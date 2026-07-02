# 真实 EPUB 测试语料（本地，不提交正文）

这个目录放**用户本地合法持有的真实商业 EPUB**，用于清洗流水线的真实兼容性测试。

## 重要：版权与提交边界

- `*.epub` 已被仓库 `.gitignore` 全局忽略——**书籍正文永远不会进 git**。
- 提交进仓库的只有：本 README、以及测试语料的**登记表 + 预期结果 + 已知怪癖**（见 `docs/modules/real-epub-test-corpus.md`）。
- 原创样例 `samples/gray-tower/` 才是提交态可复现夹具；这里的真实书只在本机跑。

## 怎么填

把 EPUB 直接放进本目录即可，例如：

```
samples/real-epubs/
  欢迎来到实力至上主义教室 1-1.epub
  欢迎来到实力至上主义教室 1-2.epub
  欢迎来到实力至上主义教室 1-3.epub
  <你的下一本>.epub
```

放好后，在 `docs/modules/real-epub-test-corpus.md` 的登记表里加一行（书名、卷数、来源结构、预期计数、已知怪癖），以便回归对比。

## 怎么跑（单本 / 多卷）

```bash
cd tools
WP=~/nc-workpack/<pack-name>

# 单本
npx tsx src/cli.ts import-epub "../samples/real-epubs/<book>.epub" "$WP" --volume-id v01 --force

# 多卷（同一系列多个单卷 EPUB append 汇入一个 bookpack）
npx tsx src/cli.ts import-epub "../samples/real-epubs/<book> 1-1.epub" "$WP" --volume-id v01 --force
npx tsx src/cli.ts import-epub "../samples/real-epubs/<book> 1-2.epub" "$WP" --volume-id v02 --append
npx tsx src/cli.ts import-epub "../samples/real-epubs/<book> 1-3.epub" "$WP" --volume-id v03 --append

# 确定性规范化 + 收口检查
npx tsx src/cli.ts normalize "$WP"
npx tsx src/cli.ts cleaning-readiness "$WP"
```

工作副本放在仓库外的持久目录（如 `~/nc-workpack/`），不要塞回 `samples/`。
