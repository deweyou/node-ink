import type { CameraV1, Vec2 } from '@nodeink-internal/protocol';

import { attachImeComposition } from './ime-input';
import { NODEINK_CANVAS_FONT_FAMILY, NODEINK_DEFAULT_TEXT_SIZE } from './text-font';

export { NODEINK_CANVAS_FONT_FAMILY, NODEINK_DEFAULT_TEXT_SIZE } from './text-font';

export interface TextEditorOverlayOptionsV1 {
  target: HTMLElement;
  position: Vec2;
  initialValue: string;
  camera: CameraV1;
  fontSize?: number;
  fontWeight?: 400 | 500;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export interface TextEditorOverlayV1 {
  element: HTMLTextAreaElement;
  updateCamera(camera: CameraV1): void;
  commit(): void;
  cancel(): void;
  dispose(): void;
}

export function attachTextEditorOverlay({
  target,
  position,
  initialValue,
  camera,
  fontSize = NODEINK_DEFAULT_TEXT_SIZE,
  fontWeight = 400,
  onCommit,
  onCancel,
}: TextEditorOverlayOptionsV1): TextEditorOverlayV1 {
  const input = target.ownerDocument.createElement('textarea');
  input.className = 'nodeink-text-editor';
  input.ariaLabel = initialValue ? 'Edit canvas text' : 'Add canvas text';
  input.value = initialValue;
  input.rows = Math.max(1, initialValue.split('\n').length);
  input.spellcheck = false;
  input.wrap = 'off';
  input.style.fontFamily = `'${NODEINK_CANVAS_FONT_FAMILY}', sans-serif`;
  input.style.fontWeight = String(fontWeight);
  let currentCamera = camera;
  let closed = false;
  let buffer = initialValue;

  const positionInput = () => {
    const x = (position.x - currentCamera.x) * currentCamera.zoom;
    const y = (position.y - currentCamera.y) * currentCamera.zoom;
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.fontSize = `${fontSize * currentCamera.zoom}px`;
    input.style.lineHeight = '1.25';
  };
  const resizeInput = () => {
    input.style.height = '0';
    input.style.height = `${Math.max(input.scrollHeight, fontSize * currentCamera.zoom * 1.25)}px`;
    input.style.width = `${Math.max(180, Math.min(560, input.scrollWidth + 24))}px`;
  };
  const close = () => {
    if (closed) {
      return false;
    }
    closed = true;
    composition.dispose();
    input.removeEventListener('input', handleInput);
    input.removeEventListener('keydown', handleKeyDown);
    input.removeEventListener('blur', handleBlur);
    input.removeEventListener('pointerdown', stopPointerPropagation);
    input.remove();
    return true;
  };
  const commit = () => {
    if (close()) {
      onCommit(buffer);
    }
  };
  const cancel = () => {
    if (close()) {
      onCancel();
    }
  };
  const handleInput = () => {
    buffer = input.value;
    resizeInput();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  };
  const handleBlur = () => commit();
  const stopPointerPropagation = (event: PointerEvent) => event.stopPropagation();
  const composition = attachImeComposition(input, (value) => {
    buffer = value;
  });

  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', handleKeyDown);
  input.addEventListener('blur', handleBlur);
  input.addEventListener('pointerdown', stopPointerPropagation);
  target.append(input);
  positionInput();
  resizeInput();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  return {
    element: input,
    updateCamera(nextCamera) {
      currentCamera = nextCamera;
      positionInput();
      resizeInput();
    },
    commit,
    cancel,
    dispose: () => {
      if (close()) {
        onCancel();
      }
    },
  };
}
