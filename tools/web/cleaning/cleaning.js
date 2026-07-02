const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  tasks: [],
  selectedTask: null,
  lastOutput: null,
  activeBookpack: false,
  taskStatus: new Map(),
};

async function api(path, method = "GET", body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["content-type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opt);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `请求失败 ${resp.status}`);
  return data;
}

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast${isErr ? " err" : ""}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3200);
}

function banner(msg, active = false) {
  const b = $("#run-banner");
  b.textContent = msg;
  b.className = `run-banner${active ? " active" : ""}`;
  b.hidden = !msg;
}

function setProgress(done, total, text) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  $("#clean-progress").style.width = `${pct}%`;
  $("#progress-text").textContent = text || (total ? `${done}/${total}` : "等待开始");
}

async function loadState() {
  const data = await api("/api/state");
  if (data.bookpack?.ok) {
    $("#pack-status").textContent = state.activeBookpack
      ? `${data.bookpack.pack_name}（${data.bookpack.series?.title || "未命名"}）`
      : "等待导入 EPUB";
  } else {
    $("#pack-status").textContent = "等待导入 EPUB";
  }
}

function resetWorkspace() {
  state.tasks = [];
  state.selectedTask = null;
  state.lastOutput = null;
  state.activeBookpack = false;
  state.taskStatus = new Map();
  $("#pack-status").textContent = "等待导入 EPUB";
  $("#epub-path").value = "";
  $("#reference-epub-path").value = "";
  setProgress(0, 0, "等待开始");
  renderTasks();
  $("#asset-list").replaceChildren(el("div", "empty", "导入 EPUB 后显示图片"));
  renderOutput({ parsed: { suggestions: [], summary: "导入 EPUB 后显示清洗建议" } });
  $("#tab-queue").replaceChildren(el("div", "empty", "导入 EPUB 后可裁决清洗建议"));
  $("#tab-usage").replaceChildren(el("div", "empty", "导入 EPUB 后显示本轮用量"));
}

async function autoClean() {
  const epubPaths = $("#epub-path").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const referenceEpubPaths = $("#reference-epub-path").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!epubPaths.length) throw new Error("请填写 EPUB 路径。");
  resetForRun();
  banner("正在导入 EPUB 并生成章节任务…", true);
  setProgress(0, epubPaths.length, `导入 EPUB 1/${epubPaths.length}`);
  const r = await api("/api/cleaning/auto-start", "POST", {
    epub_paths: epubPaths,
    reference_epub_paths: referenceEpubPaths,
  });
  const summary = r.import_summary || r.imported || {};
  state.activeBookpack = true;
  state.tasks = r.prepared?.tasks || [];
  state.tasks.forEach((task) => state.taskStatus.set(task.file, "pending"));
  banner("");
  const refSummary = r.reference_import_summary;
  const refText = refSummary?.epub_count ? `；原文 ${refSummary.epub_count} 本已挂入` : "";
  toast(`导入完成：${summary.epub_count || 1} 本，${summary.chapter_count || 0} 章，${summary.block_count || 0} blocks，${summary.image_count || 0} 图${refText}`);
  await loadState();
  renderTasks();
  await loadAssets();
  renderOutput({
    parsed: {
      suggestions: [],
      summary:
        `validation=${summary.validation_status || r.imported?.validation?.status || "unknown"}，开始逐章清洗` +
        (refSummary?.epub_count ? `；对照原文已导入到 ${refSummary.reference_dir}` : ""),
    },
  });
  await runAllTasks();
  // 汇入 MiMo 建议到裁决队列，人可在“裁决队列”页看图/看上下文裁决并一键应用低风险项。
  try {
    const ing = await api("/api/cleaning/ingest", "POST", {});
    toast(`已汇入 ${ing.item_count} 条清洗建议到裁决队列`);
    await loadQueue();
  } catch (err) {
    toast(err.message, true);
  }
}

