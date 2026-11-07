import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const source = fileURLToPath(new URL('../', import.meta.url));
const plugin = resolve(process.argv[2] || source);
const root = await mkdtemp(join(tmpdir(), 'pagestudio-host-'));
const modules = join(root, 'profiles', 'web', 'node_modules');
const patch = join(plugin, 'cordis.patch.yml');
const env = { ...process.env, DSH_HOME: root, DSH_HTML_CARDS_DIR: join(root, 'library') };
let host;
let output = '';
try {
  await mkdir(modules, { recursive: true });
  await symlink(plugin, join(modules, 'pagestudio-dsh'), 'dir');
  host = spawn('dsh', ['web', '--patch', patch, '--no-open', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(host, 'close');
  host.stdout.on('data', chunk => { output += chunk; });
  host.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 15000;
  let url;
  while (!url && Date.now() < deadline && host.exitCode === null) {
    url = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)?.[1];
    if (!url) await new Promise(done => setTimeout(done, 75));
  }
  assert(url, 'DSH did not start');
  const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  await login.body?.cancel();
  assert.equal(login.status, 303);
  assert(cookie);
  async function request(path, options = {}) {
    return fetch(new URL(path, url), {
      ...options, headers: { cookie, ...options.headers }, signal: AbortSignal.timeout(5000),
    });
  }
  const html = await request('/html-cards/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<title>PageStudio<\/title>/);
  const icon = await request('/html-cards/icon.svg');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
  assert.match(await icon.text(), /<svg\b/);
  const script = await request('/html-cards/app.js');
  assert.equal(script.status, 200);
  assert.match(await script.text(), /function showReader/);
  const listing = await request('/html-cards/api/cards');
  assert.equal(listing.status, 200);
  const catalog = await listing.json();
  assert.equal(catalog.total, 0);
  const release = await request('/html-cards/api/release');
  assert.equal(release.status, 200);
  assert.equal((await release.json()).packageName, 'pagestudio-dsh');
  const imported = await request('/html-cards/api/import?name=fixture.html', {
    method: 'POST', headers: { 'x-html-cards': 'local', 'content-type': 'application/octet-stream' },
    body: '<!doctype html><title>本机测试</title>',
  });
  assert.equal(imported.status, 201);
  const item = await imported.json();
  assert.equal(item.title, '本机测试');
  const reader = await request('/html-cards/reader/' + item.id);
  assert.equal(reader.status, 200);
  assert.match(reader.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.match(await reader.text(), /id="reader-data"/);
  assert(!/pagestudio \(pagestudio-dsh\):|entry did not activate/.test(output));
  console.log('DSH Host: plugin activated, page and script served, version endpoint, import and reader passed');
  host.kill('SIGTERM');
  await closed;
} catch (error) {
  console.error(output.replace(/([?&]token=)[^\s]+/g, '$1[redacted]'));
  throw error;
} finally {
  if (host && host.exitCode === null && host.signalCode === null) {
    host.kill('SIGTERM');
    await once(host, 'close').catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}
