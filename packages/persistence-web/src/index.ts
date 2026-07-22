export type SnapshotStatusV1 = 'candidate' | 'stable' | 'rejected';
export type SaveInterruptionV1 =
  | 'before_candidate'
  | 'during_candidate_transaction'
  | 'after_candidate'
  | 'after_readback'
  | null;

export interface SnapshotRecordV1 {
  snapshotKey: string;
  documentId: string;
  revision: number;
  schemaVersion: number;
  engineAlgorithmVersion: string;
  payload: Uint8Array;
  integrity: { algorithm: 'sha-256'; digest: string };
  status: SnapshotStatusV1;
  createdAt: string;
}

export interface DocumentCatalogRecordV1 {
  documentId: string;
  headRevision: number;
  headSnapshotKey: string;
  stableSnapshotKey: string | null;
  previousStableSnapshotKey: string | null;
  schemaVersion: number;
  updatedAt: string;
}

export interface SnapshotStoreV1 {
  commitCandidate(
    snapshot: SnapshotRecordV1,
    expectedPreviousRevision: number,
    durability: IDBTransactionDurability,
    forceAbort: boolean,
  ): Promise<void>;
  markStable(snapshotKey: string, durability: IDBTransactionDurability): Promise<void>;
  markRejected(snapshotKey: string): Promise<void>;
  getCatalog(documentId: string): Promise<DocumentCatalogRecordV1 | null>;
  getSnapshot(snapshotKey: string): Promise<SnapshotRecordV1 | null>;
}

export interface SaveSnapshotInputV1 {
  documentId: string;
  revision: number;
  expectedPreviousRevision: number;
  schemaVersion: number;
  engineAlgorithmVersion: string;
  payload: Uint8Array;
  durability: IDBTransactionDurability;
  interruptAt: SaveInterruptionV1;
}

export interface SaveSnapshotResultV1 {
  snapshot: SnapshotRecordV1;
  metrics: {
    hashMs: number;
    candidateTransactionMs: number;
    readBackMs: number;
    readBackHashMs: number;
    validationMs: number;
    readBackAndVerifyMs: number;
    stableTransactionMs: number;
    totalMs: number;
  };
}

export interface RecoveryResultV1 {
  snapshot: SnapshotRecordV1;
  source: 'stable' | 'previous_stable';
}

export type ValidatePayloadV1 = (
  payload: Uint8Array,
  schemaVersion: number,
) => void | Promise<void>;
export type DigestPayloadV1 = (payload: Uint8Array) => Promise<string>;

export type PersistenceErrorCodeV1 =
  | 'interrupted'
  | 'revision_conflict'
  | 'snapshot_missing'
  | 'integrity_mismatch'
  | 'payload_invalid'
  | 'recovery_unavailable'
  | 'crypto_unavailable';

export class PersistenceErrorV1 extends Error {
  constructor(
    readonly code: PersistenceErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = 'PersistenceErrorV1';
  }
}

export class AtomicSnapshotPersistenceV1 {
  readonly #store: SnapshotStoreV1;
  readonly #validatePayload: ValidatePayloadV1;
  readonly #digestPayload: DigestPayloadV1;
  readonly #now: () => string;

  constructor(options: {
    store: SnapshotStoreV1;
    validatePayload: ValidatePayloadV1;
    digestPayload?: DigestPayloadV1;
    now?: () => string;
  }) {
    this.#store = options.store;
    this.#validatePayload = options.validatePayload;
    this.#digestPayload = options.digestPayload ?? sha256Hex;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async save(input: SaveSnapshotInputV1): Promise<SaveSnapshotResultV1> {
    const totalStartedAt = performance.now();
    if (input.interruptAt === 'before_candidate') {
      throw interrupted('before candidate transaction');
    }

    const hashStartedAt = performance.now();
    const digest = await this.#digestPayload(input.payload);
    const hashMs = performance.now() - hashStartedAt;
    const snapshot: SnapshotRecordV1 = {
      snapshotKey: `${input.documentId}@${input.revision}`,
      documentId: input.documentId,
      revision: input.revision,
      schemaVersion: input.schemaVersion,
      engineAlgorithmVersion: input.engineAlgorithmVersion,
      payload: input.payload,
      integrity: { algorithm: 'sha-256', digest },
      status: 'candidate',
      createdAt: this.#now(),
    };

    const candidateStartedAt = performance.now();
    try {
      await this.#store.commitCandidate(
        snapshot,
        input.expectedPreviousRevision,
        input.durability,
        input.interruptAt === 'during_candidate_transaction',
      );
    } catch (error) {
      if (input.interruptAt === 'during_candidate_transaction') {
        throw interrupted('during candidate transaction');
      }
      throw error;
    }
    const candidateTransactionMs = performance.now() - candidateStartedAt;
    if (input.interruptAt === 'after_candidate') {
      throw interrupted('after candidate transaction');
    }

