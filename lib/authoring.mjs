import { basename } from 'node:path';
import { MAX_FILE, htmlFilename } from './library.mjs';
import { decodeHtml, extractMetadata } from './metadata.mjs';
import { renderDocument } from '../vendor/article-cards/render.mjs';
import { documentDigest, validate } from '../vendor/article-cards/validate.mjs';
import { deckFromWorkspace, importDeck } from './decks.mjs';

const MAX_ARTICLE = 4 * 1024 * 1024;

async function readInput(ctx, execution, path, extension, limit) {
  if (typeof path !== 'string' || !extension.test(path)) throw Error('请选择扩展名正确的文件');
  const { agent, signal } = execution;
  const cwd = agent ? await ctx.workingDirectory.ensure(agent, signal) : undefined;
  const target = await ctx.fs.resolve(path, { cwd, signal });
  if (!extension.test(ctx.fs.processPath(target))) throw Error('文件指向不支持的类型');
  return Buffer.from(await ctx.fs.readBytes(target, signal, limit));
}

function defaultName(title) {
  const stem = [...title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 50).join('').replace(/^[.\s]+|[.\s]+$/g, '');
  return (stem || '文章信息卡') + '.html';
}

export function createAuthoring(ctx, library) {
  return {
    async importHtml({ filename, file_path, html, deck_path }, execution) {
      if ([file_path, html, deck_path].filter(value => value !== undefined).length !== 1) {
        throw Error('请选择一个 HTML 文件、幻灯片项目或一份 HTML 源码');
      }
      if (deck_path !== undefined || /(?:^|[\\/])deck\.json$/.test(file_path ?? '')) {
        const files = await deckFromWorkspace(ctx, execution, deck_path ?? file_path);
        return importDeck(library, files, filename, execution.signal);
      }
      const fromFile = file_path !== undefined;
      const bytes = fromFile
        ? await readInput(ctx, execution, file_path, /\.html?$/i, MAX_FILE)
        : Buffer.from(html, 'utf8');
      if (bytes.length > MAX_FILE) throw Error('HTML 超过 32 MiB');
      const text = fromFile ? decodeHtml(bytes) : html;
      if (!/<(?:!doctype\s+html\b|[a-z][\w-]*[\s/>])/i.test(text) || text.includes('\0')) throw Error('未找到可导入的 HTML 标记');
      const source = !fromFile && decodeHtml(bytes) !== text.replace(/^\uFEFF/, '')
        ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]) : bytes;
      const metadata = extractMetadata(source);
      const name = htmlFilename(filename ?? (fromFile ? basename(file_path.replaceAll('\\', '/')) : defaultName(metadata.title)));
      execution.signal?.throwIfAborted();
      return library.ingest(name, source, metadata);
    },
    async createArticle({ filename, source, source_path, card_json }, execution) {
      if ((source === undefined) === (source_path === undefined)) throw Error('请选择一个原文文件或提供完整原文');
      const article = source_path === undefined ? source
        : new TextDecoder('utf-8', { fatal: true }).decode(await readInput(ctx, execution, source_path, /\.(?:md|markdown|txt)$/i, MAX_ARTICLE));
      if (!article.trim() || Buffer.byteLength(article) > MAX_ARTICLE) throw Error('原文为空或超过 4 MiB');
      if (Buffer.byteLength(card_json) > MAX_ARTICLE) throw Error('卡片内容超过 4 MiB');
      let card;
      try { card = JSON.parse(card_json); } catch { throw Error('卡片内容必须是有效的 JSON'); }
      const report = validate(card, article);
      const name = htmlFilename(filename ?? defaultName(card.meta.title));
      const bytes = Buffer.from(renderDocument(card, documentDigest(card, article)), 'utf8');
      execution.signal?.throwIfAborted();
      const result = library.ingest(name, bytes, {
        ...extractMetadata(bytes), title: card.meta.title, canonical: card.meta.sourceUrl,
      });
      return { ...result, mode: card.mode, canvas: report.canvas, quoteVerified: report.quoteVerified,
        declaredKeyPointCount: report.declaredKeyPointCount, browserLayout: 'not-run' };
    },
  };
}
