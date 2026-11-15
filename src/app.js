import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { ColumnSim, DEFAULTS, RHO_CONCRETE, G } from './sim.js';

// ---------------------------------------------------------------- presets
// Inspired by the column embodiments in BE1024818B1 (figs. 1–2, 9–11, 15–20, 36–37).
const PRESETS = {
  'Straight sleeve': {},
  'Tapered column (fig. 36)': { circBottom: 1.25, circTop: 0.7 },
  'Fluted column (fig. 37)': { circBottom: 1.1, circTop: 0.8, flutes: 8, fluteDepth: 0.78 },
  'Barrel / belly': { bulge: 0.3, hang: 0.94 },
  'Banded (two rings)': { r1on: true, r1at: 0.33, r1r: 0.62, r2on: true, r2at: 0.67, r2r: 0.62 },
  'Mushroom capital (fig. 15)': { circBottom: 0.95, circTop: 0.95, capital: 3.2, capitalZone: 0.3, hang: 0.9, topRing: 0.9 },
  'Waisted (hourglass)': { bulge: -0.35, hang: 0.97 },
  'Five deep flutes': { flutes: 5, fluteDepth: 0.6, bulge: 0.15 },
  'Half-filled sleeve': { fill: 0.5 },
};

const state = { ...DEFAULTS, r1on: false, r1at: 0.5, r1r: 0.7, r2on: false, r2at: 0.75, r2r: 0.7 };

// ---------------------------------------------------------------- controls
const pct = (v) => `${Math.round(v * 100)}%`;
const m = (v) => `${v.toFixed(2)} m`;
const CONTROLS = {
  'g-pattern': [
    ['length', 'Pattern length', 1, 6, 0.05, m],
    ['circBottom', 'Width at bottom', 0.3, 2.5, 0.01, m],
    ['circTop', 'Width at top', 0.3, 2.5, 0.01, m],
    ['bulge', 'Mid-height bulge / waist', -0.5, 0.6, 0.01, pct],
    ['capital', 'Capital flare', 0, 5, 0.05, (v) => `×${(1 + v).toFixed(2)}`],
    ['capitalZone', 'Capital zone', 0.1, 0.5, 0.01, pct],
  ],
  'g-stitch': [
    ['flutes', 'Tether lines (flutes)', 0, 16, 1, (v) => (v ? `${v}` : 'none')],
    ['fluteDepth', 'Tether length (of radius)', 0.3, 1, 0.01, pct],
  ],
  'g-ring1': [
    ['r1at', 'Height', 0.05, 0.95, 0.01, pct],
    ['r1r', 'Band radius', 0.3, 1, 0.01, pct],
  ],
  'g-ring2': [
    ['r2at', 'Height', 0.05, 0.95, 0.01, pct],
    ['r2r', 'Band radius', 0.3, 1, 0.01, pct],
  ],
  'g-pour': [
    ['hang', 'Top ring height (slack)', 0.8, 1, 0.005, pct],
    ['topRing', 'Top ring radius', 0.3, 1.2, 0.01, pct],
    ['bottomRing', 'Base ring radius', 0.3, 1.2, 0.01, pct],
    ['fill', 'Pour level', 0.1, 1, 0.01, pct],
  ],
};

