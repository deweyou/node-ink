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
});
