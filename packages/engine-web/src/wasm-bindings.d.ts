declare module '*nodeink_engine.js' {
  export class EngineHandle {
    currentUpdate(): string;
    executeCommand(commandJson: string): string;
    handlePointerEvents(eventsJson: string, commandId: string): string;
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
