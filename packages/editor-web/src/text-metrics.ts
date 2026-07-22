import type {
  TextMeasureRequestV1,
  TextMetricsSnapshotV1,
  TextMetricsV1,
  TextRunV1,
} from '@nodeink-internal/protocol';

import { NODEINK_CANVAS_FONT_EPOCH, NODEINK_CANVAS_FONT_FAMILY } from './text-font';

export interface TextMeasureBatchResultV1 {
  snapshot: TextMetricsSnapshotV1;
  cacheHitCount: number;
  measuredRunCount: number;
  durationMs: number;
}

export interface CanvasTextMetricsAdapterOptions {
  fixedFontFamily?: string;
  fontEpoch?: string;
  createContext?: () => Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;
  now?: () => number;
  fontStatus?: () => string;
}

export class CanvasTextMetricsAdapter {
  readonly #fixedFontFamily: string;
  readonly #createContext: () => Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;
  readonly #now: () => number;
  readonly #fontStatus: () => string;
  readonly #cache = new Map<string, TextMetricsV1>();
  #fontEpoch: string;

  constructor({
    fixedFontFamily = NODEINK_CANVAS_FONT_FAMILY,
    fontEpoch = NODEINK_CANVAS_FONT_EPOCH,
    createContext = defaultCanvasContext,
    now = () => performance.now(),
    fontStatus = () => document.fonts?.status ?? 'unsupported',
  }: CanvasTextMetricsAdapterOptions = {}) {
    this.#fixedFontFamily = fixedFontFamily;
    this.#fontEpoch = fontEpoch;
    this.#createContext = createContext;
    this.#now = now;
    this.#fontStatus = fontStatus;
  }

  fingerprint(): string {
    return `${this.#fontEpoch}:${this.#fontStatus()}:${this.#fixedFontFamily}`;
  }

  invalidateFont(nextEpoch: string): void {
    this.#fontEpoch = nextEpoch;
    this.#cache.clear();
  }

  measure(request: TextMeasureRequestV1): TextMeasureBatchResultV1 {
    const fingerprint = this.fingerprint();
    if (request.fontFingerprint !== fingerprint) {
      throw new Error('Text measure request fingerprint is stale');
    }
    const startedAt = this.#now();
    const context = this.#createContext();
    let cacheHitCount = 0;
    let measuredRunCount = 0;
    const metrics = request.runs.map((run) => {
      const key = cacheKey(fingerprint, run);
      const cached = this.#cache.get(key);
      if (cached) {
        cacheHitCount += 1;
        return cached;
      }
      const measured = measureRun(context, run);
      this.#cache.set(key, measured);
      measuredRunCount += 1;
      return measured;
    });
    return {
      snapshot: { fontFingerprint: fingerprint, metrics },
      cacheHitCount,
      measuredRunCount,
      durationMs: this.#now() - startedAt,
    };
  }
}

function measureRun(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  run: TextRunV1,
): TextMetricsV1 {
  context.font = `${run.fontWeight} ${run.fontSize}px ${run.fontFamily}`;
  const lines = run.text.split('\n');
  let baseline = run.fontSize * 0.8;
  const measuredWidths = lines.map((line) => {
    const measurement = context.measureText(line);
    baseline = Math.max(baseline, measurement.actualBoundingBoxAscent || 0);
    return measurement.width;
  });
  const width = Math.min(Math.max(...measuredWidths, 0), run.maxWidth ?? Number.POSITIVE_INFINITY);
  return {
    key: run.key,
    width,
    height: lines.length * run.fontSize * 1.25,
    baseline,
    lineBreaks: newlineIndices(run.text),
  };
}

function newlineIndices(text: string): number[] {
  const indices: number[] = [];
  let index = 0;
  for (const character of text) {
    if (character === '\n') {
      indices.push(index);
    }
    index += 1;
  }
  return indices;
}

function cacheKey(fingerprint: string, run: TextRunV1): string {
  return `${fingerprint}:${JSON.stringify(run)}`;
}

function defaultCanvasContext(): CanvasRenderingContext2D {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D text measurement is unavailable');
  }
  return context;
}
