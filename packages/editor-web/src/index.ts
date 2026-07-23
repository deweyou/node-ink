import {
  protocolVersion,
  type AlignmentGuideV1,
  type AlignmentV1,
  type CameraActionV1,
  type CameraV1,
  type CommandEnvelopeV1,
  type ArrowElementV1,
  type DiamondElementV1,
  type EllipseElementV1,
  type EnginePortV1,
  type EditorToolV1,
  type ElementStylePatchV1,
  type EngineUpdateV1,
  type NormalizedPointerEventV1,
  type LineElementV1,
  type OrientedSelectionBoundsV1,
  type PointerUpdateV1,
  type PolylineElementV1,
  type RectElementV1,
  type RenderProfileV1,
  type RendererV1,
  type RenderApplyResultV1,
  type ReorderPlacementV1,
  type SelectionBoundsV1,
  type SelectionHandleV1,
  type SelectionMarqueeV1,
  type SelectionStyleV1,
  type StrokeInputBatchV1,
  type StrokeTransportV1,
  type StrokeUpdateV1,
  type TextElementV1,
  type TextMeasureRequestV1,
  type TextMetricsSnapshotV1,
  type Vec2,
  type VertexEditUpdateV1,
} from '@nodeink-internal/protocol';

import { attachPointerInput } from './pointer-input';
import { attachEditorShortcutsV2, type EditorShortcutActionV2 } from './keyboard-input';
import {
  defaultClipboardPort,
  type ClipboardPayloadV1 as BrowserClipboardPayloadV1,
  type ClipboardPortV1,
} from './clipboard-port';
import { attachCameraInput, type CameraInputBindingV1 } from './camera-input';
import { FreehandInputAdapterV1 } from './freehand-input';
import { CanvasTextMetricsAdapter } from './text-metrics';
import {
  attachTextEditorOverlay,
  NODEINK_CANVAS_FONT_FAMILY,
  NODEINK_DEFAULT_TEXT_SIZE,
  type TextEditorOverlayV1,
} from './text-editor-overlay';
import {
  NODEINK_CLEAN_PROFILE,
  NODEINK_DEFAULT_LINE_STYLE,
  NODEINK_DEFAULT_RECT_STYLE,
  NODEINK_DEFAULT_TEXT_STYLE,
  NODEINK_SKETCH_PROFILE,
} from './style-presets';

const CAMERA_ZOOM_STEP = 1.5;
const CAMERA_FIT_PADDING = 64;
const SELECTION_GAP_PX = 6;
const PASTE_CASCADE_PX = 24;

