import {
  protocolVersion,
  type CommandEnvelopeV1,
  type EnginePortV1,
  type EngineUpdateV1,
  type RectElementV1,
  type RendererV1,
  type SceneSnapshotV1,
} from '@nodeink-internal/protocol';

export type EditorActionV1 =
  | {
      type: 'create_rectangle';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | { type: 'move_active'; delta: { x: number; y: number } }
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
    this.#listeners.clear();
    this.#renderer.unmount();
    this.#engine.dispose();
    this.#snapshot = { ...this.#snapshot, status: 'disposed' };
  }

  private async runAction(action: EditorActionV1): Promise<EditorActionResultV1> {
    this.ensureActive();
    try {
      const update = await this.executeAction(action);
      this.applyUpdate(update);
      return { ok: true, snapshot: this.#snapshot };
    } catch (error) {
      this.setError(error);
      return { ok: false, snapshot: this.#snapshot };
    }
  }

  private async executeAction(action: EditorActionV1): Promise<EngineUpdateV1> {
    if (action.type === 'undo') {
      return this.#engine.undo();
    }
    if (action.type === 'redo') {
      return this.#engine.redo();
    }
    if (!this.#documentId) {
      throw new Error('Editor must be mounted before dispatching document actions');
    }

    const commandId = this.#createId();
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
    return this.#engine.executeCommand(envelope);
  }

  private applyUpdate(update: EngineUpdateV1): void {
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
