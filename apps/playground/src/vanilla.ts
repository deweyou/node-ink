import {
  NODEINK_COLOR_PRESETS,
  NODEINK_FILL_PRESETS,
  NODEINK_STROKE_WIDTH_PRESETS,
  NODEINK_TEXT_ALIGN_PRESETS,
  NODEINK_TEXT_SIZE_PRESETS,
  fillPresetMatches,
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type EditorWebControllerV1,
} from '@nodeink-internal/editor-web';
import type { ElementStylePatchV1, FillV1, SelectionStyleV1 } from '@nodeink-internal/protocol';

import {
  exposePointerBenchmark,
  runPlaygroundPointerBenchmark,
  runPlaygroundPersistenceBenchmark,
  runPlaygroundMigrationBenchmark,
  runPlaygroundLifecycleBenchmark,
  runPlaygroundOperationBenchmark,
  releasePlaygroundLeaseBenchmark,
  runPlaygroundLeaseBenchmark,
  runPlaygroundSketchBenchmark,
  runPlaygroundScenePatchBenchmark,
  runPlaygroundSvgScaleBenchmark,
  runPlaygroundStrokeBenchmark,
  runPlaygroundTextBenchmark,
} from './benchmark-api';
import { createController } from './create-controller';
import './styles.css';

const rootElement = document.querySelector<HTMLDivElement>('#root');
if (!rootElement) {
  throw new Error('Vanilla playground root is missing');
}

rootElement.innerHTML = `
  <main class="nodeink-shell" data-nodeink-host="vanilla">
    <header class="nodeink-topbar">
      <div>
        <span class="nodeink-kicker">NodeInk · Phase 1B</span>
        <h1>Framework-neutral canvas</h1>
      </div>
      <div class="nodeink-topbar-actions">
        <nav class="nodeink-profile-toggle" aria-label="Rendering profile">
          <button type="button" data-action="set_render_profile" data-profile="clean">Clean</button>
          <button type="button" data-action="set_render_profile" data-profile="sketch">Sketch</button>
        </nav>
        <span class="nodeink-host-badge">Vanilla TypeScript</span>
      </div>
    </header>
    <aside class="nodeink-toolbar" aria-label="Canvas actions">
      <button type="button" data-action="set_tool_select" data-tool="select" title="Select tool (V)">Select</button>
      <button type="button" data-action="set_tool_freehand" data-tool="freehand" title="Freehand tool (P)">Draw</button>
      <button type="button" data-action="set_tool_text" data-tool="text" title="Text tool (T)">Text</button>
      <button type="button" data-action="create_rectangle">Rectangle</button>
      <button type="button" data-action="move_active">Move</button>
      <button type="button" data-action="delete_selection" data-danger="true">Delete</button>
      <button type="button" data-action="undo">Undo</button>
      <button type="button" data-action="redo">Redo</button>
    </aside>
    <section class="nodeink-stage" aria-label="Infinite canvas proof">
      <div class="nodeink-canvas" data-canvas></div>
      <nav class="nodeink-selection-actions" aria-label="Selection actions">
        <div class="nodeink-selection-action-group" role="group" aria-label="Clipboard">
          <button type="button" data-action="copy" data-selection-requires="one">Copy</button>
          <button type="button" data-action="cut" data-selection-requires="one">Cut</button>
          <button type="button" data-action="paste">Paste</button>
        </div>
        <div class="nodeink-selection-action-group" role="group" aria-label="Grouping">
          <button type="button" data-action="group" data-selection-requires="multiple">Group</button>
          <button type="button" data-action="ungroup" data-selection-requires="one">Ungroup</button>
        </div>
        <div class="nodeink-selection-action-group" role="group" aria-label="Stacking order">
          <button type="button" data-action="reorder" data-placement="front" data-selection-requires="one" title="Bring to front">Front</button>
          <button type="button" data-action="reorder" data-placement="forward" data-selection-requires="one" title="Bring forward">Forward</button>
          <button type="button" data-action="reorder" data-placement="backward" data-selection-requires="one" title="Send backward">Backward</button>
          <button type="button" data-action="reorder" data-placement="back" data-selection-requires="one" title="Send to back">Back</button>
        </div>
        <div class="nodeink-selection-action-group" role="group" aria-label="Alignment">
          <button type="button" data-action="align" data-alignment="left" data-selection-requires="multiple">Left</button>
          <button type="button" data-action="align" data-alignment="center" data-selection-requires="multiple">Center</button>
          <button type="button" data-action="align" data-alignment="right" data-selection-requires="multiple">Right</button>
          <button type="button" data-action="align" data-alignment="top" data-selection-requires="multiple">Top</button>
          <button type="button" data-action="align" data-alignment="middle" data-selection-requires="multiple">Middle</button>
          <button type="button" data-action="align" data-alignment="bottom" data-selection-requires="multiple">Bottom</button>
        </div>
      </nav>
      <aside class="nodeink-style-panel" aria-label="Selection style" data-style-panel hidden></aside>
      <nav class="nodeink-zoom-controls" aria-label="Canvas view controls">
        <button type="button" data-action="zoom_out" aria-label="Zoom out" title="缩小">−</button>
        <button type="button" data-action="reset_camera" data-zoom title="回正并适应全部内容">100%</button>
        <button type="button" data-action="zoom_in" aria-label="Zoom in" title="放大">+</button>
      </nav>
      <output class="nodeink-status" aria-live="polite" data-status></output>
      <p class="nodeink-notice" role="status" data-notice hidden></p>
      <p class="nodeink-error" role="alert" data-error hidden></p>
    </section>
  </main>
`;

