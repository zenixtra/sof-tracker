'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { FastBars } = require('../lib/fastbars');

test('fast bars learn the bar scale from the numbers, and ignore misreads', () => {
  const f = new FastBars();
  // before any full look: the bar as measured
  assert.deepStrictEqual(f.quick({ t: 1, hp: 0.5, mp: 0.087, exp: 45.2 }), { t: 1, hpPct: 50, mpPct: 8.7, exp: 45.2 });
  // the MP bar shows 0.87 of the real value (174 / 1680 = 10.4 %, bar 8.7 %); HP is exact
  for (let i = 0; i < 5; i++) f.full({ hp: [2261, 2261], mp: [174, 1680], bars: { hp: 1, mp: 0.087 } });
  f.full({ hp: [2261, 2261], mp: [5869, 100000], bars: { hp: 1, mp: 0.5 } }); // a misread (ratio 0.12): ignored
  f.full({ hp: null, mp: [3, 1680], bars: { hp: 1, mp: 0.001 } });          // too empty to learn from
  const q = f.quick({ t: 2, hp: 0.42, mp: 0.5, exp: null });
  assert.strictEqual(q.hpPct, 42);
  assert.strictEqual(q.mpPct, 59.5); // 0.5 × (10.357 / 8.7)
  assert.strictEqual(f.quick({ t: 3, hp: 1, mp: 0.95 }).mpPct, 100); // never above 100 %
  assert.strictEqual(f.quick({ t: 4, hp: -1, mp: 0.2 }).hpPct, null); // no bar seen
});
