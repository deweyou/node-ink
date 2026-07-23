import { EditorWebController, NODEINK_CANVAS_FONT_FAMILY } from '@nodeink-internal/editor-web';
import { createWasmEngine } from '@nodeink-internal/engine-web';
import {
  AtomicSnapshotPersistenceV1,
  IndexedDbCameraStoreV1,
  IndexedDbSnapshotStoreV1,
  WebLockDocumentLeaseV1,
  type LockManagerPortV1,
} from '@nodeink-internal/persistence-web';
import {
  DocumentTakeoverCoordinatorV1,
  type BroadcastChannelPortV1,
} from '@nodeink-internal/persistence-web/document-takeover';
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
  let cameraStore: IndexedDbCameraStoreV1 | null = null;
  let migrationEngine: Awaited<ReturnType<typeof createWasmEngine>> | null = null;
  let takeoverCoordinator: DocumentTakeoverCoordinatorV1 | null = null;
  try {
    await loadCanvasFont();
    store = await IndexedDbSnapshotStoreV1.open(localDatabaseName);
    cameraStore = await IndexedDbCameraStoreV1.open(`${localDatabaseName}-camera`);
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
    const openCameraStore = cameraStore;
    takeoverCoordinator =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new DocumentTakeoverCoordinatorV1({
            documentId: localDocumentId,
            createChannel: (name) =>
              new BroadcastChannel(name) as unknown as BroadcastChannelPortV1,
          });
    const openTakeoverCoordinator = takeoverCoordinator;
    let detachTakeoverHandler: (() => void) | null = null;
    const controller = new EditorWebController({
      engine,
      renderer: new SvgRenderer(),
      ...(persistenceCoordinator ? { persistence: persistenceCoordinator } : {}),
      cameraPersistence: openCameraStore,
      documentAccess,
      readonlyReason: isDiagnostic ? 'readonly_diagnostic' : opened.readonlyReason,
      recovery: opened.recovery,
      ...(documentAccess === 'readonly' &&
      !isDiagnostic &&
      opened.readonlyReason === 'held_elsewhere' &&
      openTakeoverCoordinator
        ? {
            requestDocumentTakeover: () => openTakeoverCoordinator.requestTakeover(),
            reloadDocument: () => window.location.reload(),
          }
        : {}),
      ...(documentAccess === 'writer' ? { onRelinquishDocument: () => openedRelease() } : {}),
      onDispose: async () => {
        detachTakeoverHandler?.();
        openTakeoverCoordinator?.dispose();
        await openedRelease();
        openMigrationEngine.dispose();
        openCameraStore.close();
        openStore.close();
      },
    });
    if (documentAccess === 'writer' && openTakeoverCoordinator) {
      detachTakeoverHandler = openTakeoverCoordinator.handleRequests(() =>
        controller.relinquishDocument(),
      );
    }
    store = null;
    cameraStore = null;
    migrationEngine = null;
    takeoverCoordinator = null;
    return controller;
  } catch (error) {
    takeoverCoordinator?.dispose();
    migrationEngine?.dispose();
    cameraStore?.close();
    store?.close();
    throw error;
  }
}

async function loadCanvasFont(): Promise<void> {
  if (!document.fonts) {
    throw new Error('This browser cannot verify the bundled canvas font');
  }
  const family = `"${NODEINK_CANVAS_FONT_FAMILY}"`;
  await Promise.all([
    document.fonts.load(`400 24px ${family}`, 'NodeInk 中文画布'),
    document.fonts.load(`500 24px ${family}`, 'NodeInk 中文画布'),
  ]);
  await document.fonts.ready;
  if (!document.fonts.check(`400 24px ${family}`, 'NodeInk 中文画布')) {
    throw new Error('The bundled NodeInk canvas font failed to load');
  }
}
