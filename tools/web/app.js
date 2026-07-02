// 数据工作台前端（原生 ESM，无构建步骤）。界面用语中文。
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  bookpackOk: false,
  chapters: [],
  currentChapter: null,
  currentBlockId: null,
  busy: false,
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
  t.className = "toast" + (isErr ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3200);
}

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle("spin", on);
  refreshActionButtons();
}

// ---------- 初始化 ----------

async function init() {
  try {
    const s = await api("/api/state");
    fillConfig(s.config);
    state.bookpackOk = s.bookpack.ok;
    $("#pack-status").textContent = s.bookpack.ok
      ? `数据包：${s.bookpack.pack_name}（${s.bookpack.series.title}）`
      : `未连接数据包：${s.bookpack.message || "请在设置里填写目录"}`;
    if (!s.bookpack.ok) $("#settings-panel").hidden = false;
    if (s.bookpack.ok) await loadChapters();
  } catch (err) {
    toast(err.message, true);
    $("#settings-panel").hidden = false;
  }
}

function fillConfig(cfg) {
  state.drafterModel = cfg.drafter.model || "起草模型";
  state.reviewerModel = cfg.reviewer.model || "复核模型";
  $("#cfg-bookpack").value = cfg.bookpack_dir || "";
  $("#cfg-drafter-url").value = cfg.drafter.base_url || "";
  $("#cfg-drafter-model").value = cfg.drafter.model || "";
  $("#cfg-drafter-key").placeholder = cfg.drafter.api_key_set ? "已配置（留空＝不修改）" : "api_key";
  $("#cfg-reviewer-url").value = cfg.reviewer.base_url || "";
  $("#cfg-reviewer-model").value = cfg.reviewer.model || "";
  $("#cfg-reviewer-key").placeholder = cfg.reviewer.api_key_set ? "已配置（留空＝不修改）" : "api_key";
  const vision = cfg.vision || {};
  $("#cfg-vision-url").value = vision.base_url || "";
  $("#cfg-vision-model").value = vision.model || "";
  $("#cfg-vision-key").placeholder = vision.api_key_set ? "已配置（留空＝不修改）" : "api_key";
}

