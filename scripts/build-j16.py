"""Build the editable J-16 Blender model from the GPL FGUK Su-27 mesh.

Run from the project root:
    '/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background \
        --factory-startup --python scripts/build-j16.py

Source mesh: FGUK / FGMEMBERS SU-27 (GPL-2.0).  The Su-27 airframe is turned
into a J-16 (Su-30MKK family two-seater) by:
  * a two-seat tandem cockpit with a long single-piece canopy, a rear
    cockpit tub, second seat and a raised dorsal spine behind the canopy;
  * taller Su-27UB/Su-30-style fins (+0.42 m, squared tips kept);
  * wingtip ECM pods and an air-to-air load (PL-15, PL-10) on pylons;
  * a J-16 grey repaint of the PLAAF livery (scripts/j16-livery.py);
  * calibration to the published 21.9 m length / 6.36 m height.
Blender axes: metres, +Z up, nose toward -Y, +X = port.
"""
import sys, math, json, hashlib
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import ac3d_reader as ac3d
import blender_kit as K

SRC = ROOT / 'assets/models/j16-source'
AC_FILE = SRC / 'source-assets/Su-27.ac'
TEXTURE = SRC / 'textures/j16_plaaf_grey.png'
BLEND = SRC / 'J-16.blend'
GLB = ROOT / 'assets/models/j16.glb'
META = ROOT / 'assets/models/j16.metadata.json'

J16_LENGTH = 21.9          # m, published overall length
J16_HEIGHT = 6.36          # m, published height (Su-27UB/Su-30 family fins)
FIN_GAIN = 0.42            # m, two-seater fin height increase over Su-27
FIN_ROOT_Z = 0.62
DORSAL_RAISE = 0.17

def srgb(*c):
    return tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in c)

GREY = srgb(104, 112, 121)

sc = K.reset_scene()
C_AIR = K.collection('J-16 airframe')
C_COCKPIT = K.collection('J-16 canopy & cockpit')
C_GEAR = K.collection('J-16 landing gear')
C_STORES = K.collection('J-16 pods & weapons')

M_SKIN = K.image_material('J-16 skin (PLAAF grey)', TEXTURE, rough=0.52, bump=0.35)
M_PAINT = K.material('J-16 grey paint', GREY, rough=0.5)
M_GLASS = K.material('J-16 canopy glass', (0.10, 0.11, 0.10), rough=0.04, alpha=0.28, spec=0.9)
M_COCKPIT = K.material('J-16 cockpit interior', (0.035, 0.038, 0.04), rough=0.8)
M_SEAT = K.material('J-16 ejection seat', (0.045, 0.05, 0.035), rough=0.7)
M_SCREEN = K.material('J-16 MFD glass', (0.01, 0.02, 0.015), rough=0.15,
                      emission=(0.05, 0.25, 0.12), emission_strength=0.6)
M_TYRE = K.material('J-16 tyre rubber', (0.02, 0.02, 0.02), rough=0.85)
M_HUB = K.material('J-16 wheel hub', srgb(92, 112, 86), rough=0.45)
M_STRUT = K.material('J-16 gear strut', srgb(196, 199, 196), rough=0.35, metal=0.3)
M_MISSILE = K.material('Missile white', srgb(222, 224, 220), rough=0.4)
M_SEEKER = K.material('Missile radome grey', srgb(92, 96, 98), rough=0.35)
M_IR_DOME = K.material('PL-10 seeker dome', (0.03, 0.035, 0.04), rough=0.05, metal=0.2, spec=1.0)
M_POD_RADOME = K.material('ECM pod dielectric', srgb(70, 76, 82), rough=0.45)
M_PYLON = M_PAINT

# ------------------------------------------------------------ import AC ----
REPLACED = {'Canopy', 'GLS_Canopy_Rear.001', 'GLS_Canopy_Rear', 'object.001',
            'UC_Nose_WGuard'}   # Su-27 single-wheel mudguard; J-16 has twin nose wheels
