"""Repaint the GPL FGUK Su-27 PLAAF livery into a J-16 grey scheme.

Keeps the source panel lines, stencils, cockpit/engine detail and PLAAF
stars; removes the Su-27 bort numbers, unit badges and tail stripes, then
paints a new five-digit number where the old fin numbers were.

Run with system Python 3 (needs numpy, scipy, Pillow):
    python3 scripts/j16-livery.py
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets/models/j16-source/source-assets/Liveries/PLAAF2Div.png'
OUT = ROOT / 'assets/models/j16-source/textures/j16_plaaf_grey.png'
NUMBER = '70316'               # generic five-digit PLAAF style number
J16_GREY = np.array([104, 112, 121], float)   # sRGB, medium blue-grey
DIGIT_COLOR = (38, 42, 48)
FONT = '/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf'

img = np.array(Image.open(SRC).convert('RGB')).astype(float)
rgb = img.copy()
mx, mn = rgb.max(2), rgb.min(2)
sat = (mx - mn) / (mx + 1e-3)
lum = rgb @ np.array([0.299, 0.587, 0.114])

# --- 1. masks of markings to erase -------------------------------------
blue = (rgb[..., 2] > rgb[..., 0] + 40) & (rgb[..., 2] > rgb[..., 1] + 15) & (sat > 0.3)
coloured = (sat > 0.18) | (lum < 140)
erase = np.zeros(lum.shape, bool)
def box(x0, y0, x1, y1, m):
    erase[y0:y1, x0:x1] |= m[y0:y1, x0:x1]
# bort numbers "48" (nose sides, fins) and "14438" (fins, rear fuselage)
for b in [(1005, 70, 1047, 128), (1202, 70, 1244, 128), (1448, 319, 1490, 377),
          (532, 1925, 574, 1983), (1593, 454, 1631, 538), (395, 1759, 433, 1843),
          (1772, 841, 1801, 899)]:
    box(*b, blue)
# unit badges next to the fin stars (all colours inside the box)
for b in [(1550, 410, 1606, 464), (420, 1836, 474, 1890)]:
    box(*b, coloured)
# blue/yellow unit stripes on the tail
for b in [(1736, 945, 1837, 1093), (1901, 945, 2002, 1093)]:
    box(*b, (sat > 0.25))
erase = ndimage.binary_dilation(erase, iterations=2)
number_boxes = {'fin_a': (1593, 454, 1631, 538, blue), 'fin_b': (395, 1759, 433, 1843, blue)}
old_number_masks = {k: blue[y0:y1, x0:x1].copy() for k, (x0, y0, x1, y1, _) in number_boxes.items()}

# --- 2. inpaint erased pixels from surrounding paint (normalized convolution)
known = ~erase
out = rgb.copy()
for c in range(3):
    ch = np.where(known, rgb[..., c], 0)
    filled = ch.copy()
    w = known.astype(float)
    for sigma in (2, 4, 8, 16):
        num = ndimage.gaussian_filter(ch, sigma)
        den = ndimage.gaussian_filter(w, sigma)
        est = num / np.maximum(den, 1e-4)
        filled = np.where(~known & (den > 0.05), est, filled)
        known_c = known | (den > 0.05)
    out[..., c] = np.where(erase, filled, rgb[..., c])
rgb = out

# --- 3. recolour the light-grey paint to the J-16 grey ----------------------
mx, mn = rgb.max(2), rgb.min(2)
sat = (mx - mn) / (mx + 1e-3)
lum = rgb @ np.array([0.299, 0.587, 0.114])
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
orange = (rgb[..., 0] > 225) & (rgb[..., 1] > 165) & (rgb[..., 1] < 220) & (rgb[..., 2] < 175) & (rgb[..., 0] - rgb[..., 2] > 60)
paint_w = smooth(0.14, 0.07, sat) * smooth(118, 150, lum)
ref = np.median(lum[paint_w > 0.9])
shade = np.clip(lum / ref, 0.55, 1.25)[..., None]
repaint = J16_GREY[None, None, :] * shade
rgb = rgb * (1 - paint_w[..., None]) + repaint * paint_w[..., None]
# unused atlas space plus its anti-aliased rim; avoids orange seams and mip bleeding
rim = ndimage.binary_dilation(orange, iterations=3) & (rgb[..., 0] - rgb[..., 2] > 22)
rgb[orange | rim] = J16_GREY

# --- 4. new fin numbers in place of the old ones ---------------------------
# Orientations checked on rendered side views: the port fin island (fin_a)
# needs the text turned 90 deg counter-clockwise; the starboard island
# (fin_b) is mirrored in v, so it gets the clockwise text flipped top-bottom.
canvas = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
font = ImageFont.truetype(FONT, 64)
l, t, r, b = font.getbbox(NUMBER)
text = Image.new('L', (r - l + 4, b - t + 4), 0)
ImageDraw.Draw(text).text((2 - l, 2 - t), NUMBER, font=font, fill=255)
for key, (x0, y0, x1, y1, _) in number_boxes.items():
    ys, xs = np.nonzero(old_number_masks[key])
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    g = (text.rotate(90, expand=True) if key == 'fin_a'
         else text.rotate(270, expand=True).transpose(Image.FLIP_TOP_BOTTOM))
    g = g.resize((bx1 - bx0, by1 - by0), Image.LANCZOS)
    canvas.paste(Image.new('RGB', g.size, DIGIT_COLOR), (x0 + bx0, y0 + by0), g)

OUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUT, optimize=True)
print('wrote', OUT.relative_to(ROOT), canvas.size, 'paint reference lum', round(float(ref), 1))
