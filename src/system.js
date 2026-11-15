// Grid formwork system (BE1024818B1, figs. 1–8), no DOM.
//
// One foldable textile formwork made of:
//   17  conical "bottle" columns with a cylindrical neck 19, on a square grid (spacing T)
//   21  horizontal base tubes linking the column feet; with the feet they form the
//       base 22 and leave circular openings 25 between every four columns
//   20  (optional) perimeter wall of touching vertical cylinders (fig. 1–4)
//   27  flat textile panels hung between the column necks that carry the
//       top slab 3 poured on them (figs. 7–8)
//
// Columns, base tubes and walls are filled in one pour through the necks, so
// they share one hydrostatic head. The slab is poured later, after the
// columns have cured, and loads only the panels.
//
// Every element of one type is identical, so each type is simulated once and
// instanced over the layout (interaction between neighbours is not modelled).

import { verticalTube, horizontalTube, sagPanel, bottleProfile, RHO_CONCRETE } from './membrane.js';

export const GRID_DEFAULTS = {
  nx: 3, nz: 3,          // columns
  spacing: 1.6,          // m, T: centre-to-centre
  height: 1.5,           // m, column pattern length
  hang: 0.95,            // top-ring height / pattern length
  foot: 1.9,             // m, circumference of the flared foot
  body: 1.25,            // m, circumference just above the foot
  neck: 0.32,            // m, circumference of the neck 19
  neckZone: 0.16,
  footZone: 0.14,
  tube: 0.9,             // m, circumference of base tubes 21
  walls: false,          // perimeter wall of cylinders 20
  wall: 0.75,            // m, circumference of a wall cylinder
  panels: false,         // soffit panels 27
  panelSlack: 0.04,      // extra cloth in each panel
  slab: false,           // top slab 3 poured on the panels
  slabThickness: 0.18,
  fill: 1.0,             // pour level of the column pour (fraction of column height)
  fabricWeight: 0.4,
};

const C2R = (c) => c / (2 * Math.PI);

export class GridSystem {
  constructor(params = {}) {
    this.p = { ...GRID_DEFAULTS, ...params };
    this.build();
  }

  build() {
    const p = this.p;
    const top = p.height * p.hang;
    const fill = top * p.fill;
    this.top = top;
    this.fillY = fill;
    this.slabTop = top + p.slabThickness;
    const rFoot = C2R(p.foot), rTube = C2R(p.tube), rWall = C2R(p.wall);
    this.rFoot = rFoot;
    const fw = p.fabricWeight;

    this.parts = {};
    this.parts.column = verticalTube({
      length: p.height, top, fill, fabricWeight: fw,
      width: bottleProfile({ foot: p.foot, body: p.body, neck: p.neck, neckZone: p.neckZone, footZone: p.footZone }),
      rBottom: rFoot * 0.9, rTop: C2R(p.neck) * 0.95, nu: 40, nv: 44,
    });

    // base tube between two neighbouring column feet; ends sit inside the feet
    const inset = rFoot * 0.75;
    const span = p.spacing - 2 * inset;
    this.tubeSpan = span;
    if (span > 0.05) {
      this.parts.tube = horizontalTube({
        x0: -span / 2, x1: span / 2, length: span * 1.02, circ: p.tube,
        rEnd: Math.min(rTube * 0.9, rFoot * 0.6), fill, fabricWeight: fw, nu: 28, nv: 28,
      });
    }

    // perimeter: wall cylinders at T/2 outside the outer columns + short edge tubes
    this.wallLine = p.spacing / 2 + rWall; // offset of wall centre line from the outer column axes
    if (p.walls) {
      this.parts.wall = verticalTube({
        length: top * 1.01, top, fill, fabricWeight: fw,
        width: () => p.wall, rBottom: rWall, rTop: rWall, nu: 24, nv: 28,
      });
      const espan = this.wallLine - rWall * 0.6 - inset;
      this.edgeSpan = espan;
      if (espan > 0.05) {
        this.parts.edge = horizontalTube({
          x0: -espan / 2, x1: espan / 2, length: espan * 1.02, circ: p.tube,
          rEnd: Math.min(rTube * 0.9, rFoot * 0.6), fill, fabricWeight: fw, nu: 28, nv: 16,
        });
      }
    }

    if (p.panels) {
      this.parts.panel = sagPanel({
        span: p.spacing, y0: top, slack: p.panelSlack,
        slabTop: p.slab ? this.slabTop : -1, fabricWeight: fw, n: 29,
      });
    }
    this.layout();
    this.iter = 0;
  }

