"""Small geometry/material helpers shared by the J-16 and Fujian Blender builds.

Blender convention used by both models: metres, +Z up, nose/bow toward -Y,
+X is the port (left) side.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix


# ----------------------------------------------------------------- scene ----
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.length_unit = 'METERS'
    return sc


def collection(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def mesh_object(name, verts, faces, coll, mat=None, smooth=False, uvs=None, recalc=True):
    """Create a mesh object. Generated (non-imported) meshes get consistent
    outward normals; smooth meshes keep hard edges above 40 degrees."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if recalc and uvs is None:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    if uvs:
        layer = me.uv_layers.new(name='UVMap')
        for poly, uv in zip(me.polygons, uvs):
            for k, li in enumerate(poly.loop_indices):
                layer.data[li].uv = uv[k]
    me.validate()
    for p in me.polygons:
        p.use_smooth = smooth
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if smooth and uvs is None:
        sharpen_by_angle(ob, 40)
    return ob


def sharpen_by_angle(ob, degrees):
    """Mark edges sharper than `degrees` as sharp (split normals, 4.1+ style)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    limit = math.radians(degrees)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) <= limit
        else:
            e.smooth = True
    bm.to_mesh(ob.data)
    bm.free()


def join(objs, name):
    objs = [o for o in objs if o]
    if not objs:
        return None
    ctx = bpy.context
    for o in ctx.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    ctx.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


# ------------------------------------------------------------- materials ----
def material(name, color, rough=0.5, metal=0.0, alpha=1.0, emission=None,
             emission_strength=0.0, spec=0.5):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Specular IOR Level'].default_value = spec
    m.diffuse_color = (*color, alpha)
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = emission_strength
    return m


def image_material(name, image_path, rough=0.55, bump=0.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
    tex.interpolation = 'Cubic'
    nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if bump:
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = bump
        b.inputs['Distance'].default_value = 0.002
        nt.links.new(tex.outputs['Color'], b.inputs['Height'])
        nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    return m


# ------------------------------------------------------------ primitives ----
def lathe(profile, segments=24, axis_origin=(0, 0, 0), cap=True):
    """Revolve [(t, r)] around a +Y axis starting at axis_origin.

    Returns verts, faces.  A radius of 0 collapses to a single pole vertex.
    """
    ox, oy, oz = axis_origin
    verts, faces, rings = [], [], []
    for t, r in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((ox, oy + t, oz))
            continue
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            ring.append(len(verts))
            verts.append((ox + r * math.cos(a), oy + t, oz + r * math.sin(a)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            faces += [(a[0], b[(k + 1) % segments], b[k]) for k in range(segments)]
        elif len(b) == 1:
            faces += [(a[k], a[(k + 1) % segments], b[0]) for k in range(segments)]
        else:
            faces += [(a[k], a[(k + 1) % segments], b[(k + 1) % segments], b[k]) for k in range(segments)]
    if cap:
        if len(rings[0]) > 1:
            faces.append(tuple(reversed(rings[0])))
        if len(rings[-1]) > 1:
            faces.append(tuple(rings[-1]))
    return verts, faces


def prism(outline, z0, z1, plane='XY'):
    """Extrude a 2D polygon [(u, v)] between z0 and z1.

    plane 'XY': u->X, v->Y, extrude Z. 'YZ': u->Y, v->Z, extrude X.
    'XZ': u->X, v->Z, extrude Y.
    """
    n = len(outline)
    def P(u, v, w):
        if plane == 'XY':
            return (u, v, w)
        if plane == 'YZ':
            return (w, u, v)
        return (u, w, v)
    verts = [P(u, v, z0) for u, v in outline] + [P(u, v, z1) for u, v in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    return verts, faces


def box(cx, cy, cz, sx, sy, sz):
    x0, x1, y0, y1, z0, z1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def sweep(points, radius, sides=6, closed=False):
    """Tube of `radius` following a polyline (parallel-transport frames)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    verts, faces = [], []
    tangents = []
    for i in range(n):
        a = pts[max(i - 1, 0)] if not closed else pts[i - 1]
        b = pts[min(i + 1, n - 1)] if not closed else pts[(i + 1) % n]
        tangents.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(ref).normalized()
    for i, (p, t) in enumerate(zip(pts, tangents)):
        normal = (normal - t * normal.dot(t)).normalized()
        binormal = t.cross(normal)
        for k in range(sides):
            a = 2 * math.pi * k / sides
            verts.append(tuple(p + (normal * math.cos(a) + binormal * math.sin(a)) * radius))
    rings = n if closed else n - 1
    for i in range(rings):
        j = (i + 1) % n
        for k in range(sides):
            faces.append((i * sides + k, i * sides + (k + 1) % sides,
                          j * sides + (k + 1) % sides, j * sides + k))
    if not closed:
        faces.append(tuple(reversed(range(sides))))
        faces.append(tuple(range((n - 1) * sides, n * sides)))
    return verts, faces


