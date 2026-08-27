"""Bundle the hand-authored page recreations into one file for the viewer.

Fetching one file per page cost the reader 100+ requests on every load, so the
recreations are packed into a single bundle. The bundle carries a build stamp,
which the viewer appends to its other data URLs as a cache-buster - that way
everything can be cached normally and still update when regenerated.
"""
import hashlib
import json
import os
import re

REC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "site", "data", "recreated")

keys = []
bad = []
bundle = {}
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
        bundle[f"{b}:{n}"] = rec
        if el:
            print(f"{f}: {arts} art, {txts} text")
    except Exception as exc:
        bad.append(f"{f}: {exc}")

payload = json.dumps({"pages": bundle}, ensure_ascii=False, separators=(",", ":"))
stamp = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:10]

with open(os.path.join(REC, "bundle.json"), "w", encoding="utf-8") as fh:
    fh.write(json.dumps({"built": stamp, "pages": bundle},
                        ensure_ascii=False, separators=(",", ":")))

# kept for anything still reading it; the viewer uses bundle.json
with open(os.path.join(REC, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(keys, fh)

size = os.path.getsize(os.path.join(REC, "bundle.json")) / 1024
print(f"\n{len(keys)} recreated pages bundled into bundle.json ({size:.0f} KB, build {stamp})")
if bad:
    print(f"{len(bad)} problems:")
    for b in bad[:20]:
        print("  " + b)
