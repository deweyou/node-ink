import { describe, expect, it } from 'vitest';

import {
  canvasFontFamily,
  createBlankDocument,
  parseDiagramOperationBatchResult,
  parseCamera,
  parseEngineUpdate,
  parseMigrationAttempt,
  parsePointerUpdate,
  parseScenePatch,
  parseSceneResolution,
  parseSceneSnapshot,
  parseStrokeUpdate,
  parseTextEditTarget,
  parseTextFixtureResolution,
} from './index';

const fixtureFontFingerprint = 'noto-sans-sc-v40-fontsource-5.3.0';

describe('protocol V1', () => {
  it('parses finite Camera state within the supported zoom range', () => {
    expect(parseCamera('{"x":-12,"y":24,"zoom":1.5}')).toEqual({
      x: -12,
      y: 24,
      zoom: 1.5,
    });
    expect(() => parseCamera('{"x":0,"y":0,"zoom":0.09}')).toThrow('Camera V1');
    expect(() => parseCamera('{"x":0,"y":0,"zoom":9}')).toThrow('Camera V1');
  });

  it('creates a blank document with explicit versions', () => {
    expect(createBlankDocument('doc-1')).toEqual({
      schemaVersion: 1,
      documentId: 'doc-1',
      revision: 0,
      rootOrder: [],
      elements: {},
    });
  });

  it('rejects an update with an unsupported protocol version', () => {
    expect(() =>
      parseEngineUpdate(
        JSON.stringify({
          operation: null,
          scene: {
            protocolVersion: 2,
            documentRevision: 0,
            sceneRevision: 0,
            rootNodeIds: [],
            nodes: {},
          },
          history: { canUndo: false, canRedo: false },
          selection: { selectedElementId: null, bounds: null },
        }),
      ),
    ).toThrow('protocol V1');
  });

  it('parses a valid engine update', () => {
    const update = {
      activeTool: 'freehand',
      textMeasureRequest: {
        requestId: 'measure-text-1',
        fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
        runs: [
          {
            key: 'text-1',
            text: '第一行\nSecond line',
            fontFamily: 'Noto Sans SC Variable',
            fontSize: 20,
            fontWeight: 400,
            maxWidth: 240,
          },
        ],
      },
      operation: null,
      scene: {
        protocolVersion: 1,
        documentId: 'doc-1',
        documentRevision: 3,
        sceneRevision: 4,
        rootNodeIds: [],
        nodes: {},
      },
      history: { canUndo: true, canRedo: false },
      selection: {
        selectedElementId: 'rect-1',
        bounds: { x: 8, y: 12, width: 120, height: 80 },
      },
    };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it('defaults legacy engine updates to the select tool', () => {
    const legacy = updateFixture();
    delete (legacy as { activeTool?: unknown }).activeTool;
    delete (legacy as { textMeasureRequest?: unknown }).textMeasureRequest;

    expect(parseEngineUpdate(JSON.stringify(legacy))).toEqual({
      ...legacy,
      activeTool: 'select',
      textMeasureRequest: null,
    });
  });

  it.each([null, '', 'pen', {}, 1])('rejects an invalid active tool %o', (activeTool) => {
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), activeTool }))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    {},
    {
      requestId: 1,
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: [],
    },
    { requestId: 'measure-1', fontFingerprint: 1, runs: [] },
    {
      requestId: 'measure-1',
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: {},
    },
    {
      requestId: 'measure-1',
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: [
        {
          key: 'text-1',
          text: 'hello',
          fontFamily: 'Noto Sans SC Variable',
          fontSize: 20,
          fontWeight: 700,
          maxWidth: null,
        },
      ],
    },
  ])('rejects an invalid text measurement request %o', (textMeasureRequest) => {
    expect(() =>
      parseEngineUpdate(JSON.stringify({ ...updateFixture(), textMeasureRequest })),
    ).toThrow('protocol V1');
  });

  it('parses a multi-line text Scene node with an explicit source element', () => {
    const textNode = sceneTextFixture();
    const scene = {
      ...updateFixture().scene,
      rootNodeIds: [textNode.id],
      nodes: { [textNode.id]: textNode },
    };

    expect(parseSceneSnapshot(JSON.stringify(scene))).toEqual(scene);
  });

  it('parses a text edit target without deriving the semantic target from SVG', () => {
    const value = {
      element: textElementFixture(),
      update: {
        ...updateFixture(),
        activeTool: 'text',
        selection: {
          selectedElementId: 'text-1',
          bounds: { x: 40, y: 48, width: 240, height: 48 },
        },
      },
    };

    expect(parseTextEditTarget(JSON.stringify(value))).toEqual(value);
    expect(parseTextEditTarget(JSON.stringify({ element: null, update: updateFixture() }))).toEqual(
      { element: null, update: updateFixture() },
    );
  });

  it.each([
    null,
    {},
    { element: null, update: null },
    { element: { ...textElementFixture(), fontFamily: 'Arial' }, update: updateFixture() },
    { element: { ...textElementFixture(), fontFingerprint: '' }, update: updateFixture() },
    { element: { ...textElementFixture(), maxWidth: 0 }, update: updateFixture() },
    { element: textElementFixture(), update: {} },
  ])('rejects an invalid text edit target %o', (value) => {
    expect(() => parseTextEditTarget(JSON.stringify(value))).toThrow('text edit target');
  });

  it.each([
    { ...sceneTextFixture(), sourceElementId: null },
    { ...sceneTextFixture(), runs: {} },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], fontWeight: 700 }],
    },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], x: null }],
    },
  ])('rejects an invalid text Scene node %o', (textNode) => {
    const scene = {
      ...updateFixture().scene,
      rootNodeIds: ['text-1:text'],
      nodes: { 'text-1:text': textNode },
    };

    expect(() => parseSceneSnapshot(JSON.stringify(scene))).toThrow('protocol V1');
  });

  it('parses a standalone scene snapshot', () => {
    const scene = updateFixture().scene;

    expect(parseSceneSnapshot(JSON.stringify(scene))).toEqual(scene);
  });

  it('parses a versioned incremental scene patch', () => {
    const patch = patchFixture();

    expect(parseScenePatch(JSON.stringify(patch))).toEqual(patch);
  });

  it('parses applied and planned diagram operation results with renderer-only patches', () => {
    const applied = diagramOperationResultFixture();
    const planned = diagramOperationResultFixture({ mode: 'dry_run', revision: null });
    planned.results[0]!.status = 'planned';

    expect(parseDiagramOperationBatchResult(JSON.stringify(applied))).toEqual(applied);
    expect(parseDiagramOperationBatchResult(JSON.stringify(planned))).toEqual(planned);
  });

  it.each([
    null,
    {},
    diagramOperationResultFixture({ batchId: 1 }),
    diagramOperationResultFixture({ mode: 'preview' }),
    diagramOperationResultFixture({ previousRevision: '0' }),
    diagramOperationResultFixture({ revision: '1' }),
    diagramOperationResultFixture({ results: {} }),
    diagramOperationResultFixture({ results: [null] }),
    diagramOperationResultFixture({ results: [{ opId: 1 }] }),
    diagramOperationResultFixture({ results: [{ opId: 'op-1', status: 'failed' }] }),
    diagramOperationResultFixture({
      results: [{ opId: 'op-1', status: 'applied', affectedElementIds: [1] }],
    }),
    diagramOperationResultFixture({ scenePatch: null }),
    diagramOperationResultFixture({ scenePatch: patchFixture({ protocolVersion: 2 }) }),
  ])('rejects invalid diagram operation result payloads', (value) => {
    expect(() => parseDiagramOperationBatchResult(JSON.stringify(value))).toThrow('protocol V1');
  });

  it.each([
    null,
    {},
    { protocolVersion: 2 },
    patchFixture({ documentRevision: '2' }),
    patchFixture({ baseSceneRevision: '1' }),
    patchFixture({ sceneRevision: '2' }),
    patchFixture({ addedNodes: [] }),
    patchFixture({ updatedNodes: [] }),
    patchFixture({ removedNodeIds: {} }),
    patchFixture({ rootNodeIds: {} }),
    patchFixture({ addedNodes: { 'text-1:text': { ...sceneTextFixture(), runs: {} } } }),
  ])('rejects invalid scene patch payloads', (value) => {
    expect(() => parseScenePatch(JSON.stringify(value))).toThrow('protocol V1');
  });

  it.each([
    null,
    {},
    { scene: null, history: {} },
    { scene: {}, history: null },
    { ...updateFixture(), selection: null },
  ])('rejects structurally invalid update payloads', (value) => {
    expect(() => parseEngineUpdate(JSON.stringify(value))).toThrow('invalid update payload');
  });

  it.each([
    {},
    { selectedElementId: 1, bounds: null },
    { selectedElementId: null, bounds: {} },
    { selectedElementId: null, bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { selectedElementId: 'rect-1', bounds: null },
    { selectedElementId: 'rect-1', bounds: { x: 0, y: 0, width: -1, height: 10 } },
  ])('rejects invalid selection state %o', (selection) => {
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    ['document revision', { documentRevision: '0' }],
    ['scene revision', { sceneRevision: '0' }],
    ['root node ids', { rootNodeIds: {} }],
    ['scene nodes', { nodes: [] }],
  ])('rejects an invalid %s', (_label, sceneOverride) => {
    expect(() => parseEngineUpdate(JSON.stringify(updateFixture(sceneOverride)))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    ['undo state', { canUndo: 'false' }],
    ['redo state', { canRedo: 'false' }],
  ])('rejects an invalid %s', (_label, historyOverride) => {
    expect(() =>
      parseEngineUpdate(
        JSON.stringify(updateFixture(undefined, historyOverride as Record<string, unknown>)),
      ),
    ).toThrow('protocol V1');
  });

  it('parses pointer processing metadata around a valid engine update', () => {
    const value = {
      update: updateFixture(),
      processedEventCount: 8,
      ignoredEventCount: 1,
      didCommit: false,
    };

    expect(parsePointerUpdate(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    null,
    {},
    { update: null, processedEventCount: 1, ignoredEventCount: 0, didCommit: false },
    { update: {}, processedEventCount: '1', ignoredEventCount: 0, didCommit: false },
    { update: {}, processedEventCount: 1, ignoredEventCount: '0', didCommit: false },
    { update: {}, processedEventCount: 1, ignoredEventCount: 0, didCommit: 'false' },
  ])('rejects invalid pointer update metadata', (value) => {
    expect(() => parsePointerUpdate(JSON.stringify(value))).toThrow('invalid pointer update');
  });

  it('parses stroke processing metadata around a valid engine update', () => {
    const value = {
      update: updateFixture(),
      processedPointCount: 32,
      ignoredPointCount: 2,
      didCommit: true,
    };

    expect(parseStrokeUpdate(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    null,
    {},
    { update: null, processedPointCount: 1, ignoredPointCount: 0, didCommit: false },
    { update: {}, processedPointCount: '1', ignoredPointCount: 0, didCommit: false },
    { update: {}, processedPointCount: 1, ignoredPointCount: '0', didCommit: false },
    { update: {}, processedPointCount: 1, ignoredPointCount: 0, didCommit: 'false' },
  ])('rejects invalid stroke update metadata', (value) => {
    expect(() => parseStrokeUpdate(JSON.stringify(value))).toThrow('invalid stroke update');
  });

  it('parses an explicit deterministic scene resolution', () => {
    const resolution = {
      engineAlgorithmVersion: 'nodeink-scene-v1',
      canonicalHash: 'fnv1a64:1234',
      renderProfile: { kind: 'clean', version: 1 },
      scene: updateFixture().scene,
    };

    expect(parseSceneResolution(JSON.stringify(resolution))).toEqual(resolution);
  });

  it.each([
    null,
    {},
    { engineAlgorithmVersion: 1, canonicalHash: 'hash', renderProfile: {}, scene: {} },
    { engineAlgorithmVersion: 'v1', canonicalHash: 1, renderProfile: {}, scene: {} },
    { engineAlgorithmVersion: 'v1', canonicalHash: 'hash', renderProfile: null, scene: {} },
  ])('rejects invalid scene resolution metadata', (value) => {
    expect(() => parseSceneResolution(JSON.stringify(value))).toThrow('invalid scene resolution');
  });

  it('parses pending and resolved text fixtures', () => {
    const pending = {
      request: {
        requestId: 'measure-1',
        fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
        runs: [],
      },
      scene: null,
      canonicalHash: null,
    };
    const resolved = {
      request: null,
      scene: { fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0', runs: [] },
      canonicalHash: 'fnv1a64:text',
    };

    expect(parseTextFixtureResolution(JSON.stringify(pending))).toEqual(pending);
    expect(parseTextFixtureResolution(JSON.stringify(resolved))).toEqual(resolved);
  });

  it('parses successful and failed migration attempts', () => {
    const success = {
      result: {
        sourceSchemaVersion: 0,
        targetSchemaVersion: 1,
        migrated: true,
        document: createBlankDocument('doc-1'),
        canonicalPayload: '{}',
      },
      report: null,
    };
    const failure = {
      result: null,
      report: {
        stage: 'schema',
        code: 'unknown_schema',
        sourceSchemaVersion: 99,
        targetSchemaVersion: 1,
        message: 'unsupported',
        recovery: 'try_next_snapshot_then_readonly_diagnostic',
      },
    };

    expect(parseMigrationAttempt(JSON.stringify(success))).toEqual(success);
    expect(parseMigrationAttempt(JSON.stringify(failure))).toEqual(failure);
  });

  it.each([
    null,
    {},
    { result: {}, report: null },
    { result: null, report: {} },
    { result: null, report: { stage: 1 } },
  ])('rejects invalid migration attempts', (value) => {
    expect(() => parseMigrationAttempt(JSON.stringify(value))).toThrow('migration');
  });

  it.each([
    null,
    {},
    { request: [], scene: null, canonicalHash: null },
    { request: null, scene: [], canonicalHash: null },
    { request: null, scene: null, canonicalHash: 1 },
  ])('rejects invalid text fixture resolutions', (value) => {
    expect(() => parseTextFixtureResolution(JSON.stringify(value))).toThrow(
      'invalid text fixture resolution',
    );
  });
});

function updateFixture(
  sceneOverride: Record<string, unknown> = {},
  historyOverride: Record<string, unknown> = {},
) {
  return {
    activeTool: 'select',
    textMeasureRequest: null,
    operation: null,
    scene: {
      protocolVersion: 1,
      documentId: 'doc-1',
      documentRevision: 0,
      sceneRevision: 0,
      rootNodeIds: [],
      nodes: {},
      ...sceneOverride,
    },
    history: { canUndo: false, canRedo: false, ...historyOverride },
    selection: { selectedElementId: null, bounds: null },
  };
}

function sceneTextFixture() {
  return {
    kind: 'text' as const,
    id: 'text-1:text',
    sourceElementId: 'text-1',
    runs: [
      {
        text: '第一行',
        x: 40,
        y: 64,
        fontFamily: canvasFontFamily,
        fontSize: 20,
        fontWeight: 400 as const,
        fill: '#1f2937',
      },
      {
        text: 'Second line',
        x: 40,
        y: 88,
        fontFamily: canvasFontFamily,
        fontSize: 20,
        fontWeight: 400 as const,
        fill: '#1f2937',
      },
    ],
  };
}

function textElementFixture() {
  return {
    kind: 'text' as const,
    id: 'text-1',
    x: 40,
    y: 48,
    text: '第一行\nSecond line',
    fontFamily: canvasFontFamily,
    fontSize: 20,
    fontWeight: 400 as const,
    maxWidth: 240,
    fontFingerprint: fixtureFontFingerprint,
  };
}

function patchFixture(override: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    documentRevision: 2,
    baseSceneRevision: 1,
    sceneRevision: 2,
    addedNodes: {},
    updatedNodes: {},
    removedNodeIds: [],
    rootNodeIds: null,
    ...override,
  };
}

function diagramOperationResultFixture(override: Record<string, unknown> = {}) {
  return {
    batchId: 'batch-1',
    mode: 'apply' as const,
    previousRevision: 0,
    revision: 1 as number | null,
    results: [
      {
        opId: 'create-1',
        status: 'applied' as 'applied' | 'planned',
        affectedElementIds: ['rect-1'],
      },
    ],
    scenePatch: patchFixture(),
    ...override,
  };
}
