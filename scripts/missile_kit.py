"""Real-scale missile geometry shared by build-missiles.py and build-j16.py.

Published figures (length, body diameter, YJ-83 wingspan) are used as hard
dimensions; fin chords, spans and stations are not published and are
estimated from photographs.  Each SPEC entry records which is which.

Missile axes: metres, nose toward -Y, +Z up.  build() places the missile so
that `matrix` maps its local origin (mid-length on the body axis).
"""
import math
import bpy
import bmesh
from mathutils import Matrix, Vector
import blender_kit as K


def srgb(*c):
    return tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in c)


def mats():
    return {
        'body': K.material('Missile body light grey', srgb(214, 217, 215), rough=0.38),
        'white': K.material('Missile body white', srgb(232, 233, 230), rough=0.35),
        'radome': K.material('Missile radome off-white', srgb(238, 236, 226), rough=0.3),
        'grey_radome': K.material('Missile radome grey', srgb(150, 154, 156), rough=0.32),
        'dome': K.material('IR seeker dome', srgb(40, 34, 52), rough=0.03, metal=0.3, spec=1.0),
        'band': K.material('Missile section band', srgb(58, 60, 62), rough=0.5),
        'nozzle': K.material('Missile nozzle', srgb(34, 33, 32), rough=0.55, metal=0.6),
        'steel': K.material('Missile steel fittings', srgb(120, 122, 124), rough=0.35, metal=0.8),
        'stencil': K.material('Missile stencil black', srgb(25, 25, 27), rough=0.6),
        'yellow': K.material('Missile warhead band yellow', srgb(214, 172, 30), rough=0.45),
        'booster': K.material('Missile booster grey', srgb(128, 134, 136), rough=0.45),
        'intake': K.material('Missile intake shadow', srgb(14, 14, 15), rough=0.9),
    }


def ogive(length, radius, tip=0.0, n=16, start=0.0):
    """Tangent-ogive nose profile [(t, r)] from t=start (tip) to t=start+length."""
    rho = (radius ** 2 + length ** 2) / (2 * radius)
    pts = []
    for i in range(n + 1):
        x = length * (i / n) ** 1.6
        r = math.sqrt(max(0.0, rho ** 2 - (length - x) ** 2)) + radius - rho
        pts.append((start + x, max(tip, r) if i else 0.0))
    if tip:
        pts.insert(1, (start, tip))
    return pts


def dome(radius, n=10, start=0.0):
    """Hemispherical dome profile from its pole."""
    return [(start + radius * (1 - math.cos(math.pi / 2 * i / n)), radius * math.sin(math.pi / 2 * i / n))
            for i in range(n + 1)]


def fin(planform, thickness, bevel):
    """Double-wedge fin.  planform: [(radial, axial)] at the body surface."""
    mid = [(u, v, 0.0) for u, v in planform]
    inner = K.inset_polygon(planform, bevel)
    top = [(u, v, thickness / 2) for u, v in inner]
    bot = [(u, v, -thickness / 2) for u, v in inner]
    n = len(planform)
    verts = mid + top + bot
    faces = [tuple(range(n, 2 * n)), tuple(reversed(range(2 * n, 3 * n)))]
    for k in range(n):
        j = (k + 1) % n
        faces.append((n + k, n + j, j, k))
        faces.append((k, j, 2 * n + j, 2 * n + k))
    return verts, faces


def cruciform(planform, r, thickness, bevel, roll_deg=45, count=4):
    """Four fins around the body; planform radial coordinate starts at 0 on the skin."""
    parts = []
    shifted = [(r - 0.002 + u, v) for u, v in planform]
    base = fin(shifted, thickness, bevel)
    for k in range(count):
        parts.append(K.transform(base, Matrix.Rotation(math.radians(roll_deg + 360 / count * k), 4, 'Y')))
    return K.merge(*parts)


def ring(t, r, width, grow=0.0012):
    return K.lathe([(t - width / 2, r + grow), (t + width / 2, r + grow)], 48, cap=False)


def lug(t, r, size=0.03):
    """T-shaped suspension lug / launch hook on top of the body."""
    return K.merge(K.box(0, t, r + size * 0.35, size * 0.5, size, size * 0.7),
                   K.box(0, t, r + size * 0.8, size * 0.9, size * 1.3, size * 0.25))


