'use strict';
const $ = (id) => document.getElementById(id);
const pending = '待归类';
const colors = {
  '工程技术':['#557c91','#e9f0f4','#263947'], 'AI 技术':['#70679d','#eeecf6','#38324d'],
  '内容创作':['#9e7650','#f4eee3','#423526'], '个人发展':['#8d6559','#f2e7df','#44342f'],
  '思想与人文':['#a96c83','#f5eaf0','#453140'], '其他':['#7e7669','#eee8dc','#3b352e'],
  '待归类':['#907e6c','#f0ede7','#3c3530']
};
let category = '', page = 1, state, editing, importing = false;
let activeRequest, timer, dragDepth = 0;
let readerItem, readerRequest;
let summaryEditor;
const method = {pending:'待归类', auto:'自动归类', ai:'AI 归类', manual:'手工整理', archive:'原卡片库分类'};
const chatChannel = 'dsh-html-cards-discussion';
const appearanceKey = 'pagestudio-appearance';
let discussionAvailable = false;
let release;
let checkingRelease = false;
let installingRelease = false;
let releaseChecked = false;
const starterHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>我的笔记</title>
</head>
<body>
  <h1>我的笔记</h1>
  <p>从这里开始写。</p>
</body>
</html>`;

function el(tag, name, text) {
  const node = document.createElement(tag);
  if (name) node.className = name;
  if (text != null) node.textContent = text;
  return node;
}
function tint(node, cat) {
  const palette = colors[cat];
  if (!palette) return;
  const [dot, light, dark] = palette;
  node.style.setProperty('--tint', dot);
  node.style.setProperty('--chip', light);
  node.style.setProperty('--chip-dark', dark);
}
function followTheme() {
  let host;
  try {
    if (window.parent !== window) host = window.parent.document.body;
  } catch { /* Standalone and cross-origin previews use the system theme. */ }
  const media = matchMedia('(prefers-color-scheme: dark)');
  const options = $('appearanceOptions');
  function readPreference() {
    try {
      const saved = JSON.parse(localStorage.getItem(appearanceKey));
      options.elements.appearance.value = saved?.appearance === 'retro' ? 'retro' : 'song';
      options.elements.mode.value = ['light', 'dark'].includes(saved?.mode) ? saved.mode : 'auto';
    } catch {
      options.elements.appearance.value = 'song';
      options.elements.mode.value = 'auto';
    }
  }
  const sync = () => {
    const { appearance, mode } = options.elements;
    const systemDark = host ? host.hasAttribute('data-ds-dark-theme') : media.matches;
    const dark = mode.value === 'auto' ? systemDark : mode.value === 'dark';
    document.documentElement.dataset.appearance = appearance.value;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    syncReaderTheme();
    syncWorkspaceTheme();
  };
  $('appearanceButton').onclick = () => $('appearanceDialog').showModal();
  options.addEventListener('change', () => {
    const { appearance, mode } = options.elements;
    try {
      localStorage.setItem(appearanceKey, JSON.stringify({ appearance: appearance.value, mode: mode.value }));
    } catch { /* Still apply the preference in the current window. */ }
    sync();
  });
  const observer = host ? new MutationObserver(sync) : null;
  if (observer) observer.observe(host, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  else media.addEventListener('change', sync);
  window.addEventListener('storage', event => {
    if (event.key === appearanceKey || event.key === null) {
      readPreference();
      sync();
    }
  });
  readPreference();
  sync();
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer?.disconnect();
    media.removeEventListener('change', sync);
  });
}
function activeAppearance() {
  const { theme, appearance } = document.documentElement.dataset;
  return { theme, appearance };
}
function syncWorkspaceTheme() {
  if (window.parent !== window) updateHost('appearance', activeAppearance());
}
function message(id, text, error = false) {
  $(id).textContent = text;
  $(id).hidden = !text;
  $(id).classList.toggle('error', error);
}
async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || '操作未完成'), { status: response.status });
  return data;
}
function post(path, body, contentType) {
  const headers = {'X-HTML-Cards':'local'};
  if (contentType) headers['Content-Type'] = contentType;
  return request(path, {method:'POST', headers, body});
}
async function refresh() {
  activeRequest?.abort();
  const ctrl = new AbortController();
  activeRequest = ctrl;
  const params = new URLSearchParams({q:$('search').value, category, page});
  try {
    const result = await request('./api/cards?' + params, {signal:ctrl.signal});
    if (ctrl.signal.aborted) return;
    state = result;
    if (page > 1 && !result.cards.length) {
      page = Math.max(1, Math.ceil(result.total / 30));
      await refresh();
      return;
    }
    render();
  } catch (error) {
    if (error.name !== 'AbortError') message('status', '读取资料库失败：' + error.message, true);
  }
}
function select(cat) {
  category = cat;
  page = 1;
  refresh();
}
function render() {
  const all = Object.values(state.counts).reduce((a,b) => a + b, 0);
  const label = category || '全部文件';
  $('location').textContent = label;
  $('heading').textContent = label;
  $('count').textContent = state.total + ' 个文件';
  $('categories').replaceChildren(...['', ...state.categories].map(cat => {
    const b = el('button', 'nav-item');
    b.append(el('span', 'swatch'), el('span', '', cat || '全部文件'),
             el('span', 'nav-count', cat ? state.counts[cat] || 0 : all));
    b.setAttribute('aria-current', String(cat === category));
    b.onclick = () => select(cat);
    tint(b, cat);
    return b;
  }));
  const cards = state.cards.map(makeCard);
  if (!cards.length) {
    const box = el('div', 'empty');
    if ($('search').value.trim()) box.append(el('strong','', '没有找到匹配的文件'), el('span','', '试试另一个关键词。'));
    else if (category) box.append(el('strong','', '这个分类暂时没有文件'), el('span','', category === pending ? '新建和导入的文件会出现在这里。' : '整理待归类卡片后，归到这一类的文件会出现在这里。'));
    else box.append(el('strong','', '书架还是空的'), el('span','', '把 .html 或 .htm 文件拖进来，开始收集。'));
    cards.push(box);
  }
  $('cards').replaceChildren(...cards);
  const last = Math.max(1, Math.ceil(state.total / 30));
  $('pages').hidden = last === 1;
  $('pageLabel').textContent = page + ' / ' + last;
  $('prev').disabled = page === 1;
  $('next').disabled = page === last;
}
function makeCard(item) {
  const card = el('article', 'card');
  tint(card, item.category);
  const main = el('button', 'card-main');
  main.type = 'button';
  const top = el('div', 'card-top');
  const badge = el('span', 'badge', item.category);
  badge.title = method[item.method];
  top.append(badge, el('span', 'card-format', 'HTML'));
  main.append(top, el('h3', '', item.title), el('p', '', item.summary || item.description || '暂无摘要'));
  main.onclick = () => showReader(item);
  card.append(main);
  if (item.tags.length) {
    const tags = el('div', 'tags');
    for (const tag of item.tags) {
      const chip = el('button', '', tag);
      chip.onclick = () => {$('search').value = tag; select('');};
      tags.append(chip);
    }
    card.append(tags);
  }
  const foot = el('div', 'card-foot');
  const filename = el('span', 'filename', item.filename);
  filename.title = item.filename;
  const edit = el('button', 'edit', '编辑');
  edit.setAttribute('aria-label', '编辑 ' + item.title);
  edit.onclick = () => showEditor(item);
  foot.append(filename, edit);
  card.append(foot);
  return card;
}
let exportAvailable = false;
let exportingId;
function exportMessage(value, error = false) {
  message('exportStatus', value, error);
  $('exportStatus').hidden = !value;
}
function showReader(item) {
  readerItem = item;
  exportMessage(exportingId === item.id ? '正在导出图片…' : '');
  $('exportImages').disabled = Boolean(exportingId);
  summaryEditor = { id: item.id, saved: null, conflict: false, loading: false, saving: false };
  $('summaryText').value = '';
  message('summaryStatus', '');
  updateSummaryControls();
  $('readerZoom').textContent = '原始大小';
  $('readerTitle').textContent = item.title;
  $('download').href = './download/' + item.id;
  $('source').hidden = !item.canonical;
  if (item.canonical) $('source').href = item.canonical;
  else $('source').removeAttribute('href');
  $('frame').src = './reader/' + item.id + '?' + new URLSearchParams(activeAppearance());
  selectReaderTab(readerTabs[0]);
  $('reader').showModal();
}
function syncReaderTheme() {
  if (!readerItem) return;
  $('frame').contentWindow?.postMessage({
    channel: 'dsh-html-cards-reader',
    ...activeAppearance(),
  }, '*');
}
$('frame').addEventListener('load', syncReaderTheme);
const readerTabs = [...$('readerTabs').querySelectorAll('[role=tab]')];
function selectReaderTab(selected) {
  for (const tab of readerTabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  }
  $('readerZoom').hidden = selected.id !== 'renderTab';
  $('exportImages').hidden = !exportAvailable || selected.id !== 'renderTab';
  if (selected.id === 'summaryTab') loadSummary();
  if ((selected.id === 'codeTab' || selected.id === 'textTab') && !readerRequest) loadReaderSource();
}
for (const tab of readerTabs) tab.onclick = () => selectReaderTab(tab);
$('readerTabs').addEventListener('keydown', event => {
  const index = readerTabs.indexOf(event.target);
  const last = readerTabs.length - 1;
  const next = { ArrowLeft: (index + last) % readerTabs.length, ArrowRight: (index + 1) % readerTabs.length, Home: 0, End: last };
  if (index < 0 || !Object.hasOwn(next, event.key)) return;
  event.preventDefault();
  readerTabs[next[event.key]].focus();
  selectReaderTab(readerTabs[next[event.key]]);
});
function updateSummaryControls() {
  if (!summaryEditor) return;
  const { saved, conflict, saving } = summaryEditor;
  const input = $('summaryText');
  const value = input.value.trim();
  const count = [...value].length;
  const dirty = saved && value !== saved.summary;
  $('summaryCount').textContent = count + ' / 140 字';
  $('summaryCount').toggleAttribute('data-over', count > 140);
  input.disabled = !saved || saving;
  input.setAttribute('aria-invalid', String(count > 140));
  $('copySummary').disabled = !value || input.disabled;
  $('pasteSummary').disabled = input.disabled;
  $('saveSummary').disabled = !dirty || count > 140 || saving || conflict;
  $('generateSummary').disabled = !saved || saving || conflict || dirty;
  $('generateSummary').textContent = saved?.summary ? '重新生成摘要' : '生成摘要';
  $('generateSummary').title = dirty ? '先保存当前编辑' : '在 AI 侧栏发送生成请求';
  $('reloadSummary').hidden = !conflict;
}
async function loadSummary(replace = false) {
  const editor = summaryEditor;
  if (!editor || editor.loading || editor.saving) return;
  editor.loading = true;
  if (!editor.saved) message('summaryStatus', '正在读取摘要…');
  try {
    const saved = await request('./api/card/' + editor.id + '/summary');
    if (editor !== summaryEditor) return;
    const previous = editor.saved;
    if (previous && saved.revision < previous.revision) return;
    if (replace || !previous || saved.revision !== previous.revision) {
      const input = $('summaryText');
      editor.conflict = !replace && previous && input.value.trim() !== previous.summary;
      if (editor.conflict) {
        message('summaryStatus', '已保存的摘要有更新。当前编辑仍保留，可复制后载入新版。', true);
      } else {
        editor.saved = saved;
        input.value = saved.summary;
        message('summaryStatus', previous ? '已载入最新摘要。' : '');
      }
      updateSummaryControls();
    }
  } catch (error) {
    if (editor === summaryEditor) message('summaryStatus', error.message, true);
  } finally {
    editor.loading = false;
  }
}
$('summaryText').addEventListener('input', updateSummaryControls);
$('reloadSummary').onclick = () => loadSummary(true);
$('summaryForm').onsubmit = async event => {
  event.preventDefault();
  const editor = summaryEditor;
  if (!editor || $('saveSummary').disabled) return;
  const summary = $('summaryText').value.trim();
  editor.saving = true;
  updateSummaryControls();
  let stale = false;
  try {
    const saved = await post('./api/card/' + editor.id + '/summary',
      JSON.stringify({ summary, revision: editor.saved.revision }), 'application/json');
    refresh();
    if (editor !== summaryEditor) return;
    editor.saved = saved;
    $('summaryText').value = saved.summary;
    message('summaryStatus', '摘要已保存。');
  } catch (error) {
    if (editor !== summaryEditor) return;
    stale = error.status === 409;
    message('summaryStatus', error.message, true);
  } finally {
    if (editor === summaryEditor) {
      editor.saving = false;
      updateSummaryControls();
      if (stale) loadSummary();
    }
  }
};
$('copySummary').onclick = async () => {
  const editor = summaryEditor;
  const input = $('summaryText');
  try {
    await navigator.clipboard.writeText(input.value.trim());
    if (editor === summaryEditor) message('summaryStatus', '摘要已复制。');
  } catch {
    if (editor !== summaryEditor) return;
    input.select();
    message('summaryStatus', '已选中摘要，可用复制快捷键。');
  }
};
$('pasteSummary').onclick = async () => {
  const editor = summaryEditor;
  const input = $('summaryText');
  try {
    const text = await navigator.clipboard.readText();
    if (editor !== summaryEditor || input.disabled || !text) return;
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    input.focus();
    updateSummaryControls();
  } catch {
    if (editor !== summaryEditor) return;
    input.focus();
    message('summaryStatus', '可在摘要框使用粘贴快捷键。');
  }
};
$('generateSummary').onclick = () => {
  const { id, saved } = summaryEditor;
  openDiscussion('summary', id, saved.revision);
  message('summaryStatus', '已准备生成请求，请在 AI 侧栏发送。');
};
function bodyText(source) {
  // Template content stays inert, including images, embedded pages and scripts.
  const template = document.createElement('template');
  template.innerHTML = source;
  const body = template.content;
  for (const node of body.querySelectorAll('head,title,style,script,template,noscript,iframe,object,svg,[hidden]')) node.remove();
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest('pre')) node.data = node.data.replace(/\s+/g, ' ');
  }
  for (const node of body.querySelectorAll('br,hr')) node.replaceWith('\n');
  for (const node of body.querySelectorAll('address,article,aside,blockquote,dd,details,div,dl,dt,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,li,main,nav,ol,p,pre,section,summary,table,tr,ul')) {
    node.before('\n');
    node.after('\n');
  }
  for (const cell of body.querySelectorAll('td,th')) {
    if (cell.nextElementSibling) cell.after('\t');
  }
  return body.textContent.replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n\n').trim();
}
async function loadReaderSource() {
  const controller = new AbortController();
  readerRequest = controller;
  $('readerCode').textContent = $('readerText').textContent = '正在读取…';
  try {
    const response = await fetch('./file/' + readerItem.id, { signal: controller.signal });
    if (!response.ok) throw Error('无法读取 HTML 原件');
    const source = await response.text();
    if (controller.signal.aborted) return;
    $('readerCode').textContent = source;
    $('readerText').textContent = bodyText(source) || '没有可提取的正文。';
  } catch (error) {
    if (controller.signal.aborted) return;
    $('readerCode').textContent = $('readerText').textContent = '读取预览失败：' + error.message;
    readerRequest = undefined;
  }
}
$('readerZoom').onclick = () => {
  const button = $('readerZoom');
  const fit = button.textContent === '适合宽度';
  $('frame').contentWindow?.postMessage({ channel: 'dsh-html-cards-reader', fit }, '*');
  button.textContent = fit ? '原始大小' : '适合宽度';
};
function showEditor(item) {
  editing = item;
  message('editStatus', '');
  $('editTitle').value = item.title;
  $('editFilename').value = item.filename;
  $('editCategory').replaceChildren(...state.categories.map(cat => new Option(cat, cat)));
  $('editCategory').value = item.category;
  $('editTags').value = item.tags.join('，');
  $('editor').showModal();
}
$('reader').addEventListener('close', () => {
  $('frame').removeAttribute('src');
  readerRequest?.abort();
  readerRequest = readerItem = undefined;
  summaryEditor = undefined;
  $('readerCode').textContent = $('readerText').textContent = '';
  $('codePanel').scrollTop = $('textPanel').scrollTop = 0;
  $('codePanel').scrollLeft = 0;
});
for (const b of document.querySelectorAll('.close')) b.onclick = () => b.closest('dialog').close();
$('create').onclick = () => {
  $('createName').value = '';
  $('createCode').value = starterHtml;
  message('createStatus', '');
  $('creator').showModal();
};
$('createForm').onsubmit = async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type=submit]');
  const name = $('createName').value.trim();
  const source = $('createCode').value;
  if (!name || !source.trim()) return message('createStatus', '请填写文件名和 HTML 源码。', true);
  const filename = /\.html?$/i.test(name) ? name : name + '.html';
  submit.disabled = true;
  try {
    const item = await post('./api/create?' + new URLSearchParams({name:filename}), source, 'text/html; charset=utf-8');
    if (item.duplicate) return message('createStatus', '相同的 HTML 已在卡片库中：' + item.filename, true);
    $('creator').close();
    $('search').value = '';
    select(pending);
    message('status', '已创建并加入「待归类」 · ' + item.filename);
    showReader(item);
  } catch (error) {
    message('createStatus', error.message, true);
  } finally {
    submit.disabled = false;
  }
};
$('editForm').onsubmit = async (event) => {
  event.preventDefault();
  const b = event.currentTarget.querySelector('[type=submit]');
  b.disabled = true;
  try {
    await post('./api/card/' + editing.id, JSON.stringify({
      title:$('editTitle').value, category:$('editCategory').value, tags:$('editTags').value.split(/[，,]/),
      filename: $('editFilename').value === editing.filename ? undefined : $('editFilename').value,
    }), 'application/json');
    $('editor').close();
    await refresh();
  } catch (e) {
    message('editStatus', e.message, true);
  } finally {
    b.disabled = false;
  }
};
$('search').addEventListener('input', () => {
  clearTimeout(timer);
  page = 1;
  timer = setTimeout(refresh, 160);
});
$('prev').onclick = () => {page--; refresh();};
$('next').onclick = () => {page++; refresh();};
$('pick').onclick = () => $('files').click();
$('pickFolder').onclick = () => $('folder').click();
for (const id of ['files', 'folder']) {
  $(id).onchange = () => {
    const files = [...$(id).files];
    $(id).value = '';
    upload(files);
  };
}
function hasFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}
document.addEventListener('dragover', e => {if (hasFiles(e)) e.preventDefault();});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  upload([...e.dataTransfer.files]);
});
$('drop').addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('drop').classList.add('drag');
});
$('drop').addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drop').classList.remove('drag');
});
$('drop').addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation();
  dragDepth = 0;
  $('drop').classList.remove('drag');
  upload([...e.dataTransfer.files]);
});
async function upload(files) {
  if (importing) return;
  const manifests = files.filter(file => file.webkitRelativePath && file.name === 'deck.json');
  const deckRoots = manifests.map(file => file.webkitRelativePath.slice(0, -'deck.json'.length));
  const html = files.filter(file => /\.html?$/i.test(file.name) &&
    !deckRoots.some(root => file.webkitRelativePath.startsWith(root.replace(/\/project\/$/, '/'))));
  if (!html.length && !manifests.length) {
    message('status', '请拖入 .html 或 .htm 文件。整批文件可以用「选择文件夹」导入。', true);
    return;
  }
  importing = $('pick').disabled = $('pickFolder').disabled = true;
  let added = 0, duplicates = 0;
  const errors = [];
  const decks = [];
  for (const [index, manifest] of manifests.entries()) {
    const root = deckRoots[index];
    const form = new FormData();
    form.append('deck.json', manifest);
    for (const file of files) {
      if (!file.webkitRelativePath.startsWith(root)) continue;
      const key = file.webkitRelativePath.slice(root.length);
      if (/^(?:slides|assets|ds)\//.test(key)) form.append(key, file);
    }
    message('status', '正在导入整套幻灯片 · ' + root);
    try {
      const result = await post('./api/import-deck', form);
      if (result.duplicate) duplicates++;
      else added++;
      const missing = result.missingAssets.length ? '，未找到部分资源' : '';
      decks.push(result.title + '（' + result.slides + ' 页' + missing + '）');
    } catch (error) {
      errors.push(root + '：' + error.message);
    }
  }
  for (let i = 0; i < html.length; i++) {
    const file = html[i];
    message('status', '正在导入 ' + (i + 1) + ' / ' + html.length + ' · ' + file.name);
    try {
      const result = await post('./api/import?' + new URLSearchParams({name:file.name}), file, 'application/octet-stream');
      if (result.duplicate) duplicates++;
      else added++;
    } catch (e) {
      errors.push(file.name + '：' + e.message);
    }
  }
  const parts = [added + ' 个已导入'];
  if (added) parts.push('已放入「待归类」');
  if (duplicates) parts.push(duplicates + ' 个重复');
  if (!manifests.length && files.length > html.length) parts.push((files.length - html.length) + ' 个非 HTML 已跳过');
  if (errors.length) parts.push(errors.length + ' 个失败');
  message('status', [parts.join(' · '), ...decks, ...errors.slice(0,3)].join('\n'), errors.length > 0);
  importing = $('pick').disabled = $('pickFolder').disabled = false;
  if (added) $('search').value = '';
  select(added ? pending : category);
}
$('ai').onclick = () => {
  if (!state) return;
  if (discussionAvailable) return openDiscussion('organize');
  $('prompt').value = '请用 html-cards-organize 技能整理 HTML 卡片库的待归类卡片。按现有类别归类、补充标签，并根据内容重命名文件。文件名已经贴切的保留，材料不足的继续留在待归类。';
  message('aiStatus', '');
  $('aiDialog').showModal();
};
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('prompt').value);
    message('aiStatus', '已复制，可粘贴到 DSH 对话。');
  } catch {
    $('prompt').select();
    message('aiStatus', '已选中指令，请手动复制。');
  }
};
function openDiscussion(mode, id, revision) {
  window.parent.postMessage({ channel: chatChannel, type: 'open', mode, id, revision }, window.location.origin === 'null' ? '*' : window.location.origin);
}
function updateHost(type, data) {
  window.parent.postMessage({ channel: chatChannel, type, ...data }, window.location.origin === 'null' ? '*' : window.location.origin);
}
function setReleaseStatus(status) {
  checkingRelease = false;
  releaseChecked = true;
  release = { ...release, latest: null, native: false, ...status };
  const { installed, latest, native, incompatible, error, releases } = release;
  const current = installed ? '当前版本 ' + installed + '。' : '';
  $('versionButton').textContent = latest ? '可更新到 ' + latest : (installed ? 'v' + installed + ' · 版本与更新' : '版本与更新');
  $('versionButton').toggleAttribute('data-available', Boolean(latest));
  $('checkUpdate').disabled = false;
  $('installUpdate').hidden = !(latest && native);
  $('installUpdate').textContent = '升级到 ' + (latest ?? '');
  if (releases) {
    $('releaseLink').href = latest ? releases + '/tag/v' + latest : releases;
    $('releaseLink').textContent = latest && !native ? '下载新版 ↗' : '发行说明 ↗';
    $('releaseLink').hidden = false;
  }
  const detail = latest
    ? (native ? '可升级到 ' + latest + '。点击升级后，DSH 将安装新版。'
      : '已有新版 ' + latest + '。请下载新版安装包，并在 DSH 插件页按发行说明升级。')
    : (incompatible ? '有新版本需要先更新 DSH。' : '已是最新版本。');
  $('updateMessage').textContent = current + (error || detail);
}
async function checkRelease() {
  if (checkingRelease || installingRelease) return;
  checkingRelease = true;
  $('checkUpdate').disabled = true;
  $('installUpdate').hidden = true;
  $('updateMessage').textContent = '正在检查更新…';
  if (discussionAvailable) {
    updateHost('check-update');
    return;
  }
  try {
    const latest = await request('./api/release/latest');
    setReleaseStatus(latest);
  } catch (error) {
    setReleaseStatus({ error: error.message });
  }
}
$('versionButton').onclick = () => {
  $('updateDialog').showModal();
  if (!releaseChecked) checkRelease();
};
$('checkUpdate').onclick = checkRelease;
$('installUpdate').onclick = () => {
  if (!release?.native || !release.latest || installingRelease) return;
  installingRelease = true;
  $('checkUpdate').disabled = $('installUpdate').disabled = true;
  $('updateMessage').textContent = '正在通过 DSH 安装 ' + release.latest + '…';
  updateHost('install-update');
};
$('discussion').onclick = () => openDiscussion('chat');
$('askCard').onclick = () => { if (readerItem) openDiscussion('card', readerItem.id); };
$('exportImages').onclick = () => {
  if (!readerItem || !exportAvailable || exportingId) return;
  exportingId = readerItem.id;
  $('exportImages').disabled = true;
  exportMessage('正在准备图片…');
  window.parent.postMessage({
    channel: chatChannel, type: 'export-images', id: exportingId, title: readerItem.title,
    ...activeAppearance(),
    width: $('frame').clientWidth, height: $('frame').clientHeight,
  }, window.location.origin === 'null' ? '*' : window.location.origin);
};
window.addEventListener('message', event => {
  if (window.parent === window || event.source !== window.parent || event.origin !== window.location.origin || event.data?.channel !== chatChannel) return;
  if (event.data.type === 'connect') {
    syncWorkspaceTheme();
    discussionAvailable = true;
    exportAvailable = event.data.canExport === true;
    $('exportImages').hidden = !exportAvailable || $('renderPanel').hidden;
    $('discussion').hidden = $('askCard').hidden = $('generateSummary').hidden = false;
    checkRelease();
  } else if (event.data.type === 'update-status') {
    setReleaseStatus(event.data);
  } else if (event.data.type === 'update-finished') {
    installingRelease = false;
    $('checkUpdate').disabled = $('installUpdate').disabled = false;
    $('installUpdate').hidden = true;
    $('updateMessage').textContent = event.data.message;
  } else if (['export-progress', 'export-done'].includes(event.data.type) && exportingId === event.data.id) {
    if (readerItem?.id === exportingId) exportMessage(event.data.message, event.data.error);
    if (event.data.type === 'export-done') {
      exportingId = undefined;
      $('exportImages').disabled = false;
    }
  } else if (event.data.type === 'refresh') {
    if (!importing) refresh();
    if (summaryEditor?.saved || !$('summaryPanel').hidden) loadSummary();
  }
});
window.addEventListener('focus', () => {
  if (!importing) refresh();
  if (!$('summaryPanel').hidden) loadSummary();
});
followTheme();
refresh();
if (window.parent === window) checkRelease();
