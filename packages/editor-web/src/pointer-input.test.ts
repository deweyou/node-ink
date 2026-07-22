import { describe, expect, it, vi } from 'vitest';

import type { NormalizedPointerEventV1 } from '@nodeink-internal/protocol';

import { attachPointerInput } from './pointer-input';

describe('attachPointerInput', () => {
  it('maps client coordinates through the rendered SVG coordinate system', () => {
    const target = document.createElement('div');
    const canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    canvas.dataset.nodeinkCanvas = 'true';
    const rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectangle.dataset.sourceElementId = 'rect-1';
    canvas.append(rectangle);
    target.append(canvas);
    mockBounds(target);
    Object.assign(canvas, {
      getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }),
    });
    Object.assign(target, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
    });
    const batches: NormalizedPointerEventV1[][] = [];
    attachPointerInput(target, (events) => batches.push(events));

    rectangle.dispatchEvent(pointerEvent('pointerdown', { clientX: 140, clientY: 110 }));
    rectangle.dispatchEvent(pointerEvent('pointermove', { clientX: 180, clientY: 150 }));

    expect(batches).toMatchObject([
      [{ phase: 'down', point: { x: 20, y: 30 } }],
      [{ phase: 'move', point: { x: 40, y: 50 } }],
    ]);
  });

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
    const detach = attachPointerInput(target, (events) => batches.push(events), {
      screenScale: () => 2,
    });

    rectangle.dispatchEvent(
      pointerEvent('pointerdown', { clientX: 30, clientY: 50, shiftKey: true }),
    );
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
          modifiers: { shift: true, alt: false, metaOrCtrl: false },
          screenScale: 2,
        },
      ],
      [
        {
          pointerId: 1,
          sequence: 2,
          phase: 'move',
          point: { x: 25, y: 35 },
          modifiers: { shift: false, alt: false, metaOrCtrl: false },
          screenScale: 2,
        },
        {
          pointerId: 1,
          sequence: 3,
          phase: 'move',
          point: { x: 35, y: 45 },
          modifiers: { shift: false, alt: false, metaOrCtrl: false },
          screenScale: 2,
        },
      ],
      [
        {
          pointerId: 1,
          sequence: 4,
          phase: 'up',
          point: { x: 40, y: 50 },
          modifiers: { shift: false, alt: false, metaOrCtrl: false },
          screenScale: 2,
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

  it('lets the Camera binding exclude an entire pointer gesture', () => {
    const target = document.createElement('div');
    mockBounds(target);
    const setPointerCapture = vi.fn();
    Object.assign(target, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const listener = vi.fn();
    attachPointerInput(target, listener, { shouldHandleEvent: () => false });

    target.dispatchEvent(pointerEvent('pointerdown'));
    target.dispatchEvent(pointerEvent('pointermove'));
    target.dispatchEvent(pointerEvent('pointerup'));
    target.dispatchEvent(pointerEvent('pointercancel'));

    expect(listener).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('cancels an active gesture on window blur and lost pointer capture', () => {
    const target = document.createElement('div');
    document.body.append(target);
    mockBounds(target);
    Object.assign(target, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
    });
    const batches: NormalizedPointerEventV1[][] = [];
    attachPointerInput(target, (events) => batches.push(events));

    target.dispatchEvent(pointerEvent('pointerdown', { clientX: 30, clientY: 50 }));
    window.dispatchEvent(new Event('blur'));
    target.dispatchEvent(pointerEvent('pointerdown', { clientX: 40, clientY: 60 }));
    target.dispatchEvent(pointerEvent('lostpointercapture'));

    expect(batches.map((batch) => batch[0]?.phase)).toEqual(['down', 'cancel', 'down', 'cancel']);
    expect(batches[1]?.[0]).toMatchObject({ sequence: 2, point: { x: 20, y: 30 } });
  });

  it('maps a primary double click to semantic canvas coordinates', () => {
    const target = document.createElement('div');
    mockBounds(target);
    const onDoubleClick = vi.fn();
    attachPointerInput(target, vi.fn(), { onDoubleClick });

    target.dispatchEvent(mouseEvent('dblclick', { clientX: 50, clientY: 80 }));
    target.dispatchEvent(mouseEvent('dblclick', { button: 2 }));

    expect(onDoubleClick).toHaveBeenCalledOnce();
    expect(onDoubleClick).toHaveBeenCalledWith({ x: 40, y: 60 });
  });
});

interface PointerEventOptions {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  coalescedEvents?: PointerEvent[];
}

function pointerEvent(type: string, options: PointerEventOptions = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    clientX: { value: options.clientX ?? 10 },
    clientY: { value: options.clientY ?? 20 },
    button: { value: options.button ?? 0 },
    shiftKey: { value: options.shiftKey ?? false },
    altKey: { value: options.altKey ?? false },
    metaKey: { value: options.metaKey ?? false },
    ctrlKey: { value: options.ctrlKey ?? false },
    getCoalescedEvents: { value: () => options.coalescedEvents ?? [] },
  });
  return event;
}

function mouseEvent(type: string, options: PointerEventOptions = {}): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 10,
    clientY: options.clientY ?? 20,
  });
}

function mockBounds(target: HTMLElement): void {
  target.getBoundingClientRect = vi.fn(
    () => ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect,
  );
}
