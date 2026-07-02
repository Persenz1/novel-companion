# 真实书籍：中日匹配与长程处理测试

本轮测试目标不是泛化 EPUB 兼容性，而是验证一条真实制作主线：

```text
中文清洗为故事主轴
-> 日文原版只做 block 对齐与阅读器渲染
-> 中文主轴起草 / 复核 / 裁决 / compile
-> 后卷带前文结构化信息继续处理
```

## 核心边界

1. **中文是唯一结构化主轴**：清洗、Parsed、Accepted、Candidates、Review、timeline、read_boundary 都以中文故事正文为准。
2. **日文只做匹配，不做进一步解析**：日文原版只进入 `source/ja/{volume}.blocks.json` 或 alignment 队列；不从日文抽实体、事实、事件、关系、数值、说话人。
3. **只考虑故事内容**：翻译组信息、发布说明、广告、版权、BookWalker 页、目录、奥付、封面、彩页说明、译者注等场外信息不参与中日匹配，也不进入后续 agent 处理。
4. **阅读器负责正确展示**：阅读器以中文 block 为阅读进度和防剧透基准；有日文匹配时逐段显示，无匹配时只显示中文，不因日文缺失影响阅读边界。
5. **后卷测试真实长程上下文**：后卷起草/复核时，不回喂前卷全量正文作为默认路径；优先验证“前卷 Accepted 结构化记忆 + 当前卷清洗正文”是否足够。

## 本轮收口结论

2026-07-02 本轮真实 COTE 测试已完成，结果固化到本机主数据包：

```text
~/nc-workpack/cote-bilingual-v1
```

后续阅读器作业、角色卡、时间线、说话人显示都以这个包为基线，不再重复本轮清洗、日文匹配、起草和复核。

已确认结果：

- 中文 v01/v02/v03 是三卷；日文原版目前只有 v01。
- v01 日文只做匹配与阅读器显示，不进入 Accepted/Candidates 的剧情抽取。
- MiMo 日文匹配修复顺序匹配错位后，v01 故事正文 `3857/3857` 全覆盖；4 条中文译注进入 `review/ja_alignment_items.jsonl`，原因是中文译版补充，日文原版无对应。
- v02/v03 MiMo 清洗完成，14 个正文章节、36 条低风险建议全部应用；v02/v03 正文图片图注缺失为 0，锚点有效。
- v01 清洗按用户确认视为既有合格基线，本轮未继续改动。
- DeepSeek 起草 / 复核在 v01-v03 跑通，最终 validate + compile passed，Accepted 283，review item 30，work_runs 53。
- 本轮暴露并修复：长章 JSON 截断 -> 候选数上限收敛到 15；短 block id -> 入库前自动补全当前章节完整 id。

当前判断：

- 足够作为真实阅读器作业基线。
- 不再重复清洗 / 匹配 / 起草 / 复核。
- 尚不代表无监督批处理生产化，后续仍需 usage audit、token 预算器、失败重试和更细的分块作业。

## 当前实现事实

代码已经支持一部分边界：

- `tools/src/types.ts` 明确：中文正文是 single spine；日文只作为 alignment reference。
- `tools/src/parser.ts` 会从 Markdown 的 `alignment` marker 生成 `parsed/alignments.jsonl`，并从 `source/ja/{volume}.json` 合并 `ja_refs`。
- `tools/src/readerView.ts` 会读取 `source/ja/{volume}.blocks.json`，把 `text_ja` 挂到中文 block 上，用于阅读器逐段显示。
- `tools/src/query.ts` 只有在 `--ja` / `includeJa` 时返回 reviewed alignment 的 `ja_refs`，不会把日文纳入防剧透过滤。
- `tools/src/agent/pipeline.ts` 的起草/复核输入来自 Parsed 中文 blocks + Accepted；当前没有读取 `source/ja`，符合“不从日文抽结构化数据”的边界。

