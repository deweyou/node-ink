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
          text: '✍️🎨',
          fontFamily: 'Arial',
          fontSize: 24,
          fontWeight: 400 as const,
          maxWidth: null,
        },
      ],
    };

    const first = adapter.measure(request);
    const cached = adapter.measure(request);

    expect(first).toMatchObject({ cacheHitCount: 0, measuredRunCount: 3, durationMs: 2 });
    expect(first.snapshot.metrics[0]).toMatchObject({
      key: 'latin',
      width: 55,
      height: 50,
      baseline: 16,
      lineBreaks: [7],
    });
    expect(cached).toMatchObject({ cacheHitCount: 3, measuredRunCount: 0, durationMs: 2 });
    expect(measureText).toHaveBeenCalledTimes(4);
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
