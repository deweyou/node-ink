import { describe, expect, it, vi } from 'vitest';

import {
  createBlankDocument,
  type MigrationAttemptV1,
  type NodeInkDocumentV1,
} from '@nodeink-internal/protocol';

import type {
  DocumentCatalogRecordV1,
  DocumentLeaseResultV1,
  SnapshotRecordV1,
  SnapshotStoreV1,
} from './index';
import { DocumentAutosaveCoordinatorV1, openLocalDocumentV1 } from './local-document';

describe('openLocalDocumentV1', () => {
  it('opens a blank writable document when no catalog exists', async () => {
    const released = vi.fn(async () => undefined);
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store: new MemorySnapshotStore(),
      persistence: { save: vi.fn() },
      lease: lease({ kind: 'writer', release: released }),
      migrationPort: migrationPort(),
      blankDocument: createBlankDocument,
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'writer',
      recovery: 'blank',
      persistedRevision: 0,
      document: { documentId: 'doc-1', revision: 0 },
    });
    await opened.release();
    await opened.release();
    expect(released).toHaveBeenCalledOnce();
  });

  it('uses the default blank document factory and keeps an unavailable lease readonly', async () => {
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store: new MemorySnapshotStore(),
      persistence: { save: vi.fn() },
      lease: lease({ kind: 'readonly', reason: 'unsupported' }),
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'readonly',
      readonlyReason: 'unsupported',
      recovery: 'blank',
      document: { documentId: 'doc-1', revision: 0 },
    });
    await opened.release();
  });

  it('opens a verified head and preserves readonly lease reasons', async () => {
    const document = documentAt(3);
    const head = await snapshot('doc-1@3', document);
    const store = new MemorySnapshotStore(catalog(head), [head]);
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store,
      persistence: { save: vi.fn() },
      lease: lease({ kind: 'readonly', reason: 'held_elsewhere' }),
      migrationPort: migrationPort(),
      blankDocument: createBlankDocument,
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'readonly',
      readonlyReason: 'held_elsewhere',
      recovery: 'head',
      document: { revision: 3 },
    });
  });

  it('falls back from a corrupt head without making the fallback writable', async () => {
    const stable = await snapshot('doc-1@2', documentAt(2));
    const corruptHead = {
      ...(await snapshot('doc-1@3', documentAt(3))),
      integrity: { algorithm: 'sha-256' as const, digest: 'corrupt' },
    };
    const store = new MemorySnapshotStore(
      {
        ...catalog(corruptHead),
        stableSnapshotKey: stable.snapshotKey,
      },
      [corruptHead, stable],
    );
    const released = vi.fn(async () => undefined);
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store,
      persistence: { save: vi.fn() },
      lease: lease({ kind: 'writer', release: released }),
      migrationPort: migrationPort(),
      blankDocument: createBlankDocument,
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'readonly',
      readonlyReason: 'recovered_fallback',
      recovery: 'stable_fallback',
      document: { revision: 2 },
      diagnostics: [{ report: { code: 'integrity_mismatch' } }],
    });
    expect(released).toHaveBeenCalledOnce();
  });

  it('persists a migrated head as a new revision before granting write access', async () => {
    const source = await snapshot('doc-1@4', {
      ...documentAt(4),
      schemaVersion: 0 as never,
    });
    const store = new MemorySnapshotStore(catalog(source), [source]);
    const save = vi.fn(async () => ({ snapshot: source, metrics: saveMetrics() }));
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store,
      persistence: { save },
      lease: lease({ kind: 'writer', release: vi.fn(async () => undefined) }),
      migrationPort: migrationPort(),
      blankDocument: createBlankDocument,
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'writer',
      recovery: 'migrated_head',
      persistedRevision: 5,
      document: { schemaVersion: 1, revision: 5 },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        revision: 5,
        expectedPreviousRevision: 4,
        schemaVersion: 1,
        engineAlgorithmVersion: 'nodeink-scene-v1',
      }),
    );
  });

  it('keeps a migrated head readonly when the lease is unavailable', async () => {
    const source = await snapshot('doc-1@4', {
      ...documentAt(4),
      schemaVersion: 0 as never,
    });
    const save = vi.fn();
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store: new MemorySnapshotStore(catalog(source), [source]),
      persistence: { save },
      lease: lease({ kind: 'readonly', reason: 'held_elsewhere' }),
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'readonly',
      readonlyReason: 'held_elsewhere',
      recovery: 'migrated_head',
      persistedRevision: 4,
      document: { revision: 5 },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('releases the writer and exposes diagnostics when a migrated copy cannot persist', async () => {
    const source = await snapshot('doc-1@4', {
      ...documentAt(4),
      schemaVersion: 0 as never,
    });
    const released = vi.fn(async () => undefined);
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store: new MemorySnapshotStore(catalog(source), [source]),
      persistence: { save: vi.fn(async () => Promise.reject('quota exceeded')) },
      lease: lease({ kind: 'writer', release: released }),
      migrationPort: migrationPort(),
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'opened',
      access: 'readonly',
      readonlyReason: 'migration_save_failed',
      recovery: 'migration_save_failed',
      persistedRevision: 4,
      document: { revision: 5 },
      diagnostics: [
        {
          report: {
            code: 'migration_save_failed',
            message: 'quota exceeded',
          },
        },
      ],
    });
    expect(released).toHaveBeenCalledOnce();
  });

  it('returns readonly diagnostics when every candidate fails', async () => {
    const invalid = await snapshot('doc-1@1', documentAt(1));
    invalid.integrity.digest = 'invalid';
    const opened = await openLocalDocumentV1({
      documentId: 'doc-1',
      store: new MemorySnapshotStore(catalog(invalid), [invalid]),
      persistence: { save: vi.fn() },
      lease: lease({ kind: 'writer', release: vi.fn(async () => undefined) }),
      migrationPort: migrationPort(),
      blankDocument: createBlankDocument,
      digestPayload: testDigest,
    });

    expect(opened).toMatchObject({
      kind: 'readonly_diagnostic',
      recovery: 'readonly_diagnostic',
      diagnostics: [{ report: { code: 'integrity_mismatch' } }],
    });
  });
});

