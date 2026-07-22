import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CommandEnvelopeV1,
  DiagramOperationBatchV1,
  TextElementV1,
  TextMetricsSnapshotV1,
} from '@nodeink-internal/protocol';
import { canvasFontFamily, createBlankDocument } from '@nodeink-internal/protocol';

const fixtureFontFingerprint = 'noto-sans-sc-v40-fontsource-5.3.0';

const wasm = vi.hoisted(() => {
  const handle = {
    currentCamera: vi.fn(),
    setCamera: vi.fn(),
    fitCamera: vi.fn(),
    applyCameraAction: vi.fn(),
    currentUpdate: vi.fn(),
    executeCommand: vi.fn(),
    setActiveTool: vi.fn(),
    setSelection: vi.fn(),
    beginTextEditAt: vi.fn(),
    provideTextMetrics: vi.fn(),
    executeDiagramOperation: vi.fn(),
    handlePointerEvents: vi.fn(),
    handleStrokeBatchJson: vi.fn(),
    handleStrokePoints: vi.fn(),
    resolveSceneProfile: vi.fn(),
    resolveTextFixture: vi.fn(),
    benchmarkSceneSnapshot: vi.fn(),
    benchmarkScenePatch: vi.fn(),
    migrateDocumentPayload: vi.fn(),
    engineAlgorithmVersion: vi.fn(),
    serializeDocument: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    free: vi.fn(),
  };
  return {
    default: vi.fn(async () => undefined),
    openDocument: vi.fn(() => handle),
    handle,
  };
});

vi.mock('../generated/nodeink_engine.js', () => ({
  default: wasm.default,
  openDocument: wasm.openDocument,
}));

import { createWasmEngine } from './index';

