# 模块：Compiled 查询

## 需求

阅读器不直接拼接 Parsed 和 Accepted。它应通过统一查询入口获取防剧透增强上下文。

核心规则：

- `read_boundary` 决定可见数据。
- `current_block` 决定当前位置相关性。
- `current_block` 超过 `read_boundary` 时，不放宽可见边界。
- Candidates、ReviewItems、OpenQuestions 不进入普通阅读器。

## 生成产物

`compiled/reader_index.json` 由 compiler 生成，包含：

- manifest / source summary。
- validation report 状态。
- timeline。
- blocks、scenes、assets、asset anchors、alignments。
- accepted objects。
- by_block / by_scene / by_entity 索引。

## 查询入口

实现：`tools/src/query.ts`

```ts
getVisibleContext(current_block, read_boundary, options)
```

返回：

- current block。
- read boundary。
- current scene。
- speaker labels。
- entities / facts / events / relation changes。
- term cards / character cards / metric changes。
- current block assets。
- optional Japanese refs。
- warnings。

## 已验证

`tools/src/query.gray-tower.test.ts` 覆盖：

- 早期 read boundary 隐藏终章揭示。
- current block 跳到后文不扩大可见边界。
- 终章 read boundary 返回揭示事件和关系。
- speaker label、term card、asset 按当前位置返回。
- speaker label 也按 read boundary 过滤。
- 日文参考只在 `--ja` / includeJa 下返回，并只返回 reviewed alignment。
- 缺失数值不推测。

## 未完成

- source fingerprint / 过期检测。
- 更丰富的阅读器模块筛选和数量限制。
- 数据库或增量索引。
