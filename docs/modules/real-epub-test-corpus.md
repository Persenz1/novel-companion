# 真实 EPUB 测试语料登记表

用户本地合法持有的真实商业 EPUB 的测试登记。正文不入库（`.gitignore` 忽略 `*.epub`），书籍文件放在 `samples/real-epubs/`（见该目录 README）。本文只记录**预期结果 + 已知怪癖**，作为清洗流水线的真实回归基线。

每次改动 importer / normalizer / 分类规则后，用这些书重跑，和下表基线对比，防回归。

## 语料 1：欢迎来到实力至上主义的教室（COTE 中译，第 1 卷分三册）

- 来源结构：标准 EPUB3（`OEBPS/Text/*.xhtml` + `Images` + `Styles` + `Fonts`，`content.opf` + `.ncx`），多看阅读（duokan）扩展。
- 语言：**中文译版，无日文对照**（单语）。
- 分卷：文件名 `1-1 / 1-2 / 1-3`（不含 `v01/v02`），需手动 `--volume-id v01/v02/v03` append。

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

## 语料 2：<待填>

放入 `samples/real-epubs/` 后在此登记：来源结构、语言、分卷方式、导入基线、已知怪癖。优先补齐下列极端形态（见 `compatibility-testing-plan.md`）：日文原版、脚注、诗歌/短信体、表格、跨文件章节、异常 nav/ncx、非 duokan 排版、图文混排段落。
