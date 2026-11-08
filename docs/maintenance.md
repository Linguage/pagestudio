# PageStudio 维护与扩展指南

## 本地开发

需要 Node.js 22.19 或以上。支持的 DSH 版本范围见 [package.json](../package.json)。

```sh
DSH_HTML_CARDS_DIR="$PWD/.local/library" npm run serve
```

用终端显示的地址预览。该命令把开发资料库放在 `.local/library`。原生 AI 侧栏和对话工具需要在 DSH 中验证。

```sh
npm test
npm run test:host
```

`test:host` 需要 DSH CLI，使用临时资料库检查插件激活、页面加载及导入流程。

## 扩展入口

| 维护内容 | 入口 |
| --- | --- |
| DSH 插件激活、对话工具及 Skills 注册 | [lib/index.js](../lib/index.js) |
| DSH 侧栏及宿主交互 | [lib/client.js](../lib/client.js) |
| 卡片库界面与阅读器 | [web/](../web/) |
| 导入、资料库切换和卡片操作 | [lib/http.mjs](../lib/http.mjs) · [lib/library.mjs](../lib/library.mjs) |
| 多页 HTML 的导入和翻页 | [lib/decks.mjs](../lib/decks.mjs) · [web/deck.js](../web/deck.js) |
| 对话中的制卡、导入、规范化和归类 | [skills/](../skills/) |

新增 Skill 时，在 `skills/` 下添加对应目录，在插件入口注册，并把所需文件纳入[打包检查](../scripts/package.mjs)。更新渲染组件时，在[第三方来源清单](../vendor/SOURCES.md)中记录版本和来源，并保留随附的许可文本。

## 导入旧版静态归档

这条命令面向早期 HTML Cards 静态目录中的 HTML 文件。它会读取平铺的 `cards/` 或旧版分类目录，复用索引里的标题和分类，并跳过内容相同的卡片。先指定目标资料库目录。

```sh
DSH_HTML_CARDS_DIR="/path/to/target-library" npm run seed -- /path/to/html-cards
```

PageStudio 也可从侧栏底部的「资料库位置」打开已有的 `library.sqlite` 所在目录。路径配置保存在 `~/.dsh/storages/pagestudio-library.json`。设置 `DSH_HOME` 时，配置文件位于该目录下的 `storages/`。环境变量 `DSH_HTML_CARDS_DIR` 可为本次运行指定目录。

## 打包与发版

在版本发布前运行 `npm run package`。安装包和 SHA256 校验文件会写入 `dist/`。

更新 [package.json](../package.json) 的版本号，提交变更并推送同名版本标签。到 GitHub Actions 手动运行 [Release PageStudio](../.github/workflows/release.yml)，填入该标签。工作流会运行测试、生成安装包与校验文件、发布 GitHub Release，并更新用于插件安装的注册表。

已发布的版本号与安装包校验值对应。需要改动安装包时，使用新版本号并发布新标签。
