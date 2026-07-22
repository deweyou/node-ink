import { createBlankDocument, type NodeInkDocumentV1 } from '@nodeink-internal/protocol';

import {
  recoverCopyOnWriteV1,
  type DigestPayloadV1,
  type DocumentLeaseResultV1,
  type MigrationPortV1,
  type MigrationDiagnosticV1,
  type SaveSnapshotInputV1,
  type SaveSnapshotResultV1,
  type SnapshotStoreV1,
} from './index';

export type LocalDocumentAccessV1 = 'writer' | 'readonly';
export type LocalDocumentReadonlyReasonV1 =
  | 'held_elsewhere'
  | 'unsupported'
  | 'recovered_fallback'
  | 'migration_save_failed';
export type LocalDocumentRecoveryV1 =
  | 'blank'
  | 'head'
  | 'migrated_head'
  | 'stable_fallback'
  | 'previous_stable_fallback'
  | 'migration_save_failed'
  | 'readonly_diagnostic';

export interface DocumentLeasePortV1 {
  acquire(documentId: string): Promise<DocumentLeaseResultV1>;
}

export interface SnapshotPersistencePortV1 {
  save(input: SaveSnapshotInputV1): Promise<SaveSnapshotResultV1>;
}

export interface MigrationRuntimePortV1 extends MigrationPortV1 {
  engineAlgorithmVersion(): string;
}

export type LocalDocumentOpenResultV1 =
  | {
      kind: 'opened';
      document: NodeInkDocumentV1;
      access: LocalDocumentAccessV1;
      readonlyReason: LocalDocumentReadonlyReasonV1 | null;
      recovery: Exclude<LocalDocumentRecoveryV1, 'readonly_diagnostic'>;
      persistedRevision: number;
      diagnostics: MigrationDiagnosticV1[];
      release(): Promise<void>;
    }
  | {
      kind: 'readonly_diagnostic';
      recovery: 'readonly_diagnostic';
      diagnostics: MigrationDiagnosticV1[];
      release(): Promise<void>;
    };

