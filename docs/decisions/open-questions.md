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
- 官方 React/Vue UI 只是 adapter；React、Vue 与 Vanilla host 复用同一 Controller、Action、Scene 和 Renderer 契约。
- 框架无关允许使用浏览器标准 DOM API；当前多个 adapter 只验证宿主契约，不承诺首期同时维护多套完整产品 UI。

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

### D-19 IndexedDB 原子保存与恢复

- 一次 readwrite transaction 原子写入 candidate 并推进 catalog head；expected previous revision 不匹配时整笔 abort，不允许 last-write-wins。
- candidate 经过 IndexedDB read-back、SHA-256 和 schema validator 后才在第二个 transaction 标记 stable；恢复只打开 verified stable 或 previous stable。
- 目标浏览器接受 `strict` durability 时请求 strict；durability 始终只是 capability/hint，不能替代 read-back 校验。
- 本机 Chrome 150 中 1MB/10MB 保存 P95 为 12.3/34.4ms，validation 主线程 P95 为 0.6/4.6ms，均未观测到 long task。
- candidate 前、candidate transaction 中、candidate 后、read-back 后中断均恢复前一稳定 revision；只有 stable transaction 完成后才恢复新 revision。

### D-20 Copy-on-write migration 与损坏诊断

- Schema validation、V0→V1 migration 与 canonical payload 生成由 `nodeink-core` 持有；TypeScript 不复制 Document 迁移规则。
- `persistence-web` 先验 SHA-256，再按 head→stable→previous stable 顺序调用 Migration Port；迁移成功只返回新 payload，源 Snapshot bytes 永不原地修改。
- hash mismatch、unknown schema、field corruption、migration failure 都产生 stage/code/source/target/recovery 结构化诊断；失败候选不会被静默跳过或覆盖。
- 可用 fallback 时确定性打开下一 verified snapshot；全部失败时进入 `readonly_diagnostic`，不构造半迁移文档。
- Phase 1A 把成功迁移结果作为新 revision 走 S7 原子保存；S8 Spike 本身不在 migration 函数中写 IndexedDB。

### D-21 多标签页单写者与只读降级

- Web Locks 使用 `nodeink:document:<documentId>` exclusive/ifAvailable lease；同时只允许一个 writer，竞争者立即得到 `readonly/held_elsewhere`。
- writer 显式 release 或标签页关闭后，竞争者必须重新加载最新 stable revision 再获取 lease；旧内存 Document 不能直接续写。
- 没有 Web Locks 或 request 失败时返回 `readonly/unsupported`，不以 BroadcastChannel、localStorage 或定时 lease 猜测单写者。
- IndexedDB expected revision 是最终事务护栏；S9 并发写 fixture 恒为一个成功、一个 `revision_conflict`，不发生 silent last-write-wins。
- 本机 Chrome 150 中初次获取、释放后接管、关闭标签页后接管分别为 0.4/0.3/0.2ms；这些时延不替代跨设备 capability probe。

### D-22 Diagram Operation V1 原子事务

- Rust Operation Layer 把版本化 create/move/update/delete rectangle Operation 映射到与 UI 共用的 `CommandV1` 和 Transaction；Web Host 不维护第二份语义实现。
- `atomic: true` 是 V1 唯一模式，单批最多 256 个 Operation；任何子操作失败或 revision conflict 都不改变 Document、revision 或 history。
- `dry_run` 在候选 Document 上完成同一 validation 与 Scene Resolution，只返回 `planned` 结果和 ScenePatch；apply 只增加一次 revision 和一个 Undo entry。
- 同一 batch 从相同 Document/revision 重放时结果、ScenePatch 与最终 Document 逐字节一致；在已推进的 revision 上重放则明确冲突。
- Renderer 只消费来源无关的 ScenePatch，不知道调用来自 UI、SDK、CLI、MCP 或未来 Mermaid adapter。

### D-23 框架无关宿主与销毁契约

