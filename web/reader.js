'use strict';
(() => {
  const payload = document.getElementById('reader-data');
  const { html, title, hasTailwind } = JSON.parse(payload.textContent);
  payload.remove();
  document.title = title;

  const template = document.createElement('template');
  template.innerHTML = html;
  const source = template.content;
  const digest = source.querySelector('meta[name="article-card-digest"]')?.content;
  const articleCanvas = /^[a-f0-9]{64}$/.test(digest) ? source.querySelector('.canvas-list') : null;
  const articlePages = articleCanvas ? [...articleCanvas.querySelectorAll('.sheet-wrap > article[data-canvas-width]')] : [];
  if (articlePages.length) {
    source.querySelector('nav.toolbar')?.remove();
    articleCanvas.style.justifyContent = 'safe center';
  }

  if (hasTailwind) {
    for (const script of source.querySelectorAll('script:not([src])')) {
      const config = script.textContent.match(/^\s*tailwind\.config\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!config || config[1].length > 32000) continue;
      try {
        const parsed = window.JSON5.parse(config[1], (key, value) =>
          ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : value);
        if (parsed.theme && typeof parsed.theme === 'object') window.tailwind.config = { theme: parsed.theme };
      } catch (error) {
        console.warn('Could not read the card theme', error);
      }
      break;
    }
  }

  const block = 'script,iframe,frame,frameset,object,embed,portal,base,link,meta,template,title,animate,set,animateTransform,animateMotion,discard';
  source.querySelectorAll(block).forEach(node => node.remove());

  for (const node of source.querySelectorAll('*')) {
    for (const { name, value, localName } of [...node.attributes]) {
      const key = localName.toLowerCase();
      if (key.startsWith('on') || ['target', 'action', 'formaction', 'srcdoc', 'srcset', 'ping', 'poster', 'background', 'data', 'attributionsrc', 'autofocus', 'base'].includes(key)) {
        node.removeAttribute(name);
      } else if (key === 'href' && !value.startsWith('#')) {
        node.removeAttribute(name);
      } else if (key === 'src' && !/^data:image\//i.test(value)) {
        node.removeAttribute(name);
      }
    }
  }

  // Template parsing strips the root elements. Copy their presentation attributes separately.
  const structure = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const copied = new Set();
  for (const [, name, attributes] of structure.matchAll(/<(html|body)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const kind = name.toLowerCase();
    if (copied.has(kind)) continue;
    copied.add(kind);
    const opening = document.createElement('template');
    opening.innerHTML = '<div' + attributes + '></div>';
    const from = opening.content.firstElementChild;
    const target = kind === 'html' ? document.documentElement : document.body;
    for (const attr of ['class', 'style', 'lang', 'dir', 'id']) {
      if (from?.hasAttribute(attr)) target.setAttribute(attr, from.getAttribute(attr));
    }
  }
  document.body.append(source);
  const deck = document.querySelector('main[data-html-cards-deck="1"]');
  if (deck && typeof mountHtmlCardsDeck === 'function') {
    if (!document.documentElement.hasAttribute('data-html-cards-capture')) mountHtmlCardsDeck(deck);
    return;
  }
  // Give unstyled documents a readable default without replacing authored palettes.
  if (!hasTailwind && !document.body.querySelector('style,[style]') &&
      !document.body.hasAttribute('style') && !document.documentElement.hasAttribute('style')) {
    document.documentElement.setAttribute('data-html-cards-plain', '');
    document.documentElement.classList.add('pagestudio-theme');
  }

  const artboards = articlePages.length ? articlePages : [...document.body.children].filter(node => !node.matches('script,style'));
  const originalStyles = ['zoom', 'overflow-x', 'justify-content', 'align-items', 'translate'].map(name =>
    [name, document.body.style.getPropertyValue(name), document.body.style.getPropertyPriority(name)]);
  function horizontalBounds() {
    const boxes = artboards.map(node => node.getBoundingClientRect()).filter(box => box.width && box.height);
    if (boxes.length) return [Math.min(...boxes.map(box => box.left)), Math.max(...boxes.map(box => box.right))];
  }
  let fit = true;
  let frame = 0;
  function layout() {
    for (const [name, value, priority] of originalStyles) document.body.style.setProperty(name, value, priority);
    const viewport = document.documentElement.clientWidth;
    const bounds = horizontalBounds();
    if (!bounds || !viewport) return;
    const [left, right] = bounds;
    const width = right - left;
    if (left >= -1 && right <= viewport + 1) return;
    const body = getComputedStyle(document.body);
    const baseZoom = Number(body.zoom) || 1;
    const box = articlePages.length ? getComputedStyle(articleCanvas) : body;
    const gutters = ['paddingLeft', 'paddingRight', 'marginLeft', 'marginRight']
      .reduce((total, key) => total + (Number.parseFloat(box[key]) || 0), 0) * baseZoom;
    if (fit && width + gutters > viewport) {
      document.body.style.zoom = String(baseZoom * (viewport - 1) / (width + gutters));
    }
    // Centered, fixed-width canvases otherwise start outside the scrollable area.
    if (body.justifyContent === 'center') document.body.style.justifyContent = 'safe center';
    if (body.alignItems === 'center') document.body.style.alignItems = 'safe center';
    document.body.style.overflowX = 'visible';
    if (fit && body.translate === 'none') {
      const [fittedLeft, fittedRight] = horizontalBounds() ?? bounds;
      // A centered scale transform can leave a leading gap after safe alignment.
      const excess = Math.min(fittedLeft, fittedRight - viewport + 1);
      if (excess > 1) document.body.style.translate = (-excess / (Number(body.zoom) || 1)) + 'px 0';
    }
  }
  function scheduleLayout() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }
  const resize = new ResizeObserver(scheduleLayout);
  artboards.forEach(node => resize.observe(node));
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('load', scheduleLayout);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.channel !== 'dsh-html-cards-reader') return;
    const { theme, appearance, fit: nextFit } = event.data;
    if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-html-cards-theme', theme);
    if (appearance === 'song' || appearance === 'retro') document.documentElement.dataset.appearance = appearance;
    if (typeof nextFit === 'boolean') {
      fit = nextFit;
      scheduleLayout();
    }
  });
  scheduleLayout();
})();
