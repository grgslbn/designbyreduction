import { ColumnSim } from '../src/sim.js';
const cases = {
  cylinder: {},
  tapered: { circBottom: 1.2, circTop: 0.6 },
  fluted: { flutes: 8, fluteDepth: 0.8 },
  belly: { bulge: 0.25 },
  ringed: { rings: [{ at: 0.33, r: 0.6 }, { at: 0.66, r: 0.6 }] },
  mushroom: { circBottom: 0.95, circTop: 0.95, capital: 3.2, capitalZone: 0.3, hang: 0.9, topRing: 0.9 },
  halfFill: { fill: 0.5 },
};
let fail = 0;
for (const [name, p] of Object.entries(cases)) {
  const t0 = Date.now();
  const s = new ColumnSim(p);
  s.run(600);
  const prof = s.profile();
  const mid = prof[Math.floor(prof.length / 2)];
  const rNat = s.flatW[Math.floor(prof.length / 2)] / (2 * Math.PI);
  const V = s.volume();
  const st = s.maxStrain(); const ok = isFinite(V) && V > 0 && st < 0.05;
  if (!ok) fail++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${name.padEnd(9)} iters=${s.iter} res=${s.residual.toExponential(1)} V=${V.toFixed(3)}m3 midR=${mid.r.toFixed(3)} (natural ${rNat.toFixed(3)}) strain=${(st*100).toFixed(1)}% ${Date.now() - t0}ms`);
}
process.exit(fail ? 1 : 0);
