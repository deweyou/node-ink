import type { StrokeInputBatchV1, StrokeTransportV1 } from '@nodeink-internal/protocol';

import type { EditorWebControllerV1 } from './index';

export interface StrokeBenchmarkCaseV1 {
  name: string;
  transport: StrokeTransportV1;
  batchSize: number;
}

export interface StrokeBenchmarkOptionsV1 {
  controller: Pick<EditorWebControllerV1, 'dispatch'>;
  durationSeconds?: number;
  inputHz?: number;
  cases?: StrokeBenchmarkCaseV1[];
  strokeIdPrefix?: string;
  now?: () => number;
}

export interface StrokeBenchmarkVariantResultV1 {
  sample: {
    durationSeconds: number;
    inputHz: number;
    movePointCount: number;
    transport: StrokeTransportV1;
    batchSize: number;
  };
  metrics: {
    inputToVisibleP50Ms: number;
    inputToVisibleP95Ms: number;
    inputToVisibleP99Ms: number;
    inputToVisibleMaxMs: number;
    batchAccumulationMaxMs: number;
    estimatedFirstPointVisibleP95Ms: number;
    rendererApplyP95Ms: number;
    sceneSnapshotP95Bytes: number;
    sceneSnapshotMaxBytes: number;
    copiedInputBytes: number;
    processedPointCount: number;
    ignoredPointCount: number;
    commitCount: number;
    longTaskCount: number;
    elapsedMs: number;
    pointsPerSecond: number;
  };
  decision: {
    isWithinFrameBudget: boolean;
    hasOrderedSingleCommit: boolean;
  };
}

export interface StrokeBenchmarkReportV1 {
  cases: Record<string, StrokeBenchmarkVariantResultV1>;
}

const defaultCases: StrokeBenchmarkCaseV1[] = [
  { name: 'jsonPoint', transport: 'json', batchSize: 1 },
  { name: 'typedArray2', transport: 'typed_array', batchSize: 2 },
  { name: 'typedArray8', transport: 'typed_array', batchSize: 8 },
  { name: 'typedArray32', transport: 'typed_array', batchSize: 32 },
];

export async function runStrokeBenchmark({
  controller,
  durationSeconds = 30,
  inputHz = 120,
  cases = defaultCases,
  strokeIdPrefix = 'benchmark-stroke',
  now = () => performance.now(),
}: StrokeBenchmarkOptionsV1): Promise<StrokeBenchmarkReportV1> {
  const activate = await controller.dispatch({ type: 'set_tool', tool: 'freehand' });
  if (!activate.ok) {
    throw new Error(activate.snapshot.errorMessage ?? 'failed to activate freehand benchmark tool');
  }
  const results: Record<string, StrokeBenchmarkVariantResultV1> = {};
  try {
    for (const [index, benchmarkCase] of cases.entries()) {
      results[benchmarkCase.name] = await runVariant({
        controller,
        durationSeconds,
        inputHz,
        benchmarkCase,
        strokeId: `${strokeIdPrefix}-${benchmarkCase.name}`,
        now,
      });
      if (index < cases.length - 1) {
        const undo = await controller.dispatch({ type: 'undo' });
        if (!undo.ok) {
          throw new Error(undo.snapshot.errorMessage ?? 'failed to reset stroke benchmark fixture');
        }
      }
    }
  } finally {
    await controller.dispatch({ type: 'set_tool', tool: 'select' });
  }
  return { cases: results };
}

interface RunVariantOptions {
  controller: Pick<EditorWebControllerV1, 'dispatch'>;
  durationSeconds: number;
  inputHz: number;
  benchmarkCase: StrokeBenchmarkCaseV1;
  strokeId: string;
  now: () => number;
}

