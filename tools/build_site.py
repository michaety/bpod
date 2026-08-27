import io
import json
import os
import re
import sys
from multiprocessing import Pool

import cv2
import numpy as np
import pymupdf
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
BOOKS = sorted(
    f for f in os.listdir(ROOT)
    if f.startswith("Manfred Maier") and f.endswith(".pdf")
)

_doc_cache = {}


def get_doc(path):
    if path not in _doc_cache:
        _doc_cache[path] = pymupdf.open(path)
    return _doc_cache[path]


def merge_boxes(boxes):
    boxes = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        out = []
        while boxes:
            a = boxes.pop()
            ax0, ay0, ax1, ay1 = a
            i = 0
            while i < len(boxes):
                b = boxes[i]
                if not (ax1 < b[0] - 15 or b[2] < ax0 - 15 or ay1 < b[1] - 15 or b[3] < ay0 - 15):
                    ax0, ay0 = min(ax0, b[0]), min(ay0, b[1])
                    ax1, ay1 = max(ax1, b[2]), max(ay1, b[3])
                    boxes.pop(i)
                    merged = True
                else:
                    i += 1
            out.append([ax0, ay0, ax1, ay1])
        boxes = out
    return boxes


def segment_line(words):
    """Split a Tesseract line into segments at large horizontal gaps."""
    words.sort(key=lambda w: w[0])
    total_chars = sum(len(w[4]) for w in words) or 1
    char_w = sum(w[2] for w in words) / total_chars
    gap_thresh = max(2.5 * char_w, 30)
    segs = [[words[0]]]
    for prev, cur in zip(words, words[1:]):
        if cur[0] - (prev[0] + prev[2]) > gap_thresh:
            segs.append([cur])
        else:
            segs[-1].append(cur)
    return segs


def process_page(args):
    book_idx, pno, pdf_path, img_dir = args
    doc = get_doc(pdf_path)
    page = doc[pno]
    pix = page.get_pixmap()
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    W, H = img.size
    arr = np.array(img)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    scan_name = f"p{pno:03d}_scan.jpg"
    img.save(os.path.join(img_dir, scan_name), quality=80)

    data = pytesseract.image_to_data(img, lang="eng", output_type=pytesseract.Output.DICT)

    mask = np.zeros(gray.shape, np.uint8)
    line_words = {}
    n = len(data["text"])
    for i in range(n):
        txt = data["text"][i].strip()
        if not txt or int(data["conf"][i]) <= 30:
            continue
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        if h > H * 0.2 or w > W * 0.95:
            continue
        cv2.rectangle(mask, (x - 5, y - 5), (x + w + 5, y + h + 5), 255, -1)
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        line_words.setdefault(key, []).append([x, y, w, h, txt])

    lines = []
    for key in sorted(line_words):
        for seg in segment_line(line_words[key]):
            x0 = min(w[0] for w in seg)
            y0 = min(w[1] for w in seg)
            x1 = max(w[0] + w[2] for w in seg)
            y1 = max(w[1] + w[3] for w in seg)
            heights = sorted(w[3] for w in seg)
            h_med = heights[len(heights) // 2]
            text = " ".join(w[4] for w in seg)
            lines.append({
                "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                "fs": round(h_med * 1.08), "t": text,
            })
    lines.sort(key=lambda l: (l["y"], l["x"]))

    ink_raw = (gray < 160).astype(np.uint8)
    ink = ink_raw * 255
    ink[mask > 0] = 0
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    ncomp, labels, stats, _ = cv2.connectedComponentsWithStats(ink)
    boxes = []
    for x, y, w, h, area in stats[1:]:
        if area < 3500:
            continue
        density = ink_raw[y:y + h, x:x + w].sum() / (w * h)
        if density < 0.02:
            continue
        boxes.append([int(x), int(y), int(x + w), int(y + h)])
    boxes = merge_boxes(boxes)

    images = []
    for ridx, (x0, y0, x1, y1) in enumerate(sorted(boxes, key=lambda b: (b[1], b[0]))):
        x0 = max(0, x0 - 4)
        y0 = max(0, y0 - 4)
        x1 = min(W, x1 + 4)
        y1 = min(H, y1 + 4)
        crop = img.crop((x0, y0, x1, y1))
        name = f"p{pno:03d}_r{ridx}.jpg"
        crop.save(os.path.join(img_dir, name), quality=85)
        images.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "src": f"img/{name}"})

    for l in lines:
        for im in images:
            ox = max(0, min(l["x"] + l["w"], im["x"] + im["w"]) - max(l["x"], im["x"]))
            oy = max(0, min(l["y"] + l["h"], im["y"] + im["h"]) - max(l["y"], im["y"]))
            if ox * oy > 0.6 * l["w"] * l["h"]:
                l["ov"] = 1
                break

    return {
        "n": pno + 1, "w": W, "h": H, "scan": f"img/{scan_name}",
        "lines": lines, "images": images,
    }


def main():
    only_book = int(sys.argv[1]) if len(sys.argv) > 1 else None
    page_limit = int(sys.argv[2]) if len(sys.argv) > 2 else None

    for bi, pdf in enumerate(BOOKS, start=1):
        if only_book and bi != only_book:
            continue
        pdf_path = os.path.join(ROOT, pdf)
        data_dir = os.path.join(SITE, "data", f"book{bi}")
        img_dir = os.path.join(data_dir, "img")
        os.makedirs(img_dir, exist_ok=True)

        doc = pymupdf.open(pdf_path)
        npages = len(doc)
        doc.close()
        if page_limit:
            npages = min(npages, page_limit)

        tasks = [(bi, p, pdf_path, img_dir) for p in range(npages)]
        with Pool(4) as pool:
            pages = []
            for i, result in enumerate(pool.imap(process_page, tasks)):
                pages.append(result)
                if (i + 1) % 10 == 0 or i + 1 == npages:
                    print(f"book {bi}: {i + 1}/{npages} pages", flush=True)

        vol = re.search(r"Design\. (\d)", pdf).group(1)
        book = {
            "book": bi,
            "title": f"Basic Principles of Design — Volume {vol}",
            "pages": pages,
        }
        with open(os.path.join(data_dir, "pages.json"), "w", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False)
        print(f"book {bi} done: {len(pages)} pages", flush=True)


if __name__ == "__main__":
    main()
