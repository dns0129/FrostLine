"""Assemble a real-scale missile comparison sheet.

    python3 scripts/compose-missile-sheet.py cn|us

Reads assets/three-views/raw/missile_<id>_{side,top,front}.png (rendered by
scripts/render-three-views.py at one shared px/m), the group's lineup render
missiles_<group>_hero_a.png and assets/models/missiles/missiles.metadata.json;
writes assets/three-views/Missiles-real-scale-CN.png or -US.png.
"""
import json
import sys
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'assets/three-views/raw'
CJK = '/System/Library/Fonts/Hiragino Sans GB.ttc'
INK, DIM, MUTED, PAPER = (34, 38, 44), (40, 92, 160), (96, 102, 110), (250, 250, 247)
GROUPS = {
    'cn': {'order': [('YJ-83', 'yj83'), ('YJ-83K', 'yj83k'), ('PL-15', 'pl15'), ('PL-10', 'pl10'), ('HQ-10', 'hq10')],
           'title': '中国导弹模型　真实比例对照（侧视 / 俯视 / 正视）',
           'subtitle': 'YJ-83 · YJ-83K · PL-15 · PL-10 · HQ-10 — all views at one scale (Blender models)',
           'notes': ['长度、弹径、翼展与质量取公开资料：PL-15E 3.996 m / 0.203 m / ≈210 kg；PL-10 3.0 m / 0.16 m / 89 kg；',
                     'HQ-10 ≈2.0 m / 0.127 m；YJ-83（舰射型含助推器）6.38 m / 0.36 m / 翼展 1.22 m / ≈800 kg；YJ-83K 长 5.2 m 为估计。',
                     '舵面弦长、展长、安装位置、分段环与色带未公开，按公开照片估计；外形为示意，不是测绘图纸。',
                     '游戏中：歼-16 挂载与发射 PL-15 / PL-10 / 鹰击-83K；052D 与 D-21 发射 HQ-10 / YJ-83。']},
    'us': {'order': [('RGM-84', 'rgm84'), ('SM-2MR', 'sm2mr'), ('AGM-84D', 'agm84d'), ('AIM-7M', 'aim7m'), ('AIM-120C', 'aim120c'), ('AIM-9M', 'aim9m')],
           'title': '美国导弹模型　真实比例对照（侧视 / 俯视 / 正视）',
           'subtitle': 'RGM-84 · SM-2MR · AGM-84D · AIM-7M · AIM-120C · AIM-9M — all views at one scale (Blender models)',
           'notes': ['长度、弹径、翼展与质量取公开资料：AIM-9M 2.87 m / 0.127 m / 0.63 m；AIM-120C 3.65 m / 0.178 m / 0.48 m；',
                     'AIM-7M 3.66 m / 0.203 m / 1.0 m；AGM-84D 3.84 m / 0.343 m / 0.914 m；RGM-84 4.63 m；SM-2MR 4.72 m / 0.343 m / 1.07 m。',
                     '舵面弦长、安装位置、分段环与色带未公开，按公开照片估计；外形为示意，不是测绘图纸。',
                     '游戏中：大黄蜂挂载与发射 AIM-9M / AIM-120C / AIM-7M / 鱼叉；伯克级发射 SM-2MR / RGM-84；敌机来袭导弹显示 AIM-7M。']},
}
GROUP = sys.argv[1] if len(sys.argv) > 1 else 'cn'
CFG = GROUPS[GROUP]
ORDER = CFG['order']
F = lambda s: ImageFont.truetype(CJK, s)

meta = json.loads((ROOT / 'assets/models/missiles/missiles.metadata.json').read_text())['missiles']
views = {mid: json.loads((RAW / f'missile_{mid}_views.json').read_text()) for _, mid in ORDER}
imgs = {(mid, v): Image.open(RAW / f'missile_{mid}_{v}.png').convert('RGBA')
        for _, mid in ORDER for v in ('side', 'top', 'front')}
ppm = views[ORDER[0][1]]['views']['side']['px_per_m']

M, LABEL, GAP, ROWGAP, HEAD, FOOT = 150, 560, 120, 110, 260, 900
side_w = max(imgs[(mid, 'side')].width for _, mid in ORDER)
front_w = max(max(imgs[(mid, 'front')].width for _, mid in ORDER), 520)
rows_h = [max(430, imgs[(mid, 'side')].height + 40 + imgs[(mid, 'top')].height) for _, mid in ORDER]
W = M + LABEL + side_w + GAP + front_w + M
H = M + HEAD + sum(rows_h) + ROWGAP * (len(ORDER) - 1) + FOOT
sheet = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(sheet)

d.text((M, M), CFG['title'], fill=INK, font=F(72))
d.text((M, M + 96), CFG['subtitle'], fill=MUTED, font=F(36))
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
    lines = [f'全长 {info["length_m"]:.3f} m' + ('（估）' if kind == 'YJ-83K' else '') + f'　弹径 {info["body_diameter_m"]:.3f} m',
             f'翼/舵尖圆直径 {info["fin_tip_diameter_m"]:.2f} m' + ('（估）' if kind in ('PL-15', 'PL-10', 'HQ-10') else '')]
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
hero = RAW / f'missiles_{GROUP}_hero_a.png'
text_right = W - M
if hero.exists():
    im = Image.open(hero).convert('RGB')
    s = min((FOOT - 120) / im.height, (W - 2 * M) * 0.45 / im.width)
    im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    sheet.paste(im, (W - M - im.width, fy))
    d.rectangle([W - M - im.width, fy, W - M, fy + im.height], outline=INK, width=2)
    text_right = W - M - im.width - 60
notes = CFG['notes'] + ['模型：assets/models/missiles/*.glb（+Y 向上、弹头朝 -Z、原点在弹长中点）；游戏用低面数版本 missiles-game.glb。']
def wrap(text, font, width):
    """Break a (mostly CJK) line by characters to fit `width` pixels."""
    lines, cur = [], ''
    for ch in text:
        if cur and d.textlength(cur + ch, font=font) > width:
            lines.append(cur); cur = ch
        else:
            cur += ch
    return lines + [cur]
note_font, line = F(26), 0
for s in notes:
    for part in wrap(s, note_font, text_right - M):
        d.text((M, fy + line * 40), part, fill=MUTED, font=note_font); line += 1
bx, by = M, fy + line * 40 + 50
for k in range(4):
    d.rectangle([bx + k * 0.5 * ppm, by, bx + (k + 1) * 0.5 * ppm, by + 18], fill=INK if k % 2 == 0 else PAPER, outline=INK)
for k in range(5):
    d.text((bx + k * 0.5 * ppm, by + 30), f'{k * 0.5:g}', fill=INK, font=F(24), anchor='mt')
d.text((bx + 2 * ppm + 24, by + 9), f'm　比例尺 1 m = {ppm:g} px', fill=INK, font=F(26), anchor='lm')
d.text((M, H - 70), f'FROSTLINE 模型素材 · Blender 5.2 · {date.today().isoformat()}', fill=(120, 126, 132), font=F(24), anchor='lm')
d.rectangle([40, 40, W - 40, H - 40], outline=INK, width=4)
out = ROOT / f'assets/three-views/Missiles-real-scale-{GROUP.upper()}.png'
sheet.save(out, optimize=True)
print('wrote', out.relative_to(ROOT), sheet.size)