GEAR_MATS = {2: M_HUB, 3: M_STRUT, 4: M_TYRE}
mats, objs = ac3d.parse(str(AC_FILE))
air, gear = [], []
seat = None
for o in objs:
    if not o['surfs'] or o['name'] in REPLACED:
        continue
    verts = [(v[2], v[0], v[1]) for v in o['world']]   # AC(x aft, y up, z left)
    faces, uvs, fmat, smooth = [], [], [], []
    for s in o['surfs']:
        if (s['flags'] & 0xF) != 0 or len(s['refs']) < 3:
            continue
        faces.append([r[0] for r in s['refs']])
        uvs.append([(r[1], r[2]) for r in s['refs']])
        fmat.append(s['mat'])
        smooth.append(bool(s['flags'] & 0x10))
    is_gear = o['name'].startswith('UC')
    is_seat = o['texture'] == 'Eject_Seat.png'
    coll = C_GEAR if is_gear else C_COCKPIT if is_seat else C_AIR
    ob = K.mesh_object(o['name'], verts, faces, coll, uvs=uvs, recalc=False)
    me = ob.data
    if is_gear:
        used = sorted(set(fmat))
        for mi in used:
            me.materials.append(GEAR_MATS.get(mi, M_STRUT))
        for p, mi in zip(me.polygons, fmat):
            p.material_index = used.index(mi)
        gear.append(ob)
    elif is_seat:
        me.materials.append(M_SEAT)
        seat = ob
    else:
        me.materials.append(M_SKIN)
        air.append(ob)
    for p, sm in zip(me.polygons, smooth):
        p.use_smooth = sm
    K.sharpen_by_angle(ob, o['crease'] or 45)
    ob['source'] = 'FGMEMBERS/SU-27 ' + '/'.join(o['path'])
hull = bpy.data.objects['HULL_Hull_Upper.001']
hull.name = hull.data.name = 'J16 fuselage, wings & tail'
seat.name = 'Front ejection seat'

def edit_verts(objects, fn):
    for ob in objects:
        for v in ob.data.vertices:
            v.co = fn(v.co.copy())
        ob.data.update()

# ------------------------------------------- 1. taller two-seater fins ----
fin_top = max(v.co.z for ob in air for v in ob.data.vertices)
fin_k = (fin_top + FIN_GAIN - FIN_ROOT_Z) / (fin_top - FIN_ROOT_Z)
def fins(c):
    if c.y > 13.5 and 1.9 < abs(c.x) < 2.6 and c.z > FIN_ROOT_Z:
        c.z = FIN_ROOT_Z + (c.z - FIN_ROOT_Z) * fin_k
    return c
edit_verts(air, fins)

# ------------------------------------------ 2. raised dorsal spine -------
def dorsal(c):
    d = DORSAL_RAISE * K.smoothstep(7.7, 8.2, c.y) * (1 - K.smoothstep(9.2, 11.0, c.y))
    d *= (1 - K.smoothstep(0.35, 0.85, abs(c.x))) * K.smoothstep(0.80, 1.0, c.z)
    c.z += d
    return c
edit_verts(air, dorsal)

# ---------------------------- 3. parked oleo compression for 6.36 m height
top = max(v.co.z for ob in air for v in ob.data.vertices)
bottom = min(v.co.z for ob in gear for v in ob.data.vertices)
pre_len = max(v.co.y for ob in air for v in ob.data.vertices) - min(v.co.y for ob in air for v in ob.data.vertices)
scale = J16_LENGTH / pre_len
gear_drop = (top - bottom) - J16_HEIGHT / scale
for ob in gear:
    nose = ob.name.startswith('UC_Nose')
    z_attach, z_full = (0.42, -1.62) if nose else (0.07, -1.42)
    for v in ob.data.vertices:
        t = min(1, max(0, (z_attach - v.co.z) / (z_attach - z_full)))
        v.co.z += gear_drop * t
    ob.data.update()

# ------------------------------------------ 4. two-seat canopy & cockpit --
def bvh_of(objects):
    bm = bmesh.new()
    for ob in objects:
        tmp = bmesh.new(); tmp.from_mesh(ob.data)
        tmp.transform(ob.matrix_world)
        me = bpy.data.meshes.new('_tmp'); tmp.to_mesh(me); tmp.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm); bm.free()
    return tree
skin_bvh = bvh_of(air)
def surface_z(x, y, start=6.0):
    hit = skin_bvh.ray_cast(Vector((x, y, start)), Vector((0, 0, -1)))
    return hit[0].z if hit[0] else None

# canopy stations: (y, half width, crown height); the first one is the
# windshield foot.  The crown rises toward the raised rear seat.
STATIONS = [(3.70, 0.28, None), (3.85, 0.36, 1.27), (4.05, 0.42, 1.42), (4.30, 0.46, 1.53),
            (4.62, 0.48, 1.62), (5.00, 0.50, 1.69), (5.40, 0.51, 1.735), (5.90, 0.51, 1.77),
            (6.40, 0.51, 1.795), (6.90, 0.50, 1.805), (7.40, 0.48, 1.79), (7.80, 0.45, 1.74),
            (8.05, 0.42, 1.67), (8.15, 0.40, 1.62)]
