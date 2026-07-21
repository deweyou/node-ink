import {
  parseEngineUpdate,
  type CommandEnvelopeV1,
  type EnginePortV1,
  type EngineUpdateV1,
  type NodeInkDocumentV1,
} from '@nodeink-internal/protocol';

interface WasmEngineHandle {
  currentUpdate(): string;
  executeCommand(commandJson: string): string;
  undo(): string;
  redo(): string;
  free(): void;
}

interface WasmEngineModule {
  default(): Promise<unknown>;
  openDocument(documentJson: string): WasmEngineHandle;
}

export async function createWasmEngine(document: NodeInkDocumentV1): Promise<EnginePortV1> {
  const wasmModule =
    (await import('../generated/nodeink_engine.js')) as unknown as WasmEngineModule;
  await wasmModule.default();
  const handle = wasmModule.openDocument(JSON.stringify(document));
  return new WasmEnginePort(handle);
}

class WasmEnginePort implements EnginePortV1 {
  #handle: WasmEngineHandle | null;

  constructor(handle: WasmEngineHandle) {
    this.#handle = handle;
  }

  async currentUpdate(): Promise<EngineUpdateV1> {
    return parseEngineUpdate(this.requireHandle().currentUpdate());
  }

  async executeCommand(command: CommandEnvelopeV1): Promise<EngineUpdateV1> {
    try {
      return parseEngineUpdate(this.requireHandle().executeCommand(JSON.stringify(command)));
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  async undo(): Promise<EngineUpdateV1> {
    try {
      return parseEngineUpdate(this.requireHandle().undo());
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  async redo(): Promise<EngineUpdateV1> {
    try {
      return parseEngineUpdate(this.requireHandle().redo());
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  dispose(): void {
    this.#handle?.free();
    this.#handle = null;
  }

  private requireHandle(): WasmEngineHandle {
    if (!this.#handle) {
      throw new Error('NodeInk engine has been disposed');
    }
    return this.#handle;
  }
}

function normalizeEngineError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message) as { code?: string; message?: string };
    return new Error(parsed.message ?? parsed.code ?? 'NodeInk engine command failed');
  } catch {
    return new Error(message);
  }
}
