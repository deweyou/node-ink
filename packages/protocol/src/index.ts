export const protocolVersion = 1 as const;
export const schemaVersion = 6 as const;
export const canvasFontFamily = 'Noto Sans SC Variable' as const;
export const nodeInkClipboardMime = 'application/x-nodeink-elements+json' as const;

export interface NodeInkDocumentV1 {
  schemaVersion: 6;
  documentId: string;
  revision: number;
  renderProfile: RenderProfileV1;
  rootOrder: string[];
  elements: Record<string, ElementRecordV1>;
}

export type ElementRecordV1 =
  | RectElementV1
  | EllipseElementV1
  | DiamondElementV1
  | LineElementV1
  | PolylineElementV1
  | ArrowElementV1
  | StrokeElementV1
  | TextElementV1
  | GroupElementV1;

export type FillV1 = { kind: 'none' } | { kind: 'solid'; color: string };

export type ElementSizeV1 = 's' | 'm' | 'l' | 'xl';

export type TextAlignV1 = 'start' | 'center' | 'end';

export interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface RectElementV1 {
  kind: 'rect';
  id: string;
  transform: Affine2D;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillV1;
  stroke: string;
  size: ElementSizeV1;
}

export interface EllipseElementV1 {
  kind: 'ellipse';
  id: string;
  transform: Affine2D;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillV1;
  stroke: string;
  size: ElementSizeV1;
}

export interface DiamondElementV1 {
  kind: 'diamond';
  id: string;
  transform: Affine2D;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: FillV1;
  stroke: string;
  size: ElementSizeV1;
}

export interface LineElementV1 {
  kind: 'line';
  id: string;
  transform: Affine2D;
  points: Vec2[];
  curve: PathCurveV1 | null;
  stroke: string;
  size: ElementSizeV1;
}

export interface PolylineElementV1 {
  kind: 'polyline';
  id: string;
  transform: Affine2D;
  points: Vec2[];
  stroke: string;
  size: ElementSizeV1;
}

export interface ArrowElementV1 {
  kind: 'arrow';
  id: string;
  transform: Affine2D;
  points: Vec2[];
  curve: PathCurveV1 | null;
  stroke: string;
  size: ElementSizeV1;
}

export interface StrokeElementV1 {
  kind: 'stroke';
  id: string;
  transform: Affine2D;
  points: Vec2[];
  size: ElementSizeV1;
  stroke: string;
}

export interface TextElementV1 {
  kind: 'text';
  id: string;
  transform: Affine2D;
  x: number;
  y: number;
  text: string;
  fontFamily: typeof canvasFontFamily;
  fontSize: number;
  fontWeight: 400 | 500;
  maxWidth: number | null;
  fontFingerprint: string;
  color: string;
  textAlign: TextAlignV1;
}

export interface GroupElementV1 {
  kind: 'group';
  id: string;
  transform: Affine2D;
  childOrder: string[];
}

export interface Vec2 {
  x: number;
  y: number;
}

export type PathCurveV1 = { kind: 'quadratic'; control: Vec2 };

export const minCameraZoom = 0.1;
export const maxCameraZoom = 8;

