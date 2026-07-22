import {
  attachImeComposition,
  CanvasTextMetricsAdapter,
  EditorWebController,
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
  WebLockDocumentLeaseV1,
  type DocumentLeaseResultV1,
  type LockManagerPortV1,
  type SaveInterruptionV1,
  type SnapshotRecordV1,
} from '@nodeink-internal/persistence-web';
import type {
  DiagramOperationBatchV1,
  EnginePortV1,
  NodeInkDocumentV1,
  RendererV1,
  RenderProfileV1,
  SceneBenchmarkPayloadV1,
  SceneNodeV1,
  ScenePatchV1,
  SceneResolutionV1,
  SceneSnapshotV1,
  TextRunV1,
  ViewportV1,
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
  engineAlgorithmVersion: 'nodeink-scene-v2';
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

export interface PlaygroundLeaseBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s9';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  role: 'writer' | 'contender';
  documentId: string;
  capability: { webLocks: boolean; unsupportedFallback: 'readonly' };
  acquisition: {
    kind: 'writer' | 'readonly';
    reason: 'held_elsewhere' | 'unsupported' | null;
    durationMs: number;
  };
  revisionGuard: {
    successfulWriters: 1;
    revisionConflicts: 1;
    recoveredRevision: 1;
    silentLastWriteWins: false;
  };
  state: 'held' | 'readonly' | 'released';
  releaseMs: number | null;
}

export interface PlaygroundOperationBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s10';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  operationCount: 5;
  dryRun: {
    durationMs: number;
    revisionBefore: 0;
    revisionAfter: 0;
    resultRevision: null;
    plannedOperationCount: 5;
    previewAddedNodeCount: 1;
  };
  apply: {
    durationMs: number;
    revision: 1;
    appliedOperationCount: 5;
    survivingElementIds: ['rect-a'];
    rendererAcceptedPatch: boolean;
    renderedSceneNodeCount: 1;
  };
  replay: { identicalResult: boolean; identicalDocument: boolean };
  atomicFailure: { rejected: boolean; revisionAfter: 0; elementCountAfter: 0 };
  revisionConflict: { rejected: boolean; revisionAfter: 1 };
  undo: { revision: 2; elementCount: 0 };
  decision: {
    dryRunNeverMutates: boolean;
    batchIsAtomicAndUndoable: boolean;
    replayIsDeterministic: boolean;
    staleRevisionIsRejected: boolean;
    rendererOnlyConsumesScenePatch: boolean;
  };
}

