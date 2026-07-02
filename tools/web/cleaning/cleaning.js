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
  setProgress(0, 0, "等待开始");
  renderTasks();
  $("#asset-list").replaceChildren(el("div", "empty", "导入 EPUB 后显示图片"));
  renderOutput({ parsed: { suggestions: [], summary: "导入 EPUB 后显示清洗建议" } });
}

async function autoClean() {
  const epubPaths = $("#epub-path").value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!epubPaths.length) throw new Error("请填写 EPUB 路径。");
  resetForRun();
  banner("正在导入 EPUB 并生成章节任务…", true);
  setProgress(0, epubPaths.length, `导入 EPUB 1/${epubPaths.length}`);
  const r = await api("/api/cleaning/auto-start", "POST", { epub_paths: epubPaths });
  const summary = r.import_summary || r.imported || {};
  state.activeBookpack = true;
  state.tasks = r.prepared?.tasks || [];
  state.tasks.forEach((task) => state.taskStatus.set(task.file, "pending"));
  banner("");
  toast(`导入完成：${summary.epub_count || 1} 本，${summary.chapter_count || 0} 章，${summary.block_count || 0} blocks，${summary.image_count || 0} 图`);
  await loadState();
  renderTasks();
  await loadAssets();
  renderOutput({
    parsed: {
      suggestions: [],
      summary: `validation=${summary.validation_status || r.imported?.validation?.status || "unknown"}，开始逐章清洗`,
    },
  });
  await runAllTasks();
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
  body.appendChild(usageSummary(usage.total));
  const buckets = el("div", "usage-buckets");
  for (const b of usage.buckets || []) buckets.appendChild(usageBucket(b));
  body.appendChild(buckets);
  const recent = el("div", "usage-recent");
  recent.appendChild(el("h3", null, "最近调用"));
  if (!usage.recent?.length) {
    recent.appendChild(el("div", "empty", "暂无模型用量记录"));
  } else {
    for (const r of usage.recent) recent.appendChild(usageRecentRow(r));
  }
  body.appendChild(recent);
}

function usageSummary(u) {
  const card = el("div", "usage-summary");
  card.append(
    usageMetric("调用", fmtNum(u.calls)),
    usageMetric("输入", fmtNum(u.prompt_tokens)),
    usageMetric("命中", fmtNum(u.prompt_cache_hit_tokens)),
    usageMetric("未命中", fmtNum(u.prompt_cache_miss_tokens)),
    usageMetric("输出", fmtNum(u.completion_tokens)),
    usageMetric("推理", fmtNum(u.reasoning_tokens)),
    usageMetric("缓存率", fmtPct(u.prompt_cache_hit_ratio)),
  );
  return card;
}

function usageMetric(label, value) {
  const box = el("div", "usage-metric");
  box.append(el("span", "usage-label", label), el("strong", null, value));
  return box;
}

function usageBucket(b) {
  const card = el("div", "usage-bucket");
  card.appendChild(el("div", "usage-bucket-title", `${b.label} · ${b.calls} 次`));
  card.appendChild(
    el(
      "div",
      "usage-line",
      `输入 ${fmtNum(b.prompt_tokens)} / 命中 ${fmtNum(b.prompt_cache_hit_tokens)} / 未命中 ${fmtNum(b.prompt_cache_miss_tokens)} / 缓存率 ${fmtPct(b.prompt_cache_hit_ratio)}`,
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

function usageRecentRow(r) {
  const row = el("div", "usage-row");
  row.appendChild(el("div", "usage-row-title", `${r.source} · ${r.stage} · ${r.chapter_id || r.file || ""}`));
  row.appendChild(
    el(
      "div",
      "usage-line",
      `输入 ${fmtNum(r.prompt_tokens)}（命中 ${fmtNum(r.prompt_cache_hit_tokens)} / 未命中 ${fmtNum(r.prompt_cache_miss_tokens)}） · 输出 ${fmtNum(r.completion_tokens)} · 推理 ${fmtNum(r.reasoning_tokens)} · 图片 ${fmtNum(r.image_tokens)} · 总计 ${fmtNum(r.total_tokens)}`,
    ),
  );
  return row;
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
      $("#tab-suggestions").hidden = btn.dataset.tab !== "suggestions";
      $("#tab-raw").hidden = btn.dataset.tab !== "raw";
      $("#tab-usage").hidden = btn.dataset.tab !== "usage";
      if (btn.dataset.tab === "usage") loadUsage();
    });
  });
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