sill = []
for y, w, _ in STATIONS:
    zs = surface_z(w + 0.015, y)
    sill.append(zs if zs is not None else 1.05)
sill = [sill[0]] + [(a + 2 * b + c) / 4 for a, b, c in zip(sill, sill[1:], sill[2:])] + [sill[-1]]
sill = [z - 0.015 for z in sill]
crown = [c if c is not None else sill[i] + 0.035 for i, (_, _, c) in enumerate(STATIONS)]
SEG = 28
def section(i, outward=0.0):
    y, w, _ = STATIONS[i]
    zs, zt = sill[i], crown[i]
    pts = []
    for j in range(SEG + 1):
        t = math.pi * j / SEG
        c, s = math.cos(t), math.sin(t)
        x = (w + outward) * math.copysign(abs(c) ** (2 / 2.6), c)
        z = zs + (zt - zs + outward) * abs(s) ** (2 / 2.6)
        pts.append((x, y, z))
    return pts
def loft(i0, i1):
    verts, faces = [], []
    for i in range(i0, i1 + 1):
        verts += section(i)
    n = SEG + 1
    for i in range(i1 - i0):
        for j in range(SEG):
            a = i * n + j
            faces.append((a, a + 1, a + 1 + n, a + n))
    return verts, faces
ws = K.mesh_object('Windshield glass', *loft(0, 4), C_COCKPIT, M_GLASS, smooth=True)
canopy = K.mesh_object('Canopy glass (opens about rear hinge)', *loft(4, len(STATIONS) - 1), C_COCKPIT, M_GLASS, smooth=True)
last = section(len(STATIONS) - 1)
cap = K.mesh_object('Canopy rear frame cap', last + [(0, STATIONS[-1][0], sill[-1])],
                    [(j, j + 1, SEG + 1) for j in range(SEG)], C_COCKPIT, M_PAINT)
frames = []
for i in (4, 8, len(STATIONS) - 1):             # windshield arch, mid bow, rear frame
    frames.append(K.sweep(section(i, 0.006), 0.024 if i != 8 else 0.018, 6))
for side in (0, SEG):                           # canopy sills
    frames.append(K.sweep([section(i, 0.004)[side] for i in range(len(STATIONS))], 0.026, 6))
for j in (9, SEG - 9):                          # windshield side posts
    frames.append(K.sweep([section(i, 0.005)[j] for i in range(0, 5)], 0.016, 5))
K.mesh_object('Canopy & windshield frames', *K.merge(*frames), C_COCKPIT, M_PAINT, smooth=True)

# open the rear cockpit under the stretched canopy
def w_at(y):
    return K.interp([(s[0], s[1]) for s in STATIONS], y)
def zs_at(y):
    return K.interp([(s[0], z) for s, z in zip(STATIONS, sill)], y)
bm = bmesh.new(); bm.from_mesh(hull.data)
cut = []
for f in bm.faces:
    c = f.calc_center_median()
    if 6.05 < c.y < 8.08 and abs(c.x) < w_at(c.y) - 0.03 and c.z > zs_at(c.y) - 0.06 and f.normal.z > 0.15:
        cut.append(f)
bmesh.ops.delete(bm, geom=cut, context='FACES')
bm.to_mesh(hull.data); bm.free()

# rear cockpit tub, instrument panel and seat
ys = [6.0 + (8.06 - 6.0) * k / 12 for k in range(13)]
tub_v, tub_f = [], []
for y in ys:
    w, zs = w_at(y) - 0.035, zs_at(y) + 0.02
    tub_v += [(w, y, zs), (w, y, 0.55), (-w, y, 0.55), (-w, y, zs)]
for k in range(len(ys) - 1):
    a, b = 4 * k, 4 * (k + 1)
    tub_f += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3)]
end = 4 * (len(ys) - 1)
tub_f += [(0, 1, 2, 3), (end + 3, end + 2, end + 1, end)]
K.mesh_object('Rear cockpit tub', tub_v, tub_f, C_COCKPIT, M_COCKPIT)
panel = K.rotate_about(K.box(0, 6.13, 1.12, 0.66, 0.16, 0.36), -12, 'X', (0, 6.13, 1.12))
K.mesh_object('Rear instrument panel', *panel, C_COCKPIT, M_COCKPIT)
screens = K.merge(*[K.box(x, 6.215, 1.13, 0.17, 0.012, 0.15) for x in (-0.2, 0, 0.2)])
K.mesh_object('Rear cockpit MFDs', *K.rotate_about(screens, -12, 'X', (0, 6.13, 1.12)), C_COCKPIT, M_SCREEN)
rear_seat = seat.copy(); rear_seat.data = seat.data.copy()
rear_seat.name = 'Rear ejection seat'; C_COCKPIT.objects.link(rear_seat)
rear_seat.data.transform(Matrix.Translation((0, 1.55, 0.12)))

