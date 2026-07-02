// 最低限度 Markdown 阅读器前端（原生 ESM，无构建步骤）。
//
// 核心机制：中文正文是唯一主轴。read_boundary（已读边界）是唯一防剧透边界，
// current_block（当前位置，由阅读标尺推算）只决定当前相关性。连续阅读推进
// read_boundary；跳读 / 目录跳转 / 大幅拖动不推进。右侧面板始终按 read_boundary
// 调 getVisibleContext()。
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  book: null,
  order: [], // block id, 全局阅读顺序
  indexOf: new Map(), // block id -> 全局序号
  blockEls: new Map(), // block id -> 中栏 DOM
  currentIndex: 0,
  boundaryIndex: 0,
  displayMode: "both", // both | zh | ja
  showSpeakers: true, // 中间栏左侧显示说话人标记
  suppressUntil: 0, // 程序化滚动窗口内不推进边界
  lastScrollTop: 0,
  lastScrollTime: 0,
};

// 滚动判定阈值：单次滚动位移超过近一屏，或速度过快，视为跳读 / 拖动，不推进边界。
const JUMP_DELTA_RATIO = 0.9;
const VELOCITY_MAX = 2.5; // px / ms

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path) {
  const resp = await fetch(path);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `请求失败 ${resp.status}`);
  return data;
}

// ---------- 初始化 ----------

async function init() {
  try {
    const book = await api("/api/book");
    state.book = book;
    state.order = book.order;
    book.order.forEach((id, i) => state.indexOf.set(id, i));
    $("#pack-status").textContent = `${book.pack_name}（${book.series.title}）`;
    if (!book.has_speakers) $(".speaker-toggle").style.display = "none";
    state.displayMode = book.has_ja ? "both" : "zh";
    document.body.dataset.mode = state.displayMode;
    document.body.classList.toggle("speakers-on", state.showSpeakers);
    renderProse(book.sections);
    renderToc(book.toc);
    bindEvents();
    updateDisplayControl();
    state.currentIndex = 0;
    state.boundaryIndex = 0;
    updateBlockStyles();
    updateBoundaryBar();
    await refreshPanel();
  } catch (err) {
    $("#pack-status").textContent = "加载失败";
    toast(err.message, true);
  }
}

// ---------- 渲染正文 ----------

function renderProse(sections) {
  const prose = $("#prose");
  prose.replaceChildren();
  for (const sec of sections) {
    if (sec.type === "volume") {
      prose.appendChild(el("div", "vol-title", sec.title));
    } else if (sec.type === "chapter") {
      const h = el("h2", `chap-title kind-${sec.kind}`, sec.title);
      h.id = `chap-${sec.id}`;
      prose.appendChild(h);
    } else if (sec.type === "block") {
      const beforeAssets = sec.assets.filter((a) => a.anchor_type === "before_block");
      const afterAssets = sec.assets.filter((a) => a.anchor_type !== "before_block");
      for (const a of beforeAssets) prose.appendChild(assetFigure(a));

      // 逐段交替双语：中文段落 + 紧随其后的日文段落，共属同一 block。
      const p = el("p", `blk zh ${sec.kind}`, sec.text);
      p.dataset.blockId = sec.id;
      p.dataset.index = String(sec.index);
      p.onclick = () => selectBlock(sec.index);

      // 说话人标记：放在正文左侧空白栏（纯文字），按 visible_from 与已读边界显隐。
      // 群体对话有多个标记就都列出，无标记不加。
      if (sec.speakers && sec.speakers.length) {
        const tag = el("span", "speaker-tag");
        tag.textContent = sec.speakers.map((s) => s.name).join("、");
        const vf = sec.speakers[0].visible_from;
        tag.dataset.vfIndex = String(state.indexOf.get(vf) ?? sec.index);
        p.appendChild(tag);
        p._speaker = tag;
      }
      prose.appendChild(p);
      state.blockEls.set(sec.id, p);

      if (sec.text_ja) {
        const ja = el("p", `blk ja ${sec.kind}`, sec.text_ja);
        ja.dataset.jaFor = sec.id;
        ja.onclick = () => selectBlock(sec.index);
        prose.appendChild(ja);
        p._ja = ja; // 同一 block 的日文段落，样式随中文段落同步
      }
      for (const a of afterAssets) prose.appendChild(assetFigure(a));
    }
  }
}

