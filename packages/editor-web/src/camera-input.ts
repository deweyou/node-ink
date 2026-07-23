import type { CameraActionV1 } from '@nodeink-internal/protocol';

export type CameraActionListener = (action: CameraActionV1) => void;

export interface CameraInputBindingV1 {
  detach(): void;
  shouldHandleDocumentPointer(event: PointerEvent): boolean;
}

export function attachCameraInput(
  target: HTMLElement,
  onCameraAction: CameraActionListener,
): CameraInputBindingV1 {
  const ownerDocument = target.ownerDocument;
  const windowTarget = ownerDocument.defaultView;
  let spacePressed = false;
  let activePointerId: number | null = null;
  let previousPoint = { x: 0, y: 0 };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== ' ' || event.repeat || isEditableTarget(event.target)) {
      return;
    }
    spacePressed = true;
    event.preventDefault();
  };
  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ') {
      spacePressed = false;
    }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 1 && !(event.button === 0 && spacePressed)) {
      return;
    }
    activePointerId = event.pointerId;
    previousPoint = { x: event.clientX, y: event.clientY };
    target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    const nextPoint = { x: event.clientX, y: event.clientY };
    const delta = {
      x: nextPoint.x - previousPoint.x,
      y: nextPoint.y - previousPoint.y,
    };
    previousPoint = nextPoint;
    if (delta.x !== 0 || delta.y !== 0) {
      onCameraAction({ type: 'pan_by', delta });
    }
    event.preventDefault();
  };
  const finishPointer = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    event.preventDefault();
    activePointerId = null;
    releasePointer(target, event.pointerId);
  };
  const handleLostPointerCapture = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) {
      activePointerId = null;
    }
  };
  const handleWindowBlur = () => {
    if (activePointerId === null) {
      return;
    }
    const pointerId = activePointerId;
    activePointerId = null;
    releasePointer(target, pointerId);
    spacePressed = false;
  };
  const handleWheel = (event: WheelEvent) => {
    const scale = wheelDeltaScale(event, target);
    if (event.ctrlKey || event.metaKey) {
      const bounds = target.getBoundingClientRect();
      const exponent = clamp(-event.deltaY * scale * 0.002, -4, 4);
      onCameraAction({
        type: 'zoom_at',
        factor: Math.exp(exponent),
        anchor: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      });
    } else {
      onCameraAction({
        type: 'pan_by',
        delta: { x: -event.deltaX * scale, y: -event.deltaY * scale },
      });
    }
    event.preventDefault();
  };

  ownerDocument.addEventListener('keydown', handleKeyDown);
  ownerDocument.addEventListener('keyup', handleKeyUp);
  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', finishPointer);
  target.addEventListener('pointercancel', finishPointer);
  target.addEventListener('lostpointercapture', handleLostPointerCapture);
  target.addEventListener('wheel', handleWheel, { passive: false });
  windowTarget?.addEventListener('blur', handleWindowBlur);

  return {
    detach() {
      ownerDocument.removeEventListener('keydown', handleKeyDown);
      ownerDocument.removeEventListener('keyup', handleKeyUp);
      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', finishPointer);
      target.removeEventListener('pointercancel', finishPointer);
      target.removeEventListener('lostpointercapture', handleLostPointerCapture);
      target.removeEventListener('wheel', handleWheel);
      windowTarget?.removeEventListener('blur', handleWindowBlur);
      activePointerId = null;
      spacePressed = false;
    },
    shouldHandleDocumentPointer(event) {
      return (
        event.pointerId !== activePointerId &&
        !event.defaultPrevented &&
        event.button !== 1 &&
        !spacePressed
      );
    },
  };
}

function wheelDeltaScale(event: WheelEvent, target: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return Math.max(1, target.getBoundingClientRect().height);
  }
  return 1;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input, textarea, select, button, a[href], [contenteditable="true"]'))
  );
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  if (target.hasPointerCapture?.(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
