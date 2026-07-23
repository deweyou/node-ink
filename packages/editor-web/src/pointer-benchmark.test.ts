import { describe, expect, it } from 'vitest';

import type { EditorActionResultV1, EditorUiSnapshotV1 } from './index';
import { runPointerBenchmark } from './pointer-benchmark';

const readySnapshot: EditorUiSnapshotV1 = {
  status: 'ready',
  documentRevision: 0,
  sceneRevision: 0,
  elementCount: 1,
  activeElementId: 'rect-1',
  selectedElementIds: ['rect-1'],
  primaryElementId: 'rect-1',
  activeTool: 'select',
  selectionBounds: { x: 0, y: 0, width: 100, height: 80 },
  selectionOrientedBounds: null,
  selectionHandles: [],
  selectionMarquee: null,
  alignmentGuides: [],
  selectionStyle: {
    kind: 'rect',
    fill: { kind: 'solid', color: '#d1fae5' },
    stroke: '#047857',
    strokeWidth: 2,
  },
  renderProfile: { kind: 'clean', version: 1 },
  canUndo: false,
  canRedo: false,
  errorMessage: null,
  saveStatus: 'saved',
  saveErrorMessage: null,
  documentAccess: 'writer',
  readonlyReason: null,
  takeoverAvailable: false,
  takeoverStatus: 'idle',
  takeoverErrorMessage: null,
  recovery: 'blank',
  camera: { x: 0, y: 0, zoom: 1 },
  cameraZoomPercent: 100,
  cameraSaveStatus: 'saved',
  cameraSaveErrorMessage: null,
};

describe('runPointerBenchmark', () => {
  it('reports percentiles, bytes, ordering, and one commit', async () => {
    const clock = [0, 1, 2, 4, 5, 8];
    const controller = {
      dispatch: async (action: {
        type: string;
        events?: unknown[];
      }): Promise<EditorActionResultV1> => ({
        ok: true,
        snapshot: readySnapshot,
        pointerMetrics: {
          processedEventCount: action.events?.length ?? 0,
          ignoredEventCount: 0,
          didCommit:
            action.type === 'pointer_events' &&
            action.events?.some((event) => (event as { phase?: string }).phase === 'up') === true,
        },
      }),
    };

    const result = await runPointerBenchmark({
      controller,
      startPoint: { x: 50, y: 40 },
      durationSeconds: 0.01,
      inputHz: 100,
      batchSize: 0,
      now: () => clock.shift() ?? 8,
    });

    expect(result.sample).toEqual({
      durationSeconds: 0.01,
      inputHz: 100,
      moveEventCount: 1,
      batchSize: 1,
    });
    expect(result.metrics).toMatchObject({
      p50Ms: 2,
      p95Ms: 3,
      p99Ms: 3,
      maxMs: 3,
      processedEventCount: 3,
      ignoredEventCount: 0,
      commitCount: 1,
      longTaskCount: 0,
    });
    expect(result.metrics.bytes).toBeGreaterThan(0);
    expect(result.decision).toEqual({
      isWithinFrameBudget: true,
      hasOrderedSingleCommit: true,
    });
  });

  it('fails when the controller does not provide pointer processing metadata', async () => {
    await expect(
      runPointerBenchmark({
        controller: {
          dispatch: async () => ({
            ok: false,
            snapshot: { ...readySnapshot, errorMessage: 'engine failed' },
          }),
        },
        startPoint: { x: 50, y: 40 },
        durationSeconds: 0,
        inputHz: 0,
      }),
    ).rejects.toThrow('engine failed');
  });
});
