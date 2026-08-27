"""Write a copy of a page scan with a percentage grid drawn over it.

Recreating a page means reading coordinates off the scan by eye, and a bare
image gives nothing to read them against. This draws a 5%-of-page grid, labelled
every 10%, so plate edges can be measured directly. Optionally overlays the art
rectangles of an existing recreation, or ones passed on the command line, to
check them against the artwork they claim to frame.

    python3 tools/gridded_scan.py <volume> <page> [--rec] [x,y,w,h ...]
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("SCRATCH", "/tmp")


def main():
    v, p = int(sys.argv[1]), int(sys.argv[2])
    rects = []
    for a in sys.argv[3:]:
        if a == "--rec":
            f = os.path.join(ROOT, "site", "data", "recreated", f"v{v}p{p}.json")
            with open(f, encoding="utf-8") as fh:
                rects += [(e["x"], e["y"], e["w"], e.get("h", 0))
                          for e in json.load(fh)["el"] if e.get("k") == "art"]
        else:
            rects.append(tuple(float(n) for n in a.split(",")))

    src = os.path.join(ROOT, "site", "data", f"book{v}", "img", f"p{p - 1:03d}_scan.jpg")
    im = Image.open(src).convert("RGB")
    W, H = im.size
    d = ImageDraw.Draw(im, "RGBA")

    for i in range(0, 101, 5):
        major = i % 10 == 0
        col = (0, 120, 255, 150 if major else 70)
        x, y = W * i / 100, H * i / 100
        d.line([(x, 0), (x, H)], fill=col, width=3 if major else 1)
        d.line([(0, y), (W, y)], fill=col, width=3 if major else 1)
        if major and i:
            d.text((x + 5, 6), str(i), fill=(0, 90, 200, 255))
            d.text((6, y + 4), str(i), fill=(0, 90, 200, 255))

    for r in rects:
        d.rectangle([W * r[0] / 100, H * r[1] / 100,
                     W * (r[0] + r[2]) / 100, H * (r[1] + r[3]) / 100],
                    outline=(255, 0, 0, 255), width=5)

    out = os.path.join(OUT, f"grid_v{v}p{p}.jpg")
    im.save(out, quality=88)
    print(out)


if __name__ == "__main__":
    main()