- React、Vue 与 Vanilla host 都只消费 `EditorWebControllerV1` 的 mount/getSnapshot/subscribe/dispatch/dispose；EnginePort 和 SVG Renderer 不因宿主框架分叉。
- `dispose` 幂等地移除 Pointer listener、清空 subscription、卸载 Renderer DOM 并释放一次 WASM Engine handle；释放后的 handle 明确拒绝后续调用。
- 本机真实 WASM 连续 25 轮 mount/create/move/undo/dispose：100 次 Pointer listener add/remove 配对、25 个 handle 全部释放、0 active listener、0 residual SVG。
- React、Vue 与 Vanilla 可见入口均复用真实 WASM；Vue 入口已从 r0 完成 create→r1、move→r2、undo→r3、redo→r4，浏览器无 warn/error。
- `pnpm check` 固化 React/Vue import boundary；框架适配器只能依赖框架无关包，不能把框架依赖下沉。

### D-24 Vite+、Cargo 与可重复 WASM 优化

- Vite+ 是日常 check/test/build/task 入口，Rust task 保持 `cache: false`；Cargo 自有 target 目录与增量缓存仍是 Rust 真相源。
- wasm-pack 0.15 只执行 release Cargo 与 wasm-bindgen（`--no-opt`）；项目从 npm 官方源精确锁定 Binaryen 117，随后以 `-Oz` 优化到同文件系统临时文件再替换最终 WASM。
- 该两阶段流程连续构建、generated 缺失重建均得到 480,459 bytes 和同一 SHA-256；Vite task 不缓存时第二次 Cargo release 仍从 2.67s 降到 0.03s。
- 故意把 rustc 指向失败程序时 `vp run wasm:build` 以 exit 1 暴露 `cargo metadata` 错误，Web 成功不能掩盖 Rust 失败。
- 根 `.npmrc` 只含 `registry=https://registry.npmjs.org/`，不得加入 token、私有源或静默 fallback。

### D-25 Phase 1A 单文档保存与恢复体验

- playground 使用一个固定本地文档，Transaction commit 后以 750ms debounce 自动保存；UI 明确显示未保存、保存中、已保存、保存失败和只读。
- 保存失败保留内存 dirty revision，并只通过显式重试再次写入；页面隐藏时尝试 flush，但不依赖 unload 完成异步事务。
- verified head 可写；stable/previous stable fallback 与候选穷尽诊断都只读，原始损坏 payload 不覆盖、不重置。
- 第二标签页只读并提示关闭其他页面后刷新；Phase 1A 不实现显式接管或共同编辑。
- React、Vue 与 Vanilla 只消费 `editor-web` 的同一保存/恢复 presentation，不分别定义状态语义。

### D-26 Camera 回正与相对 100%

- “回正并适应全部内容”由 Rust 根据 Semantic Document bounds、viewport 和 `64px` 屏幕 padding 计算；矩形使用语义几何，自由笔 bounds 包含 stroke width，Renderer 不读取 SVG/DOM bounds 反推内容。
- UI 的 `100%` 定义为当前 `camera.zoom / fitZoom === 1`，不等于固定的底层 `zoom === 1`；工具栏按 `1.5` 倍及其精确倒数缩放。
- Document bounds 或 viewport 改变只重算 fitZoom 与百分比，不自动移动 Camera；用户点击百分比按钮时才应用 fit Camera 并居中，避免编辑过程中画面跳动。
- 空文档 fit 回到 `{ x: 0, y: 0, zoom: 1 }`；绝对 Camera 仍 clamp 到 10%–800%，超大范围到 10% 仍放不下时不越过安全边界。
- 首次打开且没有已保存 Camera 时使用 fit content；已有 Camera 仍按 P-06 恢复。fitZoom 是派生状态，不进入 Document 或 Camera session store。

### D-27 Phase 1A 单选与元素删除

- 单击按 Document root order 选择最上层语义元素；单击空白或按 `Escape` 清空选择。Phase 1A 保持单选，不提前加入框选、多选或完整变换手柄。
- Selection、hover 和拖动预览属于 Rust Editor State，但不进入 Document、序列化快照、Camera session store 或 Undo history。
- 浏览器只传归一化 world coordinates；Rust Geometry 负责矩形和自由笔命中，Renderer 只绘制 Rust 返回的选择 bounds，不从 SVG/DOM 反推语义目标。
- 拖动在 PointerUp 时提交一次 `move_elements` Transaction；`Delete`、`Backspace` 和显式工具栏按钮都通过一次 `delete_elements` Transaction 删除当前元素，因此可 Undo/Redo。
- 此处删除的是当前 Document 内的元素，不决定 P-04 的文档级回收站语义。

