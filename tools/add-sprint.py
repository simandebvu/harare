"""Add Quaternius' CC0 Sprint_Loop to both hero rigs: the jog clip dips the pelvis ~23 cm per stride and had to play at
~1.8x to keep up with RUN_V, which read as a frantic crouch. The sprint's natural pace matches the run speed.
Male: same CC0 rig and bone names, so the action is assigned directly. Female: rotations retargeted per frame onto her
own skeleton, the same way tools/retarget-female.py did the other clips.
usage: blender -b -P tools/add-sprint.py -- <UAL1_Standard.glb> <in-dir with uncompressed african-*.glb> <out-dir>
then:  tools/compress-models.sh assets/models <out-dir>
"""
import bpy, re, sys
from pathlib import Path
UAL, SRC, OUT = (Path(p) for p in sys.argv[sys.argv.index('--') + 1:][:3])
CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Hover_Loop', 'Flight_Loop', 'Brace_Loop', 'Takeoff', 'Touchdown']

def clip_name(action):
    return next((n for n in CLIPS if n in action.name), None)

for gender in ['male', 'female']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SRC / f'african-{gender}.glb'))
    tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    clips = {clip_name(a): a for a in bpy.data.actions if clip_name(a)}
    old_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(UAL))
    src = next(o for o in set(bpy.data.objects) - old_objects if o.type == 'ARMATURE')
    sprint = next(a for a in bpy.data.actions if a.name.startswith('Sprint_Loop'))
    for o in set(bpy.data.objects) - old_objects:
        if o != src: bpy.data.objects.remove(o, do_unlink=True)
    tgt.animation_data_clear(); tgt.animation_data_create()
    if gender == 'male':
        sprint.name = 'Sprint_Loop'; clips['Sprint_Loop'] = sprint
    else:
        mapping = {'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_02', 'Spine2': 'spine_03', 'Neck': 'neck_01', 'Head': 'Head'}
        for side, suffix in [('Left', 'l'), ('Right', 'r')]:
            for a, b in [('Shoulder', 'clavicle'), ('Arm', 'upperarm'), ('ForeArm', 'lowerarm'), ('Hand', 'hand'), ('UpLeg', 'thigh'), ('Leg', 'calf'), ('Foot', 'foot'), ('ToeBase', 'ball')]:
                mapping[side + a] = b + '_' + suffix
        pairs = {b.name: mapping.get(re.sub(r'_\d+$', '', b.name.split(':')[-1])) for b in tgt.data.bones}
        src.animation_data_clear(); src.animation_data_create()
        src.animation_data.action = sprint; src.animation_data.action_slot = sprint.slots[0]
        start, end = map(int, sprint.frame_range)
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
            desired = {}
            for b in tgt.data.bones:
                name = pairs[b.name]; rest = (tgt.matrix_world @ b.matrix_local).to_quaternion()
                if name and name in src.data.bones:
                    sb = src.data.bones[name]; sp = src.pose.bones[name]
                    desired[b.name] = (src.matrix_world @ sp.matrix).to_quaternion() @ (src.matrix_world @ sb.matrix_local).to_quaternion().inverted() @ rest
                elif b.parent:
                    desired[b.name] = desired[b.parent.name] @ (tgt.matrix_world @ b.parent.matrix_local).to_quaternion().inverted() @ rest
                else:
                    desired[b.name] = rest
                parent = desired[b.parent.name] if b.parent else tgt.matrix_world.to_quaternion()
                restlocal = (b.parent.matrix_local.inverted() @ b.matrix_local).to_quaternion() if b.parent else b.matrix_local.to_quaternion()
                pb = tgt.pose.bones[b.name]; pb.rotation_mode = 'QUATERNION'
                pb.rotation_quaternion = restlocal.inverted() @ parent.inverted() @ desired[b.name]
                pb.keyframe_insert(data_path='rotation_quaternion', frame=frame)
        out = tgt.animation_data.action; out.name = 'Female_Sprint_Loop'; clips['Sprint_Loop'] = out
        tgt.animation_data.action = None
    bpy.data.objects.remove(src, do_unlink=True)
    for name in CLIPS:
        a = clips.get(name)
        if not a: raise SystemExit(f'{gender}: missing {name}')
        a.use_fake_user = True; tr = tgt.animation_data.nla_tracks.new(); tr.name = name
        strip = tr.strips.new(name, int(a.frame_range[0]), a); strip.action_slot = a.slots[0]
    print(gender, 'clips', sorted(clips))
    bpy.ops.export_scene.gltf(filepath=str(OUT / f'african-{gender}.glb'), export_format='GLB', export_animation_mode='NLA_TRACKS', export_force_sampling=True)
