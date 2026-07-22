import type { NormalizedPointerEventV1, PointerPhaseV1 } from '@nodeink-internal/protocol';

export type SelectionPointerTypeV1 = 'mouse' | 'pen' | 'touch';

export interface SelectionPointerInputV1 extends NormalizedPointerEventV1 {
  button: number;
  pointerType: SelectionPointerTypeV1;
}

export interface SelectionInputNormalizerOptionsV1 {
  screenScale: () => number;
  toCanvasPoint: (event: PointerEvent) => { x: number; y: number };
}

export interface SelectionInputNormalizerV1 {
  normalize(event: PointerEvent, phase: PointerPhaseV1): SelectionPointerInputV1;
  reset(pointerId?: number): void;
}

export function createSelectionInputNormalizer(
  options: SelectionInputNormalizerOptionsV1,
): SelectionInputNormalizerV1 {
  const sequences = new Map<number, number>();
  return {
    normalize(event, phase) {
      const point = options.toCanvasPoint(event);
      const screenScale = options.screenScale();
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(screenScale) ||
        screenScale <= 0
      ) {
        throw new Error('Selection input requires finite coordinates and a positive screenScale');
      }
      const sequence = (sequences.get(event.pointerId) ?? 0) + 1;
      sequences.set(event.pointerId, sequence);
      return {
        pointerId: event.pointerId,
        sequence,
        phase,
        point,
        modifiers: {
          shift: event.shiftKey === true,
          alt: event.altKey === true,
          metaOrCtrl: event.metaKey === true || event.ctrlKey === true,
        },
        button: event.button,
        pointerType: normalizePointerType(event.pointerType),
        screenScale,
      };
    },
    reset(pointerId) {
      if (pointerId === undefined) {
        sequences.clear();
      } else {
        sequences.delete(pointerId);
      }
    },
  };
}

function normalizePointerType(pointerType: string): SelectionPointerTypeV1 {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse';
}
