"""Build the editable Arleigh Burke-class (Flight I) destroyer model in Blender.

Run from the project root with Blender or the `bpy` module (5.x):
    python scripts/build-burke.py

Flight I layout (DDG-51 to DDG-71): Mk 45 5-inch gun, 29-cell forward and
61-cell aft Mk 41 VLS, forward deckhouse carrying all four SPY-1D arrays, raked
tripod mast, two funnels, Harpoon quads, aft deckhouse with two SPG-62
illuminators and the aft Phalanx, and a helicopter deck without a hangar.
Hull numbers 51 and 52 are modelled as separate objects so the game shows
each ship's own number.  Dimensions: 153.8 m overall, 20.3 m beam, about
6.3 m hull draft (9.3 m at the sonar dome).  A game-scale outline of public
U.S. Navy photographs, not ship drawings.  Axes: metres, +Z up, waterline at
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

SRC = ROOT / 'assets/models/burke-source'
BLEND = SRC / 'Arleigh-Burke-DDG.blend'
GLB = ROOT / 'assets/models/burke.glb'
META = ROOT / 'assets/models/burke.metadata.json'
NUMBERS = ['51', '52']
srgb, obj = S.srgb, S.obj
LOA, HALF_DECK, HALF_WL, DRAFT = 153.8, 10.15, 9.0, 6.3

sc = K.reset_scene()
C_HULL = K.collection('Burke hull')
C_SUP = K.collection('Burke superstructure')
C_WEAP = K.collection('Burke weapons & sensors')
C_UNDER = K.collection('Burke underwater')

M_HULL = K.material('USN haze grey', srgb(124, 132, 137), rough=0.6)
M_DECK = K.material('Deck non-skid', srgb(72, 76, 80), rough=0.95)
M_BOOT = K.material('Boot-top black', srgb(36, 36, 38), rough=0.7)
M_RED = K.material('Antifouling red', srgb(110, 44, 40), rough=0.75)
M_DARK = K.material('Opening shadow', srgb(18, 19, 21), rough=0.9)
M_WINDOW = K.material('Bridge glass', srgb(16, 26, 36), rough=0.08, spec=0.9)
M_ARRAY = K.material('SPY-1D array face', srgb(98, 105, 111), rough=0.45)
M_STEEL = K.material('Fittings steel', srgb(84, 86, 88), rough=0.45, metal=0.6)
M_CAP = K.material('Funnel cap black', srgb(28, 28, 30), rough=0.8)
M_PROP = K.material('Propeller bronze', srgb(176, 132, 78), rough=0.3, metal=1.0)
M_WHITE = K.material('White fittings', srgb(226, 228, 226), rough=0.5)
M_LINE = K.material('Deck marking white', srgb(230, 230, 224), rough=0.7)
M_NUMBER = K.material('Hull number white', srgb(236, 236, 232), rough=0.5)
M_SHADOW = K.material('Hull number shadow', srgb(24, 24, 26), rough=0.6)

# ----------------------------------------------------------------- hull ----
SHEER = [(-76.9, 10.6), (-60, 9.4), (-40, 8.3), (-20, 7.6), (20, 7.1), (45, 6.1), (76.9, 5.4)]
sheer = lambda y: K.interp(SHEER, y)
UW = [-DRAFT, -5.6, -4.6, -3.4, -2.2, -1.2, -0.4, 0.9]
FR = [0.25, 0.5, 0.75, 1.0]
STEM_UW = [(-DRAFT, -65.0), (-5.6, -67.5), (-4.6, -68.0), (-3.4, -69.4), (-2.2, -70.0), (-1.2, -70.3), (-0.4, -70.5), (0.9, -71.0)]
STEM_TOP = [(0.25, -72.4), (0.5, -73.9), (0.75, -75.4), (1.0, -76.9)]
STERN_UW = [(-DRAFT, 38.0), (-5.6, 50.0), (-4.6, 60.0), (-3.4, 68.0), (-2.2, 73.5), (-1.2, 76.3), (-0.4, 76.7), (0.9, 76.9)]
STERN_TOP = [(0.25, 76.9), (1.0, 76.9)]
FLARE = [(-76.9, 0.62), (-60, 0.42), (-40, 0.26), (-20, 0.17), (40, 0.16), (76.9, 0.14)]
Y_MID_F, Y_MID_A = -28.0, 34.0

def wl_half(y):
    y_fwd = -70.5
    if y < Y_MID_F:
        s = max(0.0, (y - y_fwd) / (Y_MID_F - y_fwd))
        return HALF_WL * math.sin(math.pi / 2 * s) ** 0.85
    if y > Y_MID_A:
        s = min(1.0, (y - Y_MID_A) / (76.9 - Y_MID_A))
        return HALF_WL - (HALF_WL - 7.4) * s ** 1.6
    return HALF_WL

def half_breadth(y, z):
    w = wl_half(y)
    if z >= 0:
        return min(HALF_DECK, w + z * K.interp(FLARE, y))
    t = min(1.0, -z / DRAFT)
    fwd = K.smoothstep(-20, -55, y)
    p, q = 5.0 - 3.2 * fwd, 0.5 + 0.25 * fwd
    hb = w * max(0.0, 1 - t ** p) ** q
    y_aft = K.interp(STERN_UW, z)
    if y > Y_MID_A and z < -1.2:                        # run aft below the transom
        s = min(1.0, (y - Y_MID_A) / max(1.0, y_aft - Y_MID_A))
        hb *= max(0.0, 1 - s ** 2.4) ** 0.55
    return hb

hull, rows = S.hull_loft('Hull (waterline at Z=0)', C_HULL, (M_RED, M_BOOT, M_HULL), uw_levels=UW, top_fracs=FR,
                         stem_uw=STEM_UW, stern_uw=STERN_UW, stem_top=STEM_TOP, stern_top=STERN_TOP,
                         half_breadth=half_breadth, sheer=sheer, transom_from=-1.2, samples=64)
S.deck_from_rows('Weather deck', rows, C_HULL, M_DECK, lift=0.01)
# SQS-53 bow dome: a bulb under the forefoot whose upper half sits inside the keel line.
dome = K.lathe([(0.0, 0.0), (1.6, 1.25), (4.5, 1.8), (9.0, 1.85), (15.0, 1.3), (21.0, 0.0)], 18)
obj('SQS-53 sonar dome', K.transform(dome, Matrix.Translation((0, -70.0, -6.9)) @ Matrix.Scale(1.0, 4, (0, 0, 1)) @ Matrix.Diagonal((0.85, 1.0, 1.35, 1.0))), C_UNDER, M_RED, smooth=True)
obj('Deck-edge guard rails', S.deck_edge_rail(rows, -74.0, 76.0, 1.0, 2.2), C_HULL, M_STEEL)
obj('Bilge keels', K.merge(*[K.oriented_box((s * 8.2, 5.0, -4.6), (0, 1, 0), (s, 0, -1.2), (0.2, 50.0, 0.9)) for s in (1, -1)]), C_UNDER, M_RED)

# ------------------------------------------------------- superstructure ----
z01 = sheer(-10)
fwd_house = S.house(-7.6, 7.6, -27.0, 6.0, z01 - 0.6, 10.2, lean=0.5, chamfer=2.0)
obj('Forward deckhouse 01 level', fwd_house, C_SUP, M_HULL, silhouette=True)
bridge = S.house(-6.6, 6.6, -22.0, 3.5, 10.2, 15.2, lean=0.8, chamfer=3.6, lean_fore=0.6)
obj('Forward deckhouse SPY-1D levels', bridge, C_SUP, M_HULL, silhouette=True)
pilot = S.house(-5.2, 5.2, -20.5, -9.5, 15.2, 17.6, lean=0.5, chamfer=1.2)
obj('Pilot house', pilot, C_SUP, M_HULL, silhouette=True)
wings = K.merge(*[K.box(s * 6.6, -18.8, 15.4, 3.0, 2.8, 0.4) for s in (1, -1)])
obj('Bridge wings', wings, C_SUP, M_HULL)
win = [K.box(0, -20.62, 16.7, 8.6, 0.14, 1.1)] + [K.box(s * 5.0, -15.5, 16.7, 0.14, 9.0, 1.0) for s in (1, -1)]
obj('Bridge windows', K.merge(*win), C_SUP, M_WINDOW)
# Four SPY-1D arrays on the 45-degree corner faces of the deckhouse
arrays = []
for sx, sy, y_face in ((1, -1, -22.0), (-1, -1, -22.0), (1, 1, 3.5), (-1, 1, 3.5)):
    corner = Vector((sx * (6.6 - 1.8 - 0.4), y_face - sy * 1.8 + sy * 0.4, 12.9))
    normal = Vector((sx, sy, 0.22)).normalized()
    arrays.append(S.face_panel(tuple(corner), tuple(normal), (0, 0, 1), 3.7, 3.7, 0.28))
obj('SPY-1D arrays (4)', K.merge(*arrays), C_WEAP, M_ARRAY)
mast = S.lattice_mast((0, -14.0, 17.6), 34.0, 2.4, legs=3, rungs=5, radius=0.16, rake=3.2)
yards = [K.sweep([(-4.6, -11.4, 27.0), (4.6, -11.4, 27.0)], 0.12, 6), K.sweep([(-2.8, -11.0, 30.0), (2.8, -11.0, 30.0)], 0.1, 6),
         K.cylinder_z(0, -10.8, 34.0, 37.0, 0.12, 0.06, 8)]
obj('Raked tripod mast', K.merge(mast, *yards), C_SUP, M_STEEL, smooth=True)
obj('Mast radomes', K.merge(K.sphere((0, -10.8, 34.4), 0.7, 14, 7), K.box(0, -11.2, 25.4, 1.4, 1.4, 0.9)), C_WEAP, M_WHITE, smooth=True)
# Midships deckhouse, funnels, boats
z_mid = sheer(18)
obj('Midships deckhouse', S.house(-6.4, 6.4, 6.0, 32.0, z_mid - 0.6, 10.0, lean=0.4, chamfer=1.0), C_SUP, M_HULL, silhouette=True)
funnels, caps = [], []
for y0, y1, top in ((7.0, 14.0, 18.2), (20.5, 27.0, 17.6)):
    funnels.append(S.house(-3.4, 3.4, y0, y1, 10.0, top, lean=0.5, chamfer=1.0, lean_fore=0.9, lean_aft=-0.4))
    for s in (1, -1):
        caps.append(K.box(s * 1.25, (y0 + y1) / 2 + 0.6, top + 0.15, 1.8, (y1 - y0) - 2.2, 0.35))
obj('Funnels', K.merge(*funnels), C_SUP, M_HULL, silhouette=True)
obj('Funnel caps', K.merge(*caps), C_SUP, M_CAP)
boats = []
for s in (1, -1):
    boats.append(K.transform(K.lathe([(-3.6, 0.0), (-3.0, 0.75), (3.0, 0.8), (3.6, 0.0)], 10), Matrix.Translation((s * 7.4, 17.0, 11.0))))
    boats.append(K.sweep([(s * 6.2, 14.5, 10.0), (s * 6.4, 14.5, 12.6), (s * 7.4, 14.5, 12.6)], 0.12, 5))
    boats.append(K.sweep([(s * 6.2, 19.5, 10.0), (s * 6.4, 19.5, 12.6), (s * 7.4, 19.5, 12.6)], 0.12, 5))
obj('Boats & davits', K.merge(*boats), C_SUP, M_WHITE, smooth=True)
# Aft deckhouse
z_aft = sheer(40)
obj('Aft deckhouse', S.house(-6.6, 6.6, 32.0, 45.5, z_aft - 0.6, 12.2, lean=0.6, chamfer=2.2), C_SUP, M_HULL, silhouette=True)
doors = [K.box(s * 7.15, y, 8.0, 0.12, 1.2, 2.0) for s in (1, -1) for y in (-12.0, 2.0, 22.0, 38.0)]
obj('Watertight doors', K.merge(*doors), C_SUP, M_DARK)

# ----------------------------------------------------------------- weapons --
obj('Mk 45 5-inch gun', S.gun_mk45(0, -50.0, sheer(-50)), C_WEAP, M_HULL, smooth=False)
frame_f, hatch_f = S.vls_grid(-3.4, 3.4, -41.0, -34.4, sheer(-38), 8, 4)
frame_a, hatch_a = S.vls_grid(-3.4, 3.4, 46.5, 57.0, sheer(52), 8, 8)
obj('Mk 41 VLS (29 + 61 cells)', K.merge(frame_f, frame_a), C_WEAP, M_DECK)
obj('VLS hatches', K.merge(hatch_f, hatch_a), C_WEAP, M_DARK)
mounts, domes, guns = [], [], []
for x, y, z, face in ((0, -24.8, 10.2, (0, -1, 0)), (0, 43.6, 12.2, (0, 1, 0))):
    m, d, g = S.phalanx(x, y, z, face); mounts.append(m); domes.append(d); guns.append(g)
for x, y, z, face in ((0, -15.0, 17.6, (0, -1, 0)), (2.6, 36.0, 12.2, (0.5, 1, 0)), (-2.6, 36.0, 12.2, (-0.5, 1, 0))):
    m, d = S.illuminator(x, y, z, 1.0, face); mounts.append(m); mounts.append(d)
for s in (1, -1):
    mounts.append(S.harpoon_quad(s * 2.3, 30.0, 10.0, (s * 0.8, -0.6, 0)))
    tt = K.merge(*[K.transform(K.lathe([(-1.6, 0), (-1.6, 0.18), (1.6, 0.18), (1.6, 0)], 8),
                               Matrix.Translation((s * 5.8, 9.5 + k * 0.45, 10.6)) @ Matrix.Rotation(math.radians(90 - s * 30), 4, 'Z'))
                   for k in range(3)])
    mounts.append(tt)
obj('CIWS, illuminators, Harpoon & torpedo tubes', K.merge(*mounts), C_WEAP, M_HULL, smooth=True)
obj('Phalanx radomes', K.merge(*domes), C_WEAP, M_WHITE, smooth=True)
obj('Phalanx barrels', K.merge(*guns), C_WEAP, M_STEEL)
bits = []
for y in (-68.0, -62.0, 66.0, 72.0):
    for s in (1, -1):
        bits.append(K.cylinder_z(s * (S.edge_x(rows, y, s) - 1.6), y, sheer(y), sheer(y) + 0.6, 0.22, 0.22, 8))
bits += [K.cylinder_z(s * 1.6, -64.0, sheer(-64), sheer(-64) + 0.5, 0.55, 0.5, 12) for s in (1, -1)]
obj('Bitts & windlass', K.merge(*bits), C_HULL, M_STEEL)

# ------------------------------------------------------- helicopter deck ----
zh = lambda y: sheer(y) + 0.03
lines = [K.box(0, 67.0, zh(67), 0.3, 17.0, 0.02)]
for s in (1, -1):
    lines.append(K.box(s * 7.4, 67.0, zh(67), 0.25, 17.0, 0.02))
lines += [K.box(0, 58.6, zh(58.6), 14.8, 0.25, 0.02), K.box(0, 75.6, zh(75.6), 14.8, 0.25, 0.02)]
ring = []
for k in range(36):
    a0, a1 = 2 * math.pi * k / 36, 2 * math.pi * (k + 1) / 36
    p0 = (5.0 * math.cos(a0), 67.0 + 5.0 * math.sin(a0)); p1 = (5.0 * math.cos(a1), 67.0 + 5.0 * math.sin(a1))
    c = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    ring.append(K.oriented_box((c[0], c[1], zh(c[1]) + 0.005), (p1[0] - p0[0], p1[1] - p0[1], 0), (0, 0, 1), (0.3, 0.92, 0.02)))
obj('Helicopter deck markings', K.merge(*lines, *ring), C_HULL, M_LINE)

# ----------------------------------------------------------- hull numbers ----
for number in NUMBERS:
    parts = []
    for side in (1, -1):
        parts += S.hull_number(number, side, -56.0, 6.0, 3.3, hull, C_HULL, M_NUMBER, offset=0.06, shadow=M_SHADOW)
    for ob in parts:
        if number != NUMBERS[0]:           # the .blend and renders show DDG-51; the game picks per ship
            ob.hide_render = True           # hidden from renders only: viewport-hidden objects skip the export rotation

# --------------------------------------------------------------- underwater --
S.propulsion([(s * 4.6, 62.0, -4.8, 30.0, -5.6) for s in (1, -1)], C_UNDER, M_PROP, M_RED, blades=5, prop_r=2.55,
             rudders=[(s * 4.6, 66.5, 70.0, -1.6, -6.0) for s in (1, -1)])

S.finish(sc, 'Arleigh Burke DDG Flight I', {
    'model': 'Arleigh Burke-class destroyer, Flight I (DDG-51 / DDG-52 numbers)',
    'license': 'Original procedural model (FrostLine); layout from public U.S. Navy photographs'},
    BLEND, GLB, META, ROOT, {
        'waterline_beam': round(2 * HALF_WL, 2), 'deck_height_bow': SHEER[0][1], 'deck_height_stern': SHEER[-1][1],
        'hull_numbers': NUMBERS, 'license': 'Original procedural model',
        'references': ['https://www.globalsecurity.org/military/systems/ship/ddg-51-flt1.htm',
                       'https://www.seaforces.org/usnships/ddg/Arleigh-Burke-class.htm']},
    cam=(120, -150, 60))
