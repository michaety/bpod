"""Set each recreated page's background to the paper colour measured from its scan.

Agents estimated these by eye, which produced 61 different shades across one
volume and made the book look patchy. The paper tone is measurable: sample the
margins, where artwork almost never reaches, and take the median.
"""
import json
import os
import re

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "site", "data", "recreated")


def paper_colour(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    H, W, _ = a.shape
    # strips just inside the trim, avoiding the scanner's dark outer edge
    t = int(H * 0.015), int(H * 0.045)
    b = int(H * 0.955), int(H * 0.985)
    l = int(W * 0.015), int(W * 0.045)
    r = int(W * 0.955), int(W * 0.985)
    strips = [
        a[t[0]:t[1], :, :].reshape(-1, 3),
        a[b[0]:b[1], :, :].reshape(-1, 3),
        a[:, l[0]:l[1], :].reshape(-1, 3),
        a[:, r[0]:r[1], :].reshape(-1, 3),
    ]
    px = np.concatenate(strips, axis=0).astype(np.float32)
    # paper is the bright bulk of the margin; drop shadow and any plate that
    # creeps in by taking an upper-middle percentile per channel
    return tuple(int(np.percentile(px[:, c], 65)) for c in range(3))


def main():
    changed = 0
    seen = {}
    for f in sorted(os.listdir(REC)):
        m = re.fullmatch(r"v(\d)p(\d+)\.json", f)
        if not m:
            continue
        b, n = int(m.group(1)), int(m.group(2))
        scan = os.path.join(ROOT, "site", "data", f"book{b}", "img",
                            f"p{n - 1:03d}_scan.jpg")
        if not os.path.exists(scan):
            continue
        rgb = paper_colour(scan)
        hexc = "#%02x%02x%02x" % rgb
        path = os.path.join(REC, f)
        with open(path, encoding="utf-8") as fh:
            rec = json.load(fh)
        if rec.get("bg") != hexc:
            rec["bg"] = hexc
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(rec, fh, ensure_ascii=False, indent=1)
            changed += 1
        seen[hexc] = seen.get(hexc, 0) + 1

    print(f"{changed} backgrounds updated")
    print(f"{len(seen)} distinct measured shades")
    for h, c in sorted(seen.items(), key=lambda kv: -kv[1])[:6]:
        print(f"  {h}  x{c}")


if __name__ == "__main__":
    main()
