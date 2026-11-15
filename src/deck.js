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
    const glued = (i, j) => { const q = flat(i, j); return segs.every(([a, b, w]) => dseg(q, a, b) > w / 2); };

    // folded geometry: u -> (z, y); web A rises, web B falls
    const fold = (u) => u <= S ? [u * Math.cos(th), u * Math.sin(th)] : [u * Math.cos(th), (2 * S - u) * Math.sin(th)];
    const nrm = (u) => u <= S ? [0, Math.cos(th), -Math.sin(th)] : [0, Math.cos(th), Math.sin(th)];
    const layer = (s) => ({
      name: s > 0 ? 'outer sheet' : 'inner sheet', nu, nv, flat,
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
    this.top = top;
    this.fab = new Fabric({ pieces: [layer(1), layer(-1)], seams, head: (y) => top - y });

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
      const iTop = (nu - 1) / 2, off = Math.round(p.chord / 2 / p.grid);
      for (let j = 0; j < nv; j++) for (const pc of [0, 1]) for (const d of [-off, off]) F.pinned[F.gid(pc, Math.round(iTop + d), j)] = 1;
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

  step() { return this.fab.step(); }
  get residual() { return this.fab.residual; }
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
      const w = i === 0 || i === nu - 1 ? 0.5 : 1;
      V += s * du * dx * w * (Math.PI / 4);
      if (Math.abs(i - iTop) <= 1) topT = Math.max(topT, s);
      else if (i > 0.15 * nu && i < 0.35 * nu) diagT = Math.max(diagT, s);
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
