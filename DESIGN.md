# 页边 / Reading at the margin

A Chinese learning workspace, not a chat landing page. The actual lecture is the focal point; course shelves and independent discussions form its margins.

## Direction

Warm paper light and charcoal dark themes, with text and components using theme-aware tokens in `app/globals.css`. The terracotta accent distinguishes links and active controls. The account appearance controls offer light, dark and system modes, and a local background-motion setting. Use the existing LXGW WenKai files for the brand, section and document titles, and short excerpts. Keep navigation, controls, forms and long discussion text on the system sans-serif stack. Code uses JetBrains Mono. Original PDF/PPT pages and KaTeX equations keep their own typography.

The desktop is a course shelf, flexible document stage and adjustable discussion margin. The home and project pages prioritize resume reading and actual recent documents. At tablet widths the shelf opens as a drawer. On mobile the document remains full width, with an explicit discussion switch and a return-to-reading control. Paper texture stays faint behind content. Floating decorative leaves appear in desktop home-page whitespace, pause for reduced motion and are removed on mobile. Keep native PDF/PPT and image colors unchanged.

## Interaction contracts

- Each selection gets an independent local draft, persisted by the actual API on first question. The bundled sample is uploaded through the normal document endpoint before its first question.
- Pending replies and errors are keyed by discussion ID. Switching selections does not cancel or overwrite another reply.
- Course memory lists actual answered discussions and actual response references, never invented examples.
- Upload requires a course and PDF/PPTX. Delete confirms its actual cascading effect. API errors stay visible in the relevant discussion or dialog.
- Keyboard focus, readable labels, reduced motion and mobile reading are supported. No credential is requested in the browser.
- Pagewise drafts preserve their document and discussion ownership. Opening a citation restores the originating reader location. Saving a notebook displays the confirmed server status.

## Initial audit and acceptance

The starter was a skeleton-only page with generic placeholder bars and English building-status copy. This was replaced, not cosmetically themed. The finished UI uses real lecture files, real uploads and real model-response states. The final pixel/interaction check is performed against the running integrated application by the main owner.

Model regression tests cover independent reply updates, per-document isolation and image-only selection labels. These tests are intentionally independent of backend correctness and visual acceptance.
