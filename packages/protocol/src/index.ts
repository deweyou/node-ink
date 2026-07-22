export const protocolVersion = 1 as const;
export const schemaVersion = 1 as const;

export interface NodeInkDocumentV1 {
  schemaVersion: 1;
  documentId: string;
  revision: number;
  rootOrder: string[];
  elements: Record<string, ElementRecordV1>;
}

export type ElementRecordV1 = RectElementV1 | StrokeElementV1;

export interface RectElementV1 {
  kind: 'rect';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StrokeElementV1 {
  kind: 'stroke';
  id: string;
  points: Vec2[];
  strokeWidth: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface CommandEnvelopeV1 {
  protocolVersion: 1;
  commandId: string;
  documentId: string;
  expectedRevision: number;
  command: CommandV1;
}

export type CommandV1 =
  | { type: 'create_rectangle'; rectangle: RectElementV1 }
  | { type: 'move_elements'; elementIds: string[]; delta: Vec2 }
  | { type: 'create_stroke'; stroke: StrokeElementV1 }
  | { type: 'update_rectangle'; elementId: string; patch: RectanglePatchV1 }
  | { type: 'delete_elements'; elementIds: string[] };

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

export interface EngineUpdateV1 {
  operation: OperationResultV1 | null;
  scene: SceneSnapshotV1;
  history: HistoryStateV1;
}

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
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}

export interface ScenePathV1 {
  kind: 'path';
  id: string;
  sourceElementId: string;
  pathData: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SceneTextV1 {
  kind: 'text';
  id: string;
  sourceElementId: string;
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
  executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1>;
  executeDiagramOperation(batch: DiagramOperationBatchV1): Promise<DiagramOperationBatchResultV1>;
  handlePointerEvents(
    events: NormalizedPointerEventV1[],
    commandId: string,
  ): Promise<PointerUpdateV1>;
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
  targetElementId: string | null;
}

export interface PointerUpdateV1 {
  update: EngineUpdateV1;
  processedEventCount: number;
  ignoredEventCount: number;
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
  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1;
  applyPatch(patch: ScenePatchV1): RenderApplyResultV1;
  unmount(): void;
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
    rootOrder: [],
    elements: {},
  };
}

export function parseEngineUpdate(value: string): EngineUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.scene) || !isRecord(parsed.history)) {
    throw new Error('Engine returned an invalid update payload');
  }
  if (
    parsed.scene.protocolVersion !== protocolVersion ||
    typeof parsed.scene.documentRevision !== 'number' ||
    typeof parsed.scene.sceneRevision !== 'number' ||
    !Array.isArray(parsed.scene.rootNodeIds) ||
    !isRecord(parsed.scene.nodes) ||
    typeof parsed.history.canUndo !== 'boolean' ||
    typeof parsed.history.canRedo !== 'boolean'
  ) {
    throw new Error('Engine update does not satisfy protocol V1');
  }
  return parsed as unknown as EngineUpdateV1;
}

export function parseSceneSnapshot(value: string): SceneSnapshotV1 {
  const parsed: unknown = JSON.parse(value);
  return parseEngineUpdate(
    JSON.stringify({
      operation: null,
      scene: parsed,
      history: { canUndo: false, canRedo: false },
    }),
  ).scene;
}

export function parseScenePatch(value: string): ScenePatchV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    parsed.protocolVersion !== protocolVersion ||
    typeof parsed.documentRevision !== 'number' ||
    typeof parsed.baseSceneRevision !== 'number' ||
    typeof parsed.sceneRevision !== 'number' ||
    !isRecord(parsed.addedNodes) ||
    !isRecord(parsed.updatedNodes) ||
    !Array.isArray(parsed.removedNodeIds) ||
    (parsed.rootNodeIds !== null && !Array.isArray(parsed.rootNodeIds))
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
    typeof parsed.previousRevision !== 'number' ||
    (parsed.revision !== null && typeof parsed.revision !== 'number') ||
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
    typeof parsed.processedEventCount !== 'number' ||
    typeof parsed.ignoredEventCount !== 'number' ||
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

export function parseStrokeUpdate(value: string): StrokeUpdateV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.update) ||
    typeof parsed.processedPointCount !== 'number' ||
    typeof parsed.ignoredPointCount !== 'number' ||
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

export function parseSceneResolution(value: string): SceneResolutionV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.engineAlgorithmVersion !== 'string' ||
    typeof parsed.canonicalHash !== 'string' ||
    !isRecord(parsed.renderProfile) ||
    !isRecord(parsed.scene)
  ) {
    throw new Error('Engine returned an invalid scene resolution payload');
  }
  return {
    engineAlgorithmVersion: parsed.engineAlgorithmVersion,
    canonicalHash: parsed.canonicalHash,
    renderProfile: parsed.renderProfile as unknown as RenderProfileV1,
    scene: parseEngineUpdate(
      JSON.stringify({
        operation: null,
        scene: parsed.scene,
        history: { canUndo: false, canRedo: false },
      }),
    ).scene,
  };
}

export function parseTextFixtureResolution(value: string): TextFixtureResolutionV1 {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    (parsed.request !== null && !isRecord(parsed.request)) ||
    (parsed.scene !== null && !isRecord(parsed.scene)) ||
    (parsed.canonicalHash !== null && typeof parsed.canonicalHash !== 'string')
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
      typeof parsed.result.sourceSchemaVersion === 'number' &&
      typeof parsed.result.targetSchemaVersion === 'number' &&
      typeof parsed.result.migrated === 'boolean' &&
      isRecord(parsed.result.document) &&
      typeof parsed.result.canonicalPayload === 'string'
    ) {
      return parsed as unknown as MigrationAttemptV1;
    }
  } else if (parsed.result === null && isRecord(parsed.report)) {
    if (
      typeof parsed.report.stage === 'string' &&
      typeof parsed.report.code === 'string' &&
      (parsed.report.sourceSchemaVersion === null ||
        typeof parsed.report.sourceSchemaVersion === 'number') &&
      typeof parsed.report.targetSchemaVersion === 'number' &&
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
