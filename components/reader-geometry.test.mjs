import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestTextRun, normalizedRect, pixelRect, pageWithin } from './reader-geometry.ts';
import { locateAnchor, scrollTopFor } from './reading-position.ts';
import { isSparseText, layoutPdfText } from './reader-text.ts';
import { annotationsVisible, pageRenderState } from './reader-page-state.ts';

test('crop aligns CSS drag coordinates to backing pixels at any zoom', () => {
  const rect = normalizedRect([250, 150], [150, 100], { left: 100, top: 50, width: 400, height: 200 });
  assert.deepEqual(rect, [0.125, 0.25, 0.25, 0.25]);
  assert.deepEqual(pixelRect(rect, 1600, 800), [200, 200, 400, 200]);
});
test('selection clips to page and ignores clicks', () => {
  assert.deepEqual(normalizedRect([-20, -30], [1000, 1000], {left: 0, top: 0, width: 400, height: 200}), [0, 0, 1, 1]);
  assert.equal(normalizedRect([10, 10], [11, 11], {left: 0, top: 0, width: 400, height: 200}), null);
});
test('text selection in a line margin stays on that line, even when another line is closer horizontally', () => {
  const shortLine = {left: 20, right: 90, top: 40, bottom: 60};
  const longLine = {left: 10, right: 300, top: 64, bottom: 84};
  assert.equal(nearestTextRun([shortLine, longLine], 270, 55), shortLine);
  assert.equal(nearestTextRun([shortLine, longLine], 14, 50), shortLine);
  assert.equal(nearestTextRun([shortLine, longLine], 45, 61), shortLine);
  assert.equal(nearestTextRun([shortLine, longLine], 45, 63), longLine);
});
test('text selection in a gap between runs snaps to the nearer edge on the same line', () => {
  const first = {left: 20, right: 80, top: 40, bottom: 60};
  const second = {left: 100, right: 150, top: 40, bottom: 60};
  assert.equal(nearestTextRun([first, second], 84, 50), first);
  assert.equal(nearestTextRun([first, second], 98, 50), second);
  assert.equal(nearestTextRun([], 10, 10), undefined);
});
test('pages use a one-based bounded contract', () => {
  assert.equal(pageWithin(0, 4), 1);
  assert.equal(pageWithin(99, 4), 4);
  assert.equal(pageWithin(2.8, 4), 2);
});

test('live scroll position maps to the page under the viewport top', () => {
  const boxes = [
    { top: 24, height: 1000 },
    { top: 1244, height: 1000 },
    { top: 2464, height: 1000 },
  ];
  assert.deepEqual(locateAnchor(boxes, 24), { anchorPage: 1, fraction: 0 });
  assert.deepEqual(locateAnchor(boxes, 524), { anchorPage: 1, fraction: 0.5 });
  assert.deepEqual(locateAnchor(boxes, 1244), { anchorPage: 2, fraction: 0 });
  assert.deepEqual(locateAnchor(boxes, 2964), { anchorPage: 3, fraction: 0.5 });
});

test('anchor position clamps at the document edges and is not stale progress', () => {
  const boxes = [
    { top: 0, height: 800 },
    { top: 800, height: 800 },
  ];
  assert.deepEqual(locateAnchor(boxes, -50), { anchorPage: 1, fraction: 0 });
  assert.deepEqual(locateAnchor(boxes, 5000), { anchorPage: 2, fraction: 1 });
  assert.equal(scrollTopFor(boxes, 2, 0), 800);
  assert.equal(scrollTopFor(boxes, 2, 0.25), 1000);
  assert.equal(scrollTopFor(boxes, 9, 0.5), 1200);
  assert.equal(scrollTopFor([], 3, 0.5), 0);
});

const item = (str, y, x = 0, size = 12) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5 });

test('pdf text items group into readable lines without inventing content', () => {
  const items = [
    item('第一行', 700, 50),
    item('继续', 700, 120),
    item('第二行', 680, 50),
    item('尾部', 640, 50),
  ];
  assert.equal(layoutPdfText(items), '第一行继续\n第二行\n\n尾部');
});

test('pdf text keeps latin word gaps and drops empty runs', () => {
  const items = [
    item('Hello', 700, 50),
    item('world', 700, 100),
    item('  ', 700, 160),
    item('Next', 686, 50),
  ];
  assert.equal(layoutPdfText(items), 'Hello world\nNext');
  assert.equal(layoutPdfText([]), '');
});

test('sparse text is reported instead of pretending the page has a text layer', () => {
  assert.equal(isSparseText(''), true);
  assert.equal(isSparseText('图 1'), true);
  assert.equal(isSparseText('这一页有足够长的可读正文，学生可以直接在手机上阅读。'), false);
});

test('page render state gates annotations and visible feedback', () => {
  assert.equal(pageRenderState({ busy: true, error: '', hasText: false }), 'loading');
  assert.equal(pageRenderState({ busy: false, error: '读取失败', hasText: false }), 'error');
  assert.equal(pageRenderState({ busy: false, error: '', hasText: false }), 'empty-text');
  assert.equal(pageRenderState({ busy: false, error: '', hasText: true }), 'ready');
  assert.equal(annotationsVisible('ready'), true);
  assert.equal(annotationsVisible('empty-text'), true);
  assert.equal(annotationsVisible('loading'), false);
  assert.equal(annotationsVisible('error'), false);
});
