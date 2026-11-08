import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_FILE, htmlFilename } from './library.mjs';
import { decodeHtml, extractMetadata } from './metadata.mjs';
import { renderReader } from './reader.mjs';
import { importDeck, isDeckFilePath } from './decks.mjs';
import { checkRelease, releaseInfo } from './releases.mjs';

export const BASE = '/html-cards';
const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' about:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function requestBody(req, max) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) {
      req.resume();
      throw new RequestError('请求超过文件大小上限', 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sameOrigin(req) {
  if (req.headers['x-html-cards'] !== 'local' || req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin || origin === 'dsh-app://app') return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === req.headers.host;
  } catch {
    return false;
  }
}

function disposition(filename) {
  return "attachment; filename*=UTF-8''" + encodeURIComponent(filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
}

function editorHtml(bytes) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError('请输入 UTF-8 HTML 源码');
  }
  if (!source.trim() || source.includes('\0')) throw new RequestError('请输入有效的 HTML 源码');
  // Preserve UTF-8 when the edited document still declares a legacy charset.
  return decodeHtml(bytes) === source ? bytes : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
}

export function createHandler(library) {
  return async function handle(req, res) {
    let releaseWrite;
    function send(status, body, type = 'text/plain; charset=utf-8', headers = {}) {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    }
    const json = (status, data) => send(status, JSON.stringify(data), 'application/json; charset=utf-8');
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (path === BASE && ['GET', 'HEAD'].includes(method)) return send(308, '', undefined, { location: BASE + '/' });
      if (!path.startsWith(BASE + '/')) return json(404, { error: '找不到页面' });
      const route = path.slice(BASE.length);
      const card = route.match(/^\/api\/card\/([a-f0-9]{64})$/);
      const summary = route.match(/^\/api\/card\/([a-f0-9]{64})\/summary$/);
      const details = route.match(/^\/api\/card\/([a-f0-9]{64})\/details$/);
      const source = route.match(/^\/api\/card\/([a-f0-9]{64})\/source$/);
      const removal = route.match(/^\/api\/card\/([a-f0-9]{64})\/delete$/);
      if (route === '/api/storage') {
        if (!sameOrigin(req)) return json(403, { error: '请从 PageStudio 操作' });
        if (method === 'GET') return json(200, library.storage());
        if (method === 'POST') {
          let input;
          try {
            input = JSON.parse((await requestBody(req, 16384)).toString('utf8'));
          } catch (error) {
            if (error instanceof SyntaxError) throw new RequestError('资料库设置格式无效');
            throw error;
          }
          return json(200, library.setStorage(input?.directory, input?.create));
        }
        return json(405, { error: '不支持该操作' });
      }
      if (method === 'POST') {
        if (!sameOrigin(req)) return json(403, { error: '请从 HTML 卡片库操作' });
        releaseWrite = library.holdWrite();
        if (source) {
          try {
            const bytes = editorHtml(await requestBody(req, MAX_FILE));
            if (bytes.length > MAX_FILE) throw new RequestError('HTML 超过 32 MiB', 413);
            const saved = library.saveSource(source[1], url.searchParams.get('version'), bytes, extractMetadata(bytes));
            return saved ? json(200, saved) : json(404, { error: '卡片不存在' });
          } catch (error) {
            if (error.code || error.status) throw error;
            return json(400, { error: error.message });
          }
        }
        if (removal) {
          return library.removeCard(removal[1]) ? json(200, { ok: true }) : json(404, { error: '卡片不存在' });
        }
        if (route === '/api/import-deck') {
          const body = await requestBody(req, MAX_FILE);
          try {
            const form = await new Request('http://localhost', {
              method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' }, body,
            }).formData();
            const entries = new Map();
            for (const [key, file] of form) {
              if (!isDeckFilePath(key) || typeof file === 'string' || entries.has(key) || entries.size >= 1000) {
                throw Error('幻灯片项目文件无效或过多');
              }
              entries.set(key, file);
            }
            const files = {
              async read(key, limit) {
                const file = entries.get(key);
                if (!file) return undefined;
                if (file.size > limit) throw Error('幻灯片文件过大：' + key);
                return Buffer.from(await file.arrayBuffer());
              },
              list(folder) {
                const prefix = folder + '/';
                return [...entries.keys()].filter(key => key.startsWith(prefix))
                  .map(key => key.slice(prefix.length)).filter(key => !key.includes('/'));
              },
            };
            return json(201, await importDeck(library, files));
          } catch (error) {
            if (error.code) throw error;
            return json(400, { error: error.message });
          }
        }
        if (route === '/api/import' || route === '/api/create') {
          let bytes = await requestBody(req, MAX_FILE);
          try {
            const name = url.searchParams.get('name') || '';
            const creating = route === '/api/create';
            if (creating) bytes = editorHtml(bytes);
            return json(201, library.ingest(creating ? htmlFilename(name) : name, bytes, extractMetadata(bytes)));
          } catch (error) {
            if (error.code) throw error;
            return json(400, { error: error.message });
          }
        }
        if (!card && !summary && !details && route !== '/api/categories') return json(404, { error: '找不到操作' });
        try {
          const input = JSON.parse((await requestBody(req, 4096)).toString('utf8'));
          if (route === '/api/categories') {
            if (input?.action === 'add') return json(201, { name: library.addCategory(input.name) });
            if (input?.action === 'rename') {
              const renamed = library.renameCategory(input.name, input.newName);
              return renamed ? json(200, renamed) : json(404, { error: '分类不存在' });
            }
            if (input?.action === 'remove') {
              const removed = library.removeCategory(input.name);
              return removed ? json(200, removed) : json(404, { error: '分类不存在' });
            }
            return json(400, { error: '无效的分类操作' });
          }
          if (details) {
            const id = details[1];
            const saved = library.saveDetails(id, input);
            if (saved) return json(200, { ...saved, categories: library.categories() });
            return library.details(id) ? json(409, { error: '卡片有更新，请先载入最新资料。' })
              : json(404, { error: '卡片不存在' });
          }
          if (summary) {
            const id = summary[1];
            const saved = library.saveSummary(id, input?.summary, input?.revision);
            if (saved) return json(200, saved);
            return library.summary(id) ? json(409, { error: '已保存的摘要有更新，请先载入新版。' })
              : json(404, { error: '卡片不存在' });
          }
          return library.edit(card[1], input) ? json(200, { ok: true }) : json(404, { error: '卡片不存在' });
        } catch (error) {
          if (error.code) throw error;
          return json(error.status || 400, { error: error instanceof SyntaxError ? '卡片数据格式无效' : error.message });
        }
      }
      if (!['GET', 'HEAD'].includes(method)) return json(405, { error: '不支持该操作' });
      if (route === '/api/cards') return json(200, library.list(Object.fromEntries(url.searchParams)));
      if (route === '/api/categories') return json(200, library.categoryCatalog());
      if (route === '/api/release') return json(200, releaseInfo());
      if (route === '/api/release/latest') {
        try {
          return json(200, await checkRelease());
        } catch {
          return json(503, { error: '暂时无法检查更新。' });
        }
      }
      if (summary) {
        const saved = library.summary(summary[1]);
        return saved ? json(200, saved) : json(404, { error: '卡片不存在' });
      }
      if (details) {
        const saved = library.details(details[1]);
        return saved ? json(200, { ...saved, categories: library.categories() }) : json(404, { error: '卡片不存在' });
      }
      if (card) {
        const context = library.cardContext(card[1]);
        return context ? json(200, context) : json(404, { error: '卡片不存在' });
      }
      const file = route.match(/^\/(reader|file|download)\/([a-f0-9]{64})$/);
      if (file) {
        const item = library.file(file[2]);
        if (!item) return json(404, { error: '找不到原件' });
        if (file[1] === 'reader') {
          const { body, policy } = await renderReader(item, {
            theme: url.searchParams.get('theme'),
            appearance: url.searchParams.get('appearance'),
            capture: url.searchParams.get('capture') === '1',
          });
          return send(200, body, 'text/html; charset=utf-8', { 'content-security-policy': policy });
        }
        if (file[1] === 'file') return send(200, decodeHtml(item.raw), 'text/plain; charset=utf-8', { etag: '"' + item.version + '"' });
        return send(200, Buffer.from(item.raw), 'application/octet-stream', { 'content-disposition': disposition(item.filename) });
      }
      const assets = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/icon.svg': ['../icon.svg', 'image/svg+xml'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/export.js': ['export.js', 'text/javascript; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/themes.css': ['themes.css', 'text/css; charset=utf-8'],
        '/discussion.css': ['discussion.css', 'text/css; charset=utf-8'],
      };
      const asset = Object.hasOwn(assets, route) ? assets[route] : undefined;
      if (!asset) return json(404, { error: '找不到页面' });
      return send(200, await readFile(join(WEB, asset[0])), asset[1], { 'content-security-policy': APP_CSP });
    } catch (error) {
      if (!error.status) console.error('[pagestudio-dsh]', error);
      return json(error.status || 500, { error: error.status ? error.message : '操作未完成，请检查本机资料库权限' });
    } finally {
      releaseWrite?.();
    }
  };
}
