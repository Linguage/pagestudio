import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_FILE = 32 * 1024 * 1024;
export const MAX_SUMMARY = 140;
export const PAGE_SIZE = 30;
export const FOLDERS = {
  'ai-tech': 'AI 技术',
  'content-creation': '内容创作',
  'engineering': '工程技术',
  'personal-dev': '个人发展',
  'thought-pieces': '思想与人文',
  'misc': '其他',
};
export const PENDING = '待归类';
export const CATEGORIES = [...Object.values(FOLDERS), PENDING];

const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
export const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fold = text => text.normalize('NFKC').toLowerCase();
const tagsFor = values => Array.isArray(values) ? [...new Set(values.map(t => clean(t, 28)).filter(Boolean))].slice(0, 6) : [];

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2000) return url.href;
  } catch {}
  return '';
}

export function htmlFilename(value) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  const stem = name.replace(/\.html?$/i, '');
  if (!/\.html?$/i.test(name) || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) ||
      !stem.trim() || /^[.\s]+$/.test(stem) || Buffer.byteLength(name) > 240 || !name.isWellFormed()) {
    throw Error('文件名必须是有效的 .html 或 .htm 文件名');
  }
  return name;
}

function availableName(sql, id, name) {
  const taken = sql.prepare('SELECT 1 FROM cards WHERE filename=? COLLATE NOCASE AND id<>?');
  if (!taken.get(name, id)) return name;
  const extension = name.match(/\.html?$/i)[0];
  const stem = name.slice(0, -extension.length);
  for (let n = 2; ; n++) {
    const suffix = '-' + n + extension;
    const chars = [...stem];
    while (Buffer.byteLength(chars.join('') + suffix) > 240) chars.pop();
    const candidate = chars.join('') + suffix;
    if (!taken.get(candidate, id)) return candidate;
  }
}

function record(row) {
  return row ? { ...row, tags: JSON.parse(row.tags) } : null;
}

function readDetails(sql, id) {
  const row = sql.prepare(`
    SELECT title,category,tags,COALESCE(summary,'') AS summary,COALESCE(revision,0) AS revision
    FROM cards LEFT JOIN card_summaries ON card_id=cards.id WHERE cards.id=?
  `).get(id);
  if (!row) return undefined;
  const version = createHash('sha256').update(JSON.stringify(row)).digest('hex');
  const suggestion = sql.prepare('SELECT details FROM card_suggestions WHERE card_id=? AND version=?').get(id, version);
  return { ...record(row), version, suggestion: suggestion ? JSON.parse(suggestion.details) : null };
}

function validateDetails(input, suggestion = false) {
  const { title, category, tags, summary, version } = input ?? {};
  if (!validId(version)) throw Error('卡片版本无效');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || !title.isWellFormed()) {
    throw Error('请输入不超过 200 字的卡片标题');
  }
  if (!CATEGORIES.includes(category)) throw Error('请选择已有分类');
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.isWellFormed() || tag.trim().length > 28)) {
    throw Error('每个标签最多 28 字');
  }
  const labels = [...new Set(tags.map(tag => clean(tag, 28)).filter(Boolean))];
  if (labels.length > 6) throw Error('最多可添加 6 个标签');
  if (typeof summary !== 'string' || !summary.isWellFormed() || (suggestion && !summary.trim())) throw Error('请输入有效的摘要');
  if ([...summary.trim()].length > MAX_SUMMARY) throw Error('卡片摘要不能超过 140 字');
  return { title: clean(title, 200), category, tags: labels, summary: summary.trim(), version };
}

function editTransaction(sql, action) {
  sql.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    sql.exec('COMMIT');
    return result;
  } catch (error) {
    sql.exec('ROLLBACK');
    throw error;
  }
}