function resetForRun() {
  state.tasks = [];
  state.selectedTask = null;
  state.lastOutput = null;
  state.activeBookpack = false;
  state.taskStatus = new Map();
  renderTasks();
  $("#asset-list").replaceChildren(el("div", "empty", "导入 EPUB 后显示图片"));
  renderOutput({ parsed: { suggestions: [], summary: "准备开始" } });
}

async function loadTasks() {
  const box = $("#task-list");
  if (!state.activeBookpack) {
    renderTasks();
    return;
  }
  box.replaceChildren(el("div", "empty", "加载中…"));
  try {
    const { index } = await api("/api/cleaning/mimo-tasks");
    state.tasks = index?.tasks || [];
    renderTasks();
  } catch (err) {
    box.replaceChildren(el("div", "empty", err.message));
  }
}

function renderTasks() {
  const box = $("#task-list");
  box.replaceChildren();
  $("#btn-run-selected").disabled = !state.selectedTask;
  if (!state.tasks.length) {
    box.appendChild(el("div", "empty", "暂无任务包"));
    return;
  }
  for (const task of state.tasks) {
    const status = state.taskStatus.get(task.file) || "pending";
    const row = el("button", `task-row${state.selectedTask?.file === task.file ? " active" : ""}`);
    row.type = "button";
    row.addEventListener("click", () => {
      state.selectedTask = task;
      renderTasks();
      renderOutput({ parsed: { suggestions: [], summary: `${task.chapter_id} · ${task.block_count} blocks · ${task.image_count} images` } });
    });
    const title = el("span", "task-title", task.chapter_id);
    const meta = el("span", "task-meta", `${task.block_count} blocks · ${task.image_count} images`);
    row.append(title, meta, el("span", `task-state ${status}`, statusLabel(status)));
    box.appendChild(row);
  }
}

function statusLabel(status) {
  return {
    pending: "等待",
    running: "运行中",
    done: "完成",
    error: "失败",
  }[status] || status;
}

async function runAllTasks() {
  if (!state.tasks.length) {
    setProgress(1, 1, "没有章节任务");
    return;
  }
  let done = 0;
  let failed = 0;
  for (const task of state.tasks) {
    state.selectedTask = task;
    state.taskStatus.set(task.file, "running");
    renderTasks();
    banner(`MiMo 正在清洗 ${task.chapter_id}…`, true);
    setProgress(done, state.tasks.length, `正在清洗 ${task.chapter_id}`);
    try {
      const r = await api("/api/cleaning/run-mimo", "POST", { task_file: task.file });
      state.taskStatus.set(task.file, "done");
      state.lastOutput = r.output;
      renderOutput(r.output);
      done += 1;
      setProgress(done, state.tasks.length, `已完成 ${done}/${state.tasks.length}`);
      renderTasks();
    } catch (err) {
      state.taskStatus.set(task.file, "error");
      failed += 1;
      renderTasks();
      renderOutput({ parsed: { suggestions: [], summary: `${task.chapter_id} 失败：${err.message}` }, error: err.message });
      setProgress(done, state.tasks.length, `${task.chapter_id} 失败，继续下一章`);
    }
  }
  banner("");
  toast(failed ? `自动清洗完成：${done}/${state.tasks.length} 章，失败 ${failed} 章` : `自动清洗完成：${done}/${state.tasks.length} 章`, failed > 0);
}

async function runSelectedTask() {
  if (!state.selectedTask) return;
  const task = state.selectedTask;
  state.taskStatus.set(task.file, "running");
  renderTasks();
  banner(`MiMo 正在处理 ${task.chapter_id}…`, true);
  try {
    const r = await api("/api/cleaning/run-mimo", "POST", { task_file: task.file });
    state.taskStatus.set(task.file, "done");
    toast(`MiMo 返回 ${r.suggestion_count} 条建议`);
    state.lastOutput = r.output;
    renderOutput(r.output);
  } catch (err) {
    state.taskStatus.set(task.file, "error");
    throw err;
  } finally {
    banner("");
    renderTasks();
  }
}