export type EditorActionV1 =
  | {
      type: 'create_rectangle';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | {
      type: 'create_ellipse';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | {
      type: 'create_diamond';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | {
      type: 'create_line';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | {
      type: 'create_polyline';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | {
      type: 'create_arrow';
      elementId?: string;
      position?: { x: number; y: number };
    }
  | { type: 'move_active'; delta: { x: number; y: number } }
  | { type: 'delete_selection' }
  | { type: 'select_all' }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste' }
  | { type: 'group' }
  | { type: 'ungroup' }
  | { type: 'reorder'; placement: ReorderPlacementV1 }
  | { type: 'align'; alignment: AlignmentV1 }
  | { type: 'clear_selection' }
  | { type: 'escape' }
  | { type: 'finish_shape_creation' }
  | { type: 'remove_shape_creation_point' }
  | { type: 'set_tool'; tool: EditorToolV1 }
  | { type: 'begin_text_edit'; point: Vec2 }
  | { type: 'insert_polyline_vertex'; point: Vec2 }
  | { type: 'commit_text_edit'; value: string }
  | { type: 'cancel_text_edit' }
  | { type: 'update_selection_style'; patch: ElementStylePatchV1 }
  | { type: 'set_render_profile'; profile: 'clean' | 'sketch' }
  | { type: 'pointer_events'; events: NormalizedPointerEventV1[] }
  | { type: 'stroke_batch'; batch: StrokeInputBatchV1; transport: StrokeTransportV1 }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'retry_save' }
  | { type: 'request_takeover' }
  | { type: 'camera_action'; action: CameraActionV1 }
  | { type: 'zoom_in' }
  | { type: 'zoom_out' }
  | { type: 'reset_camera' }
  | { type: 'retry_camera_save' };

export type EditorSaveStatusV1 = 'saved' | 'dirty' | 'saving' | 'save_failed' | 'readonly';
export type EditorCameraSaveStatusV1 = 'saved' | 'dirty' | 'saving' | 'save_failed';
export type EditorDocumentAccessV1 = 'writer' | 'readonly';
export type EditorTakeoverStatusV1 = 'idle' | 'requesting' | 'reloading' | 'failed';
export type EditorReadonlyReasonV1 =
  | 'held_elsewhere'
  | 'taken_over'
  | 'unsupported'
  | 'recovered_fallback'
  | 'migration_save_failed'
  | 'readonly_diagnostic';
export type EditorRecoveryV1 =
  | 'blank'
  | 'head'
  | 'migrated_head'
  | 'stable_fallback'
  | 'previous_stable_fallback'
  | 'migration_save_failed'
  | 'readonly_diagnostic';

export interface EditorPersistenceSnapshotV1 {
  status: 'saved' | 'dirty' | 'saving' | 'save_failed';
  persistedRevision: number;
  pendingRevision: number;
  errorMessage: string | null;
}

export interface EditorPersistencePortV1 {
  getSnapshot(): EditorPersistenceSnapshotV1;
  subscribe(listener: () => void): () => void;
  markCommitted(revision: number): void;
  retry(): Promise<void>;
  flush(): Promise<void>;
  dispose(): void;
}

export interface EditorCameraPersistencePortV1 {
  loadCamera(documentId: string): Promise<CameraV1 | null>;
  saveCamera(documentId: string, camera: CameraV1): Promise<void>;
}

export interface EditorTextMetricsPortV1 {
  fingerprint(): string;
  measure(request: TextMeasureRequestV1): { snapshot: TextMetricsSnapshotV1 };
}

export interface EditorUiSnapshotV1 {
  status: 'booting' | 'ready' | 'error' | 'disposed';
  documentRevision: number;
  sceneRevision: number;
  elementCount: number;
  activeElementId: string | null;
  selectedElementIds: string[];
  primaryElementId: string | null;
  activeTool: EditorToolV1;
  selectionBounds: SelectionBoundsV1 | null;
  selectionOrientedBounds: OrientedSelectionBoundsV1 | null;
  selectionHandles: SelectionHandleV1[];
  selectionMarquee: SelectionMarqueeV1 | null;
  alignmentGuides: AlignmentGuideV1[];
  selectionStyle: SelectionStyleV1 | null;
  renderProfile: RenderProfileV1;
  canUndo: boolean;
  canRedo: boolean;
  errorMessage: string | null;
  saveStatus: EditorSaveStatusV1;
  saveErrorMessage: string | null;
  documentAccess: EditorDocumentAccessV1;
  readonlyReason: EditorReadonlyReasonV1 | null;
  takeoverAvailable: boolean;
  takeoverStatus: EditorTakeoverStatusV1;
  takeoverErrorMessage: string | null;
  recovery: EditorRecoveryV1;
  camera: CameraV1;
  cameraZoomPercent: number;
  cameraSaveStatus: EditorCameraSaveStatusV1;
  cameraSaveErrorMessage: string | null;
}

export interface EditorActionResultV1 {
  ok: boolean;
  snapshot: EditorUiSnapshotV1;
  pointerMetrics?: Pick<PointerUpdateV1, 'processedEventCount' | 'ignoredEventCount' | 'didCommit'>;
  strokeMetrics?: Pick<StrokeUpdateV1, 'processedPointCount' | 'ignoredPointCount' | 'didCommit'>;
  vertexMetrics?: Pick<VertexEditUpdateV1, 'didCommit'>;
  performance?: EditorActionPerformanceV1;
}

export interface EditorActionPerformanceV1 {
  inputToVisibleMs: number;
  rendererApplyMs: number;
  sceneBytes: number;
  changedNodeCount: number;
}

export interface EditorWebControllerV1 {
  mount(target: HTMLElement): Promise<void>;
  getSnapshot(): EditorUiSnapshotV1;
  subscribe(listener: () => void): () => void;
  dispatch(action: EditorActionV1): Promise<EditorActionResultV1>;
  relinquishDocument(): Promise<void>;
  dispose(): void;
}

export interface EditorWebControllerOptions {
  engine: EnginePortV1;
  renderer: RendererV1;
  createId?: () => string;
  persistence?: EditorPersistencePortV1;
  cameraPersistence?: EditorCameraPersistencePortV1;
  textMetrics?: EditorTextMetricsPortV1;
  clipboard?: ClipboardPortV1;
  documentAccess?: EditorDocumentAccessV1;
  readonlyReason?: EditorReadonlyReasonV1 | null;
  recovery?: EditorRecoveryV1;
  requestDocumentTakeover?: () => Promise<void>;
  reloadDocument?: () => void | Promise<void>;
  onRelinquishDocument?: () => void | Promise<void>;
  onDispose?: () => void | Promise<void>;
}

export class EditorWebController implements EditorWebControllerV1 {
  readonly #engine: EnginePortV1;
  readonly #renderer: RendererV1;
  readonly #createId: () => string;
  readonly #persistence: EditorPersistencePortV1 | null;
  readonly #cameraPersistence: EditorCameraPersistencePortV1 | null;
  readonly #textMetrics: EditorTextMetricsPortV1;
  readonly #clipboard: ClipboardPortV1;
  readonly #requestDocumentTakeover: (() => Promise<void>) | null;
  readonly #reloadDocument: (() => void | Promise<void>) | null;
  readonly #onRelinquishDocument: (() => void | Promise<void>) | null;
  readonly #onDispose: (() => void | Promise<void>) | null;
  readonly #listeners = new Set<() => void>();
  #snapshot: EditorUiSnapshotV1;
  #documentId: string | null = null;
  #detachPointerInput: (() => void) | null = null;
  #cameraInput: CameraInputBindingV1 | null = null;
  #detachEditorShortcuts: (() => void) | null = null;
  #detachVisibilityFlush: (() => void) | null = null;
  #detachPersistence: (() => void) | null = null;
  #detachResize: (() => void) | null = null;
  #cameraTarget: HTMLElement | null = null;
  #fitZoom = 1;
  #rootElementIds: string[] = [];
  #pasteCascade = 0;
  #pendingCamera: CameraV1 | null = null;
  #cameraSaveTimer: ReturnType<typeof setTimeout> | null = null;
  #cameraSavePromise: Promise<void> | null = null;
  readonly #freehandInput = new FreehandInputAdapterV1();
  #textEditor: TextEditorOverlayV1 | null = null;
  #textDraft: TextEditingDraftV1 | null = null;
  #activeDocumentPointerId: number | null = null;
  #queue = Promise.resolve();
  #isDisposed = false;

  constructor(options: EditorWebControllerOptions) {
    this.#engine = options.engine;
    this.#renderer = options.renderer;
    this.#createId = options.createId ?? defaultId;
    this.#persistence = options.persistence ?? null;
    this.#cameraPersistence = options.cameraPersistence ?? null;
    this.#textMetrics = options.textMetrics ?? new CanvasTextMetricsAdapter();
    this.#clipboard = options.clipboard ?? defaultClipboardPort;
    this.#requestDocumentTakeover = options.requestDocumentTakeover ?? null;
    this.#reloadDocument = options.reloadDocument ?? null;
    this.#onRelinquishDocument = options.onRelinquishDocument ?? null;
    this.#onDispose = options.onDispose ?? null;
    const documentAccess = options.documentAccess ?? 'writer';
    const persistenceSnapshot = this.#persistence?.getSnapshot() ?? null;
    this.#snapshot = {
      status: 'booting',
      documentRevision: 0,
      sceneRevision: 0,
      elementCount: 0,
      activeElementId: null,
      selectedElementIds: [],
      primaryElementId: null,
      activeTool: 'select',
      selectionBounds: null,
      selectionOrientedBounds: null,
      selectionHandles: [],
      selectionMarquee: null,
      alignmentGuides: [],
      selectionStyle: null,
      renderProfile: NODEINK_CLEAN_PROFILE,
      canUndo: false,
      canRedo: false,
      errorMessage: null,
      saveStatus:
        documentAccess === 'readonly' ? 'readonly' : (persistenceSnapshot?.status ?? 'saved'),
      saveErrorMessage: persistenceSnapshot?.errorMessage ?? null,
      documentAccess,
      readonlyReason: options.readonlyReason ?? null,
      takeoverAvailable: Boolean(this.#requestDocumentTakeover && this.#reloadDocument),
      takeoverStatus: 'idle',
      takeoverErrorMessage: null,
      recovery: options.recovery ?? 'blank',
      camera: { x: 0, y: 0, zoom: 1 },
      cameraZoomPercent: 100,
      cameraSaveStatus: 'saved',
      cameraSaveErrorMessage: null,
    };
    this.#detachPersistence =
      this.#persistence?.subscribe(() => {
        const snapshot = this.#persistence?.getSnapshot();
        if (!snapshot || this.#snapshot.documentAccess === 'readonly') {
          return;
        }
        this.#snapshot = {
          ...this.#snapshot,
          saveStatus: snapshot.status,
          saveErrorMessage: snapshot.errorMessage,
        };
        this.emit();
      }) ?? null;
  }

  async mount(target: HTMLElement): Promise<void> {
    this.ensureActive();
    this.#renderer.mount(target);
    this.#cameraTarget = target;
    this.#cameraInput?.detach();
    this.#cameraInput = attachCameraInput(target, (action) => {
      void this.dispatch({ type: 'camera_action', action });
    });
    this.#detachPointerInput?.();
    this.#detachPointerInput =
      this.#snapshot.documentAccess === 'writer'
        ? attachPointerInput(
            target,
            (events) => {
              void this.dispatch({ type: 'pointer_events', events });
            },
            {
              screenScale: () => this.#snapshot.camera.zoom,
              shouldHandleEvent: (event) =>
                this.#cameraInput?.shouldHandleDocumentPointer(event) ?? true,
              shouldHandleHoverMove: () => this.#snapshot.activeTool === 'polyline',
              onDoubleClick: (point) => {
                if (this.#snapshot.activeTool === 'polyline') {
                  void this.dispatch({ type: 'finish_shape_creation' });
                } else if (this.#snapshot.activeTool === 'select' && !this.#textEditor) {
                  void this.dispatch({ type: 'insert_polyline_vertex', point }).then((result) => {
                    if (result.ok && result.vertexMetrics?.didCommit === false) {
                      void this.dispatch({ type: 'begin_text_edit', point });
                    }
                  });
                }
              },
            },
          )
        : null;
    this.#detachEditorShortcuts?.();
    this.#detachEditorShortcuts =
      this.#snapshot.documentAccess === 'writer'
        ? attachEditorShortcutsV2(target.ownerDocument, (action) => {
            const isAvailable = this.isShortcutAvailable(action);
            if (this.#snapshot.status !== 'ready' || !isAvailable) {
              return false;
            }
            void this.dispatch(shortcutToEditorAction(action, this.#snapshot.activeTool));
            return true;
          })
        : null;
    this.#detachVisibilityFlush?.();
    if (this.#persistence || this.#cameraPersistence) {
      const flushWhenHidden = () => {
        if (target.ownerDocument.visibilityState === 'hidden') {
          void this.#persistence?.flush();
          void this.flushCamera();
        }
      };
      target.ownerDocument.addEventListener('visibilitychange', flushWhenHidden);
      this.#detachVisibilityFlush = () =>
        target.ownerDocument.removeEventListener('visibilitychange', flushWhenHidden);
    }
    this.#detachResize?.();
    const ResizeObserverConstructor = target.ownerDocument.defaultView?.ResizeObserver;
    if (ResizeObserverConstructor) {
      const observer = new ResizeObserverConstructor(() => {
        this.applyCameraToRenderer();
        void this.refreshFitCamera().catch((error: unknown) => {
          if (!this.#isDisposed) {
            this.setError(error);
          }
        });
      });
      observer.observe(target);
      this.#detachResize = () => observer.disconnect();
    }
    try {
      const update = await this.resolveTextMetrics(await this.#engine.currentUpdate());
      this.#documentId = update.scene.documentId;
      const fitCamera = await this.refreshFitCamera(false);
      const camera = await this.restoreCamera(update.scene.documentId, fitCamera);
      this.setCameraSnapshot(camera, false);
      this.applyCameraToRenderer();
      this.applyUpdate(update);
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  getSnapshot(): EditorUiSnapshotV1 {
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(action: EditorActionV1): Promise<EditorActionResultV1> {
    const operation = this.#queue.then(() => this.runAction(action));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  relinquishDocument(): Promise<void> {
    const operation = this.#queue.then(() => this.runRelinquishDocument());
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    this.#detachPointerInput?.();
    this.#detachPointerInput = null;
    this.#cameraInput?.detach();
    this.#cameraInput = null;
    this.#detachEditorShortcuts?.();
    this.#detachEditorShortcuts = null;
    this.#detachVisibilityFlush?.();
    this.#detachVisibilityFlush = null;
    this.#detachPersistence?.();
    this.#detachPersistence = null;
    this.#detachResize?.();
    this.#detachResize = null;
    this.#cameraTarget = null;
    this.#freehandInput.reset();
    this.#activeDocumentPointerId = null;
    this.#textEditor?.dispose();
    this.#textEditor = null;
    this.#textDraft = null;
    this.#listeners.clear();
    this.#renderer.unmount();
    const persistenceFlush = this.#persistence?.flush() ?? null;
    const cameraFlush = this.#cameraPersistence ? this.flushCamera() : null;
    this.#snapshot = { ...this.#snapshot, status: 'disposed' };
    const finalize = () => {
      this.#engine.dispose();
      this.#persistence?.dispose();
      return this.#onDispose?.();
    };
    if (persistenceFlush || cameraFlush) {
      void Promise.all([persistenceFlush, cameraFlush]).finally(finalize);
    } else {
      void finalize();
    }
  }

  private async runAction(action: EditorActionV1): Promise<EditorActionResultV1> {
    this.ensureActive();
    if (action.type === 'request_takeover') {
      return this.runTakeoverRequest();
    }
    if (action.type === 'retry_save') {
      if (!this.#persistence || this.#snapshot.documentAccess === 'readonly') {
        return { ok: false, snapshot: this.#snapshot };
      }
      await this.#persistence.retry();
      return { ok: this.#snapshot.saveStatus !== 'save_failed', snapshot: this.#snapshot };
    }
    if (action.type === 'retry_camera_save') {
      await this.savePendingCamera();
      return { ok: this.#snapshot.cameraSaveStatus !== 'save_failed', snapshot: this.#snapshot };
    }
    if (isCameraAction(action)) {
      return this.runCameraAction(action);
    }
    if (this.#snapshot.documentAccess === 'readonly') {
      return { ok: false, snapshot: this.#snapshot };
    }
    const startedAt = performance.now();
    try {
      const previousRevision = this.#snapshot.documentRevision;
      const execution = await this.executeAction(action);
      execution.update = await this.resolveTextMetrics(execution.update);
      const renderResult = this.applyUpdate(execution.update, false);
      if (this.#snapshot.documentRevision > previousRevision) {
        this.#persistence?.markCommitted(this.#snapshot.documentRevision);
      }
      await this.refreshFitCamera(false);
      this.emit();
      return {
        ok: true,
        snapshot: this.#snapshot,
        ...(execution.pointerMetrics ? { pointerMetrics: execution.pointerMetrics } : {}),
        ...(execution.strokeMetrics ? { strokeMetrics: execution.strokeMetrics } : {}),
        ...(execution.vertexMetrics ? { vertexMetrics: execution.vertexMetrics } : {}),
        performance: {
          inputToVisibleMs: performance.now() - startedAt,
          rendererApplyMs: renderResult.durationMs ?? 0,
          sceneBytes: new TextEncoder().encode(JSON.stringify(execution.update.scene)).byteLength,
          changedNodeCount: renderResult.changedNodeCount ?? 0,
        },
      };
    } catch (error) {
      this.setError(error);
      return { ok: false, snapshot: this.#snapshot };
    }
  }

  private async runTakeoverRequest(): Promise<EditorActionResultV1> {
    if (
      this.#snapshot.documentAccess !== 'readonly' ||
      this.#snapshot.readonlyReason !== 'held_elsewhere' ||
      !this.#requestDocumentTakeover ||
      !this.#reloadDocument ||
      this.#snapshot.takeoverStatus === 'requesting' ||
      this.#snapshot.takeoverStatus === 'reloading'
    ) {
      return { ok: false, snapshot: this.#snapshot };
    }
    this.#snapshot = {
      ...this.#snapshot,
      takeoverStatus: 'requesting',
      takeoverErrorMessage: null,
    };
    this.emit();
    try {
      await this.#requestDocumentTakeover();
      this.#snapshot = {
        ...this.#snapshot,
        takeoverStatus: 'reloading',
        takeoverErrorMessage: null,
      };
      this.emit();
      await this.#reloadDocument();
      return { ok: true, snapshot: this.#snapshot };
    } catch (error) {
      this.#snapshot = {
        ...this.#snapshot,
        takeoverStatus: 'failed',
        takeoverErrorMessage: takeoverErrorMessage(error),
      };
      this.emit();
      return { ok: false, snapshot: this.#snapshot };
    }
  }

  private async runRelinquishDocument(): Promise<void> {
    this.ensureActive();
    if (
      this.#snapshot.documentAccess === 'readonly' &&
      this.#snapshot.readonlyReason === 'taken_over'
    ) {
      return;
    }
    if (this.#snapshot.documentAccess !== 'writer') {
      throw new Error('当前页面没有可让出的编辑权。');
    }
    if (!this.#onRelinquishDocument) {
      throw new Error('当前宿主未提供安全的编辑权释放能力。');
    }
    if (this.#activeDocumentPointerId !== null || this.#textEditor) {
      throw new Error('当前页面正在编辑，请结束当前操作后重试接管。');
    }
    await this.#persistence?.flush();
    const persistenceSnapshot = this.#persistence?.getSnapshot() ?? null;
    if (
      persistenceSnapshot?.status === 'save_failed' ||
      (persistenceSnapshot &&
        persistenceSnapshot.pendingRevision > persistenceSnapshot.persistedRevision)
    ) {
      throw new Error(
        persistenceSnapshot.errorMessage
          ? `保存失败：${persistenceSnapshot.errorMessage}`
          : '最新改动尚未安全保存。',
      );
    }
    await this.#onRelinquishDocument();
    this.#detachPointerInput?.();
    this.#detachPointerInput = null;
    this.#detachEditorShortcuts?.();
    this.#detachEditorShortcuts = null;
    this.#detachPersistence?.();
    this.#detachPersistence = null;
    this.#activeDocumentPointerId = null;
    this.#freehandInput.reset();
    this.#cameraTarget?.removeAttribute('data-active-tool');
    this.#snapshot = {
      ...this.#snapshot,
      documentAccess: 'readonly',
      readonlyReason: 'taken_over',
      saveStatus: 'readonly',
      saveErrorMessage: null,
      takeoverStatus: 'idle',
      takeoverErrorMessage: null,
    };
    this.emit();
  }

  private async runCameraAction(action: EditorActionV1): Promise<EditorActionResultV1> {
    try {
      const cameraAction = this.resolveCameraAction(action);
      const camera = await this.#engine.applyCameraAction(cameraAction);
      if (cameraAction.type === 'fit_content') {
        this.#fitZoom = camera.zoom;
      }
      this.setCameraSnapshot(camera);
      this.applyCameraToRenderer();
      this.#textEditor?.updateCamera(camera);
      this.scheduleCameraSave(camera);
      return { ok: true, snapshot: this.#snapshot };
    } catch (error) {
      this.setError(error);
      return { ok: false, snapshot: this.#snapshot };
    }
  }

  private resolveCameraAction(action: EditorActionV1): CameraActionV1 {
    if (action.type === 'camera_action') {
      return action.action;
    }
    if (action.type === 'reset_camera') {
      return {
        type: 'fit_content',
        viewport: this.cameraViewportSize(),
        padding: CAMERA_FIT_PADDING,
      };
    }
    if (action.type === 'zoom_in' || action.type === 'zoom_out') {
      const size = this.cameraViewportSize();
      return {
        type: 'zoom_at',
        factor: action.type === 'zoom_in' ? CAMERA_ZOOM_STEP : 1 / CAMERA_ZOOM_STEP,
        anchor: { x: size.width / 2, y: size.height / 2 },
      };
    }
    throw new Error(`Unsupported Camera action: ${action.type}`);
  }

  private async restoreCamera(documentId: string, fitCamera: CameraV1): Promise<CameraV1> {
    try {
      const restored = await this.#cameraPersistence?.loadCamera(documentId);
      this.#snapshot = {
        ...this.#snapshot,
        cameraSaveStatus: 'saved',
        cameraSaveErrorMessage: null,
      };
      return await this.#engine.setCamera(restored ?? fitCamera);
    } catch (error) {
      const camera = await this.#engine.setCamera(fitCamera);
      this.#pendingCamera = camera;
      this.#snapshot = {
        ...this.#snapshot,
        cameraSaveStatus: 'save_failed',
        cameraSaveErrorMessage: errorMessage(error),
      };
      return camera;
    }
  }

  private setCameraSnapshot(camera: CameraV1, emit = true): void {
    this.#snapshot = {
      ...this.#snapshot,
      camera,
      cameraZoomPercent: relativeCameraZoomPercent(camera.zoom, this.#fitZoom),
    };
    if (emit) {
      this.emit();
    }
  }

  private applyCameraToRenderer(): void {
    if (!this.#cameraTarget) {
      return;
    }
    const size = this.cameraViewportSize();
    this.#renderer.setViewport({
      x: this.#snapshot.camera.x,
      y: this.#snapshot.camera.y,
      width: size.width / this.#snapshot.camera.zoom,
      height: size.height / this.#snapshot.camera.zoom,
    });
    this.applySelectionOverlay();
  }

  private cameraViewportSize(): { width: number; height: number } {
    const bounds = this.#cameraTarget?.getBoundingClientRect();
    return {
      width: positiveSize(bounds?.width, 960),
      height: positiveSize(bounds?.height, 640),
    };
  }

  private async refreshFitCamera(emit = true): Promise<CameraV1> {
    const fitCamera = await this.#engine.fitCamera(this.cameraViewportSize(), CAMERA_FIT_PADDING);
    this.#fitZoom = fitCamera.zoom;
    this.#snapshot = {
      ...this.#snapshot,
      cameraZoomPercent: relativeCameraZoomPercent(this.#snapshot.camera.zoom, this.#fitZoom),
    };
    if (emit) {
      this.emit();
    }
    return fitCamera;
  }

  private scheduleCameraSave(camera: CameraV1): void {
    if (!this.#cameraPersistence || !this.#documentId) {
      return;
    }
    this.#pendingCamera = camera;
    this.#snapshot = {
      ...this.#snapshot,
      cameraSaveStatus: 'dirty',
      cameraSaveErrorMessage: null,
    };
    this.emit();
    if (this.#cameraSaveTimer) {
      clearTimeout(this.#cameraSaveTimer);
    }
    this.#cameraSaveTimer = setTimeout(() => {
      this.#cameraSaveTimer = null;
      void this.savePendingCamera();
    }, 150);
  }

  private async savePendingCamera(): Promise<void> {
    if (this.#cameraSaveTimer) {
      clearTimeout(this.#cameraSaveTimer);
      this.#cameraSaveTimer = null;
    }
    if (this.#cameraSavePromise) {
      await this.#cameraSavePromise.catch(() => undefined);
    }
    if (!this.#cameraPersistence || !this.#documentId || !this.#pendingCamera) {
      return;
    }
    const camera = this.#pendingCamera;
    this.#pendingCamera = null;
    this.#snapshot = { ...this.#snapshot, cameraSaveStatus: 'saving' };
    this.emit();
    const save = this.#cameraPersistence.saveCamera(this.#documentId, camera);
    this.#cameraSavePromise = save;
    try {
      await save;
      this.#snapshot = {
        ...this.#snapshot,
        cameraSaveStatus: this.#pendingCamera ? 'dirty' : 'saved',
        cameraSaveErrorMessage: null,
      };
    } catch (error) {
      this.#pendingCamera ??= camera;
      this.#snapshot = {
        ...this.#snapshot,
        cameraSaveStatus: 'save_failed',
        cameraSaveErrorMessage: errorMessage(error),
      };
    } finally {
      this.#cameraSavePromise = null;
      this.emit();
    }
  }

  private async flushCamera(): Promise<void> {
    await this.savePendingCamera();
  }

  private async executeAction(action: EditorActionV1): Promise<ActionExecutionResult> {
    if (action.type === 'cancel_text_edit') {
      this.#textEditor?.cancel();
      return { update: await this.#engine.currentUpdate() };
    }
    if (action.type === 'undo') {
      return { update: await this.#engine.undo() };
    }
    if (action.type === 'redo') {
      return { update: await this.#engine.redo() };
    }
    if (action.type === 'clear_selection') {
      return { update: await this.#engine.setSelection([], null) };
    }
    if (action.type === 'select_all') {
      const primaryElementId = this.#rootElementIds.at(-1) ?? null;
      return {
        update: await this.#engine.setSelection([...this.#rootElementIds], primaryElementId),
      };
    }
    if (action.type === 'copy') {
      await this.copySelection();
      return { update: await this.#engine.currentUpdate() };
    }
    if (action.type === 'finish_shape_creation') {
      const pointerUpdate = await this.#engine.finishShapeCreation();
      return {
        update: pointerUpdate.update,
        pointerMetrics: {
          processedEventCount: pointerUpdate.processedEventCount,
          ignoredEventCount: pointerUpdate.ignoredEventCount,
          didCommit: pointerUpdate.didCommit,
        },
      };
    }
    if (action.type === 'remove_shape_creation_point') {
      return { update: await this.#engine.removeShapeCreationPoint() };
    }
    if (action.type === 'set_tool') {
      this.#freehandInput.reset();
      this.#activeDocumentPointerId = null;
      this.#textEditor?.cancel();
      return { update: await this.#engine.setActiveTool(action.tool) };
    }
    if (action.type === 'escape') {
      if (this.#textEditor) {
        this.#textEditor.cancel();
        return { update: await this.#engine.currentUpdate() };
      }
      this.#freehandInput.reset();
      this.#activeDocumentPointerId = null;
      return {
        update:
          this.#snapshot.activeTool !== 'select'
            ? await this.#engine.setActiveTool('select')
            : await this.#engine.setSelection([], null),
      };
    }
    if (!this.#documentId) {
      throw new Error('Editor must be mounted before dispatching document actions');
    }

    if (action.type === 'begin_text_edit') {
      const target = await this.#engine.beginTextEditAt(action.point);
      this.openTextEditor(target.element, action.point, target.update.selection.visualBounds);
      return { update: target.update };
    }
    if (action.type === 'insert_polyline_vertex') {
      const vertexUpdate = await this.#engine.insertPolylineVertexAt(
        action.point,
        this.#createId(),
      );
      return {
        update: vertexUpdate.update,
        vertexMetrics: { didCommit: vertexUpdate.didCommit },
      };
    }
    if (action.type === 'commit_text_edit') {
      return { update: await this.commitTextDraft(action.value) };
    }

    const commandId = this.#createId();
    if (action.type === 'pointer_events') {
      this.updateDocumentPointerState(action.events);
      const down = action.events.find((event) => event.phase === 'down');
      if (down && this.#textEditor) {
        this.#textEditor.commit();
        return { update: await this.#engine.currentUpdate() };
      }
      if (this.#snapshot.activeTool === 'freehand') {
        const batch = this.#freehandInput.convert(action.events, this.#createId);
        if (!batch) {
          return { update: await this.#engine.currentUpdate() };
        }
        const strokeUpdate = await this.#engine.handleStrokeBatch(batch, commandId, 'typed_array');
        return {
          update: strokeUpdate.update,
          strokeMetrics: {
            processedPointCount: strokeUpdate.processedPointCount,
            ignoredPointCount: strokeUpdate.ignoredPointCount,
            didCommit: strokeUpdate.didCommit,
          },
        };
      }
      if (this.#snapshot.activeTool === 'text') {
        if (down && !this.#textEditor) {
          const target = await this.#engine.beginTextEditAt(down.point);
          this.openTextEditor(target.element, down.point, target.update.selection.visualBounds);
          return { update: target.update };
        }
        return { update: await this.#engine.currentUpdate() };
      }
      const pointerUpdate = await this.#engine.handlePointerEvents(action.events, commandId);
      return {
        update: pointerUpdate.update,
        pointerMetrics: {
          processedEventCount: pointerUpdate.processedEventCount,
          ignoredEventCount: pointerUpdate.ignoredEventCount,
          didCommit: pointerUpdate.didCommit,
        },
      };
    }
    if (action.type === 'stroke_batch') {
      const strokeUpdate = await this.#engine.handleStrokeBatch(
        action.batch,
        commandId,
        action.transport,
      );
      return {
        update: strokeUpdate.update,
        strokeMetrics: {
          processedPointCount: strokeUpdate.processedPointCount,
          ignoredPointCount: strokeUpdate.ignoredPointCount,
          didCommit: strokeUpdate.didCommit,
        },
      };
    }
    if (action.type === 'cut') {
      await this.copySelection();
    }
    if (
      action.type === 'delete_selection' &&
      this.#snapshot.selectionHandles.some((handle) => handle.kind === 'vertex' && handle.selected)
    ) {
      const vertexUpdate = await this.#engine.deleteSelectedVertex(commandId);
      return {
        update: vertexUpdate.update,
        vertexMetrics: { didCommit: vertexUpdate.didCommit },
      };
    }
    const pastePayload = action.type === 'paste' ? await this.#clipboard.read() : null;
    if (action.type === 'paste' && pastePayload === null) {
      return { update: await this.#engine.currentUpdate() };
    }
    const nextPasteCascade = this.#pasteCascade + 1;
    const command: CommandEnvelopeV1['command'] =
      action.type === 'create_rectangle'
        ? {
            type: 'create_rectangle',
            rectangle: createRectangle(action.elementId ?? this.#createId(), action.position),
          }
        : action.type === 'create_ellipse'
          ? {
              type: 'create_ellipse',
              ellipse: createEllipse(action.elementId ?? this.#createId(), action.position),
            }
          : action.type === 'create_diamond'
            ? {
                type: 'create_diamond',
                diamond: createDiamond(action.elementId ?? this.#createId(), action.position),
              }
            : action.type === 'create_line'
              ? {
                  type: 'create_line',
                  line: createLine(action.elementId ?? this.#createId(), action.position),
                }
              : action.type === 'create_polyline'
                ? {
                    type: 'create_polyline',
                    polyline: createPolyline(action.elementId ?? this.#createId(), action.position),
                  }
                : action.type === 'create_arrow'
                  ? {
                      type: 'create_arrow',
                      arrow: createArrow(action.elementId ?? this.#createId(), action.position),
                    }
                  : action.type === 'move_active'
                    ? {
                        type: 'move_elements',
                        elementIds: this.requireSelection(),
                        delta: action.delta,
                      }
                    : action.type === 'update_selection_style'
                      ? {
                          type: 'update_element_style',
                          elementId: this.requireActiveElement(),
                          patch: action.patch,
                        }
                      : action.type === 'set_render_profile'
                        ? {
                            type: 'set_render_profile',
                            renderProfile:
                              action.profile === 'clean'
                                ? NODEINK_CLEAN_PROFILE
                                : NODEINK_SKETCH_PROFILE,
                          }
                        : action.type === 'group'
                          ? {
                              type: 'group_elements',
                              groupId: this.#createId(),
                              elementIds: this.requireSelection(2),
                            }
                          : action.type === 'ungroup'
                            ? { type: 'ungroup_elements', groupId: this.requireActiveElement() }
                            : action.type === 'reorder'
                              ? {
                                  type: 'reorder_elements',
                                  elementIds: this.requireSelection(),
                                  placement: action.placement,
                                }
                              : action.type === 'align'
                                ? {
                                    type: 'align_elements',
                                    elementIds: this.requireSelection(2),
                                    alignment: action.alignment,
                                  }
                                : action.type === 'paste'
                                  ? {
                                      type: 'paste_clipboard',
                                      payload: clipboardPayloadToString(pastePayload),
                                      idPrefix: `${commandId}-paste`,
                                      offset: {
                                        x:
                                          (PASTE_CASCADE_PX * nextPasteCascade) /
                                          this.#snapshot.camera.zoom,
                                        y:
                                          (PASTE_CASCADE_PX * nextPasteCascade) /
                                          this.#snapshot.camera.zoom,
                                      },
                                    }
                                  : action.type === 'delete_selection' || action.type === 'cut'
                                    ? {
                                        type: 'delete_elements',
                                        elementIds: this.requireSelection(),
                                      }
                                    : (() => {
                                        throw new Error(
                                          `Unsupported editor action: ${action.type}`,
                                        );
                                      })();
    const envelope: CommandEnvelopeV1 = {
      protocolVersion,
      commandId,
      documentId: this.#documentId,
      expectedRevision: this.#snapshot.documentRevision,
      command,
    };
    if (isCreateShapeAction(action) && this.#snapshot.activeTool !== 'select') {
      this.#freehandInput.reset();
      await this.#engine.setActiveTool('select');
    }
    const update = await this.#engine.executeCommand(envelope);
    if (action.type === 'paste') {
      this.#pasteCascade = nextPasteCascade;
    }
    return { update };
  }

  private openTextEditor(
    element: TextElementV1 | null,
    point: Vec2,
    selectionBounds: SelectionBoundsV1 | null,
  ): void {
    if (!this.#cameraTarget) {
      throw new Error('Editor must be mounted before editing text');
    }
    this.#textEditor?.cancel();
    const position = element
      ? {
          x: selectionBounds?.x ?? element.x,
          y: selectionBounds?.y ?? element.y,
        }
      : point;
    this.#textDraft = {
      element,
      position,
      initialValue: element?.text ?? '',
    };
    let overlay: TextEditorOverlayV1 | null = null;
    overlay = attachTextEditorOverlay({
      target: this.#cameraTarget,
      position,
      initialValue: this.#textDraft.initialValue,
      camera: this.#snapshot.camera,
      fontSize: element?.fontSize ?? NODEINK_DEFAULT_TEXT_SIZE,
      fontWeight: element?.fontWeight ?? 400,
      textAlign: element?.textAlign ?? NODEINK_DEFAULT_TEXT_STYLE.textAlign,
      color: element?.color ?? NODEINK_DEFAULT_TEXT_STYLE.color,
      onCommit: (value) => {
        if (this.#textEditor === overlay) {
          this.#textEditor = null;
        }
        void this.dispatch({ type: 'commit_text_edit', value });
      },
      onCancel: () => {
        if (this.#textEditor === overlay) {
          this.#textEditor = null;
          this.#textDraft = null;
        }
      },
    });
    if (element) {
      overlay.element.dataset.textElementId = element.id;
    }
    this.#textEditor = overlay;
  }

  private async commitTextDraft(value: string): Promise<EngineUpdateV1> {
    const draft = this.#textDraft;
    this.#textDraft = null;
    if (!draft || !this.#documentId) {
      return this.#engine.currentUpdate();
    }
    const normalizedValue = value.replace(/\r\n?/g, '\n');
    if (draft.element && normalizedValue === draft.initialValue) {
      return this.#engine.currentUpdate();
    }
    if (!draft.element && normalizedValue.length === 0) {
      return this.#engine.currentUpdate();
    }
    const commandId = this.#createId();
    const command: CommandEnvelopeV1['command'] = draft.element
      ? normalizedValue.length === 0
        ? { type: 'delete_elements', elementIds: [draft.element.id] }
        : {
            type: 'update_text',
            elementId: draft.element.id,
            patch: { text: normalizedValue },
          }
      : {
          type: 'create_text',
          text: {
            kind: 'text',
            id: this.#createId(),
            x: draft.position.x,
            y: draft.position.y,
            text: normalizedValue,
            fontFamily: NODEINK_CANVAS_FONT_FAMILY,
            fontSize: NODEINK_DEFAULT_TEXT_SIZE,
            fontWeight: 400,
            maxWidth: null,
            fontFingerprint: this.#textMetrics.fingerprint(),
            color: NODEINK_DEFAULT_TEXT_STYLE.color,
            textAlign: NODEINK_DEFAULT_TEXT_STYLE.textAlign,
            transform: identityTransform(),
          },
        };
    return this.#engine.executeCommand({
      protocolVersion,
      commandId,
      documentId: this.#documentId,
      expectedRevision: this.#snapshot.documentRevision,
      command,
    });
  }

  private async resolveTextMetrics(update: EngineUpdateV1): Promise<EngineUpdateV1> {
    let resolved = update;
    for (let attempt = 0; resolved.textMeasureRequest; attempt += 1) {
      if (attempt >= 32) {
        throw new Error('Text measurement did not converge');
      }
      const measured = this.#textMetrics.measure(resolved.textMeasureRequest);
      resolved = await this.#engine.provideTextMetrics(measured.snapshot);
    }
    return resolved;
  }

  private applyUpdate(
    update: EngineUpdateV1,
    emit = true,
  ): Extract<RenderApplyResultV1, { ok: true }> {
    const renderResult = this.#renderer.applySnapshot(update.scene);
    if (!renderResult.ok) {
      throw new Error(`Renderer rejected scene: ${renderResult.reason}`);
    }
    this.#documentId = update.scene.documentId;
    const serializedDocument = this.#engine.serializeDocument().document;
    const semanticElementIds = Object.keys(serializedDocument.elements);
    this.#rootElementIds = [...serializedDocument.rootOrder];
    this.#snapshot = {
      ...this.#snapshot,
      status: 'ready',
      documentRevision: update.scene.documentRevision,
      sceneRevision: update.scene.sceneRevision,
      elementCount: semanticElementIds.length,
      activeElementId: update.selection.primaryElementId,
      selectedElementIds: [...update.selection.selectedElementIds],
      primaryElementId: update.selection.primaryElementId,
      activeTool: update.activeTool,
      selectionBounds: update.selection.visualBounds,
      selectionOrientedBounds: update.selection.orientedBounds,
      selectionHandles: [...update.selection.handles],
      selectionMarquee: update.selection.marquee,
      alignmentGuides: [...update.selection.guides],
      selectionStyle: update.selection.style,
      renderProfile: update.scene.renderProfile,
      canUndo: update.history.canUndo,
      canRedo: update.history.canRedo,
      errorMessage: null,
    };
    this.applySelectionOverlay();
    if (this.#cameraTarget) {
      this.#cameraTarget.dataset.activeTool = update.activeTool;
    }
    if (emit) {
      this.emit();
    }
    return renderResult;
  }

  private setError(error: unknown): void {
    this.#snapshot = {
      ...this.#snapshot,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    this.emit();
  }

  private requireActiveElement(): string {
    if (!this.#snapshot.activeElementId) {
      throw new Error('Select an element before editing it');
    }
    return this.#snapshot.activeElementId;
  }

  private requireSelection(minimum = 1): string[] {
    if (this.#snapshot.selectedElementIds.length < minimum) {
      throw new Error(
        minimum === 1
          ? 'Select an element before editing it'
          : `Select at least ${minimum} elements`,
      );
    }
    return [...this.#snapshot.selectedElementIds];
  }

  private async copySelection(): Promise<void> {
    this.requireSelection();
    const payload = await this.#engine.copySelection();
    await this.#clipboard.write(payload.data);
    this.#pasteCascade = 0;
  }

  private isShortcutAvailable(action: EditorShortcutActionV2): boolean {
    if (action === 'undo') {
      return this.#snapshot.canUndo;
    }
    if (action === 'redo') {
      return this.#snapshot.canRedo;
    }
    if (action === 'select_all') {
      return this.#rootElementIds.length > 0;
    }
    if (action === 'finish_shape_creation') {
      return this.#snapshot.activeTool === 'polyline';
    }
    if (action === 'paste') {
      return true;
    }
    if (action === 'group_selection') {
      return this.#snapshot.selectedElementIds.length >= 2;
    }
    if (action === 'delete_selection') {
      return (
        this.#snapshot.activeTool === 'polyline' || this.#snapshot.selectedElementIds.length > 0
      );
    }
    if (
      action === 'copy_selection' ||
      action === 'cut_selection' ||
      action === 'ungroup_selection' ||
      action === 'bring_forward' ||
      action === 'send_backward' ||
      action === 'bring_to_front' ||
      action === 'send_to_back'
    ) {
      return this.#snapshot.selectedElementIds.length > 0;
    }
    return true;
  }

  private updateDocumentPointerState(events: NormalizedPointerEventV1[]): void {
    for (const event of events) {
      if (event.phase === 'down' && this.#activeDocumentPointerId === null) {
        this.#activeDocumentPointerId = event.pointerId;
      }
      if (
        (event.phase === 'up' || event.phase === 'cancel') &&
        event.pointerId === this.#activeDocumentPointerId
      ) {
        this.#activeDocumentPointerId = null;
      }
    }
  }

  private applySelectionOverlay(): void {
    this.#renderer.setOverlay({
      selectionBounds: this.#snapshot.selectionBounds,
      selectionOrientedBounds: this.#snapshot.selectionOrientedBounds,
      selectionHandles: this.#snapshot.selectionHandles,
      selectionPaddingWorld: SELECTION_GAP_PX / this.#snapshot.camera.zoom,
      marquee: this.#snapshot.selectionMarquee,
      guides: this.#snapshot.alignmentGuides,
    });
  }

  private ensureActive(): void {
    if (this.#isDisposed) {
      throw new Error('NodeInk editor has been disposed');
    }
  }

  private emit(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

export interface EditorPersistencePresentationV1 {
  statusLabel: string;
  notice: string | null;
  canRetrySave: boolean;
  canRequestTakeover: boolean;
  takeoverLabel: string;
}

export interface EditorCameraPresentationV1 {
  zoomLabel: string;
  fitContentTitle: string;
  fitContentAriaLabel: string;
}

export function getEditorCameraPresentation(
  snapshot: EditorUiSnapshotV1,
): EditorCameraPresentationV1 {
  const zoomLabel = `${snapshot.cameraZoomPercent}%`;
  return {
    zoomLabel,
    fitContentTitle: '回正并适应全部内容',
    fitContentAriaLabel: `回正并适应全部内容，当前 ${zoomLabel}`,
  };
}

export function getEditorPersistencePresentation(
  snapshot: EditorUiSnapshotV1,
): EditorPersistencePresentationV1 {
  const statusLabel = {
    saved: '已保存',
    dirty: '未保存',
    saving: '保存中…',
    save_failed: '保存失败',
    readonly: '只读',
  }[snapshot.saveStatus];
  const notice =
    snapshot.recovery === 'readonly_diagnostic'
      ? '无法安全打开此画布，原数据未被覆盖。'
      : snapshot.readonlyReason === 'recovered_fallback'
        ? '已恢复到上次稳定版本，原数据未被覆盖。'
        : snapshot.readonlyReason === 'migration_save_failed'
          ? '迁移结果未能安全保存，已只读打开。'
          : snapshot.readonlyReason === 'held_elsewhere'
            ? snapshot.takeoverStatus === 'requesting'
              ? '正在请求另一页面保存并让出编辑权…'
              : snapshot.takeoverStatus === 'reloading'
                ? '编辑权已让出，正在重新载入最新版本…'
                : '此画布已在另一页面打开。可以请求对方保存并让出编辑权。'
            : snapshot.readonlyReason === 'taken_over'
              ? '编辑权已转移到另一页面，本页面保持只读。'
              : snapshot.readonlyReason === 'unsupported'
                ? '当前浏览器无法保证安全写入，已只读打开。'
                : snapshot.recovery === 'migrated_head'
                  ? '文档已安全升级并保存。'
                  : null;
  return {
    statusLabel,
    notice,
    canRetrySave: snapshot.saveStatus === 'save_failed',
    canRequestTakeover:
      snapshot.status === 'ready' &&
      snapshot.readonlyReason === 'held_elsewhere' &&
      snapshot.takeoverAvailable &&
      (snapshot.takeoverStatus === 'idle' || snapshot.takeoverStatus === 'failed'),
    takeoverLabel: snapshot.takeoverStatus === 'failed' ? '重新接管' : '接管编辑权',
  };
}

interface ActionExecutionResult {
  update: EngineUpdateV1;
  pointerMetrics?: Pick<PointerUpdateV1, 'processedEventCount' | 'ignoredEventCount' | 'didCommit'>;
  strokeMetrics?: Pick<StrokeUpdateV1, 'processedPointCount' | 'ignoredPointCount' | 'didCommit'>;
  vertexMetrics?: Pick<VertexEditUpdateV1, 'didCommit'>;
}

interface TextEditingDraftV1 {
  element: TextElementV1 | null;
  position: Vec2;
  initialValue: string;
}

export { runPointerBenchmark } from './pointer-benchmark';
export type { PointerBenchmarkOptions, PointerBenchmarkResult } from './pointer-benchmark';
export { runStrokeBenchmark } from './stroke-benchmark';
export type {
  StrokeBenchmarkCaseV1,
  StrokeBenchmarkOptionsV1,
  StrokeBenchmarkReportV1,
  StrokeBenchmarkVariantResultV1,
} from './stroke-benchmark';
export {
  NODEINK_CANVAS_FONT_EPOCH,
  NODEINK_CANVAS_FONT_FAMILY,
  NODEINK_DEFAULT_TEXT_SIZE,
} from './text-font';
export {
  NODEINK_CLEAN_PROFILE,
  NODEINK_COLOR_PRESETS,
  NODEINK_DEFAULT_LINE_STYLE,
  NODEINK_DEFAULT_RECT_STYLE,
  NODEINK_DEFAULT_STROKE_STYLE,
  NODEINK_DEFAULT_TEXT_STYLE,
  NODEINK_FILL_PRESETS,
  NODEINK_SIZE_PRESETS,
  NODEINK_SKETCH_PROFILE,
  NODEINK_TEXT_ALIGN_PRESETS,
  NODEINK_TEXT_SIZE_PRESETS,
  fillPresetMatches,
} from './style-presets';
export { attachImeComposition } from './ime-input';
export type { ImeCompositionBindingV1, ImeCompositionStateV1 } from './ime-input';
export { CanvasTextMetricsAdapter } from './text-metrics';
export type { CanvasTextMetricsAdapterOptions, TextMeasureBatchResultV1 } from './text-metrics';
export { defaultClipboardPort, MemoryClipboardPortV1 } from './clipboard-port';
export type { ClipboardPayloadV1, ClipboardPortV1 } from './clipboard-port';
export type {
  ElementSizeV1,
  ElementStylePatchV1,
  SelectionStyleV1,
} from '@nodeink-internal/protocol';

function createRectangle(
  id: string,
  position: { x: number; y: number } | undefined,
): RectElementV1 {
  return {
    kind: 'rect',
    id,
    x: position?.x ?? 80,
    y: position?.y ?? 72,
    width: 176,
    height: 104,
    fill: NODEINK_DEFAULT_RECT_STYLE.fill,
    stroke: NODEINK_DEFAULT_RECT_STYLE.stroke,
    size: NODEINK_DEFAULT_RECT_STYLE.size,
    transform: identityTransform(),
  };
}

function createEllipse(
  id: string,
  position: { x: number; y: number } | undefined,
): EllipseElementV1 {
  return {
    kind: 'ellipse',
    id,
    x: position?.x ?? 80,
    y: position?.y ?? 72,
    width: 176,
    height: 104,
    fill: NODEINK_DEFAULT_RECT_STYLE.fill,
    stroke: NODEINK_DEFAULT_RECT_STYLE.stroke,
    size: NODEINK_DEFAULT_RECT_STYLE.size,
    transform: identityTransform(),
  };
}

function createDiamond(
  id: string,
  position: { x: number; y: number } | undefined,
): DiamondElementV1 {
  return {
    kind: 'diamond',
    id,
    x: position?.x ?? 80,
    y: position?.y ?? 72,
    width: 176,
    height: 104,
    fill: NODEINK_DEFAULT_RECT_STYLE.fill,
    stroke: NODEINK_DEFAULT_RECT_STYLE.stroke,
    size: NODEINK_DEFAULT_RECT_STYLE.size,
    transform: identityTransform(),
  };
}

function createLine(id: string, position: { x: number; y: number } | undefined): LineElementV1 {
  const origin = position ?? { x: 80, y: 72 };
  return {
    kind: 'line',
    id,
    points: [
      { x: origin.x, y: origin.y + 88 },
      { x: origin.x + 176, y: origin.y + 16 },
    ],
    curve: null,
    stroke: NODEINK_DEFAULT_LINE_STYLE.stroke,
    size: NODEINK_DEFAULT_LINE_STYLE.size,
    transform: identityTransform(),
  };
}

function createPolyline(
  id: string,
  position: { x: number; y: number } | undefined,
): PolylineElementV1 {
  const origin = position ?? { x: 80, y: 72 };
  return {
    kind: 'polyline',
    id,
    points: [
      { x: origin.x, y: origin.y + 88 },
      { x: origin.x + 80, y: origin.y + 8 },
      { x: origin.x + 176, y: origin.y + 72 },
    ],
    stroke: NODEINK_DEFAULT_LINE_STYLE.stroke,
    size: NODEINK_DEFAULT_LINE_STYLE.size,
    transform: identityTransform(),
  };
}

function createArrow(id: string, position: { x: number; y: number } | undefined): ArrowElementV1 {
  const origin = position ?? { x: 80, y: 72 };
  return {
    kind: 'arrow',
    id,
    points: [
      { x: origin.x, y: origin.y + 72 },
      { x: origin.x + 176, y: origin.y + 16 },
    ],
    curve: null,
    stroke: NODEINK_DEFAULT_LINE_STYLE.stroke,
    size: NODEINK_DEFAULT_LINE_STYLE.size,
    transform: identityTransform(),
  };
}

function isCreateShapeAction(action: EditorActionV1): action is Extract<
  EditorActionV1,
  {
    type:
      | 'create_rectangle'
      | 'create_ellipse'
      | 'create_diamond'
      | 'create_line'
      | 'create_polyline'
      | 'create_arrow';
  }
> {
  return (
    action.type === 'create_rectangle' ||
    action.type === 'create_ellipse' ||
    action.type === 'create_diamond' ||
    action.type === 'create_line' ||
    action.type === 'create_polyline' ||
    action.type === 'create_arrow'
  );
}

function identityTransform() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as const;
}

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

function shortcutToEditorAction(
  action: EditorShortcutActionV2,
  activeTool: EditorToolV1,
): EditorActionV1 {
  switch (action) {
    case 'select_tool':
      return { type: 'set_tool', tool: 'select' };
    case 'freehand_tool':
      return { type: 'set_tool', tool: 'freehand' };
    case 'text_tool':
      return { type: 'set_tool', tool: 'text' };
    case 'finish_shape_creation':
      return { type: 'finish_shape_creation' };
    case 'delete_selection':
      return activeTool === 'polyline'
        ? { type: 'remove_shape_creation_point' }
        : { type: 'delete_selection' };
    case 'copy_selection':
      return { type: 'copy' };
    case 'cut_selection':
      return { type: 'cut' };
    case 'group_selection':
      return { type: 'group' };
    case 'ungroup_selection':
      return { type: 'ungroup' };
    case 'bring_forward':
      return { type: 'reorder', placement: 'forward' };
    case 'send_backward':
      return { type: 'reorder', placement: 'backward' };
    case 'bring_to_front':
      return { type: 'reorder', placement: 'front' };
    case 'send_to_back':
      return { type: 'reorder', placement: 'back' };
    default:
      return { type: action };
  }
}

function clipboardPayloadToString(payload: BrowserClipboardPayloadV1 | null): string {
  if (payload === null) {
    throw new Error('Clipboard is empty');
  }
  return typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
}

function isCameraAction(action: EditorActionV1): boolean {
  return (
    action.type === 'camera_action' ||
    action.type === 'zoom_in' ||
    action.type === 'zoom_out' ||
    action.type === 'reset_camera'
  );
}

function positiveSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function relativeCameraZoomPercent(zoom: number, fitZoom: number): number {
  return Math.round((zoom / fitZoom) * 100);
}

function takeoverErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'request_timeout') {
      return '另一页面未响应接管请求，请结束正在进行的操作后重试。';
    }
    if (error.code === 'disposed') {
      return '接管请求已取消。';
    }
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
