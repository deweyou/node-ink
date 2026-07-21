import { describe, expect, it, vi } from 'vitest';

import type { NormalizedPointerEventV1 } from '@nodeink-internal/protocol';

import { attachPointerInput } from './pointer-input';

describe('attachPointerInput', () => {
  it('normalizes single and coalesced events with monotonic per-pointer sequences', () => {
    const target = document.createElement('div');
    const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectangle.dataset.sourceElementId = 'rect-1';
    target.append(rectangle);
    mockBounds(target);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(target, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    });
    const batches: NormalizedPointerEventV1[][] = [];
    const detach = attachPointerInput(target, (events) => batches.push(events));

    rectangle.dispatchEvent(pointerEvent('pointerdown', { clientX: 30, clientY: 50 }));
    rectangle.dispatchEvent(
      pointerEvent('pointermove', {
        clientX: 45,
        clientY: 65,
        coalescedEvents: [
          pointerEvent('pointermove', { clientX: 35, clientY: 55 }),
          pointerEvent('pointermove', { clientX: 45, clientY: 65 }),
        ],
      }),
    );
    rectangle.dispatchEvent(pointerEvent('pointerup', { clientX: 50, clientY: 70 }));

    expect(batches).toEqual([
      [
        {
          pointerId: 1,
          sequence: 1,
          phase: 'down',
          point: { x: 20, y: 30 },
          targetElementId: 'rect-1',
        },
      ],
      [
        {
          pointerId: 1,
          sequence: 2,
          phase: 'move',
          point: { x: 25, y: 35 },
          targetElementId: null,
        },
        {
          pointerId: 1,
          sequence: 3,
          phase: 'move',
          point: { x: 35, y: 45 },
          targetElementId: null,
        },
      ],
      [
        {
          pointerId: 1,
          sequence: 4,
          phase: 'up',
          point: { x: 40, y: 50 },
          targetElementId: null,
        },
      ],
    ]);
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);

    detach();
    rectangle.dispatchEvent(pointerEvent('pointermove', { clientX: 60, clientY: 80 }));
    expect(batches).toHaveLength(3);
  });

  it('ignores non-primary down and handles cancel without capture', () => {
    const target = document.createElement('div');
    mockBounds(target);
    const releasePointerCapture = vi.fn();
    Object.assign(target, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture,
    });
    const listener = vi.fn();
    attachPointerInput(target, listener);

    target.dispatchEvent(pointerEvent('pointerdown', { button: 2 }));
    target.dispatchEvent(pointerEvent('pointercancel'));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject([{ phase: 'cancel', sequence: 1 }]);
    expect(releasePointerCapture).not.toHaveBeenCalled();
  });
});

interface PointerEventOptions {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  coalescedEvents?: PointerEvent[];
}

function pointerEvent(type: string, options: PointerEventOptions = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    clientX: { value: options.clientX ?? 10 },
    clientY: { value: options.clientY ?? 20 },
    button: { value: options.button ?? 0 },
    getCoalescedEvents: { value: () => options.coalescedEvents ?? [] },
  });
  return event;
}

function mockBounds(target: HTMLElement): void {
  target.getBoundingClientRect = vi.fn(
    () => ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect,
  );
}