function renderOutput(output) {
  const suggestions = output?.parsed?.suggestions || [];
  const sugBox = $("#tab-suggestions");
  const rawBox = $("#tab-raw");
  sugBox.replaceChildren();
  rawBox.replaceChildren();

  if (!suggestions.length) {
    sugBox.appendChild(el("div", "empty", output?.parsed?.summary || "暂无清洗建议"));
  } else {
    for (const s of suggestions) sugBox.appendChild(suggestionCard(s));
  }
  const pre = el("pre", "raw-json");
  pre.textContent = JSON.stringify(output || {}, null, 2);
  rawBox.appendChild(pre);
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

function fmtPct(v) {
  return v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;
}

async function loadUsage() {
  const body = $("#tab-usage");
  if (!state.activeBookpack) {
    body.replaceChildren(el("div", "empty", "导入 EPUB 后显示本轮用量"));
    return;
  }
  body.replaceChildren(el("div", "empty", "加载中…"));
  try {
    const usage = await api("/api/usage");
    renderUsage(body, usage);
  } catch (err) {
    body.replaceChildren(el("div", "empty", err.message));
  }
}

function renderUsage(body, usage) {
  body.replaceChildren();
  const total = usage.total || {};
  body.appendChild(usageSummary(total));
  body.appendChild(usageStagePanel(usage.stages || [], total));
  body.appendChild(usageModelPanel(usage.buckets || []));
}

function usageSummary(u) {
  const card = el("div", "usage-summary");
  card.append(
    usageMetric("调用", fmtNum(u.calls)),
    usageMetric("总量", fmtNum(u.total_tokens)),
    usageMetric("输入", fmtNum(u.prompt_tokens)),
    usageMetric("缓存率", fmtPct(u.prompt_cache_hit_ratio)),
    usageMetric("命中", fmtNum(u.prompt_cache_hit_tokens)),
    usageMetric("未命中", fmtNum(u.prompt_cache_miss_tokens)),
    usageMetric("输出", fmtNum(u.completion_tokens)),
    usageMetric("推理", fmtNum(u.reasoning_tokens)),
    usageMetric("图片", fmtNum(u.image_tokens)),
  );
  return card;
}

function usageMetric(label, value) {
  const box = el("div", "usage-metric");
  box.append(el("span", "usage-label", label), el("strong", null, value));
  return box;
}

function usageStagePanel(stages, total) {
  const panel = el("div", "usage-panel");
  panel.appendChild(el("h3", null, "阶段总览"));
  if (!stages.length) {
    panel.appendChild(el("div", "empty compact", "暂无阶段用量"));
    return panel;
  }
  const max = Math.max(...stages.map((s) => Number(s.total_tokens || 0)), 1);
  for (const s of stages) panel.appendChild(usageStageCard(s, max, total));
  return panel;
}

function usageStageCard(b, max, total) {
  const card = el("div", `usage-stage source-${b.source || "all"}`);
  const head = el("div", "usage-stage-head");
  head.append(el("strong", null, `${b.label} · ${fmtNum(b.calls)} 次`), el("span", null, fmtNum(b.total_tokens)));
  card.appendChild(head);
  card.appendChild(usageBar(Number(b.total_tokens || 0), max, "total"));
  card.appendChild(usageCacheStack(b));
  const share = total?.total_tokens ? Number(b.total_tokens || 0) / Number(total.total_tokens) : null;
  card.appendChild(
    el(
      "div",
      "usage-line",
      `占比 ${fmtPct(share)} · 输入 ${fmtNum(b.prompt_tokens)} · 输出 ${fmtNum(b.completion_tokens)} · 推理 ${fmtNum(b.reasoning_tokens)} · 图片 ${fmtNum(b.image_tokens)}`,
    ),
  );
  return card;
}

function usageModelPanel(buckets) {
  const panel = el("div", "usage-panel");
  panel.appendChild(el("h3", null, "模型拆分"));
  if (!buckets.length) {
    panel.appendChild(el("div", "empty compact", "暂无模型用量"));
    return panel;
  }
  for (const b of buckets) panel.appendChild(usageBucket(b));
  return panel;
}

function usageBucket(b) {
  const card = el("div", "usage-bucket");
  card.appendChild(el("div", "usage-bucket-title", `${b.label} · ${b.calls} 次`));
  card.appendChild(usageCacheStack(b));
  card.appendChild(
    el(
      "div",
      "usage-line",
      `总量 ${fmtNum(b.total_tokens)} · 输入 ${fmtNum(b.prompt_tokens)} · 缓存率 ${fmtPct(b.prompt_cache_hit_ratio)}`,
    ),
  );
  card.appendChild(
    el(
      "div",
      "usage-line",
      `输出 ${fmtNum(b.completion_tokens)} / 可见输出 ${fmtNum(b.visible_output_tokens)} / 推理 ${fmtNum(b.reasoning_tokens)} / 图片 ${fmtNum(b.image_tokens)}`,
    ),
  );
  return card;
}

function usageBar(value, max, kind) {
  const track = el("div", `usage-bar ${kind || ""}`);
  const fill = el("div", "usage-bar-fill");
  fill.style.width = `${Math.max(2, Math.min(100, (Number(value || 0) / Math.max(1, Number(max || 1))) * 100))}%`;
  track.appendChild(fill);
  return track;
}

function usageCacheStack(u) {
  const prompt = Number(u.prompt_tokens || 0);
  const hit = Number(u.prompt_cache_hit_tokens || 0);
  const miss = Number(u.prompt_cache_miss_tokens || 0);
  const uncategorized = Math.max(0, Number(u.prompt_uncategorized_tokens || 0));
  const wrap = el("div", "usage-cache");
  const track = el("div", "usage-cache-track");
  const addSeg = (cls, value, label) => {
    if (!prompt || value <= 0) return;
    const seg = el("span", cls);
    seg.style.width = `${Math.max(1, (value / prompt) * 100)}%`;
    seg.title = `${label} ${fmtNum(value)}`;
    track.appendChild(seg);
  };
  addSeg("hit", hit, "缓存命中");
  addSeg("miss", miss, "缓存未命中");
  addSeg("uncat", uncategorized, "未分类输入");
  wrap.appendChild(track);
  wrap.appendChild(el("div", "usage-line", `命中 ${fmtNum(hit)} / 未命中 ${fmtNum(miss)} / 未分类 ${fmtNum(uncategorized)}`));
  return wrap;
}

function suggestionCard(s) {
  const card = el("div", "suggestion");
  const head = el("div", "suggestion-head");
  head.append(
    el("span", "m-type", s.type || "suggestion"),
    el("span", "m-title", s.target || s.id || "未命名目标"),
    el("span", `risk ${s.risk || "medium"}`, s.risk || "medium"),
  );
  card.appendChild(head);
  card.appendChild(el("div", "m-desc", s.reason || ""));
  const meta = el("div", "m-span", `confidence=${s.confidence ?? "—"}`);
  card.appendChild(meta);
  if (s.patch && Object.keys(s.patch).length) {
    const detail = el("pre", "m-detail");
    detail.textContent = JSON.stringify(s.patch, null, 2);
    card.appendChild(detail);
  }
  return card;
}

async function loadAssets() {
  const list = $("#asset-list");
  if (!state.activeBookpack) {
    list.replaceChildren(el("div", "empty", "导入 EPUB 后显示图片"));
    return;
  }
  list.replaceChildren(el("div", "empty", "加载中…"));
  try {
    const { assets } = await api("/api/cleaning/assets");
    list.replaceChildren();
    if (!assets.length) {
      list.appendChild(el("div", "empty", "暂无图片"));
      return;
    }
    for (const asset of assets) list.appendChild(assetCard(asset));
  } catch (err) {
    list.replaceChildren(el("div", "empty", err.message));
  }
}

function assetCard(a) {
  const card = el("div", "clean-asset");
  if (a.path) {
    const img = el("img");
    img.src = a.url;
    img.alt = a.id;
    card.appendChild(img);
  }
  const body = el("div", "clean-asset-body");
  body.appendChild(el("div", "block-id", `${a.id} · ${a.anchor_block || "—"}`));
  const input = el("input");
  input.type = "text";
  input.value = a.alt || "";
  input.placeholder = "alt";
  const row = el("div", "row");
  const ai = el("button", null, "MiMo 识别");
  const save = el("button", "primary", "保存");
  const note = el("span", "hint");
  ai.addEventListener("click", async () => {
    ai.disabled = true;
    ai.textContent = "识别中…";
    try {
      const r = await api("/api/cleaning/annotate", "POST", {
        asset_id: a.id,
        roster: $("#roster").value.trim(),
      });
      input.value = r.alt || input.value;
      note.textContent = r.description || "";
      toast(`识别完成：${r.model || "vision"}`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      ai.disabled = false;
      ai.textContent = "MiMo 识别";
    }
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api("/api/cleaning/set-alt", "POST", { asset_id: a.id, alt: input.value.trim() });
      toast("已写回 Markdown 并重解析");
      await loadAssets();
    } catch (err) {
      toast(err.message, true);
    } finally {
      save.disabled = false;
    }
  });
  row.append(ai, save);
  body.append(input, row, note);
  card.appendChild(body);
  return card;
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === btn));
      $("#tab-queue").hidden = btn.dataset.tab !== "queue";
      $("#tab-suggestions").hidden = btn.dataset.tab !== "suggestions";
      $("#tab-raw").hidden = btn.dataset.tab !== "raw";
      $("#tab-usage").hidden = btn.dataset.tab !== "usage";
      if (btn.dataset.tab === "usage") loadUsage();
      if (btn.dataset.tab === "queue") loadQueue();
    });
  });
}

