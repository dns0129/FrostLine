"""Build the editable Fujian (CV-18, Type 003) carrier model in Blender.

Run from the project root (after scripts/fujian-deck-texture.py):
    '/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background \
        --factory-startup --python scripts/build-fujian.py

Everything is procedural: hull loft, flight deck with painted markings,
island (podium, stealthy main block with four S-band arrays, X-band slots,
bridge wing, integrated mast), weapon sponsons with HQ-10 launchers and
H/PJ-11 CIWS, three EM catapults, four arresting wires, two deck-edge
elevators, catwalks, antennas, propellers, shafts, rudders and bilge keels.
Plan layout: scripts/fujian_layout.py.  Axes: metres, +Z up, waterline at
Z = 0, bow toward -Y, +X = port.
"""
import sys, math, json, hashlib
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import blender_kit as K
import fujian_layout as F

SRC = ROOT / 'assets/models/fujian-source'
DECK_TEX = SRC / 'textures/fujian_flight_deck.png'
BLEND = SRC / 'Fujian-CV18.blend'
GLB = ROOT / 'assets/models/fujian.glb'
META = ROOT / 'assets/models/fujian.metadata.json'
FD = F.FLIGHT_DECK
GALLERY = FD - 5.0          # bottom of the gallery band / top of the hull loft

def srgb(*c):
    return tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in c)

sc = K.reset_scene()
C_HULL = K.collection('Fujian hull')
C_DECK = K.collection('Fujian flight deck & gear')
C_ISLAND = K.collection('Fujian island')
C_WEAP = K.collection('Fujian weapons & sensors')
C_UNDER = K.collection('Fujian underwater')

M_HULL = K.material('PLAN hull grey', srgb(146, 152, 157), rough=0.62)
M_ISLAND = K.material('PLAN island grey', srgb(170, 175, 178), rough=0.55)
M_BOOT = K.material('Boot-top black', srgb(38, 38, 40), rough=0.7)
M_RED = K.material('Antifouling red', srgb(122, 44, 40), rough=0.75)
M_DARK = K.material('Opening shadow', srgb(18, 19, 21), rough=0.9)
M_WINDOW = K.material('Bridge glass', srgb(16, 26, 36), rough=0.08, spec=0.9)
M_ARRAY = K.material('AESA array face', srgb(92, 100, 108), rough=0.4)
M_ARRAY_FRAME = K.material('Array frame', srgb(120, 126, 132), rough=0.5)
M_STEEL = K.material('Deck steel', srgb(84, 86, 88), rough=0.45, metal=0.6)
M_WIRE = K.material('Arresting wire', srgb(40, 40, 42), rough=0.35, metal=0.8)
M_PROP = K.material('Propeller bronze', srgb(176, 132, 78), rough=0.3, metal=1.0)
M_WHITE = K.material('White fittings', srgb(226, 228, 226), rough=0.5)
M_LIGHT = K.material('FLOLS lights', srgb(255, 170, 60), emission=srgb(255, 160, 40), emission_strength=3.0)
M_NUMBER = K.material('Hull number white', srgb(236, 236, 232), rough=0.5)
M_DECK = K.image_material('Flight deck non-skid', DECK_TEX, rough=0.85, bump=0.15)

def obj(name, part, coll, mat, smooth=False):
    return K.mesh_object(name, *part, coll, mat, smooth=smooth)

# ----------------------------------------------------------------- hull ----
port_chain = F.DECK[:11]                     # bow -> stern, +X side
stbd_chain = list(reversed(F.DECK[11:]))     # bow -> stern, -X side
def chain_x(chain, y):
    return K.interp([(p[1], p[0]) for p in chain], y)
CAP_INSET = 1.2
def smin(a, b, k=1.2):
    h = max(0.0, min(1.0, 0.5 + 0.5 * (b - a) / k))
    return b + (a - b) * h - k * h * (1 - h)

LEVELS = [-11.0, -10.4, -9.4, -8.0, -6.0, -4.0, -3.0, -1.6, -0.4, 0.9, 2.5, 5.0, 7.5, 10.0, GALLERY]
STEM = [(-11, -136), (-10.4, -141), (-9.4, -145.5), (-8, -149), (-6, -151.8), (-4, -152.3), (-3, -151.8),
        (-1.6, -150.6), (-0.4, -150.4), (0.9, -150.6), (2.5, -151.2), (5, -152.2), (7.5, -153.2),
        (10, -154.0), (GALLERY, -154.8)]
