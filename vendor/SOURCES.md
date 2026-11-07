# Local reader assets

- Tailwind Play CDN 3.4.17. https://cdn.tailwindcss.com/3.4.17 and https://github.com/tailwindlabs/tailwindcss/tree/v3.4.17
- JSON5 2.2.3. https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js
- Font Awesome Free 6.4.0. https://github.com/FortAwesome/Font-Awesome/tree/6.4.0
- MathJax 3.2.2 SVG bundle, reused from the local edit-engine checkout. https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js

See the accompanying license files.

## 文章信息卡

`article-cards/render.mjs` 及 `article-cards/validate.mjs` 来自本地 `dsh-article-cards` 0.1.0。前者保留原渲染器，后者保留内容验证、段落映射及文档摘要逻辑。配套模板说明随 `html-cards-create` 技能分发。许可见 `article-cards/LICENSE`。
