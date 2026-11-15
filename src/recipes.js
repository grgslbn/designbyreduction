// Shape catalogue: one production recipe per family (no DOM).
// Every recipe starts from flat cloth and only uses cut / sew / stitch / tack /
// glue / cut-out / dart / tether / fold-flat operations. The shape is what the
// hydrostatic pressure of the concrete makes of it.

import { Fabric, RHO, G } from './engine.js';

const TAU = Math.PI * 2;
const m = (v) => `${v.toFixed(2)} m`;
const cm = (v) => `${(v * 100).toFixed(0)} cm`;
const pct = (v) => `${Math.round(v * 100)}%`;
const int = (v) => `${v}`;
const kpa = (h) => `${((RHO * G * h) / 1000).toFixed(0)} kPa`;

// ------------------------------------------------------------ piece helpers

function outlineOf(p) {
  // boundary of a structured piece in flat coordinates (CCW-ish walk)
  const pts = [];
  const nu = p.wrap ? p.nu : p.nu - 1;
  for (let i = 0; i <= nu; i++) pts.push(p.flat(i, 0));
  for (let j = 1; j < p.nv; j++) pts.push(p.flat(nu, j));
  for (let i = nu - 1; i >= 0; i--) pts.push(p.flat(i, p.nv - 1));
  for (let j = p.nv - 2; j > 0; j--) pts.push(p.flat(0, j));
  return pts;
}

/**
 * Two identical layers sewn round the perimeter (family A, H).
 *  join(i,j)  -> node stitched/tacked/glued through both layers
 *  hole(i,j)  -> cell glued and cut out (rim nodes are joined automatically)
 */
function twoLayer({ nu, nv, flat, y0 = 0, join = () => false, hole = null, pinBottom = false, bump = 0.002, fullness = 0 }) {
  // fullness: the top layer is cut larger than the bottom by this fraction (eased in between the same stitch points)
  const topFlat = fullness ? (i, j) => { const f = flat(i, j); return [f[0] * (1 + fullness), f[1] * (1 + fullness)]; } : flat;
  const top = {
    name: 'top layer', nu, nv, flat: topFlat, hole,
    init: (i, j) => { const f = flat(i, j); return [f[0], y0 + bump * (1 + Math.sin(i * 1.3) * Math.cos(j * 1.7)), f[1]]; },
    outward: () => [0, 1, 0],
  };
  const bottom = {
    name: 'bottom layer', nu, nv, flat, hole,
    init: (i, j) => { const f = flat(i, j); return [f[0], y0, f[1]]; },
    outward: () => [0, -1, 0],
    pin: pinBottom ? () => true : null,
  };
  const seams = [];
  const rim = (i, j) => hole && [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]].some(([a, b]) => a >= 0 && b >= 0 && a < nu - 1 && b < nv - 1 && hole(a, b));
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const edge = i === 0 || j === 0 || i === nu - 1 || j === nv - 1;
    if (edge || join(i, j) || rim(i, j)) seams.push([0, i, j, 1, i, j]);
  }
  return { pieces: [top, bottom], seams };
}

const rectFlat = (W, D, nu, nv) => (i, j) => [(i / (nu - 1) - 0.5) * W, (j / (nv - 1) - 0.5) * D];

// ------------------------------------------------------------ recipes

export const RECIPES = [];
const recipe = (r) => RECIPES.push(r);

// A1 -------------------------------------------------------------------------
recipe({
  id: 'pillow', family: 'A', name: 'Pillow block',
  summary: 'Two identical rectangles sewn round the edge. The basic cell: thickness follows width. A long cell approaches a round section (about 0.6 × width); a square cell stays flatter because its corners wrinkle.',
  params: [
    ['W', 'Width', 0.3, 1.5, 0.01, 0.6, m],
    ['D', 'Length', 0.3, 2, 0.01, 1.0, m],
    ['head', 'Standpipe height (pump head)', 0.3, 2, 0.05, 1.0, m],
  ],
  steps: ['Cut 2 identical rectangles.', 'Sew or weld the perimeter, leaving a filling sleeve in one corner.', 'Lay flat on the ground and fill through a standpipe until full.'],
  build(p) {
    const nu = 25, nv = Math.round(25 * p.D / p.W) | 1;
    const { pieces, seams } = twoLayer({ nu, nv, flat: rectFlat(p.W, p.D, nu, nv) });
    const fab = new Fabric({ pieces, seams, head: (y) => p.head - y });
    return { fab, marks: [[], []] };
  },
  readout(fab, p) {
    const b = fab.bounds(), t = b.max[1];
    return [['Thickness', cm(t)], ['Thickness / width', (t / Math.min(p.W, p.D)).toFixed(2)], ['Volume', `${(fab.volume() * 1000).toFixed(0)} L`], ['Fill pressure', kpa(p.head)]];
  },
});

