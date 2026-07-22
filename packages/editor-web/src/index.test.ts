import { describe, expect, it, vi } from 'vitest';

import type {
  CommandEnvelopeV1,
  EnginePortV1,
  EngineUpdateV1,
  NormalizedPointerEventV1,
  PointerUpdateV1,
  RendererV1,
  RenderProfileV1,
  SceneResolutionV1,
  SceneSnapshotV1,
  StrokeInputBatchV1,
  StrokeTransportV1,
  StrokeUpdateV1,
  TextFixtureResolutionV1,
  TextMetricsSnapshotV1,
  TextRunV1,
} from '@nodeink-internal/protocol';

import { EditorWebController } from './index';

describe('EditorWebController', () => {
  it('dispatches commands through the engine and updates the renderer', async () => {
    const engine = new StubEngine();
    const renderer = new StubRenderer();
    const ids = ['command-1', 'rect-1', 'command-2'];
    const controller = new EditorWebController({
      engine,
      renderer,
      createId: () => ids.shift() ?? 'fallback',
    });

    await controller.mount(document.createElement('div'));
    await controller.dispatch({ type: 'create_rectangle' });
    await controller.dispatch({ type: 'move_active', delta: { x: 24, y: 0 } });

    expect(engine.commands.map((command) => command.command.type)).toEqual([
      'create_rectangle',
      'move_elements',
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      documentRevision: 2,
      activeElementId: 'rect-1',
      canUndo: true,
    });
    expect(renderer.snapshots.at(-1)?.documentRevision).toBe(2);
  });

  it('supports explicit geometry, history, subscriptions, and idempotent disposal', async () => {
    const engine = new StubEngine();
    const renderer = new StubRenderer();
    const listener = vi.fn();
    const controller = new EditorWebController({
      engine,
      renderer,
      createId: () => 'command-1',
    });
    const unsubscribe = controller.subscribe(listener);

    await controller.mount(document.createElement('div'));
    await controller.dispatch({
      type: 'create_rectangle',
      elementId: 'rect-explicit',
      position: { x: 12, y: 18 },
    });
    await controller.dispatch({ type: 'undo' });
    await controller.dispatch({ type: 'redo' });
    const pointer = await controller.dispatch({
      type: 'pointer_events',
      events: [pointerEvent('down', 1)],
    });
    const stroke = await controller.dispatch({
      type: 'stroke_batch',
      transport: 'typed_array',
      batch: {
        pointerId: 2,
        sequenceStart: 1,
        phase: 'move',
        points: [{ x: 4, y: 8 }],
        strokeId: null,
      },
    });

    expect(engine.commands[0]).toMatchObject({
      commandId: 'command-1',
      command: {
        type: 'create_rectangle',
        rectangle: { id: 'rect-explicit', x: 12, y: 18 },
      },
    });
    expect(engine.undoCalls).toBe(1);
    expect(engine.redoCalls).toBe(1);
    expect(pointer.pointerMetrics).toEqual({
      processedEventCount: 1,
      ignoredEventCount: 0,
      didCommit: false,
    });
    expect(stroke.strokeMetrics).toEqual({
      processedPointCount: 1,
      ignoredPointCount: 0,
      didCommit: false,
    });
    expect(stroke.performance).toMatchObject({
      rendererApplyMs: 0,
      changedNodeCount: 0,
    });
    expect(stroke.performance?.sceneBytes).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(6);

    unsubscribe();
    controller.dispose();
    controller.dispose();
    expect(engine.disposeCalls).toBe(1);
    expect(renderer.unmountCalls).toBe(1);
    expect(controller.getSnapshot().status).toBe('disposed');
    await expect(controller.dispatch({ type: 'undo' })).rejects.toThrow('disposed');
  });

  it('reports document-action and selection errors without rejecting dispatch', async () => {
    const engine = new StubEngine();
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: () => 'command-1',
    });

    const beforeMount = await controller.dispatch({ type: 'create_rectangle' });
    expect(beforeMount).toMatchObject({
      ok: false,
      snapshot: {
        status: 'error',
        errorMessage: 'Editor must be mounted before dispatching document actions',
      },
    });

    await controller.mount(document.createElement('div'));
    const withoutSelection = await controller.dispatch({
      type: 'move_active',
      delta: { x: 1, y: 1 },
    });
    expect(withoutSelection).toMatchObject({
      ok: false,
      snapshot: { status: 'error', errorMessage: 'Create a rectangle before moving it' },
    });

    engine.executeError = 'engine rejected command';
    const engineFailure = await controller.dispatch({ type: 'create_rectangle' });
    expect(engineFailure).toMatchObject({
      ok: false,
      snapshot: { errorMessage: 'engine rejected command' },
    });
  });

  it('surfaces mount and renderer failures', async () => {
    const failedEngine = new StubEngine();
    failedEngine.currentError = new Error('engine failed to boot');
    const failedMount = new EditorWebController({
      engine: failedEngine,
      renderer: new StubRenderer(),
    });

    await expect(failedMount.mount(document.createElement('div'))).rejects.toThrow(
      'engine failed to boot',
    );
    expect(failedMount.getSnapshot()).toMatchObject({
      status: 'error',
      errorMessage: 'engine failed to boot',
    });

    const rejectedRenderer = new StubRenderer();
    rejectedRenderer.shouldReject = true;
    const rejectedScene = new EditorWebController({
      engine: new StubEngine(),
      renderer: rejectedRenderer,
    });
    await expect(rejectedScene.mount(document.createElement('div'))).rejects.toThrow(
      'Renderer rejected scene',
    );
  });

  it('selects the last rendered element when no operation preference exists', async () => {
    const controller = new EditorWebController({
      engine: new StubEngine('existing-rect'),
      renderer: new StubRenderer(),
    });

    await controller.mount(document.createElement('div'));

    expect(controller.getSnapshot().activeElementId).toBe('existing-rect');
  });
});

