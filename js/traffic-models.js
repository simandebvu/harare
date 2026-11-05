import * as THREE from 'three';
import { VEHICLE_TYPES } from './vehicles.js';
import { gltfLoader } from './gltf-loader.js';
const files={fit:'fit',sedan:'sedan',police:'police',kombi:'hiace'};
const cache=new Map();
function asset(name) {
  if(!cache.has(name))cache.set(name,gltfLoader.loadAsync(new URL(`../assets/models/${name}.glb`,import.meta.url).href));
  return cache.get(name);
}
export function createTrafficModels(scene,capacities) {
  const pools={},previous=new Map();
  const ready=Promise.all(Object.entries(files).map(async([type,file])=>{
    if(!capacities[type])return;
    try {
      const gltf=await asset(file),pool=[];
      for(let i=0;i<Math.min(capacities[type],type==='kombi'?10:7);i++){
        const root=gltf.scene.clone(true),materials=new Map(),paint=[],head=[],tail=[],wheels=[];
        root.name=`detailed-traffic-${type}-${i}`;root.visible=false;
        // Match the visible body to the shared traffic footprint, including mirrors.
        if(type!=='kombi'){
          const size=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
          root.scale.x*=VEHICLE_TYPES[type].width/size.x;
        }
        root.traverse(o=>{
          if(o.name.startsWith('wheel_'))wheels.push(o);
          if(!o.isMesh)return;o.castShadow=o.receiveShadow=true;
          const copy=m=>{if(!materials.has(m))materials.set(m,m.clone());return materials.get(m);};
          o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
        });
        for(const m of materials.values()){
          if(m.name==='Paint'||m.name==='base')paint.push(m);
          if(m.name==='Headlamps'){m.emissive.set('#fff0d0');head.push(m);}
          if(m.name==='Taillamps'){m.emissive.set('#ff1305');tail.push(m);}
        }
        scene.add(root);pool.push({root,paint,head,tail,wheels});
      }
      pools[type]=pool;
    }catch(e){console.warn(`[harare] ${type} traffic model unavailable; using procedural model.`,e.message);}
  }));
  return {ready,pools,
    update(cam,time,TYPE,X,Y,Z,H,COL,LMP,count){
      const selected=new Set();
      for(const [type,pool] of Object.entries(pools)){
        for(const p of pool)p.root.visible=false;
        if(!cam)continue;
        const candidates=[];
        for(let i=0;i<count;i++)if(TYPE[i]===type){const d=(X[i]-cam.position.x)**2+(Y[i]-cam.position.y)**2+(Z[i]-cam.position.z)**2;if(d<90**2)candidates.push([i,d]);}
        candidates.sort((a,b)=>a[1]-b[1]);
        candidates.slice(0,pool.length).forEach(([i],k)=>{
          const p=pool[k],old=previous.get(i);let spin=old?.spin||0;
          if(old){const distance=(X[i]-old.x)*Math.sin(H[i])+(Z[i]-old.z)*Math.cos(H[i]);if(Math.abs(distance)<10)spin+=distance/(type==='kombi'?.381:.3);}
          previous.set(i,{x:X[i],z:Z[i],spin:spin%(Math.PI*2)});
          p.root.visible=true;p.root.position.set(X[i],Y[i],Z[i]);p.root.rotation.y=H[i];
          for(const m of p.paint)m.color.setRGB(COL[i*3],COL[i*3+1],COL[i*3+2]);
          for(const m of p.head)m.emissiveIntensity=LMP[i*4]*2;
          for(const m of p.tail)m.emissiveIntensity=LMP[i*4]*.35+LMP[i*4+1]*2.5;
          for(const wheel of p.wheels)wheel.rotation.x=spin;
          selected.add(i);
        });
      }
      return selected;
    }
  };
}
