import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { groundY } from './util.js';

export function createCrowdModels(scene,people,camera) {
  const pools=[[],[]],shown=new Set();
  people.deferCommit();
  const frustum=new THREE.Frustum(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere(new THREE.Vector3(),2);
  const ready=Promise.all(['player','pedestrian-female'].map(async(file,sex)=>{
    try {
      const g=await new GLTFLoader().loadAsync(new URL(`../assets/models/${file}.glb`,import.meta.url).href);
      for(let i=0;i<20;i++) {
        const root=clone(g.scene),materials=new Map();root.name=`detailed-pedestrian-${sex}-${i}`;root.visible=false;
        root.traverse(o=>{
          if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;o.frustumCulled=false;
          const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};
          o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
        });
        const mixer=new THREE.AnimationMixer(root),idle=mixer.clipAction(THREE.AnimationClip.findByName(g.animations,'Idle_Loop')).play(),walk=mixer.clipAction(THREE.AnimationClip.findByName(g.animations,'Walk_Loop')).play();
        walk.setEffectiveWeight(0);mixer.update(i*.137);
        scene.add(root);pools[sex].push({root,mixer,idle,walk,person:null,blend:0,materials:[...materials.values()]});
      }
    }catch(e){console.warn('[harare] Crowd model unavailable; using procedural people.',e.message);}
  }));
  return {ready,pools,update(dt){
    for(const p of shown)people.figures.hide(p.i,!!p.hidden);shown.clear();
    matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(matrix);
    const candidates=[[],[]];
    for(const p of [...people.walkers,...people.loiter]){
      if(p.hidden||!p.look||p.look.load||p.s<.75)continue;
      const d=(p.x-camera.position.x)**2+(p.z-camera.position.z)**2+(camera.position.y-groundY(p.x,p.z)-1)**2;
      sphere.center.set(p.x,groundY(p.x,p.z)+1,p.z);
      if(d<48**2&&frustum.intersectsSphere(sphere))candidates[p.look.fem?1:0].push([p,d]);
    }
    for(let sex=0;sex<2;sex++){
      for(const o of pools[sex])o.root.visible=false;
      candidates[sex].sort((a,b)=>a[1]-b[1]);
      const selected=candidates[sex].slice(0,pools[sex].length).map(([p])=>p),wanted=new Set(selected);
      for(const o of pools[sex])if(!wanted.has(o.person))o.person=null;
      selected.forEach(p=>{
        let o=pools[sex].find(o=>o.person===p);
        if(!o){o=pools[sex].find(o=>!o.person);o.person=p;o.blend=0;}
        const L=p.look,speed=p.actualSpeed??0;
        o.blend+=(Math.min(1,speed/.35)-o.blend)*(1-Math.exp(-Math.min(dt,.1)*12));
        const move=o.blend;
        o.root.visible=true;o.root.position.set(p.x,groundY(p.x,p.z)+(p.y??.15),p.z);o.root.rotation.y=p.yaw;o.root.scale.setScalar(p.s*.95);
        for(const m of o.materials){
          if(m.name.startsWith('MI_Superhero'))m.color.setScalar(.85+Math.min(.35,L.skin.r));
          else if(m.name==='Forest green cotton')m.color.copy(L.top);
          else if(m.name==='Dark indigo trousers')m.color.copy(L.bot);
          else if(m.name==='Red cotton')m.color.copy(sex?L.hair:L.acc);
          else if(m.name==='Charcoal trainers')m.color.copy(L.shoe);
        }
        o.walk.setEffectiveWeight(move);o.idle.setEffectiveWeight(1-move);o.walk.setEffectiveTimeScale(Math.max(.25,speed/(1.4*p.s*.95)));o.mixer.update(Math.min(dt,.1));
        people.figures.hide(p.i,true);shown.add(p);
      });
    }
    people.figures.commit(people.time);
  }};
}
