// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  EditorActionResultV1,
  EditorActionV1,
  EditorUiSnapshotV1,
  EditorWebControllerV1,
} from '@nodeink-internal/editor-web';

describe('Vanilla playground selection actions', () => {
  it('renders Phase 1B selection state and dispatches every public selection action', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(null, '', '/vanilla.html');
    const controller = new StubController();
    vi.doMock('./create-controller', () => ({
      createController: vi.fn(async () => controller),
    }));
    vi.doMock('./benchmark-api', () => benchmarkApiMock());

    await import('./vanilla');

    const root = requireElement<HTMLElement>(document, '#root');
    expect(root.querySelector('.nodeink-kicker')?.textContent).toBe('NodeInk · Phase 1B');
    expect(root.querySelector('[aria-label="Rendering profile"]')).toBeNull();
    expect(root.querySelector('[data-status]')?.textContent).toContain('No selection');
    expect(actionButton(root, 'copy').disabled).toBe(true);
    expect(actionButton(root, 'paste').disabled).toBe(false);
    expect(actionButton(root, 'group').disabled).toBe(true);
    expect(optionButton(root, 'reorder', 'placement', 'front').disabled).toBe(true);
    expect(optionButton(root, 'align', 'alignment', 'left').disabled).toBe(true);

    controller.setSnapshot({
      ...controller.getSnapshot(),
      activeElementId: 'rect-1',
      selectedElementIds: ['rect-1'],
      primaryElementId: 'rect-1',
    });
    expect(root.querySelector('[data-status]')?.textContent).toContain('1 selected');
    expect(actionButton(root, 'copy').disabled).toBe(false);
    expect(actionButton(root, 'ungroup').disabled).toBe(false);
    expect(optionButton(root, 'reorder', 'placement', 'front').disabled).toBe(false);
    expect(actionButton(root, 'group').disabled).toBe(true);
    expect(optionButton(root, 'align', 'alignment', 'left').disabled).toBe(true);

    controller.setSnapshot({
      ...controller.getSnapshot(),
      selectedElementIds: ['rect-1', 'rect-2'],
      primaryElementId: 'rect-2',
      activeElementId: 'rect-2',
    });
    expect(root.querySelector('[data-status]')?.textContent).toContain('2 selected');
    expect(actionButton(root, 'group').disabled).toBe(false);
    expect(optionButton(root, 'align', 'alignment', 'left').disabled).toBe(false);

    root
      .querySelectorAll<HTMLButtonElement>('.nodeink-selection-actions button')
      .forEach((button) => button.click());
    expect(controller.actions).toEqual([
      { type: 'copy' },
      { type: 'cut' },
      { type: 'paste' },
      { type: 'group' },
      { type: 'ungroup' },
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

    controller.setSnapshot({ ...controller.getSnapshot(), documentAccess: 'readonly' });
    expect(
      [...root.querySelectorAll<HTMLButtonElement>('.nodeink-selection-actions button')].every(
        (button) => button.disabled,
      ),
    ).toBe(true);

    controller.setSnapshot({
      ...controller.getSnapshot(),
      readonlyReason: 'held_elsewhere',
      takeoverAvailable: true,
    });
    actionButton(root, 'request_takeover').click();
    expect(controller.actions.at(-1)).toEqual({ type: 'request_takeover' });
  });
});

class StubController implements EditorWebControllerV1 {
  readonly actions: EditorActionV1[] = [];
  #snapshot = snapshotFixture();
  #listener: (() => void) | null = null;

  async mount(): Promise<void> {}

  getSnapshot(): EditorUiSnapshotV1 {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listener = listener;
    return () => {
      this.#listener = null;
    };
  }

  async dispatch(action: EditorActionV1): Promise<EditorActionResultV1> {
    this.actions.push(action);
    return { ok: true, snapshot: this.#snapshot };
  }

  async relinquishDocument(): Promise<void> {}

  setSnapshot(snapshot: EditorUiSnapshotV1): void {
    this.#snapshot = snapshot;
    this.#listener?.();
  }

  dispose(): void {}
}

function snapshotFixture(): EditorUiSnapshotV1 {
  return {
    status: 'ready',
    documentRevision: 0,
    sceneRevision: 0,
    elementCount: 2,
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
}

function actionButton(root: ParentNode, action: string): HTMLButtonElement {
  return requireElement(root, `[data-action="${action}"]`);
}

function optionButton(
  root: ParentNode,
  action: string,
  option: string,
  value: string,
): HTMLButtonElement {
  return requireElement(root, `[data-action="${action}"][data-${option}="${value}"]`);
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing test element: ${selector}`);
  }
  return element;
}

function benchmarkApiMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    exposePointerBenchmark: vi.fn(),
    runPlaygroundPointerBenchmark: vi.fn(),
    runPlaygroundPersistenceBenchmark: vi.fn(),
    runPlaygroundMigrationBenchmark: vi.fn(),
    runPlaygroundLifecycleBenchmark: vi.fn(),
    runPlaygroundOperationBenchmark: vi.fn(),
    releasePlaygroundLeaseBenchmark: vi.fn(),
    runPlaygroundLeaseBenchmark: vi.fn(),
    runPlaygroundSketchBenchmark: vi.fn(),
    runPlaygroundScenePatchBenchmark: vi.fn(),
    runPlaygroundSvgScaleBenchmark: vi.fn(),
    runPlaygroundStrokeBenchmark: vi.fn(),
    runPlaygroundTextBenchmark: vi.fn(),
  };
}
