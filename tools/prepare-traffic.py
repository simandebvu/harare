import bpy,os,math,sys,argparse
from pathlib import Path
p=argparse.ArgumentParser(description="Prepare Quaternius Cars Pack traffic models in Blender.")
p.add_argument("--blends",required=True,help="Extracted Cars Pack Blends directory")
p.add_argument("--output",default=str(Path(__file__).resolve().parents[1]/"assets"/"models"))
args=p.parse_args(sys.argv[sys.argv.index("--")+1:])
from mathutils import Vector,Matrix
out=args.output
os.makedirs(out,exist_ok=True)
for name,file,length in [('sedan','NormalCar1',4.56),('fit','NormalCar2',4),('police','Cop',5.3)]:
 bpy.ops.wm.open_mainfile(filepath=os.path.join(args.blends,file+'.blend'))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 for o in list(bpy.data.objects):
  if o not in meshes:bpy.data.objects.remove(o,do_unlink=True)
 for o in meshes:
  m=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(m)
 coords=[v.co for o in meshes for v in o.data.vertices];lo=min(v.y for v in coords);hi=max(v.y for v in coords);scale=length/(hi-lo);floor=min(v.z for v in coords)
 # Check headlamp face to determine vehicle forward direction.
 fronts=[]
 for o in meshes:
  for p in o.data.polygons:
   if 'Headlight' in o.data.materials[p.material_index].name:fronts.append(p.center.y)
 flip=1 if sum(fronts)/max(1,len(fronts))<0 else -1
 for o in meshes:
  for v in o.data.vertices:v.co=Vector((v.co.x*scale*flip,(v.co.y-(lo+hi)/2)*scale*flip,(v.co.z-floor)*scale))
  if 'Wheel' in o.name:
   vs=[v.co for v in o.data.vertices];center=Vector([(min(v[i] for v in vs)+max(v[i] for v in vs))/2 for i in range(3)])
   pivot=bpy.data.objects.new('wheel_'+('front' if 'Front' in o.name else 'rear')+'_'+o.name,None);bpy.context.collection.objects.link(pivot);pivot.location=center;o.data.transform(Matrix.Translation(-center));o.parent=pivot
 for m in bpy.data.materials:
  color=list(m.diffuse_color);m.use_nodes=True;m.node_tree.nodes.clear();p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');o=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],o.inputs['Surface']);p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.45
  if m.name in ['White','Blue','LightBlue']:
   m.name='Paint';p.inputs['Base Color'].default_value=(.8,.8,.8,1);p.inputs['Metallic'].default_value=.3;p.inputs['Roughness'].default_value=.28
  elif m.name=='Windows':p.inputs['Base Color'].default_value=(.025,.045,.065,1);p.inputs['Metallic'].default_value=.4;p.inputs['Roughness'].default_value=.18
  elif m.name=='Headlights':m.name='Headlamps';p.inputs['Base Color'].default_value=(.85,.85,.75,1)
  elif m.name=='TailLights':m.name='Taillamps'
  elif m.name=='Grey':p.inputs['Metallic'].default_value=.7
  elif m.name=='Black':p.inputs['Roughness'].default_value=.85
 bpy.ops.export_scene.gltf(filepath=out+'/'+name+'.glb',export_format='GLB',export_animations=False)
