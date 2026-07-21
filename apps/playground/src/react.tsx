import { createRoot } from 'react-dom/client';

import { NodeInkEditor } from '@nodeink-internal/editor-react';

import { createController } from './create-controller';
import './styles.css';

const rootElement = document.querySelector<HTMLDivElement>('#root');
if (!rootElement) {
  throw new Error('React playground root is missing');
}

const controller = await createController();
createRoot(rootElement).render(<NodeInkEditor controller={controller} />);
