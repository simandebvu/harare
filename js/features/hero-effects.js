// A single reusable ground-impact effect: bounded particles, no per-frame geometry allocation.
export default {
 init(ctx){
  const T=ctx.THREE;this.T=T;this.age=2;this.ctx=ctx;this.windTime=0;this.windStrength=0;
  // Short air streaks follow the velocity, leaving the face and centre of the body clear.
  const count=12*16*2,windGeometry=new T.BufferGeometry();
  windGeometry.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3));
  windGeometry.setAttribute('color',new T.BufferAttribute(new Float32Array(count*3),3));
  this.wind=new T.LineSegments(windGeometry,new T.LineBasicMaterial({color:0xc7e9ed,vertexColors:true,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));
  this.wind.name='hero-wind';this.wind.frustumCulled=false;this.wind.visible=false;ctx.scene.add(this.wind);
  this.windDirection=new T.Vector3();this.forward=new T.Vector3(0,0,1);
  this.group=new T.Group();ctx.scene.add(this.group);this.group.visible=false;
  this.ring=new T.Mesh(new T.RingGeometry(.82,1,64).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0xc7eeeb,transparent:true,opacity:0,depthWrite:false,side:T.DoubleSide}));this.ring.position.y=.06;this.group.add(this.ring);
  const data=new Float32Array(48*3),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(data,3));
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const c=canvas.getContext('2d'),g=c.createRadialGradient(16,16,0,16,16,16);g.addColorStop(0,'rgba(255,255,255,.8)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,32,32);
  this.dust=new T.Points(geometry,new T.PointsMaterial({color:0xc5b49a,size:.65,map:new T.CanvasTexture(canvas),transparent:true,opacity:0,depthWrite:false}));this.dust.frustumCulled=false;this.group.add(this.dust);
  addEventListener('harare:hero-burst',e=>{const{x,y,z,kind}=e.detail;this.age=0;this.strength=kind==='land'?1:.7;this.group.position.set(x,y+.02,z);this.group.visible=true;});
 },
 updateWind(dt){
  const c=this.ctx.controls,h=c.heli,speed=Math.hypot(h.vx,h.vy,h.vz);
  const enabled=c.mode==='fly'&&c.player.visible&&!['charge','impact'].includes(h.phase);
  const target=enabled?this.T.MathUtils.smoothstep(speed,7,42):0;
  this.windStrength+=(target-this.windStrength)*(1-Math.exp(-dt*7));
  this.wind.visible=enabled&&this.windStrength>.01;
  if(!this.wind.visible)return;
  this.windTime+=dt*(1+speed*.035);this.wind.material.opacity=this.windStrength*.6;
  this.wind.position.set(h.x,h.y+.7,h.z);
  if(speed>.1)this.wind.quaternion.setFromUnitVectors(this.forward,this.windDirection.set(h.vx,h.vy,h.vz).normalize());
  const positions=this.wind.geometry.attributes.position,colors=this.wind.geometry.attributes.color;
  let index=0;
  for(let line=0;line<12;line++){
   const angle=line*2.39996,radius=.85+(line%4)*.28;
   const travel=((this.windTime+line*.137)%1)*6;
   for(let segment=0;segment<16;segment++)for(let end=0;end<2;end++){
    const u=(segment+end)/16,z=2.5-travel-u*(.8+speed*.035);
    const bend=Math.sin(u*Math.PI)*.09;
    positions.setXYZ(index,Math.cos(angle)*(radius+bend),Math.sin(angle)*(radius+bend),z);
    const fade=Math.sin(u*Math.PI)*Math.sin(Math.PI*travel/6);
    colors.setXYZ(index,fade,fade,fade);index++;
   }
  }
  positions.needsUpdate=colors.needsUpdate=true;
 },
 update(dt){
  this.updateWind(dt);
  if(this.age>1.1)return;this.age+=dt;const t=this.age,k=this.strength;
  if(t>1.1){this.group.visible=false;return;}
  this.ring.scale.setScalar(.5+t*6*k);this.ring.material.opacity=Math.max(0,(1-t/.65)*.5);
  this.dust.material.opacity=Math.max(0,(1-t/1.1)*.45);this.dust.material.size=.3+t*.8;
  const a=this.dust.geometry.attributes.position;
  for(let i=0;i<48;i++){const angle=i*2.39996,r=(.2+t*(1.5+(i%7)*.35))*k;a.setXYZ(i,Math.cos(angle)*r,.08+Math.sin(Math.min(1,t)*Math.PI)*(.15+(i%5)*.07),Math.sin(angle)*r);}a.needsUpdate=true;
 }
};
