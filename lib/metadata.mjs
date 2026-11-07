const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtml(bytes) {
  const start = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const charset = start.match(/<meta\b[^>]*charset\s*=\s*["']?([\w.-]+)/i)?.[1];
  const encoding = start.startsWith('\xef\xbb\xbf') ? 'utf-8'
    : start.startsWith('\xff\xfe') ? 'utf-16le'
    : start.startsWith('\xfe\xff') ? 'utf-16be'
    : charset || 'utf-8';
  try { return new TextDecoder(encoding).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

export function textContent(fragment) {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full, entity) => {
    if (!entity.startsWith('#')) return ENTITIES[entity.toLowerCase()];
    const hex = entity[1].toLowerCase() === 'x';
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : full;
  }).replace(/\s+/g, ' ').trim();
}

function attributes(tag) {
  const entries = [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=`<>]+))/g)];
  return Object.fromEntries(entries.map(([, name, a, b, c]) => [name.toLowerCase(), textContent(a ?? b ?? c)]));
}

const removeNonContent = html => html.replace(/<!--[\s\S]*?-->|<(script|style|template|svg|noscript|nav|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
const removeHead = html => html.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, '');

export function summarySource(bytes) {
  return textContent(removeHead(removeNonContent(decodeHtml(bytes))));
}

export function extractMetadata(bytes) {
  const input = decodeHtml(bytes.subarray(0, 3_000_000));
  const content = removeNonContent(input);
  const metadata = new Map();
  for (const [tag] of content.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const { property, name, content: value } = attributes(tag);
    if (value) metadata.set((property || name || '').toLowerCase(), value);
  }
  const canonical = [...content.matchAll(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
    .map(([tag]) => attributes(tag)).find(attr => attr.rel?.toLowerCase() === 'canonical')?.href;
  const title = textContent(content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '');
  const heading = textContent(content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? '');
  const excerpt = textContent(removeHead(content)).slice(0, 3600);
  const genericTitle = /^(untitled|document|index|home|无标题)$|swiss (?:style |wireframe )?(?:wireframe|infographic|cards)/i;
  return {
    title: metadata.get('og:title') || (heading && (!title || genericTitle.test(title)) ? heading : title) || heading,
    excerpt,
    description: metadata.get('description') || metadata.get('og:description') || excerpt.slice(0, 300),
    canonical: canonical || metadata.get('og:url'),
  };
}