def merge(*parts):
    """Concatenate several (verts, faces) tuples."""
    verts, faces = [], []
    for v, f in parts:
        off = len(verts)
        verts += list(v)
        faces += [tuple(i + off for i in face) for face in f]
    return verts, faces


def transform(part, mat):
    v, f = part
    return [tuple(mat @ Vector(p)) for p in v], f


def rotate_about(part, degrees, axis, center):
    c = Vector(center)
    return transform(part, Matrix.Translation(c) @ Matrix.Rotation(math.radians(degrees), 4, axis)
                     @ Matrix.Translation(-c))


def translate(part, d):
    return transform(part, Matrix.Translation(Vector(d)))


def mirror_x(part):
    v, f = part
    return [(-x, y, z) for x, y, z in v], [tuple(reversed(face)) for face in f]


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def interp(table, x):
    """Piecewise-linear lookup in [(x, y...)] sorted by x."""
    if x <= table[0][0]:
        return table[0][1:] if len(table[0]) > 2 else table[0][1]
    for a, b in zip(table, table[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            vals = [av + (bv - av) * t for av, bv in zip(a[1:], b[1:])]
            return vals if len(vals) > 1 else vals[0]
    return table[-1][1:] if len(table[-1]) > 2 else table[-1][1]


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def cylinder_z(cx, cy, z0, z1, r0, r1=None, seg=24):
    """Vertical (optionally tapered) cylinder with caps."""
    r1 = r0 if r1 is None else r1
    v = [(cx + r0 * math.cos(2 * math.pi * k / seg), cy + r0 * math.sin(2 * math.pi * k / seg), z0) for k in range(seg)]
    v += [(cx + r1 * math.cos(2 * math.pi * k / seg), cy + r1 * math.sin(2 * math.pi * k / seg), z1) for k in range(seg)]
    f = [tuple(reversed(range(seg))), tuple(range(seg, 2 * seg))]
    f += [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
    return v, f


def sphere(c, r, seg=24, rings=12, zmin=-1.0):
    """UV sphere (optionally clipped below zmin*r, e.g. zmin=0 for a dome)."""
    cx, cy, cz = c
    verts, faces, ring_idx = [], [], []
    lat0 = math.asin(max(-1.0, min(1.0, zmin)))
    for i in range(rings + 1):
        lat = lat0 + (math.pi / 2 - lat0) * i / rings
        if i == rings:
            ring_idx.append([len(verts)]); verts.append((cx, cy, cz + r)); continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(len(verts))
            verts.append((cx + r * math.cos(lat) * math.cos(a), cy + r * math.cos(lat) * math.sin(a), cz + r * math.sin(lat)))
        ring_idx.append(ring)
    for a, b in zip(ring_idx, ring_idx[1:]):
        if len(b) == 1:
            faces += [(a[k], a[(k + 1) % seg], b[0]) for k in range(seg)]
        else:
            faces += [(a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]) for k in range(seg)]
    if zmin > -1.0:
        faces.append(tuple(reversed(ring_idx[0])))
    else:
        # close the south pole
        verts.append((cx, cy, cz - r)); s = len(verts) - 1
        faces += [(ring_idx[0][(k + 1) % seg], ring_idx[0][k], s) for k in range(seg)]
    return verts, faces


def chamfer_rect(x0, x1, y0, y1, c):
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c), (x0, y0 + c)]


def loft_outlines(rings, cap_bottom=True, cap_top=True):
    """Connect same-length 3D outlines bottom->top; optional end caps."""
    n = len(rings[0])
    verts = [p for ring in rings for p in ring]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_bottom:
        faces.append(tuple(reversed(range(n))))
    if cap_top:
        faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    return verts, faces


def polygon_area(poly):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))


def inset_polygon(poly, d):
    """Offset a simple 2D polygon inward by d (miter joins)."""
    sign = 1 if polygon_area(poly) > 0 else -1
    n = len(poly)
    lines = []
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        L = math.hypot(bx - ax, by - ay)
        nx, ny = -(by - ay) / L * sign, (bx - ax) / L * sign      # inward normal
        lines.append(((ax + nx * d, ay + ny * d), (bx - ax, by - ay)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        if abs(den) < 1e-9:
            out.append(q); continue
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


def oriented_box(center, forward, up, size):
    """Box with local axes: x = right, y = forward, z = up. size=(sx, sy, sz)."""
    f = Vector(forward).normalized(); u = Vector(up).normalized()
    r = f.cross(u).normalized(); u = r.cross(f).normalized()
    c = Vector(center); sx, sy, sz = (s / 2 for s in size)
    v = []
    for dz in (-sz, sz):
        for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            v.append(tuple(c + r * dx + f * dy + u * dz))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, faces
