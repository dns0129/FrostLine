"""Warship building blocks shared by the Enterprise, Arleigh Burke and 052D builds.

Same conventions as blender_kit / the Fujian build: metres, +Z up with the
waterline at Z = 0, bow toward -Y, +X = port.  Everything is procedural; each
weapon or sensor is a game-scale outline of the publicly photographed shape,
not an engineering drawing.
"""
import math, json, hashlib
import bpy, bmesh
from mathutils import Vector, Matrix
import blender_kit as K


def srgb(*c):
    return tuple(((v / 255 + 0.055) / 1.055) ** 2.4 for v in c)


def obj(name, part, coll, mat, smooth=False, silhouette=False):
    """Mesh object; `silhouette` marks parts kept in the game's distant LOD."""
    ob = K.mesh_object(name, *part, coll, mat, smooth=smooth)
    if silhouette:
        ob['silhouette'] = True
    return ob


# ------------------------------------------------------------------ hull ----
def hull_loft(name, coll, mats, *, uw_levels, top_fracs, stem_uw, stern_uw, stem_top, stern_top,
              half_breadth, sheer, transom_from=None, samples=88, smooth_angle=50):
    """Loft a monohull from horizontal rows.

    uw_levels: absolute Z rows from the keel up to the boot-top (must include
    -0.4 and 0.9).  top_fracs: rows between Z = 0.9 and the sheer line,
    as fractions (last = 1.0, the deck edge).  stem_*/stern_* map a row's Z
    (absolute rows) or fraction (topside rows) to its fore/aft extent in Y.
    half_breadth(y, z) is the hull half-breadth; sheer(y) the deck-edge Z.
    transom_from: absolute Z from which the stern is a flat transom.
    mats = (antifouling, boot-top, topside).  Returns (object, rows) where
    rows[i] = (port points, starboard points) bow-last.
    """
    rows = []
    specs = [('abs', z) for z in uw_levels] + [('frac', f) for f in top_fracs]
    for kind, v in specs:
        y_fwd = K.interp(stem_uw if kind == 'abs' else stem_top, v)
        y_aft = K.interp(stern_uw if kind == 'abs' else stern_top, v)
        port, stbd = [], []
        for k in range(samples):
            u = k / (samples - 1)
            g = u - math.sin(2 * math.pi * u) / (2 * math.pi) * 0.6
            y = y_aft + (y_fwd - y_aft) * g
            z = v if kind == 'abs' else 0.9 + v * (sheer(y) - 0.9)
            hb = 0.0 if k == samples - 1 else max(0.0, half_breadth(y, z))
            port.append((hb, y, z)); stbd.append((-hb, y, z))
        rows.append((port, stbd))
    verts, faces, zones = [], [], []
    def vid(p):
        verts.append(p); return len(verts) - 1
    idx = [([vid(p) for p in port], [vid(p) for p in stbd]) for port, stbd in rows]
    def zone(zc):
        return 0 if zc < -0.4 else 1 if zc < 0.9 else 2
    for i in range(len(rows) - 1):
        (p0, s0), (p1, s1) = idx[i], idx[i + 1]
        for k in range(samples - 1):
            zc = (rows[i][0][k][2] + rows[i + 1][0][k + 1][2]) / 2
            faces.append((p0[k], p0[k + 1], p1[k + 1], p1[k])); zones.append(zone(zc))
            faces.append((s0[k + 1], s0[k], s1[k], s1[k + 1])); zones.append(zone(zc))
    p0, s0 = idx[0]
    faces.append(tuple(p0) + tuple(reversed(s0[1:-1]))); zones.append(0)       # flat keel
    first = 0 if transom_from is None else next(i for i, (kind, v) in enumerate(specs) if kind == 'frac' or v >= transom_from)
    for i in range(first, len(rows) - 1):                                         # transom strips
        zc = (rows[i][0][0][2] + rows[i + 1][0][0][2]) / 2
        faces.append((idx[i][1][0], idx[i][0][0], idx[i + 1][0][0], idx[i + 1][1][0])); zones.append(zone(zc))
    if first > 0:
        faces.append((idx[first - 1][0][0], idx[first][1][0], idx[first][0][0])); zones.append(0)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    for f, m in zip(bm.faces, zones):
        f.material_index = m
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
    K.sharpen_by_angle(ob, smooth_angle)
    ob['silhouette'] = True
    return ob, rows