describe('DocumentAutosaveCoordinatorV1', () => {
  it('debounces committed revisions and exposes dirty, saving, and saved states', async () => {
    vi.useFakeTimers();
    const document = documentAt(2);
    const save = vi.fn(async () => ({
      snapshot: await snapshot('doc-1@2', document),
      metrics: saveMetrics(),
    }));
    const source = {
      serializeDocument: () => ({
        canonicalPayload: JSON.stringify(document),
        document,
        engineAlgorithmVersion: 'nodeink-scene-v1',
      }),
    };
    const coordinator = new DocumentAutosaveCoordinatorV1({
      source,
      persistence: { save },
      persistedRevision: 0,
    });
    const states: string[] = [];
    coordinator.subscribe(() => states.push(coordinator.getSnapshot().status));

    coordinator.markCommitted(1);
    coordinator.markCommitted(2);

    expect(coordinator.getSnapshot().status).toBe('dirty');
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 2, expectedPreviousRevision: 0 }),
    );
    expect(states).toContain('saving');
    expect(coordinator.getSnapshot()).toEqual({
      status: 'saved',
      persistedRevision: 2,
      pendingRevision: 2,
      errorMessage: null,
    });
    coordinator.dispose();
    vi.useRealTimers();
  });

  it('keeps failed work dirty and retries without claiming it was saved', async () => {
    vi.useFakeTimers();
    const document = documentAt(1);
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValueOnce({
        snapshot: await snapshot('doc-1@1', document),
        metrics: saveMetrics(),
      });
    const coordinator = new DocumentAutosaveCoordinatorV1({
      source: {
        serializeDocument: () => ({
          canonicalPayload: JSON.stringify(document),
          document,
          engineAlgorithmVersion: 'nodeink-scene-v1',
        }),
      },
      persistence: { save },
      persistedRevision: 0,
    });

    coordinator.markCommitted(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'save_failed',
      persistedRevision: 0,
      pendingRevision: 1,
      errorMessage: 'quota exceeded',
    });

    await coordinator.retry();
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'saved',
      persistedRevision: 1,
      errorMessage: null,
    });
    coordinator.dispose();
    vi.useRealTimers();
  });

  it('does not spin retries when a concurrent flush joins a failed save', async () => {
    const document = documentAt(1);
    let rejectSave: (reason?: unknown) => void = () => undefined;
    const pendingSave = new Promise<never>((_resolve, reject) => {
      rejectSave = reject;
    });
    const save = vi.fn(() => pendingSave);
    const coordinator = new DocumentAutosaveCoordinatorV1({
      source: {
        serializeDocument: () => ({
          canonicalPayload: JSON.stringify(document),
          document,
          engineAlgorithmVersion: 'nodeink-scene-v1',
        }),
      },
      persistence: { save },
      persistedRevision: 0,
    });

    coordinator.markCommitted(1);
    const primaryFlush = coordinator.flush();
    const joinedFlush = coordinator.flush();
    rejectSave(new Error('quota exceeded'));
    await Promise.all([primaryFlush, joinedFlush]);

    expect(save).toHaveBeenCalledOnce();
    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'save_failed',
      persistedRevision: 0,
      pendingRevision: 1,
      errorMessage: 'quota exceeded',
    });
    coordinator.dispose();
  });
});

