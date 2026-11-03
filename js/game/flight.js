// Damped vertical motion for the arcade traffic hop; collision rules remain conservative.
export class Flight {
  constructor(){this.height=0;this.charge=100;this.lifting=false;this.landingBlocked=false;this.velocity=0;this.thrust=0;this.touchdown=0;}
  toggle(){if(this.lifting){this.lifting=false;return true;}if(this.height>.01||this.charge<25)return false;this.lifting=true;return true;}
  update(dt,blocked){
    dt=Math.max(0,Math.min(dt,.1));this.landingBlocked=false;this.touchdown=Math.max(0,this.touchdown-dt*2.5);
    if(this.lifting){this.charge=Math.max(0,this.charge-dt*17);if(!this.charge)this.lifting=false;}
    if(this.lifting||this.height>0){
      let target=this.lifting?Math.min(4,(12-this.height)*2): -Math.min(3,.35+this.height*1.6);
      if(!this.lifting&&blocked&&this.height<=5.3){target=0;this.landingBlocked=true;}
      this.velocity+=(target-this.velocity)*(1-Math.exp(-dt*(this.lifting?4:8)));
      let next=Math.max(0,Math.min(12,this.height+this.velocity*dt));
      if(blocked&&!this.lifting&&next<4.6){next=this.height;this.velocity=0;this.landingBlocked=true;}
      if(next<.025&&!this.lifting&&!blocked){next=0;this.velocity=0;this.touchdown=1;}
      this.height=next;
    }else {this.velocity=0;this.charge=Math.min(100,this.charge+dt*7);}
    const power=this.lifting?1:this.height>0?.45:0;
    this.thrust+=(power-this.thrust)*(1-Math.exp(-dt*8));
    return this.height;
  }
}
