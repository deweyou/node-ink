import { describe, expect, it } from 'vitest';

import type { NormalizedPointerEventV1 } from '@nodeink-internal/protocol';

import { FreehandInputAdapterV1 } from './freehand-input';

describe('FreehandInputAdapterV1', () => {
  it('creates one stroke id and preserves batch-2 pointer ordering', () => {
    const adapter = new FreehandInputAdapterV1();
    let nextId = 0;
    const createId = () => `stroke-${++nextId}`;

    expect(adapter.convert([event('down', 1, 10, 20)], createId)).toEqual({
      pointerId: 7,
      sequenceStart: 1,
      phase: 'down',
      points: [{ x: 10, y: 20 }],
      strokeId: 'stroke-1',
    });
    expect(adapter.convert([event('move', 2, 12, 22), event('move', 3, 14, 24)], createId)).toEqual(
      {
        pointerId: 7,
        sequenceStart: 2,
        phase: 'move',
        points: [
          { x: 12, y: 22 },
          { x: 14, y: 24 },
        ],
        strokeId: null,
      },
    );
    expect(adapter.convert([event('up', 4, 16, 26)], createId)).toMatchObject({
      phase: 'up',
      strokeId: null,
    });
    expect(adapter.convert([event('down', 5, 30, 40)], createId)?.strokeId).toBe('stroke-2');
  });

  it('ignores unrelated pointers and resets after cancellation', () => {
    const adapter = new FreehandInputAdapterV1();
    const createId = () => 'stroke-1';
    adapter.convert([event('down', 1, 0, 0)], createId);

    expect(adapter.convert([{ ...event('move', 1, 1, 1), pointerId: 8 }], createId)).toBeNull();
    expect(adapter.convert([event('cancel', 2, 0, 0)], createId)).toMatchObject({
      phase: 'cancel',
    });
    expect(adapter.convert([event('move', 3, 2, 2)], createId)).toBeNull();
  });

  it('rejects mixed-pointer batches', () => {
    const adapter = new FreehandInputAdapterV1();
    expect(
      adapter.convert(
        [event('down', 1, 0, 0), { ...event('down', 1, 0, 0), pointerId: 8 }],
        () => 'stroke-1',
      ),
    ).toBeNull();
  });
});

function event(
  phase: NormalizedPointerEventV1['phase'],
  sequence: number,
  x: number,
  y: number,
): NormalizedPointerEventV1 {
  return { pointerId: 7, phase, sequence, point: { x, y } };
}