async function runVariant({
  controller,
  durationSeconds,
  inputHz,
  benchmarkCase,
  strokeId,
  now,
}: RunVariantOptions): Promise<StrokeBenchmarkVariantResultV1> {
  const movePointCount = Math.max(1, Math.round(durationSeconds * inputHz));
  const batchSize = Math.max(1, Math.floor(benchmarkCase.batchSize));
  const inputToVisibleDurations: number[] = [];
  const rendererDurations: number[] = [];
  const sceneBytes: number[] = [];
  let copiedInputBytes = 0;
  let processedPointCount = 0;
  let ignoredPointCount = 0;
  let commitCount = 0;
  let sequenceStart = 1;

  const dispatch = async (batch: StrokeInputBatchV1) => {
    copiedInputBytes += copiedBytes(batch, benchmarkCase.transport);
    const result = await controller.dispatch({
      type: 'stroke_batch',
      batch,
      transport: benchmarkCase.transport,
    });
    if (!result.ok || !result.strokeMetrics || !result.performance) {
      throw new Error(result.snapshot.errorMessage ?? 'stroke benchmark dispatch failed');
    }
    inputToVisibleDurations.push(result.performance.inputToVisibleMs);
    rendererDurations.push(result.performance.rendererApplyMs);
    sceneBytes.push(result.performance.sceneBytes);
    processedPointCount += result.strokeMetrics.processedPointCount;
    ignoredPointCount += result.strokeMetrics.ignoredPointCount;
    commitCount += result.strokeMetrics.didCommit ? 1 : 0;
  };

  const startedAt = now();
  await dispatch({
    pointerId: 1,
    sequenceStart,
    phase: 'down',
    points: [strokePoint(0, movePointCount)],
    strokeId,
  });
  sequenceStart += 1;

  for (let offset = 0; offset < movePointCount; offset += batchSize) {
    const batchEnd = Math.min(movePointCount, offset + batchSize);
    const points = Array.from({ length: batchEnd - offset }, (_, index) =>
      strokePoint(offset + index + 1, movePointCount),
    );
    await dispatch({
      pointerId: 1,
      sequenceStart,
      phase: 'move',
      points,
      strokeId: null,
    });
    sequenceStart += points.length;
  }

  await dispatch({
    pointerId: 1,
    sequenceStart,
    phase: 'up',
    points: [strokePoint(movePointCount, movePointCount)],
    strokeId: null,
  });
  const elapsedMs = now() - startedAt;

  const metrics = {
    inputToVisibleP50Ms: percentile(inputToVisibleDurations, 0.5),
    inputToVisibleP95Ms: percentile(inputToVisibleDurations, 0.95),
    inputToVisibleP99Ms: percentile(inputToVisibleDurations, 0.99),
    inputToVisibleMaxMs: Math.max(...inputToVisibleDurations),
    batchAccumulationMaxMs: inputHz > 0 ? ((batchSize - 1) * 1000) / inputHz : 0,
    estimatedFirstPointVisibleP95Ms: 0,
    rendererApplyP95Ms: percentile(rendererDurations, 0.95),
    sceneSnapshotP95Bytes: percentile(sceneBytes, 0.95),
    sceneSnapshotMaxBytes: Math.max(...sceneBytes),
    copiedInputBytes,
    processedPointCount,
    ignoredPointCount,
    commitCount,
    longTaskCount: inputToVisibleDurations.filter((duration) => duration >= 50).length,
    elapsedMs,
    pointsPerSecond: elapsedMs > 0 ? (movePointCount * 1000) / elapsedMs : 0,
  };
  metrics.estimatedFirstPointVisibleP95Ms =
    metrics.inputToVisibleP95Ms + metrics.batchAccumulationMaxMs;
  return {
    sample: {
      durationSeconds,
      inputHz,
      movePointCount,
      transport: benchmarkCase.transport,
      batchSize,
    },
    metrics,
    decision: {
      isWithinFrameBudget: metrics.estimatedFirstPointVisibleP95Ms <= 16.7,
      hasOrderedSingleCommit: ignoredPointCount === 0 && commitCount === 1,
    },
  };
}

function strokePoint(index: number, total: number) {
  const progress = index / total;
  return {
    x: 80 + progress * 800,
    y: 320 + Math.sin(progress * Math.PI * 12) * 120,
  };
}

function copiedBytes(batch: StrokeInputBatchV1, transport: StrokeTransportV1): number {
  if (transport === 'typed_array') {
    return batch.points.length * 2 * Float64Array.BYTES_PER_ELEMENT;
  }
  return new TextEncoder().encode(JSON.stringify(batch)).byteLength;
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}
