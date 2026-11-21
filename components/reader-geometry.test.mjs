import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedRect, pixelRect, pageWithin } from './reader-geometry.ts';

test('crop aligns CSS drag coordinates to backing pixels at any zoom', () => {
  const rect = normalizedRect([250, 150], [150, 100], { left: 100, top: 50, width: 400, height: 200 });
  assert.deepEqual(rect, [0.125, 0.25, 0.25, 0.25]);
  assert.deepEqual(pixelRect(rect, 1600, 800), [200, 200, 400, 200]);
});
test('selection clips to page and ignores clicks', () => {
  assert.deepEqual(normalizedRect([-20, -30], [1000, 1000], {left: 0, top: 0, width: 400, height: 200}), [0, 0, 1, 1]);
  assert.equal(normalizedRect([10, 10], [11, 11], {left: 0, top: 0, width: 400, height: 200}), null);
});
test('pages use a one-based bounded contract', () => {
  assert.equal(pageWithin(0, 4), 1);
  assert.equal(pageWithin(99, 4), 4);
  assert.equal(pageWithin(2.8, 4), 2);
});