STERN = [(-11, 105), (-10.4, 112), (-9.4, 118), (-8, 123), (-6, 135), (-4, 146), (-3, 150), (GALLERY, 153.9)]
HALF = [(-11, 15.2), (-10.4, 17.6), (-9.4, 18.9), (-8, 19.6), (-6, 19.95), (-4, 20.0), (0.9, 20.0),
        (2.5, 20.3), (5, 20.9), (7.5, 21.6), (10, 22.4), (GALLERY, 23.3)]
TRANSOM = [(-3, 7.0), (-1.6, 10.5), (-0.4, 12.5), (0.9, 14.0), (2.5, 15.5), (5, 17.0), (7.5, 18.0), (10, 18.3), (GALLERY, 18.5)]
ENTRY = [(-11, 1.05), (-4, 1.05), (0, 0.95), (5, 0.8), (GALLERY, 0.62)]
Y_MID_F, Y_MID_A = -40.0, 95.0
N = 96

def half_breadth(y, z, y_fwd, y_aft):
    W = K.interp(HALF, z)
    if y < Y_MID_F:
        s = max(0.0, (y - y_fwd) / (Y_MID_F - y_fwd))
        hb = W * math.sin(math.pi / 2 * s) ** K.interp(ENTRY, z)
    elif y > Y_MID_A:
        s = min(1.0, (y - Y_MID_A) / (y_aft - Y_MID_A))
        if z >= -3:
            hb = W - (W - K.interp(TRANSOM, z)) * s ** 1.8
        else:
            hb = W * max(0.0, 1 - s ** 2.2) ** 0.6
    else:
        hb = W
    # bilge radius below -7 m
    return hb

rows = []
for z in LEVELS:
    y_fwd, y_aft = K.interp(STEM, z), K.interp(STERN, z)
    port, stbd = [], []
    for k in range(N):
        u = k / (N - 1)
        g = u - math.sin(2 * math.pi * u) / (2 * math.pi) * 0.62
        y = y_aft + (y_fwd - y_aft) * g
        hb = half_breadth(y, z, y_fwd, y_aft)
        hp, hs = hb, hb
        if z > 0:   # keep the flared topsides inside the gallery band
            w = K.smoothstep(0, GALLERY, z)
            hp = hb + (smin(hb, chain_x(port_chain, y) - CAP_INSET) - hb) * w
            hs = hb + (smin(hb, -chain_x(stbd_chain, y) - CAP_INSET) - hb) * w
        if k == N - 1:
            hp = hs = 0.0
        port.append((hp, y, z)); stbd.append((-hs, y, z))
    rows.append((port, stbd))

hv, hf, hmat = [], [], []
def vid(p):
    hv.append(p); return len(hv) - 1
idx = [([vid(p) for p in port], [vid(p) for p in stbd]) for port, stbd in rows]
def zone(zc):
    return 0 if zc < -0.4 else 1 if zc < 0.9 else 2
for i in range(len(LEVELS) - 1):
    (p0, s0), (p1, s1) = idx[i], idx[i + 1]
    zc = (LEVELS[i] + LEVELS[i + 1]) / 2
    for k in range(N - 1):
        hf.append((p0[k], p0[k + 1], p1[k + 1], p1[k])); hmat.append(zone(zc))
        hf.append((s0[k + 1], s0[k], s1[k], s1[k + 1])); hmat.append(zone(zc))
# keel flat
p0, s0 = idx[0]
hf.append(tuple(p0) + tuple(reversed(s0[1:-1]))); hmat.append(0)
# transom, in horizontal strips so the waterline colours carry across it
it = LEVELS.index(-3.0)
for i in range(it, len(LEVELS) - 1):
    hf.append((idx[i][1][0], idx[i][0][0], idx[i + 1][0][0], idx[i + 1][1][0]))
    hmat.append(zone((LEVELS[i] + LEVELS[i + 1]) / 2))
hf.append((idx[it - 1][0][0], idx[it][1][0], idx[it][0][0])); hmat.append(0)
me = bpy.data.meshes.new('Hull')
me.from_pydata(hv, [], hf)
bm = bmesh.new(); bm.from_mesh(me)
bm.faces.ensure_lookup_table()
for f, m in zip(bm.faces, hmat):
    f.material_index = m
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
for m in (M_RED, M_BOOT, M_HULL):
    me.materials.append(m)
for p in me.polygons:
    p.use_smooth = True
hull = bpy.data.objects.new('Hull (waterline at Z=0)', me); C_HULL.objects.link(hull)
K.sharpen_by_angle(hull, 50)

