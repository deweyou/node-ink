# NodeInk 产品与架构决策

> 状态：Proposal v0.1
> 本文区分已经确认的方向和仍需产品负责人确认的行为，不把方案作者的默认值当作产品决定。

## 已确认决策

以下决定由产品负责人在 2026-07-21 的连续方案讨论中确认：

### D-01 第一阶段目标

- 以桌面 Web 的本地优先个人画板为首要产品闭环。
- 开发者和 AI 是后续目标；Phase 1 只验证内部结构化调用。

### D-02 Phase 1 分段

- Phase 1A 证明 Camera、矩形、文本、自由笔、选择/移动、Undo/Redo、Clean/Sketch、SVG 和单文档可靠保存。
- Phase 1B 再补齐基础形状、完整变换、分组、吸附、多文档和恢复体验。

### D-03 Rust/TypeScript 边界

- Rust 持有持久语义、Command/Transaction、平台无关工具状态、Geometry 和 Scene Resolution。
- TypeScript 持有 DOM 事件采集、IME、Accessibility、字体测量、持久化 I/O 和 Renderer。

### D-04 Sketch 边界

- Sketch 几何在 Scene Resolution 中确定。
- Renderer 只绘制已解析路径，不独立执行随机 rough 算法。

### D-05 SDK 稳定性

- Phase 1 packages 全部保持 private。
- Phase 1 只提供内部 typed bridge；公共 SDK、SemVer 和 npm scope 在 Phase 3 决定。

### D-06 持久化起点

- 使用当前快照与前一稳定快照。
- 不预先实现持久 Operation Log；由保存体积和恢复需求触发。

### D-07 物理模块边界

- 初期 Rust 只有 `nodeink-core` 与 `nodeink-wasm` 两个 crate。
- 内部 module 先建立职责边界，出现真实独立消费者后再拆 crate。

### D-08 Mermaid 导入兼容

- Mermaid 语法导入是长期兼容目标，从 Phase 2 的 Flowchart 子集开始逐步扩展。
- 第三方 parser 固定版本并位于 adapter 后；每个版本明示支持的图表类型、特性覆盖和不支持项。
- 导入结果转换为 NodeInk 原生语义对象继续编辑；不承诺编辑后无损回写 Mermaid 源码。

### D-09 框架无关的 Web 核心

- `renderer-svg` 与 `editor-web` 不依赖 React、Vue 或其他组件框架。
- 官方 React UI 只是 adapter；未来 Vue 或 Vanilla host 复用同一 Controller、Action、Scene 和 Renderer 契约。
- 框架无关允许使用浏览器标准 DOM API，不意味着首期同时维护多个 UI 实现。

### D-10 UI 体验方向

- 体验基准贴近 tldraw 的画布优先、直接操作、单一活动工具和上下文属性，以及 Excalidraw 的低门槛绘制、工具易发现与手绘亲和力。
- NodeInk 保留自己的本地优先、可靠恢复、Clean/Sketch 双风格和结构化图表能力，不复制两者的协作、分享、模板或品牌视觉。
- Phase 1 UI 只呈现已可用能力，不为未来功能放置空入口。

### D-11 Vite+ 工具链

- 使用 Vite+ 作为 Web 开发、检查、测试、打包和 monorepo task 的统一入口。
- Vite+ 通过 `vp run` 编排 Rust/WASM 任务，但 Cargo 仍是 Rust 构建、检查和测试的真相源。
- 本地 Vite+、Vite/Vitest override 与 pnpm 精确锁定；不依赖浮动的全局 `vp` 版本。
- 工程初始化时生成根 `.npmrc`，固定 `registry=https://registry.npmjs.org/`；不提交 token，也不配置私有源回退。
- Rust/WASM task 首期关闭 Vite Task 产物缓存，避免与 Cargo `target/` 重复；由 Phase 0 数据决定后续是否开启。
- Vite+ 不进入运行时协议或 package API，保留替换为标准 Vite/Vitest/Cargo 命令的低成本路径。

### D-12 仓库与内部包命名

