import { describe, expect, it } from 'vitest';

import { MemoryClipboardPortV1 } from './clipboard-port';

describe('MemoryClipboardPortV1', () => {
  it('shares opaque strings between controller-local port instances', async () => {
    const firstController = new MemoryClipboardPortV1();
    const secondController = new MemoryClipboardPortV1();

    await firstController.write('nodeink:opaque-document-fragment');

    await expect(secondController.read()).resolves.toBe('nodeink:opaque-document-fragment');
  });

  it('shares opaque bytes without leaking mutable array ownership', async () => {
    const writer = new MemoryClipboardPortV1();
    const reader = new MemoryClipboardPortV1();
    const source = new Uint8Array([1, 2, 3]);
    await writer.write(source);
    source[0] = 9;

    const firstRead = (await reader.read()) as Uint8Array;
    expect(firstRead).toEqual(new Uint8Array([1, 2, 3]));
    firstRead[1] = 8;
    await expect(reader.read()).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });
});
