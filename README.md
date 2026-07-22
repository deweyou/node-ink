# NodeInk

Ink freely. Connect ideas.

自由落笔，连接想法。

NodeInk 已完成 Phase 0 技术验证，当前进入 Phase 1A 最小产品闭环。第一条纵向切片已经贯通 Rust
Document/Command/Undo/Scene、真实 WASM bridge、框架无关的 Web Controller 与
SVG Renderer，并由 Vanilla TypeScript、React 和 Vue 三个独立宿主复用。三个入口现在还
共享单文档 IndexedDB 启动、750ms 自动保存、verified snapshot 恢复与多标签页单写者规则。
Camera/Viewport 也已进入同一框架无关 Controller：支持 wheel/触控板平移、Space 或中键拖拽、
光标锚点缩放、10%–800% 绝对边界，以及 Rust 根据完整内容范围计算的回正/适应内容；UI 的
`100%` 表示全部元素带 64px 留白适应当前 viewport。每个文档独立恢复最后视图，且不污染
Document revision/Undo。单击选择、空白清空、拖动、`Delete`/`Backspace` 删除和选择框也已由
Rust Editor State 与 Transaction 驱动，并在 React、Vue、Vanilla 三端共享；选择本身不会持久化。
Select/Draw 现在也是 Rust-owned 非持久工具状态：`V`/`P` 可切换，Draw 使用 S2 验证过的
Float64Array batch-2 输入，支持连续笔迹、单击圆点、取消恢复与整笔 Undo/Redo。

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
- [Phase 1A 持久化与恢复切片](docs/planning/phase1a-persistence-recovery.md)
- [Phase 1A Camera 与无限画布切片](docs/planning/phase1a-camera-viewport.md)
- [Phase 1A 单选与元素删除切片](docs/planning/phase1a-selection-tool.md)
- [Phase 1A 自由笔工具切片](docs/planning/phase1a-freehand-tool.md)
- [待确认决策](docs/decisions/open-questions.md)
