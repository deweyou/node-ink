import { describe, expect, it, vi } from 'vitest';

import {
  DocumentTakeoverCoordinatorV1,
  DocumentTakeoverErrorV1,
  type BroadcastChannelFactoryV1,
  type BroadcastChannelPortV1,
  type BroadcastMessageEventPortV1,
} from './document-takeover';

describe('DocumentTakeoverCoordinatorV1', () => {
  it('acknowledges a cooperative release only after the writer finishes', async () => {
    const hub = new FakeBroadcastHub();
    const writer = coordinator(hub, 'writer');
    const requester = coordinator(hub, 'requester');
    const order: string[] = [];
    writer.handleRequests(async () => {
      order.push('flush');
      await Promise.resolve();
      order.push('release');
    });

    await requester.requestTakeover();
    order.push('ack');

    expect(order).toEqual(['flush', 'release', 'ack']);
  });

  it('keeps the writer handler available when a request is rejected', async () => {
    const hub = new FakeBroadcastHub();
    const writer = coordinator(hub, 'writer');
    const requester = coordinator(hub, 'requester');
    let attempt = 0;
    writer.handleRequests(() => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('最新改动尚未安全保存。');
      }
    });

    await expect(requester.requestTakeover()).rejects.toMatchObject({
      code: 'request_rejected',
      message: '最新改动尚未安全保存。',
    });
    await expect(requester.requestTakeover()).resolves.toBeUndefined();
    expect(attempt).toBe(2);
  });

  it('times out without treating BroadcastChannel silence as lease ownership', async () => {
    vi.useFakeTimers();
    try {
      const hub = new FakeBroadcastHub();
      const requester = coordinator(hub, 'requester', 25);
      const request = requester.requestTakeover();
      const rejection = expect(request).rejects.toBeInstanceOf(DocumentTakeoverErrorV1);

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates documents and rejects pending requests when disposed', async () => {
    const hub = new FakeBroadcastHub();
    const writer = coordinator(hub, 'writer', 1_000, 'doc-2');
    const requester = coordinator(hub, 'requester', 1_000, 'doc-1');
    const handler = vi.fn();
    writer.handleRequests(handler);
    const request = requester.requestTakeover();

    requester.dispose();

    await expect(request).rejects.toMatchObject({ code: 'disposed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows only one in-flight request to receive a release acknowledgement', async () => {
    const hub = new FakeBroadcastHub();
    const writer = coordinator(hub, 'writer');
    const firstRequester = coordinator(hub, 'first');
    const secondRequester = coordinator(hub, 'second');
    let finishRelease: () => void = () => undefined;
    writer.handleRequests(
      () =>
        new Promise<void>((resolve) => {
          finishRelease = resolve;
        }),
    );

    const first = firstRequester.requestTakeover();
    await Promise.resolve();
    await Promise.resolve();
    const second = secondRequester.requestTakeover();

    await expect(second).rejects.toMatchObject({
      code: 'request_rejected',
      message: 'Another takeover request is already in progress',
    });
    finishRelease();
    await expect(first).resolves.toBeUndefined();
  });

  it('ignores malformed, foreign, self-authored, and stale messages', async () => {
    const hub = new FakeBroadcastHub();
    const requester = coordinator(hub, 'requester');
    const request = requester.requestTakeover();
    const channelName = 'nodeink:document-takeover:doc-1';
    const base = {
      protocol: 'nodeink-document-takeover-v1',
      documentId: 'doc-1',
      requestId: 'requester:0',
      requesterId: 'requester',
    };

    for (const message of [
      null,
      { protocol: 'wrong' },
      { ...base, documentId: 1, type: 'request' },
      { ...base, requestId: 1, type: 'request' },
      { ...base, requesterId: 1, type: 'request' },
      { ...base, type: 'request' },
      { ...base, documentId: 'doc-2', requesterId: 'other', type: 'request' },
      { ...base, requesterId: 'other', type: 'request' },
      { ...base, type: 'released', requesterId: 'someone-else', responderId: 'writer' },
      { ...base, type: 'released', requestId: 'stale', responderId: 'writer' },
      { ...base, type: 'released', responderId: 1 },
      { ...base, type: 'rejected', responderId: 'writer', message: 1 },
      { ...base, type: 'unknown' },
    ]) {
      hub.send(channelName, message);
    }
    hub.send(channelName, {
      ...base,
      type: 'rejected',
      responderId: 'writer',
    });

    await expect(request).rejects.toMatchObject({
      code: 'request_rejected',
      message: 'The writer rejected the takeover request',
    });
  });

  it('supports handler replacement and rejects use after idempotent disposal', async () => {
    const hub = new FakeBroadcastHub();
    const writer = coordinator(hub, 'writer');
    const requester = coordinator(hub, 'requester');
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const stopFirst = writer.handleRequests(firstHandler);
    const stopSecond = writer.handleRequests(secondHandler);
    stopFirst();

    await requester.requestTakeover();

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledOnce();
    stopSecond();
    writer.dispose();
    writer.dispose();
    expect(() => writer.handleRequests(vi.fn())).toThrow('disposed');
    expect(() => writer.requestTakeover()).toThrow('disposed');
  });
});

class FakeBroadcastHub {
  readonly #channels = new Map<string, Set<FakeBroadcastChannel>>();

  readonly createChannel: BroadcastChannelFactoryV1 = (name) => {
    const channel = new FakeBroadcastChannel(name, this);
    const channels = this.#channels.get(name) ?? new Set();
    channels.add(channel);
    this.#channels.set(name, channels);
    return channel;
  };

  broadcast(source: FakeBroadcastChannel, message: unknown): void {
    for (const channel of this.#channels.get(source.name) ?? []) {
      if (channel !== source) {
        channel.receive(message);
      }
    }
  }

  close(channel: FakeBroadcastChannel): void {
    this.#channels.get(channel.name)?.delete(channel);
  }

  send(name: string, message: unknown): void {
    for (const channel of this.#channels.get(name) ?? []) {
      channel.receive(message);
    }
  }
}

class FakeBroadcastChannel implements BroadcastChannelPortV1 {
  readonly #listeners = new Set<(event: BroadcastMessageEventPortV1) => void>();

  constructor(
    readonly name: string,
    readonly hub: FakeBroadcastHub,
  ) {}

  postMessage(message: unknown): void {
    queueMicrotask(() => this.hub.broadcast(this, message));
  }

  addEventListener(_type: 'message', listener: (event: BroadcastMessageEventPortV1) => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: BroadcastMessageEventPortV1) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  close(): void {
    this.hub.close(this);
    this.#listeners.clear();
  }

  receive(message: unknown): void {
    for (const listener of this.#listeners) {
      listener({ data: message });
    }
  }
}

function coordinator(
  hub: FakeBroadcastHub,
  instanceId: string,
  requestTimeoutMs = 100,
  documentId = 'doc-1',
) {
  return new DocumentTakeoverCoordinatorV1({
    documentId,
    createChannel: hub.createChannel,
    instanceId,
    requestTimeoutMs,
  });
}
