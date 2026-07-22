import type { NormalizedPointerEventV1, PointerPhaseV1 } from '@nodeink-internal/protocol';

export type PointerBatchListener = (events: NormalizedPointerEventV1[]) => void;

export interface PointerInputOptionsV1 {
  shouldHandleEvent?: (event: PointerEvent) => boolean;
}

export function attachPointerInput(
  target: HTMLElement,
  onPointerBatch: PointerBatchListener,
  options: PointerInputOptionsV1 = {},
): () => void {
  const sequences = new Map<number, number>();
  const activePointers = new Set<number>();
  const lastPoints = new Map<number, { x: number; y: number }>();
  const windowTarget = target.ownerDocument.defaultView;

  const emitNormalized = (events: NormalizedPointerEventV1[]) => {
    for (const event of events) {
      lastPoints.set(event.pointerId, event.point);
    }
    onPointerBatch(events);
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || options.shouldHandleEvent?.(event) === false) {
      return;
    }
    activePointers.add(event.pointerId);
    target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    emitNormalized(normalizeEvents(target, [event], 'down', sequences));
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId) || options.shouldHandleEvent?.(event) === false) {
      return;
    }
    const coalescedEvents = event.getCoalescedEvents?.() ?? [];
    const events = coalescedEvents.length > 0 ? coalescedEvents : [event];
    event.preventDefault();
    emitNormalized(normalizeEvents(target, events, 'move', sequences));
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId) || options.shouldHandleEvent?.(event) === false) {
      return;
    }
    event.preventDefault();
    emitNormalized(normalizeEvents(target, [event], 'up', sequences));
    activePointers.delete(event.pointerId);
    lastPoints.delete(event.pointerId);
    releasePointer(target, event.pointerId);
    sequences.delete(event.pointerId);
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (options.shouldHandleEvent?.(event) === false) {
      return;
    }
    emitNormalized(normalizeEvents(target, [event], 'cancel', sequences));
    activePointers.delete(event.pointerId);
    lastPoints.delete(event.pointerId);
    releasePointer(target, event.pointerId);
    sequences.delete(event.pointerId);
  };
  const cancelActivePointer = (pointerId: number) => {
    if (!activePointers.has(pointerId)) {
      return;
    }
    const sequence = (sequences.get(pointerId) ?? 0) + 1;
    const point = lastPoints.get(pointerId) ?? { x: 0, y: 0 };
    emitNormalized([{ pointerId, sequence, phase: 'cancel', point }]);
    activePointers.delete(pointerId);
    lastPoints.delete(pointerId);
    sequences.delete(pointerId);
    releasePointer(target, pointerId);
  };
  const handleLostPointerCapture = (event: PointerEvent) => cancelActivePointer(event.pointerId);
  const handleWindowBlur = () => {
    for (const pointerId of [...activePointers]) {
      cancelActivePointer(pointerId);
    }
  };

  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('pointercancel', handlePointerCancel);
  target.addEventListener('lostpointercapture', handleLostPointerCapture);
  windowTarget?.addEventListener('blur', handleWindowBlur);

  return () => {
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerCancel);
    target.removeEventListener('lostpointercapture', handleLostPointerCapture);
    windowTarget?.removeEventListener('blur', handleWindowBlur);
    for (const pointerId of activePointers) {
      releasePointer(target, pointerId);
    }
    activePointers.clear();
    lastPoints.clear();
    sequences.clear();
  };
}

function normalizeEvents(
  target: HTMLElement,
  events: PointerEvent[],
  phase: PointerPhaseV1,
  sequences: Map<number, number>,
): NormalizedPointerEventV1[] {
  const toCanvasPoint = createScreenToCanvasPoint(target);
  return events.map((event) => {
    const sequence = (sequences.get(event.pointerId) ?? 0) + 1;
    sequences.set(event.pointerId, sequence);
    return {
      pointerId: event.pointerId,
      sequence,
      phase,
      point: toCanvasPoint(event.clientX, event.clientY),
    };
  });
}

function createScreenToCanvasPoint(
  target: HTMLElement,
): (clientX: number, clientY: number) => { x: number; y: number } {
  const canvas = target.querySelector<SVGSVGElement>('svg[data-nodeink-canvas]');
  const matrix = canvas?.getScreenCTM?.();
  if (matrix) {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (
      Number.isFinite(determinant) &&
      Math.abs(determinant) > Number.EPSILON &&
      [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
    ) {
      return (clientX, clientY) => {
        const translatedX = clientX - matrix.e;
        const translatedY = clientY - matrix.f;
        return {
          x: (matrix.d * translatedX - matrix.c * translatedY) / determinant,
          y: (-matrix.b * translatedX + matrix.a * translatedY) / determinant,
        };
      };
    }
  }

  const bounds = target.getBoundingClientRect();
  return (clientX, clientY) => ({ x: clientX - bounds.left, y: clientY - bounds.top });
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  if (target.hasPointerCapture?.(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}