def hull_x(y, z, side):
    """Half-breadth of the hull loft at (y, z) on one side (+1 port, -1 stbd)."""
    zs = sorted(LEVELS)
    for a, b in zip(zs, zs[1:]):
        if a <= z <= b:
            t = (z - a) / (b - a)
            def at(zz, row):
                pts = row[0] if side > 0 else row[1]
                ys = [p[1] for p in pts]
                if not (min(ys) <= y <= max(ys)):
                    return 0.0
                return abs(K.interp(sorted([(p[1], p[0]) for p in pts]), y))
            return at(a, rows[zs.index(a)]) * (1 - t) + at(b, rows[zs.index(b)]) * t
    return 0.0

# ------------------------------------------------- flight deck & gallery ----
deck = F.DECK
gallery = K.inset_polygon(deck, 1.0)
deck_slab = K.prism(deck, FD - 1.2, FD)
ds = obj('Flight deck slab', deck_slab, C_DECK, M_HULL)
ds.data.materials.append(M_DECK)
uv = ds.data.uv_layers.new(name='UVMap')
top_index = 1
for p in ds.data.polygons:
    if p.normal.z > 0.9:
        p.material_index = 1
    for li in p.loop_indices:
        co = ds.data.vertices[ds.data.loops[li].vertex_index].co
        uv.data[li].uv = ((F.X_TEX_MAX - co.x) / F.X_TEX_SPAN, 1 - (co.y + F.LOA / 2) / F.LOA)
obj('Gallery deck band', K.prism(gallery, GALLERY, FD - 1.2), C_HULL, M_HULL)

# dark gallery openings / boat bays along the long straight sides
openings = []
for x_side, y0, y1, step in ((gallery[6][0], -18, 122, 11.0), (gallery[15][0], -42, 120, 12.5)):
    out = 1 if x_side > 0 else -1
    y = y0
    while y < y1:
        if not any(e[2] - 2 < y < e[3] + 2 for e in F.ELEVATORS) and not (out < 0 and 4 < y < 50):
            openings.append(K.box(x_side + out * 0.06, y, FD - 3.0, 0.14, 4.2, 1.9))
        y += step
obj('Gallery openings', K.merge(*openings), C_HULL, M_DARK)

# hangar doors below the starboard elevators
doors = []
for x0, x1, y0, y1 in F.ELEVATORS:
    yc = (y0 + y1) / 2
    xh = -hull_x(yc, 8.0, -1)
    doors.append(K.box(xh - 0.15, yc, 8.4, 0.5, (y1 - y0) - 3, 7.0))
obj('Hangar doors (open)', K.merge(*doors), C_HULL, M_DARK)

# knee braces under the big port overhang
braces = []
for y in range(-64, 124, 9):
    xe = chain_x(port_chain, y) - 1.4
    xh = hull_x(y, GALLERY, 1)
    if xe - xh > 3:
        z_low = GALLERY - min(7, (xe - xh) * 0.9)
        outline = [(xh - 0.3, GALLERY + 0.05), (xe, GALLERY + 0.05), (hull_x(y, z_low, 1) - 0.3, z_low)]
        braces.append(K.prism([(a, b) for a, b in outline], y - 0.25, y + 0.25, 'XZ'))
obj('Sponson knee braces', K.merge(*braces), C_HULL, M_HULL)

# catwalks with safety-net frames just below the deck edge
walk, rail = [], []
def catwalk(a, b, side):
    (ax, ay), (bx, by) = a, b
    L = math.hypot(bx - ax, by - ay)
    f = Vector(((bx - ax) / L, (by - ay) / L, 0))
    n = Vector((f.y, -f.x, 0)) if Vector((f.y, -f.x, 0)).x * side > 0 else Vector((-f.y, f.x, 0))
    c = Vector(((ax + bx) / 2, (ay + by) / 2, FD - 1.55)) + n * 0.75
    walk.append(K.oriented_box(c, f, (0, 0, 1), (1.5, L, 0.22)))
    p0 = Vector((ax, ay, FD - 0.25)) + n * 1.55; p1 = Vector((bx, by, FD - 0.25)) + n * 1.55
    rail.append(K.sweep([p0, p1], 0.05, 5))
    k = 0
    while k <= L:
        q = Vector((ax, ay, 0)) + f * k + n * 1.55
        rail.append(K.sweep([(q.x, q.y, FD - 1.45), (q.x, q.y, FD - 0.25)], 0.04, 4))
        k += 2.5
