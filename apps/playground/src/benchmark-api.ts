import {
  attachImeComposition,
  CanvasTextMetricsAdapter,
  runPointerBenchmark,
  runStrokeBenchmark,
  type EditorWebControllerV1,
  type PointerBenchmarkResult,
  type StrokeBenchmarkReportV1,
} from '@nodeink-internal/editor-web';
import { createWasmEngine } from '@nodeink-internal/engine-web';
import {
  AtomicSnapshotPersistenceV1,
  deleteNodeInkDatabase,
  IndexedDbSnapshotStoreV1,
  recoverCopyOnWriteV1,
  sha256Hex,
  type SaveInterruptionV1,
  type SnapshotRecordV1,
} from '@nodeink-internal/persistence-web';
import type {
  NodeInkDocumentV1,
  RenderProfileV1,
  SceneBenchmarkPayloadV1,
  SceneNodeV1,
  ScenePatchV1,
  SceneResolutionV1,
  SceneSnapshotV1,
  TextRunV1,
} from '@nodeink-internal/protocol';
import { SvgRenderer } from '@nodeink-internal/renderer-svg';

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

export interface PlaygroundTextBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s4';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  sample: { runs: 3; repeatedResolutions: 1000; includesImeComposition: true };
  metrics: {
    measureRequestRunCount: number;
    firstMeasuredRunCount: number;
    cachedHitCount: number;
    firstMeasureMs: number;
    cachedMeasureMs: number;
    firstResolveMs: number;
    cachedResolveMs: number;
    uniqueRepeatedHashCount: number;
    imeCommitCount: number;
  };
  fingerprints: { before: string; afterInvalidation: string };
  hashes: { before: string; afterInvalidation: string };
  decision: {
    compositionWasNotInterrupted: boolean;
    sameMetricsFixtureIsStable: boolean;
    fontChangeInvalidatesFingerprintAndHash: boolean;
    cacheHitAvoidsRemeasure: boolean;
  };
}

export interface PlaygroundScenePatchBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s5';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  sample: { iterationsPerScenario: 20; frameBudgetMs: 16.7 };
  scenarios: ScenePatchScenarioReport[];
  recovery: { stalePatchResult: 'snapshot_required' };
  decision: {
    outOfOrderPatchAlwaysRequiresSnapshot: boolean;
    oneThousandMoveOneP95WithinFrameBudget: boolean;
    patchPayloadSmallerInEveryScenario: boolean;
  };
}

export interface PlaygroundSvgScaleBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s6';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  sample: {
    mountIterations: 10;
    interactionIterations: 20;
    frameBudgetMs: 16.7;
    visibleElementCap: 1_000;
  };
  scenarios: SvgScaleScenarioReport[];
  decision: {
    unculledSourceElementBudget: Record<SvgFixtureKind, number>;
    cullingRequiredAboveSourceElements: Record<SvgFixtureKind, number>;
    canvasEvaluationAboveVisibleDomNodes: number;
    tenThousandSourceElementsRemainInteractiveWhenCulled: boolean;
    cullingOwner: 'scene-resolution-host';
  };
}

export interface PlaygroundPersistenceBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s7';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  capability: { indexedDb: true; strictDurability: boolean; sha256: true };
  sample: { iterationsPerPayloadSize: 5; payloadSizesBytes: [1_048_576, 10_485_760] };
  scenarios: PersistenceSizeScenarioReport[];
  interruptions: PersistenceInterruptionReport[];
  decision: {
    everyCompletedSaveReadBackVerified: boolean;
    everyInterruptionRecoveredStableSnapshot: boolean;
    noHalfSnapshotOpened: boolean;
  };
}

export interface PlaygroundMigrationBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s8';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  fixtures: Array<{
    name: 'valid_v1' | 'legacy_v0' | 'unknown_schema' | 'corrupt_field' | 'migration_failure';
    migrated: boolean | null;
    reportCode: string | null;
    elapsedMs: number;
  }>;
  copyOnWrite: {
    sourceBytesUnchanged: boolean;
    requiresPersistedCopy: boolean;
    migratedSchemaVersion: number;
  };
  fallback: {
    hashMismatchRecoveredFrom: 'stable';
    schemaFailureRecoveredFrom: 'stable';
    exhaustedRecovery: 'readonly_diagnostic';
    exhaustedReportCodes: string[];
  };
  decision: {
    sourcePayloadNeverOverwritten: boolean;
    everyFailureHasStructuredReport: boolean;
    everyFixtureHasDeterministicRecovery: boolean;
  };
}

interface PersistenceSizeScenarioReport {
  payloadBytes: 1_048_576 | 10_485_760;
  iterations: 5;
  serializationMs: Percentiles;
  hashMs: Percentiles;
  candidateTransactionMs: Percentiles;
  readBackMs: Percentiles;
  readBackHashMs: Percentiles;
  validationMainThreadMs: Percentiles;
  stableTransactionMs: Percentiles;
  totalSaveMs: Percentiles;
  longTasks: { supported: boolean; count: number; totalDurationMs: number };
  recoveredRevision: number;
}