当前边界：

- 真实书阅读器主产物采用 `source/ja/{volume}.blocks.json`（block_id -> 日文正文）。
- `tools/scripts/mimo-ja-alignment.ts` 是本轮真实书 v01 的 MiMo 辅助匹配脚本，输出 `source/ja/v01.blocks.json`、`review/ja_alignment_items.jsonl`、`reports/ja_alignment_report.json` 与 `reports/ja_alignment_mimo_outputs/*.json`。
- `tools/scripts/match-ja-reference.ts` 保留为非 MiMo 顺序匹配 / 初筛工具，不作为最终验收依据。
- 封面、目录、彩页、后记、特典等前后页属于书籍阅读材料：清洗任务和阅读器会纳入；agent 整卷背景仍跳过非故事 chapter kind，防止它们进入剧情结构化抽取。
- 中文译注等中文独有内容以 alignment review item 记录，不强行匹配日文，也不作为剧情结构化证据。

## 本轮问题

### Q1：日文只匹配不解析能否成立？

验证点：

- 中文清洗后的故事 block 能与日文原版 story block 建立稳定对应。
- 日文 `<ruby>`、竖排样式、日文引号等只影响抽取/显示，不污染结构化数据。
- 一对一、一对多、多对一、未匹配都能进入可审计队列，而不是强行错误对齐。
- 日文缺失或中文独有的翻译组信息被明确标记为非故事内容，不进入 alignment。

判定：

- `source/ja/v01.blocks.json` 只包含中文故事 block id 的日文正文。
- Accepted/Candidates/Review 中没有“来自日文解析”的结构化项。
- 未匹配项有原因：非故事内容、翻译删改、分段差异、抽取失败。

建议产物：

```text
source/ja/v01.blocks.json              # block_id -> 日文正文，阅读器直接消费
review/ja_alignment_items.jsonl        # 待裁决匹配差异：一对多、多对一、低置信、未匹配
reports/ja_alignment_report.json       # 覆盖率、未匹配原因、人工裁决统计
```

`parsed/alignments.jsonl` 仍然可以作为编译后的查询产物，但真实制作流程里，人更需要先看 `ja_alignment_items` 和报告。

### Q2：阅读器能否正确渲染中日双语？

验证点：

- 中日双语模式：中文段 + 对应日文段逐段展示。
- 仅中文 / 仅日文模式都能工作；仅日文模式仍使用中文 block id 和中文时间线。
- 无日文匹配的中文 block 不破坏布局。
- 图片、空文本 image carrier block、分隔符、章节标题在双语模式下不乱序。
- 非故事章节不进入连续阅读时间线。

判定：

- 慢读推进 `read_boundary` 时，右栏只按中文已读边界显示。
- 跳到后文日文段不会提前扩大可见上下文。
- 翻译组信息 / 版权页 / 广告页不出现在故事阅读流里。

阅读器验收补充：

- 双语切换不改变 `read_boundary`。
- 仅日文模式下，目录、当前位置、右栏查询仍以中文 block id 为准。
- `text_ja` 很长或含 ruby 展平后的括注时，不挤压按钮/右栏，也不覆盖下一段。
- 图片页若属于故事彩页，可显示图片与图注；若属于封面/广告/版权，不进入故事阅读流。

### Q3：真实长程处理是否有效？

测试路径：

1. 第 1 卷：中文版清洗到 readiness 通过。
2. 第 1 卷：日文原版与中文故事 block 匹配，生成/裁决 alignment。
3. 第 1 卷：跑起草、复核、人工裁决、compile，形成 Accepted 结构化记忆。
4. 第 2/3 卷：分别清洗中文故事正文，排除场外信息。
5. 第 2/3 卷：在带前文 Accepted 信息的上下文下跑起草和复核。
6. 阅读器检查：后卷阅读时，右栏能继承前卷信息，但不泄漏未读后文。

重点观察：

