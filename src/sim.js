// Fabric-formed column simulator — physics core (no DOM).
//
// Model
// -----
// A flat textile pattern (width varies along its length) is stitched into a
// tube along one seam, its bottom edge fixed to a base ring and its top edge
// hung from a top ring. Concrete is poured to a fill level; the wet concrete
// exerts hydrostatic pressure p(y) = rho * g * (fill - y) normal to the fabric.
//
// The fabric is treated as practically inextensible but perfectly flexible:
// every edge is a *tension-only* constraint (it may get shorter — fabric
// wrinkles/slackens — but never longer than its length in the flat pattern).
// Solved with position-based dynamics: pressure pushes, constraints hold.
//
// Restraints that the maker can add with simple stitching:
//   - flutes:  internal tethers sewn from vertical lines of the fabric to a
//              central cord -> the radius on those lines is capped (fig. 37)
//   - rings:   a cord/band sewn around the tube at a height -> radius capped
//
// Units: metres, kg, kPa. y is up.

export const RHO_CONCRETE = 2400; // kg/m3
export const G = 9.81;

export const DEFAULTS = {
  // pattern (flat, before stitching)
  length: 3.0,        // m, pattern length along the column axis
  circBottom: 1.0,    // m, pattern width at bottom edge (= tube circumference)
  circTop: 1.0,       // m, pattern width at top edge
  bulge: 0.0,         // extra width at mid-height, fraction (+ belly / - waist)
  capital: 0.0,       // extra width flaring into the top, fraction
  capitalZone: 0.25,  // fraction of length over which the capital flares
  // erection
  hang: 0.96,         // top ring height as fraction of pattern length (slack < 1)
  topRing: 1.0,       // top ring radius relative to natural radius of top edge
  bottomRing: 1.0,    // base ring radius relative to natural radius of bottom edge
  // stitched restraints
  flutes: 0,          // number of internal tether lines (0 = none)
  fluteDepth: 0.75,   // tether radius as fraction of natural local radius
  rings: [],          // [{at: 0..1 along length, r: fraction of natural radius}]
  // pour
  fill: 1.0,          // fill level as fraction of top ring height
  guided: true,       // keep each row centred on the axis (sleeve over a rebar cage / guide)
  // discretisation
  nu: 72,             // nodes around
  nv: 64,             // nodes along
};

export function widthAt(p, t) {
  // pattern width at normalised position t (0 = bottom edge, 1 = top edge)
  let w = p.circBottom + (p.circTop - p.circBottom) * t;
  w *= 1 + p.bulge * Math.sin(Math.PI * t);
  if (p.capital > 0) {
    const t0 = 1 - p.capitalZone;
    if (t > t0) {
      const u = (t - t0) / p.capitalZone; // 0..1
      w *= 1 + p.capital * u * u;
    }
  }
  return Math.max(w, 0.02);
}