# ----------------------------------------------- 5. pods and weapons -----
under_bvh = bvh_of(air)
def underside(x, y):
    hit = under_bvh.ray_cast(Vector((x, y, -6.0)), Vector((0, 0, 1)))
    return hit[0].z if hit[0] else None
def chord(x):
    ys_hit = [y / 20 for y in range(140, 400) if underside(x, y / 20) is not None and underside(x, y / 20) > -0.2]
    return min(ys_hit), max(ys_hit)

def fin_set(L, r, t0, t1, span, tip0, tip1, th, count_angle=45):
    parts = []
    outline = [(r * 0.9, t0), (r * 0.9, t1), (r + span, tip1), (r + span, tip0)]
    for k in range(4):
        part = K.prism(outline, -th / 2, th / 2, 'XY')
        parts.append(K.transform(part, Matrix.Rotation(math.radians(count_angle + 90 * k), 4, 'Y')))
    return K.merge(*parts)

def missile(kind, name, x, y_nose, z_axis):
    if kind == 'PL-15':
        L, r = 3.99, 0.1015
        nose = [(0, 0), (0.05, 0.03), (0.14, 0.058), (0.28, 0.083), (0.45, 0.098), (0.58, r)]
        body = [(0.58, r), (3.92, r), (3.99, 0.088), (3.99, 0)]
        fins = fin_set(L, r, 3.52, 3.95, 0.17, 3.80, 3.93, 0.012)
        strakes = None
    else:
        L, r = 2.99, 0.08
        nose = [(0, 0), (0.035, 0.045), (0.075, 0.062)]
        body = [(0.075, 0.062), (0.16, 0.074), (0.28, r), (2.93, r), (2.99, 0.07), (2.99, 0)]
        fins = K.merge(fin_set(L, r, 2.30, 2.94, 0.21, 2.66, 2.92, 0.01),
                       fin_set(L, r, 0.30, 0.52, 0.065, 0.44, 0.52, 0.008))
    origin = Matrix.Translation((x, y_nose, z_axis))
    seeker = M_IR_DOME if kind == 'PL-10' else M_SEEKER
    K.mesh_object(f'{name} seeker', *K.transform(K.lathe(nose, 20), origin), C_STORES, seeker, smooth=True)
    K.mesh_object(f'{name} body', *K.transform(K.lathe(body, 20), origin), C_STORES, M_MISSILE, smooth=True)
    K.mesh_object(f'{name} fins', *K.transform(fins, origin), C_STORES, M_MISSILE)
    return L, r

def pylon(name, x, y0, y1, z_top, depth, thick=0.09):
    outline = [(y0 - 0.05, z_top + 0.05), (y1 + 0.05, z_top + 0.05), (y1 - 0.12, z_top - depth), (y0 + 0.18, z_top - depth)]
    K.mesh_object(name, *K.translate(K.prism(outline, -thick / 2, thick / 2, 'YZ'), (x, 0, 0)), C_STORES, M_PYLON)

stores = []
def hang(kind, name, x, y_center, attach, pylon_depth=None, rail=False):
    """Hang a missile under `attach` (z of the mounting surface or pylon foot).
    pylon_depth=None means the source mesh already has a pylon there."""
    L = 3.99 if kind == 'PL-15' else 2.99
    r = 0.1015 if kind == 'PL-15' else 0.08
    if pylon_depth:
        py0, py1 = y_center - L * 0.28, y_center + L * 0.22
        pylon(f'{name} pylon', x, py0, py1, attach, pylon_depth)
        attach -= pylon_depth
    if rail:
        K.mesh_object(f'{name} launch rail', *K.box(x, y_center + 0.05, attach - 0.022, 0.07, L * 0.62, 0.045),
                      C_STORES, M_PYLON)
        attach -= 0.045
    missile(kind, name, x, y_center - L / 2, attach - r - 0.005)
    stores.append({'type': kind, 'station': name})

def fuselage_station(x, y_center, L):
    return min(z for z in (underside(x, y_center + d) for d in (-0.3 * L, 0, 0.3 * L)) if z is not None)

