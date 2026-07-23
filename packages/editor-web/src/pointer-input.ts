import type { NormalizedPointerEventV1, PointerPhaseV1 } from '@nodeink-internal/protocol';

import { createSelectionInputNormalizer } from './selection-input';

export type PointerBatchListener = (events: NormalizedPointerEventV1[]) => void;

export interface PointerInputOptionsV1 {
  screenScale?: () => number;
  shouldHandleEvent?: (event: PointerEvent) => boolean;
  onDoubleClick?: (point: { x: number; y: number }) => void;
}

export function attachPointerInput(
  target: HTMLElement,
  onPointerBatch: PointerBatchListener,
  options: PointerInputOptionsV1 = {},
): () => void {
  const activePointers = new Set<number>();
  const lastEvents = new Map<number, NormalizedPointerEventV1>();
  const windowTarget = target.ownerDocument.defaultView;
  const normalizer = createSelectionInputNormalizer({
    screenScale: options.screenScale ?? (() => 1),
    toCanvasPoint: (event) => createScreenToCanvasPoint(target)(event.clientX, event.clientY),
  });

  const emitNormalized = (events: NormalizedPointerEventV1[]) => {
    for (const event of events) {
      lastEvents.set(event.pointerId, event);
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
    emitNormalized(normalizeEvents([event], 'down', normalizer));
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }
    const coalescedEvents = event.getCoalescedEvents?.() ?? [];
    const events = coalescedEvents.length > 0 ? coalescedEvents : [event];
    event.preventDefault();
    emitNormalized(normalizeEvents(events, 'move', normalizer, event));
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    emitNormalized(normalizeEvents([event], 'up', normalizer));
    activePointers.delete(event.pointerId);
    lastEvents.delete(event.pointerId);
    releasePointer(target, event.pointerId);
    normalizer.reset(event.pointerId);
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }
    finalizeActivePointer(event.pointerId);
  };
  const handleDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0 || options.shouldHandleEvent?.(event as PointerEvent) === false) {
      return;
    }
    event.preventDefault();
    options.onDoubleClick?.(createScreenToCanvasPoint(target)(event.clientX, event.clientY));
  };
  const finalizeActivePointer = (pointerId: number) => {
    if (!activePointers.has(pointerId)) {
      return;
    }
    const lastEvent = lastEvents.get(pointerId);
    // Capture loss and window blur are browser interruptions, not explicit editor cancellation.
    // Commit the last visible preview so a transient DOM event cannot make a transform snap back.
    emitNormalized([
      {
        pointerId,
        sequence: (lastEvent?.sequence ?? 0) + 1,
        phase: 'up',
        point: lastEvent?.point ?? { x: 0, y: 0 },
        modifiers: lastEvent?.modifiers ?? { shift: false, alt: false, metaOrCtrl: false },
        screenScale: lastEvent?.screenScale ?? options.screenScale?.() ?? 1,
      },
    ]);
    activePointers.delete(pointerId);
    lastEvents.delete(pointerId);
    normalizer.reset(pointerId);
    releasePointer(target, pointerId);
  };
  const handleLostPointerCapture = (event: PointerEvent) => finalizeActivePointer(event.pointerId);
  const handleWindowBlur = () => {
    for (const pointerId of [...activePointers]) {
      finalizeActivePointer(pointerId);
    }
  };

  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('pointercancel', handlePointerCancel);
  target.addEventListener('lostpointercapture', handleLostPointerCapture);
  target.addEventListener('dblclick', handleDoubleClick);
  windowTarget?.addEventListener('blur', handleWindowBlur);

  return () => {
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerCancel);
    target.removeEventListener('lostpointercapture', handleLostPointerCapture);
    target.removeEventListener('dblclick', handleDoubleClick);
    windowTarget?.removeEventListener('blur', handleWindowBlur);
    for (const pointerId of activePointers) {
      releasePointer(target, pointerId);
    }
    activePointers.clear();
    lastEvents.clear();
    normalizer.reset();
  };
}

function normalizeEvents(
  events: PointerEvent[],
  phase: PointerPhaseV1,
  normalizer: ReturnType<typeof createSelectionInputNormalizer>,
  modifierSource?: PointerEvent,
): NormalizedPointerEventV1[] {
  return events.map((event) => {
    const normalized = normalizer.normalize(event, phase);
    return {
      pointerId: normalized.pointerId,
      sequence: normalized.sequence,
      phase: normalized.phase,
      point: normalized.point,
      modifiers: modifierSource
        ? {
            shift: modifierSource.shiftKey === true,
            alt: modifierSource.altKey === true,
            metaOrCtrl: modifierSource.metaKey === true || modifierSource.ctrlKey === true,
          }
        : normalized.modifiers,
      screenScale: normalized.screenScale,
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
