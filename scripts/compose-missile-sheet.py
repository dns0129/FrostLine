"""Assemble the real-scale missile comparison sheet.

    python3 scripts/compose-missile-sheet.py

Reads assets/three-views/raw/missile_<id>_{side,top,front}.png (rendered by
scripts/render-three-views.py at one shared px/m) and
assets/models/missiles/missiles.metadata.json; writes
assets/three-views/Missiles-real-scale.png.
"""
import json
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'assets/three-views/raw'
CJK = '/System/Library/Fonts/Hiragino Sans GB.ttc'
INK, DIM, MUTED, PAPER = (34, 38, 44), (40, 92, 160), (96, 102, 110), (250, 250, 247)
ORDER = [('YJ-83', 'yj83'), ('PL-15', 'pl15'), ('PL-10', 'pl10'), ('HQ-10', 'hq10')]
F = lambda s: ImageFont.truetype(CJK, s)

meta = json.loads((ROOT / 'assets/models/missiles/missiles.metadata.json').read_text())['missiles']
views = {mid: json.loads((RAW / f'missile_{mid}_views.json').read_text()) for _, mid in ORDER}
imgs = {(mid, v): Image.open(RAW / f'missile_{mid}_{v}.png').convert('RGBA')
        for _, mid in ORDER for v in ('side', 'top', 'front')}
ppm = views['yj83']['views']['side']['px_per_m']

M, LABEL, GAP, ROWGAP, HEAD, FOOT = 150, 560, 120, 110, 260, 900
side_w = max(imgs[(mid, 'side')].width for _, mid in ORDER)
front_w = max(max(imgs[(mid, 'front')].width for _, mid in ORDER), 520)
rows_h = [max(430, imgs[(mid, 'side')].height + 40 + imgs[(mid, 'top')].height) for _, mid in ORDER]
W = M + LABEL + side_w + GAP + front_w + M
H = M + HEAD + sum(rows_h) + ROWGAP * (len(ORDER) - 1) + FOOT
sheet = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(sheet)

d.text((M, M), '导弹模型　真实比例对照（侧视 / 俯视 / 正视）', fill=INK, font=F(72))
d.text((M, M + 96), 'PL-15 · PL-10 · HQ-10 · YJ-83 — all views at one scale (Blender models)', fill=MUTED, font=F(36))
for x, label in ((M + LABEL, '侧视图 SIDE（上）/ 俯视图 TOP（下）'), (M + LABEL + side_w + GAP, '正视图 FRONT')):
    d.text((x, M + HEAD - 70), label, fill=INK, font=F(34))

def arrow(x, y, dx):
    d.polygon([(x, y), (x - dx * 14, y - 6), (x - dx * 14, y + 6)], fill=DIM)

