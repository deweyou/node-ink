# NodeInk

Ink freely. Connect ideas.

自由落笔，连接想法。

NodeInk 已完成 Phase 0 技术验证与 Phase 1A 最小产品闭环，当前进入 Phase 1B 基础编辑器完整性。第一条纵向切片已经贯通 Rust
Document/Command/Undo/Scene、真实 WASM bridge、框架无关的 Web Controller 与
SVG Renderer，并由 Vanilla TypeScript、React 和 Vue 三个独立宿主复用。三个入口现在还
共享单文档 IndexedDB 启动、750ms 自动保存、verified snapshot 恢复与多标签页单写者规则。
Camera/Viewport 也已进入同一框架无关 Controller：支持 wheel/触控板平移、Space 或中键拖拽、
光标锚点缩放、10%–800% 绝对边界，以及 Rust 根据完整内容范围计算的回正/适应内容；UI 的
`100%` 表示全部元素带 64px 留白适应当前 viewport。每个文档独立恢复最后视图，且不污染
Document revision/Undo。单击选择、空白清空、拖动、`Delete`/`Backspace` 删除和选择框也已由
Rust Editor State 与 Transaction 驱动，并在 React、Vue、Vanilla 三端共享；选择本身不会持久化。
Select/Draw 现在也是 Rust-owned 非持久工具状态：`V`/`P` 可切换，Draw 使用 S2 验证过的
Float64Array batch-2 输入，支持连续平滑笔迹、单击圆点、按住 `Shift` 绘制起终点直线、取消恢复与整笔
Undo/Redo。三点以上的 Clean 笔迹由 Rust 从持久原始采样确定性解析为 midpoint quadratic 曲线，预览、
提交、选择范围与命中检测共享同一几何。画布手势一旦在 PointerDown 被文档接管，快速移动、修饰键变化或 Camera 门控变化都不会
再丢掉最终 PointerUp；浏览器 capture loss、pointer cancel 或窗口失焦会提交已显示的采样，只有
`Escape` 或切换工具这类显式取消才丢弃预览。
Text 也进入同一条产品路径：`T` 单击创建，Select 双击语义文本可编辑；固定加载
`Noto Sans SC Variable`，支持多行与中文 IME；输入层不显示输入框外观，只保留文字与原生光标，
点击画布空白、blur 或 `Cmd/Ctrl+Enter` 只提交一个 Rust Transaction。浏览器字体测量通过两阶段
协议回填 Scene，不建立第二份 Document 状态。
矩形、自由笔和文本的有限样式预设也已接入同一条 Rust Command/Transaction 路径：选择时显示
共享的上下文 Style 面板；相同预设是 no-op，实际变化可 Undo/Redo 并随本地文档恢复，三种宿主
不各自保存样式副本。当前产品界面与新文档统一使用 Clean，不再暴露实验性的 Clean/Sketch
切换；Rust 仍保留持久 Render Profile 与确定性 Sketch resolver 作为旧快照、测试和后续重做
风格系统的内部兼容边界。
Phase 1B 的第一条编辑器基础切片进一步加入框选/多选、八向缩放与旋转、嵌套 Group、同层级
顺序、内部剪贴板、六向对齐，以及带实际 Guide 的移动吸附。Document 已迁移到 Schema V3：
每个元素持有 Affine transform，层级与持久变换仍只由 Rust Command/Transaction 修改；选择框、
手柄、框选范围和吸附 Guide 都是非持久 Editor State。React、Vue、Vanilla 继续复用同一
Controller、协议和 SVG Renderer。变换时 `Shift` 会锁定移动主轴、保持缩放比例，并把最终旋转
吸附到绝对 45° 倍数。

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
- [Phase 1A 产品文本切片](docs/planning/phase1a-product-text.md)
- [Phase 1A 样式与 Render Profile](docs/planning/phase1a-style-profile.md)
- [Phase 1B 编辑器基础](docs/planning/phase1b-editor-foundation.md)
- [待确认决策](docs/decisions/open-questions.md)
