import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type EditorWebControllerV1,
} from '@nodeink-internal/editor-web';

export interface NodeInkEditorProps {
  controller: EditorWebControllerV1;
  hostLabel?: string;
}

export function NodeInkEditor({ controller, hostLabel = 'React adapter' }: NodeInkEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getSnapshot(),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    void controller.mount(canvas).catch(() => undefined);
    return () => controller.dispose();
  }, [controller]);

  const isReady = snapshot.status === 'ready';
  const isEditable = isReady && snapshot.documentAccess === 'writer';
  const camera = getEditorCameraPresentation(snapshot);
  const persistence = getEditorPersistencePresentation(snapshot);
  const visibleError =
    snapshot.errorMessage ?? snapshot.saveErrorMessage ?? snapshot.cameraSaveErrorMessage;
  const retryAction = snapshot.errorMessage
    ? null
    : snapshot.saveErrorMessage
      ? 'retry_save'
      : snapshot.cameraSaveErrorMessage
        ? 'retry_camera_save'
        : null;
  return (
    <main className="nodeink-shell" data-nodeink-host="react">
      <header className="nodeink-topbar">
        <div>
          <span className="nodeink-kicker">NodeInk · Phase 1A</span>
          <h1>Framework-neutral canvas</h1>
        </div>
        <span className="nodeink-host-badge">{hostLabel}</span>
      </header>
      <aside className="nodeink-toolbar" aria-label="Canvas actions">
        <button
          type="button"
          disabled={!isEditable}
          onClick={() => void controller.dispatch({ type: 'create_rectangle' })}
        >
          Rectangle
        </button>
        <button
          type="button"
          disabled={!isEditable || !snapshot.activeElementId}
          onClick={() =>
            void controller.dispatch({
              type: 'move_active',
              delta: { x: 32, y: 16 },
            })
          }
        >
          Move
        </button>
        <button
          type="button"
          disabled={!isEditable || !snapshot.canUndo}
          onClick={() => void controller.dispatch({ type: 'undo' })}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!isEditable || !snapshot.canRedo}
          onClick={() => void controller.dispatch({ type: 'redo' })}
        >
          Redo
        </button>
      </aside>
      <section className="nodeink-stage" aria-label="Infinite canvas proof">
        <div ref={canvasRef} className="nodeink-canvas" />
        <nav className="nodeink-zoom-controls" aria-label="Canvas view controls">
          <button
            type="button"
            disabled={!isReady}
            aria-label="Zoom out"
            title="缩小"
            onClick={() => void controller.dispatch({ type: 'zoom_out' })}
          >
            −
          </button>
          <button
            type="button"
            disabled={!isReady}
            data-camera-save-status={snapshot.cameraSaveStatus}
            aria-label={camera.fitContentAriaLabel}
            title={camera.fitContentTitle}
            onClick={() => void controller.dispatch({ type: 'reset_camera' })}
          >
            {camera.zoomLabel}
          </button>
          <button
            type="button"
            disabled={!isReady}
            aria-label="Zoom in"
            title="放大"
            onClick={() => void controller.dispatch({ type: 'zoom_in' })}
          >
            +
          </button>
        </nav>
        <output className="nodeink-status" aria-live="polite">
          <span data-save-status={snapshot.saveStatus}>{persistence.statusLabel}</span>
          <span>{snapshot.status}</span>
          <span>document r{snapshot.documentRevision}</span>
          <span>{snapshot.elementCount} elements</span>
        </output>
        {persistence.notice ? (
          <p className="nodeink-notice" role="status">
            {persistence.notice}
          </p>
        ) : null}
        {visibleError ? (
          <p className="nodeink-error" role="alert">
            <span>
              {snapshot.saveErrorMessage
                ? `保存失败：${visibleError}`
                : snapshot.cameraSaveErrorMessage
                  ? `视图位置保存失败：${visibleError}`
                  : visibleError}
            </span>
            {retryAction ? (
              <button type="button" onClick={() => void controller.dispatch({ type: retryAction })}>
                重试
              </button>
            ) : null}
          </p>
        ) : null}
      </section>
    </main>
  );
}