const inputs = {};
for (const [group, list] of Object.entries(CONTROLS)) {
  const host = document.getElementById(group);
  for (const [key, label, min, max, step, fmt] of list) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}<span></span></label><input type="range" min="${min}" max="${max}" step="${step}">`;
    const input = row.querySelector('input');
    const out = row.querySelector('span');
    input.addEventListener('input', () => {
      state[key] = parseFloat(input.value);
      out.textContent = fmt(state[key]);
      schedule();
    });
    inputs[key] = { input, out, fmt };
    host.appendChild(row);
  }
}
for (const [k, id] of [['r1on', 'ring1on'], ['r2on', 'ring2on'], ['guided', 'guided']]) {
  const el = document.getElementById(id);
  inputs[k] = { el };
  el.addEventListener('change', () => { state[k] = el.checked; schedule(); });
}
function syncInputs() {
  for (const [k, c] of Object.entries(inputs)) {
    if (c.el) c.el.checked = !!state[k];
    else { c.input.value = state[k]; c.out.textContent = c.fmt(state[k]); }
  }
}

const presetSel = document.getElementById('preset');
for (const name of Object.keys(PRESETS)) presetSel.add(new Option(name, name));
presetSel.addEventListener('change', () => applyPreset(presetSel.value));
function applyPreset(name) {
  Object.assign(state, DEFAULTS, { r1on: false, r1at: 0.5, r1r: 0.7, r2on: false, r2at: 0.75, r2r: 0.7 }, PRESETS[name]);
  syncInputs();
  rebuild();
}

function simParams() {
  const rings = [];
  if (state.r1on) rings.push({ at: state.r1at, r: state.r1r });
  if (state.r2on) rings.push({ at: state.r2at, r: state.r2r });
  const p = { ...state, rings };
  delete p.r1on; delete p.r1at; delete p.r1r; delete p.r2on; delete p.r2at; delete p.r2r;
  return p;
}

// ---------------------------------------------------------------- three.js scene
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
scene.background = new THREE.Color(dark ? 0x161615 : 0xf4f2ee);
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
camera.position.set(3.2, 2.4, 4.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.4, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222222 : 0xbbb4a8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 2);
scene.add(sun);
const grid = new THREE.GridHelper(6, 24, dark ? 0x444444 : 0xbbb5aa, dark ? 0x2a2a2a : 0xdcd7ce);
scene.add(grid);

const geom = new THREE.BufferGeometry();
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, flatShading: false });
const mesh = new THREE.Mesh(geom, mat);
scene.add(mesh);
const wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 }));
scene.add(wire);
const helpers = new THREE.Group();
scene.add(helpers);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- simulation loop
let sim, paused = false, timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 120); }

function rebuild() {
  sim = new ColumnSim(simParams());
  const n = sim.pos.length / 3;
  geom.setAttribute('position', new THREE.BufferAttribute(sim.pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(sim.tris, 1));
  // wireframe along warp/weft only (no diagonals)
  const idx = [];
  for (let j = 0; j < sim.nv; j += 2) for (let i = 0; i < sim.nu; i++) idx.push(j * sim.nu + i, j * sim.nu + ((i + 1) % sim.nu));
  for (let i = 0; i < sim.nu; i += 3) for (let j = 0; j < sim.nv - 1; j++) idx.push(j * sim.nu + i, (j + 1) * sim.nu + i);
  wire.geometry.setAttribute('position', geom.getAttribute('position'));
  wire.geometry.setIndex(idx);
  drawHelpers();
  controls.target.set(0, sim.topY / 2, 0);
  drawPattern();
  paint();
  update(true);
}

function ringLine(r, y, color, dashed = false) {
  const pts = [];
  for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(g, dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.04, gapSize: 0.03 })
    : new THREE.LineBasicMaterial({ color }));
  if (dashed) l.computeLineDistances();
  return l;
}
function drawHelpers() {
  helpers.clear();
  const steel = dark ? 0xdddddd : 0x333333;
  helpers.add(ringLine(sim.rBottom, 0.002, steel));
  helpers.add(ringLine(sim.rTop, sim.topY, steel));
  // scaffold posts holding the top ring
  const postMat = new THREE.LineBasicMaterial({ color: dark ? 0x555555 : 0xaaa49a });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * sim.rTop, z = Math.sin(a) * sim.rTop;
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, sim.topY, z), new THREE.Vector3(x * 2.2, sim.topY + 0.05, z * 2.2), new THREE.Vector3(x * 2.2, 0, z * 2.2)]);
    helpers.add(new THREE.Line(g, postMat));
  }
  // fill level
  helpers.add(ringLine(Math.max(sim.rTop, sim.rBottom) * 1.6, sim.fillY(), 0x2a7ab4, true));
}

const C = {
  low: new THREE.Color(dark ? 0x3a3a38 : 0xf1ece2),
  high: new THREE.Color(dark ? 0xe07a4b : 0xb4532a),
  slack: new THREE.Color(0x9fc3dc),
  taut: new THREE.Color(dark ? 0xe07a4b : 0xb4532a),
  dry: new THREE.Color(0xd8d3c8),
  concrete: new THREE.Color(0xa9a59d),
};
const colourSel = document.getElementById('colour');
colourSel.addEventListener('change', paint);

function paint() {
  const mode = colourSel.value;
  const col = geom.getAttribute('color');
  if (!col) return;
  const n = sim.pos.length / 3;
  const pMax = (RHO_CONCRETE * G * sim.fillY()) / 1000;
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (mode === 'pressure') {
      const t = pMax > 0 ? sim.pressure[i] / pMax : 0;
      if (sim.pressure[i] <= 0) c.copy(C.dry); else c.copy(C.low).lerp(C.high, Math.pow(t, 0.8));
    } else if (mode === 'taut') {
      c.copy(sim.taut[i] ? C.taut : C.slack);
    } else {
      c.copy(sim.pos[i * 3 + 1] <= sim.fillY() + 1e-3 ? C.concrete : C.dry);
    }
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  wire.visible = mode !== 'concrete';
  const legend = document.getElementById('legend');
  const bar = document.getElementById('lg-bar');
  if (mode === 'pressure') {
    legend.style.display = '';
    document.getElementById('lg-a').textContent = '0';
    document.getElementById('lg-b').textContent = `${pMax.toFixed(0)} kPa`;
    bar.style.background = `linear-gradient(90deg, #${C.low.getHexString()}, #${C.high.getHexString()})`;
  } else if (mode === 'taut') {
    legend.style.display = '';
    document.getElementById('lg-a').textContent = 'slack';
    document.getElementById('lg-b').textContent = 'taut';
    bar.style.background = `linear-gradient(90deg, #${C.slack.getHexString()} 50%, #${C.taut.getHexString()} 50%)`;
  } else legend.style.display = 'none';
}

