"""Assemble rendered orthographic views into a dimensioned three-view sheet.

    python3 scripts/compose-three-view.py j16|fujian|enterprise|burke|type052d

Reads assets/three-views/raw/<name>_{side,top,front}.png and <name>_views.json
(written by scripts/render-three-views.py) and writes
assets/three-views/<Title>-three-view.png.
"""
import json
import sys
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'assets/three-views/raw'
CJK = next(f for f in ('/System/Library/Fonts/Hiragino Sans GB.ttc', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
                       '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc') if Path(f).exists())
INK, DIM, ACCENT, PAPER = (34, 38, 44), (40, 92, 160), (190, 60, 50), (250, 250, 247)

MODELS = {
    'j16': {
        'out': 'J-16-three-view.png',
        'title': '歼-16 多用途战斗机　三视图',
        'subtitle': 'Shenyang J-16 multirole fighter — three-view (Blender model)',
        'meta': 'assets/models/j16.metadata.json',
        'specs': ['机长 21.9 m（模型 21.90 m）', '翼展 14.7 m（模型含翼尖电子战吊舱 15.25 m）', '机高 6.36 m（模型 6.36 m）',
                  '外挂示意：6×PL-15（机腹 4 + 翼下 2）+ 2×PL-10 + 2×翼尖电子战吊舱'],
        'notes': ['底模：FGUK / FGMEMBERS SU-27 网格与解放军涂装（GPL-2.0），改为双座长座舱、后座舱、加高垂尾 0.42 m、',
                  '双前轮（去挡泥板）、翼尖电子战吊舱、PL-15/PL-10 挂载，重绘为歼-16 灰色涂装与五位舷号（示意编号）。',
                  '外形参考：日本防卫省 / 航空自卫队 2024-11 公开照片（CC BY 4.0）。尺寸取公开资料，非测绘图纸。'],
        'scale_bar': (5, 1),
        'span_label': '15.25 m（含吊舱）',
    },
    'fujian': {
        'out': 'Fujian-CV18-three-view.png',
        'title': '福建舰（舷号 18，003 型）航空母舰　三视图',
        'subtitle': 'PLAN Fujian (CV-18), Type 003 aircraft carrier — three-view (Blender model)',
        'meta': 'assets/models/fujian.metadata.json',
        'specs': ['全长 ≈316 m（模型 315.5 m）', '飞行甲板最大宽 ≈76 m（模型 76.5 m）', '水线宽 40 m · 吃水 11 m（估计）',
                  '飞行甲板距水线 17.5 m · 桅顶距水线 57 m（照片估算）', '3 部电磁弹射器 · 4 道拦阻索 · 斜角甲板 7.9° · 2 部舷侧升降机'],
        'notes': ['甲板平面依据 Gryfia 绘制的 Wikimedia Commons 线图（CC BY-SA 4.0）测量，校准到 316 m 全长与 76 m 甲板宽；',
                  '舰岛、高度依据日本防卫省统合幕僚监部 2025-09-11 照片（CC BY 4.0）与中新社甲板照片（CC BY 4.0）估算。',
                  '水下线型、吃水、螺旋桨与舵为常规航母的估计造型；武器为 HQ-10 与 H/PJ-11 的外形示意。'],
        'scale_bar': (50, 10),
        'span_label': None,
        # flight-deck width dimension: port X, starboard X, and the Y where each is measured
        'deck_dim': (39.17, -37.3, -70.7, -46.7),
    },
    'enterprise': {
        'out': 'Enterprise-CVN65-three-view.png',
        'title': '企业号（CVN-65）核动力航空母舰　三视图',
        'subtitle': 'USS Enterprise (CVN-65), final configuration — three-view (Blender model)',
        'meta': 'assets/models/enterprise.metadata.json',
        'specs': ['全长 342 m（模型 342.0 m）', '飞行甲板宽 78.3 m · 水线宽 40.5 m · 吃水约 11.3 m', '飞行甲板距水线 18.6 m（估计）',
                  '4 部蒸汽弹射器 · 4 道拦阻索 · 斜角甲板 9° · 4 部舷侧升降机（右舷 3 / 左舷 1）', '舰岛：SPS-48E / SPS-49 桅杆 · 海麻雀、RAM、密集阵为外形示意'],
        'notes': ['全部几何由 scripts/build-enterprise.py 程序生成，甲板图案由 scripts/enterprise-deck-texture.py 绘制；',
                  '尺寸取公开资料（GlobalSecurity、Naval Technology、美国海军历史与遗产司令部），布局按公开照片判读，',
                  '不是测绘图纸；水下线型、螺旋桨与舵为估计造型，舷号 65 绘于舰岛两侧与甲板。'],
        'scale_bar': (50, 10),
        'span_label': None,
        'deck_dim': (42.3, -36.0, 60.0, 60.0),
        'renderer': 'Blender 5.0（bpy）· Cycles',
    },
    'burke': {
        'out': 'Arleigh-Burke-DDG51-three-view.png',
        'title': '阿利·伯克级（Flight I）驱逐舰　三视图',
        'subtitle': 'Arleigh Burke-class destroyer, Flight I (DDG-51) — three-view (Blender model)',
        'meta': 'assets/models/burke.metadata.json',
        'specs': ['全长 153.8 m · 最大宽 20.3 m · 水线宽 18 m', '舰体吃水约 6.3 m（声呐罩处约 9.3 m）',
                  'Mk 45 127 mm 舰炮 · Mk 41 垂发 29 + 61 单元 · 2 座密集阵', '4 面 SPY-1D 阵面 · 3 部 SPG-62 照射雷达 · 2 组鱼叉 · 无机库直升机甲板'],
        'notes': ['全部几何由 scripts/build-burke.py 程序生成；尺寸取公开资料（GlobalSecurity、Seaforces），',
                  '布局按美国海军公开照片判读，不是测绘图纸。舷号 51 / 52 为独立对象，游戏中各舰只显示自己的舷号；',
                  '本图显示 51。水下线型、声呐罩、螺旋桨与舵为估计造型。'],
        'scale_bar': (20, 5),
        'span_label': None,
        'renderer': 'Blender 5.0（bpy）· Cycles',
    },
    'type052d': {
        'out': 'Type-052D-three-view.png',
        'title': '052D 型驱逐舰　三视图',
        'subtitle': 'PLAN Type 052D (Luyang III) destroyer — three-view (Blender model)',
        'meta': 'assets/models/type052d.metadata.json',
        'specs': ['全长 157 m · 最大宽 17.5 m · 水线宽 16.2 m', '吃水约 6.5 m（声呐罩处更深）',
                  '130 mm 主炮 · 垂发 32 + 32 单元 · H/PJ-12 近防炮 · 机库顶 24 联 HHQ-10',
                  '4 面 346A 阵面 · 518 型雷达 · 一体化桅杆 · 直升机机库与甲板'],
        'notes': ['全部几何由 scripts/build-052d.py 程序生成；尺寸取公开资料（Naval Technology 等，宽度有 17 / 18 m 两说），',
                  '布局按公开照片判读，不是测绘图纸。舷号 172 / 173 为独立对象，游戏中各舰只显示自己的舷号；',
                  '本图显示 172。水下线型、声呐罩、螺旋桨与舵为估计造型。'],
        'scale_bar': (20, 5),
        'span_label': None,
        'renderer': 'Blender 5.0（bpy）· Cycles',
    },
}