const canvas = requireElement<HTMLElement>(rootElement, '[data-canvas]');
const status = requireElement<HTMLOutputElement>(rootElement, '[data-status]');
const notice = requireElement<HTMLParagraphElement>(rootElement, '[data-notice]');
const error = requireElement<HTMLParagraphElement>(rootElement, '[data-error]');
const controller = await createController();
exposePointerBenchmark(controller);

const renderControls = () => renderSnapshot(rootElement, status, notice, error, controller);
controller.subscribe(renderControls);
await controller.mount(canvas);
renderControls();

const benchmark = new URLSearchParams(window.location.search).get('benchmark');
if (
  benchmark === 'pointer' ||
  benchmark === 'stroke' ||
  benchmark === 'sketch' ||
  benchmark === 'text' ||
  benchmark === 'scene-patch' ||
  benchmark === 'svg-scale' ||
  benchmark === 'persistence' ||
  benchmark === 'migration' ||
  benchmark === 'lease' ||
  benchmark === 'operation' ||
  benchmark === 'lifecycle'
) {
  const benchmarkOutput = document.createElement('pre');
  benchmarkOutput.className = 'nodeink-benchmark';
  benchmarkOutput.dataset.benchmarkResults = benchmark;
  benchmarkOutput.textContent = `Running ${benchmark} benchmark…`;
  requireElement<HTMLElement>(rootElement, '.nodeink-stage').append(benchmarkOutput);
  try {
    const benchmarkResult =
      benchmark === 'pointer'
        ? await runPlaygroundPointerBenchmark(controller)
        : benchmark === 'stroke'
          ? await runPlaygroundStrokeBenchmark(controller)
          : benchmark === 'sketch'
            ? await runPlaygroundSketchBenchmark()
            : benchmark === 'text'
              ? await runPlaygroundTextBenchmark()
              : benchmark === 'scene-patch'
                ? await runPlaygroundScenePatchBenchmark()
                : benchmark === 'svg-scale'
                  ? await runPlaygroundSvgScaleBenchmark()
                  : benchmark === 'persistence'
                    ? await runPlaygroundPersistenceBenchmark()
                    : benchmark === 'migration'
                      ? await runPlaygroundMigrationBenchmark()
                      : benchmark === 'operation'
                        ? await runPlaygroundOperationBenchmark()
                        : benchmark === 'lifecycle'
                          ? await runPlaygroundLifecycleBenchmark()
                          : await runPlaygroundLeaseBenchmark(
                              new URLSearchParams(window.location.search).get('role') ===
                                'contender'
                                ? 'contender'
                                : 'writer',
                              new URLSearchParams(window.location.search).get('document') ??
                                'lease-fixture',
                            );
    benchmarkOutput.textContent = JSON.stringify(benchmarkResult, null, 2);
    if (benchmark === 'lease' && benchmarkResult.engineAlgorithmVersion === 'phase0-s9') {
      const leaseResult = benchmarkResult;
      if (leaseResult.state === 'held') {
        const releaseButton = document.createElement('button');
        releaseButton.type = 'button';
        releaseButton.dataset.releaseLease = 'true';
        releaseButton.textContent = 'Release benchmark lease';
        releaseButton.addEventListener('click', async () => {
          releaseButton.disabled = true;
          const releaseMs = await releasePlaygroundLeaseBenchmark();
          benchmarkOutput.textContent = JSON.stringify(
            { ...leaseResult, state: 'released', releaseMs },
            null,
            2,
          );
        });
        requireElement<HTMLElement>(rootElement, '.nodeink-stage').append(releaseButton);
      }
    }
  } catch (benchmarkError) {
    benchmarkOutput.textContent = `${benchmark} benchmark failed: ${String(benchmarkError)}`;
  }
}

