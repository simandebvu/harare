"""Bind downloaded characters to the project's CC0 locomotion rig; preserve authored materials."""
import bpy, math
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
import re
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]; SOURCES=Path(__import__('sys').argv[__import__('sys').argv.index('--')+1])
for gender in ['male']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(BASE/'assets/models/player.glb'))
 rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');rig.animation_data_clear()
 actions=list(bpy.data.actions)
 for a in actions:a.use_fake_user=True
 for o in list(bpy.data.objects):
  if o!=rig:bpy.data.objects.remove(o,do_unlink=True)
 old=set(bpy.data.objects)
 bpy.ops.import_scene.gltf(filepath=str(SOURCES/f'african-{gender}.glb'))
 source_weights={}
 meshes=[o for o in set(bpy.data.objects)-old if o.type=='MESH' and o.name!='Icosphere']
 bpy.context.view_layer.update()
 # Bake the artist's rest mesh into world coordinates, stripping only the source skeleton.
 for o in meshes:
  world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
  if gender=='female':
   mapping={'Hips':'pelvis','Spine':'spine_01','Spine1':'spine_02','Spine2':'spine_03','Neck':'neck_01','Head':'Head'}
   for side,suffix in [('Left','l'),('Right','r')]:
    for a,b in [('Shoulder','clavicle'),('Arm','upperarm'),('ForeArm','lowerarm'),('Hand','hand'),('UpLeg','thigh'),('Leg','calf'),('Foot','foot'),('ToeBase','ball')]:mapping[side+a]=b+'_'+suffix
    for digit in ['Thumb','Index','Middle','Ring','Pinky']:
     for n in range(1,4):mapping[side+'Hand'+digit+str(n)]=digit.lower()+'_%02d_'%n+suffix
   names={g.index:mapping.get(re.sub(r'_\d+$','',g.name.split(':')[-1]),'Head') for g in o.vertex_groups}
   source_weights[o.name]=[[(names[g.group],g.weight) for g in v.groups] for v in o.data.vertices]
  o.modifiers.clear();o.vertex_groups.clear()
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
 for o in list(set(bpy.data.objects)-old):
  if o not in meshes:bpy.data.objects.remove(o,do_unlink=True)
 if gender=='female':
  for o in meshes:
   for v in o.data.vertices:v.co*=1.78/1.621
 else:
  # Source is an A-pose; rotate each arm about its shoulder into the animation rig's T-pose.
  for o in meshes:
   for v in o.data.vertices:
    x,y,z=v.co
    if abs(x)>.22 and z> .88:
     side=1 if x>0 else -1;pivot=Vector((side*.20,.02,1.48))
     v.co=pivot+Matrix.Rotation(-side*math.radians(55),3,'Y')@(v.co-pivot)
 bpy.ops.object.select_all(action='DESELECT')
 for o in meshes:o.select_set(True)
 rig.select_set(True);bpy.context.view_layer.objects.active=rig
 if gender=='male':bpy.ops.object.parent_set(type='ARMATURE_AUTO')
 else:
  bpy.ops.object.parent_set(type='ARMATURE_NAME')
  for o in meshes:
   for i,weights in enumerate(source_weights[o.name]):
    for name,w in weights:
     g=o.vertex_groups.get(name) or o.vertex_groups.new(name=name);g.add([i],w,'ADD')
 # Copy nearest valid weights for isolated vertices instead of exporting unbound points.
 for o in meshes:
  valid=[v for v in o.data.vertices if v.groups]
  if valid:
   tree=KDTree(len(valid))
   for v in valid:tree.insert(v.co,v.index)
   tree.balance()
   for v in o.data.vertices:
    if not v.groups:
     _,idx,_=tree.find(v.co)
     for g in o.data.vertices[idx].groups:o.vertex_groups[g.group].add([v.index],g.weight,'REPLACE')
 # Head accessories remain rigid with the head; automatic heat weights can fail on tiny disconnected parts.
 head=next((b.name for b in rig.data.bones if b.name.lower()=='head'),'Head')
 print('HEAD',head,'BONES',[b.name for b in rig.data.bones])
 for o in meshes:
  if max(v.co.z for v in o.data.vertices)>1.65 and min(v.co.z for v in o.data.vertices)>1.4:
   o.vertex_groups.clear();g=o.vertex_groups.new(name=head);g.add(list(range(len(o.data.vertices))),1,'REPLACE')
  # Preserve hand silhouettes: this source has different finger proportions from the CC0 rig.
  for v in o.data.vertices:
   if abs(v.co.x)>.69:
    for g in list(v.groups):o.vertex_groups[g.group].remove([v.index])
    name='hand_l' if v.co.x>0 else 'hand_r';g=o.vertex_groups.get(name) or o.vertex_groups.new(name=name);g.add([v.index],1,'REPLACE')
  print(gender,o.name,'unweighted',sum(not v.groups for v in o.data.vertices))
 rig.animation_data_create()
 for a in actions:
  t=rig.animation_data.nla_tracks.new();t.name=a.name;s=t.strips.new(a.name,0,a);s.action_slot=a.slots[0]
 bpy.ops.export_scene.gltf(filepath=str(BASE/f'assets/models/african-{gender}.glb'),export_format='GLB',export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True)
