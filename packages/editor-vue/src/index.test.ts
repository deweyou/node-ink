import { createApp, defineComponent, h, nextTick, shallowRef, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  EditorActionResultV1,
  EditorActionV1,
  EditorUiSnapshotV1,
  EditorWebControllerV1,
} from '@nodeink-internal/editor-web';

import { NodeInkEditor } from './index';

describe('NodeInkEditor', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
  });

  it('mounts the shared controller and dispatches every visible action', async () => {
    const controller = new StubController();
    const target = document.createElement('div');

    app = createApp(NodeInkEditor, { controller });
    app.mount(target);
    await nextTick();

    expect(target.querySelector('[data-nodeink-host="vue"]')).not.toBeNull();
    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('Vue adapter');
    expect(controller.mountTarget?.className).toBe('nodeink-canvas');
    expect(button(target, 'Rectangle').disabled).toBe(false);
    expect(button(target, 'Move').disabled).toBe(true);
    expect(button(target, 'Delete').disabled).toBe(true);
    expect(button(target, '100%').title).toBe('回正并适应全部内容');
    expect(button(target, '100%').ariaLabel).toBe('回正并适应全部内容，当前 100%');

    controller.setSnapshot({
      ...controller.getSnapshot(),
      activeElementId: 'rect-1',
      canUndo: true,
      canRedo: true,
      errorMessage: 'recoverable engine error',
    });
    await nextTick();

    for (const label of ['Rectangle', 'Move', 'Delete', 'Undo', 'Redo', '−', '100%', '+']) {
      button(target, label).click();
    }

    expect(controller.actions.map((action) => action.type)).toEqual([
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

  it('uses a custom host label and absorbs mount rejection', async () => {
    const controller = new StubController(new Error('mount rejected'));
    const target = document.createElement('div');

    app = createApp(NodeInkEditor, { controller, hostLabel: 'Embedded Vue' });
    app.mount(target);
    await nextTick();

    expect(target.querySelector('.nodeink-host-badge')?.textContent).toBe('Embedded Vue');
    expect(controller.disposeCalls).toBe(0);
  });

  it('renders shared save failures, retry actions, and readonly recovery notices', async () => {
    const controller = new StubController();
    const target = document.createElement('div');
    app = createApp(NodeInkEditor, { controller });
    app.mount(target);
    await nextTick();

    controller.setSnapshot({
      ...controller.getSnapshot(),
      saveStatus: 'save_failed',
      saveErrorMessage: 'quota exceeded',
    });
    await nextTick();
    expect(target.querySelector('[data-save-status="save_failed"]')?.textContent).toBe('保存失败');
    button(target, '重试').click();
    expect(controller.actions.at(-1)).toEqual({ type: 'retry_save' });

    controller.setSnapshot({
      ...controller.getSnapshot(),
      saveStatus: 'saved',
      saveErrorMessage: null,
      cameraSaveStatus: 'save_failed',
      cameraSaveErrorMessage: 'camera quota exceeded',
    });
    await nextTick();
    button(target, '重试').click();
    expect(controller.actions.at(-1)).toEqual({ type: 'retry_camera_save' });

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
    await nextTick();
    expect(target.querySelector('[role="status"]')?.textContent).toContain('上次稳定版本');
    expect(button(target, 'Rectangle').disabled).toBe(true);
    expect(button(target, '100%').disabled).toBe(false);
  });

  it('unsubscribes and disposes the controller once on unmount', async () => {
    const controller = new StubController();
    const target = document.createElement('div');
    app = createApp(NodeInkEditor, { controller });
    app.mount(target);
    await nextTick();

    expect(controller.listenerCount).toBe(1);
    app.unmount();
    app = null;

    expect(controller.listenerCount).toBe(0);
    expect(controller.disposeCalls).toBe(1);
  });

  it('moves lifecycle ownership when the controller prop changes', async () => {
    const firstController = new StubController();
    const secondController = new StubController();
    const activeController = shallowRef<EditorWebControllerV1>(firstController);
    const target = document.createElement('div');
    const Host = defineComponent(
      () => () => h(NodeInkEditor, { controller: activeController.value }),
    );

    app = createApp(Host);
    app.mount(target);
    await nextTick();

    activeController.value = secondController;
    await nextTick();

    expect(firstController.listenerCount).toBe(0);
    expect(firstController.disposeCalls).toBe(1);
    expect(secondController.listenerCount).toBe(1);
    expect(secondController.mountTarget?.className).toBe('nodeink-canvas');
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
    selectionBounds: null,
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
