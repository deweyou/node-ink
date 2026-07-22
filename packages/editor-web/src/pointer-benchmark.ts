import type { NormalizedPointerEventV1 } from '@nodeink-internal/protocol';

import type { EditorWebControllerV1 } from './index';

export interface PointerBenchmarkOptions {
  controller: Pick<EditorWebControllerV1, 'dispatch'>;
  startPoint: { x: number; y: number };
  durationSeconds?: number;
  inputHz?: number;
  batchSize?: number;
  now?: () => number;
}

export interface PointerBenchmarkResult {
  sample: {
    durationSeconds: number;
    inputHz: number;
    moveEventCount: number;
    batchSize: number;
  };
  metrics: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    bytes: number;
    processedEventCount: number;
    ignoredEventCount: number;
    commitCount: number;
    longTaskCount: number;
  };
  decision: {
    isWithinFrameBudget: boolean;
    hasOrderedSingleCommit: boolean;
  };
}

export async function runPointerBenchmark({
  controller,
  startPoint,
  durationSeconds = 30,
  inputHz = 120,
  batchSize = 1,
  now = () => performance.now(),
}: PointerBenchmarkOptions): Promise<PointerBenchmarkResult> {
  const moveEventCount = Math.max(1, Math.round(durationSeconds * inputHz));
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  const durations: number[] = [];
  let bytes = 0;
  let processedEventCount = 0;
  let ignoredEventCount = 0;
  let commitCount = 0;
  let sequence = 1;

  const dispatch = async (events: NormalizedPointerEventV1[]) => {
    const startedAt = now();
    const result = await controller.dispatch({ type: 'pointer_events', events });
    durations.push(now() - startedAt);
    bytes += new TextEncoder().encode(JSON.stringify(events)).byteLength;
    if (!result.ok || !result.pointerMetrics) {
      throw new Error(result.snapshot.errorMessage ?? 'pointer benchmark dispatch failed');
    }
    processedEventCount += result.pointerMetrics.processedEventCount;
    ignoredEventCount += result.pointerMetrics.ignoredEventCount;
    commitCount += result.pointerMetrics.didCommit ? 1 : 0;
  };

  await dispatch([pointerEvent('down', sequence, startPoint.x, startPoint.y)]);
  sequence += 1;

  for (let offset = 0; offset < moveEventCount; offset += normalizedBatchSize) {
    const events: NormalizedPointerEventV1[] = [];
    const batchEnd = Math.min(moveEventCount, offset + normalizedBatchSize);
    for (let index = offset; index < batchEnd; index += 1) {
      const progress = (index + 1) / moveEventCount;
      events.push(pointerEvent('move', sequence, startPoint.x + progress * 120, startPoint.y));
      sequence += 1;
    }
    await dispatch(events);
  }

  await dispatch([pointerEvent('up', sequence, startPoint.x + 120, startPoint.y)]);

  const metrics = {
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max(...durations),
    bytes,
    processedEventCount,
    ignoredEventCount,
    commitCount,
    longTaskCount: durations.filter((duration) => duration >= 50).length,
  };
  return {
    sample: { durationSeconds, inputHz, moveEventCount, batchSize: normalizedBatchSize },
    metrics,
    decision: {
      isWithinFrameBudget: metrics.p95Ms <= 16.7,
      hasOrderedSingleCommit: ignoredEventCount === 0 && commitCount === 1,
    },
  };
}

function pointerEvent(
  phase: NormalizedPointerEventV1['phase'],
  sequence: number,
  x: number,
  y: number,
): NormalizedPointerEventV1 {
  return {
    pointerId: 1,
    sequence,
    phase,
    point: { x, y },
  };
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}
