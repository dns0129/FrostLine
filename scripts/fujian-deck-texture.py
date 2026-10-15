"""Paint the Fujian flight-deck texture (non-skid, markings, hull number).

Run with system Python 3 (numpy, scipy, Pillow):
    python3 scripts/fujian-deck-texture.py
Writes assets/models/fujian-source/textures/fujian_flight_deck.png.  The
Blender build maps it with u = (X_MAX - X) / X_SPAN, v = 1 - (Y + LOA/2) / LOA.
"""
import math
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import fujian_layout as F

OUT = ROOT / 'assets/models/fujian-source/textures/fujian_flight_deck.png'
W, H = 2048, 8192
X_MAX, X_SPAN = F.X_TEX_MAX, F.X_TEX_SPAN       # square texels: 25.92 px/m
SS = 2                                          # supersampling
PPM = W * SS / X_SPAN
FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'

DECK = (101, 99, 97)
WHITE, YELLOW, RED, ORANGE = (232, 232, 226), (226, 196, 40), (178, 38, 44), (200, 92, 48)
BLACK, STEEL = (28, 28, 30), (128, 130, 132)


def px(x, y):
    return ((X_MAX - x) * PPM, (y + F.LOA / 2) * PPM)


img = Image.new('RGB', (W * SS, H * SS), DECK)
d = ImageDraw.Draw(img)


def line(a, b, width, colour):
    d.line([px(*a), px(*b)], fill=colour, width=max(1, int(width * PPM)))


def dashed(a, b, width, colours, dash, gap=None):
    """Dashes of length `dash` along a->b, cycling `colours` (None = skip)."""
    gap = dash if gap is None else gap
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay); ux, uy = (bx - ax) / L, (by - ay) / L
    t, k = 0.0, 0
    while t < L:
        c = colours[k % len(colours)]
        e = min(L, t + dash)
        if c:
            line((ax + ux * t, ay + uy * t), (ax + ux * e, ay + uy * e), width, c)
        t = e + (gap if len(colours) == 1 else 0); k += 1


def offset(a, b, d_):
    """Line a->b shifted sideways by d_ metres (positive = port side, +X)."""
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay); nx, ny = (by - ay) / L, -(bx - ax) / L
    if nx < 0:
        nx, ny = -nx, -ny
    return (ax + nx * d_, ay + ny * d_), (bx + nx * d_, by + ny * d_)


def rect(r, colour=None, outline=None, width=0.3):
    x0, x1, y0, y1 = r
    a, b = px(x1, y0), px(x0, y1)
    d.rectangle([a, b], fill=colour, outline=outline, width=int(width * PPM) if outline else 0)


def hatched_border(r, width=0.6, stripe=0.8):
    x0, x1, y0, y1 = r
    rect(r, outline=YELLOW, width=width)
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    for a, b in zip(pts, pts[1:]):
        dashed(a, b, width * 0.55, [BLACK, None], stripe)


def ring(x, y, r, colour, width, dashes=None):
    cx, cy = px(x, y); R = r * PPM
    if not dashes:
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=colour, width=int(width * PPM))
        return
    for k in range(dashes):
        a0 = 360 * k / dashes; d.arc([cx - R, cy - R, cx + R, cy + R], a0, a0 + 360 / dashes * 0.55,
                                       fill=colour, width=int(width * PPM))


def text(s, x, y, height, colour, outline_only=False, angle=0):
    font = ImageFont.truetype(FONT, 400)
    l, t, r_, b = font.getbbox(s)
    g = Image.new('L', (r_ - l + 40, b - t + 40), 0)
    gd = ImageDraw.Draw(g)
    if outline_only:
        gd.text((20 - l, 20 - t), s, font=font, fill=255, stroke_width=26, stroke_fill=255)
        inner = Image.new('L', g.size, 0)
        ImageDraw.Draw(inner).text((20 - l, 20 - t), s, font=font, fill=255, stroke_width=4, stroke_fill=255)
        g = Image.fromarray(np.clip(np.array(g).astype(int) - np.array(inner), 0, 255).astype(np.uint8))
    else:
        gd.text((20 - l, 20 - t), s, font=font, fill=255)
    scale = height * PPM / g.height
    g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.LANCZOS)
    if angle:
        g = g.rotate(angle, expand=True, resample=Image.BICUBIC)
    cx, cy = px(x, y)
    img.paste(Image.new('RGB', g.size, colour), (int(cx - g.width / 2), int(cy - g.height / 2)), g)


# --- deck edge -----------------------------------------------------------
deck_poly = [px(*p) for p in F.DECK]
mask = Image.new('L', img.size, 0)
ImageDraw.Draw(mask).polygon(deck_poly, fill=255)
edge = Image.new('L', img.size, 0)
ImageDraw.Draw(edge).line(deck_poly + [deck_poly[0]], fill=255, width=int(1.5 * PPM))
inner_edge = Image.new('L', img.size, 0)
ImageDraw.Draw(inner_edge).line(deck_poly + [deck_poly[0]], fill=255, width=int(0.5 * PPM))
img.paste(Image.new('RGB', img.size, RED), (0, 0), edge)
img.paste(Image.new('RGB', img.size, (150, 150, 148)), (0, 0), inner_edge)

# --- landing area (angled deck) ------------------------------------------
a, b = F.LANDING_AXIS
ext = ((b[0] + (b[0] - a[0]) * 0.1), b[1] + (b[1] - a[1]) * 0.1)
dashed(a, ext, 0.9, [WHITE, YELLOW], 6.0)                       # centreline
for side in (1, -1):
    dashed(*offset(a, ext, side * 11.0), 0.9, [WHITE], 4.0)     # landing-area dashes
    line(*offset(a, ext, side * 13.0), 0.45, WHITE)
    line(*offset(a, ext, side * 14.6), 0.4, ORANGE)
    dashed(*offset(a, ext, side * 18.0), 0.6, [RED, WHITE], 2.5)  # foul lines