// A2 -------------------------------------------------------------------------
recipe({
  id: 'quilted', family: 'A', name: 'Quilted slab',
  summary: 'Two layers tacked through on a square grid. Each cell inflates into a pillow, and the tacks become dimples on both faces. A light slab without moulds.',
  params: [
    ['W', 'Slab width', 0.8, 3, 0.05, 1.6, m],
    ['cells', 'Cells per side', 2, 8, 1, 4, int],
    ['head', 'Standpipe height', 0.3, 2, 0.05, 1.0, m],
  ],
  steps: ['Cut 2 identical squares.', 'Mark the tack grid and stitch (or rivet) both layers together at every grid point.', 'Sew the perimeter.', 'Fill flat on the ground through a standpipe.'],
  build(p) {
    const k = 6, nu = p.cells * k + 1;
    const join = (i, j) => i % k === 0 && j % k === 0;
    const { pieces, seams } = twoLayer({ nu, nv: nu, flat: rectFlat(p.W, p.W, nu, nu), join });
    const fab = new Fabric({ pieces, seams, head: (y) => p.head - y });
    const dots = [];
    for (let j = k; j < nu - 1; j += k) for (let i = k; i < nu - 1; i += k) dots.push(rectFlat(p.W, p.W, nu, nu)(i, j));
    return { fab, marks: [[{ type: 'dots', pts: dots }], [{ type: 'dots', pts: dots }]] };
  },
  readout(fab, p) {
    const t = fab.bounds().max[1], cell = p.W / p.cells;
    return [['Max thickness', cm(t)], ['Cell size', cm(cell)], ['Thickness / cell', (t / cell).toFixed(2)], ['Volume', `${(fab.volume() * 1000).toFixed(0)} L`], ['Concrete / m²', `${(fab.volume() / (p.W * p.W) * 100).toFixed(1)} cm avg`]];
  },
});

// A3 -------------------------------------------------------------------------
recipe({
  id: 'ribbed', family: 'A', name: 'Ribbed slab, depth follows the span',
  summary: 'Stitch lines run along the span. Rib channels are cut wide in the middle and narrow at the supports, with flange channels in between, so the ribs come out deepest where the bending is largest.',
  params: [
    ['L', 'Span', 1.5, 5, 0.1, 3, m],
    ['ribs', 'Ribs', 2, 6, 1, 3, int],
    ['pitch', 'Rib pitch', 0.3, 0.9, 0.01, 0.5, m],
    ['wMid', 'Rib channel at mid-span', 0.1, 0.8, 0.01, 0.36, m],
    ['wEnd', 'Rib channel at supports', 0.05, 0.6, 0.01, 0.14, m],
    ['head', 'Standpipe height', 0.3, 2, 0.05, 1.0, m],
  ],
  steps: ['Cut 2 identical rectangles (span × ribs × pitch).', 'Draw the curved stitch lines: each rib channel widens towards mid-span and the flange channel between ribs narrows by the same amount.', 'Stitch both layers together along every line.', 'Sew the perimeter and fill flat.'],
  build(p) {
    const m4 = 4, nCh = p.ribs * 2 + 1, nv = nCh * m4 + 1, nu = 49;
    const W = p.ribs * p.pitch;
    const wRib = (x) => p.wEnd + (Math.min(p.wMid, p.pitch * 0.9) - p.wEnd) * Math.sin(Math.PI * x);
    // channels across the width: half flange, rib, flange, rib, ..., rib, half flange
    const widths = (x) => {
      const r = wRib(x), f = p.pitch - r, w = [f / 2];
      for (let k = 0; k < p.ribs; k++) { w.push(r); w.push(k === p.ribs - 1 ? f / 2 : f); }
      return w;
    };
    const flatW = (i, j) => {
      const x = i / (nu - 1), w = widths(x);
      const ch = Math.min(Math.floor(j / m4), nCh - 1), u = (j - ch * m4) / m4;
      let z = 0;
      for (let c = 0; c < ch; c++) z += w[c];
      return [(x - 0.5) * p.L, z + u * w[ch] - W / 2];
    };
    // rib channels are odd; flange channels are even and get an extra stitch
    // line down their middle so they stay thin (the slab plate between ribs)
    const join = (i, j) => { const ch = Math.floor(j / m4); return j % m4 === 0 || (ch % 2 === 0 && j % 2 === 0); };
    const { pieces, seams } = twoLayer({ nu, nv, flat: flatW, join });
    const fab = new Fabric({ pieces, seams, head: (y) => p.head - y });
    const lines = [];
    for (let j = 2; j < nv - 1; j += 2) { if (j % m4 && Math.floor(j / m4) % 2) continue; const pts = []; for (let i = 0; i < nu; i++) pts.push(flatW(i, j)); lines.push({ type: 'line', pts }); }
    this._nu = nu; this._nv = nv; this._m4 = m4;
    return { fab, marks: [lines, lines] };
  },
  readout(fab, p) {
    // rib depth at mid-span vs near the supports
    const { pos } = fab;
    let mid = 0, end = 0;
    for (let i = 0; i < fab.nCloth; i++) {
      const x = pos[i * 3] / p.L + 0.5, y = pos[i * 3 + 1];
      if (Math.abs(x - 0.5) < 0.04) mid = Math.max(mid, y);
      if (Math.abs(x - 0.08) < 0.04) end = Math.max(end, y);
    }
    return [['Rib depth, mid-span', cm(mid)], ['Rib depth, near support', cm(end)], ['Volume', `${(fab.volume() * 1000).toFixed(0)} L`], ['Concrete / m²', `${(fab.volume() / (p.L * p.ribs * p.pitch) * 100).toFixed(1)} cm avg`]];
  },
});

