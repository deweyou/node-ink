export type HistoryShortcutAction = 'undo' | 'redo';

export type HistoryShortcutListener = (action: HistoryShortcutAction) => boolean;

export function attachHistoryShortcuts(
  target: Document,
  onHistoryShortcut: HistoryShortcutListener,
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    const action = historyAction(event);
    if (!action || isEditableTarget(event.target)) {
      return;
    }
    if (onHistoryShortcut(action)) {
      event.preventDefault();
    }
  };

  target.addEventListener('keydown', handleKeyDown);
  return () => target.removeEventListener('keydown', handleKeyDown);
}

function historyAction(event: KeyboardEvent): HistoryShortcutAction | null {
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
