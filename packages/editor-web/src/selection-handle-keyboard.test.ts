import { describe, expect, it, vi } from 'vitest';

import type { SelectionHandleV1 } from '@nodeink-internal/protocol';

import { attachSelectionHandleKeyboard } from './selection-handle-keyboard';

describe('attachSelectionHandleKeyboard', () => {
  it('grabs, moves in screen pixels, commits, and announces one pointer session', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const handle = selectionHandle('east', 'Right resize handle');
    target.append(handle);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const detach = attachSelectionHandleKeyboard({
      target,
      getHandles: () => handles(),
      getCamera: () => ({ x: 0, y: 0, zoom: 2 }),
      dispatch,
    });
    handle.focus();

    handle.dispatchEvent(keyboardEvent('Enter'));
    await flushPromises();
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    expect(handle.dataset.nodeinkSelectionHandleFocused).toBe('true');
    handle.dispatchEvent(keyboardEvent('ArrowRight'));
    handle.dispatchEvent(keyboardEvent('ArrowDown', true));
    handle.dispatchEvent(keyboardEvent(' '));
    await flushPromises();

    expect(dispatch.mock.calls.flatMap(([events]) => events)).toEqual([
      expect.objectContaining({
        phase: 'down',
        point: { x: 100, y: 80 },
        screenScale: 2,
      }),
      expect.objectContaining({
        phase: 'move',
        point: { x: 100.5, y: 80 },
        modifiers: expect.objectContaining({ shift: false }),
      }),
      expect.objectContaining({
        phase: 'move',
        point: { x: 100.5, y: 85 },
        modifiers: expect.objectContaining({ shift: true }),
      }),
      expect.objectContaining({ phase: 'up', point: { x: 100.5, y: 85 } }),
    ]);
    expect(handle.getAttribute('aria-pressed')).toBe('false');
    expect(target.querySelector('[role="status"]')?.textContent).toBe('Adjustment committed');

    detach();
    target.remove();
  });

  it('cancels with Escape and rotates by one or forty-five degrees', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const handle = selectionHandle('rotate', 'Rotate handle');
    target.append(handle);
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const detach = attachSelectionHandleKeyboard({
      target,
      getHandles: () => handles(),
      getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
      dispatch,
    });
    handle.focus();

    handle.dispatchEvent(keyboardEvent('Enter'));
    handle.dispatchEvent(keyboardEvent('ArrowRight'));
    handle.dispatchEvent(keyboardEvent('ArrowRight', true));
    handle.dispatchEvent(keyboardEvent('Escape'));
    await flushPromises();

    const events = dispatch.mock.calls.flatMap(([batch]) => batch);
    expect(events.map((event) => event.phase)).toEqual(['down', 'move', 'move', 'cancel']);
    expect(events[1].point.x).toBeCloseTo(100.692, 3);
    expect(events[1].point.y).toBeCloseTo(20.704, 3);
    expect(events[2].point.x).toBeCloseTo(116.56, 3);
    expect(events[2].point.y).toBeCloseTo(60.987, 3);
    expect(target.querySelector('[role="status"]')?.textContent).toBe('Adjustment cancelled');

    detach();
    target.remove();
  });
});

function selectionHandle(key: string, label: string): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  element.dataset.nodeinkSelectionHandle = key;
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-pressed', 'false');
  return element;
}

function handles(): SelectionHandleV1[] {
  return [
    {
      id: 'north_west',
      kind: 'resize',
      position: { x: 20, y: 20 },
    },
    {
      id: 'east',
      kind: 'resize',
      position: { x: 100, y: 80 },
    },
    {
      id: 'south_east',
      kind: 'resize',
      position: { x: 100, y: 100 },
    },
    {
      id: 'rotate',
      kind: 'rotate',
      position: { x: 100, y: 20 },
    },
  ];
}

function keyboardEvent(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
