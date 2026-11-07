export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const e = escapeHtml;
const tag = value => `<span class="eyebrow">${e(value)}</span>`;
const paragraphs = value => String(value ?? '').split(/\n+/u).filter(Boolean).map(line => `<p data-measure>${e(line)}</p>`).join('');
const items = list => list?.length ? `<ul>${list.map(item => `<li data-measure>${e(item)}</li>`).join('')}</ul>` : '';
const textOf = block => paragraphs(block.text) + items(block.items);
const refs = block => e(block.pointIds.join(' '));

function section(block, i) {
  return `<section class="info-block" data-fit-zone data-points="${refs(block)}">
    <div class="section-label">${tag(`NOTE ${String(i + 1).padStart(2, '0')}`)}<i class="fa-regular fa-${e(block.icon || 'file-lines')}" aria-hidden="true"></i></div>
    <h3 data-measure>${e(block.title)}</h3><div class="body-copy">${textOf(block)}</div>
  </section>`;
}

function metadata(data) {
  const fields = [data.meta.author, data.meta.date].filter(Boolean);
  if (data.meta.sourceUrl) fields.push(new URL(data.meta.sourceUrl).hostname);
  return fields.length ? `<div class="metadata" data-measure>${fields.map(e).join('<span aria-hidden="true"> / </span>')}</div>` : '';
}

function quote(data) {
  if (!data.quote) return '';
  return `<figure class="quotation" data-fit-zone>${tag(data.quote.kind === 'quote' ? '原文摘录' : '观点提炼')}<blockquote data-measure>${e(data.quote.text)}</blockquote></figure>`;
}

function sourceFooter(data, number) {
  return `<footer class="source-footer" data-fit-zone><span>${data.meta.sourceUrl ? `<a href="${e(data.meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">阅读原文 <i class="fa-regular fa-file-lines" aria-hidden="true"></i></a>` : '文章阅读札记'}</span><span class="page-number">${number} / 02</span></footer>`;
}

function magazine(data) {
  return `<div class="sheet-wrap"><article class="card magazine" aria-label="单页杂志信息卡" data-canvas-width="1200" data-canvas-height="1600">
    <header class="masthead" data-fit-zone><div class="masthead-top">${tag(data.meta.kicker || '文章信息卡')}<span class="english-label">ARTICLE / JOURNAL</span></div><h1 data-measure>${e(data.meta.title)}</h1>${data.meta.subtitle ? `<p class="subtitle" data-measure>${e(data.meta.subtitle)}</p>` : ''}${metadata(data)}</header>
    <main class="magazine-grid" data-fit-zone>
      <aside class="anchor-column" data-fit-zone><span class="outline-anchor" aria-hidden="true">${e(data.anchor)}</span>${tag('核心概述')}<div class="anchor-summary body-copy" data-points="${refs(data.overview)}">${textOf(data.overview)}</div>${quote(data)}</aside>
      <div class="primary-column" data-fit-zone>${data.sections.map(section).join('')}</div>
    </main>
    <section class="mid-breaker" data-fit-zone data-points="${refs(data.breaker)}">${tag('阅读补充')}<h2 data-measure>${e(data.breaker.title)}</h2><div class="body-copy">${textOf(data.breaker)}</div></section>
    <footer class="dark-footer" data-fit-zone data-points="${refs(data.conclusion)}">${tag('结语')}<div class="body-copy">${textOf(data.conclusion)}</div><div class="footer-meta">${metadata(data)}<span>01 / 01</span></div></footer>
  </article></div>`;
}