export function storageDirectory() {
  return resolve(process.env.DSH_HTML_CARDS_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-html-cards'));
}

export function createLibrary(directory = storageDirectory()) {
  let db;
  const connect = () => {
    if (db) return db;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const next = new DatabaseSync(join(directory, 'library.sqlite'));
    try {
      next.exec(`
        PRAGMA busy_timeout=5000;
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS cards (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
          excerpt TEXT NOT NULL, canonical TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
          method TEXT NOT NULL, added TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, raw BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card_summaries (
          card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          summary TEXT NOT NULL,
          revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card_suggestions (
          card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
          version TEXT NOT NULL,
          details TEXT NOT NULL
        );
      `);
      return (db = next);
    } catch (error) {
      next.close();
      throw error;
    }
  };
  return {
    close() {
      db?.close();
      db = undefined;
    },
    ingest(file, bytes, metadata = {}, seedCategory) {
      const filename = basename(String(file).replaceAll('\\', '/')).trim();
      if (!/\.html?$/i.test(filename) || /[\u0000-\u001f\u007f]/.test(filename) || filename.length > 255) throw Error('请选择有效的 HTML 文件');
      if (!bytes.length || bytes.length > MAX_FILE) throw Error('文件为空或超过 32 MiB');
      const id = createHash('sha256').update(bytes).digest('hex');
      const title = clean(metadata?.title, 200) || filename.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ');
      const excerpt = clean(metadata?.excerpt, 3600);
      const description = clean(metadata?.description, 300) || excerpt.slice(0, 300);
      const category = seedCategory ?? PENDING;
      if (!CATEGORIES.includes(category)) throw Error('无效分类');
      const sql = connect();
      const method = category === PENDING ? 'pending' : 'archive';
      const inserted = sql.prepare(`
        INSERT INTO cards(id,filename,title,description,excerpt,canonical,category,method,raw)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
      `).run(id, filename, title, description, excerpt, safeUrl(metadata?.canonical), category, method, bytes).changes;
      const existing = sql.prepare('SELECT id,title,category,filename,canonical FROM cards WHERE id=?').get(id);
      return { ...existing, duplicate: !inserted };
    },
    list({ q = '', category = '', page = 1 } = {}) {
      const query = fold(clean(q, 160));
      const matches = connect().prepare(`
        SELECT cards.id,filename,title,description,excerpt,canonical,category,tags,method,added,card_summaries.summary
        FROM cards LEFT JOIN card_summaries ON card_summaries.card_id=cards.id ORDER BY cards.rowid DESC
      `).all().map(record).filter(item => !query || fold([item.title, item.filename, item.summary, item.description, item.excerpt, ...item.tags].join(' ')).includes(query));
      const counts = Object.fromEntries(CATEGORIES.map(name => [name, 0]));
      for (const item of matches) counts[item.category]++;
      const filtered = category ? matches.filter(item => item.category === category) : matches;
      const from = (Math.max(1, Math.trunc(Number(page)) || 1) - 1) * PAGE_SIZE;
      const cards = filtered.slice(from, from + PAGE_SIZE).map(({ excerpt, ...item }) => item);
      return { cards, counts, categories: CATEGORIES, total: filtered.length };
    },
    file(id) {
      return validId(id) ? connect().prepare('SELECT filename,title,raw FROM cards WHERE id=?').get(id) : undefined;
    },
    cardContext(id) {
      return validId(id) ? connect().prepare(`
        SELECT title,filename,category,substr(COALESCE(NULLIF(excerpt,''),description),1,2400) AS excerpt
        FROM cards WHERE id=?
      `).get(id) : undefined;
    },
    summary(id) {
      return validId(id) ? connect().prepare(`
        SELECT COALESCE(summary,'') AS summary, COALESCE(revision,0) AS revision
        FROM cards LEFT JOIN card_summaries ON card_id=cards.id WHERE cards.id=?
      `).get(id) : undefined;
    },
    details(id) {
      return validId(id) ? readDetails(connect(), id) : undefined;
    },
    saveDetails(id, input) {
      const { title, category, tags, summary, version } = validateDetails(input);
      const sql = connect();
      return editTransaction(sql, () => {
        const current = readDetails(sql, id);
        if (!current || current.version !== version) return undefined;
        sql.prepare('UPDATE cards SET title=?,category=?,tags=?,method=CASE WHEN category=? THEN method ELSE ? END WHERE id=?').run(
          title, category, JSON.stringify(tags), category, category === PENDING ? 'pending' : 'manual', id,
        );
        if (summary !== current.summary) this.saveSummary(id, summary, current.revision);
        return readDetails(sql, id);
      });
    },
    suggestDetails(id, input) {
      const { version, ...suggestion } = validateDetails(input, true);
      const sql = connect();
      return editTransaction(sql, () => {
        const current = readDetails(sql, id);
        if (!current || current.version !== version) return undefined;
        sql.prepare(`
          INSERT INTO card_suggestions(card_id,version,details) VALUES(?,?,?)
          ON CONFLICT(card_id) DO UPDATE SET version=excluded.version,details=excluded.details
        `).run(id, version, JSON.stringify(suggestion));
        return suggestion;
      });
    },
    saveSummary(id, value, revision) {
      if (!validId(id) || !Number.isSafeInteger(revision) || revision < 0 || typeof value !== 'string' || !value.isWellFormed()) {
        throw Error('摘要或版本无效');
      }
      const summary = value.trim();
      if ([...summary].length > MAX_SUMMARY) throw Error('卡片摘要不能超过 140 字');
      return connect().prepare(`
        INSERT INTO card_summaries(card_id,summary,revision)
        SELECT cards.id,?,1 FROM cards LEFT JOIN card_summaries ON card_id=cards.id
        WHERE cards.id=? AND COALESCE(revision,0)=?
        ON CONFLICT(card_id) DO UPDATE SET summary=excluded.summary, revision=card_summaries.revision+1
        RETURNING summary,revision
      `).get(summary, id, revision);
    },
    edit(id, metadata) {
      const title = clean(metadata?.title, 200);
      if (!validId(id) || !title || !CATEGORIES.includes(metadata?.category)) throw Error('请填写有效的标题和分类');
      const name = metadata.filename === undefined ? null : htmlFilename(metadata.filename);
      const method = metadata.category === PENDING ? 'pending' : 'manual';
      const sql = connect();
      return Boolean(sql.prepare(`UPDATE cards SET title=?,category=?,tags=?,method=?,filename=COALESCE(?,filename) WHERE id=?`)
        .run(title, metadata.category, JSON.stringify(tagsFor(metadata.tags)), method, name, id).changes);
    },
    pending(after = 0, limit = 25) {
      const cursor = Math.max(0, Math.trunc(Number(after)) || 0);
      const size = Math.max(1, Math.min(40, Math.trunc(Number(limit)) || 25));
      const rows = connect().prepare(`
        SELECT rowid AS cursor,id,filename,title,description,substr(excerpt,1,900) AS excerpt
        FROM cards WHERE method='pending' AND rowid>? ORDER BY rowid LIMIT ?
      `).all(cursor, size);
      return { categories: Object.values(FOLDERS), cards: rows.map(({ cursor, ...card }) => card), nextAfter: rows.at(-1)?.cursor ?? null };
    },
    organize(items) {
      if (!Array.isArray(items) || items.length > 40) throw Error('一次最多处理 40 张卡片');
      const seen = new Set();
      const changes = items.map(item => {
        if (!validId(item?.id) || seen.has(item.id) || !Object.values(FOLDERS).includes(item.category)) throw Error('卡片 ID 或分类无效');
        seen.add(item.id);
        return { ...item, filename: item.filename === undefined ? null : htmlFilename(item.filename) };
      });
      const sql = connect();
      const get = sql.prepare("SELECT filename FROM cards WHERE id=? AND method='pending'");
      const set = sql.prepare("UPDATE cards SET category=?,tags=?,filename=?,method='ai' WHERE id=? AND method='pending'");
      sql.exec('BEGIN IMMEDIATE');
      try {
        let updated = 0;
        const renamed = [];
        for (const item of changes) {
          const old = get.get(item.id);
          if (!old) continue;
          const filename = item.filename && item.filename !== old.filename ? availableName(sql, item.id, item.filename) : old.filename;
          updated += set.run(item.category, JSON.stringify(tagsFor(item.tags)), filename, item.id).changes;
          if (filename !== old.filename) renamed.push({ id: item.id, from: old.filename, to: filename });
        }
        sql.exec('COMMIT');
        return { updated, skipped: items.length - updated, renamed };
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