# touchdown aim-point bars
ux, uy = (b[0] - a[0]), (b[1] - a[1]); L = math.hypot(ux, uy); ux, uy = ux / L, uy / L
for k in range(3):
    cy = 50 + k * 6
    t = (cy - a[1]) / uy
    c = (a[0] + ux * t, a[1] + uy * t)
    for side in (1, -1):
        p0, p1 = offset((c[0], c[1]), (c[0] + ux * 3.0, c[1] + uy * 3.0), side * 6.0)
        line(p0, p1, 1.2, WHITE)

# --- catapults -----------------------------------------------------------
for (front, aft), jbd in zip(F.CATAPULTS, F.JBDS):
    for side in (1, -1):
        line(*offset(front, aft, side * 0.55), 0.14, (190, 190, 186))
    line(front, aft, 0.32, (38, 38, 40))
    # shuttle hold-back bar + yellow launch line
    p0, p1 = offset(aft, (aft[0], aft[1] + 1), 2.2)
    q0, q1 = offset(aft, (aft[0], aft[1] + 1), -2.2)
    line(p0, q0, 0.35, YELLOW)
    rect(jbd, (88, 89, 90), outline=(170, 160, 70), width=0.25)
    x0, x1, y0, y1 = jbd
    for k in range(1, 4):
        xx = x0 + (x1 - x0) * k / 4
        line((xx, y0), (xx, y1), 0.12, (60, 60, 62))
# --- elevators, hatches ----------------------------------------------------
for e in F.ELEVATORS:
    rect(e, (96, 95, 94))
    hatched_border(e)
for h in F.HATCHES:
    hatched_border(h, 0.35, 0.5)
# --- landing spots & lineup lines -----------------------------------------
for x, y, r, n, solid in F.SPOTS:
    ring(x, y, r, YELLOW, 0.45, None if solid else 10)
    text(n, x, y, 2.6, YELLOW)
    ring(x, y, 1.55, YELLOW, 0.25)
    line((x, y - r - 0.5), (x, y - r - 10.0), 0.45, YELLOW)
# --- arresting gear --------------------------------------------------------
for sx, sy in F.WIRE_STATIONS:
    t = ((sx - a[0]) * ux + (sy - a[1]) * uy)
    c = (a[0] + ux * t, a[1] + uy * t)
    p0 = (c[0] + uy * F.WIRE_HALF_SPAN, c[1] - ux * F.WIRE_HALF_SPAN)
    p1 = (c[0] - uy * F.WIRE_HALF_SPAN, c[1] + ux * F.WIRE_HALF_SPAN)
    line(p0, p1, 0.12, BLACK)
    for p in (p0, p1):
        line((p[0] - ux * 1.2, p[1] - uy * 1.2), (p[0] + ux * 1.2, p[1] + uy * 1.2), 0.5, BLACK)
# --- hull number on the bow ----------------------------------------------
text('18', -0.7, -146.4, 10.3, WHITE, outline_only=True)

# --- downsample, non-skid grain, wear, clip to deck -------------------------
img = img.resize((W, H), Image.LANCZOS)
mask = mask.resize((W, H), Image.LANCZOS)
arr = np.array(img).astype(float)
rng = np.random.default_rng(18)
grain = ndimage.gaussian_filter(rng.normal(0, 1, (H, W)), 0.7) * 5.5
blotch = ndimage.gaussian_filter(rng.normal(0, 1, (H // 8, W // 8)), 3)
blotch = np.array(Image.fromarray(((blotch - blotch.min()) / np.ptp(blotch) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)) / 255 - 0.5
arr += grain[..., None] + blotch[..., None] * 9
# tyre rubber along the landing area and exhaust soot behind the catapults
yy, xx = np.mgrid[0:H, 0:W]
Xw = X_MAX - (xx + 0.5) / W * X_SPAN
Yw = (yy + 0.5) / H * F.LOA - F.LOA / 2
along = (Xw - a[0]) * ux + (Yw - a[1]) * uy
across = (Xw - a[0]) * uy - (Yw - a[1]) * ux
streak = ndimage.gaussian_filter(rng.normal(0, 1, (H // 4, W // 4)), (6, 0.6))
streak = np.array(Image.fromarray(((streak - streak.min()) / np.ptp(streak) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)) / 255
rubber = np.exp(-(across / 5.0) ** 2) * np.clip((along - 130) / 25, 0, 1) * np.clip((215 - along) / 20, 0, 1)
arr *= (1 - 0.32 * rubber * streak)[..., None]
for (front, aft), jbd in zip(F.CATAPULTS, F.JBDS):
    jx, jy = (jbd[0] + jbd[1]) / 2, jbd[3]
    soot = np.exp(-((Xw - jx) / 5.5) ** 2 - ((Yw - jy - 4) / 6) ** 2)
    arr *= (1 - 0.35 * soot)[..., None]
# panel seams every 8 m across / 10 m along
seam = ((np.abs(((Xw + 0.0) % 8.0) - 4.0) > 3.96) | (np.abs((Yw % 10.0) - 5.0) > 4.96))
arr[seam] *= 0.9
out = np.clip(arr, 0, 255).astype(np.uint8)
m = np.array(mask) > 0
out[~m] = (112, 114, 116)
OUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(out).save(OUT, optimize=True)
print('wrote', OUT.relative_to(ROOT), (W, H))
