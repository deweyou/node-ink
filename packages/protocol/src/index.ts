export const protocolVersion = 1 as const;
export const schemaVersion = 1 as const;

export interface NodeInkDocumentV1 {
  schemaVersion: 1;
  documentId: string;
  revision: number;
  rootOrder: string[];
  elements: Record<string, ElementRecordV1>;
}

export type ElementRecordV1 = RectElementV1;

export interface RectElementV1 {
  kind: 'rect';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  | { type: 'move_elements'; elementIds: string[]; delta: Vec2 };

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

export type SceneNodeV1 = SceneRectV1;

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

export interface EnginePortV1 {
  currentUpdate(): Promise<EngineUpdateV1>;
  executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1>;
  handlePointerEvents(
    events: NormalizedPointerEventV1[],
    commandId: string,
  ): Promise<PointerUpdateV1>;
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

export interface RendererV1 {
  mount(target: HTMLElement): void;
  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1;
  unmount(): void;
}

export type RenderApplyResultV1 =
  | { ok: true; sceneRevision: number }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
