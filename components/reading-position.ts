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

// Progress uses zero-based page units. Include the leading desk and page gaps
// in the scroll spans so moving through them also advances the slider.
export function pageProgressAt(boxes: PageBox[], scrollTop: number): number {
  if (!boxes.length) return 0;
  const top = Number.isFinite(scrollTop) ? scrollTop : 0;
  const { anchorPage } = locateAnchor(boxes, top);
  const index = anchorPage - 1;
  const start = index === 0 ? 0 : boxes[index].top;
  const end = boxes[index + 1]?.top ?? boxes[index].top + boxes[index].height;
  const span = Math.max(1, end - start);
  return index + Math.max(0, Math.min(1, (top - start) / span));
}

export function scrollTopForProgress(boxes: PageBox[], progress: number): number {
  if (!boxes.length) return 0;
  const value = Number.isFinite(progress) ? progress : 0;
  const index = Math.max(0, Math.min(boxes.length - 1, Math.floor(value)));
  const start = index === 0 ? 0 : boxes[index].top;
  const end = boxes[index + 1]?.top ?? boxes[index].top + boxes[index].height;
  const span = Math.max(1, end - start);
  return start + Math.max(0, Math.min(1, value - index)) * span;
}