// A4 -------------------------------------------------------------------------
recipe({
  id: 'screen', view: { stand: 'panel' }, family: 'A', name: 'Perforated screen',
  summary: 'Two layers glued together in round patches, and each patch is then cut out. The holes go right through, and the concrete flows round them as a lattice. Cast flat, then stood up.',
  params: [
    ['W', 'Panel width', 0.8, 2.5, 0.05, 1.4, m],
    ['D', 'Panel height', 0.8, 3, 0.05, 2.0, m],
    ['n', 'Holes across', 2, 6, 1, 3, int],
    ['hole', 'Hole size', 0.2, 0.8, 0.01, 0.55, pct],
    ['head', 'Standpipe height', 0.3, 2, 0.05, 0.8, m],
  ],
  steps: ['Cut 2 identical rectangles.', 'Glue the two layers together in a ring around each hole position (heat-bond or adhesive).', 'Cut out the centre of each ring: the hole goes through both layers.', 'Sew the perimeter, fill flat, then tilt the cured panel upright.'],
  build(p) {
    const k = 8, nu = p.n * k + 1, rows = Math.max(2, Math.round(p.n * p.D / p.W)), nv = rows * k + 1;
    const flat = (i, j) => [(i / (nu - 1) - 0.5) * p.W, (j / (nv - 1) - 0.5) * p.D];
    const R = (k / 2) * p.hole;
    const hole = (i, j) => {
      const ci = Math.floor(i / k) * k + k / 2, cj = Math.floor(j / k) * k + k / 2;
      return Math.hypot(i + 0.5 - ci, j + 0.5 - cj) < R;
    };
    const { pieces, seams } = twoLayer({ nu, nv, flat, hole });
    const fab = new Fabric({ pieces, seams, head: (y) => p.head - y });
    const circles = [];
    for (let a = 0; a < p.n; a++) for (let b = 0; b < rows; b++) {
      const c = flat(a * k + k / 2, b * k + k / 2), r = R * p.W / (nu - 1), pts = [];
      for (let t = 0; t <= 24; t++) pts.push([c[0] + Math.cos((t / 24) * TAU) * r, c[1] + Math.sin((t / 24) * TAU) * r]);
      circles.push({ type: 'cut', pts });
    }
    return { fab, marks: [circles, circles] };
  },
  readout(fab, p) {
    const t = fab.bounds().max[1];
    return [['Max thickness', cm(t)], ['Holes', `${p.n * Math.max(2, Math.round(p.n * p.D / p.W))}`], ['Volume', `${(fab.volume() * 1000).toFixed(0)} L`]];
  },
});

