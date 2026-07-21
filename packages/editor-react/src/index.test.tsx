import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type {
  EditorActionResultV1,
  EditorActionV1,
  EditorUiSnapshotV1,
  EditorWebControllerV1,
} from '@nodeink-internal/editor-web';

import { NodeInkEditor } from './index';

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe('NodeInkEditor', () => {
  let target: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
  });

  it('mounts the shared controller and dispatches every visible action', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);

    await act(async () => root.render(<NodeInkEditor controller={controller} />));

    expect(target.querySelector('[data-nodeink-host="react"]')).not.toBeNull();
    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('React adapter');
    expect(controller.mountTarget?.className).toBe('nodeink-canvas');
    expect(button(target, 'Rectangle').disabled).toBe(false);
    expect(button(target, 'Move').disabled).toBe(true);

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        canUndo: true,
        canRedo: true,
        errorMessage: 'recoverable engine error',
      });
    });
    for (const label of ['Rectangle', 'Move', 'Undo', 'Redo']) {
      await act(async () => button(target, label).click());
    }

    expect(controller.actions.map((action) => action.type)).toEqual([
      'create_rectangle',
      'move_active',
      'undo',
      'redo',
    ]);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      'recoverable engine error',
    );
  });

  it('uses a custom host label and absorbs mount rejection', async () => {
    const controller = new StubController(new Error('mount rejected'));
    target = document.createElement('div');
    root = createRoot(target);

    await act(async () =>
      root.render(<NodeInkEditor controller={controller} hostLabel="Embedded React" />),
    );

    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('Embedded React');
    expect(controller.disposeCalls).toBe(0);
  });
});

class StubController implements EditorWebControllerV1 {
  readonly actions: EditorActionV1[] = [];
  readonly #listeners = new Set<() => void>();
  readonly #mountError: Error | null;
  mountTarget: HTMLElement | null = null;
  disposeCalls = 0;
  #snapshot: EditorUiSnapshotV1 = {
    status: 'booting',
    documentRevision: 0,
    sceneRevision: 0,
    elementCount: 0,
    activeElementId: null,
    canUndo: false,
    canRedo: false,
    errorMessage: null,
  };

  constructor(mountError: Error | null = null) {
    this.#mountError = mountError;
  }

  async mount(target: HTMLElement): Promise<void> {
    this.mountTarget = target;
    if (this.#mountError) {
      throw this.#mountError;
    }
    this.setSnapshot({ ...this.#snapshot, status: 'ready' });
  }

  getSnapshot(): EditorUiSnapshotV1 {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispatch(action: EditorActionV1): Promise<EditorActionResultV1> {
    this.actions.push(action);
    return { ok: true, snapshot: this.#snapshot };
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  setSnapshot(snapshot: EditorUiSnapshotV1): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const match = [...target.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) {
    throw new Error(`button ${label} was not rendered`);
  }
  return match;
}