- 产品名使用 `NodeInk`，沿用仓库名 `node-ink`。
- Rust crate 使用 `nodeink-*`；Phase 0 npm package 使用内部 workspace 名称，不承诺公共 scope。
- 公共 npm scope 与稳定包名仍在 Phase 3 设计公共 SDK 时决定。

### D-13 Pointer preview 与矩形拖拽传输

- DOM 负责 Pointer Event 采集、坐标规范化、pointer capture 与 coalesced event 读取。
- Rust 状态机持有 drag session、sequence guard、preview、cancel 和 PointerUp 单次 commit。
- S1 矩形拖拽保留单事件 JSON；batch-8 未改善约 0.1ms 的 P95，只减少约 0.8% 字节。
- 该结论只适用于矩形拖拽。S2 仍独立比较自由笔迹的 JSON point、TypedArray 与 batch size。

### D-14 自由笔传输与 batch size

- 自由笔通过 `Float64Array` 传输坐标，实时路径使用 batch-2；Rust 仍持有 preview、顺序过滤与 PointerUp 单次 commit。
- batch-2 对 120Hz 输入最多引入 8.33ms 聚合等待，release-WASM 基准的首点估算 P95 为 13.03ms。
- batch-8/32 只保留为吞吐 benchmark，不用于实时绘制，因为其聚合等待超过一帧。
- S2 的全量 SceneSnapshot 只作为过渡；S5 已验证按稳定 SceneNode ID 增量传输，revision 失配时强制完整 Snapshot 恢复。

### D-15 确定性 Sketch 所有权

- `nodeink-core` 使用显式 Render Profile、seed 和 `nodeink-scene-v1` 算法版本生成最终 Sketch path。
- Renderer 只消费已解析 Scene，不接收随机源或重新执行 rough/sketch 算法。
- Native 与 WASM canonical hash 必须逐项一致；算法升级需要新版本与 fixture 差异记录，不能原地漂移。
- Phase 0 使用 FNV-1a 做快速 Scene fixture hash；它不替代持久化对象的安全完整性摘要。

### D-16 文本测量与 IME 平台边界

- Rust Scene Resolution 发出版本化 `TextMeasureRequest`，TypeScript 返回带 `fontFingerprint` 的 metrics snapshot。
- 缓存键包含 fingerprint 与完整 run 参数；字体 epoch/status 变化会整体失效，不能复用旧 bounds。
- IME composition buffer 只存在于浏览器 textarea overlay；compositionend 后才形成一次 Rust Command。
- S4 的 Arial 仅为可复现实验输入，不代表 P-02 已确认；Phase 1A 字体包与许可仍需产品决定。

### D-17 ScenePatch 粒度与恢复

- Patch 使用稳定 SceneNode ID 映射表达 added/updated，removed 使用 ID 列表；未改变 root order 时不重复传输完整顺序。
- Renderer 仅接受 `baseSceneRevision === currentSceneRevision` 的 Patch；任何错序或重复 Patch 都返回 `snapshot_required` 且不修改 DOM。
- S5 中 1,000 节点移动 1 个的 payload 为 325B、全链路 P95 为 0.8ms；10,000 节点移动 1 个为 7.9ms，均在 16.7ms 内。
- 当前 Spike 通过对前后 Scene 做 O(N) diff 构造 Patch；Phase 1A 应从 Transaction changed IDs 直接生成，避免把 fixture diff 当成正式更新路径。

### D-18 SVG 可见节点预算与裁剪所有权

- Camera pan 只更新 SVG viewport，不增加 Document/Scene revision；ScenePatch 与 camera state 保持两个独立通道。
- 视口裁剪由 Rust Scene Resolution/Host 基于空间索引完成，Renderer 只挂载已经解析的可见 Scene，不自行解释 Document 或重做 Sketch/Text 布局。
- 本机 Chrome 150 的保守无裁剪预算：simple path 10,000 源元素；单 TextRun 与三 path Sketch 各 1,000 源元素。
- 源文档可超过上述数量，但可见集合暂限 1,000 源元素；10,000 源元素裁剪后首挂 P95 为 1.3–4.5ms。
- 可见 SVG DOM 超过 2,000 个节点时进入“降低可见 cap 或评估 Canvas”区间；这是单机 Spike 的保守门，不是自动切换 Renderer 的产品规则。