function assetFigure(a) {
  const fig = el("figure", "blk-asset");
  const img = el("img");
  img.src = a.url;
  img.alt = a.alt || "";
  img.loading = "lazy";
  fig.appendChild(img);
  if (a.alt) fig.appendChild(el("figcaption", null, a.alt));
  return fig;
}

function renderToc(toc) {
  const list = $("#toc-list");
  list.replaceChildren();
  const volumeTitles = new Map((state.book?.volumes || []).map((v) => [v.id, v.title]));
  const grouped = new Map();
  for (const ch of toc) {
    const arr = grouped.get(ch.volume_id) || [];
    arr.push(ch);
    grouped.set(ch.volume_id, arr);
  }
  for (const [volumeId, chapters] of grouped) {
    const details = document.createElement("details");
    details.className = "toc-volume";
    details.open = list.children.length === 0;
    const summary = document.createElement("summary");
    summary.append(
      el("span", "toc-volume-title", volumeTitles.get(volumeId) || volumeId),
      el("span", "toc-volume-meta", `${chapters.length} 章`),
    );
    details.appendChild(summary);
    const ul = document.createElement("ul");
    for (const ch of chapters) {
      const li = el("li", `kind-${ch.kind}`, ch.title);
      li.onclick = () => {
        jumpToChapter(ch.id);
      };
      ul.appendChild(li);
    }
    details.appendChild(ul);
    list.appendChild(details);
  }
}

// ---------- 阅读标尺：推算 current_block ----------

function scrollContainer() {
  return $("#reader-scroll");
}

/** 阅读标尺处（视口 38% 高度）落在哪个 block 上。 */
function blockAtRuler() {
  const cont = scrollContainer();
  const rect = cont.getBoundingClientRect();
  const rulerY = rect.top + rect.height * 0.38;
  let best = null;
  for (const [id, node] of state.blockEls) {
    const r = node.getBoundingClientRect();
    if (r.top <= rulerY) best = id;
    else break; // blockEls 按阅读顺序插入，越过标尺即可停
  }
  return best ?? state.order[0] ?? null;
}

function onScroll() {
  const cont = scrollContainer();
  const now = performance.now();
  const top = cont.scrollTop;
  const dt = Math.max(1, now - state.lastScrollTime);
  const delta = top - state.lastScrollTop;
  const velocity = Math.abs(delta) / dt;
  const isJump =
    now < state.suppressUntil ||
    Math.abs(delta) > cont.clientHeight * JUMP_DELTA_RATIO ||
    velocity > VELOCITY_MAX;
  state.lastScrollTop = top;
  state.lastScrollTime = now;

  const id = blockAtRuler();
  if (id == null) return;
  const idx = state.indexOf.get(id) ?? 0;

  // 连续、平稳地向前阅读时推进已读边界，当前位置随边界一起前移；
  // 跳读 / 拖动 / 目录跳转不推进、也不打扰当前选中的 block。
  if (!isJump && idx > state.boundaryIndex) {
    state.boundaryIndex = idx;
    state.currentIndex = idx;
    updateBoundaryBar();
    updateBlockStyles();
    updatePreviewFlag();
    schedulePanel();
  }
}

/** 鼠标点选一个 block 作为当前位置（越界只是预览，不推进已读边界）。 */
function selectBlock(idx) {
  state.currentIndex = idx;
  updateBlockStyles();
  updatePreviewFlag();
  refreshPanel();
}

// ---------- 边界 / 样式 ----------

function updateBlockStyles() {
  for (const [id, node] of state.blockEls) {
    const i = state.indexOf.get(id) ?? 0;
    const read = i <= state.boundaryIndex;
    const current = i === state.currentIndex;
    for (const n of node._ja ? [node, node._ja] : [node]) {
      n.classList.toggle("read", read);
      n.classList.toggle("beyond", !read);
      n.classList.toggle("current", current);
    }
    // 说话人标记：其 visible_from 到达已读边界后才显示（防剧透）。
    if (node._speaker) {
      const vfIdx = Number(node._speaker.dataset.vfIndex);
      node._speaker.classList.toggle("sp-visible", vfIdx <= state.boundaryIndex);
    }
  }
}

function updateBoundaryBar() {
  const id = state.order[state.boundaryIndex];
  $("#boundary-label").textContent = `已读边界：${id ?? "—"}`;
}

