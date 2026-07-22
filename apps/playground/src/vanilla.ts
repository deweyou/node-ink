import {
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type EditorWebControllerV1,
} from '@nodeink-internal/editor-web';

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
        <span class="nodeink-kicker">NodeInk · Phase 1A</span>
        <h1>Framework-neutral canvas</h1>
      </div>
      <span class="nodeink-host-badge">Vanilla TypeScript</span>
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
  } else if (action === 'undo') {
    void controller.dispatch({ type: 'undo' });
  } else if (action === 'redo') {
    void controller.dispatch({ type: 'redo' });
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
  statusElement.innerHTML = `
    <span data-save-status="${snapshot.saveStatus}">${persistence.statusLabel}</span>
    <span>${snapshot.status}</span>
    <span>document r${snapshot.documentRevision}</span>
    <span>${snapshot.elementCount} elements</span>
    <span>${snapshot.activeElementId ? '1 selected' : 'No selection'}</span>
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
  setDisabled(root, 'move_active', !isEditable || !snapshot.activeElementId);
  setDisabled(root, 'delete_selection', !isEditable || !snapshot.activeElementId);
  setDisabled(root, 'undo', !isEditable || !snapshot.canUndo);
  setDisabled(root, 'redo', !isEditable || !snapshot.canRedo);
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