export interface CameraV1 {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraViewportV1 {
  width: number;
  height: number;
}

export type CameraActionV1 =
  | { type: 'pan_by'; delta: Vec2 }
  | { type: 'zoom_at'; factor: number; anchor: Vec2 }
  | { type: 'fit_content'; viewport: CameraViewportV1; padding: number };

export interface CommandEnvelopeV1 {
  protocolVersion: 1;
  commandId: string;
  documentId: string;
  expectedRevision: number;
  command: CommandV1;
}

export type CommandV1 =
  | { type: 'create_rectangle'; rectangle: RectElementV1 }
  | { type: 'create_ellipse'; ellipse: EllipseElementV1 }
  | { type: 'create_diamond'; diamond: DiamondElementV1 }
  | { type: 'create_line'; line: LineElementV1 }
  | { type: 'create_polyline'; polyline: PolylineElementV1 }
  | { type: 'create_arrow'; arrow: ArrowElementV1 }
  | { type: 'move_elements'; elementIds: string[]; delta: Vec2 }
  | { type: 'create_stroke'; stroke: StrokeElementV1 }
  | { type: 'create_text'; text: TextElementV1 }
  | { type: 'update_text'; elementId: string; patch: TextPatchV1 }
  | {
      type: 'resize_text';
      elementId: string;
      x: number;
      y: number;
      fontSize: number;
      maxWidth: number | null;
    }
  | { type: 'update_rectangle'; elementId: string; patch: RectanglePatchV1 }
  | { type: 'update_path_points'; elementId: string; points: Vec2[] }
  | { type: 'update_path_curve'; elementId: string; curve: PathCurveV1 | null }
  | { type: 'update_element_style'; elementId: string; patch: ElementStylePatchV1 }
  | { type: 'set_render_profile'; renderProfile: RenderProfileV1 }
  | { type: 'transform_elements'; elementIds: string[]; transform: Affine2D }
  | { type: 'group_elements'; groupId: string; elementIds: string[] }
  | { type: 'ungroup_elements'; groupId: string }
  | {
      type: 'reorder_elements';
      elementIds: string[];
      placement: ReorderPlacementV1;
    }
  | { type: 'align_elements'; elementIds: string[]; alignment: AlignmentV1 }
  | {
      type: 'paste_clipboard';
      payload: string;
      idPrefix: string;
      offset: Vec2;
    }
  | { type: 'delete_elements'; elementIds: string[] };

export type ReorderPlacementV1 = 'front' | 'forward' | 'backward' | 'back';
export type AlignmentV1 = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface ClipboardPayloadV1 {
  mime: typeof nodeInkClipboardMime;
  data: string;
}

export type ClipboardExportResultV1 = ClipboardPayloadV1;
export type ClipboardImportResultV1 = EngineUpdateV1;

export type ElementStylePatchV1 =
  | {
      kind: 'rect';
      fill?: FillV1;
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'ellipse';
      fill?: FillV1;
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'diamond';
      fill?: FillV1;
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'line';
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'polyline';
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'arrow';
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'stroke';
      stroke?: string;
      size?: ElementSizeV1;
    }
  | {
      kind: 'text';
      color?: string;
      fontSize?: number;
      fontWeight?: 400 | 500;
      textAlign?: TextAlignV1;
    };

export interface TextPatchV1 {
  text?: string;
  maxWidth?: number | null;
}

export interface RectanglePatchV1 {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export type DiagramOperationModeV1 = 'apply' | 'dry_run';

export interface DiagramOperationBatchV1 {
  protocolVersion: 1;
  batchId: string;
  documentId: string;
  expectedRevision: number;
  mode: DiagramOperationModeV1;
  atomic: true;
  operations: DiagramOperationV1[];
}

export type DiagramOperationV1 =
  | { type: 'create_rectangle'; opId: string; rectangle: RectElementV1 }
  | { type: 'move_elements'; opId: string; elementIds: string[]; delta: Vec2 }
  | {
      type: 'update_rectangle';
      opId: string;
      elementId: string;
      patch: RectanglePatchV1;
    }
  | { type: 'delete_elements'; opId: string; elementIds: string[] };

export interface DiagramOperationResultV1 {
  opId: string;
  status: 'applied' | 'planned';
  affectedElementIds: string[];
}

export interface DiagramOperationBatchResultV1 {
  batchId: string;
  mode: DiagramOperationModeV1;
  previousRevision: number;
  revision: number | null;
  results: DiagramOperationResultV1[];
  scenePatch: ScenePatchV1;
}

export interface OperationResultV1 {
  commandId: string;
  previousRevision: number;
  revision: number;
  changedElementIds: string[];
  sceneRevision: number;
}

export interface HistoryStateV1 {
  canUndo: boolean;
  canRedo: boolean;
}

export type EditorToolV1 =
  | 'select'
  | 'freehand'
  | 'text'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'polyline'
  | 'arrow';

export interface ToolStateV1 {
  activeTool: EditorToolV1;
}

export interface EngineUpdateV1 extends ToolStateV1 {
  operation: OperationResultV1 | null;
  scene: SceneSnapshotV1;
  history: HistoryStateV1;
  selection: SelectionStateV1;
  textMeasureRequest: TextMeasureRequestV1 | null;
}

export interface SelectionBoundsV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrientedSelectionBoundsV1 {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
}

export type SelectionHandleIdV1 =
  | 'north_west'
  | 'north'
  | 'north_east'
  | 'east'
  | 'south_east'
  | 'south'
  | 'south_west'
  | 'west'
  | 'rotate'
  | 'vertex'
  | 'curve';

export interface SelectionTransformHandleV1 {
  id: Exclude<SelectionHandleIdV1, 'vertex' | 'curve'>;
  kind: 'resize' | 'rotate';
  position: Vec2;
}

export interface SelectionVertexHandleV1 {
  id: 'vertex';
  kind: 'vertex';
  position: Vec2;
  vertexIndex: number;
  selected: boolean;
}

export interface SelectionCurveHandleV1 {
  id: 'curve';
  kind: 'curve';
  position: Vec2;
}

export type SelectionHandleV1 =
  | SelectionTransformHandleV1
  | SelectionVertexHandleV1
  | SelectionCurveHandleV1;

export interface SelectionMarqueeV1 {
  bounds: SelectionBoundsV1;
  mode: 'replace' | 'add' | 'toggle';
}

export interface AlignmentGuideV1 {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
}

export interface SelectionStateV1 {
  selectedElementIds: string[];
  primaryElementId: string | null;
  selectedElementId: string | null;
  visualBounds: SelectionBoundsV1 | null;
  orientedBounds: OrientedSelectionBoundsV1 | null;
  handles: SelectionHandleV1[];
  marquee: SelectionMarqueeV1 | null;
  guides: AlignmentGuideV1[];
  style: SelectionStyleV1 | null;
}

export type SelectionStyleV1 =
  | {
      kind: 'rect';
      fill: FillV1;
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'ellipse';
      fill: FillV1;
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'diamond';
      fill: FillV1;
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'line';
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'polyline';
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'arrow';
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'stroke';
      stroke: string;
      size: ElementSizeV1;
    }
  | {
      kind: 'text';
      color: string;
      fontSize: number;
      fontWeight: 400 | 500;
      textAlign: TextAlignV1;
    };

export interface SerializedDocumentV1 {
  canonicalPayload: string;
  document: NodeInkDocumentV1;
  engineAlgorithmVersion: string;
}

export interface SceneSnapshotV1 {
  protocolVersion: 1;
  documentId: string;
  documentRevision: number;
  sceneRevision: number;
  renderProfile: RenderProfileV1;
  rootNodeIds: string[];
  nodes: Record<string, SceneNodeV1>;
}

export interface ScenePatchV1 {
  protocolVersion: 1;
  documentRevision: number;
  baseSceneRevision: number;
  sceneRevision: number;
  addedNodes: Record<string, SceneNodeV1>;
  updatedNodes: Record<string, SceneNodeV1>;
  removedNodeIds: string[];
  rootNodeIds: string[] | null;
}

export interface SceneBenchmarkPayloadV1<T> {
  value: T;
  payloadBytes: number;
  wasmSerializeAndTransferMs: number;
  parseMs: number;
}

export type RenderProfileV1 =
  | { kind: 'clean'; version: 1 }
  | {
      kind: 'sketch';
      version: 1;
      seed: number;
      roughness: number;
      bowing: number;
      fillStyle: 'solid' | 'hachure';
    };

export interface SceneResolutionV1 {
  engineAlgorithmVersion: string;
  renderProfile: RenderProfileV1;
  canonicalHash: string;
  scene: SceneSnapshotV1;
}

export interface TextRunV1 {
  key: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500;
  maxWidth: number | null;
}

export interface TextMetricsV1 {
  key: string;
  width: number;
  height: number;
  baseline: number;
  lineBreaks: number[];
}

export interface TextMeasureRequestV1 {
  requestId: string;
  fontFingerprint: string;
  runs: TextRunV1[];
}

export interface TextMetricsSnapshotV1 {
  fontFingerprint: string;
  metrics: TextMetricsV1[];
}

export interface TextFixtureSceneV1 {
  fontFingerprint: string;
  runs: Array<{ run: TextRunV1; metrics: TextMetricsV1 }>;
}

export interface TextFixtureResolutionV1 {
  request: TextMeasureRequestV1 | null;
  scene: TextFixtureSceneV1 | null;
  canonicalHash: string | null;
}

export interface TextEditTargetV1 {
  element: TextElementV1 | null;
  update: EngineUpdateV1;
}

export interface MigrationResultV1 {
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  migrated: boolean;
  document: NodeInkDocumentV1;
  canonicalPayload: string;
}

export interface MigrationReportV1 {
  stage: string;
  code: string;
  sourceSchemaVersion: number | null;
  targetSchemaVersion: number;
  message: string;
  recovery: 'try_next_snapshot_then_readonly_diagnostic';
}

export type MigrationAttemptV1 =
  | { result: MigrationResultV1; report: null }
  | { result: null; report: MigrationReportV1 };

export type SceneNodeV1 = SceneRectV1 | ScenePathV1 | SceneTextV1;

export interface SceneRectV1 {
  kind: 'rect';
  id: string;
  sourceElementId: string;
  transform: Affine2D;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface ScenePathV1 {
  kind: 'path';
  id: string;
  sourceElementId: string;
  transform: Affine2D;
  pathData: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SceneTextV1 {
  kind: 'text';
  id: string;
  sourceElementId: string;
  transform: Affine2D;
  runs: SceneTextRunV1[];
}

export interface SceneTextRunV1 {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500;
  fill: string;
  textAnchor: 'start' | 'middle' | 'end';
}

export interface ViewportV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderViewportResultV1 {
  durationMs: number;
}

export interface EnginePortV1 {
  currentUpdate(): Promise<EngineUpdateV1>;
  currentCamera(): Promise<CameraV1>;
  setCamera(camera: CameraV1): Promise<CameraV1>;
  fitCamera(viewport: CameraViewportV1, padding: number): Promise<CameraV1>;
  applyCameraAction(action: CameraActionV1): Promise<CameraV1>;
  executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1>;
  setActiveTool(tool: EditorToolV1): Promise<EngineUpdateV1>;
  setSelection(elementIds: string[], primaryElementId: string | null): Promise<EngineUpdateV1>;
  copySelection(): Promise<ClipboardPayloadV1>;
  beginTextEditAt(point: Vec2): Promise<TextEditTargetV1>;
  provideTextMetrics(snapshot: TextMetricsSnapshotV1): Promise<EngineUpdateV1>;
  executeDiagramOperation(batch: DiagramOperationBatchV1): Promise<DiagramOperationBatchResultV1>;
  handlePointerEvents(
    events: NormalizedPointerEventV1[],
    commandId: string,
  ): Promise<PointerUpdateV1>;
  finishShapeCreation(): Promise<PointerUpdateV1>;
  removeShapeCreationPoint(): Promise<EngineUpdateV1>;
  insertPolylineVertexAt(point: Vec2, commandId: string): Promise<VertexEditUpdateV1>;
  deleteSelectedVertex(commandId: string): Promise<VertexEditUpdateV1>;
  handleStrokeBatch(
    batch: StrokeInputBatchV1,
    commandId: string,
    transport: StrokeTransportV1,
  ): Promise<StrokeUpdateV1>;
  resolveSceneProfile(profile: RenderProfileV1): Promise<SceneResolutionV1>;
  resolveTextFixture(
    requestId: string,
    fontFingerprint: string,
    runs: TextRunV1[],
    metrics: TextMetricsSnapshotV1 | null,
  ): Promise<TextFixtureResolutionV1>;
  benchmarkSceneSnapshot(
    elementCount: number,
    movedCount: number,
    afterMove: boolean,
  ): Promise<SceneBenchmarkPayloadV1<SceneSnapshotV1>>;
  benchmarkScenePatch(
    elementCount: number,
    movedCount: number,
  ): Promise<SceneBenchmarkPayloadV1<ScenePatchV1>>;
  migrateDocumentPayload(payloadJson: string): Promise<MigrationAttemptV1>;
  engineAlgorithmVersion(): string;
  serializeDocument(): SerializedDocumentV1;
  undo(): Promise<EngineUpdateV1>;
  redo(): Promise<EngineUpdateV1>;
  dispose(): void;
}

export type PointerPhaseV1 = 'down' | 'move' | 'up' | 'cancel';

export interface NormalizedPointerEventV1 {
  pointerId: number;
  sequence: number;
  phase: PointerPhaseV1;
  point: Vec2;
  modifiers: PointerModifiersV1;
  screenScale: number;
}

export interface PointerModifiersV1 {
  shift: boolean;
  alt: boolean;
  metaOrCtrl: boolean;
}

export interface PointerUpdateV1 {
  update: EngineUpdateV1;
  processedEventCount: number;
  ignoredEventCount: number;
  didCommit: boolean;
}

export interface VertexEditUpdateV1 {
  update: EngineUpdateV1;
  didCommit: boolean;
}

export type StrokePhaseV1 = 'down' | 'move' | 'up' | 'cancel';
export type StrokeTransportV1 = 'json' | 'typed_array';

export interface StrokeInputBatchV1 {
  pointerId: number;
  sequenceStart: number;
  phase: StrokePhaseV1;
  points: Vec2[];
  strokeId: string | null;
  straightLine?: boolean;
}

export interface StrokeUpdateV1 {
  update: EngineUpdateV1;
  processedPointCount: number;
  ignoredPointCount: number;
  didCommit: boolean;
}

export interface RendererV1 {
  mount(target: HTMLElement): void;
  setViewport(viewport: ViewportV1): RenderViewportResultV1;
  setOverlay(overlay: EditorOverlayV1): void;
  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1;
  applyPatch(patch: ScenePatchV1): RenderApplyResultV1;
  unmount(): void;
}

export interface EditorOverlayV1 {
  selectionBounds: SelectionBoundsV1 | null;
  selectionOrientedBounds: OrientedSelectionBoundsV1 | null;
  selectionHandles: SelectionHandleV1[];
  selectionPaddingWorld: number;
  marquee: SelectionMarqueeV1 | null;
  guides: AlignmentGuideV1[];
}

export type RenderApplyResultV1 =
  | {
      ok: true;
      sceneRevision: number;
      durationMs?: number;
      changedNodeCount?: number;
    }
  | { ok: false; reason: 'unsupported_scene' | 'snapshot_required' };

export function createBlankDocument(documentId: string): NodeInkDocumentV1 {
  return {
    schemaVersion,
    documentId,
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
    rootOrder: [],
    elements: {},
  };
}

export function createIdentityAffine2D(): Affine2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function parseNodeInkDocument(value: string): NodeInkDocumentV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isNodeInkDocument(parsed)) {
    throw new Error('Engine returned an invalid serialized Document');
  }
  return parsed;
}

export function parseCommandEnvelope(value: string): CommandEnvelopeV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, [
      'protocolVersion',
      'commandId',
      'documentId',
      'expectedRevision',
      'command',
    ]) ||
    parsed.protocolVersion !== protocolVersion ||
    !isNonEmptyString(parsed.commandId) ||
    !isNonEmptyString(parsed.documentId) ||
    !isNonNegativeSafeInteger(parsed.expectedRevision) ||
    !isCommand(parsed.command)
  ) {
    throw new Error('Command envelope does not satisfy protocol V1');
  }
  return parsed as unknown as CommandEnvelopeV1;
}

