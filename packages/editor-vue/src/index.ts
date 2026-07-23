import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
  type PropType,
} from 'vue';

import {
  NODEINK_COLOR_PRESETS,
  NODEINK_FILL_PRESETS,
  NODEINK_STROKE_WIDTH_PRESETS,
  NODEINK_TEXT_ALIGN_PRESETS,
  NODEINK_TEXT_SIZE_PRESETS,
  fillPresetMatches,
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type ElementStylePatchV1,
  type EditorActionV1,
  type EditorWebControllerV1,
  type SelectionStyleV1,
} from '@nodeink-internal/editor-web';

export interface NodeInkEditorProps {
  controller: EditorWebControllerV1;
  hostLabel?: string;
}

export const NodeInkEditor = defineComponent({
  name: 'NodeInkEditor',
  props: {
    controller: {
      type: Object as PropType<EditorWebControllerV1>,
      required: true,
    },
    hostLabel: {
      type: String,
      default: 'Vue adapter',
    },
  },
  setup(props) {
    const canvas = shallowRef<HTMLDivElement | null>(null);
    const snapshot = shallowRef(props.controller.getSnapshot());
    let mountedController: EditorWebControllerV1 | null = null;
    let unsubscribe: (() => void) | null = null;

    const releaseController = () => {
      unsubscribe?.();
      unsubscribe = null;
      mountedController?.dispose();
      mountedController = null;
    };

    const mountController = (controller: EditorWebControllerV1) => {
      mountedController = controller;
      snapshot.value = controller.getSnapshot();
      unsubscribe = controller.subscribe(() => {
        if (mountedController === controller) {
          snapshot.value = controller.getSnapshot();
        }
      });

      if (canvas.value) {
        void controller.mount(canvas.value).catch(() => undefined);
      }
    };

    onMounted(() => mountController(props.controller));
    watch(
      () => props.controller,
      (controller) => {
        if (controller === mountedController) {
          return;
        }
        releaseController();
        mountController(controller);
      },
    );
    onBeforeUnmount(releaseController);

    const dispatch = (action: EditorActionV1) => {
      void props.controller.dispatch(action);
    };

    return () => {
      const currentSnapshot = snapshot.value;
      const isReady = currentSnapshot.status === 'ready';
      const isEditable = isReady && currentSnapshot.documentAccess === 'writer';
      const selectionCount = currentSnapshot.selectedElementIds.length;
      const cameraPresentation = getEditorCameraPresentation(currentSnapshot);
      const persistence = getEditorPersistencePresentation(currentSnapshot);
      const visibleError =
        currentSnapshot.errorMessage ??
        currentSnapshot.saveErrorMessage ??
        currentSnapshot.cameraSaveErrorMessage;
      const retryAction = currentSnapshot.errorMessage
        ? null
        : currentSnapshot.saveErrorMessage
          ? 'retry_save'
          : currentSnapshot.cameraSaveErrorMessage
            ? 'retry_camera_save'
            : null;
      return h('main', { class: 'nodeink-shell', 'data-nodeink-host': 'vue' }, [
        h('header', { class: 'nodeink-topbar' }, [
          h('div', [
            h('span', { class: 'nodeink-kicker' }, 'NodeInk · Phase 1B'),
            h('h1', 'Framework-neutral canvas'),
          ]),
          h('div', { class: 'nodeink-topbar-actions' }, [
            h('span', { class: 'nodeink-host-badge' }, props.hostLabel),
          ]),
        ]),
        h('aside', { class: 'nodeink-toolbar', 'aria-label': 'Canvas actions' }, [
          h(
            'button',
            {
              type: 'button',
              'data-tool': 'select',
              'aria-pressed': currentSnapshot.activeTool === 'select',
              disabled: !isEditable,
              title: 'Select tool (V)',
              onClick: () => dispatch({ type: 'set_tool', tool: 'select' }),
            },
            'Select',
          ),
          h(
            'button',
            {
              type: 'button',
              'data-tool': 'freehand',
              'aria-pressed': currentSnapshot.activeTool === 'freehand',
              disabled: !isEditable,
              title: 'Freehand tool (P)',
              onClick: () => dispatch({ type: 'set_tool', tool: 'freehand' }),
            },
            'Draw',
          ),
          h(
            'button',
            {
              type: 'button',
              'data-tool': 'text',
              'aria-pressed': currentSnapshot.activeTool === 'text',
              disabled: !isEditable,
              title: 'Text tool (T)',
              onClick: () => dispatch({ type: 'set_tool', tool: 'text' }),
            },
            'Text',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: !isEditable,
              onClick: () => dispatch({ type: 'create_rectangle' }),
            },
            'Rectangle',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: !isEditable || selectionCount === 0,
              onClick: () => dispatch({ type: 'move_active', delta: { x: 32, y: 16 } }),
            },
            'Move',
          ),
          h(
            'button',
            {
              type: 'button',
              'data-danger': 'true',
              disabled: !isEditable || selectionCount === 0,
              onClick: () => dispatch({ type: 'delete_selection' }),
            },
            'Delete',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: !isEditable || !currentSnapshot.canUndo,
              onClick: () => dispatch({ type: 'undo' }),
            },
            'Undo',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: !isEditable || !currentSnapshot.canRedo,
              onClick: () => dispatch({ type: 'redo' }),
            },
            'Redo',
          ),
        ]),
        h('section', { class: 'nodeink-stage', 'aria-label': 'Infinite canvas proof' }, [
          h('div', { ref: canvas, class: 'nodeink-canvas' }),
          renderSelectionActionControls(selectionCount, isEditable, dispatch),
          isEditable && currentSnapshot.selectionStyle
            ? renderSelectionStylePanel(currentSnapshot.selectionStyle, (patch) =>
                dispatch({ type: 'update_selection_style', patch }),
              )
            : null,
          h('nav', { class: 'nodeink-zoom-controls', 'aria-label': 'Canvas view controls' }, [
            h(
              'button',
              {
                type: 'button',
                disabled: !isReady,
                'aria-label': 'Zoom out',
                title: '缩小',
                onClick: () => dispatch({ type: 'zoom_out' }),
              },
              '−',
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: !isReady,
                'data-camera-save-status': currentSnapshot.cameraSaveStatus,
                'aria-label': cameraPresentation.fitContentAriaLabel,
                title: cameraPresentation.fitContentTitle,
                onClick: () => dispatch({ type: 'reset_camera' }),
              },
              cameraPresentation.zoomLabel,
            ),
            h(
              'button',
              {
                type: 'button',
                disabled: !isReady,
                'aria-label': 'Zoom in',
                title: '放大',
                onClick: () => dispatch({ type: 'zoom_in' }),
              },
              '+',
            ),
          ]),
          h('output', { class: 'nodeink-status', 'aria-live': 'polite' }, [
            h('span', { 'data-save-status': currentSnapshot.saveStatus }, persistence.statusLabel),
            h('span', currentSnapshot.status),
            h('span', `document r${currentSnapshot.documentRevision}`),
            h('span', `${currentSnapshot.elementCount} elements`),
            h('span', selectionCount === 0 ? 'No selection' : `${selectionCount} selected`),
            h('span', `${currentSnapshot.activeTool} tool`),
          ]),
          persistence.notice
            ? h('p', { class: 'nodeink-notice', role: 'status' }, persistence.notice)
            : null,
          visibleError
            ? h('p', { class: 'nodeink-error', role: 'alert' }, [
                h(
                  'span',
                  currentSnapshot.saveErrorMessage
                    ? `保存失败：${visibleError}`
                    : currentSnapshot.cameraSaveErrorMessage
                      ? `视图位置保存失败：${visibleError}`
                      : visibleError,
                ),
                retryAction
                  ? h(
                      'button',
                      { type: 'button', onClick: () => dispatch({ type: retryAction }) },
                      '重试',
                    )
                  : null,
              ])
            : null,
        ]),
      ]);
    };
  },
});

