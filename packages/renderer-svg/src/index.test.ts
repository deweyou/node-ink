import { describe, expect, it } from 'vitest';

import type { SceneSnapshotV1 } from '@nodeink-internal/protocol';

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
      },
    },
  };
}