export function parseClipboardPayload(value: string): ClipboardPayloadV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ['mime', 'data']) ||
    parsed.mime !== nodeInkClipboardMime ||
    !isNonEmptyString(parsed.data)
  ) {
    throw new Error('Clipboard payload does not satisfy protocol V1');
  }
  return parsed as unknown as ClipboardPayloadV1;
}

export function parseNormalizedPointerEvents(value: string): NormalizedPointerEventV1[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isNormalizedPointerEvent)) {
    throw new Error('Pointer events do not satisfy protocol V1');
  }
  return parsed;
}

export function parseEngineUpdate(value: string): EngineUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.scene) ||
    !isRecord(parsed.history) ||
    !isRecord(parsed.selection)
  ) {
    throw new Error('Engine returned an invalid update payload');
  }
  if (
    !isSceneSnapshot(parsed.scene) ||
    !isOperationResultOrNull(parsed.operation) ||
    typeof parsed.history.canUndo !== 'boolean' ||
    typeof parsed.history.canRedo !== 'boolean' ||
    !isSelectionState(parsed.selection)
  ) {
    throw new Error('Engine update does not satisfy protocol V1');
  }
  const activeTool = parsed.activeTool === undefined ? 'select' : parsed.activeTool;
  if (!isEditorTool(activeTool)) {
    throw new Error('Engine update does not satisfy protocol V1');
  }
  const textMeasureRequest = parsed.textMeasureRequest ?? null;
  if (!isTextMeasureRequest(textMeasureRequest)) {
    throw new Error('Engine update does not satisfy protocol V1');
  }
  return { ...parsed, activeTool, textMeasureRequest } as unknown as EngineUpdateV1;
}

export function parseCamera(value: string): CameraV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.x !== 'number' ||
    !Number.isFinite(parsed.x) ||
    typeof parsed.y !== 'number' ||
    !Number.isFinite(parsed.y) ||
    typeof parsed.zoom !== 'number' ||
    !Number.isFinite(parsed.zoom) ||
    parsed.zoom < minCameraZoom ||
    parsed.zoom > maxCameraZoom
  ) {
    throw new Error('Camera does not satisfy Camera V1');
  }
  return parsed as unknown as CameraV1;
}

