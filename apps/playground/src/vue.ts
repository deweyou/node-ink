import { createApp } from 'vue';

import { NodeInkEditor } from '@nodeink-internal/editor-vue';

import { exposePointerBenchmark } from './benchmark-api';
import { createController } from './create-controller';
import './styles.css';

const rootElement = document.querySelector<HTMLDivElement>('#root');
if (!rootElement) {
  throw new Error('Vue playground root is missing');
}

const controller = await createController();
exposePointerBenchmark(controller);
const app = createApp(NodeInkEditor, { controller });
app.mount(rootElement);
window.addEventListener('pagehide', () => app.unmount(), { once: true });
