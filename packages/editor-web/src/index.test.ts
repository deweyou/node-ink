import { describe, expect, it, vi } from 'vitest';

import type {
  CameraActionV1,
  CameraV1,
  CommandEnvelopeV1,
  DiagramOperationBatchResultV1,
  DiagramOperationBatchV1,
  EnginePortV1,
  EngineUpdateV1,
  EditorOverlayV1,
  NormalizedPointerEventV1,
  PointerUpdateV1,
  RendererV1,
  RenderProfileV1,
  SelectionStyleV1,
  SceneBenchmarkPayloadV1,
  ScenePatchV1,
  SceneResolutionV1,
  SceneSnapshotV1,
  StrokeInputBatchV1,
  StrokeTransportV1,
  StrokeUpdateV1,
  TextElementV1,
  TextMeasureRequestV1,
  TextFixtureResolutionV1,
  TextMetricsSnapshotV1,
  TextRunV1,
} from '@nodeink-internal/protocol';

import { EditorWebController, getEditorCameraPresentation } from './index';
import type {
  EditorCameraPersistencePortV1,
  EditorPersistencePortV1,
  EditorPersistenceSnapshotV1,
} from './index';

describe('EditorWebController', () => {
  it('restores Camera per document and maps it to the renderer viewport', async () => {
    const engine = new StubEngine();
    const renderer = new StubRenderer();
    const cameraPersistence = new StubCameraPersistence({ x: 10, y: 20, zoom: 2 });
    const controller = new EditorWebController({ engine, renderer, cameraPersistence });
    const target = document.createElement('div');
    target.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 600, left: 0, top: 0 }) as DOMRect,
    );

    await controller.mount(target);

    expect(engine.setCameras).toEqual([{ x: 10, y: 20, zoom: 2 }]);
    expect(renderer.viewports.at(-1)).toEqual({ x: 10, y: 20, width: 400, height: 300 });
    expect(controller.getSnapshot()).toMatchObject({
      camera: { x: 10, y: 20, zoom: 2 },
      cameraZoomPercent: 200,
      cameraSaveStatus: 'saved',
      documentRevision: 0,
    });
  });

  it('updates and persists Camera without changing Document revision or history', async () => {
    vi.useFakeTimers();
    try {
      const engine = new StubEngine();
      const renderer = new StubRenderer();
      const cameraPersistence = new StubCameraPersistence();
      const controller = new EditorWebController({ engine, renderer, cameraPersistence });
      const target = document.createElement('div');
      target.getBoundingClientRect = vi.fn(
        () => ({ width: 960, height: 640, left: 0, top: 0 }) as DOMRect,
      );
      await controller.mount(target);

      const result = await controller.dispatch({
        type: 'camera_action',
        action: { type: 'pan_by', delta: { x: 48, y: 32 } },
      });

      expect(result).toMatchObject({
        ok: true,
        snapshot: {
          documentRevision: 0,
          canUndo: false,
          canRedo: false,
          camera: { x: -48, y: -32, zoom: 1 },
          cameraSaveStatus: 'dirty',
        },
      });
      expect(renderer.viewports.at(-1)).toEqual({
        x: -48,
        y: -32,
        width: 960,
        height: 640,
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(cameraPersistence.saved).toEqual([
        { documentId: 'doc-1', camera: { x: -48, y: -32, zoom: 1 } },
      ]);
      expect(controller.getSnapshot().cameraSaveStatus).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows Camera navigation in readonly mode while rejecting Document commands', async () => {
    const controller = new EditorWebController({
      engine: new StubEngine(),
      renderer: new StubRenderer(),
      documentAccess: 'readonly',
      readonlyReason: 'held_elsewhere',
    });
    await controller.mount(document.createElement('div'));

    await expect(
      controller.dispatch({
        type: 'camera_action',
        action: { type: 'pan_by', delta: { x: 12, y: 8 } },
      }),
    ).resolves.toMatchObject({ ok: true, snapshot: { camera: { x: -12, y: -8 } } });
    await expect(controller.dispatch({ type: 'create_rectangle' })).resolves.toMatchObject({
      ok: false,
      snapshot: { documentRevision: 0 },
    });
  });

  it('routes zoom controls through Rust Camera actions around the viewport center', async () => {
    const engine = new StubEngine();
    const controller = new EditorWebController({ engine, renderer: new StubRenderer() });
    const target = document.createElement('div');
    target.getBoundingClientRect = vi.fn(
      () => ({ width: 800, height: 600, left: 0, top: 0 }) as DOMRect,
    );
    await controller.mount(target);

    await controller.dispatch({ type: 'zoom_in' });
    await controller.dispatch({ type: 'zoom_out' });
    await controller.dispatch({ type: 'reset_camera' });

    expect(engine.cameraActions).toEqual([
      { type: 'zoom_at', factor: 1.5, anchor: { x: 400, y: 300 } },
      { type: 'zoom_at', factor: 1 / 1.5, anchor: { x: 400, y: 300 } },
      {
        type: 'fit_content',
        viewport: { width: 800, height: 600 },
        padding: 64,
      },
    ]);
  });

  it('treats fit content as 100% without moving Camera when document bounds change', async () => {
    const engine = new StubEngine();
    engine.fitCameraResult = { x: 75, y: 25, zoom: 2 };
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: () => 'rect-1',
    });
    const target = document.createElement('div');
    target.getBoundingClientRect = vi.fn(
      () => ({ width: 500, height: 300, left: 0, top: 0 }) as DOMRect,
    );
    await controller.mount(target);

    expect(controller.getSnapshot()).toMatchObject({
      camera: { x: 75, y: 25, zoom: 2 },
      cameraZoomPercent: 100,
    });
    await controller.dispatch({ type: 'zoom_in' });
    expect(controller.getSnapshot()).toMatchObject({
      camera: { zoom: 3 },
      cameraZoomPercent: 150,
    });

    engine.fitCameraResult = { x: -100, y: -80, zoom: 1 };
    await controller.dispatch({ type: 'create_rectangle', elementId: 'rect-1' });
    expect(controller.getSnapshot()).toMatchObject({
      camera: { zoom: 3 },
      cameraZoomPercent: 300,
    });

    await controller.dispatch({ type: 'reset_camera' });
    expect(controller.getSnapshot()).toMatchObject({
      camera: { x: -100, y: -80, zoom: 1 },
      cameraZoomPercent: 100,
    });
    expect(getEditorCameraPresentation(controller.getSnapshot())).toEqual({
      zoomLabel: '100%',
      fitContentTitle: '回正并适应全部内容',
      fitContentAriaLabel: '回正并适应全部内容，当前 100%',
    });
    expect(engine.fitCameraCalls.at(-1)).toEqual({
      viewport: { width: 500, height: 300 },
      padding: 64,
    });
  });

  it('keeps the editor usable when Camera restore or Camera actions fail', async () => {
    const engine = new StubEngine();
    const cameraPersistence = new StubCameraPersistence();
    cameraPersistence.loadError = 'camera read unavailable';
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      cameraPersistence,
    });

    await controller.mount(document.createElement('div'));
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      cameraSaveStatus: 'save_failed',
      cameraSaveErrorMessage: 'camera read unavailable',
    });

    engine.cameraError = new Error('camera action unavailable');
    await expect(controller.dispatch({ type: 'reset_camera' })).resolves.toMatchObject({
      ok: false,
      snapshot: { status: 'error', errorMessage: 'camera action unavailable' },
    });
  });

  it('surfaces Camera persistence failures and retries the pending view state', async () => {
    vi.useFakeTimers();
    try {
      const cameraPersistence = new StubCameraPersistence();
      cameraPersistence.saveError = new Error('camera storage unavailable');
      const controller = new EditorWebController({
        engine: new StubEngine(),
        renderer: new StubRenderer(),
        cameraPersistence,
      });
      await controller.mount(document.createElement('div'));
      await controller.dispatch({
        type: 'camera_action',
        action: { type: 'pan_by', delta: { x: 16, y: 8 } },
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(controller.getSnapshot()).toMatchObject({
        cameraSaveStatus: 'save_failed',
        cameraSaveErrorMessage: 'camera storage unavailable',
      });

      cameraPersistence.saveError = null;
      await expect(controller.dispatch({ type: 'retry_camera_save' })).resolves.toMatchObject({
        ok: true,
        snapshot: { cameraSaveStatus: 'saved', cameraSaveErrorMessage: null },
      });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('commits rectangle style and Render Profile changes as one revision each', async () => {
    const engine = new StubEngine();
    const persistence = new StubPersistence();
    const ids = ['create-command', 'rect-1', 'style-command', 'profile-command'];
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      persistence,
      createId: () => ids.shift() ?? 'fallback',
    });
    await controller.mount(document.createElement('div'));

    await controller.dispatch({ type: 'create_rectangle' });
    const styled = await controller.dispatch({
      type: 'update_selection_style',
      patch: { kind: 'rect', fill: { kind: 'solid', color: '#dbeafe' } },
    });
    const profiled = await controller.dispatch({ type: 'set_render_profile', profile: 'sketch' });

    expect(styled.snapshot).toMatchObject({
      documentRevision: 2,
      sceneRevision: 2,
      selectionStyle: {
        kind: 'rect',
        fill: { kind: 'solid', color: '#dbeafe' },
      },
    });
    expect(profiled.snapshot).toMatchObject({
      documentRevision: 3,
      sceneRevision: 3,
      renderProfile: {
        kind: 'sketch',
        version: 1,
        seed: 1_313_817_669,
        fillStyle: 'hachure',
      },
    });
    expect(engine.commands.slice(1).map((command) => command.command)).toEqual([
      {
        type: 'update_element_style',
        elementId: 'rect-1',
        patch: { kind: 'rect', fill: { kind: 'solid', color: '#dbeafe' } },
      },
      {
        type: 'set_render_profile',
        renderProfile: {
          kind: 'sketch',
          version: 1,
          seed: 1_313_817_669,
          roughness: 1.2,
          bowing: 0.8,
          fillStyle: 'hachure',
        },
      },
    ]);
    expect(persistence.committedRevisions).toEqual([1, 2, 3]);
  });

  it('keeps Document revision stable for same-value style and profile commands', async () => {
    const engine = new StubEngine();
    const persistence = new StubPersistence();
    const ids = ['create-command', 'rect-1', 'style-command', 'profile-command'];
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      persistence,
      createId: () => ids.shift() ?? 'fallback',
    });
    await controller.mount(document.createElement('div'));
    await controller.dispatch({ type: 'create_rectangle' });

    const styled = await controller.dispatch({
      type: 'update_selection_style',
      patch: { kind: 'rect', fill: { kind: 'solid', color: '#d1fae5' } },
    });
    const profiled = await controller.dispatch({ type: 'set_render_profile', profile: 'clean' });

    expect(styled.snapshot).toMatchObject({ documentRevision: 1, sceneRevision: 1 });
    expect(profiled.snapshot).toMatchObject({ documentRevision: 1, sceneRevision: 1 });
    expect(persistence.committedRevisions).toEqual([1]);
  });

  it('commits text font size once and resolves metrics with a scene-only revision', async () => {
    const engine = new StubEngine();
    engine.textEditElement = textElement('text-1', 'NodeInk');
    const persistence = new StubPersistence();
    const measure = vi.fn((request: TextMeasureRequestV1) => ({
      snapshot: {
        fontFingerprint: request.fontFingerprint,
        metrics: request.runs.map((run) => ({
          key: run.key,
          width: 160,
          height: 40,
          baseline: 28,
          lineBreaks: [],
        })),
      },
    }));
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      persistence,
      textMetrics: { fingerprint: () => 'font-ready-v1', measure },
      createId: () => 'style-command',
    });
    await controller.mount(document.createElement('div'));
    await controller.dispatch({ type: 'begin_text_edit', point: { x: 40, y: 52 } });
    await controller.dispatch({ type: 'cancel_text_edit' });

    const result = await controller.dispatch({
      type: 'update_selection_style',
      patch: { kind: 'text', fontSize: 32 },
    });

    expect(engine.commands).toHaveLength(1);
    expect(engine.commands[0]?.command).toEqual({
      type: 'update_element_style',
      elementId: 'text-1',
      patch: { kind: 'text', fontSize: 32 },
    });
    expect(measure).toHaveBeenCalledOnce();
    expect(measure.mock.calls[0]?.[0].runs[0]?.fontSize).toBe(32);
    expect(engine.providedTextMetrics).toHaveLength(1);
    expect(result.snapshot).toMatchObject({
      documentRevision: 1,
      sceneRevision: 2,
      selectionStyle: { kind: 'text', fontSize: 32 },
    });
    expect(persistence.committedRevisions).toEqual([1]);
  });

  it('clears and deletes the Rust-owned selection through shared editor actions', async () => {
    const engine = new StubEngine();
    const renderer = new StubRenderer();
    const controller = new EditorWebController({
      engine,
      renderer,
      createId: (() => {
        const ids = ['create-command', 'rect-1', 'delete-command'];
        return () => ids.shift() ?? 'fallback';
      })(),
    });
    await controller.mount(document.createElement('div'));

    await controller.dispatch({ type: 'create_rectangle' });
    expect(controller.getSnapshot()).toMatchObject({
      activeElementId: 'rect-1',
      selectionBounds: { x: 80, y: 72, width: 176, height: 104 },
    });
    expect(renderer.overlays.at(-1)).toEqual({
      selectionBounds: { x: 80, y: 72, width: 176, height: 104 },
      selectionPaddingWorld: 6,
    });

    await controller.dispatch({ type: 'zoom_in' });
    expect(renderer.overlays.at(-1)).toEqual({
      selectionBounds: { x: 80, y: 72, width: 176, height: 104 },
      selectionPaddingWorld: 4,
    });

    const cleared = await controller.dispatch({ type: 'clear_selection' });
    expect(cleared.snapshot).toMatchObject({
      documentRevision: 1,
      activeElementId: null,
      selectionBounds: null,
    });

    await engine.setSelection('rect-1');
    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('down', 1)] });
    const deleted = await controller.dispatch({ type: 'delete_selection' });
    expect(deleted.snapshot).toMatchObject({
      documentRevision: 2,
      elementCount: 0,
      activeElementId: null,
      selectionBounds: null,
    });
    expect(engine.commands.at(-1)?.command).toEqual({
      type: 'delete_elements',
      elementIds: ['rect-1'],
    });
  });

  it('routes canvas input through the Rust-owned active tool and returns to Select for shapes', async () => {
    const engine = new StubEngine();
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: (() => {
        const ids = [
          'tool-command',
          'stroke-1',
          'move-command',
          'up-command',
          'rect-command',
          'rect-1',
        ];
        return () => ids.shift() ?? 'fallback';
      })(),
    });
    const target = document.createElement('div');
    await controller.mount(target);

    await controller.dispatch({ type: 'set_tool', tool: 'freehand' });
    expect(controller.getSnapshot()).toMatchObject({
      activeTool: 'freehand',
      activeElementId: null,
    });
    expect(target.dataset.activeTool).toBe('freehand');

    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('down', 1)] });
    await controller.dispatch({
      type: 'pointer_events',
      events: [pointerEvent('move', 2), pointerEvent('move', 3)],
    });
    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('up', 4)] });

    expect(engine.strokeBatches).toMatchObject([
      { phase: 'down', sequenceStart: 1, strokeId: 'stroke-1' },
      {
        phase: 'move',
        sequenceStart: 2,
        strokeId: null,
        points: [
          { x: 10, y: 20 },
          { x: 10, y: 20 },
        ],
      },
      { phase: 'up', sequenceStart: 4, strokeId: null },
    ]);
    expect(engine.pointerBatches).toHaveLength(0);

    await controller.dispatch({ type: 'create_rectangle' });
    expect(controller.getSnapshot().activeTool).toBe('select');
    expect(engine.commands.at(-1)?.command.type).toBe('create_rectangle');
  });

  it('uses Select pointer routing and Escape tool semantics', async () => {
    const engine = new StubEngine('rect-1');
    await engine.setSelection('rect-1');
    const controller = new EditorWebController({ engine, renderer: new StubRenderer() });
    await controller.mount(document.createElement('div'));

    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('down', 1)] });
    expect(engine.pointerBatches).toHaveLength(1);

    await controller.dispatch({ type: 'set_tool', tool: 'freehand' });
    await controller.dispatch({ type: 'escape' });
    expect(controller.getSnapshot().activeTool).toBe('select');
  });

  it('creates fixed-font multiline text after IME composition and measures it without another document commit', async () => {
    const engine = new StubEngine();
    const persistence = new StubPersistence();
    const measure = vi.fn((request: TextMeasureRequestV1) => ({
      snapshot: {
        fontFingerprint: request.fontFingerprint,
        metrics: request.runs.map((run) => ({
          key: run.key,
          width: 144,
          height: 60,
          baseline: 20,
          lineBreaks: [2],
        })),
      },
    }));
    const ids = ['unused-pointer', 'create-command', 'text-1'];
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      persistence,
      textMetrics: { fingerprint: () => 'font-ready-v1', measure },
      createId: () => ids.shift() ?? 'fallback',
    });
    const target = document.createElement('div');
    await controller.mount(target);
    await controller.dispatch({ type: 'set_tool', tool: 'text' });
    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('down', 1)] });
    const input = target.querySelector('textarea');
    expect(input).not.toBeNull();

    input?.dispatchEvent(new CompositionEvent('compositionstart'));
    if (input) {
      input.value = '你好';
    }
    input?.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input?.dispatchEvent(new CompositionEvent('compositionend'));
    expect(engine.commands).toHaveLength(0);

    if (input) {
      input.value = '你好\nNodeInk';
    }
    input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input?.dispatchEvent(new FocusEvent('blur'));
    await vi.waitFor(() => expect(engine.commands).toHaveLength(1));

    expect(engine.commands[0]).toMatchObject({
      commandId: 'create-command',
      expectedRevision: 0,
      command: {
        type: 'create_text',
        text: {
          id: 'text-1',
          text: '你好\nNodeInk',
          fontFamily: 'Noto Sans SC Variable',
          fontSize: 24,
          fontWeight: 400,
          maxWidth: null,
          fontFingerprint: 'font-ready-v1',
        },
      },
    });
    expect(measure).toHaveBeenCalledOnce();
    expect(engine.providedTextMetrics).toHaveLength(1);
    expect(persistence.committedRevisions).toEqual([1]);
    expect(controller.getSnapshot()).toMatchObject({
      documentRevision: 1,
      sceneRevision: 2,
      elementCount: 1,
    });
  });

  it('edits existing text on Select double-click and deletes it when cleared', async () => {
    const engine = new StubEngine();
    engine.textEditElement = textElement('text-1', '旧文本');
    const ids = ['update-command', 'delete-command'];
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: () => ids.shift() ?? 'fallback',
    });
    const target = document.createElement('div');
    target.getBoundingClientRect = vi.fn(
      () => ({ width: 400, height: 300, left: 0, top: 0 }) as DOMRect,
    );
    await controller.mount(target);

    target.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 40,
        clientY: 52,
      }),
    );
    const firstInput = await vi.waitFor(() => {
      const candidate = target.querySelector('textarea');
      expect(candidate).not.toBeNull();
      return candidate as HTMLTextAreaElement;
    });
    firstInput.value = '新文本';
    firstInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    firstInput.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(engine.commands).toHaveLength(1));
    expect(engine.commands[0]?.command).toEqual({
      type: 'update_text',
      elementId: 'text-1',
      patch: { text: '新文本' },
    });

    await controller.dispatch({ type: 'begin_text_edit', point: { x: 40, y: 52 } });
    const secondInput = target.querySelector('textarea');
    expect(secondInput).not.toBeNull();
    if (secondInput) {
      secondInput.value = '';
      secondInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      secondInput.dispatchEvent(new FocusEvent('blur'));
    }
    await vi.waitFor(() => expect(engine.commands).toHaveLength(2));
    expect(engine.commands[1]?.command).toEqual({
      type: 'delete_elements',
      elementIds: ['text-1'],
    });
  });

  it('cancels an empty text draft without creating history', async () => {
    const engine = new StubEngine();
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: () => 'unused-pointer',
    });
    const target = document.createElement('div');
    await controller.mount(target);
    await controller.dispatch({ type: 'set_tool', tool: 'text' });
    await controller.dispatch({ type: 'pointer_events', events: [pointerEvent('down', 1)] });

    target.querySelector('textarea')?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(target.querySelector('textarea')).toBeNull();
    expect(engine.commands).toHaveLength(0);
    expect(controller.getSnapshot().documentRevision).toBe(0);
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
      snapshot: { status: 'error', errorMessage: 'Select an element before editing it' },
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

  it('does not infer selection from the last rendered element', async () => {
    const controller = new EditorWebController({
      engine: new StubEngine('existing-rect'),
      renderer: new StubRenderer(),
    });

    await controller.mount(document.createElement('div'));

    expect(controller.getSnapshot().activeElementId).toBeNull();
    expect(controller.getSnapshot().selectionBounds).toBeNull();
  });

  it('pairs pointer listeners across repeated mounts and releases resources once', async () => {
    const engine = new StubEngine();
    const renderer = new StubRenderer();
    const controller = new EditorWebController({ engine, renderer });
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const firstAdd = vi.spyOn(firstTarget, 'addEventListener');
    const firstRemove = vi.spyOn(firstTarget, 'removeEventListener');
    const secondAdd = vi.spyOn(secondTarget, 'addEventListener');
    const secondRemove = vi.spyOn(secondTarget, 'removeEventListener');

    await controller.mount(firstTarget);
    await controller.mount(secondTarget);

    expect(firstAdd.mock.calls.map(([type]) => type)).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'wheel',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'dblclick',
    ]);
    expect(firstRemove.mock.calls.map(([type]) => type)).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'wheel',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'dblclick',
    ]);
    expect(secondAdd).toHaveBeenCalledTimes(11);
    expect(secondRemove).not.toHaveBeenCalled();
    expect(renderer.mountCalls).toBe(2);

    controller.dispose();
    controller.dispose();

    expect(secondRemove.mock.calls.map(([type]) => type)).toEqual([
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'dblclick',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'wheel',
    ]);
    expect(engine.disposeCalls).toBe(1);
    expect(renderer.unmountCalls).toBe(1);
  });

  it('routes available history shortcuts and removes the document listener on dispose', async () => {
    const ownerDocument = document.implementation.createHTMLDocument();
    const target = ownerDocument.createElement('div');
    ownerDocument.body.append(target);
    const engine = new StubEngine();
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      createId: () => 'rect-1',
    });
    await controller.mount(target);
    const unavailableUndo = keyboardEvent({ key: 'z', metaKey: true });

    ownerDocument.dispatchEvent(unavailableUndo);

    expect(unavailableUndo.defaultPrevented).toBe(false);
    expect(engine.undoCalls).toBe(0);

    await controller.dispatch({ type: 'create_rectangle' });
    const undo = keyboardEvent({ key: 'z', metaKey: true });
    ownerDocument.dispatchEvent(undo);
    await vi.waitFor(() => expect(engine.undoCalls).toBe(1));
    expect(undo.defaultPrevented).toBe(true);

    const redo = keyboardEvent({ key: 'z', metaKey: true, shiftKey: true });
    ownerDocument.dispatchEvent(redo);
    await vi.waitFor(() => expect(engine.redoCalls).toBe(1));
    expect(redo.defaultPrevented).toBe(true);

    controller.dispose();
    ownerDocument.dispatchEvent(keyboardEvent({ key: 'z', metaKey: true }));
    await Promise.resolve();
    expect(engine.undoCalls).toBe(1);
  });

  it('marks committed revisions dirty, follows autosave state, and retries failures', async () => {
    const persistence = new StubPersistence();
    const controller = new EditorWebController({
      engine: new StubEngine(),
      renderer: new StubRenderer(),
      persistence,
      createId: () => 'rect-1',
    });

    await controller.mount(document.createElement('div'));
    await controller.dispatch({ type: 'create_rectangle' });

    expect(persistence.committedRevisions).toEqual([1]);
    expect(controller.getSnapshot()).toMatchObject({
      documentAccess: 'writer',
      saveStatus: 'dirty',
      saveErrorMessage: null,
    });

    persistence.setSnapshot({
      status: 'save_failed',
      persistedRevision: 0,
      pendingRevision: 1,
      errorMessage: 'quota exceeded',
    });
    expect(controller.getSnapshot()).toMatchObject({
      saveStatus: 'save_failed',
      saveErrorMessage: 'quota exceeded',
    });

    await controller.dispatch({ type: 'retry_save' });
    expect(persistence.retryCalls).toBe(1);
  });

  it('keeps the engine alive until an in-flight persistence flush completes', async () => {
    const engine = new StubEngine();
    const persistence = new StubPersistence();
    let resolveFlush: () => void = () => undefined;
    persistence.flushPromise = new Promise<void>((resolve) => {
      resolveFlush = resolve;
    });
    const onDispose = vi.fn(async () => undefined);
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      persistence,
      onDispose,
    });

    await controller.mount(document.createElement('div'));
    controller.dispose();

    expect(controller.getSnapshot().status).toBe('disposed');
    expect(engine.disposeCalls).toBe(0);
    expect(persistence.disposeCalls).toBe(0);
    resolveFlush();
    await vi.waitFor(() => expect(engine.disposeCalls).toBe(1));
    expect(persistence.disposeCalls).toBe(1);
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it('keeps recovered fallbacks readonly and rejects document actions', async () => {
    const engine = new StubEngine('existing-rect');
    const controller = new EditorWebController({
      engine,
      renderer: new StubRenderer(),
      documentAccess: 'readonly',
      readonlyReason: 'recovered_fallback',
      recovery: 'stable_fallback',
    });

    await controller.mount(document.createElement('div'));
    const result = await controller.dispatch({ type: 'create_rectangle' });

    expect(result).toMatchObject({
      ok: false,
      snapshot: {
        status: 'ready',
        saveStatus: 'readonly',
        documentAccess: 'readonly',
        readonlyReason: 'recovered_fallback',
        recovery: 'stable_fallback',
      },
    });
    expect(engine.commands).toHaveLength(0);
  });
});