export async function openLocalDocumentV1(options: {
  documentId: string;
  store: SnapshotStoreV1;
  persistence: SnapshotPersistencePortV1;
  lease: DocumentLeasePortV1;
  migrationPort: MigrationRuntimePortV1;
  blankDocument?: (documentId: string) => NodeInkDocumentV1;
  digestPayload?: DigestPayloadV1;
  durability?: IDBTransactionDurability;
}): Promise<LocalDocumentOpenResultV1> {
  const lease = await options.lease.acquire(options.documentId);
  const release = idempotentRelease(lease);
  const catalog = await options.store.getCatalog(options.documentId);
  if (!catalog) {
    return {
      kind: 'opened',
      document: (options.blankDocument ?? createBlankDocument)(options.documentId),
      access: lease.kind,
      readonlyReason: lease.kind === 'readonly' ? lease.reason : null,
      recovery: 'blank',
      persistedRevision: 0,
      diagnostics: [],
      release,
    };
  }

  const candidates = await loadRecoveryCandidates(options.store, catalog);
  const recovered = await recoverCopyOnWriteV1({
    candidates,
    migrationPort: options.migrationPort,
    ...(options.digestPayload ? { digestPayload: options.digestPayload } : {}),
  });
  if (!recovered.ok) {
    await release();
    return {
      kind: 'readonly_diagnostic',
      recovery: 'readonly_diagnostic',
      diagnostics: recovered.diagnostics,
      release,
    };
  }

  const fallbackRecovery = recoveryForSource(recovered.source);
  if (recovered.source !== 'head') {
    await release();
    return {
      kind: 'opened',
      document: recovered.document,
      access: 'readonly',
      readonlyReason: 'recovered_fallback',
      recovery: fallbackRecovery,
      persistedRevision: recovered.sourceSnapshot.revision,
      diagnostics: recovered.diagnostics,
      release,
    };
  }

  let persistedRevision = recovered.sourceSnapshot.revision;
  if (recovered.requiresPersistedCopy) {
    if (lease.kind === 'readonly') {
      return {
        kind: 'opened',
        document: recovered.document,
        access: 'readonly',
        readonlyReason: lease.reason,
        recovery: 'migrated_head',
        persistedRevision,
        diagnostics: recovered.diagnostics,
        release,
      };
    }
    try {
      await options.persistence.save({
        documentId: recovered.document.documentId,
        revision: recovered.document.revision,
        expectedPreviousRevision: recovered.sourceSnapshot.revision,
        schemaVersion: recovered.document.schemaVersion,
        engineAlgorithmVersion: options.migrationPort.engineAlgorithmVersion(),
        payload: recovered.canonicalPayload,
        durability: options.durability ?? 'strict',
        interruptAt: null,
      });
      persistedRevision = recovered.document.revision;
    } catch (error) {
      await release();
      return {
        kind: 'opened',
        document: recovered.document,
        access: 'readonly',
        readonlyReason: 'migration_save_failed',
        recovery: 'migration_save_failed',
        persistedRevision,
        diagnostics: [
          ...recovered.diagnostics,
          {
            snapshotKey: recovered.sourceSnapshot.snapshotKey,
            source: recovered.source,
            report: {
              stage: 'persistence',
              code: 'migration_save_failed',
              sourceSchemaVersion: recovered.sourceSnapshot.schemaVersion,
              targetSchemaVersion: recovered.document.schemaVersion,
              message: errorMessage(error),
              recovery: 'try_next_snapshot_then_readonly_diagnostic',
            },
          },
        ],
        release,
      };
    }
  }

  return {
    kind: 'opened',
    document: recovered.document,
    access: lease.kind,
    readonlyReason: lease.kind === 'readonly' ? lease.reason : null,
    recovery: recovered.migrated ? 'migrated_head' : 'head',
    persistedRevision,
    diagnostics: recovered.diagnostics,
    release,
  };
}

export type DocumentSaveStatusV1 = 'saved' | 'dirty' | 'saving' | 'save_failed';

export interface DocumentAutosaveSnapshotV1 {
  status: DocumentSaveStatusV1;
  persistedRevision: number;
  pendingRevision: number;
  errorMessage: string | null;
}

export interface SerializedDocumentV1 {
  canonicalPayload: string;
  document: NodeInkDocumentV1;
  engineAlgorithmVersion: string;
}

export interface SerializedDocumentSourceV1 {
  serializeDocument(): SerializedDocumentV1;
}

export interface DocumentAutosavePortV1 {
  getSnapshot(): DocumentAutosaveSnapshotV1;
  subscribe(listener: () => void): () => void;
  markCommitted(revision: number): void;
  retry(): Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
}

export class DocumentAutosaveCoordinatorV1 implements DocumentAutosavePortV1 {
  readonly #source: SerializedDocumentSourceV1;
  readonly #persistence: SnapshotPersistencePortV1;
  readonly #debounceMs: number;
  readonly #durability: IDBTransactionDurability;
  readonly #listeners = new Set<() => void>();
  #snapshot: DocumentAutosaveSnapshotV1;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #activeSave: Promise<void> | null = null;
  #isDisposed = false;