def builtin_pylon(x):
    """Foot of the Su-27 wing pylon nearest to |x| (verts hanging >0.10 m below the wing)."""
    feet = []
    for v in hull.data.vertices:
        c = v.co
        if abs(c.x - x) < 0.2:
            h = under_bvh.ray_cast(c + Vector((0, 0, 0.03)), Vector((0, 0, 1)), 0.8)
            if h[0] and h[0].z - c.z > 0.10:
                feet.append(c.copy())
    return (sum(f.x for f in feet) / len(feet), (min(f.y for f in feet) + max(f.y for f in feet)) / 2,
            min(f.z for f in feet))

hang('PL-15', 'PL-15 tunnel front', 0.0, 10.55, fuselage_station(0.0, 10.55, 3.99), 0.10)
hang('PL-15', 'PL-15 tunnel rear', 0.0, 14.85, fuselage_station(0.0, 14.85, 3.99), 0.10)
for side, s in (('port', 1), ('starboard', -1)):
    hang('PL-15', f'PL-15 under-intake {side}', s * 1.27, 9.4, fuselage_station(s * 1.27, 9.4, 3.99), 0.14)
    px, py, pz = builtin_pylon(s * 4.79)
    hang('PL-15', f'PL-15 inner wing {side}', px, py + 0.35, pz)
    px, py, pz = builtin_pylon(s * 6.55)
    hang('PL-10', f'PL-10 outer wing {side}', px, py + 0.25, pz, rail=True)
    # wingtip ECM pod hung from the existing wingtip rail
    pod = [(0, 0), (0.12, 0.06), (0.30, 0.105), (0.55, 0.13)]
    body = [(0.55, 0.13), (2.95, 0.13), (3.30, 0.095), (3.50, 0.06), (3.55, 0)]
    o = Matrix.Translation((s * 7.555, 13.30, 0.10))
    K.mesh_object(f'Wingtip ECM pod {side} radome', *K.transform(K.lathe(pod, 20), o), C_STORES, M_POD_RADOME, smooth=True)
    K.mesh_object(f'Wingtip ECM pod {side} body', *K.transform(K.lathe(body, 20), o), C_STORES, M_PAINT, smooth=True)
stores.append({'type': 'wingtip ECM pod', 'station': 'wingtips', 'count': 2})

# ---------------------------------------- 6. calibrate, centre, ground ----
meshes = [o for o in sc.objects if o.type == 'MESH']
lo, hi = K.bounds(meshes)
s = J16_LENGTH / (hi.y - lo.y)
M = Matrix.Scale(s, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
for o in meshes:
    o.data.transform(M)
    o.data.update()
lo, hi = K.bounds(meshes)
# canopy pivots about its rear hinge
hinge = M @ Vector((0, STATIONS[-1][0], sill[-1]))
canopy.data.transform(Matrix.Translation(-hinge)); canopy.location = hinge

# group everything under one root for easy placement
root = bpy.data.objects.new('J-16', None)
sc.collection.objects.link(root)
for o in meshes:
    o.parent = root
root['model'] = 'Shenyang J-16 (Su-30MKK family two-seat multirole fighter)'
root['license'] = 'GPL-2.0 (derived from FGUK/FGMEMBERS SU-27)'

# presentation lighting for whoever opens the .blend
w = bpy.data.worlds.new('Studio'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.68, 0.76, 1)
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 3.5; sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
sc.collection.objects.link(cam); sc.camera = cam
cam.location = (16, -22, 9); cam.rotation_euler = (math.radians(70), 0, math.radians(36))
sc.render.engine = 'BLENDER_EEVEE'

tri = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)

# ---------------------------------------------------------- 7. export ----
# game/glTF convention: Y-up, nose toward -Z (same as fa18c.glb)
root.rotation_euler.z = math.pi
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', export_yup=True,
                          export_apply=True, export_extras=True, export_cameras=False,
                          export_lights=False)
report = {
    'asset': GLB.name, 'blend': str(BLEND.relative_to(ROOT)),
    'blend_sha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
    'units': 'metres', 'blender_axes': '+Z up, nose -Y, +X port', 'glb_axes': '+Y up, nose -Z',
    'length': round(hi.y - lo.y, 3), 'span_incl_wingtip_pods': round(hi.x - lo.x, 3),
    'height': round(hi.z - lo.z, 3), 'scale_from_source': round(s, 5),
    'fin_height_gain_m': FIN_GAIN, 'parked_oleo_compression_m': round(gear_drop * s, 3),
    'triangles': tri, 'stores': stores,
    'license': 'GPL-2.0', 'source': 'https://github.com/FGMEMBERS/SU-27',
    'source_commit': 'a9c4863886a5835dfa4406698dd4557fbf72a3aa',
}
META.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('J16', json.dumps(report, ensure_ascii=False))
