"""Paint the USS Enterprise flight-deck texture (non-skid, markings, hull number).

Run with Python 3 (numpy, scipy, Pillow), e.g. the same venv as bpy:
    python scripts/enterprise-deck-texture.py
Writes assets/models/enterprise-source/textures/enterprise_flight_deck.png.
The Blender build maps it with u = (X_MAX - X) / X_SPAN, v = 1 - (Y + LOA/2) / LOA.
"""
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import enterprise_layout as E

OUT = ROOT / 'assets/models/enterprise-source/textures/enterprise_flight_deck.png'
W, H = 2048, 8192
X_MAX, X_SPAN = E.X_TEX_MAX, E.X_TEX_SPAN
SS = 2
PPM = W * SS / X_SPAN
FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
         '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf']
FONT = next(f for f in FONTS if Path(f).exists())

DECK = (92, 94, 96)
WHITE, YELLOW, RED = (234, 234, 228), (222, 190, 48), (176, 40, 44)
BLACK, STEEL = (26, 26, 28), (126, 128, 130)


def px(x, y):
    return ((X_MAX - x) * PPM, (y + E.LOA / 2) * PPM)


img = Image.new('RGB', (W * SS, H * SS), DECK)
d = ImageDraw.Draw(img)


def line(a, b, width, colour):
    d.line([px(*a), px(*b)], fill=colour, width=max(1, int(width * PPM)))


def dashed(a, b, width, colours, dash, gap=None):
    gap = dash if gap is None else gap
    (ax, ay), (bx, by) = a, b
    L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
    t, k = 0.0, 0
    while t < L:
        c = colours[k % len(colours)]
        e = min(L, t + dash)
        if c:
            line((ax + ux * t, ay + uy * t), (ax + ux * e, ay + uy * e), width, c)
        t = e + (gap if len(colours) == 1 else 0); k += 1


def offset(a, b, d_):
    (ax, ay), (bx, by) = a, b
    L = math.hypot(bx - ax, by - ay); nx, ny = (by - ay) / L, -(bx - ax) / L
    if nx < 0:
        nx, ny = -nx, -ny
    return (ax + nx * d_, ay + ny * d_), (bx + nx * d_, by + ny * d_)


def rect(r, colour=None, outline=None, width=0.3):
    x0, x1, y0, y1 = r
    d.rectangle([px(x1, y0), px(x0, y1)], fill=colour, outline=outline, width=int(width * PPM) if outline else 0)


def hatched_border(r, width=0.6, stripe=0.8):
    x0, x1, y0, y1 = r
    rect(r, outline=YELLOW, width=width)
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    for a, b in zip(pts, pts[1:]):
        dashed(a, b, width * 0.55, [BLACK, None], stripe)


def text(s, x, y, height, colour, angle=0):
    font = ImageFont.truetype(FONT, 400)
    l, t, r_, b = font.getbbox(s)
    g = Image.new('L', (r_ - l + 40, b - t + 40), 0)
    ImageDraw.Draw(g).text((20 - l, 20 - t), s, font=font, fill=255)
    scale = height * PPM / g.height
    g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.LANCZOS)
    if angle:
        g = g.rotate(angle, expand=True, resample=Image.BICUBIC)
    cx, cy = px(x, y)
    img.paste(Image.new('RGB', g.size, colour), (int(cx - g.width / 2), int(cy - g.height / 2)), g)


# --- deck edge -------------------------------------------------------------
deck_poly = [px(*p) for p in E.DECK]
mask = Image.new('L', img.size, 0)
ImageDraw.Draw(mask).polygon(deck_poly, fill=255)
edge = Image.new('L', img.size, 0)
ImageDraw.Draw(edge).line(deck_poly + [deck_poly[0]], fill=255, width=int(1.0 * PPM))
img.paste(Image.new('RGB', img.size, WHITE), (0, 0), edge)

# --- angled landing area ---------------------------------------------------
a, b = E.LANDING_AXIS
dashed(a, b, 0.9, [WHITE], 6.0)                                   # centreline
for side in (1, -1):
    line(*offset(a, b, side * 12.0), 0.5, WHITE)                  # landing-area edges
    dashed(*offset(a, b, side * 16.5), 0.6, [RED, WHITE], 2.5)    # foul lines
ux, uy = b[0] - a[0], b[1] - a[1]; L = math.hypot(ux, uy); ux, uy = ux / L, uy / L
for k in range(4):                                                 # drop-line bars at the round-down
    t = L - 6 - k * 2.2
    c = (a[0] + ux * t, a[1] + uy * t)
    line(*offset(c, (c[0] + ux, c[1] + uy), 9.0), 0.0001, WHITE)
    p0 = (c[0] + uy * 9.0, c[1] - ux * 9.0); p1 = (c[0] - uy * 9.0, c[1] + ux * 9.0)
    line(p0, p1, 0.5, WHITE if k % 2 else YELLOW)