  constructor(options: {
    source: SerializedDocumentSourceV1;
    persistence: SnapshotPersistencePortV1;
    persistedRevision: number;
    debounceMs?: number;
    durability?: IDBTransactionDurability;
  }) {
    this.#source = options.source;
    this.#persistence = options.persistence;
    this.#debounceMs = options.debounceMs ?? 750;
    this.#durability = options.durability ?? 'strict';
    this.#snapshot = {
      status: 'saved',
      persistedRevision: options.persistedRevision,
      pendingRevision: options.persistedRevision,
      errorMessage: null,
    };
  }

  getSnapshot(): DocumentAutosaveSnapshotV1 {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  markCommitted(revision: number): void {
    if (this.#isDisposed || revision <= this.#snapshot.persistedRevision) {
      return;
    }
    this.setSnapshot({
      status: 'dirty',
      persistedRevision: this.#snapshot.persistedRevision,
      pendingRevision: Math.max(revision, this.#snapshot.pendingRevision),
      errorMessage: null,
    });
    this.schedule();
  }

  async retry(): Promise<void> {
    if (this.#isDisposed || this.#snapshot.status !== 'save_failed') {
      return;
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.#isDisposed) {
      return;
    }
    if (this.#activeSave) {
      await this.#activeSave;
      if (this.#snapshot.status === 'save_failed') {
        return;
      }
      if (this.#snapshot.pendingRevision > this.#snapshot.persistedRevision) {
        await this.flush();
      }
      return;
    }
    if (this.#snapshot.pendingRevision <= this.#snapshot.persistedRevision) {
      return;
    }

    const serialized = this.#source.serializeDocument();
    const revision = serialized.document.revision;
    this.setSnapshot({
      status: 'saving',
      persistedRevision: this.#snapshot.persistedRevision,
      pendingRevision: Math.max(this.#snapshot.pendingRevision, revision),
      errorMessage: null,
    });
    const save = this.#persistence
      .save({
        documentId: serialized.document.documentId,
        revision,
        expectedPreviousRevision: this.#snapshot.persistedRevision,
        schemaVersion: serialized.document.schemaVersion,
        engineAlgorithmVersion: serialized.engineAlgorithmVersion,
        payload: new TextEncoder().encode(serialized.canonicalPayload),
        durability: this.#durability,
        interruptAt: null,
      })
      .then(() => {
        const hasNewerRevision = this.#snapshot.pendingRevision > revision;
        this.setSnapshot({
          status: hasNewerRevision ? 'dirty' : 'saved',
          persistedRevision: revision,
          pendingRevision: this.#snapshot.pendingRevision,
          errorMessage: null,
        });
        if (hasNewerRevision) {
          this.schedule();
        }
      })
      .catch((error: unknown) => {
        this.setSnapshot({
          status: 'save_failed',
          persistedRevision: this.#snapshot.persistedRevision,
          pendingRevision: this.#snapshot.pendingRevision,
          errorMessage: errorMessage(error),
        });
      })
      .finally(() => {
        this.#activeSave = null;
      });
    this.#activeSave = save;
    await save;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.clearTimer();
    this.#listeners.clear();
  }

  private schedule(): void {
    this.clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#debounceMs);
  }

  private clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  private setSnapshot(snapshot: DocumentAutosaveSnapshotV1): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

async function loadRecoveryCandidates(
  store: SnapshotStoreV1,
  catalog: Awaited<ReturnType<SnapshotStoreV1['getCatalog']>> & {},
) {
  const candidates = [
    ['head', catalog.headSnapshotKey],
    ['stable', catalog.stableSnapshotKey],
    ['previous_stable', catalog.previousStableSnapshotKey],
  ] as const;
  const seen = new Set<string>();
  const loaded = [];
  for (const [source, snapshotKey] of candidates) {
    if (!snapshotKey || seen.has(snapshotKey)) {
      continue;
    }
    seen.add(snapshotKey);
    const snapshot = await store.getSnapshot(snapshotKey);
    if (snapshot?.status === 'stable') {
      loaded.push({ source, snapshot });
    }
  }
  return loaded;
}

function recoveryForSource(source: 'head' | 'stable' | 'previous_stable') {
  if (source === 'stable') {
    return 'stable_fallback' as const;
  }
  if (source === 'previous_stable') {
    return 'previous_stable_fallback' as const;
  }
  return 'head' as const;
}

function idempotentRelease(lease: DocumentLeaseResultV1): () => Promise<void> {
  let releasePromise: Promise<void> | null = null;
  return () => {
    if (lease.kind === 'readonly') {
      return Promise.resolve();
    }
    releasePromise ??= lease.release();
    return releasePromise;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