name = sys.argv[1]
cfg = MODELS[name]
info = json.loads((RAW / f'{name}_views.json').read_text())
meta = json.loads((ROOT / cfg['meta']).read_text())
(lo, hi) = info['bounds']
views = info['views']
ppm = views['side']['px_per_m']
imgs = {k: Image.open(RAW / v['file']).convert('RGBA') for k, v in views.items()}

M, GAP, HEAD, FOOT = 170, 230, 230, 420
sw, sh = imgs['side'].size
tw, th = imgs['top'].size
fw, fh = imgs['front'].size
W = M + sw + GAP + max(fw, 900) + M
H = M + HEAD + sh + GAP + th + FOOT
sheet = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(sheet)
F = lambda s: ImageFont.truetype(CJK, s)
pos = {'side': (M, M + HEAD), 'front': (M + sw + GAP, M + HEAD), 'top': (M, M + HEAD + sh + GAP)}
for k, (x, y) in pos.items():
    sheet.paste(imgs[k], (x, y), imgs[k])

def to_px(view, X=None, Y=None, Z=None):
    """World coordinate -> sheet pixel for a view (only the needed axes)."""
    v = views[view]; cx = v['center']; w_, h_ = v['size']; ox, oy = pos[view]
    world = {0: X, 1: Y, 2: Z}
    ax, sx = v['image_x']; ay, sy = v['image_y_up']
    px = py = None
    if world[ax] is not None:
        px = ox + w_ / 2 + sx * (world[ax] - cx[ax]) * ppm
    if world[ay] is not None:
        py = oy + h_ / 2 - sy * (world[ay] - cx[ay]) * ppm
    return px, py