# --- catapults, blast deflectors -------------------------------------------
for (front, aft), jbd in zip(E.CATAPULTS, E.JBDS):
    for side in (1, -1):
        line(*offset(front, aft, side * 0.55), 0.14, (190, 190, 186))
    line(front, aft, 0.3, (40, 40, 42))
    p0, p1 = offset(aft, (aft[0], aft[1] + 1), 2.4)
    q0, q1 = offset(aft, (aft[0], aft[1] + 1), -2.4)
    line(p0, q0, 0.35, YELLOW)
    dashed((front[0], front[1] + 4), (aft[0], aft[1]), 0.25, [YELLOW], 3.0, 5.0)
    rect(jbd, (86, 87, 88), outline=(170, 160, 70), width=0.25)
# --- elevators, safe-parking line and taxi lines ------------------------------
for e in E.ELEVATORS:
    rect(e, (98, 97, 96))
    hatched_border(e)
dashed((-20.0, -100.0), (-20.0, 100.0), 0.3, [YELLOW], 4.0, 4.0)
dashed((-14.0, -165.0), (-14.0, -105.0), 0.3, [YELLOW], 4.0, 4.0)
# --- arresting gear --------------------------------------------------------
for wy in E.WIRE_Y:
    t = (wy - a[1]) / uy
    c = (a[0] + ux * t, a[1] + uy * t)
    p0 = (c[0] + uy * E.WIRE_HALF_SPAN, c[1] - ux * E.WIRE_HALF_SPAN)
    p1 = (c[0] - uy * E.WIRE_HALF_SPAN, c[1] + ux * E.WIRE_HALF_SPAN)
    line(p0, p1, 0.12, BLACK)
    for p in (p0, p1):
        line((p[0] - ux * 1.2, p[1] - uy * 1.2), (p[0] + ux * 1.2, p[1] + uy * 1.2), 0.5, BLACK)
# --- hull number on the bow (reads from aft) and on the stern (reads from aft) --
text('65', 0.0, -150.0, 14.0, WHITE)
text('65', 9.0, 155.0, 9.0, WHITE)

# --- downsample, non-skid grain, wear, clip to deck -------------------------
img = img.resize((W, H), Image.LANCZOS)
mask = mask.resize((W, H), Image.LANCZOS)
arr = np.array(img).astype(float)
rng = np.random.default_rng(65)
grain = ndimage.gaussian_filter(rng.normal(0, 1, (H, W)), 0.7) * 5.5
blotch = ndimage.gaussian_filter(rng.normal(0, 1, (H // 8, W // 8)), 3)
blotch = np.array(Image.fromarray(((blotch - blotch.min()) / np.ptp(blotch) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)) / 255 - 0.5
arr += grain[..., None] + blotch[..., None] * 9
yy, xx = np.mgrid[0:H, 0:W]
Xw = X_MAX - (xx + 0.5) / W * X_SPAN
Yw = (yy + 0.5) / H * E.LOA - E.LOA / 2
along = (Xw - a[0]) * ux + (Yw - a[1]) * uy
across = (Xw - a[0]) * uy - (Yw - a[1]) * ux
streak = ndimage.gaussian_filter(rng.normal(0, 1, (H // 4, W // 4)), (6, 0.6))
streak = np.array(Image.fromarray(((streak - streak.min()) / np.ptp(streak) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)) / 255
rubber = np.exp(-(across / 5.0) ** 2) * np.clip((along - 140) / 25, 0, 1) * np.clip((215 - along) / 20, 0, 1)
arr *= (1 - 0.32 * rubber * streak)[..., None]
for jbd in E.JBDS:
    jx, jy = (jbd[0] + jbd[1]) / 2, jbd[3]
    soot = np.exp(-((Xw - jx) / 5.5) ** 2 - ((Yw - jy - 4) / 6) ** 2)
    arr *= (1 - 0.35 * soot)[..., None]
seam = ((np.abs((Xw % 8.0) - 4.0) > 3.96) | (np.abs((Yw % 10.0) - 5.0) > 4.96))
arr[seam] *= 0.9
out = np.clip(arr, 0, 255).astype(np.uint8)
out[~(np.array(mask) > 0)] = (110, 112, 114)
OUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(out).save(OUT, optimize=True)
print('wrote', OUT.relative_to(ROOT), (W, H))
