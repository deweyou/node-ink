import { EditorWebController } from '@nodeink-internal/editor-web';
import { createWasmEngine } from '@nodeink-internal/engine-web';
import { createBlankDocument } from '@nodeink-internal/protocol';
import { SvgRenderer } from '@nodeink-internal/renderer-svg';

export async function createController() {
  const engine = await createWasmEngine(createBlankDocument('phase0-document'));
  return new EditorWebController({
    engine,
    renderer: new SvgRenderer(),
  });
}