interface PersistenceInterruptionReport {
  phase: Exclude<SaveInterruptionV1, null> | 'after_stable';
  headRevision: number;
  recoveredRevision: number;
  recoveredStatus: 'stable';
}

type SvgFixtureKind = 'simple_path' | 'text_run' | 'sketch_multi_path';

interface SvgScaleScenarioReport {
  kind: SvgFixtureKind;
  sourceElementCount: 1_000 | 5_000 | 10_000;
  fullSceneNodeCount: number;
  fullSvgDomNodeCount: number;
  culledSceneNodeCount: number;
  culledSvgDomNodeCount: number;
  fullMountMs: Percentiles;
  culledMountMs: Percentiles;
  cameraPanMs: Percentiles;
  singleNodePatchMs: Percentiles;
}

interface ScenePatchScenarioReport {
  elementCount: 100 | 1_000 | 10_000;
  movedCount: 1 | 100;
  snapshot: ScenePipelineMetrics;
  patch: ScenePipelineMetrics;
  ratios: { payload: number; pipelineP95: number };
}

interface ScenePipelineMetrics {
  payloadBytes: number;
  wasmSerializeAndTransferMs: Percentiles;
  parseMs: Percentiles;
  svgApplyMs: Percentiles;
  pipelineMs: Percentiles;
}

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
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
    nodeInkRunTextBenchmark?: () => Promise<PlaygroundTextBenchmarkReport>;
    nodeInkRunScenePatchBenchmark?: () => Promise<PlaygroundScenePatchBenchmarkReport>;
    nodeInkRunSvgScaleBenchmark?: () => Promise<PlaygroundSvgScaleBenchmarkReport>;
    nodeInkRunPersistenceBenchmark?: () => Promise<PlaygroundPersistenceBenchmarkReport>;
    nodeInkRunMigrationBenchmark?: () => Promise<PlaygroundMigrationBenchmarkReport>;
  }
}

export function exposePointerBenchmark(controller: EditorWebControllerV1): void {
  window.nodeInkRunPointerBenchmark = () => runPlaygroundPointerBenchmark(controller);
  window.nodeInkRunStrokeBenchmark = () => runPlaygroundStrokeBenchmark(controller);
  window.nodeInkRunSketchBenchmark = () => runPlaygroundSketchBenchmark();
  window.nodeInkRunTextBenchmark = () => runPlaygroundTextBenchmark();
  window.nodeInkRunScenePatchBenchmark = () => runPlaygroundScenePatchBenchmark();
  window.nodeInkRunSvgScaleBenchmark = () => runPlaygroundSvgScaleBenchmark();
  window.nodeInkRunPersistenceBenchmark = () => runPlaygroundPersistenceBenchmark();
  window.nodeInkRunMigrationBenchmark = () => runPlaygroundMigrationBenchmark();
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

export async function runPlaygroundTextBenchmark(): Promise<PlaygroundTextBenchmarkReport> {
  const engine = await createWasmEngine({
    schemaVersion: 1,
    documentId: 'text-fixture',
    revision: 0,
    rootOrder: [],
    elements: {},
  });
  const adapter = new CanvasTextMetricsAdapter({
    fixedFontFamily: 'Arial',
    fontEpoch: 'nodeink-fixture-font-v1',
  });
  const runs = textFixtureRuns();
  try {
    const before = adapter.fingerprint();
    const pending = await engine.resolveTextFixture('measure-1', before, runs, null);
    if (!pending.request) {
      throw new Error('text fixture did not request browser metrics');
    }
    const firstMeasured = adapter.measure(pending.request);
    const firstResolveStarted = performance.now();
    const firstResolved = await engine.resolveTextFixture(
      'measure-1',
      before,
      runs,
      firstMeasured.snapshot,
    );
    const firstResolveMs = performance.now() - firstResolveStarted;

    const cachedPending = await engine.resolveTextFixture('measure-2', before, runs, null);
    if (!cachedPending.request) {
      throw new Error('cached text fixture did not request metrics');
    }
    const cachedMeasured = adapter.measure(cachedPending.request);
    const cachedResolveStarted = performance.now();
    const cachedResolved = await engine.resolveTextFixture(
      'measure-2',
      before,
      runs,
      cachedMeasured.snapshot,
    );
    const cachedResolveMs = performance.now() - cachedResolveStarted;

    const repeatedHashes = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      const repeated = await engine.resolveTextFixture(
        `repeat-${index}`,
        before,
        runs,
        firstMeasured.snapshot,
      );
      repeatedHashes.add(repeated.canonicalHash ?? 'missing');
    }

    adapter.invalidateFont('nodeink-fixture-font-v2');
    const afterInvalidation = adapter.fingerprint();
    const invalidatedPending = await engine.resolveTextFixture(
      'measure-3',
      afterInvalidation,
      runs,
      null,
    );
    if (!invalidatedPending.request) {
      throw new Error('font invalidation did not request metrics');
    }
    const invalidatedMeasured = adapter.measure(invalidatedPending.request);
    const invalidatedResolved = await engine.resolveTextFixture(
      'measure-3',
      afterInvalidation,
      runs,
      invalidatedMeasured.snapshot,
    );
    const ime = runImeFixture();
    const beforeHash = firstResolved.canonicalHash ?? 'missing';
    const afterHash = invalidatedResolved.canonicalHash ?? 'missing';
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: 'phase0-s4',
      ...benchmarkEnvironment(),
      sample: { runs: 3, repeatedResolutions: 1_000, includesImeComposition: true },
      metrics: {
        measureRequestRunCount: pending.request.runs.length,
        firstMeasuredRunCount: firstMeasured.measuredRunCount,
        cachedHitCount: cachedMeasured.cacheHitCount,
        firstMeasureMs: firstMeasured.durationMs,
        cachedMeasureMs: cachedMeasured.durationMs,
        firstResolveMs,
        cachedResolveMs,
        uniqueRepeatedHashCount: repeatedHashes.size,
        imeCommitCount: ime.commitCount,
      },
      fingerprints: { before, afterInvalidation },
      hashes: { before: beforeHash, afterInvalidation: afterHash },
      decision: {
        compositionWasNotInterrupted:
          ime.committedDuringComposition === false && ime.commitCount === 1,
        sameMetricsFixtureIsStable:
          repeatedHashes.size === 1 &&
          repeatedHashes.has(beforeHash) &&
          cachedResolved.canonicalHash === beforeHash,
        fontChangeInvalidatesFingerprintAndHash:
          before !== afterInvalidation && beforeHash !== afterHash,
        cacheHitAvoidsRemeasure:
          cachedMeasured.cacheHitCount === runs.length && cachedMeasured.measuredRunCount === 0,
      },
    };
  } finally {
    engine.dispose();
  }
}

