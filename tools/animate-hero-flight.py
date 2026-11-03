"""Add skeletal hover and forward-flight loops to the two prepared character rigs.
Run prepare-hero-transitions.py afterwards to rebuild Takeoff and Touchdown clips.
"""
import bpy,math,re
from pathlib import Path
from mathutils import Matrix, Vector
base=Path(__file__).resolve().parents[1]
for gender in ['male','female']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(base/f'assets/models/african-{gender}.glb'))
 rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
 clips=[a for a in bpy.data.actions if any(n in a.name for n in ['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Jump_Loop'])]
 idle=next(a for a in clips if 'Idle_Loop' in a.name)
 rig.animation_data_clear();rig.animation_data_create();rig.animation_data.action=idle;rig.animation_data.action_slot=idle.slots[0]
 bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
 rest={b.name:b.matrix_basis.copy() for b in rig.pose.bones}
 rig.animation_data.action=None
 def bone(key,side=''):
  if gender=='male':return rig.pose.bones.get(key+('_'+side if side else ''))
  aliases={'upperarm':'Arm','lowerarm':'ForeArm','thigh':'UpLeg','calf':'Leg','foot':'Foot','Head':'Head','spine_03':'Spine2','pelvis':'Hips'}
  name=('Left' if side=='l' else 'Right' if side=='r' else '')+aliases[key]
  return next((b for b in rig.pose.bones if re.sub(r'_\d+$','',b.name.split(':')[-1])==name),None)
 def turn(key,side,axis,angle):
  b=bone(key,side)
  if b is None:return
  bpy.context.view_layer.update()
  # Rotate around the bone's origin in rig-space, preserving the artist's joint orientation.
  m=b.matrix.copy();p=m.translation.copy();b.matrix=Matrix.Translation(p)@Matrix.Rotation(math.radians(angle),4,axis)@Matrix.Translation(-p)@m
  bpy.context.view_layer.update()
 for name in ['Hover_Loop','Flight_Loop','Brace_Loop']:
  rig.animation_data.action=None
  for frame in range(1,62):
   t=(frame-1)/60*math.tau;wave=math.sin(t);other=math.sin(t+1.2)
   for b in rig.pose.bones:b.matrix_basis=rest[b.name]
   bpy.context.view_layer.update()
   ankles={side:rig.matrix_world@bone('calf',side).tail for side in ['l','r']}
   flying=name=='Flight_Loop'
   for side,sign in [('l',1),('r',-1)]:
    turn('upperarm',side,'X',(-165 if side=='l' else -155)+wave*1.5 if flying else -12+wave*5*sign)
    if not flying:turn('upperarm',side,'Y',-sign*(13+other*3))
    turn('lowerarm',side,'X',(14 if side=='l' else 8) if flying else -22+other*4)
    turn('thigh',side,'X',(-2+wave*1.5*sign) if flying else (-8 if side=='l' else 4)+wave*4*sign)
    if flying:turn('thigh',side,'Y',sign*7)
    turn('calf',side,'X',(7+other*2*sign) if flying else 28+other*6*sign)
    turn('foot',side,'X',12+wave*3)
   if name=='Brace_Loop':
    # Compact, asymmetric crouch: load the legs before launch and absorb touchdown.
    for b in rig.pose.bones:b.matrix_basis=rest[b.name]
    bpy.context.view_layer.update()
    for side in ['l','r']:
     turn('thigh',side,'X',-42)
     turn('calf',side,'X',84)
     turn('foot',side,'X',-36)
     turn('upperarm',side,'X',-45 if side=='l' else 15)
     turn('lowerarm',side,'X',-40 if side=='l' else -65)
    turn('spine_03','','X',24)
    # Plant both ankles while lowering the hips. Solve the two leg chains, then bake the result.
    hip=bone('pelvis');hm=hip.matrix.copy();hm.translation+=rig.matrix_world.inverted().to_3x3()@Vector((0,0,-.29));hip.matrix=hm
    targets=[];constraints=[]
    for side in ['l','r']:
     calf=bone('calf',side);foot=bone('foot',side)
     # Rest-pose baseline uses the sampled idle matrices, captured before the crouch.
     target=bpy.data.objects.new('Foot plant',None);bpy.context.collection.objects.link(target);target.location=ankles[side]
     con=calf.constraints.new('IK');con.target=target;con.chain_count=2;con.use_stretch=False
     targets.append(target);constraints.append((calf,con))
    bpy.context.view_layer.update()
    baked={b.name:b.matrix.copy() for b in rig.pose.bones}
    for calf,con in constraints:calf.constraints.remove(con)
    for b in rig.pose.bones:b.matrix=baked[b.name]
    for target in targets:bpy.data.objects.remove(target,do_unlink=True)
    bpy.context.view_layer.update()
   turn('Head','','X',-42 if flying else -4+wave*2)
   turn('spine_03','','Y',other*2)
   for b in rig.pose.bones:
    b.rotation_mode='QUATERNION';b.keyframe_insert(data_path='rotation_quaternion',frame=frame)
    b.keyframe_insert(data_path='location',frame=frame)
  action=rig.animation_data.action;action.name=name;action.use_fake_user=True;clips.append(action)
 rig.animation_data.action=None
 for a in clips:
  a.use_fake_user=True;t=rig.animation_data.nla_tracks.new();name=next(n for n in ['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Jump_Loop','Hover_Loop','Flight_Loop','Brace_Loop'] if n in a.name);t.name=name;strip=t.strips.new(name,0,a);strip.action_slot=a.slots[0]
 bpy.ops.export_scene.gltf(filepath=str(base/f'assets/models/african-{gender}.glb'),export_format='GLB',export_animation_mode='NLA_TRACKS',export_force_sampling=True)
