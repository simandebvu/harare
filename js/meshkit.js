// js/meshkit.js — tiny indexed-geometry builder: tapered boxes (hexahedra) and three.js geometries, each tagged with
// arbitrary per-vertex attributes (colour, part id, limb id …). Used for people and vehicles.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();

export class MeshKit {
  // attrs: {name: itemSize} for the extra per-vertex attributes every shape must supply
  constructor(attrs = {}) {
    this.pos = [];
    this.nrm = [];
    this.idx = [];
    this.sizes = attrs;
    this.extra = {};
    for (const k in attrs) this.extra[k] = [];
  }

  _push(p, n, attrs) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    for (const k in this.sizes) {
      const v = attrs[k];
      if (Array.isArray(v)) this.extra[k].push(...v);
      else this.extra[k].push(v ?? 0);
    }
  }

  // Flat quad; winding fixed so the normal points away from `centre`
  quad(a, b, c, d, attrs, centre) {
    _a.fromArray(a);
    _n.fromArray(b).sub(_a).cross(_c.fromArray(c).sub(_a)).normalize();
    _m.fromArray(a).add(_b.fromArray(c)).multiplyScalar(0.5);
    if (centre && _n.dot(_m.sub(centre)) < 0) {
      [b, d] = [d, b];
      _n.negate();
    }
    const base = this.pos.length / 3;
    const n = [_n.x, _n.y, _n.z];
    for (const p of [a, b, c, d]) this._push(p, n, attrs);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Hexahedron from 8 corners: bottom ring then top ring, each ordered (-x,-z) (+x,-z) (+x,+z) (-x,+z)
  hex(c, attrs, skip = '') {
    const ctr = new THREE.Vector3();
    for (const p of c) ctr.x += p[0] / 8, ctr.y += p[1] / 8, ctr.z += p[2] / 8;
    const [b0, b1, b2, b3, t0, t1, t2, t3] = c;
    if (!skip.includes('b')) this.quad(b0, b1, b2, b3, attrs, ctr);
    if (!skip.includes('t')) this.quad(t0, t1, t2, t3, attrs, ctr);
    this.quad(b0, b1, t1, t0, attrs, ctr);
    this.quad(b1, b2, t2, t1, attrs, ctr);
    this.quad(b2, b3, t3, t2, attrs, ctr);
    this.quad(b3, b0, t0, t3, attrs, ctr);
    return this;
  }

  // Axis-aligned box centred at (cx, cy, cz)
  box(cx, cy, cz, w, h, d, attrs) {
    return this.taper(cx, cy - h / 2, cz, w, d, w, d, h, attrs);
  }

  // Tapered box standing on y0: bottom wb x db, top wt x dt; o.zt0/zt1 move the top's back/front edges (windscreen rake)
  taper(cx, y0, cz, wb, db, wt, dt, h, attrs, o = {}) {
    const y1 = y0 + h;
    const zb0 = cz - db / 2, zb1 = cz + db / 2;
    const zt0 = cz - dt / 2 + (o.zt0 || 0), zt1 = cz + dt / 2 + (o.zt1 || 0);
    return this.hex([
      [cx - wb / 2, y0, zb0], [cx + wb / 2, y0, zb0], [cx + wb / 2, y0, zb1], [cx - wb / 2, y0, zb1],
      [cx - wt / 2, y1, zt0], [cx + wt / 2, y1, zt0], [cx + wt / 2, y1, zt1], [cx - wt / 2, y1, zt1],
    ], attrs, o.skip || '');
  }

  // Append a three.js geometry (optionally transformed by a Matrix4)
  geo(g, attrs, matrix) {
    g = g.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const base = this.pos.length / 3;
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) this._push([P.getX(i), P.getY(i), P.getZ(i)], [N.getX(i), N.getY(i), N.getZ(i)], attrs);
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    for (const k in this.sizes) g.setAttribute(k, new THREE.Float32BufferAttribute(this.extra[k], this.sizes[k]));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
