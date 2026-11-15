import { Deck } from '../src/deck.js';
let fail = 0;
for (const v of [{}, { propped: false }]) {
  const d = new Deck(v);
  for (let i = 0; i < 1200; i++) if (d.step() < 1e-5) break;
  const s = d.stats();
  const ok = s.volume > 0 && s.strain < 0.06 && (v.propped === false ? s.apex < 0.9 : s.apex > 0.9);
  if (!ok) fail++;
  console.log(`${ok ? 'ok ' : 'BAD'} deck ${JSON.stringify(v)} apex=${s.apex.toFixed(2)} V=${s.volume.toFixed(1)}m3 strain=${(s.strain * 100).toFixed(1)}%`);
}
process.exit(fail ? 1 : 0);
