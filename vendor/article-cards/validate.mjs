import { createHash } from 'node:crypto';

export const icons = new Set(['file-lines', 'bookmark', 'lightbulb', 'circle-check', 'newspaper', 'clock', 'compass', 'flag']);
export const hash = text => createHash('sha256').update(text).digest('hex');
const normalized = text => text.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '').replace(/\s+/gu, ' ').trim();
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text);

export function sourceMap(source) {
  return {
    version: 1,
    sha256: hash(source),
    paragraphs: source.split(/\r?\n\s*\r?\n/u).map(x => x.trim()).filter(Boolean).map((value, i) => ({ id: `P${String(i + 1).padStart(3, '0')}`, text: value })),
  };
}

export function validate(data, source, map = sourceMap(source)) {
  if (!object(data) || data.version !== 1) fail('card.json 需要 version: 1');
  if (!['magazine', 'spread'].includes(data.mode)) fail('mode 必须为 magazine 或 spread');
  if (map.sha256 !== hash(source)) fail('原文已变化，请重新核对 source-map.json 与全部段落引用');
  if (JSON.stringify(map.paragraphs) !== JSON.stringify(sourceMap(source).paragraphs)) fail('段落映射与原文不一致');
  if (!/^#[0-9a-f]{6}$/iu.test(data.accent ?? '')) fail('accent 必须是六位十六进制颜色');
  if (!/^[a-z0-9]{1,3}$/iu.test(data.anchor ?? '')) fail('anchor 需要 1—3 个英文字母或数字');
  if (!object(data.meta) || !text(data.meta.title)) fail('meta.title 不能为空');
  for (const key of ['subtitle', 'kicker', 'author', 'date', 'sourceUrl']) {
    if (data.meta[key] !== undefined && typeof data.meta[key] !== 'string') fail(`meta.${key} 必须为字符串`);
  }
  if (data.meta.sourceUrl) {
    let url;
    try { url = new URL(data.meta.sourceUrl); } catch { fail('sourceUrl 不是有效 URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) fail('sourceUrl 仅支持 http/https');
  }
  if (!object(data.analysis) || !text(data.analysis.page1) || !text(data.analysis.page2)) fail('analysis.page1 和 page2 需要各填写一句版式分析');
  const paragraphs = new Map(map.paragraphs.map(p => [p.id, p.text]));
  function refs(value, label) {
    if (!strings(value) || value.some(id => !paragraphs.has(id))) fail(`${label} 包含缺失或无效的原文段落 ID`);
  }
  if (!Array.isArray(data.keyPoints) || !data.keyPoints.length) fail('请先填写 keyPoints，不从空白提纲生成卡片');
  const ids = new Set();
  for (const point of data.keyPoints) {
    if (!object(point) || !/^K\d+$/u.test(point.id ?? '') || ids.has(point.id) || !text(point.text)) fail('核心要点需要唯一 K数字 ID 和非空 text');
    refs(point.sourceIds, point.id);
    ids.add(point.id);
  }
  const used = new Set();
  function block(value, label, heading = false) {
    if (!object(value)) fail(`${label} 缺失`);
    if (heading && !text(value.title)) fail(`${label}.title 不能为空`);
    if (value.text !== undefined && typeof value.text !== 'string') fail(`${label}.text 必须为字符串`);
    if (value.items !== undefined && !strings(value.items)) fail(`${label}.items 必须是非空字符串数组`);
    if (!text(value.text) && !strings(value.items)) fail(`${label} 没有正文或条目`);
    if (!strings(value.pointIds) || value.pointIds.some(id => !ids.has(id))) fail(`${label}.pointIds 缺失或引用未知要点`);
    for (const id of value.pointIds) used.add(id);
    if (value.icon && !icons.has(value.icon)) fail(`${label} 使用了未支持的线稿图标`);
  }
  block(data.overview, 'overview');
  if (!Array.isArray(data.sections) || data.sections.length < 2 || data.sections.length > 6) fail('sections 需要 2—6 个区块');
  data.sections.forEach((section, i) => block(section, `sections[${i}]`, true));
  block(data.breaker, 'breaker', true);
  block(data.conclusion, 'conclusion');
  const uncovered = [...ids].filter(id => !used.has(id));
  if (uncovered.length) fail(`核心要点未在页面区块中引用：${uncovered.join(', ')}`);
  if (data.quote !== undefined) {
    if (!object(data.quote) || !['quote', 'summary'].includes(data.quote.kind) || !text(data.quote.text)) fail('quote 需要 kind: quote/summary 及非空 text');
    refs(data.quote.sourceIds, 'quote');
    const referenced = data.quote.sourceIds.map(id => paragraphs.get(id)).join('\n\n');
    if (data.quote.kind === 'quote' && !normalized(referenced).includes(normalized(data.quote.text))) fail('原文引语与所引用段落不一致；改写内容请标为 summary');
  }
  const visibleText = JSON.stringify({ meta: data.meta, anchor: data.anchor, overview: data.overview, sections: data.sections, quote: data.quote, breaker: data.breaker, conclusion: data.conclusion });
  if (/\p{Extended_Pictographic}/u.test(visibleText)) fail('卡片中不能使用 emoji；请使用字母、数字或规定的线稿图标');
  return {
    contentValid: true,
    referencedKeyPoints: [...used],
    declaredKeyPointCount: ids.size,
    quoteVerified: data.quote?.kind === 'quote',
    semanticReview: '需逐项回读原文，引用覆盖不等于自动语义核实',
    canvas: data.mode === 'spread' ? { count: 2, width: 900, height: 1200 } : { count: 1, width: 1200, height: 1600 },
  };
}

export function documentDigest(data, source) {
  return hash(JSON.stringify(data) + '\n' + source);
}
