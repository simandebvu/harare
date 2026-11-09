// js/main.js — Slop Harare: a procedural Harare CBD from OpenStreetMap, in three.js
import * as THREE from 'three';
import { createCollisionWorld } from './collision-world.js';
import { createCrowdModels } from './crowd-models.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DATA } from './harare-data.js';
import { buildWorld } from './world.js';
import { groundY } from './util.js';
import { buildBuildings } from './buildings.js';
import { buildTrees } from './trees.js';
import { createTraffic } from './traffic.js';
import { createPeople } from './people.js';
import { Controls } from './controls.js';
import { createPost } from './post.js';
import { createClouds } from './clouds.js';
import { features } from './features/index.js';

const LAT = -17.83;
const DECLINATION = -11.6; // late October: the sun passes almost straight overhead at noon

const status = document.getElementById('loading-status');
const step = (msg) => {
  status.textContent = msg;
  return new Promise((r) => setTimeout(r, 0));
};

async function init() {
  const app = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // MSAA lives in the composer target
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
  app.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.0, 45000);
  camera.position.set(420, 380, 620);

  // --- sky, sun, fog ------------------------------------------------------------------------------------------------
  const sky = new Sky();
  sky.scale.setScalar(40000); // a box: keep it larger than the suburbs' horizon (camera far is 45 km)
  sky.renderOrder = -2;
  sky.material.uniforms.turbidity.value = 2.4;
  sky.material.uniforms.rayleigh.value = 1.6;
  sky.material.uniforms.mieCoefficient.value = 0.0035;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  scene.add(sky);

  const sun = new THREE.DirectionalLight('#fff4e0', 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -450;
  sun.shadow.camera.right = sun.shadow.camera.top = 450;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2500;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.16;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#d6e2f5', '#9a7652', 1.0);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2('#c8c2b4', 0.00028);
  const clouds = createClouds(scene);
  const post = createPost(renderer, scene, camera);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  let envRT = null;
  const envSun = new THREE.Vector3();

  // --- city ------------------------------------------------------------------------------------------------------------
  await step('laying out streets…');
  const world = buildWorld(scene, DATA, renderer);
  await step(`raising ${DATA.buildings.length} buildings…`);
  const buildings = buildBuildings(scene, DATA, renderer);
  await step('planting jacarandas…');
  const trees = buildTrees(scene, DATA, buildings.blocked);
  await step('starting kombis…');
  const traffic = createTraffic(scene, DATA);
  await step('filling the pavements…');
  const people = createPeople(scene, DATA, buildings.blocked);
  console.log(`[harare] ${DATA.buildings.length} buildings, ${trees.count} trees, ${traffic.cars.length} vehicles, ${traffic.lightCount} robots, ${people.count} people, ${people.stalls} stalls`);

  // Landmark labels
  const labels = new THREE.Group();
  const seen = new Set();
  // OSM spellings and long official names that read badly on screen
  const LABEL_NAMES = { 'Harare Main Post Ofiice': 'Harare Main Post Office', 'Hyatt Regency Harare The Meikles': 'Meikles Hotel' };
  const addLabel = (n, x, y, z) => {
    n = LABEL_NAMES[n] || n;
    if (seen.has(n)) return;
    seen.add(n);
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = n;
    const o = new CSS2DObject(el);
    o.position.set(x, y, z);
    labels.add(o);
  };
  for (const l of buildings.labels) addLabel(l.n.replace(/ Shopping Mall$/, ''), l.x, l.y, l.z);
  for (const a of DATA.areas) if (/Africa Unity Square|Harare Gardens/.test(a.n || '')) {
    let x = 0, z = 0;
    for (let i = 0; i < a.p.length; i += 2) (x += a.p[i]), (z += a.p[i + 1]);
    addLabel(a.n, x / (a.p.length / 2), 12, z / (a.p.length / 2));
  }
  addLabel('The Kopje', -1377, 85, 1593);
  scene.add(labels);
  // Declutter: nearest labels claim screen space first, any later one that overlaps them is hidden
  const _lp = new THREE.Vector3();
  let declutterT = 0;
  const declutterLabels = () => {
    const placed = [];
    const items = labels.children.map((o) => ({ o, d: o.getWorldPosition(_lp).distanceToSquared(camera.position) })).sort((a, b) => a.d - b.d);
    for (const { o } of items) {
      const el = o.element;
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      const hit = placed.some((q) => r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 2 && r.bottom > q.top - 2);
      el.classList.toggle('label-hidden', hit);
      if (!hit) placed.push(r);
    }
  };

  const controls = new Controls(camera, renderer.domElement, scene, buildings.blocked);
  const detailedCrowd=createCrowdModels(scene,people,camera);
  const contacts=createCollisionWorld(traffic,people,controls);
  controls.contacts=contacts;people.setContacts(contacts);traffic.setContacts(contacts);
  // Lot boundary walls, gates and yard containers (js/lots.js) block walkers and cars like any other static
  for (const b of world.lots.solids) contacts.addStaticBox(b.x, b.z, b.yaw, b.hw, b.hl, b.top - groundY(b.x, b.z));
  for (const p of buildings.posts) contacts.addStaticBox(p.x, p.z, p.yaw, p.hw, p.hl, p.h);
  await step('loading the kombi and player…');
  await Promise.all([controls.pk.ready, controls.player.ready, traffic.renderer.ready, detailedCrowd.ready]);
  controls.map.target.set(0, 0, 0);
  controls.map.update();
  // Hook for tools/shot.mjs: place the fly camera precisely
  window.__harare = {
    scene,
    setCamera(x, y, z, tx, ty, tz) {
      setMode('fly');
      camera.position.set(x, y, z);
      controls.map.target.set(tx, ty, tz);
      controls.map.update();
    },
  };

  // --- time of day -----------------------------------------------------------------------------------------------------
  const timeInput = document.getElementById('time');
  const clock = document.getElementById('clock');
  let hour = parseFloat(timeInput.value);
  let nightness = 0;
  const sunDir = new THREE.Vector3();
  const warm = new THREE.Color('#ffc18a'), noon = new THREE.Color('#fff6e8');
  const fogDay = new THREE.Color('#b8c4d0'), fogDusk = new THREE.Color('#d39a6a'), fogNight = new THREE.Color('#1a2030');

  function applyTime(force = false) {
    const H = ((hour - 12.2) * 15 * Math.PI) / 180;
    const lat = (LAT * Math.PI) / 180, dec = (DECLINATION * Math.PI) / 180;
    const east = -Math.cos(dec) * Math.sin(H);
    const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
    const upv = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    sunDir.set(east, upv, -north).normalize();
    const el = sunDir.y;
    nightness = THREE.MathUtils.smoothstep(-el, -0.02, 0.12);
    const day = 1 - nightness;
    const golden = THREE.MathUtils.smoothstep(0.35 - el, 0, 0.3) * day;

    sky.material.uniforms.sunPosition.value.copy(sunDir);
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = sky.material.uniforms[k].value;

    sun.intensity = 3.5 * day * Math.min(1, el * 6 + 0.2);
    sun.color.copy(noon).lerp(warm, golden);
    hemi.intensity = 0.95 + 0.4 * day;
    hemi.color.set('#d6e2f5').lerp(new THREE.Color('#9baed4'), nightness);
    hemi.groundColor.set('#ad9580').lerp(new THREE.Color('#3a3430'), nightness);
    renderer.toneMappingExposure = 0.76 + nightness * 0.14;
    // Dry-season haze: dust and veld-fire smoke thicken the air toward the horizon
    scene.fog.color.copy(fogDay).lerp(fogDusk, golden * 0.7).lerp(fogNight, nightness);
    scene.fog.density = 0.0002 + golden * 0.00008 + nightness * 0.0001;
    scene.background = nightness > 0.98 ? fogNight : null;

    buildings.setNight(nightness);
    world.setNight(nightness);
    post.setNight(nightness);
    clouds.setSun(sunDir, sun.color, nightness);

    const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
    clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    // Re-bake the sky reflection only when the sun has visibly moved (the slider fires dozens of inputs a second), and
    // never swap scene.environment to null: that changes every material's shader and recompiles the whole city
    if (!envRT || force || envSun.angleTo(sunDir) > 0.035) {
      if (envRT) envRT.dispose();
      envRT = pmrem.fromScene(envScene);
      envSun.copy(sunDir);
    }
    scene.environment = envRT.texture;
    scene.environmentIntensity = nightness > 0.9 ? 0 : 0.3 * day + 0.03;
    // No sun, no shadows worth redrawing every frame
    renderer.shadowMap.autoUpdate = sun.intensity > 0.01;
    if (!renderer.shadowMap.autoUpdate) renderer.shadowMap.needsUpdate = true;
  }
  timeInput.addEventListener('input', () => {
    hour = parseFloat(timeInput.value);
    applyTime();
  });
  timeInput.addEventListener('change', () => applyTime(true));
  applyTime();

  // --- HUD -------------------------------------------------------------------------------------------------------------
  const help = document.getElementById('help');
  const HELP = {
    fly: 'Skyweaver · look up or down and press W to climb or dive · Space / E rise · C / Q descend · Shift boost · 2 land · V camera',
    walk: 'Click to mouse-look (Esc frees the cursor) · WASD walk · Shift run · Space jump · V camera',
    drive: 'Click to mouse-look · W/S accelerate & reverse · A/D steer · Space brake · keep left!',
  };
  const buttons = [...document.querySelectorAll('.modes button')];
  const setMode = (m) => {
    if(controls.setMode(m)===false)return;
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    help.textContent = HELP[m];
    const landButton=document.querySelector('[data-mode="walk"] .mode-label');
    if(landButton)landButton.textContent=m==='fly'?'Land':'Walk';
    labels.visible = m === 'fly' && labelsOn;
    labelRenderer.domElement.style.display = labels.visible ? '' : 'none';
  };
  addEventListener('harare:landing',()=>{help.textContent='Landing… · A/D steer · W move to clear ground · 1 cancel';});
  addEventListener('harare:landed',e=>setMode(e.detail));
  let labelsOn = true;
  buttons.forEach((b) => b.addEventListener('click', (e) => {
    setMode(b.dataset.mode);
    e.currentTarget.blur();
  }));
  addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) || e.target.closest?.('[popover]:popover-open')) return;
    if (e.code === 'Digit1') setMode('fly');
    if (e.code === 'Digit2') setMode('walk');
    if (e.code === 'Digit3') setMode('drive');
    if (e.code === 'KeyL') {
      labelsOn = !labelsOn;
      labels.visible = labelsOn && controls.mode === 'fly';
      labelRenderer.domElement.style.display = labels.visible ? '' : 'none';
    }
    if (e.code === 'KeyP') {
      post.setQuality((post.quality + 2) % 3);
      showQuality();
    }
    if (e.code === 'KeyT') {
      hour = (hour + 0.5) % 24;
      timeInput.value = hour;
      applyTime();
    }
  });
  setMode('walk');

  // Feature modules get one shared context. Fields are stable API for js/features/*.
  const ctx = {
    THREE, DATA, scene, camera, renderer, post, sun, sky, clouds, detailedCrowd, contacts,
    world, buildings, trees, traffic, people, controls, labels,
    setMode,
    getMode: () => controls.mode,
    getHour: () => hour,
    setHour(h) {
      hour = ((h % 24) + 24) % 24;
      timeInput.value = hour;
      applyTime(true);
    },
    getNightness: () => nightness,
    getSunDir: () => sunDir,
    streetAt: (x, z) => world.streetAt(x, z),
    teleport: (x, z, yaw) => controls.teleport(x, z, yaw),
  };
  window.__harare.ctx = ctx;
  for (const f of features) await f.init?.(ctx);

  const QUALITY = ['low (no post-processing)', 'medium (bloom + grade)', 'high (+ ambient occlusion)'];
  let toastT = 0;
  const showQuality = () => {
    where.textContent = `Quality: ${QUALITY[post.quality]}`;
    whereT = 1.5;
    toastT = 1.5;
  };
  const where = document.getElementById('where');
  // Mouse-look (js/cameras.js) captures the cursor: say so, and how to get it back
  const toast = document.getElementById('toast');
  let toastHide = 0;
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== renderer.domElement) return;
    toast.textContent = 'Mouse-look on · Esc frees the cursor';
    toast.classList.add('show');
    clearTimeout(toastHide);
    toastHide = setTimeout(() => toast.classList.remove('show'), 2600);
  });
  let whereT = 0;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
  });
  post.setSize(innerWidth, innerHeight);

  // --- loop -------------------------------------------------------------------------------------------------------------
  const timer = new THREE.Clock();
  const frameTimes = [];
  let frameSum = 0;
  let userQuality = false;
  addEventListener('keydown', (e) => e.code === 'KeyP' && (userQuality = true));
  const shadowFocus = new THREE.Vector3(), shadowRight = new THREE.Vector3(), shadowUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  function frame() {
    // A hidden tab stops the loop; the first frame back must not replay the whole absence in one step
    const raw = timer.getDelta(), dt = Math.min(raw, 0.1);
    controls.update(dt, nightness);
    camera.updateMatrixWorld(); // cull people and cars against this frame's view, not last frame's
    traffic.update(dt, nightness);
    contacts.refresh();
    people.update(dt);
    detailedCrowd.update(dt);
    for (const f of features) f.update?.(dt, ctx);
    clouds.update(dt, camera);
    sky.position.copy(camera.position); // the sky box travels with you
    trees.update(dt, camera);

    // Drop ambient occlusion automatically if the machine can't keep up
    if (timer.elapsedTime > 6 && raw < 0.25) frameTimes.push(raw), (frameSum += raw); // ignore warm-up and tab switches
    if (frameTimes.length > 90) {
      frameSum -= frameTimes.shift();
      const avg = frameSum / frameTimes.length;
      if (avg > 1 / 38 && post.quality > 1 && !userQuality) post.setQuality(1), showQuality(), (frameTimes.length = 0), (frameSum = 0);
    }

    // Shadow frustum follows what you're looking at
    const p = controls.position;
    // Snap in the light's image plane: world-axis snapping makes shadows jump when driving.
    const focus = shadowFocus.set(p.x, 0, p.z);
    const span = controls.mode === 'fly' ? Math.round(Math.min(700, Math.max(200, camera.position.distanceTo(focus))) / 100) * 100 : 130;
    shadowRight.crossVectors(sunDir, worldUp).normalize();
    if(shadowRight.lengthSq()<0.01)shadowRight.set(1,0,0);
    shadowUp.crossVectors(shadowRight,sunDir).normalize();
    const texel=span*2/sun.shadow.mapSize.x;
    const sx=focus.dot(shadowRight),sy=focus.dot(shadowUp);
    focus.addScaledVector(shadowRight,Math.round(sx/texel)*texel-sx);
    focus.addScaledVector(shadowUp,Math.round(sy/texel)*texel-sy);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir,1200);
    const sc = sun.shadow.camera;
    if (sc.right !== span) {
      sc.left = sc.bottom = -span;
      sc.right = sc.top = span;
      sc.updateProjectionMatrix();
    }

    if ((toastT -= dt) < 0 && (whereT -= dt) < 0) {
      whereT = 0.4;
      const street = world.streetAt(p.x, p.z);
      where.textContent = street ? `📍 ${street}` : '';
    }

    post.render();
    if (labels.visible) {
      labelRenderer.render(scene, camera);
      if ((declutterT -= dt) < 0) (declutterT = 0.2), declutterLabels();
    }
  }
  frame();
  renderer.setAnimationLoop(frame);
  document.getElementById('loading').classList.add('done');
}

init().catch((e) => {
  console.error(e);
  status.textContent = 'Something went wrong: ' + e.message;
});
