import { describe, expect, it, vi } from 'vitest';

import type { EditorActionResultV1, EditorWebControllerV1 } from './index';
import { runStrokeBenchmark } from './stroke-benchmark';

describe('runStrokeBenchmark', () => {
  it('compares JSON points with multiple TypedArray batch sizes', async () => {
    let clock = 0;
    const dispatch = vi.fn(async (action): Promise<EditorActionResultV1> => {
      if (action.type === 'undo') {
        return success();
      }
      if (action.type !== 'stroke_batch') {
        throw new Error('unexpected action');
      }
      const pointCount = action.batch.points.length;
      clock += pointCount;
      return {
        ...success(),
        strokeMetrics: {
          processedPointCount: pointCount,
          ignoredPointCount: 0,
          didCommit: action.batch.phase === 'up',
        },
        performance: {
          inputToVisibleMs: pointCount,
          rendererApplyMs: pointCount / 2,
          sceneBytes: pointCount * 100,
          changedNodeCount: 1,
        },
      };
    });

    const report = await runStrokeBenchmark({
      controller: { dispatch },
      durationSeconds: 1,
      inputHz: 4,
      cases: [
        { name: 'jsonPoint', transport: 'json', batchSize: 1 },
        { name: 'typedArray2', transport: 'typed_array', batchSize: 2 },
      ],
      now: () => clock,
    });

    expect(report.cases.jsonPoint).toMatchObject({
      sample: { movePointCount: 4, batchSize: 1, transport: 'json' },
      metrics: {
        processedPointCount: 6,
        ignoredPointCount: 0,
        commitCount: 1,
        rendererApplyP95Ms: 0.5,
        batchAccumulationMaxMs: 0,
        estimatedFirstPointVisibleP95Ms: 1,
      },
      decision: { isWithinFrameBudget: true, hasOrderedSingleCommit: true },
    });
    expect(report.cases.typedArray2?.metrics.copiedInputBytes).toBe(96);
    expect(report.cases.typedArray2?.decision.isWithinFrameBudget).toBe(false);
    expect(report.cases.jsonPoint?.metrics.copiedInputBytes).toBeGreaterThan(96);
    expect(dispatch.mock.calls.filter(([action]) => action.type === 'undo')).toHaveLength(1);
  });

  it('normalizes a zero batch size and reports budget or ordering failures', async () => {
    let call = 0;
    const controller: Pick<EditorWebControllerV1, 'dispatch'> = {
      dispatch: async (action) => {
        call += 1;
        if (action.type !== 'stroke_batch') {
          return success();
        }
        return {
          ...success(),
          strokeMetrics: {
            processedPointCount: action.batch.points.length,
            ignoredPointCount: action.batch.phase === 'move' ? 1 : 0,
            didCommit: action.batch.phase === 'up',
          },
          performance: {
            inputToVisibleMs: 60,
            rendererApplyMs: 4,
            sceneBytes: 200,
            changedNodeCount: 1,
          },
        };
      },
    };

    const report = await runStrokeBenchmark({
      controller,
      durationSeconds: 0,
      inputHz: 0,
      cases: [{ name: 'slow', transport: 'typed_array', batchSize: 0 }],
      now: () => call * 60,
    });

    expect(report.cases.slow).toMatchObject({
      sample: { movePointCount: 1, batchSize: 1 },
      metrics: { longTaskCount: 3 },
      decision: { isWithinFrameBudget: false, hasOrderedSingleCommit: false },
    });
  });

  it('rejects failed dispatches and failed fixture resets', async () => {
    const failed = {
      dispatch: vi.fn(async () => ({
        ...success(),
        ok: false,
        snapshot: { ...success().snapshot, errorMessage: 'stroke failed' },
      })),
    };
    await expect(
      runStrokeBenchmark({
        controller: failed,
        durationSeconds: 1,
        inputHz: 1,
        cases: [{ name: 'json', transport: 'json', batchSize: 1 }],
      }),
    ).rejects.toThrow('stroke failed');

    let isUndo = false;
    const resetFailed = {
      dispatch: vi.fn(async (action): Promise<EditorActionResultV1> => {
        if (action.type === 'undo') {
          isUndo = true;
          return {
            ...success(),
            ok: false,
            snapshot: { ...success().snapshot, errorMessage: 'undo failed' },
          };
        }
        return {
          ...success(),
          strokeMetrics: {
            processedPointCount: action.type === 'stroke_batch' ? action.batch.points.length : 0,
            ignoredPointCount: 0,
            didCommit: action.type === 'stroke_batch' && action.batch.phase === 'up',
          },
          performance: {
            inputToVisibleMs: 1,
            rendererApplyMs: 1,
            sceneBytes: 1,
            changedNodeCount: 1,
          },
        };
      }),
    };
    await expect(
      runStrokeBenchmark({
        controller: resetFailed,
        durationSeconds: 1,
        inputHz: 1,
        cases: [
          { name: 'first', transport: 'json', batchSize: 1 },
          { name: 'second', transport: 'typed_array', batchSize: 2 },
        ],
      }),
    ).rejects.toThrow('undo failed');
    expect(isUndo).toBe(true);
  });
});

function success(): EditorActionResultV1 {
  return {
    ok: true,
    snapshot: {
      status: 'ready',
      documentRevision: 0,
      sceneRevision: 0,
      elementCount: 0,
      activeElementId: null,
      selectionBounds: null,
      canUndo: false,
      canRedo: false,
      errorMessage: null,
      saveStatus: 'saved',
      saveErrorMessage: null,
      documentAccess: 'writer',
      readonlyReason: null,
      recovery: 'blank',
      camera: { x: 0, y: 0, zoom: 1 },
      cameraZoomPercent: 100,
      cameraSaveStatus: 'saved',
      cameraSaveErrorMessage: null,
    },
  };
}
