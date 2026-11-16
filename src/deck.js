// Concertina V truss deck (no DOM).
//
// One big double sheet is taped with a row of Warren truss webs side by side
// and folded like a concertina along the chord channels. Unfolded, the webs
// lean alternately left and right (a zig-zag in section): the fold lines are
// chords shared by two neighbouring webs (top chords form the deck, bottom
// chords rest on the ground), and the triangles of neighbouring webs point
// opposite ways. Pumped full of concrete it becomes a space truss.
//
// Simulated: one representative V module (two webs + shared chords, a whole
// number of bays long). Its four cut edges are symmetry planes standing in for
// the neighbours: across the deck (are the bottom chords anchored, or may the
// V spread?) and along it (are the ends held, or may the deck shorten?).
// The module is then repeated over the footprint.

import { Fabric, RHO, G } from './engine.js';

export const DECK_DEFAULTS = {
  width: 8, length: 20, height: 1.0,
  angle: 60,          // web inclination from horizontal (degrees)
  bays: 2,            // bays per simulated module
  bayLen: 1.33,       // m, bay length along the deck
  chord: 0.26,        // m, flat width of a fold (chord) channel
  diag: 0.2,          // m, flat width of a diagonal channel
  anchored: true,     // bottom chords fixed in place (ground anchors / ties)
  heldEnds: true,     // deck ends held (no shortening)
  propped: true,      // top chords hung from a light rail / cable line during the pour
  cushions: false,    // triangles sealed as air cushions instead of taped flat
  bend: 0,            // bending stiffness of the taped (glued) areas, 0 = limp
  lift: 0,            // staged pour: height of each lift in m (0 = one pour)
  airKPa: 20,         // cushion air pressure
  standpipe: 0.25,    // m, head above the top chords while pumping
  grid: 0.04,         // m, simulation resolution
};

export class Deck {
  constructor(params = {}) { this.p = { ...DECK_DEFAULTS, ...params }; this.build(); }

  build() {
    const p = this.p, th = (p.angle * Math.PI) / 180;
    const S = p.height / Math.sin(th);           // slant length of one web (fold to fold)
    const Lm = p.bays * p.bayLen;                // module length
    this.S = S; this.Lm = Lm; this.th = th;
    this.modW = 2 * S * Math.cos(th);            // width of one V
    const nu = Math.round((2 * S) / p.grid) + 1, nv = Math.round(Lm / p.grid) + 1;
    this.nu = nu; this.nv = nv;
    const flat = (i, j) => [(i / (nu - 1)) * 2 * S, (j / (nv - 1) - 0.5) * Lm];

    // channel centrelines in flat (u, x) coordinates
    const segs = [];
    for (const u of [0, S, 2 * S]) segs.push([[u, -Lm], [u, Lm], p.chord]);
    const web = (u0, phase) => {
      const ua = u0 + p.chord / 2, ub = u0 + S - p.chord / 2;
      for (let k = -1; k <= p.bays; k++) {
        const x0 = -Lm / 2 + (k + phase) * p.bayLen;
        segs.push([[ua, x0], [ub, x0 + p.bayLen / 2], p.diag]);
        segs.push([[ub, x0 + p.bayLen / 2], [ua, x0 + p.bayLen], p.diag]);
      }
    };
    web(0, 0);       // web A
    web(S, 0.5);     // web B: triangles point the other way
    this.segs = segs;
    const dseg = (q, a, b) => {
      const vx = b[0] - a[0], vz = b[1] - a[1], t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(q[0] - a[0] - t * vx, q[1] - a[1] - t * vz);
    };
    const clr = (q) => Math.min(...segs.map(([a, b, w]) => dseg(q, a, b) - w / 2));
    const rim = 0.035; // taped band that separates a concrete channel from an air cushion
    const glued = p.cushions ? (i, j) => { const c = clr(flat(i, j)); return c > 0 && c < rim; } : (i, j) => clr(flat(i, j)) > 0;
    const region = p.cushions ? (i, j) => (clr([((i + 0.5) / (nu - 1)) * 2 * S, ((j + 0.5) / (nv - 1) - 0.5) * Lm]) >= rim ? 1 : 0) : null;

    // folded geometry: u -> (z, y); web A rises, web B falls
    const fold = (u) => u <= S ? [u * Math.cos(th), u * Math.sin(th)] : [u * Math.cos(th), (2 * S - u) * Math.sin(th)];
    const nrm = (u) => u <= S ? [0, Math.cos(th), -Math.sin(th)] : [0, Math.cos(th), Math.sin(th)];
    const layer = (s) => ({
      name: s > 0 ? 'outer sheet' : 'inner sheet', nu, nv, flat, region, bend: p.bend, bendOk: glued,
      init: (i, j) => {
        const [u, x] = flat(i, j), [z, y] = fold(u), n = nrm(u);
        const off = s * 0.004 * (glued(i, j) ? 0 : 1) + 0.005 * Math.sin((2.3 * Math.PI * x) / Lm + u);
        return [x, y + n[1] * off + 0.002, z + n[2] * off];
      },
      outward: (q) => nrm(q[2] / Math.cos(th)).map((v) => v * s),
    });
    const seams = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) if (glued(i, j)) seams.push([0, i, j, 1, i, j]);
    const top = p.height + p.standpipe;
    // staged pour: fresh concrete fills up to `fillLevel`; below `setLevel` it has set
    this.stages = p.lift > 0 ? Math.ceil(p.height / p.lift) : 1;
    this.stage = 1;
    this.setLevel = -1;
    this.fillLevel = p.lift > 0 ? Math.min(p.lift, p.height) : p.height;
    const fresh = (y) => (y < this.setLevel ? 0 : Math.max(0, this.fillLevel + p.standpipe - y));
    this.top = top;
    const airHead = (p.airKPa * 1000) / (RHO * G);
    this.fab = new Fabric({ pieces: [layer(1), layer(-1)], seams, head: (y, r) => (r === 1 ? airHead : fresh(y)) });
    if (p.cushions) this.fab.regionHeadMax = airHead;
    this.isAir = p.cushions ? (i, j) => clr(flat(i, j)) >= rim : null;