(e1, e2) = F.ELEVATORS
for a, b, side in [(deck[0], deck[1], 1), (deck[3], deck[4], 1), (deck[5], deck[6], 1),
                   (deck[21], deck[22], -1), (deck[17], deck[18], -1),
                   ((deck[16][0], deck[16][1]), (deck[16][0], e1[2]), -1),
                   ((deck[16][0], e1[3]), (deck[16][0], e2[2]), -1),
                   ((deck[16][0], e2[3]), (deck[15][0], deck[15][1]), -1)]:
    catwalk(a, b, side)
obj('Catwalks', K.merge(*walk), C_DECK, M_STEEL)
obj('Catwalk safety-net frames', K.merge(*rail), C_DECK, M_STEEL, smooth=True)

# ---------------------------------------------------------------- sponsons --
sp = []
for poly in F.SPONSONS:
    sp.append(K.prism(poly, FD - 3.8, FD - 2.6))
obj('Weapon sponsons', K.merge(*sp), C_HULL, M_HULL)
sp_rail = []
for poly in F.SPONSONS:
    ring = [(x, y, FD - 1.55) for x, y in poly] + [(poly[0][0], poly[0][1], FD - 1.55)]
    sp_rail.append(K.sweep(ring, 0.045, 4))
obj('Sponson railings', K.merge(*sp_rail), C_HULL, M_STEEL)

# ------------------------------------------------------------------ island --
IH = F.ISLAND_HEIGHTS
x0, x1, y0, y1 = F.ISLAND_PODIUM
obj('Island podium', K.prism(K.chamfer_rect(x0, x1, y0, y1, 2.0), FD, FD + IH['podium']), C_ISLAND, M_ISLAND)
bx0, bx1, by0, by1 = F.ISLAND_BLOCK
zb, zt = FD + IH['podium'], FD + IH['roof']
lean = 0.9
bot = [(x, y, zb) for x, y in K.chamfer_rect(bx0, bx1, by0, by1, 3.0)]
top = [(x, y, zt) for x, y in K.chamfer_rect(bx0 + lean, bx1 - lean, by0 + lean, by1 - lean, 3.0 - lean * 0.4)]
obj('Island main block', K.loft_outlines([bot, top]), C_ISLAND, M_ISLAND)
# face helper: point on a leaning face at height z
def face_point(face, along, z):
    t = (z - zb) / (zt - zb)
    if face == 'port':
        return Vector((bx1 - lean * t, along, z)), Vector((1, 0, lean / (zt - zb))).normalized(), Vector((0, 1, 0))
    if face == 'stbd':
        return Vector((bx0 + lean * t, along, z)), Vector((-1, 0, lean / (zt - zb))).normalized(), Vector((0, -1, 0))
    if face == 'fore':
        return Vector((along, by0 + lean * t, z)), Vector((0, -1, lean / (zt - zb))).normalized(), Vector((-1, 0, 0))
    return Vector((along, by1 - lean * t, z)), Vector((0, 1, lean / (zt - zb))).normalized(), Vector((1, 0, 0))

def panel(face, along, zc, w, h, depth, mat, name, parts):
    p, n, side = face_point(face, along, zc)
    up = n.cross(side).normalized()
    parts.setdefault(mat, []).append(K.oriented_box(p + n * depth / 2, up * -1 if up.z < 0 else up, n, (w, h, depth)))

arr = {}
ymid, xmid = (by0 + by1) / 2, (bx0 + bx1) / 2
for face, along, w in (('port', ymid, 9.0), ('stbd', ymid, 9.0), ('fore', xmid, 6.0), ('aft', xmid, 6.0)):
    panel(face, along, zb + 8.6, w + 0.8, w + 0.8, 0.18, M_ARRAY_FRAME, 'frame', arr)
    panel(face, along, zb + 8.6, w, w, 0.32, M_ARRAY, 'S-band array', arr)
    for dz in (13.6, 15.2):
        panel(face, along, zb + dz, w, 0.7, 0.3, M_ARRAY, 'X-band slots', arr)
for face, along, w in (('fore', xmid, 5.6), ('port', by0 + 5.0, 6.0), ('stbd', by0 + 5.0, 6.0)):
    panel(face, along, zt - 2.4, w, 1.4, 0.12, M_WINDOW, 'windows', arr)
obj('Island S/X-band array frames', K.merge(*arr[M_ARRAY_FRAME]), C_ISLAND, M_ARRAY_FRAME)
obj('Island S/X-band arrays (Type 346B style)', K.merge(*arr[M_ARRAY]), C_ISLAND, M_ARRAY)
obj('Island upper windows', K.merge(*arr[M_WINDOW]), C_ISLAND, M_WINDOW)