y = M + HEAD
for (kind, mid), rh in zip(ORDER, rows_h):
    info = meta[kind]
    side, top, front = imgs[(mid, 'side')], imgs[(mid, 'top')], imgs[(mid, 'front')]
    sx = M + LABEL
    sheet.paste(side, (sx, y), side)
    sheet.paste(top, (sx, y + side.height + 40), top)
    sheet.paste(front, (M + LABEL + side_w + GAP, y + (side.height - front.height) // 2), front)
    # length dimension between the side and top views
    v = views[mid]['views']['side']
    lo, hi = views[mid]['bounds']
    x0 = sx + v['size'][0] / 2 + (lo[1] - v['center'][1]) * ppm
    x1 = sx + v['size'][0] / 2 + (hi[1] - v['center'][1]) * ppm
    dy = y + side.height + 18
    d.line([(x0, dy), (x1, dy)], fill=DIM, width=2); arrow(x0, dy, -1); arrow(x1, dy, 1)
    lab = f'{info["length_m"]:.3f} m'
    tw = d.textlength(lab, font=F(26))
    d.rectangle([(x0 + x1) / 2 - tw / 2 - 8, dy - 16, (x0 + x1) / 2 + tw / 2 + 8, dy + 16], fill=PAPER)
    d.text(((x0 + x1) / 2, dy), lab, fill=DIM, font=F(26), anchor='mm')
    # label column
    d.text((M, y), kind, fill=INK, font=F(56))
    d.text((M, y + 74), info['title'], fill=INK, font=F(30))
    d.text((M, y + 116), info['role'], fill=MUTED, font=F(24))
    lines = [f'全长 {info["length_m"]:.3f} m　弹径 {info["body_diameter_m"]:.3f} m',
             f'翼/舵尖圆直径 {info["fin_tip_diameter_m"]:.2f} m' + ('' if kind == 'YJ-83' else '（估）')]
    if info['mass_kg']:
        lines.append(f'质量约 {info["mass_kg"]} kg（公开数据）')
    for i, s in enumerate(lines):
        d.text((M, y + 160 + i * 38), s, fill=DIM, font=F(26))
    y += rh + ROWGAP
    d.line([(M, y - ROWGAP / 2), (W - M, y - ROWGAP / 2)], fill=(220, 220, 214), width=1)

# 1.75 m person for scale, in the front-view column next to the small missiles
fx = M + LABEL + side_w + GAP + front_w // 2
foot = M + HEAD + sum(rows_h) + ROWGAP * (len(ORDER) - 1) - 10
h = 1.75 * ppm
c = (150, 154, 160)
d.ellipse([fx - 0.11 * ppm, foot - h, fx + 0.11 * ppm, foot - h + 0.24 * ppm], fill=c)
d.rounded_rectangle([fx - 0.22 * ppm, foot - h + 0.27 * ppm, fx + 0.22 * ppm, foot - 0.85 * ppm], 0.08 * ppm, fill=c)
d.rectangle([fx - 0.19 * ppm, foot - 0.88 * ppm, fx - 0.03 * ppm, foot], fill=c)
d.rectangle([fx + 0.03 * ppm, foot - 0.88 * ppm, fx + 0.19 * ppm, foot], fill=c)
d.rectangle([fx - 0.30 * ppm, foot - h + 0.30 * ppm, fx - 0.23 * ppm, foot - 0.95 * ppm], fill=c)
d.rectangle([fx + 0.23 * ppm, foot - h + 0.30 * ppm, fx + 0.30 * ppm, foot - 0.95 * ppm], fill=c)
d.text((fx, foot + 14), '人 1.75 m（比例参考）', fill=MUTED, font=F(24), anchor='mt')

# footer: perspective render, notes, scale bar
fy = H - FOOT + 30
hero = RAW / 'missiles_hero_a.png'
if hero.exists():
    im = Image.open(hero).convert('RGB')
    s = (FOOT - 120) / im.height
    im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    sheet.paste(im, (W - M - im.width, fy))
    d.rectangle([W - M - im.width, fy, W - M, fy + im.height], outline=INK, width=2)
notes = ['长度、弹径、YJ-83 翼展与质量取公开资料：PL-15E 3.996 m / 0.203 m / ≈210 kg；PL-10 3.0 m / 0.16 m / 89 kg；',
         'HQ-10 ≈2.0 m / 0.127 m；YJ-83（舰射型含助推器）6.38 m / 0.36 m / 翼展 1.22 m / ≈800 kg。',
         '舵面弦长、展长、安装位置、分段环与色带未公开，按公开照片估计；外形为示意，不是测绘图纸。',
         '模型：assets/models/missiles/*.glb（+Y 向上、弹头朝 -Z、原点在弹长中点）；源文件 Missiles.blend。',
         '独立模型，尚未接入游戏；游戏内歼-16 仍用 j16.glb 原有挂载（见 MISSILES-ART.md）。']
for i, s in enumerate(notes):
    d.text((M, fy + i * 44), s, fill=MUTED, font=F(26))
bx, by = M, fy + len(notes) * 44 + 50
for k in range(4):
    d.rectangle([bx + k * 0.5 * ppm, by, bx + (k + 1) * 0.5 * ppm, by + 18], fill=INK if k % 2 == 0 else PAPER, outline=INK)
for k in range(5):
    d.text((bx + k * 0.5 * ppm, by + 30), f'{k * 0.5:g}', fill=INK, font=F(24), anchor='mt')
d.text((bx + 2 * ppm + 24, by + 9), f'm　比例尺 1 m = {ppm:g} px', fill=INK, font=F(26), anchor='lm')
d.text((M, H - 70), f'FROSTLINE 模型素材 · Blender 5.2 · {date.today().isoformat()}', fill=(120, 126, 132), font=F(24), anchor='lm')
d.rectangle([40, 40, W - 40, H - 40], outline=INK, width=4)
out = ROOT / 'assets/three-views/Missiles-real-scale.png'
sheet.save(out, optimize=True)
print('wrote', out.relative_to(ROOT), sheet.size)
