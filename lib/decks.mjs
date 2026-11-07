import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep, posix } from 'node:path';
import { MAX_FILE, htmlFilename } from './library.mjs';
import { decodeHtml, extractMetadata } from './metadata.mjs';
import { escapeHtml } from '../vendor/article-cards/render.mjs';

const MAX_SLIDES = 200;
const SLIDE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BLOB = /^\/_blob\/([a-f0-9]{32})$/;
const types = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};
const runtime = new URL('../web/deck.js', import.meta.url);
const stylesheet = new URL('../web/deck.css', import.meta.url);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const e = escapeHtml;

export function isDeckFilePath(path) {
  return typeof path === 'string' && path.length <= 900 && !/[\\\u0000-\u001f\u007f]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}

export async function deckFromWorkspace(ctx, execution, path) {
  if (typeof path !== 'string' || !path.trim()) throw Error('请选择幻灯片项目目录或 deck.json');
  const { agent, signal } = execution;
  const cwd = agent ? await ctx.workingDirectory.ensure(agent, signal) : undefined;
  const target = await ctx.fs.resolve(path, { cwd, signal });
  const absolute = ctx.fs.processPath(target);
  let root;
  if (basename(absolute) === 'deck.json') root = dirname(absolute);
  else if ((await ctx.fs.stat(target, signal))?.type === 'directory') root = absolute;
  else throw Error('请选择幻灯片项目目录或 deck.json');

  function fileAt(folder, key) {
    return ctx.fs.resolve(join(folder, key), { signal }).then(file => {
      const local = relative(folder, ctx.fs.processPath(file));
      if (local === '..' || local.startsWith('..' + sep) || resolve(folder, local) !== ctx.fs.processPath(file)) {
        throw Error('项目文件指向了目录之外：' + key);
      }
      return file;
    });
  }
  if (basename(absolute) !== 'deck.json' && !(await ctx.fs.stat(await fileAt(root, 'deck.json'), signal))) {
    root = ctx.fs.processPath(await fileAt(root, 'project'));
  }
  return {
    async read(key, limit) {
      const file = await fileAt(root, key);
      const info = await ctx.fs.stat(file, signal);
      if (!info) return undefined;
      if (info.type !== 'file') throw Error('项目文件不是普通文件：' + key);
      if (info.size > limit) throw Error('幻灯片文件过大：' + key);
      return Buffer.from(await ctx.fs.readBytes(file, signal, limit));
    },
    async list(folder) {
      const directory = await fileAt(root, folder);
      if ((await ctx.fs.stat(directory, signal))?.type !== 'directory') return [];
      const entries = await ctx.fs.listDir(directory, signal);
      return entries.filter(entry => entry.type === 'file').map(entry => entry.name);
    },
  };
}