# --------------------------------------------------------------- specs ----
SPECS = {
    'PL-15': {
        'title': '霹雳-15 中远距空空导弹', 'role': 'AESA 主动雷达制导，双脉冲固体火箭发动机',
        'length': 3.996, 'diameter': 0.203,
        'published': ['length 3.996 m (PL-15E)', 'diameter 0.203 m', 'mass ~210 kg (PL-15E)'],
        'estimated': ['centre-body fin 0.60 m chord, 0.07 m span', 'tail fin 0.36 m root chord, 0.13 m span'],
        'mass_kg': 210,
    },
    'PL-10': {
        'title': '霹雳-10 近距格斗空空导弹', 'role': '红外成像制导，推力矢量 + 尾舵',
        'length': 3.0, 'diameter': 0.16,
        'published': ['length 3.0 m', 'diameter 0.16 m', 'mass 89 kg'],
        'estimated': ['body strakes 1.9 m long, 0.035 m high', 'tail fin 0.28 m root chord, 0.12 m span'],
        'mass_kg': 89,
    },
    'HQ-10': {
        'title': '红旗-10 舰载近程防空导弹', 'role': '被动射频 + 红外复合制导，24 联装发射装置',
        'length': 2.0, 'diameter': 0.127,
        'published': ['length ~2.0 m', 'diameter 0.127 m'],
        'estimated': ['rectangular canards 0.12 m chord, 0.065 m span', 'tail fins 0.19 m root chord, 0.08 m span'],
        'mass_kg': None,
    },
    'YJ-83': {
        'title': '鹰击-83 反舰导弹（舰射型，含助推器）', 'role': '涡喷发动机巡航，末段主动雷达制导',
        'length': 6.38, 'diameter': 0.36,
        'published': ['length 6.38 m (with booster)', 'diameter 0.36 m', 'wingspan 1.22 m', 'mass ~800 kg'],
        'estimated': ['wing 0.90 m root chord, mid-body', 'booster 1.20 m long with four fins', 'ventral intake 1.3 m'],
        'mass_kg': 800,
    },
}


