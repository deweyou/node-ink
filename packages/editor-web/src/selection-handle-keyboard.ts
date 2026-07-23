import type {
  CameraV1,
  NormalizedPointerEventV1,
  SelectionHandleV1,
} from '@nodeink-internal/protocol';

const keyboardPointerId = 2_147_483_646;
const fineStepScreenPx = 1;
const coarseStepScreenPx = 10;
const fineRotationDegrees = 1;
const coarseRotationDegrees = 45;
const handleSelector = '[data-nodeink-selection-handle]';

export interface SelectionHandleKeyboardOptions {
  target: HTMLElement;
  getHandles(): SelectionHandleV1[];
  getCamera(): CameraV1;
  dispatch(events: NormalizedPointerEventV1[]): void | Promise<void>;
}

interface KeyboardGrab {
  handleKey: string;
  point: { x: number; y: number };
  sequence: number;
}

export function attachSelectionHandleKeyboard(options: SelectionHandleKeyboardOptions): () => void {
  const { target } = options;
  const ownerDocument = target.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const suffix = Math.random().toString(36).slice(2);
  const instructions = ownerDocument.createElement('p');
  instructions.id = `nodeink-selection-handle-instructions-${suffix}`;
  instructions.textContent =
    'Press Enter or Space to grab. Use arrow keys to adjust. Press Enter or Space to commit, or Escape to cancel.';
  visuallyHide(instructions);
  const liveRegion = ownerDocument.createElement('div');
  liveRegion.dataset.nodeinkSelectionAnnouncement = 'true';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  visuallyHide(liveRegion);
  target.append(instructions, liveRegion);

  let grab: KeyboardGrab | null = null;
  let dispatchQueue = Promise.resolve();

  const restoreGrabPresentation = () => {
    if (!grab) {
      return;
    }
    const handle = [...target.querySelectorAll<SVGElement>(handleSelector)].find(
      (candidate) => candidate.dataset.nodeinkSelectionHandle === grab?.handleKey,
    );
    if (!handle) {
      return;
    }
    handle.setAttribute('aria-pressed', 'true');
    handle.dataset.nodeinkSelectionHandleFocused = 'true';
    handle.setAttribute('stroke-width', '3');
    handle.focus();
  };

  const enqueue = (events: NormalizedPointerEventV1[]) => {
    dispatchQueue = dispatchQueue
      .then(() => options.dispatch(events))
      .then(
        () => {
          restoreGrabPresentation();
        },
        (error: unknown) => {
          announce(liveRegion, error instanceof Error ? error.message : 'Handle adjustment failed');
        },
      );
  };

  const focusedHandle = (): SVGElement | null => {
    const active = ownerDocument.activeElement;
    return active instanceof SVGElement && active.matches(handleSelector) ? active : null;
  };

  const setGrabbed = (value: boolean, handleKey?: string) => {
    const handle =
      focusedHandle() ??
      [...target.querySelectorAll<SVGElement>(handleSelector)].find(
        (candidate) => candidate.dataset.nodeinkSelectionHandle === handleKey,
      ) ??
      null;
    if (handle) {
      handle.setAttribute('aria-pressed', String(value));
    }
  };

  const finish = (phase: 'up' | 'cancel', message: string) => {
    if (!grab) {
      return;
    }
    const handleKey = grab.handleKey;
    enqueue([pointerEvent(grab.point, ++grab.sequence, phase, options.getCamera().zoom, false)]);
    grab = null;
    setGrabbed(false, handleKey);
    announce(liveRegion, message);
  };

  const onFocusIn = (event: FocusEvent) => {
    const handle = selectionHandleElement(event.target);
    if (handle) {
      handle.setAttribute('aria-describedby', instructions.id);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const handle = selectionHandleElement(event.target);
    if (!handle) {
      return;
    }
    const handleKey = handle.dataset.nodeinkSelectionHandle;
    if (!handleKey) {
      return;
    }
    if (event.key === 'Tab' && grab) {
      finish('up', 'Adjustment committed');
      return;
    }
    if (event.key === 'Escape' && grab) {
      event.preventDefault();
      event.stopPropagation();
      finish('cancel', 'Adjustment cancelled');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (grab) {
        finish('up', 'Adjustment committed');
        return;
      }
      const selectionHandle = findHandle(options.getHandles(), handleKey);
      if (!selectionHandle) {
        return;
      }
      grab = {
        handleKey,
        point: { ...selectionHandle.position },
        sequence: 1,
      };
      handle.dataset.nodeinkSelectionHandleFocused = 'true';
      handle.setAttribute('stroke-width', '3');
      setGrabbed(true, handleKey);
      enqueue([pointerEvent(grab.point, grab.sequence, 'down', options.getCamera().zoom, false)]);
      announce(liveRegion, `${handle.getAttribute('aria-label') ?? 'Handle'} grabbed`);
      return;
    }
    if (!grab || !isArrowKey(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const selectionHandle = findHandle(options.getHandles(), grab.handleKey);
    if (!selectionHandle) {
      finish('cancel', 'Adjustment cancelled');
      return;
    }
    const zoom = options.getCamera().zoom;
    if (selectionHandle.kind === 'rotate') {
      const center = selectionCenter(options.getHandles());
      if (!center) {
        finish('cancel', 'Adjustment cancelled');
        return;
      }
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const degrees = event.shiftKey ? coarseRotationDegrees : fineRotationDegrees;
      grab.point = rotateAround(grab.point, center, direction * degrees);
    } else {
      const step = (event.shiftKey ? coarseStepScreenPx : fineStepScreenPx) / zoom;
      grab.point = {
        x:
          grab.point.x +
          (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: grab.point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      };
    }
    enqueue([pointerEvent(grab.point, ++grab.sequence, 'move', zoom, event.shiftKey)]);
    announce(liveRegion, 'Adjustment preview');
  };

  const onPointerDown = () => finish('up', 'Adjustment committed');
  const onWindowBlur = () => finish('up', 'Adjustment committed');

  target.addEventListener('focusin', onFocusIn);
  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('pointerdown', onPointerDown, true);
  ownerWindow?.addEventListener('blur', onWindowBlur);

  return () => {
    if (grab) {
      finish('cancel', 'Adjustment cancelled');
    }
    target.removeEventListener('focusin', onFocusIn);
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('pointerdown', onPointerDown, true);
    ownerWindow?.removeEventListener('blur', onWindowBlur);
    instructions.remove();
    liveRegion.remove();
  };
}

function pointerEvent(
  point: { x: number; y: number },
  sequence: number,
  phase: NormalizedPointerEventV1['phase'],
  zoom: number,
  shift: boolean,
): NormalizedPointerEventV1 {
  return {
    pointerId: keyboardPointerId,
    sequence,
    phase,
    point,
    modifiers: { shift, alt: false, metaOrCtrl: false },
    screenScale: zoom,
  };
}

function selectionHandleElement(target: EventTarget | null): SVGElement | null {
  return target instanceof SVGElement && target.matches(handleSelector) ? target : null;
}

function findHandle(handles: SelectionHandleV1[], key: string): SelectionHandleV1 | undefined {
  return handles.find((handle) =>
    handle.kind === 'vertex' ? `vertex:${handle.vertexIndex}` === key : handle.id === key,
  );
}

function selectionCenter(handles: SelectionHandleV1[]): { x: number; y: number } | null {
  const northWest = handles.find((handle) => handle.id === 'north_west');
  const southEast = handles.find((handle) => handle.id === 'south_east');
  if (!northWest || !southEast) {
    return null;
  }
  return {
    x: (northWest.position.x + southEast.position.x) / 2,
    y: (northWest.position.y + southEast.position.y) / 2,
  };
}

function rotateAround(
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

function isArrowKey(key: string): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

function announce(liveRegion: HTMLElement, message: string): void {
  liveRegion.textContent = '';
  liveRegion.textContent = message;
}

function visuallyHide(element: HTMLElement): void {
  Object.assign(element.style, {
    border: '0',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    height: '1px',
    margin: '-1px',
    overflow: 'hidden',
    padding: '0',
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: '1px',
  });
}
