import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary, FOLDERS, PENDING } from '../lib/library.mjs';
import { extractMetadata, textContent } from '../lib/metadata.mjs';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../../', import.meta.url)));
const navigation = await readFile(join(root, 'index.html'), 'utf8');
const labels = new Map();
const categories = new Map();
for (const [, path, attributes, html] of navigation.matchAll(/<a\s+href="([^"]+\.html?)"([^>]*)>([\s\S]*?)<\/a>/gi)) {
  if (!/\bclass="card-link\b/.test(attributes)) continue;
  const label = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map(match => textContent(match[1])).filter(Boolean);
  if (label.length) labels.set(path, [...new Set(label)].join(' · '));
  const category = attributes.match(/\bdata-category="([^"]+)"/)?.[1];
  if (category) categories.set(path, category);
}
const candidates = [];
for (const dir of ['', 'cards', ...Object.keys(FOLDERS)]) {
  const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(error => {
    if (dir && error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of entries) {
    if (file.isFile() && /\.html?$/i.test(file.name) && (dir || file.name !== 'index.html')) {
      const path = dir ? dir + '/' + file.name : file.name;
      candidates.push({ file: path, category: categories.get(path) ?? FOLDERS[dir] ?? PENDING });
    }
  }
}
const library = createLibrary();
let added = 0;
let duplicates = 0;
try {
  const available = new Set(library.categories());
  for (const { file, category } of candidates.sort((a, b) => a.file.localeCompare(b.file))) {
    const raw = await readFile(join(root, file));
    const metadata = extractMetadata(raw);
    if (labels.has(file)) metadata.title = labels.get(file);
    const result = library.ingest(basename(file), raw, metadata, available.has(category) ? category : PENDING);
    if (result.duplicate) duplicates++;
    else added++;
  }
  console.log(JSON.stringify({ added, duplicates, total: library.list().total }));
} finally {
  library.close();
}
