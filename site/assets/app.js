const NBOOKS = 4;
const FRONT_TITLES = new Set([
  "cover", "title page", "imprint", "general introduction", "table of contents",
]);

// Data files are cached normally and busted by the bundle's build stamp, so a
// regenerated book is picked up without costing a revalidation per request.
let BUILD = "";

async function loadJson(url, opts) {
  try {
    const u = BUILD && !url.includes("?") ? `${url}?v=${BUILD}` : url;
    const r = await fetch(u, opts);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/* Load all four volumes and merge them into one continuous book. */
async function loadMerged() {
  const vols = [];
  for (let b = 1; b <= NBOOKS; b++) {
    const bk = await loadJson(`data/book${b}/pages.json`);
    if (!bk) continue;
    const toc = await loadJson(`data/book${b}/toc.json`);
    const idx = await loadJson(`data/book${b}/index.json`);
    vols.push({ b, pages: bk.pages, toc: (toc && toc.sections) || [], idx: idx || [] });
  }
  let g = 0;
  const pages = [], sections = [], offsets = {};
  const termMap = new Map();
  for (const v of vols) {
    offsets[v.b] = g;
    sections.push({ title: `Volume ${v.b}`, gpage: g + 1, level: 0, b: v.b });
    for (const s of v.toc)
      sections.push({ title: s.title, level: s.level, gpage: g + s.page, b: v.b, vpage: s.page });
    for (const p of v.pages) pages.push(Object.assign({}, p, { b: v.b, gn: g + p.n }));
    for (const [t, ps] of v.idx) {
      if (!termMap.has(t)) termMap.set(t, []);
      termMap.get(t).push(...ps.map(p => g + p));
    }
    g += v.pages.length;
  }
  const index = [...termMap.entries()].sort((a, b2) => (a[0] < b2[0] ? -1 : 1));

  // Section titles that are unique content sections -> jump targets for printed contents lines
  const titleCount = new Map();
  for (const s of sections) {
    if (s.level < 1 || FRONT_TITLES.has(norm(s.title).replace(/ volumes? \d.*$/, ""))) continue;
    const k = norm(s.title);
    titleCount.set(k, (titleCount.get(k) || []).concat(s.gpage));
  }
  const linkMap = new Map();
  for (const [k, gps] of titleCount) if (gps.length === 1 && k.length >= 6) linkMap.set(k, gps[0]);

  return { pages, sections, index, offsets, linkMap, total: g };
}

function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + q.length + 60);
  let s = esc(text.slice(start, i)) + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" + esc(text.slice(i + q.length, end));
  if (start > 0) s = "…" + s;
  if (end < text.length) s += "…";
  return s;
}

function searchPages(pages, q) {
  const hits = [];
  for (const p of pages) {
    const text = p.lines.map(l => l.t).join(" ");
    if (text.toLowerCase().includes(q.toLowerCase())) {
      hits.push({ b: p.b, n: p.n, gn: p.gn, snip: snippet(text, q) });
    }
  }
  return hits;
}

/* ---------- home ---------- */

