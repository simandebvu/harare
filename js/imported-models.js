// Local, licensed hero assets. The city keeps its lightweight crowd/traffic meshes.
import * as THREE from 'three';
import { gltfLoader } from './gltf-loader.js';
import { createCostume } from './hero-costume.js';

const loader = gltfLoader;
const assetURL = (name) => new URL(`../assets/models/${name}`, import.meta.url).href;

function prepare(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = true;
    // Skinned bounds change while jumping; only the hero uses this path.
    if (object.isSkinnedMesh) object.frustumCulled = false;
  });
}

export async function loadPlayerModel(character = 'male') {
  if (!['male', 'female'].includes(character)) throw new Error('Unknown character');
  const gltf = await loader.loadAsync(assetURL(`african-${character}.glb`));
  const root = new THREE.Group();
  root.name = `Skyweaver-${character}`;
  root.add(gltf.scene);
  prepare(gltf.scene);
  // The avatar export left the hands on a flat brick-red placeholder; match them to the face instead.
  gltf.scene.traverse(o => {
    if (o.isMesh && o.material.name === 'Wolf3D_Body') { o.material.map = null; o.material.color.set('#6e4030'); o.material.needsUpdate = true; }
  });
  // Cutout hair and clothing need depth writes; blended sorting exposed the back of the head.
  if (character === 'female') gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      m.transparent = false; m.alphaTest = 0.45; m.depthWrite = true; m.needsUpdate = true;
    }
  });
  const costume = createCostume(gltf.scene, root, character);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const required = { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Sprint_Loop', jump: 'Jump_Loop', hover: 'Hover_Loop', flight: 'Flight_Loop', brace: 'Brace_Loop', takeoff: 'Takeoff', touchdown: 'Touchdown' };
  const actions = {};
  for (const [state, name] of Object.entries(required)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`Player asset is missing ${name}`);
    actions[state] = mixer.clipAction(clip).setEffectiveWeight(state === 'idle' ? 1 : 0).play();
  }
  actions.jump.setLoop(THREE.LoopOnce,1);actions.jump.clampWhenFinished=true;
  actions.takeoff.setEffectiveTimeScale(0);actions.touchdown.setEffectiveTimeScale(0);
  let wasAirborne=false;
  let climbTilt = 0, moving = 0, running = 0, jumping = 0, gaitPhase=0, flightBlend=0, cruise=0, bank=0, clock=0, brace=0, sequenceWeight=0, lastSequence='takeoff';
  return {
    root,
    get gait() { return gaitPhase; },
    setOutfit: (name) => costume.set(name),
    update(dt, x, y, z, yaw, speed, airborne, lean, powered=false, flightAction=null) {
      // Smooth clip weights; leaving the ground does not snap back to an idle pose.
      const k = 1 - Math.exp(-12 * dt);
      clock+=dt;
      const stage=flightAction?.phase;
      const launching=powered&&(stage==='charge'||stage==='launch');
      const landing=powered&&stage==='impact';
      const inSequence=launching||landing;
      flightBlend+=((powered&&!landing&&stage!=='charge'?1:0)-flightBlend)*(1-Math.exp(-dt*5));
      cruise+=((powered&&!inSequence&&!flightAction?.landing?THREE.MathUtils.smoothstep(speed,4,30):0)-cruise)*(1-Math.exp(-dt*4));
      if(airborne&&!wasAirborne){actions.jump.reset().setEffectiveWeight(1).play();}
      wasAirborne=airborne;
      if(inSequence)lastSequence=landing?'touchdown':'takeoff';
      sequenceWeight=inSequence?1:Math.max(0,sequenceWeight-dt*8);
      brace=landing?1:stage==='charge'?THREE.MathUtils.smoothstep(flightAction.time,0,.4):0;
      moving += ((!powered && speed > 0.08 ? 1 : 0) - moving) * k;
      running += (THREE.MathUtils.smoothstep(speed, 2.2, 4.2) - running) * k;
      jumping += ((airborne ? 1 : 0) - jumping) * k;
      actions.idle.setEffectiveWeight((1 - moving) * (1 - jumping)*(1-flightBlend));
      actions.walk.setEffectiveWeight(moving * (1 - running) * (1 - jumping)*(1-flightBlend));
      actions.run.setEffectiveWeight(moving * running * (1 - jumping)*(1-flightBlend));
      actions.jump.setEffectiveWeight(jumping*(1-flightBlend));
      actions.hover.setEffectiveWeight(flightBlend*(1-cruise));
      actions.flight.setEffectiveWeight(flightBlend*cruise);
      actions.hover.setEffectiveTimeScale(.8);
      actions.flight.setEffectiveTimeScale(.75);
      for(const name of ['idle','walk','run','jump','hover','flight'])actions[name].setEffectiveWeight(actions[name].getEffectiveWeight()*(1-sequenceWeight));
      actions.brace.setEffectiveWeight(0);
      // Advance cinematic clips from the same clock as the actual launch/impact physics.
      actions.takeoff.setEffectiveWeight(launching?sequenceWeight:0);
      actions.touchdown.setEffectiveWeight(landing?sequenceWeight:0);
      if(!inSequence && sequenceWeight>0){const finish=lastSequence==='touchdown'?actions.idle:actions.hover;finish.setEffectiveWeight(finish.getEffectiveWeight()+sequenceWeight);}
      if(launching)actions.takeoff.time=Math.min(1,(stage==='charge'?flightAction.time:.55+flightAction.time)/1.2)*actions.takeoff.getClip().duration;
      if(landing)actions.touchdown.time=Math.min(1,flightAction.time/.72)*actions.touchdown.getClip().duration;
      actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 1.5, 0.5, 2));
      actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 4.2, 0.65, 1.6));
      // Keep both locomotion clips at the same footfall phase during crossfades.
      // Independently advancing loops previously blended opposing legs into a wobble.
      // Metres per gait cycle: the sprint clip covers ~6 m natively, so 5 m at RUN_V plays it at ~0.83x with little foot slip
      gaitPhase=(gaitPhase+Math.min(dt,.1)*speed/THREE.MathUtils.lerp(1.55,5.0,running))%1;
      actions.walk.time=gaitPhase*actions.walk.getClip().duration;
      actions.run.time=gaitPhase*actions.run.getClip().duration;
      actions.walk.setEffectiveTimeScale(0);actions.run.setEffectiveTimeScale(0);
      mixer.update(Math.min(dt, 0.1));

      bank+=((powered?-lean:0)-bank)*(1-Math.exp(-dt*5));
      // Upright hover blends into a forward glide, with a gentle breathing motion at rest.
      // Lie along the flight path: upright for a straight climb, head-down in a dive
      climbTilt+=((powered?flightAction?.climb||0:0)-climbTilt)*(1-Math.exp(-dt*4));
      gltf.scene.rotation.x=cruise*(1.08-0.68*climbTilt)*(1-brace);
      gltf.scene.position.y=flightBlend*(.10+Math.sin(clock*2.5)*.025*(1-cruise))*(1-brace);
      root.position.set(x, y, z);
      root.rotation.set(0, yaw, 0);
      gltf.scene.rotation.z = powered ? bank : -lean * 0.35;
      costume.update(dt);
    },
  };
}