// H1 -------------------------------------------------------------------------
recipe({
  id: 'board', view: { stand: 'panel' }, family: 'H', name: 'Wall panel on a board',
  summary: 'The bottom layer lies on a flat casting table and the top layer is stitched in diagonal lines. One face comes out flat and the other pillowed: a precast panel with a flat inside and a textured outside.',
  params: [
    ['W', 'Panel width', 0.8, 3, 0.05, 1.8, m],
    ['D', 'Panel height', 0.8, 3, 0.05, 1.2, m],
    ['k', 'Diamond size (grid cells)', 4, 12, 2, 8, int],
    ['fullness', 'Front layer cut larger by', 0, 0.3, 0.01, 0.12, pct],
    ['head', 'Standpipe height', 0.3, 2, 0.05, 0.8, m],
  ],
  steps: ['Cut the back layer to size, and the front layer larger by the chosen fullness. The back is held flat by the table, so without fullness the front cannot bulge.', 'Mark the same diamond grid on both layers (scaled on the front) and stitch them together along the lines, easing the extra front cloth in.', 'Sew the perimeter. Lay it on a flat casting table, bottom layer down.', 'Fill. The table keeps the back flat; the front pillows between the stitch lines.'],
  build(p) {
    const nu = 49, nv = Math.max(9, Math.round(48 * p.D / p.W)) + 1;
    const k = p.k;
    const join = (i, j) => (i + j) % k === 0 || ((i - j) % k + k) % k === 0;
    const { pieces, seams } = twoLayer({ nu, nv, flat: rectFlat(p.W, p.D, nu, nv), join, pinBottom: true, fullness: p.fullness });
    const fab = new Fabric({ pieces, seams, head: (y) => p.head - y });
    const f = rectFlat(p.W, p.D, nu, nv), lines = [];
    for (let c = -nv; c < nu + nv; c += k) {
      const a = [], b = [];
      for (let i = 0; i < nu; i++) { const j1 = c - i, j2 = i - c; if (j1 >= 0 && j1 < nv) a.push(f(i, j1)); if (j2 >= 0 && j2 < nv) b.push(f(i, j2)); }
      if (a.length > 1) lines.push({ type: 'line', pts: a });
      if (b.length > 1) lines.push({ type: 'line', pts: b });
    }
    const sc = (L) => L.map((mk) => ({ ...mk, pts: mk.pts.map(([x, y]) => [x * (1 + p.fullness), y * (1 + p.fullness)]) }));
    return { fab, marks: [sc(lines), lines] };
  },
  readout(fab, p) {
    const t = fab.bounds().max[1];
    return [['Max thickness', cm(t)], ['Back face', 'flat (board)'], ['Volume', `${(fab.volume() * 1000).toFixed(0)} L`]];
  },
});

// B1 -------------------------------------------------------------------------
recipe({
  id: 'twisted', family: 'B', name: 'Twisted fluted column',
  summary: 'A rolled tube with internal tethers sewn along helical lines to a central cord. The flutes spiral up the column.',
  params: [
    ['H', 'Height', 1, 4, 0.05, 2.6, m],
    ['C', 'Circumference', 0.5, 2, 0.01, 1.0, m],
    ['flutes', 'Tether lines', 3, 12, 1, 6, int],
    ['turns', 'Twist (turns)', 0, 1.5, 0.05, 0.5, (v) => `${v.toFixed(2)}`],
    ['depth', 'Tether length', 0.4, 0.95, 0.01, 0.6, pct],
  ],
  steps: ['Cut 1 rectangle (circumference × height).', 'Draw the helical tether lines and sew a tether tape along each one.', 'Roll it up, sew the long seam, and tie the tethers to a central cord or the rebar cage.', 'Hang it between a base ring and a top ring, and pour from the top.'],
  build(p) {
    const nu = 48, nv = 56, r = p.C / TAU, top = p.H * 0.97;
    const tube = {
      name: 'tube', nu, nv, wrap: true,
      flat: (i, j) => [(i / nu) * p.C, (j / (nv - 1)) * p.H],
      init: (i, j) => { const a = (i / nu) * TAU, t = j / (nv - 1), rr = j === 0 || j === nv - 1 ? r : r * 0.8; return [Math.cos(a) * rr, t * top, Math.sin(a) * rr]; },
      outward: (q) => [q[0], 0, q[2]],
      pin: (i, j) => j === 0 || j === nv - 1,
    };
    const anchors = [], cordList = [], marks = [];
    const tether = [];
    for (let f = 0; f < p.flutes; f++) {
      const pts = [];
      for (let j = 2; j < nv - 2; j++) {
        const i = Math.round((f / p.flutes) * nu + p.turns * nu * (j / (nv - 1)));
        tether.push([((i % nu) + nu) % nu, j]);
        pts.push([((((i % nu) + nu) % nu) / nu) * p.C, (j / (nv - 1)) * p.H]);
      }
      // split at wrap-around for drawing
      let seg = [pts[0]];
      for (let q = 1; q < pts.length; q++) { if (Math.abs(pts[q][0] - pts[q - 1][0]) > p.C / 2) { marks.push({ type: 'line', pts: seg }); seg = []; } seg.push(pts[q]); }
      marks.push({ type: 'line', pts: seg });
    }
    tether.forEach(([i, j]) => anchors.push([0, (j / (nv - 1)) * top, 0]));
    const fab = new Fabric({
      pieces: [tube], anchors, head: (y) => top - y,
      cords: [], // filled below once global ids exist
    });
    // add tether cords: node -> its own axis anchor
    const extra = [];
    tether.forEach(([i, j], k) => extra.push(fab.gid(0, i, j), fab.nCloth + k, r * p.depth));
    appendCords(fab, extra);
    return { fab, marks: [marks] };
  },
  readout(fab, p) {
    return [['Height', m(p.H * 0.97)], ['Base pressure', kpa(p.H * 0.97)], ['Volume', `${(fab.volume([0, p.H * 0.485, 0]) * 1000).toFixed(0)} L (≈)`], ['Max fabric strain', `${(fab.maxStrain() * 100).toFixed(1)} %`]];
  },
});