def deck_from_rows(name, rows, coll, mat, lift=0.0, silhouette=True):
    """Weather deck surface spanning the top row (follows the sheer)."""
    port, stbd = rows[-1]
    n = len(port)
    verts = [(x, y, z + lift) for x, y, z in port] + [(x, y, z + lift) for x, y, z in stbd]
    faces = [(k, k + 1, n + k + 1, n + k) for k in range(n - 1)]
    ob = K.mesh_object(name, verts, faces, coll, mat)
    for p in ob.data.polygons:                        # make every face point up
        if p.normal.z < 0:
            p.flip()
    if silhouette:
        ob['silhouette'] = True
    return ob


def deck_edge_rail(rows, y0, y1, height=1.0, step=2.0, radius=0.035, side=0):
    """Guard rail on the deck edge between Y = y0 and y1 (side 0 = both)."""
    parts = []
    for s, pts in ((1, rows[-1][0]), (-1, rows[-1][1])):
        if side and s != side:
            continue
        sel = [Vector(p) for p in pts if y0 <= p[1] <= y1]
        sel.sort(key=lambda p: p.y)
        if len(sel) < 2:
            continue
        inset = Vector((-s * 0.12, 0, 0))
        for h in (height * 0.5, height):
            parts.append(K.sweep([tuple(p + inset + Vector((0, 0, h))) for p in sel], radius, 4))
        acc, last = 0.0, sel[0]
        for p in sel:
            acc += (p - last).length; last = p
            if acc >= step:
                acc = 0.0
                parts.append(K.sweep([tuple(p + inset), tuple(p + inset + Vector((0, 0, height)))], radius, 4))
    return K.merge(*parts) if parts else ([], [])


def edge_x(rows, y, side):
    """Deck-edge half-breadth (top row) at Y."""
    pts = rows[-1][0 if side > 0 else 1]
    table = sorted((p[1], abs(p[0])) for p in pts)
    return K.interp(table, y)


def hull_x_at(rows, y, z, side=1):
    """Hull half-breadth interpolated between rows at (y, z)."""
    best = None
    for (port, stbd) in rows:
        pts = port if side > 0 else stbd
        table = sorted((p[1], abs(p[0]), p[2]) for p in pts)
        ys = [t[0] for t in table]
        if not (ys[0] <= y <= ys[-1]):
            continue
        hb = K.interp([(t[0], t[1]) for t in table], y)
        zz = K.interp([(t[0], t[2]) for t in table], y)
        if best is None or abs(zz - z) < abs(best[1] - z):
            best = (hb, zz)
    return best[0] if best else 0.0


# ----------------------------------------------------------- superstructure --
def house(x0, x1, y0, y1, z0, z1, lean=0.0, chamfer=0.0, lean_fore=None, lean_aft=None):
    """Deckhouse block from z0 to z1 whose walls lean inward by `lean` metres."""
    lf = lean if lean_fore is None else lean_fore
    la = lean if lean_aft is None else lean_aft
    bot = [(x, y, z0) for x, y in K.chamfer_rect(x0, x1, y0, y1, chamfer)]
    c2 = max(0.0, chamfer - lean * 0.4)
    top = [(x, y, z1) for x, y in K.chamfer_rect(x0 + lean, x1 - lean, y0 + lf, y1 - la, c2)]
    return K.loft_outlines([bot, top])


def face_panel(center, normal, up, w, h, depth=0.15):
    """Flat panel (radar array, window band, door) on a wall."""
    n = Vector(normal).normalized(); u = Vector(up)
    u = (u - n * u.dot(n)).normalized()
    return K.oriented_box(tuple(Vector(center) + n * depth / 2), tuple(u), tuple(n), (w, h, depth))


def windows_band(x0, x1, y, z, h, facing=-1, inset=0.05):
    return K.box((x0 + x1) / 2, y + facing * inset, z, x1 - x0, 0.12, h)


