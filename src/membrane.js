// Generic tension-only membrane under hydrostatic load (no DOM).
//
// Same physics as ColumnSim, but for arbitrary placement in the world:
// tubes along any axis (columns, base tubes, wall cylinders) and sheets
// (soffit panels loaded by the slab poured on top of them).
//
// Units: metres. y is up. Pressure expressed as "head" in metres of concrete.

import { RHO_CONCRETE, G } from './sim.js';
export { RHO_CONCRETE, G };

export class Membrane {
  /**
   * @param {object} o
   *  nu, nv            grid size (nodes); `wrap` joins column nu-1 to 0 (tube)
   *  flat(i, j)        -> [x, s] flat pattern coordinate of node (i may be nu when wrap)
   *  init(i, j)        -> [x, y, z] initial position
   *  pin(i, j)         -> bool
   *  head(y)           -> metres of concrete head acting on the fabric at height y
   *  outward(p)        -> vector along which pressure should push at point p (sign check)
   *  guide             -> {axis:'y'|'x'|'z', dims:['x','z']} keep rows centred (optional)
   *  fabricWeight      kg/m2
   *  iterations
   */
  constructor(o) {
    Object.assign(this, { iterations: 8, fabricWeight: 0.4, guide: null }, o);
    const { nu, nv, wrap } = this;
    const n = nu * nv;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.force = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.pressure = new Float32Array(n);
    const id = (i, j) => j * nu + (wrap ? i % nu : i);
    this.id = id;

    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = id(i, j) * 3;
      const p = o.init(i, j);
      this.pos[k] = p[0]; this.pos[k + 1] = p[1]; this.pos[k + 2] = p[2];
      if (o.pin(i, j)) this.pinned[id(i, j)] = 1;
    }
    this.prev.set(this.pos);

    const fd = (i1, j1, i2, j2) => {
      const a = o.flat(i1, j1), b = o.flat(i2, j2);
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    const iMax = wrap ? nu : nu - 1;
    const cons = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < (wrap ? nu : nu); i++) {
      if (i < iMax) cons.push(id(i, j), id(i + 1, j), fd(i, j, i + 1, j), 1);
      if (j < nv - 1) {
        cons.push(id(i, j), id(i, j + 1), fd(i, j, i, j + 1), 1);
        if (i < iMax) {
          cons.push(id(i, j), id(i + 1, j + 1), fd(i, j, i + 1, j + 1) * 1.04, 0.5);
          cons.push(id(i + 1, j), id(i, j + 1), fd(i + 1, j, i, j + 1) * 1.04, 0.5);
        }
      }
    }
    const m = cons.length / 4;
    this.cA = new Uint32Array(m); this.cB = new Uint32Array(m);
    this.cL = new Float32Array(m); this.cW = new Float32Array(m);
    for (let c = 0; c < m; c++) {
      this.cA[c] = cons[4 * c]; this.cB[c] = cons[4 * c + 1];
      this.cL[c] = cons[4 * c + 2]; this.cW[c] = cons[4 * c + 3];
    }