- 后卷是否复用前卷实体 ID，而不是重建同名实体。
- 数值、关系、伏笔、术语是否能承接。
- 复核是否能把高风险跨卷推断升级到 review/open_question。
- token 用量和 cache 命中是否可接受；用工作台 / 清洗页「用量」仪表盘观察清洗、起草、复核各自的消耗。

最低通过线：

- 第 2 卷起草能识别并复用第 1 卷核心人物/班级/制度实体。
- 第 2/3 卷不把前卷已确认事实当成新设定重造。
- 至少一个跨卷关系或数值变化能被复核正确路由：低风险自动落盘，高风险升级而不是静默编造。
- compile 后阅读器在后卷能看到前卷已读信息，但看不到当前阅读边界之后的信息。

失败也有价值的判定：

- 如果实体复用失败，优先归因到 Accepted 上下文组织与 prompt，而不是清洗。
- 如果中文故事正文混入翻译组信息，归因到清洗/章节 kind/非故事过滤。
- 如果日文显示错位但结构化数据正确，归因到中日匹配或阅读器渲染。
- 如果复核过度自动接受跨卷推断，归因到 reviewer 路由规则和风险提示。

## 阶段计划

### Phase 0：语料与边界确认

状态：已完成。

- 已有：中文 v01/v02/v03 EPUB；日文原版 v01 EPUB。
- 日文 v02/v03 暂缺，本轮后半段按中文长程处理验证。
- 明确非故事规则：翻译组信息、发布说明、广告、版权、目录、奥付、BookWalker、封面、彩页等默认排除出 story body。

工作副本建议：

```bash
cd tools
WP=~/nc-workpack/cote-bilingual-v1
```

所有真实书籍产物都写到 `$WP`，不写回 `samples/gray-tower`，不把 EPUB 或模型输出加入 git。

### Phase 1：第 1 卷中文清洗

状态：v01 按既有清洗结果作为合格基线，不再重复改动。

- 多个中文 EPUB append 成同一第 1 卷或同一 bookpack 的连续卷时，要明确映射策略。
- 清洗目标是故事正文干净，而不是保留 EPUB 全部可见页面。
- readiness 必须诚实报告图注、噪声、未裁决建议。

已有 CLI 可覆盖的部分：

```bash
npx tsx src/cli.ts import-epub "../samples/real-epubs/<中文 1-1>.epub" "$WP" --volume-id v01 --force
npx tsx src/cli.ts import-epub "../samples/real-epubs/<中文 1-2>.epub" "$WP" --volume-id v02 --append
npx tsx src/cli.ts import-epub "../samples/real-epubs/<中文 1-3>.epub" "$WP" --volume-id v03 --append
npx tsx src/cli.ts normalize "$WP"
npx tsx src/cli.ts cleaning-readiness "$WP"
```

注意：用户已明确 COTE 中文三本就是 v01/v02/v03 三卷，不是第一卷三 part。后续文档和脚本均按三卷处理。

需要特别处理：

- 中文译版可能含翻译组信息、发布说明、广告、下载站提示。这些内容默认 `kind=extra` 或 cleaning item `drop_noise`，不进入 story body。
- 彩页如果承载故事相关插图，可以保留为 story asset；如果只是版权/广告，归为非故事。
- 译者注若解释故事内术语，先作为 `note` 保留但不让 agent 当作剧情事实；若是场外说明，排除。

### Phase 2：第 1 卷日文匹配

状态：已完成，作为后续阅读器基线。

结果：

- MiMo 匹配输出 `source/ja/v01.blocks.json`。
- 故事正文覆盖 `3857/3857`。
- `review/ja_alignment_items.jsonl` 有 4 条，均为中文译注 / 译版补充，无日文对应。
- v02/v03 不挂日文，阅读器中 `text_ja` 为 0。

