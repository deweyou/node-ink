# Phase 1B 元素级 Size

> 日期：2026-07-23
>
> 状态：已实现并通过完整 gate 与真实 WASM 三宿主验收
>
> 边界：元素级 S/M/L/XL、Schema V5 迁移、统一样式面板与 Arrow 成套尺寸；不包含 dash、roughness、pressure 或旧 renderProfile 删除

## 产品契约

- Rectangle、Ellipse、Diamond、Line、Polyline、Arrow 与 Stroke 使用元素级 `Size`，可在同一画板混用；默认值是 `M`。
- React、Vue 与 Vanilla 的上下文 Style 面板显示 `S / M / L / XL`，不再把数值像素暴露为 `Width`。
- Text 的字号仍是独立的 font-size 控件，不复用图形 Size。
- 产品不提供 `Clean | Sketch` 整板主题。旧 Render Profile 仅用于兼容已有快照与内部确定性验证。

## 持久语义与解析

| Size | Scene stroke width | Arrow head length | Arrow opening width |
| --- | ---: | ---: | ---: |
| S | 2 | 28 | 25.2 |
| M | 4 | 40 | 36 |
| L | 6 | 56 | 50.4 |
| XL | 8 | 72 | 64.8 |

- `size` 属于 Rust Document；Style 更新经过一个 Command/Transaction，支持 no-op、Undo/Redo 与本地恢复。
- Rust Scene Resolution 将 Size 解析为数值 stroke width；SVG Renderer 继续只消费 resolved Scene，不认识语义 Size。
- Arrow 的 shaft、head length 与 opening width 成套变化；开放式 head 使用较大的视觉比例，保证普通缩放下仍清晰。tip 保持在持久 endpoint。非等比 element/Group transform 不扭曲箭头，bounds 与 hit-test 复用同一 resolved world geometry。
- Element/Group resize 不改写 Size，也不把 stroke width 烘焙进 affine；Camera zoom 正常投影 Scene paint。

## Schema V5 migration

- V4 的 Rect、Ellipse、Diamond、Line、Polyline、Arrow 与 Stroke 从数值 `strokeWidth` copy-on-write 映射到 `size`：
  - `<= 2 → s`
  - `<= 4 → m`
  - `<= 6 → l`
  - 其余有效值 `→ xl`
- 迁移 revision 增加 1，源 payload 不原地修改；V0–V3 通过同一 Rust 路径直达 V5。
- Scene 仍保留数值 `strokeWidth`，因为它是 Renderer paint，而不是持久 Document 字段。

## 延后项

- solid/dashed/dotted 等线型；
- 元素级 hand-drawn/roughness 与稳定 seed；
- pressure/variable-width freehand outline；
- 删除或迁移旧全局 `renderProfile`；
- 上述样式在混合元素、导出与多 Renderer 上的一致性验收。

## 验收

- Rust：Size metrics、V4→V5 copy-on-write、默认 M、Arrow geometry/bounds/hit-test、style no-op 与 Undo/Redo。
- Protocol：仅接受 `s/m/l/xl`，持久元素不再接受 `strokeWidth`，Scene 仍接受 resolved numeric width。
- Hosts：React、Vue、Vanilla 显示相同 Size 控件并发出相同 `update_element_style` patch。
- Runtime：真实生成 WASM 后，React、Vue、Vanilla 均显示一致的 S/M/L/XL 控件；Vanilla 中 Arrow 从 M 切至 XL 时 shaft 与 head 同步增大、tip/方向不变，并已恢复原始 M 样式。后续按用户参考图将四档开放式 head 的 length/opening 成套放大 2 倍，并在 `r530 / 7 elements / 87%` 上完成 reference/before/after 视觉对比。Rectangle、Freehand 与 Arrow 的 M 默认值及完整切换矩阵由 Rust/Web 自动化测试覆盖。

---
*Last updated: 2026-07-23 | Reason: record the verified larger open Arrow head metrics*
