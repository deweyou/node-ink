import { describe, expect, it } from 'vitest';

import type { ScenePatchV1, SceneSnapshotV1 } from '@nodeink-internal/protocol';

import { SvgRenderer } from './index';

describe('SvgRenderer', () => {
  it('reuses a rectangle node while applying snapshots', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(1, 24));
    const firstRectangle = target.querySelector('rect');

    renderer.applySnapshot(scene(2, 56));
    const movedRectangle = target.querySelector('rect');

    expect(movedRectangle).toBe(firstRectangle);
    expect(movedRectangle?.getAttribute('x')).toBe('56');
    expect(movedRectangle?.getAttribute('stroke-width')).toBe('2');
    expect(target.querySelector('svg')?.dataset.sceneRevision).toBe('2');
  });

  it('removes stale nodes and supports repeated mount and unmount', () => {
    const firstTarget = document.createElement('div');
    const secondTarget = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(firstTarget);
    renderer.applySnapshot(scene(1, 24));

    renderer.applySnapshot({ ...scene(2, 24), rootNodeIds: [], nodes: {} });
    expect(firstTarget.querySelector('rect')).toBeNull();

    renderer.mount(secondTarget);
    expect(firstTarget.querySelector('svg')).toBeNull();
    expect(secondTarget.querySelector('svg')).not.toBeNull();

    renderer.unmount();
    renderer.unmount();
    expect(secondTarget.querySelector('svg')).toBeNull();
  });

  it('renders and reuses freehand paths with measured DOM work', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const first = renderer.applySnapshot(strokeScene(1, 'M 1 2 L 3 4'));
    const firstPath = target.querySelector('path');

    const second = renderer.applySnapshot(strokeScene(2, 'M 1 2 L 5 6'));
    const updatedPath = target.querySelector('path');

    expect(updatedPath).toBe(firstPath);
    expect(updatedPath?.getAttribute('d')).toBe('M 1 2 L 5 6');
    expect(updatedPath?.getAttribute('stroke-linecap')).toBe('round');
    expect(first).toMatchObject({ ok: true, sceneRevision: 1, changedNodeCount: 1 });
    expect(second).toMatchObject({ ok: true, sceneRevision: 2, changedNodeCount: 1 });
    if (first.ok) {
      expect(first.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('renders text runs and updates them through a patch', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(textScene(1, 'NodeInk'));
    const firstText = target.querySelector('text');

    const result = renderer.applyPatch({
      protocolVersion: 1,
      documentRevision: 2,
      baseSceneRevision: 1,
      sceneRevision: 2,
      addedNodes: {},
      updatedNodes: textScene(2, '画布').nodes,
      removedNodeIds: [],
      rootNodeIds: null,
    });

    expect(result).toMatchObject({ ok: true, changedNodeCount: 1 });
    expect(target.querySelector('text')).toBe(firstText);
    expect(firstText?.querySelector('tspan')?.textContent).toBe('画布');
    expect(firstText?.querySelector('tspan')?.getAttribute('font-family')).toBe('Arial');
  });

  it('updates the viewport independently of scene revision', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);

    const result = renderer.setViewport({ x: 120, y: 80, width: 640, height: 480 });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(target.querySelector('svg')?.getAttribute('viewBox')).toBe('120 80 640 480');
  });

  it('renders a straight selection ring with explicit world-space padding', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(1, 24));

    renderer.setOverlay({
      selectionBounds: { x: 20, y: 32, width: 160, height: 96 },
      selectionPaddingWorld: 3,
    });

    const svg = target.querySelector('svg');
    const overlay = target.querySelector('[data-nodeink-overlay]');
    const outline = target.querySelector('[data-nodeink-selection-outline]');
    expect(outline?.getAttribute('x')).toBe('17');
    expect(outline?.getAttribute('y')).toBe('29');
    expect(outline?.getAttribute('width')).toBe('166');
    expect(outline?.getAttribute('height')).toBe('102');
    expect(outline?.hasAttribute('rx')).toBe(false);
    expect(outline?.getAttribute('stroke')).toContain('--nodeink-selection-color');
    expect(outline?.getAttribute('stroke-width')).toBe('2');
    expect(outline?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(outline?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(overlay?.getAttribute('pointer-events')).toBe('none');
    expect(svg?.lastElementChild).toBe(overlay);

    renderer.setOverlay({ selectionBounds: null, selectionPaddingWorld: 3 });
    expect(target.querySelector('[data-nodeink-selection-outline]')).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid selection padding %s',
    (selectionPaddingWorld) => {
      const renderer = new SvgRenderer();
      renderer.mount(document.createElement('div'));

      expect(() => renderer.setOverlay({ selectionBounds: null, selectionPaddingWorld })).toThrow(
        'finite non-negative',
      );
    },
  );

  it.each([
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: -1 },
  ])('rejects invalid viewports without updating the SVG', (viewport) => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);

    expect(() => renderer.setViewport(viewport)).toThrow('positive dimensions');
    expect(target.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 960 640');
  });

  it('rejects unsupported or missing scene nodes', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);

    expect(
      renderer.applySnapshot({
        ...scene(1, 24),
        nodes: {},
      }),
    ).toEqual({ ok: false, reason: 'unsupported_scene' });
  });

  it('requires a mounted SVG before applying a snapshot', () => {
    const renderer = new SvgRenderer();

    expect(() => renderer.applySnapshot(scene(1, 24))).toThrow('must be mounted');
  });

  it('applies an in-order move patch while reusing the SVG node', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(1, 24));
    const firstRectangle = target.querySelector('rect');

    const result = renderer.applyPatch(movePatch(1, 2, 88));

    expect(result).toMatchObject({ ok: true, sceneRevision: 2, changedNodeCount: 1 });
    expect(target.querySelector('rect')).toBe(firstRectangle);
    expect(firstRectangle?.getAttribute('x')).toBe('88');
    expect(target.querySelector('svg')?.dataset.sceneRevision).toBe('2');
  });

  it('rejects an out-of-order patch without mutating the DOM', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(3, 24));

    expect(renderer.applyPatch(movePatch(1, 2, 88))).toEqual({
      ok: false,
      reason: 'snapshot_required',
    });
    expect(target.querySelector('rect')?.getAttribute('x')).toBe('24');
    expect(target.querySelector('svg')?.dataset.sceneRevision).toBe('3');
  });

  it('applies additions, removals, and explicit root order changes', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(1, 24));
    const added = {
      ...scene(2, 40).nodes['rect-1:shape']!,
      id: 'rect-2:shape',
      sourceElementId: 'rect-2',
    };

    const result = renderer.applyPatch({
      protocolVersion: 1,
      documentRevision: 2,
      baseSceneRevision: 1,
      sceneRevision: 2,
      addedNodes: { 'rect-2:shape': added },
      updatedNodes: {},
      removedNodeIds: ['rect-1:shape'],
      rootNodeIds: ['rect-2:shape'],
    });

    expect(result).toMatchObject({ ok: true, changedNodeCount: 2 });
    expect(target.querySelector('[data-scene-node-id="rect-1:shape"]')).toBeNull();
    expect(target.querySelector('[data-scene-node-id="rect-2:shape"]')).not.toBeNull();
  });

  it('rejects a patch whose root order references a missing node', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    renderer.applySnapshot(scene(1, 24));

    expect(
      renderer.applyPatch({
        protocolVersion: 1,
        documentRevision: 2,
        baseSceneRevision: 1,
        sceneRevision: 2,
        addedNodes: {},
        updatedNodes: {},
        removedNodeIds: [],
        rootNodeIds: ['missing'],
      }),
    ).toEqual({ ok: false, reason: 'unsupported_scene' });
  });

  it('requires a mounted SVG before applying a patch', () => {
    expect(() => new SvgRenderer().applyPatch(movePatch(1, 2, 88))).toThrow('must be mounted');
  });

  it('requires a mounted SVG before updating the viewport', () => {
    expect(() => new SvgRenderer().setViewport({ x: 0, y: 0, width: 960, height: 640 })).toThrow(
      'must be mounted',
    );
  });
});