- 日文 importer 只产出可匹配 story blocks。
- 匹配器输出 `source/ja/v01.blocks.json` 和待裁决 alignment 差异。
- 对翻译组信息等中文独有内容，输出“非故事/无须匹配”原因。

当前可用脚本：

```text
npx tsx scripts/mimo-ja-alignment.ts --bookpack <zh-bookpack> --ja-bookpack <ja-imported-bookpack> --volume-id v01 --preset cote-v01 --force
```

后续若产品化，需要补 API / UI：

```text
GET  /api/ja-alignment/items
POST /api/ja-alignment/items/resolve
POST /api/ja-alignment/apply
GET  /api/ja-alignment/report
```

这些接口仍不应写 Accepted；只写 `source/ja/*`、`review/ja_alignment_items.jsonl`、`reports/ja_alignment_report.json`。

匹配策略建议：

1. 按章节标题 / nav toc 粗对齐章节。
2. 章节内按段落长度、标点密度、专名、数字、对话结构做候选匹配。
3. 低风险一对一自动写入 `source/ja/v01.blocks.json`。
4. 一对多 / 多对一 / 低置信 / 缺失进入 `review/ja_alignment_items.jsonl`。
5. 人工裁决后重新生成 `source/ja/v01.blocks.json`，再让阅读器消费。

不建议本轮做：

- 不用 LLM 直接翻译日文来辅助结构化抽取。
- 不要求机器自动解决所有段落拆分差异；先让审计队列把差异暴露出来。
- 不把日文原版的章节划分强行改写中文主轴。

### Phase 3：第 1 卷数据处理

状态：已完成并合并回主数据包。

- 起草/复核只读中文故事正文 + 已裁决日文匹配（用于阅读展示，不用于抽取）。
- 生成 Accepted 结构化记忆。
- compile 后阅读器验证中日双语和防剧透右栏。

已有界面/HTTP 能覆盖：

```text
npm run workbench
POST /api/draft
POST /api/review
POST /api/queue/resolve 或 /api/queue/resolve-batch
POST /api/compile
GET  /reader/
```

本阶段要额外留意：日文匹配文件存在时，agent prompt 仍不应包含 `text_ja` 或 `ja_refs`。它们只给阅读器用。

数据处理验收：

- `reports/work_runs.jsonl` 可以清楚区分 draft/review 阶段与模型 token 使用。
- Accepted 的 `source_span` 和 `visible_from` 都指向中文 block。
- 日文匹配数据不出现在 Candidate payload 的 evidence 里，除非明确作为“显示参考”而非抽取证据。
- 人工裁决后的 review item 能进入 compile，阅读器右栏可见。

### Phase 4：第 2/3 卷清洗与长程处理

状态：已完成并合并回主数据包。

结果摘要：

| 阶段 | 结果 |
|------|------|
| v02/v03 MiMo 清洗 | 14 个正文章节跑通，36 条低风险建议全部应用 |
| v02/v03 图注 / 锚点 | 正文图片缺图注 0，锚点有效 |
| DeepSeek 起草 / 复核 | work_runs 53，Accepted 283，review item 30 |
| 校验 / 编译 | `~/nc-workpack/cote-bilingual-v1` validate + compile passed |
| 长程问题修复 | JSON 截断 -> 候选上限 15；短 block id -> 入库前补全 |

- 对第 2/3 卷先做中文清洗，确保故事正文可用。
- 起草/复核上下文使用：

```text
稳定系统提示
+ 前文 Accepted 结构化记忆
+ 当前卷中文故事正文
+ 当前目标章
```

- 观察跨卷实体复用、关系演变、数值连续、伏笔处理和 review 升级。

上下文有效性记录表：