## 22. 需要产品负责人决策的问题

以下问题不阻碍继续评审文档，但会阻碍对应功能进入实现。

### P-01 仓库与包命名

- **推荐**：产品名 `NodeInk`；沿用当前仓库名 `node-ink`；Rust crate 使用 `nodeink-*`；npm scope 暂不决定。
- **替代**：把仓库重命名为原需求中的 `nodeink`。
- **影响**：文档链接、CI、package 名和未来品牌检索。
- **决策时点**：创建正式工程骨架前。
- **当前状态**：已确认；采用推荐方案，详见 D-12。

### P-02 画布字体与确定性等级

- **推荐**：Phase 1 画布内容只提供一个随应用加载的固定字体；UI 可以使用系统字体。确定性契约包含 `fontFingerprint`。
- **替代 A**：允许系统字体，只承诺相同字体度量输入下 Scene 一致。
- **替代 B**：把文本 bounds 从确定性 Scene 验收中排除。
- **影响**：跨设备换行、布局、Scene hash、包体积和字体许可。
- **决策时点**：Phase 0 文本测量 Spike 后、Phase 1A 文本实现前。
- **当前状态**：待确认。
- **Phase 0 证据**：两阶段测量与 fingerprint 失效可行；本机首次 3-run 测量 7.5ms、缓存 3/3 命中。跨设备一致性仍要求固定字体或明确降级契约。

### P-03 多标签页行为

- **推荐**：单写者；第二标签页只读，提供“关闭其他页面后重试”和显式“接管”。
- **替代**：两个标签页通过本地同步共同编辑。
- **理由**：共同编辑会提前引入本地同步、合并和冲突语义，接近被明确排除的协作复杂度。
- **影响**：文档锁、冲突 UI 和恢复测试。
- **决策时点**：Phase 1B 前。
- **当前状态**：待确认。

### P-04 删除与回收站

- **推荐**：删除进入本地回收站；不自动过期；永久删除需要二次确认。
- **替代**：删除后只提供一次 toast Undo，不建立回收站。
- **影响**：Catalog schema、磁盘空间、恢复信任和 UI 信息架构。
- **决策时点**：Phase 1B 文档库设计前。
- **当前状态**：待确认。

### P-05 恢复包是否例外允许导出

- **推荐**：仅在迁移/损坏恢复界面允许下载诊断恢复包；它不是稳定交换格式，也不提供普通导入入口。
- **替代**：严格禁止任何导出，只依赖当前和前一稳定快照。
- **理由**：纯本地产品在两个快照都失败时，否则没有把唯一数据交给用户或诊断工具的途径。
- **影响**：非目标边界、隐私提示、payload 脱敏和支持成本。
- **决策时点**：Phase 1B 恢复流程前。
- **当前状态**：待确认。

### P-06 Camera 的恢复语义

- **推荐**：每个文档恢复最后 Camera；不恢复 selection、hover、active transform 或正在编辑的 IME buffer。
- **替代**：每次打开执行 fit content。
- **影响**：用户连续性、Session schema 和“打开后找不到内容”的风险。
- **决策时点**：Phase 1A 持久化前。
- **当前状态**：待确认。

### P-07 桌面手写笔与触控范围

- **推荐**：Phase 1 支持 Pointer Events 中的 pen/pressure 数据，但只承诺桌面布局；移动触摸 UI 不进入验收。
- **替代**：Phase 1 只保证 mouse/trackpad，自由笔忽略 pressure。
- **影响**：产品“ink”体验、输入 benchmark 和设备测试矩阵。
- **决策时点**：Phase 0 自由笔 Spike 后。
- **当前状态**：待确认。

## 决策模板

后续新增关键决策时使用：

```markdown
### P-XX 标题

- 推荐：
- 推荐理由：
- 替代方案：
- 适用边界：
- 当前阶段是否实施：
- 未来切换成本：
- 决策时点：
- 状态：待确认 / 已确认 / 已否决
```

## 进入实现的门槛

P-01 已确认，Phase 0 可以实施。进入相应产品功能前必须确认其余问题；未到决策时点的问题可以保留待确认，但不能由实现者自行选择用户可见行为。
