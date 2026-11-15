// General fabric formwork engine (no DOM).
//
// A formwork is described the way it is produced:
//   pieces  flat pieces of cloth (structured grids with flat 2D coordinates = the CUT)
//   seams   node-to-node joins between or within pieces           = SEW / WELD / GLUE lines
//           (perimeter seams, stitch lines through two layers, point tacks,
//            glued areas, the rim of a glued-and-cut-out hole)
//   darts   are expressed in the flat coordinates (cloth removed)  = DART / LOCKED PLEAT
//   holes   cells removed from a piece                             = CUT OUT
//   cords   tension-only links to an internal anchor               = TETHER
//   pins    nodes held by rings, rails, boards                     = FRAMEWORK
// Loads: hydrostatic concrete pressure normal to the cloth (head in metres of
// concrete), or a vertical weight per area (a draped layer of concrete).
//
// All edges are tension-only: cloth can wrinkle but not stretch beyond its
// flat length. Solved with position-based dynamics.

export const RHO = 2400, G = 9.81;

export class Fabric {
  constructor({ pieces, seams = [], cords = [], anchors = [], head = () => 0, weight = 0, fabricWeight = 0.4, ground = true, iterations = 8 }) {
    Object.assign(this, { pieces, head, weight, fabricWeight, ground, iterations });
    // ---- local -> global indexing with union-find over seams
    let off = 0;
    for (const p of pieces) {
      p.offset = off;
      off += p.nu * p.nv;
      p.lid = (i, j) => p.offset + j * p.nu + (p.wrap ? ((i % p.nu) + p.nu) % p.nu : i);
    }
    const nLocal = off;
    const parent = new Int32Array(nLocal).map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    for (const s of seams) unite(pieces[s[0]].lid(s[1], s[2]), pieces[s[3]].lid(s[4], s[5]));
    const map = new Int32Array(nLocal), roots = new Map();
    let n = 0;
    for (let i = 0; i < nLocal; i++) { const r = find(i); if (!roots.has(r)) roots.set(r, n++); map[i] = roots.get(r); }
    this.nCloth = n;
    this.n = n + anchors.length;
    this.map = map;
    const N = this.n;
    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.force = new Float32Array(N * 3);
    this.pinned = new Uint8Array(N);
    this.pressure = new Float32Array(N);
    const cnt = new Float32Array(N);

    // ---- positions (average of merged nodes), pins
    for (const p of pieces) for (let j = 0; j < p.nv; j++) for (let i = 0; i < p.nu; i++) {
      const g = map[p.lid(i, j)], q = p.init(i, j);
      this.pos[g * 3] += q[0]; this.pos[g * 3 + 1] += q[1]; this.pos[g * 3 + 2] += q[2]; cnt[g]++;
      if (p.pin && p.pin(i, j)) this.pinned[g] = 1;
    }
    for (let g = 0; g < n; g++) for (let d = 0; d < 3; d++) this.pos[g * 3 + d] /= cnt[g] || 1;
    anchors.forEach((a, k) => { const g = n + k; this.pos.set(a, g * 3); this.pinned[g] = 1; });
    this.prev.set(this.pos);
    this.gid = (pi, i, j) => map[pieces[pi].lid(i, j)];

    // ---- constraints from the flat pattern
    const cons = [];
    for (const p of pieces) {
      const iMax = p.wrap ? p.nu : p.nu - 1;
      const fd = (i1, j1, i2, j2) => { const a = p.flat(i1, j1), b = p.flat(i2, j2); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
      const isHole = (i, j) => p.hole && i >= 0 && j >= 0 && i < iMax && j < p.nv - 1 && p.hole(i, j);
      const solid = (i, j) => i >= 0 && j >= 0 && i < iMax && j < p.nv - 1 && !isHole(i, j);
      // stiff (glued / laminated) areas resist compression too: two-sided links,
      // marked with a negative weight
      const stiff = (i1, j1, i2, j2) => p.bend && p.bendOk && p.bendOk(((i1 % p.nu) + p.nu) % p.nu, j1) && p.bendOk(((i2 % p.nu) + p.nu) % p.nu, j2);
      const add = (i1, j1, i2, j2, w, stretch = 1) => {
        if (stiff(i1, j1, i2, j2)) { w = -w; stretch = 1; }
        // skip edges that lie entirely inside cut-out holes
        if (p.hole) {
          const horiz = j1 === j2, i = Math.min(i1, i2), j = Math.min(j1, j2);
          const keep = horiz ? solid(i, j) || solid(i, j - 1) : (i1 !== i2 || solid(i, j) || solid(p.wrap ? (i - 1 + p.nu) % p.nu : i - 1, j));
          if (!keep) return;
        }
        const a = map[p.lid(i1, j1)], b = map[p.lid(i2, j2)];
        if (a !== b) cons.push(a, b, fd(i1, j1, i2, j2) * stretch, w);
      };
      for (let j = 0; j < p.nv; j++) for (let i = 0; i <= iMax; i++) {
        if (i < iMax) add(i, j, i + 1, j, 1);
        if (j < p.nv - 1 && i < p.nu) add(i, j, i, j + 1, 1);
        if (j < p.nv - 1 && i < iMax && !(p.hole && p.hole(i, j))) {
          add(i, j, i + 1, j + 1, 0.5, 1.04);
          add(i + 1, j, i, j + 1, 0.5, 1.04);
        }
      }
    }
    for (const c of cords) cons.push(c[0], c[1], c[2], 1);
    const m = cons.length / 4;
    this.cA = new Uint32Array(m); this.cB = new Uint32Array(m); this.cL = new Float32Array(m); this.cW = new Float32Array(m);
    for (let c = 0; c < m; c++) { this.cA[c] = cons[4 * c]; this.cB[c] = cons[4 * c + 1]; this.cL[c] = cons[4 * c + 2]; this.cW[c] = cons[4 * c + 3]; }

    // ---- triangles, oriented so that the load pushes along piece.outward
    const tris = [], regions = [];
    for (const p of pieces) {
      const iMax = p.wrap ? p.nu : p.nu - 1;
      const local = [];
      for (let j = 0; j < p.nv - 1; j++) for (let i = 0; i < iMax; i++) {
        if (p.hole && p.hole(i, j)) continue;
        const a = map[p.lid(i, j)], b = map[p.lid(i + 1, j)], c = map[p.lid(i, j + 1)], d = map[p.lid(i + 1, j + 1)];
        local.push(a, c, b, b, c, d);
        const r = p.region ? p.region(i, j) : 0;
        regions.push(r, r);
      }
      // sign check on a sample triangle, against the piece's outward direction
      let sgn = 1;
      for (let t = 0; t < local.length; t += 3) {
        const P = this.pos, a = local[t] * 3, b = local[t + 1] * 3, c = local[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-14) continue;
        const ctr = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
        const o = p.outward(ctr);
        sgn = nx * o[0] + ny * o[1] + nz * o[2] < 0 ? -1 : 1;
        break;
      }
      for (let t = 0; t < local.length; t += 3) {
        if (sgn > 0) tris.push(local[t], local[t + 1], local[t + 2]);
        else tris.push(local[t], local[t + 2], local[t + 1]);
      }
    }
    this.tris = new Uint32Array(tris);

    // ---- bending: dihedral constraints between neighbouring triangles
    // (piece.bend = stiffness 0..1, piece.bendOk(i,j) = which nodes are stiff,
    // e.g. only glued double-layer areas). Rest shape = the flat pattern.
    const quads = [], bw = [];
    for (const p of pieces) {
      if (!p.bend) continue;
      const iMax = p.wrap ? p.nu : p.nu - 1, ok = (i, j) => !p.bendOk || p.bendOk(((i % p.nu) + p.nu) % p.nu, j);
      const edges = new Map();
      const addTri = (x, y, z, okT) => {
        for (const [e0, e1, o] of [[x, y, z], [y, z, x], [z, x, y]]) {
          const key = e0 < e1 ? `${e0},${e1}` : `${e1},${e0}`;
          const prev = edges.get(key);
          if (prev) { if (prev.ok && okT) quads.push(e0, e1, prev.o, o); bw.push(p.bend); }
          else edges.set(key, { o, ok: okT });
        }
      };
      for (let j = 0; j < p.nv - 1; j++) for (let i = 0; i < iMax; i++) {
        if (p.hole && p.hole(i, j)) continue;
        const okC = ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1);
        const A = map[p.lid(i, j)], B = map[p.lid(i + 1, j)], C = map[p.lid(i, j + 1)], D = map[p.lid(i + 1, j + 1)];
        addTri(A, C, B, okC); addTri(B, C, D, okC);
      }
    }
    this.quads = new Uint32Array(quads);
    this.bendK = bw.length ? Math.max(...bw) : 0;
    this.triRegion = new Uint8Array(regions);
    this.iter = 0;
    this.residual = Infinity;
  }

