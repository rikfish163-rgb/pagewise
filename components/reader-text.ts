export type PdfTextItem = { str?: string; width?: number; transform?: number[] };

const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

function itemSize(transform: number[] | undefined) {
  if (!transform) return 12;
  const size = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
  return size > 0 ? size : 12;
}

// Group pdf.js text runs into lines so a phone can read the page without the
// original layout. Only source strings are used; nothing is generated.
export function layoutPdfText(items: PdfTextItem[]): string {
  const runs = items
    .filter(item => typeof item.str === 'string' && item.str.trim().length > 0)
    .map(item => {
      const transform = item.transform ?? [12, 0, 0, 12, 0, 0];
      const size = itemSize(transform);
      const text = item.str!.replace(/\s+/g, ' ').trim();
      return { text, x: transform[4] ?? 0, y: transform[5] ?? 0, size, right: (transform[4] ?? 0) + (item.width ?? text.length * size * 0.5) };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: { y: number; size: number; runs: typeof runs }[] = [];
  for (const run of runs) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - run.y) <= Math.max(line.size, run.size) * 0.6) {
      line.runs.push(run);
      line.size = Math.max(line.size, run.size);
    } else {
      lines.push({ y: run.y, size: run.size, runs: [run] });
    }
  }

  const output: string[] = [];
  let previous: { y: number; size: number } | null = null;
  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    let text = '';
    let previousRun: (typeof runs)[number] | null = null;
    for (const run of line.runs) {
      if (previousRun) {
        const gap = run.x - previousRun.right;
        const needsSpace = gap > Math.max(1, run.size * 0.25)
          && !CJK.test(previousRun.text.slice(-1))
          && !CJK.test(run.text.slice(0, 1));
        text += needsSpace ? ' ' : '';
      }
      text += run.text;
      previousRun = run;
    }
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (previous && previous.y - line.y > Math.max(previous.size, line.size) * 2.2) output.push('');
    output.push(trimmed);
    previous = line;
  }
  return output.join('\n').trim();
}

// Short or missing extraction means the page is a scan or a figure: the reader
// should offer the original image instead of pretending a text layer exists.
export function isSparseText(text: string) {
  return text.replace(/\s+/g, '').length < 24;
}
