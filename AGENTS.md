# NodeInk Agent Guide

NodeInk is a local-first, desktop Web canvas whose persistent semantics live in Rust and whose browser integration stays framework-neutral.

## Knowledge Base

| Document                                                                                       | What it covers                                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [README.md](README.md)                                                                         | Local setup, demo URLs, and verification commands                |
| [DESIGN.md](DESIGN.md)                                                                         | Durable UI/UX and visual design contract                         |
| [docs/project-structure.md](docs/project-structure.md)                                         | Package ownership, dependency direction, and startup path        |
| [docs/architecture/technical-architecture.md](docs/architecture/technical-architecture.md)     | Product engine, protocol, persistence, and renderer architecture |
| [docs/decisions/open-questions.md](docs/decisions/open-questions.md)                           | Confirmed decisions and choices that must not be guessed         |
| [docs/planning/phase0-vertical-slice.md](docs/planning/phase0-vertical-slice.md)               | Implemented Phase 0 boundary and its verification evidence       |
| [docs/planning/phase1a-persistence-recovery.md](docs/planning/phase1a-persistence-recovery.md) | Integrated local document startup, autosave, recovery, and lease |
| [docs/planning/phase1a-selection-tool.md](docs/planning/phase1a-selection-tool.md)             | Rust-owned single selection, hit testing, move, and delete       |
| [docs/planning/phase1b-lease-takeover.md](docs/planning/phase1b-lease-takeover.md)             | Explicit same-origin writer hand-off and verified reload         |
| [docs/planning/phase1b-basic-shapes.md](docs/planning/phase1b-basic-shapes.md)                 | Schema V4 basic shapes, Scene paths, and shared host controls    |
| [docs/planning/phase1b-shape-creation.md](docs/planning/phase1b-shape-creation.md)             | Rust-owned drag/click shape creation and transient previews      |
| [docs/.state.md](docs/.state.md)                                                               | Last memory review and active risks                              |
| [docs/.todo.md](docs/.todo.md)                                                                 | Prioritized repository-memory follow-ups                         |

## Hard Constraints

- Persistent Document changes go through Rust Command/Transaction handling; browser UI must not create a second document truth source.
- `protocol`, `engine-web`, `editor-web`, and `renderer-svg` remain free of React/Vue imports. Framework code belongs in adapters such as `editor-react` or host apps.
- Renderer consumes resolved Scene data and does not reproduce semantic layout or Sketch randomness.
- Generated WASM under `packages/engine-web/generated/` is not committed; rebuild it with `pnpm exec vp run wasm:build`.
- Cargo remains the Rust truth source even when Vite+ orchestrates it. Preserve the task-specific temporary target-dir workaround in `scripts/` unless the macOS provenance issue is revalidated.
- Root `.npmrc` must stay on `https://registry.npmjs.org/` and must never contain credentials.
- `.harness_local/` is local runtime state: keep it ignored and do not modify or commit it.
- DDev is global personal tooling: do not commit repository-local DDev copies, manifests, links, or lockfiles solely to activate it.
- Phase 0 packages are private and unstable. Do not promise public SDK compatibility or choose a public npm scope early.

## Task Routing

- Before UI, UX, styling, accessibility, or visual changes, read [DESIGN.md](DESIGN.md).
- Before changing Rust/TypeScript ownership, Scene, Renderer, or persistence boundaries, read [docs/architecture/technical-architecture.md](docs/architecture/technical-architecture.md).
- Before implementing user-visible behavior, check [docs/decisions/open-questions.md](docs/decisions/open-questions.md); ask or leave a focused TODO instead of inventing undecided semantics.
- Before modifying package layout or boot/build paths, read [docs/project-structure.md](docs/project-structure.md).
- For Phase 0 work, preserve measurable Spike exit conditions in [docs/planning/phase-plan.md](docs/planning/phase-plan.md).

## Verification

Run checks proportional to the touched boundary. The full Phase 0 gate is:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm coverage
pnpm exec vp run rust:check
pnpm build
```

For visible behavior, also inspect both `/` and `/vanilla.html` against the real generated WASM.
