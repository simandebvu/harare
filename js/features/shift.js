import {Shift} from '../game/shift.js';
import {groundY} from '../util.js';

// Stops are roadside bays near the ranks, kept clear of building footprints.
function stopNear(ctx,name,x,z){
  let best=null,score=Infinity;
  for(const e of ctx.DATA.graph.edges){
    if(e.k==='pedestrian')continue;
    for(let i=2;i<e.p.length;i+=2){
      const ax=e.p[i-2],az=e.p[i-1],dx=e.p[i]-ax,dz=e.p[i+1]-az,L=Math.hypot(dx,dz);if(L<15)continue;
      const t=Math.max(.15,Math.min(.85,((x-ax)*dx+(z-az)*dz)/(L*L)));
      const sign=e.o===-1?-1:1,tx=dx/L*sign,tz=dz/L*sign,off=Math.max(0,e.w/2-2.3);
      const px=ax+dx*t+tz*off,pz=az+dz*t-tx*off,d=Math.hypot(px-x,pz-z);
      if(d<score&&!ctx.buildings.blocked.box(px,pz,Math.atan2(tx,tz),3,1.2)){score=d;best={name,x:px,z:pz};}
    }
  }
  if(!best)throw Error('No clear rank stop found');return best;
}
const carAirborne=ctx=>(ctx.controls.car.alt||0)>.01;
export default {
  init(ctx){
    this.ctx=ctx;this.state=new Shift();this.stops=[stopNear(ctx,'Fourth Street',422,57),stopNear(ctx,'Charge Office',-319,502)];
    const link=document.createElement('link');link.rel='stylesheet';link.href='css/shift.css';document.head.appendChild(link);
    const ui=this.ui=document.createElement('section');ui.className='shift-card';ui.setAttribute('aria-label','Kombi shift');
    ui.innerHTML=`<div class="shift-eyebrow">HARARE TAXI · FIRST SHIFT</div><h2>Make your first takings.</h2><p class="shift-copy"></p><div class="shift-stats"></div><div class="shift-progress" hidden><span></span></div><p class="shift-hint"></p><div class="shift-actions"><button class="shift-start">Start 10-minute shift</button><button class="shift-end" hidden>End shift</button><button class="shift-dismiss">Free roam</button></div>`;
    document.body.appendChild(ui);
    this.launch=document.createElement('button');this.launch.className='shift-launch';this.launch.textContent='Start a kombi shift';this.launch.hidden=true;document.body.appendChild(this.launch);
    this.launch.onclick=()=>{ui.hidden=false;this.launch.hidden=true;};
    ui.querySelector('.shift-dismiss').onclick=()=>{ui.hidden=true;this.launch.hidden=false;};
    ui.querySelector('.shift-start').onclick=()=>this.start();
    ui.querySelector('.shift-end').onclick=()=>{this.state.finish('Shift ended early');this.complete();};
    addEventListener('harare:crash',e=>this.state.crash(e.detail?.strength||0));
    const T=ctx.THREE;
    this.marker=new T.Mesh(new T.RingGeometry(12,13,64).rotateX(-Math.PI/2),new T.MeshBasicMaterial({color:0xffd84c,transparent:true,opacity:.8,depthWrite:false,side:T.DoubleSide}));
    this.marker.visible=false;ctx.scene.add(this.marker);
    this.last={x:ctx.controls.car.x,z:ctx.controls.car.z};this.refresh=0;this.message='';
    ctx.shift=this;this.render();
  },
  route(){const p=this.stops[this.state.target];window.__harare.nav?.setDest(p.x,p.z,p.name+' · kombi stop');this.marker.position.set(p.x,groundY(p.x,p.z)+.35,p.z);this.marker.visible=true;},
  start(){if(this.ctx.controls.car.alt>.01)return;this.state.start(this.ctx.controls.vehicleType);this.ctx.setMode('drive');this.route();this.faceRoute();this.last={x:this.ctx.controls.car.x,z:this.ctx.controls.car.z};this.message='Follow the GPS to the yellow stop ring.';const st=this.stops[this.state.target];this.distance=Math.hypot(this.last.x-st.x,this.last.z-st.z);this.render();},
  // A shift should not open with a three-point turn: if the GPS leads away behind the kombi, put it in the lane that heads that way
  faceRoute(){const C=this.ctx.controls,c=C.car,pts=window.__harare.nav?.route;if(!pts||pts.length<4)return;
    let i=2,tx=pts[2],tz=pts[3];for(;i<pts.length;i+=2){tx=pts[i];tz=pts[i+1];if(Math.hypot(tx-c.x,tz-c.z)>12)break;}
    const yaw=Math.atan2(tx-c.x,tz-c.z);if(Math.cos(yaw-c.yaw)>0)return;
    C.placeCarOnRoad(c.x,c.z,yaw);if(Math.cos(yaw-c.yaw)<=0)return;C.rig.yaw=c.yaw;C.rig.orbitYaw=0;this.route();},
  complete(){this.marker.visible=false;window.__harare.nav?.clearDest();this.ctx.controls.car.v=this.ctx.controls.car.vx=this.ctx.controls.car.vz=0;this.render();},
  // Same figure as the GPS chip: the road distance, not the straight line
  roadDistance(){const d=this.distance||0,r=window.__harare.nav?.routeLen,m=d>22&&r?Math.max(d,r):d;return m<950?Math.round(m/10)*10+' m':(m/1000).toFixed(1)+' km';},
  render(){
    const s=this.state,active=s.status==='active',done=s.status==='finished',q=sel=>this.ui.querySelector(sel),money=n=>'$'+n.toFixed(2);
    q('h2').textContent=active?(s.onboard?'Take your passengers to '+this.stops[s.target].name:'Pick up at '+this.stops[s.target].name):done?s.reason:'Make your first takings.';
    q('.shift-copy').textContent=active?`${this.roadDistance()} to stop · ${s.onboard}/${s.capacity} passengers` :done?`${s.delivered} passengers delivered · ${s.trips} ${s.trips===1?'trip':'trips'}. ${s.profit>0?'You covered the shift costs.':'Try another shift to cover your costs.'}`:'Fourth Street ↔ Charge Office. Stop in the yellow ring for four seconds to board or drop off. Earn $24 in fares before the ten-minute shift ends.';
    q('.shift-stats').innerHTML=active?`<span><b>${Math.floor(s.remaining/60)}:${String(Math.floor(s.remaining%60)).padStart(2,'0')}</b> time left</span><span><b>${money(s.cash)}</b> / $24 fares</span><span><b>${Math.ceil(s.fuel)}%</b> ${s.vehicle==='roadster'?'battery':'fuel'}</span><span><b>${Math.round(s.comfort)}%</b> comfort</span>`:done?`<span><b>${money(s.cash)}</b> fares</span><span><b>${money(8+s.repairs+(100-s.fuel)*.04)}</b> costs</span><span><b>${money(s.profit)}</b> take-home</span>`:'';
    q('.shift-hint').textContent=active?(this.ctx.controls.mode!=='drive'?'Shift paused — return to Drive mode to continue.':carAirborne(this.ctx)?'Land on clear road before serving passengers.':this.distance<16?(this.ctx.controls.speed>.6?'Brake to a full stop to serve passengers.':`${s.onboard?'Dropping off':'Boarding'}… ${Math.max(0,Math.ceil(4-s.dwell))}s`):this.message):done?'Costs include $8 owner’s takings, fuel used and $1 per collision.':'Smooth driving earns a $2 tip per trip. Crashes cost money. Walking pauses the shift; fast travel ends it. Fares are game values.';
    q('.shift-progress').hidden=!active||!s.dwell;q('.shift-progress span').style.width=(s.dwell/4*100)+'%';
    q('.shift-start').hidden=active;q('.shift-start').textContent=done?'Try another shift':'Start 10-minute shift';q('.shift-end').hidden=!active;q('.shift-dismiss').hidden=active;
  },
  update(dt,ctx){
    const s=this.state;if(s.status!=='active')return;
    const car=ctx.controls.car,stop=this.stops[s.target];this.distance=Math.hypot(car.x-stop.x,car.z-stop.z);
    const travel=Math.hypot(car.x-this.last.x,car.z-this.last.z);this.last.x=car.x;this.last.z=car.z;
    let servingDistance=this.distance;
    if(servingDistance<16)for(let i=1;i<8;i++)if(ctx.buildings.blocked(car.x+(stop.x-car.x)*i/8,car.z+(stop.z-car.z)*i/8)){servingDistance=Infinity;break;}
    const event=s.tick(dt,{driving:ctx.controls.mode==='drive',hidden:document.hidden,speed:ctx.controls.speed,distance:servingDistance,travel,airborne:car.alt>.01});
    if(event==='pickup'){this.message=`${s.onboard} passenger${s.onboard===1?'':'s'} aboard. Keep it smooth for a tip.`;this.route();}
    if(event==='dropoff'){this.message=(s.cash>=24?'Fare target met! ':'Fares collected! ')+'Stay stopped to board return passengers.';}
    if(event==='finished'){this.complete();return;}
    this.refresh-=dt;if(this.refresh<=0||event){this.refresh=.15;this.render();}
  }
};
