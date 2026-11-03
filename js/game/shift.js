// Small deterministic shift simulation, independent of rendering and input.
export class Shift {
  constructor(){this.status='ready';}
  start(vehicle='kombi'){this.vehicle=vehicle;this.capacity=vehicle==='roadster'?1:8;this.fare=vehicle==='roadster'?12:1.5;Object.assign(this,{status:'active',remaining:600,fuel:100,comfort:100,cash:0,delivered:0,trips:0,onboard:0,target:0,dwell:0,repairs:0,crashCooldown:0,reason:''});}
  crash(strength){
    if(this.status!=='active'||this.crashCooldown>0||strength<2)return;
    this.crashCooldown=2;this.comfort=Math.max(0,this.comfort-Math.min(20,strength));this.repairs+=1;
  }
  finish(reason){if(this.status!=='active')return;this.status='finished';this.reason=reason;this.dwell=0;}
  get profit(){return this.cash-8-this.repairs-(100-this.fuel)*.04;}
  tick(dt,{driving=true,hidden=false,speed=0,distance=Infinity,travel=0,airborne=false}={}){
    if(this.status!=='active'||hidden||!driving)return null;
    dt=Math.max(0,Math.min(dt,1));
    if(travel>80){this.finish('Shift ended after fast travel');return 'finished';}
    this.remaining=Math.max(0,this.remaining-dt);this.crashCooldown=Math.max(0,this.crashCooldown-dt);
    this.fuel=Math.max(0,this.fuel-dt*(.025+Math.abs(speed)*.009));
    if(speed>19)this.comfort=Math.max(0,this.comfort-dt*.65);
    else this.comfort=Math.min(100,this.comfort+dt*.06);
    if(this.remaining===0||this.fuel===0){this.finish(this.fuel===0?'Out of fuel':'Shift complete');return 'finished';}
    if(airborne||distance>16||Math.abs(speed)>.6){this.dwell=0;return null;}
    this.dwell+=dt;
    if(this.dwell<4)return null;
    this.dwell=0;
    if(this.onboard){
      this.cash+=this.onboard*this.fare+(this.comfort>=80?2:0);this.delivered+=this.onboard;this.onboard=0;this.trips++;
      return 'dropoff';
    }
    this.onboard=this.capacity;this.target=1-this.target;return 'pickup';
  }
}
