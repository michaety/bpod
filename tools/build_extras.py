import json
import os
import re
from collections import defaultdict

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")

STOP = set("""
the and for with are that this from was were been being have has had not but all can its
which their there these those they them then than when where what who whom whose why how
also into onto upon over under between through during before after above below out off
each other some such only own same very more most both few any nor too own she her his
him himself herself itself ourselves themselves your yours ours mine one two three four
five six seven eight nine ten first second third page pages left right top bottom upper
lower here about again against because until while shall should would could may might
must will does did doing done make made making takes take taken taking given give gives
becomes become came come comes goes gone going way ways example examples shown shows show
used uses using use etc still well much many
""".split())


def build_thumbs(book_dir):
    img_dir = os.path.join(book_dir, "img")
    th_dir = os.path.join(book_dir, "thumb")
    os.makedirs(th_dir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(img_dir)):
        if not f.endswith("_scan.jpg"):
            continue
        dst = os.path.join(th_dir, f.replace("_scan", ""))
        if os.path.exists(dst):
            continue
        im = Image.open(os.path.join(img_dir, f))
        w = 180
        im = im.resize((w, int(im.height * w / im.width)))
        im.save(dst, quality=70)
        n += 1
    return n


def build_index(book_dir):
    with open(os.path.join(book_dir, "pages.json"), encoding="utf-8") as f:
        book = json.load(f)
    term_pages = defaultdict(set)
    for p in book["pages"]:
        text = " ".join(l["t"] for l in p["lines"]).lower()
        for w in set(re.findall(r"[a-z][a-z\-]{3,}", text)):
            w = w.strip("-")
            if len(w) < 4 or w in STOP:
                continue
            term_pages[w].add(p["n"])
    npages = len(book["pages"])
    entries = {
        t: sorted(ps) for t, ps in term_pages.items()
        if 3 <= len(ps) <= max(6, int(npages * 0.45))
    }
    top = sorted(entries.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:450]
    index = sorted(top, key=lambda kv: kv[0])
    with open(os.path.join(book_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    return len(index)


for b in range(1, 5):
    book_dir = os.path.join(SITE, "data", f"book{b}")
    nt = build_thumbs(book_dir)
    ni = build_index(book_dir)
    print(f"book {b}: {nt} thumbs, {ni} index terms", flush=True)