export function parseSceneSnapshot(value: string): SceneSnapshotV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isSceneSnapshot(parsed)) {
    throw new Error('Engine scene does not satisfy protocol V1');
  }
  return parsed as unknown as SceneSnapshotV1;
}

export function parseScenePatch(value: string): ScenePatchV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    parsed.protocolVersion !== protocolVersion ||
    !isNonNegativeSafeInteger(parsed.documentRevision) ||
    !isNonNegativeSafeInteger(parsed.baseSceneRevision) ||
    !isNonNegativeSafeInteger(parsed.sceneRevision) ||
    !isRecord(parsed.addedNodes) ||
    !isRecord(parsed.updatedNodes) ||
    !Array.isArray(parsed.removedNodeIds) ||
    !isSceneNodeMap(parsed.addedNodes) ||
    !isSceneNodeMap(parsed.updatedNodes) ||
    !parsed.removedNodeIds.every((nodeId) => typeof nodeId === 'string') ||
    (parsed.rootNodeIds !== null &&
      (!Array.isArray(parsed.rootNodeIds) ||
        !parsed.rootNodeIds.every((nodeId) => typeof nodeId === 'string')))
  ) {
    throw new Error('Engine patch does not satisfy protocol V1');
  }
  return parsed as unknown as ScenePatchV1;
}

export function parseDiagramOperationBatchResult(value: string): DiagramOperationBatchResultV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.batchId !== 'string' ||
    (parsed.mode !== 'apply' && parsed.mode !== 'dry_run') ||
    !isNonNegativeSafeInteger(parsed.previousRevision) ||
    (parsed.revision !== null && !isNonNegativeSafeInteger(parsed.revision)) ||
    !Array.isArray(parsed.results) ||
    !isRecord(parsed.scenePatch)
  ) {
    throw new Error('Diagram operation result does not satisfy protocol V1');
  }
  for (const result of parsed.results) {
    if (
      !isRecord(result) ||
      typeof result.opId !== 'string' ||
      (result.status !== 'applied' && result.status !== 'planned') ||
      !Array.isArray(result.affectedElementIds) ||
      !result.affectedElementIds.every((elementId) => typeof elementId === 'string')
    ) {
      throw new Error('Diagram operation result does not satisfy protocol V1');
    }
  }
  return {
    batchId: parsed.batchId,
    mode: parsed.mode,
    previousRevision: parsed.previousRevision,
    revision: parsed.revision,
    results: parsed.results as DiagramOperationResultV1[],
    scenePatch: parseScenePatch(JSON.stringify(parsed.scenePatch)),
  };
}

export function parsePointerUpdate(value: string): PointerUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.update) ||
    !isNonNegativeSafeInteger(parsed.processedEventCount) ||
    !isNonNegativeSafeInteger(parsed.ignoredEventCount) ||
    typeof parsed.didCommit !== 'boolean'
  ) {
    throw new Error('Engine returned an invalid pointer update payload');
  }
  return {
    update: parseEngineUpdate(JSON.stringify(parsed.update)),
    processedEventCount: parsed.processedEventCount,
    ignoredEventCount: parsed.ignoredEventCount,
    didCommit: parsed.didCommit,
  };
}

export function parseVertexEditUpdate(value: string): VertexEditUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.update) || typeof parsed.didCommit !== 'boolean') {
    throw new Error('Engine returned an invalid vertex edit update payload');
  }
  return {
    update: parseEngineUpdate(JSON.stringify(parsed.update)),
    didCommit: parsed.didCommit,
  };
}

export function parseStrokeUpdate(value: string): StrokeUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.update) ||
    !isNonNegativeSafeInteger(parsed.processedPointCount) ||
    !isNonNegativeSafeInteger(parsed.ignoredPointCount) ||
    typeof parsed.didCommit !== 'boolean'
  ) {
    throw new Error('Engine returned an invalid stroke update payload');
  }
  return {
    update: parseEngineUpdate(JSON.stringify(parsed.update)),
    processedPointCount: parsed.processedPointCount,
    ignoredPointCount: parsed.ignoredPointCount,
    didCommit: parsed.didCommit,
  };
}

export function parseTextEditTarget(value: string): TextEditTargetV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    (parsed.element !== null && !isTextElement(parsed.element)) ||
    !isRecord(parsed.update)
  ) {
    throw new Error('Engine returned an invalid text edit target payload');
  }
  let update: EngineUpdateV1;
  try {
    update = parseEngineUpdate(JSON.stringify(parsed.update));
  } catch {
    throw new Error('Engine returned an invalid text edit target payload');
  }
  return {
    element: parsed.element,
    update,
  };
}

export function parseSceneResolution(value: string): SceneResolutionV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.engineAlgorithmVersion !== 'string' ||
    typeof parsed.canonicalHash !== 'string' ||
    !isRenderProfile(parsed.renderProfile) ||
    !isRecord(parsed.scene) ||
    !isSceneSnapshot(parsed.scene) ||
    !renderProfilesEqual(parsed.renderProfile, parsed.scene.renderProfile as RenderProfileV1)
  ) {
    throw new Error('Engine returned an invalid scene resolution payload');
  }
  return parsed as unknown as SceneResolutionV1;
}

export function parseTextFixtureResolution(value: string): TextFixtureResolutionV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !isTextMeasureRequest(parsed.request) ||
    (parsed.scene !== null && !isTextFixtureScene(parsed.scene)) ||
    (parsed.canonicalHash !== null && typeof parsed.canonicalHash !== 'string') ||
    !(
      (parsed.request !== null && parsed.scene === null && parsed.canonicalHash === null) ||
      (parsed.request === null && parsed.scene !== null && typeof parsed.canonicalHash === 'string')
    )
  ) {
    throw new Error('Engine returned an invalid text fixture resolution payload');
  }
  return parsed as unknown as TextFixtureResolutionV1;
}

