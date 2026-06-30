# 模块：Markdown 阅读器

## 状态

最低限度 Markdown 阅读器尚未实现。当前只有 compiled 查询接口和数据工作台。

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
- 支持中文 / 中文 + 日文参考切换。

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
