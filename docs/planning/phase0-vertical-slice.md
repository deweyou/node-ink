# Phase 0 首条纵向切片

```mermaid
flowchart LR
    Core["Rust core"] --> Wasm["WASM bridge"]
    Wasm --> Controller["Web Controller"]
    Controller --> Renderer["SVG Renderer"]
    Renderer --> Vanilla["Vanilla host"]
    Controller --> React["React adapter"]
    Renderer --> React
```

> 日期：2026-07-21
> 状态：已实现并验证
> 覆盖 Spike：S0、S1、S2、S10 的最小事务边界、S11、S12

## 结论

首条纵向切片证明以下依赖方向可以工作：

```text
Rust nodeink-core
  → nodeink-wasm
  → engine-web
  → editor-web
  → renderer-svg
  → Vanilla host / React adapter
```

- Document、Command、Undo/Redo、revision guard 和确定性 Scene Resolution 由 Rust 持有。
- 浏览器通过真实 `wasm-bindgen` 产物调用引擎；UI 不维护第二份文档真相源。
- `editor-web` 与 `renderer-svg` 只依赖 TypeScript 和标准 DOM，不导入 React/Vue。
- React adapter 和 Vanilla TypeScript host 使用同一 Controller、Action、EnginePort 与 Renderer。
- Web 日常入口统一为 Vite+；Rust 检查和 WASM 构建由 `vp run` 编排，底层仍直接执行 Cargo/wasm-pack。
- DOM 只规范化 Pointer Event；Rust 状态机持有 drag session、preview、顺序过滤与一次性 commit。

## 已实现范围

- 创建一个矩形。
- 移动已有矩形。
- Undo/Redo，并保持 revision 单调递增。
- expected revision 冲突拒绝且不修改文档。
- 原子命令校验失败时不产生部分写入。
- 同一 Document 产生稳定排序、可重复序列化的 Scene。
- SVG Renderer 根据 SceneSnapshot 协调 DOM。
- React 与 Vanilla 两个桌面 Web 演示入口。
- 矩形 Pointer drag：Move 只更新 Scene preview，PointerUp 才生成一个可撤销的 Document command。
- 自由笔 Stroke：Rust 累积点并解析 SVG path，支持 JSON point 与 Float64Array batch，PointerUp 只提交一个 Undo entry。

这不是日常可用的编辑器，也不包含持久化、Camera、选择框、文本/IME、自由笔、
Mermaid 导入或公共 SDK。

## 验证证据

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | lockfile 可重复安装；workspace 已是最新状态 |
| `pnpm config get registry` | `https://registry.npmjs.org/` |
| `pnpm exec vp check` | 21 个源码入口无格式、lint 或 type error |
| `pnpm exec vp test` | 7 个 test file、38 个 Web test 通过 |
| `pnpm coverage` | Web statements 98.86%、branches 92.50%、functions 97.05%、lines 98.83%；Rust lines 99.61% |
| `pnpm exec vp run rust:check` | fmt、Clippy、13 个 Rust test、doc-test 通过 |
| `pnpm exec vp run wasm:build` | release WASM 重新生成成功 |
| `pnpm exec vp build apps/playground` | React/Vanilla 双入口和 WASM 生产包构建成功 |
| framework dependency scan | `protocol`、`engine-web`、`editor-web`、`renderer-svg` 无 React/Vue import |
| S1 release WASM browser benchmark | 单事件和 batch-8 均 P95 约 0.1ms、0 ignored、1 commit、0 long task |
| S2 release WASM browser benchmark | JSON point 与 TypedArray batch-2/8/32 均 0 ignored、1 commit、0 long task；batch-2 首点估算 P95 13.03ms |
| `git diff --check` | 通过 |

真实浏览器中分别验证了 React 和 Vanilla 两个入口：

1. 初始 revision 为 0。
2. 创建矩形后 revision 为 1，坐标为 `(80, 72)`。
3. 移动后 revision 为 2，坐标为 `(112, 88)`。
4. Undo 后 revision 为 3，坐标恢复为 `(80, 72)`。

验证过程中发现 Rust serde 默认把 `elementIds` 解析为 `element_ids`，导致浏览器 Move
失败。Command wire schema 已统一为 camelCase，并新增 Rust 回归测试；双宿主随后重新通过。

## S1 Pointer Event 决策

浏览器基准原始数据见
[`phase0-s1-pointer.json`](../benchmarks/phase0-s1-pointer.json)，测试源代码锚定提交
`bdef2e3`。每种传输处理 3,600 个 PointerMove 样本，等价于 30 秒 120Hz 输入；
采样覆盖 normalized event、Controller queue、release WASM、Rust preview/commit 和 SVG
Snapshot apply。它不包含操作系统事件调度与 DOM 规范化耗时，不能替代真实设备 pen 测试。

- Rust 继续持有工具 preview 和 drag 状态；Move 不修改 Document，Up 只提交一个 Undo entry。
- 矩形拖拽暂用单事件 JSON：batch-8 没有降低 P95，只减少约 0.8% 传输字节，复杂度收益不足。
- 主线程满足 S1 矩形拖拽预算；是否引入 TypedArray batch 或 Worker 留给数据量更高的 S2 自由笔迹。

## S2 自由笔迹决策

浏览器基准原始数据见
[`phase0-s2-stroke.json`](../benchmarks/phase0-s2-stroke.json)，测试源代码锚定提交
`d377f1d`。每组处理 3,600 个 move point；service latency 覆盖 Controller、release
WASM、Rust preview/commit、全量 SceneSnapshot 和 SVG path 更新。首点估算延迟额外计入 batch
填充等待，因此不会把更大 batch 的吞吐优势误当成交互延迟优势。

- Stroke 采用 `Float64Array` batch-2：复制字节从 JSON point 的 442,662 降至 57,632，约减少 87%。
- batch-2 在 120Hz 下最多等待 8.33ms，加上 4.70ms service P95 后首点估算 P95 为 13.03ms，仍在 16.7ms 内。
- batch-8/32 的首点估算 P95 为 62.93/262.43ms，因此不用于实时笔迹；它们只证明大 batch 的离线吞吐上限。
- S2 主线程路径可继续；当前 P95 SceneSnapshot 已约 128KB，S5 必须验证增量 ScenePatch，不能把全量快照当长期方案。
- 该合成基准不包含真实 pen pressure、浏览器 coalescing 与 OS 调度，P-07 设备范围仍待后续真实硬件确认。

## 工具链说明

- Node：`24.15.0`
- pnpm：`11.1.3`
- Vite+：`0.2.5`
- Rust：`1.96.0`
- wasm-pack：`0.15.0`
- wasm-bindgen CLI/crate：`0.2.126`

macOS 在仓库内 Cargo `target/` 上触发过扩展属性相关的 `Operation not permitted`。
脚本因此默认把 Cargo target 放在系统临时目录；可通过
`NODEINK_CARGO_TARGET_DIR` 显式覆盖。此调整不改变 Cargo 作为 Rust 构建真相源的边界。

## 下一步

按风险顺序继续 Phase 0，而不是直接铺开完整 UI：

1. S3 确定性 Sketch，跨 Rust native/WASM 比较 canonical hash。
2. S4 文本测量与 IME，并在实现文本前确认 P-02 字体决策。
3. S5/S6 ScenePatch、SVG 更新与裁剪预算。
4. S7/S8 持久化、原子恢复与 migration fixture。
5. S9 多标签页写入权与只读降级。

---
*Last updated: 2026-07-21 | Reason: record S2 freehand transport evidence and TypedArray batch-2 decision*
