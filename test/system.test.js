import { GridSystem } from '../src/system.js';
const cases = {
  fig6: {},
  fig8: { panels: true, slab: true },
  fig7: { panels: true },
  fig4: { walls: true, panels: true, slab: true },
};
let fail = 0;
for (const [name, p] of Object.entries(cases)) {
  const t0 = Date.now();
  const g = new GridSystem(p).run(500);
  const s = g.stats();
  const ok = isFinite(s.pourVolume) && s.pourVolume > 0 && s.strain < 0.06;
  if (!ok) fail++;
  const parts = Object.entries(g.parts).map(([k, m]) => `${k}:${m.iter}/${(m.maxStrain()*100).toFixed(1)}%`).join(' ');
  console.log(`${ok ? 'ok ' : 'BAD'} ${name} pour=${s.pourVolume.toFixed(2)}m3 slab=${s.slabVolume.toFixed(2)}m3 sag=${(s.sag*1000).toFixed(0)}mm col=${s.vColumn.toFixed(3)} tube=${s.vTube.toFixed(3)} [${parts}] ${Date.now()-t0}ms`);
}
process.exit(fail ? 1 : 0);
