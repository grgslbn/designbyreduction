import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RECIPES, defaults, build, patternSVG } from './recipes.js';
import { RHO, G } from './engine.js';

const FAMILY = {
  A: 'A · Two layers sewn round the edge', B: 'B · Rolled tubes', C: 'C · Tubes shortened on one side',
  E: 'E · Joined sleeves', F: 'F · Hung single layers', H: 'H · Cloth against a rigid board',
};

let recipe = RECIPES[0], params = defaults(recipe), out, fab, paused = false, timer = null;

// ---------------------------------------------------------------- recipe list
const list = document.getElementById('recipes');
for (const r of RECIPES) {
  const b = document.createElement('button');
  b.innerHTML = `<b>${r.family}</b><span>${r.name}</span>`;
  b.onclick = () => select(r.id);
  b.dataset.id = r.id;
  list.appendChild(b);
}
// links to the other two modules, which are families B and G in the catalogue
for (const [fam, name, href] of [['B', 'Column studio (flutes, bands, capitals)', './'], ['G', 'Multi-chamber grid (buffer tank)', './grid.html']]) {
  const a = document.createElement('button');
  a.innerHTML = `<b>${fam}</b><span>${name} ↗</span>`;
  a.onclick = () => (location.href = href);
  list.appendChild(a);
}

function select(id) {
  recipe = RECIPES.find((r) => r.id === id) || RECIPES[0];
  params = defaults(recipe);
  list.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === recipe.id));
  history.replaceState(null, '', `?r=${recipe.id}`);
  document.getElementById('r-family').textContent = FAMILY[recipe.family] || recipe.family;
  document.getElementById('r-summary').textContent = recipe.summary;
  document.getElementById('steps').innerHTML = recipe.steps.map((s) => `<li>${s}</li>`).join('');
  const host = document.getElementById('params');
  host.innerHTML = '';
  for (const [key, label, min, max, step, , fmt] of recipe.params) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label>${label}<span>${fmt(params[key])}</span></label><input type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
    const input = row.querySelector('input'), span = row.querySelector('span');
    input.addEventListener('input', () => { params[key] = parseFloat(input.value); span.textContent = fmt(params[key]); schedule(); });
    host.appendChild(row);
  }
  framed = false;
  rebuild();
}

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
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(3, 6, 4);
scene.add(sun);
scene.add(new THREE.GridHelper(20, 80, dark ? 0x444444 : 0xbbb5aa, dark ? 0x2a2a2a : 0xdcd7ce));
const geom = new THREE.BufferGeometry();
const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
scene.add(mesh);
const wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.07 }));
mesh.add(wire);

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
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, 150); }
let framed = false;

function rebuild() {
  out = build(recipe, params);
  fab = out.fab;
  const pos = new THREE.BufferAttribute(fab.pos, 3);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fab.pos.length), 3));
  geom.setIndex(new THREE.BufferAttribute(fab.renderTris(), 1));
  const idx = [];
  for (let c = 0; c < fab.cL.length; c++) if (fab.cW[c] >= 1 && fab.cB[c] < fab.nCloth) idx.push(fab.cA[c], fab.cB[c]);
  wire.geometry.setAttribute('position', pos);
  wire.geometry.setIndex(idx);
  drawPattern();
  paint();
  update(true);
}

// orientation "in use": turned over (shell), stood up (panels, arch)
const flipBox = document.getElementById('flip');
flipBox.addEventListener('change', () => { framed = false; place(); });
function place() {
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  const v = recipe.view || {};
  if (flipBox.checked) {
    if (v.flip) mesh.scale.y = -1;
    if (v.stand === 'panel') mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    if (v.stand === 'arch') {
      // rotate so the arch's crown points up: direction from chord midpoint to mid-length centroid
      const pc = fab.pieces[0], P = fab.pos, cen = (j) => { let x = 0, y = 0, z = 0; for (let i = 0; i < pc.nu; i++) { const g = fab.gid(0, i, j); x += P[g * 3]; y += P[g * 3 + 1]; z += P[g * 3 + 2]; } return new THREE.Vector3(x / pc.nu, y / pc.nu, z / pc.nu); };
      const a = cen(1), c = cen(pc.nv - 2), b = cen(Math.floor(pc.nv / 2));
      const d = b.clone().sub(a.clone().add(c).multiplyScalar(0.5)).setY(0).normalize();
      if (d.lengthSq() > 0.5) mesh.quaternion.setFromUnitVectors(d, new THREE.Vector3(0, 1, 0));
    }
  }
  mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  mesh.position.y -= box.min.y;
  mesh.position.x -= (box.min.x + box.max.x) / 2;
  mesh.position.z -= (box.min.z + box.max.z) / 2;
  if (!framed) {
    framed = true;
    const size = box.getSize(new THREE.Vector3()), R = Math.max(size.x, size.y, size.z, 0.5);
    camera.position.set(R * 1.3, R * 1.0 + size.y * 0.5, R * 1.7);
    controls.target.set(0, size.y / 2, 0);
  }
}