// C1 -------------------------------------------------------------------------
recipe({
  id: 'arch', view: { stand: 'arch' }, family: 'C', name: 'Arch rib from a darted tube',
  summary: 'Darts sewn along one side of a tube make that side shorter, so the tube curves when filled. It is cast lying on the ground, with both ends tied off and one end held, then stood up as an arch rib.',
  params: [
    ['L', 'Tube length', 2, 8, 0.1, 5, m],
    ['C', 'Circumference', 0.4, 1.5, 0.01, 0.8, m],
    ['dart', 'Cloth taken out on inner side', 0, 0.45, 0.01, 0.25, pct],
    ['head', 'Standpipe height', 0.3, 2, 0.05, 0.8, m],
  ],
  steps: ['Cut 1 rectangle (circumference × length).', 'Sew a row of darts along one long side. Their total width takes out the chosen share of the length on that side.', 'Roll it up and sew the long seam. Gather and tie off both ends around a filling sleeve.', 'Lay it on the ground and fill from one end. It curls by itself. After curing, lift it upright.'],
  build(p) {
    const nu = 32, nv = 72, r = p.C / TAU;
    const k = p.dart;
    // inner side (theta = 0) shortened by k, outer side full length
    const shrink = (i) => 1 - k * (1 + Math.cos((i / nu) * TAU)) / 2;
    const kappa = k / (2 * r * (1 - k / 2) + 1e-9);
    const Lc = p.L * (1 - k / 2);
    const R = kappa > 1e-6 ? 1 / kappa : Infinity;
    // initial centreline: arc of the predicted curvature, lying in the xz plane at y = r
    const cl = (s) => {
      if (!isFinite(R)) return { c: [s - Lc / 2, r, 0], n: [0, 0, 1] };
      const a = s / R - Lc / (2 * R);
      return { c: [R * Math.sin(a), r, R - R * Math.cos(a)], n: [-Math.sin(a), 0, Math.cos(a)] }; // n points to centre
    };
    const tube = {
      name: 'tube', nu, nv, wrap: true,
      flat: (i, j) => [(i / nu) * p.C, (j / (nv - 1)) * p.L * shrink(i)],
      init: (i, j) => {
        const s = (j / (nv - 1)) * Lc, { c, n } = cl(s), th = (i / nu) * TAU;
        const rr = j === 0 || j === nv - 1 ? r * 0.05 : r * 0.9;
        // theta=0 -> towards centre of curvature (inner side), theta=90° -> up
        return [c[0] + rr * Math.cos(th) * n[0], c[1] + rr * Math.sin(th), c[2] + rr * Math.cos(th) * n[2]];
      },
      outward: (q) => [0, 1, 0], // replaced below
      pin: (i, j) => j === 0,
    };
    // outward = away from centreline: approximate with nearest centreline point
    tube.outward = (q) => {
      let best = null, bd = Infinity;
      for (let s = 0; s <= Lc; s += Lc / 60) { const { c } = cl(s); const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; best = c; } }
      return [q[0] - best[0], q[1] - best[1], q[2] - best[2]];
    };
    // tie off both ends: gather each end ring into one point
    const seams = [];
    for (let i = 1; i < nu; i++) { seams.push([0, 0, 0, 0, i, 0]); seams.push([0, 0, nv - 1, 0, i, nv - 1]); }
    const fab = new Fabric({ pieces: [tube], seams, head: (y) => p.head - y });
    this._pred = { kappa, R };
    // darts drawn as wedges on the cut pattern
    const nd = Math.max(3, Math.round(p.L / 0.25)), marks = [];
    for (let d = 0; d < nd; d++) {
      const s = ((d + 0.5) / nd) * p.L, w = (k * p.L) / nd, depth = p.C * 0.45;
      marks.push({ type: 'dart', pts: [[p.C / 2 - depth / 2, s], [p.C / 2, s - w / 2], [p.C / 2 + depth / 2, s], [p.C / 2, s + w / 2]] });
    }
    return { fab, marks: [marks] };
  },
  readout(fab, p) {
    // fit a circle to the centreline (row centroids)
    const { nu, nv } = fab.pieces[0], P = fab.pos, cs = [];
    for (let j = 1; j < nv - 1; j++) { let x = 0, z = 0; for (let i = 0; i < nu; i++) { const g = fab.gid(0, i, j); x += P[g * 3]; z += P[g * 3 + 2]; } cs.push([x / nu, z / nu]); }
    const a = cs[0], b = cs[Math.floor(cs.length / 2)], c = cs[cs.length - 1];
    const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2, sag = Math.hypot(b[0] - mx, b[1] - mz);
    const Rm = sag > 1e-4 ? (chord * chord) / (8 * sag) + sag / 2 : Infinity;
    const r = p.C / TAU, k = p.dart, Rp = k > 0 ? (2 * r * (1 - k / 2)) / k : Infinity;
    return [['Stood up: span', m(chord)], ['Stood up: rise', m(sag)], ['Radius, simulated', isFinite(Rm) ? m(Rm) : '∞'], ['Radius, rule of thumb 2r(1−k/2)/k', isFinite(Rp) ? m(Rp) : '∞']];
  },
});