# forward bridge wing and aft flight-control platform
wx0, wx1, wy0, wy1 = F.ISLAND_BRIDGE
z0b, z1b = FD + IH['bridge'][0], FD + IH['bridge'][1]
obj('Bridge wing', K.prism(K.chamfer_rect(wx0, wx1, wy0, wy1, 1.6), z0b, z1b), C_ISLAND, M_ISLAND)
win = [K.box((wx0 + wx1) / 2, wy0 - 0.05, z1b - 2.0, wx1 - wx0 - 3.6, 0.2, 1.8)]
for xs in (wx0 - 0.05, wx1 + 0.05):
    win.append(K.box(xs, (wy0 + wy1) / 2 - 0.5, z1b - 2.0, 0.2, wy1 - wy0 - 3.6, 1.8))
win.append(K.box((bx0 + bx1) / 2, by1 + 2.3, zb + 2.2, bx1 - bx0 - 3.0, 0.2, 1.4))
obj('Bridge windows', K.merge(*win), C_ISLAND, M_WINDOW)
obj('Aft flight-control platform', K.prism(K.chamfer_rect(bx0 + 0.6, bx1 - 0.6, by1 - 0.5, by1 + 2.2, 0.8), zb, zb + 3.4), C_ISLAND, M_ISLAND)
# railings on bridge wing and podium roof
rails = []
for poly, z in ((K.chamfer_rect(wx0, wx1, wy0, wy1, 1.6), z1b + 1.1), (K.chamfer_rect(x0, x1, y0, y1, 2.0), FD + IH['podium'] + 1.1)):
    ring = [(x, y, z) for x, y in poly] + [(poly[0][0], poly[0][1], z)]
    rails.append(K.sweep(ring, 0.05, 4))
obj('Island railings', K.merge(*rails), C_ISLAND, M_STEEL)

# integrated mast, radome, yard and roof equipment
mx, my = (bx0 + bx1) / 2, by0 + 6.5
mast = [K.loft_outlines([[(x, y, zt) for x, y in K.chamfer_rect(mx - 2.6, mx + 2.6, my - 2.8, my + 2.8, 0.9)],
                         [(x, y, zt + 7.6) for x, y in K.chamfer_rect(mx - 1.4, mx + 1.4, my - 1.4, my + 1.4, 0.5)]])]
mast.append(K.cylinder_z(mx, my, zt + 7.6, zt + 8.4, 2.0, 2.0, 24))
obj('Integrated mast', K.merge(*mast), C_ISLAND, M_ISLAND)
obj('Mast radome', K.sphere((mx, my, zt + 9.9), 1.75, 28, 14), C_ISLAND, M_WHITE, smooth=True)
pole = [K.cylinder_z(mx, my, zt + 11.4, FD + IH['mast_top'], 0.22, 0.1, 10),
        K.sweep([(mx - 3.5, my, zt + 12.6), (mx + 3.5, my, zt + 12.6)], 0.09, 6),
        K.sweep([(mx - 2.0, my, zt + 13.6), (mx + 2.0, my, zt + 13.6)], 0.07, 6)]
for dx in (-3.2, -1.6, 1.6, 3.2):
    pole.append(K.cylinder_z(mx + dx, my, zt + 12.6, zt + 13.4, 0.06, 0.04, 6))
obj('Mast pole & yard', K.merge(*pole), C_ISLAND, M_STEEL, smooth=True)
domes = []
for dx, dy in ((-4.0, 12.0), (4.0, 12.0), (-4.0, 26.4), (4.0, 26.4)):
    domes.append(K.cylinder_z(mx + dx, by0 + dy, zt, zt + 0.8, 0.5, 0.5, 12))
    domes.append(K.sphere((mx + dx, by0 + dy, zt + 1.6), 1.05, 20, 10))
obj('Roof satcom radomes', K.merge(*domes), C_ISLAND, M_WHITE, smooth=True)
obj('Exhaust uptake housing', K.prism(K.chamfer_rect(mx - 2.6, mx + 2.6, by0 + 14.5, by1 - 3.5, 1.0), zt, zt + 2.0), C_ISLAND, M_ISLAND)
obj('Exhaust grille', K.box(mx, (by0 + 14.5 + by1 - 3.5) / 2, zt + 2.05, 4.0, by1 - 3.5 - by0 - 16.0, 0.12), C_ISLAND, M_DARK)

