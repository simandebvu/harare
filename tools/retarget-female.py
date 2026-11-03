import bpy,re
from mathutils import Quaternion
from pathlib import Path
B=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(B/'assets/models/player.glb'))
src=next(o for o in bpy.data.objects if o.type=='ARMATURE');acts=list(bpy.data.actions)
for a in acts:a.use_fake_user=True
for o in list(bpy.data.objects):
 if o!=src:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(Path(__import__('sys').argv[__import__('sys').argv.index('--')+1])/'african-female.glb'))
tgt=next(o for o in bpy.data.objects if o.type=='ARMATURE' and o!=src)
tgt.animation_data_clear()
for o in list(bpy.data.objects):
 if o.name=='Icosphere':bpy.data.objects.remove(o,do_unlink=True)
mapping={'Hips':'pelvis','Spine':'spine_01','Spine1':'spine_02','Spine2':'spine_03','Neck':'neck_01','Head':'Head'}
for side,suffix in [('Left','l'),('Right','r')]:
 for a,b in [('Shoulder','clavicle'),('Arm','upperarm'),('ForeArm','lowerarm'),('Hand','hand'),('UpLeg','thigh'),('Leg','calf'),('Foot','foot'),('ToeBase','ball')]:mapping[side+a]=b+'_'+suffix
pairs={b.name:mapping.get(re.sub(r'_\d+$','',b.name.split(':')[-1])) for b in tgt.data.bones}
src.animation_data_clear();src.animation_data_create()
for a in acts:
 src.animation_data.action=a;src.animation_data.action_slot=a.slots[0]
 tgt.animation_data_create();tgt.animation_data.action=None
 start,end=map(int,a.frame_range)
 for frame in range(start,end+1):
  bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
  desired={}
  for b in tgt.data.bones:
   name=pairs[b.name];rest=(tgt.matrix_world@b.matrix_local).to_quaternion()
   if name:
    sb=src.data.bones[name];sp=src.pose.bones[name]
    desired[b.name]=(src.matrix_world@sp.matrix).to_quaternion() @ (src.matrix_world@sb.matrix_local).to_quaternion().inverted() @ rest
   elif b.parent:
    desired[b.name]=desired[b.parent.name] @ (tgt.matrix_world@b.parent.matrix_local).to_quaternion().inverted() @ rest
   else:desired[b.name]=rest
   parent=desired[b.parent.name] if b.parent else tgt.matrix_world.to_quaternion()
   restlocal=(b.parent.matrix_local.inverted()@b.matrix_local).to_quaternion() if b.parent else b.matrix_local.to_quaternion()
   pb=tgt.pose.bones[b.name];pb.rotation_mode='QUATERNION';pb.rotation_quaternion=restlocal.inverted()@parent.inverted()@desired[b.name]
   pb.keyframe_insert(data_path='rotation_quaternion',frame=frame)
 out=tgt.animation_data.action;out.name='Female_'+a.name
 tr=tgt.animation_data.nla_tracks.new();tr.name=a.name;st=tr.strips.new(a.name,start,out);st.action_slot=out.slots[0];tr.mute=True
 tgt.animation_data.action=None
for tr in tgt.animation_data.nla_tracks:tr.mute=False
bpy.data.objects.remove(src,do_unlink=True)
# Scale the complete rig hierarchy together without altering skin bind transforms.
root=tgt
while root.parent:root=root.parent
root.scale*=1.78/1.621
for mat in bpy.data.materials:
 if mat.use_nodes:
  p=mat.node_tree.nodes.get('Principled BSDF')
  if p:p.inputs['Roughness'].default_value=.8
bpy.ops.export_scene.gltf(filepath=str(B/'assets/models/african-female.glb'),export_format='GLB',export_animation_mode='NLA_TRACKS',export_force_sampling=True)
