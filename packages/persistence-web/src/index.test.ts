import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBlankDocument,
  type MigrationAttemptV1,
  type NodeInkDocumentV1,
} from '@nodeink-internal/protocol';

import {
  AtomicSnapshotPersistenceV1,
  deleteNodeInkDatabase,
  IndexedDbCameraStoreV1,
  IndexedDbSnapshotStoreV1,
  PersistenceErrorV1,
  sha256Hex,
  recoverCopyOnWriteV1,
  type SaveInterruptionV1,
  type SnapshotRecordV1,
  type SnapshotStoreV1,
  WebLockDocumentLeaseV1,
} from './index';

const openStores: Array<IndexedDbSnapshotStoreV1 | IndexedDbCameraStoreV1> = [];

afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
});

describe('AtomicSnapshotPersistenceV1', () => {
  it('atomically advances candidate, head, stable, and previous stable snapshots', async () => {
    const { persistence, store } = await fixture();

    const first = await persistence.save(saveInput(1, 0, payload(1)));
    const second = await persistence.save(saveInput(2, 1, payload(2)));
    const catalog = await store.getCatalog('doc-1');

    expect(first.snapshot.status).toBe('stable');
    expect(second.metrics).toMatchObject({
      hashMs: expect.any(Number),
      candidateTransactionMs: expect.any(Number),
      readBackMs: expect.any(Number),
      readBackHashMs: expect.any(Number),
      validationMs: expect.any(Number),
      readBackAndVerifyMs: expect.any(Number),
      stableTransactionMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(catalog).toMatchObject({
      headRevision: 2,
      headSnapshotKey: 'doc-1@2',
      stableSnapshotKey: 'doc-1@2',
      previousStableSnapshotKey: 'doc-1@1',
    });
    await expect(persistence.recover('doc-1')).resolves.toMatchObject({
      source: 'stable',
      snapshot: { snapshotKey: 'doc-1@2', revision: 2 },
    });
  });

  it.each<SaveInterruptionV1>([
    'before_candidate',
    'during_candidate_transaction',
    'after_candidate',
    'after_readback',
  ])('recovers the previous stable snapshot after %s interruption', async (interruptAt) => {
    const { persistence, store } = await fixture();
    await persistence.save(saveInput(1, 0, payload(1)));

    await expect(
      persistence.save({ ...saveInput(2, 1, payload(2)), interruptAt }),
    ).rejects.toMatchObject({
      code: 'interrupted',
    });

    const recovered = await persistence.recover('doc-1');
    expect(recovered.snapshot.snapshotKey).toBe('doc-1@1');
    expect(recovered.source).toBe('stable');
    const candidate = await store.getSnapshot('doc-1@2');
    if (interruptAt === 'before_candidate' || interruptAt === 'during_candidate_transaction') {
      expect(candidate).toBeNull();
    } else {
      expect(candidate?.status).toBe('candidate');
    }
  });

  it('rejects revision conflicts without changing the catalog or adding a snapshot', async () => {
    const { persistence, store } = await fixture();
    await persistence.save(saveInput(1, 0, payload(1)));

    await expect(persistence.save(saveInput(2, 0, payload(2)))).rejects.toMatchObject({
      code: 'revision_conflict',
    });

    expect(await store.getSnapshot('doc-1@2')).toBeNull();
    expect(await store.getCatalog('doc-1')).toMatchObject({ headRevision: 1 });
  });

  it('marks invalid read-back payloads rejected and keeps the last stable snapshot', async () => {
    const { store } = await fixture();
    const persistence = new AtomicSnapshotPersistenceV1({
      store,
      digestPayload: testDigest,
      validatePayload: (bytes) => {
        if (bytes[0] === 2) throw new Error('fixture schema is invalid');
      },
      now: () => '2026-07-22T00:00:00.000Z',
    });
    await persistence.save(saveInput(1, 0, payload(1)));

    await expect(persistence.save(saveInput(2, 1, payload(2)))).rejects.toMatchObject({
      code: 'payload_invalid',
      message: 'fixture schema is invalid',
    });

    expect(await store.getSnapshot('doc-1@2')).toMatchObject({ status: 'rejected' });
    await expect(persistence.recover('doc-1')).resolves.toMatchObject({
      snapshot: { snapshotKey: 'doc-1@1' },
    });
  });

  it('falls back to previous stable when the current stable fails integrity verification', async () => {
    const { persistence, store } = await fixture();
    await persistence.save(saveInput(1, 0, payload(1)));
    await persistence.save(saveInput(2, 1, payload(2)));
    const corruptingStore: SnapshotStoreV1 = {
      ...delegateStore(store),
      async getSnapshot(key) {
        const snapshot = await store.getSnapshot(key);
        return key === 'doc-1@2' && snapshot
          ? { ...snapshot, payload: new Uint8Array([99]) }
          : snapshot;
      },
    };
    const recovering = new AtomicSnapshotPersistenceV1({
      store: corruptingStore,
      validatePayload,
      digestPayload: testDigest,
    });

    await expect(recovering.recover('doc-1')).resolves.toMatchObject({
      source: 'previous_stable',
      snapshot: { snapshotKey: 'doc-1@1' },
    });
  });

  it('reports missing catalogs and exhausted recovery candidates', async () => {
    const { persistence, store } = await fixture();
    await expect(persistence.recover('missing')).rejects.toMatchObject({
      code: 'recovery_unavailable',
    });
    await persistence.save(saveInput(1, 0, payload(1)));
    const alwaysInvalid = new AtomicSnapshotPersistenceV1({
      store,
      digestPayload: testDigest,
      validatePayload: () => {
        throw new Error('cannot open');
      },
    });
    await expect(alwaysInvalid.recover('doc-1')).rejects.toMatchObject({
      code: 'recovery_unavailable',
    });
  });

  it('detects a changed read-back digest and rejects the candidate', async () => {
    const { store } = await fixture();
    let digestCalls = 0;
    const persistence = new AtomicSnapshotPersistenceV1({
      store,
      validatePayload,
      digestPayload: async () => (digestCalls++ === 0 ? 'first' : 'changed'),
    });

    await expect(persistence.save(saveInput(1, 0, payload(1)))).rejects.toMatchObject({
      code: 'integrity_mismatch',
    });
    expect(await store.getSnapshot('doc-1@1')).toMatchObject({ status: 'rejected' });
  });
});

describe('IndexedDbSnapshotStoreV1', () => {
  it('persists Camera separately for each document', async () => {
    const store = await IndexedDbCameraStoreV1.open(
      `camera-fixture-${Math.random()}`,
      new IDBFactory(),
    );
    openStores.push(store);

    await store.saveCamera('doc-1', { x: -48, y: 16, zoom: 1.5 });
    await store.saveCamera('doc-2', { x: 20, y: 40, zoom: 0.75 });

    await expect(store.loadCamera('doc-1')).resolves.toEqual({ x: -48, y: 16, zoom: 1.5 });
    await expect(store.loadCamera('doc-2')).resolves.toEqual({ x: 20, y: 40, zoom: 0.75 });
    await expect(store.loadCamera('missing')).resolves.toBeNull();
  });

  it('reports missing snapshots during stabilization and ignores missing rejection targets', async () => {
    const { store } = await fixture();

    await expect(store.markStable('missing', 'strict')).rejects.toMatchObject({
      code: 'snapshot_missing',
    });
    await expect(store.markRejected('missing')).resolves.toBeUndefined();
    expect(store.probeStrictDurability()).toBe(true);
  });

  it('rejects stabilization if another candidate became the catalog head', async () => {
    const { store } = await fixture();
    const first = snapshot(1);
    const second = snapshot(2);
    await store.commitCandidate(first, 0, 'strict', false);
    await store.commitCandidate(second, 1, 'strict', false);

    await expect(store.markStable(first.snapshotKey, 'strict')).rejects.toMatchObject({
      code: 'revision_conflict',
    });
  });

  it('deletes a closed database and can recreate its stores', async () => {
    const factory = new IDBFactory();
    const name = 'delete-fixture';
    const store = await IndexedDbSnapshotStoreV1.open(name, factory);
    store.close();

    await deleteNodeInkDatabase(name, factory);
    const reopened = await IndexedDbSnapshotStoreV1.open(name, factory);
    openStores.push(reopened);
    expect(await reopened.getCatalog('missing')).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('uses Web Crypto SHA-256 when available', async () => {
    await expect(sha256Hex(new TextEncoder().encode('NodeInk'))).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports when Web Crypto is unavailable', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      await expect(sha256Hex(new Uint8Array())).rejects.toMatchObject({
        code: 'crypto_unavailable',
      });
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
    }
  });
});

describe('recoverCopyOnWriteV1', () => {
  it('opens a valid V6 snapshot without requesting a persisted copy', async () => {
    const candidate = migrationCandidate('head', 6, currentPayload());

    const recovered = await recoverCopyOnWriteV1({
      candidates: [candidate],
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(recovered).toMatchObject({
      ok: true,
      source: 'head',
      migrated: false,
      requiresPersistedCopy: false,
      diagnostics: [],
    });
  });

  it('migrates an explicit V1 copy while preserving the exact source payload', async () => {
    const legacy = new TextEncoder().encode(
      '{"schemaVersion":1,"documentId":"doc-1","revision":4,"rootOrder":[],"elements":{}}',
    );
    const original = [...legacy];
    const candidate = migrationCandidate('head', 1, legacy);

    const recovered = await recoverCopyOnWriteV1({
      candidates: [candidate],
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(recovered).toMatchObject({ ok: true, migrated: true, requiresPersistedCopy: true });
    expect([...legacy]).toEqual(original);
    if (recovered.ok) {
      expect(JSON.parse(new TextDecoder().decode(recovered.canonicalPayload))).toMatchObject({
        schemaVersion: 6,
        revision: 5,
        renderProfile: { kind: 'clean', version: 1 },
      });
    }
  });

  it('records a hash mismatch and deterministically falls back to stable', async () => {
    const corruptHead = migrationCandidate('head', 6, currentPayload());
    corruptHead.snapshot.integrity.digest = 'wrong';
    const stable = migrationCandidate('stable', 6, currentPayload());

    const recovered = await recoverCopyOnWriteV1({
      candidates: [corruptHead, stable],
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(recovered).toMatchObject({
      ok: true,
      source: 'stable',
      diagnostics: [{ snapshotKey: 'doc-1@1', report: { code: 'integrity_mismatch' } }],
    });
  });

  it('returns readonly diagnostics when unknown schema and migration failures exhaust fallbacks', async () => {
    const unknown = migrationCandidate(
      'head',
      99,
      new TextEncoder().encode('{"schemaVersion":99}'),
    );
    const failedLegacy = migrationCandidate(
      'stable',
      0,
      new TextEncoder().encode('{"schemaVersion":0,"failMigration":true}'),
    );

    const recovered = await recoverCopyOnWriteV1({
      candidates: [unknown, failedLegacy],
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(recovered).toEqual({
      ok: false,
      recovery: 'readonly_diagnostic',
      diagnostics: [
        expect.objectContaining({ report: expect.objectContaining({ code: 'unknown_schema' }) }),
        expect.objectContaining({ report: expect.objectContaining({ code: 'migration_failed' }) }),
      ],
    });
  });
});

describe('WebLockDocumentLeaseV1', () => {
  it('grants one writer, rejects a contender, and allows takeover after release', async () => {
    const locks = new FakeLockManager();
    const firstCoordinator = new WebLockDocumentLeaseV1(locks);
    const secondCoordinator = new WebLockDocumentLeaseV1(locks);

    const first = await firstCoordinator.acquire('doc-1');
    const contender = await secondCoordinator.acquire('doc-1');
    expect(first.kind).toBe('writer');
    expect(contender).toEqual({ kind: 'readonly', reason: 'held_elsewhere' });
    if (first.kind === 'writer') {
      await first.release();
      await first.release();
    }

    await expect(secondCoordinator.acquire('doc-1')).resolves.toMatchObject({ kind: 'writer' });
  });

  it('uses independent lock names for different documents', async () => {
    const locks = new FakeLockManager();
    const coordinator = new WebLockDocumentLeaseV1(locks);
    const first = await coordinator.acquire('doc-1');
    const second = await coordinator.acquire('doc-2');

    expect(first.kind).toBe('writer');
    expect(second.kind).toBe('writer');
    if (first.kind === 'writer') await first.release();
    if (second.kind === 'writer') await second.release();
  });

  it('degrades to readonly when Web Locks are missing or reject requests', async () => {
    await expect(new WebLockDocumentLeaseV1(undefined).acquire('doc-1')).resolves.toEqual({
      kind: 'readonly',
      reason: 'unsupported',
    });
    const rejecting = new WebLockDocumentLeaseV1({
      request: async () => {
        throw new Error('locks unavailable');
      },
    });
    await expect(rejecting.acquire('doc-1')).resolves.toEqual({
      kind: 'readonly',
      reason: 'unsupported',
    });
  });
});

async function fixture() {
  const factory = new IDBFactory();
  const store = await IndexedDbSnapshotStoreV1.open(`fixture-${Math.random()}`, factory);
  openStores.push(store);
  return {
    store,
    persistence: new AtomicSnapshotPersistenceV1({
      store,
      validatePayload,
      digestPayload: testDigest,
      now: () => '2026-07-22T00:00:00.000Z',
    }),
  };
}

function saveInput(revision: number, expectedPreviousRevision: number, bytes: Uint8Array) {
  return {
    documentId: 'doc-1',
    revision,
    expectedPreviousRevision,
    schemaVersion: 2,
    engineAlgorithmVersion: 'nodeink-scene-v2',
    payload: bytes,
    durability: 'strict' as const,
    interruptAt: null,
  };
}

function payload(revision: number): Uint8Array {
  return new Uint8Array([revision, 10, 20]);
}

function validatePayload(bytes: Uint8Array): void {
  if (bytes.length !== 3) throw new Error('invalid fixture');
}

async function testDigest(bytes: Uint8Array): Promise<string> {
  return [...bytes].join('-');
}

function snapshot(revision: number): SnapshotRecordV1 {
  return {
    snapshotKey: `doc-1@${revision}`,
    documentId: 'doc-1',
    revision,
    schemaVersion: 2,
    engineAlgorithmVersion: 'nodeink-scene-v2',
    payload: payload(revision),
    integrity: { algorithm: 'sha-256', digest: String(revision) },
    status: 'candidate',
    createdAt: '2026-07-22T00:00:00.000Z',
  };
}

function delegateStore(store: SnapshotStoreV1): SnapshotStoreV1 {
  return {
    commitCandidate: (...args) => store.commitCandidate(...args),
    markStable: (...args) => store.markStable(...args),
    markRejected: (...args) => store.markRejected(...args),
    getCatalog: (...args) => store.getCatalog(...args),
    getSnapshot: (...args) => store.getSnapshot(...args),
  };
}

function currentPayload(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(createBlankDocument('doc-1')));
}

function migrationCandidate(
  source: 'head' | 'stable' | 'previous_stable',
  schemaVersion: number,
  bytes: Uint8Array,
) {
  return {
    source,
    snapshot: {
      ...snapshot(1),
      schemaVersion,
      payload: bytes,
      integrity: { algorithm: 'sha-256' as const, digest: [...bytes].join('-') },
      status: 'stable' as const,
    },
  };
}

function migrationPort() {
  return {
    async migrateDocumentPayload(payloadJson: string): Promise<MigrationAttemptV1> {
      const parsed = JSON.parse(payloadJson) as {
        schemaVersion?: number;
        documentId?: string;
        revision?: number;
        failMigration?: boolean;
      };
      if (parsed.schemaVersion === 99) {
        return failedMigrationAttempt('schema', 'unknown_schema', 99);
      }
      if (parsed.failMigration) {
        return failedMigrationAttempt('migration', 'migration_failed', 0);
      }
      if (
        parsed.schemaVersion !== 0 &&
        parsed.schemaVersion !== 1 &&
        parsed.schemaVersion !== 2 &&
        parsed.schemaVersion !== 3 &&
        parsed.schemaVersion !== 4 &&
        parsed.schemaVersion !== 5 &&
        parsed.schemaVersion !== 6
      ) {
        return failedMigrationAttempt('schema', 'unknown_schema', parsed.schemaVersion ?? -1);
      }
      const migrated = parsed.schemaVersion !== 6;
      const document: NodeInkDocumentV1 = {
        ...createBlankDocument(parsed.documentId ?? 'doc-1'),
        revision: (parsed.revision ?? 0) + (migrated ? 1 : 0),
      };
      return {
        result: {
          sourceSchemaVersion: parsed.schemaVersion,
          targetSchemaVersion: 6,
          migrated,
          document,
          canonicalPayload: JSON.stringify(document),
        },
        report: null,
      };
    },
  };
}

function failedMigrationAttempt(stage: string, code: string, sourceSchemaVersion: number) {
  return {
    result: null,
    report: {
      stage,
      code,
      sourceSchemaVersion,
      targetSchemaVersion: 6,
      message: code,
      recovery: 'try_next_snapshot_then_readonly_diagnostic' as const,
    },
  };
}

class FakeLockManager {
  readonly #held = new Set<string>();

  async request(
    name: string,
    _options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void> {
    if (this.#held.has(name)) {
      await callback(null);
      return;
    }
    this.#held.add(name);
    try {
      await callback({ name });
    } finally {
      this.#held.delete(name);
    }
  }
}

void PersistenceErrorV1;