class MemorySnapshotStore implements SnapshotStoreV1 {
  readonly #catalog: DocumentCatalogRecordV1 | null;
  readonly #snapshots: Map<string, SnapshotRecordV1>;

  constructor(
    catalogRecord: DocumentCatalogRecordV1 | null = null,
    snapshots = <SnapshotRecordV1[]>[],
  ) {
    this.#catalog = catalogRecord;
    this.#snapshots = new Map(snapshots.map((entry) => [entry.snapshotKey, entry]));
  }

  async commitCandidate(): Promise<void> {}
  async markStable(): Promise<void> {}
  async markRejected(): Promise<void> {}
  async getCatalog(): Promise<DocumentCatalogRecordV1 | null> {
    return this.#catalog;
  }
  async getSnapshot(snapshotKey: string): Promise<SnapshotRecordV1 | null> {
    return this.#snapshots.get(snapshotKey) ?? null;
  }
}

function lease(result: DocumentLeaseResultV1) {
  return { acquire: vi.fn(async () => result) };
}

function documentAt(revision: number): NodeInkDocumentV1 {
  return { ...createBlankDocument('doc-1'), revision };
}

function migrationPort() {
  return {
    engineAlgorithmVersion: () => 'nodeink-scene-v1',
    async migrateDocumentPayload(payloadJson: string): Promise<MigrationAttemptV1> {
      const parsed = JSON.parse(payloadJson) as Omit<NodeInkDocumentV1, 'schemaVersion'> & {
        schemaVersion: number;
      };
      if (parsed.schemaVersion !== 0 && parsed.schemaVersion !== 1) {
        return {
          result: null,
          report: {
            stage: 'schema',
            code: 'unknown_schema',
            sourceSchemaVersion: parsed.schemaVersion,
            targetSchemaVersion: 1,
            message: 'unsupported schema',
            recovery: 'try_next_snapshot_then_readonly_diagnostic',
          },
        };
      }
      const migrated = parsed.schemaVersion === 0;
      const document = {
        ...parsed,
        schemaVersion: 1 as const,
        revision: migrated ? parsed.revision + 1 : parsed.revision,
      };
      return {
        result: {
          sourceSchemaVersion: parsed.schemaVersion,
          targetSchemaVersion: 1,
          migrated,
          document,
          canonicalPayload: JSON.stringify(document),
        },
        report: null,
      };
    },
  };
}

async function snapshot(
  snapshotKey: string,
  document: NodeInkDocumentV1,
): Promise<SnapshotRecordV1> {
  const payload = new TextEncoder().encode(JSON.stringify(document));
  return {
    snapshotKey,
    documentId: document.documentId,
    revision: document.revision,
    schemaVersion: document.schemaVersion,
    engineAlgorithmVersion: 'nodeink-scene-v1',
    payload,
    integrity: { algorithm: 'sha-256', digest: await testDigest(payload) },
    status: 'stable',
    createdAt: '2026-07-22T00:00:00.000Z',
  };
}

function catalog(head: SnapshotRecordV1): DocumentCatalogRecordV1 {
  return {
    documentId: head.documentId,
    headRevision: head.revision,
    headSnapshotKey: head.snapshotKey,
    stableSnapshotKey: head.snapshotKey,
    previousStableSnapshotKey: null,
    schemaVersion: head.schemaVersion,
    updatedAt: head.createdAt,
  };
}

async function testDigest(payload: Uint8Array): Promise<string> {
  return `test:${new TextDecoder().decode(payload)}`;
}

function saveMetrics() {
  return {
    hashMs: 0,
    candidateTransactionMs: 0,
    readBackMs: 0,
    readBackHashMs: 0,
    validationMs: 0,
    readBackAndVerifyMs: 0,
    stableTransactionMs: 0,
    totalMs: 0,
  };
}