const C = {
  low: new THREE.Color(dark ? 0x3a3a38 : 0xf1ece2), high: new THREE.Color(dark ? 0xe07a4b : 0xb4532a),
  dry: new THREE.Color(0xd8d3c8), concrete: new THREE.Color(0xa9a59d),
};
const colourSel = document.getElementById('colour');
colourSel.addEventListener('change', paint);
function paint() {
  const col = geom.getAttribute('color');
  const n = fab.pos.length / 3, mode = colourSel.value;
  let pMax = 0;
  for (let i = 0; i < n; i++) pMax = Math.max(pMax, fab.pressure[i]);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (mode === 'concrete') c.copy(C.concrete);
    else if (fab.weight > 0) c.copy(C.high); // draped weight: uniform load
    else c.copy(fab.pressure[i] > 0 ? C.low.clone().lerp(C.high, Math.pow(fab.pressure[i] / (pMax || 1), 0.8)) : C.dry);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  wire.visible = mode !== 'concrete';
  const lg = document.getElementById('legend');
  if (mode === 'pressure' && !fab.weight) {
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
  if (!force && now - last < 300) return;
  last = now;
  place();
  const ro = recipe.readout.call(recipe, fab, params);
  ro.push(['Max fabric strain', `${(fab.maxStrain() * 100).toFixed(1)} %`]);
  document.getElementById('stats').innerHTML = ro.filter((v, i, a) => a.findIndex((w) => w[0] === v[0]) === i).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const done = fab.residual < 1e-5;
  document.getElementById('hud').textContent = `${done ? 'settled' : paused ? 'paused' : 'pouring…'}  ·  iteration ${fab.iter}  ·  ${out.pieces.length} piece${out.pieces.length > 1 ? 's' : ''}, ${fab.nCloth} nodes`;
}

function loop() {
  requestAnimationFrame(loop);
  if (fab && !paused && !(fab.residual < 1e-5) && fab.iter < 1500) {
    fab.step();
    update();
    paint();
  }
  controls.update();
  renderer.render(scene, camera);
}
document.getElementById('pour').onclick = () => { paused = false; document.getElementById('pause').textContent = 'Pause'; rebuild(); };
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; update(true); };

function drawPattern() {
  const el = document.getElementById('pattern');
  el.innerHTML = patternSVG(out.pieces).replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, '');
  const s = el.querySelector('svg');
  s.style.maxHeight = '260px';
  if (dark) s.querySelectorAll('text').forEach((t) => t.setAttribute('fill', '#ddd'));
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
document.getElementById('exp-svg').onclick = () => download(`${recipe.id}-pattern.svg`, patternSVG(out.pieces), 'image/svg+xml');
document.getElementById('exp-obj').onclick = () => {
  let s = `# ${recipe.name} — designbyreduction shape catalogue\n`;
  for (let i = 0; i < fab.nCloth; i++) s += `v ${fab.pos[i * 3].toFixed(4)} ${fab.pos[i * 3 + 1].toFixed(4)} ${fab.pos[i * 3 + 2].toFixed(4)}\n`;
  for (let t = 0; t < fab.tris.length; t += 3) s += `f ${fab.tris[t] + 1} ${fab.tris[t + 1] + 1} ${fab.tris[t + 2] + 1}\n`;
  download(`${recipe.id}.obj`, s, 'text/plain');
};
document.getElementById('exp-json').onclick = () => download(`${recipe.id}-params.json`, JSON.stringify({ recipe: recipe.id, ...params }, null, 2), 'application/json');

resize();
select(new URLSearchParams(location.search).get('r') || RECIPES[0].id);
loop();
window.__sim = () => fab;