class StubPersistence implements EditorPersistencePortV1 {
  readonly committedRevisions: number[] = [];
  readonly #listeners = new Set<() => void>();
  retryCalls = 0;
  flushCalls = 0;
  disposeCalls = 0;
  flushPromise: Promise<void> | null = null;
  #snapshot: EditorPersistenceSnapshotV1 = {
    status: 'saved',
    persistedRevision: 0,
    pendingRevision: 0,
    errorMessage: null,
  };

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  markCommitted(revision: number): void {
    this.committedRevisions.push(revision);
    this.setSnapshot({
      status: 'dirty',
      persistedRevision: this.#snapshot.persistedRevision,
      pendingRevision: revision,
      errorMessage: null,
    });
  }

  async retry(): Promise<void> {
    this.retryCalls += 1;
  }

  async flush(): Promise<void> {
    this.flushCalls += 1;
    await this.flushPromise;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  setSnapshot(snapshot: {
    status: 'saved' | 'dirty' | 'saving' | 'save_failed';
    persistedRevision: number;
    pendingRevision: number;
    errorMessage: string | null;
  }): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

class StubEngine implements EnginePortV1 {
  readonly commands: CommandEnvelopeV1[] = [];
  readonly pointerBatches: NormalizedPointerEventV1[][] = [];
  readonly strokeBatches: StrokeInputBatchV1[] = [];
  readonly providedTextMetrics: TextMetricsSnapshotV1[] = [];
  textMeasureRequest: TextMeasureRequestV1 | null = null;
  textEditElement: TextElementV1 | null = null;
  currentError: unknown = null;
  executeError: unknown = null;
  undoCalls = 0;
  redoCalls = 0;
  disposeCalls = 0;
  readonly cameraActions: CameraActionV1[] = [];
  readonly setCameras: CameraV1[] = [];
  readonly fitCameraCalls: Array<{
    viewport: { width: number; height: number };
    padding: number;
  }> = [];
  fitCameraResult: CameraV1 = { x: 0, y: 0, zoom: 1 };
  cameraError: Error | null = null;
  #camera: CameraV1 = { x: 0, y: 0, zoom: 1 };
  #revision = 0;
  #sceneRevision = 0;
  #rectangleId: string | null;
  #rectangleStyle: Omit<Extract<SelectionStyleV1, { kind: 'rect' }>, 'kind'> = {
    fill: { kind: 'solid' as const, color: '#d1fae5' },
    stroke: '#047857',
    strokeWidth: 2,
  };
  #renderProfile: RenderProfileV1 = { kind: 'clean', version: 1 };
  #textElement: TextElementV1 | null = null;
  #textMeasured = false;
  #selectedElementId: string | null = null;
  #activeTool: 'select' | 'freehand' | 'text' = 'select';
  #canRedo = false;

  constructor(rectangleId: string | null = null) {
    this.#rectangleId = rectangleId;
  }

  async currentUpdate(): Promise<EngineUpdateV1> {
    if (this.currentError) {
      throw this.currentError;
    }
    return this.update();
  }

  async currentCamera(): Promise<CameraV1> {
    return this.#camera;
  }

  async setCamera(camera: CameraV1): Promise<CameraV1> {
    this.setCameras.push(camera);
    this.#camera = camera;
    return camera;
  }

  async fitCamera(viewport: { width: number; height: number }, padding: number): Promise<CameraV1> {
    this.fitCameraCalls.push({ viewport, padding });
    return this.fitCameraResult;
  }

  async applyCameraAction(action: CameraActionV1): Promise<CameraV1> {
    if (this.cameraError) {
      throw this.cameraError;
    }
    this.cameraActions.push(action);
    if (action.type === 'fit_content') {
      this.#camera = this.fitCameraResult;
    } else if (action.type === 'pan_by') {
      this.#camera = {
        ...this.#camera,
        x: this.#camera.x - action.delta.x / this.#camera.zoom,
        y: this.#camera.y - action.delta.y / this.#camera.zoom,
      };
    } else if (action.type === 'zoom_at') {
      const zoom = this.#camera.zoom * action.factor;
      const anchorWorldX = this.#camera.x + action.anchor.x / this.#camera.zoom;
      const anchorWorldY = this.#camera.y + action.anchor.y / this.#camera.zoom;
      this.#camera = {
        x: anchorWorldX - action.anchor.x / zoom,
        y: anchorWorldY - action.anchor.y / zoom,
        zoom,
      };
    }
    return this.#camera;
  }

  async executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1> {
    if (this.executeError) {
      throw this.executeError;
    }
    this.commands.push(command);
    let changedElementIds: string[] = [];
    let didChange = false;
    if (command.command.type === 'create_rectangle') {
      this.#rectangleId = command.command.rectangle.id;
      this.#selectedElementId = this.#rectangleId;
      this.#rectangleStyle = {
        fill: command.command.rectangle.fill,
        stroke: command.command.rectangle.stroke,
        strokeWidth: command.command.rectangle.strokeWidth,
      };
      changedElementIds = [command.command.rectangle.id];
      didChange = true;
    } else if (command.command.type === 'create_text') {
      this.#textElement = command.command.text;
      this.textEditElement = command.command.text;
      this.#selectedElementId = command.command.text.id;
      this.requestTextMeasurement(command.command.text);
      changedElementIds = [command.command.text.id];
      didChange = true;
    } else if (command.command.type === 'update_text') {
      const current = this.textEditElement;
      if (current && current.id === command.command.elementId) {
        const updated = { ...current, ...command.command.patch };
        if (!sameValue(current, updated)) {
          this.#textElement = updated;
          this.textEditElement = updated;
          this.#selectedElementId = updated.id;
          this.requestTextMeasurement(updated);
          changedElementIds = [updated.id];
          didChange = true;
        }
      }
    } else if (command.command.type === 'move_elements') {
      this.#selectedElementId = command.command.elementIds[0] ?? this.#selectedElementId;
      changedElementIds = [...command.command.elementIds];
      didChange = command.command.elementIds.length > 0;
    } else if (command.command.type === 'update_element_style') {
      if (
        command.command.elementId === this.#rectangleId &&
        command.command.patch.kind === 'rect'
      ) {
        const nextStyle = { ...this.#rectangleStyle, ...command.command.patch };
        delete (nextStyle as { kind?: unknown }).kind;
        if (!sameValue(this.#rectangleStyle, nextStyle)) {
          this.#rectangleStyle = nextStyle;
          changedElementIds = [command.command.elementId];
          didChange = true;
        }
      } else if (command.command.patch.kind === 'text') {
        const current = this.#textElement ?? this.textEditElement;
        if (current?.id === command.command.elementId) {
          const { kind: _kind, ...patch } = command.command.patch;
          const updated = { ...current, ...patch };
          if (!sameValue(current, updated)) {
            this.#textElement = updated;
            this.textEditElement = updated;
            this.#selectedElementId = updated.id;
            if (
              updated.fontSize !== current.fontSize ||
              updated.fontWeight !== current.fontWeight
            ) {
              this.requestTextMeasurement(updated);
            }
            changedElementIds = [updated.id];
            didChange = true;
          }
        }
      }
    } else if (command.command.type === 'set_render_profile') {
      if (!sameValue(this.#renderProfile, command.command.renderProfile)) {
        this.#renderProfile = command.command.renderProfile;
        didChange = true;
        changedElementIds = [
          ...[this.#rectangleId, this.#textElement?.id].filter(
            (elementId): elementId is string => elementId !== null && elementId !== undefined,
          ),
        ];
      }
    } else if (command.command.type === 'delete_elements') {
      const existingElementIds = [this.#rectangleId, this.#textElement?.id].filter(
        (elementId): elementId is string => elementId !== null && elementId !== undefined,
      );
      changedElementIds = command.command.elementIds.filter((elementId) =>
        existingElementIds.includes(elementId),
      );
      didChange = changedElementIds.length > 0;
      if (this.#selectedElementId && command.command.elementIds.includes(this.#selectedElementId)) {
        this.#selectedElementId = null;
      }
      if (this.#rectangleId && command.command.elementIds.includes(this.#rectangleId)) {
        this.#rectangleId = null;
      }
      if (this.#textElement && command.command.elementIds.includes(this.#textElement.id)) {
        this.#textElement = null;
        this.textEditElement = null;
        this.textMeasureRequest = null;
        this.#textMeasured = false;
      }
    }
    if (didChange) {
      this.#revision += 1;
      this.#sceneRevision += 1;
      this.#canRedo = false;
    }
    return this.update(changedElementIds);
  }

  async setActiveTool(tool: 'select' | 'freehand' | 'text'): Promise<EngineUpdateV1> {
    this.#activeTool = tool;
    this.#selectedElementId = null;
    return this.update();
  }

  async setSelection(elementId: string | null): Promise<EngineUpdateV1> {
    if (elementId && elementId !== this.#rectangleId) {
      throw new Error(`element ${elementId} was not found`);
    }
    this.#selectedElementId = elementId;
    return this.update();
  }

  async beginTextEditAt(): Promise<{ element: TextElementV1 | null; update: EngineUpdateV1 }> {
    this.#selectedElementId = this.textEditElement?.id ?? null;
    return { element: this.textEditElement, update: this.update() };
  }

  async provideTextMetrics(snapshot: TextMetricsSnapshotV1): Promise<EngineUpdateV1> {
    this.providedTextMetrics.push(snapshot);
    this.textMeasureRequest = null;
    this.#textMeasured = true;
    this.#sceneRevision += 1;
    return this.update();
  }

  async executeDiagramOperation(
    batch: DiagramOperationBatchV1,
  ): Promise<DiagramOperationBatchResultV1> {
    return {
      batchId: batch.batchId,
      mode: batch.mode,
      previousRevision: this.#revision,
      revision: batch.mode === 'apply' ? this.#revision + 1 : null,
      results: batch.operations.map((operation) => ({
        opId: operation.opId,
        status: batch.mode === 'apply' ? 'applied' : 'planned',
        affectedElementIds: [],
      })),
      scenePatch: (await this.benchmarkScenePatch()).value,
    };
  }

  async handlePointerEvents(
    events: NormalizedPointerEventV1[],
    _commandId: string,
  ): Promise<PointerUpdateV1> {
    this.pointerBatches.push(events);
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
    this.strokeBatches.push(batch);
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
      scene: { ...this.update().scene, renderProfile: profile },
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

  async benchmarkSceneSnapshot(): Promise<SceneBenchmarkPayloadV1<SceneSnapshotV1>> {
    return {
      value: this.update().scene,
      payloadBytes: 0,
      wasmSerializeAndTransferMs: 0,
      parseMs: 0,
    };
  }

  async benchmarkScenePatch(): Promise<SceneBenchmarkPayloadV1<ScenePatchV1>> {
    return {
      value: {
        protocolVersion: 1,
        documentRevision: this.#revision,
        baseSceneRevision: this.#sceneRevision,
        sceneRevision: this.#sceneRevision + 1,
        addedNodes: {},
        updatedNodes: {},
        removedNodeIds: [],
        rootNodeIds: null,
      },
      payloadBytes: 0,
      wasmSerializeAndTransferMs: 0,
      parseMs: 0,
    };
  }

  async migrateDocumentPayload() {
    return {
      result: {
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        migrated: true,
        document: {
          schemaVersion: 2 as const,
          documentId: 'doc-1',
          revision: 0,
          renderProfile: { kind: 'clean' as const, version: 1 as const },
          rootOrder: [],
          elements: {},
        },
        canonicalPayload: '{}',
      },
      report: null,
    };
  }

  engineAlgorithmVersion(): string {
    return 'nodeink-scene-v1';
  }

  serializeDocument() {
    const document = {
      schemaVersion: 2 as const,
      documentId: 'doc-1',
      revision: this.#revision,
      renderProfile: this.#renderProfile,
      rootOrder: this.#rectangleId ? [this.#rectangleId] : [],
      elements: {},
    };
    return {
      canonicalPayload: JSON.stringify(document),
      document,
      engineAlgorithmVersion: this.engineAlgorithmVersion(),
    };
  }

  async undo(): Promise<EngineUpdateV1> {
    this.undoCalls += 1;
    this.#canRedo = true;
    return this.update();
  }

  async redo(): Promise<EngineUpdateV1> {
    this.redoCalls += 1;
    this.#canRedo = false;
    return this.update();
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  private update(changedElementIds: string[] = []): EngineUpdateV1 {
    const scene = stubScene(
      this.#revision,
      this.#sceneRevision,
      this.#rectangleId,
      this.#textMeasured ? this.#textElement : null,
      this.#rectangleStyle,
      this.#renderProfile,
    );
    const selectedText = this.#textElement ?? this.textEditElement;
    const selectionStyle: SelectionStyleV1 | null =
      this.#selectedElementId === this.#rectangleId && this.#rectangleId
        ? { kind: 'rect', ...this.#rectangleStyle }
        : this.#selectedElementId === selectedText?.id
          ? {
              kind: 'text',
              color: selectedText.color,
              fontSize: selectedText.fontSize,
              fontWeight: selectedText.fontWeight,
              textAlign: selectedText.textAlign,
            }
          : null;
    const selectionBounds =
      this.#selectedElementId === this.#rectangleId && this.#rectangleId
        ? { x: 80, y: 72, width: 176, height: 104 }
        : this.#selectedElementId === selectedText?.id && this.#textMeasured
          ? { x: 80, y: 72, width: 176, height: 104 }
          : null;
    return {
      activeTool: this.#activeTool,
      textMeasureRequest: this.textMeasureRequest,
      operation: changedElementIds.length
        ? {
            commandId: `command-${this.#revision}`,
            previousRevision: this.#revision - 1,
            revision: this.#revision,
            changedElementIds,
            sceneRevision: this.#sceneRevision,
          }
        : null,
      scene,
      history: { canUndo: this.#revision > 0, canRedo: this.#canRedo },
      selection: {
        selectedElementId: this.#selectedElementId,
        bounds: selectionBounds,
        style: selectionStyle,
      },
    };
  }

  private requestTextMeasurement(element: TextElementV1): void {
    this.#textMeasured = false;
    this.textMeasureRequest = {
      requestId: `measure-${this.#revision}`,
      fontFingerprint: element.fontFingerprint,
      runs: [
        {
          key: `${element.id}:run-${this.#revision}`,
          text: element.text,
          fontFamily: element.fontFamily,
          fontSize: element.fontSize,
          fontWeight: element.fontWeight,
          maxWidth: element.maxWidth,
        },
      ],
    };
  }
}

class StubRenderer implements RendererV1 {
  readonly snapshots: SceneSnapshotV1[] = [];
  readonly viewports: Array<{ x: number; y: number; width: number; height: number }> = [];
  readonly overlays: EditorOverlayV1[] = [];
  shouldReject = false;
  mountCalls = 0;
  unmountCalls = 0;

  mount(): void {
    this.mountCalls += 1;
  }

  setViewport(viewport: { x: number; y: number; width: number; height: number }) {
    this.viewports.push(viewport);
    return { durationMs: 0 };
  }

  setOverlay(overlay: EditorOverlayV1): void {
    this.overlays.push(overlay);
  }

  applySnapshot(snapshot: SceneSnapshotV1) {
    if (this.shouldReject) {
      return { ok: false as const, reason: 'unsupported_scene' as const };
    }
    this.snapshots.push(snapshot);
    return { ok: true as const, sceneRevision: snapshot.sceneRevision };
  }

  applyPatch(patch: ScenePatchV1) {
    return { ok: true as const, sceneRevision: patch.sceneRevision };
  }

  unmount(): void {
    this.unmountCalls += 1;
  }
}

class StubCameraPersistence implements EditorCameraPersistencePortV1 {
  readonly saved: Array<{ documentId: string; camera: CameraV1 }> = [];
  saveError: Error | null = null;
  loadError: unknown = null;

  constructor(readonly restored: CameraV1 | null = null) {}

  async loadCamera(): Promise<CameraV1 | null> {
    if (this.loadError) {
      throw this.loadError;
    }
    return this.restored;
  }

  async saveCamera(documentId: string, camera: CameraV1): Promise<void> {
    this.saved.push({ documentId, camera });
    if (this.saveError) {
      throw this.saveError;
    }
  }
}

function stubScene(
  documentRevision: number,
  sceneRevision: number,
  rectangleId: string | null,
  text: TextElementV1 | null = null,
  rectangleStyle: Omit<Extract<SelectionStyleV1, { kind: 'rect' }>, 'kind'> = {
    fill: { kind: 'solid', color: '#d1fae5' },
    stroke: '#047857',
    strokeWidth: 2,
  },
  renderProfile: RenderProfileV1 = { kind: 'clean', version: 1 },
): SceneSnapshotV1 {
  const sceneNodeId = rectangleId ? `${rectangleId}:shape` : null;
  const rectangleNodes =
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
            fill:
              rectangleStyle.fill.kind === 'solid' ? rectangleStyle.fill.color : ('none' as const),
            stroke: rectangleStyle.stroke,
            strokeWidth: rectangleStyle.strokeWidth,
          },
        }
      : {};
  const textNodeId = text ? `${text.id}:text` : null;
  const textNodes =
    text && textNodeId
      ? {
          [textNodeId]: {
            kind: 'text' as const,
            id: textNodeId,
            sourceElementId: text.id,
            runs: [
              {
                text: text.text,
                x: text.x,
                y: text.y + 20,
                fontFamily: text.fontFamily,
                fontSize: text.fontSize,
                fontWeight: text.fontWeight,
                fill: text.color,
                textAnchor:
                  text.textAlign === 'center'
                    ? ('middle' as const)
                    : text.textAlign === 'end'
                      ? ('end' as const)
                      : ('start' as const),
              },
            ],
          },
        }
      : {};
  return {
    protocolVersion: 1,
    documentId: 'doc-1',
    documentRevision,
    sceneRevision,
    renderProfile,
    rootNodeIds: [sceneNodeId, textNodeId].filter((id): id is string => id !== null),
    nodes: { ...rectangleNodes, ...textNodes },
  };
}

function textElement(id: string, text: string): TextElementV1 {
  return {
    kind: 'text',
    id,
    x: 40,
    y: 52,
    text,
    fontFamily: 'Noto Sans SC Variable',
    fontSize: 24,
    fontWeight: 400,
    maxWidth: null,
    fontFingerprint: 'font-ready-v1',
    color: '#0f172a',
    textAlign: 'start',
  };
}

function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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
  };
}

function keyboardEvent({
  key,
  metaKey = false,
  shiftKey = false,
}: {
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    metaKey,
    shiftKey,
  });
}
