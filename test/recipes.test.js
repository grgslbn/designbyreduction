import { RECIPES, defaults, build, patternSVG } from '../src/recipes.js';
let fail = 0;
for (const r of RECIPES) {
  const t0 = Date.now();
  const p = defaults(r);
  const out = build(r, p);
  out.fab.run(900);
  const st = out.fab.maxStrain();
  const ro = r.readout.call(r, out.fab, p);
  const svg = patternSVG(out.pieces);
  const ok = st < 0.08 && ro.every(([, v]) => !/NaN|Infinity/.test(v)) && svg.length > 100;
  if (!ok) fail++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${r.family} ${r.id.padEnd(8)} it=${out.fab.iter} res=${out.fab.residual.toExponential(1)} strain=${(st*100).toFixed(1)}% ${Date.now()-t0}ms | ${ro.map(([k,v])=>k+': '+v).join(' | ')}`);
}
process.exit(fail ? 1 : 0);
