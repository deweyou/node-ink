import { describe, expect, it } from 'vitest';

import { createSelectionInputNormalizer } from './selection-input';

describe('createSelectionInputNormalizer', () => {
  it('preserves selection modifiers, device details, Camera scale, and pointer order', () => {
    let zoom = 2;
    const normalizer = createSelectionInputNormalizer({
      screenScale: () => zoom,
      toCanvasPoint: (event) => ({ x: event.clientX / zoom, y: event.clientY / zoom }),
    });

    expect(
      normalizer.normalize(
        pointerEvent({
          pointerId: 7,
          clientX: 80,
          clientY: 48,
          button: 0,
          pointerType: 'pen',
          shiftKey: true,
          altKey: true,
          ctrlKey: true,
        }),
        'down',
      ),
    ).toEqual({
      pointerId: 7,
      sequence: 1,
      phase: 'down',
      point: { x: 40, y: 24 },
      modifiers: { shift: true, alt: true, metaOrCtrl: true },
      button: 0,
      pointerType: 'pen',
      screenScale: 2,
    });

    zoom = 4;
    expect(
      normalizer.normalize(
        pointerEvent({ pointerId: 7, clientX: 80, clientY: 48, button: -1, pointerType: 'pen' }),
        'move',
      ),
    ).toMatchObject({
      sequence: 2,
      point: { x: 20, y: 12 },
      button: -1,
      screenScale: 4,
    });
  });

  it('tracks pointers independently and resets one gesture or all gestures', () => {
    const normalizer = createSelectionInputNormalizer({
      screenScale: () => 1,
      toCanvasPoint: (event) => ({ x: event.clientX, y: event.clientY }),
    });

    expect(normalizer.normalize(pointerEvent({ pointerId: 1 }), 'down').sequence).toBe(1);
    expect(normalizer.normalize(pointerEvent({ pointerId: 2 }), 'down').sequence).toBe(1);
    normalizer.reset(1);
    expect(normalizer.normalize(pointerEvent({ pointerId: 1 }), 'down').sequence).toBe(1);
    expect(normalizer.normalize(pointerEvent({ pointerId: 2 }), 'move').sequence).toBe(2);
    normalizer.reset();
    expect(normalizer.normalize(pointerEvent({ pointerId: 2 }), 'down').sequence).toBe(1);
  });

  it('normalizes unknown browser pointer types and rejects invalid coordinate transforms', () => {
    const normalizer = createSelectionInputNormalizer({
      screenScale: () => 1,
      toCanvasPoint: () => ({ x: 0, y: 0 }),
    });
    expect(normalizer.normalize(pointerEvent({ pointerType: '' }), 'down').pointerType).toBe(
      'mouse',
    );

    const invalidScale = createSelectionInputNormalizer({
      screenScale: () => 0,
      toCanvasPoint: () => ({ x: 0, y: 0 }),
    });
    expect(() => invalidScale.normalize(pointerEvent(), 'down')).toThrow('screenScale');

    const invalidPoint = createSelectionInputNormalizer({
      screenScale: () => 1,
      toCanvasPoint: () => ({ x: Number.NaN, y: 0 }),
    });
    expect(() => invalidPoint.normalize(pointerEvent(), 'down')).toThrow('finite coordinates');
  });
});

interface PointerEventOptions {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  pointerType?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

function pointerEvent(options: PointerEventOptions = {}): PointerEvent {
  const event = new MouseEvent('pointerdown', {
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
  }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
  });
  return event;
}
