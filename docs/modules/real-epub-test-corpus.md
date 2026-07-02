# 真实 EPUB 测试语料登记表

用户本地合法持有的真实商业 EPUB 的测试登记。正文不入库（`.gitignore` 忽略 `*.epub`），书籍文件放在 `samples/real-epubs/`（见该目录 README）。本文只记录**预期结果 + 已知怪癖**，作为清洗流水线的真实回归基线。

每次改动 importer / normalizer / 分类规则后，用这些书重跑，和下表基线对比，防回归。

## 语料 1：欢迎来到实力至上主义的教室（COTE 中译 v01/v02/v03）

- 来源结构：标准 EPUB3（`OEBPS/Text/*.xhtml` + `Images` + `Styles` + `Fonts`，`content.opf` + `.ncx`），多看阅读（duokan）扩展。
- 语言：**中文译版，无日文对照**（单语）。
- 分卷：文件名 `1-1 / 1-2 / 1-3`（不含 `v01/v02`），用户已确认它们对应中文 v01/v02/v03 三卷，需手动 `--volume-id v01/v02/v03` append。

说明：此前曾误判为“第 1 卷三册拆分”，已修正。当前 bookpack 中 `v01/v02/v03` 就是 COTE 中文前三卷。

导入 + normalize 后基线（2026-07-02）：

| 卷 | 文件 | chapters（body） | blocks | separators（normalize 后） | images | validation |
|----|------|------------------|--------|----------------------------|--------|------------|
| v01 | 1-1.epub | 28（12） | 4223 | 30 | 21 | passed |
| v02 | 1-2.epub | 23（7） | 4142 | 33 | 26 | passed |
| v03 | 1-3.epub | 23（7） | 3931 | 25 | 25 | passed |

章节 kind 分类（v01，强信号）：cover / title / colophon×2 / introduction / illustration×5 / toc / **chapter×12** / afterword / extra×3。

### 已知怪癖（这本暴露、已处理）

1. **图片不用 `<figure>`**：真实图是 `<div class="duokan-image-single"><img/></div>`。importer 已支持非 figure 包裹。
2. **纯图页（封面/彩页）无正文 block**：importer 合成 `kind:image` 承载 block，图片才进 block 序列。
3. **跨章图片 ID 碰撞**：fallback id 用章级前缀 `${chapterId}_img_NNN`。
4. **孤立数字做场景分隔**：正文里单独一行 "1"/"2"/"3" 是场景分隔，normalizer 归 `separator`（v01=30、v02=33、v03=25 处）。
5. **非正文页混入**：封面/版权/Logo/简介/彩页/目录/后记/特典，靠强信号 `classifyChapterKind` 归类，不当正文。
6. **占位 alt**：EPUB 原始 img alt 是 "001"/"006" 等数字占位，readiness 视为「缺图注」。
7. **MiMo 偶发失准**：某次 c19（4 图）返回 0 建议；曾把 `drop_noise` 错标到图片 id（应用器安全跳过）。属模型方差，靠人工裁决 + 收口 gate 兜底。

### MiMo 识图质量（实跑参考）

纯中文图注、能认出主角名（绫小路 / 堀北 / 栉田 / 一之濑 / 须藤 / 茶柱）、剧情细节（指纹证据、里拳、图书馆冲突）、非正文页（Logo / 目录）。语料 1 是「识图能力够、瓶颈在规则与应用」的实证来源。

### 本轮结果包

2026-07-02 结果已固化到：

```text
~/nc-workpack/cote-bilingual-v1
```

后续不再重复 v01/v02/v03 的清洗、v01 日文匹配、DeepSeek 起草/复核。当前结果：

- validate + compile passed。
- Accepted 283。
- review item 30。
- work_runs 53。
- v02/v03 正文图片图注缺失为 0。

## 语料 2：欢迎来到实力至上主义的教室（日文原版，第 1 卷）

状态：EPUB 已放入 `samples/real-epubs/`（本地忽略，不入库）；已作为 v01 日文匹配源使用，日文只进入 `source/ja/v01.blocks.json` 和 alignment 报告，不做结构化抽取。

- 来源结构初查：EPUB3，`OEBPS/content.opf` + `OEBPS/Text/nav.xhtml` + `OEBPS/toc.ncx`。
- 语言：**日文原版**，OPF `dc:language=ja`。
- 阅读方向：spine 标记 `page-progression-direction="rtl"`。
- 正文拆分：`OEBPS/Text/part0000.xhtml`–`part0042.xhtml`，另有 `cover_page.xhtml` / `nav.xhtml`。
- 图片：JPEG/GIF 若干，含封面图；多个 spine item 带 `rendition:layout-pre-paginated`，疑似彩页 / 固定版式页。
- 非正文信号：OPF item id 含 `fmatter` / `titlepage` / `toc` / `colophon` / `bookwalker`，nav landmarks 含 cover / toc / bodymatter。

导入基线（2026-07-02，`~/nc-workpack/cote-ja-v01-raw`）：

| 卷 | 文件 | chapters（body） | blocks | separators（normalize 后） | images | validation |
|----|------|------------------|--------|----------------------------|--------|------------|
| v01 | 日文原版第 1 卷 | 44 个 spine item（章节标题不可靠） | 3922 | 未作为清洗主轴 normalize | 19 | passed |

匹配基线：

- 日文正文实际 story block 通过章节映射 + MiMo 局部修复对齐到中文 v01。
- 中文 v01 故事正文 `3857/3857` 有日文；4 条中文译注无日文对应，进入 review item。
- v02/v03 暂无日文原版，不挂 `text_ja`。

### 本书测试需求

1. **日文只做匹配与渲染**：导入后不丢日文故事正文；`ruby` / 日文标点 / 竖排相关样式至少不能破坏文本顺序，但不从日文抽实体、事实、事件或关系。
2. **章节拆分判断**：`part0000`–`part0042` 中的小文件、彩页、目录、奥付、BookWalker 页应归入正确 chapter kind，正文不能被误判为非正文。
3. **只对齐故事内容**：翻译组信息、广告、版权页、目录、奥付、BookWalker 页等场外信息不参与中日匹配。
4. **阅读流与抽取边界分离**：cover / toc / title / colophon / illustration / afterword / extra 可进入阅读器阅读流和清洗检查；agent 剧情抽取仍只使用故事正文。
5. **固定版式与图片页**：`rendition:layout-pre-paginated` 页、纯图页、多图页要保序进入 assets/anchors；空文本 image carrier block 需要在阅读器里可渲染。
6. **导航一致性**：同时存在 nav 与 ncx；导入应按 spine 保序，同时记录 nav/toc 与 spine 不一致时的可审计线索。
7. **readiness 诚实报缺口**：图注缺失、疑似噪声、未裁决清洗建议要清楚列出，不能假绿。

### 预期可能暴露的缺口

- `readerView.ts` / 清洗 MiMo feed 已纳入书籍可读材料；agent 背景仍按 `isBodyChapterKind` 过滤非故事页。
- importer 当前主要抽取 `<p>` / `<figure>` / `<img>` / `<hr>`；若日文 EPUB 使用更复杂的 div/ruby/固定版式结构，可能出现正文抽取不足或图片锚点偏移。
- `classifyChapterKind` 对 `fmatter`、`titlepage`、`bookwalker`、日文奥付/目次等强信号可能还需要补规则。
