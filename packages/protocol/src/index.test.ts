import { describe, expect, it } from 'vitest';

import { createBlankDocument, parseEngineUpdate } from './index';

describe('protocol V1', () => {
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
        }),
      ),
    ).toThrow('protocol V1');
  });

  it('parses a valid engine update', () => {
    const update = {
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
    };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it.each([null, {}, { scene: null, history: {} }, { scene: {}, history: null }])(
    'rejects structurally invalid update payloads',
    (value) => {
      expect(() => parseEngineUpdate(JSON.stringify(value))).toThrow('invalid update payload');
    },
  );

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
});

function updateFixture(
  sceneOverride: Record<string, unknown> = {},
  historyOverride: Record<string, unknown> = {},
) {
  return {
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
  };
}