export async function runPlaygroundScenePatchBenchmark(): Promise<PlaygroundScenePatchBenchmarkReport> {
  const engine = await createWasmEngine({
    schemaVersion: 1,
    documentId: 'scene-patch-benchmark',
    revision: 0,
    rootOrder: [],
    elements: {},
  });
  const fixturePairs = [
    [100, 1],
    [100, 100],
    [1_000, 1],
    [1_000, 100],
    [10_000, 1],
    [10_000, 100],
  ] as const;
  try {
    const scenarios: ScenePatchScenarioReport[] = [];
    for (const [elementCount, movedCount] of fixturePairs) {
      const before = await engine.benchmarkSceneSnapshot(elementCount, movedCount, false);
      const snapshotSamples: PipelineSample[] = [];
      const patchSamples: PipelineSample[] = [];
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const after = await engine.benchmarkSceneSnapshot(elementCount, movedCount, true);
        const patch = await engine.benchmarkScenePatch(elementCount, movedCount);
        snapshotSamples.push(measureSnapshotPipeline(before.value, after));
        patchSamples.push(measurePatchPipeline(before.value, patch));
      }
      const snapshot = summarizePipeline(snapshotSamples);
      const patch = summarizePipeline(patchSamples);
      scenarios.push({
        elementCount,
        movedCount,
        snapshot,
        patch,
        ratios: {
          payload: round(patch.payloadBytes / snapshot.payloadBytes),
          pipelineP95: round(patch.pipelineMs.p95 / snapshot.pipelineMs.p95),
        },
      });
    }

    const recoveryRenderer = new SvgRenderer();
    const recoveryTarget = document.createElement('div');
    recoveryRenderer.mount(recoveryTarget);
    const recoveryBefore = await engine.benchmarkSceneSnapshot(100, 1, false);
    const recoveryPatch = await engine.benchmarkScenePatch(100, 1);
    recoveryRenderer.applySnapshot(recoveryBefore.value);
    const firstPatch = recoveryRenderer.applyPatch(recoveryPatch.value);
    if (!firstPatch.ok) throw new Error('ordered recovery fixture patch was rejected');
    const stalePatch = recoveryRenderer.applyPatch(recoveryPatch.value);
    recoveryRenderer.unmount();
    const stalePatchResult = stalePatch.ok ? 'unexpected_success' : stalePatch.reason;
    if (stalePatchResult !== 'snapshot_required') {
      throw new Error(`stale patch did not require snapshot: ${stalePatchResult}`);
    }

    const oneThousandMoveOne = scenarios.find(
      (scenario) => scenario.elementCount === 1_000 && scenario.movedCount === 1,
    );
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: 'phase0-s5',
      ...benchmarkEnvironment(),
      sample: { iterationsPerScenario: 20, frameBudgetMs: 16.7 },
      scenarios,
      recovery: { stalePatchResult },
      decision: {
        outOfOrderPatchAlwaysRequiresSnapshot: stalePatchResult === 'snapshot_required',
        oneThousandMoveOneP95WithinFrameBudget:
          (oneThousandMoveOne?.patch.pipelineMs.p95 ?? Number.POSITIVE_INFINITY) <= 16.7,
        patchPayloadSmallerInEveryScenario: scenarios.every(
          (scenario) => scenario.patch.payloadBytes < scenario.snapshot.payloadBytes,
        ),
      },
    };
  } finally {
    engine.dispose();
  }
}

