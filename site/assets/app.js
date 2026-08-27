const NBOOKS = 4;

async function loadBook(b) {
  const res = await fetch(`data/book${b}/pages.json`);
  return res.json();
}

function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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

function searchPages(book, q) {
  const hits = [];
  for (const p of book.pages) {
    const text = p.lines.map(l => l.t).join(" ");
    if (text.toLowerCase().includes(q.toLowerCase())) {
      hits.push({ book: book.book, page: p.n, snip: snippet(text, q) });
    }
  }
  return hits;
}

/* ---------- home ---------- */

async function initHome() {
  const grid = document.getElementById("books");
  const books = [];
  for (let b = 1; b <= NBOOKS; b++) {
    try {
      const bk = await loadBook(b);
      books.push(bk);
      const a = document.createElement("div");
      a.className = "bookcard";
      let secs = "";
      try {
        const toc = await (await fetch(`data/book${b}/toc.json`)).json();
        secs = toc.sections.filter(s => s.level === 1 && s.page >= 12)
          .map(s => `<a class="seclink" href="book.html?b=${b}&p=${s.page}">${esc(s.title)}</a>`)
          .join("");
      } catch (e) { /* no toc */ }
      a.innerHTML = `<a href="book.html?b=${b}">
          <img src="data/book${b}/thumb/p000.jpg" loading="lazy">
          <div class="label">Volume ${b}<span>${bk.pages.length} pages</span></div></a>
        <div class="seclinks">${secs}</div>`;
      grid.appendChild(a);
    } catch (e) { /* book not built yet */ }
  }

  const input = document.getElementById("q");
  const results = document.getElementById("results");
  input.addEventListener("input", () => {
    const q = input.value.trim();
    results.innerHTML = "";
    if (q.length < 3) return;
    let all = [];
    for (const bk of books) all = all.concat(searchPages(bk, q));
    results.innerHTML = `<div class="rcount">${all.length} pages match</div>` +
      all.slice(0, 200).map(h =>
        `<a class="result" href="book.html?b=${h.book}&p=${h.page}&q=${encodeURIComponent(q)}">
          <div class="where">Volume ${h.book} · page ${h.page}</div><div>${h.snip}</div></a>`
      ).join("");
  });
}

/* ---------- book viewer ---------- */

function renderPage(bookNum, p, q) {
  const div = document.createElement("div");
  div.className = "page";
  div.id = `page-${p.n}`;
  div.style.aspectRatio = `${p.w} / ${p.h}`;
  const pct = (v, total) => (v / total * 100).toFixed(3);

  let html = "";
  for (const im of p.images) {
    html += `<img class="region" loading="lazy" src="data/book${bookNum}/${im.src}"
      style="left:${pct(im.x, p.w)}%;top:${pct(im.y, p.h)}%;width:${pct(im.w, p.w)}%;height:${pct(im.h, p.h)}%">`;
  }
  for (const l of p.lines) {
    const hl = q && l.t.toLowerCase().includes(q.toLowerCase()) ? " hl" : "";
    const ov = l.ov ? " ov" : "";
    html += `<div class="tl${hl}${ov}" data-r="${(l.fs / p.w).toFixed(5)}"
      style="left:${pct(l.x, p.w)}%;top:${pct(l.y, p.h)}%">${esc(l.t)}</div>`;
  }
  div.dataset.scan = `data/book${bookNum}/${p.scan}`;
  div.innerHTML = html;
  return div;
}

async function loadJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