def arrow(p, direction, size=16):
    x, y = p; dx, dy = direction
    pts = [(x, y), (x - dx * size - dy * size * 0.35, y - dy * size + dx * size * 0.35),
           (x - dx * size + dy * size * 0.35, y - dy * size - dx * size * 0.35)]
    d.polygon(pts, fill=DIM)

def dim_h(x0, x1, y, label, ext_from=None, size=34):
    if ext_from:
        for x, yy in zip((x0, x1), ext_from):
            d.line([(x, yy), (x, y + (8 if y > yy else -8))], fill=DIM, width=2)
    d.line([(x0, y), (x1, y)], fill=DIM, width=3)
    arrow((x0, y), (-1, 0)); arrow((x1, y), (1, 0))
    f = F(size); tw_ = d.textlength(label, font=f)
    d.rectangle([(x0 + x1) / 2 - tw_ / 2 - 10, y - size * 0.7, (x0 + x1) / 2 + tw_ / 2 + 10, y + size * 0.7], fill=PAPER)
    d.text(((x0 + x1) / 2, y), label, fill=DIM, font=f, anchor='mm')

def dim_v(y0, y1, x, label, ext_from=None, size=34):
    if ext_from:
        for y, xx in zip((y0, y1), ext_from):
            d.line([(xx, y), (x + (8 if x > xx else -8), y)], fill=DIM, width=2)
    d.line([(x, y0), (x, y1)], fill=DIM, width=3)
    arrow((x, y0), (0, -1) if y0 < y1 else (0, 1)); arrow((x, y1), (0, 1) if y0 < y1 else (0, -1))
    f = F(size)
    txt = Image.new('RGBA', (int(d.textlength(label, font=f)) + 24, size + 20), PAPER + (255,))
    ImageDraw.Draw(txt).text((txt.width / 2, txt.height / 2), label, fill=DIM, font=f, anchor='mm')
    txt = txt.rotate(90, expand=True)
    sheet.paste(txt, (int(x - txt.width / 2), int((y0 + y1) / 2 - txt.height / 2)))

# --- header ---------------------------------------------------------------
d.text((M, M), cfg['title'], fill=INK, font=F(76))
d.text((M, M + 100), cfg['subtitle'], fill=(90, 96, 104), font=F(38))
for k, label in (('side', '侧视图  SIDE (左舷 / PORT)'), ('front', '正视图  FRONT'), ('top', '俯视图  TOP')):
    x, y = pos[k]
    d.text((x, y - 58), label, fill=INK, font=F(40))

# --- dimensions ------------------------------------------------------------
Ymin, Ymax, Zmin, Zmax, Xmin, Xmax = lo[1], hi[1], lo[2], hi[2], lo[0], hi[0]
xa, _ = to_px('side', Y=Ymin); xb, _ = to_px('side', Y=Ymax)
_, z_top = to_px('side', Z=Zmax); _, z_bot = to_px('side', Z=Zmin)
length = meta.get('length', meta.get('length_overall'))
dim_h(xa, xb, pos['side'][1] + sh + 70, f'全长 {length:.2f} m', ext_from=(z_bot, z_bot))
height = meta.get('height', Zmax - Zmin)
dim_v(z_top, z_bot, pos['side'][0] - 70, f'高 {Zmax - Zmin:.2f} m', ext_from=(xa, xa))
fx0, _ = to_px('front', X=Xmin); fx1, _ = to_px('front', X=Xmax)
_, fz_bot = to_px('front', Z=Zmin)
if name == 'j16':
    dim_h(fx1, fx0, pos['front'][1] + fh + 70, '翼展 ' + cfg['span_label'], ext_from=(fz_bot, fz_bot))
    # height at fin tips in front view
    _, ft = to_px('front', Z=Zmax); _, fb = to_px('front', Z=0)
    dim_v(ft, fb, pos['front'][0] + fw + 60, f'机高 {meta["height"]:.2f} m', ext_from=(fx0, fx0))
    ty0, _ = to_px('top', Y=Ymin)
    _, tx0 = to_px('top', X=Xmin); _, tx1 = to_px('top', X=Xmax)
    dim_v(tx1, tx0, pos['top'][0] - 70, f'{Xmax - Xmin:.2f} m', ext_from=(ty0, ty0))
