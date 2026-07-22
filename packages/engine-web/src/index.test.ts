import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandEnvelopeV1, DiagramOperationBatchV1 } from '@nodeink-internal/protocol';
import { createBlankDocument } from '@nodeink-internal/protocol';

const wasm = vi.hoisted(() => {
  const handle = {
    currentUpdate: vi.fn(),
    executeCommand: vi.fn(),
    executeDiagramOperation: vi.fn(),
    handlePointerEvents: vi.fn(),
    handleStrokeBatchJson: vi.fn(),
    handleStrokePoints: vi.fn(),
    resolveSceneProfile: vi.fn(),
    resolveTextFixture: vi.fn(),
    benchmarkSceneSnapshot: vi.fn(),
    benchmarkScenePatch: vi.fn(),
    migrateDocumentPayload: vi.fn(),
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
    wasm.handle.currentUpdate.mockReturnValue(update);
    wasm.handle.executeCommand.mockReturnValue(update);
    wasm.handle.executeDiagramOperation.mockReturnValue(diagramOperationResult());
    wasm.handle.handlePointerEvents.mockReturnValue(pointerUpdate());
    wasm.handle.handleStrokeBatchJson.mockReturnValue(strokeUpdate());
    wasm.handle.handleStrokePoints.mockReturnValue(strokeUpdate());
    wasm.handle.resolveSceneProfile.mockReturnValue(sceneResolution());
    wasm.handle.resolveTextFixture.mockReturnValue(textResolution());
    wasm.handle.benchmarkSceneSnapshot.mockReturnValue(sceneSnapshot());
    wasm.handle.benchmarkScenePatch.mockReturnValue(scenePatch());
    wasm.handle.migrateDocumentPayload.mockReturnValue(migrationAttempt());
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
        rectangle: { kind: 'rect', id: 'rect-1', x: 1, y: 2, width: 3, height: 4 },
      },
    };
    const batch = diagramOperationBatch();

    await expect(engine.currentUpdate()).resolves.toMatchObject({
      scene: { documentRevision: 0 },
    });
    await expect(engine.executeCommand(command)).resolves.toMatchObject({
      history: { canUndo: false },
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
        targetElementId: 'rect-1',
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
        fontFamily: 'Arial',
        fontSize: 20,
        fontWeight: 400 as const,
        maxWidth: null,
      },
    ];
    await expect(
      engine.resolveTextFixture('measure-1', 'font-v1', textRuns, null),
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
    await expect(engine.undo()).resolves.toBeDefined();
    await expect(engine.redo()).resolves.toBeDefined();

    expect(wasm.default).toHaveBeenCalledOnce();
    expect(wasm.openDocument).toHaveBeenCalledWith(JSON.stringify(document));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(command));
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
      'font-v1',
      JSON.stringify(textRuns),
      undefined,
    );
    expect(wasm.handle.benchmarkSceneSnapshot).toHaveBeenCalledWith(1_000, 1, true);
    expect(wasm.handle.benchmarkScenePatch).toHaveBeenCalledWith(1_000, 1);
    expect(wasm.handle.migrateDocumentPayload).toHaveBeenCalledWith('{"schemaVersion":0}');
  });

  it('normalizes structured and plain engine failures', async () => {
    const engine = await createWasmEngine(createBlankDocument('doc-1'));
    const command = commandFixture();

    wasm.handle.executeCommand.mockImplementation(() => {
      throw new Error(JSON.stringify({ code: 'revision_conflict', message: 'stale revision' }));
    });
    await expect(engine.executeCommand(command)).rejects.toThrow('stale revision');

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
    await expect(engine.resolveTextFixture('measure', 'font-v1', [], null)).rejects.toThrow(
      'metrics rejected',
    );

    wasm.handle.benchmarkScenePatch.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'fixture rejected' }));
    });
    await expect(engine.benchmarkScenePatch(0, 0)).rejects.toThrow('fixture rejected');

    wasm.handle.migrateDocumentPayload.mockImplementation(() => {
      throw new Error(JSON.stringify({ message: 'migration unavailable' }));
    });
    await expect(engine.migrateDocumentPayload('{}')).rejects.toThrow('migration unavailable');
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
        rectangle: { kind: 'rect', id: 'rect-1', x: 1, y: 2, width: 3, height: 4 },
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

function validUpdate(): string {
  return JSON.stringify({
    operation: null,
    scene: {
      protocolVersion: 1,
      documentId: 'doc-1',
      documentRevision: 0,
      sceneRevision: 0,
      rootNodeIds: [],
      nodes: {},
    },
    history: { canUndo: false, canRedo: false },
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
    request: { requestId: 'measure-1', fontFingerprint: 'font-v1', runs: [] },
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
      targetSchemaVersion: 1,
      migrated: true,
      document: createBlankDocument('doc-1'),
      canonicalPayload: JSON.stringify(createBlankDocument('doc-1')),
    },
    report: null,
  });
}
