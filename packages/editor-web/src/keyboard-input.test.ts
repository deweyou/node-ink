import { describe, expect, it, vi } from 'vitest';

import { attachEditorShortcuts } from './keyboard-input';

describe('attachEditorShortcuts', () => {
  it.each([
    [{ key: 'z', metaKey: true }, 'undo'],
    [{ key: 'z', ctrlKey: true }, 'undo'],
    [{ key: 'Z', metaKey: true, shiftKey: true }, 'redo'],
    [{ key: 'z', ctrlKey: true, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true }, 'redo'],
  ] as const)('maps %o to %s', (options, expectedAction) => {
    const shortcutTarget = document.implementation.createHTMLDocument();
    const listener = vi.fn(() => true);
    attachEditorShortcuts(shortcutTarget, listener);
    const event = keyboardEvent(options);

    shortcutTarget.body.dispatchEvent(event);

    expect(listener).toHaveBeenCalledWith(expectedAction);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves unavailable history actions and unrelated shortcuts to the browser', () => {
    const shortcutTarget = document.implementation.createHTMLDocument();
    const listener = vi.fn(() => false);
    attachEditorShortcuts(shortcutTarget, listener);
    const unavailableUndo = keyboardEvent({ key: 'z', metaKey: true });
    const unmodifiedKey = keyboardEvent({ key: 'z' });
    const alternateShortcut = keyboardEvent({ key: 'z', metaKey: true, altKey: true });

    shortcutTarget.dispatchEvent(unavailableUndo);
    shortcutTarget.dispatchEvent(unmodifiedKey);
    shortcutTarget.dispatchEvent(alternateShortcut);

    expect(listener).toHaveBeenCalledOnce();
    expect(unavailableUndo.defaultPrevented).toBe(false);
    expect(unmodifiedKey.defaultPrevented).toBe(false);
    expect(alternateShortcut.defaultPrevented).toBe(false);
  });

  it('does not override editing, composition, handled events, or detached documents', () => {
    const shortcutTarget = document.implementation.createHTMLDocument();
    const input = shortcutTarget.createElement('input');
    const editable = shortcutTarget.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    shortcutTarget.body.append(input, editable);
    const listener = vi.fn(() => true);
    const detach = attachEditorShortcuts(shortcutTarget, listener);

    input.dispatchEvent(keyboardEvent({ key: 'z', metaKey: true }));
    editable.dispatchEvent(keyboardEvent({ key: 'z', ctrlKey: true }));
    shortcutTarget.dispatchEvent(keyboardEvent({ key: 'z', metaKey: true, isComposing: true }));
    const handled = keyboardEvent({ key: 'z', metaKey: true });
    handled.preventDefault();
    shortcutTarget.dispatchEvent(handled);
    detach();
    shortcutTarget.dispatchEvent(keyboardEvent({ key: 'z', metaKey: true }));

    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ['Delete', 'delete_selection'],
    ['Backspace', 'delete_selection'],
    ['Escape', 'escape'],
    ['v', 'select_tool'],
    ['P', 'freehand_tool'],
    ['t', 'text_tool'],
  ] as const)('maps %s to %s without browser side effects', (key, expectedAction) => {
    const shortcutTarget = document.implementation.createHTMLDocument();
    const listener = vi.fn(() => true);
    attachEditorShortcuts(shortcutTarget, listener);
    const event = keyboardEvent({ key });

    shortcutTarget.body.dispatchEvent(event);

    expect(listener).toHaveBeenCalledWith(expectedAction);
    expect(event.defaultPrevented).toBe(true);
  });
});

interface KeyboardEventOptions {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

function keyboardEvent(options: KeyboardEventOptions): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: options.key,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
  });
  Object.defineProperty(event, 'isComposing', { value: options.isComposing ?? false });
  return event;
}
