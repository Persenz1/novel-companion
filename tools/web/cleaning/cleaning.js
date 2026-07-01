// 清洗·图片标注前端（原生 ESM，无构建）。
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };

async function api(path, method = "GET", body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  const resp = await fetch(path, opt);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `请求失败 ${resp.status}`);
  return data;
}

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = isErr ? "err" : ""; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = "none"), 3000);
}

async function load() {
  const list = $("#list");
  list.replaceChildren(el("p", "hint", "加载中…"));
  try {
    const { assets } = await api("/api/cleaning/assets");
    list.replaceChildren();
    if (!assets.length) { list.appendChild(el("p", "hint", "这个 bookpack 没有图片资产。")); return; }
    for (const a of assets) list.appendChild(card(a));
  } catch (err) {
    list.replaceChildren(el("p", "hint", err.message));
  }
}

function card(a) {
  const c = el("div", "card");
  const left = el("div");
  if (a.path) { const img = el("img"); img.src = a.url; img.alt = a.id; left.appendChild(img); }
  else left.appendChild(el("div", "meta", "（无图片文件）"));
  c.appendChild(left);

  const right = el("div");
  const meta = el("div", "meta");
  meta.innerHTML = `<b>${a.id}</b> · 卷 ${a.volume} · 锚点 ${a.anchor_block || "—"}`;
  right.appendChild(meta);

  right.appendChild(el("label", null, "alt（图注 — 会写回 Markdown）"));
  const alt = el("input", "alt"); alt.value = a.alt || ""; right.appendChild(alt);

  const desc = el("div", "desc"); desc.hidden = true; right.appendChild(desc);

  const row = el("div", "row");
  const btnAI = el("button", null, "MiMo 识别");
  const btnSave = el("button", "primary", "确认保存");
  const status = el("span", "tag");
  btnAI.addEventListener("click", async () => {
    btnAI.disabled = true; btnAI.textContent = "识别中…";
    try {
      const roster = $("#roster").value.trim();
      const r = await api("/api/cleaning/annotate", "POST", { asset_id: a.id, roster });
      alt.value = r.alt || alt.value;
      desc.textContent = r.description || ""; desc.hidden = !r.description;
      $("#model").textContent = r.model ? `vision: ${r.model}` : "";
      status.textContent = "已识别，待确认"; status.className = "tag";
    } catch (err) { toast(err.message, true); }
    finally { btnAI.disabled = false; btnAI.textContent = "MiMo 识别"; }
  });
  btnSave.addEventListener("click", async () => {
    btnSave.disabled = true;
    try {
      const r = await api("/api/cleaning/set-alt", "POST", { asset_id: a.id, alt: alt.value.trim() });
      if (r.asset) alt.value = r.asset.alt || "";
      status.textContent = "已保存并重解析"; status.className = "tag saved";
      toast("已写回 Markdown 并重解析");
    } catch (err) { toast(err.message, true); }
    finally { btnSave.disabled = false; }
  });
  row.append(btnAI, btnSave, status);
  right.appendChild(row);
  c.appendChild(right);
  return c;
}

load();