function scene(sceneRevision: number, x: number): SceneSnapshotV1 {
  return {
    protocolVersion: 1,
    documentId: 'doc-1',
    documentRevision: sceneRevision,
    sceneRevision,
    rootNodeIds: ['rect-1:shape'],
    nodes: {
      'rect-1:shape': {
        kind: 'rect',
        id: 'rect-1:shape',
        sourceElementId: 'rect-1',
        x,
        y: 40,
        width: 160,
        height: 96,
        fill: '#d1fae5',
        stroke: '#047857',
        strokeWidth: 2,
      },
    },
  };
}

function strokeScene(sceneRevision: number, pathData: string): SceneSnapshotV1 {
  return {
    protocolVersion: 1,
    documentId: 'doc-1',
    documentRevision: 0,
    sceneRevision,
    rootNodeIds: ['stroke-1:path'],
    nodes: {
      'stroke-1:path': {
        kind: 'path',
        id: 'stroke-1:path',
        sourceElementId: 'stroke-1',
        pathData,
        fill: 'none',
        stroke: '#0f172a',
        strokeWidth: 3,
      },
    },
  };
}

function movePatch(baseSceneRevision: number, sceneRevision: number, x: number): ScenePatchV1 {
  return {
    protocolVersion: 1,
    documentRevision: sceneRevision,
    baseSceneRevision,
    sceneRevision,
    addedNodes: {},
    updatedNodes: { 'rect-1:shape': scene(sceneRevision, x).nodes['rect-1:shape']! },
    removedNodeIds: [],
    rootNodeIds: null,
  };
}

function textScene(sceneRevision: number, value: string): SceneSnapshotV1 {
  return {
    protocolVersion: 1,
    documentId: 'text-fixture',
    documentRevision: sceneRevision,
    sceneRevision,
    rootNodeIds: ['text-1:run'],
    nodes: {
      'text-1:run': {
        kind: 'text',
        id: 'text-1:run',
        sourceElementId: 'text-1',
        runs: [
          {
            text: value,
            x: 24,
            y: 48,
            fontFamily: 'Arial',
            fontSize: 20,
            fontWeight: 400,
            fill: '#0f172a',
          },
        ],
      },
    },
  };
}
