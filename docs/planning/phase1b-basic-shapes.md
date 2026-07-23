# Phase 1B 基础图形

```mermaid
flowchart LR
    Host["React / Vue / Vanilla"] --> Controller["editor-web action"]
    Controller --> Command["typed Command V1"]
    Command --> Rust["Rust Transaction"]
    Rust --> Document["Schema V4 semantic element"]
    Document --> Resolver["Rust geometry + Scene resolution"]
    Resolver --> Path["ScenePathV1"]
    Path --> Renderer["framework-neutral SVG renderer"]
```

> 日期：2026-07-23
> 状态：已实现并通过完整 gate 与真实 WASM 三宿主验收
> 边界：默认位置快捷创建、整元素编辑与有限样式；不包含拖拽创建、顶点编辑、Connector 绑定/路由或 Sketch v2

## 用户可见行为

- React、Vue 与 Vanilla 工具栏均提供 Ellipse、Diamond、Line、Polyline、Arrow；点击后立即创建默认几何并回到 Select。
- 新图形创建后与 Rectangle 共用选择框、移动、缩放、旋转、Group、层级、剪贴板、对齐、吸附、删除与 Undo/Redo。
- Ellipse 与 Diamond 的上下文样式面板提供 fill、stroke 与 width；Line、Polyline 与 Arrow 提供 stroke 与 width。
- 当前只编辑完整图形。Line/Polyline/Arrow 的顶点手柄、折线追加节点和箭头端点拖动不在本切片中。

## 持久语义

| kind | local geometry | style | minimum points |
| --- | --- | --- | --- |
| `ellipse` | `x/y/width/height` | fill/stroke/strokeWidth | — |
| `diamond` | `x/y/width/height` | fill/stroke/strokeWidth | — |
| `line` | `points` | stroke/strokeWidth | exactly 2 |
| `polyline` | `points` | stroke/strokeWidth | 3 |
| `arrow` | `points` + resolved arrowhead | stroke/strokeWidth | 2 |

- 所有元素持有与其他 Phase 1B 元素相同的 affine transform；resize 不改写 strokeWidth。
- 连续重复点、非 finite 坐标、非法尺寸、非法颜色和非法线宽在 Rust 与 TS 协议边界被拒绝。
- Arrow 是普通自由几何；未来 Connector 必须拥有独立的 source/target binding、port 与 route 语义。

## Scene 与 Renderer

- Rust 为 Ellipse、Diamond、Line、Polyline、Arrow 生成确定性的 SVG-compatible path data，并以稳定 `sourceElementId` 输出 `ScenePathV1`。
- hit-test、visual bounds 与箭头头部范围使用同一 Rust 几何模块；选择不依赖 SVG DOM target。
- Renderer 继续只负责 Scene 投影、DOM patch 与 transform-independent document stroke，不认识新的 Document kind。
- 当前 Clean 产品面是唯一视觉验收。旧 Sketch v1 profile 仍可读取，但不会为基础图形生成另一套随机几何。

## Schema V4 migration

- V3 文档 copy-on-write 升级为 V4，revision 增加 1，既有元素与 transform 保持不变。
- V0/V1/V2 继续通过 Rust 迁移到当前 V4；未知 schema 与损坏 payload 返回结构化诊断。
- 源 payload 不被原地修改，迁移后的 canonical payload 必须先持久化为新 revision，才能授予 writer。

## 验收

- `pnpm check`：83 files 格式、lint、类型与 framework boundary 通过。
- `pnpm test`：20 个 Web test files、417 tests 通过。
- `pnpm coverage`：Web statements 95.65%、branches 90.98%、functions 95.87%、lines 95.92%；Rust 117 tests，regions 92.02%、functions 91.00%、lines 93.07%，所有逐文件门禁通过。
- `pnpm exec vp run rust:check`：fmt、Clippy、Rust tests 与 doc tests 通过。
- `pnpm build`：重新生成真实 WASM，并完成 React、Vue、Vanilla 三入口生产构建。
- 真实 WASM 按顺序验收：
  - Vanilla 从 `r409 / 3 elements` 各创建一种基础图形到 `r414 / 8 elements`；Arrow 修改为 blue/4px 并移动到 `(32,16)`，Undo `r418` 恢复 identity，Redo `r419` 恢复 transform，自动保存后刷新仍保持五种 path、样式与位置。
  - React 从 verified `r419 / 8 elements` 各创建一种基础图形到 `r424 / 13 elements`，五个新 Scene path 与 Rust canonical path 一致并自动保存。
  - Vue 从 verified `r424 / 13 elements` 各创建一种基础图形到 `r429 / 18 elements`，五个新 Scene path 一致并自动保存；最终 Vanilla 从 `r429` 恢复 18 个 path。

---

_Last updated: 2026-07-23 | Reason: record full gates and real-WASM parity for the basic-shape slice_
