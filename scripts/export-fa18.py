"""Export the approved editable F/A-18C as an offline game asset.

All positions/UVs/normals are derived from the Blender file. Merge only
material-equivalent parts, keeping landing gear independently switchable.
"""
import bpy,bmesh,json,math,hashlib,sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets/models/f18-source/F-A-18C-rebuilt-v2.blend'
OUTPUT=ROOT/'assets/models/fa18c.glb'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene=bpy.context.scene
objects=[o for o in scene.objects if o.type=='MESH' and not o.hide_render]
def points(o):return [o.matrix_world@v.co for v in o.data.vertices]
allpoints=[p for o in objects for p in points(o)]
lo=Vector(tuple(min(p[i] for p in allpoints) for i in range(3)))
hi=Vector(tuple(max(p[i] for p in allpoints) for i in range(3)))
def game(p):return [-p.x,p.z,p.y]
wingtips=[]
for name in ['LeftOutboardBody','RightOutboardBody']:
    ps=points(bpy.data.objects[name]);wingtips.append(game(sum(ps,Vector())/len(ps)))
nozzlepoints=points(bpy.data.objects['NozzleRing'])
nozzles=[]
for sign in (-1,1):
    ps=[p for p in nozzlepoints if p.x*sign>0]
    nlo=Vector(tuple(min(p[i] for p in ps) for i in range(3)))
    nhi=Vector(tuple(max(p[i] for p in ps) for i in range(3)))
    center=(nlo+nhi)/2;center.y=nhi.y
    nozzles.append(game(center))
materials={};batches={}
def material_key(m):
    n=m.node_tree.nodes.get('Principled BSDF')
    image=next((n.image.name for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image),'')
    return (image,tuple(round(c,5) for c in n.inputs['Base Color'].default_value),
            round(n.inputs['Metallic'].default_value,5),round(n.inputs['Roughness'].default_value,5),
            round(n.inputs['Alpha'].default_value,5))
for o in objects:
    gear=any(c.name=='05 Landing gear' for c in o.users_collection)
    # The source has open, separate gear doors and bays. They travel with the
    # parked assembly; hide this assembly in the airborne game instance.
    name=o.get('source_name',o.name)
    if any(t in name.lower() for t in ['gearflap','gearbay','axle','hydraulic']):gear=True
    # The F/A-18 deliverable has no mesh modifiers. Read original datablocks;
    # keeping material handles from temporary evaluated meshes is unsafe.
    mesh=o.data;mesh.calc_loop_triangles()
    uv=mesh.uv_layers.active
    normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
    for tri in mesh.loop_triangles:
        m=mesh.materials[tri.material_index];key=material_key(m)
        materials.setdefault(key,m)
        batch=batches.setdefault(('gear' if gear else 'airframe',key),{'pos':[],'normal':[],'uv':[]})
        for li in tri.loops:
            v=mesh.vertices[mesh.loops[li].vertex_index]
            batch['pos'].append(tuple(o.matrix_world@v.co))
            batch['normal'].append(tuple((normal_matrix@mesh.corner_normals[li].vector).normalized()))
            batch['uv'].append(tuple(uv.data[li].uv) if uv else (0,0))
print('Collected',len(batches),'material batches',flush=True)
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
root=bpy.data.objects.new('F-A-18C Hornet',None);scene.collection.objects.link(root)
root.rotation_euler.z=math.pi  # glTF Z-up conversion gives game Y-up, nose -Z.
root['modelId']='fa18';root['license']='GPL-2.0';root['source']='FGUK/FGMEMBERS F-18C; calibrated Blender v2'
groups={}
for role in ['airframe','gear']:
    o=bpy.data.objects.new('FA18 '+role,None);o['role']=role;o.parent=root
    scene.collection.objects.link(o);groups[role]=o
counts={}
for index,((role,key),batch) in enumerate(batches.items()):
    data=bpy.data.meshes.new('FA18 '+role+' material batch '+str(index))
    data.from_pydata(batch['pos'],[],[tuple(range(i,i+3)) for i in range(0,len(batch['pos']),3)])
    data.materials.append(materials[key]);uv=data.uv_layers.new(name='Source UV')
    for i,co in enumerate(batch['uv']):uv.data[i].uv=co
    for p in data.polygons:p.use_smooth=True
    data.normals_split_custom_set(batch['normal'])
    obj=bpy.data.objects.new(data.name,data);scene.collection.objects.link(obj);obj.parent=groups[role]
    counts[role]=counts.get(role,0)+len(data.polygons)
    if role=='gear':
        # Most source triangles are in tires/struts; keep the airframe intact.
        # Collapse only this assembly, while locking material/UV boundaries.
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bm.to_mesh(data);bm.free()
        if len(data.polygons)>400:
            mod=obj.modifiers.new('Game landing gear optimization','DECIMATE');mod.ratio=.42
            mod.use_collapse_triangulate=True
        obj.select_set(False)
print('Built merged meshes',counts,flush=True)
scene['asset_license']='GPL-2.0'
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format='GLB',export_yup=True,
                          export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
report={'asset':OUTPUT.name,'blend_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'units':'metres','forward':'-Z','up':'+Y','length':round(hi.y-lo.y,4),
        'span':round(hi.x-lo.x,4),'parkedGroundOffset':round(-lo.z+.04,4),
        'wingtips':wingtips,'nozzles':nozzles,'batchCount':len(batches),
        'sourceTriangles':counts,'license':'GPL-2.0',
        'sourceUrl':'https://github.com/FGMEMBERS/F-18C'}
(ROOT/'assets/models/fa18c.metadata.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('EXPORT',json.dumps(report),flush=True)
