import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

import {
  NODEINK_COLOR_PRESETS,
  NODEINK_FILL_PRESETS,
  NODEINK_STROKE_WIDTH_PRESETS,
  NODEINK_TEXT_ALIGN_PRESETS,
  NODEINK_TEXT_SIZE_PRESETS,
  fillPresetMatches,
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type ElementStylePatchV1,
  type EditorActionV1,
  type EditorWebControllerV1,
  type SelectionStyleV1,
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
  const selectionCount = snapshot.selectedElementIds.length;
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
          <span className="nodeink-kicker">NodeInk · Phase 1B</span>
          <h1>Framework-neutral canvas</h1>
        </div>
        <div className="nodeink-topbar-actions">
          <span className="nodeink-host-badge">{hostLabel}</span>
        </div>
      </header>
      <aside className="nodeink-toolbar" aria-label="Canvas actions">
        <button
          type="button"
          data-tool="select"
          aria-pressed={snapshot.activeTool === 'select'}
          disabled={!isEditable}
          title="Select tool (V)"
          onClick={() => void controller.dispatch({ type: 'set_tool', tool: 'select' })}
        >
          Select
        </button>
        <button
          type="button"
          data-tool="freehand"
          aria-pressed={snapshot.activeTool === 'freehand'}
          disabled={!isEditable}
          title="Freehand tool (P)"
          onClick={() => void controller.dispatch({ type: 'set_tool', tool: 'freehand' })}
        >
          Draw
        </button>
        <button
          type="button"
          data-tool="text"
          aria-pressed={snapshot.activeTool === 'text'}
          disabled={!isEditable}
          title="Text tool (T)"
          onClick={() => void controller.dispatch({ type: 'set_tool', tool: 'text' })}
        >
          Text
        </button>
        <button
          type="button"
          disabled={!isEditable}
          onClick={() => void controller.dispatch({ type: 'create_rectangle' })}
        >
          Rectangle
        </button>
        <button
          type="button"
          disabled={!isEditable || selectionCount === 0}
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
          data-danger="true"
          disabled={!isEditable || selectionCount === 0}
          onClick={() => void controller.dispatch({ type: 'delete_selection' })}
        >
          Delete
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
        <SelectionActionControls
          isEditable={isEditable}
          selectionCount={selectionCount}
          dispatch={(action) => void controller.dispatch(action)}
        />
        {isEditable && snapshot.selectionStyle ? (
          <SelectionStylePanel
            style={snapshot.selectionStyle}
            dispatch={(patch) =>
              void controller.dispatch({ type: 'update_selection_style', patch })
            }
          />
        ) : null}
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
          <span>{selectionCount === 0 ? 'No selection' : `${selectionCount} selected`}</span>
          <span>{snapshot.activeTool} tool</span>
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

function SelectionActionControls({
  isEditable,
  selectionCount,
  dispatch,
}: {
  isEditable: boolean;
  selectionCount: number;
  dispatch: (action: EditorActionV1) => void;
}) {
  const hasSelection = selectionCount > 0;
  const hasMultiple = selectionCount > 1;
  const selectionDisabled = !isEditable || !hasSelection;
  const multipleDisabled = !isEditable || !hasMultiple;

  return (
    <nav className="nodeink-selection-actions" aria-label="Selection actions">
      <div className="nodeink-selection-action-group" role="group" aria-label="Clipboard">
        <button
          type="button"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'copy' })}
        >
          Copy
        </button>
        <button
          type="button"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'cut' })}
        >
          Cut
        </button>
        <button type="button" disabled={!isEditable} onClick={() => dispatch({ type: 'paste' })}>
          Paste
        </button>
      </div>
      <div className="nodeink-selection-action-group" role="group" aria-label="Grouping">
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'group' })}
        >
          Group
        </button>
        <button
          type="button"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'ungroup' })}
        >
          Ungroup
        </button>
      </div>
      <div className="nodeink-selection-action-group" role="group" aria-label="Stacking order">
        <button
          type="button"
          title="Bring to front"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'reorder', placement: 'front' })}
        >
          Front
        </button>
        <button
          type="button"
          title="Bring forward"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'reorder', placement: 'forward' })}
        >
          Forward
        </button>
        <button
          type="button"
          title="Send backward"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'reorder', placement: 'backward' })}
        >
          Backward
        </button>
        <button
          type="button"
          title="Send to back"
          disabled={selectionDisabled}
          onClick={() => dispatch({ type: 'reorder', placement: 'back' })}
        >
          Back
        </button>
      </div>
      <div className="nodeink-selection-action-group" role="group" aria-label="Alignment">
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'left' })}
        >
          Left
        </button>
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'center' })}
        >
          Center
        </button>
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'right' })}
        >
          Right
        </button>
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'top' })}
        >
          Top
        </button>
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'middle' })}
        >
          Middle
        </button>
        <button
          type="button"
          disabled={multipleDisabled}
          onClick={() => dispatch({ type: 'align', alignment: 'bottom' })}
        >
          Bottom
        </button>
      </div>
    </nav>
  );
}

