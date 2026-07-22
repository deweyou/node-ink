# NodeInk 产品与技术设计

> 状态：Proposal v0.1 + Phase 0 implementation
> 日期：2026-07-21
> 阶段：Phase 0 技术验证；首条纵向切片已实现，React/Vue/Vanilla 三个独立宿主复用同一核心

本目录是 NodeInk 第一阶段的设计基线。它将原始需求中的 22 项交付物按产品、架构、计划和决策四个关注点拆开，但保持同一套术语、边界和依赖方向。

## 已确认方向

- 第一目标是桌面 Web 上的本地优先个人画板；开发者 SDK 和 AI Agent 是后续能力。
- 原 Phase 1 拆为 Phase 1A“端到端最小闭环”和 Phase 1B“基础编辑器完整性”。
- Rust 持有持久语义、命令事务、平台无关工具状态、几何和 Scene Resolution；TypeScript 持有浏览器事件、IME、可访问性、文本测量、持久化 I/O 和渲染。
- Sketch 几何在 Scene Resolution 阶段确定，Renderer 不重复生成手绘路径。
- Phase 1 只提供内部类型化 Command/Scene Bridge，不承诺公共 SDK 的 SemVer 稳定性。
- 持久化从“当前快照 + 上一个稳定快照”开始，不预先实现完整操作日志。
- 初期 Rust crate 保持 `nodeink-core` 与 `nodeink-wasm` 两个粗粒度边界。
- Mermaid 语法导入是长期兼容目标；Mermaid 作为输入适配器，导入后转换为 NodeInk 原生语义对象。
- `renderer-svg` 与 `editor-web` 不依赖 React/Vue；React 与 Vue 只存在于可替换的 UI 适配层。
- UI 体验参考 tldraw 的低干扰直接编辑，以及 Excalidraw 的轻松手绘表达，但不复制其品牌视觉或超出本期的产品复杂度。
- 项目采用 Vite+ 作为 Web 工具链和 monorepo 任务统一入口；Cargo 仍是 Rust crate 的构建与测试真相源。

## 交付物索引

