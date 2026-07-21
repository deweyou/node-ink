import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandEnvelopeV1 } from '@nodeink-internal/protocol';
import { createBlankDocument } from '@nodeink-internal/protocol';

const wasm = vi.hoisted(() => {
  const handle = {
    currentUpdate: vi.fn(),
    executeCommand: vi.fn(),
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

    await expect(engine.currentUpdate()).resolves.toMatchObject({
      scene: { documentRevision: 0 },
    });
    await expect(engine.executeCommand(command)).resolves.toMatchObject({
      history: { canUndo: false },
    });
    await expect(engine.undo()).resolves.toBeDefined();
    await expect(engine.redo()).resolves.toBeDefined();

    expect(wasm.default).toHaveBeenCalledOnce();
    expect(wasm.openDocument).toHaveBeenCalledWith(JSON.stringify(document));
    expect(wasm.handle.executeCommand).toHaveBeenCalledWith(JSON.stringify(command));
  });

  it('normalizes structured and plain engine failures', async () => {
    const engine = await createWasmEngine(createBlankDocument('doc-1'));
    const command = commandFixture();

    wasm.handle.executeCommand.mockImplementation(() => {
      throw new Error(JSON.stringify({ code: 'revision_conflict', message: 'stale revision' }));
    });
    await expect(engine.executeCommand(command)).rejects.toThrow('stale revision');

    wasm.handle.undo.mockImplementation(() => {
      throw JSON.stringify({ code: 'undo_unavailable' });
    });
    await expect(engine.undo()).rejects.toThrow('undo_unavailable');

    wasm.handle.redo.mockImplementation(() => {
      throw new Error('plain engine failure');
    });
    await expect(engine.redo()).rejects.toThrow('plain engine failure');
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
