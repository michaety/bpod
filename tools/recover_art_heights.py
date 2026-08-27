"""Measure a plate's bottom edge directly from the scan.

Artwork sits on a grey mount against pale paper, so the plate's extent is
measurable rather than estimated. Run with --check to score the detector against
art rectangles whose height is known; run with --fix to fill in missing ones.
"""
import json
import os
import statistics
import sys

import numpy as np
import pymupdf
from PIL import Image
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "site", "data", "recreated")

_gray = {}


def gray_for(book, page):
    key = (book, page)
    if key not in _gray:
        p = os.path.join(ROOT, "site", "data", f"book{book}", "img",
                         f"p{page - 1:03d}_scan.jpg")
        im = Image.open(p).convert("L")
        _gray[key] = np.asarray(im, dtype=np.float32)
    return _gray[key]


def measure_bottom(g, x_pct, y_pct, w_pct):
    """Return the plate's bottom edge as a % of page height, or None."""
    H, W = g.shape
    x0 = int(max(0, x_pct / 100 * W))
    x1 = int(min(W, (x_pct + w_pct) / 100 * W))
    y0 = int(max(0, y_pct / 100 * H))
    if x1 - x0 < 20 or y0 >= H - 20:
        return None

    band = g[:, x0:x1]
    rowmean = band.mean(axis=1)

    probe = rowmean[y0 + 4: y0 + 30]
    if probe.size < 5:
        return None
    plate = float(np.median(probe))

    # paper brightness: the page's brightest rows, sampled at the margins
    paper = float(np.percentile(rowmean, 92))
    if paper - plate < 6:
        return None  # plate is not distinguishable from paper here

    thresh = plate + (paper - plate) * 0.55

    r = y0 + 4
    last = r
    gap = 0
    while r < H:
        if rowmean[r] < thresh:
            last = r
            gap = 0
        else:
            gap += 1
            if gap > max(6, H * 0.004):
                break
        r += 1
    return (last + 1) / H * 100


def iter_records():
    for f in sorted(os.listdir(REC)):
        if not f.startswith("v") or not f.endswith(".json") or f == "manifest.json":
            continue
        b = int(f[1])
        n = int(f.split("p")[1].split(".")[0])
        yield f, b, n


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--check"

    errs = []
    fixed = 0
    unfixable = []

    for f, b, n in iter_records():
        path = os.path.join(REC, f)
        with open(path, encoding="utf-8") as fh:
            rec = json.load(fh)
        arts = [e for e in rec.get("el", []) if e.get("k") == "art"]
        if not arts:
            continue
        g = gray_for(b, n)
        H = g.shape[0]
        touched = False

        for e in arts:
            bottom = measure_bottom(g, e["x"], e["y"], e["w"])
            if mode == "--check":
                if "h" in e and bottom is not None:
                    errs.append(abs((e["y"] + e["h"]) - bottom))
            else:
                if "h" in e:
                    continue
                if bottom is None or bottom <= e["y"] + 1:
                    unfixable.append(f"{f}: art at y={e['y']} x={e['x']}")
                    continue
                e["h"] = round(bottom - e["y"], 2)
                touched = True
                fixed += 1

        if touched:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(rec, fh, ensure_ascii=False, indent=1)

    if mode == "--check":
        if not errs:
            print("no comparable rectangles")
            return
        errs.sort()
        print(f"compared {len(errs)} known art rectangles")
        print(f"  median error {statistics.median(errs):.2f}% of page height")
        print(f"  mean   error {statistics.mean(errs):.2f}%")
        print(f"  90th pct     {errs[int(len(errs) * 0.9)]:.2f}%")
        print(f"  worst        {errs[-1]:.2f}%")
        print(f"  within 1%:   {sum(1 for e in errs if e <= 1)}/{len(errs)}")
    else:
        print(f"recovered {fixed} art heights")
        if unfixable:
            print(f"{len(unfixable)} not measurable:")
            for u in unfixable[:12]:
                print("  " + u)


if __name__ == "__main__":
    main()
