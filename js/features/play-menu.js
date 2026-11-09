// Keep movement and the current objective visible; put optional controls in one light-dismiss menu.
export default {
 init(ctx) {
  const style=document.createElement('style');
  style.textContent=`
   .sound-toggle{position:fixed;top:20px;z-index:20;width:46px;height:46px;border:1px solid #ffffff40;border-radius:12px;background:#172522;color:#fff;display:grid;place-items:center;padding:0;cursor:pointer}.sound-toggle:focus-visible{outline:2px solid white;outline-offset:2px}
   .play-menu-trigger{position:fixed;right:20px;top:20px;z-index:20;border:1px solid #ffffff40;border-radius:12px;background:#172522;color:#fff;padding:13px 20px;font:600 14px system-ui;cursor:pointer}
   #play-menu{position:fixed;inset:76px 20px auto auto;margin:0;width:min(360px,calc(100vw - 40px));max-height:calc(100dvh - 100px);overflow:auto;box-sizing:border-box;padding:22px;background:#14211ff5;color:#edf5ee;border:1px solid #ffffff30;border-radius:18px;font:14px/1.5 system-ui;box-shadow:0 16px 60px #0008}
   #play-menu h2{margin:0 0 6px;font-size:23px}#play-menu p{color:#b9c9c1;margin:5px 0 16px}
   #play-menu label{display:block;font-weight:650;margin:15px 0 6px}#play-menu select{width:100%;padding:11px;border-radius:8px;background:#293b35;color:#fff;border:1px solid #7c9388;font:inherit}
   #play-menu details{border-top:1px solid #ffffff22;margin-top:18px;padding-top:14px}#play-menu summary{cursor:pointer;font-weight:650;padding:5px 0}
   #play-menu .toolbar{display:flex;flex-wrap:wrap;position:static;margin-top:10px;padding:8px;box-shadow:none;background:transparent}#play-menu .toolbar-divider{display:none}#play-menu .time-presets{flex-wrap:wrap}
   #play-menu .shortcut-grid{display:grid;grid-template-columns:1fr auto;gap:9px;margin:12px 0}#play-menu kbd{font:12px monospace;color:#f5d453}
   #play-menu button:focus-visible,#play-menu select:focus-visible,#play-menu summary:focus-visible{outline:2px solid #f5d453;outline-offset:3px}
   body[data-play-mode="walk"] .garage,body[data-play-mode="fly"] .garage{display:none}
   .hud-tr{display:none}.shift-launch{top:88px}.garage{top:88px!important}
   @media(max-width:700px){.play-menu-trigger{right:10px;top:15px;padding:10px 14px}.sound-toggle{top:15px;width:38px;height:38px}.garage{top:76px!important;bottom:auto!important}.hud-bc{max-width:calc(100vw - 20px)}#help{max-width:90vw;font-size:11px}}
  `;document.head.appendChild(style);
  const trigger=document.createElement('button');trigger.className='play-menu-trigger';trigger.textContent='Character & options';trigger.setAttribute('popovertarget','play-menu');
  const menu=document.createElement('section');menu.id='play-menu';menu.setAttribute('popover','auto');menu.setAttribute('aria-label','Character and game options');
  menu.innerHTML=`<h2>Make it your city</h2><p>Choose your character. Both can walk, run and fly.</p><label for="hero-choice">Your character</label><select id="hero-choice"><option value="male">Male · city suit</option><option value="female">Female · patterned dress</option></select><label for="outfit-choice">Outfit</label><select id="outfit-choice"><option value="viltrumite">Hero flight suit</option><option value="street">Street clothes</option></select><p id="hero-status" role="status">Both characters can fly.</p><details><summary>How to play</summary><div class="shortcut-grid"><span>Move / steer</span><kbd>W A S D</kbd><span>Run / fly faster</span><kbd>Shift</kbd><span>Look around</span><kbd>Click, then mouse</kbd><span>Jump / rise / brake</span><kbd>Space</kbd><span>Descend in flight</span><kbd>C</kbd><span>Fly / Walk / Drive</span><kbd>1 / 2 / 3</kbd><span>Enter or leave the taxi · mission action</span><kbd>R</kbd><span>Hoot</span><kbd>H</kbd><span>Change camera</span><kbd>V</kbd><span>Street map</span><kbd>M</kbd><span>Time of day</span><kbd>T</kbd><span>Sound on / off</span><kbd>N</kbd><span>Graphics quality</span><kbd>P</kbd><span>Hide the HUD</span><kbd>U</kbd></div><p>Click the city to look around with the mouse; Esc gives the cursor back. On a touch screen, drag to look. Start a taxi shift to pick up passengers at the yellow stop.</p></details><details><summary>Time, map & world</summary><div id="world-controls"></div></details>`;
  // Speaker toggle beside the menu button: the game starts silent, this (or N) turns the city's sound on
  const sound=document.createElement('button');sound.className='sound-toggle';sound.type='button';
  const paintSound=()=>{const on=window.__harareAudio&&!window.__harareAudio.muted;sound.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>${on?'<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>':'<path d="M16 9.5l5 5M21 9.5l-5 5"/>'}</svg>`;sound.title=on?'Sound on (N to mute)':'Sound off (N to turn on)';sound.setAttribute('aria-label',on?'Mute sound':'Turn sound on');sound.setAttribute('aria-pressed',String(on));};
  sound.onclick=()=>{window.__harareAudio?.toggle();sound.blur();};
  addEventListener('harare:audiomute',paintSound);
  document.body.append(trigger,sound,menu);
  const placeSound=()=>{sound.style.right=(innerWidth-trigger.getBoundingClientRect().left+8)+'px';};
  placeSound();paintSound();addEventListener("resize",placeSound);document.fonts?.ready.then(placeSound);
  menu.querySelector('#world-controls').appendChild(document.getElementById('toolbar'));
  const choice=menu.querySelector('#hero-choice'),status=menu.querySelector('#hero-status');
  const outfit=menu.querySelector('#outfit-choice');outfit.value=ctx.controls.player.outfit;outfit.onchange=()=>ctx.controls.player.setOutfit(outfit.value);
  choice.onchange=async()=>{
   choice.disabled=true;status.textContent='Loading your character…';
   try{await ctx.controls.player.setCharacter(choice.value);status.textContent='Ready. Close this menu to explore.';}
   catch(error){choice.value=ctx.controls.player.character;status.textContent='Could not load that character. Your current character is still available.';console.warn(error);}
   finally{choice.disabled=false;}
  };
  menu.addEventListener('toggle',()=>{ctx.controls.keys?.clear?.();});
  // Start with the world visible. The shift introduction remains one click away.
  const dismiss=document.querySelector('.shift-dismiss');dismiss?.click();
  this.welcome(ctx);
  document.querySelector('.shift-launch').textContent='Start taxi mission';
  ctx.setMode('walk');
  this.ctx=ctx;this.update();
 },
 update(){document.body.dataset.playMode=this.ctx.controls.mode;},
 // First visit: one card that says what this is and offers three ways in. Afterwards (and on later visits) a hint
 // teaches the one thing nobody guesses: the camera only follows the mouse after you click the city.
 welcome(ctx){
  const style=document.createElement('style');
  style.textContent=`.welcome{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;width:min(440px,calc(100vw - 32px));box-sizing:border-box;padding:26px;background:#14211ff7;color:#edf5ee;border:1px solid #ffffff30;border-radius:18px;font:14px/1.5 system-ui;box-shadow:0 20px 70px #000a;text-align:center}
.welcome small{color:#f5d453;letter-spacing:1.5px;font-size:10px;font-weight:700}.welcome h2{margin:8px 0 6px;font-size:24px}.welcome p{margin:0 0 18px;color:#b9c9c1}
.welcome .ways{display:grid;gap:9px}.welcome button{padding:12px;border-radius:10px;border:1px solid #ffffff38;background:#273d36;color:#fff;font:600 14px system-ui;cursor:pointer}
.welcome button.primary{background:#f5d453;color:#18201c;border-color:#f5d453}.welcome button:focus-visible{outline:2px solid #fff;outline-offset:3px}
.welcome .keys{margin:16px 0 0;font-size:12px;color:#8fa59b}
.look-hint{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:9;padding:12px 20px;border-radius:999px;background:#0d1513cc;color:#fff;font:600 15px system-ui;pointer-events:none;box-shadow:0 8px 30px #0006;animation:look-pulse 2.4s ease-in-out infinite}
.look-hint[hidden],.welcome[hidden]{display:none}body.ui-hidden .look-hint{display:none}
@keyframes look-pulse{50%{opacity:.72}}@media(prefers-reduced-motion:reduce){.look-hint{animation:none}}`;
  document.head.appendChild(style);
  const touch=matchMedia('(pointer: coarse)').matches;
  const hint=document.createElement('div');hint.className='look-hint';hint.hidden=true;hint.setAttribute('role','status');
  hint.textContent=touch?'Drag to look around · use the stick to move':'Click the city to look around';
  document.body.appendChild(hint);
  let looked=false;
  const done=()=>{looked=true;hint.hidden=true;};
  document.addEventListener('pointerlockchange',()=>document.pointerLockElement&&done());
  if(touch)ctx.renderer.domElement.addEventListener('pointermove',e=>e.buttons&&done());
  const showHint=()=>{if(!looked)hint.hidden=false;};
  let seen=false;try{seen=localStorage.getItem('harare-welcomed')==='1';}catch{}
  if(seen)return showHint();
  const card=document.createElement('section');card.className='welcome';card.setAttribute('role','dialog');card.setAttribute('aria-labelledby','welcome-title');
  card.innerHTML=`<small>HARARE CBD · BUILT FROM OPENSTREETMAP</small><h2 id="welcome-title">Welcome to the Sunshine City</h2><p>Walk the streets, drive a kombi through them, or fly over the rooftops.</p><div class="ways"><button type="button" class="primary" data-go="explore">Just explore</button><button type="button" data-go="shift">Drive a kombi shift</button><button type="button" data-go="supply">Fly a supply drop</button></div><p class="keys">${touch?'Stick to move · drag to look · Fly / Walk / Drive buttons below':'WASD move · click the city to look around · 1 / 2 / 3 fly, walk, drive'}</p>`;
  document.body.appendChild(card);
  const close=(go)=>{
   if(card.hidden)return;card.hidden=true;try{localStorage.setItem('harare-welcomed','1');}catch{}
   removeEventListener('keydown',onKey,true);
   if(go==='shift')document.querySelector('.shift-launch')?.click();
   else if(go==='supply')document.querySelector('.supply-launch')?.click();
   showHint();
  };
  card.addEventListener('click',e=>{const b=e.target.closest('button');if(b)close(b.dataset.go);});
  // Players who just start pressing keys are exploring: get out of their way
  const onKey=e=>{if(e.target.closest?.('.welcome')&&/Enter|Space|Tab/.test(e.code))return;if(/Key[WASD]|Arrow|Digit[123]|Escape/.test(e.code))close('explore');};
  addEventListener('keydown',onKey,true);
  card.querySelector('.primary').focus({preventScroll:true});
 }
};
