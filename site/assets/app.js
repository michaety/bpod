const NBOOKS = 4;
const FRONT_TITLES = new Set([
  "cover", "title page", "imprint", "general introduction", "table of contents",
]);

async function loadJson(url) {
  try {
    const r = await fetch(url);
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

async function initBook() {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  const book = await loadMerged();
  // legacy links: ?b=N&p=<page within volume>
  let startPage = parseInt(params.get("p") || "0");
  if (params.get("b") && book.offsets[parseInt(params.get("b"))] !== undefined) {
    startPage = book.offsets[parseInt(params.get("b"))] + (startPage || 1);
  }
  document.getElementById("booktitle").textContent = "Volumes 1–4";
  document.title = "Basic Principles of Design — Complete";

  const main = document.getElementById("pages");
  for (const p of book.pages) {
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
    rt = setTimeout(applyFontSizes, 150);
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

  /* ---- sidebar: thumbnails ---- */
  const thumbsPane = document.getElementById("tab-thumbs");
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

  /* ---- sidebar: index ---- */
  const idxPane = document.getElementById("tab-idx");
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

  /* ---- tabs / sidebar toggle ---- */
  document.querySelectorAll(".tabs button").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tabpane").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    }));
  document.getElementById("sbtoggle").addEventListener("click", () =>
    document.body.classList.toggle("nosb"));

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

  /* ---- keyboard paging ---- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      gotoPage(Math.min(curPage + 1, book.total));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      gotoPage(Math.max(curPage - 1, 1));
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
