"""Generate the Android launcher icons and splash screens from the boar artwork.
Usage: python scripts/android-icons.py <boar.png rendered from ui/img/boar.svg>   (needs Pillow)"""
import os
import sys
from PIL import Image, ImageDraw

RES = "mobile/android/app/src/main/res"
BG = (30, 26, 21, 255)
GOLD = (201, 162, 94, 255)

boar = Image.open(sys.argv[1]).convert("RGBA")
boar = boar.crop(boar.getbbox())


def place(canvas, frac):
    w = int(canvas.width * frac)
    h = int(boar.height * w / boar.width)
    canvas.alpha_composite(boar.resize((w, h), Image.LANCZOS), ((canvas.width - w) // 2, (canvas.height - h) // 2))
    return canvas


icon = Image.open("build/icon.png").convert("RGBA")
for d, k in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    n, f = int(48 * k), int(108 * k)
    # Adaptive icon foreground: the boar inside the safe zone, background colour comes from XML
    place(Image.new("RGBA", (f, f), (0, 0, 0, 0)), 0.56).save(f"{RES}/mipmap-{d}/ic_launcher_foreground.png")
    icon.resize((n, n), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher.png")
    big = n * 4
    r = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(r).ellipse([0, 0, big - 1, big - 1], fill=BG, outline=GOLD, width=max(2, big // 24))
    place(r, 0.66).resize((n, n), Image.LANCZOS).save(f"{RES}/mipmap-{d}/ic_launcher_round.png")

for root, _, files in os.walk(RES):
    for fn in files:
        if fn == "splash.png":
            p = os.path.join(root, fn)
            w, h = Image.open(p).size
            s = Image.new("RGBA", (w, h), (22, 19, 15, 255))
            place(s, 0.38 if w < h else 0.24).convert("RGB").save(p)
print("icons and splash written")
