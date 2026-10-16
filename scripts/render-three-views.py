"""Render orthographic three views (with outlines) and hero shots of a model.

    Blender -b <model.blend> --python scripts/render-three-views.py -- <out_dir> <name> <px_per_m> [views|hero|all] [root]

Views share one pixel scale so scripts/compose-three-view.py can assemble a
dimensioned drawing sheet; their framing is written to <out_dir>/<name>_views.json.
With [root], only that object and its children are rendered.
Without a GPU (no EEVEE), set VIEW_ENGINE=CYCLES; VIEW_SAMPLES / HERO_SAMPLES
override the Cycles sample counts.  With the bpy module, open the .blend first
and pass the same arguments after '--' in sys.argv.
Blender axes: +Z up, nose/bow toward -Y, +X = port.
"""
import bpy, sys, json, math, os
from mathutils import Vector

a = sys.argv[sys.argv.index('--') + 1:]
out_dir, name, ppm = a[0], a[1], float(a[2])
mode = a[3] if len(a) > 3 else 'all'
only = a[4] if len(a) > 4 else None
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type in ('LIGHT', 'CAMERA'):
        bpy.data.objects.remove(o)
if only:
    keep = {bpy.data.objects[only], *bpy.data.objects[only].children_recursive}
    for o in sc.objects:
        if o.type == 'MESH' and o not in keep:
            o.hide_render = True
meshes = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
ctr, size = (lo + hi) / 2, hi - lo
sc.render.engine = os.environ.get('VIEW_ENGINE', 'BLENDER_EEVEE')
if sc.render.engine == 'CYCLES':
    sc.cycles.device = 'CPU'; sc.cycles.samples = int(os.environ.get('VIEW_SAMPLES', 24)); sc.cycles.use_denoising = True
else:
    sc.eevee.taa_render_samples = 64
sc.render.resolution_percentage = 100
world = sc.world or bpy.data.worlds.new('World'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.clip_start = 0.05; cam.data.clip_end = size.length * 20

def sun(rot, energy, angle=8, color=(1, 1, 1)):
    l = bpy.data.lights.new('sun', 'SUN'); l.energy = energy; l.angle = math.radians(angle); l.color = color
    o = bpy.data.objects.new('sun', l); o.rotation_euler = [math.radians(v) for v in rot]
    sc.collection.objects.link(o); return o

def look(direction, dist):
    d = Vector(direction).normalized()
    cam.location = ctr - d * dist
    if abs(d.z) > 0.99:
        cam.rotation_euler = (0, 0, math.radians(90))          # top: nose left, starboard up
    else:
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

views = {}
if mode in ('views', 'all'):
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 0.75
    lights = [sun((38, 0, -28), 2.2, 25), sun((70, 0, 160), 0.6, 30)]
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = 1.0
    fs = sc.view_layers[0].freestyle_settings
    fs.crease_angle = math.radians(135)
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('outline')
    ls.select_by_visibility = True; ls.visibility = 'VISIBLE'
    ls.select_silhouette = ls.select_border = ls.select_crease = True
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new('outline')
    ls.linestyle.color = (0.10, 0.11, 0.12); ls.linestyle.thickness = 1.25
    margin = max(size) * 0.03
    # view -> (camera direction, world axis for image-x, sign, world axis for image-y, sign)
    spec = {'side': ((-1, 0, 0), 1, 1, 2, 1), 'top': ((0, 0, -1), 1, 1, 0, -1), 'front': ((0, 1, 0), 0, 1, 2, 1)}
    for view, (direction, ax_x, sx, ax_y, sy) in spec.items():
        w_m, h_m = size[ax_x] + 2 * margin, size[ax_y] + 2 * margin
        rx, ry = int(math.ceil(w_m * ppm)), int(math.ceil(h_m * ppm))
        sc.render.resolution_x, sc.render.resolution_y = rx, ry
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(rx, ry) / ppm
        look(direction, size.length * 3)
        path = f'{out_dir}/{name}_{view}.png'
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        views[view] = {'file': path.split('/')[-1], 'size': [rx, ry], 'px_per_m': ppm,
                       'center': list(ctr), 'image_x': [ax_x, sx], 'image_y_up': [ax_y, sy]}
    for o in lights:
        bpy.data.objects.remove(o)
    sc.render.use_freestyle = False
    with open(f'{out_dir}/{name}_views.json', 'w') as fh:
        json.dump({'bounds': [list(lo), list(hi)], 'views': views}, fh, indent=1)

if mode in ('hero', 'all'):
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Punchy'
    except TypeError:
        sc.view_settings.look = 'None'
    # EEVEE drops sun shadows in background renders on this Mac, so hero
    # shots use Cycles on the CPU.
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.cycles.samples = int(os.environ.get('HERO_SAMPLES', 96)); sc.cycles.use_denoising = True
    bg.inputs[0].default_value = (0.40, 0.55, 0.80, 1); bg.inputs[1].default_value = 0.55
    key = sun((50, 0, 40), 4.6, 1.5, (1.0, 0.95, 0.88))
    sc.render.resolution_x, sc.render.resolution_y = 2400, 1350
    cam.data.type = 'PERSP'
    big = size.y > 100
    ground = bpy.data.meshes.new('_ground')
    R = size.length * 30
    ground.from_pydata([(-R, -R, 0), (R, -R, 0), (R, R, 0), (-R, R, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('_ground', ground); sc.collection.objects.link(g)
    m = bpy.data.materials.new('_ground'); m.use_nodes = True; nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 0.08 if big else 2.0
    noise.inputs['Detail'].default_value = 8
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25 if big else 0.08
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    if big:   # sea
        p.inputs['Base Color'].default_value = (0.012, 0.035, 0.06, 1)
        p.inputs['Roughness'].default_value = 0.14
        p.inputs['Specular IOR Level'].default_value = 0.6
    else:     # concrete apron
        p.inputs['Base Color'].default_value = (0.32, 0.32, 0.31, 1)
        p.inputs['Roughness'].default_value = 0.85
    ground.materials.append(m)
    shots = ({'hero_a': (32, 14, 0.9, 35), 'hero_b': (-132, 20, 0.9, 35)} if big else
             {'hero_a': (38, 12, 0.9, 45), 'hero_b': (-140, 24, 0.95, 45)})
    for shot, (az, el, dist_mul, lens) in shots.items():
        cam.data.lens = lens
        d = Vector((math.cos(math.radians(el)) * math.sin(math.radians(az)),
                    -math.cos(math.radians(el)) * math.cos(math.radians(az)), math.sin(math.radians(el))))
        target = ctr.copy()
        if big:
            target.z = 10.0
        fov = 2 * math.atan(18 / lens)
        dist = (size.y if big else max(size.x, size.y)) * 0.62 / math.tan(fov / 2) * dist_mul
        cam.location = target + d * dist
        # key light from the camera side, 45 deg round and 40 deg up
        sa, se = math.radians(az - 45), math.radians(40)
        to_sun = Vector((math.cos(se) * math.sin(sa), -math.cos(se) * math.cos(sa), math.sin(se)))
        key.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = f'{out_dir}/{name}_{shot}.png'
        bpy.ops.render.render(write_still=True)
print('RENDERED', name, list(views))