export function parseMigrationAttempt(value: string): MigrationAttemptV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new Error('Engine returned an invalid migration attempt');
  }
  if (isRecord(parsed.result) && parsed.report === null) {
    if (
      isNonNegativeSafeInteger(parsed.result.sourceSchemaVersion) &&
      parsed.result.targetSchemaVersion === schemaVersion &&
      typeof parsed.result.migrated === 'boolean' &&
      isNodeInkDocument(parsed.result.document) &&
      typeof parsed.result.canonicalPayload === 'string'
    ) {
      return parsed as unknown as MigrationAttemptV1;
    }
  } else if (parsed.result === null && isRecord(parsed.report)) {
    if (
      typeof parsed.report.stage === 'string' &&
      typeof parsed.report.code === 'string' &&
      (parsed.report.sourceSchemaVersion === null ||
        isNonNegativeSafeInteger(parsed.report.sourceSchemaVersion)) &&
      parsed.report.targetSchemaVersion === schemaVersion &&
      typeof parsed.report.message === 'string' &&
      parsed.report.recovery === 'try_next_snapshot_then_readonly_diagnostic'
    ) {
      return parsed as unknown as MigrationAttemptV1;
    }
  }
  throw new Error('Engine migration attempt does not satisfy protocol V1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isCommand(value: unknown): value is CommandV1 {
  if (!isRecord(value) || !isNonEmptyString(value.type)) {
    return false;
  }
  switch (value.type) {
    case 'create_rectangle':
      return hasOnlyKeys(value, ['type', 'rectangle']) && isRectElement(value.rectangle);
    case 'create_ellipse':
      return hasOnlyKeys(value, ['type', 'ellipse']) && isEllipseElement(value.ellipse);
    case 'create_diamond':
      return hasOnlyKeys(value, ['type', 'diamond']) && isDiamondElement(value.diamond);
    case 'create_line':
      return hasOnlyKeys(value, ['type', 'line']) && isLineElement(value.line);
    case 'create_polyline':
      return hasOnlyKeys(value, ['type', 'polyline']) && isPolylineElement(value.polyline);
    case 'create_arrow':
      return hasOnlyKeys(value, ['type', 'arrow']) && isArrowElement(value.arrow);
    case 'create_stroke':
      return hasOnlyKeys(value, ['type', 'stroke']) && isStrokeElement(value.stroke);
    case 'create_text':
      return hasOnlyKeys(value, ['type', 'text']) && isTextElement(value.text);
    case 'move_elements':
      return (
        hasOnlyKeys(value, ['type', 'elementIds', 'delta']) &&
        isNonEmptyUniqueStringArray(value.elementIds) &&
        isVec2(value.delta)
      );
    case 'update_text':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'patch']) &&
        isNonEmptyString(value.elementId) &&
        isTextPatch(value.patch)
      );
    case 'resize_text':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'x', 'y', 'fontSize', 'maxWidth']) &&
        isNonEmptyString(value.elementId) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isValidFontSize(value.fontSize) &&
        (value.maxWidth === null || isPositiveFiniteNumber(value.maxWidth))
      );
    case 'update_rectangle':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'patch']) &&
        isNonEmptyString(value.elementId) &&
        isRectanglePatch(value.patch)
      );
    case 'update_path_points':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'points']) &&
        isNonEmptyString(value.elementId) &&
        Array.isArray(value.points) &&
        value.points.length >= 2 &&
        value.points.length <= 65_536 &&
        value.points.every(isVec2) &&
        value.points.every(
          (point, index, points) =>
            index === 0 ||
            point.x !== (points[index - 1] as Vec2).x ||
            point.y !== (points[index - 1] as Vec2).y,
        )
      );
    case 'update_path_curve':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'curve']) &&
        isNonEmptyString(value.elementId) &&
        (value.curve === null || isPathCurve(value.curve))
      );
    case 'update_element_style':
      return (
        hasOnlyKeys(value, ['type', 'elementId', 'patch']) &&
        isNonEmptyString(value.elementId) &&
        isElementStylePatch(value.patch)
      );
    case 'set_render_profile':
      return hasOnlyKeys(value, ['type', 'renderProfile']) && isRenderProfile(value.renderProfile);
    case 'transform_elements':
      return (
        hasOnlyKeys(value, ['type', 'elementIds', 'transform']) &&
        isNonEmptyUniqueStringArray(value.elementIds) &&
        isAffine2D(value.transform)
      );
    case 'group_elements':
      return (
        hasOnlyKeys(value, ['type', 'groupId', 'elementIds']) &&
        isNonEmptyString(value.groupId) &&
        isNonEmptyUniqueStringArray(value.elementIds, 2) &&
        !value.elementIds.includes(value.groupId)
      );
    case 'ungroup_elements':
      return hasOnlyKeys(value, ['type', 'groupId']) && isNonEmptyString(value.groupId);
    case 'reorder_elements':
      return (
        hasOnlyKeys(value, ['type', 'elementIds', 'placement']) &&
        isNonEmptyUniqueStringArray(value.elementIds) &&
        isReorderPlacement(value.placement)
      );
    case 'align_elements':
      return (
        hasOnlyKeys(value, ['type', 'elementIds', 'alignment']) &&
        isNonEmptyUniqueStringArray(value.elementIds, 2) &&
        isAlignment(value.alignment)
      );
    case 'paste_clipboard':
      return (
        hasOnlyKeys(value, ['type', 'payload', 'idPrefix', 'offset']) &&
        isNonEmptyString(value.payload) &&
        isNonEmptyString(value.idPrefix) &&
        isVec2(value.offset)
      );
    case 'delete_elements':
      return (
        hasOnlyKeys(value, ['type', 'elementIds']) && isNonEmptyUniqueStringArray(value.elementIds)
      );
    default:
      return false;
  }
}

function isTextPatch(value: unknown): value is TextPatchV1 {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.every((key) => key === 'text' || key === 'maxWidth') &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.maxWidth === undefined ||
      value.maxWidth === null ||
      isPositiveFiniteNumber(value.maxWidth))
  );
}

function isRectanglePatch(value: unknown): value is RectanglePatchV1 {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.every((key) => key === 'x' || key === 'y' || key === 'width' || key === 'height') &&
    (value.x === undefined || isFiniteNumber(value.x)) &&
    (value.y === undefined || isFiniteNumber(value.y)) &&
    (value.width === undefined || isPositiveFiniteNumber(value.width)) &&
    (value.height === undefined || isPositiveFiniteNumber(value.height))
  );
}

function isElementStylePatch(value: unknown): value is ElementStylePatchV1 {
  if (!isRecord(value) || Object.keys(value).length < 2) {
    return false;
  }
  const keys = Object.keys(value);
  if (value.kind === 'rect') {
    return (
      keys.every((key) => key === 'kind' || key === 'fill' || key === 'stroke' || key === 'size') &&
      (value.fill === undefined || isFill(value.fill)) &&
      (value.stroke === undefined || isCanonicalColor(value.stroke)) &&
      (value.size === undefined || isElementSize(value.size))
    );
  }
  if (value.kind === 'ellipse' || value.kind === 'diamond') {
    return (
      keys.every((key) => key === 'kind' || key === 'fill' || key === 'stroke' || key === 'size') &&
      (value.fill === undefined || isFill(value.fill)) &&
      (value.stroke === undefined || isCanonicalColor(value.stroke)) &&
      (value.size === undefined || isElementSize(value.size))
    );
  }
  if (
    value.kind === 'line' ||
    value.kind === 'polyline' ||
    value.kind === 'arrow' ||
    value.kind === 'stroke'
  ) {
    return (
      keys.every((key) => key === 'kind' || key === 'stroke' || key === 'size') &&
      (value.stroke === undefined || isCanonicalColor(value.stroke)) &&
      (value.size === undefined || isElementSize(value.size))
    );
  }
  return (
    value.kind === 'text' &&
    keys.every(
      (key) =>
        key === 'kind' ||
        key === 'color' ||
        key === 'fontSize' ||
        key === 'fontWeight' ||
        key === 'textAlign',
    ) &&
    (value.color === undefined || isCanonicalColor(value.color)) &&
    (value.fontSize === undefined || isValidFontSize(value.fontSize)) &&
    (value.fontWeight === undefined || value.fontWeight === 400 || value.fontWeight === 500) &&
    (value.textAlign === undefined || isTextAlign(value.textAlign))
  );
}

function isNormalizedPointerEvent(value: unknown): value is NormalizedPointerEventV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['pointerId', 'sequence', 'phase', 'point', 'modifiers', 'screenScale']) &&
    isUint32(value.pointerId) &&
    isNonNegativeSafeInteger(value.sequence) &&
    (value.phase === 'down' ||
      value.phase === 'move' ||
      value.phase === 'up' ||
      value.phase === 'cancel') &&
    isVec2(value.point) &&
    isPointerModifiers(value.modifiers) &&
    isPositiveFiniteNumber(value.screenScale)
  );
}

