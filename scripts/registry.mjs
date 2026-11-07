import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import manifest from '../package.json' with { type: 'json' };
import { newerVersion, registry } from '../lib/releases.mjs';

const { name, version } = manifest;
const file = 'registry/' + name;
const filename = name + '-' + version + '.tgz';
const mirror = new URL('../../distribution/', registry).href;
const archive = await readFile('dist/' + filename);
const now = new Date().toISOString();
await mkdir('registry', { recursive: true });
const index = await readFile(file, 'utf8').then(JSON.parse, error => {
  if (error.code !== 'ENOENT') throw error;
  return { name, 'dist-tags': {}, versions: {}, time: { created: now } };
});
const dist = {
  tarball: mirror + filename,
  shasum: createHash('sha1').update(archive).digest('hex'),
  integrity: 'sha512-' + createHash('sha512').update(archive).digest('base64'),
};
const existing = index.versions[version];
if (existing && existing.dist.integrity !== dist.integrity) {
  throw Error('这个版本已指向不同的安装包，请提高版本号。');
}
if (!existing) {
  index.versions[version] = { ...manifest, dist };
  index.time[version] = now;
  index.time.modified = now;
  const latest = index['dist-tags'].latest;
  if (!latest || newerVersion(latest, version)) index['dist-tags'].latest = version;
}
for (const [published, entry] of Object.entries(index.versions)) {
  entry.dist.tarball = mirror + name + '-' + published + '.tgz';
}
await writeFile(file, JSON.stringify(index, null, 2) + '\n');
