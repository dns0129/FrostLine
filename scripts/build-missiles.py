"""Build the real-scale missile models (PL-15, PL-10, HQ-10, YJ-83).

Run from the project root:
    '/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background \
        --factory-startup --python scripts/build-missiles.py

Writes assets/models/missiles-source/Missiles.blend (all four on display
stands, side by side at true relative size), one GLB per missile in
assets/models/missiles/ (+Y up, nose toward -Z, origin at mid-length on the
body axis) and assets/models/missiles/missiles.metadata.json.
"""
import sys, math, json, hashlib
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import blender_kit as K
import missile_kit as MK

BLEND = ROOT / 'assets/models/missiles-source/Missiles.blend'
OUT = ROOT / 'assets/models/missiles'
ORDER = ['YJ-83', 'PL-15', 'PL-10', 'HQ-10']
FILES = {'YJ-83': 'yj83.glb', 'PL-15': 'pl15.glb', 'PL-10': 'pl10.glb', 'HQ-10': 'hq10.glb'}
AXIS_Z = 1.0          # display height of the missile axes

sc = K.reset_scene()
C_STANDS = K.collection('Display stands')
M_STAND = K.material('Stand dark grey', MK.srgb(52, 55, 58), rough=0.6)
roots, report = {}, {}
x = 0.0
for kind in ORDER:
    spec = MK.SPECS[kind]
    coll = K.collection(kind)
    root = bpy.data.objects.new(kind, None)
    coll.objects.link(root)
    objs = MK.build(kind, coll)
    for o in objs:
        o.parent = root
    roots[kind] = root
    # measure from the generated geometry
    pts = [v.co for o in objs for v in o.data.vertices]
    fin_r = max(math.hypot(v.co.x, v.co.z) for o in objs if 'fin' in o.name or 'wing' in o.name for v in o.data.vertices)
    body = next(o for o in objs if o.name.endswith(' body'))
    body_r = max(math.hypot(v.co.x, v.co.z) for v in body.data.vertices)
    report[kind] = {
        'file': FILES[kind], 'title': spec['title'], 'role': spec['role'],
        'length_m': round(max(p.y for p in pts) - min(p.y for p in pts), 3),
        'body_diameter_m': round(2 * body_r, 3),
        'fin_tip_diameter_m': round(2 * fin_r, 3),
        'mass_kg': spec['mass_kg'],
        'published': spec['published'], 'estimated': spec['estimated'],
        'triangles': sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons),
    }
    # line up left to right, spaced by fin-tip size
    half = max(fin_r, spec['diameter'] / 2) + 0.35
    x -= half
    root.location = (x, 0, AXIS_Z)
    L = spec['length']
    for t in (-0.3 * L, 0.3 * L):           # two cradle stands
        stand = K.merge(K.box(x, t, (AXIS_Z - spec['diameter'] / 2) / 2, 0.08, 0.08, AXIS_Z - spec['diameter'] / 2),
                        K.box(x, t, 0.02, 0.5, 0.35, 0.04),
                        K.box(x, t, AXIS_Z - spec['diameter'] / 2 - 0.02, spec['diameter'] * 0.9, 0.12, 0.04))
        K.mesh_object(f'{kind} stand', *stand, C_STANDS, M_STAND)
    x -= half

# presentation scene
w = bpy.data.worlds.new('Studio'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.68, 0.76, 1)
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(45), 0, math.radians(30)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 40; cam.location = (4.5, -9.5, 4.0)
cam.rotation_euler = (Vector((x / 2, 0, AXIS_Z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'BLENDER_EEVEE'
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)

# one GLB per missile: origin at mid-length, +Y up, nose toward -Z
OUT.mkdir(parents=True, exist_ok=True)
for kind, root in roots.items():
    loc = root.location.copy()
    root.location = (0, 0, 0); root.rotation_euler = (0, 0, math.pi)
    for o in sc.objects:
        o.select_set(False)
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / FILES[kind]), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_cameras=False, export_lights=False)
    root.location = loc; root.rotation_euler = (0, 0, 0)
    report[kind]['glb_bytes'] = (OUT / FILES[kind]).stat().st_size

meta = {'blend': str(BLEND.relative_to(ROOT)), 'blend_sha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
        'units': 'metres', 'glb_axes': '+Y up, nose -Z, origin at mid-length on the body axis',
        'note': 'Length, body diameter, YJ-83 wingspan and masses are published figures; fin chords, '
                'spans and stations are estimates from photographs.',
        'missiles': report}
(OUT / 'missiles.metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
print('MISSILES', json.dumps({k: (v['length_m'], v['body_diameter_m'], v['fin_tip_diameter_m'], v['triangles'])
                              for k, v in report.items()}, ensure_ascii=False))