function isPointerModifiers(value: unknown): value is PointerModifiersV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['shift', 'alt', 'metaOrCtrl']) &&
    typeof value.shift === 'boolean' &&
    typeof value.alt === 'boolean' &&
    typeof value.metaOrCtrl === 'boolean'
  );
}

function isEditorTool(value: unknown): value is EditorToolV1 {
  return (
    value === 'select' ||
    value === 'freehand' ||
    value === 'text' ||
    value === 'rectangle' ||
    value === 'ellipse' ||
    value === 'diamond' ||
    value === 'line' ||
    value === 'polyline' ||
    value === 'arrow'
  );
}

function isNodeInkDocument(value: unknown): value is NodeInkDocumentV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== schemaVersion ||
    typeof value.documentId !== 'string' ||
    value.documentId.length === 0 ||
    !isNonNegativeSafeInteger(value.revision) ||
    !isRenderProfile(value.renderProfile) ||
    !Array.isArray(value.rootOrder) ||
    !value.rootOrder.every(isNonEmptyString) ||
    new Set(value.rootOrder).size !== value.rootOrder.length ||
    !isRecord(value.elements)
  ) {
    return false;
  }
  const elements = value.elements as Record<string, unknown>;
  const elementEntries = Object.entries(elements);
  if (
    !elementEntries.every(
      ([elementId, element]) => isElementRecord(element) && element.id === elementId,
    )
  ) {
    return false;
  }
  const referencedIds = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (elementId: string): boolean => {
    const element = elements[elementId] as ElementRecordV1 | undefined;
    if (element === undefined || visiting.has(elementId) || referencedIds.has(elementId)) {
      return false;
    }
    referencedIds.add(elementId);
    visiting.add(elementId);
    if (element.kind === 'group' && !element.childOrder.every(visit)) {
      return false;
    }
    visiting.delete(elementId);
    visited.add(elementId);
    return true;
  };
  return value.rootOrder.every(visit) && visited.size === elementEntries.length;
}

function isElementRecord(value: unknown): value is ElementRecordV1 {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isAffine2D(value.transform)) {
    return false;
  }
  if (value.kind === 'rect') {
    return isRectElement(value);
  }
  if (value.kind === 'ellipse') {
    return isEllipseElement(value);
  }
  if (value.kind === 'diamond') {
    return isDiamondElement(value);
  }
  if (value.kind === 'line') {
    return isLineElement(value);
  }
  if (value.kind === 'polyline') {
    return isPolylineElement(value);
  }
  if (value.kind === 'arrow') {
    return isArrowElement(value);
  }
  if (value.kind === 'stroke') {
    return isStrokeElement(value);
  }
  if (value.kind === 'group') {
    return (
      hasOnlyKeys(value, ['kind', 'id', 'transform', 'childOrder']) &&
      Array.isArray(value.childOrder) &&
      value.childOrder.length > 0 &&
      value.childOrder.every(isNonEmptyString) &&
      new Set(value.childOrder).size === value.childOrder.length &&
      !value.childOrder.includes(value.id)
    );
  }
  return isTextElement(value);
}

function isRectElement(value: unknown): value is RectElementV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'id',
      'transform',
      'x',
      'y',
      'width',
      'height',
      'fill',
      'stroke',
      'size',
    ]) &&
    value.kind === 'rect' &&
    isNonEmptyString(value.id) &&
    isAffine2D(value.transform) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isPositiveFiniteNumber(value.width) &&
    isPositiveFiniteNumber(value.height) &&
    isFill(value.fill) &&
    isCanonicalColor(value.stroke) &&
    isElementSize(value.size)
  );
}

function isEllipseElement(value: unknown): value is EllipseElementV1 {
  return isClosedShapeElement(value, 'ellipse');
}

function isDiamondElement(value: unknown): value is DiamondElementV1 {
  return isClosedShapeElement(value, 'diamond');
}

function isClosedShapeElement(
  value: unknown,
  kind: 'ellipse' | 'diamond',
): value is EllipseElementV1 | DiamondElementV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'id',
      'transform',
      'x',
      'y',
      'width',
      'height',
      'fill',
      'stroke',
      'size',
    ]) &&
    value.kind === kind &&
    isNonEmptyString(value.id) &&
    isAffine2D(value.transform) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isPositiveFiniteNumber(value.width) &&
    isPositiveFiniteNumber(value.height) &&
    isFill(value.fill) &&
    isCanonicalColor(value.stroke) &&
    isElementSize(value.size)
  );
}

function isLineElement(value: unknown): value is LineElementV1 {
  return isLineShapeElement(value, 'line', 2, 2);
}

function isPolylineElement(value: unknown): value is PolylineElementV1 {
  return isLineShapeElement(value, 'polyline', 3);
}

function isArrowElement(value: unknown): value is ArrowElementV1 {
  return isLineShapeElement(value, 'arrow', 2);
}

function isLineShapeElement(
  value: unknown,
  kind: 'line' | 'polyline' | 'arrow',
  minimumPoints: number,
  maximumPoints = Number.POSITIVE_INFINITY,
): value is LineElementV1 | PolylineElementV1 | ArrowElementV1 {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return false;
  }
  const points = value.points;
  const supportsCurve = kind === 'line' || kind === 'arrow';
  return (
    hasOnlyKeys(
      value,
      supportsCurve
        ? ['kind', 'id', 'transform', 'points', 'curve', 'size', 'stroke']
        : ['kind', 'id', 'transform', 'points', 'size', 'stroke'],
    ) &&
    value.kind === kind &&
    isNonEmptyString(value.id) &&
    isAffine2D(value.transform) &&
    points.length >= minimumPoints &&
    points.length <= maximumPoints &&
    points.every(isVec2) &&
    points.every(
      (point, index) =>
        index === 0 ||
        point.x !== (points[index - 1] as Vec2).x ||
        point.y !== (points[index - 1] as Vec2).y,
    ) &&
    (!supportsCurve || value.curve === null || (points.length === 2 && isPathCurve(value.curve))) &&
    isElementSize(value.size) &&
    isCanonicalColor(value.stroke)
  );
}

function isPathCurve(value: unknown): value is PathCurveV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['kind', 'control']) &&
    value.kind === 'quadratic' &&
    isVec2(value.control)
  );
}

function isStrokeElement(value: unknown): value is StrokeElementV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['kind', 'id', 'transform', 'points', 'size', 'stroke']) &&
    value.kind === 'stroke' &&
    isNonEmptyString(value.id) &&
    isAffine2D(value.transform) &&
    Array.isArray(value.points) &&
    value.points.length >= 2 &&
    value.points.every(isVec2) &&
    isElementSize(value.size) &&
    isCanonicalColor(value.stroke)
  );
}

function isSceneSnapshot(value: Record<string, unknown>): boolean {
  const rootNodeIds = value.rootNodeIds;
  const nodes = value.nodes;
  if (
    value.protocolVersion !== protocolVersion ||
    !isNonEmptyString(value.documentId) ||
    !isNonNegativeSafeInteger(value.documentRevision) ||
    !isNonNegativeSafeInteger(value.sceneRevision) ||
    !isRenderProfile(value.renderProfile) ||
    !Array.isArray(rootNodeIds) ||
    !rootNodeIds.every(isNonEmptyString) ||
    new Set(rootNodeIds).size !== rootNodeIds.length ||
    !isRecord(nodes) ||
    !isSceneNodeMap(nodes)
  ) {
    return false;
  }
  return rootNodeIds.every((nodeId) => nodes[nodeId] !== undefined);
}