export async function loadKombiModel() {
  const { scene: root } = await loader.loadAsync(assetURL('hiace.glb'));
  root.name = 'imported-hiace';
  prepare(root);
  const wheels = [];
  const headlamps = [], taillamps = [];
  root.traverse((object) => {
    if (object.name.startsWith('wheel_')) wheels.push({ object, rest: object.rotation.clone(), front: object.name.includes('front') });
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material.name === 'Headlamps' && !headlamps.includes(material)) {
        material.emissive.set('#fff0c4'); material.emissiveIntensity = 0; headlamps.push(material);
      }
      if (material.name === 'Taillamps' && !taillamps.includes(material)) {
        material.emissive.set('#ff1606'); material.emissiveIntensity = 0; taillamps.push(material);
      }
    }
  });
  let spin = 0;
  return {
    root,
    update(dt, head, brake, speed = 0, steer = 0) {
      spin = (spin + speed * dt / 0.3814) % (Math.PI * 2);
      for (const { object, rest, front } of wheels) {
        object.rotation.set(rest.x + spin, rest.y + (front ? steer : 0), rest.z, 'YXZ');
      }
      for (const m of headlamps) m.emissiveIntensity = head * 2;
      for (const m of taillamps) m.emissiveIntensity = head * 0.35 + brake * 2.5;
    },
  };
}
