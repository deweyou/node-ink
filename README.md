# NodeInk

Ink freely. Connect ideas.

自由落笔，连接想法。

NodeInk 当前处于 Phase 0 技术验证阶段。第一条纵向切片已经贯通 Rust
Document/Command/Undo/Scene、真实 WASM bridge、框架无关的 Web Controller 与
SVG Renderer，并由 Vanilla TypeScript、React 和 Vue 三个独立宿主复用。

## 本地运行

环境版本以 `.node-version`、`rust-toolchain.toml` 和 lockfile 为准；npm 依赖固定从
官方源安装。

```bash
pnpm install --frozen-lockfile
pnpm exec vp run wasm:build
pnpm dev
```

WASM 构建由 Cargo/wasm-pack 生成 release 绑定，再由 lockfile 固定的 Binaryen 117
执行 `-Oz`。优化结果先写入 generated 同文件系统的临时文件，再替换最终 WASM，
避免 macOS provenance 让 wasm-pack 内置优化步骤失败；Cargo 仍是 Rust 构建真相源。

- React adapter：<http://localhost:5173/>
- Vanilla TypeScript：<http://localhost:5173/vanilla.html>
- Vue adapter：<http://localhost:5173/vue.html>

完整验证：

```bash
pnpm check
pnpm test
pnpm coverage
pnpm exec vp run rust:check
pnpm build
```

Rust 覆盖率使用精确版本 `cargo-llvm-cov 0.8.7`；首次运行前安装：

```bash
cargo install cargo-llvm-cov --version 0.8.7 --locked
```

- [产品与技术设计索引](docs/README.md)
- [产品规格](docs/product/product-spec.md)
- [技术架构](docs/architecture/technical-architecture.md)
- [Phase 0 与实施计划](docs/planning/phase-plan.md)
- [Phase 0 纵向切片结果](docs/planning/phase0-vertical-slice.md)
- [待确认决策](docs/decisions/open-questions.md)