export async function runPlaygroundSvgScaleBenchmark(): Promise<PlaygroundSvgScaleBenchmarkReport> {
  const kinds: SvgFixtureKind[] = ['simple_path', 'text_run', 'sketch_multi_path'];
  const sourceCounts = [1_000, 5_000, 10_000] as const;
  const scenarios: SvgScaleScenarioReport[] = [];
  for (const kind of kinds) {
    for (const sourceElementCount of sourceCounts) {
      const full = svgScaleScene(kind, sourceElementCount, sourceElementCount, 1);
      const culled = svgScaleScene(kind, sourceElementCount, 1_000, 1);
      const fullMount = measureSvgMount(full, 10);
      const culledMount = measureSvgMount(culled, 10);
      const interactions = measureSvgInteractions(full, 20);
      scenarios.push({
        kind,
        sourceElementCount,
        fullSceneNodeCount: full.rootNodeIds.length,
        fullSvgDomNodeCount: fullMount.domNodeCount,
        culledSceneNodeCount: culled.rootNodeIds.length,
        culledSvgDomNodeCount: culledMount.domNodeCount,
        fullMountMs: percentiles(fullMount.durations),
        culledMountMs: percentiles(culledMount.durations),
        cameraPanMs: percentiles(interactions.cameraPanDurations),
        singleNodePatchMs: percentiles(interactions.patchDurations),
      });
      await yieldToBrowser();
    }
  }

  const unculledSourceElementBudget = Object.fromEntries(
    kinds.map((kind) => {
      const withinBudget = scenarios.filter(
        (scenario) =>
          scenario.kind === kind &&
          scenario.fullMountMs.p95 <= 16.7 &&
          scenario.cameraPanMs.p95 <= 16.7 &&
          scenario.singleNodePatchMs.p95 <= 16.7,
      );
      return [kind, Math.max(0, ...withinBudget.map((scenario) => scenario.sourceElementCount))];
    }),
  ) as Record<SvgFixtureKind, number>;
  const visibleDomBudgets = kinds.map((kind) =>
    Math.max(
      0,
      ...scenarios
        .filter((scenario) => scenario.kind === kind && scenario.fullMountMs.p95 <= 16.7)
        .map((scenario) => scenario.fullSvgDomNodeCount),
    ),
  );
  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s6',
    ...benchmarkEnvironment(),
    sample: {
      mountIterations: 10,
      interactionIterations: 20,
      frameBudgetMs: 16.7,
      visibleElementCap: 1_000,
    },
    scenarios,
    decision: {
      unculledSourceElementBudget,
      cullingRequiredAboveSourceElements: { ...unculledSourceElementBudget },
      canvasEvaluationAboveVisibleDomNodes: Math.min(...visibleDomBudgets) + 1,
      tenThousandSourceElementsRemainInteractiveWhenCulled: scenarios
        .filter((scenario) => scenario.sourceElementCount === 10_000)
        .every(
          (scenario) =>
            scenario.culledMountMs.p95 <= 16.7 &&
            scenario.cameraPanMs.p95 <= 16.7 &&
            scenario.singleNodePatchMs.p95 <= 16.7,
        ),
      cullingOwner: 'scene-resolution-host',
    },
  };
}

export async function runPlaygroundPersistenceBenchmark(): Promise<PlaygroundPersistenceBenchmarkReport> {
  const databaseName = `nodeink-s7-${crypto.randomUUID()}`;
  const store = await IndexedDbSnapshotStoreV1.open(databaseName);
  const strictDurability = store.probeStrictDurability();
  const durability = strictDurability ? 'strict' : 'relaxed';
  const persistence = new AtomicSnapshotPersistenceV1({
    store,
    validatePayload: validateBenchmarkDocument,
  });
  try {
    const scenarios: PersistenceSizeScenarioReport[] = [];
    for (const payloadBytes of [1_048_576, 10_485_760] as const) {
      scenarios.push(await measurePersistenceSize(persistence, payloadBytes, durability));
    }
    const interruptions = await measurePersistenceInterruptions(persistence, store, durability);
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: 'phase0-s7',
      ...benchmarkEnvironment(),
      capability: { indexedDb: true, strictDurability, sha256: true },
      sample: {
        iterationsPerPayloadSize: 5,
        payloadSizesBytes: [1_048_576, 10_485_760],
      },
      scenarios,
      interruptions,
      decision: {
        everyCompletedSaveReadBackVerified: scenarios.every(
          (scenario) => scenario.recoveredRevision === scenario.iterations,
        ),
        everyInterruptionRecoveredStableSnapshot: interruptions.every((result) =>
          result.phase === 'after_stable'
            ? result.recoveredRevision === 2
            : result.recoveredRevision === 1,
        ),
        noHalfSnapshotOpened: interruptions.every((result) => result.recoveredStatus === 'stable'),
      },
    };
  } finally {
    store.close();
    await deleteNodeInkDatabase(databaseName);
  }
}

