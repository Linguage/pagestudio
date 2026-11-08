import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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

const clean = (value, limit) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
export const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fold = text => text.normalize('NFKC').toLowerCase();
const tagsFor = values => Array.isArray(values) ? [...new Set(values.map(t => clean(t, 28)).filter(Boolean))].slice(0, 6) : [];
const sourceHash = bytes => createHash('sha256').update(bytes).digest('hex');

function categoryNames(sql) {
  return [...sql.prepare('SELECT name FROM categories ORDER BY rowid').all().map(row => row.name), PENDING];
}

function categoryName(value) {
  const name = clean(value, 41).normalize('NFC');
  if (!name || name.length > 40 || !name.isWellFormed() || /[\u0000-\u001f\u007f]/.test(name) || [PENDING, '全部文件'].includes(name)) {
    throw Error('请输入 1–40 字的有效分类名称');
  }
  return name;
}

function checkCategory(sql, category) {
  if (category !== PENDING && (typeof category !== 'string' || !sql.prepare('SELECT 1 FROM categories WHERE name=?').get(category))) {
    throw Error('请选择已有分类');
  }
}

function projectName(value) {
  const name = clean(value, 41).normalize('NFC');
  if (!name || name.length > 40 || !name.isWellFormed() || /[\u0000-\u001f\u007f]/.test(name) || name === '全部文件') {
    throw Error('请输入 1–40 字的有效项目名称');
  }
  return name;
}

function checkProject(sql, projectId) {
  if (!validId(projectId) || !sql.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)) {
    throw Error('项目已不存在，请重新选择。');
  }
}

function linkProjectCard(sql, projectId, cardId) {
  checkProject(sql, projectId);
  return Boolean(sql.prepare('INSERT INTO project_cards(project_id,card_id) VALUES (?,?) ON CONFLICT DO NOTHING')
    .run(projectId, cardId).changes);
}

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

function validateDetails(sql, input, suggestion = false) {
  const { title, category, tags, summary, version } = input ?? {};
  if (!validId(version)) throw Error('卡片版本无效');
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || !title.isWellFormed()) {
    throw Error('请输入不超过 200 字的卡片标题');
  }
  checkCategory(sql, category);
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

function validDirectory(directory) {
  return typeof directory === 'string' && isAbsolute(directory) && !directory.includes('\0');
}

