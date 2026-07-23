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
    const first = renderer.applySnapshot(strokeScene(1, 'M 1 2 Q 2 3 3 4'));
    const firstPath = target.querySelector('path');

    const second = renderer.applySnapshot(strokeScene(2, 'M 1 2 Q 3 4 5 6'));
    const updatedPath = target.querySelector('path');

    expect(updatedPath).toBe(firstPath);
    expect(updatedPath?.getAttribute('d')).toBe('M 1 2 Q 3 4 5 6');
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
    expect(firstText?.querySelector('tspan')?.getAttribute('font-family')).toBe(
      'Noto Sans SC Variable',
    );
    expect(firstText?.querySelector('tspan')?.getAttribute('text-anchor')).toBe('middle');
  });

  it('applies Scene affine transforms to rectangles, paths, and text', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const affine = { a: 0, b: 1, c: -1, d: 0, e: 120, f: 48 };

    const rectangle = scene(1, 24);
    rectangle.nodes['rect-1:shape']!.transform = affine;
    renderer.applySnapshot(rectangle);
    expect(
      target.querySelector('[data-scene-node-id="rect-1:shape"]')?.getAttribute('transform'),
    ).toBe('matrix(0 1 -1 0 120 48)');

    const stroke = strokeScene(2, 'M 1 2 L 3 4');
    stroke.nodes['stroke-1:path']!.transform = affine;
    renderer.applySnapshot(stroke);
    expect(target.querySelector('path')?.getAttribute('transform')).toBe('matrix(0 1 -1 0 120 48)');

    const text = textScene(3, 'NodeInk');
    text.nodes['text-1:run']!.transform = affine;
    renderer.applySnapshot(text);
    expect(target.querySelector('text')?.getAttribute('transform')).toBe('matrix(0 1 -1 0 120 48)');
  });

  it('keeps document stroke width stable across element resize while following camera zoom', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const svg = target.querySelector('svg')!;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ width: 960, height: 640 }),
    });
    renderer.setViewport({ x: 0, y: 0, width: 480, height: 320 });

    const stretched = scene(1, 24);
    const stretchedPath = strokeScene(1, 'M 1 2 L 3 4').nodes['stroke-1:path']!;
    stretched.rootNodeIds.push(stretchedPath.id);
    stretched.nodes[stretchedPath.id] = stretchedPath;
    stretched.nodes['rect-1:shape']!.transform = {
      a: 4,
      b: 0,
      c: 0,
      d: 0.5,
      e: 0,
      f: 0,
    };
    stretchedPath.transform = stretched.nodes['rect-1:shape']!.transform;
    renderer.applySnapshot(stretched);

    const rectangle = target.querySelector('[data-scene-node-id="rect-1:shape"]');
    const path = target.querySelector('[data-scene-node-id="stroke-1:path"]');
    expect(rectangle?.getAttribute('stroke-width')).toBe('4');
    expect(rectangle?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(path?.getAttribute('stroke-width')).toBe('6');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');

    stretched.sceneRevision = 2;
    stretched.nodes['rect-1:shape']!.transform = {
      a: 0.25,
      b: 0,
      c: 0,
      d: 8,
      e: 0,
      f: 0,
    };
    stretchedPath.transform = stretched.nodes['rect-1:shape']!.transform;
    renderer.applySnapshot(stretched);
    expect(rectangle?.getAttribute('stroke-width')).toBe('4');
    expect(path?.getAttribute('stroke-width')).toBe('6');

    renderer.setViewport({ x: 0, y: 0, width: 960, height: 640 });
    expect(rectangle?.getAttribute('stroke-width')).toBe('2');
    expect(path?.getAttribute('stroke-width')).toBe('3');
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
      selectionOrientedBounds: null,
      selectionHandles: [],
      selectionPaddingWorld: 3,
      marquee: null,
      guides: [],
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

    renderer.setOverlay(emptyOverlay(3));
    expect(target.querySelector('[data-nodeink-selection-outline]')).toBeNull();
  });

  it('renders oriented selection handles, marquee, and restrained guides at stable screen sizes', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const overlay = {
      selectionBounds: { x: 80, y: 70, width: 40, height: 20 },
      selectionOrientedBounds: {
        center: { x: 100, y: 80 },
        width: 40,
        height: 20,
        rotation: Math.PI / 2,
      },
      selectionHandles: selectionHandles(),
      selectionPaddingWorld: 3,
      marquee: {
        bounds: { x: 12, y: 18, width: 88, height: 64 },
        mode: 'add' as const,
      },
      guides: [
        { axis: 'x' as const, position: 64, start: 8, end: 180 },
        { axis: 'y' as const, position: 96, start: 12, end: 220 },
      ],
    };

    renderer.setOverlay(overlay);

    const outline = target.querySelector('[data-nodeink-selection-outline]');
    expect(outline?.getAttribute('x')).toBe('-23');
    expect(outline?.getAttribute('y')).toBe('-13');
    expect(outline?.getAttribute('transform')).toBe('translate(100 80) rotate(90)');
    const handles = target.querySelectorAll('[data-nodeink-selection-handle]');
    expect(handles).toHaveLength(9);
    expect(
      target.querySelector('[data-nodeink-selection-handle="north_west"]')?.getAttribute('width'),
    ).toBe('4');
    expect(
      target.querySelector('[data-nodeink-selection-handle="rotate"]')?.getAttribute('r'),
    ).toBe('2.5');
    expect(target.querySelector('[data-nodeink-rotate-connector]')).not.toBeNull();
    expect(
      target.querySelector('[data-nodeink-selection-marquee="add"]')?.getAttribute('fill'),
    ).toContain('rgba(37, 99, 235, 0.12)');
    const verticalGuide = target.querySelector('[data-nodeink-alignment-guide="x"]');
    expect(verticalGuide?.getAttribute('x1')).toBe('64');
    expect(verticalGuide?.getAttribute('y2')).toBe('180');
    expect(verticalGuide?.getAttribute('vector-effect')).toBe('non-scaling-stroke');

    renderer.setOverlay({ ...overlay, selectionPaddingWorld: 6 });
    expect(
      target.querySelector('[data-nodeink-selection-handle="north_west"]')?.getAttribute('width'),
    ).toBe('8');
    expect(target.querySelector('[data-nodeink-overlay]')?.getAttribute('pointer-events')).toBe(
      'none',
    );
  });

  it('renders path editing handles at stable screen sizes without a bounding ring', () => {
    const target = document.createElement('div');
    const renderer = new SvgRenderer();
    renderer.mount(target);
    const overlay = {
      selectionBounds: { x: 20, y: 20, width: 80, height: 40 },
      selectionOrientedBounds: {
        center: { x: 60, y: 40 },
        width: 80,
        height: 40,
        rotation: 0,
      },
      selectionHandles: [
        {
          id: 'vertex' as const,
          kind: 'vertex' as const,
          position: { x: 20, y: 20 },
          vertexIndex: 0,
          selected: false,
        },
        {
          id: 'vertex' as const,
          kind: 'vertex' as const,
          position: { x: 100, y: 60 },
          vertexIndex: 1,
          selected: true,
        },
        {
          id: 'curve' as const,
          kind: 'curve' as const,
          position: { x: 60, y: 40 },
        },
      ],
      selectionPaddingWorld: 3,
      marquee: null,
      guides: [],
    };

    renderer.setOverlay(overlay);

    const first = target.querySelector('[data-nodeink-selection-handle="vertex:0"]');
    const selected = target.querySelector('[data-nodeink-selection-handle="vertex:1"]');
    const curve = target.querySelector('[data-nodeink-selection-handle="curve"]');
    expect(target.querySelector('[data-nodeink-selection-outline]')).toBeNull();
    expect(first?.getAttribute('width')).toBe('4');
    expect(first?.getAttribute('fill')).toContain('--nodeink-selection-handle-fill');
    expect(selected?.getAttribute('fill')).toContain('--nodeink-selection-color');
    expect(curve?.tagName).toBe('circle');
    expect(curve?.getAttribute('r')).toBe('2.5');
    expect(curve?.getAttribute('fill')).toContain('--nodeink-selection-curve-fill');

    renderer.setOverlay({ ...overlay, selectionPaddingWorld: 6 });
    expect(
      target.querySelector('[data-nodeink-selection-handle="vertex:0"]')?.getAttribute('width'),
    ).toBe('8');
    expect(target.querySelector('[data-nodeink-selection-handle="curve"]')?.getAttribute('r')).toBe(
      '5',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects invalid selection padding %s',
    (selectionPaddingWorld) => {
      const renderer = new SvgRenderer();
      renderer.mount(document.createElement('div'));

      expect(() => renderer.setOverlay(emptyOverlay(selectionPaddingWorld))).toThrow(
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
    renderProfile: { kind: 'clean', version: 1 },
    rootNodeIds: ['rect-1:shape'],
    nodes: {
      'rect-1:shape': {
        kind: 'rect',
        id: 'rect-1:shape',
        sourceElementId: 'rect-1',
        transform: identity(),
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
    renderProfile: { kind: 'clean', version: 1 },
    rootNodeIds: ['stroke-1:path'],
    nodes: {
      'stroke-1:path': {
        kind: 'path',
        id: 'stroke-1:path',
        sourceElementId: 'stroke-1',
        transform: identity(),
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

function textScene(
  sceneRevision: number,
  value: string,
  textAnchor: 'start' | 'middle' | 'end' = sceneRevision === 1 ? 'start' : 'middle',
): SceneSnapshotV1 {
  return {
    protocolVersion: 1,
    documentId: 'text-fixture',
    documentRevision: sceneRevision,
    sceneRevision,
    renderProfile: { kind: 'clean', version: 1 },
    rootNodeIds: ['text-1:run'],
    nodes: {
      'text-1:run': {
        kind: 'text',
        id: 'text-1:run',
        sourceElementId: 'text-1',
        transform: identity(),
        runs: [
          {
            text: value,
            x: 24,
            y: 48,
            fontFamily: 'Noto Sans SC Variable',
            fontSize: 20,
            fontWeight: 400,
            fill: '#0f172a',
            textAnchor,
          },
        ],
      },
    },
  };
}

function identity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function emptyOverlay(selectionPaddingWorld: number) {
  return {
    selectionBounds: null,
    selectionOrientedBounds: null,
    selectionHandles: [],
    selectionPaddingWorld,
    marquee: null,
    guides: [],
  };
}

function selectionHandles() {
  return [
    { id: 'north_west' as const, kind: 'resize' as const, position: { x: 110, y: 60 } },
    { id: 'north' as const, kind: 'resize' as const, position: { x: 110, y: 80 } },
    { id: 'north_east' as const, kind: 'resize' as const, position: { x: 110, y: 100 } },
    { id: 'east' as const, kind: 'resize' as const, position: { x: 100, y: 100 } },
    { id: 'south_east' as const, kind: 'resize' as const, position: { x: 90, y: 100 } },
    { id: 'south' as const, kind: 'resize' as const, position: { x: 90, y: 80 } },
    { id: 'south_west' as const, kind: 'resize' as const, position: { x: 90, y: 60 } },
    { id: 'west' as const, kind: 'resize' as const, position: { x: 100, y: 60 } },
    { id: 'rotate' as const, kind: 'rotate' as const, position: { x: 132, y: 80 } },
  ];
}