export async function runPlaygroundMigrationBenchmark(): Promise<PlaygroundMigrationBenchmarkReport> {
  const engine = await createWasmEngine({
    schemaVersion: 1,
    documentId: 'migration-runner',
    revision: 0,
    rootOrder: [],
    elements: {},
  });
  const fixturePayloads = {
    valid_v1: validMigrationPayload(),
    legacy_v0: legacyMigrationPayload(),
    unknown_schema: '{"schemaVersion":99}',
    corrupt_field:
      '{"schemaVersion":1,"documentId":"doc-1","revision":"bad","rootOrder":[],"elements":{}}',
    migration_failure:
      '{"schemaVersion":0,"documentId":"doc-1","revision":0,"rootOrder":["plugin-1"],"elements":{"plugin-1":{"kind":"legacy_plugin","id":"plugin-1"}}}',
  } as const;
  try {
    const fixtures: PlaygroundMigrationBenchmarkReport['fixtures'] = [];
    for (const [name, payloadJson] of Object.entries(fixturePayloads) as Array<
      [keyof typeof fixturePayloads, string]
    >) {
      const startedAt = performance.now();
      const attempt = await engine.migrateDocumentPayload(payloadJson);
      fixtures.push({
        name,
        migrated: attempt.result?.migrated ?? null,
        reportCode: attempt.report?.code ?? null,
        elapsedMs: round(performance.now() - startedAt),
      });
    }

    const legacyBytes = new TextEncoder().encode(fixturePayloads.legacy_v0);
    const sourceCopy = [...legacyBytes];
    const legacySnapshot = await migrationSnapshot('legacy@0', 0, legacyBytes);
    const migrated = await recoverCopyOnWriteV1({
      candidates: [{ source: 'head', snapshot: legacySnapshot }],
      migrationPort: engine,
    });
    if (!migrated.ok) throw new Error('valid legacy fixture did not migrate');
    const migratedDocument = JSON.parse(new TextDecoder().decode(migrated.canonicalPayload)) as {
      schemaVersion?: number;
    };

    const corruptHead = await migrationSnapshot(
      'corrupt@2',
      1,
      new TextEncoder().encode(validMigrationPayload()),
    );
    corruptHead.integrity.digest = 'corrupt-digest';
    const stable = await migrationSnapshot(
      'stable@1',
      1,
      new TextEncoder().encode(validMigrationPayload()),
    );
    const hashFallback = await recoverCopyOnWriteV1({
      candidates: [
        { source: 'head', snapshot: corruptHead },
        { source: 'stable', snapshot: stable },
      ],
      migrationPort: engine,
    });
    if (!hashFallback.ok) throw new Error('hash fallback did not recover stable fixture');

    const unknown = await migrationSnapshot(
      'unknown@2',
      99,
      new TextEncoder().encode(fixturePayloads.unknown_schema),
    );
    const schemaFallback = await recoverCopyOnWriteV1({
      candidates: [
        { source: 'head', snapshot: unknown },
        { source: 'stable', snapshot: stable },
      ],
      migrationPort: engine,
    });
    if (!schemaFallback.ok) throw new Error('schema fallback did not recover stable fixture');

    const migrationFailure = await migrationSnapshot(
      'migration-failure@1',
      0,
      new TextEncoder().encode(fixturePayloads.migration_failure),
    );
    const exhausted = await recoverCopyOnWriteV1({
      candidates: [
        { source: 'head', snapshot: unknown },
        { source: 'stable', snapshot: migrationFailure },
      ],
      migrationPort: engine,
    });
    if (exhausted.ok) throw new Error('invalid migration fixtures unexpectedly recovered');

    const sourceBytesUnchanged = sourceCopy.every((byte, index) => legacyBytes[index] === byte);
    const everyFailureHasStructuredReport = fixtures
      .filter((fixture) => fixture.migrated === null)
      .every((fixture) => typeof fixture.reportCode === 'string');
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: 'phase0-s8',
      ...benchmarkEnvironment(),
      fixtures,
      copyOnWrite: {
        sourceBytesUnchanged,
        requiresPersistedCopy: migrated.requiresPersistedCopy,
        migratedSchemaVersion: migratedDocument.schemaVersion ?? -1,
      },
      fallback: {
        hashMismatchRecoveredFrom: hashFallback.source as 'stable',
        schemaFailureRecoveredFrom: schemaFallback.source as 'stable',
        exhaustedRecovery: exhausted.recovery,
        exhaustedReportCodes: exhausted.diagnostics.map((diagnostic) => diagnostic.report.code),
      },
      decision: {
        sourcePayloadNeverOverwritten: sourceBytesUnchanged,
        everyFailureHasStructuredReport,
        everyFixtureHasDeterministicRecovery:
          hashFallback.source === 'stable' &&
          schemaFallback.source === 'stable' &&
          exhausted.recovery === 'readonly_diagnostic',
      },
    };
  } finally {
    engine.dispose();
  }
}

