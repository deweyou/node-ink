import type { EditorWebControllerV1 } from '@nodeink-internal/editor-web';

import {
  exposePointerBenchmark,
  runPlaygroundPointerBenchmark,
  runPlaygroundPersistenceBenchmark,
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
        <span class="nodeink-kicker">NodeInk · Phase 0</span>
        <h1>Framework-neutral canvas</h1>
      </div>
      <span class="nodeink-host-badge">Vanilla TypeScript</span>
    </header>
    <aside class="nodeink-toolbar" aria-label="Canvas actions">
      <button type="button" data-action="create_rectangle">Rectangle</button>
      <button type="button" data-action="move_active">Move</button>
      <button type="button" data-action="undo">Undo</button>
      <button type="button" data-action="redo">Redo</button>
    </aside>
    <section class="nodeink-stage" aria-label="Infinite canvas proof">
      <div class="nodeink-canvas" data-canvas></div>
      <output class="nodeink-status" aria-live="polite" data-status></output>
      <p class="nodeink-error" role="alert" data-error hidden></p>
    </section>
  </main>
`;

const canvas = requireElement<HTMLElement>(rootElement, '[data-canvas]');
const status = requireElement<HTMLOutputElement>(rootElement, '[data-status]');
const error = requireElement<HTMLParagraphElement>(rootElement, '[data-error]');
const controller = await createController();
exposePointerBenchmark(controller);

const renderControls = () => renderSnapshot(rootElement, status, error, controller);
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
  benchmark === 'persistence'
) {
  const benchmarkOutput = document.createElement('pre');
  benchmarkOutput.className = 'nodeink-benchmark';
  benchmarkOutput.dataset.benchmarkResults = benchmark;
  benchmarkOutput.textContent = `Running ${benchmark} benchmark…`;
  requireElement<HTMLElement>(rootElement, '.nodeink-stage').append(benchmarkOutput);
  try {
    benchmarkOutput.textContent = JSON.stringify(
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
                  : await runPlaygroundPersistenceBenchmark(),
      null,
      2,
    );
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
  } else if (action === 'move_active') {
    void controller.dispatch({ type: 'move_active', delta: { x: 32, y: 16 } });
  } else if (action === 'undo') {
    void controller.dispatch({ type: 'undo' });
  } else if (action === 'redo') {
    void controller.dispatch({ type: 'redo' });
  }
});

window.addEventListener('pagehide', () => controller.dispose(), { once: true });

function renderSnapshot(
  root: HTMLElement,
  statusElement: HTMLOutputElement,
  errorElement: HTMLParagraphElement,
  editor: EditorWebControllerV1,
): void {
  const snapshot = editor.getSnapshot();
  statusElement.innerHTML = `
    <span>${snapshot.status}</span>
    <span>document r${snapshot.documentRevision}</span>
    <span>${snapshot.elementCount} elements</span>
  `;
  errorElement.hidden = !snapshot.errorMessage;
  errorElement.textContent = snapshot.errorMessage;
  setDisabled(root, 'create_rectangle', snapshot.status !== 'ready');
  setDisabled(root, 'move_active', snapshot.status !== 'ready' || !snapshot.activeElementId);
  setDisabled(root, 'undo', !snapshot.canUndo);
  setDisabled(root, 'redo', !snapshot.canRedo);
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
