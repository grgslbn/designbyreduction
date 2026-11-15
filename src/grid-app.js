import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { GridSystem, GRID_DEFAULTS } from './system.js';
import { RHO_CONCRETE, G } from './membrane.js';

const PRESETS = {
  'Fig. 6: columns on base tubes': {},
  'Fig. 7: + soffit panels (hanging)': { panels: true },
  'Fig. 8: + top slab poured': { panels: true, slab: true },
  'Fig. 1–4: buffer tank with walls': { walls: true, panels: true, slab: true },
  'Dense 4×4, slender columns': { nx: 4, nz: 4, spacing: 1.2, foot: 1.5, body: 0.9, neck: 0.28, tube: 0.7, panels: true, slab: true },
  'Wide 2×3, tall': { nx: 2, nz: 3, spacing: 2.2, height: 2.2, foot: 2.3, body: 1.5, neck: 0.4, tube: 1.0, panels: true, panelSlack: 0.06, slab: true },
};

const state = { ...GRID_DEFAULTS };
const pct = (v) => `${Math.round(v * 100)}%`;
const m = (v) => `${v.toFixed(2)} m`;
const int = (v) => `${v}`;
const CONTROLS = {
  'g-layout': [
    ['nx', 'Columns in x', 1, 6, 1, int],
    ['nz', 'Columns in z', 1, 6, 1, int],
    ['spacing', 'Spacing T', 0.8, 3, 0.05, m],
  ],
  'g-column': [
    ['height', 'Pattern length', 0.6, 3, 0.05, m],
    ['foot', 'Foot width (24)', 0.6, 3, 0.01, m],
    ['body', 'Body width', 0.4, 2.5, 0.01, m],
    ['neck', 'Neck width (19)', 0.15, 0.8, 0.01, m],
    ['footZone', 'Foot zone', 0.05, 0.3, 0.01, pct],
    ['neckZone', 'Neck zone', 0.05, 0.4, 0.01, pct],
  ],
  'g-base': [
    ['tube', 'Base tube width', 0.3, 1.6, 0.01, m],
    ['wall', 'Wall cylinder width', 0.4, 1.6, 0.01, m],
  ],
  'g-slab': [
    ['panelSlack', 'Panel slack', 0, 0.12, 0.005, pct],
    ['slabThickness', 'Slab thickness above necks', 0.08, 0.4, 0.01, m],
  ],
  'g-pour': [
    ['hang', 'Top ring height (slack)', 0.85, 1, 0.005, pct],
    ['fill', 'Pour level', 0.1, 1, 0.01, pct],
    ['fabricWeight', 'Fabric weight', 0, 1.5, 0.05, (v) => `${v.toFixed(2)} kg/m²`],
  ],
};

