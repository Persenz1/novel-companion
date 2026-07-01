# 模块：Markdown 阅读器

## 状态

最低限度 Markdown 阅读器已实现（`tools/src/reader.ts` + `tools/web/reader/`，`npm run reader`）。只读 manifest / Parsed / Compiled，防剧透查询完全复用 `CompiledQuery.getVisibleContext`。已按当前样例包 typecheck + 接口冒烟验证；真实书籍长程阅读体验尚未压测。

启动方式二选一：

```bash
npm run workbench   # 推荐：工作台 + 阅读器合并，阅读器在 http://localhost:4173/reader/（共用工作台配置的 bookpack）
npm run reader      # 独立只读阅读器，默认读 ../samples/gray-tower，端口 4174
npx tsx src/reader.ts <bookpack-dir>   # 独立阅读器指定数据包
```

## 需求

第一版阅读器应只读 manifest、Markdown、Parsed、Compiled，不修改 schema、parser、validator 或样例数据。

最低能力：

- 渲染 `parsed/volumes/*.md`。
- 隐藏 HTML 注释 marker。
- DOM 或内部结构保留 block ID。
- 根据阅读标尺计算 `current_block`。
- 维护 `read_boundary`。
- 正常连续阅读时自动推进 `read_boundary`。
- 快速跳读、目录跳转、搜索跳转、大幅拖动时不自动推进 `read_boundary`。
- 当 `current_block > read_boundary`，右侧面板仍按 `read_boundary` 查询，并提示当前处于越界预览。
- 支持“标记至当前 block 为已读”。
- 支持“返回 read_boundary”。
- 右侧增强面板调用 `getVisibleContext()`。
- 中日双语显示：逐段交替（中文段 + 其日文段），可切换 中日双语 / 仅中文 / 仅日文。

## 中日双语（真正双语，非参考对照）

日文是每个 block 的 1:1 并列正文，不是可隐藏的脚注。存储在 `source/ja/{volume}.blocks.json`（`block_id -> 日文`），由阅读器侧 `/api/book` 合并出 `text_ja` 并逐段交替渲染。中文正文仍是唯一时间线主轴与防剧透基准，日文不建立独立阅读进度。核心 parser / validator / compiler / 数据 schema 不受影响（双语是阅读器侧读入的授权文本）。

## 验收

- 慢速阅读会推进 read boundary。
- 快速跳到后文不会推进 read boundary。
- 后文揭示不会提前显示。
- 手动确认后，右侧增强数据更新。
- 返回 read boundary 可回到已读边界附近。
- 日文参考只在开启时显示。

## 非目标

- EPUB 原版渲染。
- 账号、云同步、在线内容平台。
- 全系列复杂关系图。
- 移动端优先。