else:
    # waterline on side and front views
    for view in ('side', 'front'):
        _, wl = to_px(view, Z=0.0)
        x0, x1 = pos[view][0], pos[view][0] + views[view]['size'][0]
        for xx in range(int(x0), int(x1), 36):
            d.line([(xx, wl), (min(xx + 20, x1), wl)], fill=ACCENT, width=2)
        d.text((x0 - 10, wl), 'WL', fill=ACCENT, font=F(30), anchor='rm')
    carrier = 'flight_deck_height' in meta
    deck_z = meta['flight_deck_height'] if carrier else meta['deck_height_bow']
    _, fd = to_px('side', Z=deck_z); _, wl = to_px('side', Z=0.0)
    # short spans: plain dimension lines with horizontal labels beside them
    for y0_, y1_, label in ((fd, wl, f'{"甲板" if carrier else "艏部甲板"}距水线 {deck_z:.1f} m'), (wl, z_bot, f'吃水 {abs(Zmin):.1f} m')):
        d.line([(xb - 40, y0_), (xb + 90, y0_)], fill=DIM, width=2)
        d.line([(xb + 80, y0_), (xb + 80, y1_)], fill=DIM, width=3)
        arrow((xb + 80, y0_), (0, -1), 12); arrow((xb + 80, y1_), (0, 1), 12)
        d.text((xb + 100, (y0_ + y1_) / 2), label, fill=DIM, font=F(28), anchor='lm')
    d.line([(xb - 40, z_bot), (xb + 90, z_bot)], fill=DIM, width=2)
    # flight-deck (or hull) width on the top view
    ty, _ = to_px('top', Y=Ymin)
    if carrier:
        xp, xs, yp, ys = cfg['deck_dim']
        _, p0 = to_px('top', X=xp); _, p1 = to_px('top', X=xs)
        ex0, _ = to_px('top', Y=yp); ex1, _ = to_px('top', Y=ys)
        d.line([(ex0, p0), (ty - 60, p0)], fill=DIM, width=2); d.line([(ex1, p1), (ty - 60, p1)], fill=DIM, width=2)
        dim_v(p1, p0, ty - 70, f'甲板宽 {meta["flight_deck_width"]:.1f} m')
    else:
        _, p0 = to_px('top', X=Xmax); _, p1 = to_px('top', X=Xmin)
        dim_v(p1, p0, ty - 70, f'宽 {meta["beam_overall"]:.1f} m', ext_from=(ty, ty))
    # waterline beam on the front view
    hb = meta['waterline_beam'] / 2
    w0, _ = to_px('front', X=-hb); w1, _ = to_px('front', X=hb); _, wly = to_px('front', Z=0.0)
    dim_h(w0, w1, fz_bot + 70, f'水线宽 {meta["waterline_beam"]:.0f} m', ext_from=(wly, wly), size=30)

# --- perspective render in the free space beside the top view --------------
hero = RAW / f'{name}_hero_a.png'
if hero.exists():
    bx0 = pos['front'][0]; by0 = pos['top'][1]
    bw = W - M - bx0; bh = H - FOOT - 40 - by0
    im = Image.open(hero).convert('RGB')
    scale = min(bw / im.width, bh / im.height)
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    sheet.paste(im, (bx0, by0))
    d.rectangle([bx0, by0, bx0 + im.width, by0 + im.height], outline=INK, width=2)
    d.text((bx0, by0 - 58), '透视图  PERSPECTIVE (Cycles)', fill=INK, font=F(40))

# --- footer: specs, notes, scale bar ----------------------------------------
fy = H - FOOT + 40
d.line([(M, fy - 20), (W - M, fy - 20)], fill=(200, 200, 196), width=2)
for i, s in enumerate(cfg['specs']):
    d.text((M, fy + i * 50), '· ' + s, fill=INK, font=F(34))
nx = M + (W - 2 * M) * 0.42
for i, s in enumerate(cfg['notes']):
    d.text((nx, fy + i * 46), s, fill=(80, 86, 94), font=F(27))
length_m, step = cfg['scale_bar']
bx, by = nx, fy + 200
for k in range(int(length_m / step)):
    d.rectangle([bx + k * step * ppm, by, bx + (k + 1) * step * ppm, by + 18], fill=INK if k % 2 == 0 else PAPER, outline=INK)
for k in range(int(length_m / step) + 1):
    d.text((bx + k * step * ppm, by + 30), f'{k * step:g}', fill=INK, font=F(26), anchor='mt')
d.text((bx + length_m * ppm + 30, by + 9), f'm　比例尺 1 m = {ppm:g} px', fill=INK, font=F(28), anchor='lm')
d.text((W - M, H - 60), f'FROSTLINE 模型素材 · {cfg.get("renderer", "Blender 5.2")} 渲染 · {date.today().isoformat()}', fill=(120, 126, 132), font=F(26), anchor='rm')
d.rectangle([40, 40, W - 40, H - 40], outline=INK, width=4)
out = ROOT / 'assets/three-views' / cfg['out']
sheet.save(out, optimize=True)
print('wrote', out.relative_to(ROOT), sheet.size)
