import {nearestTextRun} from './reader-geometry';

const selectableRun = 'span:not(.markedContent):not([role="img"])';
export type TextCaret = {node: Text; offset: number};

function browserCaret(doc: Document, x: number, y: number): TextCaret | undefined {
  const caret = doc.caretPositionFromPoint?.(x, y);
  if (caret) return caret.offsetNode instanceof Text ? {node: caret.offsetNode, offset: caret.offset} : undefined;
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range?.startContainer instanceof Text) return {node: range.startContainer, offset: range.startOffset};
}

export function textMarginCaret(layer: HTMLElement, target: EventTarget | null, x: number, y: number): TextCaret | undefined {
  if (!(target instanceof Element) || !layer.contains(target) || target.closest(selectableRun)) return;

  const runs = Array.from(layer.querySelectorAll<HTMLElement>(selectableRun)).flatMap(span => {
    const node = span.firstChild;
    if (!(node instanceof Text) || !node.data.trim()) return [];
    const {left, right, top, bottom} = span.getBoundingClientRect();
    return right > left && bottom > top ? [{node, span, left, right, top, bottom}] : [];
  });
  const run = nearestTextRun(runs, x, y);
  if (!run) return;

  if (x <= run.left || x >= run.right) {
    const rtl = getComputedStyle(run.span).direction === 'rtl';
    const onLeft = x <= run.left;
    return {node: run.node, offset: onLeft === rtl ? run.node.length : 0};
  }
  // In an interline gap, keep the horizontal character position on the nearest run.
  const caret = browserCaret(layer.ownerDocument, x, (run.top + run.bottom) / 2);
  if (caret?.node === run.node) return caret;
}

export function snapTextSelection(
  selection: Selection, layer: HTMLElement, target: EventTarget | null, x: number, y: number, marginAnchor?: TextCaret,
) {
  const anchor = marginAnchor?.node ?? selection.anchorNode;
  if (!(anchor instanceof Text) || !layer.contains(anchor) || !(target instanceof Element) || !layer.contains(target)) return;
  // Keep native character selection when both ends are over actual text.
  const focus = target.closest(selectableRun)
    ? marginAnchor && browserCaret(layer.ownerDocument, x, y)
    : textMarginCaret(layer, target, x, y);
  if (!focus || !layer.contains(focus.node)) return;

  const start = marginAnchor?.offset ?? selection.anchorOffset;
  if (selection.anchorNode !== anchor || selection.anchorOffset !== start ||
      selection.focusNode !== focus.node || selection.focusOffset !== focus.offset) {
    selection.setBaseAndExtent(anchor, start, focus.node, focus.offset);
  }
}
