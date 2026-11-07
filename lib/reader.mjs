import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeHtml } from './metadata.mjs';

const WEB = new URL('../web/', import.meta.url);
const VENDOR = new URL('../vendor/', import.meta.url);
const assets = new Map();

function asset(directory, name, encoding) {
  if (!assets.has(name)) {
    assets.set(name, readFile(new URL(name, directory), encoding).catch(error => {
      assets.delete(name);
      throw error;
    }));
  }
  return assets.get(name);
}

const cssAsset = async () => {
  const [css, ...fonts] = await Promise.all([
    asset(VENDOR, 'fontawesome.css', 'utf8'),
    ...['fa-solid-900', 'fa-regular-400', 'fa-brands-400', 'fa-v4compatibility']
      .map(name => asset(VENDOR, name + '.woff2').then(bytes => [name, bytes.toString('base64')])),
  ]);
  const data = new Map(fonts);
  return css.replace(/url\(\.\.\/webfonts\/(fa-[\w-]+)\.woff2\)( format\("woff2"\))(?:,url\(\.\.\/webfonts\/\1\.ttf\) format\("truetype"\))?/g,
    (_, name, format) => 'url(data:font/woff2;base64,' + data.get(name) + ')' + format);
};

function inlineScript(nonce, source) {
  return '<script nonce="' + nonce + '">' + source.replace(/<\/script/gi, '<\\/script') + '</script>';
}

export async function renderReader(item, theme, capture = false) {
  const html = decodeHtml(item.raw);
  const hasTailwind = /<script\b[^>]*\bsrc\s*=\s*["']?https:\/\/cdn\.tailwindcss\.com(?:[/"'?\s>])/i.test(html);
  const hasMathJax = /<script\b[^>]*\bsrc\s*=\s*["']?https:\/\/[^\s"'<>]*mathjax/i.test(html);
  const hasIcons = /font-awesome\/|fontawesome/i.test(html);
  const isDeck = /<main data-html-cards-deck="1">/.test(html);
  const nonce = randomBytes(18).toString('base64');
  const policy = [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src 'nonce-" + nonce + "'",
    "style-src 'unsafe-inline'",
    'font-src data:',
    'img-src data:',
    'media-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const [renderer, tailwind, json5, mathjax, icons, deck, captureScript] = await Promise.all([
    asset(WEB, 'reader.js', 'utf8'),
    hasTailwind ? asset(VENDOR, 'tailwind.js', 'utf8') : '',
    hasTailwind ? asset(VENDOR, 'json5.js', 'utf8') : '',
    hasMathJax ? asset(VENDOR, 'mathjax.js', 'utf8') : '',
    hasIcons ? cssAsset() : '',
    isDeck ? asset(WEB, 'deck.js', 'utf8') : '',
    capture ? asset(WEB, 'capture.js', 'utf8') : '',
  ]);
  const data = JSON.stringify({ html, title: item.title, hasTailwind }).replace(/</g, '\\u003c');
  const nativeFonts = [
    '@font-face{font-family:"Noto Sans SC";src:local("PingFang SC");font-weight:100 900}',
    '@font-face{font-family:"Noto Serif SC";src:local("Songti SC");font-weight:100 900}',
    'html,body{scrollbar-width:none;overscroll-behavior:contain}',
    'body{margin:0;color:#222;background:#fff}',
    'html[data-html-cards-plain][data-html-cards-theme=dark]{color-scheme:dark}',
    'html[data-html-cards-plain][data-html-cards-theme=dark] body{color:#e8eae7;background:#1b1e1b}',
  ].join('\n');
  const body = [
    '<!doctype html><html data-html-cards-theme="' + (theme === 'dark' ? 'dark' : 'light') + '"' +
      (capture ? ' data-html-cards-capture' : '') + '><head><meta charset="utf-8">' +
      (capture ? '<meta http-equiv="Content-Security-Policy" content="' + policy.replace(/^sandbox allow-scripts; /, '') + '">' : '') +
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>' + nativeFonts + '\n' + icons + '</style>',
    json5 && inlineScript(nonce, json5),
    tailwind && inlineScript(nonce, tailwind),
    '</head><body><script id="reader-data" type="application/json">' + data + '</script>',
    deck && inlineScript(nonce, deck),
    inlineScript(nonce, renderer),
    mathjax && inlineScript(nonce, "window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']]},svg:{fontCache:'global'}};\n" + mathjax),
    captureScript && inlineScript(nonce, captureScript),
    '</body></html>',
  ].join('\n');
  return { body, policy };
}