let lastStats = 0;
function update(force = false) {
  geom.getAttribute('position').needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  const now = performance.now();
  if (!force && now - lastStats < 250) return;
  lastStats = now;
  const V = sim.volume();
  const done = sim.residual < 1e-5;
  const pBase = (RHO_CONCRETE * G * sim.fillY()) / 1000;
  const prof = sim.profile();
  const rMax = Math.max(...prof.map((p) => p.rMax));
  const fabric = sim.flatW.reduce((a, w) => a + w, 0) / sim.nv * sim.p.length;
  document.getElementById('stats').innerHTML = `
    <dt>Concrete volume</dt><dd>${V.toFixed(3)} m³</dd>
    <dt>Concrete mass</dt><dd>${((V * RHO_CONCRETE) / 1000).toFixed(2)} t</dd>
    <dt>Column height</dt><dd>${sim.topY.toFixed(2)} m</dd>
    <dt>Max diameter</dt><dd>${(2 * rMax).toFixed(2)} m</dd>
    <dt>Pressure at base</dt><dd>${pBase.toFixed(1)} kPa</dd>
    <dt>Fabric area</dt><dd>${fabric.toFixed(2)} m²</dd>
    <dt>Max fabric strain</dt><dd>${(sim.maxStrain() * 100).toFixed(1)} %</dd>`;
  document.getElementById('hud').textContent =
    `${done ? 'settled' : paused ? 'paused' : 'pouring…'}  ·  iteration ${sim.iter}  ·  residual ${sim.residual === Infinity ? '—' : sim.residual.toExponential(1)}`;
  drawSection(prof);
}

function loop() {
  requestAnimationFrame(loop);
  if (sim && !paused && sim.residual >= 1e-5 && sim.iter < 1500) {
    sim.step();
    update();
    paint();
  }
  controls.update();
  renderer.render(scene, camera);
}

document.getElementById('pour').onclick = () => { paused = false; document.getElementById('pause').textContent = 'Pause'; rebuild(); };
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; update(true); };

// ---------------------------------------------------------------- 2D figures
function drawPattern() {
  const svg = sim.toPatternSVG().replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '');
  const host = document.getElementById('pattern');
  host.innerHTML = svg;
  const s = host.querySelector('svg');
  // fit tall patterns
  s.style.maxHeight = '300px';
  s.style.margin = '0 auto';
  s.querySelectorAll('.cut').forEach((e) => e.setAttribute('fill', dark ? '#2a2926' : '#fff'));
  if (dark) s.querySelectorAll('.cut').forEach((e) => e.setAttribute('stroke', '#ddd'));
}

function drawSection(prof) {
  const H = sim.topY, R = Math.max(...prof.map((p) => p.rMax)) * 1.15;
  const W = 2 * R, pad = 0.06 * H;
  const x = (r) => (W / 2 + r).toFixed(4), y = (v) => (H + pad - v).toFixed(4);
  const outer = prof.map((p) => `${x(p.rMax)},${y(p.y)}`).concat(prof.slice().reverse().map((p) => `${x(-p.rMax)},${y(p.y)}`));
  const inner = prof.map((p) => `${x(p.rMin)},${y(p.y)}`).concat(prof.slice().reverse().map((p) => `${x(-p.rMin)},${y(p.y)}`));
  const ink = dark ? '#ecebe7' : '#1d1d1b';
  const sw = (H / 300).toFixed(4);
  document.getElementById('section').innerHTML = `
    <svg viewBox="0 0 ${W.toFixed(4)} ${(H + 2 * pad).toFixed(4)}" style="max-height:260px;margin:0 auto">
      <polygon points="${outer.join(' ')}" fill="${dark ? '#55524c' : '#d9d4ca'}" stroke="${ink}" stroke-width="${sw}"/>
      <polygon points="${inner.join(' ')}" fill="${dark ? '#77736b' : '#b9b3a8'}" stroke="none"/>
      <line x1="0" x2="${W}" y1="${y(sim.fillY())}" y2="${y(sim.fillY())}" stroke="#2a7ab4" stroke-width="${sw}" stroke-dasharray="${H / 60} ${H / 90}"/>
      <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${ink}" stroke-width="${sw * 1.5}"/>
    </svg>`;
}

// ---------------------------------------------------------------- export
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
document.getElementById('exp-svg').onclick = () => download('column-pattern.svg', sim.toPatternSVG(), 'image/svg+xml');
document.getElementById('exp-obj').onclick = () => download('column.obj', sim.toOBJ(), 'text/plain');
document.getElementById('exp-json').onclick = () => download('column-params.json', JSON.stringify(simParams(), null, 2), 'application/json');

// ---------------------------------------------------------------- go
resize();
const initial = new URLSearchParams(location.search).get('preset');
const first = Object.keys(PRESETS).find((k) => k.startsWith(initial || '')) || Object.keys(PRESETS)[1];
presetSel.value = first;
applyPreset(first);
loop();
window.__sim = () => sim; // for debugging / automated screenshots
