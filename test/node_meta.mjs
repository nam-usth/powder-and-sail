// Run the pure-JS meta suites in Node: `node test/node_meta.mjs`
import { results } from './runner.js';
await import('./12_Meta.test.js');
let pass = 0, fail = 0;
for (const s of results.suites) for (const t of s.tests) {
  try { await t.fn(); pass++; }
  catch (e) { fail++; console.log(`✗ ${s.name} › ${t.name}\n   ${e.message}`); }
}
console.log(`${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