async function migrationSnapshot(
  snapshotKey: string,
  schemaVersion: number,
  payload: Uint8Array,
): Promise<SnapshotRecordV1> {
  return {
    snapshotKey,
    documentId: 'doc-1',
    revision: 1,
    schemaVersion,
    engineAlgorithmVersion: 'nodeink-scene-v1',
    payload,
    integrity: { algorithm: 'sha-256', digest: await sha256Hex(payload) },
    status: 'stable',
    createdAt: '2026-07-22T00:00:00.000Z',
  };
}

function validMigrationPayload(): string {
  return JSON.stringify({
    schemaVersion: 1,
    documentId: 'doc-1',
    revision: 0,
    rootOrder: [],
    elements: {},
  });
}

function legacyMigrationPayload(): string {
  return JSON.stringify({
    schemaVersion: 0,
    documentId: 'doc-1',
    revision: 4,
    rootOrder: ['rect-1'],
    elements: {
      'rect-1': { kind: 'rect', id: 'rect-1', x: 1, y: 2, width: 3, height: 4 },
    },
  });
}

async function measurePersistenceSize(
  persistence: AtomicSnapshotPersistenceV1,
  payloadBytes: 1_048_576 | 10_485_760,
  durability: IDBTransactionDurability,
): Promise<PersistenceSizeScenarioReport> {
  const documentId = `size-${payloadBytes}`;
  const serialization: number[] = [];
  const hash: number[] = [];
  const candidate: number[] = [];
  const readBack: number[] = [];
  const readBackHash: number[] = [];
  const validation: number[] = [];
  const stable: number[] = [];
  const total: number[] = [];
  const longTasks = startLongTaskCollection();
  for (let revision = 1; revision <= 5; revision += 1) {
    const serializationStartedAt = performance.now();
    const payload = createBenchmarkDocumentPayload(payloadBytes, documentId, revision);
    serialization.push(performance.now() - serializationStartedAt);
    const result = await persistence.save({
      documentId,
      revision,
      expectedPreviousRevision: revision - 1,
      schemaVersion: 1,
      engineAlgorithmVersion: 'nodeink-scene-v1',
      payload,
      durability,
      interruptAt: null,
    });
    hash.push(result.metrics.hashMs);
    candidate.push(result.metrics.candidateTransactionMs);
    readBack.push(result.metrics.readBackMs);
    readBackHash.push(result.metrics.readBackHashMs);
    validation.push(result.metrics.validationMs);
    stable.push(result.metrics.stableTransactionMs);
    total.push(result.metrics.totalMs);
    await yieldToBrowser();
  }
  const recovered = await persistence.recover(documentId);
  return {
    payloadBytes,
    iterations: 5,
    serializationMs: percentiles(serialization),
    hashMs: percentiles(hash),
    candidateTransactionMs: percentiles(candidate),
    readBackMs: percentiles(readBack),
    readBackHashMs: percentiles(readBackHash),
    validationMainThreadMs: percentiles(validation),
    stableTransactionMs: percentiles(stable),
    totalSaveMs: percentiles(total),
    longTasks: await longTasks.stop(),
    recoveredRevision: recovered.snapshot.revision,
  };
}

async function measurePersistenceInterruptions(
  persistence: AtomicSnapshotPersistenceV1,
  store: IndexedDbSnapshotStoreV1,
  durability: IDBTransactionDurability,
): Promise<PersistenceInterruptionReport[]> {
  const phases = [
    'before_candidate',
    'during_candidate_transaction',
    'after_candidate',
    'after_readback',
    'after_stable',
  ] as const;
  const reports: PersistenceInterruptionReport[] = [];
  for (const phase of phases) {
    const documentId = `interrupt-${phase}`;
    await persistence.save({
      documentId,
      revision: 1,
      expectedPreviousRevision: 0,
      schemaVersion: 1,
      engineAlgorithmVersion: 'nodeink-scene-v1',
      payload: createBenchmarkDocumentPayload(4_096, documentId, 1),
      durability,
      interruptAt: null,
    });
    const interruptAt = phase === 'after_stable' ? null : phase;
    try {
      await persistence.save({
        documentId,
        revision: 2,
        expectedPreviousRevision: 1,
        schemaVersion: 1,
        engineAlgorithmVersion: 'nodeink-scene-v1',
        payload: createBenchmarkDocumentPayload(4_096, documentId, 2),
        durability,
        interruptAt,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('interrupted')) throw error;
    }
    const catalog = await store.getCatalog(documentId);
    const recovered = await persistence.recover(documentId);
    reports.push({
      phase,
      headRevision: catalog?.headRevision ?? 0,
      recoveredRevision: recovered.snapshot.revision,
      recoveredStatus: recovered.snapshot.status as 'stable',
    });
  }
  return reports;
}

function createBenchmarkDocumentPayload(
  targetBytes: number,
  documentId: string,
  revision: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const shell = JSON.stringify({ schemaVersion: 1, documentId, revision, padding: '' });
  const paddingLength = Math.max(0, targetBytes - encoder.encode(shell).byteLength);
  return encoder.encode(
    JSON.stringify({ schemaVersion: 1, documentId, revision, padding: 'x'.repeat(paddingLength) }),
  );
}

function validateBenchmarkDocument(payload: Uint8Array, schemaVersion: number): void {
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
    schemaVersion?: unknown;
    documentId?: unknown;
    revision?: unknown;
  };
  if (
    schemaVersion !== 1 ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.documentId !== 'string' ||
    typeof parsed.revision !== 'number'
  ) {
    throw new Error('benchmark document does not satisfy schema V1');
  }
}

