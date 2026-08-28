"""Find the plate rectangles on a page scan.

Artwork - photograph, drawing or printed plate, together with the grey mount it
is often pasted on - is darker than the paper around it. Mask everything that is
not paper, drop the printed text (its geometry is already known from the OCR
pass), and what is left are the plates. Report each as a rectangle in page
percentages.

    python3 tools/detect_art.py <volume> <page>       list the plates
    python3 tools/detect_art.py --score <volume>      score against recreations
"""
import json
import os
import statistics
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "site", "data", "recreated")

_pages = {}


def pages_for(book):
    if book not in _pages:
        with open(os.path.join(ROOT, "site", "data", f"book{book}", "pages.json"),
                  encoding="utf-8") as fh:
            _pages[book] = json.load(fh)["pages"]
    return _pages[book]


def label(mask):
    """Connected components of a boolean mask, 4-connected, iterative."""
    H, W = mask.shape
    lab = np.zeros((H, W), dtype=np.int32)
    cur = 0
    stack = []
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        cur += 1
        stack.append((y0, x0))
        lab[y0, x0] = cur
        while stack:
            y, x = stack.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cur
                    stack.append((ny, nx))
    return lab, cur


def maxfilt(a, r):
    """Separable maximum filter, radius r cells."""
    for axis in (0, 1):
        n = a.shape[axis]
        out = a.copy()
        for d in range(1, r + 1):
            out = np.maximum(out, np.roll(a, d, axis=axis))
            out = np.maximum(out, np.roll(a, -d, axis=axis))
        # np.roll wraps; clamp the edges back to a one-sided window
        sl = [slice(None), slice(None)]
        for d in range(min(r, n)):
            sl[axis] = d
            lo = [slice(None), slice(None)]
            lo[axis] = slice(0, d + r + 1)
            out[tuple(sl)] = a[tuple(lo)].max(axis=axis)
            sl[axis] = n - 1 - d
            hi = [slice(None), slice(None)]
            hi[axis] = slice(max(0, n - 1 - d - r), n)
            out[tuple(sl)] = a[tuple(hi)].max(axis=axis)
        a = out
    return a


def detect(book, page, cell=8, min_area=1.2, delta=13, ink=0.35):
    """Return plate rectangles as (x, y, w, h) percentages of the page."""
    p = pages_for(book)[page - 1]
    path = os.path.join(ROOT, "site", "data", f"book{book}", "img",
                        f"p{page - 1:03d}_scan.jpg")
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    H, W = g.shape
    sx, sy = W / p["w"], H / p["h"]

    # the printed text is not artwork; neither is the scanner's dark border.
    # paint them out with the local paper tone so they cannot read as plate.
    keep = np.ones((H, W), dtype=bool)
    for l in p["lines"]:
        x0 = int(max(0, (l["x"] - 3) * sx))
        x1 = int(min(W, (l["x"] + l["w"] + 3) * sx))
        y0 = int(max(0, (l["y"] - 3) * sy))
        y1 = int(min(H, (l["y"] + l["h"] + 3) * sy))
        keep[y0:y1, x0:x1] = False
    m = int(min(H, W) * 0.012)
    keep[:m, :] = keep[-m:, :] = keep[:, :m] = keep[:, -m:] = False

    gh, gw = H // cell, W // cell
    sub = g[:gh * cell, :gw * cell].reshape(gh, cell, gw, cell)
    coarse = sub.mean(axis=(1, 3))
    ksub = keep[:gh * cell, :gw * cell].reshape(gh, cell, gw, cell)
    live = ksub.mean(axis=(1, 3)) > 0.5

    # the scan is unevenly lit, so compare each cell with the brightest paper
    # near it rather than with one global paper value
    probe = np.where(live, coarse, 0.0)
    paper = maxfilt(probe, max(6, int(min(gh, gw) * 0.16)))
    grid = live & (coarse < paper - delta)

    # close small gaps so a plate's pale interior does not split it in two,
    # then open again so stray specks do not become plates
    for _ in range(1):
        pad = np.zeros((gh + 2, gw + 2), dtype=bool)
        pad[1:-1, 1:-1] = grid
        grid = (pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] |
                pad[1:-1, 2:] | pad[1:-1, 1:-1])
    for _ in range(1):
        pad = np.ones((gh + 2, gw + 2), dtype=bool)
        pad[1:-1, 1:-1] = grid
        grid = (pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] &
                pad[1:-1, 2:] & pad[1:-1, 1:-1])

    depth = np.where(live, np.maximum(paper - coarse, 0.0), 0.0)

    lab, n = label(grid)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        y0, y1 = ys.min(), ys.max() + 1
        x0, x1 = xs.min(), xs.max() + 1

        # a scan darkens towards the page edge, and that gradient can read as
        # plate. Pare back any edge far fainter than the plate it borders.
        core = depth[y0:y1, x0:x1]
        floor = float(core[grid[y0:y1, x0:x1]].mean()) * 0.20
        for _ in range(max(y1 - y0, x1 - x0)):
            edges = [(depth[y0, x0:x1].mean(), "y0"), (depth[y1 - 1, x0:x1].mean(), "y1"),
                     (depth[y0:y1, x0].mean(), "x0"), (depth[y0:y1, x1 - 1].mean(), "x1")]
            worst, which = min(edges)
            if worst >= floor or y1 - y0 < 4 or x1 - x0 < 4:
                break
            if which == "y0":
                y0 += 1
            elif which == "y1":
                y1 -= 1
            elif which == "x0":
                x0 += 1
            else:
                x1 -= 1

        rx, ry = x0 * cell / W * 100, y0 * cell / H * 100
        rw, rh = (x1 - x0) * cell / W * 100, (y1 - y0) * cell / H * 100
        if rw * rh < min_area * 100 or rw < 4 or rh < 3:
            continue
        out.append((round(rx, 2), round(ry, 2), round(rw, 2), round(rh, 2)))
    out.sort(key=lambda r: (round(r[1] / 4), r[0]))
    return out


def score(book):
    errs = []
    for n in range(1, len(pages_for(book)) + 1):
        f = os.path.join(REC, f"v{book}p{n}.json")
        if not os.path.exists(f):
            continue
        with open(f, encoding="utf-8") as fh:
            want = [e for e in json.load(fh).get("el", []) if e.get("k") == "art"]
        if not want:
            continue
        got = detect(book, n)
        if len(got) != len(want):
            print(f"  v{book}p{n}: {len(got)} found, {len(want)} expected")
            continue
        want.sort(key=lambda e: (round(e["y"] / 4), e["x"]))
        for a, b in zip(want, got):
            errs.extend([abs(a["x"] - b[0]), abs(a["y"] - b[1]),
                         abs(a["x"] + a["w"] - b[0] - b[2]),
                         abs(a["y"] + a["h"] - b[1] - b[3])])
    if errs:
        errs.sort()
        print(f"{len(errs) // 4} matched plates, {len(errs)} edges")
        print(f"  median {statistics.median(errs):.2f}%  90th {errs[int(len(errs) * .9)]:.2f}%"
              f"  worst {errs[-1]:.2f}%")


def main():
    if sys.argv[1] == "--score":
        score(int(sys.argv[2]))
        return
    v, p = int(sys.argv[1]), int(sys.argv[2])
    for r in detect(v, p):
        print('  {"k":"art","x":%.2f,"y":%.2f,"w":%.2f,"h":%.2f},' % r)


if __name__ == "__main__":
    main()