function spread(data) {
  return `<div class="sheet-wrap"><article class="card spread-page cover" aria-label="第一页 文章概述" data-canvas-width="900" data-canvas-height="1200">
    <header class="cover-header" data-fit-zone>${tag(data.meta.kicker || '文章信息卡')}<span class="english-label">READING / 01</span></header>
    <div class="cover-main" data-fit-zone><div class="accent-rule"></div><h1 class="hero-title" data-measure>${e(data.meta.title)}</h1>${data.meta.subtitle ? `<p class="cover-subtitle" data-measure>${e(data.meta.subtitle)}</p>` : ''}${quote(data)}</div>
    <section class="cover-summary" data-fit-zone data-points="${refs(data.overview)}">${tag('文章概述')}<div class="body-copy">${textOf(data.overview)}</div>${metadata(data)}</section>
    ${sourceFooter(data, '01')}
  </article></div>
  <div class="sheet-wrap"><article class="card spread-page details" aria-label="第二页 概念与细节" data-canvas-width="900" data-canvas-height="1200">
    <header class="detail-header" data-fit-zone><div class="masthead-top">${tag(data.meta.kicker || '文章信息卡')}<span class="english-label">DETAILS / 02</span></div><h2 data-measure>概念与细节</h2><div class="accent-rule"></div></header>
    <main class="detail-grid" data-fit-zone>${data.sections.map(section).join('')}</main>
    <section class="mid-breaker" data-fit-zone data-points="${refs(data.breaker)}"><h3 data-measure>${e(data.breaker.title)}</h3><div class="body-copy">${textOf(data.breaker)}</div></section>
    <section class="closing-note" data-fit-zone data-points="${refs(data.conclusion)}">${tag('结语')}<div class="body-copy">${textOf(data.conclusion)}</div></section>
    ${sourceFooter(data, '02')}
  </article></div>`;
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/giu).map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function renderDocument(data, digest) {
  const accentLuminance = luminance(data.accent);
  const paperLuminance = luminance('#f5f3ed');
  const contrast = (Math.max(accentLuminance, paperLuminance) + 0.05) / (Math.min(accentLuminance, paperLuminance) + 0.05);
  const accentText = contrast >= 4.5 ? data.accent : '#33312c';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="article-card-digest" content="${digest}"><title>${e(data.meta.title)} · 文章信息卡</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Noto+Sans+SC:wght@400;700;900&family=Noto+Serif+SC:wght@400;700;900&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style>
:root{--accent:${data.accent};--accent-text:${accentText};--paper:#f5f3ed;--ink:#1a1a1a;--muted:#5b5b55;--dark:#1f2937;--line:#bcbab1;--serif:'Noto Serif SC','Songti SC',serif;--sans:'Inter','Noto Sans SC',sans-serif;--english:'Poppins','Inter',sans-serif}
*{box-sizing:border-box}body{margin:0;background:#e2e0d9;color:var(--ink);font-family:var(--sans)}button,a{-webkit-tap-highlight-color:transparent}button{font:inherit;cursor:pointer}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:4px}button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}p,h1,h2,h3,figure,blockquote,ul{margin:0}p+p{margin-top:.7em}ul{padding-left:1.15em}li+li{margin-top:.4em}h1,h2,h3,p,li,blockquote{overflow-wrap:anywhere;word-break:normal}h1,h2,h3{font-family:var(--serif);font-weight:900}i{font-size:18px}
.toolbar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 22px;border-bottom:1px solid #ccc9bd;background:#f5f3edf5;font-size:13px;backdrop-filter:blur(8px)}.toolbar-title{font-weight:700;margin-right:12px}.toolbar button{border:1px solid #c7c3b8;background:transparent;padding:8px 12px;border-radius:3px;min-height:36px}.toolbar button[aria-pressed=true]{background:var(--dark);color:#fff;border-color:var(--dark)}.status{margin-left:auto;color:var(--muted)}.status.error{color:#9c2b20}.font-note{font-size:12px;color:var(--muted);width:100%}.canvas-list{display:flex;justify-content:center;align-items:flex-start;gap:32px;flex-wrap:wrap;padding:36px 24px 60px}.sheet-wrap{position:relative;flex-shrink:0}.card{position:relative;display:flex;flex-direction:column;background:var(--paper);color:var(--ink);box-shadow:0 18px 48px #22222218;transform-origin:top left;isolation:isolate;overflow:visible}.card::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;opacity:.04;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%23000' filter='url(%23n)' d='M0 0h180v180H0z'/%3E%3C/svg%3E")}.card.has-overflow{outline:4px solid #a82d22}.eyebrow,.english-label,.page-number{font-family:var(--english);font-size:13px;font-weight:600;letter-spacing:.15em;line-height:1.5}.eyebrow{color:var(--accent);display:block;margin-bottom:12px}.english-label{color:var(--muted);text-transform:uppercase}.masthead-top,.cover-header{display:flex;justify-content:space-between;align-items:center;gap:20px}.masthead-top .eyebrow,.cover-header .eyebrow{margin:0}.metadata{font-size:15px;line-height:1.5;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px}.body-copy{font-family:var(--sans);font-size:var(--body-size);font-weight:400;line-height:var(--body-leading)}.accent-rule{height:6px;width:100px;background:var(--accent);flex-shrink:0}.section-label{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-label i{color:var(--accent)}.section-label .eyebrow{margin:0}.info-block{border-top:1px solid var(--line);padding-top:var(--block-padding);min-width:0}.info-block h3{font-size:var(--section-title);line-height:1.2;margin:10px 0 12px;font-weight:700}.quotation blockquote{font-family:var(--serif);font-weight:700;line-height:1.35}.mid-breaker{background:color-mix(in srgb,var(--accent) 9%,var(--paper));border-top:6px solid var(--accent)}.mid-breaker h2,.mid-breaker h3{font-size:var(--section-title);font-weight:700;line-height:1.2;margin-bottom:12px}
.magazine{width:1200px;height:1600px;padding:48px;gap:22px;--body-size:28px;--body-leading:1.5;--section-title:34px;--block-padding:14px}.magazine .body-copy{font-family:var(--serif);font-weight:700}.masthead{border-bottom:6px solid var(--accent);padding-bottom:22px;flex-shrink:0}.masthead h1{font-size:88px;line-height:1.12;letter-spacing:-.04em;margin:20px 0 14px}.subtitle{font-family:var(--serif);font-size:32px;line-height:1.4;font-weight:700;margin-bottom:14px}.magazine-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:26px;flex:1;min-height:0}.anchor-column{grid-column:span 4;border-right:1px solid var(--line);padding-right:24px;min-width:0}.primary-column{grid-column:span 8;display:flex;flex-direction:column;justify-content:space-between;gap:18px;min-width:0;min-height:0}.outline-anchor{font-family:var(--english);font-size:245px;font-weight:600;letter-spacing:-.12em;line-height:1.1;display:block;color:transparent;-webkit-text-stroke:2px var(--accent);margin:0 0 30px -8px;white-space:nowrap}.anchor-summary{margin-bottom:28px}.magazine .quotation{border-top:1px solid var(--line);padding-top:20px}.magazine blockquote{font-size:32px}.magazine .mid-breaker{padding:20px 26px;flex-shrink:0}.dark-footer{background:var(--dark);color:#fff;padding:24px 28px;flex-shrink:0}.dark-footer .eyebrow{color:#e6d2b6}.dark-footer .body-copy{font-size:28px;line-height:1.5}.footer-meta{display:flex;align-items:flex-end;justify-content:space-between;margin-top:18px;font:13px var(--english)}.dark-footer .metadata{color:#d3d7df}
.spread-page{width:900px;height:1200px;padding:60px;--body-size:19px;--body-leading:1.6;--section-title:30px;--block-padding:16px}.cover{gap:30px}.cover-header{flex-shrink:0}.cover-main{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:28px}.hero-title{font-size:88px;line-height:1.05;letter-spacing:-.04em}.cover-subtitle{font-family:var(--serif);font-size:30px;line-height:1.4;font-weight:700;color:var(--muted)}.cover .quotation{border-left:6px solid var(--accent);padding-left:24px;margin-top:6px}.cover blockquote{font-size:36px;line-height:1.4}.cover-summary{border-top:1px solid var(--line);padding-top:22px;flex-shrink:0}.cover-summary .body-copy{font-size:20px}.cover-summary .metadata{margin-top:20px}.source-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;border-top:1px solid var(--line);padding-top:18px;font-size:13px;line-height:1.5;flex-shrink:0;color:var(--muted)}.source-footer a{display:inline-block}.details{gap:30px}.detail-header{flex-shrink:0}.detail-header h2{font-size:52px;line-height:1.1;margin:20px 0 24px;letter-spacing:-.03em}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:30px 40px;flex:1;min-height:0}.details .mid-breaker{padding:20px 24px;flex-shrink:0}.closing-note{border-top:1px solid var(--line);padding-top:18px;flex-shrink:0}.closing-note .eyebrow{margin-bottom:8px}
.density-1 .magazine{gap:18px;--body-size:26px;--body-leading:1.45;--block-padding:12px}.density-1 .magazine h1{font-size:80px}.density-1 .magazine .primary-column{gap:14px}.density-1 .spread-page{padding:54px;--body-size:18.5px;--body-leading:1.55}.density-1 .cover,.density-1 .details{gap:30px}.density-1 .hero-title{font-size:80px}.density-1 .cover blockquote{font-size:34px}.density-1 .detail-grid{gap:30px}.density-1 .detail-header h2{font-size:50px}
.density-2 .magazine{gap:16px;--body-size:24px;--body-leading:1.4;--block-padding:10px;--section-title:32px}.density-2 .magazine h1{font-size:72px}.density-2 .magazine .primary-column{gap:12px}.density-2 .magazine blockquote{font-size:28px}.density-2 .magazine .dark-footer .body-copy{font-size:24px}.density-2 .spread-page{padding:50px;--body-size:18px;--body-leading:1.5;--section-title:28px}.density-2 .hero-title{font-size:72px}.density-2 .cover blockquote{font-size:32px}.density-2 .detail-grid{gap:30px}.density-2 .detail-header h2{font-size:48px;margin:16px 0 18px}
body.reading .canvas-list{display:block;padding:20px 14px 40px}body.reading .sheet-wrap{width:min(100%,760px)!important;height:auto!important;margin:0 auto 24px}body.reading .card{width:100%;height:auto;min-height:0;padding:28px 22px;transform:none!important;gap:24px;--body-size:19px;--body-leading:1.65;--section-title:26px}body.reading .magazine-grid,body.reading .detail-grid{display:block;min-height:0;flex:auto}body.reading .anchor-column{border-right:0;padding-right:0;border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:24px}body.reading .outline-anchor{font-size:120px;line-height:1.1;margin-bottom:16px}body.reading .primary-column{gap:24px}body.reading .info-block{margin-bottom:24px}body.reading .masthead h1,body.reading .hero-title{font-size:44px;line-height:1.2}body.reading .detail-header h2{font-size:36px}body.reading .subtitle,body.reading .cover-subtitle{font-size:24px}body.reading .cover-main{flex:none;gap:22px}body.reading .quotation blockquote{font-size:26px}body.reading .dark-footer .body-copy{font-size:20px}body.reading .magazine .body-copy{font-family:var(--serif);font-size:20px}body.reading .cover-summary .body-copy{font-size:19px}body.reading .masthead-top,body.reading .cover-header{align-items:flex-start}body.reading .english-label{font-size:10px;max-width:100px;text-align:right}body.reading .magazine .mid-breaker,body.reading .dark-footer{padding:20px}body.reading .card.has-overflow{outline:none}
.eyebrow,.section-label i{color:var(--accent-text)}.outline-anchor{-webkit-text-stroke-color:var(--accent-text)}ul{list-style:disc}li::marker{color:var(--accent-text)}.dark-footer li::marker{color:#e6d2b6}
@media(max-width:640px){.toolbar{padding:10px 12px;gap:6px}.toolbar-title{width:100%;margin:0 0 2px}.toolbar button{font-size:12px;padding:7px 9px}.status{margin-left:0;flex:1 0 100%;font-size:12px}.canvas-list{padding:20px 12px 36px;gap:20px}.font-note{font-size:11px}}
@media print{@page{size:${data.mode === 'magazine' ? '1200px 1600px' : '900px 1200px'};margin:0}html,body{margin:0!important;padding:0!important;background:var(--paper)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{display:none!important}.canvas-list,body.reading .canvas-list{display:block;padding:0!important}.sheet-wrap,body.reading .sheet-wrap{width:${data.mode === 'magazine' ? 1200 : 900}px!important;height:${data.mode === 'magazine' ? 1600 : 1200}px!important;margin:0!important;break-after:page}.sheet-wrap:last-child{break-after:auto}.card{transform:none!important;box-shadow:none!important}.card.has-overflow{outline:0}.card.magazine{width:1200px!important;height:1600px!important}.card.spread-page{width:900px!important;height:1200px!important}}
</style></head><body data-mode="${data.mode}">
<nav class="toolbar" aria-label="预览操作"><span class="toolbar-title">文章信息卡</span><button id="canvas-mode" aria-pressed="true">画布预览</button><button id="reading-mode" aria-pressed="false">手机阅读</button><button id="check-layout">检查版面</button><button id="download-html">下载 HTML</button><button id="print-cards">打印 / PDF</button><output id="layout-status" class="status" aria-live="polite">正在检查画布</output><span id="font-note" class="font-note">正在加载指定字体</span></nav>
<div class="canvas-list">${data.mode === 'magazine' ? magazine(data) : spread(data)}</div>
<script>${browserRuntime}</script></body></html>`;
}

const browserRuntime = String.raw`
(() => {
  const cards = [...document.querySelectorAll('.card')];
  const body = document.body;
  const status = document.querySelector('#layout-status');
  let density = 0;
  let busy = false;
  function sizeCanvases() {
    const gap = innerWidth <= 640 ? 24 : 48;
    for (const card of cards) {
      const w = Number(card.dataset.canvasWidth), h = Number(card.dataset.canvasHeight);
      const scale = Math.min(1, (innerWidth - gap) / w);
      card.style.transform = 'scale(' + scale + ')';
      card.parentElement.style.width = w * scale + 'px';
      card.parentElement.style.height = h * scale + 'px';
    }
  }
  function measure() {
    const overflow = [];
    const dimensions = [];
    for (const [index, card] of cards.entries()) {
      const bounds = card.getBoundingClientRect();
      dimensions.push({page:index + 1,width:card.offsetWidth,height:card.offsetHeight,ratio:card.offsetWidth/card.offsetHeight});
      let errors = 0;
      for (const zone of card.querySelectorAll('[data-fit-zone]')) {
        if (zone.scrollHeight > zone.clientHeight + 2 || zone.scrollWidth > zone.clientWidth + 2) {
          overflow.push({page:index + 1,kind:'zone',label:zone.className}); errors++;
        }
      }
      for (const node of card.querySelectorAll('[data-measure],.outline-anchor,.source-footer,.footer-meta')) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1 || rect.left < bounds.left - 1 || rect.top < bounds.top - 1) {
          overflow.push({page:index + 1,kind:'bounds',label:node.textContent.slice(0,36)}); errors++;
        }
      }
      card.classList.toggle('has-overflow', errors > 0);
    }
    const fontMap = new Map();
    for (const font of document.fonts) {
      if (!/Noto|Poppins|Inter|Font Awesome/.test(font.family)) continue;
      if (!fontMap.has(font.family) || font.status === 'loaded') fontMap.set(font.family, {family:font.family,status:font.status});
    }
    return {cardCount:cards.length,dimensions,overflow,density,checkedAt:new Date().toISOString(),fonts:[...fontMap.values()]};
  }
  function applyDensity(value) {
    density = value;
    body.classList.toggle('density-1', value >= 1);
    body.classList.toggle('density-2', value >= 2);
  }
  function fit() {
    if (busy) return window.__ARTICLE_CARD_REPORT__;
    busy = true;
    const reading = body.classList.contains('reading');
    body.classList.remove('reading');
    sizeCanvases();
    applyDensity(0);
    let report = measure();
    for (let d = 1; report.overflow.length && d <= 2; d++) { applyDensity(d); report = measure(); }
    body.classList.toggle('reading', reading);
    window.__ARTICLE_CARD_REPORT__ = report;
    status.textContent = report.overflow.length ? '画布内容溢出：请精简重复内容后重试' : '画布检查通过 · ' + cards.length + ' 页 · 3:4';
    status.classList.toggle('error', report.overflow.length > 0);
    const families = report.fonts.filter(f => f.status === 'loaded').map(f=>f.family);
    const required = ['Noto Serif SC', 'Noto Sans SC', 'Poppins', 'Font Awesome 6 Free'];
    const missing = required.filter(f => !families.some(actual => actual.replaceAll('"','').replaceAll("'",'') === f));
    report.fontsMissing = missing;
    document.querySelector('#font-note').textContent = missing.length ? '指定字体尚未全部加载，当前使用回退字体；联网后重新检查' : '指定字体已加载';
    busy = false;
    return report;
  }
  function mode(reading) {
    body.classList.toggle('reading', reading);
    document.querySelector('#canvas-mode').setAttribute('aria-pressed', String(!reading));
    document.querySelector('#reading-mode').setAttribute('aria-pressed', String(reading));
    sizeCanvases();
  }
  document.querySelector('#canvas-mode').addEventListener('click', () => mode(false));
  document.querySelector('#reading-mode').addEventListener('click', () => mode(true));
  document.querySelector('#check-layout').addEventListener('click', fit);
  document.querySelector('#download-html').addEventListener('click', () => {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector('body').classList.remove('reading');
    copy.querySelector('#canvas-mode').setAttribute('aria-pressed', 'true');
    copy.querySelector('#reading-mode').setAttribute('aria-pressed', 'false');
    const blob = new Blob(['<!doctype html>\n' + copy.outerHTML], {type:'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'article-cards.html'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector('#print-cards').addEventListener('click', () => {
    mode(false); const report = fit();
    if (report.overflow.length) { status.focus(); return; }
    window.print();
  });
  window.addEventListener('beforeprint', () => mode(false));
  window.addEventListener('resize', () => { sizeCanvases(); fit(); });
  window.checkArticleCards = fit;
  sizeCanvases(); fit();
  document.fonts.ready.then(fit);
  setTimeout(fit, 4000);
  if (location.protocol.startsWith('http') && location.hostname === '127.0.0.1') {
    let modified;
    setInterval(async () => {
      try { const response = await fetch('/__status'); if(!response.ok) return; const data = await response.json();
        if(modified !== undefined && data.modified !== modified) location.reload(); modified = data.modified;
      } catch {}
    }, 2000);
  }
})();`;