  step(substeps = 6) {
    const { pos, prev, force, pinned, tris } = this;
    const N = this.n;
    let hNow = this.weight;
    for (let i = 1; i < this.nCloth * 3; i += 3) hNow = Math.max(hNow, this.head(pos[i], 0));
    if (this.regionHeadMax) hNow = Math.max(hNow, this.regionHeadMax);
    const gain = 0.35 / Math.max(hNow, 0.2);
    const gw = (this.fabricWeight / RHO) * 40 * gain / 6 + (this.weight * gain) / 6;
    for (let s = 0; s < substeps; s++) {
      force.fill(0);
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const wgt = Math.sqrt(nx * nx + ny * ny + nz * nz) * gw;
        force[a + 1] -= wgt; force[b + 1] -= wgt; force[c + 1] -= wgt;
        const h = this.head((pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, this.triRegion[t / 3]);
        if (h <= 0) continue;
        const f = (h * gain) / 6;
        nx *= f; ny *= f; nz *= f;
        force[a] += nx; force[a + 1] += ny; force[a + 2] += nz;
        force[b] += nx; force[b + 1] += ny; force[b + 2] += nz;
        force[c] += nx; force[c + 1] += ny; force[c + 2] += nz;
      }
      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        const k = i * 3;
        for (let d = 0; d < 3; d++) {
          const x = pos[k + d], v = (x - prev[k + d]) * 0.9;
          prev[k + d] = x;
          pos[k + d] = x + v + force[k + d];
        }
      }
      if (this.quads.length) this.projectBending();
      for (let it = 0; it < this.iterations; it++) this.project();
    }
    let moved = 0, free = 0;
    for (let i = 0; i < N; i++) {
      if (pinned[i]) continue;
      free++;
      moved += Math.abs(pos[i * 3] - prev[i * 3]) + Math.abs(pos[i * 3 + 1] - prev[i * 3 + 1]) + Math.abs(pos[i * 3 + 2] - prev[i * 3 + 2]);
    }
    this.residual = moved / Math.max(free, 1);
    this.iter++;
    for (let i = 0; i < N; i++) this.pressure[i] = (RHO * G * Math.max(this.head(pos[i * 3 + 1]), 0)) / 1000;
    return this.residual;
  }

  project() {
    const { pos, pinned, cA, cB, cL, cW } = this;
    for (let c = 0; c < cL.length; c++) {
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), L = cL[c];
      const two = cW[c] < 0;
      if (d === 0 || (!two && d <= L)) continue;
      const wa = pinned[cA[c]] ? 0 : 1, wb = pinned[cB[c]] ? 0 : 1, ws = wa + wb;
      if (!ws) continue;
      const k = ((d - L) / d) * Math.abs(cW[c]) / ws;
      pos[a] += dx * k * wa; pos[a + 1] += dy * k * wa; pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb; pos[b + 1] -= dy * k * wb; pos[b + 2] -= dz * k * wb;
    }
    // symmetry / guide planes: {nodes, axis (0|1|2), value, slide}
    // fixed: every node on the plane keeps coordinate = value
    // slide: the nodes stay coplanar but the plane may translate (value = their mean)
    if (this.planes) for (const pl of this.planes) {
      const a = pl.axis;
      let v = pl.value;
      if (pl.slide) { v = 0; for (const g of pl.nodes) v += pos[g * 3 + a]; v /= pl.nodes.length; pl.current = v; }
      for (const g of pl.nodes) pos[g * 3 + a] = v;
    }
    if (this.ground) for (let i = 1; i < pos.length; i += 3) if (pos[i] < 0) pos[i] = 0;
  }

  // Müller et al. 2006 dihedral bending constraint, rest angle = flat
  projectBending() {
    const { pos: P, pinned, quads } = this, k = this.bendK;
    for (let q = 0; q < quads.length; q += 4) {
      const i1 = quads[q] * 3, i2 = quads[q + 1] * 3, i3 = quads[q + 2] * 3, i4 = quads[q + 3] * 3;
      const ax = P[i2] - P[i1], ay = P[i2 + 1] - P[i1 + 1], az = P[i2 + 2] - P[i1 + 2]; // p2
      const bx = P[i3] - P[i1], by = P[i3 + 1] - P[i1 + 1], bz = P[i3 + 2] - P[i1 + 2]; // p3
      const cx = P[i4] - P[i1], cy = P[i4 + 1] - P[i1 + 1], cz = P[i4 + 2] - P[i1 + 2]; // p4
      let n1x = ay * bz - az * by, n1y = az * bx - ax * bz, n1z = ax * by - ay * bx;
      let n2x = ay * cz - az * cy, n2y = az * cx - ax * cz, n2z = ax * cy - ay * cx;
      const l1 = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z), l2 = Math.sqrt(n2x * n2x + n2y * n2y + n2z * n2z);
      if (l1 < 1e-12 || l2 < 1e-12) continue;
      n1x /= l1; n1y /= l1; n1z /= l1; n2x /= l2; n2y /= l2; n2z /= l2;
      const d = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y + n1z * n2z));
      // flat rest: p3 and p4 on opposite sides -> d = -1 (angle π)
      const ang = Math.acos(d) - Math.PI;
      if (ang > -1e-4) continue;
      // q3 = (p2×n2 + (n1×p2) d) / l1
      const q3x = ((ay * n2z - az * n2y) + (n1y * az - n1z * ay) * d) / l1;
      const q3y = ((az * n2x - ax * n2z) + (n1z * ax - n1x * az) * d) / l1;
      const q3z = ((ax * n2y - ay * n2x) + (n1x * ay - n1y * ax) * d) / l1;
      const q4x = ((ay * n1z - az * n1y) + (n2y * az - n2z * ay) * d) / l2;
      const q4y = ((az * n1x - ax * n1z) + (n2z * ax - n2x * az) * d) / l2;
      const q4z = ((ax * n1y - ay * n1x) + (n2x * ay - n2y * ax) * d) / l2;
      const q2x = -((by * n2z - bz * n2y) + (n1y * bz - n1z * by) * d) / l1 - ((cy * n1z - cz * n1y) + (n2y * cz - n2z * cy) * d) / l2;
      const q2y = -((bz * n2x - bx * n2z) + (n1z * bx - n1x * bz) * d) / l1 - ((cz * n1x - cx * n1z) + (n2z * cx - n2x * cz) * d) / l2;
      const q2z = -((bx * n2y - by * n2x) + (n1x * by - n1y * bx) * d) / l1 - ((cx * n1y - cy * n1x) + (n2x * cy - n2y * cx) * d) / l2;
      const q1x = -q2x - q3x - q4x, q1y = -q2y - q3y - q4y, q1z = -q2z - q3z - q4z;
      const w1 = pinned[quads[q]] ? 0 : 1, w2 = pinned[quads[q + 1]] ? 0 : 1, w3 = pinned[quads[q + 2]] ? 0 : 1, w4 = pinned[quads[q + 3]] ? 0 : 1;
      const den = w1 * (q1x * q1x + q1y * q1y + q1z * q1z) + w2 * (q2x * q2x + q2y * q2y + q2z * q2z) + w3 * (q3x * q3x + q3y * q3y + q3z * q3z) + w4 * (q4x * q4x + q4y * q4y + q4z * q4z);
      if (den < 1e-9) continue;
      let sc = (-Math.sqrt(1 - d * d) * ang / den) * k;
      // limit the step so a single constraint can never move a node more than 5 mm
      const maxQ = Math.sqrt(Math.max(q1x * q1x + q1y * q1y + q1z * q1z, q2x * q2x + q2y * q2y + q2z * q2z, q3x * q3x + q3y * q3y + q3z * q3z, q4x * q4x + q4y * q4y + q4z * q4z));
      if (Math.abs(sc) * maxQ > 0.005) sc = Math.sign(sc) * 0.005 / maxQ;
      P[i1] += sc * w1 * q1x; P[i1 + 1] += sc * w1 * q1y; P[i1 + 2] += sc * w1 * q1z;
      P[i2] += sc * w2 * q2x; P[i2 + 1] += sc * w2 * q2y; P[i2 + 2] += sc * w2 * q2z;
      P[i3] += sc * w3 * q3x; P[i3 + 1] += sc * w3 * q3y; P[i3 + 2] += sc * w3 * q3z;
      P[i4] += sc * w4 * q4x; P[i4 + 1] += sc * w4 * q4y; P[i4 + 2] += sc * w4 * q4z;
    }
  }

  run(maxIter = 800, tol = 1e-5) {
    for (let i = 0; i < maxIter; i++) if (this.step() < tol) break;
    return this;
  }

  maxStrain() {
    const { pos, cA, cB, cL, cW } = this;
    let m = 0;
    for (let c = 0; c < cL.length; c++) {
      if (Math.abs(cW[c]) < 1 || cB[c] >= this.nCloth) continue;
      const a = cA[c] * 3, b = cB[c] * 3;
      m = Math.max(m, Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]) / cL[c] - 1);
    }
    return m;
  }

  // enclosed volume via the divergence theorem, relative to origin o
  // (exact for closed surfaces; for open ones put o in the plane of the opening)
  volume(o = [0, 0, 0]) {
    const { pos, tris } = this;
    let V = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ax = pos[a] - o[0], ay = pos[a + 1] - o[1], az = pos[a + 2] - o[2];
      const bx = pos[b] - o[0], by = pos[b + 1] - o[1], bz = pos[b + 2] - o[2];
      const cx = pos[c] - o[0], cy = pos[c + 1] - o[1], cz = pos[c + 2] - o[2];
      V += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return Math.abs(V) / 6;
  }

  // triangles for display: where two layers are glued they coincide exactly,
  // so draw each such triangle once (volume() still uses the full list)
  renderTris() {
    const seen = new Set(), out = [], t = this.tris;
    for (let k = 0; k < t.length; k += 3) {
      const key = [t[k], t[k + 1], t[k + 2]].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t[k], t[k + 1], t[k + 2]);
    }
    return new Uint32Array(out);
  }

  bounds() {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < this.nCloth; i++) for (let d = 0; d < 3; d++) {
      const v = this.pos[i * 3 + d];
      if (v < b.min[d]) b.min[d] = v;
      if (v > b.max[d]) b.max[d] = v;
    }
    return b;
  }
}
