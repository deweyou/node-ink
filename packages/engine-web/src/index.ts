import {
  parseDiagramOperationBatchResult,
  parseEngineUpdate,
  parseMigrationAttempt,
  parsePointerUpdate,
  parseScenePatch,
  parseSceneResolution,
  parseSceneSnapshot,
  parseStrokeUpdate,
  parseTextFixtureResolution,
  type CommandEnvelopeV1,
  type DiagramOperationBatchResultV1,
  type DiagramOperationBatchV1,
  type EnginePortV1,
  type EngineUpdateV1,
  type MigrationAttemptV1,
  type NodeInkDocumentV1,
  type NormalizedPointerEventV1,
  type PointerUpdateV1,
  type RenderProfileV1,
  type SceneResolutionV1,
  type SceneBenchmarkPayloadV1,
  type ScenePatchV1,
  type SceneSnapshotV1,
  type SerializedDocumentV1,
  type StrokeInputBatchV1,
  type StrokeTransportV1,
  type StrokeUpdateV1,
  type TextFixtureResolutionV1,
  type TextMetricsSnapshotV1,
  type TextRunV1,
} from '@nodeink-internal/protocol';

interface WasmEngineHandle {
  currentUpdate(): string;
  executeCommand(commandJson: string): string;
  executeDiagramOperation(batchJson: string): string;
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
  resolveSceneProfile(profileJson: string): string;
  resolveTextFixture(
    requestId: string,
    fontFingerprint: string,
    runsJson: string,
    metricsJson: string | undefined,
  ): string;
  benchmarkSceneSnapshot(elementCount: number, movedCount: number, afterMove: boolean): string;
  benchmarkScenePatch(elementCount: number, movedCount: number): string;
  migrateDocumentPayload(payloadJson: string): string;
  engineAlgorithmVersion(): string;
  serializeDocument(): string;
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

  async executeDiagramOperation(
    batch: DiagramOperationBatchV1,
  ): Promise<DiagramOperationBatchResultV1> {
    try {
      return parseDiagramOperationBatchResult(
        this.requireHandle().executeDiagramOperation(JSON.stringify(batch)),
      );
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

  async resolveSceneProfile(profile: RenderProfileV1): Promise<SceneResolutionV1> {
    try {
      return parseSceneResolution(
        this.requireHandle().resolveSceneProfile(JSON.stringify(profile)),
      );
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  async resolveTextFixture(
    requestId: string,
    fontFingerprint: string,
    runs: TextRunV1[],
    metrics: TextMetricsSnapshotV1 | null,
  ): Promise<TextFixtureResolutionV1> {
    try {
      return parseTextFixtureResolution(
        this.requireHandle().resolveTextFixture(
          requestId,
          fontFingerprint,
          JSON.stringify(runs),
          metrics ? JSON.stringify(metrics) : undefined,
        ),
      );
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  async benchmarkSceneSnapshot(
    elementCount: number,
    movedCount: number,
    afterMove: boolean,
  ): Promise<SceneBenchmarkPayloadV1<SceneSnapshotV1>> {
    return this.benchmarkPayload(
      () => this.requireHandle().benchmarkSceneSnapshot(elementCount, movedCount, afterMove),
      parseSceneSnapshot,
    );
  }

  async benchmarkScenePatch(
    elementCount: number,
    movedCount: number,
  ): Promise<SceneBenchmarkPayloadV1<ScenePatchV1>> {
    return this.benchmarkPayload(
      () => this.requireHandle().benchmarkScenePatch(elementCount, movedCount),
      parseScenePatch,
    );
  }

  async migrateDocumentPayload(payloadJson: string): Promise<MigrationAttemptV1> {
    try {
      return parseMigrationAttempt(this.requireHandle().migrateDocumentPayload(payloadJson));
    } catch (error) {
      throw normalizeEngineError(error);
    }
  }

  engineAlgorithmVersion(): string {
    return this.requireHandle().engineAlgorithmVersion();
  }

  serializeDocument(): SerializedDocumentV1 {
    try {
      const handle = this.requireHandle();
      const canonicalPayload = handle.serializeDocument();
      const document = parseSerializedDocument(canonicalPayload);
      return {
        canonicalPayload,
        document,
        engineAlgorithmVersion: handle.engineAlgorithmVersion(),
      };
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

  private benchmarkPayload<T>(
    serialize: () => string,
    parse: (value: string) => T,
  ): SceneBenchmarkPayloadV1<T> {
    try {
      const transferStartedAt = performance.now();
      const serialized = serialize();
      const wasmSerializeAndTransferMs = performance.now() - transferStartedAt;
      const parseStartedAt = performance.now();
      const value = parse(serialized);
      const parseMs = performance.now() - parseStartedAt;
      return {
        value,
        payloadBytes: new TextEncoder().encode(serialized).byteLength,
        wasmSerializeAndTransferMs,
        parseMs,
      };
    } catch (error) {
      throw normalizeEngineError(error);
    }
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

function parseSerializedDocument(canonicalPayload: string): NodeInkDocumentV1 {
  const document = JSON.parse(canonicalPayload) as Partial<NodeInkDocumentV1>;
  if (
    document.schemaVersion !== 1 ||
    typeof document.documentId !== 'string' ||
    typeof document.revision !== 'number' ||
    !Array.isArray(document.rootOrder) ||
    typeof document.elements !== 'object' ||
    document.elements === null
  ) {
    throw new Error('Engine returned an invalid serialized Document');
  }
  return document as NodeInkDocumentV1;
}
