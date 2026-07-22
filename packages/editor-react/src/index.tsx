import { useEffect, useRef, useSyncExternalStore } from 'react';

import type { EditorWebControllerV1 } from '@nodeink-internal/editor-web';

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

  return (
    <main className="nodeink-shell" data-nodeink-host="react">
      <header className="nodeink-topbar">
        <div>
          <span className="nodeink-kicker">NodeInk · Phase 0</span>
          <h1>Framework-neutral canvas</h1>
        </div>
        <span className="nodeink-host-badge">{hostLabel}</span>
      </header>
      <aside className="nodeink-toolbar" aria-label="Canvas actions">
        <button
          type="button"
          disabled={!isReady}
          onClick={() => void controller.dispatch({ type: 'create_rectangle' })}
        >
          Rectangle
        </button>
        <button
          type="button"
          disabled={!isReady || !snapshot.activeElementId}
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
          disabled={!snapshot.canUndo}
          onClick={() => void controller.dispatch({ type: 'undo' })}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!snapshot.canRedo}
          onClick={() => void controller.dispatch({ type: 'redo' })}
        >
          Redo
        </button>
      </aside>
      <section className="nodeink-stage" aria-label="Infinite canvas proof">
        <div ref={canvasRef} className="nodeink-canvas" />
        <output className="nodeink-status" aria-live="polite">
          <span>{snapshot.status}</span>
          <span>document r{snapshot.documentRevision}</span>
          <span>{snapshot.elementCount} elements</span>
        </output>
        {snapshot.errorMessage ? (
          <p className="nodeink-error" role="alert">
            {snapshot.errorMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