function renderSelectionActionControls(
  selectionCount: number,
  isEditable: boolean,
  dispatch: (action: EditorActionV1) => void,
) {
  const selectionDisabled = !isEditable || selectionCount === 0;
  const multipleDisabled = !isEditable || selectionCount < 2;
  const button = (label: string, action: EditorActionV1, disabled: boolean, title?: string) =>
    h(
      'button',
      {
        type: 'button',
        title,
        disabled,
        onClick: () => dispatch(action),
      },
      label,
    );

  return h('nav', { class: 'nodeink-selection-actions', 'aria-label': 'Selection actions' }, [
    h(
      'div',
      { class: 'nodeink-selection-action-group', role: 'group', 'aria-label': 'Clipboard' },
      [
        button('Copy', { type: 'copy' }, selectionDisabled),
        button('Cut', { type: 'cut' }, selectionDisabled),
        button('Paste', { type: 'paste' }, !isEditable),
      ],
    ),
    h('div', { class: 'nodeink-selection-action-group', role: 'group', 'aria-label': 'Grouping' }, [
      button('Group', { type: 'group' }, multipleDisabled),
      button('Ungroup', { type: 'ungroup' }, selectionDisabled),
    ]),
    h(
      'div',
      { class: 'nodeink-selection-action-group', role: 'group', 'aria-label': 'Stacking order' },
      [
        button(
          'Front',
          { type: 'reorder', placement: 'front' },
          selectionDisabled,
          'Bring to front',
        ),
        button(
          'Forward',
          { type: 'reorder', placement: 'forward' },
          selectionDisabled,
          'Bring forward',
        ),
        button(
          'Backward',
          { type: 'reorder', placement: 'backward' },
          selectionDisabled,
          'Send backward',
        ),
        button('Back', { type: 'reorder', placement: 'back' }, selectionDisabled, 'Send to back'),
      ],
    ),
    h(
      'div',
      { class: 'nodeink-selection-action-group', role: 'group', 'aria-label': 'Alignment' },
      [
        button('Left', { type: 'align', alignment: 'left' }, multipleDisabled),
        button('Center', { type: 'align', alignment: 'center' }, multipleDisabled),
        button('Right', { type: 'align', alignment: 'right' }, multipleDisabled),
        button('Top', { type: 'align', alignment: 'top' }, multipleDisabled),
        button('Middle', { type: 'align', alignment: 'middle' }, multipleDisabled),
        button('Bottom', { type: 'align', alignment: 'bottom' }, multipleDisabled),
      ],
    ),
  ]);
}

