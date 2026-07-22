export type ClipboardPayloadV1 = string | Uint8Array;

export interface ClipboardPortV1 {
  read(): Promise<ClipboardPayloadV1 | null>;
  write(payload: ClipboardPayloadV1): Promise<void>;
}

let sharedPayload: ClipboardPayloadV1 | null = null;

export class MemoryClipboardPortV1 implements ClipboardPortV1 {
  async read(): Promise<ClipboardPayloadV1 | null> {
    return clonePayload(sharedPayload);
  }

  async write(payload: ClipboardPayloadV1): Promise<void> {
    sharedPayload = clonePayload(payload);
  }
}

export const defaultClipboardPort: ClipboardPortV1 = new MemoryClipboardPortV1();

function clonePayload(payload: ClipboardPayloadV1 | null): ClipboardPayloadV1 | null {
  return payload instanceof Uint8Array ? payload.slice() : payload;
}
