import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { BASE, createHandler } from '../lib/http.mjs';
import { createLibrary, FOLDERS } from '../lib/library.mjs';
import { apply } from '../lib/index.js';

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-html-cards-'));
  const library = createLibrary(directory);
  t.after(async () => {
    library.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, library };
}

test('archive import keeps file bytes and categories and skips duplicate content', async t => {
  const { directory, library } = await workspace(t);
  const archive = join(directory, 'archive');
  await mkdir(archive);
  const raw = Buffer.from('<!doctype html><title>测试卡片</title><p>测试正文</p>');
  const folder = Object.keys(FOLDERS)[0];
  for (const name of Object.keys(FOLDERS)) await mkdir(join(archive, name));
  await writeFile(join(archive, 'index.html'), '<a href="' + folder + '/fixture.html" class="card-link"><div>索引标题</div></a>');
  await writeFile(join(archive, folder, 'fixture.html'), raw);
  const runSeed = () => {
    const run = spawnSync(process.execPath, ['scripts/seed.mjs', archive], {
      env: { ...process.env, DSH_HTML_CARDS_DIR: directory }, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  assert.deepEqual(runSeed(), { added: 1, duplicates: 0, total: 1 });
  const id = createHash('sha256').update(raw).digest('hex');
  assert.deepEqual(Buffer.from(library.file(id).raw), raw);
  assert.equal(library.list().cards[0].category, FOLDERS[folder]);
  assert.equal(library.list().cards[0].title, '索引标题');
  assert.deepEqual(runSeed(), { added: 0, duplicates: 1, total: 1 });
  const flat = join(directory, 'flat');
  await mkdir(join(flat, 'cards'), { recursive: true });
  await writeFile(join(flat, 'index.html'), '<a href="cards/flat.html" data-category="工程技术" class="card-link"><div>平铺索引</div></a>');
  await writeFile(join(flat, 'cards', 'flat.html'), '<title>另一张卡片</title>');
  const imported = spawnSync(process.execPath, ['scripts/seed.mjs', flat], {
    env: { ...process.env, DSH_HTML_CARDS_DIR: directory }, encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(library.list({ category: '工程技术' }).cards[0].title, '平铺索引');
});

test('saved library path is reused and a missing directory does not create an empty library', async t => {
  const { directory, library } = await workspace(t);
  library.ingest('real.html', Buffer.from('<title>原有资料</title>'));
  const home = join(directory, 'home');
  const config = join(home, 'storages', 'pagestudio-library.json');
  await mkdir(join(home, 'storages'), { recursive: true });
  const previous = { home: process.env.DSH_HOME, library: process.env.DSH_HTML_CARDS_DIR };
  let saved, missing;
  try {
    process.env.DSH_HOME = home;
    delete process.env.DSH_HTML_CARDS_DIR;
    await writeFile(config, JSON.stringify({ directory }));
    saved = createLibrary();
    await writeFile(config, JSON.stringify({ directory: join(directory, 'unavailable') }));
    missing = createLibrary();
  } finally {
    for (const [key, value] of [['DSH_HOME', previous.home], ['DSH_HTML_CARDS_DIR', previous.library]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  try {
    assert.equal(saved.list().total, 1);
    const reply = await request(createHandler(missing), '/api/cards');
    assert.equal(reply.status, 503);
    assert.match(JSON.parse(reply.data).error, /找不到已设置的资料库/);
    await assert.rejects(stat(join(directory, 'unavailable')), { code: 'ENOENT' });
    await assert.rejects(stat(join(home, 'storages', 'dsh-html-cards')), { code: 'ENOENT' });
  } finally {
    saved.close();
    missing.close();
  }
});

test('storage settings open and create distinct libraries and remember the active directory', async t => {
  const { directory, library } = await workspace(t);
  library.ingest('old.html', Buffer.from('<title>原资料库</title>'));
  const home = join(directory, 'home');
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_HTML_CARDS_DIR: process.env.DSH_HTML_CARDS_DIR };
  process.env.DSH_HOME = home;
  delete process.env.DSH_HTML_CARDS_DIR;
  const switched = createLibrary();
  t.after(() => {
    switched.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const handle = createHandler(switched);
  const headers = { 'x-html-cards': 'local', origin: 'dsh-app://app' };
  const select = (directory, create) => request(handle, '/api/storage', {
    method: 'POST', headers, body: Buffer.from(JSON.stringify({ directory, create })),
  });
  assert.equal((await request(handle, '/api/storage')).status, 403);
  assert.equal((await select(directory, false)).status, 200);
  assert.equal(switched.list().total, 1);
  assert.equal((await select(directory, true)).status, 409);
  const fresh = join(directory, 'new library', 'cards');
  assert.equal((await select(fresh, false)).status, 400);
  assert.equal(switched.list().total, 1);
  const release = switched.holdWrite();
  try {
    assert.equal((await select(fresh, true)).status, 409);
  } finally {
    release();
  }
  assert.equal((await select(fresh, true)).status, 200);
  assert.equal(switched.list().total, 0);
  switched.ingest('new.html', Buffer.from('<title>新资料库</title>'));
  const reopened = createLibrary();
  try {
    assert.equal(reopened.list().cards[0].filename, 'new.html');
    assert.equal(reopened.storage().directory, switched.storage().directory);
  } finally {
    reopened.close();
  }
  assert.equal((await select(directory, false)).status, 200);
  assert.equal(switched.list().cards[0].filename, 'old.html');
});

async function request(handle, path, { method = 'GET', headers = {}, body = Buffer.alloc(0) } = {}) {
  const req = Object.assign(Readable.from(body.length ? [body] : []), { url: BASE + path, method, headers });
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(data) { this.data = data; } };
  await handle(req, response);
  return response;
}

test('HTTP import guards writes, retains original bytes, and AI skips manual classification', async t => {
  const { directory, library } = await workspace(t);
  const handle = createHandler(library);
  const raw = Buffer.from('<!doctype html><title>Untitled</title><h1>特别卡片</h1><p>唯一词语</p><script>const x=1;</script>');
  const filename = encodeURIComponent('测试.html');
  const headers = { 'x-html-cards': 'local', origin: 'dsh-app://app' };
  const options = { method: 'POST', headers, body: raw };
  assert.equal((await request(handle, '/api/import?name=' + filename, { ...options, headers: { ...headers, origin: 'https://example.test' } })).status, 403);
  const imported = await request(handle, '/api/import?name=' + filename, options);
  assert.equal(imported.status, 201);
  const item = JSON.parse(imported.data);
  assert.equal(item.title, '特别卡片');
  assert.equal(item.category, '待归类');
  assert.deepEqual(JSON.parse((await request(handle, '/api/card/' + item.id)).data), {
    title: '特别卡片', filename: '测试.html', category: '待归类', excerpt: 'Untitled 特别卡片 唯一词语',
  });
  assert.equal(JSON.parse((await request(handle, '/api/import?name=copy.html', options)).data).duplicate, true);
  assert.equal(JSON.parse((await request(handle, '/api/cards?q=' + encodeURIComponent('唯一词语'))).data).total, 1);
  const rawResponse = await request(handle, '/file/' + item.id);
  assert.match(rawResponse.headers['content-type'], /^text\/plain/);
  const reader = await request(handle, '/reader/' + item.id);
  assert.equal(reader.status, 200);
  assert.match(reader.headers['content-security-policy'], /sandbox allow-scripts.*connect-src 'none'/);
  assert(reader.data.includes('\\u003cscript>const x=1;'));
  assert(!reader.data.includes('<script>const x=1;'));
  const download = await request(handle, '/download/' + item.id);
  assert.deepEqual(download.data, raw);
  assert.match(download.headers['content-disposition'], /attachment/);
  const edit = await request(handle, '/api/card/' + item.id, {
    method: 'POST', headers, body: Buffer.from(JSON.stringify({ title: '手工标题', category: '思想与人文', tags: ['人工'] })),
  });
  assert.equal(edit.status, 200);
  assert.deepEqual(library.organize([{ id: item.id, category: '其他', tags: [] }]), { updated: 0, skipped: 1, renamed: [] });
  library.close();
  assert.equal(library.list({ category: '思想与人文' }).cards[0].title, '手工标题');
});

test('new and imported HTML queue for AI classification and renaming without changing the source', async t => {
  const { library } = await workspace(t);
  const handle = createHandler(library);
  const post = (path, source) => request(handle, path, {
    method: 'POST', headers: { 'x-html-cards': 'local', origin: 'dsh-app://app' }, body: Buffer.from(source),
  });
  const source = '<title>轮轨仿真工程</title><p>轮轨仿真、Simulink 和 Matlab。</p>';
  const create = await post('/api/create?name=untitled.html', source);
  assert.equal(create.status, 201);
  const item = JSON.parse(create.data);
  assert.equal(item.title, '轮轨仿真工程');
  assert.equal(item.category, '待归类');
  assert.equal((await post('/api/create?name=..%2Ftest.html', source)).status, 400);
  assert.equal((await post('/api/create?name=empty.html', ' ')).status, 400);
  assert.equal(JSON.parse((await post('/api/create?name=copy.html', source)).data).duplicate, true);
  const importResult = await post('/api/import?name=simulation.htm', source + '<p>更多工程细节。</p>');
  const imported = JSON.parse(importResult.data);
  assert.equal(imported.category, '待归类');
  assert.deepEqual(library.pending().cards.map(card => card.id), [item.id, imported.id]);
  library.ingest('轮轨仿真.HTML', Buffer.from('<p>早期版本</p>'), {}, '工程技术');
  const change = { id: item.id, filename: '轮轨仿真.html', category: '工程技术', tags: ['轮轨'] };
  assert.throws(() => library.organize([change, { ...change, id: imported.id, filename: '../bad.htm' }]), /文件名/);
  assert.equal(library.pending().cards.length, 2);
  assert.deepEqual(library.organize([change, { id: imported.id, category: '工程技术', tags: [] }]), {
    updated: 2, skipped: 0, renamed: [{ id: item.id, from: 'untitled.html', to: '轮轨仿真-2.html' }],
  });
  assert.deepEqual(library.organize([change]), { updated: 0, skipped: 1, renamed: [] });
  assert.equal(library.pending().cards.length, 0);
  const card = library.list({ q: '轮轨仿真-2.html' }).cards[0];
  assert.equal(card.id, item.id);
  assert.equal(card.title, item.title);
  assert.equal(card.category, '工程技术');
  assert.deepEqual(card.tags, ['轮轨']);
  assert.equal((await request(handle, '/file/' + item.id)).data, source);
  const download = await request(handle, '/download/' + item.id);
  assert.deepEqual(download.data, Buffer.from(source));
  assert(download.headers['content-disposition'].includes(encodeURIComponent('轮轨仿真-2.html')));
  const legacyMarkup = '<meta charset="gbk"><title>中文标题</title>';
  const pasted = JSON.parse((await post('/api/create?name=legacy.html', legacyMarkup)).data);
  assert.equal(pasted.title, '中文标题');
  assert.equal((await request(handle, '/file/' + pasted.id)).data, legacyMarkup);
});

test('old cards gain editable summaries with a shared length and version check', async t => {
  const { directory, library } = await workspace(t);
  const item = library.ingest('old.html', Buffer.from('<h1>旧卡片</h1>'), {}, '内容创作');
  library.close();
  const legacy = new DatabaseSync(join(directory, 'library.sqlite'));
  legacy.exec('DROP TABLE card_summaries');
  legacy.close();
  const handle = createHandler(library);
  const route = '/api/card/' + item.id + '/summary';
  const save = (summary, revision) => request(handle, route, {
    method: 'POST', headers: { 'x-html-cards': 'local', origin: 'dsh-app://app' },
    body: Buffer.from(JSON.stringify({ summary, revision })),
  });
  assert.deepEqual(JSON.parse((await request(handle, route)).data), { summary: '', revision: 0 });
  assert.equal((await save('字'.repeat(141), 0)).status, 400);
  const summary = '𠮷'.repeat(140);
  assert.deepEqual(JSON.parse((await save(summary, 0)).data), { summary, revision: 1 });
  const other = createLibrary(directory);
  try {
    assert.equal(other.saveSummary(item.id, '较旧的 AI 草稿', 0), undefined);
    assert.deepEqual({ ...other.saveSummary(item.id, '最新摘要', 1) }, { summary: '最新摘要', revision: 2 });
    assert.equal((await save('过期的编辑', 1)).status, 409);
  } finally { other.close(); }
  assert.deepEqual(JSON.parse((await request(handle, route)).data), { summary: '最新摘要', revision: 2 });
  assert.equal(library.list().cards[0].category, '内容创作');
});

test('bundled DSH authoring skills generate and import into the existing library', async t => {
  const { directory, library } = await workspace(t);
  const cleanup = [];
  const tools = new Map();
  let provider;
  const previous = process.env.DSH_HTML_CARDS_DIR;
  process.env.DSH_HTML_CARDS_DIR = directory;
  try {
    apply({
      effect: effect => cleanup.push(effect()),
      webServer: { register: () => () => {} },
      skills: { registerProvider: factory => { provider = factory(); } },
      tools: { register: tool => tools.set(tool.name, tool) },
      workingDirectory: { ensure: async () => directory },
      fs: {
        resolve: async (path, { cwd }) => resolve(cwd, path),
        processPath: path => path,
        readBytes: async (path, signal) => readFile(path, { signal }),
        stat: async path => stat(path).then(info => ({ type: info.isDirectory() ? 'directory' : 'file', size: info.size }),
          error => { if (error.code !== 'ENOENT') throw error; }),
        listDir: async path => (await readdir(path, { withFileTypes: true })).map(info => ({
          name: info.name, type: info.isFile() ? 'file' : 'other',
        })),
      },
    });
  } finally {
    if (previous === undefined) delete process.env.DSH_HTML_CARDS_DIR;
    else process.env.DSH_HTML_CARDS_DIR = previous;
  }
  t.after(() => { for (const dispose of cleanup.reverse()) dispose?.(); });

  const skills = await provider.list();
  assert.deepEqual(skills.map(({ name }) => name), ['html-cards-organize', 'html-cards-create', 'html-cards-import', 'html-cards-normalize-deck']);
  assert.match((await provider.get(skills[1])).content, /html_cards_create_article/);
  assert.match((await provider.get(skills[2])).content, /html_cards_import/);
  const source = '现场观测先记时间。\n\n复核结果时保留记录。';
  const block = { text: '保留观测记录。', pointIds: ['K1'] };
  const card = {
    version: 1, mode: 'spread', accent: '#874b34', anchor: 'R', meta: { title: '现场观测' },
    analysis: { page1: '介绍记录方法。', page2: '说明复核。' },
    keyPoints: [{ id: 'K1', text: block.text, sourceIds: ['P001', 'P002'] }],
    overview: block, sections: [{ ...block, title: '时间' }, { ...block, title: '复核' }],
    breaker: { ...block, title: '补充' }, conclusion: block,
    quote: { kind: 'quote', text: '现场观测先记时间。', sourceIds: ['P001'] },
  };
  const execution = { agent: {}, signal: new AbortController().signal };
  const create = tools.get('html_cards_create_article').execute;
  await assert.rejects(create({ source, card_json: JSON.stringify({ ...card, quote: { ...card.quote, text: '编造的引语' } }) }, execution), /原文引语/);
  assert.equal(library.list().total, 0);
  await writeFile(join(directory, 'article.md'), source);
  const generated = JSON.parse(await create({ source_path: 'article.md', card_json: JSON.stringify(card) }, execution));
  assert.equal(generated.category, '待归类');
  assert.equal(generated.quoteVerified, true);
  assert.deepEqual(generated.canvas, { count: 2, width: 900, height: 1200 });
  const generatedHtml = Buffer.from(library.file(generated.id).raw);
  assert.match(generatedHtml.toString(), /article-card-digest/);
  assert.equal((generatedHtml.toString().match(/<article /g) ?? []).length, 2);
  const importHtml = tools.get('html_cards_import').execute;
  await writeFile(join(directory, 'export.html'), generatedHtml);
  const duplicate = JSON.parse(await importHtml({ file_path: 'export.html' }, execution));
  assert.equal(duplicate.id, generated.id);
  assert.equal(duplicate.duplicate, true);
  const standalone = '<h1>对话产物</h1><p>可直接入库的 HTML</p>';
  const imported = JSON.parse(await importHtml({ html: standalone }, execution));
  assert.equal(imported.filename, '对话产物.html');
  assert.deepEqual(Buffer.from(library.file(imported.id).raw), Buffer.from(standalone));
  assert.equal(library.list({ category: '待归类' }).total, 2);
  const detailsRoute = '/api/card/' + imported.id + '/details';
  const handle = createHandler(library);
  const initial = JSON.parse((await request(handle, detailsRoute)).data);
  const submit = input => request(handle, detailsRoute, {
    method: 'POST', headers: { 'x-html-cards': 'local', origin: 'dsh-app://app' },
    body: Buffer.from(JSON.stringify({ ...input, version: initial.version })),
  });
  const suggest = tools.get('html_cards_suggest_details').execute;
  const input = { title: '如何整理对话产物', category: '内容创作', tags: ['对话', '归档'], summary: '把对话成果保存到卡片库。' };
  const suggested = await suggest({ id: imported.id, version: initial.version, ...input }, execution);
  assert.equal(JSON.parse(suggested).saved, true);
  assert.deepEqual(library.details(imported.id).suggestion, input);
  assert.equal(library.list({ category: '待归类' }).total, 2);
  assert.equal((await submit({ ...input, summary: '字'.repeat(141) })).status, 400);
  assert.equal(library.details(imported.id).title, initial.title);
  assert.equal((await submit(input)).status, 200);
  assert.equal(library.details(imported.id).suggestion, null);
  assert.equal(library.list({ category: input.category, q: input.summary }).cards[0].title, input.title);
  assert.deepEqual(Buffer.from(library.file(imported.id).raw), Buffer.from(standalone));
  assert.equal((await submit({ ...input, title: '过时标题' })).status, 409);
  await assert.rejects(suggest({ id: imported.id, version: initial.version, ...input }, execution), /卡片已有更新/);

  const project = join(directory, 'talk', 'project');
  await mkdir(join(project, 'slides'), { recursive: true });
  await mkdir(join(project, 'assets'));
  const manifest = { title: '两页演示', order: ['b', 'a'] };
  const slides = { b: '<section id="b"><h1>开场</h1><img src="../assets/shape.svg"></section>', a: '<section id="a"><h1>结语</h1></section>' };
  await writeFile(join(project, 'deck.json'), JSON.stringify(manifest));
  await writeFile(join(project, 'slides', 'b.html'), slides.b);
  await assert.rejects(importHtml({ deck_path: 'talk' }, execution), /缺少幻灯片.*a.html/);
  assert.equal(library.list().total, 2);
  await writeFile(join(project, 'slides', 'a.html'), slides.a);
  const asset = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>';
  await writeFile(join(project, 'assets', 'shape.svg'), asset);
  const deck = JSON.parse(await importHtml({ deck_path: 'talk' }, execution));
  assert.equal(deck.slides, 2);
  assert.equal(deck.category, '待归类');
  assert.deepEqual(deck.missingAssets, []);
  const html = Buffer.from(library.file(deck.id).raw).toString();
  assert.match(html, /<section id="b">[\s\S]*<section id="a">/);
  assert(html.includes('data:image/svg+xml;base64,' + Buffer.from(asset).toString('base64')));
  assert.equal(JSON.parse(await importHtml({ file_path: 'talk/project/deck.json' }, execution)).id, deck.id);
  const form = new FormData();
  for (const [key, body] of Object.entries({ 'deck.json': JSON.stringify(manifest),
    'slides/a.html': slides.a, 'slides/b.html': slides.b, 'assets/shape.svg': asset })) form.append(key, new Blob([body]), key);
  const multipart = new Response(form);
  const uploaded = await request(handle, '/api/import-deck', {
    method: 'POST', headers: { 'x-html-cards': 'local', 'content-type': multipart.headers.get('content-type') },
    body: Buffer.from(await multipart.arrayBuffer()),
  });
  assert.equal(uploaded.status, 201);
  assert.equal(JSON.parse(uploaded.data).id, deck.id);
  assert.equal(JSON.parse(uploaded.data).duplicate, true);
  assert.equal(library.list().total, 3);
});
