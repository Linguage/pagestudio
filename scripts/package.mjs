import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--cache', '.local/npm', '--pack-destination', 'dist'], { encoding: 'utf8' }));
const entries = packed.files.map(file => file.path);
const allowed = [
  /^(?:package\.json|README\.md|cordis\.patch\.yml|icon\.svg|lib\/[^/]+)$/,
  /^web\/(?:index\.html|app\.js|style\.css|themes\.css|discussion\.css|reader\.js|deck\.js|deck\.css|capture\.js|export\.js)$/,
  /^vendor\/(?:SOURCES\.md|(?:tailwind|mathjax|json5)\.js|fontawesome\.css|(?:tailwind|mathjax|json5|fontawesome)\.LICENSE|fa-[\w-]+\.woff2)$/,
  /^vendor\/article-cards\/(?:render\.mjs|validate\.mjs|LICENSE)$/,
  /^skills\/html-cards-(?:organize|import|create|normalize-deck)\/SKILL\.md$/,
  /^skills\/html-cards-create\/references\/(?:content-format|design)\.md$/,
];
if (!entries.every(path => allowed.some(pattern => pattern.test(path)))) {
  throw Error('安装包包含意外文件');
}
for (const path of [
  'lib/index.js', 'lib/client.js', 'lib/authoring.mjs', 'lib/decks.mjs', 'web/index.html', 'web/reader.js', 'web/themes.css', 'web/discussion.css', 'web/deck.js', 'web/deck.css', 'web/capture.js', 'web/export.js',
  'vendor/tailwind.js', 'vendor/mathjax.js', 'vendor/fontawesome.css', 'vendor/json5.js',
  'vendor/article-cards/render.mjs', 'vendor/article-cards/validate.mjs', 'vendor/article-cards/LICENSE',
  'skills/html-cards-organize/SKILL.md', 'skills/html-cards-import/SKILL.md', 'skills/html-cards-create/SKILL.md', 'skills/html-cards-normalize-deck/SKILL.md',
  ...['content-format', 'design'].map(name => 'skills/html-cards-create/references/' + name + '.md'),
]) {
  if (!entries.includes(path)) throw Error('安装包缺少文件：' + path);
}
const hash = createHash('sha256').update(await readFile('dist/' + packed.filename)).digest('hex');
await writeFile('dist/SHA256SUMS', hash + '  ' + packed.filename + '\n');
console.log(JSON.stringify({ file: 'dist/' + packed.filename, bytes: packed.size, files: entries.length, sha256: hash }));
