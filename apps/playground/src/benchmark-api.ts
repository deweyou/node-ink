import {
  runPointerBenchmark,
  type EditorWebControllerV1,
  type PointerBenchmarkResult,
} from '@nodeink-internal/editor-web';

export interface PlaygroundPointerBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s1';
  browser: string;
  os: string;
  hardware: {
    logicalProcessors: number;
    deviceMemoryGb: number | null;
    display: string;
  };
  singleEvent: PointerBenchmarkResult;
  batch8: PointerBenchmarkResult;
}

declare global {
  interface Window {
    nodeInkRunPointerBenchmark?: () => Promise<PlaygroundPointerBenchmarkReport>;
  }
}

export function exposePointerBenchmark(controller: EditorWebControllerV1): void {
  window.nodeInkRunPointerBenchmark = () => runPlaygroundPointerBenchmark(controller);
}

export async function runPlaygroundPointerBenchmark(
  controller: EditorWebControllerV1,
): Promise<PlaygroundPointerBenchmarkReport> {
  if (!controller.getSnapshot().activeElementId) {
    const created = await controller.dispatch({ type: 'create_rectangle' });
    if (!created.ok) {
      throw new Error(created.snapshot.errorMessage ?? 'failed to create benchmark rectangle');
    }
  }
  const elementId = controller.getSnapshot().activeElementId;
  if (!elementId) {
    throw new Error('benchmark rectangle is not active');
  }

  const singleEvent = await runPointerBenchmark({ controller, elementId, batchSize: 1 });
  const batch8 = await runPointerBenchmark({ controller, elementId, batchSize: 8 });
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s1',
    browser: navigator.userAgent,
    os: navigator.platform,
    hardware: {
      logicalProcessors: navigator.hardwareConcurrency,
      deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
      display: `${screen.width}x${screen.height}@${window.devicePixelRatio}x`,
    },
    singleEvent,
    batch8,
  };
}
