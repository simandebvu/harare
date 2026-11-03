import bpy, math, argparse, sys
from pathlib import Path
parser=argparse.ArgumentParser(description='Rebuild Skyweaver from the intact CC0 Quaternius base and hair, retaining the existing player animations.')
parser.add_argument('--player',required=True)
parser.add_argument('--character',required=True)
parser.add_argument('--hair',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.player)
actions={a.name:a for a in bpy.data.actions};
for a in actions.values():a.use_fake_user=True
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=args.character)
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
rig.animation_data_create();rig.animation_data.action=None
for name,a in actions.items():
 tr=rig.animation_data.nla_tracks.new();tr.name=name.split('|')[-1];st=tr.strips.new(tr.name,0,a);st.action_slot=a.slots[0];tr.mute=True
bpy.context.view_layer.update()
def mat(name,c,rough=.8):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;return m
navy=mat('Skyweaver woven jacket',(.025,.065,.09));trim=mat('Skyweaver warm metal',(.27,.19,.075),.42);hair=mat('Natural dark hair',(.009,.006,.004));boot=mat('Skyweaver graphite boots',(.025,.028,.033))
for o in list(bpy.data.objects):
 if o.name in ['Red cap','Cap brim']:bpy.data.objects.remove(o,do_unlink=True)
 elif o.type=='MESH':
  if o.name.startswith(('Trainer','Sole')):
   # Reduce the inflated oval trainers, keeping the ankle centre fixed.
   for v in o.data.vertices:
    cx=.1143 if v.co.x>0 else -.1143
    v.co.x=cx+(v.co.x-cx)*.85;v.co.y*=.84
   if o.name.startswith('Trainer'):o.data.materials.clear();o.data.materials.append(boot)
  if o.name=='Eyebrows':o.data.materials.clear();o.data.materials.append(hair)
body=bpy.data.objects.get('SuperHero_Male')
# Preserve the original artist's continuous skinned topology (the old bisected mesh had broken weights).
if body:
 shirt=mat('Forest green cotton',(.025,.065,.09));pants=mat('Dark indigo trousers',(.02,.027,.035));soles=mat('Rubber soles',(.13,.14,.14))
 for m in [shirt,pants,boot,soles]:body.data.materials.append(m)
 for f in body.data.polygons:
  x,y,z=f.center;f.material_index=4 if z<.025 else 3 if z<.13 else 2 if z<.96 else 1 if z<1.55 and abs(x)<.43 else 0
for o in list(bpy.data.objects):
 if o.name.startswith('Icosphere'):bpy.data.objects.remove(o,do_unlink=True)

def skin(o,bone,material):
 bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 o.data.materials.append(material);g=o.vertex_groups.new(name=bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE');mod=o.modifiers.new('Skin','ARMATURE');mod.object=rig;o.parent=rig
 for p in o.data.polygons:p.use_smooth=True
# Compact bevelled ankle boots, weighted to each foot rather than inflated spheres.
for side,x in [('l',.1143),('r',-.1143)]:
 bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-.025,.065));o=bpy.context.object;o.name='Fitted boot '+side;o.scale=(.13,.275,.125)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);be=o.modifiers.new('Boot rounding','BEVEL');be.width=.035;be.segments=4;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=be.name);skin(o,'foot_'+side,boot)
# Authored CC0 buzz-cut asset, attached to the existing animated head rig.
old=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=args.hair)
new=set(bpy.data.objects)-old
for o in new:
 if o.type=='MESH':
  world=o.matrix_world.copy();o.parent=rig;o.matrix_world=world
  for m in o.modifiers:
   if m.type=='ARMATURE':m.object=rig
  o.data.materials.clear();o.data.materials.append(hair)
for o in list(new):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
for t in rig.animation_data.nla_tracks:t.mute=False
bpy.ops.export_scene.gltf(filepath=args.output,export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True)
