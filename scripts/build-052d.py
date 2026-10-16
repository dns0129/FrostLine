"""Build the editable Type 052D (Luyang III) destroyer model in Blender.

Run from the project root with Blender or the `bpy` module (5.x):
    python scripts/build-052d.py

Layout: 130 mm H/PJ-45 gun, 32-cell forward VLS, H/PJ-12 CIWS ahead of the
bridge, faceted forward superstructure with four Type 346A arrays and an
integrated mast, single wide funnel, 32-cell aft VLS amidships, Type 518
rotating radar on the aft tower, hangar with the 24-cell HHQ-10 on its roof
and a helicopter deck aft.  Hull numbers 172 and 173 are separate objects so
the game shows each ship's own number.  Dimensions: about 157 m overall,
17.5 m beam, 6.5 m draft.  A game-scale outline of public photographs and
published figures, not ship drawings.  Axes: metres, +Z up, waterline at
Z = 0, bow toward -Y, +X = port.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import blender_kit as K
import ship_kit as S

SRC = ROOT / 'assets/models/type052d-source'
BLEND = SRC / 'Type-052D.blend'
GLB = ROOT / 'assets/models/type052d.glb'
META = ROOT / 'assets/models/type052d.metadata.json'
NUMBERS = ['172', '173']
srgb, obj = S.srgb, S.obj
LOA, HALF_DECK, HALF_WL, DRAFT = 157.0, 8.75, 8.1, 6.5

sc = K.reset_scene()
C_HULL = K.collection('052D hull')
C_SUP = K.collection('052D superstructure')
C_WEAP = K.collection('052D weapons & sensors')
C_UNDER = K.collection('052D underwater')

M_HULL = K.material('PLAN hull grey', srgb(146, 152, 157), rough=0.62)
M_SUP = K.material('PLAN superstructure grey', srgb(158, 164, 168), rough=0.58)
M_DECK = K.material('Deck non-skid', srgb(78, 86, 84), rough=0.95)
M_BOOT = K.material('Boot-top black', srgb(36, 36, 38), rough=0.7)
M_RED = K.material('Antifouling red', srgb(118, 44, 40), rough=0.75)
M_DARK = K.material('Opening shadow', srgb(18, 19, 21), rough=0.9)
M_WINDOW = K.material('Bridge glass', srgb(16, 26, 36), rough=0.08, spec=0.9)
M_ARRAY = K.material('Type 346A array face', srgb(104, 110, 116), rough=0.42)
M_STEEL = K.material('Fittings steel', srgb(84, 86, 88), rough=0.45, metal=0.6)
M_PROP = K.material('Propeller bronze', srgb(176, 132, 78), rough=0.3, metal=1.0)
M_WHITE = K.material('White fittings', srgb(226, 228, 226), rough=0.5)
M_YELLOW = K.material('Deck marking yellow', srgb(214, 182, 50), rough=0.7)
M_LINE = K.material('Deck marking white', srgb(230, 230, 224), rough=0.7)
M_NUMBER = K.material('Hull number white', srgb(236, 236, 232), rough=0.5)
M_SHADOW = K.material('Hull number shadow', srgb(24, 24, 26), rough=0.6)

# ----------------------------------------------------------------- hull ----
SHEER = [(-78.5, 10.4), (-60, 9.3), (-40, 8.5), (-20, 7.9), (20, 7.5), (45, 6.6), (78.5, 5.6)]
sheer = lambda y: K.interp(SHEER, y)
UW = [-DRAFT, -5.8, -4.8, -3.6, -2.4, -1.3, -0.4, 0.9]
FR = [0.2, 0.45, 0.72, 1.0]
STEM_UW = [(-DRAFT, -66.0), (-5.8, -68.5), (-4.8, -70.5), (-3.6, -71.7), (-2.4, -72.3), (-1.3, -72.6), (-0.4, -72.8), (0.9, -73.2)]
STEM_TOP = [(0.2, -74.2), (0.45, -75.6), (0.72, -77.0), (1.0, -78.5)]
STERN_UW = [(-DRAFT, 36.0), (-5.8, 50.0), (-4.8, 61.0), (-3.6, 69.0), (-2.4, 74.5), (-1.3, 77.6), (-0.4, 78.2), (0.9, 78.5)]
STERN_TOP = [(0.2, 78.5), (1.0, 78.5)]
FLARE = [(-78.5, 0.6), (-60, 0.4), (-40, 0.2), (-20, 0.1), (40, 0.1), (78.5, 0.12)]
Y_MID_F, Y_MID_A = -26.0, 32.0

def wl_half(y):
    if y < Y_MID_F:
        s = max(0.0, (y + 72.8) / (Y_MID_F + 72.8))
        return HALF_WL * math.sin(math.pi / 2 * s) ** 0.9
    if y > Y_MID_A:
        s = min(1.0, (y - Y_MID_A) / (78.5 - Y_MID_A))
        return HALF_WL - (HALF_WL - 6.9) * s ** 1.6
    return HALF_WL

def half_breadth(y, z):
    w = wl_half(y)
    if z >= 0:
        # flare up to a knuckle 2 m below the deck edge, then near-vertical topsides
        knuckle = sheer(y) - 2.0
        hb = w + min(z, knuckle) * K.interp(FLARE, y) + max(0.0, z - knuckle) * 0.04
        return min(HALF_DECK, hb)
    t = min(1.0, -z / DRAFT)
    fwd = K.smoothstep(-20, -55, y)
    hb = w * max(0.0, 1 - t ** (4.6 - 3.0 * fwd)) ** (0.5 + 0.25 * fwd)
    y_aft = K.interp(STERN_UW, z)
    if y > Y_MID_A and z < -1.3:
        s = min(1.0, (y - Y_MID_A) / max(1.0, y_aft - Y_MID_A))
        hb *= max(0.0, 1 - s ** 2.4) ** 0.55
    return hb

hull, rows = S.hull_loft('Hull (waterline at Z=0)', C_HULL, (M_RED, M_BOOT, M_HULL), uw_levels=UW, top_fracs=FR,
                         stem_uw=STEM_UW, stern_uw=STERN_UW, stem_top=STEM_TOP, stern_top=STERN_TOP,
                         half_breadth=half_breadth, sheer=sheer, transom_from=-1.3, samples=64)
S.deck_from_rows('Weather deck', rows, C_HULL, M_DECK, lift=0.01)
dome = K.lathe([(0.0, 0.0), (1.5, 1.1), (4.0, 1.6), (8.0, 1.65), (13.0, 1.2), (18.0, 0.0)], 18)
obj('Bow sonar dome', K.transform(dome, Matrix.Translation((0, -72.0, -7.0)) @ Matrix.Diagonal((0.85, 1.0, 1.3, 1.0))), C_UNDER, M_RED, smooth=True)
obj('Deck-edge guard rails', S.deck_edge_rail(rows, -76.0, 77.5, 1.0, 2.2), C_HULL, M_STEEL)
obj('Bilge keels', K.merge(*[K.oriented_box((s * 7.4, 4.0, -4.8), (0, 1, 0), (s, 0, -1.2), (0.2, 48.0, 0.8)) for s in (1, -1)]), C_UNDER, M_RED)
# Forecastle breakwater ahead of the gun
bw = [K.oriented_box((s * 2.6, -60.0 + 1.2, sheer(-60) + 0.45), (s * 0.85, -0.5, 0), (0, 0, 1), (0.15, 6.2, 0.9)) for s in (1, -1)]
obj('Breakwater', K.merge(*bw), C_HULL, M_HULL)

# ------------------------------------------------------- superstructure ----
z_f = sheer(-10) - 0.6
obj('Forward superstructure 01 level', S.house(-7.4, 7.4, -26.5, 7.0, z_f, 10.8, lean=0.7, chamfer=1.5), C_SUP, M_SUP, silhouette=True)
obj('Bridge level', S.house(-6.6, 6.6, -22.5, 5.0, 10.8, 14.2, lean=0.8, chamfer=2.0, lean_fore=1.2), C_SUP, M_SUP, silhouette=True)
upper = S.house(-6.0, 6.0, -19.0, 3.5, 14.2, 19.6, lean=1.0, chamfer=3.4, lean_fore=0.9, lean_aft=0.9)
obj('Array deckhouse', upper, C_SUP, M_SUP, silhouette=True)
win = [K.box(0, -22.3 + 0.55, 13.2, 9.0, 0.14, 1.0)] + [K.box(s * 6.15, -17.5, 13.2, 0.14, 7.0, 0.9) for s in (1, -1)]
obj('Bridge windows', K.merge(*win), C_SUP, M_WINDOW)
arrays = []
for sx, sy, y_face in ((1, -1, -19.0), (-1, -1, -19.0), (1, 1, 3.5), (-1, 1, 3.5)):
    c = Vector((sx * (6.0 - 1.7 - 0.5), y_face - sy * 1.7 + sy * 0.45, 16.8))
    arrays.append(S.face_panel(tuple(c), (sx, sy, 0.26), (0, 0, 1), 4.0, 4.4, 0.3))
obj('Type 346A arrays (4)', K.merge(*arrays), C_WEAP, M_ARRAY)
mast = K.loft_outlines([[(x, y, 19.6) for x, y in K.chamfer_rect(-3.2, 3.2, -12.5, -1.0, 1.2)],
                        [(x, y, 25.0) for x, y in K.chamfer_rect(-2.0, 2.0, -9.5, -3.2, 0.7)],
                        [(x, y, 28.6) for x, y in K.chamfer_rect(-0.9, 0.9, -7.6, -5.2, 0.3)]])
obj('Integrated mast', mast, C_SUP, M_SUP, silhouette=True)
pole = [K.cylinder_z(0, -6.4, 28.6, 35.0, 0.22, 0.1, 10), K.sweep([(-3.0, -6.4, 31.0), (3.0, -6.4, 31.0)], 0.09, 6)]
obj('Mast pole & yard', K.merge(*pole), C_SUP, M_STEEL, smooth=True)
domes = [K.sphere((0, -6.4, 29.4), 0.75, 14, 7)] + [K.sphere((s * 2.4, -10.8, 20.4), 0.8, 14, 7) for s in (1, -1)]
obj('Mast radomes', K.merge(*domes), C_WEAP, M_WHITE, smooth=True)
decoys = [K.oriented_box((s * 7.3, -6.0 + k * 2.0, 11.6), (s * 0.6, -0.4, 0.6), (0, 0, 1), (1.2, 1.0, 0.9)) for s in (1, -1) for k in (0, 1)]
obj('Type 726 decoy launchers', K.merge(*decoys), C_WEAP, M_SUP)
# Funnel (single, wide, stealth faceted)
z_m = sheer(12) - 0.6
obj('Midships deckhouse', S.house(-6.8, 6.8, 7.0, 33.0, z_m, 10.6, lean=0.6, chamfer=1.0), C_SUP, M_SUP, silhouette=True)
obj('Funnel', S.house(-3.8, 3.8, 8.0, 16.5, 10.6, 18.0, lean=0.7, chamfer=1.4, lean_fore=1.2, lean_aft=-0.3), C_SUP, M_SUP, silhouette=True)
obj('Funnel exhaust grilles', K.merge(*[K.box(s * 1.35, 13.2, 18.12, 1.9, 5.2, 0.2) for s in (1, -1)]), C_SUP, M_DARK)
# Type 518 tower and rotating array
obj('Radar tower', S.house(-2.8, 2.8, 26.0, 32.5, 10.6, 17.2, lean=0.5, chamfer=0.8), C_SUP, M_SUP, silhouette=True)
r518 = [K.box(0, 29.2, 17.6, 1.4, 1.4, 0.8)]
for k in range(8):
    r518.append(K.box(-3.5 + k, 29.2, 19.2, 0.85, 0.35, 2.6))
obj('Type 518 radar array', K.merge(*r518), C_WEAP, M_ARRAY)
# Hangar with HHQ-10 on the roof
z_h = sheer(45) - 0.6
obj('Hangar', S.house(-6.6, 6.6, 33.0, 57.5, z_h, 13.0, lean=0.6, chamfer=1.2, lean_aft=0.1), C_SUP, M_SUP, silhouette=True)
obj('Hangar door', K.box(0, 57.38, (z_h + 11.6) / 2 + 0.3, 7.4, 0.14, 11.6 - z_h - 1.0), C_SUP, M_DARK)
boats = []
for s in (1, -1):
    boats.append(K.box(s * 6.95, 21.0, 8.6, 0.12, 8.0, 2.4))
obj('Boat bay doors', K.merge(*boats), C_SUP, M_DARK)

# ----------------------------------------------------------------- weapons --
obj('H/PJ-45 130 mm gun', S.gun_hpj45(0, -52.0, sheer(-52)), C_WEAP, M_SUP)
frame_f, hatch_f = S.vls_grid(-3.3, 3.3, -44.0, -36.0, sheer(-40), 4, 8)
frame_a, hatch_a = S.vls_grid(-3.3, 3.3, 17.5, 25.5, 10.6, 4, 8)
obj('VLS (32 + 32 cells)', K.merge(frame_f, frame_a), C_WEAP, M_DECK)
obj('VLS hatches', K.merge(hatch_f, hatch_a), C_WEAP, M_DARK)
m, barrels = S.ciws_chinese(0, -24.4, 10.8, (0, -1, 0))
obj('H/PJ-12 CIWS', m, C_WEAP, M_SUP, smooth=True)
obj('H/PJ-12 barrels', barrels, C_WEAP, M_STEEL)
hq, caps = S.box_launcher(0, 53.0, 13.0, (0, -1, 0), size=(3.2, 2.6, 2.4), elev=0, cells=(6, 4))
obj('HHQ-10 launcher (24 cells)', hq, C_WEAP, M_SUP)
obj('HHQ-10 cell covers', caps, C_WEAP, M_DARK)
eo = [S.illuminator(s * 4.2, -16.0, 19.6, 0.7, (s * 0.4, -1, 0))[0] for s in (1, -1)]
obj('Fire-control directors', K.merge(*eo), C_WEAP, M_SUP)
bits = []
for y in (-70.0, -64.0, 68.0, 74.0):
    for s in (1, -1):
        bits.append(K.cylinder_z(s * (S.edge_x(rows, y, s) - 1.4), y, sheer(y), sheer(y) + 0.6, 0.22, 0.22, 8))
bits += [K.cylinder_z(s * 1.5, -67.0, sheer(-67), sheer(-67) + 0.5, 0.55, 0.5, 12) for s in (1, -1)]
obj('Bitts & windlass', K.merge(*bits), C_HULL, M_STEEL)

# ------------------------------------------------------- helicopter deck ----
zh = lambda y: sheer(y) + 0.03
ring = []
for k in range(40):
    a0, a1 = 2 * math.pi * k / 40, 2 * math.pi * (k + 1) / 40
    p0 = (5.2 * math.cos(a0), 68.0 + 5.2 * math.sin(a0)); p1 = (5.2 * math.cos(a1), 68.0 + 5.2 * math.sin(a1))
    c = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    ring.append(K.oriented_box((c[0], c[1], zh(c[1]) + 0.005), (p1[0] - p0[0], p1[1] - p0[1], 0), (0, 0, 1), (0.35, 0.86, 0.02)))
obj('Helicopter deck circle', K.merge(*ring, K.box(0, 68.0, zh(68) + 0.006, 0.35, 19.0, 0.02)), C_HULL, M_YELLOW)
lines = [K.box(s * 6.4, 68.0, zh(68), 0.25, 19.0, 0.02) for s in (1, -1)] + [K.box(0, 58.6, zh(58.6), 13.0, 0.25, 0.02)]
obj('Helicopter deck edge lines', K.merge(*lines), C_HULL, M_LINE)

# ----------------------------------------------------------- hull numbers ----
for number in NUMBERS:
    parts = []
    for side in (1, -1):
        parts += S.hull_number(number, side, -57.0, 6.2, 3.1, hull, C_HULL, M_NUMBER, offset=0.06, shadow=M_SHADOW)
    for ob in parts:
        if number != NUMBERS[0]:
            ob.hide_render = True           # hidden from renders only: viewport-hidden objects skip the export rotation

# --------------------------------------------------------------- underwater --
S.propulsion([(s * 4.2, 63.0, -4.9, 30.0, -5.8) for s in (1, -1)], C_UNDER, M_PROP, M_RED, blades=5, prop_r=2.3,
             rudders=[(s * 4.2, 67.5, 71.0, -1.8, -6.1) for s in (1, -1)])

S.finish(sc, 'Type 052D destroyer', {
    'model': 'PLAN Type 052D (Luyang III) destroyer, hull numbers 172 / 173',
    'license': 'Original procedural model (FrostLine); layout from public photographs and published figures'},
    BLEND, GLB, META, ROOT, {
        'waterline_beam': round(2 * HALF_WL, 2), 'deck_height_bow': SHEER[0][1], 'deck_height_stern': SHEER[-1][1],
        'hull_numbers': NUMBERS, 'license': 'Original procedural model',
        'references': ['https://en.wikipedia.org/wiki/Type_052D_destroyer',
                       'https://www.naval-technology.com/projects/luyang-052d-destroyers/']},
    cam=(120, -150, 60))
