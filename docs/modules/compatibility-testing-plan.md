# 规划：真实 EPUB 极端兼容性测试

本文件是长期兼容性矩阵。当前真实书籍主线测试另见 `real-book-bilingual-long-range-test.md`：中文作为故事主轴，日文只做中日匹配与阅读器渲染，并验证第 2/3 卷带前文结构化信息的起草 / 复核。

清洗数据是下游一切的地基（见 `cleaning-pipeline-v2-design.md`）。gray-tower 是受控原创夹具，覆盖不了真实书的千奇百怪。本规划用不断扩充的真实 EPUB 语料（`samples/real-epubs/`，本地不入库）系统性地压兼容性。

## 目标

1. importer 对真实结构**不丢内容、保序**；无法处理的形态要**显式报出**而非静默吞掉。
2. normalizer + 分类规则对常见模式**零误判**。
3. readiness 收口清单能**诚实**反映「离完美还差什么」。
4. 每类怪癖沉淀成 `real-epub-test-corpus.md` 的一条基线，防回归。

## 测试维度（按优先级）

### A. 结构形态
- [x] 标准 EPUB3 + duokan 扩展（语料 1 COTE）
- [x] 日文原版 v01 作为匹配源（语料 2：竖排/RTL spine、假名注音 `<ruby>`、日文引号、固定版式页；已用于 COTE v01 日文匹配）
- [ ] 跨文件章节（一章拆多个 xhtml / 多章合一个 xhtml）
- [ ] 异常导航：仅 `.ncx` 无 nav、nav 与 spine 不一致、无目录
- [ ] EPUB2、非 duokan 排版、其它厂商扩展
- [ ] 分卷信号：文件名/标题/spine 都不含卷号时的分卷策略

### B. 正文内容形态
- [x] 孤立数字场景分隔（COTE）
- [ ] 符号分隔（※ ◇ ＊ 行）、诗歌/歌词、书信/短信体
- [ ] 表格、代码块、脚注/尾注、注释性旁注
- [ ] 图文混排段落（`<p>` 内嵌 `<img>`）、跨页图、跨栏
- [ ] 广告页 / 出版社宣传页 / 试读页等非正文噪声

### C. 图片形态
- [x] `<div><img>`、纯图页、跨章 ID
- [ ] 多图一页、SVG 包裹图、base64 内嵌图、封面双图
- [ ] 图注已在正文（需识别并关联，而非再生成 alt）

### D. 多卷 / 整本
- [x] 多个单卷 EPUB append 为一本（COTE 1-1/1-2/1-3，用户确认对应中文 v01/v02/v03）
- [ ] 单个 EPUB 内含多卷、合集本拆卷
- [ ] 跨卷实体/线索一致性（清洗后接长程起草复核）

### E. 全链贯通
- [x] COTE v01-v03：import → normalize/MiMo → ingest → apply → compile → 阅读器基线；v01 清洗按既有测试结果保留，不重复改动
- [x] 非正文页从阅读时间线剔除（timeline / readerView / MiMo feed / agent 背景按 `isBodyChapterKind` 过滤）
- [x] 阅读器渲染中日双语正文，目录默认展开；图片显示仍需在后续阅读器制作作业中继续审阅

## 每本书的测试流程（清单）

1. 放入 `samples/real-epubs/`，`git check-ignore` 确认被忽略。
2. import（必要时分卷 append），记 chapters/blocks/images/validation。
3. `cleaning-readiness` 看初始缺口。
4. `normalize`，确认噪声归零、无误判。
5. 抽查章节 kind 分类是否正确（有无正文被误判非正文、反之）。
6. 跑 MiMo（token 够就整本），`ingest` → 界面裁决 → `apply --all-low`。
7. `cleaning-readiness` 逼近全绿；剩余项归类为「模型方差 / importer 缺陷 / 规则缺陷」。
8. 把新怪癖 + 基线写进 `real-epub-test-corpus.md`。
9. importer/规则若为此书改动，回归语料 1 基线确保不倒退。

## 沉淀机制

- 结构基线：`real-epub-test-corpus.md` 表格（防回归对比）。
- 确定性逻辑：优先补 `normalize.ts` / `classifyChapterKind` 规则并加单测（如 `markdownEdit.test.ts` 的做法）。
- 需要判断的：交 MiMo，靠裁决队列 + 收口 gate 兜底。
- importer 遇到无法解析的结构：应产出 validation/cleaning note 显式报出，严禁静默丢内容。

## 里程碑

1. **M1 单语中译（已达成）**：COTE 三卷 import+normalize+图注+收口闭环跑通。
2. **M2 日文原版（已达成 v01 匹配基线）**：语料 2 已用于 COTE v01 日文匹配，故事正文覆盖 `3857/3857`；后续重点转向日文 v02/v03 语料补齐与匹配 UI。
3. **M3 结构地狱**：脚注/表格/跨文件章节/异常 nav 各来一本，importer 显式报缺陷。
4. **M4 整本贯通（COTE v01-v03 已达成本轮基线）**：真实书从 EPUB 到防剧透阅读、日文匹配、清洗、长程起草复核已跑通；下一步转阅读器角色卡 / 时间线 / 说话人作业。
