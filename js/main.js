// js/main.js — Slop Harare: a procedural Harare CBD from OpenStreetMap, in three.js
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DATA } from './harare-data.js';
import { buildWorld } from './world.js';
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
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); // MSAA lives in the composer target
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
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
  const addLabel = (n, x, y, z) => {
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

  const controls = new Controls(camera, renderer.domElement, scene, buildings.blocked);
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
  const warm = new THREE.Color('#ffb070'), noon = new THREE.Color('#fff6e8');
  const fogDay = new THREE.Color('#b8c4d0'), fogDusk = new THREE.Color('#d39a6a'), fogNight = new THREE.Color('#1a2030');

  function applyTime() {
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

    sun.intensity = 3.8 * day * Math.min(1, el * 6 + 0.2);
    sun.color.copy(noon).lerp(warm, golden);
    hemi.intensity = 0.9 + 0.15 * day;
    hemi.color.set('#d6e2f5').lerp(new THREE.Color('#7088c8'), nightness);
    hemi.groundColor.set('#9a7652').lerp(new THREE.Color('#3a3430'), nightness);
    renderer.toneMappingExposure = 0.6 + nightness * 0.35;
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

    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene);
    scene.environment = nightness > 0.9 ? null : envRT.texture;
    scene.environmentIntensity = 0.3 * day + 0.03;
  }
  timeInput.addEventListener('input', () => {
    hour = parseFloat(timeInput.value);
    applyTime();
  });
  applyTime();

  // --- HUD -------------------------------------------------------------------------------------------------------------
  const help = document.getElementById('help');
  const HELP = {
    fly: 'Drag to pan · right-drag to orbit · scroll to zoom · WASD to glide · L labels · T advance time · P quality',
    walk: 'Drag to look · WASD walk · Shift run · Space jump · V camera',
    drive: 'W/S accelerate & reverse · A/D steer · Space brake · keep left!',
  };
  const buttons = [...document.querySelectorAll('.modes button')];
  const setMode = (m) => {
    controls.setMode(m);
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    help.textContent = HELP[m];
    labels.visible = m === 'fly' && labelsOn;
    labelRenderer.domElement.style.display = labels.visible ? '' : 'none';
  };
  let labelsOn = true;
  buttons.forEach((b) => b.addEventListener('click', (e) => {
    setMode(b.dataset.mode);
    e.currentTarget.blur();
  }));
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
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
  setMode('fly');

  // Feature modules get one shared context. Fields are stable API for js/features/*.
  const ctx = {
    THREE, DATA, scene, camera, renderer, post, sun, sky, clouds,
    world, buildings, trees, traffic, people, controls, labels,
    setMode,
    getMode: () => controls.mode,
    getHour: () => hour,
    setHour(h) {
      hour = ((h % 24) + 24) % 24;
      timeInput.value = hour;
      applyTime();
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
  let userQuality = false;
  addEventListener('keydown', (e) => e.code === 'KeyP' && (userQuality = true));
  function frame() {
    const dt = timer.getDelta();
    controls.update(dt, nightness);
    traffic.update(dt, nightness);
    people.update(dt);
    for (const f of features) f.update?.(dt, ctx);
    clouds.update(dt, camera);
    sky.position.copy(camera.position); // the sky box travels with you
    trees.update(dt, camera);

    // Drop ambient occlusion automatically if the machine can't keep up
    if (timer.elapsedTime > 6) frameTimes.push(dt); // ignore the post-load warm-up
    if (frameTimes.length > 90) {
      frameTimes.shift();
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      if (avg > 1 / 38 && post.quality > 1 && !userQuality) post.setQuality(1), showQuality(), (frameTimes.length = 0);
    }

    // Shadow frustum follows what you're looking at
    const p = controls.position;
    // Snap focus and span to steps so shadows don't shimmer as the camera moves
    const focus = new THREE.Vector3(Math.round(p.x / 8) * 8, 0, Math.round(p.z / 8) * 8);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 1200);
    const span = controls.mode === 'fly' ? Math.round(Math.min(700, Math.max(200, camera.position.distanceTo(focus))) / 100) * 100 : 200;
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
    if (labels.visible) labelRenderer.render(scene, camera);
  }
  frame();
  renderer.setAnimationLoop(frame);
  document.getElementById('loading').classList.add('done');
}

init().catch((e) => {
  console.error(e);
  status.textContent = 'Something went wrong: ' + e.message;
});
