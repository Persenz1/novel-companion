# 下一轮：清洗与多卷操作测试

## 用户明确需求

1. 清洗入口要是一整本书的 EPUB / 文本，而不是让用户手动分卷、填内部 ID。
2. 系统内部可以分卷、分章节处理；用户只应感知“一本书 -> 自动清洗”。
3. 清洗后文本处理也应统一为“整本书输入，按卷处理”。不要让起草 / 复核阶段和清洗阶段采用两套割裂逻辑。
4. 明天要测试：
   - 多卷 EPUB 解包与清洗。
   - DeepSeek 对多卷数据的起草 / 复核操作。
   - 多卷操作时，后卷是否能接收到前一卷信息。
5. DeepSeek cache 命中率当前约 20%，成本不可接受。后续要排查提示词前缀稳定性、请求组织方式和 agent 架构。
6. 可参考 deepseektui 等开源 agent 的请求组织 / cache 友好设计，但不要直接照搬；目标是降低整本书制作成本。

## 当前代码事实

### 清洗阶段

当前清洗 UI 已是一键入口：

```text
EPUB 路径 -> 开始自动清洗
```

系统自动：

- 生成目标 bookpack。
- 导入 EPUB。
- parse + validate。
- 生成 MiMo 章节任务。
- 逐章调用 MiMo。
- 展示进度和建议。

当前 importer MVP 已能处理受控 EPUB fixture；真实多卷 EPUB 的 nav / spine / 多文件合并仍需测试。

### 起草 / 复核阶段

当前 `runDraft` / `runReview` 的作业粒度仍是章节，但背景上下文是“目标章节所属整卷正文”。两者逻辑已统一为整卷背景：

```text
target chapter + current volume body + accepted memory
```

这还不是“整本书正文一次性输入”。跨卷连续性当前主要依赖 Accepted 结构化记忆，而不是前卷原文全文。

下一轮要决定是否升级为：

```text
whole book source
-> volume jobs
-> chapter subjobs
-> stable shared prefix for DeepSeek cache
```

## DeepSeek cache 排查方向

DeepSeek 缓存命中依赖完整前缀单元复用。当前命中低可能来自：

- 每章请求的 user prompt 前缀不稳定。
- 当前卷正文和目标章节混排，导致公共前缀不足。
- Accepted 记忆顺序或内容每章变化。
- 起草与复核 prompt 结构不同，无法共享缓存。
- 每章 JSON 候选/复核输入插入位置太靠前，破坏长文本公共前缀。

建议下一步做请求结构重排：

```text
system prompt（稳定）
book/volume stable context（稳定）
accepted memory snapshot（稳定排序）
task instruction（稳定）
target chapter / candidate payload（最后变化）
```

并把每次 `work_runs.token_usage.prompt_cache_hit_ratio` 画出来，按章节比较。

## 明日验收建议

1. 准备一个多卷 EPUB 或用 gray-tower 反向生成多卷 EPUB fixture。
2. 清洗 UI 一键导入，确认能生成多卷 manifest 和多卷 Markdown。
3. 对 v01 / v02 分别跑 DeepSeek 起草 + 复核。
4. 检查 v02 起草是否复用 v01 已确认实体与长线线索。
5. 检查 `reports/work_runs.jsonl` 里的 cache hit/miss。
6. 根据命中率重构 prompt 前缀布局。