  // world placement of every instance: {part, x, z, rotY}
  layout() {
    const p = this.p, T = p.spacing;
    const X = (i) => (i - (p.nx - 1) / 2) * T;
    const Z = (k) => (k - (p.nz - 1) / 2) * T;
    const out = [];
    for (let i = 0; i < p.nx; i++) for (let k = 0; k < p.nz; k++) out.push({ part: 'column', x: X(i), z: Z(k), rotY: 0 });
    if (this.parts.tube) {
      for (let i = 0; i < p.nx - 1; i++) for (let k = 0; k < p.nz; k++) out.push({ part: 'tube', x: X(i) + T / 2, z: Z(k), rotY: 0 });
      for (let i = 0; i < p.nx; i++) for (let k = 0; k < p.nz - 1; k++) out.push({ part: 'tube', x: X(i), z: Z(k) + T / 2, rotY: Math.PI / 2 });
    }
    if (this.parts.panel) {
      for (let i = 0; i < p.nx - 1; i++) for (let k = 0; k < p.nz - 1; k++) out.push({ part: 'panel', x: X(i) + T / 2, z: Z(k) + T / 2, rotY: 0 });
    }
    if (this.parts.wall) {
      const ex = X(p.nx - 1) + this.wallLine, ez = Z(p.nz - 1) + this.wallLine;
      const d = p.wall / Math.PI; // touching cylinders
      const side = (x0, z0, x1, z1) => {
        const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / d));
        for (let s = 0; s < n; s++) {
          const t = s / n;
          out.push({ part: 'wall', x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rotY: 0 });
        }
      };
      side(-ex, -ez, ex, -ez); side(ex, -ez, ex, ez); side(ex, ez, -ex, ez); side(-ex, ez, -ex, -ez);
      if (this.parts.edge) {
        const off = this.rFoot * 0.75 + this.edgeSpan / 2;
        for (let k = 0; k < p.nz; k++) {
          out.push({ part: 'edge', x: X(0) - off, z: Z(k), rotY: 0 });
          out.push({ part: 'edge', x: X(p.nx - 1) + off, z: Z(k), rotY: 0 });
        }
        for (let i = 0; i < p.nx; i++) {
          out.push({ part: 'edge', x: X(i), z: Z(0) - off, rotY: Math.PI / 2 });
          out.push({ part: 'edge', x: X(i), z: Z(p.nz - 1) + off, rotY: Math.PI / 2 });
        }
      }
    }
    this.instances = out;
    this.extent = {
      x: this.parts.wall ? X(p.nx - 1) + this.wallLine + C2R(p.wall) : X(p.nx - 1) + this.rFoot,
      z: this.parts.wall ? Z(p.nz - 1) + this.wallLine + C2R(p.wall) : Z(p.nz - 1) + this.rFoot,
    };
  }

  step() {
    let r = 0;
    for (const m of Object.values(this.parts)) if (m.residual >= 1e-5 || m.iter < 3) r = Math.max(r, m.step());
    this.iter++;
    this.residual = Math.max(...Object.values(this.parts).map((m) => m.residual));
    return this.residual;
  }

  run(maxIter = 600) {
    for (let i = 0; i < maxIter; i++) if (this.step() < 1e-5) break;
    return this;
  }

  count(part) { return this.instances.filter((s) => s.part === part).length; }

  // volume enclosed by a tube, sliced perpendicular to its axis ('y' or 'x')
  static tubeVolume(m, axis, clipY = Infinity) {
    const { pos, nu, nv } = m;
    const a = axis === 'y' ? 1 : 0;           // axis component
    const [u, v] = axis === 'y' ? [0, 2] : [1, 2];
    let V = 0, pa = null, ps = null;
    for (let j = 0; j < nv; j++) {
      let A = 0, s = 0;
      for (let i = 0; i < nu; i++) {
        const k = (j * nu + i) * 3, l = (j * nu + ((i + 1) % nu)) * 3;
        // clip the section at the pour level (only relevant for horizontal tubes)
        const ku = axis === 'x' ? Math.min(pos[k + u], clipY) : pos[k + u];
        const lu = axis === 'x' ? Math.min(pos[l + u], clipY) : pos[l + u];
        A += ku * pos[l + v] - lu * pos[k + v];
        s += pos[k + a];
      }
      A = Math.abs(A) / 2; s /= nu;
      if (pa !== null) {
        let ds = Math.abs(s - ps);
        if (axis === 'y') ds = Math.max(0, Math.min(s, clipY) - Math.min(ps, clipY));
        V += ((A + pa) / 2) * ds;
      }
      pa = A; ps = s;
    }
    return V;
  }

  // slab concrete above one panel: sum (slabTop - y) over cells
  panelSlabVolume() {
    const m = this.parts.panel;
    if (!m || !this.p.slab) return 0;
    const { pos, nu, nv } = m;
    const cell = (this.p.spacing / (nu - 1)) ** 2;
    let V = 0;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const k = (j * nu + i) * 3;
      V += (this.slabTop - pos[k + 1]) * cell;
    }
    return V;
  }

  stats() {
    const P = this.parts, s = {};
    s.columns = this.count('column');
    s.vColumn = GridSystem.tubeVolume(P.column, 'y', this.fillY);
    s.vTube = P.tube ? GridSystem.tubeVolume(P.tube, 'x', this.fillY) : 0;
    s.vWall = P.wall ? GridSystem.tubeVolume(P.wall, 'y', this.fillY) : 0;
    s.vEdge = P.edge ? GridSystem.tubeVolume(P.edge, 'x', this.fillY) : 0;
    s.vPanelSlab = this.panelSlabVolume();
    s.pourVolume = s.vColumn * s.columns + s.vTube * this.count('tube') + s.vWall * this.count('wall') + s.vEdge * this.count('edge');
    s.slabVolume = s.vPanelSlab * this.count('panel');
    s.mass = ((s.pourVolume + s.slabVolume) * RHO_CONCRETE) / 1000;
    s.footprint = 4 * this.extent.x * this.extent.z;
    s.strain = Math.max(...Object.values(P).map((m) => m.maxStrain()));
    s.sag = P.panel ? this.top - Math.min(...Array.from({ length: P.panel.pos.length / 3 }, (_, i) => P.panel.pos[i * 3 + 1])) : 0;
    return s;
  }
}

