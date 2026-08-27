"""Give every multi-line text block in a recreation its true printed height.

The OCR pass recorded accurate geometry for each printed line (even where it read
the words badly). Cluster those lines back into blocks and hand each recreated
text element the real rectangle it occupies on the page, so live text is fitted
into the printed block instead of overflowing into its neighbour.
"""
import json
import os
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "site", "data", "recreated")


def blocks_for_page(page):
    lines = [l for l in page["lines"] if len(l["t"].strip()) > 1]
    if not lines:
        return []
    pitch = statistics.median([l["h"] for l in lines]) or 10

    cols = []
    for l in sorted(lines, key=lambda l: (l["x"], l["y"])):
        for c in cols:
            if abs(c["x"] - l["x"]) < max(28, l["h"] * 2.0):
                c["lines"].append(l)
                c["x"] = min(c["x"], l["x"])
                break
        else:
            cols.append({"x": l["x"], "lines": [l]})

    blocks = []
    for c in cols:
        cur = []
        for l in sorted(c["lines"], key=lambda l: l["y"]):
            # a printed column runs continuously through indented paragraphs;
            # only a real gap (roughly a blank line) starts a new block
            if cur and l["y"] - (cur[-1]["y"] + cur[-1]["h"]) > pitch * 1.5:
                blocks.append(cur)
                cur = []
            cur.append(l)
        if cur:
            blocks.append(cur)

    out = []
    for b in blocks:
        out.append({
            "x0": min(l["x"] for l in b),
            "y0": min(l["y"] for l in b),
            "x1": max(l["x"] + l["w"] for l in b),
            "y1": max(l["y"] + l["h"] for l in b),
            "n": len(b),
        })
    return out


def main():
    pages_cache = {}
    changed = 0
    skipped = []

    for f in sorted(os.listdir(REC)):
        if not f.startswith("v") or not f.endswith(".json") or f == "manifest.json":
            continue
        b = int(f[1])
        n = int(f.split("p")[1].split(".")[0])
        if b not in pages_cache:
            with open(os.path.join(ROOT, "site", "data", f"book{b}", "pages.json"), encoding="utf-8") as fh:
                pages_cache[b] = json.load(fh)["pages"]
        page = pages_cache[b][n - 1]
        PW, PH = page["w"], page["h"]
        blocks = blocks_for_page(page)

        path = os.path.join(REC, f)
        with open(path, encoding="utf-8") as fh:
            rec = json.load(fh)

        el = rec.get("el", [])

        def paras_of(e):
            return e["paras"] if e.get("paras") else [e.get("text", "")]

        flow = [e for e in el
                if e.get("k") == "txt"
                and e.get("style") in ("body", "caption")
                and len(" ".join(paras_of(e))) >= 45]
        touched = False
        claimed = set()

        for bl in [b for b in blocks if b["n"] >= 2]:
            bx, by = bl["x0"] / PW * 100, bl["y0"] / PH * 100
            bh = (bl["y1"] - bl["y0"]) / PH * 100
            bw = (bl["x1"] - bl["x0"]) / PW * 100
            members = [e for e in flow
                       if id(e) not in claimed
                       and abs(e["x"] - bx) < 8
                       and by - 2.5 <= e["y"] <= by + bh + 2.5]
            if not members:
                continue
            members.sort(key=lambda e: e["y"])
            for e in members:
                claimed.add(id(e))
            keep = members[0]
            # one printed column -> one flowing element, paragraphs marked by indent
            merged = []
            for m in members:
                merged.extend(paras_of(m))
            keep["paras"] = merged
            keep.pop("text", None)
            keep["x"] = round(bx, 2)
            keep["y"] = round(by, 2)
            keep["w"] = round(max(bw, keep.get("w", bw)), 2)
            # a little breathing room: our face is not the original Helvetica
            keep["h"] = round(bh * 1.06, 2)
            for m in members[1:]:
                el.remove(m)
            touched = True

        for e in flow:
            if id(e) not in claimed:
                skipped.append(f"{f}: unmatched block {e.get('text','')[:34]!r}")

        if touched:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(rec, fh, ensure_ascii=False, indent=1)
            changed += 1

    print(f"{changed} files given printed block heights")
    if skipped:
        print(f"{len(skipped)} blocks left unfitted:")
        for s in skipped[:15]:
            print("  " + s)


if __name__ == "__main__":
    main()
