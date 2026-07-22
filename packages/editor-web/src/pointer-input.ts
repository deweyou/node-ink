import type { NormalizedPointerEventV1, PointerPhaseV1 } from '@nodeink-internal/protocol';

export type PointerBatchListener = (events: NormalizedPointerEventV1[]) => void;

export function attachPointerInput(
  target: HTMLElement,
  onPointerBatch: PointerBatchListener,
): () => void {
  const sequences = new Map<number, number>();

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    onPointerBatch(normalizeEvents(target, [event], 'down', sequences));
  };
  const handlePointerMove = (event: PointerEvent) => {
    const coalescedEvents = event.getCoalescedEvents?.() ?? [];
    const events = coalescedEvents.length > 0 ? coalescedEvents : [event];
    event.preventDefault();
    onPointerBatch(normalizeEvents(target, events, 'move', sequences));
  };
  const handlePointerUp = (event: PointerEvent) => {
    event.preventDefault();
    onPointerBatch(normalizeEvents(target, [event], 'up', sequences));
    releasePointer(target, event.pointerId);
    sequences.delete(event.pointerId);
  };
  const handlePointerCancel = (event: PointerEvent) => {
    onPointerBatch(normalizeEvents(target, [event], 'cancel', sequences));
    releasePointer(target, event.pointerId);
    sequences.delete(event.pointerId);
  };

  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUp);
  target.addEventListener('pointercancel', handlePointerCancel);

  return () => {
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerCancel);
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
      targetElementId: phase === 'down' ? sourceElementId(event.target) : null,
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

function sourceElementId(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest<SVGElement>('[data-source-element-id]')?.dataset.sourceElementId ?? null)
    : null;
}

function releasePointer(target: HTMLElement, pointerId: number): void {
  if (target.hasPointerCapture?.(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}