// Cut list: flat pattern outlines (metres) for each part type, with counts.
GridSystem.prototype.cutList = function () {
  const p = this.p, out = [];
  const prof = bottleProfile({ foot: p.foot, body: p.body, neck: p.neck, neckZone: p.neckZone, footZone: p.footZone });
  const N = 60, colL = [], colR = [];
  for (let j = 0; j <= N; j++) {
    const t = j / N, w = prof(t) / 2, s = t * p.height;
    colL.push([-w, s]); colR.push([w, s]);
  }
  out.push({ name: 'Column 17 (sewn into a tube)', count: this.count('column'), outline: [...colL, ...colR.reverse()] });
  const rect = (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  if (this.parts.tube) out.push({ name: 'Base tube 21', count: this.count('tube'), outline: rect(p.tube, this.tubeSpan * 1.02) });
  if (this.parts.edge) out.push({ name: 'Edge tube 21', count: this.count('edge'), outline: rect(p.tube, this.edgeSpan * 1.02) });
  if (this.parts.wall) out.push({ name: 'Wall cylinder 20', count: this.count('wall'), outline: rect(p.wall, this.top * 1.01) });
  if (this.parts.panel) { const L = p.spacing * (1 + p.panelSlack); out.push({ name: 'Soffit panel 27', count: this.count('panel'), outline: rect(L, L) }); }
  return out;
};

GridSystem.prototype.cutListSVG = function (seam = 0.015) {
  const parts = this.cutList();
  const gap = 0.15;
  let x = 0, H = 0, body = '';
  for (const part of parts) {
    const xs = part.outline.map((q) => q[0]), ys = part.outline.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 2 * seam, h = Math.max(...ys) + 2 * seam;
    const ox = x + w / 2, oy = 0.12 + seam;
    const pts = part.outline.map(([px, py]) => `${(ox + px).toFixed(4)},${(oy + h - 2 * seam - py).toFixed(4)}`).join(' ');
    body += `<g><text x="${(x).toFixed(3)}" y="0.07" font-size="0.05" font-family="sans-serif">${part.name} ×${part.count}</text>
<polygon points="${pts}" fill="none" stroke="#000" stroke-width="0.002"/></g>\n`;
    x += Math.max(w, 0.9) + gap;
    H = Math.max(H, h + 0.15);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(x * 1000).toFixed(0)}mm" height="${(H * 1000).toFixed(0)}mm" viewBox="0 0 ${x.toFixed(4)} ${H.toFixed(4)}">
<!-- sewing lines at 1:1; add ${seam * 1000} mm seam allowance when cutting -->
${body}</svg>`;
};
