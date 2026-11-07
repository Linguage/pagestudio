'use strict';
function mountHtmlCardsDeck(deck) {
  const slides = [...deck.children].filter(node => node.hasAttribute('data-html-cards-slide'));
  if (!slides.length) return;
  document.body.classList.add('html-cards-deck-player');
  deck.tabIndex = 0;
  deck.setAttribute('aria-label', '幻灯片');
  const controls = document.createElement('nav');
  controls.className = 'html-cards-deck-controls';
  controls.setAttribute('aria-label', '幻灯片翻页');
  const previous = document.createElement('button');
  previous.textContent = '← 上一页';
  const next = document.createElement('button');
  next.textContent = '下一页 →';
  const position = document.createElement('output');
  position.setAttribute('aria-live', 'polite');
  controls.append(previous, position, next);
  deck.after(controls);

  let index = 0;
  let fit = true;
  function size() {
    const scale = fit ? Math.min(1, Math.max(1, deck.clientWidth - 24) / 1920, Math.max(1, deck.clientHeight - 24) / 1080) : 1;
    slides[index].style.zoom = String(scale);
  }
  function show(page) {
    index = Math.max(0, Math.min(slides.length - 1, page));
    slides.forEach((slide, number) => { slide.hidden = number !== index; });
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    position.textContent = (index + 1) + ' / ' + slides.length + ' 页';
    deck.scrollTo(0, 0);
    size();
  }
  previous.onclick = () => show(index - 1);
  next.onclick = () => show(index + 1);
  document.addEventListener('keydown', event => {
    const pages = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1 };
    if (event.altKey || event.ctrlKey || event.metaKey || !Object.hasOwn(pages, event.key)) return;
    event.preventDefault();
    show(pages[event.key]);
  });
  window.addEventListener('resize', size);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.channel !== 'dsh-html-cards-reader') return;
    if (typeof event.data.fit === 'boolean') {
      fit = event.data.fit;
      size();
    }
  });
  show(0);
}
