import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary, FOLDERS, PENDING } from '../lib/library.mjs';
import { extractMetadata, textContent } from '../lib/metadata.mjs';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../../', import.meta.url)));
const navigation = await readFile(join(root, 'index.html'), 'utf8');
const labels = new Map();
for (const [, path, html] of navigation.matchAll(/<a\s+href="([^"]+\.html)"[^>]*class="card-link\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
  const label = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map(match => textContent(match[1])).filter(Boolean);
  if (label.length) labels.set(path, [...new Set(label)].join(' · '));
}
const candidates = [];
for (const dir of ['', ...Object.keys(FOLDERS)]) {
  for (const file of await readdir(join(root, dir), { withFileTypes: true })) {
    if (file.isFile() && /\.html?$/i.test(file.name) && (dir || file.name !== 'index.html')) {
      candidates.push({ file: dir ? dir + '/' + file.name : file.name, category: FOLDERS[dir] || PENDING });
    }
  }
}
const library = createLibrary();
let added = 0;
let duplicates = 0;
try {
  for (const { file, category } of candidates.sort((a, b) => a.file.localeCompare(b.file))) {
    const raw = await readFile(join(root, file));
    const metadata = extractMetadata(raw);
    if (labels.has(file)) metadata.title = labels.get(file);
    const result = library.ingest(basename(file), raw, metadata, category);
    if (result.duplicate) duplicates++;
    else added++;
  }
  console.log(JSON.stringify({ added, duplicates, total: library.list().total }));
} finally {
  library.close();
}
