# 页边 / Reading at the margin

A Chinese learning workspace, not a chat landing page. The actual lecture is the focal point; course shelves and independent discussions form its margins.

## Direction

Use near-white paper in the light theme and neutral charcoal in the dark theme. Use warm red for primary actions and links in light mode and soft coral in dark mode. Shared tokens live in `app/globals.css`, with detailed values in [the redesign plan](Pagewise-innei-ui-redesign.md). The account appearance controls offer light, dark and system modes plus local background preferences. Use LXGW WenKai for the brand, section and document titles, and short excerpts. Use the system sans-serif stack for controls, forms and discussion text. Code uses JetBrains Mono. PDF/PPTX pages, images and KaTeX equations use their original colors and typography.

The desktop pairs an adjustable discussion margin with a flexible document stage and an optional shelf. Narrower layouts use overlaid shelves and discussion panels. The home page prioritizes resume reading and recent documents. Library search has a paper dialog and retains its result context while a document is open. On mobile the document has the full width and the discussion panel offers a return-to-reading control. The wide learning homepage uses maple and fan-shaped leaves with quieter small fragments. Project, reading and narrow layouts use static surfaces.

## Interaction contracts

- Each selection gets an independent local draft, persisted by the actual API on first question. The bundled sample is uploaded through the normal document endpoint before its first question.
- Pending replies and errors are keyed by discussion ID. Switching selections does not cancel or overwrite another reply.
- Course memory lists actual answered discussions and actual response references, never invented examples.
- Upload requires a course and PDF/PPTX. Delete confirms its actual cascading effect. API errors stay visible in the relevant discussion or dialog.
- Keyboard focus, readable labels, reduced motion and mobile reading are supported. No credential is requested in the browser.
- Pagewise drafts preserve their document and discussion ownership. Opening a citation restores the originating reader location. Saving a notebook displays the confirmed server status.
- The notebook uses a left index and a quiet writing surface with the existing paper, ink, warm red, muted text and border tokens. Note numbers identify real records; they are editable positive integers unique to the current account. The full notebook filters across projects and discussions, while the reading margin uses a compact note switcher.
- Each note keeps its own unsaved edits and server revision. One note may have several project or discussion sources. Moving or renaming a project updates those sources; removing a source document or discussion preserves the note and its source description. The old single notebook becomes “原学习笔记”.

## Initial audit and acceptance

The starter was a skeleton-only page with generic placeholder bars and English building-status copy. This was replaced, not cosmetically themed. The finished UI uses real lecture files, real uploads and real model-response states. The final pixel/interaction check is performed against the running integrated application by the main owner.

Model regression tests cover independent reply updates, per-document isolation and image-only selection labels. These tests are intentionally independent of backend correctness and visual acceptance.
