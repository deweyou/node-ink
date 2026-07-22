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
  let root: Root | null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
  });

  it('mounts the shared controller and dispatches every visible action', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);

    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    expect(target.querySelector('[data-nodeink-host="react"]')).not.toBeNull();
    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('React adapter');
    expect(controller.mountTarget?.className).toBe('nodeink-canvas');
    expect(button(target, 'Select').ariaPressed).toBe('true');
    expect(button(target, 'Draw').ariaPressed).toBe('false');
    expect(button(target, 'Text').ariaPressed).toBe('false');
    expect(button(target, 'Rectangle').disabled).toBe(false);
    expect(button(target, 'Move').disabled).toBe(true);
    expect(button(target, 'Delete').disabled).toBe(true);
    expect(button(target, 'Clean').ariaPressed).toBe('true');
    expect(button(target, 'Sketch').ariaPressed).toBe('false');
    expect(button(target, '100%').title).toBe('回正并适应全部内容');
    expect(button(target, '100%').ariaLabel).toBe('回正并适应全部内容，当前 100%');

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        canUndo: true,
        canRedo: true,
        errorMessage: 'recoverable engine error',
      });
    });
    for (const label of [
      'Select',
      'Draw',
      'Text',
      'Rectangle',
      'Move',
      'Delete',
      'Undo',
      'Redo',
      '−',
      '100%',
      '+',
    ]) {
      await act(async () => button(target, label).click());
    }

    expect(controller.actions.map((action) => action.type)).toEqual([
      'set_tool',
      'set_tool',
      'set_tool',
      'create_rectangle',
      'move_active',
      'delete_selection',
      'undo',
      'redo',
      'zoom_out',
      'reset_camera',
      'zoom_in',
    ]);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      'recoverable engine error',
    );
  });

  it('dispatches rendering profiles and contextual selection styles', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);
    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    expect(target.querySelector('[aria-label="Selection style"]')).toBeNull();
    await act(async () => button(target, 'Sketch').click());
    expect(controller.actions.at(-1)).toEqual({
      type: 'set_render_profile',
      profile: 'sketch',
    });

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        renderProfile: {
          kind: 'sketch',
          version: 1,
          seed: 1_313_817_669,
          roughness: 1.2,
          bowing: 0.8,
          fillStyle: 'hachure',
        },
        selectionStyle: {
          kind: 'rect',
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      });
    });

    expect(button(target, 'Clean').ariaPressed).toBe('false');
    expect(button(target, 'Sketch').ariaPressed).toBe('true');
    expect(target.querySelector('[aria-label="Selection style"]')).not.toBeNull();
    expect(labelledButton(target, 'Fill Mint').ariaPressed).toBe('true');
    expect(labelledButton(target, 'Fill Blue').ariaPressed).toBe('false');
    expect(labelledButton(target, 'Stroke Emerald').ariaPressed).toBe('true');
    expect(button(target, '2px').ariaPressed).toBe('true');

    await act(async () => labelledButton(target, 'Fill Blue').click());
    await act(async () => labelledButton(target, 'Stroke Blue').click());
    await act(async () => button(target, '4px').click());
    expect(controller.actions.slice(-3)).toEqual([
      {
        type: 'update_selection_style',
        patch: { kind: 'rect', fill: { kind: 'solid', color: '#dbeafe' } },
      },
      {
        type: 'update_selection_style',
        patch: { kind: 'rect', stroke: '#2563eb' },
      },
      {
        type: 'update_selection_style',
        patch: { kind: 'rect', strokeWidth: 4 },
      },
    ]);

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'text-1',
        selectionStyle: {
          kind: 'text',
          color: '#2563eb',
          fontSize: 24,
          fontWeight: 400,
          textAlign: 'center',
        },
      });
    });

    expect(labelledButton(target, 'Color Blue').ariaPressed).toBe('true');
    expect(button(target, '24').ariaPressed).toBe('true');
    expect(button(target, 'Center').ariaPressed).toBe('true');
    await act(async () => button(target, 'Right').click());
    expect(controller.actions.at(-1)).toEqual({
      type: 'update_selection_style',
      patch: { kind: 'text', textAlign: 'end' },
    });
  });

  it('uses a custom host label and absorbs mount rejection', async () => {
    const controller = new StubController(new Error('mount rejected'));
    target = document.createElement('div');
    root = createRoot(target);

    await act(async () =>
      root?.render(<NodeInkEditor controller={controller} hostLabel="Embedded React" />),
    );

    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('Embedded React');
    expect(controller.disposeCalls).toBe(0);
  });

  it('renders shared save failures, retry actions, and readonly recovery notices', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);
    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        saveStatus: 'save_failed',
        saveErrorMessage: 'quota exceeded',
      });
    });
    expect(target.querySelector('[data-save-status="save_failed"]')?.textContent).toBe('保存失败');
    await act(async () => button(target, '重试').click());
    expect(controller.actions.at(-1)).toEqual({ type: 'retry_save' });

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        saveStatus: 'saved',
        saveErrorMessage: null,
        cameraSaveStatus: 'save_failed',
        cameraSaveErrorMessage: 'camera quota exceeded',
      });
    });
    await act(async () => button(target, '重试').click());
    expect(controller.actions.at(-1)).toEqual({ type: 'retry_camera_save' });

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        saveStatus: 'readonly',
        saveErrorMessage: null,
        cameraSaveStatus: 'saved',
        cameraSaveErrorMessage: null,
        documentAccess: 'readonly',
        readonlyReason: 'recovered_fallback',
        recovery: 'stable_fallback',
      });
    });
    expect(target.querySelector('[role="status"]')?.textContent).toContain('上次稳定版本');
    expect(button(target, 'Rectangle').disabled).toBe(true);
    expect(button(target, 'Select').disabled).toBe(true);
    expect(button(target, 'Draw').disabled).toBe(true);
    expect(button(target, 'Text').disabled).toBe(true);
    expect(button(target, '100%').disabled).toBe(false);
  });

  it('unsubscribes the shared store and disposes the controller once on unmount', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);
    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    expect(controller.listenerCount).toBe(1);
    await act(async () => root?.unmount());
    root = null;

    expect(controller.listenerCount).toBe(0);
    expect(controller.disposeCalls).toBe(1);
  });
});

class StubController implements EditorWebControllerV1 {
  readonly actions: EditorActionV1[] = [];
  readonly #listeners = new Set<() => void>();
  readonly #mountError: Error | null;
  mountTarget: HTMLElement | null = null;
  disposeCalls = 0;
  get listenerCount(): number {
    return this.#listeners.size;
  }
  #snapshot: EditorUiSnapshotV1 = {
    status: 'booting',
    documentRevision: 0,
    sceneRevision: 0,
    elementCount: 0,
    activeElementId: null,
    activeTool: 'select',
    selectionBounds: null,
    selectionStyle: null,
    renderProfile: { kind: 'clean', version: 1 },
    canUndo: false,
    canRedo: false,
    errorMessage: null,
    saveStatus: 'saved',
    saveErrorMessage: null,
    documentAccess: 'writer',
    readonlyReason: null,
    recovery: 'blank',
    camera: { x: 0, y: 0, zoom: 1 },
    cameraZoomPercent: 100,
    cameraSaveStatus: 'saved',
    cameraSaveErrorMessage: null,
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

function labelledButton(target: HTMLElement, label: string): HTMLButtonElement {
  const match = [...target.querySelectorAll('button')].find(
    (candidate) => candidate.ariaLabel === label,
  );
  if (!match) {
    throw new Error(`button labelled ${label} was not rendered`);
  }
  return match;
}
