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
> 边界：直接拖拽/点选创建、整元素编辑与有限样式；不包含持久顶点编辑、Connector 绑定/路由或 Sketch v2

## 用户可见行为

- React、Vue 与 Vanilla 工具栏提供 Rectangle、Ellipse、Diamond、Line、Polyline、Arrow；点击只进入创建工具，不再自动生成默认位置图形。
- Rectangle/Ellipse/Diamond/Line/Arrow 有效拖拽后一次提交、选中新元素并回到 Select；3px 以下拖拽不创建。框形支持 `Shift` 等边与 `Alt` 中心展开，Line/Arrow 支持 `Shift` 45° 吸附。
- Polyline 点选顶点，双击或 `Enter` 完成，`Backspace` 退点，`Escape` 取消；至少三个固定点前不会提交。
- 新图形创建后与 Rectangle 共用选择框、移动、缩放、旋转、Group、层级、剪贴板、对齐、吸附、删除与 Undo/Redo。
- Ellipse 与 Diamond 的上下文样式面板提供 fill、stroke 与 width；Line、Polyline 与 Arrow 提供 stroke 与 width。
- 当前只编辑完整图形。创建完成后的 Line/Polyline/Arrow 顶点手柄、折线追加节点和箭头端点拖动不在本切片中。

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
- `pnpm test`：20 个 Web test files、426 tests 通过。
- `pnpm coverage`：Web statements 95.34%、branches 90.73%、functions 95.70%、lines 95.60%；Rust 128 tests，regions 92.17%、functions 91.52%、lines 93.25%，所有逐文件门禁通过。
- `pnpm exec vp run rust:check`：fmt、Clippy、Rust tests 与 doc tests 通过。
- `pnpm build`：重新生成真实 WASM，并完成 React、Vue、Vanilla 三入口生产构建。
- 真实 WASM 直接创建验收：
  - Vanilla 在 `r458 / 22 elements` 上验证工具激活零提交、Shift 等边框形、Alt 中心椭圆、Shift 45° Line/Arrow、3px 以下 no-op，以及 Polyline 的退点/显式完成；六次有效创建到 `r464 / 28 elements`。
  - 六次 Undo 恢复为 `r470 / 22 elements`，自动保存与刷新后仍为原文档，不残留验收图形。
  - React 与 Vue 在同一 verified `r470 / 22 elements` 上分别验证 Shape 按钮只切换工具而不修改 Document；三宿主控制台均无错误。

---

_Last updated: 2026-07-23 | Reason: replace default-position creation with verified direct shape creation_