function gotoPage(n) {
  const el = document.getElementById(`page-${n}`);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

async function initBook() {
  const params = new URLSearchParams(location.search);
  const b = parseInt(params.get("b") || "1");
  const q = params.get("q") || "";
  const book = await loadBook(b);
  document.getElementById("booktitle").textContent = `Volume ${b}`;
  document.title = book.title;

  const main = document.getElementById("pages");
  for (const p of book.pages) {
    main.appendChild(renderPage(b, p, q));
    const no = document.createElement("div");
    no.className = "pageno";
    no.textContent = p.n;
    main.appendChild(no);
  }

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

  const modeBtn = document.getElementById("mode");
  modeBtn.addEventListener("click", () => {
    const scan = document.body.classList.toggle("scanmode");
    modeBtn.textContent = scan ? "Rebuilt view" : "Scan view";
    modeBtn.classList.toggle("active", scan);
    document.querySelectorAll(".page").forEach(pg => {
      let img = pg.querySelector("img.scanimg");
      if (scan && !img) {
        img = document.createElement("img");
        img.className = "scanimg";
        img.loading = "lazy";
        img.src = pg.dataset.scan;
        pg.appendChild(img);
      } else if (!scan && img) {
        img.remove();
      }
    });
  });

  const pn = document.getElementById("pagenum");
  pn.max = book.pages.length;
  pn.addEventListener("change", () => gotoPage(pn.value));

  /* ---- sidebar ---- */
  const toc = await loadJson(`data/book${b}/toc.json`);
  const tocPane = document.getElementById("tab-toc");
  if (toc && toc.sections && toc.sections.length) {
    tocPane.innerHTML = toc.sections.map((s, i) =>
      `<a class="toc-item l${s.level}" data-p="${s.page}" data-i="${i}">
        ${esc(s.title)}<span class="pg">${s.page}</span></a>`
    ).join("");
    tocPane.querySelectorAll(".toc-item").forEach(el =>
      el.addEventListener("click", () => gotoPage(el.dataset.p)));
  } else {
    tocPane.innerHTML = `<div class="toc-empty">No contents outline available for this volume yet.</div>`;
  }

  const thumbsPane = document.getElementById("tab-thumbs");
  thumbsPane.innerHTML = `<div class="thumbgrid">` + book.pages.map(p =>
    `<div class="thumb" data-p="${p.n}" id="th-${p.n}">
      <img loading="lazy" src="data/book${b}/thumb/p${String(p.n - 1).padStart(3, "0")}.jpg">
      <div class="tn">${p.n}</div></div>`
  ).join("") + `</div>`;
  thumbsPane.querySelectorAll(".thumb").forEach(el =>
    el.addEventListener("click", () => gotoPage(el.dataset.p)));

  const idx = await loadJson(`data/book${b}/index.json`);
  const idxPane = document.getElementById("tab-idx");
  if (idx && idx.length) {
    const byLetter = {};
    for (const [term, pgs] of idx) (byLetter[term[0].toUpperCase()] ??= []).push([term, pgs]);
    const letters = Object.keys(byLetter).sort();
    let html = `<div class="letternav">` +
      letters.map(L => `<a href="#idx-${L}">${L}</a>`).join("") + `</div>`;
    for (const L of letters) {
      html += `<div class="idx-letter" id="idx-${L}">${L}</div>`;
      for (const [term, pgs] of byLetter[L]) {
        html += `<div class="idx-term">${esc(term)}
          <span class="pgs">${pgs.map(p => `<a data-p="${p}">${p}</a>`).join("")}</span></div>`;
      }
    }
    idxPane.innerHTML = html;
    idxPane.querySelectorAll(".pgs a").forEach(el =>
      el.addEventListener("click", () => gotoPage(el.dataset.p)));
  }

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
  let curPage = 1;
  function setCurrent(n) {
    if (n === curPage) return;
    curPage = n;
    pn.value = n;
    const u = new URL(location);
    u.searchParams.set("p", n);
    history.replaceState(null, "", u);
    document.querySelectorAll(".thumb.cur").forEach(x => x.classList.remove("cur"));
    document.getElementById(`th-${n}`)?.classList.add("cur");
    if (toc && toc.sections) {
      let cur = -1;
      toc.sections.forEach((s, i) => { if (s.page <= n) cur = i; });
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
      gotoPage(Math.min(curPage + 1, book.pages.length));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      gotoPage(Math.max(curPage - 1, 1));
    }
  });

  const input = document.getElementById("q");
  const results = document.getElementById("results");
  input.value = q;
  input.addEventListener("input", () => {
    const qq = input.value.trim();
    results.innerHTML = "";
    if (qq.length < 3) return;
    const hits = searchPages(book, qq);
    results.innerHTML = `<div class="rcount">${hits.length} pages match</div>` +
      hits.map(h =>
        `<div class="result" data-p="${h.page}">
          <div class="where">Page ${h.page}</div><div>${h.snip}</div></div>`
      ).join("");
    results.querySelectorAll(".result").forEach(el => {
      el.addEventListener("click", () => {
        highlight(input.value.trim());
        document.getElementById(`page-${el.dataset.p}`).scrollIntoView({ behavior: "smooth" });
      });
    });
  });

  function highlight(qq) {
    document.querySelectorAll(".tl").forEach(el => {
      el.classList.toggle("hl", qq.length >= 3 && el.textContent.toLowerCase().includes(qq.toLowerCase()));
    });
  }

  if (params.get("p")) {
    const el = document.getElementById(`page-${params.get("p")}`);
    if (el) el.scrollIntoView();
  }
}
