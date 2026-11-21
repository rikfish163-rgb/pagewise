export type Rect = [number, number, number, number];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function normalizedRect(a: number[], b: number[], box: {left: number; top: number; width: number; height: number}): Rect | null {
  if (!box.width || !box.height) return null;
  const x1 = clamp((Math.min(a[0], b[0]) - box.left) / box.width);
  const y1 = clamp((Math.min(a[1], b[1]) - box.top) / box.height);
  const x2 = clamp((Math.max(a[0], b[0]) - box.left) / box.width);
  const y2 = clamp((Math.max(a[1], b[1]) - box.top) / box.height);
  if ((x2-x1)*box.width < 3 || (y2-y1)*box.height < 3) return null;
  return [x1,y1,x2-x1,y2-y1];
}
export function pixelRect(rect: number[], width: number, height: number): Rect {
  const x = Math.floor(clamp(rect[0]) * width), y = Math.floor(clamp(rect[1]) * height);
  return [x, y, Math.max(1, Math.ceil(Math.min(1-clamp(rect[0]), rect[2])*width)), Math.max(1, Math.ceil(Math.min(1-clamp(rect[1]), rect[3])*height))];
}
export function pageWithin(page: number, count: number) { return Math.max(1, Math.min(Math.max(1,count), Math.floor(page) || 1)); }