describe('createWasmEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const update = validUpdate();
    wasm.handle.currentCamera.mockReturnValue('{"x":0,"y":0,"zoom":1}');
    wasm.handle.setCamera.mockReturnValue('{"x":24,"y":12,"zoom":1.5}');
    wasm.handle.fitCamera.mockReturnValue('{"x":75,"y":25,"zoom":2}');
    wasm.handle.applyCameraAction.mockReturnValue('{"x":12,"y":6,"zoom":2}');
    wasm.handle.currentUpdate.mockReturnValue(update);
    wasm.handle.executeCommand.mockReturnValue(update);
    wasm.handle.setActiveTool.mockReturnValue(validUpdate('freehand'));
    wasm.handle.setSelection.mockReturnValue(update);
    wasm.handle.beginTextEditAt.mockReturnValue(textEditTarget());
    wasm.handle.provideTextMetrics.mockReturnValue(validUpdate('text'));
    wasm.handle.executeDiagramOperation.mockReturnValue(diagramOperationResult());
    wasm.handle.handlePointerEvents.mockReturnValue(pointerUpdate());
    wasm.handle.handleStrokeBatchJson.mockReturnValue(strokeUpdate());
    wasm.handle.handleStrokePoints.mockReturnValue(strokeUpdate());
    wasm.handle.resolveSceneProfile.mockReturnValue(sceneResolution());
    wasm.handle.resolveTextFixture.mockReturnValue(textResolution());
    wasm.handle.benchmarkSceneSnapshot.mockReturnValue(sceneSnapshot());
    wasm.handle.benchmarkScenePatch.mockReturnValue(scenePatch());
    wasm.handle.migrateDocumentPayload.mockReturnValue(migrationAttempt());
    wasm.handle.engineAlgorithmVersion.mockReturnValue('nodeink-scene-v1');
    wasm.handle.serializeDocument.mockReturnValue(JSON.stringify(createBlankDocument('doc-1')));
    wasm.handle.undo.mockReturnValue(update);
    wasm.handle.redo.mockReturnValue(update);
  });

  it('initializes the module and forwards engine operations', async () => {
    const document = createBlankDocument('doc-1');
    const engine = await createWasmEngine(document);
    const command: CommandEnvelopeV1 = {
      protocolVersion: 1,
      commandId: 'command-1',
      documentId: 'doc-1',
      expectedRevision: 0,
      command: {
        type: 'create_rectangle',
        rectangle: rectangleElement(),
      },
    };
    const batch = diagramOperationBatch();

    await expect(engine.currentUpdate()).resolves.toMatchObject({
      scene: { documentRevision: 0 },
    });
    await expect(engine.currentCamera()).resolves.toEqual({ x: 0, y: 0, zoom: 1 });
    await expect(engine.setCamera({ x: 24, y: 12, zoom: 1.5 })).resolves.toEqual({
      x: 24,
      y: 12,
      zoom: 1.5,
    });
    await expect(engine.fitCamera({ width: 500, height: 300 }, 50)).resolves.toEqual({
      x: 75,
      y: 25,
      zoom: 2,
    });
    await expect(
      engine.applyCameraAction({
        type: 'zoom_at',
        factor: 2,
        anchor: { x: 100, y: 80 },
      }),
    ).resolves.toEqual({ x: 12, y: 6, zoom: 2 });
    await expect(engine.executeCommand(command)).resolves.toMatchObject({
      history: { canUndo: false },
    });
    const createTextCommand: CommandEnvelopeV1 = {
      protocolVersion: 1,
      commandId: 'create-text-1',
      documentId: 'doc-1',
      expectedRevision: 0,
      command: { type: 'create_text', text: textElement() },
    };
    const updateTextCommand: CommandEnvelopeV1 = {
      protocolVersion: 1,
      commandId: 'update-text-1',
      documentId: 'doc-1',
      expectedRevision: 0,
      command: {
        type: 'update_text',
        elementId: 'text-1',
        patch: { text: 'Updated\ntext', maxWidth: null },
      },
    };
    const updateStyleCommand: CommandEnvelopeV1 = {
      protocolVersion: 1,
      commandId: 'update-style-1',
      documentId: 'doc-1',
      expectedRevision: 0,
      command: {
        type: 'update_element_style',
        elementId: 'text-1',
        patch: {
          kind: 'text',
          color: '#2563eb',
          fontSize: 28,
          fontWeight: 500,
          textAlign: 'center',
        },
      },
    };
    const renderProfileCommand: CommandEnvelopeV1 = {
      protocolVersion: 1,
      commandId: 'set-render-profile-1',
      documentId: 'doc-1',
      expectedRevision: 0,
      command: {
        type: 'set_render_profile',
        renderProfile: {
          kind: 'sketch',
          version: 1,
          seed: 42,
          roughness: 1.2,
          bowing: 0.8,
          fillStyle: 'hachure',
        },
      },
    };
    await expect(engine.executeCommand(createTextCommand)).resolves.toBeDefined();
    await expect(engine.executeCommand(updateTextCommand)).resolves.toBeDefined();
    await expect(engine.executeCommand(updateStyleCommand)).resolves.toBeDefined();
    await expect(engine.executeCommand(renderProfileCommand)).resolves.toBeDefined();
    await expect(engine.setActiveTool('freehand')).resolves.toMatchObject({
      activeTool: 'freehand',
    });
    await expect(engine.setSelection('rect-1')).resolves.toMatchObject({
      selection: { selectedElementId: null },
    });
    await expect(engine.beginTextEditAt({ x: 40, y: 48 })).resolves.toMatchObject({
      element: { id: 'text-1', text: '第一行\nSecond line' },
      update: { activeTool: 'text' },
    });
    const textMetrics: TextMetricsSnapshotV1 = {
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      metrics: [
        {
          key: 'text-1:line-0',
          width: 120,
          height: 24,
          baseline: 18,
          lineBreaks: [5],
        },
      ],
    };
    await expect(engine.provideTextMetrics(textMetrics)).resolves.toMatchObject({
      activeTool: 'text',
      textMeasureRequest: null,
    });
    await expect(engine.executeDiagramOperation(batch)).resolves.toMatchObject({
      batchId: 'batch-1',
      revision: 1,
      results: [{ status: 'applied' }],
    });
    const pointerEvents = [
      {
        pointerId: 1,
        sequence: 1,
        phase: 'down' as const,
        point: { x: 1, y: 2 },
      },
    ];
    await expect(engine.handlePointerEvents(pointerEvents, 'drag-1')).resolves.toMatchObject({
      processedEventCount: 1,
      didCommit: false,
    });
    const strokeBatch = {
      pointerId: 7,
      sequenceStart: 11,
      phase: 'move' as const,
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      strokeId: null,
    };
    await expect(
      engine.handleStrokeBatch(strokeBatch, 'stroke-json', 'json'),
    ).resolves.toMatchObject({ processedPointCount: 2, didCommit: false });
    await expect(engine.resolveSceneProfile({ kind: 'clean', version: 1 })).resolves.toMatchObject({
      engineAlgorithmVersion: 'nodeink-scene-v1',
      canonicalHash: 'fnv1a64:1234',
    });
    const textRuns = [
      {
        key: 'cjk',
        text: '你好',
        fontFamily: 'Noto Sans SC Variable',
        fontSize: 20,
        fontWeight: 400 as const,
        maxWidth: null,
      },
    ];
    await expect(
      engine.resolveTextFixture('measure-1', 'noto-sans-sc-v40-fontsource-5.3.0', textRuns, null),
    ).resolves.toMatchObject({ request: { requestId: 'measure-1' }, scene: null });
    await expect(
      engine.handleStrokeBatch(strokeBatch, 'stroke-typed', 'typed_array'),
    ).resolves.toMatchObject({ processedPointCount: 2, didCommit: false });
    await expect(engine.benchmarkSceneSnapshot(1_000, 1, true)).resolves.toMatchObject({
      value: { sceneRevision: 2 },
      payloadBytes: expect.any(Number),
      wasmSerializeAndTransferMs: expect.any(Number),
      parseMs: expect.any(Number),
    });
    await expect(engine.benchmarkScenePatch(1_000, 1)).resolves.toMatchObject({
      value: { baseSceneRevision: 1, sceneRevision: 2 },
      payloadBytes: expect.any(Number),
    });
    await expect(engine.migrateDocumentPayload('{"schemaVersion":0}')).resolves.toMatchObject({
      result: { sourceSchemaVersion: 0, migrated: true },
    });
    expect(engine.engineAlgorithmVersion()).toBe('nodeink-scene-v1');
    expect(engine.serializeDocument()).toEqual({
      canonicalPayload: JSON.stringify(document),
      document,
      engineAlgorithmVersion: 'nodeink-scene-v1',
    });
    await expect(engine.undo()).resolves.toBeDefined();
    await expect(engine.redo()).resolves.toBeDefined();

    expect(wasm.default).toHaveBeenCalledOnce();
    expect(wasm.openDocument).toHaveBeenCalledWith(JSON.stringify(document));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(command));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(createTextCommand));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(updateTextCommand));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(updateStyleCommand));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(renderProfileCommand));
    expect(wasm.handle.setActiveTool).toHaveBeenCalledWith('freehand');
    expect(wasm.handle.setSelection).toHaveBeenCalledWith('rect-1');
    expect(wasm.handle.beginTextEditAt).toHaveBeenCalledWith('{"x":40,"y":48}');
    expect(wasm.handle.provideTextMetrics).toHaveBeenCalledWith(JSON.stringify(textMetrics));
    expect(wasm.handle.setCamera).toHaveBeenCalledWith('{"x":24,"y":12,"zoom":1.5}');
    expect(wasm.handle.fitCamera).toHaveBeenCalledWith(500, 300, 50);
    expect(wasm.handle.applyCameraAction).toHaveBeenCalledWith(
      '{"type":"zoom_at","factor":2,"anchor":{"x":100,"y":80}}',
    );
    expect(wasm.handle.executeDiagramOperation).toHaveBeenCalledWith(JSON.stringify(batch));
    expect(wasm.handle.handlePointerEvents).toHaveBeenCalledWith(
      JSON.stringify(pointerEvents),
      'drag-1',
    );
    expect(wasm.handle.handleStrokeBatchJson).toHaveBeenCalledWith(
      JSON.stringify(strokeBatch),
      'stroke-json',
    );
    expect(wasm.handle.handleStrokePoints).toHaveBeenCalledWith(
      7,
      11,
      'move',
      new Float64Array([1, 2, 3, 4]),
      undefined,
      'stroke-typed',
    );
    expect(wasm.handle.resolveSceneProfile).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'clean', version: 1 }),
    );
    expect(wasm.handle.resolveTextFixture).toHaveBeenCalledWith(
      'measure-1',
      'noto-sans-sc-v40-fontsource-5.3.0',
      JSON.stringify(textRuns),
      undefined,
    );
    expect(wasm.handle.benchmarkSceneSnapshot).toHaveBeenCalledWith(1_000, 1, true);
    expect(wasm.handle.benchmarkScenePatch).toHaveBeenCalledWith(1_000, 1);
    expect(wasm.handle.migrateDocumentPayload).toHaveBeenCalledWith('{"schemaVersion":0}');
    expect(wasm.handle.serializeDocument).toHaveBeenCalledOnce();
    expect(wasm.handle.engineAlgorithmVersion).toHaveBeenCalledTimes(2);
  });

  it('normalizes structured and plain engine failures', async () => {
    const engine = await createWasmEngine(createBlankDocument('doc-1'));
    const command = commandFixture();

    wasm.handle.currentCamera.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'camera unavailable' }));
    });
    await expect(engine.currentCamera()).rejects.toThrow('camera unavailable');

    wasm.handle.setCamera.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'camera restore rejected' }));
    });
    await expect(engine.setCamera({ x: 0, y: 0, zoom: 1 })).rejects.toThrow(
      'camera restore rejected',
    );

    wasm.handle.fitCamera.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'camera fit rejected' }));
    });
    await expect(engine.fitCamera({ width: 800, height: 600 }, 64)).rejects.toThrow(
      'camera fit rejected',
    );

    wasm.handle.applyCameraAction.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'camera action rejected' }));
    });
    await expect(
      engine.applyCameraAction({
        type: 'fit_content',
        viewport: { width: 800, height: 600 },
        padding: 64,
      }),
    ).rejects.toThrow('camera action rejected');

    wasm.handle.executeCommand.mockImplementation(() => {
      throw new Error(JSON.stringify({ code: 'revision_conflict', message: 'stale revision' }));
    });
    await expect(engine.executeCommand(command)).rejects.toThrow('stale revision');

    wasm.handle.setActiveTool.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'tool rejected' }));
    });
    await expect(engine.setActiveTool('freehand')).rejects.toThrow('tool rejected');

    wasm.handle.beginTextEditAt.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'text target rejected' }));
    });
    await expect(engine.beginTextEditAt({ x: 0, y: 0 })).rejects.toThrow('text target rejected');

    wasm.handle.provideTextMetrics.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'metrics snapshot rejected' }));
    });
    await expect(
      engine.provideTextMetrics({
        fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
        metrics: [],
      }),
    ).rejects.toThrow('metrics snapshot rejected');

    wasm.handle.executeDiagramOperation.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'batch rejected' }));
    });
    await expect(engine.executeDiagramOperation(diagramOperationBatch())).rejects.toThrow(
      'batch rejected',
    );

    wasm.handle.undo.mockImplementation(() => {
      throw JSON.stringify({ code: 'undo_unavailable' });
    });
    await expect(engine.undo()).rejects.toThrow('undo_unavailable');

    wasm.handle.redo.mockImplementation(() => {
      throw new Error('plain engine failure');
    });
    await expect(engine.redo()).rejects.toThrow('plain engine failure');

    wasm.handle.handlePointerEvents.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'pointer rejected' }));
    });
    await expect(engine.handlePointerEvents([], 'drag-1')).rejects.toThrow('pointer rejected');

    wasm.handle.handleStrokeBatchJson.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'stroke rejected' }));
    });
    await expect(
      engine.handleStrokeBatch(
        {
          pointerId: 1,
          sequenceStart: 1,
          phase: 'cancel',
          points: [],
          strokeId: null,
        },
        'stroke-1',
        'json',
      ),
    ).rejects.toThrow('stroke rejected');

    wasm.handle.resolveSceneProfile.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'profile rejected' }));
    });
    await expect(engine.resolveSceneProfile({ kind: 'clean', version: 1 })).rejects.toThrow(
      'profile rejected',
    );

    wasm.handle.resolveTextFixture.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'metrics rejected' }));
    });
    await expect(
      engine.resolveTextFixture('measure', 'noto-sans-sc-v40-fontsource-5.3.0', [], null),
    ).rejects.toThrow('metrics rejected');

    wasm.handle.benchmarkScenePatch.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'fixture rejected' }));
    });
    await expect(engine.benchmarkScenePatch(0, 0)).rejects.toThrow('fixture rejected');

    wasm.handle.migrateDocumentPayload.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'migration unavailable' }));
    });
    await expect(engine.migrateDocumentPayload('{}')).rejects.toThrow('migration unavailable');

    wasm.handle.serializeDocument.mockReturnValue('{"schemaVersion":1}');
    expect(() => engine.serializeDocument()).toThrow('invalid serialized Document');
  });

  it('frees the handle once and rejects use after disposal', async () => {
    const engine = await createWasmEngine(createBlankDocument('doc-1'));

    engine.dispose();
    engine.dispose();

    expect(wasm.handle.free).toHaveBeenCalledOnce();
    await expect(engine.currentUpdate()).rejects.toThrow('disposed');
  });
});

