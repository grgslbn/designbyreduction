import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { Deck, DECK_DEFAULTS } from './deck.js';
import { RHO, G } from './engine.js';

const state = { ...DECK_DEFAULTS };
const m = (v) => `${v.toFixed(2)} m`;
const CONTROLS = {
  'g-deck': [
    ['width', 'Width', 2, 16, 0.5, m],
    ['length', 'Length', 4, 40, 1, m],
    ['height', 'Height', 0.4, 1.6, 0.05, m],
    ['angle', 'Web angle', 40, 75, 1, (v) => `${v}°`],
  ],
  'g-web': [
    ['bayLen', 'Bay length', 0.6, 2.4, 0.01, m],
    ['chord', 'Fold chord channel (flat)', 0.1, 0.5, 0.01, m],
    ['diag', 'Diagonal channel (flat)', 0.08, 0.4, 0.01, m],
  ],
  'g-pour': [
    ['standpipe', 'Pump head above top chords', 0, 6, 0.05, m],
    ['airKPa', 'Cushion air pressure', 5, 100, 1, (v) => `${v} kPa`],
    ['lift', 'Staged pour: lift height', 0, 1, 0.05, (v) => (v ? `${v.toFixed(2)} m per lift` : 'one pour')],
    ['bend', 'Stiffness of taped areas', 0, 1, 0.05, (v) => (v ? v.toFixed(2) : 'none (limp)')],
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
for (const k of ['propped', 'anchored', 'heldEnds', 'cushions']) {
  const el = document.getElementById(k);
  inputs[k] = { el };
  el.addEventListener('change', () => { state[k] = el.checked; schedule(); });
}
for (const [k, c] of Object.entries(inputs)) {
  if (c.el) c.el.checked = !!state[k];
  else { c.input.value = state[k]; c.out.textContent = c.fmt(state[k]); }
}

// ---------------------------------------------------------------- scene
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
scene.background = new THREE.Color(dark ? 0x161615 : 0xf4f2ee);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x222222 : 0xbbb4a8, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(6, 10, 4);
scene.add(sun);
scene.add(new THREE.GridHelper(60, 60, dark ? 0x444444 : 0xbbb5aa, dark ? 0x2a2a2a : 0xdcd7ce));
const world = new THREE.Group();
scene.add(world);
const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
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
let deck, geom, paused = false, timer = null, framedFor = '';
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 200); }
const allBox = document.getElementById('all');
allBox.addEventListener('change', () => { framedFor = ''; place(); });

function rebuild() {
  deck = new Deck({ ...state });
  const F = deck.fab;
  geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(F.pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(F.pos.length), 3));
  geom.setIndex(new THREE.BufferAttribute(F.renderTris(), 1));
  place();
  drawSheet();
  paint();
  update(true);
}

function place() {
  world.clear();
  const list = allBox.checked ? deck.instances : [{ x: 0, z: -deck.modW / 2 }];
  for (const inst of list) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(inst.x, 0, inst.z);
    world.add(mesh);
  }
  // rails holding the top chords
  if (state.propped) {
    const railMat = new THREE.LineBasicMaterial({ color: dark ? 0xaaaaaa : 0x555555 });
    const L = allBox.checked ? deck.nL * deck.Lm : deck.Lm;
    const nV = allBox.checked ? deck.nV : 1;
    for (let a = 0; a < nV; a++) {
      const z = (allBox.checked ? (a - deck.nV / 2) * deck.modW : -deck.modW / 2) + deck.modW / 2;
      const y = state.height + 0.02;
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L / 2, y, z), new THREE.Vector3(L / 2, y, z)]), railMat));
    }
  }
  const key = `${allBox.checked}|${state.width}|${state.length}|${state.height}`;
  if (key !== framedFor) {
    framedFor = key;
    const R = allBox.checked ? Math.max(state.width, state.length) * 0.6 : Math.max(deck.Lm, deck.modW) * 0.9;
    camera.position.set(R * 1.1, R * 0.8, R * 1.3);
    controls.target.set(0, state.height * 0.3, 0);
  }
}

