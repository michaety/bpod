"""Index the hand-authored page recreations so the viewer knows which pages have one."""
import json
import os
import re

REC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "site", "data", "recreated")

keys = []
bad = []
for f in sorted(os.listdir(REC)):
    m = re.fullmatch(r"v(\d)p(\d+)\.json", f)
    if not m:
        continue
    b, n = m.group(1), int(m.group(2))
    try:
        with open(os.path.join(REC, f), encoding="utf-8") as fh:
            rec = json.load(fh)
        el = rec.get("el", [])
        arts = sum(1 for e in el if e.get("k") == "art")
        txts = sum(1 for e in el if e.get("k") == "txt")
        if not el:
            print(f"{f}: blank page")
        for e in el:
            for k in ("x", "y"):
                if not isinstance(e.get(k), (int, float)) or not (-5 <= e[k] <= 105):
                    bad.append(f"{f}: bad {k}={e.get(k)}")
        keys.append(f"{b}:{n}")
        if el:
            print(f"{f}: {arts} art, {txts} text")
    except Exception as exc:
        bad.append(f"{f}: {exc}")

with open(os.path.join(REC, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(keys, fh)

print(f"\n{len(keys)} recreated pages indexed")
if bad:
    print(f"{len(bad)} problems:")
    for b in bad[:20]:
        print("  " + b)
