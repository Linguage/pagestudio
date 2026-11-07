# 内容格式

`prepare` 生成 `source.md`、带 SHA-256 的 `source-map.json` 和待填写的 `card.json`。原文按空行分为 `P001`、`P002` 等段落，Markdown 标题也有自己的段落 ID。

```json
{
  "version": 1,
  "mode": "spread",
  "accent": "#874b34",
  "anchor": "Aa",
  "meta": { "title": "文章标题", "subtitle": "副标题", "kicker": "文章信息卡", "author": "", "date": "", "sourceUrl": "" },
  "analysis": { "page1": "首页围绕文章主张安排大字标题。", "page2": "次页按文章的论证次序展示细节。" },
  "keyPoints": [{ "id": "K1", "text": "原文核心要点", "sourceIds": ["P002"] }],
  "overview": { "text": "摘要", "pointIds": ["K1"] },
  "quote": { "kind": "quote", "text": "原文中的连续表述", "sourceIds": ["P002"] },
  "sections": [{ "title": "概念", "text": "正文", "items": ["第一条", "第二条"], "pointIds": ["K1"], "icon": "file-lines" }],
  "breaker": { "title": "补充信息", "text": "原文提供的补充", "pointIds": ["K1"] },
  "conclusion": { "text": "原文结论或保留的问题", "pointIds": ["K1"] }
}
```

- `keyPoints` 至少一个，ID 不得重复。每项有至少一个有效原文段落引用。
- `overview`、每个 `section`、`breaker`、`conclusion` 的 `pointIds` 非空，必须指向真实要点。所有要点至少在一个区块中使用。
- `sections` 需要 2—6 个区块；`text` 与 `items` 至少填写一种。
- `quote` 可省略；存在时 `kind` 为 `quote` 或 `summary`，且有有效 `sourceIds`。逐字引用可跨原文中的空白，但不能改写字词或标点。
- `anchor` 为 1—3 个英文字母或数字。`accent` 是六位十六进制颜色；渲染器根据对比度选择高光文字颜色。
- 支持的线稿图标：`file-lines`、`bookmark`、`lightbulb`、`circle-check`、`newspaper`、`clock`、`compass`、`flag`。图标仅作辅助装饰。
- `sourceUrl` 仅允许 http/https；文本始终转义，不接受文章中的 HTML、脚本或样式注入。
- 无法仅凭段落引用证明摘要和原文语义相符。交付前逐项回读对应段落；保留数据范围、适用条件和作者的不确定性。
