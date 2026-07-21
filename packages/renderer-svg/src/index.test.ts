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