# ----------------------------------------------------------------- weapons --
def yaw_dir(x, y):
    out = 1 if x > 0 else -1
    fwd = -1 if y < 0 else 1
    a = math.radians(35)
    return Vector((out * math.cos(a), fwd * math.sin(a), 0))

hq, hq_dark, ciws, ciws_dark = [], [], [], []
for x, y in F.HQ10:
    z0 = FD - 2.6
    d = yaw_dir(x, y)
    hq.append(K.cylinder_z(x, y, z0, z0 + 0.9, 1.3, 1.2, 20))
    c = Vector((x, y, z0 + 2.15))
    hq.append(K.oriented_box(c, d, (0, 0, 1), (2.7, 3.2, 2.4)))
    hq.append(K.oriented_box(c + Vector((0, 0, 1.55)) - d * 0.8, d, (0, 0, 1), (0.9, 0.9, 0.7)))
    r = d.cross(Vector((0, 0, 1))).normalized()
    front = c + d * 1.62
    for row in range(4):
        for col in range(6):
            p = front + r * ((col - 2.5) * 0.4) + Vector((0, 0, (row - 1.5) * 0.45))
            hq_dark.append(K.oriented_box(p, d, (0, 0, 1), (0.3, 0.06, 0.3)))
for x, y in F.CIWS:
    z0 = FD - 2.6
    d = yaw_dir(x, y)
    ciws.append(K.cylinder_z(x, y, z0, z0 + 1.0, 1.35, 1.25, 20))
    c = Vector((x, y, z0 + 1.9))
    ciws.append(K.oriented_box(c, d, (0, 0, 1), (2.3, 2.6, 1.6)))
    ciws.append(K.sphere(tuple(c + Vector((0, 0, 0.8)) - d * 0.4), 1.15, 20, 8, zmin=0.0))
    gun = K.lathe([(0, 0.34), (2.4, 0.3), (2.4, 0)], 14)
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    ciws.append(K.transform(gun, Matrix.Translation(c + d * 1.2) @ rot))
    for b in range(11):
        a = 2 * math.pi * b / 11
        off = Matrix.Translation((0.2 * math.cos(a), 0, 0.2 * math.sin(a)))
        ciws_dark.append(K.transform(K.lathe([(0, 0.035), (1.0, 0.035), (1.0, 0)], 6),
                                     Matrix.Translation(c + d * 3.55) @ rot @ off))
    ciws.append(K.sphere(tuple(c + Vector((0, 0, 1.75)) - d * 0.9), 0.45, 14, 7))
obj('HQ-10 launchers (24-cell)', K.merge(*hq), C_WEAP, M_HULL)
obj('HQ-10 cell covers', K.merge(*hq_dark), C_WEAP, M_DARK)
obj('H/PJ-11 CIWS mounts', K.merge(*ciws), C_WEAP, M_HULL, smooth=True)
obj('H/PJ-11 barrels', K.merge(*ciws_dark), C_WEAP, M_STEEL)
dm = []
for x, y in F.DOMES:
    dm.append(K.cylinder_z(x, y, FD - 2.6, FD - 1.2, 1.2, 1.2, 16))
    dm.append(K.sphere((x, y, FD + 0.6), 2.1, 24, 12))
obj('Sponson radome', K.merge(*dm), C_WEAP, M_WHITE, smooth=True)
# decoy launchers on the forward sponsons
dec = []
for x, y in (F.HQ10[0], F.HQ10[1]):
    out = 1 if x > 0 else -1
    dec.append(K.oriented_box((x + out * 1.0, y + 4.2, FD - 2.0), (out, 0.4, 0.6), (0, 0, 1), (1.6, 1.2, 1.0)))
obj('Decoy launchers', K.merge(*dec), C_WEAP, M_HULL)

# --------------------------------------------------- deck equipment -------
eq = []
for front, aft in F.CATAPULTS:
    d = (Vector((front[0], front[1], 0)) - Vector((aft[0], aft[1], 0))).normalized()
    eq.append(K.oriented_box((aft[0] + d.x * 0.8, aft[1] + d.y * 0.8, FD + 0.12), d, (0, 0, 1), (0.7, 1.4, 0.24)))
for x0j, x1j, y0j, y1j in F.JBDS:
    eq.append(K.box((x0j + x1j) / 2, (y0j + y1j) / 2, FD + 0.04, x1j - x0j, y1j - y0j, 0.08))