| 检查项 | 第 2 卷 | 第 3 卷 | 失败归因 |
|--------|--------|--------|----------|
| 核心实体 ID 复用 | 跑通，无重复实体名 | 跑通，无重复实体名 | 后续需在阅读器卡片中人工审阅质量 |
| 班级与制度术语复用 | 跑通 | 跑通 | term_card 数量偏少，后续阅读器作业补强 |
| 数值变化承接 | 有 metric / metric_change | 有 metric / metric_change | 后续按时间线审计 |
| 关系变化承接 | 本轮 relation_change 为 0 | 本轮 relation_change 为 0 | 下一步重点补角色关系 / 时间线 / 关系变化 |
| 伏笔不过度编造 | 复核有升级 / 拒绝 | 复核有升级 / 拒绝 | 仍需人工裁决 review item |
| token / cache 仪表盘 | 已显示阶段总览 | 已显示阶段总览 | 官网控制台与本地账本不一致，后续单独排查 |

对第 2/3 卷暂不强制日文匹配。如果日文 2/3 卷未准备好，长程测试仍可先用中文清洗 + Accepted 上下文跑通。

### Phase 5：交互打磨与需求研究

状态：下一轮开始。

下一轮不再重复本轮清洗、匹配、起草、复核，直接在 `~/nc-workpack/cote-bilingual-v1` 上做阅读器侧作业：

- 角色卡显示与编辑。
- 时间线 / 事件线显示。
- 说话人显示与修正。
- review item 人工裁决。
- usage audit：DeepSeek / MiMo 控制台与本地 request usage 对账。

跑通后再进入产品形态打磨：

- 清洗页和处理页是否应该合并成同一“制作流程”。
- 中日匹配差异如何给人审：按章节、按 block、按未匹配原因。
- 翻译组信息等非故事内容是隐藏、归档，还是提供可选查看。
- 起草/复核是否需要显示“本章引用了哪些前文 Accepted 记忆”。
- 成本面板是否按清洗 / 匹配 / 起草 / 复核分阶段展示。

建议把最终体验收束成一条制作向导：

```text
导入中文 EPUB
-> 清洗故事正文
-> 可选导入日文 EPUB
-> 中日匹配/裁决
-> 起草
-> 复核
-> 人工处理异常
-> compile
-> 阅读器验收
```

每一步都显示“能不能进入下一步”的 gate，而不是让用户记住命令顺序。

## 暂不做

- 不从日文原文生成 Accepted 数据。
- 不把翻译组信息、广告、版权页作为故事正文处理。
- 不追求 EPUB 原排版复刻。
- 不在这轮优先做 Phase B 的前卷全文回喂 / RAG，除非结构化记忆路径失败。

## 后续实现优先级

P0：把边界跑通。

- 非故事章节过滤进入 `timeline.ts` / `readerView.ts`。
- 明确 `source/ja/{volume}.blocks.json` 为阅读器主产物。
- 增加中日匹配报告与人工裁决队列的最小格式。

P0 任务切片：

| 任务 | 目标 | 不做 |
|------|------|------|
| 非故事过滤 | story body 才进入 timeline / reader order | 不重构 manifest schema |
| 日文 block 抽取 | 从日文 EPUB 得到章节级 story blocks | 不做结构化抽取 |
| 中日匹配报告 | 覆盖率、低置信、未匹配原因可见 | 不要求 100% 自动对齐 |
| 阅读器双语验收 | `text_ja` 正确展示且不影响 read_boundary | 不复刻 EPUB 原排版 |
| 第 1 卷 agent 闭环 | 中文主轴生成 Accepted 并 compile | 不把日文作为 evidence |

P1：提高真实书籍可用性。

- 日文 EPUB story block 抽取：ruby 展平、固定版式页跳过/转图片、nav/toc 辅助章节识别。
- 中文清洗阶段增加“场外信息”分类和批量排除。
- 阅读器双语模式打磨长日文段、缺失匹配、图片页。

P2：降低长程成本。

- 重排 draft/review prompt，使稳定前缀更长。
- 记录每章 cache hit ratio，并按卷汇总。
- 如结构化记忆不够，再设计前卷梗概或检索层。
