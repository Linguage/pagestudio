'use strict';
(() => {
  const deck = document.querySelector('main[data-html-cards-deck="1"]');
  const deckPages = deck ? [...deck.children].filter(node => node.hasAttribute('data-html-cards-slide')) : [];
  const articlePages = [...document.querySelectorAll('.canvas-list .sheet-wrap > article[data-canvas-width][data-canvas-height]')];
  const pages = deckPages.length ? deckPages : articlePages;
  const style = document.createElement('style');
  style.textContent = `
    html { scroll-behavior: auto !important; }
    *, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
    ::-webkit-scrollbar { display: none !important; }
    [data-html-cards-export-hidden] { display: none !important; }
    [data-html-cards-export-page] {
      position: fixed !important; inset: 0 auto auto 0 !important; margin: 0 !important;
      zoom: 1 !important; z-index: 2147483647 !important;
    }
  `;
  document.head.append(style);
  const wait = () => new Promise(resolve => setTimeout(resolve, 100));
  async function settle() {
    await Promise.race([Promise.all([
      document.fonts.ready,
      ...[...document.images].filter(img => img.getClientRects().length).map(img => img.decode().catch(() => {})),
      Promise.resolve(window.MathJax?.startup?.promise).catch(() => {}),
    ]), new Promise(resolve => setTimeout(resolve, 2000))]);
    await wait();
  }
  window.htmlCardsCapture = {
    count: Math.max(1, pages.length),
    async page(index) {
      if (pages.length) {
        pages.forEach((node, i) => {
          node.toggleAttribute('data-html-cards-export-page', i === index);
          node.toggleAttribute('data-html-cards-export-hidden', i !== index);
        });
        const node = pages[index];
        return { width: node.offsetWidth, height: node.offsetHeight, artboard: true };
      }
      await settle();
      return { width: innerWidth, height: Math.max(innerHeight, document.scrollingElement.scrollHeight) };
    },
    async scroll(top) {
      window.scrollTo(0, top);
      await settle();
      return { y: window.scrollY, width: innerWidth, height: innerHeight };
    },
  };
})();