// E1 -------------------------------------------------------------------------
recipe({
  id: 'tree', family: 'E', name: 'Tree column (Y-branch)',
  summary: 'A trunk sleeve with two branch sleeves sewn onto its top. Each branch takes half of the trunk rim, and the two branches share a crotch seam across the middle. Poured from the branch tops.',
  params: [
    ['H', 'Overall height', 1.5, 4, 0.05, 2.8, m],
    ['split', 'Branching height', 0.25, 0.75, 0.01, 0.5, pct],
    ['C', 'Trunk circumference', 0.6, 2, 0.01, 1.1, m],
    ['Cb', 'Branch circumference (top)', 0.3, 1.2, 0.01, 0.6, m],
    ['spread', 'Branch spread', 0.3, 2.5, 0.05, 1.4, m],
  ],
  steps: ['Cut 1 trunk rectangle and 2 branch pieces. The bottom edge of each branch is half the trunk rim plus a crotch edge.', 'Roll and seam each sleeve.', 'Sew each branch to half of the trunk rim, then sew the two crotch edges to each other.', 'Hang the branch tops from the slab formwork, fix the trunk to the base ring, and pour from the branch tops.'],
  build(p) {
    const nu = 48, half = nu / 2, nvT = 30, nvB = 34;
    const hT = p.H * p.split, top = p.H * 0.97;
    const rT = p.C / TAU, rB = p.Cb / TAU;
    const crotch = 2 * rT * 1.15; // crotch edge, a little longer than the trunk diameter
    const trunk = {
      name: 'trunk', nu, nv: nvT, wrap: true,
      flat: (i, j) => [(i / nu) * p.C, (j / (nvT - 1)) * hT * 1.03],
      init: (i, j) => { const a = (i / nu) * TAU, rr = j === 0 ? rT : rT * 0.85; return [Math.cos(a) * rr, (j / (nvT - 1)) * hT, Math.sin(a) * rr]; },
      outward: (q) => [q[0], 0, q[2]],
      pin: (i, j) => j === 0,
    };
    const branch = (side) => {
      // bottom-edge flat coordinate: trunk half-rim, then crotch
      const xb = (i) => i <= half ? (i / half) * (p.C / 2) : p.C / 2 + ((i - half) / half) * crotch;
      const Wb = p.C / 2 + crotch, len = Math.hypot(p.spread / 2, top - hT) * 1.04;
      const tx = side * p.spread / 2;
      return {
        name: side < 0 ? 'branch A' : 'branch B', nu, nv: nvB, wrap: true,
        flat: (i, j) => { const t = j / (nvB - 1); return [xb(i) * (1 - t) + (i / nu) * p.Cb * t, t * len]; },
        init: (i, j) => {
          const t = j / (nvB - 1);
          // bottom ring position on trunk rim / crotch; top ring at branch top
          const a0 = side < 0 ? (i / half) * Math.PI : Math.PI + (i / half) * Math.PI;
          let b;
          if (i <= half) b = [Math.cos(a0) * rT, hT, Math.sin(a0) * rT];
          else { const u = (i - half) / half; b = [side < 0 ? -rT + 2 * rT * u : rT - 2 * rT * u, hT, 0]; }
          const a1 = (i / nu) * TAU + (side < 0 ? 0 : Math.PI);
          const e = [tx + Math.cos(a1) * rB, top, Math.sin(a1) * rB];
          const rr = t === 0 || t === 1 ? 1 : 0.9;
          return [b[0] * (1 - t) + e[0] * t, b[1] * (1 - t) + e[1] * t, (b[2] * (1 - t) + e[2] * t) * rr];
        },
        outward: (q) => [q[0] - tx * ((q[1] - hT) / (top - hT)), 0, q[2]],
        pin: (i, j) => j === nvB - 1,
      };
    };
    const A = branch(-1), B = branch(1);
    // branch A: rim nodes 0..half = trunk 0..half ; branch B: rim 0..half = trunk half..nu
    const seams = [];
    for (let i = 0; i <= half; i++) {
      seams.push([0, i, nvT - 1, 1, i, 0]);
      seams.push([0, (half + i) % nu, nvT - 1, 2, i, 0]);
    }
    // crotch: A(half+m) <-> B(nu-m)
    for (let mm = 1; mm < half; mm++) seams.push([1, half + mm, 0, 2, nu - mm, 0]);
    const fab = new Fabric({ pieces: [trunk, A, B], seams, head: (y) => top - y });
    return { fab, marks: [[], [], []] };
  },
  readout(fab, p) {
    const top = p.H * 0.97;
    return [['Height', m(top)], ['Base pressure', kpa(top)], ['Volume', `${(fab.volume([0, top / 2, 0]) * 1000).toFixed(0)} L (≈)`], ['Max fabric strain', `${(fab.maxStrain() * 100).toFixed(1)} %`]];
  },
});