const inputs = {};
for (const [group, list] of Object.entries(CONTROLS)) {
  const host = document.getElementById(group);
  for (const [key, label, min, max, step, fmt] of list) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}<span></span></label><input type="range" min="${min}" max="${max}" step="${step}">`;
    const input = row.querySelector('input'), out = row.querySelector('span');
    input.addEventListener('input', () => { state[key] = parseFloat(input.value); out.textContent = fmt(state[key]); schedule(); });
    inputs[key] = { input, out, fmt };
    host.appendChild(row);
  }
}
for (const k of ['walls', 'panels', 'slab']) {
  const el = document.getElementById(k);
  inputs[k] = { el };
  el.addEventListener('change', () => { state[k] = el.checked; if (k === 'slab' && el.checked) { state.panels = true; inputs.panels.el.checked = true; } schedule(); });
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
function applyPreset(name) { Object.assign(state, GRID_DEFAULTS, PRESETS[name]); syncInputs(); rebuild(); }

// ---------------------------------------------------------------- scene
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
scene.background = new THREE.Color(dark ? 0x161615 : 0xf4f2ee);
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222222 : 0xbbb4a8, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 7, 3);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, dark ? 0x444444 : 0xbbb5aa, dark ? 0x2a2a2a : 0xdcd7ce);
scene.add(grid);
const world = new THREE.Group();
scene.add(world);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- simulation
let sys, geoms = {}, paused = false, timer = null, slabMesh = null, framedFor = '';
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 150); }

const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });

function rebuild() {
  sys = new GridSystem({ ...state });
  world.clear();
  geoms = {};
  for (const [name, m] of Object.entries(sys.parts)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.pos.length), 3));
    g.setIndex(new THREE.BufferAttribute(m.tris, 1));
    geoms[name] = g;
  }
  for (const inst of sys.instances) {
    const mesh = new THREE.Mesh(geoms[inst.part], mat);
    mesh.position.set(inst.x, 0, inst.z);
    mesh.rotation.y = inst.rotY;
    world.add(mesh);
  }
  // slab volume (fig. 8): translucent block over the panelled area
  slabMesh = null;
  if (sys.parts.panel && state.slab) {
    const w = (state.nx - 1) * state.spacing, d = (state.nz - 1) * state.spacing;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, sys.slabTop - sys.top + 0.001, d),
      new THREE.MeshStandardMaterial({ color: 0x9b968c, transparent: true, opacity: 0.35, depthWrite: false }));
    box.position.y = (sys.top + sys.slabTop) / 2;
    slabMesh = box;
    slabMesh.visible = document.getElementById('showSlab').checked;
    world.add(box);
  }
  // reframe camera when the layout size changes
  const key = `${state.nx}|${state.nz}|${state.spacing}|${state.walls}|${state.height}`;
  if (key !== framedFor) {
    framedFor = key;
    const R = Math.max(sys.extent.x, sys.extent.z, sys.top);
    camera.position.set(R * 2.3, R * 1.7, R * 2.9);
    controls.target.set(0, sys.top * 0.35, 0);
  }
  drawCutList();
  paint();
  update(true);
}
document.getElementById('showSlab').addEventListener('change', (e) => { if (slabMesh) slabMesh.visible = e.target.checked; });

const C = {
  low: new THREE.Color(dark ? 0x3a3a38 : 0xf1ece2),
  high: new THREE.Color(dark ? 0xe07a4b : 0xb4532a),
  dry: new THREE.Color(0xd8d3c8),
  concrete: new THREE.Color(0xa9a59d),
  panel: new THREE.Color(0x8fb3cc),
};
const colourSel = document.getElementById('colour');
colourSel.addEventListener('change', paint);

function paint() {
  const mode = colourSel.value;
  const pMax = (RHO_CONCRETE * G * Math.max(sys.fillY, state.slab ? sys.slabTop - sys.top + 0.4 : 0)) / 1000;
  const c = new THREE.Color();
  for (const [name, m] of Object.entries(sys.parts)) {
    const col = geoms[name].getAttribute('color');
    const n = m.pos.length / 3;
    for (let i = 0; i < n; i++) {
      if (mode === 'pressure') {
        const p = m.pressure[i];
        if (p <= 0) c.copy(name === 'panel' ? C.panel : C.dry); else c.copy(C.low).lerp(C.high, Math.min(1, Math.pow(p / pMax, 0.8)));
      } else {
        c.copy(name === 'panel' ? (state.slab ? C.concrete : C.panel) : m.pos[i * 3 + 1] <= sys.fillY + 1e-3 ? C.concrete : C.dry);
      }
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
  const legend = document.getElementById('legend');
  if (mode === 'pressure') {
    legend.style.display = '';
    document.getElementById('lg-a').textContent = '0';
    document.getElementById('lg-b').textContent = `${pMax.toFixed(0)} kPa`;
    document.getElementById('lg-bar').style.background = `linear-gradient(90deg, #${C.low.getHexString()}, #${C.high.getHexString()})`;
  } else legend.style.display = 'none';
}