    const tris = [];
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < iMax; i++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
      tris.push(a, c, b, b, c, d);
    }
    this.tris = new Uint32Array(tris);

    // orient: pressure must push along outward(p)
    this.sign = 1;
    const t = Math.floor(this.tris.length / 6) * 3;
    const [a, b, c] = [this.tris[t] * 3, this.tris[t + 1] * 3, this.tris[t + 2] * 3];
    const P = this.pos;
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const ctr = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    const out = o.outward(ctr);
    if (nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0) this.sign = -1;

    this.iter = 0;
    this.residual = Infinity;
    this.headMax = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) this.headMax = Math.max(this.headMax, o.head(this.pos[id(i, j) * 3 + 1]));
  }

  step(substeps = 6) {
    const { pos, prev, force, pinned, tris } = this;
    const n = pinned.length;
    // normalise the load by the current maximum head so the step size stays
    // bounded when the load grows (e.g. a panel sagging under the slab)
    let hNow = 0;
    for (let i = 1; i < pos.length; i += 3) hNow = Math.max(hNow, this.head(pos[i]));
    const gain = (0.35 / Math.max(hNow, this.headMax, 0.2)) * this.sign;
    const gw = (this.fabricWeight / RHO_CONCRETE) * 40 * Math.abs(gain) / 6;
    const damping = 0.9;
    for (let s = 0; s < substeps; s++) {
      force.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const wgt = Math.sqrt(nx * nx + ny * ny + nz * nz) * gw;
        force[a + 1] -= wgt; force[b + 1] -= wgt; force[c + 1] -= wgt;
        const h = this.head((pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3);
        if (h <= 0) continue;
        const f = (h * gain) / 6;
        nx *= f; ny *= f; nz *= f;
        force[a] += nx; force[a + 1] += ny; force[a + 2] += nz;
        force[b] += nx; force[b + 1] += ny; force[b + 2] += nz;
        force[c] += nx; force[c + 1] += ny; force[c + 2] += nz;
      }
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const k = i * 3;
        for (let d = 0; d < 3; d++) {
          const x = pos[k + d];
          const v = (x - prev[k + d]) * damping;
          prev[k + d] = x;
          pos[k + d] = x + v + force[k + d];
        }
      }
      for (let it = 0; it < this.iterations; it++) this.project();
    }
    let moved = 0;
    for (let i = 0; i < n * 3; i++) moved += Math.abs(pos[i] - prev[i]);
    this.residual = moved / n;
    this.iter++;
    for (let i = 0; i < n; i++) this.pressure[i] = (RHO_CONCRETE * G * this.head(pos[i * 3 + 1])) / 1000;
    return this.residual;
  }

  project() {
    const { pos, pinned, cA, cB, cL, cW } = this;
    for (let c = 0; c < cL.length; c++) {
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const L = cL[c];
      if (d <= L || d === 0) continue;
      const wa = pinned[cA[c]] ? 0 : 1, wb = pinned[cB[c]] ? 0 : 1;
      const ws = wa + wb;
      if (!ws) continue;
      const corr = ((d - L) / d) * cW[c] / ws;
      pos[a] += dx * corr * wa; pos[a + 1] += dy * corr * wa; pos[a + 2] += dz * corr * wa;
      pos[b] -= dx * corr * wb; pos[b + 1] -= dy * corr * wb; pos[b + 2] -= dz * corr * wb;
    }
    if (this.guide) {
      const { nu, nv } = this;
      const dims = this.guide.dims.map((d) => ({ x: 0, y: 1, z: 2 })[d]);
      const target = this.guide.center; // fixed values for each guided dim
      for (let j = 1; j < nv - 1; j++) {
        const sum = [0, 0, 0];
        for (let i = 0; i < nu; i++) { const k = (j * nu + i) * 3; for (const d of dims) sum[d] += pos[k + d]; }
        for (let q = 0; q < dims.length; q++) {
          const d = dims[q], off = sum[d] / nu - target[q];
          for (let i = 0; i < nu; i++) pos[(j * nu + i) * 3 + d] -= off;
        }
      }
    }
    for (let i = 1; i < pos.length; i += 3) if (pos[i] < 0) pos[i] = 0;
  }

  maxStrain() {
    const { pos, cA, cB, cL, cW } = this;
    let m = 0;
    for (let c = 0; c < cL.length; c++) {
      if (cW[c] < 1) continue;
      const a = cA[c] * 3, b = cB[c] * 3;
      m = Math.max(m, Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]) / cL[c] - 1);
    }
    return m;
  }
}

// ------------------------------------------------------------------ builders

const ease = (u) => u * u * (3 - 2 * u);

