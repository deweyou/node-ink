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
  typography:
    control: 'Source Han Sans SC Web, PingFang SC, Heiti SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif'
    content: 'TODO pending P-02 fixed canvas font decision'
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
- Let Clean and future Sketch rendering express content style; application chrome stays restrained.

## Typography

- Use the shared sans-serif stack for UI controls and status text.
- Keep labels short, sentence case, and legible at 12–14px; reserve larger type for page or document identity.
- Canvas-content typography is not decided. Confirm P-02 before selecting or bundling a fixed font.

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

## Interaction

- UI actions and programmatic actions must converge on the same Controller and Rust Command path.
- Tool changes are explicit; history availability is reflected immediately in control state.
- Select and Draw are persistent tools. `V` and `P` activate them, active buttons use `aria-pressed`, Draw uses a crosshair, and creating a rectangle returns to Select.
- Freehand uses fixed 3px round ink in this slice. Pen pressure, variable-width outlines, mobile touch editing, and style controls are separate capabilities.
- The Camera percentage is relative to the current fit-content zoom. Clicking it recenters all content with 64px screen padding; content changes may update the percentage but must not move the Camera automatically.
- A primary click selects the topmost semantic element; an empty-canvas click or `Escape` clears selection. `Delete`, `Backspace`, and the visible Delete button invoke the same undoable element-deletion action.
- Selection uses a straight solid-blue ring separated from the element's visible painted bounds by a 6px screen-space gap. The overlay keeps constant screen-space stroke and spacing, ignores pointer events, and must not add resize or rotate handles before Phase 1B.
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
- Do not invent the final canvas font or infer mobile editing from Pointer Events support.
- Do not let a framework adapter invent save, recovery, or read-only copy independently of the shared presentation contract.
- Do not add empty toolbar entries for Mermaid, AI, collaboration, or other future phases.

---

_Last updated: 2026-07-23 | Reason: confirm shared Tool State and fixed-width freehand direction_
