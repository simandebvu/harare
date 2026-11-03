export class SupplyDrop {
 constructor(){this.status='idle';this.elapsed=0;this.attempts=0;this.damage=0;}
 start(pickup,target){Object.assign(this,{status:'pickup',pickup,target,elapsed:0,attempts:0,damage:0,parcel:null,result:null});}
 collect(mode,distance){if(this.status!=='pickup'||mode!=='walk'||distance>2.5)return false;this.status='carrying';return true;}
 canDrop(mode,p,speed){return this.status==='carrying'&&mode==='fly'&&speed<=4&&Math.hypot(p.x-this.target.x,p.z-this.target.z)<=8&&p.y-this.target.y>=2&&p.y-this.target.y<=12;}
 drop(mode,p,velocity){if(!this.canDrop(mode,p,Math.hypot(velocity.x,velocity.y,velocity.z)))return false;this.attempts++;this.status='falling';this.parcel={x:p.x,y:p.y+.5,z:p.z,vx:velocity.x,vy:Math.min(0,velocity.y),vz:velocity.z};return true;}
 tick(dt){
  if(!['pickup','carrying','falling'].includes(this.status))return;
  this.elapsed+=dt;
  if(this.status!=='falling')return;
  const p=this.parcel,steps=Math.max(1,Math.ceil(dt/.02));
  for(let i=0;i<steps;i++){
   const step=dt/steps,old={x:p.x,y:p.y,z:p.z};p.vy-=9.8*step;p.x+=p.vx*step;p.y+=p.vy*step;p.z+=p.vz*step;
   if(p.y<=this.target.y+.3){
    const t=Math.max(0,Math.min(1,(old.y-this.target.y-.3)/(old.y-p.y)));
    p.x=old.x+(p.x-old.x)*t;p.z=old.z+(p.z-old.z)*t;p.y=this.target.y+.3;
    const error=Math.hypot(p.x-this.target.x,p.z-this.target.z);
    if(error>this.target.radius){this.status='missed';return;}
    const accuracy=Math.max(0,1-error/this.target.radius),time=Math.max(0,1-this.elapsed/180);
    const score=Math.max(0,Math.round(accuracy*70+time*30-this.damage*5-(this.attempts-1)*10));
    this.result={score,error,medal:score>=85?'Gold':score>=65?'Silver':'Bronze'};this.status='complete';return;
   }
  }
 }
 retry(){if(this.status==='missed'){this.status='pickup';this.parcel=null;return true;}return false;}
 cancel(){this.status='idle';this.parcel=null;}
}
