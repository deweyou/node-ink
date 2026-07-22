import { describe, expect, it, vi } from 'vitest';

import {
  createBlankDocument,
  type ElementRecordV1,
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
    const source = await legacyV1Snapshot(4);
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
      document: {
        schemaVersion: 2,
        revision: 5,
        renderProfile: { kind: 'clean', version: 1 },
        elements: {
          'rect-1': {
            fill: { kind: 'solid', color: '#d1fae5' },
            stroke: '#047857',
            strokeWidth: 2,
          },
          'stroke-1': { stroke: '#0f172a', strokeWidth: 3 },
          'text-1': { color: '#0f172a', textAlign: 'start' },
        },
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        revision: 5,
        expectedPreviousRevision: 4,
        schemaVersion: 2,
        engineAlgorithmVersion: 'nodeink-scene-v2',
      }),
    );
  });

  it('keeps a migrated head readonly when the lease is unavailable', async () => {
    const source = await legacyV1Snapshot(4);
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
    const source = await legacyV1Snapshot(4);
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
        engineAlgorithmVersion: 'nodeink-scene-v2',
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
          engineAlgorithmVersion: 'nodeink-scene-v2',
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
          engineAlgorithmVersion: 'nodeink-scene-v2',
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
    engineAlgorithmVersion: () => 'nodeink-scene-v2',
    async migrateDocumentPayload(payloadJson: string): Promise<MigrationAttemptV1> {
      const parsed = JSON.parse(payloadJson) as LegacyDocumentFixture | NodeInkDocumentV1;
      if (parsed.schemaVersion !== 0 && parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
        return {
          result: null,
          report: {
            stage: 'schema',
            code: 'unknown_schema',
            sourceSchemaVersion: parsed.schemaVersion,
            targetSchemaVersion: 2,
            message: 'unsupported schema',
            recovery: 'try_next_snapshot_then_readonly_diagnostic',
          },
        };
      }
      const migrated = parsed.schemaVersion !== 2;
      const document: NodeInkDocumentV1 = migrated
        ? migrateLegacyDocument(parsed as LegacyDocumentFixture)
        : (parsed as NodeInkDocumentV1);
      return {
        result: {
          sourceSchemaVersion: parsed.schemaVersion,
          targetSchemaVersion: 2,
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
    engineAlgorithmVersion: 'nodeink-scene-v2',
    payload,
    integrity: { algorithm: 'sha-256', digest: await testDigest(payload) },
    status: 'stable',
    createdAt: '2026-07-22T00:00:00.000Z',
  };
}

type LegacyDocumentFixture = {
  schemaVersion: 0 | 1;
  documentId: string;
  revision: number;
  rootOrder: string[];
  elements: Record<string, LegacyElementFixture>;
};

type LegacyElementFixture =
  | {
      kind: 'rect';
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: 'stroke';
      id: string;
      points: Array<{ x: number; y: number }>;
      strokeWidth: number;
    }
  | {
      kind: 'text';
      id: string;
      x: number;
      y: number;
      text: string;
      fontFamily: 'Noto Sans SC Variable';
      fontSize: number;
      fontWeight: 400 | 500;
      maxWidth: number | null;
      fontFingerprint: string;
    };

function migrateLegacyDocument(legacy: LegacyDocumentFixture): NodeInkDocumentV1 {
  return {
    schemaVersion: 2,
    documentId: legacy.documentId,
    revision: legacy.revision + 1,
    renderProfile: { kind: 'clean', version: 1 },
    rootOrder: [...legacy.rootOrder],
    elements: Object.fromEntries(
      Object.entries(legacy.elements).map(([elementId, element]) => [
        elementId,
        migrateLegacyElement(element),
      ]),
    ),
  };
}

function migrateLegacyElement(element: LegacyElementFixture): ElementRecordV1 {
  if (element.kind === 'rect') {
    return {
      ...element,
      fill: { kind: 'solid', color: '#d1fae5' },
      stroke: '#047857',
      strokeWidth: 2,
    };
  }
  if (element.kind === 'stroke') {
    return { ...element, stroke: '#0f172a' };
  }
  return { ...element, color: '#0f172a', textAlign: 'start' };
}

async function legacyV1Snapshot(revision: number): Promise<SnapshotRecordV1> {
  const document = {
    schemaVersion: 1,
    documentId: 'doc-1',
    revision,
    rootOrder: ['rect-1', 'stroke-1', 'text-1'],
    elements: {
      'rect-1': {
        kind: 'rect',
        id: 'rect-1',
        x: 24,
        y: 40,
        width: 160,
        height: 96,
      },
      'stroke-1': {
        kind: 'stroke',
        id: 'stroke-1',
        points: [
          { x: 8, y: 12 },
          { x: 24, y: 28 },
        ],
        strokeWidth: 3,
      },
      'text-1': {
        kind: 'text',
        id: 'text-1',
        x: 40,
        y: 52,
        text: 'NodeInk',
        fontFamily: 'Noto Sans SC Variable',
        fontSize: 24,
        fontWeight: 400,
        maxWidth: null,
        fontFingerprint: 'font-ready-v1',
      },
    },
  } satisfies LegacyDocumentFixture;
  const payload = new TextEncoder().encode(JSON.stringify(document));
  return {
    snapshotKey: `doc-1@${revision}`,
    documentId: document.documentId,
    revision,
    schemaVersion: 1,
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
