export type EditorShortcutAction = 'undo' | 'redo' | 'delete_selection' | 'clear_selection';

export type EditorShortcutListener = (action: EditorShortcutAction) => boolean;

export function attachEditorShortcuts(
  target: Document,
  onShortcut: EditorShortcutListener,
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    const action = editorAction(event);
    if (!action || isEditableTarget(event.target)) {
      return;
    }
    if (onShortcut(action)) {
      event.preventDefault();
    }
  };

  target.addEventListener('keydown', handleKeyDown);
  return () => target.removeEventListener('keydown', handleKeyDown);
}

function editorAction(event: KeyboardEvent): EditorShortcutAction | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'y') {
    return 'redo';
  }
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
    if (key === 'delete' || key === 'backspace') {
      return 'delete_selection';
    }
    if (key === 'escape') {
      return 'clear_selection';
    }
  }
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest('input, textarea, select, [role="textbox"]')) {
    return true;
  }
  const contentEditable = target.closest('[contenteditable]');
  return contentEditable !== null && contentEditable.getAttribute('contenteditable') !== 'false';
}
