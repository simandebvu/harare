// Vela X1: original fictional electric flight concept. Legacy export preserves saved vehicle keys.
import * as T from 'three';
export function createRoadster(scene){
 const root=new T.Group(),body=new T.Group(),wheels=[];root.add(body);
 const paint=new T.MeshStandardMaterial({color:0x214e66,metalness:.78,roughness:.2});
 const glass=new T.MeshStandardMaterial({color:0x111e28,metalness:.65,roughness:.13});
 const dark=new T.MeshStandardMaterial({color:0x11161a,roughness:.65});
 const rubber=new T.MeshStandardMaterial({color:0x17191b,roughness:.92});
 const rim=new T.MeshStandardMaterial({color:0xaeb9c2,metalness:.9,roughness:.22});
 const brakeMat=new T.MeshStandardMaterial({color:0x434b50,metalness:.8,roughness:.4});
 const red=new T.MeshStandardMaterial({color:0xc92822,metalness:.3,roughness:.35});
 const head=new T.MeshStandardMaterial({color:0xeaf6ff,emissive:0xb9ddff,emissiveIntensity:1.5});
 const tail=new T.MeshStandardMaterial({color:0xb50812,emissive:0xff1620,emissiveIntensity:1});
 const cyan=new T.MeshStandardMaterial({color:0x81efff,emissive:0x25cfff,emissiveIntensity:2});
 function mesh(g,m,x=0,y=0,z=0,parent=body){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;parent.add(o);return o;}
 function box(x,y,z,w,h,d,m,parent=body){return mesh(new T.BoxGeometry(w,h,d),m,x,y,z,parent);}
 function shell(sections,mat){
  const pos=[],idx=[];
  for(const [z,w,lo,hi,top] of sections)pos.push(-w,lo,z,w,lo,z,w,hi,z,top,hi+.06,z,-top,hi+.06,z,-w,hi,z);
  for(let j=0;j<sections.length-1;j++)for(let i=0;i<6;i++){const a=j*6+i,b=j*6+(i+1)%6,c=b+6,d=a+6;idx.push(a,b,d,b,c,d);}
  for(let i=1;i<5;i++){idx.push(0,i+1,i);const n=(sections.length-1)*6;idx.push(n,n+i,n+i+1);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return mesh(g,mat);
 }
 // Narrow central tub leaves actual space for the tyres instead of burying them inside a solid block.
 shell([[-2.12,.73,.26,.62,.67],[-1.7,.74,.22,.74,.66],[-.8,.74,.2,.7,.66],[.55,.74,.2,.56,.67],[1.5,.73,.24,.44,.66],[2.12,.65,.29,.36,.6]],paint);
 shell([[-1.2,.63,.68,.75,.5],[-.6,.59,.68,1.08,.49],[.17,.58,.58,1.03,.48],[.9,.65,.48,.52,.6]],glass);
 box(0,.22,0,1.42,.1,3.9,dark);box(0,.29,2.1,1.42,.055,.18,dark);
 // Continuous light signature and canopy spine define the fictional concept.
 box(0,.49,1.99,1.2,.018,.028,cyan);
 box(0,1.12,-.3,.055,.018,.55,paint);
 box(0,.36,-2.15,1.24,.09,.025,glass);

 for(let i=0;i<7;i++)box(0,.765,-1.35-i*.065,1.06,.014,.025,dark);
 const wing=new T.Group();wing.position.set(0,.78,-1.8);body.add(wing);
 box(0,.04,0,1.65,.035,.22,dark,wing);
 for(const side of [-1,1]){
  box(side*.58,0,0,.035,.07,.08,dark,wing);
  // Side panel boundary follows both wheel arches; no geometry covers the wheel faces.
  const sh=new T.Shape();sh.moveTo(-2.1,.26);
  for(const z of [-1.4,1.35]){
    sh.lineTo(z-.405,.26);sh.lineTo(z-.405,.35);
    for(let i=0;i<=20;i++){const a=Math.PI-i*Math.PI/20;sh.lineTo(z+Math.cos(a)*.405,.35+Math.sin(a)*.405);}
    sh.lineTo(z+.405,.26);
  }
  sh.lineTo(2.1,.3);sh.lineTo(2.1,.43);sh.quadraticCurveTo(1.9,.46,1.72,.68);sh.quadraticCurveTo(1.35,.82,.95,.69);sh.quadraticCurveTo(.3,.6,-.85,.76);sh.quadraticCurveTo(-1.4,.83,-1.85,.76);sh.lineTo(-2.1,.64);sh.closePath();
  const geo=new T.ExtrudeGeometry(sh,{depth:.15,bevelEnabled:true,bevelSize:.012,bevelThickness:.012,bevelSegments:2,steps:1,curveSegments:20});
  geo.rotateY(-Math.PI/2);mesh(geo,paint,side===1?.95:-.8,0,0);
  box(side*.67,.48,1.92,.4,.026,.075,head);
  box(side*.94,.68,.25,.16,.075,.2,dark);
  box(side*.9,.27,-.02,.07,.09,1.75,dark);
  box(side*.88,.61,-.37,.028,.025,.18,dark);
  for(const z of [-1.4,1.35]){
   const steerPivot=new T.Group();steerPivot.position.set(side*.88,.35,z);root.add(steerPivot);
   const spinGroup=new T.Group();steerPivot.add(spinGroup);wheels.push({steerPivot,spinGroup,front:z>0});
   mesh(new T.TorusGeometry(.285,.065,12,48).rotateY(Math.PI/2),rubber,0,0,0,spinGroup);
   mesh(new T.CylinderGeometry(.325,.325,.18,48).rotateZ(Math.PI/2),rubber,0,0,0,spinGroup);
   // Recessed brake rotor, alloy lip and ten split spokes on the visible face.
   mesh(new T.CylinderGeometry(.215,.215,.014,40).rotateZ(Math.PI/2),brakeMat,side*.1,0,0,steerPivot);
   box(side*.115,.07,-.15,.04,.13,.065,red,steerPivot);
   mesh(new T.TorusGeometry(.253,.014,8,48).rotateY(Math.PI/2),rim,side*.12,0,0,spinGroup);
   for(let i=0;i<10;i++){
    const a=i*Math.PI/5;
    for(const d of [-.035,.035]){
      const spoke=box(side*.125,Math.cos(a+d)*.16,Math.sin(a+d)*.16,.025,.17,.021,rim,spinGroup);spoke.rotation.x=a+d;
    }
   }
   mesh(new T.CylinderGeometry(.062,.062,.025,20).rotateZ(Math.PI/2),rim,side*.13,0,0,spinGroup);
   // Flush illuminated lift rings, with actual particles emitted below.
   mesh(new T.TorusGeometry(.13,.025,8,32).rotateX(Math.PI/2),cyan,side*.61,.16,z);
   mesh(new T.TorusGeometry(.257,.009,8,64).rotateY(Math.PI/2),cyan,side*.135,0,0,spinGroup);
   mesh(new T.CylinderGeometry(.1,.13,.08,20),rim,side*.61,.18,z);
  }
  // Long light blades and a slim floating rear deck replace exhaust pipes.
  box(side*.78,.5,-2.13,.22,.035,.055,cyan);
  box(side*.91,.31,-.02,.025,.018,1.72,cyan);

 }
 box(0,.64,-2.13,1.4,.025,.035,tail);box(0,.28,-2.1,1.42,.12,.16,dark);
 for(let i=-3;i<=3;i++)box(i*.19,.22,-2.08,.025,.15,.32,dark);
 root.name='Vela X1 concept taxi';
 // Fixed-size world-space exhaust pool: trails stay behind as the vehicle moves.
 const count=320,positions=new Float32Array(count*3),alpha=new Float32Array(count),ages=new Float32Array(count).fill(9),vel=new Float32Array(count*3);
 const pg=new T.BufferGeometry();pg.setAttribute('position',new T.BufferAttribute(positions,3));pg.setAttribute('alpha',new T.BufferAttribute(alpha,1));
 const pm=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,
 vertexShader:'attribute float alpha; varying float a; void main(){a=alpha;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(520.*(.16+(1.-alpha)*.3)/max(1.,-p.z),1.,55.);}',
 fragmentShader:'varying float a; void main(){float d=length(gl_PointCoord-.5)*2.;float f=pow(max(0.,1.-d),2.);gl_FragColor=vec4(.25,.8,1.,a*f);}' });
 const particles=new T.Points(pg,pm);particles.frustumCulled=false;particles.name='Vela thrust trails';(scene||root).add(particles);
 const origin=new T.Vector3(),direction=new T.Vector3();let cursor=0,carry=0;
 function exhaust(dt,power){
  root.updateWorldMatrix(true,false);carry+=dt*280*power;
  while(carry>=1){carry--;const i=cursor++%count,j=i*3,n=i%4;origin.set(n%2?.61:-.61,.12,n<2?-1.4:1.35);direction.set((Math.random()-.5)*.7,-3.8-Math.random()*2,(Math.random()-.5)*.7);
   if(scene){origin.applyMatrix4(root.matrixWorld);direction.transformDirection(root.matrixWorld).multiplyScalar(5);}
   positions.set([origin.x,origin.y,origin.z],j);vel.set([direction.x,direction.y,direction.z],j);ages[i]=0;
  }
  for(let i=0;i<count;i++){ages[i]+=dt;alpha[i]=Math.max(0,1-ages[i]/.65);if(alpha[i]>0)for(let k=0;k<3;k++)positions[i*3+k]+=vel[i*3+k]*dt;}
  pg.attributes.position.needsUpdate=pg.attributes.alpha.needsUpdate=true;
  particles.visible=root.visible&&alpha.some(a=>a>0);
 }
 let spin=0,air=0,t=0;
 return {root,particles,update(dt,speed,steer,brake,flight){
  t+=Math.min(dt,.1);const k=1-Math.exp(-dt*5);air+=((flight.height>.1?1:0)-air)*k;
  spin+=speed*dt/.35*(1-air*.92);
  for(const w of wheels){w.spinGroup.rotation.x=spin;w.steerPivot.rotation.y=w.front?steer*(1-air*.8):0;w.steerPivot.position.y=.35-.045*air;}
  root.rotation.x+=(T.MathUtils.clamp(-flight.velocity*.018+air*speed*.0015,-.09,.08)-root.rotation.x)*k;
  root.rotation.z+=(T.MathUtils.clamp(air*steer*speed*.035,-.16,.16)-root.rotation.z)*k;
  body.position.y=-flight.touchdown*.045+Math.sin(t*2.2)*.012*air;
  wing.rotation.x+=( (air?.18:brake*.32)-wing.rotation.x)*k;
  wing.position.y=.78+air*.13;
  tail.emissiveIntensity=.65+brake*2.3;
  exhaust(Math.min(dt,.1),flight.thrust);
 }};
}
