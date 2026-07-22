import { EditorWebController } from '@nodeink-internal/editor-web';
import { createWasmEngine } from '@nodeink-internal/engine-web';
import {
  AtomicSnapshotPersistenceV1,
  IndexedDbSnapshotStoreV1,
  WebLockDocumentLeaseV1,
  type LockManagerPortV1,
} from '@nodeink-internal/persistence-web';
import {
  DocumentAutosaveCoordinatorV1,
  openLocalDocumentV1,
} from '@nodeink-internal/persistence-web/local-document';
import { createBlankDocument } from '@nodeink-internal/protocol';
import { SvgRenderer } from '@nodeink-internal/renderer-svg';

const localDocumentId = 'nodeink-local-document';
const localDatabaseName = 'nodeink-playground-v1';

export async function createController() {
  let store: IndexedDbSnapshotStoreV1 | null = null;
  let migrationEngine: Awaited<ReturnType<typeof createWasmEngine>> | null = null;
  try {
    store = await IndexedDbSnapshotStoreV1.open(localDatabaseName);
    const durability = store.probeStrictDurability() ? 'strict' : 'relaxed';
    migrationEngine = await createWasmEngine(createBlankDocument('nodeink-migration-runtime'));
    const openMigrationEngine = migrationEngine;
    const persistence = new AtomicSnapshotPersistenceV1({
      store,
      validatePayload: async (payload, snapshotSchemaVersion) => {
        const attempt = await openMigrationEngine.migrateDocumentPayload(
          new TextDecoder().decode(payload),
        );
        if (
          !attempt.result ||
          attempt.result.migrated ||
          attempt.result.document.schemaVersion !== snapshotSchemaVersion
        ) {
          throw new Error(attempt.report?.message ?? 'Snapshot validation failed');
        }
      },
    });
    const lease = new WebLockDocumentLeaseV1(
      typeof navigator.locks === 'undefined'
        ? undefined
        : (navigator.locks as unknown as LockManagerPortV1),
    );
    const opened = await openLocalDocumentV1({
      documentId: localDocumentId,
      store,
      persistence,
      lease,
      migrationPort: migrationEngine,
      durability,
    });
    const isDiagnostic = opened.kind === 'readonly_diagnostic';
    const document = isDiagnostic ? createBlankDocument(localDocumentId) : opened.document;
    const engine = await createWasmEngine(document);
    const documentAccess = isDiagnostic ? 'readonly' : opened.access;
    const persistenceCoordinator =
      documentAccess === 'writer' && !isDiagnostic
        ? new DocumentAutosaveCoordinatorV1({
            source: engine,
            persistence,
            persistedRevision: opened.persistedRevision,
            durability,
          })
        : undefined;
    const openedRelease = opened.release;
    const openStore = store;
    store = null;
    migrationEngine = null;
    return new EditorWebController({
      engine,
      renderer: new SvgRenderer(),
      ...(persistenceCoordinator ? { persistence: persistenceCoordinator } : {}),
      documentAccess,
      readonlyReason: isDiagnostic ? 'readonly_diagnostic' : opened.readonlyReason,
      recovery: opened.recovery,
      onDispose: async () => {
        await openedRelease();
        openMigrationEngine.dispose();
        openStore.close();
      },
    });
  } catch (error) {
    migrationEngine?.dispose();
    store?.close();
    throw error;
  }
}