function startLongTaskCollection(): {
  stop(): Promise<{ supported: boolean; count: number; totalDurationMs: number }>;
} {
  const durations: number[] = [];
  if (typeof PerformanceObserver === 'undefined') {
    return { stop: async () => ({ supported: false, count: 0, totalDurationMs: 0 }) };
  }
  let supported = true;
  const observer = new PerformanceObserver((list) => {
    durations.push(...list.getEntries().map((entry) => entry.duration));
  });
  try {
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    supported = false;
  }
  return {
    async stop() {
      await yieldToBrowser();
      durations.push(...observer.takeRecords().map((entry) => entry.duration));
      observer.disconnect();
      return {
        supported,
        count: durations.length,
        totalDurationMs: round(durations.reduce((sum, duration) => sum + duration, 0)),
      };
    },
  };
}

function svgScaleScene(
  kind: SvgFixtureKind,
  sourceElementCount: number,
  visibleElementCount: number,
  sceneRevision: number,
): SceneSnapshotV1 {
  const rootNodeIds: string[] = [];
  const nodes: Record<string, SceneNodeV1> = {};
  const count = Math.min(sourceElementCount, visibleElementCount);
  for (let index = 0; index < count; index += 1) {
    const sourceElementId = `scale-${index.toString().padStart(5, '0')}`;
    const x = (index % 100) * 18;
    const y = Math.floor(index / 100) * 18;
    if (kind === 'text_run') {
      const id = `${sourceElementId}:text`;
      rootNodeIds.push(id);
      nodes[id] = {
        kind: 'text',
        id,
        sourceElementId,
        runs: [
          {
            text: `N${index}`,
            x,
            y: y + 14,
            fontFamily: 'Arial',
            fontSize: 12,
            fontWeight: 400,
            fill: '#0f172a',
          },
        ],
      };
      continue;
    }
    const pathCount = kind === 'sketch_multi_path' ? 3 : 1;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const id = `${sourceElementId}:path-${pathIndex}`;
      rootNodeIds.push(id);
      nodes[id] = {
        kind: 'path',
        id,
        sourceElementId,
        pathData: `M ${x} ${y + pathIndex} L ${x + 12} ${y + 12 + pathIndex}`,
        fill: 'none',
        stroke: pathIndex === 2 ? '#64748b' : '#0f172a',
        strokeWidth: pathIndex === 2 ? 1 : 2,
      };
    }
  }
  return {
    protocolVersion: 1,
    documentId: `svg-scale-${kind}-${sourceElementCount}`,
    documentRevision: sceneRevision,
    sceneRevision,
    rootNodeIds,
    nodes,
  };
}

function measureSvgMount(
  scene: SceneSnapshotV1,
  iterations: number,
): { durations: number[]; domNodeCount: number } {
  const durations: number[] = [];
  let domNodeCount = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const result = renderer.applySnapshot(scene);
    if (!result.ok) throw new Error(`SVG scale snapshot rejected: ${result.reason}`);
    durations.push(result.durationMs ?? 0);
    domNodeCount = target.querySelectorAll('svg *').length;
    renderer.unmount();
  }
  return { durations, domNodeCount };
}

function measureSvgInteractions(
  scene: SceneSnapshotV1,
  iterations: number,
): { cameraPanDurations: number[]; patchDurations: number[] } {
  const renderer = new SvgRenderer();
  renderer.mount(document.createElement('div'));
  const mounted = renderer.applySnapshot(scene);
  if (!mounted.ok) throw new Error(`SVG interaction fixture rejected: ${mounted.reason}`);
  const cameraPanDurations: number[] = [];
  const patchDurations: number[] = [];
  const firstNodeId = scene.rootNodeIds[0];
  const firstNode = firstNodeId ? scene.nodes[firstNodeId] : undefined;
  if (!firstNodeId || !firstNode) throw new Error('SVG interaction fixture is empty');
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    cameraPanDurations.push(
      renderer.setViewport({ x: iteration * 8, y: iteration * 4, width: 960, height: 640 })
        .durationMs,
    );
    const baseSceneRevision = scene.sceneRevision + iteration;
    const patch = renderer.applyPatch({
      protocolVersion: 1,
      documentRevision: baseSceneRevision + 1,
      baseSceneRevision,
      sceneRevision: baseSceneRevision + 1,
      addedNodes: {},
      updatedNodes: { [firstNodeId]: mutateScaleNode(firstNode, iteration) },
      removedNodeIds: [],
      rootNodeIds: null,
    });
    if (!patch.ok) throw new Error(`SVG interaction patch rejected: ${patch.reason}`);
    patchDurations.push(patch.durationMs ?? 0);
  }
  renderer.unmount();
  return { cameraPanDurations, patchDurations };
}