// ---- 裁决队列 + 收口 ----
async function loadQueue() {
  const box = $("#tab-queue");
  box.replaceChildren();
  if (!state.activeBookpack) {
    box.appendChild(el("div", "empty", "导入 EPUB 后可裁决清洗建议"));
    return;
  }

  // 工具条
  const bar = el("div", "queue-bar");
  const mk = (label, cls, fn) => {
    const b = el("button", cls, label);
    b.addEventListener("click", () => fn(b));
    return b;
  };
  bar.append(
    mk("规范化", null, wrap(async () => { const r = await api("/api/cleaning/normalize", "POST", {}); toast(`规范化 ${r.total_edits} 处`); await loadQueue(); await loadAssets(); })),
    mk("取入建议", null, wrap(async () => { const r = await api("/api/cleaning/ingest", "POST", {}); toast(`取入 ${r.item_count} 条（新增 ${r.new_count}）`); await loadQueue(); })),
    mk("应用全部低风险", "primary", wrap(async () => { const r = await api("/api/cleaning/items/apply", "POST", { all_low: true }); toast(`应用 ${r.applied.length}，跳过 ${r.skipped.length}`); await loadQueue(); await loadAssets(); })),
    mk("刷新", null, wrap(loadQueue)),
  );
  box.appendChild(bar);

  // 收口
  box.appendChild(await readinessCard());

  // 建议列表（未裁决在前）
  const { items } = await api("/api/cleaning/items");
  const order = { open: 0, accepted: 1, applied: 2, rejected: 3 };
  items.sort((a, b) => (order[a.status] - order[b.status]) || (a.chapter_id > b.chapter_id ? 1 : -1));
  const list = el("div", "queue-list");
  if (!items.length) list.appendChild(el("div", "empty", "暂无清洗建议（先自动清洗或点“取入建议”）"));
  for (const it of items) list.appendChild(queueItem(it));
  box.appendChild(list);

  // 变更历史（可回滚）
  box.appendChild(await changesCard());
}

