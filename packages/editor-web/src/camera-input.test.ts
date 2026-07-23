import { describe, expect, it, vi } from 'vitest';

import { attachCameraInput } from './camera-input';

describe('attachCameraInput', () => {
  it('pans with the middle button and keeps document pointer input out of the gesture', () => {
    const target = cameraTarget();
    const actions = vi.fn();
    const binding = attachCameraInput(target, actions);
    const down = pointerEvent('pointerdown', { button: 1, clientX: 40, clientY: 60 });
    const move = pointerEvent('pointermove', { button: 1, clientX: 75, clientY: 92 });

    target.dispatchEvent(down);
    target.dispatchEvent(move);
    target.dispatchEvent(pointerEvent('pointerup', { button: 1, clientX: 75, clientY: 92 }));

    expect(actions).toHaveBeenCalledWith({ type: 'pan_by', delta: { x: 35, y: 32 } });
    expect(binding.shouldHandleDocumentPointer(down)).toBe(false);
    expect(binding.shouldHandleDocumentPointer(move)).toBe(false);
  });

  it('pans with Space plus primary drag and restores document input after keyup', () => {
    const ownerDocument = document.implementation.createHTMLDocument();
    const target = cameraTarget(ownerDocument);
    const actions = vi.fn();
    const binding = attachCameraInput(target, actions);
    ownerDocument.dispatchEvent(keyboardEvent('keydown', ' '));

    const down = pointerEvent('pointerdown', { clientX: 50, clientY: 70 });
    target.dispatchEvent(down);
    target.dispatchEvent(pointerEvent('pointermove', { clientX: 20, clientY: 45 }));
    ownerDocument.dispatchEvent(keyboardEvent('keyup', ' '));
    target.dispatchEvent(pointerEvent('pointerup', { clientX: 20, clientY: 45 }));

    expect(actions).toHaveBeenCalledWith({ type: 'pan_by', delta: { x: -30, y: -25 } });
    expect(binding.shouldHandleDocumentPointer(down)).toBe(false);
    expect(
      binding.shouldHandleDocumentPointer(pointerEvent('pointerdown', { clientX: 0, clientY: 0 })),
    ).toBe(true);
  });

  it('maps wheel pan and cursor-anchored zoom into framework-neutral actions', () => {
    const target = cameraTarget();
    const actions = vi.fn();
    attachCameraInput(target, actions);

    target.dispatchEvent(wheelEvent({ deltaX: 12, deltaY: 24 }));
    target.dispatchEvent(wheelEvent({ deltaY: -50, ctrlKey: true, clientX: 210, clientY: 170 }));

    expect(actions.mock.calls[0]?.[0]).toEqual({
      type: 'pan_by',
      delta: { x: -12, y: -24 },
    });
    expect(actions.mock.calls[1]?.[0]).toMatchObject({
      type: 'zoom_at',
      anchor: { x: 200, y: 150 },
    });
    expect(actions.mock.calls[1]?.[0].factor).toBeCloseTo(Math.exp(0.1));
  });

  it('normalizes line/page wheel deltas and clamps extreme meta-key zoom', () => {
    const target = cameraTarget();
    const actions = vi.fn();
    attachCameraInput(target, actions);

    target.dispatchEvent(
      wheelEvent({ deltaX: 1, deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE }),
    );
    target.dispatchEvent(wheelEvent({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE }));
    target.dispatchEvent(wheelEvent({ deltaY: 100_000, metaKey: true }));

    expect(actions.mock.calls[0]?.[0]).toEqual({
      type: 'pan_by',
      delta: { x: -16, y: -32 },
    });
    expect(actions.mock.calls[1]?.[0]).toEqual({
      type: 'pan_by',
      delta: { x: -0, y: -640 },
    });
    expect(actions.mock.calls[2]?.[0]).toMatchObject({ type: 'zoom_at', factor: Math.exp(-4) });
  });

  it('ignores editable/repeated keys, inactive pointers, and zero-distance movement', () => {
    const ownerDocument = document.implementation.createHTMLDocument();
    const target = cameraTarget(ownerDocument);
    const input = ownerDocument.createElement('input');
    const button = ownerDocument.createElement('button');
    target.append(input);
    target.append(button);
    const actions = vi.fn();
    const binding = attachCameraInput(target, actions);

    input.dispatchEvent(keyboardEvent('keydown', ' '));
    const buttonSpace = keyboardEvent('keydown', ' ');
    button.dispatchEvent(buttonSpace);
    ownerDocument.dispatchEvent(keyboardEvent('keydown', 'x'));
    ownerDocument.dispatchEvent(keyboardEvent('keydown', ' ', true));
    ownerDocument.dispatchEvent(keyboardEvent('keyup', 'x'));
    const primaryDown = pointerEvent('pointerdown');
    target.dispatchEvent(primaryDown);
    target.dispatchEvent(pointerEvent('pointermove', { pointerId: 9 }));
    target.dispatchEvent(pointerEvent('pointerup', { pointerId: 9 }));

    target.dispatchEvent(pointerEvent('pointerdown', { button: 1, clientX: 30, clientY: 40 }));
    target.dispatchEvent(pointerEvent('pointermove', { button: 1, clientX: 30, clientY: 40 }));
    Object.assign(target, { hasPointerCapture: () => false });
    target.dispatchEvent(pointerEvent('pointercancel', { button: 1, clientX: 30, clientY: 40 }));

    expect(actions).not.toHaveBeenCalled();
    expect(buttonSpace.defaultPrevented).toBe(false);
    expect(primaryDown.defaultPrevented).toBe(false);
    expect(binding.shouldHandleDocumentPointer(primaryDown)).toBe(true);
  });

  it('releases Camera gesture ownership when pointer capture is lost', () => {
    const target = cameraTarget();
    const binding = attachCameraInput(target, vi.fn());
    const cameraDown = pointerEvent('pointerdown', { button: 1, pointerId: 7 });
    target.dispatchEvent(cameraDown);
    expect(binding.shouldHandleDocumentPointer(cameraDown)).toBe(false);

    target.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 7 }));

    const documentDown = pointerEvent('pointerdown', { pointerId: 7 });
    expect(binding.shouldHandleDocumentPointer(documentDown)).toBe(true);
  });

  it('releases Camera gesture ownership and pointer capture when the window blurs', () => {
    const target = cameraTarget();
    const releasePointerCapture = vi.fn();
    Object.assign(target, { releasePointerCapture });
    const binding = attachCameraInput(target, vi.fn());
    const cameraDown = pointerEvent('pointerdown', { button: 1, pointerId: 7 });
    target.dispatchEvent(cameraDown);

    window.dispatchEvent(new Event('blur'));

    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(binding.shouldHandleDocumentPointer(pointerEvent('pointerdown'))).toBe(true);
  });

  it('detaches all listeners', () => {
    const ownerDocument = document.implementation.createHTMLDocument();
    const target = cameraTarget(ownerDocument);
    const actions = vi.fn();
    const binding = attachCameraInput(target, actions);

    binding.detach();
    ownerDocument.dispatchEvent(keyboardEvent('keydown', ' '));
    target.dispatchEvent(pointerEvent('pointerdown', { button: 1 }));
    target.dispatchEvent(wheelEvent({ deltaY: 10 }));

    expect(actions).not.toHaveBeenCalled();
  });
});

function cameraTarget(ownerDocument: Document = document): HTMLElement {
  const target = ownerDocument.createElement('div');
  ownerDocument.body.append(target);
  target.getBoundingClientRect = vi.fn(
    () => ({ left: 10, top: 20, width: 960, height: 640 }) as DOMRect,
  );
  Object.assign(target, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  return target;
}

function pointerEvent(
  type: string,
  options: { button?: number; pointerId?: number; clientX?: number; clientY?: number } = {},
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, {
    button: { value: options.button ?? 0 },
    pointerId: { value: options.pointerId ?? 1 },
    clientX: { value: options.clientX ?? 10 },
    clientY: { value: options.clientY ?? 20 },
  });
  return event;
}

function wheelEvent(
  options: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX?: number;
    clientY?: number;
  } = {},
): WheelEvent {
  return new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

function keyboardEvent(type: string, key: string, repeat = false): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, key, repeat });
}
