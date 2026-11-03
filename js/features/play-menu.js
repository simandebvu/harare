// Keep movement and the current objective visible; put optional controls in one light-dismiss menu.
export default {
 init(ctx) {
  const style=document.createElement('style');
  style.textContent=`
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
   @media(max-width:700px){.play-menu-trigger{right:10px;top:15px;padding:10px 14px}.garage{top:76px!important;bottom:auto!important}.hud-bc{max-width:calc(100vw - 20px)}#help{max-width:90vw;font-size:11px}}
  `;document.head.appendChild(style);
  const trigger=document.createElement('button');trigger.className='play-menu-trigger';trigger.textContent='Character & options';trigger.setAttribute('popovertarget','play-menu');
  const menu=document.createElement('section');menu.id='play-menu';menu.setAttribute('popover','auto');menu.setAttribute('aria-label','Character and game options');
  menu.innerHTML=`<h2>Make it your city</h2><p>Choose your character. Both can walk, run and fly.</p><label for="hero-choice">Your character</label><select id="hero-choice"><option value="male">Male · city suit</option><option value="female">Female · patterned dress</option></select><p id="hero-status" role="status">Skyweaver powers included with both characters.</p><details><summary>How to play</summary><div class="shortcut-grid"><span>Move / steer</span><kbd>W A S D</kbd><span>Run / fly faster</span><kbd>Shift</kbd><span>Jump / rise / brake</span><kbd>Space</kbd><span>Descend in flight</span><kbd>C</kbd><span>Fly / Walk / Drive</span><kbd>1 / 2 / 3</kbd><span>Change camera</span><kbd>V</kbd><span>Street map</span><kbd>M</kbd></div><p>Drag the scene to look around. Choose Drive to see your taxi options. Start a shift to pick up passengers at the yellow stop.</p></details><details><summary>Time, map & world</summary><div id="world-controls"></div></details>`;
  document.body.append(trigger,menu);
  menu.querySelector('#world-controls').appendChild(document.getElementById('toolbar'));
  const choice=menu.querySelector('select'),status=menu.querySelector('#hero-status');
  choice.onchange=async()=>{
   choice.disabled=true;status.textContent='Loading your character…';
   try{await ctx.controls.player.setCharacter(choice.value);status.textContent='Ready. Close this menu to explore.';}
   catch(error){choice.value=ctx.controls.player.character;status.textContent='Could not load that character. Your current character is still available.';console.warn(error);}
   finally{choice.disabled=false;}
  };
  menu.addEventListener('toggle',()=>{ctx.controls.keys?.clear?.();});
  // Start with the world visible. The shift introduction remains one click away.
  const dismiss=document.querySelector('.shift-dismiss');dismiss?.click();
  document.querySelector('.shift-launch').textContent='Start taxi mission';
  ctx.setMode('walk');
  this.ctx=ctx;this.update();
 },
 update(){document.body.dataset.playMode=this.ctx.controls.mode;}
};
