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
  getEditorCameraPresentation,
  getEditorPersistencePresentation,
  type EditorActionV1,
  type EditorWebControllerV1,
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
            h('span', { class: 'nodeink-kicker' }, 'NodeInk · Phase 1A'),
            h('h1', 'Framework-neutral canvas'),
          ]),
          h('span', { class: 'nodeink-host-badge' }, props.hostLabel),
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
              disabled: !isEditable || !currentSnapshot.activeElementId,
              onClick: () => dispatch({ type: 'move_active', delta: { x: 32, y: 16 } }),
            },
            'Move',
          ),
          h(
            'button',
            {
              type: 'button',
              'data-danger': 'true',
              disabled: !isEditable || !currentSnapshot.activeElementId,
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
            h('span', currentSnapshot.activeElementId ? '1 selected' : 'No selection'),
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
