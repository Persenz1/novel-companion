# 需求层

## 1. 产品定位

`novel-companion` 是面向长篇系列小说的本地交互式阅读增强系统。基础阅读器只是入口，核心价值是围绕长篇叙事文本提供：

- 防剧透上下文。
- 人物、实体、术语和角色卡。
- 对话说话人标注。
- 事件、关系和数值变化记忆。
- 中文主轴阅读，日文参考可选展示。
- AI 辅助、可审计、可回滚的数据整理流程。

长期形态是本地桌面 App；当前阶段仍是文件夹工程 + TypeScript 工具链 + Web 数据工作台。

## 2. 内容与权利边界

项目只发行软件、数据格式、工具链、提示词和自制/授权样例数据。

项目不发行版权小说原文、可还原版权原文的大规模 parsed blocks、官方作品完整增强数据包或在线百科数据。真实书籍制作依赖用户本地合法文本与资源。

## 3. 当前阶段目标

当前阶段目标是跑通本地制作闭环，而不是完整桌面应用：

```text
EPUB / 已清洗 Markdown
-> Parsed JSONL
-> 硬校验
-> AI 起草 Candidates
-> 独立 AI 复核 / 异常队列
-> Accepted + Change
-> Compiled 查询产物
-> 最低限度 Markdown 阅读器
```

已落地的代码闭环到 EPUB 导入 MVP、Compiled 查询、数据工作台和最低限度 Markdown 阅读器。桌面 App、真实书籍规模压测、多卷清洗和成本优化仍是后续工作。

## 4. 硬约束

- 中文正文是唯一主轴；block、时间线、来源位置和防剧透边界都以中文正文为准。
- 日文只作为参考文本，不建立独立阅读进度体系。
- 正式增强数据只展示 Accepted，不展示 Candidates / ReviewItems / OpenQuestions。
- 所有影响阅读展示的数据必须有 `visible_from` 或等价正文时间线位置。
- 阅读查询必须按 `read_boundary` 过滤增强数据；`current_block` 只决定当前位置相关性。
- Accepted 写入必须生成 Change，并能追溯到正文 block 或 asset anchor。
- API key 只允许存在本地配置，不进 git、不进 bookpack、不回传给前端明文。
- AI 输出不能静默成为正式数据；低风险草案须经独立复核，风险项须升级给人裁决。

## 5. AI 制作需求

清洗后的结构化制作采用“起草 Agent + 独立复核 Agent + 人审计异常”：

- 起草 Agent 负责抽取候选，写 `candidates/candidates.jsonl`。
- 复核 Agent 独立核对正文依据、一致性和风险，路由为自动落盘、升级或拒绝。
- 人的主操作面是异常队列和 Change 审计，不是逐候选点击。
- 实体合并、歧义说话人、关系变化、伏笔 / 隐藏身份、数值冲突、图片人物身份、复核拿不准的项必须升级给人。

当前实现的上下文策略是：目标章节 + 所属整卷正文 + 全局 Accepted 结构化记忆（提示词当前主要渲染已确认实体名册，其他 Accepted 类型由数据层读入但尚未完整压缩注入）。DeepSeek Phase A 四卷长程压力已证明：在 gray-tower 样例上，不回喂前卷原文、也不加前卷梗概，仍可保持核心实体复用、主要伏笔回收和 D 班点数弧线连续。

异常队列已支持单项裁决和批量裁决 / 批量转 OpenQuestion；裁决后可通过工作台触发 validate + compile，让阅读器右栏刷新到新的 Accepted 状态。

## 6. 未完成核心需求

- 真实（版权）书籍长程制作与长程阅读压测。
- 多卷 / 多本 EPUB 清洗的真实书籍兼容性；受控 gray-tower 多个单卷 EPUB 已可 append 导入同一 bookpack。
- 第二卷及后续卷的前文上下文压缩 / 检索——Phase A 暂不阻塞 gray-tower 四卷主线；Phase B 可作为真实书或质量 / 成本对照增强，测试执行手册见 `modules/long-range-test.md`。
- DeepSeek cache 命中率与整本书制作成本优化。
- 批量合并同名实体 / 同义实体的专用入口。
- `AgentStore` 对 update / merge / deprecate 的完整 before 快照和恢复语义。
- LLM 输出的通用 schema-level 修复、重试和脱敏验收记录。
- **清洗真正起点：EPUB → 多模态清洗**已经有受控 fixture 和一键入口；多个单卷 EPUB 可汇入同一 bookpack。真实书籍复杂结构、AI 建议写回和人工确认队列还没完成。以此为准，覆盖旧的「外部 Codex/GPT 清洗」设想。详见 `modules/cleaning-pipeline.md`。
- **已确认 block 右栏看不到增强信息**：先不当 bug 修，需先与用户对齐「右栏显示什么」。同上 §2。
- **AI 提取型增强交互**（人物信息卡 / 角色事件时间线 / 关系等，从已洗数据提取）：不急，系统跑通后做，但**显示接口现在就预留**。同上 §3。
