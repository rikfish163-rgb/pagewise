# 页边 / Reading at the margin

A Chinese learning workspace, not a chat landing page. The actual lecture is the focal point; course shelves and independent discussions form its margins.

## Direction

Codex Absolutely light: opaque warm surface `#f5f3ee`, ink `#1d1b16`, accent `#da7756`, contrast setting 60. Use darker terracotta for small text and ink on filled accent buttons. The masthead, controls, inputs and discussion text share the handwritten rhythm of LXGW WenKai; use its medium cut for emphasis rather than synthetic bold. Self-hosted WOFF2 files cover the interface first and load additional glyphs on demand. Code retains JetBrains Mono for alignment; original PDF/PPT pages and KaTeX equations keep their own typography.

The desktop is a 208px course shelf, flexible document stage and 360px discussion margin. At tablet widths the shelf becomes a drawer. On mobile the document remains full width, with an explicit discussion switch and return control. Native select keeps every discussion accessible without overflowing a tab row.

## Interaction contracts

- Each selection gets an independent local draft, persisted by the actual API on first question. The bundled sample is uploaded through the normal document endpoint before its first question.
- Pending replies and errors are keyed by discussion ID. Switching selections does not cancel or overwrite another reply.
- Course memory lists actual answered discussions and actual response references, never invented examples.
- Upload requires a course and PDF/PPTX. Delete confirms its actual cascading effect. API errors stay visible in the relevant discussion or dialog.
- Keyboard focus, readable labels, reduced motion and mobile reading are supported. No credential is requested in the browser.

## Initial audit and acceptance

The starter was a skeleton-only page with generic placeholder bars and English building-status copy. This was replaced, not cosmetically themed. The finished UI uses real lecture files, real uploads and real model-response states. The final pixel/interaction check is performed against the running integrated application by the main owner.

Model regression tests cover independent reply updates, per-document isolation and image-only selection labels. These tests are intentionally independent of backend correctness and visual acceptance.