function storageLocation(config, directory) {
  if (directory !== undefined) return { directory, fixed: true };
  if (process.env.DSH_HTML_CARDS_DIR) return { directory: resolve(process.env.DSH_HTML_CARDS_DIR), fixed: true };
  try {
    const { directory } = JSON.parse(readFileSync(config, 'utf8'));
    if (validDirectory(directory)) return { directory, configured: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { directory: join(dirname(config), 'dsh-html-cards') };
  }
  return { error: '无法读取资料库路径设置，请检查 ' + config };
}

function storageError(message, status = 503) {
  return Object.assign(new Error(message), { code: 'PAGESTUDIO_STORAGE', status });
}

function openLibrary(location) {
  if (location.error) throw storageError(location.error);
  const filename = join(location.directory, 'library.sqlite');
  let next;
  try {
    if (location.configured && !statSync(filename, { throwIfNoEntry: false })?.isFile()) {
      throw storageError('找不到已设置的资料库，请重新选择目录：' + location.directory);
    }
    if (!location.configured) mkdirSync(location.directory, { recursive: true, mode: 0o700 });
    if (location.creating) closeSync(openSync(filename, 'wx', 0o600));
    next = new DatabaseSync(filename);
    if (location.configured && !next.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='cards'").get()) {
      throw storageError('所选目录不包含有效的 PageStudio 资料库：' + location.directory);
    }
    if (location.configured) next.prepare('SELECT id, filename, category, tags, raw FROM cards LIMIT 0');
    next.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
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
    editTransaction(next, () => {
      next.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE IF NOT EXISTS project_cards (
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          PRIMARY KEY (project_id, card_id)
        );
        CREATE INDEX IF NOT EXISTS project_cards_by_card ON project_cards(card_id);
      `);
      if (!next.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='categories'").get()) {
        next.exec('CREATE TABLE categories (name TEXT PRIMARY KEY NOT NULL)');
        const add = next.prepare('INSERT INTO categories(name) VALUES (?)');
        const existing = next.prepare('SELECT DISTINCT category FROM cards WHERE category<>?').all(PENDING);
        for (const name of new Set([...Object.values(FOLDERS), ...existing.map(row => row.category)])) add.run(name);
      }
      if (!next.prepare("SELECT 1 FROM pragma_table_info('cards') WHERE name='source_hash'").get()) {
        next.exec('ALTER TABLE cards ADD COLUMN source_hash TEXT');
      }
      next.exec('CREATE UNIQUE INDEX IF NOT EXISTS cards_source_hash ON cards(COALESCE(source_hash,id))');
    });
    return next;
  } catch (error) {
    next?.close();
    if (location.creating && error.code === 'EEXIST') {
      throw storageError('此目录已有 library.sqlite，请使用已有资料库或选择其他目录。', 409);
    }
    if ((location.configured || location.creating) && error.code !== 'PAGESTUDIO_STORAGE') {
      throw storageError('无法打开资料库，请检查文件格式和目录权限：' + location.directory);
    }
    throw error;
  }
}

export function createLibrary(directory) {
  const config = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'pagestudio-library.json');
  let location = storageLocation(config, directory);
  let db;
  let pendingWrites = 0;
  const connect = () => db ??= openLibrary(location);
  const storage = () => ({ directory: location.directory ?? '', fixed: Boolean(location.fixed), error: location.error });
  return {
    storage,
    holdWrite() {
      pendingWrites++;
      return () => { pendingWrites--; };
    },
    setStorage(directory, creating) {
      if (location.fixed) throw storageError('当前资料库路径由启动配置指定。', 409);
      if (pendingWrites) throw storageError('资料库正在处理写入，请稍后再试。', 409);
      if (!validDirectory(directory) || typeof creating !== 'boolean') {
        throw storageError('请输入资料库目录的绝对路径。', 400);
      }
      let selected = resolve(directory);
      try {
        if (creating) mkdirSync(selected, { recursive: true, mode: 0o700 });
        selected = realpathSync(selected);
      } catch {
        throw storageError('无法访问所选目录，请检查路径和权限。', 400);
      }
      const next = openLibrary({ directory: selected, configured: !creating, creating });
      try {
        mkdirSync(dirname(config), { recursive: true, mode: 0o700 });
        const temporary = mkdtempSync(join(dirname(config), '.pagestudio-'));
        try {
          const file = join(temporary, 'library.json');
          writeFileSync(file, JSON.stringify({ directory: selected }) + '\n', { mode: 0o600 });
          renameSync(file, config);
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      } catch {
        next.close();
        throw storageError('无法保存资料库位置，请检查 DSH 配置目录权限。');
      }
      db?.close();
      db = next;
      location = { directory: selected, configured: true };
      return storage();
    },
    close() {
      db?.close();
      db = undefined;
    },
    categories() {
      return categoryNames(connect());
    },
    categoryCatalog() {
      const sql = connect();
      const counts = new Map(sql.prepare('SELECT category, count(*) AS count FROM cards GROUP BY category')
        .all().map(row => [row.category, row.count]));
      return categoryNames(sql).map(name => ({ name, count: counts.get(name) ?? 0 }));
    },
    addCategory(value) {
      const name = categoryName(value);
      const sql = connect();
      if (!sql.prepare('INSERT INTO categories(name) VALUES (?) ON CONFLICT DO NOTHING').run(name).changes) {
        throw Error('这个分类已经存在');
      }
      return name;
    },
    renameCategory(previous, value) {
      if (typeof previous !== 'string' || previous === PENDING) throw Error('请选择可重命名的分类');
      const name = categoryName(value);
      const sql = connect();
      return editTransaction(sql, () => {
        const exists = sql.prepare('SELECT 1 FROM categories WHERE name=?');
        if (!exists.get(previous)) return undefined;
        if (name === previous) return { name };
        if (exists.get(name)) throw Error('这个分类已经存在');
        const affected = sql.prepare(`SELECT cards.id FROM cards JOIN card_suggestions ON card_id=cards.id
          WHERE cards.category=?`).all(previous);
        const active = affected.filter(({ id }) => readDetails(sql, id).suggestion);
        sql.prepare('UPDATE categories SET name=? WHERE name=?').run(name, previous);
        sql.prepare('UPDATE cards SET category=? WHERE category=?').run(name, previous);
        sql.prepare(`UPDATE card_suggestions SET details=json_set(details,'$.category',?)
          WHERE json_extract(details,'$.category')=?`).run(name, previous);
        // A category rename changes the card version. Carry forward suggestions that were current.
        const updateVersion = sql.prepare('UPDATE card_suggestions SET version=? WHERE card_id=?');
        for (const { id } of active) updateVersion.run(readDetails(sql, id).version, id);
        return { name };
      });
    },
    removeCategory(name) {
      if (typeof name !== 'string' || name === PENDING) throw Error('请选择可删除的分类');
      const sql = connect();
      return editTransaction(sql, () => {
        if (!sql.prepare('DELETE FROM categories WHERE name=?').run(name).changes) return undefined;
        const { changes } = sql.prepare("UPDATE cards SET category=?,method='pending' WHERE category=?").run(PENDING, name);
        sql.prepare("DELETE FROM card_suggestions WHERE json_extract(details,'$.category')=?").run(name);
        return { moved: changes };
      });
    },
    projects() {
      return connect().prepare(`
        SELECT projects.id, name, count(card_id) AS count
        FROM projects LEFT JOIN project_cards ON project_id=projects.id
        GROUP BY projects.id ORDER BY projects.rowid
      `).all();
    },
    addProject(value) {
      const id = randomBytes(32).toString('hex');
      const name = projectName(value);
      if (!connect().prepare('INSERT INTO projects(id,name) VALUES (?,?) ON CONFLICT(name) DO NOTHING').run(id, name).changes) {
        throw Error('这个项目已经存在');
      }
      return { id, name };
    },
    renameProject(id, value) {
      if (!validId(id)) return undefined;
      const name = projectName(value);
      const sql = connect();
      return editTransaction(sql, () => {
        const result = sql.prepare('UPDATE OR IGNORE projects SET name=? WHERE id=? RETURNING id,name').get(name, id);
        if (!result && sql.prepare('SELECT 1 FROM projects WHERE id=?').get(id)) throw Error('这个项目已经存在');
        return result;
      });
    },
    removeProject(id) {
      return validId(id) && Boolean(connect().prepare('DELETE FROM projects WHERE id=?').run(id).changes);
    },
    setProjectCards(projectId, ids, remove = false) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 40 || !ids.every(validId)) {
        throw Error('请提供 1–40 张有效的卡片');
      }
      const unique = new Set(ids);
      const sql = connect();
      return editTransaction(sql, () => {
        checkProject(sql, projectId);
        const card = sql.prepare('SELECT 1 FROM cards WHERE id=?');
        const change = sql.prepare(remove ? 'DELETE FROM project_cards WHERE project_id=? AND card_id=?'
          : 'INSERT INTO project_cards(project_id,card_id) VALUES (?,?) ON CONFLICT DO NOTHING');
        let changed = 0;
        for (const id of unique) {
          if (!card.get(id)) throw Error('卡片已不存在，请重新查找。');
          changed += Number(change.run(projectId, id).changes);
        }
        return remove ? { removed: changed, notLinked: unique.size - changed }
          : { added: changed, alreadyLinked: unique.size - changed };
      });
    },
    removeCard(id) {
      return validId(id) && Boolean(connect().prepare('DELETE FROM cards WHERE id=?').run(id).changes);
    },
    saveSource(id, version, bytes, metadata) {
      if (!validId(version) || !bytes.length || bytes.length > MAX_FILE) throw Error('HTML 源码或版本无效');
      const sql = connect();
      return editTransaction(sql, () => {
        const current = sql.prepare('SELECT COALESCE(source_hash,id) AS version,canonical FROM cards WHERE id=?').get(id);
        if (!current) return undefined;
        if (current.version !== version) throw storageError('源码已被修改。请复制当前草稿，再重新打开卡片读取最新版。', 409);
        const hash = sourceHash(bytes);
        if (hash === version) return current;
        if (sql.prepare('SELECT 1 FROM cards WHERE COALESCE(source_hash,id)=?').get(hash)) {
          throw storageError('相同的 HTML 源码已保存在另一张卡片中。', 409);
        }
        const excerpt = clean(metadata.excerpt, 3600);
        const description = clean(metadata.description, 300) || excerpt.slice(0, 300);
        const canonical = safeUrl(metadata.canonical) || current.canonical;
        sql.prepare('UPDATE cards SET raw=?,source_hash=?,excerpt=?,description=?,canonical=? WHERE id=?')
          .run(bytes, hash, excerpt, description, canonical, id);
        sql.prepare(`INSERT INTO card_summaries(card_id,summary,revision) VALUES (?,'',1)
          ON CONFLICT(card_id) DO UPDATE SET revision=card_summaries.revision+1`).run(id);
        sql.prepare('DELETE FROM card_suggestions WHERE card_id=?').run(id);
        return { version: hash, canonical };
      });
    },
    ingest(file, bytes, metadata = {}, seedCategory, projectId) {
      const filename = basename(String(file).replaceAll('\\', '/')).trim();
      if (!/\.html?$/i.test(filename) || /[\u0000-\u001f\u007f]/.test(filename) || filename.length > 255) throw Error('请选择有效的 HTML 文件');
      if (!bytes.length || bytes.length > MAX_FILE) throw Error('文件为空或超过 32 MiB');
      const hash = sourceHash(bytes);
      const title = clean(metadata?.title, 200) || filename.replace(/\.html?$/i, '').replace(/[_-]+/g, ' ');
      const excerpt = clean(metadata?.excerpt, 3600);
      const description = clean(metadata?.description, 300) || excerpt.slice(0, 300);
      const category = seedCategory ?? PENDING;
      const sql = connect();
      const method = category === PENDING ? 'pending' : 'archive';
      return editTransaction(sql, () => {
        checkCategory(sql, category);
        const existing = sql.prepare('SELECT id,title,category,filename,canonical FROM cards WHERE COALESCE(source_hash,id)=?').get(hash);
        if (existing) {
          const result = { ...existing, duplicate: true };
          if (projectId != null) result.linked = linkProjectCard(sql, projectId, existing.id);
          return result;
        }
        const id = sql.prepare('SELECT 1 FROM cards WHERE id=?').get(hash) ? randomBytes(32).toString('hex') : hash;
        const canonical = safeUrl(metadata?.canonical);
        sql.prepare(`INSERT INTO cards(id,filename,title,description,excerpt,canonical,category,method,raw,source_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, filename, title, description, excerpt, canonical, category, method, bytes, hash);
        if (projectId != null) linkProjectCard(sql, projectId, id);
        return { id, title, category, filename, canonical, duplicate: false };
      });
    },
    list({ q = '', category = '', projectId = '', page = 1 } = {}) {
      const query = fold(clean(q, 160));
      const sql = connect();
      const categories = categoryNames(sql);
      const projects = this.projects();
      const matches = sql.prepare(`
        SELECT cards.id,filename,title,description,excerpt,canonical,category,tags,method,added,card_summaries.summary
        FROM cards LEFT JOIN card_summaries ON card_summaries.card_id=cards.id ORDER BY cards.rowid DESC
      `).all().map(record).filter(item => !query || fold([item.title, item.filename, item.summary, item.description, item.excerpt, ...item.tags].join(' ')).includes(query));
      const counts = Object.fromEntries(categories.map(name => [name, 0]));
      for (const item of matches) {
        if (Object.hasOwn(counts, item.category)) counts[item.category]++;
      }
      const members = projectId
        ? new Set(sql.prepare('SELECT card_id FROM project_cards WHERE project_id=?').all(projectId).map(row => row.card_id))
        : null;
      const filtered = matches.filter(item => (!category || item.category === category) && (!members || members.has(item.id)));
      const from = (Math.max(1, Math.trunc(Number(page)) || 1) - 1) * PAGE_SIZE;
      const memberships = sql.prepare('SELECT project_id FROM project_cards WHERE card_id=?');
      const cards = filtered.slice(from, from + PAGE_SIZE).map(({ excerpt, ...item }) => ({
        ...item, projectIds: memberships.all(item.id).map(row => row.project_id),
      }));
      return { cards, counts, categories, projects, total: filtered.length };
    },
    file(id) {
      return validId(id) ? connect().prepare('SELECT filename,title,raw,COALESCE(source_hash,id) AS version FROM cards WHERE id=?').get(id) : undefined;
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
      const sql = connect();
      return editTransaction(sql, () => {
        const { title, category, tags, summary, version } = validateDetails(sql, input);
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
      const sql = connect();
      return editTransaction(sql, () => {
        const { version, ...suggestion } = validateDetails(sql, input, true);
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
      if (!validId(id) || !title) throw Error('请填写有效的标题和分类');
      const name = metadata.filename === undefined ? null : htmlFilename(metadata.filename);
      const method = metadata.category === PENDING ? 'pending' : 'manual';
      const { add = [], remove = [] } = metadata.projects ?? {};
      if (![add, remove].every(ids => Array.isArray(ids) && ids.every(validId))) throw Error('项目选择无效');
      const sql = connect();
      return editTransaction(sql, () => {
        checkCategory(sql, metadata.category);
        const updated = sql.prepare(`
          UPDATE cards SET title=?,category=?,tags=?,
            method=CASE WHEN ? AND category=? THEN method ELSE ? END, filename=COALESCE(?,filename)
          WHERE id=?
        `).run(title, metadata.category, JSON.stringify(tagsFor(metadata.tags)),
          Number(Boolean(add.length || remove.length)), metadata.category, method, name, id).changes;
        if (!updated) return false;
        for (const projectId of add) linkProjectCard(sql, projectId, id);
        if (remove.length) {
          const unlink = sql.prepare('DELETE FROM project_cards WHERE project_id=? AND card_id=?');
          for (const projectId of remove) unlink.run(projectId, id);
        }
        return true;
      });
    },
    pending(after = 0, limit = 25) {
      const cursor = Math.max(0, Math.trunc(Number(after)) || 0);
      const size = Math.max(1, Math.min(40, Math.trunc(Number(limit)) || 25));
      const rows = connect().prepare(`
        SELECT rowid AS cursor,id,filename,title,description,substr(excerpt,1,900) AS excerpt
        FROM cards WHERE method='pending' AND rowid>? ORDER BY rowid LIMIT ?
      `).all(cursor, size);
      return { categories: this.categories().filter(name => name !== PENDING), cards: rows.map(({ cursor, ...card }) => card), nextAfter: rows.at(-1)?.cursor ?? null };
    },
    organize(items) {
      if (!Array.isArray(items) || items.length > 40) throw Error('一次最多处理 40 张卡片');
      const seen = new Set();
      const changes = items.map(item => {
        if (!validId(item?.id) || seen.has(item.id) || item.category === PENDING) throw Error('卡片 ID 或分类无效');
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
          checkCategory(sql, item.category);
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
