export interface ImeCompositionStateV1 {
  isComposing: boolean;
  buffer: string;
}

export interface ImeCompositionBindingV1 {
  getState(): ImeCompositionStateV1;
  applyExternalValue(value: string): boolean;
  dispose(): void;
}

export function attachImeComposition(
  input: HTMLTextAreaElement,
  onCommit: (value: string) => void,
): ImeCompositionBindingV1 {
  let isComposing = false;
  let buffer = input.value;
  let compositionCommit: string | null = null;

  const handleCompositionStart = () => {
    isComposing = true;
    buffer = input.value;
    compositionCommit = null;
  };
  const handleInput = () => {
    buffer = input.value;
    if (isComposing) {
      return;
    }
    if (compositionCommit === buffer) {
      compositionCommit = null;
      return;
    }
    onCommit(buffer);
  };
  const handleCompositionEnd = () => {
    isComposing = false;
    buffer = input.value;
    compositionCommit = buffer;
    onCommit(buffer);
  };

  input.addEventListener('compositionstart', handleCompositionStart);
  input.addEventListener('input', handleInput);
  input.addEventListener('compositionend', handleCompositionEnd);

  return {
    getState: () => ({ isComposing, buffer }),
    applyExternalValue: (value) => {
      if (isComposing) {
        return false;
      }
      input.value = value;
      buffer = value;
      return true;
    },
    dispose: () => {
      input.removeEventListener('compositionstart', handleCompositionStart);
      input.removeEventListener('input', handleInput);
      input.removeEventListener('compositionend', handleCompositionEnd);
    },
  };
}
