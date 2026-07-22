# Phase 1A Styles and Render Profile

```mermaid
flowchart LR
    Controls["Shared style / profile actions"] --> Controller["editor-web"]
    Controller --> Command["Rust Command + Transaction"]
    Command --> Document["Schema V2 Document"]
    Document --> Resolver["Clean / deterministic Sketch resolver"]
    Resolver --> Scene["Resolved paint + profile"]
    Scene --> Renderer["Framework-neutral SVG"]
```

This slice completes the Phase 1A appearance contract without moving semantic state into a framework or renderer. The UI exposes a deliberately small set of durable presets; Rust validates and persists the exact values, owns Undo/Redo, and resolves both Clean and Sketch Scene nodes.

## Product Contract

- The top bar exposes document-level `Clean` and `Sketch`. Sketch uses one fixed versioned preset (`seed=1313817669`, `roughness=1.2`, `bowing=0.8`, hachure fill); advanced randomness controls are not product UI in Phase 1A.
- A compact contextual panel appears only for a writable Rust-owned selection. Rectangles expose fill, stroke, and width; strokes expose color and width; text exposes color, size, and alignment.
- Presets are finite and named in the UI. Fill uses mint, blue, amber, or none; stroke/text uses ink, emerald, blue, or rose; widths are 1/2/4px; text sizes are 18/24/32px; alignment is start/center/end.
- Each actual style/profile change is one Command, one Document revision, and one Undo entry. Re-selecting the current preset is a no-op; invalid paint or a patch for the wrong element kind is atomically rejected.

## Ownership and Determinism

- Schema V2 persists `renderProfile` and element paint. V1 snapshots migrate copy-on-write to Clean and the exact previous visual defaults, so refresh does not silently recolor existing content.
- `SelectionStateV1` carries a Rust-derived style presentation. UI adapters never inspect SVG attributes or deserialize a Document copy to determine active controls.
- Scene snapshots identify their resolved profile. Clean and Sketch both consume persistent element paint; Renderer only applies resolved attributes and never receives a random source.
- Text alignment changes semantic bounds and resolved `text-anchor`; font size changes reuse the existing two-phase fixed-font metrics protocol.

## Acceptance

- Rectangle, stroke, and text style changes plus Profile toggles each round-trip through persistence, Undo, Redo, and reload.
- Clean↔Sketch keeps element IDs, kinds, geometry, and content unchanged; the same Document/Profile/font metrics/algorithm produces the same Scene hash across native Rust and WASM.
- React, Vue, and Vanilla show the same active presets, readonly gating, labels, and contextual visibility through one Controller contract.
- Real generated WASM verifies all three visible hosts before delivery.

---
*Last updated: 2026-07-23 | Reason: freeze the Phase 1A style and Clean/Sketch product contract*
