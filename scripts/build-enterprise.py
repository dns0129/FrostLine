"""Build the editable USS Enterprise (CVN-65) carrier model in Blender.

Run from the project root (after scripts/enterprise-deck-texture.py), with
Blender or the `bpy` module (5.x):
    blender --background --factory-startup --python scripts/build-enterprise.py
    python scripts/build-enterprise.py            # bpy module

Everything is procedural: hull loft, textured flight deck, gallery band and
catwalks, rebuilt island (bridge, primary flight control, SPS-48E / SPS-49
mast, radomes, island hull number 65), weapon sponsons with Sea Sparrow, RAM
and Phalanx, four steam catapults with blast deflectors, four arresting wires,
four deck-edge elevator openings, four shafts and propellers, rudders.
Layout: scripts/enterprise_layout.py.  Axes: metres, +Z up, waterline at
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
import enterprise_layout as E

SRC = ROOT / 'assets/models/enterprise-source'
DECK_TEX = SRC / 'textures/enterprise_flight_deck.png'
BLEND = SRC / 'Enterprise-CVN65.blend'
GLB = ROOT / 'assets/models/enterprise.glb'
META = ROOT / 'assets/models/enterprise.metadata.json'
FD, GALLERY = E.FLIGHT_DECK, E.GALLERY
srgb = S.srgb
obj = S.obj

sc = K.reset_scene()
C_HULL = K.collection('Enterprise hull')
C_DECK = K.collection('Enterprise flight deck & gear')
C_ISLAND = K.collection('Enterprise island')
C_WEAP = K.collection('Enterprise weapons & sensors')
C_UNDER = K.collection('Enterprise underwater')

M_HULL = K.material('USN haze grey', srgb(124, 132, 137), rough=0.62)
M_ISLAND = K.material('USN island grey', srgb(136, 143, 147), rough=0.58)
M_BOOT = K.material('Boot-top black', srgb(36, 36, 38), rough=0.7)
M_RED = K.material('Antifouling red', srgb(110, 44, 40), rough=0.75)
M_DARK = K.material('Opening shadow', srgb(18, 19, 21), rough=0.9)
M_WINDOW = K.material('Bridge glass', srgb(16, 26, 36), rough=0.08, spec=0.9)
M_ARRAY = K.material('Radar array face', srgb(70, 76, 82), rough=0.45)
M_STEEL = K.material('Deck steel', srgb(84, 86, 88), rough=0.45, metal=0.6)
M_WIRE = K.material('Arresting wire', srgb(40, 40, 42), rough=0.35, metal=0.8)
M_PROP = K.material('Propeller bronze', srgb(176, 132, 78), rough=0.3, metal=1.0)
M_WHITE = K.material('White fittings', srgb(226, 228, 226), rough=0.5)
M_LIGHT = K.material('FLOLS lights', srgb(255, 170, 60), emission=srgb(255, 160, 40), emission_strength=3.0)
M_NUMBER = K.material('Hull number white', srgb(236, 236, 232), rough=0.5)
M_SHADOW = K.material('Hull number shadow', srgb(24, 24, 26), rough=0.6)
M_DECK = K.image_material('Flight deck non-skid', DECK_TEX, rough=0.85, bump=0.15)

# ----------------------------------------------------------------- hull ----
HALF = [(-11.3, 15.5), (-10.4, 17.8), (-9.4, 19.1), (-8, 19.9), (-6, 20.2), (-4, 20.25), (0.9, 20.25),
        (2.5, 20.6), (5, 21.3), (7.5, 22.1), (10, 22.9), (GALLERY, 23.8)]
TRANSOM = [(-3, 7.5), (-1.6, 11.0), (-0.4, 13.0), (0.9, 14.5), (2.5, 16.0), (5, 17.5), (7.5, 18.5), (10, 18.8), (GALLERY, 19.0)]
ENTRY = [(-11.3, 1.1), (-4, 1.05), (0, 0.95), (5, 0.8), (GALLERY, 0.62)]
UW = [-11.3, -10.5, -9.4, -8.0, -6.0, -4.0, -3.0, -1.6, -0.4, 0.9]
TOP_Z = [2.5, 5.0, 7.5, 10.0, GALLERY]
FR = [(z - 0.9) / (GALLERY - 0.9) for z in TOP_Z]
STEM_Z = [(-11.3, -150.0), (-10.5, -156.0), (-9.4, -160.5), (-8, -163.5), (-6, -165.5), (-4, -166.0), (-3, -165.5),
          (-1.6, -164.5), (-0.4, -164.0), (0.9, -164.2), (2.5, -164.8), (5, -165.8), (7.5, -166.8), (10, -167.6), (GALLERY, -168.4)]
STERN_Z = [(-11.3, 110.0), (-10.5, 118.0), (-9.4, 125.0), (-8, 131.0), (-6, 142.0), (-4, 152.0), (-3, 157.0), (GALLERY, 166.5)]
Y_MID_F, Y_MID_A = -45.0, 100.0

def half_breadth(y, z):
    W = K.interp(HALF, z)
    y_fwd, y_aft = K.interp(STEM_Z, z), K.interp(STERN_Z, z)
    if y < Y_MID_F:
        s = max(0.0, (y - y_fwd) / (Y_MID_F - y_fwd))
        return W * math.sin(math.pi / 2 * s) ** K.interp(ENTRY, z)
    if y > Y_MID_A:
        s = min(1.0, (y - Y_MID_A) / (y_aft - Y_MID_A))
        if z >= -3:
            return W - (W - K.interp(TRANSOM, z)) * s ** 1.8
        return W * max(0.0, 1 - s ** 2.2) ** 0.6
    return W

to_frac = lambda table: [((z - 0.9) / (GALLERY - 0.9), y) for z, y in table if z >= 0.9]
hull, rows = S.hull_loft('Hull (waterline at Z=0)', C_HULL, (M_RED, M_BOOT, M_HULL), uw_levels=UW, top_fracs=FR,
                         stem_uw=STEM_Z, stern_uw=STERN_Z, stem_top=to_frac(STEM_Z), stern_top=to_frac(STERN_Z),
                         half_breadth=half_breadth, sheer=lambda y: GALLERY, transom_from=-3.0, samples=64)

# ------------------------------------------------- flight deck & gallery ----
deck = E.DECK
ds = obj('Flight deck slab', K.prism(deck, FD - 1.2, FD), C_DECK, M_HULL, silhouette=True)
ds.data.materials.append(M_DECK)
uv = ds.data.uv_layers.new(name='UVMap')
for p in ds.data.polygons:
    if p.normal.z > 0.9:
        p.material_index = 1
    for li in p.loop_indices:
        co = ds.data.vertices[ds.data.loops[li].vertex_index].co
        uv.data[li].uv = ((E.X_TEX_MAX - co.x) / E.X_TEX_SPAN, 1 - (co.y + E.LOA / 2) / E.LOA)
gallery = K.inset_polygon(deck, 1.0)
obj('Gallery deck band', K.prism(gallery, GALLERY, FD - 1.2), C_HULL, M_HULL, silhouette=True)

def deck_x(y, side):
    chain = deck[:12] if side > 0 else list(reversed(deck[12:])) + [deck[0]]
    pts = sorted((p[1], p[0]) for p in (deck[:12] if side > 0 else deck[12:]))
    return K.interp(pts, y)

openings = []
for side, y0, y1, step in ((1, -60, 150, 12.0), (-1, -120, 150, 11.0)):
    y = y0
    while y < y1:
        if not any(e[2] - 2 < y < e[3] + 2 for e in E.ELEVATORS) and not (side < 0 and -26 < y < 14):
            xg = K.interp(sorted((p[1], p[0]) for p in (gallery[:12] if side > 0 else gallery[12:])), y)
            openings.append(K.box(xg + side * 0.06, y, FD - 3.0, 0.14, 4.0, 1.8))
        y += step
obj('Gallery openings', K.merge(*openings), C_HULL, M_DARK)
doors = []
for x0, x1, y0, y1 in E.ELEVATORS:
    side = 1 if x0 > 0 else -1
    yc = (y0 + y1) / 2
    xh = side * S.hull_x_at(rows, yc, 9.0, side)
    doors.append(K.box(xh + side * 0.1, yc, 8.6, 0.5, (y1 - y0) - 4, 7.0))
obj('Hangar bay openings', K.merge(*doors), C_HULL, M_DARK)
braces = []
for y in range(-60, 150, 9):
    for side in (1, -1):
        xe = abs(deck_x(y, side)) - 1.4
        xh = S.hull_x_at(rows, y, GALLERY, side)
        if xe - xh > 3:
            z_low = GALLERY - min(7, (xe - xh) * 0.9)
            outline = [(xh - 0.3, GALLERY + 0.05), (xe, GALLERY + 0.05), (S.hull_x_at(rows, y, z_low, side) - 0.3, z_low)]
            part = K.prism(outline, y - 0.25, y + 0.25, 'XZ')
            braces.append(part if side > 0 else K.mirror_x(part))
obj('Sponson knee braces', K.merge(*braces), C_HULL, M_HULL)

walk, rail = [], []
def catwalk(a, b, side):
    (ax, ay), (bx, by) = a, b
    L = math.hypot(bx - ax, by - ay)
    f = Vector(((bx - ax) / L, (by - ay) / L, 0))
    n = Vector((f.y, -f.x, 0)) if f.y * side < 0 or (f.y == 0 and -f.x * side > 0) else Vector((-f.y, f.x, 0))
    if n.x * side < 0:
        n = -n
    c = Vector(((ax + bx) / 2, (ay + by) / 2, FD - 1.55)) + n * 0.75
    walk.append(K.oriented_box(c, f, (0, 0, 1), (1.5, L, 0.22)))
    p0 = Vector((ax, ay, FD - 0.25)) + n * 1.55; p1 = Vector((bx, by, FD - 0.25)) + n * 1.55
    rail.append(K.sweep([p0, p1], 0.05, 5))
    k = 0.0
    while k <= L:
        q = Vector((ax, ay, 0)) + f * k + n * 1.55
        rail.append(K.sweep([(q.x, q.y, FD - 1.45), (q.x, q.y, FD - 0.25)], 0.04, 4)); k += 2.5
# no catwalks on the bow and stern faces, which would overhang the 342 m deck
for i in (1, 2, 3, 5, 6, 9):
    catwalk(deck[i], deck[i + 1], 1)
for i in (13, 14, 17, 18):
    catwalk(deck[i], deck[i + 1], -1)
catwalk((-36.0, 50.0), (-36.0, 105.0), -1)
catwalk((-36.0, -40.0), (-36.0, -28.0), -1)
obj('Catwalks', K.merge(*walk), C_DECK, M_STEEL)
obj('Catwalk safety-net frames', K.merge(*rail), C_DECK, M_STEEL, smooth=True)

sp, sp_rail = [], []
for poly in E.SPONSONS:
    sp.append(K.prism(poly, FD - 3.8, FD - 2.6))
    ring = [(x, y, FD - 1.55) for x, y in poly] + [(poly[0][0], poly[0][1], FD - 1.55)]
    sp_rail.append(K.sweep(ring, 0.045, 4))
obj('Weapon sponsons', K.merge(*sp), C_HULL, M_HULL, silhouette=True)
obj('Sponson railings', K.merge(*sp_rail), C_HULL, M_STEEL)

# ------------------------------------------------------------------ island --
ix0, ix1, iy0, iy1 = E.ISLAND
IH = E.ISLAND_HEIGHTS
z_block = FD + IH['block']
island = obj('Island main block', S.house(ix0, ix1, iy0, iy1, FD, z_block, lean=0.25, chamfer=1.2), C_ISLAND, M_ISLAND, silhouette=True)
bridge = S.house(ix0 + 0.6, ix1 - 0.4, iy0 + 1.0, iy0 + 22.0, z_block, FD + IH['bridge'], lean=0.2, chamfer=0.8)
obj('Navigation & flag bridge levels', bridge, C_ISLAND, M_ISLAND, silhouette=True)
win = []
for z, (wy0, wy1) in ((z_block - 2.4, (iy0 + 1.0, iy0 + 22.0)), (FD + IH['bridge'] - 2.0, (iy0 + 1.6, iy0 + 21.2))):
    win.append(K.box((ix0 + ix1) / 2, wy0 - 0.06, z, ix1 - ix0 - 2.0, 0.12, 1.4))
    for xs in (ix0 + 0.35, ix1 - 0.15):
        win.append(K.box(xs, (wy0 + wy1) / 2, z, 0.12, wy1 - wy0 - 2.0, 1.4))
# primary flight control: angled glass box overhanging the deck at the aft port corner
pri = S.house(ix1 - 1.5, ix1 + 1.4, iy1 - 12.0, iy1 - 1.0, z_block - 4.5, z_block - 1.0, lean=-0.4)
obj('Primary flight control', pri, C_ISLAND, M_ISLAND)
win.append(K.box(ix1 + 1.55, iy1 - 6.5, z_block - 2.6, 0.12, 10.0, 1.6))
obj('Island windows', K.merge(*win), C_ISLAND, M_WINDOW)
# mast tower, SPS-48E planar array (forward), SPS-49 mesh (aft), pole mast and radomes
mx, my = (ix0 + ix1) / 2, iy0 + 13.0
tower = S.house(mx - 3.4, mx + 3.4, my - 4.0, my + 4.0, FD + IH['bridge'], FD + IH['tower'], lean=1.2)
obj('Radar mast tower', tower, C_ISLAND, M_ISLAND, silhouette=True)
zt = FD + IH['tower']
sps48 = [K.box(mx, my - 2.2, zt + 0.5, 3.4, 3.4, 1.0)]
arr48 = K.rotate_about(K.box(mx, my - 4.2, zt + 4.0, 5.4, 0.5, 5.2), -14, 'X', (mx, my - 4.2, zt + 4.0))
obj('SPS-48E pedestal', K.merge(*sps48), C_WEAP, M_STEEL)
obj('SPS-48E planar array', arr48, C_WEAP, M_ARRAY)
pole = [K.cylinder_z(mx, my + 1.5, zt, FD + IH['mast_top'], 0.45, 0.18, 10),
        K.sweep([(mx - 5.0, my + 1.5, zt + 9.0), (mx + 5.0, my + 1.5, zt + 9.0)], 0.12, 6),
        K.sweep([(mx - 3.4, my + 1.5, zt + 11.5), (mx + 3.4, my + 1.5, zt + 11.5)], 0.1, 6),
        K.box(mx, my + 3.4, zt + 6.8, 2.4, 3.6, 0.4)]
obj('Pole mast & yards', K.merge(*pole), C_ISLAND, M_STEEL, smooth=True)
arr49 = []
for i in range(9):
    a = math.radians(-36 + i * 9)
    arr49.append(K.box(mx + 3.6 * math.sin(a), my + 5.2 + 0.9 * (1 - math.cos(a)), zt + 8.2, 0.85, 0.12, 4.3))
obj('SPS-49 mesh antenna', K.merge(*arr49), C_WEAP, M_ARRAY)
domes = [K.sphere((mx - 2.6, my - 2.0, FD + IH['bridge'] + 1.4), 1.3, 18, 9),
         K.sphere((mx + 2.6, my - 2.0, FD + IH['bridge'] + 1.4), 1.3, 18, 9),
         K.sphere((mx, my + 1.5, FD + IH['mast_top'] - 1.0), 0.7, 14, 7),
         K.sphere((ix0 + 1.6, iy1 - 3.0, z_block + 1.1), 1.1, 16, 8),
         K.sphere((ix0 + 1.6, iy1 - 7.0, z_block + 1.1), 1.1, 16, 8)]
obj('SATCOM radomes', K.merge(*domes), C_WEAP, M_WHITE, smooth=True)
rails = []
for poly, z in ((K.chamfer_rect(ix0, ix1, iy0, iy1, 1.2), z_block + 1.0), (K.chamfer_rect(mx - 2.2, mx + 2.2, my - 2.8, my + 2.8, 0.5), zt + 1.0)):
    ring = [(x, y, z) for x, y in poly] + [(poly[0][0], poly[0][1], z)]
    rails.append(K.sweep(ring, 0.05, 4))
obj('Island railings', K.merge(*rails), C_ISLAND, M_STEEL)
for side in (1, -1):
    S.hull_number('65', side, iy0 + 30.0, FD + 8.5, 6.5, island, C_ISLAND, M_NUMBER, offset=0.06,
                  label='island', shadow=M_SHADOW)

# ----------------------------------------------------------------- weapons --
def outward(x, y):
    return (1 if x > 0 else -1, -0.6 if y < 0 else 0.6, 0)
body, caps, white, guns = [], [], [], []
for x, y in E.SEA_SPARROW:
    b, c = S.box_launcher(x, y, FD - 2.6, outward(x, y), size=(2.6, 3.2, 1.6), elev=15, cells=(4, 2))
    body.append(b); caps.append(c)
    b2, dish = S.illuminator(x - (2.5 if x > 0 else -2.5) * 0, y + (4.5 if y < 0 else -4.5), FD - 2.6, 0.9, outward(x, y))
    body.append(b2); body.append(dish)
for x, y in E.RAM:
    b, face = S.ram_launcher(x, y, FD - 2.6, outward(x, y))
    body.append(b); caps.append(face)
for x, y in E.PHALANX:
    b, dome, gun = S.phalanx(x, y, FD - 2.6, outward(x, y))
    body.append(b); white.append(dome); guns.append(gun)
obj('Sea Sparrow, RAM & CIWS mounts', K.merge(*body), C_WEAP, M_HULL, smooth=True)
obj('Launcher cell covers', K.merge(*caps), C_WEAP, M_DARK)
obj('Phalanx radomes', K.merge(*white), C_WEAP, M_WHITE, smooth=True)
obj('Phalanx barrels', K.merge(*guns), C_WEAP, M_STEEL)

# --------------------------------------------------- deck equipment -------
eq = []
for front, aft in E.CATAPULTS:
    d = (Vector((front[0], front[1], 0)) - Vector((aft[0], aft[1], 0))).normalized()
    eq.append(K.oriented_box((aft[0] + d.x * 0.8, aft[1] + d.y * 0.8, FD + 0.12), d, (0, 0, 1), (0.7, 1.4, 0.24)))
for x0j, x1j, y0j, y1j in E.JBDS:
    eq.append(K.box((x0j + x1j) / 2, (y0j + y1j) / 2, FD + 0.04, x1j - x0j, y1j - y0j, 0.08))
obj('Catapult shuttles & stowed blast deflectors', K.merge(*eq), C_DECK, M_STEEL)
(ax, ay), (bx_, by_) = E.LANDING_AXIS
ux, uy = bx_ - ax, by_ - ay; L = math.hypot(ux, uy); ux, uy = ux / L, uy / L
wires, sheaves = [], []
for wy in E.WIRE_Y:
    t = (wy - ay) / uy
    cx, cy = ax + ux * t, ay + uy * t
    p0 = (cx + uy * E.WIRE_HALF_SPAN, cy - ux * E.WIRE_HALF_SPAN, FD + 0.1)
    p1 = (cx - uy * E.WIRE_HALF_SPAN, cy + ux * E.WIRE_HALF_SPAN, FD + 0.1)
    wires.append(K.sweep([p0, p1], 0.045, 6))
    for p in (p0, p1):
        sheaves.append(K.oriented_box((p[0], p[1], FD + 0.12), (ux, uy, 0), (0, 0, 1), (0.5, 2.0, 0.24)))
obj('Arresting wires (4)', K.merge(*wires), C_DECK, M_WIRE, smooth=True)
obj('Arresting gear sheaves', K.merge(*sheaves), C_DECK, M_STEEL)
fx, fy = 41.0, 92.0       # FLOLS on the port deck edge, abeam the wires
obj('Optical landing aid housing', K.merge(K.box(fx + 1.2, fy, FD + 1.6, 1.0, 1.4, 3.6), K.box(fx + 1.2, fy, FD + 3.5, 3.6, 0.6, 0.3)), C_DECK, M_STEEL)
obj('Optical landing aid lights', K.merge(*[K.box(fx + 1.2 + dx, fy + 0.72, FD + 0.6 + dz, 0.3, 0.06, 0.25)
                                             for dx in (-0.25, 0.25) for dz in (0.4, 0.9, 1.4, 1.9, 2.4, 2.9)]), C_DECK, M_LIGHT)

# --------------------------------------------------------------- underwater --
shafts = [(s * 7.0, 138.0, -8.4, 108.0, -10.0) for s in (1, -1)] + [(s * 16.0, 126.0, -8.2, 96.0, -9.6) for s in (1, -1)]
rudders = [(s * xr, 143.5, 150.5, -3.6, -10.4) for s in (1, -1) for xr in (4.0, 12.0)]
S.propulsion(shafts, C_UNDER, M_PROP, M_RED, blades=5, prop_r=2.6, rudders=rudders)
hawse = []
for s in (1, -1):
    m = Matrix.Translation((s * (S.hull_x_at(rows, -150.0, 9.5, s) - 0.05), -150.0, 9.5)) @ Matrix.Rotation(-s * math.radians(70), 4, 'Z')
    hawse.append(K.transform(K.lathe([(0, 1.0), (0.25, 1.0), (0.25, 0)], 20), m))
obj('Hawse pipes', K.merge(*hawse), C_HULL, M_DARK, smooth=True)

# -------------------------------------------------------------- finishing --
xs = [p[0] for p in deck]
S.finish(sc, 'Enterprise CVN-65', {
    'model': 'USS Enterprise (CVN-65), nuclear aircraft carrier, final configuration',
    'license': 'Original procedural model (FrostLine); layout from public U.S. Navy photographs'},
    BLEND, GLB, META, ROOT, {
        'flight_deck_width': round(max(xs) - min(xs), 2), 'waterline_beam': round(2 * K.interp(HALF, 0.0), 2),
        'flight_deck_height': FD, 'angled_deck_deg': round(math.degrees(math.atan2(ax - bx_, by_ - ay)), 2),
        'hull_numbers': ['65'], 'license': 'Original procedural model',
        'references': ['https://www.globalsecurity.org/military/systems/ship/cvn-65-specs.htm',
                       'https://www.naval-technology.com/projects/uss-enterprise/',
                       'https://history.navy.mil/research/histories/ship-histories/danfs/e/enterprise-cvan-65-viii-1991-1995.html']},
    cam=(300, -380, 180))