class StubEngine implements EnginePortV1 {
  readonly commands: CommandEnvelopeV1[] = [];
  currentError: unknown = null;
  executeError: unknown = null;
  undoCalls = 0;
  redoCalls = 0;
  disposeCalls = 0;
  #revision = 0;
  #rectangleId: string | null;

  constructor(rectangleId: string | null = null) {
    this.#rectangleId = rectangleId;
  }

  async currentUpdate(): Promise<EngineUpdateV1> {
    if (this.currentError) {
      throw this.currentError;
    }
    return this.update();
  }

  async executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1> {
    if (this.executeError) {
      throw this.executeError;
    }
    this.commands.push(command);
    this.#revision += 1;
    if (command.command.type === 'create_rectangle') {
      this.#rectangleId = command.command.rectangle.id;
    }
    return this.update([this.#rectangleId ?? 'rect-1']);
  }

  async handlePointerEvents(
    events: NormalizedPointerEventV1[],
    _commandId: string,
  ): Promise<PointerUpdateV1> {
    return {
      update: this.update(),
      processedEventCount: events.length,
      ignoredEventCount: 0,
      didCommit: false,
    };
  }

  async handleStrokeBatch(
    batch: StrokeInputBatchV1,
    _commandId: string,
    _transport: StrokeTransportV1,
  ): Promise<StrokeUpdateV1> {
    return {
      update: this.update(),
      processedPointCount: batch.points.length,
      ignoredPointCount: 0,
      didCommit: false,
    };
  }

  async resolveSceneProfile(profile: RenderProfileV1): Promise<SceneResolutionV1> {
    return {
      engineAlgorithmVersion: 'nodeink-scene-v1',
      renderProfile: profile,
      canonicalHash: 'fnv1a64:test',
      scene: this.update().scene,
    };
  }

  async resolveTextFixture(
    requestId: string,
    fontFingerprint: string,
    runs: TextRunV1[],
    _metrics: TextMetricsSnapshotV1 | null,
  ): Promise<TextFixtureResolutionV1> {
    return {
      request: { requestId, fontFingerprint, runs },
      scene: null,
      canonicalHash: null,
    };
  }

  async undo(): Promise<EngineUpdateV1> {
    this.undoCalls += 1;
    return this.update();
  }

  async redo(): Promise<EngineUpdateV1> {
    this.redoCalls += 1;
    return this.update();
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  private update(changedElementIds: string[] = []): EngineUpdateV1 {
    const scene = stubScene(this.#revision, this.#rectangleId);
    return {
      operation: changedElementIds.length
        ? {
            commandId: `command-${this.#revision}`,
            previousRevision: this.#revision - 1,
            revision: this.#revision,
            changedElementIds,
            sceneRevision: this.#revision,
          }
        : null,
      scene,
      history: { canUndo: this.#revision > 0, canRedo: false },
    };
  }
}

class StubRenderer implements RendererV1 {
  readonly snapshots: SceneSnapshotV1[] = [];
  shouldReject = false;
  unmountCalls = 0;

  mount(): void {}

  applySnapshot(snapshot: SceneSnapshotV1) {
    if (this.shouldReject) {
      return { ok: false as const, reason: 'unsupported_scene' as const };
    }
    this.snapshots.push(snapshot);
    return { ok: true as const, sceneRevision: snapshot.sceneRevision };
  }

  unmount(): void {
    this.unmountCalls += 1;
  }
}

function stubScene(revision: number, rectangleId: string | null): SceneSnapshotV1 {
  const sceneNodeId = rectangleId ? `${rectangleId}:shape` : null;
  const nodes =
    sceneNodeId && rectangleId
      ? {
          [sceneNodeId]: {
            kind: 'rect' as const,
            id: sceneNodeId,
            sourceElementId: rectangleId,
            x: 80,
            y: 72,
            width: 176,
            height: 104,
            fill: '#d1fae5',
            stroke: '#047857',
          },
        }
      : {};
  return {
    protocolVersion: 1,
    documentId: 'doc-1',
    documentRevision: revision,
    sceneRevision: revision,
    rootNodeIds: sceneNodeId ? [sceneNodeId] : [],
    nodes,
  };
}

function pointerEvent(
  phase: NormalizedPointerEventV1['phase'],
  sequence: number,
): NormalizedPointerEventV1 {
  return {
    pointerId: 1,
    sequence,
    phase,
    point: { x: 10, y: 20 },
    targetElementId: phase === 'down' ? 'rect-1' : null,
  };
}