function updatePreviewFlag() {
  $("#preview-flag").hidden = state.currentIndex <= state.boundaryIndex;
}

// ---------- 右侧面板：getVisibleContext ----------

let panelTimer = null;
function schedulePanel() {
  clearTimeout(panelTimer);
  panelTimer = setTimeout(refreshPanel, 220);
}

async function refreshPanel() {
  const current = state.order[state.currentIndex];
  const boundary = state.order[state.boundaryIndex];
  if (!current || !boundary) return;
  try {
    const q = new URLSearchParams({
      current_block: current,
      read_boundary: boundary,
      ja: state.displayMode === "zh" ? "0" : "1",
    });
    const ctx = await api(`/api/context?${q}`);
    renderPanel(ctx);
  } catch (err) {
    $("#panel-body").replaceChildren(el("div", "empty", err.message));
  }
}

// 增强阅读区已清空为空白画布：右栏不再渲染 9 类 Accepted 平铺条目，
// 只保留当前位置标题、越界提示和取数管线（refreshPanel 仍拉 getVisibleContext，
// ctx 供后续重做增强 UI 使用）。等信息架构定稿后在此基础上重建。
function renderPanel(ctx) {
  $("#panel-title").textContent = "增强信息（重建中）";
  $("#panel-sub").textContent = ctx.is_ahead_of_boundary
    ? `当前 ${state.order[state.currentIndex]} · 越过已读边界`
    : `当前 ${state.order[state.currentIndex]}`;

  const body = $("#panel-body");
  body.replaceChildren();
  body.appendChild(
    el("div", "empty", "增强阅读区待重建：右栏信息显示已清空，将在数据包基础上重新设计。"),
  );
}

// ---------- 跳转 / 操作 ----------

function jumpToBlock(idx) {
  const node = state.blockEls.get(state.order[idx]);
  if (!node) return;
  // 程序化跳转：开一个抑制窗口，落地滚动不推进已读边界。
  state.suppressUntil = performance.now() + 900;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
}

function jumpToChapter(chapterId) {
  const heading = document.getElementById(`chap-${chapterId}`);
  if (!heading) return;
  state.suppressUntil = performance.now() + 900;
  heading.scrollIntoView({ behavior: "smooth", block: "start" });
}

function markReadHere() {
  if (state.currentIndex > state.boundaryIndex) {
    state.boundaryIndex = state.currentIndex;
    updateBoundaryBar();
    updateBlockStyles();
    updatePreviewFlag();
    refreshPanel();
    toast(`已读边界推进到 ${state.order[state.boundaryIndex]}`);
  } else {
    toast("当前位置未越过已读边界，无需推进。");
  }
}

function returnToBoundary() {
  jumpToBlock(state.boundaryIndex);
  selectBlock(state.boundaryIndex);
  toast("回到已读边界附近");
}

function setDisplayMode(mode) {
  if (!state.book?.has_ja && mode !== "zh") {
    toast("当前数据包还没有原文对照。");
    mode = "zh";
  }
  state.displayMode = mode;
  document.body.dataset.mode = mode; // CSS 按 mode 控制中/日段落显隐
  updateDisplayControl();
  refreshPanel();
}

function updateDisplayControl() {
  const hasRef = !!state.book?.has_ja;
  $("#ref-status").textContent = hasRef ? "" : "未匹配原文";
  for (const btn of document.querySelectorAll("#disp-mode button")) {
    const mode = btn.dataset.mode;
    btn.classList.toggle("active", mode === state.displayMode);
    btn.disabled = !hasRef && mode !== "zh";
  }
}

// ---------- 事件绑定 ----------

function bindEvents() {
  const cont = scrollContainer();
  let raf = null;
  cont.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      onScroll();
    });
  });
  $("#btn-toc").onclick = () => $(".layout").classList.toggle("toc-open");
  $("#btn-mark").onclick = markReadHere;
  $("#btn-return").onclick = returnToBoundary;
  for (const btn of document.querySelectorAll("#disp-mode button")) {
    btn.onclick = () => setDisplayMode(btn.dataset.mode);
  }
  $("#chk-speaker").onchange = (e) => {
    state.showSpeakers = e.target.checked;
    document.body.classList.toggle("speakers-on", state.showSpeakers);
  };
}

init();
