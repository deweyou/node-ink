import {
  protocolVersion,
  type CommandEnvelopeV1,
  type EnginePortV1,
  type EngineUpdateV1,
  type NormalizedPointerEventV1,
  type PointerUpdateV1,
  type RectElementV1,
  type RendererV1,
  type RenderApplyResultV1,
  type SceneSnapshotV1,
  type StrokeInputBatchV1,
  type StrokeTransportV1,
  type StrokeUpdateV1,
} from '@nodeink-internal/protocol';

import { attachPointerInput } from './pointer-input';

export type EditorActionV1 =
  | {
      type: 'create_rectangle';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | { type: 'move_active'; delta: { x: number; y: number } }
  | { type: 'pointer_events'; events: NormalizedPointerEventV1[] }
  | { type: 'stroke_batch'; batch: StrokeInputBatchV1; transport: StrokeTransportV1 }
  | { type: 'undo' }
  | { type: 'redo' };

export interface EditorUiSnapshotV1 {
  status: 'booting' | 'ready' | 'error' | 'disposed';
  documentRevision: number;
  sceneRevision: number;
  elementCount: number;
  activeElementId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  errorMessage: string | null;
}

export interface EditorActionResultV1 {
  ok: boolean;
  snapshot: EditorUiSnapshotV1;
  pointerMetrics?: Pick<PointerUpdateV1, 'processedEventCount' | 'ignoredEventCount' | 'didCommit'>;
  strokeMetrics?: Pick<StrokeUpdateV1, 'processedPointCount' | 'ignoredPointCount' | 'didCommit'>;
  performance?: EditorActionPerformanceV1;
}

export interface EditorActionPerformanceV1 {
  inputToVisibleMs: number;
  rendererApplyMs: number;
  sceneBytes: number;
  changedNodeCount: number;
}

export interface EditorWebControllerV1 {
  mount(target: HTMLElement): Promise<void>;
  getSnapshot(): EditorUiSnapshotV1;
  subscribe(listener: () => void): () => void;
  dispatch(action: EditorActionV1): Promise<EditorActionResultV1>;
  dispose(): void;
}

export interface EditorWebControllerOptions {
  engine: EnginePortV1;
  renderer: RendererV1;
  createId?: () => string;
}

const initialSnapshot: EditorUiSnapshotV1 = {
  status: 'booting',
  documentRevision: 0,
  sceneRevision: 0,
  elementCount: 0,
  activeElementId: null,
  canUndo: false,
  canRedo: false,
  errorMessage: null,
};

export class EditorWebController implements EditorWebControllerV1 {
  readonly #engine: EnginePortV1;
  readonly #renderer: RendererV1;
  readonly #createId: () => string;
  readonly #listeners = new Set<() => void>();
  #snapshot = initialSnapshot;
  #documentId: string | null = null;
  #detachPointerInput: (() => void) | null = null;
  #queue = Promise.resolve();
  #isDisposed = false;

  constructor(options: EditorWebControllerOptions) {
    this.#engine = options.engine;
    this.#renderer = options.renderer;
    this.#createId = options.createId ?? defaultId;
  }

  async mount(target: HTMLElement): Promise<void> {
    this.ensureActive();
    this.#renderer.mount(target);
    this.#detachPointerInput?.();
    this.#detachPointerInput = attachPointerInput(target, (events) => {
      void this.dispatch({ type: 'pointer_events', events });
    });
    try {
      this.applyUpdate(await this.#engine.currentUpdate());
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  getSnapshot(): EditorUiSnapshotV1 {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(action: EditorActionV1): Promise<EditorActionResultV1> {
    const operation = this.#queue.then(() => this.runAction(action));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#detachPointerInput?.();
    this.#detachPointerInput = null;
    this.#listeners.clear();
    this.#renderer.unmount();
    this.#engine.dispose();
    this.#snapshot = { ...this.#snapshot, status: 'disposed' };
  }

  private async runAction(action: EditorActionV1): Promise<EditorActionResultV1> {
    this.ensureActive();
    const startedAt = performance.now();
    try {
      const execution = await this.executeAction(action);
      const renderResult = this.applyUpdate(execution.update);
      return {
        ok: true,
        snapshot: this.#snapshot,
        ...(execution.pointerMetrics ? { pointerMetrics: execution.pointerMetrics } : {}),
        ...(execution.strokeMetrics ? { strokeMetrics: execution.strokeMetrics } : {}),
        performance: {
          inputToVisibleMs: performance.now() - startedAt,
          rendererApplyMs: renderResult.durationMs ?? 0,
          sceneBytes: new TextEncoder().encode(JSON.stringify(execution.update.scene)).byteLength,
          changedNodeCount: renderResult.changedNodeCount ?? 0,
        },
      };
    } catch (error) {
      this.setError(error);
      return { ok: false, snapshot: this.#snapshot };
    }
  }

  private async executeAction(action: EditorActionV1): Promise<ActionExecutionResult> {
    if (action.type === 'undo') {
      return { update: await this.#engine.undo() };
    }
    if (action.type === 'redo') {
      return { update: await this.#engine.redo() };
    }
    if (!this.#documentId) {
      throw new Error('Editor must be mounted before dispatching document actions');
    }

    const commandId = this.#createId();
    if (action.type === 'pointer_events') {
      const pointerUpdate = await this.#engine.handlePointerEvents(action.events, commandId);
      return {
        update: pointerUpdate.update,
        pointerMetrics: {
          processedEventCount: pointerUpdate.processedEventCount,
          ignoredEventCount: pointerUpdate.ignoredEventCount,
          didCommit: pointerUpdate.didCommit,
        },
      };
    }
    if (action.type === 'stroke_batch') {
      const strokeUpdate = await this.#engine.handleStrokeBatch(
        action.batch,
        commandId,
        action.transport,
      );
      return {
        update: strokeUpdate.update,
        strokeMetrics: {
          processedPointCount: strokeUpdate.processedPointCount,
          ignoredPointCount: strokeUpdate.ignoredPointCount,
          didCommit: strokeUpdate.didCommit,
        },
      };
    }
    const envelope: CommandEnvelopeV1 = {
      protocolVersion,
      commandId,
      documentId: this.#documentId,
      expectedRevision: this.#snapshot.documentRevision,
      command:
        action.type === 'create_rectangle'
          ? {
              type: 'create_rectangle',
              rectangle: createRectangle(action.elementId ?? this.#createId(), action.position),
            }
          : {
              type: 'move_elements',
              elementIds: [this.requireActiveElement()],
              delta: action.delta,
            },
    };
    return { update: await this.#engine.executeCommand(envelope) };
  }

  private applyUpdate(update: EngineUpdateV1): Extract<RenderApplyResultV1, { ok: true }> {
    const renderResult = this.#renderer.applySnapshot(update.scene);
    if (!renderResult.ok) {
      throw new Error(`Renderer rejected scene: ${renderResult.reason}`);
    }
    this.#documentId = update.scene.documentId;
    const activeElementId = chooseActiveElement(
      update.scene,
      update.operation?.changedElementIds.at(-1) ?? this.#snapshot.activeElementId,
    );
    this.#snapshot = {
      status: 'ready',
      documentRevision: update.scene.documentRevision,
      sceneRevision: update.scene.sceneRevision,
      elementCount: update.scene.rootNodeIds.length,
      activeElementId,
      canUndo: update.history.canUndo,
      canRedo: update.history.canRedo,
      errorMessage: null,
    };
    this.emit();
    return renderResult;
  }

  private setError(error: unknown): void {
    this.#snapshot = {
      ...this.#snapshot,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    this.emit();
  }

  private requireActiveElement(): string {
    if (!this.#snapshot.activeElementId) {
      throw new Error('Create a rectangle before moving it');
    }
    return this.#snapshot.activeElementId;
  }

  private ensureActive(): void {
    if (this.#isDisposed) {
      throw new Error('NodeInk editor has been disposed');
    }
  }

  private emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

interface ActionExecutionResult {
  update: EngineUpdateV1;
  pointerMetrics?: Pick<PointerUpdateV1, 'processedEventCount' | 'ignoredEventCount' | 'didCommit'>;
  strokeMetrics?: Pick<StrokeUpdateV1, 'processedPointCount' | 'ignoredPointCount' | 'didCommit'>;
}

export { runPointerBenchmark } from './pointer-benchmark';
export type { PointerBenchmarkOptions, PointerBenchmarkResult } from './pointer-benchmark';
export { runStrokeBenchmark } from './stroke-benchmark';
export type {
  StrokeBenchmarkCaseV1,
  StrokeBenchmarkOptionsV1,
  StrokeBenchmarkReportV1,
  StrokeBenchmarkVariantResultV1,
} from './stroke-benchmark';
export { attachImeComposition } from './ime-input';
export type { ImeCompositionBindingV1, ImeCompositionStateV1 } from './ime-input';
export { CanvasTextMetricsAdapter } from './text-metrics';
export type { CanvasTextMetricsAdapterOptions, TextMeasureBatchResultV1 } from './text-metrics';

function createRectangle(
  id: string,
  position: { x: number; y: number } | undefined,
): RectElementV1 {
  return {
    kind: 'rect',
    id,
    x: position?.x ?? 80,
    y: position?.y ?? 72,
    width: 176,
    height: 104,
  };
}

function chooseActiveElement(
  scene: SceneSnapshotV1,
  preferredElementId: string | null,
): string | null {
  if (
    preferredElementId &&
    Object.values(scene.nodes).some((node) => node.sourceElementId === preferredElementId)
  ) {
    return preferredElementId;
  }
  const lastNodeId = scene.rootNodeIds.at(-1);
  return lastNodeId ? (scene.nodes[lastNodeId]?.sourceElementId ?? null) : null;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}