obj('Catapult shuttles & stowed blast deflectors', K.merge(*eq), C_DECK, M_STEEL)
(ax, ay), (bx_, by_) = F.LANDING_AXIS
ux, uy = bx_ - ax, by_ - ay; L = math.hypot(ux, uy); ux, uy = ux / L, uy / L
wires, sheaves = [], []
for sx, sy in F.WIRE_STATIONS:
    t = (sx - ax) * ux + (sy - ay) * uy
    cx, cy = ax + ux * t, ay + uy * t
    p0 = (cx + uy * F.WIRE_HALF_SPAN, cy - ux * F.WIRE_HALF_SPAN, FD + 0.1)
    p1 = (cx - uy * F.WIRE_HALF_SPAN, cy + ux * F.WIRE_HALF_SPAN, FD + 0.1)
    wires.append(K.sweep([p0, p1], 0.045, 6))
    for p in (p0, p1):
        sheaves.append(K.oriented_box((p[0], p[1], FD + 0.12), (ux, uy, 0), (0, 0, 1), (0.5, 2.0, 0.24)))
obj('Arresting wires (4)', K.merge(*wires), C_DECK, M_WIRE, smooth=True)
obj('Arresting gear sheaves', K.merge(*sheaves), C_DECK, M_STEEL)
fx, fy = 35.2, F.FLOLS[1]       # on the port catwalk
fl = [K.box(fx + 0.6, fy, FD + 1.6, 1.0, 1.4, 3.6), K.box(fx + 0.6, fy, FD + 3.5, 3.6, 0.6, 0.3)]
obj('Optical landing aid housing', K.merge(*fl), C_DECK, M_STEEL)
obj('Optical landing aid lights', K.merge(*[K.box(fx + 0.6 + dx, fy - 0.72, FD + 0.6 + dz, 0.3, 0.06, 0.25)
                                             for dx in (-0.25, 0.25) for dz in (0.4, 0.9, 1.4, 1.9, 2.4, 2.9)]),
    C_DECK, M_LIGHT)
ant = []
for x, y, length in F.ANTENNAS:
    s = 1 if length > 0 else -1
    ant.append(K.box(x + s * 0.4, y, FD - 1.0, 0.8, 0.8, 0.9))
    ant.append(K.transform(K.lathe([(0, 0.16), (abs(length), 0.05), (abs(length), 0)], 8),
                           Matrix.Translation((x + s * 0.6, y, FD - 1.0)) @ Matrix.Rotation(-s * math.pi / 2, 4, 'Z')))