/** Vertical tube centred on (cx, cz), from y=0 to y=top; circumference w(t). */
export function verticalTube({ cx = 0, cz = 0, length, top, width, rBottom, rTop, fill, nu = 40, nv = 48, fabricWeight }) {
  const W = (j) => width(j / (nv - 1));
  const rNat = (j) => W(j) / (2 * Math.PI);
  const slack = Math.max(0, length - top);
  const bow = (2 * top / Math.PI) * Math.sqrt(slack / top);
  return new Membrane({
    nu, nv, wrap: true, fabricWeight,
    flat: (i, j) => [(i / nu - 0.5) * W(j), (j / (nv - 1)) * length],
    init: (i, j) => {
      const t = j / (nv - 1), y = t * top, a = (i / nu) * Math.PI * 2;
      const rEnd = rBottom + (rTop - rBottom) * t;
      const wEnd = Math.exp(-Math.min(t, 1 - t) / 0.06);
      const limp = Math.min(rEnd, rNat(j)) * 0.55 + bow * Math.sin(Math.PI * t);
      const r = j === 0 || j === nv - 1 ? rEnd : Math.min(rNat(j), wEnd * rEnd + (1 - wEnd) * limp);
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    },
    pin: (i, j) => j === 0 || j === nv - 1,
    head: (y) => Math.max(0, fill - y),
    outward: (p) => [p[0] - cx, 0, p[2] - cz],
    guide: { dims: ['x', 'z'], center: [cx, cz] },
  });
}

/** Horizontal tube along x from x0 to x1 at z, end rings of radius rEnd centred at y=rEnd. */
export function horizontalTube({ x0, x1, z = 0, length, circ, rEnd, fill, nu = 32, nv = 32, fabricWeight }) {
  const span = x1 - x0;
  const rNat = circ / (2 * Math.PI);
  return new Membrane({
    nu, nv, wrap: true, fabricWeight,
    flat: (i, j) => [(i / nu - 0.5) * circ, (j / (nv - 1)) * length],
    init: (i, j) => {
      const t = j / (nv - 1), a = (i / nu) * Math.PI * 2;
      const wEnd = Math.exp(-Math.min(t, 1 - t) / 0.08);
      const r = j === 0 || j === nv - 1 ? rEnd : wEnd * rEnd + (1 - wEnd) * rNat * 0.6;
      const yc = Math.max(r, rEnd * wEnd + (1 - wEnd) * r);
      return [x0 + t * span, yc + Math.sin(a) * r, z + Math.cos(a) * r];
    },
    pin: (i, j) => j === 0 || j === nv - 1,
    head: (y) => Math.max(0, fill - y),
    outward: (p) => [0, p[1] - rEnd, p[2] - z],
    guide: { dims: ['z'], center: [z] },
  });
}

/**
 * Square soffit panel spanning between four column necks at height y0.
 * Edges are held on straight cords between the neck tops; the panel is cut
 * (1 + slack) larger so it can sag under the slab concrete poured on it.
 */
export function sagPanel({ cx = 0, cz = 0, span, y0, slack, slabTop, n = 33, fabricWeight }) {
  const L = span * (1 + slack);
  return new Membrane({
    nu: n, nv: n, wrap: false, fabricWeight,
    flat: (i, j) => [(i / (n - 1)) * L, (j / (n - 1)) * L],
    init: (i, j) => [cx + (i / (n - 1) - 0.5) * span, y0, cz + (j / (n - 1) - 0.5) * span],
    pin: (i, j) => i === 0 || j === 0 || i === n - 1 || j === n - 1,
    head: (y) => Math.max(0, slabTop - y),
    outward: () => [0, -1, 0],
  });
}

/** Bottle-shaped column profile (figs. 4–8): broad foot, cone, shoulder, cylindrical neck. */
export function bottleProfile({ foot, body, neck, footZone = 0.12, neckZone = 0.18 }) {
  return (t) => {
    if (t > 1 - neckZone) return neck;
    if (t < footZone) return body + (foot - body) * ease(1 - t / footZone);
    const u = (t - footZone) / (1 - neckZone - footZone);
    // cone that rounds into the shoulder
    return body + (neck - body) * Math.pow(u, 1.6);
  };
}
