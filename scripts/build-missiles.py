"""Build the real-scale missile models used by FrostLine.

Chinese group: YJ-83, YJ-83K, PL-15, PL-10, HQ-10.  US group: RGM-84,
SM-2MR, AGM-84D, AIM-7M, AIM-120C, AIM-9M.

Run from the project root:
    '/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background \
        --factory-startup --python scripts/build-missiles.py

Writes assets/models/missiles-source/Missiles.blend (all of them on display
stands, side by side at true relative size), one detailed GLB per missile in
assets/models/missiles/ (+Y up, nose toward -Z, origin at mid-length on the
body axis) with missiles.metadata.json, and the runtime missiles-game.glb:
low-poly PL-15 / PL-10 / YJ-83K store templates (one mesh per material,
transforms baked, root nodes named pl15 / pl10 / yj83k) used by missile-models.js.
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
GROUPS = {'Chinese missiles': ['YJ-83', 'YJ-83K', 'PL-15', 'PL-10', 'HQ-10'],
          'US missiles': ['RGM-84', 'SM-2MR', 'AGM-84D', 'AIM-7M', 'AIM-120C', 'AIM-9M']}
ORDER = [k for kinds in GROUPS.values() for k in kinds]
FILES = {'YJ-83': 'yj83.glb', 'YJ-83K': 'yj83k.glb', 'PL-15': 'pl15.glb', 'PL-10': 'pl10.glb', 'HQ-10': 'hq10.glb',
         'RGM-84': 'rgm84.glb', 'SM-2MR': 'sm2mr.glb', 'AGM-84D': 'agm84d.glb', 'AIM-7M': 'aim7m.glb',
         'AIM-120C': 'aim120c.glb', 'AIM-9M': 'aim9m.glb'}
# runtime template id -> missile.  Store ids match STORES; the others are the
# launch visuals chosen by renderer.js for ships and enemy aircraft.
GAME = {'pl15': 'PL-15', 'pl10': 'PL-10', 'yj83k': 'YJ-83K', 'aim9': 'AIM-9M', 'aim120': 'AIM-120C',
        'aim7': 'AIM-7M', 'harpoon': 'AGM-84D', 'sm2': 'SM-2MR', 'rgm84': 'RGM-84', 'hq10': 'HQ-10', 'yj83': 'YJ-83'}
ROLE = {'Missile body light grey': 'body', 'Missile body white': 'body', 'Missile radome off-white': 'seeker',
        'Missile radome grey': 'seeker', 'IR seeker dome': 'seeker', 'Missile nozzle': 'dark',
        'Missile intake shadow': 'dark', 'Missile section band': 'dark', 'Missile steel fittings': 'fittings',
        'Missile booster grey': 'booster', 'Missile warhead band yellow': 'fittings'}
AXIS_Z = 1.0          # display height of the missile axes

sc = K.reset_scene()
C_STANDS = K.collection('Display stands')
M_STAND = K.material('Stand dark grey', MK.srgb(52, 55, 58), rough=0.6)
roots, report = {}, {}
group_of = {k: g for g, kinds in GROUPS.items() for k in kinds}
group_roots, cursor = {}, {}
for gi, g in enumerate(GROUPS):
    group_roots[g] = bpy.data.objects.new(g, None); sc.collection.objects.link(group_roots[g])
    cursor[g] = 0.0
for kind in ORDER:
    spec = MK.SPECS[kind]
    g = group_of[kind]; x = cursor[g]; row_y = 9.0 * list(GROUPS).index(g)
    coll = K.collection(kind)
    root = bpy.data.objects.new(kind, None)
    coll.objects.link(root)
    objs = MK.build(kind, coll)
    for o in objs:
        o.parent = root
    roots[kind] = root
    root.parent = group_roots[g]
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
    root.location = (x, row_y, AXIS_Z)
    L = spec['length']
    for t in (-0.3 * L, 0.3 * L):           # two cradle stands
        t += row_y
        stand = K.merge(K.box(x, t, (AXIS_Z - spec['diameter'] / 2) / 2, 0.08, 0.08, AXIS_Z - spec['diameter'] / 2),
                        K.box(x, t, 0.02, 0.5, 0.35, 0.04),
                        K.box(x, t, AXIS_Z - spec['diameter'] / 2 - 0.02, spec['diameter'] * 0.9, 0.12, 0.04))
        K.mesh_object(f'{kind} stand', *stand, C_STANDS, M_STAND).parent = group_roots[g]
    x -= half
    cursor[g] = x

# presentation scene
w = bpy.data.worlds.new('Studio'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.68, 0.76, 1)
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4.0; sun.rotation_euler = (math.radians(45), 0, math.radians(30)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 40; cam.location = (4.5, -9.5, 4.0)
cam.rotation_euler = (Vector((min(cursor.values()) / 2, 4.5, AXIS_Z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.engine = 'BLENDER_EEVEE'
BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True, relative_remap=True)

# one GLB per missile: origin at mid-length, +Y up, nose toward -Z
OUT.mkdir(parents=True, exist_ok=True)
for kind, root in roots.items():
    loc, parent = root.location.copy(), root.parent
    root.parent = None; root.location = (0, 0, 0); root.rotation_euler = (0, 0, math.pi)
    for o in sc.objects:
        o.select_set(False)
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / FILES[kind]), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_cameras=False, export_lights=False)
    root.location = loc; root.rotation_euler = (0, 0, 0); root.parent = parent
    report[kind]['glb_bytes'] = (OUT / FILES[kind]).stat().st_size

meta = {'blend': str(BLEND.relative_to(ROOT)), 'blend_sha256': hashlib.sha256(BLEND.read_bytes()).hexdigest(),
        'units': 'metres', 'glb_axes': '+Y up, nose -Z, origin at mid-length on the body axis',
        'note': 'Length, body diameter, YJ-83 wingspan and masses are published figures; fin chords, '
                'spans and stations are estimates from photographs.',
        'missiles': report}
(OUT / 'missiles.metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
print('MISSILES', json.dumps({k: (v['length_m'], v['body_diameter_m'], v['fin_tip_diameter_m'], v['triangles'])
                              for k, v in report.items()}, ensure_ascii=False))

# ---------------------------------------------------------- runtime GLB ----
# Built after the .blend was saved, so the showcase file stays unchanged.
# Each store: one mesh per role, vertices baked into glTF space (nose -Z).
for o in sc.objects:
    o.select_set(False)
C_GAME = K.collection('Game store templates')
spin = Matrix.Rotation(math.pi, 4, 'Z')          # Blender nose -Y -> glTF nose -Z
game = {}
for gid, kind in GAME.items():
    root = bpy.data.objects.new(gid, None); C_GAME.objects.link(root)
    parts = MK.build(kind, C_GAME, spin, prefix=f'{gid} game', detail='game')
    by_role = {}
    for o in parts:
        by_role.setdefault(ROLE[o.data.materials[0].name], []).append(o)
    tris = 0
    for role, objs in sorted(by_role.items()):
        ob = K.join(objs, f'{gid}_{role}') if len(objs) > 1 else objs[0]
        ob.name = ob.data.name = f'{gid}_{role}'
        # one material per role mesh; shared roles use one canonical material
        canonical = {'dark': 'Missile nozzle', 'fittings': 'Missile steel fittings'}.get(role)
        keep = bpy.data.materials[canonical] if canonical else ob.data.materials[0]
        ob.data.materials.clear(); ob.data.materials.append(keep)
        for p in ob.data.polygons:
            p.material_index = 0
        ob.parent = root
        tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    pts = [v.co for o in root.children for v in o.data.vertices]
    spec = MK.SPECS[kind]
    game[gid] = {'missile': kind, 'length_m': round(max(p.y for p in pts) - min(p.y for p in pts), 3),
                 'diameter_m': spec['diameter'], 'meshes': sorted(o.name for o in root.children), 'triangles': tris}
for o in C_GAME.all_objects:
    o.select_set(True)
GAME_GLB = OUT / 'missiles-game.glb'
bpy.ops.export_scene.gltf(filepath=str(GAME_GLB), export_format='GLB', use_selection=True, export_yup=True,
                          export_apply=True, export_extras=False, export_cameras=False, export_lights=False)
game_meta = {'asset': GAME_GLB.name, 'units': 'metres', 'glb_axes': '+Y up, nose -Z, origin at mid-length on the body axis',
             'note': 'Low-poly runtime templates generated by scripts/missile_kit.py (detail="game"); '
                     'lengths and diameters match the detailed models.', 'stores': game}
(OUT / 'missiles-game.metadata.json').write_text(json.dumps(game_meta, ensure_ascii=False, indent=2) + '\n')
print('GAME', json.dumps({k: (v['length_m'], v['triangles'], len(v['meshes'])) for k, v in game.items()}))
