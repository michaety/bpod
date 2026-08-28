"""Print OCR lines and detected image rectangles for a page, in page percentages.

A recreation aid: run `python3 tools/page_hints.py <volume> <page>` to see the
stored geometry next to the scan while writing site/data/recreated/vVpP.json.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect_art

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    v, p = int(sys.argv[1]), int(sys.argv[2])
    with open(os.path.join(ROOT, "site", "data", f"book{v}", "pages.json"), encoding="utf-8") as fh:
        page = json.load(fh)["pages"][p - 1]
    PW, PH = page["w"], page["h"]
    print(f"v{v}p{p}  scan={page['scan']}  {PW}x{PH}")
    print("-- plates measured off the scan (verify against the image) --")
    for r in detect_art.detect(v, p):
        print('  {"k":"art","x":%.2f,"y":%.2f,"w":%.2f,"h":%.2f},' % r)
    print("-- lines --")
    for l in sorted(page["lines"], key=lambda l: (l["y"], l["x"])):
        print("  x=%6.2f y=%6.2f w=%6.2f fs=%.2f  %s" % (
            l["x"] / PW * 100, l["y"] / PH * 100, l["w"] / PW * 100,
            l["fs"] / PW * 100, l["t"]))


if __name__ == "__main__":
    main()