# ----------------------------------------------------------------- weapons --
def gun_mk45(x, y, z, stealth=True):
    """US 5-inch Mk 45 Mod 4 style faceted gunhouse with a long barrel."""
    parts = [K.cylinder_z(x, y, z, z + 0.5, 2.0, 2.0, 24)]
    house_ = [(x - 1.6, y - 2.2, z + 0.5), (x + 1.6, y - 2.2, z + 0.5), (x + 1.8, y + 2.6, z + 0.5), (x - 1.8, y + 2.6, z + 0.5)]
    top = [(x - 0.9, y - 1.4, z + 2.4), (x + 0.9, y - 1.4, z + 2.4), (x + 1.2, y + 2.3, z + 2.6), (x - 1.2, y + 2.3, z + 2.6)]
    parts.append(K.loft_outlines([house_, top]))
    barrel = K.lathe([(0, 0.19), (1.2, 0.17), (7.4, 0.1), (7.6, 0.12), (7.7, 0)], 12)
    parts.append(K.transform(barrel, Matrix.Translation((x, y - 1.6, z + 1.35)) @ Matrix.Rotation(math.pi, 4, 'Z')
                             @ Matrix.Rotation(math.radians(6), 4, 'X')))
    return K.merge(*parts)


def gun_hpj45(x, y, z):
    """Chinese 130 mm H/PJ-45 style stealth turret (broad faceted shield)."""
    parts = [K.cylinder_z(x, y, z, z + 0.4, 2.4, 2.4, 24)]
    bot = [(x - 2.2, y - 2.6, z + 0.4), (x + 2.2, y - 2.6, z + 0.4), (x + 2.4, y + 3.2, z + 0.4), (x - 2.4, y + 3.2, z + 0.4)]
    mid = [(x - 2.0, y - 3.0, z + 1.6), (x + 2.0, y - 3.0, z + 1.6), (x + 2.3, y + 3.1, z + 1.8), (x - 2.3, y + 3.1, z + 1.8)]
    top = [(x - 1.1, y - 1.6, z + 2.9), (x + 1.1, y - 1.6, z + 2.9), (x + 1.4, y + 2.6, z + 3.0), (x - 1.4, y + 2.6, z + 3.0)]
    parts.append(K.loft_outlines([bot, mid, top]))
    barrel = K.lathe([(0, 0.24), (1.4, 0.21), (7.8, 0.12), (8.2, 0.15), (8.3, 0)], 12)
    parts.append(K.transform(barrel, Matrix.Translation((x, y - 2.4, z + 1.5)) @ Matrix.Rotation(math.pi, 4, 'Z')
                             @ Matrix.Rotation(math.radians(5), 4, 'X')))
    return K.merge(*parts)


def vls_grid(x0, x1, y0, y1, z, cols, rows_, hatch=0.56):
    """Flush Mk 41 / GJB VLS block: a raised frame plus dark hatch grid."""
    frame = K.box((x0 + x1) / 2, (y0 + y1) / 2, z + 0.1, x1 - x0, y1 - y0, 0.2)
    hatches = []
    dx, dy = (x1 - x0) / cols, (y1 - y0) / rows_
    for c in range(cols):
        for r in range(rows_):
            hatches.append(K.box(x0 + dx * (c + 0.5), y0 + dy * (r + 0.5), z + 0.22, dx * hatch * 1.4, dy * hatch * 1.4, 0.06))
    return frame, K.merge(*hatches)


def phalanx(x, y, z, facing=(0, -1, 0)):
    """Mk 15 Phalanx: drum base, white radome 'R2-D2' head, gun barrel cluster."""
    d = Vector(facing).normalized()
    parts = [K.cylinder_z(x, y, z, z + 1.2, 1.0, 0.9, 16)]
    c = Vector((x, y, z + 1.9))
    parts.append(K.oriented_box(tuple(c), tuple(d), (0, 0, 1), (1.4, 1.6, 1.2)))
    radome = [K.cylinder_z(x, y, z + 2.5, z + 3.6, 0.55, 0.5, 16), K.sphere((x, y, z + 3.6), 0.5, 16, 8, zmin=0.0)]
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    gun = K.transform(K.lathe([(0, 0.16), (2.2, 0.14), (2.2, 0)], 10), Matrix.Translation(c + d * 0.6) @ rot)
    return K.merge(*parts), K.merge(*radome), gun


