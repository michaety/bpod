"""Draw the social share card.

A designed title card in the book's own idiom - the cover's stack of colour
blocks beside Helvetica set flush left - rather than a scan of the printed
cover. 1200x630 is the size Open Graph consumers crop to.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

W, H = 1200, 630
PAPER = (253, 253, 251)
INK = (28, 28, 28)
RED = (226, 59, 40)
BLOCKS = [(51, 58, 143), (245, 158, 44), (77, 132, 196), (119, 113, 63)]

FONTS = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(bold, size):
    for p in FONTS:
        if os.path.exists(p) and (("bd" in p.lower() or "Bold" in p) == bold or not bold):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    for p in FONTS:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)

    # colour blocks, echoing the cover's four rows
    pad = 46
    col_w = 250
    gap = 12
    rows = len(BLOCKS)
    row_h = (H - pad * 2 - gap * (rows - 1)) // rows
    for i, c in enumerate(BLOCKS):
        y = pad + i * (row_h + gap)
        d.rectangle([pad, y, pad + col_w * 0.46, y + row_h], fill=RED)
        d.rectangle([pad + col_w * 0.46, y, pad + col_w, y + row_h], fill=c)

    x = pad + col_w + 62
    right = W - pad

    # rule, kicker, title, author - the cover's vertical order
    d.rectangle([x, pad + 18, right, pad + 22], fill=INK)
    f_kick = font(True, 21)
    d.text((x, pad + 36), "The Foundation Program at the School of Design", font=f_kick, fill=INK)
    d.text((x, pad + 64), "Basel, Switzerland", font=f_kick, fill=INK)

    f_title = font(True, 74)
    d.text((x, pad + 118), "Basic Principles", font=f_title, fill=INK)
    d.text((x, pad + 196), "of Design", font=f_title, fill=INK)

    d.rectangle([x, pad + 292, right, pad + 296], fill=INK)
    f_auth = font(True, 34)
    d.text((x, pad + 312), "Manfred Maier", font=f_auth, fill=INK)

    d.rectangle([x, pad + 364, right, pad + 367], fill=INK)

    f_sub = font(False, 20)
    subjects = [
        "Object Drawing   ·   Nature Drawing   ·   Memory Drawing",
        "Technical Drawing   ·   Lettering   ·   Material Studies",
        "Textile Design   ·   Color   ·   Graphic Exercises",
        "Dimensional Design",
    ]
    for i, s in enumerate(subjects):
        d.text((x, pad + 386 + i * 28), s, font=f_sub, fill=(90, 90, 90))

    f_foot = font(False, 19)
    d.text((x, H - pad - 26), "Four volumes · 432 pages · reader", font=f_foot, fill=(140, 140, 140))

    for p in (os.path.join(ROOT, "og.png"), os.path.join(ROOT, "site", "og.png")):
        im.save(p, "PNG", optimize=True)
        print(f"wrote {p} ({os.path.getsize(p)//1024} KB)")


if __name__ == "__main__":
    main()