const C = {
  low: new THREE.Color(dark ? 0x3a3a38 : 0xf1ece2), high: new THREE.Color(dark ? 0xe07a4b : 0xb4532a),
  concrete: new THREE.Color(0xa9a59d),
};
const colourSel = document.getElementById('colour');
colourSel.addEventListener('change', paint);
function paint() {
  const F = deck.fab, col = geom.getAttribute('color'), n = F.pos.length / 3;
  const pMax = (RHO * G * deck.top) / 1000, c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (colourSel.value === 'concrete') c.copy(C.concrete);
    else c.copy(C.low).lerp(C.high, Math.min(1, Math.pow(F.pressure[i] / pMax, 0.8)));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  const lg = document.getElementById('legend');
  if (colourSel.value === 'pressure') {
    lg.style.display = '';
    document.getElementById('lg-a').textContent = '0';
    document.getElementById('lg-b').textContent = `${pMax.toFixed(0)} kPa`;
    document.getElementById('lg-bar').style.background = `linear-gradient(90deg, #${C.low.getHexString()}, #${C.high.getHexString()})`;
  } else lg.style.display = 'none';
}

let last = 0;
function update(force = false) {
  geom.getAttribute('position').needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  const now = performance.now();
  if (!force && now - last < 400) return;
  last = now;
  const s = deck.stats();
  const pct = (v) => `${(v * 100).toFixed(1)} %`;
  document.getElementById('stats').innerHTML = `
    <dt>Webs × length</dt><dd>${s.webs} × ${s.sheetL.toFixed(1)} m</dd>
    <dt>Deck after pour</dt><dd>${s.deckW.toFixed(1)} × ${s.deckL.toFixed(1)} m</dd>
    <dt>Top chord height</dt><dd>${s.apex.toFixed(2)} m of ${state.height.toFixed(2)}</dd>
    <dt>V spread</dt><dd>${pct(s.spread)}</dd>
    <dt>Shortening along deck</dt><dd>${pct(s.shorten)}</dd>
    <dt>Fold chord tube</dt><dd>${(s.topTube * 100).toFixed(0)} cm</dd>
    <dt>Diagonal tube</dt><dd>${(s.diagTube * 100).toFixed(0)} cm</dd>
    <dt>Concrete</dt><dd>${s.volume.toFixed(1)} m³</dd>
    <dt>Mass</dt><dd>${s.mass.toFixed(0)} t</dd>
    <dt>Fabric (2 layers)</dt><dd>${s.fabric.toFixed(0)} m²</dd>
    <dt>Flat sheet</dt><dd>${s.sheetW.toFixed(1)} × ${s.sheetL.toFixed(1)} m</dd>
    <dt>Peak pressure on cloth</dt><dd>${s.peakPressure.toFixed(0)} kPa${s.stages > 1 ? ` (one pour: ${s.basePressure.toFixed(0)})` : ''}</dd>
    ${s.stages > 1 ? `<dt>Lift</dt><dd>${s.stage} of ${s.stages}</dd>` : ''}
    <dt>Max fabric strain</dt><dd>${pct(s.strain)}</dd>`;
  const f = [];
  if (s.apex < state.height * 0.9) f.push(`<p><b>The V is slumping</b> (top chords at ${s.apex.toFixed(2)} m). Wet concrete in a leaning bag needs a pressure at the top well above its own height to stand. Hang the top chords from rails or cables, raise the pump head, or pour in stages.</p>`);
  if (s.spread > 0.05) f.push(`<p><b>The webs push apart</b> (+${(s.spread * 100).toFixed(0)} %). Tie the bottom chords together or peg them down.</p>`);
  if (s.shorten > 0.03) f.push(`<p><b>The deck shortens by ${(s.shorten * 100).toFixed(0)} %</b> as the channels inflate (about ${(s.shorten * state.length).toFixed(1)} m over ${state.length} m). Cut the sheet that much longer, or hold the ends.</p>`);
  if (state.heldEnds && s.diagTube < state.diag * 0.5) f.push(`<p><b>Held ends keep the diagonals flat</b> (${(s.diagTube * 100).toFixed(0)} cm instead of about ${(state.diag * 2 / Math.PI * 100).toFixed(0)} cm round). A channel needs to shorten its surroundings to inflate fully.</p>`);
  if (state.cushions && s.diagTube < 0.04) f.push(`<p><b>The air cushions are squashing the concrete diagonals</b> (${(s.diagTube * 100).toFixed(0)} cm). The air pressure is higher than the concrete pressure. Lower it, or widen the taped band between cushion and channel.</p>`);
  if (state.cushions && s.apex >= state.height * 0.9 && !state.propped) f.push('<p><b>The air cushions brace the V</b>: it stands without rails.</p>');
  if (s.stages > 1 && s.apex < state.height * 0.9) f.push('<p><b>A staged pour does not stop the slump.</b> The empty cloth above each lift has no pressure to hold it up, and each lift then sets in the slumped shape. Lifts help only when something holds the cloth up.</p>');
  if (s.stages > 1 && s.apex >= state.height * 0.9) f.push(`<p><b>The staged pour cuts the pressure on the cloth</b> to ${s.peakPressure.toFixed(0)} kPa per lift, instead of ${s.basePressure.toFixed(0)} kPa in one pour. That allows a lighter fabric and weaker seams.</p>`);
  if (s.stages > 1 && !state.heldEnds && s.strain > 0.06) f.push(`<p><b>Set lifts fight the fresh ones.</b> Each lift shortens as it fills, but the set lift below has already shortened and holds it back (fabric strain ${(s.strain * 100).toFixed(0)} %). Hold the ends during a staged pour, or cut the upper part of the sheet with extra length.</p>`);
  if (!f.length) f.push('<p>Stable: the V holds its shape with these settings.</p>');
  document.getElementById('findings').innerHTML = f.join('');
  const done = deck.residual < 1e-5;
  document.getElementById('hud').textContent = `${done ? 'settled' : paused ? 'paused' : 'pouring…'}  ·  iteration ${deck.iter}  ·  ${s.modules} modules from 1 simulated V`;
}

