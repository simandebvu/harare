export default {
 init(ctx){
  const style=document.createElement('style');style.textContent=`.garage[hidden]{display:none}.garage{position:fixed;right:20px;top:88px;z-index:8;width:250px;padding:15px;box-sizing:border-box;background:#141b19ed;border:1px solid #ffffff24;border-radius:14px;color:#eee;font:12px/1.5 system-ui}.garage strong{display:block;color:#f5d453;font-size:10px;letter-spacing:1.5px;margin-bottom:8px}.garage select{width:100%;background:#28332e;color:white;border:1px solid #65736b;border-radius:7px;padding:9px;font:inherit}.garage p{margin:9px 0 0;color:#bac5be}.garage button{width:100%;padding:9px;border:0;border-radius:7px;background:#f5d453;color:#18201c;font-weight:700;cursor:pointer}.garage button:disabled{opacity:.5;cursor:default}.garage button[hidden]{display:none}.garage meter{width:100%;height:10px}.garage select:focus-visible,.garage button:focus-visible{outline:2px solid white;outline-offset:2px}@media(max-width:700px){.garage{top:auto;bottom:210px;right:10px;width:180px;padding:10px}.garage strong,.garage-info{display:none}.garage-status:empty{display:none}.garage p{font-size:11px;margin-top:6px}}`;
  document.head.appendChild(style);const ui=this.ui=document.createElement('section');ui.className='garage';ui.setAttribute('aria-label','Vehicle selection');
  ui.innerHTML='<strong>CHOOSE YOUR RIDE</strong><select aria-label="Vehicle"><option value="kombi">Toyota HiAce · 8 passengers</option><option value="roadster">Vela X1 · 1 passenger</option></select><p class="garage-info"></p><meter min="0" max="100" aria-label="Flight reserve"></meter><button type="button" hidden>Lift off [F]</button><p class="garage-status" role="status"></p>';
  document.body.appendChild(ui);this.select=ui.querySelector('select');this.button=ui.querySelector('button');this.reserve=ui.querySelector('meter');this.info=ui.querySelector('.garage-info');this.status=ui.querySelector('.garage-status');
  this.select.onchange=()=>{if(!ctx.controls.setVehicle(this.select.value))this.select.value=ctx.controls.vehicleType;ctx.shift?.render();};
  this.button.onclick=()=>ctx.controls.toggleFlight();this.t=0;
 },
 update(dt,ctx){
  if((this.t-=dt)>0)return;this.t=.1;
  const c=ctx.controls,f=c.flight,tesla=c.vehicleType==='roadster',active=ctx.shift?.state.status==='active';
  this.ui.hidden=active&&!tesla; // the ride can't change mid-shift; the roadster keeps its lift button
  this.select.value=c.vehicleType;this.select.disabled=active||Math.abs(c.car.v)>.5||f.height>0;
  this.button.hidden=this.reserve.hidden=!tesla;
  this.reserve.value=f.charge;
  const start=document.querySelector('.shift-start');if(start)start.disabled=f.height>0;
  this.button.textContent=f.lifting?'Land [F]':f.height>0?'Descending…':'Lift off [F]';
  this.button.disabled=c.mode!=='drive'||(!f.lifting&&(f.height>0||f.charge<25));
  this.info.textContent=tesla?'Futuristic electric flight taxi. $12 premium fare. WASD drive · F lift / land.':'Eight seats · $1.50 per passenger. Choose your vehicle before starting a shift.';
  this.status.textContent=tesla?(f.landingBlocked?'Landing blocked — drive toward clear road.':f.height>0?`${f.height.toFixed(1)} m altitude · ${Math.ceil(f.charge)}% thrust reserve`:`${Math.ceil(f.charge)}% thrust reserve · recharges on the ground`):active?'Finish your shift to change vehicles.':Math.abs(c.car.v)>.5?'Stop to change vehicles.':'Ready for your next shift.';
 }
};