| # | 交付物 | 位置 |
| --- | --- | --- |
| 1 | 一页式产品定义 | [product-spec.md](product/product-spec.md#1-一页式产品定义) |
| 2 | 目标用户与核心场景 | [product-spec.md](product/product-spec.md#2-目标用户与核心场景) |
| 3 | 产品信息架构 | [product-spec.md](product/product-spec.md#3-产品信息架构) |
| 4 | MVP 范围 | [product-spec.md](product/product-spec.md#4-mvp-范围) |
| 5 | 非目标 | [product-spec.md](product/product-spec.md#5-非目标) |
| 6 | 总体技术架构图 | [technical-architecture.md](architecture/technical-architecture.md#6-总体技术架构) |
| 7 | Rust 与 TypeScript 职责边界 | [technical-architecture.md](architecture/technical-architecture.md#7-rust-与-typescript-职责边界) |
| 8 | Semantic Document Model 草案 | [technical-architecture.md](architecture/technical-architecture.md#8-semantic-document-model) |
| 9 | Command 与 Transaction 协议草案 | [technical-architecture.md](architecture/technical-architecture.md#9-command-与-transaction) |
| 10 | Editor State Machine 草案 | [technical-architecture.md](architecture/technical-architecture.md#10-editor-state-machine) |
| 11 | Geometry 与 Layout 边界 | [technical-architecture.md](architecture/technical-architecture.md#11-geometry-与-layout) |
| 12 | Resolved Scene Model 草案 | [technical-architecture.md](architecture/technical-architecture.md#12-resolved-scene-model) |
| 13 | Renderer 接口草案 | [technical-architecture.md](architecture/technical-architecture.md#13-renderer-接口) |
| 14 | WASM 通信方案 | [technical-architecture.md](architecture/technical-architecture.md#14-wasm-通信方案) |
| 15 | IndexedDB 数据结构和恢复方案 | [technical-architecture.md](architecture/technical-architecture.md#15-indexeddb-数据结构和恢复方案) |
| 16 | AI Diagram Operation 协议草案 | [technical-architecture.md](architecture/technical-architecture.md#16-ai-diagram-operation-协议) |
| 17 | Monorepo 目录和依赖方向 | [technical-architecture.md](architecture/technical-architecture.md#17-monorepo-目录和依赖方向) |
| 18 | Phase 0 技术 Spike 清单 | [phase-plan.md](planning/phase-plan.md#18-phase-0-技术-spike) |
| 19 | 分阶段路线图 | [phase-plan.md](planning/phase-plan.md#19-分阶段路线图) |
| 20 | 技术风险及验证方法 | [phase-plan.md](planning/phase-plan.md#20-技术风险及验证方法) |
| 21 | 首期验收标准 | [phase-plan.md](planning/phase-plan.md#21-首期验收标准) |
| 22 | 需要产品负责人决策的问题 | [open-questions.md](decisions/open-questions.md#22-需要产品负责人决策的问题) |

## 工程状态

- [Phase 0 纵向切片结果](planning/phase0-vertical-slice.md)：记录已经实现的边界、验证命令、浏览器证据与尚未覆盖的 Spike。
- [S1 Pointer benchmark](benchmarks/phase0-s1-pointer.json)：记录 release WASM 环境、P50/P95/P99、字节、错序、commit 与 long task 基线。
- [S2 Stroke benchmark](benchmarks/phase0-s2-stroke.json)：比较 JSON point 与 Float64Array batch-2/8/32 的延迟、吞吐、复制字节、Scene payload 与 DOM 更新。
- [S3 Sketch determinism](benchmarks/phase0-s3-sketch.json)：记录 1,000 次稳定性、seed/profile 差异及 Native/WASM canonical hash 对照。
- [S4 Text and IME](benchmarks/phase0-s4-text-ime.json)：记录两阶段测量、cache hit、fingerprint 失效、hash 稳定性与中文 composition 边界。
- [根 README](../README.md)：提供本地运行入口与完整检查命令。
- 本阶段产物仍是可推翻的技术验证，不代表 Phase 1A 产品闭环已经完成。

## 文档约束

- 这里出现的接口均为设计草案，不是已发布 API。
- “确定性”默认指相同文档、命令、随机种子、Render Profile、字体度量输入和引擎版本得到一致结果；字体环境不是隐式常量。
- Phase 1 未实现的未来能力只保留边界，不创建空 package、空类型或无调用方的抽象。
- 框架无关指引擎、Controller、Renderer 和持久化包不导入 React/Vue；官方 React UI 可以通过公开 Controller contract 组合这些能力。
- Mermaid 兼容按 parser 版本、diagram type 和 feature coverage 声明；不支持的语法返回精确诊断，不静默降级。
- Vite+ 不进入运行时 package API；版本精确锁定，Rust 任务保留可直接执行的 Cargo 命令与独立回滚路径。
- 工程初始化时在仓库根生成 `.npmrc`，固定 `registry=https://registry.npmjs.org/`；文件不保存认证 token，也不配置私有源回退。
- 所有未确认的用户可见行为集中在 [open-questions.md](decisions/open-questions.md)，不会在实现时由工程侧自行补全。

## 参考资料

这些资料用于校验模式与风险，不作为 NodeInk 内部模型的直接依赖：

- [tldraw Store](https://tldraw.dev/sdk-features/store)：document、session、presence 等不同生命周期记录的分离方式。
- [tldraw Persistence](https://tldraw.dev/docs/persistence)：快照、IndexedDB 和迁移的产品化实践。
- [tldraw UI components](https://tldraw.dev/sdk-features/ui-components)：工具、上下文样式面板、菜单和动作的 UI 分层参考。
- [Excalidraw](https://github.com/excalidraw/excalidraw)：无限画布、手绘表达和轻量工具体验参考。
- [Mermaid Flowchart Syntax](https://mermaid.js.org/syntax/flowchart)：Mermaid 输入语义和布局提示的复杂度边界。
- [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/)：事务、durability hint 与浏览器存储基础契约。
- [Web Locks API](https://www.w3.org/TR/web-locks/)：同源标签页之间的单写者协调；该标准仍处于 Working Draft，必须经兼容性验证并封装在适配器后。
- [`wasm-bindgen` boxed slices](https://wasm-bindgen.github.io/wasm-bindgen/reference/types/boxed-slices.html)：数值切片与 TypedArray 的边界能力。
- [Vite+ Monorepo](https://viteplus.dev/guide/monorepo)：根配置、package 局部配置与 workspace task 的组织方式。
- [Vite+ Run](https://viteplus.dev/guide/run)：自定义任务、依赖顺序和缓存边界。

---
*Last updated: 2026-07-22 | Reason: record React, Vue, and Vanilla host parity*
