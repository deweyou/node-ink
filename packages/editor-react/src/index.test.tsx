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
    expect(button(target, 'Ellipse').disabled).toBe(false);
    expect(button(target, 'Diamond').disabled).toBe(false);
    expect(button(target, 'Line').disabled).toBe(false);
    expect(button(target, 'Polyline').disabled).toBe(false);
    expect(button(target, 'Arrow').disabled).toBe(false);
    expect(button(target, 'Move').disabled).toBe(true);
    expect(button(target, 'Delete').disabled).toBe(true);
    expect(target.querySelector('[aria-label="Rendering profile"]')).toBeNull();
    expect(button(target, '100%').title).toBe('回正并适应全部内容');
    expect(button(target, '100%').ariaLabel).toBe('回正并适应全部内容，当前 100%');

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        selectedElementIds: ['rect-1'],
        primaryElementId: 'rect-1',
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
      'Ellipse',
      'Diamond',
      'Line',
      'Polyline',
      'Arrow',
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
      'set_tool',
      'set_tool',
      'set_tool',
      'set_tool',
      'set_tool',
      'set_tool',
      'move_active',
      'delete_selection',
      'undo',
      'redo',
      'zoom_out',
      'reset_camera',
      'zoom_in',
    ]);
    expect(controller.actions.slice(3, 9)).toEqual([
      { type: 'set_tool', tool: 'rectangle' },
      { type: 'set_tool', tool: 'ellipse' },
      { type: 'set_tool', tool: 'diamond' },
      { type: 'set_tool', tool: 'line' },
      { type: 'set_tool', tool: 'polyline' },
      { type: 'set_tool', tool: 'arrow' },
    ]);
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      'recoverable engine error',
    );
  });

  it('renders and dispatches Phase 1B selection actions with shared availability rules', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);
    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    const actions = selectionActions(target);
    expect(target.querySelector('.nodeink-kicker')?.textContent).toBe('NodeInk · Phase 1B');
    expect(target.querySelector('.nodeink-status')?.textContent).toContain('No selection');
    expect(button(actions, 'Copy').disabled).toBe(true);
    expect(button(actions, 'Cut').disabled).toBe(true);
    expect(button(actions, 'Paste').disabled).toBe(false);
    expect(button(actions, 'Group').disabled).toBe(true);
    expect(button(actions, 'Ungroup').disabled).toBe(true);
    expect(button(actions, 'Front').disabled).toBe(true);
    expect(button(actions, 'Left').disabled).toBe(true);

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        selectedElementIds: ['rect-1'],
        primaryElementId: 'rect-1',
      });
    });
    expect(target.querySelector('.nodeink-status')?.textContent).toContain('1 selected');
    expect(button(actions, 'Copy').disabled).toBe(false);
    expect(button(actions, 'Ungroup').disabled).toBe(false);
    expect(button(actions, 'Front').disabled).toBe(false);
    expect(button(actions, 'Group').disabled).toBe(true);
    expect(button(actions, 'Left').disabled).toBe(true);

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-2',
        selectedElementIds: ['rect-1', 'rect-2'],
        primaryElementId: 'rect-2',
      });
    });
    expect(target.querySelector('.nodeink-status')?.textContent).toContain('2 selected');
    expect(button(actions, 'Group').disabled).toBe(false);
    expect(button(actions, 'Left').disabled).toBe(false);

    for (const label of [
      'Group',
      'Ungroup',
      'Copy',
      'Cut',
      'Paste',
      'Front',
      'Forward',
      'Backward',
      'Back',
      'Left',
      'Center',
      'Right',
      'Top',
      'Middle',
      'Bottom',
    ]) {
      await act(async () => button(actions, label).click());
    }

    expect(controller.actions).toEqual([
      { type: 'group' },
      { type: 'ungroup' },
      { type: 'copy' },
      { type: 'cut' },
      { type: 'paste' },
      { type: 'reorder', placement: 'front' },
      { type: 'reorder', placement: 'forward' },
      { type: 'reorder', placement: 'backward' },
      { type: 'reorder', placement: 'back' },
      { type: 'align', alignment: 'left' },
      { type: 'align', alignment: 'center' },
      { type: 'align', alignment: 'right' },
      { type: 'align', alignment: 'top' },
      { type: 'align', alignment: 'middle' },
      { type: 'align', alignment: 'bottom' },
    ]);

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        documentAccess: 'readonly',
      });
    });
    for (const action of actions.querySelectorAll('button')) {
      expect(action.disabled).toBe(true);
    }
  });

  it('dispatches contextual selection styles without exposing experimental profiles', async () => {
    const controller = new StubController();
    target = document.createElement('div');
    root = createRoot(target);
    await act(async () => root?.render(<NodeInkEditor controller={controller} />));

    expect(target.querySelector('[aria-label="Selection style"]')).toBeNull();
    expect(target.querySelector('[aria-label="Rendering profile"]')).toBeNull();

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'rect-1',
        selectionStyle: {
          kind: 'rect',
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      });
    });

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
        activeElementId: 'ellipse-1',
        selectionStyle: {
          kind: 'ellipse',
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      });
    });
    expect(target.querySelector('.nodeink-style-title')?.textContent).toContain('Ellipse');
    await act(async () => labelledButton(target, 'Fill Blue').click());
    expect(controller.actions.at(-1)).toEqual({
      type: 'update_selection_style',
      patch: { kind: 'ellipse', fill: { kind: 'solid', color: '#dbeafe' } },
    });

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        activeElementId: 'arrow-1',
        selectionStyle: {
          kind: 'arrow',
          stroke: '#0f172a',
          strokeWidth: 2,
        },
      });
    });
    expect(target.querySelector('.nodeink-style-title')?.textContent).toContain('Arrow');
    await act(async () => labelledButton(target, 'Color Blue').click());
    expect(controller.actions.at(-1)).toEqual({
      type: 'update_selection_style',
      patch: { kind: 'arrow', stroke: '#2563eb' },
    });

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
    expect(styleButton(target, '24').ariaPressed).toBe('true');
    expect(styleButton(target, 'Center').ariaPressed).toBe('true');
    await act(async () => styleButton(target, 'Right').click());
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

    await act(async () => {
      controller.setSnapshot({
        ...controller.getSnapshot(),
        readonlyReason: 'held_elsewhere',
        recovery: 'head',
        takeoverAvailable: true,
      });
    });
    await act(async () => button(target, '接管编辑权').click());
    expect(controller.actions.at(-1)).toEqual({ type: 'request_takeover' });
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
    selectedElementIds: [],
    primaryElementId: null,
    activeTool: 'select',
    selectionBounds: null,
    selectionOrientedBounds: null,
    selectionHandles: [],
    selectionMarquee: null,
    alignmentGuides: [],
    selectionStyle: null,
    renderProfile: { kind: 'clean', version: 1 },
    canUndo: false,
    canRedo: false,
    errorMessage: null,
    saveStatus: 'saved',
    saveErrorMessage: null,
    documentAccess: 'writer',
    readonlyReason: null,
    takeoverAvailable: false,
    takeoverStatus: 'idle',
    takeoverErrorMessage: null,
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

  async relinquishDocument(): Promise<void> {}

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

function selectionActions(target: HTMLElement): HTMLElement {
  const actions = target.querySelector<HTMLElement>('[aria-label="Selection actions"]');
  if (!actions) {
    throw new Error('selection actions were not rendered');
  }
  return actions;
}

function styleButton(target: HTMLElement, label: string): HTMLButtonElement {
  const panel = target.querySelector<HTMLElement>('[aria-label="Selection style"]');
  if (!panel) {
    throw new Error('selection style was not rendered');
  }
  return button(panel, label);
}
