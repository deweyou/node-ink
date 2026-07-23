---
name: nodeink-design
description: Canvas-first, low-interference desktop editing with approachable ink character and reliable system feedback.
version: 1
tokens:
  color:
    canvas: '#fafafa'
    surface: '#ffffff'
    text: 'hsl(28 3.68% 18%)'
    primary: 'hsl(154 37.2% 27%)'
    ink: '#0f172a'
    emerald: '#047857'
    blue: '#2563eb'
    rose: '#e11d48'
    mint-fill: '#d1fae5'
    blue-fill: '#dbeafe'
    amber-fill: '#fef3c7'
  typography:
    control: 'Source Han Sans SC Web, PingFang SC, Heiti SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif'
    content: 'Noto Sans SC Variable'
  spacing:
    rhythm: '4px'
---

# NodeInk Design

NodeInk keeps the canvas visually dominant, controls quiet and discoverable, and feedback explicit enough to earn trust in a local-first editor. It takes interaction cues from tldraw and approachability cues from Excalidraw without copying either product's visual identity.

## Design Thesis

The interface should disappear until the user needs it. Content owns the visual hierarchy; chrome communicates tool state, history, save/recovery state, and errors without competing with the drawing.

## Principles

- Prefer direct manipulation and one obvious active tool.
- Show only implemented actions; do not seed the UI with disabled future-product promises.
- Use compact desktop controls with generous canvas space.
- Preserve predictable, explicit state transitions over decorative motion.
- Use Clean as the stable product baseline while interaction capabilities mature; treat alternative rendering as a later coherent style-system decision.

## Typography

- Use the shared sans-serif stack for UI controls and status text.
- Keep labels short, sentence case, and legible at 12–14px; reserve larger type for page or document identity.
- Canvas content uses the bundled `Noto Sans SC Variable` at 24px/400 by default. Hosts must wait for the 400 and 500 weights before opening the engine so persisted metrics never depend on an accidental system fallback.

## Color

- Use warm-neutral canvas, white surfaces, near-black text, and subtle warm-gray borders.
- Emerald is the interaction accent for focus, active tools, and positive system identity.
- Red is reserved for actionable errors and recovery-risk communication.
- Introduce colors through named tokens in `apps/playground/src/styles.css`, not scattered component literals.

## Layout

- Desktop Web is the Phase 1 target; the current minimum layout width is 720px.
- Keep the top bar shallow, tools in a narrow edge rail, and the main canvas uninterrupted.
- Overlay status and errors at canvas edges, away from the primary drawing focus.
- Responsive mobile editing is not implied by making a dialog fit a narrow viewport.

## Components

- Buttons use the shared border radius, minimum 36px height, clear hover, and visible keyboard focus.
- Active tools must be distinguishable without relying only on color.
- Status badges are compact metadata, not primary calls to action.
- New panels should be contextual and dismissible rather than permanently shrinking the canvas.
- Selection styles live in a compact overlay panel at the upper-right canvas edge. It appears only when Rust reports an editable selection and never changes canvas geometry.

## Interaction

- UI actions and programmatic actions must converge on the same Controller and Rust Command path.
- Tool changes are explicit; history availability is reflected immediately in control state.
- Select, Draw, and Text are persistent tools. `V`, `P`, and `T` activate them, active buttons use `aria-pressed`, Draw uses a crosshair, Text uses a text cursor, and creating a rectangle returns to Select.
- Text starts from a canvas click in Text or a semantic double-click on existing text in Select. Editing uses a fixed-font HTML textarea overlay with no field chrome, so only the text and native caret are visible; Enter inserts a line, `Cmd/Ctrl+Enter`, a blank-canvas click, or blur commits one Transaction, and `Escape` cancels. Clearing existing text deletes the element through the normal undoable Command path.
- The current product surface is Clean-only and exposes no Render Profile control. The persisted profile field and deterministic Sketch resolver remain internal compatibility seams until a later style-system/Sketch v2 design replaces the experimental visual contract.
- Context styles use a fixed accessible palette and discrete presets: rectangle fill/stroke/width, freehand stroke/width, and text color/size/alignment. “No fill” is explicit; arbitrary CSS colors, opacity, dash, and experimental rendering parameters remain outside this slice.
- Each style press is one Rust Command and one Undo entry. Current values use `aria-pressed` and a visible check/state treatment, not color alone.
- Freehand uses fixed 3px round ink in this slice. Multi-point strokes resolve through deterministic midpoint quadratic curves so preview, committed paint, selection bounds, and hit testing follow one smooth geometry while the Document retains its original samples. Click dots and two-point or `Shift` strokes stay exact. A DOM interruption such as capture loss, pointer cancel, or window blur commits the samples already shown; only explicit editor cancellation such as `Escape` or tool switching discards the preview. Pen pressure, variable-width outlines, mobile touch editing, smoothing controls, and style controls are separate capabilities.
- The Camera percentage is relative to the current fit-content zoom. Clicking it recenters all content with 64px screen padding; content changes may update the percentage but must not move the Camera automatically.
- A primary click selects the topmost semantic element; an empty-canvas click or `Escape` clears selection. `Delete`, `Backspace`, and the visible Delete button invoke the same undoable element-deletion action.
- Selection uses a straight solid-blue ring separated from painted bounds by a 6px screen-space gap. Phase 1B adds eight square resize handles, a rotate connector/handle, a translucent marquee, and restrained snap guides; their stroke, size, hit regions, and spacing stay screen-space stable and overlay paint itself ignores pointer events.
- Once a canvas PointerDown owns a document gesture, later move/up events remain on that gesture even if modifier or Camera gates change. A DOM interruption such as capture loss, pointer cancel, or window blur commits the last visible transform; only explicit editor cancellation such as `Escape` or tool switching restores the pre-gesture document. `Shift` locks moves to the dominant axis, preserves resize aspect ratio, and snaps final rotation to absolute 45° increments.
- Rectangle and path stroke width is persistent style, not transform geometry. Element or Group resize must not stretch it; Camera zoom still projects the style width with the rest of the document.
- Persistence uses five explicit presentation states shared by every host: `未保存`, `保存中`, `已保存`, `保存失败`, and `只读`.
- A save failure remains visible with an explicit `重试` action. Read-only mode explains why editing is unavailable instead of silently disabling controls.
- Avoid ornamental transitions. Honor reduced-motion preferences.
- Errors stay visible until the cause is clear or the next successful operation resolves them.

## Accessibility

- Use native controls and semantic regions before custom hit targets.
- Preserve `:focus-visible` treatment and do not remove outlines without an equivalent tokenized ring.
- Never encode state using color alone; pair it with labels, disabled state, or accessible attributes.
- Treat keyboard editing, IME, and screen-reader canvas alternatives as acceptance work, not polish.

## Do

- Keep the canvas primary and the active action unmistakable.
- Reuse design tokens and the shared host shell across framework adapters.
- Validate visible changes in React, Vue, and Vanilla hosts when shared UI contracts change.

## Don't

- Do not copy tldraw or Excalidraw branding, iconography, or full feature density.
- Do not put semantic geometry, layout, or document ownership into React components.
- Do not substitute system fonts for committed canvas text or infer mobile editing from Pointer Events support.
- Do not let a framework adapter invent save, recovery, or read-only copy independently of the shared presentation contract.
- Do not add empty toolbar entries for Mermaid, AI, collaboration, or other future phases.
- Do not infer selected styles from SVG attributes or store a parallel profile in a framework component.

---

_Last updated: 2026-07-23 | Reason: standardize the current product on Clean and defer the visual style system_