export class ColumnSim {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.build();
  }

  build() {
    const p = this.p;
    const nu = p.nu, nv = p.nv;
    this.nu = nu; this.nv = nv;
    const n = nu * nv;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.force = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.pressure = new Float32Array(n); // kPa, for colouring
    this.taut = new Float32Array(n);     // 0..1 how stretched the fabric is
    this.capR = new Float32Array(n).fill(Infinity); // radius cap from tethers/rings

    // flat-pattern coordinates (x across, s along)
    const flat = new Float32Array((nu + 1) * nv * 2);
    this.flatW = new Float32Array(nv);
    for (let j = 0; j < nv; j++) {
      const t = j / (nv - 1);
      const s = t * p.length;
      const w = widthAt(p, t);
      this.flatW[j] = w;
      for (let i = 0; i <= nu; i++) {
        const k = (j * (nu + 1) + i) * 2;
        flat[k] = (i / nu - 0.5) * w;
        flat[k + 1] = s;
      }
    }
    this.flat = flat;
    const fd = (i1, j1, i2, j2) => {
      const a = (j1 * (nu + 1) + i1) * 2, b = (j2 * (nu + 1) + i2) * 2;
      return Math.hypot(flat[a] - flat[b], flat[a + 1] - flat[b + 1]);
    };
    const id = (i, j) => j * nu + (i % nu);

    // tension-only constraints: structural (around, along) + shear diagonals
    const cons = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        cons.push(id(i, j), id(i + 1, j), fd(i, j, i + 1, j), 1);
        if (j < nv - 1) {
          cons.push(id(i, j), id(i, j + 1), fd(i, j, i, j + 1), 1);
          // woven textile is softer on the bias: diagonals allowed some give
          cons.push(id(i, j), id(i + 1, j + 1), fd(i, j, i + 1, j + 1) * 1.04, 0.5);
          cons.push(id(i + 1, j), id(i, j + 1), fd(i + 1, j, i, j + 1) * 1.04, 0.5);
        }
      }
    }
    this.cA = new Uint32Array(cons.length / 4);
    this.cB = new Uint32Array(cons.length / 4);
    this.cL = new Float32Array(cons.length / 4);
    this.cW = new Float32Array(cons.length / 4);
    for (let c = 0; c < cons.length / 4; c++) {
      this.cA[c] = cons[c * 4]; this.cB[c] = cons[c * 4 + 1];
      this.cL[c] = cons[c * 4 + 2]; this.cW[c] = cons[c * 4 + 3];
    }

    // geometry of rings
    this.topY = p.length * p.hang;
    const rNat = (j) => this.flatW[j] / (2 * Math.PI);
    this.rBottom = rNat(0) * p.bottomRing;
    this.rTop = rNat(nv - 1) * p.topRing;

    // radius caps from stitched restraints
    if (p.flutes > 0) {
      for (let f = 0; f < p.flutes; f++) {
        const i = Math.round((f * nu) / p.flutes) % nu;
        for (let j = 1; j < nv - 1; j++) {
          this.capR[id(i, j)] = Math.min(this.capR[id(i, j)], rNat(j) * p.fluteDepth);
        }
      }
    }
    for (const ring of p.rings || []) {
      const j = Math.round(ring.at * (nv - 1));
      if (j <= 0 || j >= nv - 1) continue;
      for (let i = 0; i < nu; i++) {
        this.capR[id(i, j)] = Math.min(this.capR[id(i, j)], rNat(j) * ring.r);
      }
    }

    // half-sine bow whose arc length matches the slack: L ≈ H (1 + (πa/2H)²)
    const slack = Math.max(0, p.length - this.topY);
    const bow = (2 * this.topY / Math.PI) * Math.sqrt(slack / this.topY);
    // initial state: a limp, partially collapsed sleeve hanging between rings
    for (let j = 0; j < nv; j++) {
      const t = j / (nv - 1);
      const y = t * this.topY;
      const rEnd = this.rBottom + (this.rTop - this.rBottom) * t;
      // bow the limp sleeve outward so the slack length is already taken up
      // near the rings the sleeve starts at the ring radius, blending to a limp sleeve
      const wEnd = Math.exp(-Math.min(t, 1 - t) / 0.06);
      const limp = Math.min(rEnd, rNat(j)) * 0.55 + bow * Math.sin(Math.PI * t);
      const r = j === 0 || j === nv - 1 ? rEnd : Math.min(rNat(j), wEnd * rEnd + (1 - wEnd) * limp);
      for (let i = 0; i < nu; i++) {
        const a = (i / nu) * Math.PI * 2;
        const k = id(i, j) * 3;
        this.pos[k] = Math.cos(a) * r;
        this.pos[k + 1] = y;
        this.pos[k + 2] = Math.sin(a) * r;
        if (j === 0 || j === nv - 1) this.pinned[id(i, j)] = 1;
      }
    }
    this.prev.set(this.pos);
    this.iter = 0;
    this.iterations = 10;
    this.residual = Infinity;
    this.computeTriangles();
  }

  computeTriangles() {
    const nu = this.nu, nv = this.nv;
    const tris = [];
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * nu + i, b = j * nu + ((i + 1) % nu);
        const c = (j + 1) * nu + i, d = (j + 1) * nu + ((i + 1) % nu);
        // winding chosen so that the normal points outward
        tris.push(a, c, b, b, c, d);
      }
    }
    this.tris = new Uint32Array(tris);
  }

  fillY() { return this.topY * this.p.fill; }

  // hydrostatic pressure at height y, in "metres of concrete head"
  head(y) { return Math.max(0, this.fillY() - y); }

  step(substeps = 8) {
    const { pos, prev, force, pinned, tris, capR } = this;
    const n = pos.length / 3;
    const nu = this.nu;
    // pressure gain: converts head x area into a displacement per substep.
    // Absolute magnitude does not change the equilibrium of an inextensible
    // membrane; it only sets how fast we get there.
    const gain = 0.35 / Math.max(this.fillY(), 0.2);
    const damping = 0.9;
    let moved = 0;

    for (let s = 0; s < substeps; s++) {
      force.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        // area-weighted normal (|cross| = 2 * area)
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const h = this.head((pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3);
        if (h <= 0) continue;
        const f = (h * gain) / 6; // /2 area, /3 nodes
        nx *= f; ny *= f; nz *= f;
        force[a] += nx; force[a + 1] += ny; force[a + 2] += nz;
        force[b] += nx; force[b + 1] += ny; force[b + 2] += nz;
        force[c] += nx; force[c + 1] += ny; force[c + 2] += nz;
      }
      // verlet integration with damping
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
      // project tension-only constraints
      for (let it = 0; it < this.iterations; it++) this.project();
    }

    // residual = mean motion in last substep
    for (let i = 0; i < n * 3; i++) moved += Math.abs(pos[i] - prev[i]);
    this.residual = moved / n;
    this.iter++;
    this.updateFields();
    return this.residual;
  }

  project() {
    const { pos, pinned, cA, cB, cL, cW, capR } = this;
    const nc = cL.length;
    for (let c = 0; c < nc; c++) {
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const L = cL[c];
      if (d <= L || d === 0) continue; // slack: fabric does not push
      const wa = pinned[cA[c]] ? 0 : 1, wb = pinned[cB[c]] ? 0 : 1;
      const ws = wa + wb;
      if (ws === 0) continue;
      const corr = ((d - L) / d) * cW[c] / ws;
      pos[a] += dx * corr * wa; pos[a + 1] += dy * corr * wa; pos[a + 2] += dz * corr * wa;
      pos[b] -= dx * corr * wb; pos[b + 1] -= dy * corr * wb; pos[b + 2] -= dz * corr * wb;
    }
    // stitched restraints: radius caps
    const n = pinned.length;
    for (let i = 0; i < n; i++) {
      const R = capR[i];
      if (R === Infinity) continue;
      const k = i * 3;
      const r = Math.hypot(pos[k], pos[k + 2]);
      if (r > R) { const f = R / r; pos[k] *= f; pos[k + 2] *= f; }
    }
    if (this.p.guided) {
      const nu = this.nu;
      for (let j = 1; j < this.nv - 1; j++) {
        let cx = 0, cz = 0;
        for (let i = 0; i < nu; i++) { const k = (j * nu + i) * 3; cx += pos[k]; cz += pos[k + 2]; }
        cx /= nu; cz /= nu;
        for (let i = 0; i < nu; i++) { const k = (j * nu + i) * 3; pos[k] -= cx; pos[k + 2] -= cz; }
      }
    }
    // nothing goes below the ground
    for (let i = 0; i < n; i++) {
      const k = i * 3 + 1;
      if (pos[k] < 0) pos[k] = 0;
    }
  }

  updateFields() {
    const { pos, cA, cB, cL, taut, pressure } = this;
    const n = pos.length / 3;
    taut.fill(0);
    for (let c = 0; c < cL.length; c++) {
      if (this.cW[c] < 1) continue;
      const a = cA[c] * 3, b = cB[c] * 3;
      const d = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      const r = d / cL[c];
      const v = r > 0.985 ? 1 : 0;
      taut[cA[c]] = Math.max(taut[cA[c]], v);
      taut[cB[c]] = Math.max(taut[cB[c]], v);
    }
    for (let i = 0; i < n; i++) {
      pressure[i] = (RHO_CONCRETE * G * this.head(pos[i * 3 + 1])) / 1000;
    }
  }

  // cross-section area per row (shoelace in xz) integrated over height
  volume() {
    const { pos, nu, nv } = this;
    let V = 0, prevA = null, prevY = null;
    for (let j = 0; j < nv; j++) {
      let A = 0, y = 0;
      for (let i = 0; i < nu; i++) {
        const k = (j * nu + i) * 3, l = (j * nu + ((i + 1) % nu)) * 3;
        A += pos[k] * pos[l + 2] - pos[l] * pos[k + 2];
        y += pos[k + 1];
      }
      A = Math.abs(A) / 2; y /= nu;
      // only concrete below the pour level counts
      const fy = this.fillY();
      if (prevA !== null && prevY < fy) V += ((A + prevA) / 2) * Math.max(0, Math.min(y, fy) - prevY);
      prevA = A; prevY = y;
    }
    return V;
  }

  // radius profile (mean radius per row) for the section diagram
  profile() {
    const { pos, nu, nv } = this;
    const out = [];
    for (let j = 0; j < nv; j++) {
      let r = 0, y = 0, rMin = Infinity, rMax = 0;
      for (let i = 0; i < nu; i++) {
        const k = (j * nu + i) * 3;
        const ri = Math.hypot(pos[k], pos[k + 2]);
        r += ri; y += pos[k + 1];
        rMin = Math.min(rMin, ri); rMax = Math.max(rMax, ri);
      }
      out.push({ y: y / nu, r: r / nu, rMin, rMax });
    }
    return out;
  }

  run(maxIter = 400, tol = 1e-5) {
    for (let i = 0; i < maxIter; i++) if (this.step() < tol) break;
    return this;
  }

  toOBJ() {
    const { pos, tris } = this;
    let s = '# fabric-formed column — designbyreduction simulator\n';
    for (let i = 0; i < pos.length; i += 3) {
      s += `v ${pos[i].toFixed(4)} ${pos[i + 1].toFixed(4)} ${pos[i + 2].toFixed(4)}\n`;
    }
    for (let t = 0; t < tris.length; t += 3) {
      s += `f ${tris[t] + 1} ${tris[t + 1] + 1} ${tris[t + 2] + 1}\n`;
    }
    return s;
  }

  // Cutting pattern: outline, seam allowance, flute stitch lines, ring marks.
  toPatternSVG(seam = 0.015) {
    const { p, nv, nu, flatW } = this;
    const pad = 0.05;
    const maxW = Math.max(...flatW) + 2 * seam;
    const W = maxW + 2 * pad, H = p.length + 2 * pad + 2 * seam;
    const X = (x) => (x + W / 2).toFixed(4);
    const Y = (s) => (H - pad - seam - s).toFixed(4);
    const L = [], R = [], Ls = [], Rs = [];
    for (let j = 0; j < nv; j++) {
      const s = (j / (nv - 1)) * p.length, w = flatW[j] / 2;
      L.push(`${X(-w)},${Y(s)}`); R.push(`${X(w)},${Y(s)}`);
      Ls.push(`${X(-w - seam)},${Y(s)}`); Rs.push(`${X(w + seam)},${Y(s)}`);
    }
    const poly = (a, b) => [...a, ...b.reverse()].join(' ');
    let lines = '';
    if (p.flutes > 0) {
      for (let f = 0; f < p.flutes; f++) {
        const u = Math.round((f * nu) / p.flutes) / nu;
        const pts = [];
        for (let j = 1; j < nv - 1; j++) {
          const s = (j / (nv - 1)) * p.length;
          pts.push(`${X((u - 0.5) * flatW[j])},${Y(s)}`);
        }
        lines += `<polyline points="${pts.join(' ')}" class="stitch"/>\n`;
      }
    }
    for (const ring of p.rings || []) {
      const j = Math.round(ring.at * (nv - 1));
      const s = (j / (nv - 1)) * p.length, w = flatW[j] / 2;
      lines += `<line x1="${X(-w)}" y1="${Y(s)}" x2="${X(w)}" y2="${Y(s)}" class="ring"/>\n`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(W * 1000).toFixed(0)}mm" height="${(H * 1000).toFixed(0)}mm" viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}">
<style>
  .cut{fill:none;stroke:#000;stroke-width:0.002}
  .sew{fill:none;stroke:#c00;stroke-width:0.0015;stroke-dasharray:0.01 0.006}
  .stitch{fill:none;stroke:#06c;stroke-width:0.0015;stroke-dasharray:0.004 0.004}
  .ring{stroke:#090;stroke-width:0.002}
</style>
<!-- cut line includes ${seam * 1000} mm seam allowance on the long edges; long edges are sewn together into a tube -->
<polygon points="${poly(Ls, Rs)}" class="cut"/>
<polygon points="${poly(L, R)}" class="sew"/>
${lines}</svg>`;
  }
}

// max strain over the structural (warp/weft) constraints — sanity metric
ColumnSim.prototype.maxStrain = function () {
  const { pos, cA, cB, cL, cW } = this;
  let m = 0;
  for (let c = 0; c < cL.length; c++) {
    if (cW[c] < 1) continue;
    const a = cA[c] * 3, b = cB[c] * 3;
    const d = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    m = Math.max(m, d / cL[c] - 1);
  }
  return m;
};
