"""Bake timed anticipation, extension, impact and recovery using the existing character poses."""
import bpy
from pathlib import Path
from mathutils import Matrix
base=Path(__file__).resolve().parents[1]
for gender in ['male','female']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(base/f'assets/models/african-{gender}.glb'))
 rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
 names=['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Jump_Loop','Hover_Loop','Flight_Loop','Brace_Loop']
 clips={n:next(a for a in bpy.data.actions if n in a.name) for n in names}
 rig.animation_data_clear();rig.animation_data_create()
 poses={}
 for name in ['Idle_Loop','Hover_Loop','Brace_Loop']:
  a=clips[name];rig.animation_data.action=a;rig.animation_data.action_slot=a.slots[0]
  bpy.context.scene.frame_set(int(a.frame_range[0]));bpy.context.view_layer.update()
  poses[name]={b.name:b.matrix_basis.decompose() for b in rig.pose.bones}
 rig.animation_data.action=None
 for name,keys,duration in [
  ('Takeoff',[(0,'Idle_Loop'),(.38,'Brace_Loop'),(.55,'Brace_Loop'),(.86,'Hover_Loop'),(1.2,'Hover_Loop')],1.2),
  ('Touchdown',[(0,'Hover_Loop'),(.10,'Brace_Loop'),(.28,'Brace_Loop'),(.72,'Idle_Loop')],.72)]:
  rig.animation_data.action=None
  fps=bpy.context.scene.render.fps
  for f in range(round(duration*fps)+1):
   t=min(duration,f/fps)
   a,b=keys[-2:]
   for i in range(len(keys)-1):
    if keys[i][0]<=t<=keys[i+1][0]:a,b=keys[i:i+2];break
   u=max(0,min(1,(t-a[0])/(b[0]-a[0])));u=u*u*(3-2*u)
   for pb in rig.pose.bones:
    p,q,s=poses[a[1]][pb.name];p2,q2,s2=poses[b[1]][pb.name]
    pb.rotation_mode='QUATERNION';pb.location=p.lerp(p2,u);pb.rotation_quaternion=q.slerp(q2,u);pb.scale=s.lerp(s2,u)
    for prop in ['location','rotation_quaternion','scale']:pb.keyframe_insert(data_path=prop,frame=f)
  action=rig.animation_data.action;action.name=name;action.use_fake_user=True;clips[name]=action
 rig.animation_data.action=None
 for name,a in clips.items():
  a.use_fake_user=True;tr=rig.animation_data.nla_tracks.new();tr.name=name;strip=tr.strips.new(name,0,a);strip.action_slot=a.slots[0]
 bpy.ops.export_scene.gltf(filepath=str(base/f'assets/models/african-{gender}.glb'),export_format='GLB',export_animation_mode='NLA_TRACKS',export_force_sampling=True)