function mutateScaleNode(node: SceneNodeV1, iteration: number): SceneNodeV1 {
  if (node.kind === 'text') {
    return {
      ...node,
      runs: node.runs.map((run) => ({ ...run, text: `${run.text}-${iteration}` })),
    };
  }
  if (node.kind === 'path') {
    return { ...node, pathData: `${node.pathData} M ${iteration} ${iteration}` };
  }
  return { ...node, x: node.x + iteration };
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

interface PipelineSample {
  payloadBytes: number;
  wasmSerializeAndTransferMs: number;
  parseMs: number;
  svgApplyMs: number;
  pipelineMs: number;
}

function measureSnapshotPipeline(
  before: SceneSnapshotV1,
  after: SceneBenchmarkPayloadV1<SceneSnapshotV1>,
): PipelineSample {
  const renderer = new SvgRenderer();
  renderer.mount(document.createElement('div'));
  renderer.applySnapshot(before);
  const result = renderer.applySnapshot(after.value);
  renderer.unmount();
  if (!result.ok) throw new Error(`snapshot renderer rejected fixture: ${result.reason}`);
  const svgApplyMs = result.durationMs ?? 0;
  return pipelineSample(after, svgApplyMs);
}

function measurePatchPipeline(
  before: SceneSnapshotV1,
  patch: SceneBenchmarkPayloadV1<ScenePatchV1>,
): PipelineSample {
  const renderer = new SvgRenderer();
  renderer.mount(document.createElement('div'));
  renderer.applySnapshot(before);
  const result = renderer.applyPatch(patch.value);
  renderer.unmount();
  if (!result.ok) throw new Error(`patch renderer rejected fixture: ${result.reason}`);
  const svgApplyMs = result.durationMs ?? 0;
  return pipelineSample(patch, svgApplyMs);
}

function pipelineSample(
  payload: { payloadBytes: number; wasmSerializeAndTransferMs: number; parseMs: number },
  svgApplyMs: number,
): PipelineSample {
  return {
    ...payload,
    svgApplyMs,
    pipelineMs: payload.wasmSerializeAndTransferMs + payload.parseMs + svgApplyMs,
  };
}

function summarizePipeline(samples: PipelineSample[]): ScenePipelineMetrics {
  return {
    payloadBytes: samples[0]?.payloadBytes ?? 0,
    wasmSerializeAndTransferMs: percentiles(
      samples.map((sample) => sample.wasmSerializeAndTransferMs),
    ),
    parseMs: percentiles(samples.map((sample) => sample.parseMs)),
    svgApplyMs: percentiles(samples.map((sample) => sample.svgApplyMs)),
    pipelineMs: percentiles(samples.map((sample) => sample.pipelineMs)),
  };
}

function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (quantile: number) => sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
  return { p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)) };
}

function round(value: number): number {
  return Number(value.toFixed(3));
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

function textFixtureRuns(): TextRunV1[] {
  return [
    {
      key: 'latin-multiline',
      text: 'NodeInk\ncanvas',
      fontFamily: 'Arial',
      fontSize: 20,
      fontWeight: 500,
      maxWidth: 240,
    },
    {
      key: 'cjk',
      text: '你好，画布',
      fontFamily: 'Arial',
      fontSize: 20,
      fontWeight: 400,
      maxWidth: null,
    },
    {
      key: 'emoji',
      text: '✍️🎨',
      fontFamily: 'Arial',
      fontSize: 24,
      fontWeight: 400,
      maxWidth: null,
    },
  ];
}

function runImeFixture(): { commitCount: number; committedDuringComposition: boolean } {
  const textarea = document.createElement('textarea');
  let commitCount = 0;
  let committedDuringComposition = false;
  const binding = attachImeComposition(textarea, () => {
    commitCount += 1;
    committedDuringComposition ||= binding.getState().isComposing;
  });
  textarea.dispatchEvent(new CompositionEvent('compositionstart'));
  textarea.value = '你';
  textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText' }));
  textarea.value = '你好✍️';
  textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText' }));
  const externalWasApplied = binding.applyExternalValue('external command');
  textarea.dispatchEvent(new CompositionEvent('compositionend'));
  textarea.dispatchEvent(new InputEvent('input'));
  binding.dispose();
  return {
    commitCount,
    committedDuringComposition: committedDuringComposition || externalWasApplied,
  };
}