function SelectionStylePanel({
  style,
  dispatch,
}: {
  style: SelectionStyleV1;
  dispatch: (patch: ElementStylePatchV1) => void;
}) {
  return (
    <aside className="nodeink-style-panel" aria-label="Selection style">
      <h2 className="nodeink-style-title">
        Style{' '}
        <span>
          {style.kind === 'rect' ? 'Rectangle' : style.kind === 'stroke' ? 'Stroke' : 'Text'}
        </span>
      </h2>
      {style.kind === 'rect' ? (
        <>
          <StyleGroup label="Fill">
            {NODEINK_FILL_PRESETS.map((preset) => (
              <SwatchButton
                key={preset.id}
                label={`Fill ${preset.label}`}
                color={preset.value.kind === 'solid' ? preset.value.color : null}
                pressed={fillPresetMatches(style.fill, preset.value)}
                onClick={() => dispatch({ kind: 'rect', fill: preset.value })}
              />
            ))}
          </StyleGroup>
          <ColorGroup
            label="Stroke"
            value={style.stroke}
            onChange={(stroke) => dispatch({ kind: 'rect', stroke })}
          />
          <WidthGroup
            value={style.strokeWidth}
            onChange={(strokeWidth) => dispatch({ kind: 'rect', strokeWidth })}
          />
        </>
      ) : style.kind === 'stroke' ? (
        <>
          <ColorGroup
            label="Color"
            value={style.stroke}
            onChange={(stroke) => dispatch({ kind: 'stroke', stroke })}
          />
          <WidthGroup
            value={style.strokeWidth}
            onChange={(strokeWidth) => dispatch({ kind: 'stroke', strokeWidth })}
          />
        </>
      ) : (
        <>
          <ColorGroup
            label="Color"
            value={style.color}
            onChange={(color) => dispatch({ kind: 'text', color })}
          />
          <StyleGroup label="Size">
            {NODEINK_TEXT_SIZE_PRESETS.map((fontSize) => (
              <button
                key={fontSize}
                type="button"
                aria-pressed={style.fontSize === fontSize}
                onClick={() => dispatch({ kind: 'text', fontSize })}
              >
                {fontSize}
              </button>
            ))}
          </StyleGroup>
          <StyleGroup label="Align">
            {NODEINK_TEXT_ALIGN_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                aria-pressed={style.textAlign === preset.value}
                onClick={() => dispatch({ kind: 'text', textAlign: preset.value })}
              >
                {preset.label}
              </button>
            ))}
          </StyleGroup>
        </>
      )}
    </aside>
  );
}

function ColorGroup({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (color: string) => void;
}) {
  return (
    <StyleGroup label={label}>
      {NODEINK_COLOR_PRESETS.map((preset) => (
        <SwatchButton
          key={preset.id}
          label={`${label} ${preset.label}`}
          color={preset.value}
          pressed={value === preset.value}
          onClick={() => onChange(preset.value)}
        />
      ))}
    </StyleGroup>
  );
}

function WidthGroup({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <StyleGroup label="Width">
      {NODEINK_STROKE_WIDTH_PRESETS.map((strokeWidth) => (
        <button
          key={strokeWidth}
          type="button"
          aria-pressed={value === strokeWidth}
          onClick={() => onChange(strokeWidth)}
        >
          {strokeWidth}px
        </button>
      ))}
    </StyleGroup>
  );
}

function StyleGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="nodeink-style-group">
      <legend>{label}</legend>
      <div className="nodeink-style-options">{children}</div>
    </fieldset>
  );
}

function SwatchButton({
  label,
  color,
  pressed,
  onClick,
}: {
  label: string;
  color: string | null;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="nodeink-swatch"
      data-none={color === null ? 'true' : undefined}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      style={color ? ({ '--swatch-color': color } as CSSProperties) : undefined}
      onClick={onClick}
    />
  );
}
