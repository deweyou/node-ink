# Phase 1A Freehand Tool

```mermaid
flowchart LR
    DOM["Pointer Events"] --> Input["editor-web batch-2 adapter"]
    Input --> Tool["Rust Tool State"]
    Tool --> Stroke["Rust Stroke preview"]
    Stroke --> Commit["One CreateStroke Transaction"]
    Stroke --> Scene["Resolved Scene"]
    Scene --> Hosts["React · Vue · Vanilla"]
```

This slice turns the Phase 0 stroke transport into a visible product tool while preserving one semantic owner. React, Vue, and Vanilla expose the same Select and Draw actions; Rust decides which input state machine may run.

## Interaction Contract

- The editor starts in Select. `V` activates Select and `P` activates Draw; toolbar buttons expose the same state with `aria-pressed`.
- Entering Draw cancels any in-progress selection drag, clears selection, and changes the canvas cursor to a crosshair without changing Document revision or history.
- PointerDown shows a Rust preview, coalesced PointerMove samples use the verified Float64Array batch-2 transport, and PointerUp commits one `create_stroke` Transaction.
- Holding `Shift` transports straight-line intent with every batch; Rust keeps the raw samples but resolves the current preview and committed stroke to the origin/latest-point segment while Shift remains held.
- Three-or-more-point Clean strokes resolve to deterministic midpoint quadratic curves. The Document keeps its original samples, while preview, committed Scene path, curve-extrema bounds, and bounded-error hit testing share the same Rust geometry. Click dots, two-point strokes, and `Shift` lines remain exact.
- Draw remains active after a stroke so consecutive marks are fast. Creating a rectangle explicitly returns to Select.
- DOM pointer cancel/capture loss and window blur finalize the samples already visible so an incidental browser interruption cannot erase a whole stroke. `Escape` and tool switching remain explicit cancellation paths that remove an unfinished preview without changing the Document. Once document PointerDown succeeds, later events cannot be dropped merely because a modifier or Camera gate changes mid-gesture.
- A click without movement commits a stable 3px round dot. Mouse, trackpad, and pen position are supported; pressure and variable-width outlines remain outside this slice.
- Existing Select behavior continues to hit-test, move, delete, Undo, and Redo committed strokes through Rust-owned geometry and Commands.

## Ownership

- `crates/nodeink-core/src/tool.rs` owns non-persistent Tool State. It is returned in every `EngineUpdateV1` but is excluded from Document serialization, persistence, Camera state, and Undo/Redo.
- `packages/editor-web/src/freehand-input.ts` only converts normalized DOM batches into the stroke transport. It does not choose the active tool or mutate document objects.
- Rust rejects pointer input routed to Draw and stroke input routed to Select, preventing a stale browser snapshot from creating a second semantic path.
- `crates/nodeink-core/src/stroke_geometry.rs` owns Clean curve resolution, visual bounds, and deterministic hit-test flattening without changing the persistent Stroke schema.
- `renderer-svg` remains unchanged: it draws resolved Scene paths and does not know how strokes were captured or smoothed.

## Acceptance

- Tool changes are visible and accessible in all three hosts and never change Document revision.
- A freehand preview is visible before commit; PointerUp creates exactly one revision and one Undo entry.
- Consecutive strokes remain in Draw; each Undo removes one complete stroke and Redo restores it.
- Smooth preview/commit parity, curve bounds/hit testing, click-only dots, Shift straight lines, ownership changes, DOM interruption recovery, explicit cancel paths, tool mismatch rejection, batch ordering, and framework-neutral host parity have automated coverage.
- Real generated WASM is exercised through `/`, `/vue.html`, and `/vanilla.html` before delivery.

---
*Last updated: 2026-07-23 | Reason: add deterministic Clean freehand smoothing with matching selection geometry*
