import bpy,math,os,sys,argparse
from pathlib import Path
parser=argparse.ArgumentParser(description="Prepare the licensed Harare hero models in Blender 5.2.")
for name in ["hiace", "characters", "animations"]: parser.add_argument("--"+name,required=True)
parser.add_argument("--output",default=str(Path(__file__).resolve().parents[1]/"assets"/"models"))
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
from mathutils import Vector,Matrix
OUT=args.output;os.makedirs(OUT,exist_ok=True)
def mat(name,color,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def export(name):
 bpy.ops.export_scene.gltf(filepath=OUT+'/'+name+'.glb',export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_nla_strips_merged_animation_name='Action',export_extras=False)
# Vehicle: bake hierarchy, give each wheel a clean axle pivot.
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=args.hiace)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:
 world=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(world)
for o in list(bpy.context.scene.objects):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
for side in ['front left','front right','rear left','rear right']:
 parts=[o for o in meshes if o.name.startswith(side)];coords=[v.co for o in parts for v in o.data.vertices]
 center=Vector([(min(v[i] for v in coords)+max(v[i] for v in coords))/2 for i in range(3)])
 pivot=bpy.data.objects.new('wheel_'+side.replace(' ','_'),None);bpy.context.collection.objects.link(pivot);pivot.location=center
 for o in parts:o.data.transform(Matrix.Translation(-center));o.parent=pivot
 print('WHEEL',side,tuple(center))
for m in bpy.data.materials:
 p=m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
 if not p:continue
 if m.name=='base':p.inputs['Base Color'].default_value=(.84,.86,.82,1);p.inputs['Roughness'].default_value=.32;p.inputs['Metallic'].default_value=.18
 if m.name=='window':p.inputs['Base Color'].default_value=(.025,.055,.075,1);p.inputs['Roughness'].default_value=.22;p.inputs['Metallic'].default_value=.45;p.inputs['Alpha'].default_value=1
 if m.name=='rubber':p.inputs['Roughness'].default_value=.9
 if m.name in ['headlight','brake_lights']:
  head=m.name=='headlight';m.name='Headlamps' if head else 'Taillamps';p.inputs['Emission Color'].default_value=(1,.83,.55,1) if head else (1,.015,.005,1);p.inputs['Emission Strength'].default_value=0
# Raise tire bottoms to ground; source car faces -Y which exports as +Z.
bpy.context.view_layer.update()
coords=[o.matrix_world@v.co for o in meshes for v in o.data.vertices];floor=min(v.z for v in coords)
for o in bpy.context.scene.objects:
 if o.parent is None:o.location.z-=floor
export('hiace')
# Character + shared-rig animation actions.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.animations)
keep=['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Jump_Loop'];actions={a.name:a for a in bpy.data.actions if a.name in keep}
for a in actions.values():a.use_fake_user=True
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
path=args.characters
# Two missing aliases in the artist's source glTF.
for stem in ['T_Hair_1_Normal','T_Eye_Normal']:
 import shutil;shutil.copyfile(os.path.dirname(path)+'/'+stem+'.png',os.path.dirname(path)+'/'+stem+'_png.png')
bpy.ops.import_scene.gltf(filepath=path)
for o in list(bpy.data.objects):
 if o.name.startswith('Icosphere'):bpy.data.objects.remove(o,do_unlink=True)
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');body=bpy.data.objects.get('SuperHero_Male')
shirt=mat('Forest green cotton',(.024,.17,.10));pants=mat('Dark indigo trousers',(.028,.045,.075));shoes=mat('Charcoal trainers',(.035,.04,.045));sole=mat('Rubber soles',(.55,.57,.53))
for m in [shirt,pants,shoes,sole]:body.data.materials.append(m)
import bmesh
bm=bmesh.new();bm.from_mesh(body.data)
for axis,value in [(2,.045),(2,.15),(2,.96),(2,1.55),(0,-.43),(0,.43)]:
 normal=Vector((0,0,0));normal[axis]=1;point=normal*value
 bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=point,plane_no=normal)
bm.to_mesh(body.data);bm.free();body.data.update()
for f in body.data.polygons:
 c=f.center;x,y,z=c
 f.material_index=4 if z<.045 else 3 if z<.15 else 2 if z<.96 else 1 if z<1.55 and abs(x)<.43 else 0
# Offset fabric slightly from the original anatomical silhouette.
cloth={v for f in body.data.polygons if f.material_index in [1,2] for v in f.vertices}
for i in cloth:body.data.vertices[i].co+=body.data.vertices[i].normal*.009
# A fitted fabric cap keeps the playable character recognisable.
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,location=(0,.018,1.76));cap=bpy.context.object;cap.name='Red cap';cap.scale=(.104,.112,.09);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bm=bmesh.new();bm.from_mesh(cap.data);bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<-.015],context='VERTS');bm.to_mesh(cap.data);bm.free()
cap.data.materials.append(mat('Red cotton',(.48,.025,.025)))
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=8,location=(0,-.108,1.758));brim=bpy.context.object;brim.name='Cap brim';brim.scale=(.105,.092,.009);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);brim.data.materials.append(cap.data.materials[0])
for o in [cap,brim]:
 bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 group=o.vertex_groups.new(name='Head');group.add(list(range(len(o.data.vertices))),1,'REPLACE');mod=o.modifiers.new('Skin','ARMATURE');mod.object=rig;o.parent=rig
 for f in o.data.polygons:f.use_smooth=True
skin=body.data.materials[0];p=skin.node_tree.nodes.get('Principled BSDF');links=skin.node_tree.links
if p.inputs['Base Color'].is_linked:
 source=p.inputs['Base Color'].links[0].from_socket;mix=skin.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(.48,.32,.23,1);links.new(source,mix.inputs[1]);links.new(mix.outputs[0],p.inputs['Base Color'])
# Limit hero texture resolution for a compact local download.
for im in bpy.data.images:
 if im.size[0]>512:im.scale(512,512)
for side,x in [('l',.1143),('r',-.1143)]:
 for name,z,scale,material in [('Trainer',.067,(.072,.159,.062),shoes),('Sole',.016,(.074,.161,.018),sole)]:
  bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,location=(x,-.003,z));o=bpy.context.object;o.name=name+'_'+side;o.scale=scale;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.data.materials.append(material)
  group=o.vertex_groups.new(name='foot_'+side);group.add(list(range(len(o.data.vertices))),1,'REPLACE');mod=o.modifiers.new('Skin','ARMATURE');mod.object=rig;o.parent=rig
  for f in o.data.polygons:f.use_smooth=True
# Each imported action uses the same named rig, with local offsets relative to its rest pose.
rig.animation_data_create();rig.animation_data.action=None
for name,a in actions.items():
 tr=rig.animation_data.nla_tracks.new();tr.name=name;st=tr.strips.new(name,0,a);st.action_slot=a.slots[0]
# Remove unused textures from output by clearing orphan material data via export selection.
for o in bpy.context.scene.objects:o.select_set(True)
export('player')
print('BUILT',OUT)