def ciws_chinese(x, y, z, facing=(0, -1, 0)):
    """H/PJ-12 / H/PJ-11 style CIWS: angular mount with a fire-control box."""
    d = Vector(facing).normalized()
    parts = [K.cylinder_z(x, y, z, z + 0.9, 1.3, 1.2, 18)]
    c = Vector((x, y, z + 1.7))
    parts.append(K.oriented_box(tuple(c), tuple(d), (0, 0, 1), (2.1, 2.4, 1.5)))
    parts.append(K.sphere(tuple(c + Vector((0, 0, 0.7)) - d * 0.4), 1.0, 16, 7, zmin=0.0))
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    barrels = []
    for b in range(7):
        a = 2 * math.pi * b / 7
        off = Matrix.Translation((0.17 * math.cos(a), 0, 0.17 * math.sin(a)))
        barrels.append(K.transform(K.lathe([(0, 0.035), (2.6, 0.035), (2.6, 0)], 6), Matrix.Translation(c + d * 1.1) @ rot @ off))
    return K.merge(*parts), K.merge(*barrels)


def box_launcher(x, y, z, facing, size=(3.0, 2.4, 1.6), elev=12, cells=(4, 2)):
    """Box launcher (Mk 29 Sea Sparrow, Harpoon quad, HHQ-10 style) on a pedestal."""
    d = Vector(facing).normalized()
    up = Vector((0, 0, 1))
    r = d.cross(up).normalized()
    pitch = Matrix.Rotation(math.radians(elev), 4, r)
    fwd = (pitch @ d.to_4d()).to_3d().normalized(); upv = (pitch @ up.to_4d()).to_3d().normalized()
    c = Vector((x, y, z + 0.9 + size[2] / 2))
    body = [K.cylinder_z(x, y, z, z + 0.9, 0.9, 0.8, 14), K.oriented_box(tuple(c), tuple(fwd), tuple(upv), size)]
    caps = []
    front = c + fwd * (size[1] / 2 + 0.02)
    for i in range(cells[0]):
        for j in range(cells[1]):
            p = front + r * ((i - (cells[0] - 1) / 2) * size[0] / cells[0]) + upv * ((j - (cells[1] - 1) / 2) * size[2] / cells[1])
            caps.append(K.oriented_box(tuple(p), tuple(fwd), tuple(upv), (size[0] / cells[0] * 0.8, 0.05, size[2] / cells[1] * 0.75)))
    return K.merge(*body), K.merge(*caps)


def harpoon_quad(x, y, z, facing):
    """Four canted Harpoon canisters on a low frame."""
    d = Vector(facing).normalized(); r = d.cross(Vector((0, 0, 1))).normalized()
    pitch = Matrix.Rotation(math.radians(14), 4, r)
    f = (pitch @ d.to_4d()).to_3d().normalized()
    parts = [K.oriented_box((x, y, z + 0.35), tuple(d), (0, 0, 1), (2.6, 3.4, 0.7))]
    for i in range(4):
        c = Vector((x, y, z + 1.15)) + r * ((i - 1.5) * 0.62)
        rot = Vector((0, 1, 0)).rotation_difference(f).to_matrix().to_4x4()
        parts.append(K.transform(K.lathe([(-2.3, 0.0), (-2.3, 0.3), (2.3, 0.3), (2.3, 0)], 8), Matrix.Translation(c) @ rot))
    return K.merge(*parts)


def ram_launcher(x, y, z, facing):
    """RIM-116 RAM Mk 49: guide box with a round launcher face."""
    d = Vector(facing).normalized()
    parts = [K.cylinder_z(x, y, z, z + 1.0, 0.9, 0.8, 14)]
    c = Vector((x, y, z + 2.0))
    parts.append(K.oriented_box(tuple(c), tuple(d), (0, 0, 1), (1.7, 2.6, 1.7)))
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    face = K.transform(K.lathe([(0, 0.0), (0, 0.8), (0.2, 0.8), (0.2, 0)], 16), Matrix.Translation(c + d * 1.3) @ rot)
    return K.merge(*parts), face