### D-28 Phase 1A 自由笔工具状态

- Rust 持有非持久 Tool State，首期工具为 `select | freehand`；状态随 Engine Update 返回，但不进入 Document、序列化、Camera 或 Undo/Redo。
- React、Vue 与 Vanilla 只通过同一个 Controller 切换工具；`V` 选择、`P` 自由笔，活动按钮使用 `aria-pressed`，创建矩形显式回到 Select。
- 自由笔复用 S2 的 Float64Array batch-2 传输，PointerUp 形成一个 `create_stroke` Transaction；单击规范化为稳定圆点，取消与失焦只清除 preview。
- Phase 1 使用 mouse/trackpad/pen 的位置输入和固定 3px 笔宽，不承诺 pressure、可变宽轮廓或移动触摸编辑。这些能力需要独立几何、命中和设备验收。

### D-29 Phase 1A 产品文本与固定字体

- 画布文本固定使用随应用加载的 `Noto Sans SC Variable`（`@fontsource-variable/noto-sans-sc@5.3.0`，OFL-1.1）；UI 字体仍使用系统栈。Host 在创建 Engine 前等待 400/500 weight 可用，失败时明确阻止进入可写编辑器。
- `TextElementV1` 持久化内容、位置、24px/400 默认样式、可选 `maxWidth` 与非空 `fontFingerprint`；创建、更新、清空删除、移动及 Undo/Redo 全部经过 Rust Command/Transaction。
- Rust 发出 `textMeasureRequest`，浏览器用固定字体测量并通过 `provideTextMetrics` 回填；metrics cache 与 Scene revision 属于瞬态解析状态，不增加 Document revision 或 Undo history。换行索引统一按 Unicode code point，而不是 JavaScript UTF-16 code unit。
- IME buffer 只存在于 HTML textarea overlay。Enter 插入换行，`Cmd/Ctrl+Enter` 或 blur 提交一次，`Escape` 取消；空白新文本不产生 Command，清空已有文本走 `delete_elements`。
- Text 工具快捷键为 `T`；Text 单击开始创建，Select 对已有文本的双击通过 Rust 语义命中进入编辑，不能依赖 SVG DOM target。

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
- **当前状态**：已确认采用推荐方案。Phase 1A 固定使用随应用加载的 `Noto Sans SC Variable`，持久化 `fontFingerprint` 并等待字体就绪后创建 Engine，详见 D-29。
- **Phase 0 证据**：两阶段测量与 fingerprint 失效可行；本机首次 3-run 测量 7.5ms、缓存 3/3 命中。跨设备一致性仍要求固定字体或明确降级契约。

### P-03 多标签页行为

- **推荐**：单写者；第二标签页只读，提供“关闭其他页面后重试”和显式“接管”。
- **替代**：两个标签页通过本地同步共同编辑。
- **理由**：共同编辑会提前引入本地同步、合并和冲突语义，接近被明确排除的协作复杂度。
- **影响**：文档锁、冲突 UI 和恢复测试。
- **决策时点**：Phase 1B 前。
- **当前状态**：已确认推荐方向。Phase 1A 提供第二标签页只读与“关闭其他页面后刷新”；显式“接管”延后到 Phase 1B，详见 D-25。

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
- **当前状态**：已实现。每文档 Camera 存入独立 session database；已有 Camera 优先恢复，没有已保存 Camera 时执行 fit content。Document snapshot、selection、hover、active transform 与 IME buffer 均不受影响，详见 D-26。

### P-07 桌面手写笔与触控范围

- **推荐**：Phase 1 支持 Pointer Events 中的 pen/pressure 数据，但只承诺桌面布局；移动触摸 UI 不进入验收。
- **替代**：Phase 1 只保证 mouse/trackpad，自由笔忽略 pressure。
- **影响**：产品“ink”体验、输入 benchmark 和设备测试矩阵。
- **决策时点**：Phase 0 自由笔 Spike 后。
- **当前状态**：已确认采用替代方案。Phase 1 使用 mouse/trackpad/pen 的位置输入，固定 3px 笔宽并忽略 pressure；移动触摸 UI 和可变宽笔迹另行设计，详见 D-28。

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

---
*Last updated: 2026-07-23 | Reason: confirm fixed-width desktop freehand scope*