// F1 -------------------------------------------------------------------------
recipe({
  id: 'beam', family: 'F', name: 'Beam with moment-shaped depth',
  summary: 'One sheet of cloth hung from two rails and closed by two end boards. It is cut wider at mid-span, so the beam comes out deepest where the bending moment is largest (fabric-formed beam).',
  params: [
    ['L', 'Span', 1.5, 6, 0.1, 3.6, m],
    ['b', 'Rail spacing (beam width)', 0.12, 0.5, 0.01, 0.22, m],
    ['wEnd', 'Cloth width at the ends', 0.3, 1, 0.01, 0.42, m],
    ['wMid', 'Cloth width at mid-span', 0.3, 2, 0.01, 1.05, m],
  ],
  steps: ['Cut 1 lens-shaped sheet: narrow at the ends, wide at mid-span (parabolic edges).', 'Clamp both long edges to two parallel rails at the top of the beam.', 'Close the ends with plywood end boards.', 'Pour from the top. The cloth sags into the depth profile.'],
  build(p) {
    const nu = 25, nv = 61, H = 1.2;
    const w = (t) => p.wEnd + (p.wMid - p.wEnd) * 4 * t * (1 - t);
    const flat = (i, j) => { const t = j / (nv - 1); return [(i / (nu - 1) - 0.5) * w(t), t * p.L]; };
    const uPoint = (u, wc) => {
      // U-shaped section of perimeter wc between the rails: down, across, up
      const e = Math.max(0.005, (wc - p.b) / 2), s = u * wc;
      if (s < e) return [-p.b / 2, H - s];
      if (s < e + p.b) return [-p.b / 2 + (s - e), H - e];
      return [p.b / 2, H - e + (s - e - p.b)];
    };
    const sheet = {
      name: 'sheet', nu, nv,
      flat,
      init: (i, j) => { const t = j / (nv - 1), q = uPoint(i / (nu - 1), (j === 0 || j === nv - 1) ? p.wEnd : Math.min(w(t), p.wEnd * 1.2)); return [(t - 0.5) * p.L, q[1], q[0]]; },
      outward: () => [0, -1, 0],
      pin: (i, j) => i === 0 || i === nu - 1 || j === 0 || j === nv - 1,
    };
    const fab = new Fabric({ pieces: [sheet], head: (y) => H - y });
    this._H = H;
    return { fab, marks: [[]] };
  },
  readout(fab, p) {
    const H = 1.2, { nu, nv } = fab.pieces[0], P = fab.pos;
    let V = 0, prevA = null, prevX = null, dMid = 0, dEnd = 0;
    for (let j = 0; j < nv; j++) {
      let A = 0, x = 0, dmax = 0;
      for (let i = 0; i < nu; i++) {
        const g = fab.gid(0, i, j), h = fab.gid(0, (i + 1) % nu, j);
        // close the section with the top line between the rails
        A += P[g * 3 + 2] * P[h * 3 + 1] - P[h * 3 + 2] * P[g * 3 + 1];
        x += P[g * 3]; dmax = Math.max(dmax, H - P[g * 3 + 1]);
      }
      A = Math.abs(A) / 2; x /= nu;
      if (prevA !== null) V += ((A + prevA) / 2) * Math.abs(x - prevX);
      prevA = A; prevX = x;
      if (j === Math.floor(nv / 2)) dMid = dmax;
      if (j === 3) dEnd = dmax;
    }
    return [['Depth at mid-span', cm(dMid)], ['Depth near the ends', cm(dEnd)], ['Depth / span', `1 : ${(p.L / dMid).toFixed(1)}`], ['Volume', `${(V * 1000).toFixed(0)} L`]];
  },
});