def illuminator(x, y, z, dish=1.1, facing=(0, -1, 0)):
    """SPG-62 style fire-control dish on a pedestal."""
    d = Vector(facing).normalized()
    rot = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    base = [K.cylinder_z(x, y, z, z + 1.1, 0.45, 0.4, 12), K.box(x, y, z + 1.4, 0.9, 0.9, 0.7)]
    d_ = K.transform(K.lathe([(0, 0.15), (0.25, dish), (0.35, dish), (0.2, 0)], 18), Matrix.Translation(Vector((x, y, z + 1.6)) + d * 0.5) @ rot)
    return K.merge(*base), d_


def lattice_mast(base, top, width, legs=3, rungs=6, radius=0.12, rake=0.0):
    """Raked tripod / lattice mast between two Z heights."""
    bx, by, bz = base
    parts = []
    tops = []
    for i in range(legs):
        a = 2 * math.pi * i / legs + math.pi / 2
        p0 = Vector((bx + width * math.cos(a), by + width * math.sin(a), bz))
        p1 = Vector((bx + width * 0.18 * math.cos(a), by + rake + width * 0.18 * math.sin(a), top))
        parts.append(K.sweep([tuple(p0), tuple(p1)], radius, 6)); tops.append((p0, p1))
    for k in range(1, rungs):
        t = k / rungs
        ring = [tuple(p0.lerp(p1, t)) for p0, p1 in tops]
        parts.append(K.sweep(ring + [ring[0]], radius * 0.55, 4))
    return K.merge(*parts)


# ------------------------------------------------------------- underwater --
def propulsion(shafts, coll, mat_prop, mat_gear, blades=5, prop_r=2.4, rudders=(), name_suffix=''):
    """shafts: [(x, y_prop, z_prop, y_inboard, z_inboard)]; rudders: [(x, y0, y1, z_top, z_bot)]."""
    props, gear = [], []
    for x, yp, zp, yi, zi in shafts:
        s = 1 if x >= 0 else -1
        hub = K.lathe([(-0.6, 0), (-0.5, prop_r * 0.18), (0.4, prop_r * 0.22), (0.9, prop_r * 0.12), (1.1, 0)], 14)
        props.append(K.translate(hub, (x, yp, zp)))
        for b in range(blades):
            a = 2 * math.pi * b / blades + 0.3 * s
            k = prop_r / 2.45
            blade = K.prism([(0.45 * k, -0.35 * k), (1.4 * k, -0.55 * k), (2.45 * k, -0.15 * k), (2.35 * k, 0.35 * k), (1.3 * k, 0.5 * k), (0.45 * k, 0.3 * k)], -0.05, 0.05, 'XY')
            m = Matrix.Translation((x, yp, zp)) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Rotation(s * math.radians(25), 4, 'X')
            props.append(K.transform(blade, m))
        gear.append(K.sweep([(x, yp - 0.6, zp), (x, yi, zi)], prop_r * 0.12, 10))
        ys = yp - (yp - yi) * 0.25
        gear.append(K.oriented_box((x, ys, zp + (zi - zp) * 0.25 + 1.4), (0, 1, 0), (0, 0, 1), (0.35, 1.2, 2.8)))
    for x, y0, y1, zt, zb in rudders:
        gear.append(K.translate(K.prism([(y0, zt), (y1, zt), (y1 - 0.4, zb), (y0 + 0.6, zb)], -0.3, 0.3, 'YZ'), (x, 0, 0)))
    obj('Propellers' + name_suffix, K.merge(*props), coll, mat_prop, smooth=True)
    obj('Shafts, struts & rudders' + name_suffix, K.merge(*gear), coll, mat_gear, smooth=True)


# ----------------------------------------------------------- hull numbers --
def text_mesh(text, size, name):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = text; cu.size = size
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    tmp = bpy.data.objects.new('tmp', cu); bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    me.name = name
    return me