obj('Folding whip antennas (lowered)', K.merge(*ant), C_DECK, M_STEEL, smooth=True)
rafts = []
for poly in F.SPONSONS[2:4]:
    cxs, cys = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    for k in range(5):
        rafts.append(K.transform(K.lathe([(0, 0.34), (1.5, 0.34), (1.5, 0)], 12),
                                 Matrix.Translation((cxs + (2.2 if cxs > 0 else -2.2), cys - 6 + k * 0.85, FD - 2.25)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')))
obj('Liferaft canisters', K.merge(*rafts), C_DECK, M_WHITE, smooth=True)

# --------------------------------------------------------------- underwater --
props, shafts, rudders = [], [], []
for xs, yp, zp in ((6.5, 134.0, -8.6), (16.5, 122.0, -8.6)):
    for s in (1, -1):
        x = s * xs
        hub = K.lathe([(-0.6, 0), (-0.5, 0.45), (0.4, 0.55), (0.9, 0.3), (1.1, 0)], 16)
        props.append(K.translate(hub, (x, yp, zp)))
        for b in range(5):
            a = 2 * math.pi * b / 5 + (0.3 if s > 0 else -0.3)
            blade = K.prism([(0.45, -0.35), (1.4, -0.55), (2.45, -0.15), (2.35, 0.35), (1.3, 0.5), (0.45, 0.3)], -0.05, 0.05, 'XY')
            m = Matrix.Translation((x, yp, zp)) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Rotation(s * math.radians(25), 4, 'X')
            props.append(K.transform(blade, m))
        y_in = yp - 30
        shafts.append(K.sweep([(x, yp - 0.6, zp), (x, y_in, zp - 1.9)], 0.42, 12))
        for ys in (yp - 4.5, yp - 16):
            zt_ = zp + (zp - 1.9 - zp) * (yp - ys) / 30
            shafts.append(K.oriented_box((x, ys, zt_ + 2.3), (0, 1, 0), (0, 0, 1), (0.45, 1.6, 4.6)))
for s in (1, -1):
    rudders.append(K.prism([(138.5, -3.8), (145.8, -3.8), (145.2, -10.6), (139.6, -10.6)], -0.45, 0.45, 'YZ'))
    rudders[-1] = K.translate(rudders[-1], (s * 10.5, 0, 0))
    keel = K.oriented_box((s * 18.6, 22, -10.2), (0, 1, 0), (s, 0, -1), (0.25, 110, 1.2))
    rudders.append(keel)
obj('Propellers (4 x 5-blade)', K.merge(*props), C_UNDER, M_PROP, smooth=True)
obj('Shafts & struts', K.merge(*shafts), C_UNDER, M_RED, smooth=True)
obj('Rudders & bilge keels', K.merge(*rudders), C_UNDER, M_RED)
hawse = []
for s in (1, -1):
    disc = K.lathe([(0, 0.95), (0.25, 0.95), (0.25, 0)], 20)          # axis +Y
    m = Matrix.Translation((s * (hull_x(-134, 9.0, s) - 0.05), -134, 9.0)) @ Matrix.Rotation(-s * math.radians(72), 4, 'Z')
    hawse.append(K.transform(disc, m))
obj('Hawse pipes', K.merge(*hawse), C_HULL, M_DARK, smooth=True)

# ------------------------------------------------- hull number on the bow --
def hull_number(side):
    cu = bpy.data.curves.new('18', 'FONT'); cu.body = '18'; cu.size = 7.5
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    tmp = bpy.data.objects.new('tmp', cu); sc.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=3, use_grid_fill=True)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(f'Hull number 18 ({"port" if side > 0 else "starboard"})', me)
    C_HULL.objects.link(ob)
    y, z = -128.0, 9.0
    x = side * (hull_x(y, z, side) + 1.5)
    rot = Matrix(((0, 0, side), (side, 0, 0), (0, 1, 0))).to_4x4() if side > 0 else Matrix(((0, 0, side), (side, 0, 0), (0, 1, 0))).to_4x4()
    ob.matrix_world = Matrix.Translation((x, y, z)) @ rot
    me.materials.append(M_NUMBER)
    mod = ob.modifiers.new('wrap', 'SHRINKWRAP'); mod.target = hull; mod.wrap_method = 'NEAREST_SURFACEPOINT'; mod.offset = 0.06
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
hull_number(1); hull_number(-1)

# -------------------------------------------------------------- finishing --
root = bpy.data.objects.new('Fujian CV-18', None); sc.collection.objects.link(root)
meshes = [o for o in sc.objects if o.type == 'MESH']
for o in meshes:
    o.parent = root
root['model'] = 'PLAN Fujian (CV-18), Type 003 aircraft carrier'
root['license'] = 'CC BY-SA 4.0 (layout traced from Gryfia, Wikimedia Commons)'
lo, hi = K.bounds(meshes)
w = bpy.data.worlds.new('Sea sky'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.64, 0.75, 1)
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(42), 0, math.radians(-40)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35; cam.data.clip_end = 3000
cam.location = (260, -330, 160); cam.rotation_euler = (math.radians(66), 0, math.radians(38))
sc.render.engine = 'BLENDER_EEVEE'
tri = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)

root.rotation_euler.z = math.pi           # glTF: +Y up, bow toward -Z
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', export_yup=True, export_apply=True,
                          export_extras=True, export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=88)
report = {
    'asset': GLB.name, 'blend': str(BLEND.relative_to(ROOT)),
    'blend_sha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
    'units': 'metres', 'blender_axes': '+Z up (waterline 0), bow -Y, +X port', 'glb_axes': '+Y up, bow -Z',
    'length_overall': round(hi.y - lo.y, 2), 'flight_deck_width': round(max(p[0] for p in deck) - min(p[0] for p in deck), 2),
    'beam_overall_incl_sponsons': round(hi.x - lo.x, 2), 'waterline_beam': round(2 * K.interp(HALF, 0.0), 2),
    'draft': -lo.z, 'flight_deck_height': FD, 'mast_top_above_waterline': round(hi.z, 2),
    'angled_deck_deg': round(math.degrees(math.atan2(ax - bx_, by_ - ay)), 2),
    'triangles': tri, 'license': 'CC BY-SA 4.0',
    'references': ['https://commons.wikimedia.org/wiki/File:Type_003_Aircraft_Carrier_Fujian_(18).svg',
                   'https://commons.wikimedia.org/wiki/File:PLAN_CV-18_Fujian_20250911.jpg',
                   'https://commons.wikimedia.org/wiki/File:Chinese_aircraft_carrier_Fujian_flight_deck.jpg'],
}
META.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('FUJIAN', json.dumps(report, ensure_ascii=False))
