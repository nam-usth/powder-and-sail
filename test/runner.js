// ── TEST RUNNER ──────────────────────────────────────────────────
// Zero-dependency test runner for IOW.
// Runs entirely in browser via ES modules — no Jest, no bundler, no Node.
// Usage: open test/index.html in browser after python -m http.server 8080
//
// API:
//   suite('name', fn)   — group of tests
//   test('name', fn)    — individual test (sync or async)
//   assert(cond, msg)   — throws on failure
//   assertEqual(a,b,msg)
//   assertApprox(a,b,eps,msg)
//   assertThrows(fn, msg)

export const results = { pass: 0, fail: 0, suites: [] };

let _currentSuite = null;

export function suite(name, fn) {
  const s = { name, tests: [] };
  results.suites.push(s);
  _currentSuite = s;
  fn();
  _currentSuite = null;
}

export function test(name, fn) {
  if (!_currentSuite) throw new Error('test() must be inside suite()');
  _currentSuite.tests.push({ name, fn, status: 'pending', error: null });
}

export function assert(cond, msg = 'Assertion failed') {
  if (!cond) throw new Error(msg);
}

export function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export function assertApprox(a, b, eps = 0.0001, msg) {
  if (Math.abs(a - b) > eps)
    throw new Error(msg || `Expected ~${b} (±${eps}), got ${a}`);
}

export function assertThrows(fn, msg = 'Expected function to throw') {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg);
}

export function assertGT(a, b, msg) {
  if (!(a > b)) throw new Error(msg || `Expected ${a} > ${b}`);
}

export function assertLT(a, b, msg) {
  if (!(a < b)) throw new Error(msg || `Expected ${a} < ${b}`);
}

// ── Run all registered tests ──────────────────────────────────────
export async function runAll(renderFn) {
  for (const s of results.suites) {
    for (const t of s.tests) {
      try {
        await Promise.resolve(t.fn());
        t.status = 'pass';
        results.pass++;
      } catch(e) {
        t.status = 'fail';
        t.error  = e.message;
        results.fail++;
      }
    }
  }
  if (renderFn) renderFn(results);
  return results;
}
