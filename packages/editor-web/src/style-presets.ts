import type {
  ElementSizeV1,
  FillV1,
  RenderProfileV1,
  TextAlignV1,
} from '@nodeink-internal/protocol';

export const NODEINK_CLEAN_PROFILE = {
  kind: 'clean',
  version: 1,
} as const satisfies RenderProfileV1;

export const NODEINK_SKETCH_PROFILE = {
  kind: 'sketch',
  version: 1,
  seed: 1_313_817_669,
  roughness: 1.2,
  bowing: 0.8,
  fillStyle: 'hachure',
} as const satisfies RenderProfileV1;

export const NODEINK_FILL_PRESETS = [
  { id: 'mint', label: 'Mint', value: { kind: 'solid', color: '#d1fae5' } },
  { id: 'blue', label: 'Blue', value: { kind: 'solid', color: '#dbeafe' } },
  { id: 'amber', label: 'Amber', value: { kind: 'solid', color: '#fef3c7' } },
  { id: 'none', label: 'No fill', value: { kind: 'none' } },
] as const satisfies ReadonlyArray<{ id: string; label: string; value: FillV1 }>;

export const NODEINK_COLOR_PRESETS = [
  { id: 'ink', label: 'Ink', value: '#0f172a' },
  { id: 'emerald', label: 'Emerald', value: '#047857' },
  { id: 'blue', label: 'Blue', value: '#2563eb' },
  { id: 'rose', label: 'Rose', value: '#e11d48' },
] as const;

export const NODEINK_SIZE_PRESETS = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
  { value: 'xl', label: 'XL' },
] as const satisfies ReadonlyArray<{ value: ElementSizeV1; label: string }>;
export const NODEINK_TEXT_SIZE_PRESETS = [18, 24, 32] as const;
export const NODEINK_TEXT_ALIGN_PRESETS = [
  { value: 'start', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'Right' },
] as const satisfies ReadonlyArray<{ value: TextAlignV1; label: string }>;

export const NODEINK_DEFAULT_RECT_STYLE = {
  fill: NODEINK_FILL_PRESETS[0].value,
  stroke: '#047857',
  size: 'm',
} as const;

export const NODEINK_DEFAULT_STROKE_STYLE = {
  stroke: '#0f172a',
  size: 'm',
} as const;

export const NODEINK_DEFAULT_LINE_STYLE = {
  stroke: '#0f172a',
  size: 'm',
} as const;

export const NODEINK_DEFAULT_TEXT_STYLE = {
  color: '#0f172a',
  textAlign: 'start',
  fontSize: 24,
  fontWeight: 400,
} as const;

export function fillPresetMatches(current: FillV1, preset: FillV1): boolean {
  return (
    current.kind === preset.kind &&
    (current.kind === 'none' || (preset.kind === 'solid' && current.color === preset.color))
  );
}