let lastStats = 0;
function update(force = false) {
  for (const g of Object.values(geoms)) {
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }
  const now = performance.now();
  if (!force && now - lastStats < 300) return;
  lastStats = now;
  const s = sys.stats();
  const done = sys.residual < 1e-5;
  document.getElementById('stats').innerHTML = `
    <dt>Columns</dt><dd>${s.columns}</dd>
    <dt>Footprint</dt><dd>${s.footprint.toFixed(1)} m²</dd>
    <dt>Column height</dt><dd>${sys.top.toFixed(2)} m</dd>
    <dt>Concrete, main pour</dt><dd>${s.pourVolume.toFixed(2)} m³</dd>
    <dt>&nbsp;&nbsp;per column</dt><dd>${s.vColumn.toFixed(3)} m³</dd>
    <dt>&nbsp;&nbsp;per base tube</dt><dd>${s.vTube.toFixed(3)} m³</dd>
    ${s.vWall ? `<dt>&nbsp;&nbsp;per wall cylinder</dt><dd>${s.vWall.toFixed(3)} m³</dd>` : ''}
    ${s.slabVolume ? `<dt>Concrete, slab</dt><dd>${s.slabVolume.toFixed(2)} m³</dd>` : ''}
    ${s.sag ? `<dt>Panel sag</dt><dd>${(s.sag * 1000).toFixed(0)} mm</dd>` : ''}
    <dt>Total mass</dt><dd>${s.mass.toFixed(1)} t</dd>
    <dt>Base pressure</dt><dd>${((RHO_CONCRETE * G * sys.fillY) / 1000).toFixed(1)} kPa</dd>
    <dt>Max fabric strain</dt><dd>${(s.strain * 100).toFixed(1)} %</dd>`;
  document.getElementById('hud').textContent =
    `${done ? 'settled' : paused ? 'paused' : 'pouring…'}  ·  iteration ${sys.iter}  ·  ${sys.instances.length} parts from ${Object.keys(sys.parts).length} simulated types`;
}

function loop() {
  requestAnimationFrame(loop);
  if (sys && !paused && !(sys.residual < 1e-5) && sys.iter < 1500) {
    sys.step();
    update();
    paint();
  }
  controls.update();
  renderer.render(scene, camera);
}
document.getElementById('pour').onclick = () => { paused = false; document.getElementById('pause').textContent = 'Pause'; rebuild(); };
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; update(true); };

function drawCutList() {
  const host = document.getElementById('pattern');
  host.innerHTML = sys.cutListSVG().replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '');
  const s = host.querySelector('svg');
  s.style.maxHeight = '220px';
  if (dark) { s.querySelectorAll('polygon').forEach((e) => e.setAttribute('stroke', '#ddd')); s.querySelectorAll('text').forEach((e) => e.setAttribute('fill', '#ddd')); }
}

// ---------------------------------------------------------------- export
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toOBJ() {
  let s = '# grid formwork system — designbyreduction simulator\n', base = 1;
  const v = new THREE.Vector3();
  world.updateMatrixWorld();
  for (const mesh of world.children) {
    if (!mesh.geometry.index || mesh === slabMesh) continue;
    const P = mesh.geometry.getAttribute('position'), I = mesh.geometry.index.array;
    s += `o part_${base}\n`;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
      s += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
    }
    for (let t = 0; t < I.length; t += 3) s += `f ${I[t] + base} ${I[t + 1] + base} ${I[t + 2] + base}\n`;
    base += P.count;
  }
  return s;
}
document.getElementById('exp-svg').onclick = () => download('grid-cutlist.svg', sys.cutListSVG(), 'image/svg+xml');
document.getElementById('exp-obj').onclick = () => download('grid-system.obj', toOBJ(), 'text/plain');
document.getElementById('exp-json').onclick = () => download('grid-params.json', JSON.stringify(state, null, 2), 'application/json');

resize();
const q = new URLSearchParams(location.search).get('preset');
const first = Object.keys(PRESETS).find((k) => q && k.toLowerCase().includes(q.toLowerCase())) || Object.keys(PRESETS)[0];
presetSel.value = first;
applyPreset(first);
loop();
window.__sim = () => sys;
