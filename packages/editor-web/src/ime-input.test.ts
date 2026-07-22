import { describe, expect, it, vi } from 'vitest';

import { attachImeComposition } from './ime-input';

describe('attachImeComposition', () => {
  it('keeps Chinese composition in the browser and commits once at the end', () => {
    const textarea = document.createElement('textarea');
    const commit = vi.fn();
    const binding = attachImeComposition(textarea, commit);

    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    textarea.value = '你';
    textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText' }));
    textarea.value = '你好✍️';
    textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText' }));

    expect(binding.getState()).toEqual({ isComposing: true, buffer: '你好✍️' });
    expect(binding.applyExternalValue('external command')).toBe(false);
    expect(textarea.value).toBe('你好✍️');
    expect(commit).not.toHaveBeenCalled();

    textarea.dispatchEvent(new CompositionEvent('compositionend'));
    textarea.dispatchEvent(new InputEvent('input'));

    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('你好✍️');
    expect(binding.getState().isComposing).toBe(false);
  });

  it('commits ordinary input, accepts external values outside composition, and disposes', () => {
    const textarea = document.createElement('textarea');
    const commit = vi.fn();
    const binding = attachImeComposition(textarea, commit);

    textarea.value = 'plain';
    textarea.dispatchEvent(new InputEvent('input'));
    expect(commit).toHaveBeenCalledWith('plain');
    expect(binding.applyExternalValue('snapshot')).toBe(true);
    expect(textarea.value).toBe('snapshot');

    binding.dispose();
    textarea.value = 'after dispose';
    textarea.dispatchEvent(new InputEvent('input'));
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
