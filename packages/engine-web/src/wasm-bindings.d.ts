declare module '*nodeink_engine.js' {
  export class EngineHandle {
    currentUpdate(): string;
    currentCamera(): string;
    setCamera(cameraJson: string): string;
    fitCamera(viewportWidth: number, viewportHeight: number, padding: number): string;
    applyCameraAction(actionJson: string): string;
    executeCommand(commandJson: string): string;
    setSelection(elementId: string | undefined): string;
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
    undo(): string;
    redo(): string;
    serializeDocument(): string;
    free(): void;
  }

  export function openDocument(documentJson: string): EngineHandle;
  export default function initializeWasm(
    input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
  ): Promise<WebAssembly.Exports>;
}