function isSceneNodeMap(value: Record<string, unknown>): boolean {
  return Object.entries(value).every(([nodeId, node]) => isSceneNode(node) && node.id === nodeId);
}

function isSceneNode(value: unknown): value is SceneNodeV1 {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.sourceElementId) ||
    !isAffine2D(value.transform)
  ) {
    return false;
  }
  if (value.kind === 'rect') {
    return (
      hasOnlyKeys(value, [
        'kind',
        'id',
        'sourceElementId',
        'transform',
        'x',
        'y',
        'width',
        'height',
        'fill',
        'stroke',
        'strokeWidth',
      ]) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isNonNegativeFiniteNumber(value.width) &&
      isNonNegativeFiniteNumber(value.height) &&
      isScenePaint(value.fill) &&
      isScenePaint(value.stroke) &&
      isNonNegativeFiniteNumber(value.strokeWidth)
    );
  }
  if (value.kind === 'path') {
    return (
      hasOnlyKeys(value, [
        'kind',
        'id',
        'sourceElementId',
        'transform',
        'pathData',
        'fill',
        'stroke',
        'strokeWidth',
      ]) &&
      typeof value.pathData === 'string' &&
      isScenePaint(value.fill) &&
      isScenePaint(value.stroke) &&
      isNonNegativeFiniteNumber(value.strokeWidth)
    );
  }
  return (
    value.kind === 'text' &&
    hasOnlyKeys(value, ['kind', 'id', 'sourceElementId', 'transform', 'runs']) &&
    Array.isArray(value.runs) &&
    value.runs.every(isSceneTextRun)
  );
}

function isSceneTextRun(value: unknown): value is SceneTextRunV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'text',
      'x',
      'y',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fill',
      'textAnchor',
    ]) &&
    typeof value.text === 'string' &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    value.fontFamily === canvasFontFamily &&
    isValidFontSize(value.fontSize) &&
    (value.fontWeight === 400 || value.fontWeight === 500) &&
    isCanonicalColor(value.fill) &&
    (value.textAnchor === 'start' || value.textAnchor === 'middle' || value.textAnchor === 'end')
  );
}

function isOperationResultOrNull(value: unknown): value is OperationResultV1 | null {
  return (
    value === null ||
    (isRecord(value) &&
      isNonEmptyString(value.commandId) &&
      isNonNegativeSafeInteger(value.previousRevision) &&
      isNonNegativeSafeInteger(value.revision) &&
      Array.isArray(value.changedElementIds) &&
      value.changedElementIds.every(isNonEmptyString) &&
      isNonNegativeSafeInteger(value.sceneRevision))
  );
}

function isTextMeasureRequest(value: unknown): value is TextMeasureRequestV1 | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.requestId === 'string' &&
      value.requestId.length > 0 &&
      typeof value.fontFingerprint === 'string' &&
      value.fontFingerprint.length > 0 &&
      Array.isArray(value.runs) &&
      value.runs.every(isTextRun))
  );
}

function isTextElement(value: unknown): value is TextElementV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'id',
      'transform',
      'x',
      'y',
      'text',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'maxWidth',
      'fontFingerprint',
      'color',
      'textAlign',
    ]) &&
    value.kind === 'text' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isAffine2D(value.transform) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    typeof value.text === 'string' &&
    value.fontFamily === canvasFontFamily &&
    isValidFontSize(value.fontSize) &&
    (value.fontWeight === 400 || value.fontWeight === 500) &&
    (value.maxWidth === null || isPositiveFiniteNumber(value.maxWidth)) &&
    typeof value.fontFingerprint === 'string' &&
    value.fontFingerprint.trim().length > 0 &&
    isCanonicalColor(value.color) &&
    isTextAlign(value.textAlign)
  );
}

function isTextRun(value: unknown): value is TextRunV1 {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    value.key.length > 0 &&
    typeof value.text === 'string' &&
    value.fontFamily === canvasFontFamily &&
    isPositiveFiniteNumber(value.fontSize) &&
    (value.fontWeight === 400 || value.fontWeight === 500) &&
    (value.maxWidth === null || isPositiveFiniteNumber(value.maxWidth))
  );
}

function isTextFixtureScene(value: unknown): value is TextFixtureSceneV1 {
  return (
    isRecord(value) &&
    isNonEmptyString(value.fontFingerprint) &&
    Array.isArray(value.runs) &&
    value.runs.every(
      (entry) =>
        isRecord(entry) &&
        isTextRun(entry.run) &&
        isTextMetrics(entry.metrics) &&
        entry.run.key === entry.metrics.key,
    )
  );
}

function isTextMetrics(value: unknown): value is TextMetricsV1 {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.key) ||
    !isNonNegativeFiniteNumber(value.width) ||
    !isPositiveFiniteNumber(value.height) ||
    !isNonNegativeFiniteNumber(value.baseline) ||
    value.baseline > value.height ||
    !Array.isArray(value.lineBreaks) ||
    !value.lineBreaks.every(isNonNegativeSafeInteger)
  ) {
    return false;
  }
  const lineBreaks = value.lineBreaks as number[];
  return lineBreaks.every((lineBreak, index) => index === 0 || lineBreak > lineBreaks[index - 1]!);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isElementSize(value: unknown): value is ElementSizeV1 {
  return value === 's' || value === 'm' || value === 'l' || value === 'xl';
}

function isValidFontSize(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 1 && value <= 512;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSelectionState(value: unknown): value is SelectionStateV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'selectedElementIds',
      'primaryElementId',
      'selectedElementId',
      'visualBounds',
      'orientedBounds',
      'handles',
      'marquee',
      'guides',
      'style',
    ]) ||
    !isUniqueStringArray(value.selectedElementIds) ||
    (value.primaryElementId !== null && !isNonEmptyString(value.primaryElementId)) ||
    value.selectedElementId !== value.primaryElementId ||
    !isSelectionBounds(value.visualBounds) ||
    !isOrientedSelectionBounds(value.orientedBounds) ||
    !Array.isArray(value.handles) ||
    !value.handles.every(isSelectionHandle) ||
    new Set(
      value.handles.map((handle) =>
        handle.kind === 'vertex' ? `vertex:${handle.vertexIndex}` : handle.id,
      ),
    ).size !== value.handles.length ||
    !isSelectionMarquee(value.marquee) ||
    !Array.isArray(value.guides) ||
    !value.guides.every(isAlignmentGuide) ||
    !isSelectionStyleOrNull(value.style)
  ) {
    return false;
  }
  const selectedElementIds = value.selectedElementIds as string[];
  const hasSelection = selectedElementIds.length > 0;
  if (
    hasSelection !== (value.primaryElementId !== null) ||
    (value.primaryElementId !== null && !selectedElementIds.includes(value.primaryElementId)) ||
    (value.visualBounds === null) !== (value.orientedBounds === null) ||
    (!hasSelection &&
      (value.visualBounds !== null ||
        value.orientedBounds !== null ||
        value.handles.length > 0 ||
        value.guides.length > 0 ||
        value.style !== null)) ||
    (value.handles.length > 0 && value.orientedBounds === null)
  ) {
    return false;
  }
  return true;
}