function wrap(fn) {
  return async (btn) => {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
  };
}

async function readinessCard() {
  const card = el("div", "readiness");
  try {
    const r = await api("/api/cleaning/readiness");
    card.appendChild(el("div", `readiness-head ${r.ready ? "ok" : "block"}`, r.ready ? "✓ 清洗数据已就绪，可 compile" : "✗ 清洗未就绪"));
    for (const c of r.checks) {
      const mark = c.ok ? "✓" : c.blocking ? "✗" : "!";
      card.appendChild(el("div", `readiness-line ${c.ok ? "ok" : c.blocking ? "block" : "warn"}`, `${mark} ${c.detail}`));
    }
  } catch (err) {
    card.appendChild(el("div", "empty", err.message));
  }
  return card;
}

function queueItem(it) {
  const card = el("div", `queue-item status-${it.status}`);
  const head = el("div", "suggestion-head");
  head.append(
    el("span", "m-type", it.type),
    el("span", "m-title", it.target),
    el("span", `risk ${it.risk}`, it.risk),
    el("span", "queue-status", it.status),
  );
  card.appendChild(head);
  card.appendChild(el("div", "m-desc", it.reason || ""));
  if (it.block_preview) card.appendChild(el("div", "m-span", `${it.block_preview.kind}: ${it.block_preview.text}`));

  let altInput = null;
  if (it.asset) {
    const wrapImg = el("div", "queue-img");
    if (it.asset.url) { const img = el("img"); img.src = it.asset.url; img.alt = it.target; wrapImg.appendChild(img); }
    card.appendChild(wrapImg);
    if (it.type === "set_asset_alt") {
      altInput = el("input");
      altInput.type = "text";
      altInput.value = (it.patch && it.patch.alt) || it.asset.alt || "";
      card.appendChild(altInput);
    }
  } else if (it.patch && Object.keys(it.patch).length) {
    const pre = el("pre", "m-detail");
    pre.textContent = JSON.stringify(it.patch, null, 2);
    card.appendChild(pre);
  }

  const row = el("div", "row");
  const apply = el("button", "primary", "应用");
  apply.addEventListener("click", wrap(async () => {
    if (altInput) await api("/api/cleaning/items/resolve", "POST", { ids: [it.id], decision: "accept", patch: { alt: altInput.value.trim() } });
    const r = await api("/api/cleaning/items/apply", "POST", { ids: [it.id] });
    if (r.applied.length) toast("已应用并写回"); else toast(r.skipped?.[0]?.reason || "未应用", true);
    await loadQueue(); await loadAssets();
  }));
  const reject = el("button", null, "拒绝");
  reject.addEventListener("click", wrap(async () => { await api("/api/cleaning/items/resolve", "POST", { ids: [it.id], decision: "reject" }); toast("已拒绝"); await loadQueue(); }));
  row.append(apply, reject);
  card.appendChild(row);
  return card;
}

