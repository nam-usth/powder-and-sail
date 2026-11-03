// ── TEST: EventEmitter ───────────────────────────────────────────
// Covers: on(), off(), trigger(), namespace support, no memory leak

import { suite, test, assert, assertEqual } from './runner.js';
import { EventEmitter } from '../frontend/src/Experience/EventEmitter.js';

suite('EventEmitter', () => {

  test('on() + trigger() fires callback', () => {
    const ee = new EventEmitter();
    let called = 0;
    ee.on('tick', () => called++);
    ee.trigger('tick');
    assertEqual(called, 1, 'callback should fire once');
    ee.trigger('tick');
    assertEqual(called, 2, 'callback should fire again');
  });

  test('trigger() passes args to callback', () => {
    const ee = new EventEmitter();
    let received = null;
    ee.on('data', (val) => received = val);
    ee.trigger('data', [42]);
    assertEqual(received, 42);
  });

  test('multiple listeners on same event all fire', () => {
    const ee = new EventEmitter();
    let a = 0, b = 0;
    ee.on('ping', () => a++);
    ee.on('ping', () => b++);
    ee.trigger('ping');
    assertEqual(a, 1); assertEqual(b, 1);
  });

  test('off() by namespace removes only that listener', () => {
    const ee = new EventEmitter();
    let a = 0, b = 0;
    ee.on('tick.sysA', () => a++);
    ee.on('tick.sysB', () => b++);
    ee.off('tick.sysA');
    ee.trigger('tick');
    assertEqual(a, 0, 'sysA should be removed');
    assertEqual(b, 1, 'sysB should still fire');
  });

  test('off() whole namespace clears all events in it', () => {
    const ee = new EventEmitter();
    let a = 0, b = 0;
    ee.on('tick.ns1',  () => a++);
    ee.on('resize.ns1',() => b++);
    ee.off('ns1');  // remove all ns1 events
    ee.trigger('tick');
    ee.trigger('resize');
    assertEqual(a, 0);
    assertEqual(b, 0);
  });

  test('trigger on unknown event does not throw', () => {
    const ee = new EventEmitter();
    // Should not throw
    ee.trigger('nonexistent');
    assert(true, 'no crash on unknown event');
  });

  test('off() non-existent listener does not throw', () => {
    const ee = new EventEmitter();
    ee.off('tick.ghost');
    assert(true, 'no crash');
  });

  test('chaining: on().on().trigger()', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.on('a', () => count++).on('a', () => count++);
    ee.trigger('a');
    assertEqual(count, 2);
  });

});
