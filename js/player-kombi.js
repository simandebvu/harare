// js/player-kombi.js — the player's own kombi drawn exactly like traffic: the sculpted near-detail model
// (vehicleGeometry('kombi', 1, true)) through the shared clearcoat vehicle material from js/vehicle-render.js (paint,
// plates and route board from the decal atlas, rack luggage, dust, lamp emission from per-instance lamp state), plus
// the traffic renderer's own night glow shader (lamp flares, headlight pool, red wash) on a one-instance geometry.
// A single-instance InstancedMesh with an identity instance matrix, so it can ride inside the controls' lean pivot.
import * as THREE from 'three';
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
    this.mesh = new THREE.InstancedMesh(geo, this.ownMat, 1);
    this.mesh.setMatrixAt(0, new THREE.Matrix4());
    this.mesh.setColorAt(0, new THREE.Color(look.color ?? '#f2f1ec'));
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.name = 'player-kombi';
    this.glow = null;
    this.shared = false;
    this.dims = VEHICLE_TYPES.kombi.lampDims;
  }

  // Adopt the traffic renderer's material (shared program + uniforms, so blink phase and day/night match the street)
  // and borrow its glow shader for our lamps' flares and pools
  attach(traffic) {
    if (this.shared || !traffic?.renderer?.material) return;
    this.shared = true;
    this.mesh.material = traffic.renderer.material;
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
  update(dt, night, head, brake, ind, cab, x, y, z, yaw, visible) {
    this.time += dt;
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