function renderSelectionStylePanel(
  style: SelectionStyleV1,
  dispatch: (patch: ElementStylePatchV1) => void,
) {
  const groups =
    style.kind === 'rect'
      ? [
          styleGroup(
            'Fill',
            NODEINK_FILL_PRESETS.map((preset) =>
              swatchButton(
                `Fill ${preset.label}`,
                preset.value.kind === 'solid' ? preset.value.color : null,
                fillPresetMatches(style.fill, preset.value),
                () => dispatch({ kind: 'rect', fill: preset.value }),
              ),
            ),
          ),
          colorGroup('Stroke', style.stroke, (stroke) => dispatch({ kind: 'rect', stroke })),
          widthGroup(style.strokeWidth, (strokeWidth) => dispatch({ kind: 'rect', strokeWidth })),
        ]
      : style.kind === 'stroke'
        ? [
            colorGroup('Color', style.stroke, (stroke) => dispatch({ kind: 'stroke', stroke })),
            widthGroup(style.strokeWidth, (strokeWidth) =>
              dispatch({ kind: 'stroke', strokeWidth }),
            ),
          ]
        : [
            colorGroup('Color', style.color, (color) => dispatch({ kind: 'text', color })),
            styleGroup(
              'Size',
              NODEINK_TEXT_SIZE_PRESETS.map((fontSize) =>
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-pressed': style.fontSize === fontSize,
                    onClick: () => dispatch({ kind: 'text', fontSize }),
                  },
                  String(fontSize),
                ),
              ),
            ),
            styleGroup(
              'Align',
              NODEINK_TEXT_ALIGN_PRESETS.map((preset) =>
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-pressed': style.textAlign === preset.value,
                    onClick: () => dispatch({ kind: 'text', textAlign: preset.value }),
                  },
                  preset.label,
                ),
              ),
            ),
          ];

  return h('aside', { class: 'nodeink-style-panel', 'aria-label': 'Selection style' }, [
    h('h2', { class: 'nodeink-style-title' }, [
      'Style',
      h('span', style.kind === 'rect' ? 'Rectangle' : style.kind === 'stroke' ? 'Stroke' : 'Text'),
    ]),
    ...groups,
  ]);
}

function colorGroup(label: string, value: string, onChange: (color: string) => void) {
  return styleGroup(
    label,
    NODEINK_COLOR_PRESETS.map((preset) =>
      swatchButton(`${label} ${preset.label}`, preset.value, value === preset.value, () =>
        onChange(preset.value),
      ),
    ),
  );
}

function widthGroup(value: number, onChange: (value: number) => void) {
  return styleGroup(
    'Width',
    NODEINK_STROKE_WIDTH_PRESETS.map((strokeWidth) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': value === strokeWidth,
          onClick: () => onChange(strokeWidth),
        },
        `${strokeWidth}px`,
      ),
    ),
  );
}

function styleGroup(label: string, children: ReturnType<typeof h>[]) {
  return h('fieldset', { class: 'nodeink-style-group' }, [
    h('legend', label),
    h('div', { class: 'nodeink-style-options' }, children),
  ]);
}

function swatchButton(label: string, color: string | null, pressed: boolean, onClick: () => void) {
  return h('button', {
    type: 'button',
    class: 'nodeink-swatch',
    'data-none': color === null ? 'true' : undefined,
    'aria-label': label,
    title: label,
    'aria-pressed': pressed,
    style: color ? { '--swatch-color': color } : undefined,
    onClick,
  });
}