async function initHome() {
  const grid = document.getElementById("books");
  let offset = 0;
  const allPages = [];
  for (let b = 1; b <= NBOOKS; b++) {
    const bk = await loadJson(`data/book${b}/pages.json`);
    if (!bk) continue;
    const myOffset = offset;
    for (const p of bk.pages) allPages.push(Object.assign({}, p, { b, gn: myOffset + p.n }));
    const card = document.createElement("div");
    card.className = "bookcard";
    let secs = "";
    const toc = await loadJson(`data/book${b}/toc.json`);
    if (toc && toc.sections) {
      secs = toc.sections.filter(s => s.level === 1 && s.page >= 12)
        .map(s => `<a class="seclink" href="book.html?p=${myOffset + s.page}">${esc(s.title)}</a>`)
        .join("");
    }
    card.innerHTML = `<a href="book.html?p=${myOffset + 1}">
        <img src="data/book${b}/thumb/p000.jpg" loading="lazy">
        <div class="label">Volume ${b}<span>${bk.pages.length} pages</span></div></a>
      <div class="seclinks">${secs}</div>`;
    grid.appendChild(card);
    offset += bk.pages.length;
  }

  const input = document.getElementById("q");
  const results = document.getElementById("results");
  input.addEventListener("input", () => {
    const q = input.value.trim();
    results.innerHTML = "";
    if (q.length < 3) return;
    const all = searchPages(allPages, q);
    results.innerHTML = `<div class="rcount">${all.length} pages match</div>` +
      all.slice(0, 200).map(h =>
        `<a class="result" href="book.html?p=${h.gn}&q=${encodeURIComponent(q)}">
          <div class="where">Volume ${h.b} · page ${h.n}</div><div>${h.snip}</div></a>`
      ).join("");
  });
}

/* ---------- merged book viewer ---------- */

/* Fit each text block inside the rectangle it occupies in print, so blocks can
   never overlap: start at the measured print size, shrink only if it overflows. */
function fitPageText(pg) {
  const r = pg.getBoundingClientRect();
  if (!r.width) return;
  pg.querySelectorAll(".rt").forEach(el => {
    const size = parseFloat(el.dataset.size);
    if (!size) return;
    const px = size / 100 * r.width;
    el.style.fontSize = px.toFixed(2) + "px";
    const hPct = parseFloat(el.style.height);
    if (!hPct) return;
    const boxH = hPct / 100 * r.height;
    if (el.scrollHeight <= boxH + 1) return;
    let lo = px * 0.3, hi = px;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = mid.toFixed(2) + "px";
      if (el.scrollHeight <= boxH + 1) lo = mid; else hi = mid;
    }
    el.style.fontSize = lo.toFixed(2) + "px";
  });
}

/* Attach a page's scan only when it is close to the viewport. Every art element
   on the page reads it through a custom property, so one assignment serves them
   all, and the other 400-odd scans are never requested. */
function showScan(pg) {
  if (pg.dataset.scan && !pg.style.getPropertyValue("--scan")) {
    pg.style.setProperty("--scan", `url('${pg.dataset.scan}')`);
  }
}

const fitObserver = typeof IntersectionObserver !== "undefined"
  ? new IntersectionObserver(entries => {
      for (const en of entries) {
        if (en.isIntersecting) {
          showScan(en.target);
          fitPageText(en.target);
          fitObserver.unobserve(en.target);
        }
      }
    }, { rootMargin: "1200px" })
  : null;

/* A hand-authored recreation: live text over artwork windowed out of the scan. */
function renderRecreated(p, rec, q, sectionPages) {
  const div = document.createElement("div");
  div.className = "page rpage";
  div.id = `page-${p.gn}`;
  div.style.aspectRatio = `${p.w} / ${p.h}`;
  if (rec.bg) div.style.background = rec.bg;
  const scan = `data/book${p.b}/${p.scan}`;

  let html = "";
  for (const e of rec.el || []) {
    if (e.k === "art") {
      const bx = e.w >= 100 ? 0 : e.x / (100 - e.w) * 100;
      const by = e.h >= 100 ? 0 : e.y / (100 - e.h) * 100;
      // the scan itself is attached by the observer below, once the page is near
      // the viewport - naming it here would fetch all 432 scans up front
      html += `<div class="art" style="left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%;
        background-size:${(100 / e.w * 100).toFixed(2)}% ${(100 / e.h * 100).toFixed(2)}%;
        background-position:${bx.toFixed(2)}% ${by.toFixed(2)}%"></div>`;
    } else if (e.k === "txt") {
      const hl = q && e.text.toLowerCase().includes(q.toLowerCase()) ? " hl" : "";
      const target = e.link && sectionPages[e.link];
      const style = `left:${e.x}%;top:${e.y}%;` +
        (e.w ? `width:${e.w}%;` : "") +
        (e.h ? `height:${e.h}%;` : "") +
        (e.align && e.align !== "left" ? `text-align:${e.align};` : "") +
        (e.weight ? `font-weight:${e.weight === "bold" ? 700 : 400};` : "");
      const cls = `rt rt-${e.style || "body"}${hl}`;
      const data = `data-size="${e.size}"`;
      const inner = e.paras
        ? e.paras.map((t, i) => `<span class="para${i ? " ind" : ""}">${esc(t)}</span>`).join("")
        : esc(e.text || "");
      html += target && target !== p.gn
        ? `<a class="${cls} rlnk" ${data} data-p="${target}" style="${style}">${inner}</a>`
        : `<div class="${cls}" ${data} style="${style}">${inner}</div>`;
    }
  }
  div.dataset.scan = scan;
  div.innerHTML = html;
  div.addEventListener("click", ev => {
    const a = ev.target.closest("a.rlnk");
    if (a) { ev.preventDefault(); gotoPage(a.dataset.p); }
  });
  if (fitObserver) fitObserver.observe(div);
  else { showScan(div); setTimeout(() => fitPageText(div), 0); }
  return div;
}

