const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value;
});

async function pngArchive(files) {
  const records = [];
  const directory = [];
  let offset = 0;
  for (const { name, blob } of files) {
    const label = new TextEncoder().encode(name);
    let crc = 0xffffffff;
    for (const byte of new Uint8Array(await blob.arrayBuffer())) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + label.length);
    const info = new DataView(header.buffer);
    info.setUint32(0, 0x04034b50, true);
    info.setUint16(4, 20, true);
    info.setUint16(6, 0x800, true);
    info.setUint16(12, 33, true);
    info.setUint32(14, crc, true);
    info.setUint32(18, blob.size, true);
    info.setUint32(22, blob.size, true);
    info.setUint16(26, label.length, true);
    header.set(label, 30);
    const entry = new Uint8Array(46 + label.length);
    const fields = new DataView(entry.buffer);
    fields.setUint32(0, 0x02014b50, true);
    fields.setUint16(4, 20, true);
    entry.set(header.subarray(4, 28), 6);
    fields.setUint32(42, offset, true);
    entry.set(label, 46);
    directory.push(entry);
    records.push(header, blob);
    offset += header.length + blob.size;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directory.reduce((size, entry) => size + entry.length, 0), true);
  end.setUint32(16, offset, true);
  return new Blob([...records, ...directory, end.buffer], { type: 'application/zip' });
}

function bounded(task, signal, message = '渲染等待超时，请重试。') {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
    const abort = () => { cleanup(); reject(signal.reason); };
    const timeout = setTimeout(() => { cleanup(); reject(Error(message)); }, 20000);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(task).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

const toPng = canvas => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('无法生成 PNG。')), 'image/png');
});

async function capturePage(guest, dimensions, run) {
  const { width, height, artboard } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 96000) {
    throw Error('页面尺寸超出图片导出范围。');
  }
  if (artboard) {
    guest.style.width = width + 'px';
    guest.style.height = height + 'px';
  }
  const scale = Math.min(1, 16384 / height, Math.sqrt(32000000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  let top = 0;
  while (top < height) {
    const viewport = await run('window.htmlCardsCapture.scroll(' + top + ')');
    const visibleTop = top - viewport.y;
    const visibleHeight = Math.min(height - top, viewport.height - visibleTop);
    if (visibleTop < 0 || visibleHeight < 1 || viewport.width < width) throw Error('无法取得完整页面。');
    const image = await run(() => guest.capturePage({ x: 0, y: visibleTop, width, height: visibleHeight }));
    if (image.isEmpty()) throw Error('渲染器未返回图片。');
    const picture = new Image();
    picture.src = image.toDataURL();
    await run(() => picture.decode());
    const start = Math.round(top / height * canvas.height);
    const end = Math.round((top + visibleHeight) / height * canvas.height);
    if (end > start) context.drawImage(picture, 0, start, canvas.width, end - start);
    top += visibleHeight;
  }
  return toPng(canvas);
}

export async function exportImages(desktop, { id, title, theme, width, height }, signal, progress) {
  const url = '/html-cards/reader/' + id + '?capture=1&theme=' + theme;
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('无法读取渲染页面。');
  const source = await response.text();
  const { lease, partition } = await desktop.browser.acquire('html-cards-image-export');
  const guest = document.createElement('webview');
  const run = task => bounded(typeof task === 'function' ? task() : guest.executeJavaScript(task), signal);
  const name = [...title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 60).join('').replace(/^[.\s]+|[.\s]+$/g, '') || 'HTML 卡片';
  const files = [];
  let bytes = 0;
  try {
    signal.throwIfAborted();
    guest.setAttribute('name', lease);
    guest.setAttribute('partition', partition);
    guest.setAttribute('src', 'about:blank#' + lease);
    guest.setAttribute('aria-hidden', 'true');
    guest.tabIndex = -1;
    guest.style.cssText = 'position:fixed;left:calc(100vw - 1px);top:0;opacity:.01;pointer-events:none;z-index:-1';
    guest.style.width = width + 'px';
    guest.style.height = height + 'px';
    const ready = new Promise(resolve => guest.addEventListener('dom-ready', resolve, { once: true }));
    document.body.append(guest);
    await bounded(ready, signal);
    guest.setAudioMuted(true);
    await run('document.open(); document.write(' + JSON.stringify(source) + '); document.close(); true');
    const count = await run('window.htmlCardsCapture?.count');
    if (!Number.isInteger(count) || count < 1 || count > 200) throw Error('无法识别要导出的页面。');
    for (let index = 0; index < count; index++) {
      progress('正在导出 ' + (index + 1) + ' / ' + count + ' 页…');
      const dimensions = await run('window.htmlCardsCapture.page(' + index + ')');
      const blob = await capturePage(guest, dimensions, run);
      bytes += blob.size;
      if (bytes > 256 * 1024 * 1024) throw Error('导出图片总量超过 256 MiB。');
      files.push({ name: name + (count > 1 ? '-' + String(index + 1).padStart(String(count).length, '0') : '') + '.png', blob });
    }
  } finally {
    guest.remove();
    await desktop.browser.release(lease).catch(() => {});
  }
  signal.throwIfAborted();
  const blob = files.length === 1 ? files[0].blob : await pngArchive(files);
  const filename = files.length === 1 ? files[0].name : name + '.zip';
  const objectUrl = URL.createObjectURL(blob);
  try {
    const result = await desktop.fileActions.save({ url: objectUrl, mode: 'download', name: filename, mediaType: blob.type });
    return result.status === 'saved' ? { filename, count: files.length } : null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