    // symmetry planes
    const F = this.fab, edgeU = (i) => { const g = []; for (let j = 0; j < nv; j++) for (const pc of [0, 1]) g.push(F.gid(pc, i, j)); return g; };
    const edgeX = (j) => { const g = []; for (let i = 0; i < nu; i++) for (const pc of [0, 1]) g.push(F.gid(pc, i, j)); return g; };
    F.planes = [
      { nodes: edgeU(0), axis: 2, value: 0, slide: !p.anchored },
      { nodes: edgeU(nu - 1), axis: 2, value: this.modW, slide: !p.anchored },
      { nodes: edgeX(0), axis: 0, value: -Lm / 2, slide: !p.heldEnds },
      { nodes: edgeX(nv - 1), axis: 0, value: Lm / 2, slide: !p.heldEnds },
    ];
    // top-chord support: the two edges of each top-chord channel are held at
    // their height (a rail or tensioned cable taped along the fold)
    if (p.propped) {
      // rails hold height and position across the deck, but the cloth can
      // slide along them (so the deck can still shorten)
      const iTop = (nu - 1) / 2, off = Math.round(p.chord / 2 / p.grid);
      for (let j = 0; j < nv; j++) for (const pc of [0, 1]) for (const d of [-off, off]) {
        const g = F.gid(pc, Math.round(iTop + d), j);
        F.planes.push({ nodes: [g], axis: 1, value: F.pos[g * 3 + 1] }, { nodes: [g], axis: 2, value: F.pos[g * 3 + 2] });
      }
    }
    this.layout();
  }

  layout() {
    const p = this.p;
    this.nV = Math.max(1, Math.round(p.width / this.modW));
    this.nL = Math.max(1, Math.round(p.length / this.Lm));
    this.instances = [];
    for (let a = 0; a < this.nV; a++) for (let b = 0; b < this.nL; b++) {
      this.instances.push({ z: (a - this.nV / 2) * this.modW, x: (b - (this.nL - 1) / 2) * this.Lm });
    }
  }

  step() {
    const r = this.fab.step();
    if (r < 1e-5 && this.stage < this.stages) {
      // this lift has settled: let it set (freeze it) and pour the next one
      const F = this.fab;
      this.setLevel = this.fillLevel;
      for (let i = 0; i < F.nCloth; i++) if (F.pos[i * 3 + 1] < this.setLevel) F.pinned[i] = 1;
      this.stage++;
      this.fillLevel = Math.min(this.p.height, this.fillLevel + this.p.lift);
      F.residual = Infinity;
    }
    return this.fab.residual;
  }
  get residual() { return this.stage < this.stages ? Infinity : this.fab.residual; }
  get iter() { return this.fab.iter; }

  stats() {
    const F = this.fab, P = F.pos, { nu, nv } = this;
    const du = (2 * this.S) / (nu - 1), dx = this.Lm / (nv - 1);
    const sep = (i, j) => { const a = F.gid(0, i, j), b = F.gid(1, i, j); return Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); };
    let V = 0, topT = 0, diagT = 0;
    const iTop = Math.round((nu - 1) / 2);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const s = sep(i, j);
      // a flat width w that inflates to a round tube: ∫ separation du = d², area = π d² / 4
      const w = (i === 0 || i === nu - 1 ? 0.5 : 1) * (this.isAir && this.isAir(i, j) ? 0 : 1);
      V += s * du * dx * w * (Math.PI / 4);
      if (Math.abs(i - iTop) <= 1) topT = Math.max(topT, s);
      else if (i > 0.15 * nu && i < 0.35 * nu && !(this.isAir && this.isAir(i, j))) diagT = Math.max(diagT, s);
    }
    let ymax = 0;
    for (let i = 0; i < F.nCloth; i++) ymax = Math.max(ymax, P[i * 3 + 1]);
    const pl = F.planes;
    const wNow = (pl[1].current ?? pl[1].value) - (pl[0].current ?? pl[0].value);
    const lNow = (pl[3].current ?? pl[3].value) - (pl[2].current ?? pl[2].value);
    const n = this.instances.length;
    const sheetArea = 2 * this.S * this.nV * this.nL * this.Lm; // per layer
    return {
      modules: n, webs: 2 * this.nV,
      vModule: V, volume: V * n, mass: (V * n * RHO) / 1000,
      deckW: wNow * this.nV, deckL: lNow * this.nL,
      spread: wNow / this.modW - 1, shorten: 1 - lNow / this.Lm,
      apex: ymax, topTube: topT, diagTube: diagT,
      fabric: 2 * sheetArea, sheetW: 2 * this.S * this.nV, sheetL: this.nL * this.Lm,
      basePressure: (RHO * G * this.top) / 1000,
      peakPressure: (RHO * G * ((this.p.lift > 0 ? Math.min(this.p.lift, this.p.height) : this.p.height) + this.p.standpipe)) / 1000,
      stage: this.stage, stages: this.stages,
      strain: F.maxStrain(),
    };
  }

  // Cut-and-fold drawing of the whole sheet (1:1 in metres): taped areas are
  // outside the channel outlines; fold lines alternate mountain (top chords)
  // and valley (bottom chords).
  sheetSVG() {
    const p = this.p, S = this.S, W = 2 * S * this.nV, L = this.nL * this.Lm, pad = 0.3;
    let body = '';
    const X = (u) => (pad + u).toFixed(3), Y = (x) => (pad + x).toFixed(3);
    for (let k = 0; k <= 2 * this.nV; k++) {
      const u = k * S, mountain = k % 2 === 1;
      body += `<line x1="${X(u)}" y1="${Y(0)}" x2="${X(u)}" y2="${Y(L)}" stroke="${mountain ? '#c00' : '#06c'}" stroke-width="0.02" stroke-dasharray="${mountain ? '0.2 0.08' : '0.06 0.06'}"/>\n`;
    }
    // channel outlines for one module, repeated
    for (let a = 0; a < this.nV; a++) for (let b = 0; b < this.nL; b++) {
      for (const [p0, p1, w] of this.segs.slice(3)) {
        const du = p1[0] - p0[0], dx = p1[1] - p0[1], l = Math.hypot(du, dx), nu = (-dx / l) * w / 2, nx = (du / l) * w / 2;
        const clip = (x) => Math.max(0, Math.min(this.Lm, x + this.Lm / 2));
        const pts = [[p0[0] + nu, p0[1] + nx], [p1[0] + nu, p1[1] + nx], [p1[0] - nu, p1[1] - nx], [p0[0] - nu, p0[1] - nx]];
        body += `<polygon points="${pts.map(([u, x]) => `${X(a * 2 * S + u)},${Y(b * this.Lm + clip(x))}`).join(' ')}" fill="none" stroke="#000" stroke-width="0.01"/>\n`;
      }
    }
    for (let k = 0; k <= 2 * this.nV; k++) {
      const u = k * S;
      for (const s of [-1, 1]) body += `<line x1="${X(u + (s * p.chord) / 2)}" y1="${Y(0)}" x2="${X(u + (s * p.chord) / 2)}" y2="${Y(L)}" stroke="#000" stroke-width="0.01"/>\n`;
    }
    const Wt = W + 2 * pad, Lt = L + 2 * pad;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(Wt * 10).toFixed(0)}mm" height="${(Lt * 10).toFixed(0)}mm" viewBox="0 0 ${Wt.toFixed(3)} ${Lt.toFixed(3)}">
<!-- scale 1:100 when printed. Black: channel outlines (tape everything outside them). Red dashed: mountain folds (top chords). Blue dotted: valley folds (bottom chords). -->
<rect x="${pad}" y="${pad}" width="${W.toFixed(3)}" height="${L.toFixed(3)}" fill="none" stroke="#000" stroke-width="0.02"/>
${body}</svg>`;
  }
}