    const readBackStartedAt = performance.now();
    const readBack = await this.#store.getSnapshot(snapshot.snapshotKey);
    const readBackMs = performance.now() - readBackStartedAt;
    if (!readBack) {
      throw new PersistenceErrorV1('snapshot_missing', 'candidate snapshot read-back failed');
    }
    const readBackHashStartedAt = performance.now();
    const readBackDigest = await this.#digestPayload(readBack.payload);
    const readBackHashMs = performance.now() - readBackHashStartedAt;
    if (readBackDigest !== readBack.integrity.digest) {
      await this.#store.markRejected(snapshot.snapshotKey);
      throw new PersistenceErrorV1(
        'integrity_mismatch',
        'candidate digest changed after read-back',
      );
    }
    const validationStartedAt = performance.now();
    try {
      await this.#validatePayload(readBack.payload, readBack.schemaVersion);
    } catch (error) {
      await this.#store.markRejected(snapshot.snapshotKey);
      throw new PersistenceErrorV1('payload_invalid', errorMessage(error));
    }
    const validationMs = performance.now() - validationStartedAt;
    const readBackAndVerifyMs = performance.now() - readBackStartedAt;
    if (input.interruptAt === 'after_readback') {
      throw interrupted('after read-back verification');
    }

    const stableStartedAt = performance.now();
    await this.#store.markStable(snapshot.snapshotKey, input.durability);
    const stableTransactionMs = performance.now() - stableStartedAt;
    return {
      snapshot: { ...snapshot, status: 'stable' },
      metrics: {
        hashMs,
        candidateTransactionMs,
        readBackMs,
        readBackHashMs,
        validationMs,
        readBackAndVerifyMs,
        stableTransactionMs,
        totalMs: performance.now() - totalStartedAt,
      },
    };
  }

  async recover(documentId: string): Promise<RecoveryResultV1> {
    const catalog = await this.#store.getCatalog(documentId);
    if (!catalog) {
      throw new PersistenceErrorV1('recovery_unavailable', 'document catalog was not found');
    }
    const candidates = [
      ['stable', catalog.stableSnapshotKey],
      ['previous_stable', catalog.previousStableSnapshotKey],
    ] as const;
    for (const [source, snapshotKey] of candidates) {
      if (!snapshotKey) continue;
      const snapshot = await this.#store.getSnapshot(snapshotKey);
      if (!snapshot || snapshot.status !== 'stable') continue;
      const digest = await this.#digestPayload(snapshot.payload);
      if (digest !== snapshot.integrity.digest) continue;
      try {
        await this.#validatePayload(snapshot.payload, snapshot.schemaVersion);
      } catch {
        continue;
      }
      return { snapshot, source };
    }
    throw new PersistenceErrorV1(
      'recovery_unavailable',
      'no verified stable snapshot is available',
    );
  }
}

export class IndexedDbSnapshotStoreV1 implements SnapshotStoreV1 {
  readonly #database: IDBDatabase;

  private constructor(database: IDBDatabase) {
    this.#database = database;
  }