rootElement.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
  if (!button) {
    return;
  }
  const action = button.dataset.action;
  if (action === 'create_rectangle') {
    void controller.dispatch({ type: 'create_rectangle' });
  } else if (action === 'set_tool_select') {
    void controller.dispatch({ type: 'set_tool', tool: 'select' });
  } else if (action === 'set_tool_freehand') {
    void controller.dispatch({ type: 'set_tool', tool: 'freehand' });
  } else if (action === 'set_tool_text') {
    void controller.dispatch({ type: 'set_tool', tool: 'text' });
  } else if (action === 'move_active') {
    void controller.dispatch({ type: 'move_active', delta: { x: 32, y: 16 } });
  } else if (action === 'delete_selection') {
    void controller.dispatch({ type: 'delete_selection' });
  } else if (
    action === 'copy' ||
    action === 'cut' ||
    action === 'paste' ||
    action === 'group' ||
    action === 'ungroup'
  ) {
    void controller.dispatch({ type: action });
  } else if (action === 'reorder') {
    const placement = button.dataset.placement;
    if (
      placement === 'front' ||
      placement === 'forward' ||
      placement === 'backward' ||
      placement === 'back'
    ) {
      void controller.dispatch({ type: 'reorder', placement });
    }
  } else if (action === 'align') {
    const alignment = button.dataset.alignment;
    if (
      alignment === 'left' ||
      alignment === 'center' ||
      alignment === 'right' ||
      alignment === 'top' ||
      alignment === 'middle' ||
      alignment === 'bottom'
    ) {
      void controller.dispatch({ type: 'align', alignment });
    }
  } else if (action === 'undo') {
    void controller.dispatch({ type: 'undo' });
  } else if (action === 'redo') {
    void controller.dispatch({ type: 'redo' });
  } else if (action === 'set_render_profile') {
    const profile = button.dataset.profile;
    if (profile === 'clean' || profile === 'sketch') {
      void controller.dispatch({ type: 'set_render_profile', profile });
    }
  } else if (action === 'update_selection_style') {
    const patch = stylePatchFromButton(button, controller.getSnapshot().selectionStyle);
    if (patch) {
      void controller.dispatch({ type: 'update_selection_style', patch });
    }
  } else if (action === 'retry_save') {
    void controller.dispatch({ type: 'retry_save' });
  } else if (action === 'retry_camera_save') {
    void controller.dispatch({ type: 'retry_camera_save' });
  } else if (action === 'zoom_out' || action === 'zoom_in' || action === 'reset_camera') {
    void controller.dispatch({ type: action });
  }
});

window.addEventListener('pagehide', () => controller.dispose(), { once: true });

