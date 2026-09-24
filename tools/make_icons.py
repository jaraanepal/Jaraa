#!/usr/bin/env python3
"""Generate all Jaraa logo/icon assets locally from the founder-uploaded logo.
Never uses the (down) media-generation tool. Pure PIL.
Input : ~/workspace/user/media_library/image/b6/b60063be6dde8a9d8efe39eb318c71fa76fa9d3fe8fab8bbc5b4a5108179851e.png
Output: ~/workspace/jaraa-pwa/jaraa-app/client/public/icons/* and logo files.
"""
import os
from PIL import Image

SRC = os.path.expanduser(
    "~/workspace/user/media_library/image/b6/b60063be6dde8a9d8efe39eb318c71fa76fa9d3fe8fab8bbc5b4a5108179851e.png"
)
OUT = os.path.expanduser("~/workspace/jaraa-pwa/jaraa-app/client/public")
ICONS = os.path.join(OUT, "icons")
os.makedirs(ICONS, exist_ok=True)

img = Image.open(SRC).convert("RGB")
W, H = img.size
print(f"source: {W}x{H}")

# Background (cream) sampled from corners
corners = [img.getpixel((5, 5)), img.getpixel((W - 6, 5)),
           img.getpixel((5, H - 6)), img.getpixel((W - 6, H - 6))]
bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
print(f"bg color: {bg}")

# 1) Full logo for header/footer/emails
img.save(os.path.join(OUT, "logo.png"))

# 2) Emblem crop: bounding box of dark pixels in the top 45% only
#    (the wordmark "Jaraa" starts below ~48% — it must not be included)
gray = img.convert("L")
px = gray.load()
dark_xs, dark_ys = [], []
for y in range(int(H * 0.45)):
    for x in range(0, W, 2):
        if px[x, y] < 150:
            dark_xs.append(x); dark_ys.append(y)
x0, x1 = min(dark_xs), max(dark_xs)
y0, y1 = min(dark_ys), max(dark_ys)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
side = max(x1 - x0, y1 - y0)
pad = int(side * 0.12)
half = side // 2 + pad
emblem = img.crop((max(0, cx - half), max(0, cy - half),
                   min(W, cx + half), min(H, cy + half)))
print(f"emblem crop: {emblem.size}")

# 3) Favicons from emblem
for s in (16, 32, 48):
    emblem.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, f"favicon-{s}.png"))
# multi-size favicon.ico
emblem.resize((48, 48), Image.LANCZOS).save(
    os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

# 4) Apple touch icon 180
img.resize((180, 180), Image.LANCZOS).save(os.path.join(ICONS, "apple-touch-icon.png"))

# 5) PWA icons 192 / 512 (full lockup)
img.resize((192, 192), Image.LANCZOS).save(os.path.join(ICONS, "icon-192.png"))
img.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "icon-512.png"))

# 6) Maskable 512: emblem centered at 80% on cream so safe-zone crops keep it
mask = Image.new("RGB", (512, 512), bg)
em = emblem.resize((410, 410), Image.LANCZOS)
mask.paste(em, ((512 - 410) // 2, (512 - 410) // 2))
mask.save(os.path.join(ICONS, "maskable-512.png"))

# 7) Social/avatar + email header variants
img.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "social-avatar.png"))
img.resize((600, 600), Image.LANCZOS).save(os.path.join(ICONS, "email-logo.png"))

print("done:")
for f in sorted(os.listdir(ICONS)):
    print(" -", f, os.path.getsize(os.path.join(ICONS, f)), "bytes")
