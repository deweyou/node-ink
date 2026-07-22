export type EditorShortcutAction =
  | 'undo'
  | 'redo'
  | 'delete_selection'
  | 'escape'
  | 'select_tool'
  | 'freehand_tool'
  | 'text_tool';

export type EditorSelectionShortcutAction =
  | 'select_all'
  | 'copy_selection'
  | 'cut_selection'
  | 'paste'
  | 'group_selection'
  | 'ungroup_selection'
  | 'bring_forward'
  | 'send_backward'
  | 'bring_to_front'
  | 'send_to_back';

export type EditorShortcutActionV2 = EditorShortcutAction | EditorSelectionShortcutAction;

export type EditorShortcutListener = (action: EditorShortcutAction) => boolean;
export type EditorShortcutListenerV2 = (action: EditorShortcutActionV2) => boolean;

export function attachEditorShortcuts(
  target: Document,
  onShortcut: EditorShortcutListener,
): () => void {
  return attachShortcuts(target, (action) => onShortcut(action as EditorShortcutAction), false);
}

export function attachEditorShortcutsV2(
  target: Document,
  onShortcut: EditorShortcutListenerV2,
): () => void {
  return attachShortcuts(target, onShortcut, true);
}

function attachShortcuts(
  target: Document,
  onShortcut: EditorShortcutListenerV2,
  includeSelectionActions: boolean,
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    const action = editorAction(event, includeSelectionActions);
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

function editorAction(
  event: KeyboardEvent,
  includeSelectionActions: boolean,
): EditorShortcutActionV2 | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  const metaOrCtrl = event.metaKey || event.ctrlKey;
  if (metaOrCtrl && key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'y') {
    return 'redo';
  }
  if (!includeSelectionActions) {
    return unmodifiedEditorAction(event, key);
  }
  if (metaOrCtrl) {
    if (!event.shiftKey && key === 'a') {
      return 'select_all';
    }
    if (!event.shiftKey && key === 'c') {
      return 'copy_selection';
    }
    if (!event.shiftKey && key === 'x') {
      return 'cut_selection';
    }
    if (!event.shiftKey && key === 'v') {
      return 'paste';
    }
    if (key === 'g') {
      return event.shiftKey ? 'ungroup_selection' : 'group_selection';
    }
    if (!event.shiftKey && event.key === ']') {
      return 'bring_to_front';
    }
    if (!event.shiftKey && event.key === '[') {
      return 'send_to_back';
    }
    return null;
  }
  if (!event.shiftKey && event.key === ']') {
    return 'bring_forward';
  }
  if (!event.shiftKey && event.key === '[') {
    return 'send_backward';
  }
  return unmodifiedEditorAction(event, key);
}

function unmodifiedEditorAction(event: KeyboardEvent, key: string): EditorShortcutAction | null {
  if (event.metaKey || event.ctrlKey || event.shiftKey) {
    return null;
  }
  if (key === 'delete' || key === 'backspace') {
    return 'delete_selection';
  }
  if (key === 'escape') {
    return 'escape';
  }
  if (key === 'v') {
    return 'select_tool';
  }
  if (key === 'p') {
    return 'freehand_tool';
  }
  return key === 't' ? 'text_tool' : null;
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
