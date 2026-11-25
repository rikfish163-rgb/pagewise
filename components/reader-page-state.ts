export type PageRenderState = 'loading' | 'error' | 'empty-text' | 'ready';

export function pageRenderState(input: { busy: boolean; error: string; hasText: boolean }): PageRenderState {
  if (input.busy) return 'loading';
  if (input.error) return 'error';
  return input.hasText ? 'ready' : 'empty-text';
}

export function annotationsVisible(state: PageRenderState) {
  return state === 'ready' || state === 'empty-text';
}