  static async open(
    databaseName = 'nodeink-local-v1',
    factory: IDBFactory = indexedDB,
  ): Promise<IndexedDbSnapshotStoreV1> {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('documents')) {
        database.createObjectStore('documents', { keyPath: 'documentId' });
      }
      if (!database.objectStoreNames.contains('snapshots')) {
        database.createObjectStore('snapshots', { keyPath: 'snapshotKey' });
      }
    };
    return new IndexedDbSnapshotStoreV1(await requestResult(request));
  }

  probeStrictDurability(): boolean {
    try {
      const transaction = this.#database.transaction('documents', 'readonly', {
        durability: 'strict',
      });
      return transaction.durability === 'strict';
    } catch {
      return false;
    }
  }

  async commitCandidate(
    snapshot: SnapshotRecordV1,
    expectedPreviousRevision: number,
    durability: IDBTransactionDurability,
    forceAbort: boolean,
  ): Promise<void> {
    const transaction = this.#database.transaction(['documents', 'snapshots'], 'readwrite', {
      durability,
    });
    const completion = transactionCompletion(transaction);
    const documents = transaction.objectStore('documents');
    const snapshots = transaction.objectStore('snapshots');
    const current = (await requestResult(documents.get(snapshot.documentId))) as
      | DocumentCatalogRecordV1
      | undefined;
    const currentRevision = current?.headRevision ?? 0;
    if (currentRevision !== expectedPreviousRevision) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw new PersistenceErrorV1(
        'revision_conflict',
        `expected persisted revision ${expectedPreviousRevision}, actual ${currentRevision}`,
      );
    }
    snapshots.put(snapshot);
    documents.put({
      documentId: snapshot.documentId,
      headRevision: snapshot.revision,
      headSnapshotKey: snapshot.snapshotKey,
      stableSnapshotKey: current?.stableSnapshotKey ?? null,
      previousStableSnapshotKey: current?.previousStableSnapshotKey ?? null,
      schemaVersion: snapshot.schemaVersion,
      updatedAt: snapshot.createdAt,
    } satisfies DocumentCatalogRecordV1);
    if (forceAbort) transaction.abort();
    await completion;
  }

  async markStable(snapshotKey: string, durability: IDBTransactionDurability): Promise<void> {
    const transaction = this.#database.transaction(['documents', 'snapshots'], 'readwrite', {
      durability,
    });
    const completion = transactionCompletion(transaction);
    const documents = transaction.objectStore('documents');
    const snapshots = transaction.objectStore('snapshots');
    const snapshot = (await requestResult(snapshots.get(snapshotKey))) as
      | SnapshotRecordV1
      | undefined;
    if (!snapshot) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw new PersistenceErrorV1('snapshot_missing', `snapshot ${snapshotKey} was not found`);
    }
    const catalog = (await requestResult(documents.get(snapshot.documentId))) as
      | DocumentCatalogRecordV1
      | undefined;
    if (!catalog || catalog.headSnapshotKey !== snapshotKey) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw new PersistenceErrorV1(
        'revision_conflict',
        'catalog head changed before stabilization',
      );
    }
    snapshots.put({ ...snapshot, status: 'stable' } satisfies SnapshotRecordV1);
    documents.put({
      ...catalog,
      stableSnapshotKey: snapshotKey,
      previousStableSnapshotKey:
        catalog.stableSnapshotKey && catalog.stableSnapshotKey !== snapshotKey
          ? catalog.stableSnapshotKey
          : catalog.previousStableSnapshotKey,
    } satisfies DocumentCatalogRecordV1);
    await completion;
  }

  async markRejected(snapshotKey: string): Promise<void> {
    const transaction = this.#database.transaction('snapshots', 'readwrite');
    const completion = transactionCompletion(transaction);
    const store = transaction.objectStore('snapshots');
    const snapshot = (await requestResult(store.get(snapshotKey))) as SnapshotRecordV1 | undefined;
    if (snapshot) store.put({ ...snapshot, status: 'rejected' } satisfies SnapshotRecordV1);
    await completion;
  }

  async getCatalog(documentId: string): Promise<DocumentCatalogRecordV1 | null> {
    const transaction = this.#database.transaction('documents', 'readonly');
    const value = (await requestResult(transaction.objectStore('documents').get(documentId))) as
      | DocumentCatalogRecordV1
      | undefined;
    return value ?? null;
  }

  async getSnapshot(snapshotKey: string): Promise<SnapshotRecordV1 | null> {
    const transaction = this.#database.transaction('snapshots', 'readonly');
    const value = (await requestResult(transaction.objectStore('snapshots').get(snapshotKey))) as
      | SnapshotRecordV1
      | undefined;
    return value ?? null;
  }

  close(): void {
    this.#database.close();
  }
}

export async function deleteNodeInkDatabase(
  databaseName: string,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  await requestResult(factory.deleteDatabase(databaseName));
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new PersistenceErrorV1('crypto_unavailable', 'Web Crypto SHA-256 is unavailable');
  }
  const digest = await subtle.digest('SHA-256', payload as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function interrupted(phase: string): PersistenceErrorV1 {
  return new PersistenceErrorV1('interrupted', `save interrupted ${phase}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