function renderSnapshot(
  root: HTMLElement,
  statusElement: HTMLOutputElement,
  noticeElement: HTMLParagraphElement,
  errorElement: HTMLParagraphElement,
  editor: EditorWebControllerV1,
): void {
  const snapshot = editor.getSnapshot();
  const persistence = getEditorPersistencePresentation(snapshot);
  const selectionCount = snapshot.selectedElementIds.length;
  statusElement.innerHTML = `
    <span data-save-status="${snapshot.saveStatus}">${persistence.statusLabel}</span>
    <span>${snapshot.status}</span>
    <span>document r${snapshot.documentRevision}</span>
    <span>${snapshot.elementCount} elements</span>
    <span>${selectionCount === 0 ? 'No selection' : `${selectionCount} selected`}</span>
    <span>${snapshot.activeTool} tool</span>
  `;
  noticeElement.hidden = !persistence.notice;
  noticeElement.textContent = persistence.notice;
  const visibleError =
    snapshot.errorMessage ?? snapshot.saveErrorMessage ?? snapshot.cameraSaveErrorMessage;
  errorElement.hidden = !visibleError;
  errorElement.replaceChildren();
  if (visibleError) {
    const message = document.createElement('span');
    message.textContent = snapshot.saveErrorMessage
      ? `保存失败：${visibleError}`
      : snapshot.cameraSaveErrorMessage
        ? `视图位置保存失败：${visibleError}`
        : visibleError;
    errorElement.append(message);
    const retryAction = snapshot.errorMessage
      ? null
      : snapshot.saveErrorMessage
        ? 'retry_save'
        : snapshot.cameraSaveErrorMessage
          ? 'retry_camera_save'
          : null;
    if (retryAction) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.dataset.action = retryAction;
      retry.textContent = '重试';
      errorElement.append(retry);
    }
  }
  const isEditable = snapshot.status === 'ready' && snapshot.documentAccess === 'writer';
  const camera = getEditorCameraPresentation(snapshot);
  setDisabled(root, 'set_tool_select', !isEditable);
  setDisabled(root, 'set_tool_freehand', !isEditable);
  setDisabled(root, 'set_tool_text', !isEditable);
  setPressed(root, 'select', snapshot.activeTool === 'select');
  setPressed(root, 'freehand', snapshot.activeTool === 'freehand');
  setPressed(root, 'text', snapshot.activeTool === 'text');
  setDisabled(root, 'create_rectangle', !isEditable);
  setDisabled(root, 'move_active', !isEditable || selectionCount === 0);
  setDisabled(root, 'delete_selection', !isEditable || selectionCount === 0);
  setDisabled(root, 'paste', !isEditable);
  root.querySelectorAll<HTMLButtonElement>('[data-selection-requires]').forEach((button) => {
    const minimum = button.dataset.selectionRequires === 'multiple' ? 2 : 1;
    button.disabled = !isEditable || selectionCount < minimum;
  });
  setDisabled(root, 'undo', !isEditable || !snapshot.canUndo);
  setDisabled(root, 'redo', !isEditable || !snapshot.canRedo);
  root.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach((button) => {
    button.disabled = !isEditable;
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.profile === snapshot.renderProfile.kind),
    );
  });
  renderStylePanel(
    requireElement<HTMLElement>(root, '[data-style-panel]'),
    isEditable ? snapshot.selectionStyle : null,
  );
  setDisabled(root, 'zoom_out', snapshot.status !== 'ready');
  setDisabled(root, 'reset_camera', snapshot.status !== 'ready');
  setDisabled(root, 'zoom_in', snapshot.status !== 'ready');
  const zoom = root.querySelector<HTMLButtonElement>('[data-zoom]');
  if (zoom) {
    zoom.textContent = camera.zoomLabel;
    zoom.title = camera.fitContentTitle;
    zoom.ariaLabel = camera.fitContentAriaLabel;
    zoom.dataset.cameraSaveStatus = snapshot.cameraSaveStatus;
  }
}

function renderStylePanel(panel: HTMLElement, style: SelectionStyleV1 | null): void {
  panel.hidden = !style;
  if (!style) {
    panel.replaceChildren();
    return;
  }
  const kindLabel =
    style.kind === 'rect' ? 'Rectangle' : style.kind === 'stroke' ? 'Stroke' : 'Text';
  const groups =
    style.kind === 'rect'
      ? [
          styleGroupMarkup(
            'Fill',
            NODEINK_FILL_PRESETS.map((preset) =>
              swatchMarkup(
                `Fill ${preset.label}`,
                preset.value,
                fillPresetMatches(style.fill, preset.value),
                'fill',
                preset.id,
              ),
            ).join(''),
          ),
          colorGroupMarkup('Stroke', style.stroke, 'stroke'),
          widthGroupMarkup(style.strokeWidth),
        ]
      : style.kind === 'stroke'
        ? [colorGroupMarkup('Color', style.stroke, 'stroke'), widthGroupMarkup(style.strokeWidth)]
        : [
            colorGroupMarkup('Color', style.color, 'color'),
            styleGroupMarkup(
              'Size',
              NODEINK_TEXT_SIZE_PRESETS.map(
                (fontSize) =>
                  `<button type="button" data-action="update_selection_style" data-style-property="fontSize" data-style-value="${fontSize}" aria-pressed="${String(style.fontSize === fontSize)}">${fontSize}</button>`,
              ).join(''),
            ),
            styleGroupMarkup(
              'Align',
              NODEINK_TEXT_ALIGN_PRESETS.map(
                (preset) =>
                  `<button type="button" data-action="update_selection_style" data-style-property="textAlign" data-style-value="${preset.value}" aria-pressed="${String(style.textAlign === preset.value)}">${preset.label}</button>`,
              ).join(''),
            ),
          ];
  panel.innerHTML = `<h2 class="nodeink-style-title">Style <span>${kindLabel}</span></h2>${groups.join('')}`;
}

