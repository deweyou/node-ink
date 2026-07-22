import { describe, expect, it, vi } from 'vitest';

import { attachTextEditorOverlay, NODEINK_CANVAS_FONT_FAMILY } from './text-editor-overlay';

describe('attachTextEditorOverlay', () => {
  it('positions the fixed-font textarea from world space and commits multiline text once', () => {
    const target = document.createElement('div');
    const onCommit = vi.fn();
    const overlay = attachTextEditorOverlay({
      target,
      position: { x: 120, y: 80 },
      initialValue: '第一行',
      camera: { x: 20, y: 30, zoom: 2 },
      onCommit,
      onCancel: vi.fn(),
    });

    expect(overlay.element.style.left).toBe('200px');
    expect(overlay.element.style.top).toBe('100px');
    expect(overlay.element.style.fontSize).toBe('48px');
    expect(overlay.element.style.fontFamily).toContain(NODEINK_CANVAS_FONT_FAMILY);

    overlay.element.value = '第一行\n第二行';
    overlay.element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    overlay.element.dispatchEvent(new FocusEvent('blur'));
    overlay.commit();

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('第一行\n第二行');
    expect(target.querySelector('textarea')).toBeNull();
  });

  it('keeps IME composition in the overlay and cancels with Escape', () => {
    const target = document.createElement('div');
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const overlay = attachTextEditorOverlay({
      target,
      position: { x: 0, y: 0 },
      initialValue: '',
      camera: { x: 0, y: 0, zoom: 1 },
      onCommit,
      onCancel,
    });

    overlay.element.dispatchEvent(new CompositionEvent('compositionstart'));
    overlay.element.value = '你';
    overlay.element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    expect(onCommit).not.toHaveBeenCalled();
    overlay.element.dispatchEvent(new CompositionEvent('compositionend'));
    expect(onCommit).not.toHaveBeenCalled();

    overlay.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('updates screen placement with Camera and commits from the keyboard', () => {
    const target = document.createElement('div');
    const onCommit = vi.fn();
    const overlay = attachTextEditorOverlay({
      target,
      position: { x: 50, y: 40 },
      initialValue: 'NodeInk',
      camera: { x: 0, y: 0, zoom: 1 },
      onCommit,
      onCancel: vi.fn(),
    });

    overlay.updateCamera({ x: 10, y: 5, zoom: 1.5 });
    expect(overlay.element.style.left).toBe('60px');
    expect(overlay.element.style.top).toBe('52.5px');
    overlay.element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onCommit).toHaveBeenCalledWith('NodeInk');
  });
});
