import {
  runPointerBenchmark,
  runStrokeBenchmark,
  type EditorWebControllerV1,
  type PointerBenchmarkResult,
  type StrokeBenchmarkReportV1,
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

export interface PlaygroundStrokeBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s2';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  benchmark: StrokeBenchmarkReportV1;
}

interface PlaygroundBenchmarkHardware {
  logicalProcessors: number;
  deviceMemoryGb: number | null;
  display: string;
}

declare global {
  interface Window {
    nodeInkRunPointerBenchmark?: () => Promise<PlaygroundPointerBenchmarkReport>;
    nodeInkRunStrokeBenchmark?: () => Promise<PlaygroundStrokeBenchmarkReport>;
  }
}

export function exposePointerBenchmark(controller: EditorWebControllerV1): void {
  window.nodeInkRunPointerBenchmark = () => runPlaygroundPointerBenchmark(controller);
  window.nodeInkRunStrokeBenchmark = () => runPlaygroundStrokeBenchmark(controller);
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
  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s1',
    ...benchmarkEnvironment(),
    singleEvent,
    batch8,
  };
}

export async function runPlaygroundStrokeBenchmark(
  controller: EditorWebControllerV1,
): Promise<PlaygroundStrokeBenchmarkReport> {
  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s2',
    ...benchmarkEnvironment(),
    benchmark: await runStrokeBenchmark({ controller }),
  };
}

function benchmarkEnvironment() {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  return {
    browser: navigator.userAgent,
    os: navigator.platform,
    hardware: {
      logicalProcessors: navigator.hardwareConcurrency,
      deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
      display: `${screen.width}x${screen.height}@${window.devicePixelRatio}x`,
    },
  };
}