function commandFixture(): CommandEnvelopeV1 {
  return {
    protocolVersion: 1,
    commandId: 'command-1',
    documentId: 'doc-1',
    expectedRevision: 0,
    command: { type: 'move_elements', elementIds: ['rect-1'], delta: { x: 1, y: 2 } },
  };
}

function diagramOperationBatch(): DiagramOperationBatchV1 {
  return {
    protocolVersion: 1,
    batchId: 'batch-1',
    documentId: 'doc-1',
    expectedRevision: 0,
    mode: 'apply',
    atomic: true,
    operations: [
      {
        type: 'create_rectangle',
        opId: 'create-1',
        rectangle: rectangleElement(),
      },
    ],
  };
}

function diagramOperationResult(): string {
  return JSON.stringify({
    batchId: 'batch-1',
    mode: 'apply',
    previousRevision: 0,
    revision: 1,
    results: [{ opId: 'create-1', status: 'applied', affectedElementIds: ['rect-1'] }],
    scenePatch: JSON.parse(scenePatch()),
  });
}

function validUpdate(activeTool: 'select' | 'freehand' | 'text' = 'select'): string {
  return JSON.stringify({
    activeTool,
    textMeasureRequest: null,
    operation: null,
    scene: {
      protocolVersion: 1,
      documentId: 'doc-1',
      documentRevision: 0,
      sceneRevision: 0,
      renderProfile: { kind: 'clean', version: 1 },
      rootNodeIds: [],
      nodes: {},
    },
    history: { canUndo: false, canRedo: false },
    selection: { selectedElementId: null, bounds: null, style: null },
  });
}