async function changesCard() {
  const card = el("div", "changes-card");
  card.appendChild(el("h3", null, "变更历史"));
  try {
    const { changes } = await api("/api/cleaning/changes");
    if (!changes.length) { card.appendChild(el("div", "empty", "暂无清洗变更")); return card; }
    for (const c of changes) {
      const row = el("div", `change-row ${c.status}`);
      row.appendChild(el("span", "change-sum", `${c.id} · ${c.op} · ${c.volume_id} · ${c.summary}`));
      if (c.status === "applied") {
        const rb = el("button", null, "回滚");
        rb.addEventListener("click", wrap(async () => { const r = await api("/api/cleaning/rollback", "POST", { change_id: c.id }); toast(`已回滚 ${r.rolled_back.join(",")}`); await loadQueue(); await loadAssets(); }));
        row.appendChild(rb);
      } else {
        row.appendChild(el("span", "change-sum", "已回滚"));
      }
      card.appendChild(row);
    }
  } catch (err) {
    card.appendChild(el("div", "empty", err.message));
  }
  return card;
}

function bind() {
  $("#btn-auto-clean").addEventListener("click", () => autoClean().catch((err) => { banner(""); toast(err.message, true); }));
  $("#btn-reset").addEventListener("click", resetWorkspace);
  $("#btn-run-selected").addEventListener("click", () => runSelectedTask().catch((err) => { banner(""); toast(err.message, true); }));
  setupTabs();
}

async function init() {
  bind();
  resetWorkspace();
  await loadState();
}

init().catch((err) => toast(err.message, true));