function renderPage(p, q, linkMap) {
  const div = document.createElement("div");
  div.className = "page";
  div.id = `page-${p.gn}`;
  div.style.aspectRatio = `${p.w} / ${p.h}`;
  const pct = (v, total) => (v / total * 100).toFixed(3);

  let html = `<img class="scanimg" loading="lazy" decoding="async" src="data/book${p.b}/${p.scan}">`;
  const frontMatter = p.n <= 12;
  for (const l of p.lines) {
    const hl = q && l.t.toLowerCase().includes(q.toLowerCase()) ? " hl" : "";
    const ov = l.ov ? " ov" : "";
    let target = null;
    if (frontMatter && linkMap) {
      const t = linkMap.get(norm(l.t));
      if (t && t !== p.gn) target = t;
    }
    const style = `left:${pct(l.x, p.w)}%;top:${pct(l.y, p.h)}%`;
    if (target) {
      html += `<a class="tl lnk${hl}${ov}" data-r="${(l.fs / p.w).toFixed(5)}" data-go="${target}"
        style="${style}" title="Jump to this section">${esc(l.t)}</a>`;
    } else {
      html += `<div class="tl${hl}${ov}" data-r="${(l.fs / p.w).toFixed(5)}" style="${style}">${esc(l.t)}</div>`;
    }
  }
  div.innerHTML = html;
  return div;
}

