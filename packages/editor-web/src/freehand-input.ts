import type { NormalizedPointerEventV1, StrokeInputBatchV1 } from '@nodeink-internal/protocol';

/**
 * Converts framework-neutral pointer batches into the ordered stroke protocol.
 * Tool ownership stays in Rust; this adapter only keeps the active DOM gesture.
 */
export class FreehandInputAdapterV1 {
  #activePointerId: number | null = null;
  #strokeId: string | null = null;

  convert(
    events: NormalizedPointerEventV1[],
    createStrokeId: () => string,
  ): StrokeInputBatchV1 | null {
    const first = events[0];
    if (!first || events.some((event) => event.pointerId !== first.pointerId)) {
      return null;
    }

    if (first.phase === 'down') {
      if (this.#activePointerId !== null) {
        return null;
      }
      this.#activePointerId = first.pointerId;
      this.#strokeId = createStrokeId();
    } else if (this.#activePointerId !== first.pointerId) {
      return null;
    }

    const strokeId = first.phase === 'down' ? this.#strokeId : null;
    const last = events.at(-1) ?? first;
    // A DOM interruption is not an explicit editor cancel. Preserve the ink already sampled
    // instead of letting capture loss or window blur erase the whole visible stroke.
    const phase = first.phase === 'cancel' ? 'up' : first.phase;
    const batch: StrokeInputBatchV1 = {
      pointerId: first.pointerId,
      sequenceStart: first.sequence,
      phase,
      points: events.map((event) => event.point),
      strokeId,
      straightLine: last.modifiers.shift,
    };

    if (first.phase === 'up' || first.phase === 'cancel') {
      this.reset();
    }
    return batch;
  }

  reset(): void {
    this.#activePointerId = null;
    this.#strokeId = null;
  }
}
