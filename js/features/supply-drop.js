import {SupplyDrop} from '../game/supply-drop.js';
import {groundY,pointInPoly} from '../util.js';
export default {
 init(ctx){
  this.ctx=ctx;this.state=new SupplyDrop();ctx.supplyDrop=this;this.cooldown=0;
  const T=ctx.THREE,w=ctx.controls.walk;this.pickup={x:w.x,z:w.z};
  let found=false;
  for(let r=2;r<20&&!found;r+=2)for(let i=0;i<16;i++){const x=w.x+Math.cos(i*Math.PI/8)*r,z=w.z+Math.sin(i*Math.PI/8)*r;if(!ctx.controls.walkHits(x,z,.7,0,w)){this.pickup={x,z};found=true;break;}}
  this.pickup.y=groundY(this.pickup.x,this.pickup.z);
  const candidates=ctx.buildings.rooftops.filter(f=>f.missionRoof&&f.h>10&&f.h<65).map(f=>{
   const x=(f.bounds[0]+f.bounds[2])/2,z=(f.bounds[1]+f.bounds[3])/2;
   const fits=[[-7,-7],[-7,7],[7,-7],[7,7],[0,0]].every(([dx,dz])=>pointInPoly(x+dx,z+dz,f.p));
   return {x,z,y:f.h+6.3,base:f.h,radius:3.5,fits,distance:Math.hypot(x-w.x,z-w.z)};
  }).filter(f=>f.fits&&!ctx.buildings.blocked(f.x,f.z,f.y+1)&&f.distance>100&&f.distance<650).sort((a,b)=>Math.abs(a.distance-240)-Math.abs(b.distance-240));
  if(!candidates.length)throw Error('No safe delivery rooftop found');
  this.target=candidates[0];const roof=this.target;
  // Raised receiving deck clears the existing rooftop water tanks and plant rooms.
  this.deck=new T.Group();const metal=new T.MeshStandardMaterial({color:0x253b3c,roughness:.85});
  const slab=new T.Mesh(new T.BoxGeometry(12,.4,12),metal);slab.position.set(roof.x,roof.y-.2,roof.z);slab.receiveShadow=true;this.deck.add(slab);
  for(const dx of [-5,5])for(const dz of [-5,5]){const post=new T.Mesh(new T.BoxGeometry(.4,6,.4),metal);post.position.set(roof.x+dx,roof.base+3,roof.z+dz);this.deck.add(post);}
  ctx.scene.add(this.deck);ctx.buildings.addRoofDeck(roof.x,roof.z,6,roof.y);
  const ring=(radius,color)=>new T.Mesh(new T.RingGeometry(radius-.15,radius,64).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color,side:T.DoubleSide,transparent:true,opacity:.9}));
  this.marker=ring(roof.radius,0x62e5dc);this.marker.position.set(roof.x,roof.y+.05,roof.z);ctx.scene.add(this.marker);
  this.pickupRing=ring(1.6,0xffd75e);this.pickupRing.position.set(this.pickup.x,this.pickup.y+.06,this.pickup.z);ctx.scene.add(this.pickupRing);
  this.beacon=new T.Mesh(new T.CylinderGeometry(.15,.15,18,8),new T.MeshBasicMaterial({color:0x62e5dc,transparent:true,opacity:.4,depthWrite:false}));this.beacon.position.set(roof.x,roof.y+9,roof.z);ctx.scene.add(this.beacon);
  this.package=new T.Group();const box=new T.Mesh(new T.BoxGeometry(.65,.55,.5),new T.MeshStandardMaterial({color:0xefc653,roughness:.75}));box.castShadow=true;this.package.add(box);
  for(const dims of [[.12,.57,.52],[.67,.57,.1]])this.package.add(new T.Mesh(new T.BoxGeometry(...dims),new T.MeshStandardMaterial({color:0xf8f1da})));ctx.scene.add(this.package);
  const style=document.createElement('style');style.textContent=`.supply-launch{position:fixed;left:20px;top:134px;z-index:8;background:#73e3d4;color:#102c28;border:0;border-radius:9px;padding:11px 14px;font:600 12px system-ui;cursor:pointer}.supply-card{position:fixed;left:20px;top:88px;width:280px;padding:18px;box-sizing:border-box;background:#14211ff2;border:1px solid #ffffff30;border-radius:16px;color:#f3f4e9;z-index:9;font:13px/1.5 system-ui}.supply-card h2{font-size:20px;margin:6px 0}.supply-card p{margin:9px 0;color:#c6d6ce}.supply-card small{color:#78e3d4;letter-spacing:1px}.supply-card button{cursor:pointer;padding:8px 12px;border-radius:8px;border:1px solid #ffffff40;background:#273d36;color:white;margin:6px 6px 0 0}.supply-action{position:fixed;bottom:118px;left:50%;transform:translateX(-50%);z-index:12;padding:12px 22px;border:1px solid #9bf3e9;border-radius:12px;background:#123d37ed;color:#fff;font:600 14px system-ui;cursor:pointer;max-width:90vw}.supply-action:disabled{opacity:.7;cursor:default}.supply-card[hidden],.supply-launch[hidden],.supply-action[hidden]{display:none}.supply-card button:focus-visible,.supply-action:focus-visible,.supply-launch:focus-visible{outline:2px solid white;outline-offset:3px}@media(max-width:700px){.supply-card{left:10px;top:76px;width:230px;padding:12px}.supply-launch{left:10px;top:128px}.supply-action{bottom:108px;font-size:12px}}@media(max-width:600px){body.gm-has-touch .supply-action{left:auto;right:10px;transform:none;bottom:max(392px,calc(env(safe-area-inset-bottom) + 378px));padding:10px 14px}}`;document.head.appendChild(style);
  this.launch=document.createElement('button');this.launch.className='supply-launch';this.launch.textContent='Supply drop · hero mission';this.launch.onclick=()=>{this.start();this.launch.blur();};
  this.card=document.createElement('section');this.card.className='supply-card';this.card.setAttribute('aria-label','Supply drop mission');this.card.innerHTML='<small>SKYWEAVER · SUPPLY RUN</small><h2></h2><p class="objective" role="status"></p><p class="metrics"></p><button class="again">Try again</button><button class="cancel">Close mission</button>';
  this.card.querySelector('.again').onclick=()=>{if(this.state.retry())this.route(this.pickup,'Collect replacement supplies');else this.start();};this.card.querySelector('.cancel').onclick=()=>this.cancel();this.card.addEventListener('click',e=>e.target.closest('button')?.blur());
  this.action=document.createElement('button');this.action.className='supply-action';this.action.onclick=()=>{this.act?.();this.render();this.action.blur();};document.body.append(this.launch,this.card,this.action);
  addEventListener('keydown',e=>{if(e.code==='KeyR'&&!e.repeat&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)&&!document.querySelector('[popover]:popover-open')){e.preventDefault();this.act?.();this.render();}});
  this.render();
 },
 route(p,name){window.__harare.nav?.setDest(p.x,p.z,name);},
 start(){
  if(this.ctx.shift?.state.status==='active')return;
  this.state.start(this.pickup,this.target);this.route(this.pickup,'Supply collection');this.ctx.shift.ui.hidden=true;this.ctx.shift.launch.hidden=true;this.render();
 },
 cancel(){this.state.cancel();window.__harare.nav?.clearDest();this.ctx.shift.launch.hidden=false;this.render();},
 chooseAction(){
  const c=this.ctx.controls,s=this.state,p=c.playerState,dist=Math.hypot(p.x-this.pickup.x,p.z-this.pickup.z);
  this.act=null;let label='';
  if(s.status==='pickup'&&dist<2.5&&c.mode==='walk'){label='Pick up supplies';this.act=()=>{if(s.collect(c.mode,Math.hypot(c.playerState.x-this.pickup.x,c.playerState.z-this.pickup.z)))this.route(this.target,'Rooftop supply drop');};}
  else if(s.status==='carrying'&&c.mode==='fly'){
   if(s.canDrop(c.mode,p,c.speed)){label='Drop package';this.act=()=>s.drop(c.mode,c.heli,{x:c.heli.vx,y:c.heli.vy,z:c.heli.vz});}
   else{const d=Math.hypot(p.x-this.target.x,p.z-this.target.z),alt=p.y-this.target.y;label=d>8?'Fly to the cyan rooftop target':alt<2?'Rise above the receiving deck':alt>12?'Descend to 2–12 m above the deck':'Slow to a hover to release';}
  }else if(s.status==='falling')label='Package falling…';
  else if(c.mode==='drive'){label='Exit taxi';this.act=()=>this.ctx.setMode('walk');}
  else if(c.mode==='fly'){label=c.heli.landing?'Landing…':'Land';if(!c.heli.landing)this.act=()=>this.ctx.setMode('walk');}
  else if(c.mode==='walk'){
   if(s.status!=='carrying'&&c.driven&&Math.hypot(p.x-c.car.x,p.z-c.car.z)<4){label='Enter taxi';this.act=()=>this.ctx.setMode('drive');}
   else{label='Fly';this.act=()=>this.ctx.setMode('fly');}
  }
  this.action.textContent=label+(this.act?' [R]':'');this.action.disabled=!this.act;this.action.hidden=!label;
 },
 render(){
  const s=this.state,c=this.ctx.controls,p=c.playerState,active=s.status!=='idle';this.card.hidden=!active;this.launch.hidden=active||!this.ctx.shift.ui.hidden;this.launch.disabled=this.ctx.shift?.state.status==='active';
  this.launch.textContent=this.launch.disabled?'Finish taxi shift for supply missions':'Supply drop · hero mission';
  this.ctx.shift.launch.hidden=active||!this.ctx.shift.ui.hidden;
  this.marker.visible=active;this.beacon.visible=active&&Math.hypot(p.x-this.target.x,p.z-this.target.z)>25;this.pickupRing.visible=s.status==='pickup';this.package.visible=active&&s.status!=='missed'&&(s.status!=='carrying'||c.player.visible||c.mode==='drive');
  const title=this.card.querySelector('h2'),objective=this.card.querySelector('.objective');
  const distance=Math.round(Math.hypot(p.x-this.target.x,p.z-this.target.z));
  if(s.status==='pickup'){title.textContent='1 · Collect the supplies';objective.textContent=`Walk to the yellow collection ring (${Math.round(Math.hypot(p.x-this.pickup.x,p.z-this.pickup.z))} m). Press R nearby to pick up the package.`;}
  if(s.status==='carrying'){title.textContent='2 · Deliver by air';objective.textContent=distance>30?`Cyan rooftop · ${distance} m away · deck ${Math.round(this.target.y)} m high. Rise above the roofs and follow the beacon.`:`${distance} m from target · ${((p.y||0)-this.target.y).toFixed(1)} m above deck · ${c.speed.toFixed(1)} m/s. Hover 2–12 m above the ring, then press R to release. Aim for the centre.`;}
  if(s.status==='falling'){title.textContent='3 · Watch the drop';objective.textContent='Your momentum carries into the package. A steady hover gives the most accurate delivery.';}
  if(s.status==='missed'){title.textContent='Missed the target';objective.textContent='The package drifted outside the ring. Collect a replacement and try a slower, lower release.';}
  if(s.status==='complete'){title.textContent=`${s.result.medal} delivery · ${s.result.score}/100`;objective.textContent=`Supplies received! ${s.result.error.toFixed(1)} m from centre. Try again for a more accurate delivery.`;try{const best=Math.max(s.result.score,Number(localStorage.getItem('harare-supply-best'))||0);localStorage.setItem('harare-supply-best',String(best));objective.textContent+=` Personal best: ${best}.`;}catch{}}
  this.card.querySelector('.metrics').textContent=`${Math.floor(s.elapsed/60)}:${String(Math.floor(s.elapsed%60)).padStart(2,'0')} elapsed · ${s.attempts} drops · ${s.damage} damage`;
  this.card.querySelector('.again').hidden=!['complete','missed'].includes(s.status);this.chooseAction();
 },
 update(dt){
  const s=this.state,c=this.ctx.controls,p=c.playerState;
  if(!document.hidden)s.tick(dt);
  if(s.status==='carrying'&&c.mode==='fly'&&this.lastSpeed>10&&c.speed<this.lastSpeed*.45&&this.cooldown<=0){s.damage=Math.min(10,s.damage+1);this.cooldown=1;}
  this.lastSpeed=c.speed;this.cooldown-=dt;
  if(s.status==='pickup')this.package.position.set(this.pickup.x,this.pickup.y+.4,this.pickup.z);
  else if(s.status==='carrying'){const yaw=p.yaw||0;this.package.position.set(p.x+Math.cos(yaw)*.55,(p.y??groundY(p.x,p.z))+.65,p.z-Math.sin(yaw)*.55);this.package.rotation.y=yaw;}
  else if(s.parcel)this.package.position.set(s.parcel.x,s.parcel.y,s.parcel.z);
  this.refresh=(this.refresh||0)-dt;if(this.refresh<=0){this.refresh=.12;this.render();}
 }
};