function loop() {
  requestAnimationFrame(loop);
  if (deck && !paused && !(deck.residual < 1e-5) && deck.iter < 3000) {
    deck.step();
    update();
    if (deck.iter % 5 === 0) paint();
  }
  controls.update();
  renderer.render(scene, camera);
}
document.getElementById('pour').onclick = () => { paused = false; document.getElementById('pause').textContent = 'Pause'; rebuild(); };
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; update(true); };

function drawSheet() {
  const el = document.getElementById('pattern');
  el.innerHTML = deck.sheetSVG().replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '');
  el.querySelector('svg').style.maxHeight = '320px';
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
document.getElementById('exp-svg').onclick = () => download('v-deck-sheet.svg', deck.sheetSVG(), 'image/svg+xml');
document.getElementById('exp-obj').onclick = () => {
  const F = deck.fab;
  let s = '# V truss deck module — designbyreduction\n';
  for (let i = 0; i < F.nCloth; i++) s += `v ${F.pos[i * 3].toFixed(4)} ${F.pos[i * 3 + 1].toFixed(4)} ${F.pos[i * 3 + 2].toFixed(4)}\n`;
  for (let t = 0; t < F.tris.length; t += 3) s += `f ${F.tris[t] + 1} ${F.tris[t + 1] + 1} ${F.tris[t + 2] + 1}\n`;
  download('v-deck-module.obj', s, 'text/plain');
};
document.getElementById('exp-json').onclick = () => download('v-deck-params.json', JSON.stringify(state, null, 2), 'application/json');

resize();
rebuild();
loop();
window.__sim = () => deck;