function gotoPage(n) {
  const el = document.getElementById(`page-${n}`);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

/* HTML recreation of the combined-edition cover, with a clickable book map */
function renderCover(book) {
  const div = document.createElement("div");
  div.className = "cover";
  const colors = ["#333a8f", "#f59e2c", "#4d84c4", "#77713f"];
  const blocks = colors.map(c =>
    `<div class="cvrow"><div class="cvred"></div><div class="cvc" style="background:${c}"></div></div>`).join("");
  let list = "";
  for (const b of Object.keys(book.offsets)) {
    const subj = book.sections.filter(s => s.b == b && s.level === 1 && s.vpage >= 13);
    list += `<div class="cvbook">
      <div class="cvbklabel" data-p="${subj[0] ? subj[0].gpage : book.offsets[b] + 1}"><span>Book</span><b>${b}</b></div>
      <div class="cvsubjects">${subj.map(s => `<a data-p="${s.gpage}">${esc(s.title)}</a>`).join("")}</div>
    </div>`;
  }
  div.innerHTML = `
    <div class="cvleft">${blocks}</div>
    <div class="cvright">
      <div class="cvhead">The Foundation Program at the School of Design<br>Basel, Switzerland</div>
      <h2 class="cvtitle">Basic Principles<br>of Design</h2>
      <div class="cvauthor">Manfred Maier</div>
      <div class="cvlist">${list}</div>
    </div>`;
  div.addEventListener("click", e => {
    const t = e.target.closest("[data-p]");
    if (t) gotoPage(t.dataset.p);
  });
  return div;
}

const narrow = window.matchMedia("(max-width: 820px)");

async function initBook() {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  // one request, and its build stamp lets everything else cache
  const bundle = await loadJson("data/recreated/bundle.json", { cache: "no-cache" });
  if (bundle && bundle.built) BUILD = bundle.built;
  const book = await loadMerged();
  // legacy links: ?b=N&p=<page within volume>
  let startPage = parseInt(params.get("p") || "0");
  if (params.get("b") && book.offsets[parseInt(params.get("b"))] !== undefined) {
    startPage = book.offsets[parseInt(params.get("b"))] + (startPage || 1);
  }
  document.getElementById("booktitle").textContent = "Volumes 1–4";
  document.title = "Basic Principles of Design — Complete";

  /* Hand-authored page recreations, all in one bundle. */
  const sectionPages = {};
  for (const s of book.sections) if (s.level >= 1) sectionPages[s.title] = s.gpage;
  const recs = bundle ? bundle.pages : {};

  const main = document.getElementById("pages");
  main.appendChild(renderCover(book));
  const spacer = () => {
    const s = document.createElement("div");
    s.className = "pagespacer";
    return s;
  };
  let prevVol = null;
  for (const p of book.pages) {
    // page 1 of each volume is a recto, so it faces a blank: pad the volume at
    // both ends and every spread falls as the printed book does (…12|13…)
    if (p.b !== prevVol) {
      if (prevVol !== null) main.appendChild(spacer());
      main.appendChild(spacer());
      prevVol = p.b;
    }
    const rec = recs[`${p.b}:${p.n}`];
    if (rec) {
      // recreated transcription is cleaner than OCR: let it drive search too
      const txt = (rec.el || []).filter(e => e.k === "txt");
      if (txt.length) p.lines = txt.map(e => ({ t: e.text }));
      main.appendChild(renderRecreated(p, rec, q, sectionPages));
      const no = document.createElement("div");
      no.className = "pageno";
      no.textContent = `${p.gn} · Vol. ${p.b} p. ${p.n}`;
      main.appendChild(no);
      continue;
    }
    main.appendChild(renderPage(p, q, book.linkMap));
    const no = document.createElement("div");
    no.className = "pageno";
    no.textContent = `${p.gn} · Vol. ${p.b} p. ${p.n}`;
    main.appendChild(no);
  }
  main.addEventListener("click", e => {
    const a = e.target.closest("a.lnk");
    if (a) { e.preventDefault(); gotoPage(a.dataset.go); }
  });

  function applyFontSizes() {
    const pw = document.querySelector(".page").getBoundingClientRect().width;
    document.querySelectorAll(".tl").forEach(el => {
      el.style.fontSize = (parseFloat(el.dataset.r) * pw).toFixed(2) + "px";
    });
  }
  applyFontSizes();
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      applyFontSizes();
      document.querySelectorAll(".rpage").forEach(fitPageText);
    }, 150);
  });

  const pn = document.getElementById("pagenum");
  pn.max = book.total;
  pn.addEventListener("change", () => gotoPage(pn.value));

  /* ---- volume switcher ---- */
  const vs = document.getElementById("volswitch");
  if (vs) {
    vs.innerHTML = `<span>Vol.</span>` + Object.keys(book.offsets).map(b =>
      `<button data-b="${b}">${b}</button>`).join("");
    vs.querySelectorAll("button").forEach(btn =>
      btn.addEventListener("click", () => gotoPage(book.offsets[btn.dataset.b] + 1)));
  }

  /* ---- sidebar: contents ---- */
  const tocPane = document.getElementById("tab-toc");
  if (book.sections.length) {
    tocPane.innerHTML = book.sections.map((s, i) =>
      `<a class="toc-item l${s.level}" data-p="${s.gpage}" data-i="${i}">
        ${esc(s.title)}<span class="pg">${s.level === 0 ? "" : s.vpage}</span></a>`
    ).join("");
    tocPane.querySelectorAll(".toc-item").forEach(el =>
      el.addEventListener("click", () => gotoPage(el.dataset.p)));
  } else {
    tocPane.innerHTML = `<div class="toc-empty">No contents outline available.</div>`;
  }

  /* ---- sidebar: thumbnails (built on first open) ---- */
  const thumbsPane = document.getElementById("tab-thumbs");
  function buildThumbs() {
  let thtml = "";
  let lastB = 0;
  for (const p of book.pages) {
    if (p.b !== lastB) {
      if (lastB) thtml += `</div>`;
      thtml += `<div class="thumbvol">Volume ${p.b}</div><div class="thumbgrid">`;
      lastB = p.b;
    }
    thtml += `<div class="thumb" data-p="${p.gn}" id="th-${p.gn}">
      <img loading="lazy" src="data/book${p.b}/thumb/p${String(p.n - 1).padStart(3, "0")}.jpg">
      <div class="tn">${p.n}</div></div>`;
  }
  if (lastB) thtml += `</div>`;
  thumbsPane.innerHTML = thtml;
  thumbsPane.querySelectorAll(".thumb").forEach(el =>
    el.addEventListener("click", () => gotoPage(el.dataset.p)));
  document.getElementById(`th-${curPage}`)?.classList.add("cur");
  }

  /* ---- sidebar: index (built on first open) ---- */
  const idxPane = document.getElementById("tab-idx");
  function buildIndex() {
  if (book.index.length) {
    const gToLabel = g => {
      let b = 1;
      for (const [bb, off] of Object.entries(book.offsets)) if (g > off) b = parseInt(bb);
      return `${b}·${g - book.offsets[b]}`;
    };
    const byLetter = {};
    for (const [term, pgs] of book.index) (byLetter[term[0].toUpperCase()] ??= []).push([term, pgs]);
    const letters = Object.keys(byLetter).sort();
    let html = `<div class="letternav">` +
      letters.map(L => `<a href="#idx-${L}">${L}</a>`).join("") + `</div>`;
    for (const L of letters) {
      html += `<div class="idx-letter" id="idx-${L}">${L}</div>`;
      for (const [term, pgs] of byLetter[L]) {
        html += `<div class="idx-term">${esc(term)}
          <span class="pgs">${pgs.map(p => `<a data-p="${p}" title="Volume ${gToLabel(p).split("·")[0]}, page ${gToLabel(p).split("·")[1]}">${gToLabel(p)}</a>`).join("")}</span></div>`;
      }
    }
    idxPane.innerHTML = html;
    idxPane.querySelectorAll(".pgs a").forEach(el =>
      el.addEventListener("click", () => gotoPage(el.dataset.p)));
  }
  }

  /* ---- tabs / sidebar toggle ---- */
  const builders = { thumbs: buildThumbs, idx: buildIndex };
  document.querySelectorAll(".tabs button").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      const build = builders[btn.dataset.tab];
      if (build) { build(); delete builders[btn.dataset.tab]; }
    }));
  // on a phone the sidebar is a drawer over the page; on desktop it collapses
  const closeDrawer = () => document.body.classList.remove("sb-open");
  document.getElementById("sbtoggle").addEventListener("click", () => {
    if (narrow.matches) document.body.classList.toggle("sb-open");
    else document.body.classList.toggle("nosb");
  });
  document.getElementById("sbbackdrop")?.addEventListener("click", closeDrawer);
  document.getElementById("sidebar").addEventListener("click", e => {
    if (narrow.matches && e.target.closest(".toc-item, .thumb")) closeDrawer();
  });
  narrow.addEventListener("change", closeDrawer);

  /* ---- current-page tracking ---- */
  let curPage = 0;
  function setCurrent(n) {
    if (n === curPage) return;
    curPage = n;
    pn.value = n;
    const u = new URL(location);
    u.searchParams.delete("b");
    u.searchParams.set("p", n);
    history.replaceState(null, "", u);
    document.querySelectorAll(".thumb.cur").forEach(x => x.classList.remove("cur"));
    document.getElementById(`th-${n}`)?.classList.add("cur");
    let cur = -1;
    book.sections.forEach((s, i) => { if (s.gpage <= n) cur = i; });
    document.querySelectorAll(".toc-item.cur").forEach(x => x.classList.remove("cur"));
    if (cur >= 0) {
      const el = tocPane.querySelector(`[data-i="${cur}"]`);
      if (el) {
        el.classList.add("cur");
        if (document.getElementById("tab-toc").classList.contains("active"))
          el.scrollIntoView({ block: "nearest" });
      }
    }
  }
  window.addEventListener("scroll", () => {
    const pages = document.querySelectorAll(".page");
    for (const pg of pages) {
      const r = pg.getBoundingClientRect();
      if (r.bottom > 120) {
        setCurrent(parseInt(pg.id.split("-")[1]));
        break;
      }
    }
  }, { passive: true });

  /* ---- view mode: continuous scroll, one page, or two-page spread ---- */
  let mode = localStorage.getItem("bpod-view") || "scroll";
  function setMode(m) {
    mode = m;
    // a phone always gets the single continuous column, whatever was saved
    const eff = narrow.matches ? "scroll" : m;
    document.body.classList.remove("view-scroll", "view-page", "view-spread");
    document.body.classList.add(`view-${eff}`);
    document.querySelectorAll("#viewmode button").forEach(b =>
      b.classList.toggle("active", b.dataset.v === m));
    try { localStorage.setItem("bpod-view", m); } catch (e) { /* private mode */ }
    // page geometry changed, so re-fit every kind of text layer
    requestAnimationFrame(() => {
      applyFontSizes();
      document.querySelectorAll(".rpage").forEach(fitPageText);
      const el = document.getElementById(`page-${curPage}`);
      if (el) el.scrollIntoView({ block: "center" });
    });
  }
  document.querySelectorAll("#viewmode button").forEach(b =>
    b.addEventListener("click", () => setMode(b.dataset.v)));
  setMode(mode);
  // phones read one long column; re-apply if the window crosses the breakpoint
  narrow.addEventListener("change", () => setMode(mode));

  /* ---- keyboard paging ---- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    const step = mode === "spread" ? 2 : 1;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      gotoPage(Math.min(curPage + step, book.total));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      gotoPage(Math.max(curPage - step, 1));
    }
  });

  /* ---- search ---- */
  const input = document.getElementById("q");
  const results = document.getElementById("results");
  input.value = q;
  input.addEventListener("input", () => {
    const qq = input.value.trim();
    results.innerHTML = "";
    if (qq.length < 3) return;
    const hits = searchPages(book.pages, qq);
    results.innerHTML = `<div class="rcount">${hits.length} pages match</div>` +
      hits.map(h =>
        `<div class="result" data-p="${h.gn}">
          <div class="where">Vol. ${h.b} · page ${h.n}</div><div>${h.snip}</div></div>`
      ).join("");
    results.querySelectorAll(".result").forEach(el => {
      el.addEventListener("click", () => {
        highlight(input.value.trim());
        gotoPage(el.dataset.p);
      });
    });
  });

  function highlight(qq) {
    document.querySelectorAll(".tl").forEach(el => {
      el.classList.toggle("hl", qq.length >= 3 && el.textContent.toLowerCase().includes(qq.toLowerCase()));
    });
  }

  if (startPage) {
    const el = document.getElementById(`page-${startPage}`);
    if (el) el.scrollIntoView();
  }
}