export interface PlaygroundLifecycleBenchmarkReport {
  build: 'release-wasm-dev-host';
  engineAlgorithmVersion: 'phase0-s11';
  browser: string;
  os: string;
  hardware: PlaygroundBenchmarkHardware;
  cycles: 25;
  actionLoop: {
    createMoveUndoPassed: 25;
    finalRevision: 3;
    finalRectangleX: 80;
  };
  lifecycle: {
    pointerListenerAdds: 100;
    pointerListenerRemoves: 100;
    activePointerListeners: 0;
    subscriptionNotifications: 100;
    engineHandleDisposeCalls: 25;
    disposedHandlesRejectedUse: 25;
    rendererUnmountCalls: 25;
    residualSvgCount: 0;
  };
  decision: {
    listenersArePaired: boolean;
    subscriptionsAreDetached: boolean;
    engineHandlesAreReleasedOnce: boolean;
    rendererDomIsRemoved: boolean;
    repeatedCreateMoveUndoIsStable: boolean;
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
    nodeInkRunOperationBenchmark?: () => Promise<PlaygroundOperationBenchmarkReport>;
    nodeInkRunLifecycleBenchmark?: () => Promise<PlaygroundLifecycleBenchmarkReport>;
    nodeInkReleaseLeaseBenchmark?: () => Promise<number>;
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
  window.nodeInkRunOperationBenchmark = () => runPlaygroundOperationBenchmark();
  window.nodeInkRunLifecycleBenchmark = () => runPlaygroundLifecycleBenchmark();
  window.nodeInkReleaseLeaseBenchmark = () => releasePlaygroundLeaseBenchmark();
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
  const selectionBounds = controller.getSnapshot().selectionBounds;
  if (!selectionBounds) {
    throw new Error('benchmark rectangle selection bounds are unavailable');
  }
  const startPoint = {
    x: selectionBounds.x + selectionBounds.width / 2,
    y: selectionBounds.y + selectionBounds.height / 2,
  };

  const singleEvent = await runPointerBenchmark({ controller, startPoint, batchSize: 1 });
  const batch8 = await runPointerBenchmark({ controller, startPoint, batchSize: 8 });
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
    clean: 'fnv1a64:5b2061b1f75e7c2c',
    sketchRoughness2: 'fnv1a64:739072c8fe33ca8c',
    sketchSeed42: 'fnv1a64:f12e0a0336d64e6b',
    sketchSeed43: 'fnv1a64:8bcf6f600f48a03f',
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
    schemaVersion: 2,
    documentId: 'text-fixture',
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
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
    schemaVersion: 2,
    documentId: 'scene-patch-benchmark',
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
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
    schemaVersion: 2,
    documentId: 'migration-runner',
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
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

let activePlaygroundLease: Extract<DocumentLeaseResultV1, { kind: 'writer' }> | null = null;

export async function runPlaygroundLeaseBenchmark(
  role: 'writer' | 'contender',
  documentId: string,
): Promise<PlaygroundLeaseBenchmarkReport> {
  const webLocks = typeof navigator.locks !== 'undefined';
  const coordinator = new WebLockDocumentLeaseV1(
    webLocks ? (navigator.locks as unknown as LockManagerPortV1) : undefined,
  );
  const startedAt = performance.now();
  const lease = await coordinator.acquire(documentId);
  const durationMs = performance.now() - startedAt;
  if (lease.kind === 'writer') activePlaygroundLease = lease;
  const unsupported = await new WebLockDocumentLeaseV1(undefined).acquire(documentId);
  if (unsupported.kind !== 'readonly') throw new Error('unsupported locks did not become readonly');
  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s9',
    ...benchmarkEnvironment(),
    role,
    documentId,
    capability: { webLocks, unsupportedFallback: 'readonly' },
    acquisition: {
      kind: lease.kind,
      reason: lease.kind === 'readonly' ? lease.reason : null,
      durationMs: round(durationMs),
    },
    revisionGuard: await runRevisionGuardProbe(),
    state: lease.kind === 'writer' ? 'held' : 'readonly',
    releaseMs: null,
  };
}

export async function releasePlaygroundLeaseBenchmark(): Promise<number> {
  if (!activePlaygroundLease) throw new Error('no writer lease is held by this tab');
  const startedAt = performance.now();
  await activePlaygroundLease.release();
  activePlaygroundLease = null;
  return round(performance.now() - startedAt);
}

export async function runPlaygroundOperationBenchmark(): Promise<PlaygroundOperationBenchmarkReport> {
  const engine = await createWasmEngine(operationDocument('doc-1'));
  const replayEngine = await createWasmEngine(operationDocument('doc-1'));
  const atomicEngine = await createWasmEngine(operationDocument('atomic-doc'));
  const renderTarget = document.createElement('div');
  const renderer = new SvgRenderer();
  try {
    const initial = await engine.currentUpdate();
    renderer.mount(renderTarget);
    const initialRender = renderer.applySnapshot(initial.scene);
    if (!initialRender.ok) throw new Error('renderer rejected initial operation fixture');

    const dryRunStartedAt = performance.now();
    const dryRun = await engine.executeDiagramOperation(operationBatch('dry_run'));
    const dryRunDurationMs = performance.now() - dryRunStartedAt;
    const afterDryRun = await engine.currentUpdate();
    if (
      dryRun.revision !== null ||
      afterDryRun.scene.documentRevision !== 0 ||
      dryRun.results.some((result) => result.status !== 'planned')
    ) {
      throw new Error('dry-run changed the document or returned a committed result');
    }

    const applyStartedAt = performance.now();
    const applied = await engine.executeDiagramOperation(operationBatch('apply'));
    const applyDurationMs = performance.now() - applyStartedAt;
    const afterApply = await engine.currentUpdate();
    const renderResult = renderer.applyPatch(applied.scenePatch);
    if (!renderResult.ok)
      throw new Error(`renderer rejected operation patch: ${renderResult.reason}`);

    const replayed = await replayEngine.executeDiagramOperation(operationBatch('apply'));
    const replayDocument = await replayEngine.currentUpdate();

    let revisionConflictRejected = false;
    try {
      await engine.executeDiagramOperation(operationBatch('apply'));
    } catch {
      revisionConflictRejected = true;
    }
    const afterConflict = await engine.currentUpdate();

    let atomicFailureRejected = false;
    try {
      await atomicEngine.executeDiagramOperation(atomicFailureBatch());
    } catch {
      atomicFailureRejected = true;
    }
    const afterAtomicFailure = await atomicEngine.currentUpdate();
    const undone = await engine.undo();

    const identicalResult = JSON.stringify(applied) === JSON.stringify(replayed);
    const identicalDocument =
      JSON.stringify(afterApply.scene) === JSON.stringify(replayDocument.scene);
    const renderedSceneNodeCount = renderTarget.querySelectorAll('[data-scene-node-id]').length;
    const previewAddedNodeCount = Object.keys(dryRun.scenePatch.addedNodes).length;
    const plannedOperationCount = dryRun.results.filter(
      (result) => result.status === 'planned',
    ).length;
    const appliedOperationCount = applied.results.filter(
      (result) => result.status === 'applied',
    ).length;
    if (
      previewAddedNodeCount !== 1 ||
      plannedOperationCount !== 5 ||
      appliedOperationCount !== 5 ||
      afterApply.scene.documentRevision !== 1 ||
      afterApply.scene.rootNodeIds.join(',') !== 'rect-a:shape' ||
      renderedSceneNodeCount !== 1
    ) {
      throw new Error('operation fixture did not produce the expected single rectangle');
    }
    const dryRunNeverMutates =
      afterDryRun.scene.documentRevision === 0 && !afterDryRun.history.canUndo;
    const batchIsAtomicAndUndoable =
      atomicFailureRejected &&
      afterAtomicFailure.scene.documentRevision === 0 &&
      afterAtomicFailure.scene.rootNodeIds.length === 0 &&
      undone.scene.documentRevision === 2 &&
      undone.scene.rootNodeIds.length === 0;
    return {
      build: 'release-wasm-dev-host',
      engineAlgorithmVersion: 'phase0-s10',
      ...benchmarkEnvironment(),
      operationCount: 5,
      dryRun: {
        durationMs: round(dryRunDurationMs),
        revisionBefore: 0,
        revisionAfter: 0,
        resultRevision: null,
        plannedOperationCount,
        previewAddedNodeCount,
      },
      apply: {
        durationMs: round(applyDurationMs),
        revision: 1,
        appliedOperationCount,
        survivingElementIds: ['rect-a'],
        rendererAcceptedPatch: renderResult.ok,
        renderedSceneNodeCount,
      },
      replay: { identicalResult, identicalDocument },
      atomicFailure: {
        rejected: atomicFailureRejected,
        revisionAfter: 0,
        elementCountAfter: 0,
      },
      revisionConflict: { rejected: revisionConflictRejected, revisionAfter: 1 },
      undo: { revision: 2, elementCount: 0 },
      decision: {
        dryRunNeverMutates,
        batchIsAtomicAndUndoable,
        replayIsDeterministic: identicalResult && identicalDocument,
        staleRevisionIsRejected:
          revisionConflictRejected && afterConflict.scene.documentRevision === 1,
        rendererOnlyConsumesScenePatch: renderResult.ok && renderedSceneNodeCount === 1,
      },
    };
  } finally {
    renderer.unmount();
    engine.dispose();
    replayEngine.dispose();
    atomicEngine.dispose();
  }
}

function operationDocument(documentId: string): NodeInkDocumentV1 {
  return {
    schemaVersion: 2,
    documentId,
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
    rootOrder: [],
    elements: {},
  };
}

function operationBatch(mode: 'apply' | 'dry_run'): DiagramOperationBatchV1 {
  return {
    protocolVersion: 1,
    batchId: 'diagram-batch-1',
    documentId: 'doc-1',
    expectedRevision: 0,
    mode,
    atomic: true,
    operations: [
      {
        type: 'create_rectangle',
        opId: 'create-a',
        rectangle: {
          kind: 'rect',
          id: 'rect-a',
          x: 10,
          y: 40,
          width: 160,
          height: 96,
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      },
      {
        type: 'create_rectangle',
        opId: 'create-b',
        rectangle: {
          kind: 'rect',
          id: 'rect-b',
          x: 100,
          y: 40,
          width: 160,
          height: 96,
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      },
      {
        type: 'move_elements',
        opId: 'move-a',
        elementIds: ['rect-a'],
        delta: { x: 5, y: 7 },
      },
      {
        type: 'update_rectangle',
        opId: 'resize-a',
        elementId: 'rect-a',
        patch: { width: 240, height: 120 },
      },
      { type: 'delete_elements', opId: 'delete-b', elementIds: ['rect-b'] },
    ],
  };
}

function atomicFailureBatch(): DiagramOperationBatchV1 {
  return {
    protocolVersion: 1,
    batchId: 'atomic-failure',
    documentId: 'atomic-doc',
    expectedRevision: 0,
    mode: 'apply',
    atomic: true,
    operations: [
      {
        type: 'create_rectangle',
        opId: 'create-before-failure',
        rectangle: {
          kind: 'rect',
          id: 'rect-before-failure',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          strokeWidth: 2,
        },
      },
      {
        type: 'move_elements',
        opId: 'move-missing',
        elementIds: ['missing'],
        delta: { x: 1, y: 1 },
      },
    ],
  };
}

export async function runPlaygroundLifecycleBenchmark(): Promise<PlaygroundLifecycleBenchmarkReport> {
  const cycles = 25;
  let createMoveUndoPassed = 0;
  let pointerListenerAdds = 0;
  let pointerListenerRemoves = 0;
  let activePointerListeners = 0;
  let subscriptionNotifications = 0;
  let engineHandleDisposeCalls = 0;
  let disposedHandlesRejectedUse = 0;
  let rendererUnmountCalls = 0;
  let residualSvgCount = 0;

  for (let index = 0; index < cycles; index += 1) {
    const engine = await createWasmEngine(operationDocument(`lifecycle-${index}`));
    const trackedEngine = trackEngineDispose(engine, () => {
      engineHandleDisposeCalls += 1;
    });
    const renderer = new LifecycleRenderer();
    const controller = new EditorWebController({
      engine: trackedEngine,
      renderer,
      createId: lifecycleIdFactory(index),
    });
    const target = document.createElement('div');
    const listenerTracker = trackPointerListeners(target);
    const unsubscribe = controller.subscribe(() => {
      subscriptionNotifications += 1;
    });

    await controller.mount(target);
    const created = await controller.dispatch({
      type: 'create_rectangle',
      elementId: `rect-${index}`,
    });
    const moved = await controller.dispatch({
      type: 'move_active',
      delta: { x: 32, y: 16 },
    });
    const undone = await controller.dispatch({ type: 'undo' });
    const rectangleX = Number(target.querySelector('rect')?.getAttribute('x'));
    if (
      created.ok &&
      moved.ok &&
      undone.ok &&
      created.snapshot.documentRevision === 1 &&
      moved.snapshot.documentRevision === 2 &&
      undone.snapshot.documentRevision === 3 &&
      rectangleX === 80
    ) {
      createMoveUndoPassed += 1;
    }

    unsubscribe();
    controller.dispose();
    controller.dispose();
    pointerListenerAdds += listenerTracker.addCount();
    pointerListenerRemoves += listenerTracker.removeCount();
    activePointerListeners += listenerTracker.activeCount();
    rendererUnmountCalls += renderer.unmountCalls;
    residualSvgCount += target.querySelectorAll('svg').length;
    try {
      await engine.currentUpdate();
    } catch {
      disposedHandlesRejectedUse += 1;
    }
  }

  if (
    createMoveUndoPassed !== 25 ||
    pointerListenerAdds !== 100 ||
    pointerListenerRemoves !== 100 ||
    activePointerListeners !== 0 ||
    subscriptionNotifications !== 100 ||
    engineHandleDisposeCalls !== 25 ||
    disposedHandlesRejectedUse !== 25 ||
    rendererUnmountCalls !== 25 ||
    residualSvgCount !== 0
  ) {
    throw new Error('repeated controller lifecycle fixture leaked or diverged');
  }

  return {
    build: 'release-wasm-dev-host',
    engineAlgorithmVersion: 'phase0-s11',
    ...benchmarkEnvironment(),
    cycles,
    actionLoop: {
      createMoveUndoPassed,
      finalRevision: 3,
      finalRectangleX: 80,
    },
    lifecycle: {
      pointerListenerAdds,
      pointerListenerRemoves,
      activePointerListeners,
      subscriptionNotifications,
      engineHandleDisposeCalls,
      disposedHandlesRejectedUse,
      rendererUnmountCalls,
      residualSvgCount,
    },
    decision: {
      listenersArePaired: pointerListenerAdds === pointerListenerRemoves,
      subscriptionsAreDetached: subscriptionNotifications === cycles * 4,
      engineHandlesAreReleasedOnce:
        engineHandleDisposeCalls === cycles && disposedHandlesRejectedUse === cycles,
      rendererDomIsRemoved: rendererUnmountCalls === cycles && residualSvgCount === 0,
      repeatedCreateMoveUndoIsStable: createMoveUndoPassed === cycles,
    },
  };
}

class LifecycleRenderer implements RendererV1 {
  readonly #renderer = new SvgRenderer();
  unmountCalls = 0;

  mount(target: HTMLElement): void {
    this.#renderer.mount(target);
  }

  setViewport(viewport: ViewportV1) {
    return this.#renderer.setViewport(viewport);
  }

  setOverlay(overlay: Parameters<RendererV1['setOverlay']>[0]): void {
    this.#renderer.setOverlay(overlay);
  }

  applySnapshot(snapshot: SceneSnapshotV1) {
    return this.#renderer.applySnapshot(snapshot);
  }

  applyPatch(patch: ScenePatchV1) {
    return this.#renderer.applyPatch(patch);
  }

  unmount(): void {
    this.unmountCalls += 1;
    this.#renderer.unmount();
  }
}

function trackEngineDispose(engine: EnginePortV1, onDispose: () => void): EnginePortV1 {
  return new Proxy(engine, {
    get(target, property) {
      if (property === 'dispose') {
        return () => {
          onDispose();
          target.dispose();
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function lifecycleIdFactory(cycle: number): () => string {
  let next = 0;
  return () => `lifecycle-${cycle}-${next++}`;
}

function trackPointerListeners(target: HTMLElement) {
  const pointerTypes = new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);
  const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const originalAdd = target.addEventListener.bind(target);
  const originalRemove = target.removeEventListener.bind(target);
  let adds = 0;
  let removes = 0;
  target.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (pointerTypes.has(type)) {
      adds += 1;
      const listeners = active.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      active.set(type, listeners);
    }
    originalAdd(type, listener, options);
  }) as typeof target.addEventListener;
  target.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (pointerTypes.has(type)) {
      removes += 1;
      active.get(type)?.delete(listener);
    }
    originalRemove(type, listener, options);
  }) as typeof target.removeEventListener;
  return {
    addCount: () => adds,
    removeCount: () => removes,
    activeCount: () => [...active.values()].reduce((total, listeners) => total + listeners.size, 0),
  };
}

async function runRevisionGuardProbe(): Promise<PlaygroundLeaseBenchmarkReport['revisionGuard']> {
  const databaseName = `nodeink-s9-revision-${crypto.randomUUID()}`;
  const store = await IndexedDbSnapshotStoreV1.open(databaseName);
  const persistence = new AtomicSnapshotPersistenceV1({
    store,
    validatePayload: validateBenchmarkDocument,
  });
  const payload = createBenchmarkDocumentPayload(4_096, 'revision-guard', 1);
  try {
    const writes = await Promise.allSettled(
      [0, 1].map(() =>
        persistence.save({
          documentId: 'revision-guard',
          revision: 1,
          expectedPreviousRevision: 0,
          schemaVersion: 1,
          engineAlgorithmVersion: 'nodeink-scene-v1',
          payload,
          durability: store.probeStrictDurability() ? 'strict' : 'relaxed',
          interruptAt: null,
        }),
      ),
    );
    const successfulWriters = writes.filter((result) => result.status === 'fulfilled').length;
    const revisionConflicts = writes.filter(
      (result) =>
        result.status === 'rejected' &&
        typeof result.reason === 'object' &&
        result.reason !== null &&
        'code' in result.reason &&
        result.reason.code === 'revision_conflict',
    ).length;
    const recovered = await persistence.recover('revision-guard');
    if (successfulWriters !== 1 || revisionConflicts !== 1 || recovered.snapshot.revision !== 1) {
      throw new Error('revision guard did not reject the competing writer');
    }
    return {
      successfulWriters: 1,
      revisionConflicts: 1,
      recoveredRevision: 1,
      silentLastWriteWins: false,
    };
  } finally {
    store.close();
    await deleteNodeInkDatabase(databaseName);
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
            textAnchor: 'start',
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
    renderProfile: { kind: 'clean', version: 1 },
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
    schemaVersion: 2,
    documentId: 'sketch-fixture',
    revision: 0,
    renderProfile: { kind: 'clean', version: 1 },
    rootOrder: ['rect-1', 'stroke-1'],
    elements: {
      'rect-1': {
        kind: 'rect',
        id: 'rect-1',
        x: 24,
        y: 40,
        width: 160,
        height: 96,
        fill: { kind: 'solid', color: '#d1fae5' },
        stroke: '#047857',
        strokeWidth: 2,
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
        stroke: '#0f172a',
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

function assertAlgorithmVersion(resolution: SceneResolutionV1 | undefined): 'nodeink-scene-v2' {
  if (resolution?.engineAlgorithmVersion !== 'nodeink-scene-v2') {
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