// F2 -------------------------------------------------------------------------
recipe({
  id: 'shell', family: 'F', name: 'Hanging shell (inverted)',
  summary: 'A square cloth hung from its four corners and loaded with a layer of concrete sags into a hanging-chain shape. Turned upside down after curing, it becomes a shell in compression. The concrete is draped on (sprayed or poured), not pumped in under pressure.',
  params: [
    ['S', 'Corner spacing', 1.5, 6, 0.1, 3, m],
    ['slack', 'Extra cloth', 0.02, 0.3, 0.01, 0.12, pct],
    ['t', 'Concrete layer', 0.02, 0.1, 0.005, 0.04, cm],
  ],
  steps: ['Cut 1 square, larger than the corner spacing by the chosen amount of extra cloth.', 'Reinforce the corners and hang them from 4 posts.', 'Apply an even layer of concrete or GFRC on the cloth.', 'After curing, turn it over: the hanging shape becomes a shell in compression.'],
  view: { flip: true },
  build(p) {
    const n = 37, L = p.S * (1 + p.slack), H = p.S * 0.8;
    const sheet = {
      name: 'cloth', nu: n, nv: n,
      flat: (i, j) => [(i / (n - 1) - 0.5) * L, (j / (n - 1) - 0.5) * L],
      init: (i, j) => [(i / (n - 1) - 0.5) * p.S, H - 0.02 * Math.sin(Math.PI * i / (n - 1)) * Math.sin(Math.PI * j / (n - 1)), (j / (n - 1) - 0.5) * p.S],
      outward: () => [0, -1, 0],
      // reinforced corner patches (a few cm of stiff tape) clamped to the posts
      pin: (i, j) => Math.min(i, n - 1 - i) + Math.min(j, n - 1 - j) <= 2,
    };
    const fab = new Fabric({ pieces: [sheet], weight: p.t, head: () => 0, ground: false });
    this._H = H;
    return { fab, marks: [[]] };
  },
  readout(fab, p) {
    const H = p.S * 0.8, b = fab.bounds(), rise = H - b.min[1];
    return [['Inverted: rise', m(rise)], ['Rise / span', `1 : ${(p.S / rise).toFixed(1)}`], ['Concrete', `${(p.S * p.S * (1 + p.slack) ** 2 * p.t).toFixed(2)} m³`]];
  },
});

// ------------------------------------------------------------ utilities

function appendCords(fab, triples) {
  const m0 = fab.cL.length, m = triples.length / 3;
  const grow = (arr, Ctor) => { const a = new Ctor(m0 + m); a.set(arr); return a; };
  fab.cA = grow(fab.cA, Uint32Array); fab.cB = grow(fab.cB, Uint32Array);
  fab.cL = grow(fab.cL, Float32Array); fab.cW = grow(fab.cW, Float32Array);
  for (let k = 0; k < m; k++) {
    fab.cA[m0 + k] = triples[3 * k]; fab.cB[m0 + k] = triples[3 * k + 1];
    fab.cL[m0 + k] = triples[3 * k + 2]; fab.cW[m0 + k] = 1;
  }
}

export function defaults(r) { return Object.fromEntries(r.params.map((q) => [q[0], q[5]])); }

export function build(r, p) {
  const out = r.build(p);
  out.pieces = out.fab.pieces.map((pc, k) => ({ name: pc.name, outline: outlineOf(pc), marks: out.marks[k] || [] }));
  return out;
}

// Cut pattern SVG: every piece laid out side by side with its marks.
export function patternSVG(pieces, seam = 0.015) {
  const gap = 0.12;
  let x = 0, H = 0, body = '';
  const style = { line: 'stroke:#06c;stroke-dasharray:0.012 0.008', dots: 'fill:#06c', cut: 'stroke:#000;fill:none', dart: 'stroke:#c00;fill:none' };
  for (const pc of pieces) {
    const xs = pc.outline.map((q) => q[0]), ys = pc.outline.map((q) => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const X = (v) => (x + seam + v - x0).toFixed(4), Y = (v) => (0.1 + seam + h - (v - y0)).toFixed(4);
    body += `<text x="${x.toFixed(3)}" y="0.06" font-size="0.045" font-family="sans-serif">${pc.name}</text>\n`;
    body += `<polygon points="${pc.outline.map(([a, b]) => `${X(a)},${Y(b)}`).join(' ')}" style="fill:none;stroke:#c00;stroke-width:0.003;stroke-dasharray:0.015 0.008"/>\n`;
    for (const mk of pc.marks) {
      if (mk.type === 'dots') for (const [a, b] of mk.pts) body += `<circle cx="${X(a)}" cy="${Y(b)}" r="0.008" style="${style.dots}"/>\n`;
      else body += `<polyline points="${mk.pts.map(([a, b]) => `${X(a)},${Y(b)}`).join(' ')}${mk.type === 'dart' ? ` ${X(mk.pts[0][0])},${Y(mk.pts[0][1])}` : ''}" style="${style[mk.type]};stroke-width:0.003;fill:none"/>\n`;
    }
    x += w + 2 * seam + gap;
    H = Math.max(H, h + 0.1 + 2 * seam + 0.02);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${(x * 1000).toFixed(0)}mm" height="${(H * 1000).toFixed(0)}mm" viewBox="0 0 ${x.toFixed(4)} ${H.toFixed(4)}">
<!-- 1:1. Red dashed: sewing line (add ${seam * 1000} mm seam allowance when cutting). Blue: stitch lines / tacks. Black: glue ring and cut out. Red wedges: darts. -->
${body}</svg>`;
}
