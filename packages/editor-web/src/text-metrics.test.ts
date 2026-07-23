import { describe, expect, it, vi } from 'vitest';

import { CanvasTextMetricsAdapter } from './text-metrics';

describe('CanvasTextMetricsAdapter', () => {
  it('measures multiline Latin, CJK and emoji then serves them from cache', () => {
    let clock = 0;
    const measureText = vi.fn((text: string) => ({
      width: text.length * 10,
      actualBoundingBoxAscent: 16,
    }));
    const adapter = new CanvasTextMetricsAdapter({
      createContext: () => ({ font: '', measureText }) as never,
      now: () => (clock += 2),
      fontStatus: () => 'loaded',
    });
    const request = {
      requestId: 'measure-1',
      fontFingerprint: adapter.fingerprint(),
      runs: [
        {
          key: 'latin',
          text: 'NodeInk\ncanvas',
          fontFamily: 'Arial',
          fontSize: 20,
          fontWeight: 500 as const,
          maxWidth: 55,
        },
        {
          key: 'cjk',
          text: '你好画布',
          fontFamily: 'Arial',
          fontSize: 20,
          fontWeight: 400 as const,
          maxWidth: null,
        },
        {
          key: 'emoji',
          text: '🎨\n画布',
          fontFamily: 'Arial',
          fontSize: 24,
          fontWeight: 400 as const,
          maxWidth: null,
        },
      ],
    };

    const first = adapter.measure(request);
    const measuredCallCount = measureText.mock.calls.length;
    const cached = adapter.measure(request);

    expect(first).toMatchObject({ cacheHitCount: 0, measuredRunCount: 3, durationMs: 2 });
    expect(first.snapshot.metrics[0]).toMatchObject({
      key: 'latin',
      width: 50,
      height: 100,
      baseline: 16,
      lineBreaks: [5, 7, 13],
    });
    expect(first.snapshot.metrics[2]?.lineBreaks).toEqual([1]);
    expect(cached).toMatchObject({ cacheHitCount: 3, measuredRunCount: 0, durationMs: 2 });
    expect(measuredCallCount).toBeGreaterThan(5);
    expect(measureText).toHaveBeenCalledTimes(measuredCallCount);
  });

  it('soft-wraps unbroken text at max width without splitting Unicode code points', () => {
    const measureText = vi.fn((text: string) => ({
      width: Array.from(text).length * 10,
      actualBoundingBoxAscent: 16,
    }));
    const adapter = new CanvasTextMetricsAdapter({
      createContext: () => ({ font: '', measureText }) as never,
      fontStatus: () => 'loaded',
    });

    const measured = adapter.measure({
      requestId: 'soft-wrap',
      fontFingerprint: adapter.fingerprint(),
      runs: [
        {
          key: 'digits',
          text: '1234567',
          fontFamily: 'Arial',
          fontSize: 20,
          fontWeight: 400,
          maxWidth: 25,
        },
        {
          key: 'emoji',
          text: '🎨🎨🎨',
          fontFamily: 'Arial',
          fontSize: 20,
          fontWeight: 400,
          maxWidth: 25,
        },
      ],
    });

    expect(measured.snapshot.metrics).toEqual([
      {
        key: 'digits',
        width: 20,
        height: 100,
        baseline: 16,
        lineBreaks: [2, 4, 6],
      },
      {
        key: 'emoji',
        width: 20,
        height: 50,
        baseline: 16,
        lineBreaks: [2],
      },
    ]);
  });

  it('changes fingerprint and clears cache after a font epoch change', () => {
    const measureText = vi.fn(() => ({ width: 20, actualBoundingBoxAscent: 0 }));
    const adapter = new CanvasTextMetricsAdapter({
      fixedFontFamily: 'NodeInk Fixture Sans',
      createContext: () => ({ font: '', measureText }) as never,
      fontStatus: () => 'loaded',
    });
    const run = {
      key: 'one',
      text: 'A',
      fontFamily: 'NodeInk Fixture Sans',
      fontSize: 10,
      fontWeight: 400 as const,
      maxWidth: null,
    };
    const before = adapter.fingerprint();
    adapter.measure({ requestId: 'one', fontFingerprint: before, runs: [run] });
    adapter.invalidateFont('nodeink-fixture-font-v2');
    const after = adapter.fingerprint();
    adapter.measure({ requestId: 'two', fontFingerprint: after, runs: [run] });

    expect(after).not.toBe(before);
    expect(measureText).toHaveBeenCalledTimes(2);
    expect(() =>
      adapter.measure({ requestId: 'stale', fontFingerprint: before, runs: [run] }),
    ).toThrow('fingerprint is stale');
  });

  it('reports an unavailable default Canvas context', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const adapter = new CanvasTextMetricsAdapter({ fontStatus: () => 'unsupported' });

    expect(() =>
      adapter.measure({
        requestId: 'one',
        fontFingerprint: adapter.fingerprint(),
        runs: [],
      }),
    ).toThrow('unavailable');
    getContext.mockRestore();
  });
});