export async function importDeck(library, files, filename, signal) {
  const manifest = await files.read('deck.json', 256 * 1024);
  if (!manifest) throw Error('未找到 deck.json');
  let deck;
  try { deck = JSON.parse(utf8.decode(manifest)); } catch { throw Error('deck.json 不是有效的 JSON'); }
  if (!Array.isArray(deck?.order) || deck.order.length > MAX_SLIDES ||
      deck.order.some(id => typeof id !== 'string' || !SLIDE_ID.test(id)) || new Set(deck.order).size !== deck.order.length) {
    throw Error('deck.json 的幻灯片顺序无效');
  }
  const available = (await files.list('slides')).filter(name => name.endsWith('.html'))
    .map(name => name.slice(0, -5)).filter(id => SLIDE_ID.test(id)).sort();
  const ordered = new Set(deck.order);
  const ids = [...deck.order, ...available.filter(id => !ordered.has(id))];
  if (!ids.length || ids.length > MAX_SLIDES) throw Error('幻灯片套件须包含 1 至 200 页');
  const title = typeof deck.title === 'string' && deck.title.trim() ? deck.title.trim().slice(0, 200) : 'HTML 幻灯片';
  const safeTitle = [...title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 50).join('').replace(/^[.\s]+|[.\s]+$/g, '');
  const name = htmlFilename(filename ?? ((safeTitle || '幻灯片') + '.html'));
  const missing = new Set();
  const encoded = new Map();
  let blobs;
  let size = 0;
  function charge(text) {
    size += Buffer.byteLength(text);
    if (size > MAX_FILE) throw Error('整套幻灯片超过 32 MiB');
    return text;
  }
  async function dataUrl(value, from) {
    if (/^data:/i.test(value)) return value;
    if (/^(?:https?:)?\/\//i.test(value)) {
      missing.add(value);
      return '';
    }
    const blob = value.match(BLOB);
    let key;
    if (blob) {
      blobs ??= await files.list('assets');
      const file = blobs.find(name => name.startsWith(blob[1] + '.') && Object.hasOwn(types, posix.extname(name).slice(1).toLowerCase()));
      if (file) key = 'assets/' + file;
    } else if (!value.startsWith('/') && !value.includes(':')) {
      key = value.startsWith('project/') ? value.slice(8) : posix.normalize(posix.join(from, value));
    }
    const ext = key && posix.extname(key).slice(1).toLowerCase();
    if (isDeckFilePath(key) && /^(?:assets|ds)\//.test(key) && Object.hasOwn(types, ext)) {
      if (!encoded.has(key)) {
        const bytes = await files.read(key, Math.floor(MAX_FILE * 0.75));
        encoded.set(key, bytes ? 'data:' + types[ext] + ';base64,' + bytes.toString('base64') : '');
      }
      if (encoded.get(key)) return encoded.get(key);
    }
    missing.add(value);
    return '';
  }
  async function slideAssets(html) {
    const assets = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"]+))\s*\)/gi;
    const chunks = [];
    let start = 0;
    for (const match of html.matchAll(assets)) {
      const value = match.slice(1).find(part => part !== undefined);
      const url = await dataUrl(value, 'slides');
      chunks.push(charge(html.slice(start, match.index)));
      chunks.push(charge(match[0].toLowerCase().startsWith('url(') ? 'url(' + url + ')' : 'src="' + e(url) + '"'));
      start = match.index + match[0].length;
    }
    chunks.push(charge(html.slice(start)));
    return chunks.join('');
  }

  const slides = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    const source = await files.read('slides/' + id + '.html', MAX_FILE - size);
    if (!source) throw Error('缺少幻灯片：' + id + '.html');
    const html = decodeHtml(source).trim();
    const section = html.match(/^<section\b((?:[^>"']|"[^"]*"|'[^']*')*)>[\s\S]*<\/section\s*>$/i);
    if (!section || !new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']').test(section[1])) {
      throw Error('幻灯片须包含与文件名相符的 section：' + id + '.html');
    }
    const content = html.replace(/<\/?(?:meta|base)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, '');
    slides.push('<div data-html-cards-slide>' + await slideAssets(content) + '</div>');
  }
  const fontCss = [];
  for (const face of Object.values(deck.faces ?? {}).slice(0, 12)) {
    if (!face || typeof face.family !== 'string' || !/^[a-z][a-z0-9 _-]{0,39}$/i.test(face.family)) continue;
    const source = face.src ?? face.href;
    if (typeof source !== 'string') continue;
    const url = await dataUrl(source, '.');
    if (url.startsWith('data:font/')) fontCss.push(charge('@font-face{font-family:"' + face.family + '";src:url(' + url + ')}'));
  }
  const [script, css] = await Promise.all([readFile(runtime, 'utf8'), readFile(stylesheet, 'utf8')]);
  const player = script + '\nmountHtmlCardsDeck(document.querySelector("main[data-html-cards-deck]"));';
  const hash = createHash('sha256').update(player).digest('base64');
  const policy = "default-src 'none'; script-src 'sha256-" + hash + "'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  const bytes = Buffer.from('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + policy + '"><title>' + e(title) + '</title>' +
    '<style>' + css + fontCss.join('') + '</style></head><body><main data-html-cards-deck="1">' +
    slides.join('\n') + '</main><script>' + player + '</script></body></html>');
  signal?.throwIfAborted();
  const card = library.ingest(name, bytes, extractMetadata(bytes));
  return { ...card, slides: slides.length, missingAssets: [...missing].slice(0, 20) };
}