def build(kind, coll, matrix=Matrix.Identity(4), prefix=None, stencil=True):
    """Create one missile; returns the created objects."""
    m = mats()
    s = SPECS[kind]
    L, r = s['length'], s['diameter'] / 2
    name = prefix or kind
    # geometry is built nose at t=0 along +Y, then shifted so mid-length is the origin
    to_origin = matrix @ Matrix.Translation((0, -L / 2, 0))
    out = []

    def add(label, part, mat, smooth=False):
        ob = K.mesh_object(f'{name} {label}', *K.transform(part, to_origin), coll, mat, smooth=smooth)
        out.append(ob)
        return ob

    if kind == 'PL-15':
        nose = ogive(0.62, r, tip=0.008, n=18)
        add('AESA radome', K.lathe(nose, 48), m['radome'], True)
        add('body', K.lathe([(0.62, r), (3.90, r), (3.975, r * 0.86), (3.996, r * 0.80), (3.996, 0)], 48), m['body'], True)
        add('nozzle', K.lathe([(3.986, r * 0.70), (3.996, r * 0.70), (3.930, r * 0.42), (3.930, 0)], 32, cap=False), m['nozzle'], True)
        add('centre-body fins', cruciform([(0, 1.55), (0, 2.15), (0.07, 2.08), (0.07, 1.80)], r, 0.010, 0.004), m['body'])
        add('tail control fins', cruciform([(0, 3.60), (0, 3.96), (0.13, 3.94), (0.13, 3.82)], r, 0.012, 0.005), m['body'])
        details = [K.box(0, 2.10, r + 0.008, 0.032, 2.60, 0.016), lug(1.30, r), lug(2.85, r),
                   K.box(0, 1.98, r + 0.02, 0.05, 0.08, 0.03)]
        add('raceway, lugs & umbilical', K.merge(*details), m['steel'])
        add('section bands', K.merge(ring(0.62, r, 0.012), ring(1.18, r, 0.008), ring(1.55, r, 0.008), ring(2.25, r, 0.03)), m['band'], True)
        add('warhead band', ring(1.36, r, 0.025, 0.0008), m['yellow'], True)
    elif kind == 'PL-10':
        cone = [(0.0, 0.0)] + [(t + 0.0, rr) for t, rr in dome(0.058, 10)[1:]]
        add('IR seeker dome', K.lathe(cone, 40), m['dome'], True)
        add('body', K.lathe([(0.058, 0.058), (0.10, 0.064), (0.20, r), (2.93, r), (2.985, r * 0.85), (3.0, r * 0.82), (3.0, 0)], 48), m['white'], True)
        add('nozzle & jet vanes', K.merge(
            K.lathe([(2.992, r * 0.66), (3.0, r * 0.66), (2.94, r * 0.4), (2.94, 0)], 32, cap=False),
            *[K.transform(K.box(0, 2.972, 0, 0.004, 0.05, r * 1.1), Matrix.Rotation(math.radians(45 + 90 * k), 4, 'Y'))
              for k in range(4)]), m['nozzle'], True)
        add('body strakes', cruciform([(0, 0.55), (0, 2.45), (0.035, 2.30), (0.035, 0.75)], r, 0.006, 0.002), m['white'])
        add('tail control fins', cruciform([(0, 2.68), (0, 2.96), (0.12, 2.93), (0.12, 2.81)], r, 0.010, 0.004), m['white'])
        add('launch hooks', K.merge(lug(0.95, r, 0.026), lug(1.85, r, 0.026), K.box(0, 1.40, r + 0.006, 0.026, 1.4, 0.012)), m['steel'])
        add('section bands', K.merge(ring(0.20, r, 0.01), ring(0.62, r, 0.008), ring(1.05, r, 0.008)), m['band'], True)
        add('warhead band', ring(0.84, r, 0.02, 0.0008), m['yellow'], True)
    elif kind == 'HQ-10':
        add('seeker dome', K.lathe(dome(0.05, 10), 40), m['dome'], True)
        add('body', K.lathe([(0.05, 0.05), (0.09, 0.056), (0.17, r), (1.96, r), (2.0, r * 0.82), (2.0, 0)], 48), m['white'], True)
        add('nozzle', K.lathe([(1.992, r * 0.62), (2.0, r * 0.62), (1.95, r * 0.35), (1.95, 0)], 28, cap=False), m['nozzle'], True)
        add('rectangular canards', cruciform([(0, 0.18), (0, 0.30), (0.065, 0.30), (0.065, 0.18)], r, 0.006, 0.002, roll_deg=0), m['white'])
        add('tail fins', cruciform([(0, 1.78), (0, 1.97), (0.08, 1.96), (0.08, 1.86)], r, 0.007, 0.003), m['white'])
        add('RF antennas', K.merge(*[K.transform(K.box(0, 0.36, r + 0.006, 0.012, 0.05, 0.012), Matrix.Rotation(math.radians(45 + 90 * k), 4, 'Y'))
                                     for k in range(4)]), m['band'])
        add('section bands', K.merge(ring(0.17, r, 0.008), ring(0.55, r, 0.008)), m['band'], True)
    elif kind == 'YJ-83':
        nose = ogive(0.95, r, tip=0.02, n=18)
        add('radar radome', K.lathe(nose, 48), m['grey_radome'], True)
        add('body', K.lathe([(0.95, r), (5.12, r), (5.18, r * 0.97), (5.18, 0)], 48), m['body'], True)
        add('booster', K.lathe([(5.18, 0), (5.18, r * 0.97), (5.22, r), (6.28, r), (6.36, r * 0.82), (6.38, r * 0.74), (6.38, 0)], 48), m['booster'], True)
        add('booster nozzle', K.lathe([(6.37, r * 0.62), (6.38, r * 0.62), (6.30, r * 0.4), (6.30, 0)], 32, cap=False), m['nozzle'], True)
        span = 1.22 / 2 - r
        add('cruciform wings', cruciform([(0, 2.25), (0, 3.15), (span, 3.05), (span, 2.75)], r, 0.022, 0.009), m['body'])
        add('tail control fins', cruciform([(0, 4.62), (0, 5.08), (0.27, 5.04), (0.27, 4.84)], r, 0.016, 0.006), m['body'])
        add('booster fins', cruciform([(0, 5.80), (0, 6.30), (0.30, 6.30), (0.30, 6.05)], r, 0.014, 0.005, roll_deg=0), m['booster'])
        intake = K.prism([(-0.11, 0.0), (0.11, 0.0), (0.085, -0.13), (-0.085, -0.13)], 3.55, 4.95, 'XZ')
        intake = K.transform(intake, Matrix.Translation((0, 0, -r + 0.03)))
        add('ventral air intake', intake, m['body'])
        add('intake mouth', K.box(0, 3.545, -r - 0.035, 0.16, 0.01, 0.09), m['intake'])
        add('section bands', K.merge(ring(0.95, r, 0.015), ring(1.9, r, 0.01), ring(3.4, r, 0.01), ring(5.18, r, 0.02)), m['band'], True)
        add('warhead band', ring(1.55, r, 0.04, 0.0008), m['yellow'], True)
        add('booster lugs', K.merge(lug(5.5, r, 0.05), lug(1.6, r, 0.05), lug(3.9, r, 0.05)), m['steel'])
    if stencil:
        out.append(_stencil(kind, name, coll, to_origin, r, m['stencil']))
    for ob in out:
        ob['missile'] = kind
    return out


def _stencil(kind, name, coll, to_origin, r, mat):
    """Designation text wrapped round the port side of the body."""
    cu = bpy.data.curves.new(f'{name} stencil', 'FONT')
    cu.body = kind
    cu.size = r * 0.75
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    tmp = bpy.data.objects.new('tmp', cu); bpy.context.scene.collection.objects.link(tmp)
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    station = {'PL-15': 1.85, 'PL-10': 1.40, 'HQ-10': 0.95, 'YJ-83': 2.15}[kind]
    # text in the YZ plane on the +X (port) side, reading nose -> tail
    place = Matrix(((0, 0, 1, r + 0.0015), (1, 0, 0, station), (0, 1, 0, 0), (0, 0, 0, 1)))
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=2, use_grid_fill=True)
    for v in bm.verts:
        p = place @ v.co
        a = p.z / r                       # wrap round the cylinder
        p = Vector(((r + 0.0015) * math.cos(a), p.y, (r + 0.0015) * math.sin(a)))
        v.co = to_origin @ p
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(f'{name} stencil', me)
    coll.objects.link(ob)
    return ob
