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
      const e = this.extra[k], n = this.sizes[k];
      if (Array.isArray(v)) for (let i = 0; i < n; i++) e.push(v[i] ?? 0);
      else for (let i = 0; i < n; i++) e.push(v ?? 0);
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

  // Smooth surface through a grid of points P[row][col] ([x, y, z]); normals come from the grid (central differences,
  // one-sided at open edges and at rows listed in o.crease), attributes per CELL via attrs(i, j) so colour boundaries
  // stay crisp. o.closed wraps the columns into a ring; o.capStart / o.capEnd close the first / last row with a fan
  // (attrs from o.capAttrs or the neighbouring cell). Winding is chosen so faces point along the computed normals;
  // o.flip reverses the normals (for rings that run the other way).
  loft(P, attrs, o = {}) {
    const rows = P.length, cols = P[0].length, closed = !!o.closed;
    const crease = new Set(o.crease || []);
    const get = (i, j) => {
      if (closed) j = ((j % cols) + cols) % cols;
      else j = Math.max(0, Math.min(cols - 1, j));
      return P[Math.max(0, Math.min(rows - 1, i))][j];
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const N = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) {
        const dj = sub(get(i, j + 1), get(i, j - 1));
        const up = crease.has(i) || i === rows - 1 ? i : i + 1, dn = crease.has(i) || i === 0 ? i : i - 1;
        let di = sub(get(up, j), get(dn, j));
        if (Math.hypot(...di) < 1e-6) di = sub(get(Math.min(rows - 1, i + 1), j), get(Math.max(0, i - 1), j));
        let n = [dj[1] * di[2] - dj[2] * di[1], dj[2] * di[0] - dj[0] * di[2], dj[0] * di[1] - dj[1] * di[0]];
        const l = Math.hypot(...n) || 1;
        n = n.map((v) => (v / l) * (o.flip ? -1 : 1));
        row.push(n);
      }
      N.push(row);
    }
    if (o.orient !== false && !o.flip) {
      // closed rings: make the normals face away from each ring's centre
      let s = 0;
      for (let i = 0; i < rows; i++) {
        const c = [0, 0, 0];
        for (const p of P[i]) (c[0] += p[0] / cols), (c[1] += p[1] / cols), (c[2] += p[2] / cols);
        for (let j = 0; j < cols; j++) s += N[i][j][0] * (P[i][j][0] - c[0]) + N[i][j][1] * (P[i][j][1] - c[1]) + N[i][j][2] * (P[i][j][2] - c[2]);
      }
      if (s < 0) for (const row of N) for (const n of row) (n[0] = -n[0]), (n[1] = -n[1]), (n[2] = -n[2]);
    }
    const A = typeof attrs === 'function' ? attrs : () => attrs;
    const jn = closed ? cols : cols - 1;
    // normal at grid point (a, b) using only the rows of cell row i (a crease between rows)
    const cellNormal = (a, b, i) => {
      const dj = sub(get(a, b + 1), get(a, b - 1));
      const di = sub(P[i + 1][b], P[i][b]);
      let n = [dj[1] * di[2] - dj[2] * di[1], dj[2] * di[0] - dj[0] * di[2], dj[0] * di[1] - dj[1] * di[0]];
      const l = Math.hypot(...n);
      if (l < 1e-9) return N[a][b];
      n = n.map((v) => v / l);
      const g = N[a][b];
      if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) n = n.map((v) => -v);
      return n;
    };
    if (o.vattrs) {
      // shared vertices, attributes per grid point (skin weights must agree where cells meet)
      const base = this.pos.length / 3;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) this._push(P[i][j], N[i][j], o.vattrs(i, j));
      for (let i = 0; i < rows - 1; i++)
        for (let j = 0; j < jn; j++) {
          const j1 = (j + 1) % cols;
          const a = base + i * cols + j, b = base + i * cols + j1, c = base + (i + 1) * cols + j1, d = base + (i + 1) * cols + j;
          const p0 = P[i][j], p1 = P[i][j1], p3 = P[i + 1][j], p2 = P[i + 1][j1];
          let e1 = sub(p1, p0), e2 = sub(p3, p0);
          if (Math.hypot(...e1) < 1e-9) e1 = sub(p2, p3);
          const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const nn = N[i][j], nm = N[i + 1][j1];
          if (g[0] * (nn[0] + nm[0]) + g[1] * (nn[1] + nm[1]) + g[2] * (nn[2] + nm[2]) >= 0) this.idx.push(a, b, c, a, c, d);
          else this.idx.push(a, c, b, a, d, c);
        }
      const capV = (i) => {
        const ring = P[i], c = [0, 0, 0], oc = [0, 0, 0], other = P[i === 0 ? 1 : rows - 2];
        for (const p of ring) (c[0] += p[0] / cols), (c[1] += p[1] / cols), (c[2] += p[2] / cols);
        for (const p of other) (oc[0] += p[0] / cols), (oc[1] += p[1] / cols), (oc[2] += p[2] / cols);
        let n = sub(c, oc);
        const l = Math.hypot(...n) || 1;
        n = n.map((v) => v / l);
        const ci = this.pos.length / 3;
        this._push(c, n, o.vattrs(i, -1));
        for (let j = 0; j < jn; j++) {
          const a = base + i * cols + j, b = base + i * cols + ((j + 1) % cols);
          const e1 = sub(P[i][(j + 1) % cols], c), e2 = sub(P[i][j], c);
          const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0) this.idx.push(ci, b, a);
          else this.idx.push(ci, a, b);
        }
      };
      if (o.capStart) capV(0);
      if (o.capEnd) capV(rows - 1);
      return this;
    }
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < jn; j++) {
        const j1 = (j + 1) % cols;
        const at = A(i, j);
        if (at === null) continue;
        const base = this.pos.length / 3;
        const cs = [[i, j], [i, j1], [i + 1, j1], [i + 1, j]];
        for (const [a, b] of cs) this._push(P[a][b], crease.has(a) ? cellNormal(a, b, i) : N[a][b], at);
        // pick the winding whose geometric normal agrees with the grid normal
        const p0 = P[i][j], p1 = P[i][j1], p2 = P[i + 1][j1], p3 = P[i + 1][j];
        const e1 = sub(p1, p0), e2 = sub(p3, p0);
        let g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(...g) < 1e-9) {
          const e3 = sub(p2, p1), e4 = sub(p2, p3);
          g = [e3[1] * e4[2] - e3[2] * e4[1], e3[2] * e4[0] - e3[0] * e4[2], e3[0] * e4[1] - e3[1] * e4[0]];
          g = g.map((v) => -v);
        }
        const nn = N[i][j], nm = N[i + 1][j1];
        const dot = g[0] * (nn[0] + nm[0]) + g[1] * (nn[1] + nm[1]) + g[2] * (nn[2] + nm[2]);
        if (dot >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const cap = (i, sign) => {
      const ring = P[i];
      const c = [0, 0, 0];
      for (const p of ring) (c[0] += p[0] / cols), (c[1] += p[1] / cols), (c[2] += p[2] / cols);
      const other = P[i === 0 ? 1 : rows - 2];
      const oc = [0, 0, 0];
      for (const p of other) (oc[0] += p[0] / cols), (oc[1] += p[1] / cols), (oc[2] += p[2] / cols);
      let n = sub(c, oc);
      const l = Math.hypot(...n) || 1;
      n = n.map((v) => v / l);
      const at = o.capAttrs || A(Math.min(i, rows - 2), 0);
      const base = this.pos.length / 3;
      this._push(c, n, at);
      for (const p of ring) this._push(p, n, at);
      for (let j = 0; j < jn; j++) {
        const a = base + 1 + j, b = base + 1 + ((j + 1) % cols);
        const e1 = sub(P[i][(j + 1) % cols], c), e2 = sub(P[i][j], c);
        const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] >= 0) this.idx.push(base, b, a);
        else this.idx.push(base, a, b);
      }
    };
    if (o.capStart) cap(0);
    if (o.capEnd) cap(rows - 1);
    return this;
  }

  // Quad with explicit per-corner uvs (for decals: number plates, route boards). corners a b c d counter-clockwise
  // seen from the front; the kit should have an 'aUv' attribute.
  decal(a, b, c, d, attrs, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    n = n.map((v) => v / l);
    const base = this.pos.length / 3;
    [a, b, c, d].forEach((p, k) => this._push(p, n, { ...attrs, aUv: uv[k] }));
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  get vertexCount() {
    return this.pos.length / 3;
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
