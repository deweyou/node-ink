const TAKEOVER_PROTOCOL = 'nodeink-document-takeover-v1';

export interface BroadcastMessageEventPortV1 {
  data: unknown;
}

export interface BroadcastChannelPortV1 {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: BroadcastMessageEventPortV1) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: BroadcastMessageEventPortV1) => void,
  ): void;
  close(): void;
}

export type BroadcastChannelFactoryV1 = (name: string) => BroadcastChannelPortV1;

export type DocumentTakeoverErrorCodeV1 = 'disposed' | 'request_rejected' | 'request_timeout';

export class DocumentTakeoverErrorV1 extends Error {
  constructor(
    readonly code: DocumentTakeoverErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentTakeoverErrorV1';
  }
}

type TakeoverMessageV1 =
  | {
      protocol: typeof TAKEOVER_PROTOCOL;
      type: 'request';
      documentId: string;
      requestId: string;
      requesterId: string;
    }
  | {
      protocol: typeof TAKEOVER_PROTOCOL;
      type: 'released' | 'rejected';
      documentId: string;
      requestId: string;
      requesterId: string;
      responderId: string;
      message?: string;
    };

interface PendingRequestV1 {
  resolve(): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Coordinates a cooperative hand-off between same-origin browser pages.
 *
 * BroadcastChannel is only a request/acknowledgement transport. It never proves
 * write ownership; the receiving page must still reload and acquire the real
 * Web Lock before constructing a writable document runtime.
 */
export class DocumentTakeoverCoordinatorV1 {
  readonly #documentId: string;
  readonly #instanceId: string;
  readonly #requestTimeoutMs: number;
  readonly #channel: BroadcastChannelPortV1;
  readonly #pendingRequests = new Map<string, PendingRequestV1>();
  readonly #onMessage = (event: BroadcastMessageEventPortV1) => {
    this.handleMessage(event.data);
  };
  #requestHandler: (() => void | Promise<void>) | null = null;
  #isHandlingRequest = false;
  #isDisposed = false;
  #requestSequence = 0;

  constructor(options: {
    documentId: string;
    createChannel: BroadcastChannelFactoryV1;
    instanceId?: string;
    requestTimeoutMs?: number;
  }) {
    this.#documentId = options.documentId;
    this.#instanceId = options.instanceId ?? randomId();
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 8_000;
    this.#channel = options.createChannel(`nodeink:document-takeover:${options.documentId}`);
    this.#channel.addEventListener('message', this.#onMessage);
  }

  handleRequests(handler: () => void | Promise<void>): () => void {
    this.ensureActive();
    this.#requestHandler = handler;
    return () => {
      if (this.#requestHandler === handler) {
        this.#requestHandler = null;
      }
    };
  }

  requestTakeover(): Promise<void> {
    this.ensureActive();
    const requestId = `${this.#instanceId}:${this.#requestSequence}`;
    this.#requestSequence += 1;
    const request = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(requestId);
        reject(
          new DocumentTakeoverErrorV1(
            'request_timeout',
            'The writer did not respond to the takeover request',
          ),
        );
      }, this.#requestTimeoutMs);
      this.#pendingRequests.set(requestId, { resolve, reject, timeout });
    });
    this.#channel.postMessage({
      protocol: TAKEOVER_PROTOCOL,
      type: 'request',
      documentId: this.#documentId,
      requestId,
      requesterId: this.#instanceId,
    } satisfies TakeoverMessageV1);
    return request;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#requestHandler = null;
    this.#isHandlingRequest = false;
    this.#channel.removeEventListener('message', this.#onMessage);
    this.#channel.close();
    for (const pending of this.#pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new DocumentTakeoverErrorV1(
          'disposed',
          'The takeover coordinator was disposed before the request completed',
        ),
      );
    }
    this.#pendingRequests.clear();
  }

  private handleMessage(value: unknown): void {
    const message = parseMessage(value);
    if (!message || message.documentId !== this.#documentId) {
      return;
    }
    if (message.type === 'request') {
      if (message.requesterId === this.#instanceId || !this.#requestHandler) {
        return;
      }
      if (this.#isHandlingRequest) {
        this.respond(message, 'rejected', 'Another takeover request is already in progress');
        return;
      }
      const handler = this.#requestHandler;
      this.#isHandlingRequest = true;
      void Promise.resolve()
        .then(handler)
        .then(() => {
          if (this.#requestHandler === handler) {
            this.#requestHandler = null;
          }
          this.#isHandlingRequest = false;
          this.respond(message, 'released');
        })
        .catch((error: unknown) => {
          this.#isHandlingRequest = false;
          this.respond(message, 'rejected', errorMessage(error));
        });
      return;
    }
    if (message.requesterId !== this.#instanceId) {
      return;
    }
    const pending = this.#pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pendingRequests.delete(message.requestId);
    if (message.type === 'released') {
      pending.resolve();
      return;
    }
    pending.reject(
      new DocumentTakeoverErrorV1(
        'request_rejected',
        message.message ?? 'The writer rejected the takeover request',
      ),
    );
  }

  private respond(
    request: Extract<TakeoverMessageV1, { type: 'request' }>,
    type: 'released' | 'rejected',
    message?: string,
  ): void {
    if (this.#isDisposed) {
      return;
    }
    this.#channel.postMessage({
      protocol: TAKEOVER_PROTOCOL,
      type,
      documentId: this.#documentId,
      requestId: request.requestId,
      requesterId: request.requesterId,
      responderId: this.#instanceId,
      ...(message ? { message } : {}),
    } satisfies TakeoverMessageV1);
  }

  private ensureActive(): void {
    if (this.#isDisposed) {
      throw new DocumentTakeoverErrorV1('disposed', 'The takeover coordinator is disposed');
    }
  }
}

function parseMessage(value: unknown): TakeoverMessageV1 | null {
  if (!isRecord(value) || value.protocol !== TAKEOVER_PROTOCOL) {
    return null;
  }
  if (
    typeof value.documentId !== 'string' ||
    typeof value.requestId !== 'string' ||
    typeof value.requesterId !== 'string'
  ) {
    return null;
  }
  if (value.type === 'request') {
    return {
      protocol: TAKEOVER_PROTOCOL,
      type: 'request',
      documentId: value.documentId,
      requestId: value.requestId,
      requesterId: value.requesterId,
    };
  }
  if (
    (value.type === 'released' || value.type === 'rejected') &&
    typeof value.responderId === 'string' &&
    (value.message === undefined || typeof value.message === 'string')
  ) {
    return {
      protocol: TAKEOVER_PROTOCOL,
      type: value.type,
      documentId: value.documentId,
      requestId: value.requestId,
      requesterId: value.requesterId,
      responderId: value.responderId,
      ...(value.message ? { message: value.message } : {}),
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
