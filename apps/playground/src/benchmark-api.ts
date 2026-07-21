import {
  runPointerBenchmark,
  runStrokeBenchmark,
  type EditorWebControllerV1,
  type PointerBenchmarkResult,
  type StrokeBenchmarkReportV1,
} from '@nodeink-internal/editor-web';
import { createWasmEngine } from '@nodeink-internal/engine-web';
import type {
  NodeInkDocumentV1,
  RenderProfileV1,
  SceneResolutionV1,
} from '@nodeink-internal/protocol';

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

export interface PlaygroundSketchBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'nodeink-scene-v1';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  sample: {
    repeatedResolutions: 1000;
    fixtureElements: 2;
  };
  hashes: Record<string, string>;
  nativeExpectedHashes: Record<string, string>;
  metrics: {
    elapsedMs: number;
    uniqueRepeatedHashCount: number;
  };
  decision: {
    isStableAcrossOneThousandRuns: boolean;
    matchesNativeHashes: boolean;
    seedAndProfileProduceDistinctHashes: boolean;
  };
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
    nodeInkRunSketchBenchmark?: () => Promise<PlaygroundSketchBenchmarkReport>;
  }
}

export function exposePointerBenchmark(controller: EditorWebControllerV1): void {
  window.nodeInkRunPointerBenchmark = () => runPlaygroundPointerBenchmark(controller);
  window.nodeInkRunStrokeBenchmark = () => runPlaygroundStrokeBenchmark(controller);
  window.nodeInkRunSketchBenchmark = () => runPlaygroundSketchBenchmark();
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

export async function runPlaygroundSketchBenchmark(): Promise<PlaygroundSketchBenchmarkReport> {
  const engine = await createWasmEngine(sketchFixtureDocument());
  const profiles: Record<string, RenderProfileV1> = {
    clean: { kind: 'clean', version: 1 },
    sketchSeed42: sketchProfile(42, 1.2),
    sketchSeed43: sketchProfile(43, 1.2),
    sketchRoughness2: sketchProfile(42, 2),
  };
  const nativeExpectedHashes = {
    clean: 'fnv1a64:161767abbb52ac49',
    sketchRoughness2: 'fnv1a64:b52452b806f9f8f5',
    sketchSeed42: 'fnv1a64:ddce7e37dbe5a687',
    sketchSeed43: 'fnv1a64:9c7c25290e150686',
  };
  try {
    const resolutions = await Promise.all(
      Object.entries(profiles).map(
        async ([name, profile]) => [name, await engine.resolveSceneProfile(profile)] as const,
      ),
    );
    const hashes = Object.fromEntries(
      resolutions.map(([name, resolution]) => [name, resolution.canonicalHash]),
    );
    const repeatedHashes = new Set<string>();
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      const repeated = await engine.resolveSceneProfile(profiles.sketchSeed42!);
      repeatedHashes.add(repeated.canonicalHash);
    }
    const elapsedMs = performance.now() - startedAt;
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: assertAlgorithmVersion(resolutions[0]?.[1]),
      ...benchmarkEnvironment(),
      sample: { repeatedResolutions: 1_000, fixtureElements: 2 },
      hashes,
      nativeExpectedHashes,
      metrics: {
        elapsedMs,
        uniqueRepeatedHashCount: repeatedHashes.size,
      },
      decision: {
        isStableAcrossOneThousandRuns:
          repeatedHashes.size === 1 && repeatedHashes.has(hashes.sketchSeed42 ?? ''),
        matchesNativeHashes: Object.entries(nativeExpectedHashes).every(
          ([name, hash]) => hashes[name] === hash,
        ),
        seedAndProfileProduceDistinctHashes: new Set(Object.values(hashes)).size === 4,
      },
    };
  } finally {
    engine.dispose();
  }
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

function sketchFixtureDocument(): NodeInkDocumentV1 {
  return {
    schemaVersion: 1,
    documentId: 'sketch-fixture',
    revision: 0,
    rootOrder: ['rect-1', 'stroke-1'],
    elements: {
      'rect-1': {
        kind: 'rect',
        id: 'rect-1',
        x: 24,
        y: 40,
        width: 160,
        height: 96,
      },
      'stroke-1': {
        kind: 'stroke',
        id: 'stroke-1',
        points: [
          { x: 8, y: 12 },
          { x: 24, y: 28 },
          { x: 48, y: 16 },
        ],
        strokeWidth: 3,
      },
    },
  };
}

function sketchProfile(seed: number, roughness: number): RenderProfileV1 {
  return {
    kind: 'sketch',
    version: 1,
    seed,
    roughness,
    bowing: 0.8,
    fillStyle: 'hachure',
  };
}

function assertAlgorithmVersion(resolution: SceneResolutionV1 | undefined): 'nodeink-scene-v1' {
  if (resolution?.engineAlgorithmVersion !== 'nodeink-scene-v1') {
    throw new Error(`unexpected engine algorithm version: ${resolution?.engineAlgorithmVersion}`);
  }
  return resolution.engineAlgorithmVersion;
}
