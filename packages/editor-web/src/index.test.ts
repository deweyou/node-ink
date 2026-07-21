import { describe, expect, it } from 'vitest';

import type {
  CommandEnvelopeV1,
  EnginePortV1,
  EngineUpdateV1,
  RendererV1,
  SceneSnapshotV1,
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
});

class StubEngine implements EnginePortV1 {
  readonly commands: CommandEnvelopeV1[] = [];
  #revision = 0;
  #rectangleId: string | null = null;

  async currentUpdate(): Promise<EngineUpdateV1> {
    return this.update();
  }

  async executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1> {
    this.commands.push(command);
    this.#revision += 1;
    if (command.command.type === 'create_rectangle') {
      this.#rectangleId = command.command.rectangle.id;
    }
    return this.update([this.#rectangleId ?? 'rect-1']);
  }

  async undo(): Promise<EngineUpdateV1> {
    return this.update();
  }

  async redo(): Promise<EngineUpdateV1> {
    return this.update();
  }

  dispose(): void {}

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

  mount(): void {}

  applySnapshot(snapshot: SceneSnapshotV1) {
    this.snapshots.push(snapshot);
    return { ok: true as const, sceneRevision: snapshot.sceneRevision };
  }

  unmount(): void {}
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
