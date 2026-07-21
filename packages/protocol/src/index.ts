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
  | { type: 'create_stroke'; stroke: StrokeElementV1 };

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

export interface SceneSnapshotV1 {
  protocolVersion: 1;
  documentId: string;
  documentRevision: number;
  sceneRevision: number;
  rootNodeIds: string[];
  nodes: Record<string, SceneNodeV1>;
}

export type SceneNodeV1 = SceneRectV1 | ScenePathV1;

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

export interface EnginePortV1 {
  currentUpdate(): Promise<EngineUpdateV1>;
  executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1>;
  handlePointerEvents(
    events: NormalizedPointerEventV1[],
    commandId: string,
  ): Promise<PointerUpdateV1>;
  handleStrokeBatch(
    batch: StrokeInputBatchV1,
    commandId: string,
    transport: StrokeTransportV1,
  ): Promise<StrokeUpdateV1>;
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
  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1;
  unmount(): void;
}

export type RenderApplyResultV1 =
  | {
      ok: true;
      sceneRevision: number;
      durationMs?: number;
      changedNodeCount?: number;
    }
  | { ok: false; reason: 'unsupported_scene' };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
