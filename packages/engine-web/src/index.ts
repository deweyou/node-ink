import {
  parseEngineUpdate,
  parsePointerUpdate,
  parseStrokeUpdate,
  type CommandEnvelopeV1,
  type EnginePortV1,
  type EngineUpdateV1,
  type NodeInkDocumentV1,
  type NormalizedPointerEventV1,
  type PointerUpdateV1,
  type StrokeInputBatchV1,
  type StrokeTransportV1,
  type StrokeUpdateV1,
} from '@nodeink-internal/protocol';

interface WasmEngineHandle {
  currentUpdate(): string;
  executeCommand(commandJson: string): string;
  handlePointerEvents(eventsJson: string, commandId: string): string;
  handleStrokeBatchJson(batchJson: string, commandId: string): string;
  handleStrokePoints(
    pointerId: number,
    sequenceStart: number,
    phase: string,
    coordinates: Float64Array,
    strokeId: string | undefined,
    commandId: string,
  ): string;
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

  async handlePointerEvents(
    events: NormalizedPointerEventV1[],
    commandId: string,
  ): Promise<PointerUpdateV1> {
    try {
      return parsePointerUpdate(
        this.requireHandle().handlePointerEvents(JSON.stringify(events), commandId),
      );
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  async handleStrokeBatch(
    batch: StrokeInputBatchV1,
    commandId: string,
    transport: StrokeTransportV1,
  ): Promise<StrokeUpdateV1> {
    try {
      const handle = this.requireHandle();
      const serialized =
        transport === 'json'
          ? handle.handleStrokeBatchJson(JSON.stringify(batch), commandId)
          : handle.handleStrokePoints(
              batch.pointerId,
              batch.sequenceStart,
              batch.phase,
              packCoordinates(batch),
              batch.strokeId ?? undefined,
              commandId,
            );
      return parseStrokeUpdate(serialized);
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

function packCoordinates(batch: StrokeInputBatchV1): Float64Array {
  const coordinates = new Float64Array(batch.points.length * 2);
  for (const [index, point] of batch.points.entries()) {
    coordinates[index * 2] = point.x;
    coordinates[index * 2 + 1] = point.y;
  }
  return coordinates;
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