function colorGroupMarkup(label: string, value: string, property: 'stroke' | 'color'): string {
  return styleGroupMarkup(
    label,
    NODEINK_COLOR_PRESETS.map((preset) =>
      swatchMarkup(
        `${label} ${preset.label}`,
        { kind: 'solid', color: preset.value },
        value === preset.value,
        property,
        preset.id,
      ),
    ).join(''),
  );
}

function widthGroupMarkup(value: number): string {
  return styleGroupMarkup(
    'Width',
    NODEINK_STROKE_WIDTH_PRESETS.map(
      (strokeWidth) =>
        `<button type="button" data-action="update_selection_style" data-style-property="strokeWidth" data-style-value="${strokeWidth}" aria-pressed="${String(value === strokeWidth)}">${strokeWidth}px</button>`,
    ).join(''),
  );
}

function styleGroupMarkup(label: string, options: string): string {
  return `<fieldset class="nodeink-style-group"><legend>${label}</legend><div class="nodeink-style-options">${options}</div></fieldset>`;
}

function swatchMarkup(
  label: string,
  fill: FillV1,
  pressed: boolean,
  property: 'fill' | 'stroke' | 'color',
  value: string,
): string {
  const style = fill.kind === 'solid' ? ` style="--swatch-color:${fill.color}"` : '';
  const none = fill.kind === 'none' ? ' data-none="true"' : '';
  return `<button type="button" class="nodeink-swatch" data-action="update_selection_style" data-style-property="${property}" data-style-value="${value}" aria-label="${label}" title="${label}" aria-pressed="${String(pressed)}"${none}${style}></button>`;
}

function stylePatchFromButton(
  button: HTMLButtonElement,
  style: SelectionStyleV1 | null,
): ElementStylePatchV1 | null {
  if (!style) {
    return null;
  }
  const property = button.dataset.styleProperty;
  const value = button.dataset.styleValue;
  if (!property || !value) {
    return null;
  }
  if (style.kind === 'rect' && property === 'fill') {
    const fill = NODEINK_FILL_PRESETS.find((preset) => preset.id === value)?.value;
    return fill ? { kind: 'rect', fill } : null;
  }
  if ((style.kind === 'rect' || style.kind === 'stroke') && property === 'stroke') {
    const stroke = NODEINK_COLOR_PRESETS.find((preset) => preset.id === value)?.value;
    return stroke ? { kind: style.kind, stroke } : null;
  }
  if ((style.kind === 'rect' || style.kind === 'stroke') && property === 'strokeWidth') {
    const strokeWidth = Number(value);
    return NODEINK_STROKE_WIDTH_PRESETS.includes(strokeWidth as 1 | 2 | 4)
      ? { kind: style.kind, strokeWidth }
      : null;
  }
  if (style.kind === 'text' && property === 'color') {
    const color = NODEINK_COLOR_PRESETS.find((preset) => preset.id === value)?.value;
    return color ? { kind: 'text', color } : null;
  }
  if (style.kind === 'text' && property === 'fontSize') {
    const fontSize = Number(value);
    return NODEINK_TEXT_SIZE_PRESETS.includes(fontSize as 18 | 24 | 32)
      ? { kind: 'text', fontSize }
      : null;
  }
  if (style.kind === 'text' && property === 'textAlign') {
    const textAlign = NODEINK_TEXT_ALIGN_PRESETS.find((preset) => preset.value === value)?.value;
    return textAlign ? { kind: 'text', textAlign } : null;
  }
  return null;
}

function setPressed(root: HTMLElement, tool: string, pressed: boolean): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
  button?.setAttribute('aria-pressed', String(pressed));
}

function setDisabled(root: HTMLElement, action: string, disabled: boolean): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (button) {
    button.disabled = disabled;
  }
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) {
    throw new Error(`Missing playground element: ${selector}`);
  }
  return element;
}
