// Downloaded HiAce with the original traffic mesh as a fallback and shared lamp glows.
import * as THREE from 'three';
import { loadKombiModel } from './imported-models.js';
import { vehicleGeometry, VEHICLE_TYPES, ROUTES } from './vehicles.js';
import { vehicleMaterial } from './vehicle-render.js';

const inst = (n) => {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n), n);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
};

export class PlayerKombi {
  // look: { color, plate (atlas cell), opt (1, 2: luggage sets), dirt, route (index into ROUTES or a name) }
  constructor(scene, look = {}) {
    this.scene = scene;
    const route = typeof look.route === 'string' ? Math.max(0, ROUTES.indexOf(look.route)) : look.route ?? 0;
    this.var = [look.plate ?? 17, look.opt ?? 1, look.dirt ?? 0.22, route];
    this.ownMat = vehicleMaterial(); // until the traffic renderer's material (and its clock) is available
    this.time = 0;
    const geo = vehicleGeometry('kombi', 1, true);
    this.iVar = inst(4);
    this.iLamp = inst(4);
    this.iVar.array.set(this.var);
    geo.setAttribute('iVar', this.iVar);
    geo.setAttribute('iLamp', this.iLamp);
    this.fallback = new THREE.InstancedMesh(geo, this.ownMat, 1);
    this.fallback.setMatrixAt(0, new THREE.Matrix4());
    this.fallback.setColorAt(0, new THREE.Color(look.color ?? '#f2f1ec'));
    this.fallback.castShadow = this.fallback.receiveShadow = true;
    this.fallback.name = 'player-kombi-procedural';
    this.mesh = new THREE.Group();
    this.mesh.name = 'player-kombi';
    this.mesh.add(this.fallback);
    this.ready = loadKombiModel().then((model) => {
      this.imported = model;
      this.mesh.add(model.root);
      this.fallback.visible = false;
      this.dims = [0.66, 0.92, 2.20, 0.95, -2.26, 0.85];
      console.log('[harare] imported HiAce ready');
    }).catch((error) => console.warn('[harare] HiAce unavailable; using procedural fallback.', error.message));
    this.glow = null;
    this.shared = false;
    this.dims = VEHICLE_TYPES.kombi.lampDims;
  }

  // Adopt the traffic renderer's material (shared program + uniforms, so blink phase and day/night match the street)
  // and borrow its glow shader for our lamps' flares and pools
  attach(traffic) {
    if (this.shared || !traffic?.renderer?.material) return;
    this.shared = true;
    this.fallback.material = traffic.renderer.material;
    this.ownMat.dispose();
    let src = null;
    this.scene.traverse((o) => {
      if (!src && o.isMesh && o.material?.isShaderMaterial && o.geometry?.attributes?.iDimA && o.geometry.attributes.aKind) src = o;
    });
    if (!src) return;
    const g = new THREE.InstancedBufferGeometry();
    for (const k of ['position', 'aKind', 'aCorner']) g.setAttribute(k, src.geometry.attributes[k]);
    g.setIndex(src.geometry.index);
    this.gAttr = {};
    for (const k of ['iM0', 'iDimA', 'iDimB', 'iLamp']) g.setAttribute(k, (this.gAttr[k] = inst(4)));
    const D = this.dims;
    this.gAttr.iDimA.array.set([D[0], D[1], D[2], D[3]]);
    this.gAttr.iDimB.array.set([D[4], D[5], VEHICLE_TYPES.kombi.width, this.var[0]]);
    g.instanceCount = 1;
    this.glow = new THREE.Mesh(g, src.material);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = src.renderOrder;
    this.glow.visible = false;
    this.glow.name = 'player-kombi-glow';
    this.scene.add(this.glow);
  }

  // head, brake (0..1+), indicator (-1 left, 1 right, 2 hazard), cabin light; pose = world x, y, z, yaw; visible
  update(dt, night, head, brake, ind, cab, x, y, z, yaw, visible, speed = 0, steer = 0) {
    this.time += dt;
    this.imported?.update(dt, head, brake, speed, steer);
    if (!this.shared) {
      this.ownMat.userData.uTime.value = this.time;
      this.ownMat.userData.uDay.value = 0.15 + 0.85 * (1 - night);
    }
    const L = this.iLamp.array;
    if (L[0] !== head || L[1] !== brake || L[2] !== ind || L[3] !== cab) {
      L[0] = head;
      L[1] = brake;
      L[2] = ind;
      L[3] = cab;
      this.iLamp.needsUpdate = true;
    }
    if (!this.glow) return;
    const on = visible && night > 0.02 && (head > 0.01 || brake > 0.01 || ind !== 0);
    this.glow.visible = on;
    if (!on) return;
    this.gAttr.iM0.array.set([x, y, z, yaw]);
    this.gAttr.iM0.needsUpdate = true;
    this.gAttr.iLamp.array.set(L);
    this.gAttr.iLamp.needsUpdate = true;
  }
}