function isSelectionBounds(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      hasOnlyKeys(value, ['x', 'y', 'width', 'height']) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isNonNegativeFiniteNumber(value.width) &&
      isNonNegativeFiniteNumber(value.height))
  );
}

function isOrientedSelectionBounds(value: unknown): value is OrientedSelectionBoundsV1 | null {
  return (
    value === null ||
    (isRecord(value) &&
      hasOnlyKeys(value, ['center', 'width', 'height', 'rotation']) &&
      isVec2(value.center) &&
      isNonNegativeFiniteNumber(value.width) &&
      isNonNegativeFiniteNumber(value.height) &&
      isFiniteNumber(value.rotation))
  );
}

function isSelectionHandle(value: unknown): value is SelectionHandleV1 {
  if (!isRecord(value) || !isVec2(value.position)) {
    return false;
  }
  if (value.kind === 'vertex') {
    return (
      hasOnlyKeys(value, ['id', 'kind', 'position', 'vertexIndex', 'selected']) &&
      value.id === 'vertex' &&
      isNonNegativeSafeInteger(value.vertexIndex) &&
      typeof value.selected === 'boolean'
    );
  }
  if (value.kind === 'curve') {
    return hasOnlyKeys(value, ['id', 'kind', 'position']) && value.id === 'curve';
  }
  if (
    !hasOnlyKeys(value, ['id', 'kind', 'position']) ||
    !isSelectionHandleId(value.id) ||
    (value.kind !== 'resize' && value.kind !== 'rotate') ||
    value.id === 'vertex'
  ) {
    return false;
  }
  return value.id !== 'curve' && (value.id === 'rotate') === (value.kind === 'rotate');
}

function isSelectionHandleId(value: unknown): value is SelectionHandleIdV1 {
  return (
    value === 'north_west' ||
    value === 'north' ||
    value === 'north_east' ||
    value === 'east' ||
    value === 'south_east' ||
    value === 'south' ||
    value === 'south_west' ||
    value === 'west' ||
    value === 'rotate' ||
    value === 'vertex' ||
    value === 'curve'
  );
}

function isSelectionMarquee(value: unknown): value is SelectionMarqueeV1 | null {
  return (
    value === null ||
    (isRecord(value) &&
      hasOnlyKeys(value, ['bounds', 'mode']) &&
      value.bounds !== null &&
      isSelectionBounds(value.bounds) &&
      (value.mode === 'replace' || value.mode === 'add' || value.mode === 'toggle'))
  );
}

function isAlignmentGuide(value: unknown): value is AlignmentGuideV1 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['axis', 'position', 'start', 'end']) &&
    (value.axis === 'x' || value.axis === 'y') &&
    isFiniteNumber(value.position) &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end)
  );
}

function isSelectionStyleOrNull(value: unknown): value is SelectionStyleV1 | null {
  return value === null || isSelectionStyle(value);
}

function isSelectionStyle(value: unknown): value is SelectionStyleV1 {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'rect') {
    return (
      hasOnlyKeys(value, ['kind', 'fill', 'stroke', 'size']) &&
      isFill(value.fill) &&
      isCanonicalColor(value.stroke) &&
      isElementSize(value.size)
    );
  }
  if (value.kind === 'ellipse' || value.kind === 'diamond') {
    return (
      hasOnlyKeys(value, ['kind', 'fill', 'stroke', 'size']) &&
      isFill(value.fill) &&
      isCanonicalColor(value.stroke) &&
      isElementSize(value.size)
    );
  }
  if (
    value.kind === 'line' ||
    value.kind === 'polyline' ||
    value.kind === 'arrow' ||
    value.kind === 'stroke'
  ) {
    return (
      hasOnlyKeys(value, ['kind', 'stroke', 'size']) &&
      isCanonicalColor(value.stroke) &&
      isElementSize(value.size)
    );
  }
  return (
    value.kind === 'text' &&
    hasOnlyKeys(value, ['kind', 'color', 'fontSize', 'fontWeight', 'textAlign']) &&
    isCanonicalColor(value.color) &&
    isValidFontSize(value.fontSize) &&
    (value.fontWeight === 400 || value.fontWeight === 500) &&
    isTextAlign(value.textAlign)
  );
}

function isFill(value: unknown): value is FillV1 {
  if (!isRecord(value)) {
    return false;
  }
  return value.kind === 'none'
    ? hasOnlyKeys(value, ['kind'])
    : value.kind === 'solid' &&
        hasOnlyKeys(value, ['kind', 'color']) &&
        isCanonicalColor(value.color);
}

function isCanonicalColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
}

function isScenePaint(value: unknown): value is string {
  return value === 'none' || isCanonicalColor(value);
}

function isTextAlign(value: unknown): value is TextAlignV1 {
  return value === 'start' || value === 'center' || value === 'end';
}

function isVec2(value: unknown): value is Vec2 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['x', 'y']) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
}

function isAffine2D(value: unknown): value is Affine2D {
  if (
    isRecord(value) &&
    hasOnlyKeys(value, ['a', 'b', 'c', 'd', 'e', 'f']) &&
    isFiniteNumber(value.a) &&
    isFiniteNumber(value.b) &&
    isFiniteNumber(value.c) &&
    isFiniteNumber(value.d) &&
    isFiniteNumber(value.e) &&
    isFiniteNumber(value.f)
  ) {
    const determinant = value.a * value.d - value.b * value.c;
    return Number.isFinite(determinant) && determinant !== 0;
  }
  return false;
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length
  );
}

function isNonEmptyUniqueStringArray(value: unknown, minimumLength = 1): value is string[] {
  return isUniqueStringArray(value) && value.length >= minimumLength;
}

function isReorderPlacement(value: unknown): value is ReorderPlacementV1 {
  return value === 'front' || value === 'forward' || value === 'backward' || value === 'back';
}

function isAlignment(value: unknown): value is AlignmentV1 {
  return (
    value === 'left' ||
    value === 'center' ||
    value === 'right' ||
    value === 'top' ||
    value === 'middle' ||
    value === 'bottom'
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRenderProfile(value: unknown): value is RenderProfileV1 {
  if (!isRecord(value) || value.version !== 1) {
    return false;
  }
  if (value.kind === 'clean') {
    return hasOnlyKeys(value, ['kind', 'version']);
  }
  return (
    value.kind === 'sketch' &&
    hasOnlyKeys(value, ['kind', 'version', 'seed', 'roughness', 'bowing', 'fillStyle']) &&
    isUint32(value.seed) &&
    isNonNegativeFiniteNumber(value.roughness) &&
    isNonNegativeFiniteNumber(value.bowing) &&
    (value.fillStyle === 'solid' || value.fillStyle === 'hachure')
  );
}

function isUint32(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= 0xffff_ffff;
}

function renderProfilesEqual(first: RenderProfileV1, second: RenderProfileV1): boolean {
  if (first.kind !== second.kind) {
    return false;
  }
  if (first.kind === 'clean' && second.kind === 'clean') {
    return true;
  }
  return (
    first.kind === 'sketch' &&
    second.kind === 'sketch' &&
    first.seed === second.seed &&
    first.roughness === second.roughness &&
    first.bowing === second.bowing &&
    first.fillStyle === second.fillStyle
  );
}