def hull_number(number, side, y, z, size, target, coll, mat, offset=0.05, label='', shadow=None, wrap=True):
    """Number painted on a surface.  side +1 port / -1 starboard.  The text is
    upright, reads bow-to-stern on both sides, and is shrink-wrapped onto
    `target` (hull or island) when `wrap`.  Object name 'Hull number <n> (...)'
    lets the game show only the instance's own number."""
    out = []
    for kind, m, depth, shift in (('', mat, offset, 0.0),) + ((('shadow', shadow, offset * 0.6, size * 0.06),) if shadow else ()):
        me = text_mesh(number, size, f'num{number}{kind}')
        place = f'{"port" if side > 0 else "starboard"}{" " + label if label else ""}'
        ob = bpy.data.objects.new(f'Hull number {number} {kind + " " if kind else ""}({place})', me)
        coll.objects.link(ob)
        # text X (reading) -> along -side*Y ... reading direction bow->stern on port means +Y
        rx = Vector((0, side, 0)); ry = Vector((0, 0, 1)); rz = Vector((side, 0, 0))
        rot = Matrix((rx, ry, rz)).transposed().to_4x4()
        x = side * (hull_x_at_target(target, y, z, side) + 0.6)
        ob.matrix_world = Matrix.Translation((x, y + shift * side, z - shift)) @ rot
        me.materials.append(m)
        if wrap:
            mod = ob.modifiers.new('wrap', 'SHRINKWRAP'); mod.target = target
            mod.wrap_method = 'NEAREST_SURFACEPOINT'; mod.offset = depth
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
        out.append(ob)
    return out


def hull_x_at_target(target, y, z, side):
    """Half-breadth of `target` near (y, z) on one side (vertex search)."""
    best, d = 0.0, 1e9
    for v in target.data.vertices:
        co = target.matrix_world @ v.co
        if co.x * side <= 0:
            continue
        dist = abs(co.y - y) + abs(co.z - z) * 2
        if dist < d:
            d, best = dist, abs(co.x)
    return best


# --------------------------------------------------------------- finishing --
def finish(sc, root_name, props, blend, glb, meta_path, root_dir, report, cam=(80, -120, 60)):
    """Parent everything to one root, save the .blend, export a Y-up GLB with
    the bow toward -Z, and write the metadata JSON."""
    root = bpy.data.objects.new(root_name, None); sc.collection.objects.link(root)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    for o in meshes:
        o.parent = root
    for k, v in props.items():
        root[k] = v
    lo, hi = K.bounds(meshes)
    w = bpy.data.worlds.new('Sea sky'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.64, 0.75, 1)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4.0; sun.rotation_euler = (math.radians(42), 0, math.radians(-40)); sc.collection.objects.link(sun)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera')); sc.collection.objects.link(camera); sc.camera = camera
    camera.data.lens = 35; camera.data.clip_end = 3000
    camera.location = cam; camera.rotation_euler = (Vector((0, 0, 10)) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()
    tri = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True, relative_remap=True)
    root.rotation_euler.z = math.pi           # glTF: +Y up, bow toward -Z
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', export_yup=True, export_apply=True,
                              export_extras=True, export_cameras=False, export_lights=False,
                              export_image_format='JPEG', export_jpeg_quality=88)
    full = {'asset': glb.name, 'blend': str(blend.relative_to(root_dir)),
            'blend_sha256': hashlib.sha256(blend.read_bytes()).hexdigest(),
            'units': 'metres', 'blender_axes': '+Z up (waterline 0), bow -Y, +X port', 'glb_axes': '+Y up, bow -Z',
            'length_overall': round(hi.y - lo.y, 2), 'beam_overall': round(hi.x - lo.x, 2),
            'draft': round(-lo.z, 2), 'mast_top_above_waterline': round(hi.z, 2), 'triangles': tri}
    full.update(report)
    meta_path.write_text(json.dumps(full, ensure_ascii=False, indent=2) + '\n')
    print(root_name.upper().replace(' ', '_'), json.dumps(full, ensure_ascii=False))
    return full