async function saveConfig() {
  const body = {
    bookpack_dir: $("#cfg-bookpack").value.trim(),
    drafter: {
      base_url: $("#cfg-drafter-url").value.trim(),
      model: $("#cfg-drafter-model").value.trim(),
      api_key: $("#cfg-drafter-key").value,
    },
    reviewer: {
      base_url: $("#cfg-reviewer-url").value.trim(),
      model: $("#cfg-reviewer-model").value.trim(),
      api_key: $("#cfg-reviewer-key").value,
    },
    vision: {
      base_url: $("#cfg-vision-url").value.trim(),
      model: $("#cfg-vision-model").value.trim(),
      api_key: $("#cfg-vision-key").value,
    },
  };
  try {
    await api("/api/config", "POST", body);
    $("#cfg-drafter-key").value = "";
    $("#cfg-reviewer-key").value = "";
    $("#cfg-vision-key").value = "";
    toast("设置已保存");
    await init();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 左栏：章节 ----------

async function loadChapters() {
  const { chapters } = await api("/api/chapters");
  state.chapters = chapters;
  const list = $("#chapter-list");
  list.replaceChildren();
  let lastVolume = null;
  for (const ch of chapters) {
    if (ch.volume_id !== lastVolume) {
      list.appendChild(el("li", "vol-sep", ch.volume_title)).style.cssText =
        "background:transparent;border:none;color:var(--muted);cursor:default;font-size:12px;padding:4px 2px;";
      lastVolume = ch.volume_id;
    }
    const li = el("li");
    li.dataset.id = ch.id;
    if (ch.id === state.currentChapter) li.classList.add("active");
    li.appendChild(el("div", "ch-title", ch.title));
    const meta = el("div", "ch-meta");
    meta.appendChild(el("span", null, `${ch.block_count} 段`));
    if (ch.accepted_count) meta.appendChild(el("span", null, `已确认 ${ch.accepted_count}`));
    if (ch.candidate_count) meta.appendChild(el("span", null, `候选 ${ch.candidate_count}`));
    if (ch.exception_count) meta.appendChild(el("span", null, `异常 ${ch.exception_count}`));
    li.appendChild(meta);
    li.addEventListener("click", () => selectChapter(ch.id));
    list.appendChild(li);
  }
}

async function selectChapter(chapterId) {
  state.currentChapter = chapterId;
  state.currentBlockId = null;
  document.querySelectorAll("#chapter-list li").forEach((li) =>
    li.classList.toggle("active", li.dataset.id === chapterId),
  );
  const ch = state.chapters.find((c) => c.id === chapterId);
  $("#mid-title").textContent = ch ? ch.title : chapterId;
  refreshActionButtons();
  await loadBlocks(chapterId);
  renderMarkers([]);
}

function refreshActionButtons() {
  const ready = state.bookpackOk && state.currentChapter && !state.busy;
  $("#btn-draft").disabled = !ready;
  $("#btn-review").disabled = !ready;
}

// ---------- 中栏：逐 block ----------

async function loadBlocks(chapterId) {
  const { blocks } = await api(`/api/chapters/${encodeURIComponent(chapterId)}/blocks`);
  const wrap = $("#blocks");
  wrap.replaceChildren();
  if (blocks.length === 0) {
    wrap.appendChild(el("div", "empty", "本章没有 block"));
    return;
  }
  for (const b of blocks) {
    const node = el("div", "block");
    node.dataset.id = b.id;
    const head = el("div", "block-head");
    head.appendChild(el("span", "block-id", b.id));
    head.appendChild(el("span", "kind " + b.kind, kindLabel(b.kind)));
    const badges = el("div", "badges");
    if (b.accepted_count) badges.appendChild(el("span", "badge acc", `确认 ${b.accepted_count}`));
    if (b.candidate_count) badges.appendChild(el("span", "badge cand", `候选 ${b.candidate_count}`));
    if (b.exception_count) badges.appendChild(el("span", "badge exc", `异常 ${b.exception_count}`));
    head.appendChild(badges);
    node.appendChild(head);
    node.appendChild(el("div", "block-text", b.text));
    node.addEventListener("click", () => selectBlock(b.id, node));
    wrap.appendChild(node);
  }
}

function kindLabel(kind) {
  return { paragraph: "叙述", dialogue: "对话", separator: "分隔", note: "注记" }[kind] || kind;
}

async function selectBlock(blockId, node) {
  state.currentBlockId = blockId;
  document.querySelectorAll(".block").forEach((b) => b.classList.toggle("active", b.dataset.id === blockId));
  switchTab("markers");
  const { markers, assets } = await api(`/api/blocks/${encodeURIComponent(blockId)}/markers`);
  renderMarkers(markers, blockId, assets);
}

// ---------- 右栏：标识 ----------

function renderMarkers(markers, blockId, assets = []) {
  const body = $("#tab-markers");
  body.replaceChildren();
  if (!blockId) {
    body.appendChild(el("div", "empty", "点击中间任意段落，查看它身上的标识"));
    return;
  }
  // 本段挂的图片：复核图片类必须看得见图
  if (assets.length) {
    const box = el("div", "asset-box");
    box.appendChild(el("p", "hint", `本段配图 ${assets.length} 张`));
    for (const a of assets) box.appendChild(imageBlock(a));
    body.appendChild(box);
  }
  body.appendChild(el("p", "hint", `${blockId} · 共 ${markers.length} 个标识`));
  if (markers.length === 0) {
    body.appendChild(el("div", "empty", "这一段还没有任何标识"));
    return;
  }
  for (const m of markers) body.appendChild(markerCard(m));
}

function imageBlock(a) {
  const wrap = el("div", "asset-img");
  const img = el("img");
  img.src = a.url;
  img.alt = a.alt || a.id;
  img.loading = "lazy";
  wrap.appendChild(img);
  if (a.alt) wrap.appendChild(el("div", "asset-alt", a.alt));
  return wrap;
}

// ---------- 起草 / 复核 ----------

// 处理中的状态反馈：跳动的计时器，让人区分"正在处理"和"卡住了"。
function startProgress(label, model) {
  const start = Date.now();
  const tick = () => {
    const sec = Math.round((Date.now() - start) / 1000);
    let txt = `⏳ ${label}（模型 ${model}）… 已用 ${sec}s`;
    if (sec >= 600) txt += " — 超过 10 分钟，若窗口很多属正常，可查终端日志确认仍在推进";
    else if (sec >= 60) txt += " — pass 会分窗/分批多次调用模型，整卷需要几分钟，属正常";
    else if (sec >= 30) txt += " — 大段文本较慢，仍在处理中";
    showBanner(txt, true);
  };
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

// v2：按「卷 + pass」运行；卷取当前选中章节所属卷（v01.c13 -> v01）。
function currentVolume() {
  return state.currentChapter ? state.currentChapter.split(".")[0] : null;
}

function currentPass() {
  return $("#pass-select").value;
}

async function doDraft() {
  const volumeId = currentVolume();
  if (!volumeId) return;
  const pass = currentPass();
  setBusy(true);
  const stop = startProgress(`起草中（${volumeId} · ${pass}，分窗多次调用）`, state.drafterModel);
  try {
    const r = await api("/api/draft", "POST", { volume_id: volumeId, pass });
    stop();
    let msg = `✅ 起草完成：${r.volume_id}/${r.pass} 共 ${r.windows} 窗，新增 ${r.created} 条候选（模型 ${r.model}）。`;
    if (r.pass === "speakers") msg += ` unknown ${r.speaker_unknown}，覆盖缺口 ${r.speaker_missing}。`;
    if (r.bad_lines) msg += ` 坏行 ${r.bad_lines}。`;
    showBanner(msg + "点「复核」让复核模型路由。");
    toast(`起草完成，新增 ${r.created} 条候选`);
    await loadBlocks(state.currentChapter);
    await loadChapters();
  } catch (err) {
    stop();
    showBanner(`❌ 起草失败：${err.message}`);
    toast(err.message, true);
  } finally {
    setBusy(false);
  }
}

async function doReview() {
  const volumeId = currentVolume();
  if (!volumeId) return;
  const pass = currentPass();
  setBusy(true);
  const stop = startProgress(`复核中（${volumeId} · ${pass}，分批多次调用）`, state.reviewerModel);
  try {
    const r = await api("/api/review", "POST", { volume_id: volumeId, pass });
    stop();
    showBanner(
      `✅ 复核完成（${r.reviewer_model}，${r.batches} 批）：自动落盘 ${r.auto_accepted}，升级 ${r.escalated}，拒绝 ${r.rejected}。` +
        (r.escalated ? "升级项见右侧「异常队列」。" : ""),
    );
    toast(`复核完成：自动 ${r.auto_accepted} / 升级 ${r.escalated} / 拒绝 ${r.rejected}`);
    await loadBlocks(state.currentChapter);
    await loadChapters();
    if (state.currentBlockId) {
      const { markers, assets } = await api(`/api/blocks/${encodeURIComponent(state.currentBlockId)}/markers`);
      renderMarkers(markers, state.currentBlockId, assets);
    }
  } catch (err) {
    stop();
    showBanner(`❌ 复核失败：${err.message}`);
    toast(err.message, true);
  } finally {
    setBusy(false);
  }
}

function showBanner(text, active = false) {
  const b = $("#run-banner");
  b.textContent = text;
  b.hidden = !text;
  b.classList.toggle("active", Boolean(text) && active);
}

// ---------- 用量 / 缓存 ----------

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

// ---------- 右栏：异常队列 ----------

const queueSelection = new Set();

async function loadQueue() {
  const body = $("#tab-queue");
  body.replaceChildren();
  body.appendChild(el("div", "empty", "加载中…"));
  try {
    const { items } = await api("/api/queue");
    queueSelection.clear();
    body.replaceChildren();

    // 工具条：批量裁决 + 重新编译（compile 落盘后阅读器右栏才刷新）。
    const bar = el("div", "queue-bar");
    const summary = el("span", "hint", items.length ? `${items.length} 项待人工裁决` : "没有待裁决的异常项");
    bar.appendChild(summary);
    const batchActs = el("div", "queue-batch");
    const selCount = el("span", "sel-count", "已选 0");
    const relTypes = new Set(items.filter((i) => i.candidate_type === "relation_change").map((i) => i.id));
    const refreshSel = () => {
      selCount.textContent = `已选 ${queueSelection.size}`;
      for (const b of batchActs.querySelectorAll("button[data-batch]")) b.disabled = queueSelection.size === 0;
      body.querySelectorAll("input.queue-check").forEach((cb) => (cb.checked = queueSelection.has(cb.value)));
    };
    const selectAll = mkBtn("全选", "tiny ghost", () => {
      items.forEach((i) => queueSelection.add(i.id));
      refreshSel();
    });
    const clearAll = mkBtn("全不选", "tiny ghost", () => {
      queueSelection.clear();
      refreshSel();
    });
    const selRel = mkBtn(`选关系变化(${relTypes.size})`, "tiny ghost", () => {
      relTypes.forEach((id) => queueSelection.add(id));
      refreshSel();
    });
    const mkBatch = (text, cls, decision) => {
      const b = mkBtn(text, cls, () => batchResolve(decision));
      b.dataset.batch = decision;
      b.disabled = true;
      return b;
    };
    batchActs.append(
      selCount,
      selectAll,
      clearAll,
      relTypes.size ? selRel : el("span"),
      mkBatch("批量接受", "tiny primary", "accept"),
      mkBatch("批量拒绝", "tiny", "reject"),
      mkBatch("批量转未决", "tiny", "open_question"),
    );
    bar.appendChild(batchActs);
    bar.appendChild(mkBtn("重新编译", "tiny", doCompile)); // validate + compile，刷新阅读器右栏
    body.appendChild(bar);

    for (const it of items) {
      const card = el("div", "marker");
      const head = el("div", "m-head");
      const check = el("input", "queue-check");
      check.type = "checkbox";
      check.value = it.id;
      check.addEventListener("change", () => {
        if (check.checked) queueSelection.add(it.id);
        else queueSelection.delete(it.id);
        refreshSel();
      });
      head.appendChild(check);
      head.appendChild(el("span", "m-type kind-exception", it.candidate_type || "升级项"));
      head.appendChild(el("span", "m-title", it.message || "需要裁决"));
      card.appendChild(head);
      card.appendChild(el("div", "m-span", `${it.block_id || ""}　建议：${it.recommended_action || "—"}`));
      if (it.asset) card.appendChild(imageBlock(it.asset)); // 图片复核：显示图本身
      const det = el("div", "m-detail", JSON.stringify(it, null, 2));
      det.hidden = true;
      const toggle = el("button", "tiny ghost", "展开详情");
      toggle.addEventListener("click", () => {
        det.hidden = !det.hidden;
        toggle.textContent = det.hidden ? "展开详情" : "收起";
      });
      const acts = el("div", "m-actions");
      acts.appendChild(mkBtn("接受", "tiny primary", () => resolve(it.id, "accept")));
      acts.appendChild(mkBtn("拒绝", "tiny", () => resolve(it.id, "reject")));
      acts.appendChild(mkBtn("转未决", "tiny", () => resolve(it.id, "open_question")));
      card.appendChild(toggle);
      card.appendChild(det);
      card.appendChild(acts);
      body.appendChild(card);
    }
  } catch (err) {
    body.replaceChildren(el("div", "empty", err.message));
  }
}

async function afterResolve() {
  await loadQueue();
  await loadChapters();
  if (state.currentChapter) await loadBlocks(state.currentChapter);
}

async function resolve(id, decision) {
  try {
    await api("/api/queue/resolve", "POST", { id, decision });
    toast(decision === "accept" ? "已接受并落盘" : decision === "reject" ? "已拒绝" : "已转未决问题");
    await afterResolve();
  } catch (err) {
    toast(err.message, true);
  }
}

async function batchResolve(decision) {
  const ids = [...queueSelection];
  if (ids.length === 0) return;
  const label = decision === "accept" ? "接受并落盘" : decision === "reject" ? "拒绝" : "转未决问题";
  if (!confirm(`批量${label} ${ids.length} 项？`)) return;
  try {
    const decisions = ids.map((id) => ({ id, decision }));
    const r = await api("/api/queue/resolve-batch", "POST", { decisions });
    toast(`批量完成：接受 ${r.accepted} / 拒绝 ${r.rejected} / 转未决 ${r.open_questions}`);
    await afterResolve();
  } catch (err) {
    toast(err.message, true);
  }
}

async function doCompile() {
  try {
    const r = await api("/api/compile", "POST");
    toast(`已重新编译：accepted ${r.accepted}，警告 ${r.warnings}`);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 右栏：审计 / 回滚 ----------

async function loadAudit() {
  const body = $("#tab-audit");
  body.replaceChildren();
  body.appendChild(el("div", "empty", "加载中…"));
  try {
    const { changes } = await api("/api/changes");
    body.replaceChildren();
    if (changes.length === 0) {
      body.appendChild(el("div", "empty", "还没有任何 Change"));
      return;
    }
    body.appendChild(el("p", "hint", `共 ${changes.length} 条 Change（倒序）`));
    for (const c of [...changes].reverse()) {
      const row = el("div", "change-row");
      const head = el("div", "cr-head");
      const who = c.decided_by === "reviewer_agent" ? "auto" : "user";
      head.appendChild(el("span", "tag " + who, c.auto_accepted ? "自动" : "人工"));
      head.appendChild(el("span", null, `${c.target_type} · ${c.target_id}`));
      const rev = mkBtn("回滚", "tiny danger", () => revert({ change_id: c.id }));
      rev.style.marginLeft = "auto";
      head.appendChild(rev);
      row.appendChild(head);
      row.appendChild(el("div", null, `${c.id}　${c.reviewer_model || c.approved_by || ""}　${(c.reason || "").slice(0, 40)}`));
      body.appendChild(row);
    }
  } catch (err) {
    body.replaceChildren(el("div", "empty", err.message));
  }
}

async function revert(payload) {
  if (!confirm("确认回滚？将删除对应 Accepted 对象与 Change。")) return;
  try {
    const r = await api("/api/revert", "POST", payload);
    toast(`已回滚 ${r.reverted.length} 条`);
    await loadAudit();
    await loadChapters();
    if (state.currentChapter) await loadBlocks(state.currentChapter);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 标签页 ----------

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#tab-markers").hidden = name !== "markers";
  $("#tab-queue").hidden = name !== "queue";
  $("#tab-audit").hidden = name !== "audit";
  $("#tab-usage").hidden = name !== "usage";
  if (name === "queue") loadQueue();
  if (name === "audit") loadAudit();
  if (name === "usage") loadUsage();
}

function mkBtn(text, cls, fn) {
  const b = el("button", cls, text);
  b.addEventListener("click", fn);
  return b;
}

// 标识卡片：自然语言描述常显，原始 JSON 收在次级按钮后。
function markerCard(m) {
  const card = el("div", "marker");
  const head = el("div", "m-head");
  head.appendChild(el("span", "m-type kind-" + m.kind, m.type_label));
  head.appendChild(el("span", "m-title", m.title));
  card.appendChild(head);
  if (m.description) card.appendChild(el("div", "m-desc", m.description));
  if (m.source_span)
    card.appendChild(el("div", "m-span", `来源 ${m.source_span.start_block} → ${m.source_span.end_block}`));
  const det = el("div", "m-detail", JSON.stringify(m.detail, null, 2));
  det.hidden = true;
  const toggle = el("button", "tiny ghost", "原始 JSON");
  toggle.addEventListener("click", () => {
    det.hidden = !det.hidden;
    toggle.textContent = det.hidden ? "原始 JSON" : "收起 JSON";
  });
  card.appendChild(toggle);
  card.appendChild(det);
  return card;
}

// ---------- 绑定 ----------

$("#btn-settings").addEventListener("click", () => {
  const p = $("#settings-panel");
  p.hidden = !p.hidden;
});
$("#btn-save-config").addEventListener("click", saveConfig);
$("#btn-draft").addEventListener("click", doDraft);
$("#btn-review").addEventListener("click", doReview);
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

init();
