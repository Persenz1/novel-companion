# 数据清洗规范包

本目录是 novel-companion 的**数据清洗阶段**独立规范包。

清洗阶段是整条制作链路的最前端，负责把任意来源的原始文本变成一套**干净、自洽、可机器解析**的输入。它有意与后续的 AI 制作 Agent 解耦：只要清洗产物符合本规范并通过校验，下游工具链（解析、校验、候选、复核、编译、阅读）就能接手，清洗者无需了解 AI 阶段的任何细节。

当前注意：下游阶段 5-8 的真实操作逻辑正在重构讨论中。清洗规范不随候选复核 UI 调整而变化；清洗者仍只需要交付 manifest、Markdown、图片和日文参考。

本包只包含指导性、规范性 md，不包含工具代码。

## 在链路中的位置

```text
任意原始来源（人工 / 脚本 / OCR / EPUB / TXT / 外部大模型）
   │   ← 清洗阶段（本规范包负责）
   ▼
清洗产物（manifest + 清洗后 Markdown + 可选图片 + 可选日文参考）
   │   ← 下游工具链接手（不在本包范围）
   ▼
Parsed JSONL → 硬校验 → 阶段 5-8 操作逻辑待重构 → Accepted/Compiled → 阅读器
```

清洗阶段**只规定输出，不规定输入**。你可以用任何方式整理文本，只要最终产物符合本规范。

## 清洗产物契约

一个工程包（bookpack）目录下，清洗者需要**亲手交付**的只有以下内容：

```text
bookpack/
  manifest.json                 # 必需：数据包身份证与章节目录
  parsed/volumes/v01.md         # 必需：清洗后正文 + 结构 marker（一卷一个文件）
  assets/images/...             # 可选：图片资源（第一阶段允许占位文件）
  source/ja/v01.json            # 可选：日文参考文本（中文是唯一主轴，日文只作参考）
```

> 注意：`parsed/*.jsonl`、`accepted/`、`candidates/`、`compiled/`、`reports/` 等**全部由下游工具生成**，清洗者不手写。清洗者只产出 manifest、Markdown、图片、日文参考四类。

> 图片标注（2026-07 起）：图片的 `alt`（图里是谁/是什么）不必清洗者手写。工作台的**「清洗·图片」页**会用多模态模型（如 MiMo）看图给出 alt + 描述、按角色名册认人，**人工确认后写回 Markdown 的 `asset` 标记**。清洗者交付图片 + 锚点即可，`alt` 可留空由该页补全。这一步在系统内完成，身份在清洗阶段定死，下游操作阶段直接信任。详见 [markdown-spec.md](markdown-spec.md) §5。

## 核心原则

- **中文文本是唯一主轴。** block、章节、当前位置、防剧透边界、来源引用都以中文正文为准。
- **日文只作参考渲染内容**，不建立独立 block，不进入主操作链；通过 `source/ja/` 旁挂。
- **章节顺序由 manifest 声明**，不靠 ID 猜测；解析器反过来校验 Markdown 与 manifest 是否匹配。
- **block ID 一旦进入下游引用阶段原则上冻结**；插入补块用可排序后缀（如 `b0042a`）。
- **复杂结构不塞进 Markdown 注释**，注释只放轻量键值，复杂内容交给下游 JSONL。

## 验收门槛

清洗产物的唯一硬性验收标准是**通过校验器**（下游工具 `nc validate`）的 Markdown 与 manifest 检查，且无 `error`。校验报告 `reports/validation_report.json` 会给出可直接返工的 `suggested_action`，清洗流程按「生成 → 校验 → 按报告修复 → 再校验」闭环推进。

## 规范索引

- [markdown-spec.md](markdown-spec.md) — 清洗后 Markdown 的 marker 格式、ID 规则、block/scene/asset/alignment 写法。
- [manifest-spec.md](manifest-spec.md) — `manifest.json` 字段契约。
- [japanese-reference-spec.md](japanese-reference-spec.md) — `source/ja/{volume}.json` 日文参考来源格式。
- [checklist.md](checklist.md) — 清洗交付前的自检清单。