function textElement(): TextElementV1 {
  return {
    kind: 'text',
    id: 'text-1',
    x: 40,
    y: 48,
    text: '第一行\nSecond line',
    fontFamily: canvasFontFamily,
    fontSize: 20,
    fontWeight: 400,
    maxWidth: 240,
    fontFingerprint: fixtureFontFingerprint,
    color: '#0f172a',
    textAlign: 'start',
  };
}

function textEditTarget(): string {
  return JSON.stringify({
    element: textElement(),
    update: {
      ...JSON.parse(validUpdate('text')),
      selection: {
        selectedElementId: 'text-1',
        bounds: { x: 40, y: 48, width: 240, height: 48 },
        style: {
          kind: 'text',
          color: '#0f172a',
          fontSize: 20,
          fontWeight: 400,
          textAlign: 'start',
        },
      },
    },
  });
}

function pointerUpdate(): string {
  return JSON.stringify({
    update: JSON.parse(validUpdate()),
    processedEventCount: 1,
    ignoredEventCount: 0,
    didCommit: false,
  });
}

function strokeUpdate(): string {
  return JSON.stringify({
    update: JSON.parse(validUpdate()),
    processedPointCount: 2,
    ignoredPointCount: 0,
    didCommit: false,
  });
}

function sceneResolution(): string {
  return JSON.stringify({
    engineAlgorithmVersion: 'nodeink-scene-v1',
    renderProfile: { kind: 'clean', version: 1 },
    canonicalHash: 'fnv1a64:1234',
    scene: JSON.parse(validUpdate()).scene,
  });
}

function textResolution(): string {
  return JSON.stringify({
    request: {
      requestId: 'measure-1',
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: [],
    },
    scene: null,
    canonicalHash: null,
  });
}

function sceneSnapshot(): string {
  return JSON.stringify({
    ...JSON.parse(validUpdate()).scene,
    documentRevision: 2,
    sceneRevision: 2,
  });
}

function scenePatch(): string {
  return JSON.stringify({
    protocolVersion: 1,
    documentRevision: 2,
    baseSceneRevision: 1,
    sceneRevision: 2,
    addedNodes: {},
    updatedNodes: {},
    removedNodeIds: [],
    rootNodeIds: null,
  });
}

function migrationAttempt(): string {
  return JSON.stringify({
    result: {
      sourceSchemaVersion: 0,
      targetSchemaVersion: 2,
      migrated: true,
      document: createBlankDocument('doc-1'),
      canonicalPayload: JSON.stringify(createBlankDocument('doc-1')),
    },
    report: null,
  });
}

function rectangleElement() {
  return {
    kind: 'rect' as const,
    id: 'rect-1',
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    fill: { kind: 'solid' as const, color: '#d1fae5' },
    stroke: '#047857',
    strokeWidth: 2,
  };
}
