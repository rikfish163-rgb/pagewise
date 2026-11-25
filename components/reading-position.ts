export type PageBox = { top: number; height: number };
export type Anchor = { anchorPage: number; fraction: number };

// Page boxes use scroll-content coordinates: a page top is the scrollTop that
// would place that page's top edge at the top of the reading viewport.
export function locateAnchor(boxes: PageBox[], scrollTop: number): Anchor {
  if (!boxes.length) return { anchorPage: 1, fraction: 0 };
  const top = Number.isFinite(scrollTop) ? scrollTop : 0;
  let low = 0;
  let high = boxes.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (boxes[mid].top <= top) low = mid;
    else high = mid - 1;
  }
  const start = boxes[low].top;
  const gap = low + 1 < boxes.length ? boxes[low + 1].top - start : 0;
  const span = Math.max(1, boxes[low].height || gap);
  return { anchorPage: low + 1, fraction: Math.max(0, Math.min(1, (top - start) / span)) };
}

export function scrollTopFor(boxes: PageBox[], page: number, fraction = 0): number {
  if (!boxes.length) return 0;
  const index = Math.max(0, Math.min(boxes.length - 1, Math.floor(page) - 1));
  const start = boxes[index].top;
  const gap = index + 1 < boxes.length ? boxes[index + 1].top - start : 0;
  const span = Math.max(1, boxes[index].height || gap);
  return start + Math.max(0, Math.min(1, fraction)) * span;
}
