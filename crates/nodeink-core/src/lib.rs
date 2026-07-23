use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod camera;
mod clipboard;
mod hierarchy;
mod migration;
mod operation;
mod pointer;
mod scene_patch;
mod selection;
mod selection_geometry;
mod sketch;
mod snapping;
mod stroke;
mod stroke_geometry;
mod style;
mod text;
mod tool;
mod transform;

use camera::CameraContentBounds;
pub use camera::{CameraActionV1, CameraV1, CameraViewportV1, MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM};
pub use clipboard::ClipboardPayloadV1;
use hierarchy::Hierarchy;
pub use migration::{
    MigrationAttemptV1, MigrationReportV1, MigrationResultV1, migrate_document_payload,
};
use operation::validate_operation_batch;
pub use operation::{
    DiagramOperationBatchResultV1, DiagramOperationBatchV1, DiagramOperationModeV1,
    DiagramOperationResultV1, DiagramOperationStatusV1, DiagramOperationV1,
    MAX_OPERATION_BATCH_SIZE, RectanglePatchV1,
};
pub use pointer::{NormalizedPointerEventV1, PointerModifiersV1, PointerPhaseV1};
use pointer::{
    PointerMachine, PointerPreview, PointerSelectionChange, PointerTransformKind,
    PointerTransformPreview, PointerTransition, TargetedPointerEvent,
};
pub use scene_patch::{ScenePatchV1, benchmark_scene_patch, benchmark_scene_snapshot, diff_scene};
pub use selection::{
    AlignmentGuideAxisV1, AlignmentGuideV1, OrientedSelectionBoundsV1, SelectionBoundsV1,
    SelectionHandleIdV1, SelectionHandleTypeV1, SelectionHandleV1, SelectionMarqueeModeV1,
    SelectionMarqueeV1, SelectionStateV1,
};
use selection::{HitTestMode, SelectionModel, hit_test_document, hit_test_document_with_mode};
use selection_geometry::VisualAabb;
pub use sketch::{ENGINE_ALGORITHM_VERSION, RenderProfileV1, SketchFillStyleV1};
use sketch::{sketch_rectangle, sketch_stroke};
pub use stroke::{StrokeInputBatchV1, StrokePhaseV1};
use stroke::{StrokeMachine, StrokePreview, StrokeTransition};
use stroke_geometry::{resolved_stroke_path_data, stroke_visual_bounds};
pub use style::{
    DEFAULT_INK_COLOR, DEFAULT_RECTANGLE_FILL_COLOR, DEFAULT_RECTANGLE_STROKE_COLOR,
    DEFAULT_RECTANGLE_STROKE_WIDTH, DEFAULT_STROKE_WIDTH, ElementStylePatchV1, FillV1,
    SelectionStyleV1, TextAlignV1, TextAnchorV1,
};
use style::{aligned_text_x, is_canonical_color, is_valid_font_size, is_valid_stroke_width};
pub use text::{
    CANVAS_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE, DEFAULT_TEXT_FONT_WEIGHT, ResolvedTextRunV1,
    TextFixtureResolutionV1, TextFixtureSceneV1, TextMeasureRequestV1, TextMetricsSnapshotV1,
    TextMetricsV1, TextRunV1,
};
use text::{TextMetricsCache, resolve_text_fixture, scene_runs};
pub use tool::EditorToolV1;
use tool::ToolState;
pub use transform::Affine2D;
use transform::Point2D;

pub const PROTOCOL_VERSION: u32 = 1;
pub const SCHEMA_VERSION: u32 = 3;

pub type DocumentId = String;
pub type ElementId = String;
pub type SceneNodeId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInkDocumentV1 {
    pub schema_version: u32,
    pub document_id: DocumentId,
    pub revision: u64,
    pub render_profile: RenderProfileV1,
    pub root_order: Vec<ElementId>,
    pub elements: BTreeMap<ElementId, ElementRecordV1>,
}

impl NodeInkDocumentV1 {
    pub fn blank(document_id: impl Into<DocumentId>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            document_id: document_id.into(),
            revision: 0,
            render_profile: RenderProfileV1::clean(),
            root_order: Vec::new(),
            elements: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ElementRecordV1 {
    Rect(RectElementV1),
    Stroke(StrokeElementV1),
    Text(TextElementV1),
    Group(GroupElementV1),
}

impl ElementRecordV1 {
    pub fn id(&self) -> &str {
        match self {
            Self::Rect(rectangle) => &rectangle.id,
            Self::Stroke(stroke) => &stroke.id,
            Self::Text(text) => &text.id,
            Self::Group(group) => &group.id,
        }
    }

    pub(crate) fn as_text(&self) -> Option<&TextElementV1> {
        match self {
            Self::Text(text) => Some(text),
            Self::Rect(_) | Self::Stroke(_) | Self::Group(_) => None,
        }
    }

    fn transform(&self) -> Affine2D {
        match self {
            Self::Rect(rectangle) => rectangle.transform,
            Self::Stroke(stroke) => stroke.transform,
            Self::Text(text) => text.transform,
            Self::Group(group) => group.transform,
        }
    }

    fn set_transform(&mut self, transform: Affine2D) {
        match self {
            Self::Rect(rectangle) => rectangle.transform = transform,
            Self::Stroke(stroke) => stroke.transform = transform,
            Self::Text(text) => text.transform = transform,
            Self::Group(group) => group.transform = transform,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectElementV1 {
    pub id: ElementId,
    pub transform: Affine2D,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: FillV1,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeElementV1 {
    pub id: ElementId,
    pub transform: Affine2D,
    pub points: Vec<Vec2>,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextElementV1 {
    pub id: ElementId,
    pub transform: Affine2D,
    pub x: f64,
    pub y: f64,
    pub text: String,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub color: String,
    pub text_align: TextAlignV1,
    pub max_width: Option<f64>,
    pub font_fingerprint: String,
}

impl TextElementV1 {
    pub fn new(
        id: impl Into<ElementId>,
        x: f64,
        y: f64,
        text: impl Into<String>,
        font_fingerprint: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            transform: Affine2D::identity(),
            x,
            y,
            text: text.into(),
            font_family: CANVAS_FONT_FAMILY.to_string(),
            font_size: DEFAULT_TEXT_FONT_SIZE,
            font_weight: DEFAULT_TEXT_FONT_WEIGHT,
            color: DEFAULT_INK_COLOR.to_string(),
            text_align: TextAlignV1::Start,
            max_width: None,
            font_fingerprint: font_fingerprint.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupElementV1 {
    pub id: ElementId,
    pub transform: Affine2D,
    pub child_order: Vec<ElementId>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPatchV1 {
    pub text: Option<String>,
    pub max_width: Option<Option<f64>>,
}

impl TextPatchV1 {
    fn is_empty(&self) -> bool {
        self.text.is_none() && self.max_width.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelopeV1 {
    pub protocol_version: u32,
    pub command_id: String,
    pub document_id: DocumentId,
    pub expected_revision: u64,
    pub command: CommandV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CommandV1 {
    CreateRectangle {
        rectangle: RectElementV1,
    },
    MoveElements {
        element_ids: Vec<ElementId>,
        delta: Vec2,
    },
    CreateStroke {
        stroke: StrokeElementV1,
    },
    CreateText {
        text: TextElementV1,
    },
    UpdateText {
        element_id: ElementId,
        patch: TextPatchV1,
    },
    UpdateRectangle {
        element_id: ElementId,
        patch: RectanglePatchV1,
    },
    UpdateElementStyle {
        element_id: ElementId,
        patch: ElementStylePatchV1,
    },
    SetRenderProfile {
        render_profile: RenderProfileV1,
    },
    TransformElements {
        element_ids: Vec<ElementId>,
        transform: Affine2D,
    },
    GroupElements {
        group_id: ElementId,
        element_ids: Vec<ElementId>,
    },
    UngroupElements {
        group_id: ElementId,
    },
    ReorderElements {
        element_ids: Vec<ElementId>,
        placement: ReorderPlacementV1,
    },
    AlignElements {
        element_ids: Vec<ElementId>,
        alignment: AlignmentV1,
    },
    PasteClipboard {
        payload: String,
        id_prefix: String,
        offset: Vec2,
    },
    DeleteElements {
        element_ids: Vec<ElementId>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReorderPlacementV1 {
    Front,
    Forward,
    Backward,
    Back,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignmentV1 {
    Left,
    Center,
    Right,
    Top,
    Middle,
    Bottom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResultV1 {
    pub command_id: String,
    pub previous_revision: u64,
    pub revision: u64,
    pub changed_element_ids: Vec<ElementId>,
    pub scene_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStateV1 {
    pub can_undo: bool,
    pub can_redo: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUpdateV1 {
    pub operation: Option<OperationResultV1>,
    pub scene: SceneSnapshotV1,
    pub history: HistoryStateV1,
    pub selection: SelectionStateV1,
    pub active_tool: EditorToolV1,
    pub text_measure_request: Option<TextMeasureRequestV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEditTargetV1 {
    #[serde(serialize_with = "serialize_optional_text_edit_element")]
    pub element: Option<TextElementV1>,
    pub update: EngineUpdateV1,
}

fn serialize_optional_text_edit_element<S>(
    element: &Option<TextElementV1>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    let Some(element) = element else {
        return serializer.serialize_none();
    };
    let mut value = serde_json::to_value(element).map_err(serde::ser::Error::custom)?;
    value
        .as_object_mut()
        .expect("TextElementV1 serializes as an object")
        .insert(
            "kind".to_string(),
            serde_json::Value::String("text".to_string()),
        );
    value.serialize(serializer)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerUpdateV1 {
    pub update: EngineUpdateV1,
    pub processed_event_count: usize,
    pub ignored_event_count: usize,
    pub did_commit: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeUpdateV1 {
    pub update: EngineUpdateV1,
    pub processed_point_count: usize,
    pub ignored_point_count: usize,
    pub did_commit: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshotV1 {
    pub protocol_version: u32,
    pub document_id: DocumentId,
    pub document_revision: u64,
    pub scene_revision: u64,
    pub render_profile: RenderProfileV1,
    pub root_node_ids: Vec<SceneNodeId>,
    pub nodes: BTreeMap<SceneNodeId, SceneNodeV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneResolutionV1 {
    pub engine_algorithm_version: String,
    pub render_profile: RenderProfileV1,
    pub canonical_hash: String,
    pub scene: SceneSnapshotV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SceneNodeV1 {
    Rect(SceneRectV1),
    Path(ScenePathV1),
    Text(SceneTextV1),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneRectV1 {
    pub id: SceneNodeId,
    pub source_element_id: ElementId,
    pub transform: Affine2D,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePathV1 {
    pub id: SceneNodeId,
    pub source_element_id: ElementId,
    pub transform: Affine2D,
    pub path_data: String,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneTextV1 {
    pub id: SceneNodeId,
    pub source_element_id: ElementId,
    pub transform: Affine2D,
    pub runs: Vec<SceneTextRunV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneTextRunV1 {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub fill: String,
    pub text_anchor: TextAnchorV1,
}

#[derive(Debug, Clone, PartialEq, Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum EngineErrorV1 {
    #[error("unsupported protocol version {actual}")]
    UnsupportedProtocol { actual: u32 },
    #[error("unsupported schema version {actual}")]
    UnsupportedSchema { actual: u32 },
    #[error("document id does not match the open document")]
    DocumentMismatch,
    #[error("expected revision {expected}, actual revision {actual}")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("element {element_id} already exists")]
    ElementAlreadyExists { element_id: ElementId },
    #[error("element {element_id} was not found")]
    ElementNotFound { element_id: ElementId },
    #[error("invalid rectangle geometry for {element_id}")]
    InvalidRectangle { element_id: ElementId },
    #[error("invalid movement delta")]
    InvalidDelta,
    #[error("invalid camera state")]
    InvalidCamera,
    #[error("invalid camera action")]
    InvalidCameraAction,
    #[error("invalid stroke geometry for {element_id}")]
    InvalidStroke { element_id: ElementId },
    #[error("invalid stroke input: {reason}")]
    InvalidStrokeInput { reason: String },
    #[error("active tool {active_tool:?} cannot handle {required_tool:?} input")]
    ToolInputMismatch {
        active_tool: EditorToolV1,
        required_tool: EditorToolV1,
    },
    #[error("invalid render profile")]
    InvalidRenderProfile,
    #[error("invalid element style for {element_id}")]
    InvalidElementStyle { element_id: ElementId },
    #[error("invalid clipboard payload")]
    InvalidClipboard,
    #[error("invalid affine transform for {element_id}")]
    InvalidTransform { element_id: ElementId },
    #[error("invalid element hierarchy: {reason}")]
    InvalidHierarchy { reason: String },
    #[error("style patch kind does not match element {element_id}")]
    ElementStyleKindMismatch { element_id: ElementId },
    #[error("invalid text measurement fixture")]
    InvalidTextFixture,
    #[error("text metrics fingerprint does not match the request")]
    TextFingerprintMismatch,
    #[error("invalid product text metrics")]
    InvalidTextMetrics,
    #[error("invalid text element {element_id}")]
    InvalidText { element_id: ElementId },
    #[error("invalid benchmark fixture")]
    InvalidBenchmarkFixture,
    #[error("invalid operation batch: {reason}")]
    InvalidOperationBatch { reason: String },
    #[error("element {element_id} is not a rectangle")]
    ElementNotRectangle { element_id: ElementId },
    #[error("element {element_id} is not text")]
    ElementNotText { element_id: ElementId },
    #[error("undo history is empty")]
    UndoUnavailable,
    #[error("redo history is empty")]
    RedoUnavailable,
    #[error("document structure is invalid: {reason}")]
    InvalidDocument { reason: String },
}

#[derive(Debug, Clone)]
pub struct Engine {
    document: NodeInkDocumentV1,
    camera: CameraV1,
    scene_revision: u64,
    undo_stack: Vec<NodeInkDocumentV1>,
    redo_stack: Vec<NodeInkDocumentV1>,
    selection: SelectionModel,
    tool_state: ToolState,
    pointer_machine: PointerMachine,
    stroke_machine: StrokeMachine,
    text_metrics: TextMetricsCache,
}

impl Engine {
    pub fn open(document: NodeInkDocumentV1) -> Result<Self, EngineErrorV1> {
        validate_document(&document)?;
        Ok(Self {
            document,
            camera: CameraV1::default(),
            scene_revision: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            selection: SelectionModel::default(),
            tool_state: ToolState::default(),
            pointer_machine: PointerMachine::default(),
            stroke_machine: StrokeMachine::default(),
            text_metrics: TextMetricsCache::default(),
        })
    }

    pub fn document(&self) -> &NodeInkDocumentV1 {
        &self.document
    }

    pub fn camera(&self) -> CameraV1 {
        self.camera
    }

    pub fn set_camera(&mut self, camera: CameraV1) -> Result<CameraV1, EngineErrorV1> {
        self.camera = camera.validate()?;
        Ok(self.camera)
    }

    pub fn fit_camera(
        &self,
        viewport: CameraViewportV1,
        padding: f64,
    ) -> Result<CameraV1, EngineErrorV1> {
        CameraV1::fit_content(
            document_content_bounds(&self.document, &self.text_metrics),
            viewport,
            padding,
        )
    }

    pub fn apply_camera_action(
        &mut self,
        action: CameraActionV1,
    ) -> Result<CameraV1, EngineErrorV1> {
        self.camera = match action {
            CameraActionV1::FitContent { viewport, padding } => {
                self.fit_camera(viewport, padding)?
            }
            navigation => self.camera.apply_navigation(navigation)?,
        };
        Ok(self.camera)
    }

    pub fn execute_command(
        &mut self,
        envelope: CommandEnvelopeV1,
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        if matches!(&envelope.command, CommandV1::CreateText { text } if text.text.is_empty()) {
            self.validate_envelope(&envelope)?;
            return Ok(self.current_update());
        }
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        let selection_after =
            selection_after_command(&envelope.command, &self.selection, &self.document);
        self.execute_command_without_pointer_reset(envelope, selection_after)
    }

    pub fn execute_diagram_operation(
        &mut self,
        batch: DiagramOperationBatchV1,
    ) -> Result<DiagramOperationBatchResultV1, EngineErrorV1> {
        validate_operation_batch(&batch)?;
        self.validate_transaction_header(batch.document_id.as_str(), batch.expected_revision)?;

        let previous_scene = self.current_update().scene;
        let previous_revision = self.document.revision;
        let batch_id = batch.batch_id;
        let mode = batch.mode;
        let op_ids = batch
            .operations
            .iter()
            .map(|operation| operation.op_id().to_string())
            .collect::<Vec<_>>();
        let commands = batch
            .operations
            .into_iter()
            .map(DiagramOperationV1::into_command)
            .collect();
        let (candidate, effects) = self.prepare_transaction(commands)?;
        let affected_by_operation = effects
            .iter()
            .map(|effect| effect.changed_element_ids.clone())
            .collect::<Vec<_>>();
        let status = match mode {
            DiagramOperationModeV1::Apply => DiagramOperationStatusV1::Applied,
            DiagramOperationModeV1::DryRun => DiagramOperationStatusV1::Planned,
        };
        let results = op_ids
            .into_iter()
            .zip(affected_by_operation.iter().cloned())
            .map(|(op_id, affected_element_ids)| DiagramOperationResultV1 {
                op_id,
                status,
                affected_element_ids,
            })
            .collect();

        let (revision, next_scene) = match mode {
            DiagramOperationModeV1::Apply => {
                self.pointer_machine.cancel();
                self.stroke_machine.cancel();
                let changed_element_ids = unique_element_ids(&affected_by_operation);
                let update = self.commit_transaction(
                    batch_id.clone(),
                    candidate,
                    changed_element_ids,
                    SelectionAfterCommand::Preserve,
                );
                (Some(update.scene.document_revision), update.scene)
            }
            DiagramOperationModeV1::DryRun => (
                None,
                resolve_scene(
                    &candidate,
                    self.scene_revision + 1,
                    None,
                    None,
                    &candidate.render_profile,
                    &self.text_metrics,
                ),
            ),
        };

        Ok(DiagramOperationBatchResultV1 {
            batch_id,
            mode,
            previous_revision,
            revision,
            results,
            scene_patch: diff_scene(&previous_scene, &next_scene),
        })
    }

    pub fn handle_pointer_events(
        &mut self,
        command_id: String,
        events: Vec<NormalizedPointerEventV1>,
    ) -> Result<PointerUpdateV1, EngineErrorV1> {
        self.validate_active_tool(EditorToolV1::Select)?;
        self.stroke_machine.cancel();
        let selection_state =
            self.selection
                .snapshot(&self.document, None, &self.text_metrics, self.camera.zoom);
        let targeted_events = events
            .into_iter()
            .map(|input| {
                let is_down = input.phase == PointerPhaseV1::Down;
                let target_handle = is_down
                    .then(|| hit_selection_handle(&selection_state, input.point, self.camera.zoom))
                    .flatten();
                let target_element_id = (is_down && target_handle.is_none())
                    .then(|| {
                        hit_test_document_with_mode(
                            &self.document,
                            input.point,
                            self.camera.zoom,
                            &self.text_metrics,
                            if input.modifiers.meta_or_ctrl {
                                HitTestMode::PierceLeaf
                            } else {
                                HitTestMode::OutermostGroup
                            },
                        )
                    })
                    .flatten();
                TargetedPointerEvent {
                    input,
                    target_element_id,
                    selected_element_ids: selection_state.selected_element_ids.clone(),
                    target_handle,
                    oriented_bounds: selection_state.oriented_bounds,
                }
            })
            .collect();
        let outcome = self
            .pointer_machine
            .process_batch(self.document.revision, targeted_events);
        if let Some(selection_change) = outcome.selection_change {
            match selection_change {
                PointerSelectionChange::Replace(element_id) => {
                    self.selection.set_single(&self.document, element_id)?;
                }
                PointerSelectionChange::Toggle(element_id) => {
                    self.selection
                        .apply_hit(&self.document, Some(element_id), true)?;
                }
            }
        }
        let (update, did_commit) = match outcome.transition {
            PointerTransition::None => (self.current_update(), false),
            PointerTransition::Preview(PointerPreview::Marquee { bounds, mode }) => {
                self.selection.update_marquee(bounds, mode)?;
                self.scene_revision += 1;
                (self.current_update(), false)
            }
            PointerTransition::Preview(PointerPreview::Transform(preview)) => {
                let preview = self.resolve_pointer_transform_preview(preview)?;
                self.selection.set_guides(preview_guides(
                    &self.document,
                    &preview,
                    &self.text_metrics,
                ))?;
                self.scene_revision += 1;
                (
                    self.update_with_preview(Some(&PointerPreview::Transform(preview))),
                    false,
                )
            }
            PointerTransition::Cancelled => {
                self.selection.clear_marquee();
                self.selection.clear_guides();
                self.scene_revision += 1;
                (self.current_update(), false)
            }
            PointerTransition::MarqueeCommit { bounds, mode } => {
                self.selection
                    .apply_marquee(&self.document, bounds, mode, &self.text_metrics)?;
                self.selection.clear_marquee();
                self.scene_revision += 1;
                (self.current_update(), false)
            }
            PointerTransition::Commit(commit) => {
                if commit.transform == Affine2D::identity() {
                    self.selection.clear_guides();
                    self.scene_revision += 1;
                    return Ok(PointerUpdateV1 {
                        update: self.current_update(),
                        processed_event_count: outcome.processed_event_count,
                        ignored_event_count: outcome.ignored_event_count,
                        did_commit: false,
                    });
                }
                let preview = self.resolve_pointer_transform_preview(PointerTransformPreview {
                    element_ids: commit.element_ids,
                    transform: commit.transform,
                    kind: commit.kind,
                    disable_snap: commit.disable_snap,
                })?;
                self.selection.clear_guides();
                if preview.transform == Affine2D::identity() {
                    self.scene_revision += 1;
                    (self.current_update(), false)
                } else {
                    let envelope = CommandEnvelopeV1 {
                        protocol_version: PROTOCOL_VERSION,
                        command_id,
                        document_id: self.document.document_id.clone(),
                        expected_revision: commit.expected_revision,
                        command: CommandV1::TransformElements {
                            element_ids: preview.element_ids,
                            transform: preview.transform,
                        },
                    };
                    (
                        self.execute_command_without_pointer_reset(
                            envelope,
                            SelectionAfterCommand::Preserve,
                        )?,
                        true,
                    )
                }
            }
        };

        Ok(PointerUpdateV1 {
            update,
            processed_event_count: outcome.processed_event_count,
            ignored_event_count: outcome.ignored_event_count,
            did_commit,
        })
    }

    fn resolve_pointer_transform_preview(
        &self,
        mut preview: PointerTransformPreview,
    ) -> Result<PointerTransformPreview, EngineErrorV1> {
        if preview.kind != PointerTransformKind::Move || preview.disable_snap {
            return Ok(preview);
        }
        let selected = selected_roots(&self.document, preview.element_ids.clone())?;
        let hierarchy = document_hierarchy(&self.document)?;
        let world_transforms = resolved_world_transforms(&self.document, None)?;
        let selected_set = selected.iter().cloned().collect::<BTreeSet<_>>();
        let Some(base_bounds) = selected
            .iter()
            .filter_map(|element_id| {
                element_world_bounds(
                    &self.document,
                    element_id,
                    &world_transforms,
                    &self.text_metrics,
                )
            })
            .reduce(union_visual_bounds)
        else {
            return Ok(preview);
        };
        let moving_bounds =
            selection_geometry::SelectionGeometry::resolve(base_bounds, preview.transform, 0.0)
                .map_err(|_| EngineErrorV1::InvalidDelta)?
                .visual_aabb;
        let targets = self
            .document
            .root_order
            .iter()
            .enumerate()
            .filter(|(_, element_id)| {
                !selected_set.contains(*element_id)
                    && !selected
                        .iter()
                        .any(|selected_id| is_ancestor(&hierarchy, element_id, selected_id))
            })
            .filter_map(|(draw_order, element_id)| {
                element_world_bounds(
                    &self.document,
                    element_id,
                    &world_transforms,
                    &self.text_metrics,
                )
                .map(|bounds| snapping::SnapTarget {
                    element_id: element_id.clone(),
                    draw_order,
                    bounds,
                    is_selected: false,
                })
            })
            .collect::<Vec<_>>();
        let snap = snapping::snap_bounds(moving_bounds, &targets, self.camera.zoom, 6.0)
            .map_err(|_| EngineErrorV1::InvalidDelta)?;
        if snap.correction.x != 0.0 || snap.correction.y != 0.0 {
            let correction =
                Affine2D::translation(snap.correction).map_err(|_| EngineErrorV1::InvalidDelta)?;
            preview.transform = preview
                .transform
                .compose(correction)
                .map_err(|_| EngineErrorV1::InvalidDelta)?;
        }
        Ok(preview)
    }

    pub fn handle_stroke_batch(
        &mut self,
        command_id: String,
        batch: StrokeInputBatchV1,
    ) -> Result<StrokeUpdateV1, EngineErrorV1> {
        self.validate_active_tool(EditorToolV1::Freehand)?;
        validate_stroke_input(&batch)?;
        self.pointer_machine.cancel();
        let outcome = self
            .stroke_machine
            .process_batch(self.document.revision, batch);
        let (update, did_commit) = match outcome.transition {
            StrokeTransition::None => {
                let preview = self.stroke_machine.preview();
                (self.update_with_stroke_preview(preview.as_ref()), false)
            }
            StrokeTransition::Preview(preview) => {
                self.scene_revision += 1;
                (self.update_with_stroke_preview(Some(&preview)), false)
            }
            StrokeTransition::Cancelled => {
                self.scene_revision += 1;
                (self.current_update(), false)
            }
            StrokeTransition::Commit(commit) => {
                let envelope = CommandEnvelopeV1 {
                    protocol_version: PROTOCOL_VERSION,
                    command_id,
                    document_id: self.document.document_id.clone(),
                    expected_revision: commit.expected_revision,
                    command: CommandV1::CreateStroke {
                        stroke: commit.stroke,
                    },
                };
                (
                    self.execute_command_without_pointer_reset(
                        envelope,
                        SelectionAfterCommand::Preserve,
                    )?,
                    true,
                )
            }
        };
        Ok(StrokeUpdateV1 {
            update,
            processed_point_count: outcome.processed_point_count,
            ignored_point_count: outcome.ignored_point_count,
            did_commit,
        })
    }

    fn execute_command_without_pointer_reset(
        &mut self,
        envelope: CommandEnvelopeV1,
        selection_after: SelectionAfterCommand,
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.validate_envelope(&envelope)?;

        let (candidate, effects) = self.prepare_transaction(vec![envelope.command])?;
        if effects.iter().all(|effect| !effect.did_change) {
            return Ok(self.current_update());
        }
        let changed_by_command = effects
            .iter()
            .map(|effect| effect.changed_element_ids.clone())
            .collect::<Vec<_>>();
        Ok(self.commit_transaction(
            envelope.command_id,
            candidate,
            unique_element_ids(&changed_by_command),
            selection_after,
        ))
    }

    fn prepare_transaction(
        &self,
        commands: Vec<CommandV1>,
    ) -> Result<(NodeInkDocumentV1, Vec<CommandEffect>), EngineErrorV1> {
        let mut candidate = self.document.clone();
        let mut effects = Vec::with_capacity(commands.len());
        for command in commands {
            effects.push(apply_command(&mut candidate, command, &self.text_metrics)?);
        }
        if effects.iter().any(|effect| effect.did_change) {
            candidate.revision = self.document.revision + 1;
        }
        validate_document(&candidate)?;
        Ok((candidate, effects))
    }

    fn commit_transaction(
        &mut self,
        transaction_id: String,
        candidate: NodeInkDocumentV1,
        changed_element_ids: Vec<ElementId>,
        selection_after: SelectionAfterCommand,
    ) -> EngineUpdateV1 {
        let previous_revision = self.document.revision;
        self.undo_stack.push(self.document.clone());
        self.redo_stack.clear();
        self.document = candidate;
        match selection_after {
            SelectionAfterCommand::Preserve => self.selection.reconcile(&self.document),
            SelectionAfterCommand::Set(selected_element_ids, primary_element_id) => self
                .selection
                .set(&self.document, selected_element_ids, primary_element_id)
                .expect("selection after a validated transaction must reference a live element"),
        }
        self.scene_revision += 1;

        self.update(Some(OperationResultV1 {
            command_id: transaction_id,
            previous_revision,
            revision: self.document.revision,
            changed_element_ids,
            scene_revision: self.scene_revision,
        }))
    }

    pub fn undo(&mut self) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        let mut previous = self
            .undo_stack
            .pop()
            .ok_or(EngineErrorV1::UndoUnavailable)?;
        let next_revision = self.document.revision + 1;
        self.redo_stack.push(self.document.clone());
        previous.revision = next_revision;
        self.document = previous;
        self.selection.reconcile(&self.document);
        self.scene_revision += 1;
        Ok(self.update(None))
    }

    pub fn redo(&mut self) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        let mut next = self
            .redo_stack
            .pop()
            .ok_or(EngineErrorV1::RedoUnavailable)?;
        let next_revision = self.document.revision + 1;
        self.undo_stack.push(self.document.clone());
        next.revision = next_revision;
        self.document = next;
        self.selection.reconcile(&self.document);
        self.scene_revision += 1;
        Ok(self.update(None))
    }

    pub fn current_update(&self) -> EngineUpdateV1 {
        self.update(None)
    }

    pub fn set_active_tool(&mut self, active_tool: EditorToolV1) -> EngineUpdateV1 {
        if !self.tool_state.set_active_tool(active_tool) {
            return self.current_update();
        }
        let had_active_gesture =
            self.pointer_machine.is_active() || self.stroke_machine.is_active();
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        self.selection.clear();
        if had_active_gesture {
            self.scene_revision += 1;
        }
        self.current_update()
    }

    pub fn set_selection(
        &mut self,
        selected_element_ids: Vec<ElementId>,
        primary_element_id: Option<ElementId>,
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        self.selection
            .set(&self.document, selected_element_ids, primary_element_id)?;
        Ok(self.current_update())
    }

    pub fn copy_selection(&self) -> Result<ClipboardPayloadV1, EngineErrorV1> {
        let selected = selected_roots(
            &self.document,
            self.selection.selected_element_ids().to_vec(),
        )?;
        if selected.is_empty() {
            return Err(EngineErrorV1::InvalidClipboard);
        }
        let hierarchy = document_hierarchy(&self.document)?;
        let mut included = BTreeSet::new();
        for element_id in &selected {
            collect_subtree(&hierarchy, element_id, &mut included);
        }
        let elements = included
            .into_iter()
            .map(|element_id| {
                let element = self
                    .document
                    .elements
                    .get(&element_id)
                    .expect("selected clipboard subtree was validated")
                    .clone();
                (element_id, element)
            })
            .collect();
        clipboard::encode_clipboard(&self.document.document_id, selected, elements)
    }

    pub fn begin_text_edit_at(&mut self, point: Vec2) -> Result<TextEditTargetV1, EngineErrorV1> {
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(EngineErrorV1::InvalidDelta);
        }
        let active_tool = self.tool_state.active_tool();
        if !matches!(active_tool, EditorToolV1::Select | EditorToolV1::Text) {
            return Err(EngineErrorV1::ToolInputMismatch {
                active_tool,
                required_tool: EditorToolV1::Text,
            });
        }
        let element =
            hit_test_document(&self.document, point, self.camera.zoom, &self.text_metrics)
                .and_then(|element_id| self.document.elements.get(&element_id))
                .and_then(ElementRecordV1::as_text)
                .cloned();
        if let Some(text) = &element {
            self.selection
                .set(&self.document, vec![text.id.clone()], Some(text.id.clone()))?;
        } else if active_tool == EditorToolV1::Text {
            self.selection.clear();
        }
        Ok(TextEditTargetV1 {
            element,
            update: self.current_update(),
        })
    }

    pub fn provide_text_metrics(
        &mut self,
        snapshot: TextMetricsSnapshotV1,
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        if self.text_metrics.provide(&self.document, snapshot)? {
            self.scene_revision += 1;
        }
        Ok(self.current_update())
    }

    pub fn serialize_document(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(&self.document)
    }

    pub fn resolve_scene_profile(
        &self,
        profile: RenderProfileV1,
    ) -> Result<SceneResolutionV1, EngineErrorV1> {
        if !profile.validate() {
            return Err(EngineErrorV1::InvalidRenderProfile);
        }
        if self
            .text_metrics
            .request_for_document(
                &self.document,
                format!("text-measure-{}", self.scene_revision),
            )
            .is_some()
        {
            return Err(EngineErrorV1::InvalidTextMetrics);
        }
        let scene = resolve_scene(
            &self.document,
            self.scene_revision,
            None,
            None,
            &profile,
            &self.text_metrics,
        );
        let canonical =
            serde_json::to_string(&scene).expect("SceneSnapshot serialization is infallible");
        Ok(SceneResolutionV1 {
            engine_algorithm_version: ENGINE_ALGORITHM_VERSION.to_string(),
            render_profile: profile,
            canonical_hash: fnv1a64_hex(canonical.as_bytes()),
            scene,
        })
    }

    pub fn resolve_text_fixture(
        &self,
        request_id: String,
        font_fingerprint: String,
        runs: Vec<TextRunV1>,
        metrics: Option<TextMetricsSnapshotV1>,
    ) -> Result<TextFixtureResolutionV1, EngineErrorV1> {
        resolve_text_fixture(request_id, font_fingerprint, runs, metrics)
    }

    fn validate_envelope(&self, envelope: &CommandEnvelopeV1) -> Result<(), EngineErrorV1> {
        if envelope.protocol_version != PROTOCOL_VERSION {
            return Err(EngineErrorV1::UnsupportedProtocol {
                actual: envelope.protocol_version,
            });
        }
        self.validate_transaction_header(&envelope.document_id, envelope.expected_revision)
    }

    fn validate_active_tool(&self, required_tool: EditorToolV1) -> Result<(), EngineErrorV1> {
        let active_tool = self.tool_state.active_tool();
        if active_tool != required_tool {
            return Err(EngineErrorV1::ToolInputMismatch {
                active_tool,
                required_tool,
            });
        }
        Ok(())
    }

    fn validate_transaction_header(
        &self,
        document_id: &str,
        expected_revision: u64,
    ) -> Result<(), EngineErrorV1> {
        if document_id != self.document.document_id {
            return Err(EngineErrorV1::DocumentMismatch);
        }
        if expected_revision != self.document.revision {
            return Err(EngineErrorV1::RevisionConflict {
                expected: expected_revision,
                actual: self.document.revision,
            });
        }
        Ok(())
    }

    fn update(&self, operation: Option<OperationResultV1>) -> EngineUpdateV1 {
        self.update_with_operation_and_previews(operation, None, None)
    }

    fn update_with_preview(&self, preview: Option<&PointerPreview>) -> EngineUpdateV1 {
        self.update_with_operation_and_previews(None, preview, None)
    }

    fn update_with_stroke_preview(&self, preview: Option<&StrokePreview>) -> EngineUpdateV1 {
        self.update_with_operation_and_previews(None, None, preview)
    }

    fn update_with_operation_and_previews(
        &self,
        operation: Option<OperationResultV1>,
        pointer_preview: Option<&PointerPreview>,
        stroke_preview: Option<&StrokePreview>,
    ) -> EngineUpdateV1 {
        EngineUpdateV1 {
            operation,
            scene: resolve_scene(
                &self.document,
                self.scene_revision,
                pointer_preview,
                stroke_preview,
                &self.document.render_profile,
                &self.text_metrics,
            ),
            history: HistoryStateV1 {
                can_undo: !self.undo_stack.is_empty(),
                can_redo: !self.redo_stack.is_empty(),
            },
            selection: self.selection.snapshot(
                &self.document,
                pointer_preview.and_then(|preview| match preview {
                    PointerPreview::Transform(preview) => {
                        Some((preview.element_ids.as_slice(), preview.transform))
                    }
                    PointerPreview::Marquee { .. } => None,
                }),
                &self.text_metrics,
                self.camera.zoom,
            ),
            active_tool: self.tool_state.active_tool(),
            text_measure_request: self.text_metrics.request_for_document(
                &self.document,
                format!("text-measure-{}", self.scene_revision),
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum SelectionAfterCommand {
    Preserve,
    Set(Vec<ElementId>, Option<ElementId>),
}

fn selection_after_command(
    command: &CommandV1,
    selection: &SelectionModel,
    document: &NodeInkDocumentV1,
) -> SelectionAfterCommand {
    match command {
        CommandV1::CreateRectangle { rectangle } => {
            SelectionAfterCommand::Set(vec![rectangle.id.clone()], Some(rectangle.id.clone()))
        }
        CommandV1::CreateStroke { stroke } => {
            SelectionAfterCommand::Set(vec![stroke.id.clone()], Some(stroke.id.clone()))
        }
        CommandV1::CreateText { text } => {
            SelectionAfterCommand::Set(vec![text.id.clone()], Some(text.id.clone()))
        }
        CommandV1::UpdateText { element_id, patch } => {
            if patch.text.as_ref().is_some_and(String::is_empty) {
                if selection.selected_element_id() == Some(element_id.as_str()) {
                    SelectionAfterCommand::Set(Vec::new(), None)
                } else {
                    SelectionAfterCommand::Preserve
                }
            } else {
                SelectionAfterCommand::Set(vec![element_id.clone()], Some(element_id.clone()))
            }
        }
        CommandV1::MoveElements { element_ids, .. } => element_ids
            .first()
            .cloned()
            .map_or(SelectionAfterCommand::Preserve, |element_id| {
                SelectionAfterCommand::Set(vec![element_id.clone()], Some(element_id))
            }),
        CommandV1::UpdateRectangle { element_id, .. } => {
            SelectionAfterCommand::Set(vec![element_id.clone()], Some(element_id.clone()))
        }
        CommandV1::UpdateElementStyle { element_id, .. } => {
            SelectionAfterCommand::Set(vec![element_id.clone()], Some(element_id.clone()))
        }
        CommandV1::SetRenderProfile { .. } => SelectionAfterCommand::Preserve,
        CommandV1::TransformElements { .. }
        | CommandV1::ReorderElements { .. }
        | CommandV1::AlignElements { .. } => SelectionAfterCommand::Preserve,
        CommandV1::GroupElements { group_id, .. } => {
            SelectionAfterCommand::Set(vec![group_id.clone()], Some(group_id.clone()))
        }
        CommandV1::UngroupElements { group_id } => document
            .elements
            .get(group_id)
            .and_then(|element| match element {
                ElementRecordV1::Group(group) => Some(group.child_order.clone()),
                _ => None,
            })
            .filter(|children| !children.is_empty())
            .map_or(SelectionAfterCommand::Preserve, |children| {
                let primary = children.last().cloned();
                SelectionAfterCommand::Set(children, primary)
            }),
        CommandV1::PasteClipboard {
            payload, id_prefix, ..
        } => clipboard::decode_clipboard(payload)
            .and_then(|decoded| {
                clipboard::remap_clipboard(decoded, id_prefix, Point2D::new(0.0, 0.0))
            })
            .ok()
            .filter(|decoded| !decoded.root_element_ids.is_empty())
            .map_or(SelectionAfterCommand::Preserve, |decoded| {
                let primary = decoded.root_element_ids.last().cloned();
                SelectionAfterCommand::Set(decoded.root_element_ids, primary)
            }),
        CommandV1::DeleteElements { element_ids } => {
            if selection
                .selected_element_id()
                .is_some_and(|selected| element_ids.iter().any(|element_id| element_id == selected))
            {
                SelectionAfterCommand::Set(Vec::new(), None)
            } else {
                SelectionAfterCommand::Preserve
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct CommandEffect {
    changed_element_ids: Vec<ElementId>,
    did_change: bool,
}

impl CommandEffect {
    fn changed(changed_element_ids: Vec<ElementId>) -> Self {
        Self {
            changed_element_ids,
            did_change: true,
        }
    }

    fn unchanged() -> Self {
        Self {
            changed_element_ids: Vec::new(),
            did_change: false,
        }
    }
}

fn apply_command(
    document: &mut NodeInkDocumentV1,
    command: CommandV1,
    text_metrics: &TextMetricsCache,
) -> Result<CommandEffect, EngineErrorV1> {
    match command {
        CommandV1::CreateRectangle { rectangle } => {
            validate_rectangle(&rectangle)?;
            if document.elements.contains_key(&rectangle.id) {
                return Err(EngineErrorV1::ElementAlreadyExists {
                    element_id: rectangle.id,
                });
            }
            let element_id = rectangle.id.clone();
            document.root_order.push(element_id.clone());
            document
                .elements
                .insert(element_id.clone(), ElementRecordV1::Rect(rectangle));
            Ok(CommandEffect::changed(vec![element_id]))
        }
        CommandV1::MoveElements { element_ids, delta } => {
            if !delta.x.is_finite() || !delta.y.is_finite() {
                return Err(EngineErrorV1::InvalidDelta);
            }
            let translation = Affine2D::translation(Point2D::new(delta.x, delta.y))
                .map_err(|_| EngineErrorV1::InvalidDelta)?;
            apply_world_transform(document, element_ids, translation)
        }
        CommandV1::CreateStroke { stroke } => {
            validate_stroke(&stroke)?;
            if document.elements.contains_key(&stroke.id) {
                return Err(EngineErrorV1::ElementAlreadyExists {
                    element_id: stroke.id,
                });
            }
            let element_id = stroke.id.clone();
            document.root_order.push(element_id.clone());
            document
                .elements
                .insert(element_id.clone(), ElementRecordV1::Stroke(stroke));
            Ok(CommandEffect::changed(vec![element_id]))
        }
        CommandV1::CreateText { text } => {
            validate_text(&text)?;
            if document.elements.contains_key(&text.id) {
                return Err(EngineErrorV1::ElementAlreadyExists {
                    element_id: text.id,
                });
            }
            let element_id = text.id.clone();
            document.root_order.push(element_id.clone());
            document
                .elements
                .insert(element_id.clone(), ElementRecordV1::Text(text));
            Ok(CommandEffect::changed(vec![element_id]))
        }
        CommandV1::UpdateText { element_id, patch } => {
            if patch.is_empty() {
                return Err(EngineErrorV1::InvalidText {
                    element_id: element_id.clone(),
                });
            }
            let element = document.elements.get_mut(&element_id).ok_or_else(|| {
                EngineErrorV1::ElementNotFound {
                    element_id: element_id.clone(),
                }
            })?;
            let ElementRecordV1::Text(text) = element else {
                return Err(EngineErrorV1::ElementNotText { element_id });
            };
            if patch.text.as_ref().is_some_and(String::is_empty) {
                return delete_elements(document, vec![element_id]);
            }
            if let Some(value) = patch.text {
                text.text = value;
            }
            if let Some(value) = patch.max_width {
                text.max_width = value;
            }
            validate_text(text)?;
            Ok(CommandEffect::changed(vec![element_id]))
        }
        CommandV1::UpdateRectangle { element_id, patch } => {
            let element = document.elements.get_mut(&element_id).ok_or_else(|| {
                EngineErrorV1::ElementNotFound {
                    element_id: element_id.clone(),
                }
            })?;
            let ElementRecordV1::Rect(rectangle) = element else {
                return Err(EngineErrorV1::ElementNotRectangle { element_id });
            };
            if let Some(x) = patch.x {
                rectangle.x = x;
            }
            if let Some(y) = patch.y {
                rectangle.y = y;
            }
            if let Some(width) = patch.width {
                rectangle.width = width;
            }
            if let Some(height) = patch.height {
                rectangle.height = height;
            }
            validate_rectangle(rectangle)?;
            Ok(CommandEffect::changed(vec![element_id]))
        }
        CommandV1::UpdateElementStyle { element_id, patch } => {
            apply_element_style_patch(document, element_id, patch)
        }
        CommandV1::SetRenderProfile { render_profile } => {
            if !render_profile.validate() {
                return Err(EngineErrorV1::InvalidRenderProfile);
            }
            if document.render_profile == render_profile {
                return Ok(CommandEffect::unchanged());
            }
            document.render_profile = render_profile;
            Ok(CommandEffect::changed(document.root_order.clone()))
        }
        CommandV1::TransformElements {
            element_ids,
            transform,
        } => {
            if !transform.is_valid() {
                return Err(EngineErrorV1::InvalidTransform {
                    element_id: element_ids.first().cloned().unwrap_or_default(),
                });
            }
            apply_world_transform(document, element_ids, transform)
        }
        CommandV1::GroupElements {
            group_id,
            element_ids,
        } => group_elements(document, group_id, element_ids),
        CommandV1::UngroupElements { group_id } => ungroup_elements(document, group_id),
        CommandV1::ReorderElements {
            element_ids,
            placement,
        } => reorder_elements(document, element_ids, placement),
        CommandV1::AlignElements {
            element_ids,
            alignment,
        } => align_elements(document, element_ids, alignment, text_metrics),
        CommandV1::PasteClipboard {
            payload,
            id_prefix,
            offset,
        } => paste_clipboard(document, payload, id_prefix, offset),
        CommandV1::DeleteElements { element_ids } => delete_elements(document, element_ids),
    }
}

fn selected_roots(
    document: &NodeInkDocumentV1,
    element_ids: Vec<ElementId>,
) -> Result<Vec<ElementId>, EngineErrorV1> {
    let hierarchy = document_hierarchy(document)?;
    let requested = element_ids.into_iter().collect::<BTreeSet<_>>();
    for element_id in &requested {
        if !document.elements.contains_key(element_id) {
            return Err(EngineErrorV1::ElementNotFound {
                element_id: element_id.clone(),
            });
        }
    }
    Ok(hierarchy
        .stable_depth_first_order()
        .into_iter()
        .filter(|element_id| requested.contains(*element_id))
        .filter(|element_id| {
            let mut parent = hierarchy.parent_of(element_id).flatten();
            while let Some(parent_id) = parent {
                if requested.contains(parent_id) {
                    return false;
                }
                parent = hierarchy.parent_of(parent_id).flatten();
            }
            true
        })
        .map(str::to_string)
        .collect())
}

fn apply_world_transform(
    document: &mut NodeInkDocumentV1,
    element_ids: Vec<ElementId>,
    delta_world: Affine2D,
) -> Result<CommandEffect, EngineErrorV1> {
    let element_ids = selected_roots(document, element_ids)?;
    if element_ids.is_empty() {
        return Ok(CommandEffect::unchanged());
    }
    let hierarchy = document_hierarchy(document)?;
    let world_transforms = resolved_world_transforms(document, None)?;
    let mut local_updates = Vec::with_capacity(element_ids.len());
    for element_id in &element_ids {
        let world =
            *world_transforms
                .get(element_id)
                .ok_or_else(|| EngineErrorV1::ElementNotFound {
                    element_id: element_id.clone(),
                })?;
        let parent_world = hierarchy
            .parent_of(element_id)
            .flatten()
            .and_then(|parent_id| world_transforms.get(parent_id).copied())
            .unwrap_or_else(Affine2D::identity);
        let next_world =
            world
                .compose(delta_world)
                .map_err(|_| EngineErrorV1::InvalidTransform {
                    element_id: element_id.clone(),
                })?;
        let next_local = next_world
            .compose(
                parent_world
                    .inverse()
                    .map_err(|_| EngineErrorV1::InvalidTransform {
                        element_id: element_id.clone(),
                    })?,
            )
            .map_err(|_| EngineErrorV1::InvalidTransform {
                element_id: element_id.clone(),
            })?;
        local_updates.push((element_id.clone(), next_local));
    }
    let did_change = local_updates.iter().any(|(element_id, transform)| {
        document
            .elements
            .get(element_id)
            .is_some_and(|element| element.transform() != *transform)
    });
    if !did_change {
        return Ok(CommandEffect::unchanged());
    }
    for (element_id, transform) in local_updates {
        document
            .elements
            .get_mut(&element_id)
            .expect("selected element existence was validated")
            .set_transform(transform);
    }
    Ok(CommandEffect::changed(element_ids))
}

fn group_elements(
    document: &mut NodeInkDocumentV1,
    group_id: ElementId,
    element_ids: Vec<ElementId>,
) -> Result<CommandEffect, EngineErrorV1> {
    if group_id.trim().is_empty() || document.elements.contains_key(&group_id) {
        return Err(EngineErrorV1::ElementAlreadyExists {
            element_id: group_id,
        });
    }
    let element_ids = selected_roots(document, element_ids)?;
    if element_ids.len() < 2 {
        return Err(EngineErrorV1::InvalidHierarchy {
            reason: "grouping requires at least two sibling elements".to_string(),
        });
    }
    let hierarchy = document_hierarchy(document)?;
    let refs = element_ids.iter().map(String::as_str).collect::<Vec<_>>();
    let parent_id =
        hierarchy
            .ensure_same_parent(&refs)
            .map_err(|error| EngineErrorV1::InvalidHierarchy {
                reason: format!("{error:?}"),
            })?;
    let sibling_order = match parent_id.as_deref() {
        Some(parent_id) => hierarchy
            .children_of(parent_id)
            .expect("validated group parent has a child order")
            .to_vec(),
        None => hierarchy.root_order().to_vec(),
    };
    let selected = element_ids.iter().cloned().collect::<BTreeSet<_>>();
    let highest_index = sibling_order
        .iter()
        .rposition(|id| selected.contains(id))
        .expect("selected siblings occur in their parent order");
    let group_children = sibling_order
        .iter()
        .filter(|id| selected.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    let insert_index = sibling_order[..=highest_index]
        .iter()
        .filter(|id| !selected.contains(*id))
        .count();
    let mut next_order = sibling_order
        .into_iter()
        .filter(|id| !selected.contains(id))
        .collect::<Vec<_>>();
    next_order.insert(insert_index, group_id.clone());
    set_sibling_order(document, parent_id.as_deref(), next_order)?;
    document.elements.insert(
        group_id.clone(),
        ElementRecordV1::Group(GroupElementV1 {
            id: group_id.clone(),
            transform: Affine2D::identity(),
            child_order: group_children,
        }),
    );
    let mut changed = element_ids;
    changed.push(group_id);
    Ok(CommandEffect::changed(changed))
}

fn ungroup_elements(
    document: &mut NodeInkDocumentV1,
    group_id: ElementId,
) -> Result<CommandEffect, EngineErrorV1> {
    let hierarchy = document_hierarchy(document)?;
    let group = match document.elements.get(&group_id) {
        Some(ElementRecordV1::Group(group)) => group.clone(),
        Some(_) => {
            return Err(EngineErrorV1::InvalidHierarchy {
                reason: format!("element {group_id} is not a group"),
            });
        }
        None => {
            return Err(EngineErrorV1::ElementNotFound {
                element_id: group_id,
            });
        }
    };
    let parent_id = hierarchy
        .parent_of(&group.id)
        .expect("validated hierarchy indexes every element")
        .map(str::to_string);
    let sibling_order = match parent_id.as_deref() {
        Some(parent_id) => hierarchy
            .children_of(parent_id)
            .expect("validated group parent has children")
            .to_vec(),
        None => hierarchy.root_order().to_vec(),
    };
    let group_index = sibling_order
        .iter()
        .position(|element_id| element_id == &group.id)
        .expect("validated group occurs in its sibling order");
    let mut next_order = sibling_order;
    next_order.splice(group_index..=group_index, group.child_order.clone());
    for child_id in &group.child_order {
        let child = document
            .elements
            .get_mut(child_id)
            .expect("validated group child exists");
        let transform = child.transform().compose(group.transform).map_err(|_| {
            EngineErrorV1::InvalidTransform {
                element_id: child_id.clone(),
            }
        })?;
        child.set_transform(transform);
    }
    set_sibling_order(document, parent_id.as_deref(), next_order)?;
    document.elements.remove(&group.id);
    let mut changed = group.child_order;
    changed.push(group.id);
    Ok(CommandEffect::changed(changed))
}

fn reorder_elements(
    document: &mut NodeInkDocumentV1,
    element_ids: Vec<ElementId>,
    placement: ReorderPlacementV1,
) -> Result<CommandEffect, EngineErrorV1> {
    let element_ids = selected_roots(document, element_ids)?;
    if element_ids.is_empty() {
        return Ok(CommandEffect::unchanged());
    }
    let hierarchy = document_hierarchy(document)?;
    let refs = element_ids.iter().map(String::as_str).collect::<Vec<_>>();
    let parent_id =
        hierarchy
            .ensure_same_parent(&refs)
            .map_err(|error| EngineErrorV1::InvalidHierarchy {
                reason: format!("{error:?}"),
            })?;
    let order = match parent_id.as_deref() {
        Some(parent_id) => hierarchy
            .children_of(parent_id)
            .expect("validated parent has a child order")
            .to_vec(),
        None => hierarchy.root_order().to_vec(),
    };
    let selected = element_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut next = order.clone();
    match placement {
        ReorderPlacementV1::Front => {
            next = order
                .iter()
                .filter(|id| !selected.contains(*id))
                .chain(order.iter().filter(|id| selected.contains(*id)))
                .cloned()
                .collect();
        }
        ReorderPlacementV1::Back => {
            next = order
                .iter()
                .filter(|id| selected.contains(*id))
                .chain(order.iter().filter(|id| !selected.contains(*id)))
                .cloned()
                .collect();
        }
        ReorderPlacementV1::Forward => {
            for index in (0..next.len().saturating_sub(1)).rev() {
                if selected.contains(&next[index]) && !selected.contains(&next[index + 1]) {
                    next.swap(index, index + 1);
                }
            }
        }
        ReorderPlacementV1::Backward => {
            for index in 1..next.len() {
                if selected.contains(&next[index]) && !selected.contains(&next[index - 1]) {
                    next.swap(index - 1, index);
                }
            }
        }
    }
    if next == order {
        return Ok(CommandEffect::unchanged());
    }
    set_sibling_order(document, parent_id.as_deref(), next)?;
    Ok(CommandEffect::changed(element_ids))
}

fn align_elements(
    document: &mut NodeInkDocumentV1,
    element_ids: Vec<ElementId>,
    alignment: AlignmentV1,
    text_metrics: &TextMetricsCache,
) -> Result<CommandEffect, EngineErrorV1> {
    let element_ids = selected_roots(document, element_ids)?;
    if element_ids.len() < 2 {
        return Ok(CommandEffect::unchanged());
    }
    let world_transforms = resolved_world_transforms(document, None)?;
    let bounds = element_ids
        .iter()
        .map(|element_id| {
            element_world_bounds(document, element_id, &world_transforms, text_metrics)
                .ok_or(EngineErrorV1::InvalidTextMetrics)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let target = match alignment {
        AlignmentV1::Left => bounds
            .iter()
            .map(|value| value.min_x())
            .fold(f64::INFINITY, f64::min),
        AlignmentV1::Center => {
            let min = bounds
                .iter()
                .map(|value| value.min_x())
                .fold(f64::INFINITY, f64::min);
            let max = bounds
                .iter()
                .map(|value| value.max_x())
                .fold(f64::NEG_INFINITY, f64::max);
            min + (max - min) / 2.0
        }
        AlignmentV1::Right => bounds
            .iter()
            .map(|value| value.max_x())
            .fold(f64::NEG_INFINITY, f64::max),
        AlignmentV1::Top => bounds
            .iter()
            .map(|value| value.min_y())
            .fold(f64::INFINITY, f64::min),
        AlignmentV1::Middle => {
            let min = bounds
                .iter()
                .map(|value| value.min_y())
                .fold(f64::INFINITY, f64::min);
            let max = bounds
                .iter()
                .map(|value| value.max_y())
                .fold(f64::NEG_INFINITY, f64::max);
            min + (max - min) / 2.0
        }
        AlignmentV1::Bottom => bounds
            .iter()
            .map(|value| value.max_y())
            .fold(f64::NEG_INFINITY, f64::max),
    };
    let hierarchy = document_hierarchy(document)?;
    let mut updates = Vec::new();
    for (element_id, bounds) in element_ids.iter().zip(bounds) {
        let delta = match alignment {
            AlignmentV1::Left => Point2D::new(target - bounds.min_x(), 0.0),
            AlignmentV1::Center => Point2D::new(target - bounds.center_x(), 0.0),
            AlignmentV1::Right => Point2D::new(target - bounds.max_x(), 0.0),
            AlignmentV1::Top => Point2D::new(0.0, target - bounds.min_y()),
            AlignmentV1::Middle => Point2D::new(0.0, target - bounds.center_y()),
            AlignmentV1::Bottom => Point2D::new(0.0, target - bounds.max_y()),
        };
        if delta.x == 0.0 && delta.y == 0.0 {
            continue;
        }
        let world = world_transforms[element_id];
        let parent_world = hierarchy
            .parent_of(element_id)
            .flatten()
            .and_then(|parent_id| world_transforms.get(parent_id).copied())
            .unwrap_or_else(Affine2D::identity);
        let translation = Affine2D::translation(delta).map_err(|_| EngineErrorV1::InvalidDelta)?;
        let local = world
            .compose(translation)
            .and_then(|next| next.compose(parent_world.inverse()?))
            .map_err(|_| EngineErrorV1::InvalidTransform {
                element_id: element_id.clone(),
            })?;
        updates.push((element_id.clone(), local));
    }
    if updates.is_empty() {
        return Ok(CommandEffect::unchanged());
    }
    for (element_id, transform) in updates {
        document
            .elements
            .get_mut(&element_id)
            .unwrap()
            .set_transform(transform);
    }
    Ok(CommandEffect::changed(element_ids))
}

fn paste_clipboard(
    document: &mut NodeInkDocumentV1,
    payload: String,
    id_prefix: String,
    offset: Vec2,
) -> Result<CommandEffect, EngineErrorV1> {
    let decoded = clipboard::decode_clipboard(&payload)?;
    let remapped =
        clipboard::remap_clipboard(decoded, &id_prefix, Point2D::new(offset.x, offset.y))?;
    if remapped
        .elements
        .keys()
        .any(|element_id| document.elements.contains_key(element_id))
    {
        return Err(EngineErrorV1::InvalidClipboard);
    }
    let changed = remapped.elements.keys().cloned().collect::<Vec<_>>();
    document.root_order.extend(remapped.root_element_ids);
    document.elements.extend(remapped.elements);
    Ok(CommandEffect::changed(changed))
}

fn delete_elements(
    document: &mut NodeInkDocumentV1,
    element_ids: Vec<ElementId>,
) -> Result<CommandEffect, EngineErrorV1> {
    let roots = selected_roots(document, element_ids)?;
    if roots.is_empty() {
        return Ok(CommandEffect::unchanged());
    }
    let hierarchy = document_hierarchy(document)?;
    let mut removed = BTreeSet::new();
    for root in roots {
        collect_subtree(&hierarchy, &root, &mut removed);
    }
    loop {
        for element in document.elements.values_mut() {
            if let ElementRecordV1::Group(group) = element {
                group.child_order.retain(|child| !removed.contains(child));
            }
        }
        let empty_groups = document
            .elements
            .iter()
            .filter_map(|(id, element)| match element {
                ElementRecordV1::Group(group)
                    if !removed.contains(id) && group.child_order.is_empty() =>
                {
                    Some(id.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        if empty_groups.is_empty() {
            break;
        }
        removed.extend(empty_groups);
    }
    document.root_order.retain(|id| !removed.contains(id));
    for element in document.elements.values_mut() {
        if let ElementRecordV1::Group(group) = element {
            group.child_order.retain(|id| !removed.contains(id));
        }
    }
    for element_id in &removed {
        document.elements.remove(element_id);
    }
    Ok(CommandEffect::changed(removed.into_iter().collect()))
}

fn collect_subtree(hierarchy: &Hierarchy, element_id: &str, output: &mut BTreeSet<ElementId>) {
    if !output.insert(element_id.to_string()) {
        return;
    }
    if let Some(children) = hierarchy.children_of(element_id) {
        for child_id in children {
            collect_subtree(hierarchy, child_id, output);
        }
    }
}

fn is_ancestor(hierarchy: &Hierarchy, ancestor_id: &str, element_id: &str) -> bool {
    let mut current = hierarchy.parent_of(element_id).flatten();
    while let Some(parent_id) = current {
        if parent_id == ancestor_id {
            return true;
        }
        current = hierarchy.parent_of(parent_id).flatten();
    }
    false
}

fn set_sibling_order(
    document: &mut NodeInkDocumentV1,
    parent_id: Option<&str>,
    order: Vec<ElementId>,
) -> Result<(), EngineErrorV1> {
    match parent_id {
        None => document.root_order = order,
        Some(parent_id) => match document.elements.get_mut(parent_id) {
            Some(ElementRecordV1::Group(group)) => group.child_order = order,
            Some(_) => {
                return Err(EngineErrorV1::InvalidHierarchy {
                    reason: format!("parent {parent_id} is not a group"),
                });
            }
            None => {
                return Err(EngineErrorV1::ElementNotFound {
                    element_id: parent_id.to_string(),
                });
            }
        },
    }
    Ok(())
}

fn apply_element_style_patch(
    document: &mut NodeInkDocumentV1,
    element_id: ElementId,
    patch: ElementStylePatchV1,
) -> Result<CommandEffect, EngineErrorV1> {
    if patch.is_empty() {
        return Err(EngineErrorV1::InvalidElementStyle { element_id });
    }
    let element =
        document
            .elements
            .get_mut(&element_id)
            .ok_or_else(|| EngineErrorV1::ElementNotFound {
                element_id: element_id.clone(),
            })?;
    let previous = element.clone();
    match patch {
        ElementStylePatchV1::Rect {
            fill,
            stroke,
            stroke_width,
        } => {
            let ElementRecordV1::Rect(rectangle) = element else {
                return Err(EngineErrorV1::ElementStyleKindMismatch { element_id });
            };
            if fill.as_ref().is_some_and(|value| !value.validate())
                || stroke
                    .as_deref()
                    .is_some_and(|value| !is_canonical_color(value))
                || stroke_width.is_some_and(|value| !is_valid_stroke_width(value))
            {
                return Err(EngineErrorV1::InvalidElementStyle { element_id });
            }
            if let Some(value) = fill {
                rectangle.fill = value;
            }
            if let Some(value) = stroke {
                rectangle.stroke = value;
            }
            if let Some(value) = stroke_width {
                rectangle.stroke_width = value;
            }
        }
        ElementStylePatchV1::Stroke {
            stroke,
            stroke_width,
        } => {
            let ElementRecordV1::Stroke(ink) = element else {
                return Err(EngineErrorV1::ElementStyleKindMismatch { element_id });
            };
            if stroke
                .as_deref()
                .is_some_and(|value| !is_canonical_color(value))
                || stroke_width.is_some_and(|value| !is_valid_stroke_width(value))
            {
                return Err(EngineErrorV1::InvalidElementStyle { element_id });
            }
            if let Some(value) = stroke {
                ink.stroke = value;
            }
            if let Some(value) = stroke_width {
                ink.stroke_width = value;
            }
        }
        ElementStylePatchV1::Text {
            color,
            text_align,
            font_size,
            font_weight,
        } => {
            let ElementRecordV1::Text(text) = element else {
                return Err(EngineErrorV1::ElementStyleKindMismatch { element_id });
            };
            if color
                .as_deref()
                .is_some_and(|value| !is_canonical_color(value))
                || font_size.is_some_and(|value| !is_valid_font_size(value))
                || font_weight.is_some_and(|value| !matches!(value, 400 | 500))
            {
                return Err(EngineErrorV1::InvalidElementStyle { element_id });
            }
            if let Some(value) = color {
                text.color = value;
            }
            if let Some(value) = text_align {
                text.text_align = value;
            }
            if let Some(value) = font_size {
                text.font_size = value;
            }
            if let Some(value) = font_weight {
                text.font_weight = value;
            }
        }
    }
    if *element == previous {
        Ok(CommandEffect::unchanged())
    } else {
        Ok(CommandEffect::changed(vec![element_id]))
    }
}

fn unique_element_ids(changed_by_command: &[Vec<ElementId>]) -> Vec<ElementId> {
    let mut seen = BTreeMap::new();
    let mut unique = Vec::new();
    for element_id in changed_by_command.iter().flatten() {
        if seen.insert(element_id.clone(), ()).is_none() {
            unique.push(element_id.clone());
        }
    }
    unique
}

fn validate_document(document: &NodeInkDocumentV1) -> Result<(), EngineErrorV1> {
    if document.schema_version != SCHEMA_VERSION {
        return Err(EngineErrorV1::UnsupportedSchema {
            actual: document.schema_version,
        });
    }
    if document.document_id.trim().is_empty() {
        return Err(EngineErrorV1::InvalidDocument {
            reason: "documentId must not be empty".to_string(),
        });
    }
    if !document.render_profile.validate() {
        return Err(EngineErrorV1::InvalidRenderProfile);
    }
    let _hierarchy = document_hierarchy(document)?;
    for (element_id, element) in &document.elements {
        if element.id() != element_id {
            return Err(EngineErrorV1::InvalidDocument {
                reason: format!("element key {element_id} does not match its id"),
            });
        }
        if !element.transform().is_valid() {
            return Err(EngineErrorV1::InvalidTransform {
                element_id: element_id.clone(),
            });
        }
        match element {
            ElementRecordV1::Rect(rectangle) => validate_rectangle(rectangle)?,
            ElementRecordV1::Stroke(stroke) => validate_stroke(stroke)?,
            ElementRecordV1::Text(text) => validate_text(text)?,
            ElementRecordV1::Group(group) => {
                if group.id.trim().is_empty() || group.child_order.is_empty() {
                    return Err(EngineErrorV1::InvalidHierarchy {
                        reason: format!("group {} must contain at least one child", group.id),
                    });
                }
            }
        }
    }
    Ok(())
}

fn document_hierarchy(document: &NodeInkDocumentV1) -> Result<Hierarchy, EngineErrorV1> {
    let child_orders = document
        .elements
        .values()
        .filter_map(|element| match element {
            ElementRecordV1::Group(group) => Some((group.id.clone(), group.child_order.clone())),
            _ => None,
        })
        .collect();
    Hierarchy::new(
        document.elements.keys().cloned(),
        document.root_order.clone(),
        child_orders,
    )
    .map_err(|error| EngineErrorV1::InvalidHierarchy {
        reason: format!("{error:?}"),
    })
}

fn document_content_bounds(
    document: &NodeInkDocumentV1,
    text_metrics: &TextMetricsCache,
) -> Option<CameraContentBounds> {
    let world_transforms = resolved_world_transforms(document, None).ok()?;
    document
        .root_order
        .iter()
        .filter_map(|element_id| {
            element_world_bounds(document, element_id, &world_transforms, text_metrics).map(
                |bounds| {
                    CameraContentBounds::from_rect(bounds.x, bounds.y, bounds.width, bounds.height)
                },
            )
        })
        .reduce(CameraContentBounds::union)
}

fn element_local_visual_bounds(
    element: &ElementRecordV1,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    match element {
        ElementRecordV1::Rect(rectangle) => {
            let half_width = rectangle.stroke_width / 2.0;
            VisualAabb::new(
                rectangle.x - half_width,
                rectangle.y - half_width,
                rectangle.width + rectangle.stroke_width,
                rectangle.height + rectangle.stroke_width,
            )
            .ok()
        }
        ElementRecordV1::Stroke(stroke) => {
            stroke_visual_bounds(&stroke.points, stroke.stroke_width)
        }
        ElementRecordV1::Text(text) => text_metrics.metric_for(text).map(|metric| {
            VisualAabb::new(
                aligned_text_x(text.x, metric.width, text.text_align),
                text.y,
                metric.width,
                metric.height,
            )
            .expect("validated text metrics create valid bounds")
        }),
        ElementRecordV1::Group(_) => None,
    }
}

fn element_world_bounds(
    document: &NodeInkDocumentV1,
    element_id: &str,
    world_transforms: &BTreeMap<ElementId, Affine2D>,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    let element = document.elements.get(element_id)?;
    match element {
        ElementRecordV1::Group(group) => group
            .child_order
            .iter()
            .filter_map(|child_id| {
                element_world_bounds(document, child_id, world_transforms, text_metrics)
            })
            .reduce(union_visual_bounds),
        leaf => {
            let local_bounds = element_local_visual_bounds(leaf, text_metrics)?;
            let world_transform = *world_transforms.get(element_id)?;
            selection_geometry::SelectionGeometry::resolve(local_bounds, world_transform, 0.0)
                .ok()
                .map(|geometry| geometry.visual_aabb)
        }
    }
}

fn union_visual_bounds(first: VisualAabb, second: VisualAabb) -> VisualAabb {
    let min_x = first.min_x().min(second.min_x());
    let min_y = first.min_y().min(second.min_y());
    let max_x = first.max_x().max(second.max_x());
    let max_y = first.max_y().max(second.max_y());
    VisualAabb::new(min_x, min_y, max_x - min_x, max_y - min_y)
        .expect("union of valid bounds remains valid")
}

fn resolved_world_transforms(
    document: &NodeInkDocumentV1,
    local_overrides: Option<&BTreeMap<ElementId, Affine2D>>,
) -> Result<BTreeMap<ElementId, Affine2D>, EngineErrorV1> {
    let hierarchy = document_hierarchy(document)?;
    let mut world_transforms = BTreeMap::new();
    for root_id in hierarchy.root_order() {
        append_world_transforms(
            document,
            &hierarchy,
            root_id,
            Affine2D::identity(),
            local_overrides,
            &mut world_transforms,
        )?;
    }
    Ok(world_transforms)
}

fn append_world_transforms(
    document: &NodeInkDocumentV1,
    hierarchy: &Hierarchy,
    element_id: &str,
    parent_world: Affine2D,
    local_overrides: Option<&BTreeMap<ElementId, Affine2D>>,
    world_transforms: &mut BTreeMap<ElementId, Affine2D>,
) -> Result<(), EngineErrorV1> {
    let element =
        document
            .elements
            .get(element_id)
            .ok_or_else(|| EngineErrorV1::ElementNotFound {
                element_id: element_id.to_string(),
            })?;
    let local = local_overrides
        .and_then(|overrides| overrides.get(element_id).copied())
        .unwrap_or_else(|| element.transform());
    let world = local
        .compose(parent_world)
        .map_err(|_| EngineErrorV1::InvalidTransform {
            element_id: element_id.to_string(),
        })?;
    world_transforms.insert(element_id.to_string(), world);
    if let Some(children) = hierarchy.children_of(element_id) {
        for child_id in children {
            append_world_transforms(
                document,
                hierarchy,
                child_id,
                world,
                local_overrides,
                world_transforms,
            )?;
        }
    }
    Ok(())
}

fn validate_rectangle(rectangle: &RectElementV1) -> Result<(), EngineErrorV1> {
    let is_valid = !rectangle.id.trim().is_empty()
        && rectangle.x.is_finite()
        && rectangle.y.is_finite()
        && rectangle.width.is_finite()
        && rectangle.height.is_finite()
        && rectangle.width > 0.0
        && rectangle.height > 0.0
        && rectangle.fill.validate()
        && is_canonical_color(&rectangle.stroke)
        && is_valid_stroke_width(rectangle.stroke_width);
    if !is_valid {
        return Err(EngineErrorV1::InvalidRectangle {
            element_id: rectangle.id.clone(),
        });
    }
    Ok(())
}

fn validate_stroke(stroke: &StrokeElementV1) -> Result<(), EngineErrorV1> {
    let is_valid = !stroke.id.trim().is_empty()
        && stroke.points.len() >= 2
        && stroke
            .points
            .iter()
            .all(|point| point.x.is_finite() && point.y.is_finite())
        && is_canonical_color(&stroke.stroke)
        && is_valid_stroke_width(stroke.stroke_width);
    if !is_valid {
        return Err(EngineErrorV1::InvalidStroke {
            element_id: stroke.id.clone(),
        });
    }
    Ok(())
}

fn validate_text(text: &TextElementV1) -> Result<(), EngineErrorV1> {
    let is_valid = !text.id.trim().is_empty()
        && text.x.is_finite()
        && text.y.is_finite()
        && !text.text.is_empty()
        && text.text.chars().count() <= 65_536
        && text.font_family == CANVAS_FONT_FAMILY
        && is_valid_font_size(text.font_size)
        && matches!(text.font_weight, 400 | 500)
        && is_canonical_color(&text.color)
        && text
            .max_width
            .is_none_or(|width| width.is_finite() && width > 0.0)
        && !text.font_fingerprint.trim().is_empty();
    if !is_valid {
        return Err(EngineErrorV1::InvalidText {
            element_id: text.id.clone(),
        });
    }
    Ok(())
}

fn validate_stroke_input(batch: &StrokeInputBatchV1) -> Result<(), EngineErrorV1> {
    if batch
        .points
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return Err(EngineErrorV1::InvalidStrokeInput {
            reason: "points must be finite".to_string(),
        });
    }
    if batch.phase == StrokePhaseV1::Down
        && batch
            .stroke_id
            .as_deref()
            .is_none_or(|stroke_id| stroke_id.trim().is_empty())
    {
        return Err(EngineErrorV1::InvalidStrokeInput {
            reason: "down requires a strokeId".to_string(),
        });
    }
    Ok(())
}

fn hit_selection_handle(
    selection: &SelectionStateV1,
    point: Vec2,
    camera_zoom: f64,
) -> Option<SelectionHandleIdV1> {
    if !camera_zoom.is_finite() || camera_zoom <= 0.0 {
        return None;
    }
    let radius = 10.0 / camera_zoom;
    selection.handles.iter().rev().find_map(|handle| {
        let dx = handle.position.x - point.x;
        let dy = handle.position.y - point.y;
        (dx * dx + dy * dy <= radius * radius).then_some(handle.id)
    })
}

fn preview_guides(
    document: &NodeInkDocumentV1,
    preview: &PointerTransformPreview,
    text_metrics: &TextMetricsCache,
) -> Vec<AlignmentGuideV1> {
    if preview.kind != PointerTransformKind::Move || preview.disable_snap {
        return Vec::new();
    }
    let Ok(selected) = selected_roots(document, preview.element_ids.clone()) else {
        return Vec::new();
    };
    let Ok(hierarchy) = document_hierarchy(document) else {
        return Vec::new();
    };
    let Ok(world_transforms) = resolved_world_transforms(document, None) else {
        return Vec::new();
    };
    let selected_set = selected.iter().cloned().collect::<BTreeSet<_>>();
    let Some(base_bounds) = selected
        .iter()
        .filter_map(|element_id| {
            element_world_bounds(document, element_id, &world_transforms, text_metrics)
        })
        .reduce(union_visual_bounds)
    else {
        return Vec::new();
    };
    let Ok(geometry) =
        selection_geometry::SelectionGeometry::resolve(base_bounds, preview.transform, 0.0)
    else {
        return Vec::new();
    };
    let target_bounds = document
        .root_order
        .iter()
        .enumerate()
        .filter(|(_, element_id)| {
            !selected_set.contains(*element_id)
                && !selected
                    .iter()
                    .any(|selected_id| is_ancestor(&hierarchy, element_id, selected_id))
        })
        .filter_map(|(draw_order, element_id)| {
            element_world_bounds(document, element_id, &world_transforms, text_metrics).map(
                |bounds| {
                    (
                        snapping::SnapTarget {
                            element_id: element_id.clone(),
                            draw_order,
                            bounds,
                            is_selected: false,
                        },
                        bounds,
                    )
                },
            )
        })
        .collect::<Vec<_>>();
    let targets = target_bounds
        .iter()
        .map(|(target, _)| target.clone())
        .collect::<Vec<_>>();
    let Ok(snap) = snapping::snap_bounds(geometry.visual_aabb, &targets, 1.0, 1e-7) else {
        return Vec::new();
    };
    let mut guides = Vec::new();
    if let Some(matched) = snap.x_match
        && let Some((_, target)) = target_bounds
            .iter()
            .find(|(target, _)| target.element_id == matched.target_element_id)
    {
        guides.push(AlignmentGuideV1 {
            axis: AlignmentGuideAxisV1::X,
            position: matched.guide_position,
            start: geometry.visual_aabb.min_y().min(target.min_y()),
            end: geometry.visual_aabb.max_y().max(target.max_y()),
        });
    }
    if let Some(matched) = snap.y_match
        && let Some((_, target)) = target_bounds
            .iter()
            .find(|(target, _)| target.element_id == matched.target_element_id)
    {
        guides.push(AlignmentGuideV1 {
            axis: AlignmentGuideAxisV1::Y,
            position: matched.guide_position,
            start: geometry.visual_aabb.min_x().min(target.min_x()),
            end: geometry.visual_aabb.max_x().max(target.max_x()),
        });
    }
    guides
}

fn resolve_scene(
    document: &NodeInkDocumentV1,
    scene_revision: u64,
    pointer_preview: Option<&PointerPreview>,
    stroke_preview: Option<&StrokePreview>,
    profile: &RenderProfileV1,
    text_metrics: &TextMetricsCache,
) -> SceneSnapshotV1 {
    let mut root_node_ids =
        Vec::with_capacity(document.root_order.len() + usize::from(stroke_preview.is_some()));
    let mut nodes = BTreeMap::new();
    let hierarchy = document_hierarchy(document).expect("validated Document has valid hierarchy");
    let base_world = resolved_world_transforms(document, None)
        .expect("validated Document has finite world transforms");
    let preview_overrides = pointer_preview.and_then(|preview| {
        let PointerPreview::Transform(preview) = preview else {
            return None;
        };
        let mut overrides = BTreeMap::new();
        for element_id in &preview.element_ids {
            let world = *base_world.get(element_id)?;
            let parent_world = hierarchy
                .parent_of(element_id)
                .flatten()
                .and_then(|parent_id| base_world.get(parent_id).copied())
                .unwrap_or_else(Affine2D::identity);
            let preview_world = world.compose(preview.transform).ok()?;
            let local = preview_world.compose(parent_world.inverse().ok()?).ok()?;
            overrides.insert(element_id.clone(), local);
        }
        Some(overrides)
    });
    let world_transforms = resolved_world_transforms(document, preview_overrides.as_ref())
        .expect("validated preview has finite world transforms");

    for element_id in hierarchy.stable_depth_first_order() {
        let Some(element) = document.elements.get(element_id) else {
            continue;
        };
        let world_transform = *world_transforms
            .get(element_id)
            .expect("resolved hierarchy element has a world transform");
        match element {
            ElementRecordV1::Rect(rectangle) => {
                if matches!(profile, RenderProfileV1::Clean { .. }) {
                    let scene_node_id = format!("{}:shape", rectangle.id);
                    root_node_ids.push(scene_node_id.clone());
                    nodes.insert(
                        scene_node_id.clone(),
                        SceneNodeV1::Rect(SceneRectV1 {
                            id: scene_node_id,
                            source_element_id: rectangle.id.clone(),
                            transform: world_transform,
                            x: rectangle.x,
                            y: rectangle.y,
                            width: rectangle.width,
                            height: rectangle.height,
                            fill: rectangle.fill.scene_paint().to_string(),
                            stroke: rectangle.stroke.clone(),
                            stroke_width: rectangle.stroke_width,
                        }),
                    );
                } else {
                    for mut path in sketch_rectangle(rectangle, profile) {
                        path.transform = world_transform;
                        root_node_ids.push(path.id.clone());
                        nodes.insert(path.id.clone(), SceneNodeV1::Path(path));
                    }
                }
            }
            ElementRecordV1::Stroke(stroke) => {
                insert_stroke_scene_node(
                    &mut root_node_ids,
                    &mut nodes,
                    stroke,
                    world_transform,
                    profile,
                );
            }
            ElementRecordV1::Text(text) => {
                if let Some(metric) = text_metrics.metric_for(text) {
                    let scene_node_id = format!("{}:text", text.id);
                    root_node_ids.push(scene_node_id.clone());
                    nodes.insert(
                        scene_node_id.clone(),
                        SceneNodeV1::Text(SceneTextV1 {
                            id: scene_node_id,
                            source_element_id: text.id.clone(),
                            transform: world_transform,
                            runs: scene_runs(text, metric),
                        }),
                    );
                }
            }
            ElementRecordV1::Group(_) => {}
        }
    }

    if let Some(preview) = stroke_preview {
        insert_stroke_scene_node(
            &mut root_node_ids,
            &mut nodes,
            &preview.stroke,
            preview.stroke.transform,
            profile,
        );
    }

    SceneSnapshotV1 {
        protocol_version: PROTOCOL_VERSION,
        document_id: document.document_id.clone(),
        document_revision: document.revision,
        scene_revision,
        render_profile: profile.clone(),
        root_node_ids,
        nodes,
    }
}

fn insert_stroke_scene_node(
    root_node_ids: &mut Vec<SceneNodeId>,
    nodes: &mut BTreeMap<SceneNodeId, SceneNodeV1>,
    stroke: &StrokeElementV1,
    world_transform: Affine2D,
    profile: &RenderProfileV1,
) {
    let path = if matches!(profile, RenderProfileV1::Clean { .. }) {
        let scene_node_id = format!("{}:path", stroke.id);
        ScenePathV1 {
            id: scene_node_id,
            source_element_id: stroke.id.clone(),
            transform: world_transform,
            path_data: resolved_stroke_path_data(&stroke.points),
            fill: "none".to_string(),
            stroke: stroke.stroke.clone(),
            stroke_width: stroke.stroke_width,
        }
    } else {
        let mut path = sketch_stroke(stroke, profile);
        path.transform = world_transform;
        path
    };
    root_node_ids.push(path.id.clone());
    nodes.insert(path.id.clone(), SceneNodeV1::Path(path));
}

fn fnv1a64_hex(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3)
    });
    format!("fnv1a64:{hash:016x}")
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn camera_pan_and_anchor_zoom_do_not_change_document_or_history() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let before = engine.current_update();

        engine
            .apply_camera_action(CameraActionV1::PanBy {
                delta: Vec2 { x: 80.0, y: 40.0 },
            })
            .unwrap();
        let panned = engine.camera();
        assert_eq!(
            panned,
            CameraV1 {
                x: -80.0,
                y: -40.0,
                zoom: 1.0
            }
        );

        engine
            .apply_camera_action(CameraActionV1::ZoomAt {
                factor: 2.0,
                anchor: Vec2 { x: 200.0, y: 100.0 },
            })
            .unwrap();
        assert_eq!(
            engine.camera(),
            CameraV1 {
                x: 20.0,
                y: 10.0,
                zoom: 2.0,
            }
        );
        assert_eq!(engine.current_update(), before);
        assert!(!engine.current_update().history.can_undo);
        assert!(!engine.current_update().history.can_redo);
    }

    #[test]
    fn camera_fit_content_centers_document_bounds_with_screen_padding() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        let rectangle = RectElementV1 {
            id: "rect-1".to_string(),
            transform: Affine2D::identity(),
            x: 100.0,
            y: 50.0,
            width: 200.0,
            height: 100.0,
            fill: FillV1::default_rectangle(),
            stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
            stroke_width: DEFAULT_RECTANGLE_STROKE_WIDTH,
        };
        document.root_order.push(rectangle.id.clone());
        document
            .elements
            .insert(rectangle.id.clone(), ElementRecordV1::Rect(rectangle));
        let nested_rectangle = RectElementV1 {
            id: "rect-2".to_string(),
            transform: Affine2D::identity(),
            x: 150.0,
            y: 75.0,
            width: 50.0,
            height: 25.0,
            fill: FillV1::default_rectangle(),
            stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
            stroke_width: DEFAULT_RECTANGLE_STROKE_WIDTH,
        };
        document.root_order.push(nested_rectangle.id.clone());
        document.elements.insert(
            nested_rectangle.id.clone(),
            ElementRecordV1::Rect(nested_rectangle),
        );
        let mut engine = Engine::open(document).unwrap();
        let before = engine.current_update();
        let viewport = CameraViewportV1 {
            width: 500.0,
            height: 300.0,
        };

        let fitted = engine.fit_camera(viewport, 50.0).unwrap();
        assert_eq!(
            fitted,
            CameraV1 {
                x: 72.5,
                y: 23.5,
                zoom: 1.9607843137254901,
            }
        );

        engine
            .apply_camera_action(CameraActionV1::FitContent {
                viewport,
                padding: 50.0,
            })
            .unwrap();
        assert_eq!(engine.camera(), fitted);
        assert_eq!(engine.current_update(), before);
    }

    #[test]
    fn camera_fit_content_includes_stroke_width_and_handles_empty_documents() {
        let blank = Engine::open(NodeInkDocumentV1::blank("blank")).unwrap();
        assert_eq!(
            blank
                .fit_camera(
                    CameraViewportV1 {
                        width: 800.0,
                        height: 600.0,
                    },
                    64.0,
                )
                .unwrap(),
            CameraV1::default()
        );

        let mut document = NodeInkDocumentV1::blank("stroke");
        let stroke = StrokeElementV1 {
            id: "stroke-1".to_string(),
            transform: Affine2D::identity(),
            points: vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }],
            stroke: DEFAULT_INK_COLOR.to_string(),
            stroke_width: 20.0,
        };
        document.root_order.push(stroke.id.clone());
        document
            .elements
            .insert(stroke.id.clone(), ElementRecordV1::Stroke(stroke));
        let engine = Engine::open(document).unwrap();

        assert_eq!(
            engine
                .fit_camera(
                    CameraViewportV1 {
                        width: 360.0,
                        height: 160.0,
                    },
                    60.0,
                )
                .unwrap(),
            CameraV1 {
                x: -40.0,
                y: -40.0,
                zoom: 2.0,
            }
        );
    }

    #[test]
    fn camera_fit_content_rejects_invalid_viewport_or_padding() {
        let engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();

        assert!(
            engine
                .fit_camera(
                    CameraViewportV1 {
                        width: 100.0,
                        height: 100.0,
                    },
                    50.0,
                )
                .is_err()
        );
        assert!(
            engine
                .fit_camera(
                    CameraViewportV1 {
                        width: f64::NAN,
                        height: 100.0,
                    },
                    0.0,
                )
                .is_err()
        );
    }

    #[test]
    fn camera_zoom_is_clamped_and_invalid_state_is_rejected() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();

        engine
            .apply_camera_action(CameraActionV1::ZoomAt {
                factor: 100.0,
                anchor: Vec2 { x: 0.0, y: 0.0 },
            })
            .unwrap();
        assert_eq!(engine.camera().zoom, MAX_CAMERA_ZOOM);
        engine
            .apply_camera_action(CameraActionV1::ZoomAt {
                factor: 0.0001,
                anchor: Vec2 { x: 0.0, y: 0.0 },
            })
            .unwrap();
        assert_eq!(engine.camera().zoom, MIN_CAMERA_ZOOM);

        assert!(
            engine
                .set_camera(CameraV1 {
                    x: f64::NAN,
                    y: 0.0,
                    zoom: 1.0,
                })
                .is_err()
        );
    }

    fn envelope(
        document: &NodeInkDocumentV1,
        command_id: &str,
        command: CommandV1,
    ) -> CommandEnvelopeV1 {
        CommandEnvelopeV1 {
            protocol_version: PROTOCOL_VERSION,
            command_id: command_id.to_string(),
            document_id: document.document_id.clone(),
            expected_revision: document.revision,
            command,
        }
    }

    fn rectangle(id: &str, x: f64) -> RectElementV1 {
        RectElementV1 {
            id: id.to_string(),
            transform: Affine2D::identity(),
            x,
            y: 40.0,
            width: 160.0,
            height: 96.0,
            fill: FillV1::default_rectangle(),
            stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
            stroke_width: DEFAULT_RECTANGLE_STROKE_WIDTH,
        }
    }

    fn diagram_batch(mode: DiagramOperationModeV1) -> DiagramOperationBatchV1 {
        DiagramOperationBatchV1 {
            protocol_version: PROTOCOL_VERSION,
            batch_id: "diagram-batch-1".to_string(),
            document_id: "doc-1".to_string(),
            expected_revision: 0,
            mode,
            atomic: true,
            operations: vec![
                DiagramOperationV1::CreateRectangle {
                    op_id: "create-a".to_string(),
                    rectangle: rectangle("rect-a", 10.0),
                },
                DiagramOperationV1::CreateRectangle {
                    op_id: "create-b".to_string(),
                    rectangle: rectangle("rect-b", 100.0),
                },
                DiagramOperationV1::MoveElements {
                    op_id: "move-a".to_string(),
                    element_ids: vec!["rect-a".to_string()],
                    delta: Vec2 { x: 5.0, y: 7.0 },
                },
                DiagramOperationV1::UpdateRectangle {
                    op_id: "resize-a".to_string(),
                    element_id: "rect-a".to_string(),
                    patch: RectanglePatchV1 {
                        width: Some(240.0),
                        height: Some(120.0),
                        ..RectanglePatchV1::default()
                    },
                },
                DiagramOperationV1::DeleteElements {
                    op_id: "delete-b".to_string(),
                    element_ids: vec!["rect-b".to_string()],
                },
            ],
        }
    }

    #[test]
    fn diagram_operation_dry_run_is_complete_without_mutating_document_or_history() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let before = engine.document().clone();

        let result = engine
            .execute_diagram_operation(diagram_batch(DiagramOperationModeV1::DryRun))
            .unwrap();

        assert_eq!(result.mode, DiagramOperationModeV1::DryRun);
        assert_eq!(result.previous_revision, 0);
        assert_eq!(result.revision, None);
        assert_eq!(result.results.len(), 5);
        assert!(
            result
                .results
                .iter()
                .all(|entry| entry.status == DiagramOperationStatusV1::Planned)
        );
        assert_eq!(result.scene_patch.base_scene_revision, 0);
        assert_eq!(result.scene_patch.scene_revision, 1);
        assert_eq!(result.scene_patch.document_revision, 1);
        assert_eq!(result.scene_patch.added_nodes.len(), 1);
        assert!(result.scene_patch.added_nodes.contains_key("rect-a:shape"));
        assert_eq!(engine.document(), &before);
        assert_eq!(engine.current_update().scene.scene_revision, 0);
        assert!(!engine.current_update().history.can_undo);
    }

    #[test]
    fn diagram_operation_apply_is_one_atomic_undoable_transaction() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let result = engine
            .execute_diagram_operation(diagram_batch(DiagramOperationModeV1::Apply))
            .unwrap();

        assert_eq!(result.revision, Some(1));
        assert!(
            result
                .results
                .iter()
                .all(|entry| entry.status == DiagramOperationStatusV1::Applied)
        );
        assert_eq!(
            result.results[2].affected_element_ids,
            ["rect-a".to_string()]
        );
        assert_eq!(engine.document().root_order, ["rect-a"]);
        let ElementRecordV1::Rect(rectangle) = &engine.document().elements["rect-a"] else {
            panic!("operation result must contain the surviving rectangle");
        };
        assert_eq!((rectangle.x, rectangle.y), (10.0, 40.0));
        assert_eq!((rectangle.transform.e, rectangle.transform.f), (5.0, 7.0));
        assert_eq!((rectangle.width, rectangle.height), (240.0, 120.0));
        assert_eq!(result.scene_patch.added_nodes.len(), 1);
        assert!(engine.current_update().history.can_undo);

        let undone = engine.undo().unwrap();
        assert_eq!(undone.scene.document_revision, 2);
        assert!(undone.scene.root_node_ids.is_empty());
        assert!(!undone.history.can_undo);
    }

    #[test]
    fn diagram_operation_batch_is_deterministically_replayable_from_the_same_revision() {
        let mut first = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let mut second = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let first_result = first
            .execute_diagram_operation(diagram_batch(DiagramOperationModeV1::Apply))
            .unwrap();
        let second_result = second
            .execute_diagram_operation(diagram_batch(DiagramOperationModeV1::Apply))
            .unwrap();

        assert_eq!(first_result, second_result);
        assert_eq!(first.document(), second.document());
        assert_eq!(
            first.serialize_document().unwrap(),
            second.serialize_document().unwrap()
        );
    }

    #[test]
    fn failed_or_stale_diagram_operation_batches_are_atomic() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let before = engine.document().clone();
        let mut stale = diagram_batch(DiagramOperationModeV1::Apply);
        stale.expected_revision = 9;
        assert_eq!(
            engine.execute_diagram_operation(stale),
            Err(EngineErrorV1::RevisionConflict {
                expected: 9,
                actual: 0,
            })
        );

        let mut wrong_document = diagram_batch(DiagramOperationModeV1::Apply);
        wrong_document.document_id = "doc-2".to_string();
        assert_eq!(
            engine.execute_diagram_operation(wrong_document),
            Err(EngineErrorV1::DocumentMismatch)
        );

        let mut invalid = diagram_batch(DiagramOperationModeV1::Apply);
        invalid.operations.push(DiagramOperationV1::MoveElements {
            op_id: "move-missing".to_string(),
            element_ids: vec!["missing".to_string()],
            delta: Vec2 { x: 1.0, y: 1.0 },
        });
        assert_eq!(
            engine.execute_diagram_operation(invalid),
            Err(EngineErrorV1::ElementNotFound {
                element_id: "missing".to_string(),
            })
        );
        assert_eq!(engine.document(), &before);
        assert!(!engine.current_update().history.can_undo);
    }

    #[test]
    fn rectangle_update_and_delete_commands_reject_invalid_targets_without_partial_mutation() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        let stroke = StrokeElementV1 {
            id: "stroke-1".to_string(),
            transform: Affine2D::identity(),
            points: vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 1.0, y: 1.0 }],
            stroke: DEFAULT_INK_COLOR.to_string(),
            stroke_width: 2.0,
        };
        document.root_order.push(stroke.id.clone());
        document
            .elements
            .insert(stroke.id.clone(), ElementRecordV1::Stroke(stroke));
        let mut engine = Engine::open(document).unwrap();
        let before = engine.document().clone();

        for (command, expected) in [
            (
                CommandV1::UpdateRectangle {
                    element_id: "missing".to_string(),
                    patch: RectanglePatchV1 {
                        x: Some(1.0),
                        ..RectanglePatchV1::default()
                    },
                },
                EngineErrorV1::ElementNotFound {
                    element_id: "missing".to_string(),
                },
            ),
            (
                CommandV1::UpdateRectangle {
                    element_id: "stroke-1".to_string(),
                    patch: RectanglePatchV1 {
                        x: Some(1.0),
                        ..RectanglePatchV1::default()
                    },
                },
                EngineErrorV1::ElementNotRectangle {
                    element_id: "stroke-1".to_string(),
                },
            ),
            (
                CommandV1::DeleteElements {
                    element_ids: vec!["stroke-1".to_string(), "missing".to_string()],
                },
                EngineErrorV1::ElementNotFound {
                    element_id: "missing".to_string(),
                },
            ),
        ] {
            let envelope = envelope(engine.document(), "invalid", command);
            assert_eq!(engine.execute_command(envelope), Err(expected));
            assert_eq!(engine.document(), &before);
        }

        let mut rectangle_document = NodeInkDocumentV1::blank("doc-2");
        let rectangle_fixture = rectangle("rect-1", 10.0);
        rectangle_document
            .root_order
            .push(rectangle_fixture.id.clone());
        rectangle_document.elements.insert(
            rectangle_fixture.id.clone(),
            ElementRecordV1::Rect(rectangle_fixture),
        );
        let mut rectangle_engine = Engine::open(rectangle_document).unwrap();
        let invalid_geometry = envelope(
            rectangle_engine.document(),
            "invalid-size",
            CommandV1::UpdateRectangle {
                element_id: "rect-1".to_string(),
                patch: RectanglePatchV1 {
                    width: Some(0.0),
                    ..RectanglePatchV1::default()
                },
            },
        );
        assert_eq!(
            rectangle_engine.execute_command(invalid_geometry),
            Err(EngineErrorV1::InvalidRectangle {
                element_id: "rect-1".to_string(),
            })
        );
        assert_eq!(
            rectangle_engine.document().elements["rect-1"],
            ElementRecordV1::Rect(rectangle("rect-1", 10.0))
        );
    }

    #[test]
    fn create_move_and_undo_keep_revisions_monotonic() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let create = envelope(
            engine.document(),
            "command-1",
            CommandV1::CreateRectangle {
                rectangle: rectangle("rect-1", 24.0),
            },
        );
        let created = engine.execute_command(create).unwrap();
        assert_eq!(created.scene.document_revision, 1);
        assert!(created.history.can_undo);

        let movement = envelope(
            engine.document(),
            "command-2",
            CommandV1::MoveElements {
                element_ids: vec!["rect-1".to_string()],
                delta: Vec2 { x: 32.0, y: 8.0 },
            },
        );
        let moved = engine.execute_command(movement).unwrap();
        let SceneNodeV1::Rect(moved_rectangle) = &moved.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!((moved_rectangle.x, moved_rectangle.y), (24.0, 40.0));
        assert_eq!(
            (moved_rectangle.transform.e, moved_rectangle.transform.f),
            (32.0, 8.0)
        );

        let undone = engine.undo().unwrap();
        let SceneNodeV1::Rect(undone_rectangle) = &undone.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!((undone_rectangle.x, undone_rectangle.y), (24.0, 40.0));
        assert_eq!(undone.scene.document_revision, 3);
        assert!(undone.history.can_redo);
    }

    #[test]
    fn revision_conflict_does_not_modify_the_document() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let before = engine.document().clone();
        let command = CommandEnvelopeV1 {
            expected_revision: 7,
            ..envelope(
                engine.document(),
                "stale-command",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-1", 24.0),
                },
            )
        };

        assert_eq!(
            engine.execute_command(command),
            Err(EngineErrorV1::RevisionConflict {
                expected: 7,
                actual: 0,
            })
        );
        assert_eq!(engine.document(), &before);
    }

    #[test]
    fn failed_batch_validation_is_atomic() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        let first = rectangle("rect-1", 24.0);
        document.root_order.push(first.id.clone());
        document
            .elements
            .insert(first.id.clone(), ElementRecordV1::Rect(first));
        let mut engine = Engine::open(document).unwrap();
        let before = engine.document().clone();
        let command = envelope(
            engine.document(),
            "invalid-move",
            CommandV1::MoveElements {
                element_ids: vec!["rect-1".to_string(), "missing".to_string()],
                delta: Vec2 { x: 12.0, y: 0.0 },
            },
        );

        assert_eq!(
            engine.execute_command(command),
            Err(EngineErrorV1::ElementNotFound {
                element_id: "missing".to_string(),
            })
        );
        assert_eq!(engine.document(), &before);
    }

    #[test]
    fn scene_serialization_is_deterministic() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        for rectangle in [rectangle("rect-b", 200.0), rectangle("rect-a", 24.0)] {
            document.root_order.push(rectangle.id.clone());
            document
                .elements
                .insert(rectangle.id.clone(), ElementRecordV1::Rect(rectangle));
        }
        let engine = Engine::open(document).unwrap();
        let first = serde_json::to_string(&engine.current_update().scene).unwrap();
        let second = serde_json::to_string(&engine.current_update().scene).unwrap();
        let scene = engine.current_update().scene;

        assert_eq!(first, second);
        assert_eq!(scene.root_node_ids, ["rect-b:shape", "rect-a:shape"]);
        assert_eq!(
            scene.nodes.keys().map(String::as_str).collect::<Vec<_>>(),
            ["rect-a:shape", "rect-b:shape"]
        );
    }

    #[test]
    fn command_wire_fields_use_camel_case() {
        let command: CommandEnvelopeV1 = serde_json::from_value(serde_json::json!({
            "protocolVersion": 1,
            "commandId": "command-1",
            "documentId": "doc-1",
            "expectedRevision": 0,
            "command": {
                "type": "move_elements",
                "elementIds": ["rect-1"],
                "delta": { "x": 24.0, "y": 8.0 }
            }
        }))
        .unwrap();

        assert_eq!(
            command.command,
            CommandV1::MoveElements {
                element_ids: vec!["rect-1".to_string()],
                delta: Vec2 { x: 24.0, y: 8.0 },
            }
        );
    }

    #[test]
    fn text_scene_nodes_use_framework_neutral_wire_fields() {
        let node = SceneNodeV1::Text(SceneTextV1 {
            id: "text-1:run".to_string(),
            source_element_id: "text-1".to_string(),
            transform: Affine2D::identity(),
            runs: vec![SceneTextRunV1 {
                text: "NodeInk 画布".to_string(),
                x: 24.0,
                y: 48.0,
                font_family: "Arial".to_string(),
                font_size: 20.0,
                font_weight: 400,
                fill: "#0f172a".to_string(),
                text_anchor: TextAnchorV1::Start,
            }],
        });

        let value = serde_json::to_value(node).unwrap();
        assert_eq!(value["kind"], "text");
        assert_eq!(value["sourceElementId"], "text-1");
        assert_eq!(value["runs"][0]["fontFamily"], "Arial");
        assert_eq!(value["runs"][0]["fontWeight"], 400);
    }

    #[test]
    fn redo_restores_an_undone_document_and_new_commands_clear_redo() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine
            .execute_command(envelope(
                engine.document(),
                "create-1",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-1", 24.0),
                },
            ))
            .unwrap();

        engine.undo().unwrap();
        let redone = engine.redo().unwrap();
        assert_eq!(redone.scene.document_revision, 3);
        assert_eq!(redone.scene.root_node_ids, ["rect-1:shape"]);
        assert!(redone.history.can_undo);
        assert!(!redone.history.can_redo);

        engine.undo().unwrap();
        engine
            .execute_command(envelope(
                engine.document(),
                "create-2",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-2", 64.0),
                },
            ))
            .unwrap();
        assert_eq!(engine.redo(), Err(EngineErrorV1::RedoUnavailable));
    }

    #[test]
    fn unavailable_history_operations_are_reported() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();

        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));
        assert_eq!(engine.redo(), Err(EngineErrorV1::RedoUnavailable));
    }

    #[test]
    fn invalid_envelopes_and_commands_never_mutate_the_document() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let before = engine.document().clone();

        let unsupported_protocol = CommandEnvelopeV1 {
            protocol_version: 2,
            ..envelope(
                engine.document(),
                "unsupported",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-1", 24.0),
                },
            )
        };
        assert_eq!(
            engine.execute_command(unsupported_protocol),
            Err(EngineErrorV1::UnsupportedProtocol { actual: 2 })
        );

        let wrong_document = CommandEnvelopeV1 {
            document_id: "other-document".to_string(),
            ..envelope(
                engine.document(),
                "wrong-document",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-1", 24.0),
                },
            )
        };
        assert_eq!(
            engine.execute_command(wrong_document),
            Err(EngineErrorV1::DocumentMismatch)
        );
        assert_eq!(engine.document(), &before);

        engine
            .execute_command(envelope(
                engine.document(),
                "create",
                CommandV1::CreateRectangle {
                    rectangle: rectangle("rect-1", 24.0),
                },
            ))
            .unwrap();
        let after_create = engine.document().clone();

        let duplicate = envelope(
            engine.document(),
            "duplicate",
            CommandV1::CreateRectangle {
                rectangle: rectangle("rect-1", 48.0),
            },
        );
        assert_eq!(
            engine.execute_command(duplicate),
            Err(EngineErrorV1::ElementAlreadyExists {
                element_id: "rect-1".to_string(),
            })
        );

        let invalid_rectangle = envelope(
            engine.document(),
            "invalid-rectangle",
            CommandV1::CreateRectangle {
                rectangle: RectElementV1 {
                    width: 0.0,
                    ..rectangle("rect-2", 48.0)
                },
            },
        );
        assert_eq!(
            engine.execute_command(invalid_rectangle),
            Err(EngineErrorV1::InvalidRectangle {
                element_id: "rect-2".to_string(),
            })
        );

        let invalid_delta = envelope(
            engine.document(),
            "invalid-delta",
            CommandV1::MoveElements {
                element_ids: vec!["rect-1".to_string()],
                delta: Vec2 {
                    x: f64::NAN,
                    y: 0.0,
                },
            },
        );
        assert_eq!(
            engine.execute_command(invalid_delta),
            Err(EngineErrorV1::InvalidDelta)
        );
        assert_eq!(engine.document(), &after_create);
    }

    #[test]
    fn opening_invalid_documents_reports_the_broken_invariant() {
        let mut unsupported_schema = NodeInkDocumentV1::blank("doc-1");
        unsupported_schema.schema_version = 4;
        assert_eq!(
            Engine::open(unsupported_schema).unwrap_err(),
            EngineErrorV1::UnsupportedSchema { actual: 4 }
        );

        assert_eq!(
            Engine::open(NodeInkDocumentV1::blank("  ")).unwrap_err(),
            EngineErrorV1::InvalidDocument {
                reason: "documentId must not be empty".to_string(),
            }
        );

        let mut different_lengths = NodeInkDocumentV1::blank("doc-1");
        different_lengths.root_order.push("missing".to_string());
        assert_eq!(
            Engine::open(different_lengths).unwrap_err(),
            EngineErrorV1::InvalidHierarchy {
                reason: "UnknownElement { element_id: \"missing\" }".to_string(),
            }
        );

        let mut missing_element = NodeInkDocumentV1::blank("doc-1");
        missing_element.root_order.push("missing".to_string());
        missing_element.elements.insert(
            "other".to_string(),
            ElementRecordV1::Rect(rectangle("other", 24.0)),
        );
        assert_eq!(
            Engine::open(missing_element).unwrap_err(),
            EngineErrorV1::InvalidHierarchy {
                reason: "UnknownElement { element_id: \"missing\" }".to_string(),
            }
        );

        let mut mismatched_key = NodeInkDocumentV1::blank("doc-1");
        mismatched_key.root_order.push("rect-key".to_string());
        mismatched_key.elements.insert(
            "rect-key".to_string(),
            ElementRecordV1::Rect(rectangle("rect-id", 24.0)),
        );
        assert_eq!(
            Engine::open(mismatched_key).unwrap_err(),
            EngineErrorV1::InvalidDocument {
                reason: "element key rect-key does not match its id".to_string(),
            }
        );

        let mut invalid_rectangle_document = NodeInkDocumentV1::blank("doc-1");
        invalid_rectangle_document
            .root_order
            .push("rect-1".to_string());
        invalid_rectangle_document.elements.insert(
            "rect-1".to_string(),
            ElementRecordV1::Rect(RectElementV1 {
                height: f64::INFINITY,
                ..rectangle("rect-1", 24.0)
            }),
        );
        assert_eq!(
            Engine::open(invalid_rectangle_document).unwrap_err(),
            EngineErrorV1::InvalidRectangle {
                element_id: "rect-1".to_string(),
            }
        );
    }

    #[test]
    fn current_update_and_document_serialization_reflect_the_open_document() {
        let engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();

        assert_eq!(engine.current_update().scene.document_revision, 0);
        assert_eq!(engine.current_update().active_tool, EditorToolV1::Select);
        assert_eq!(
            engine.serialize_document().unwrap(),
            r#"{"schemaVersion":3,"documentId":"doc-1","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#
        );
    }

    #[test]
    fn tool_state_is_transient_and_switching_tools_clears_selection() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();
        engine
            .handle_pointer_events(
                "select".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 1, 32.0, 48.0)],
            )
            .unwrap();
        let serialized_before = engine.serialize_document().unwrap();

        let freehand = engine.set_active_tool(EditorToolV1::Freehand);

        assert_eq!(freehand.active_tool, EditorToolV1::Freehand);
        assert_eq!(freehand.selection, SelectionStateV1::default());
        assert_eq!(freehand.scene.document_revision, 0);
        assert!(!freehand.history.can_undo);
        assert_eq!(engine.serialize_document().unwrap(), serialized_before);

        let unchanged = engine.set_active_tool(EditorToolV1::Freehand);
        assert_eq!(unchanged, freehand);
        assert_eq!(
            engine.set_active_tool(EditorToolV1::Select).active_tool,
            EditorToolV1::Select
        );
    }

    #[test]
    fn tool_handlers_reject_wrong_routes_without_changing_engine_state() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let select_state = engine.current_update();

        assert_eq!(
            engine.handle_stroke_batch(
                "stroke".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(0.0, 0.0)], Some("stroke-1")),
            ),
            Err(EngineErrorV1::ToolInputMismatch {
                active_tool: EditorToolV1::Select,
                required_tool: EditorToolV1::Freehand,
            })
        );
        assert_eq!(engine.current_update(), select_state);

        engine.set_active_tool(EditorToolV1::Freehand);
        let freehand_state = engine.current_update();
        assert_eq!(
            engine.handle_pointer_events(
                "pointer".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 1, 0.0, 0.0)],
            ),
            Err(EngineErrorV1::ToolInputMismatch {
                active_tool: EditorToolV1::Freehand,
                required_tool: EditorToolV1::Select,
            })
        );
        assert_eq!(engine.current_update(), freehand_state);
    }

    #[test]
    fn switching_tools_cancels_pointer_and_stroke_previews() {
        let mut pointer_engine = Engine::open(document_with_rectangle()).unwrap();
        pointer_engine
            .handle_pointer_events(
                "drag".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 1, 24.0)],
            )
            .unwrap();
        let preview = pointer_engine
            .handle_pointer_events(
                "drag".to_string(),
                vec![pointer_event(PointerPhaseV1::Move, 2, 56.0)],
            )
            .unwrap();
        let SceneNodeV1::Rect(preview_rectangle) = &preview.update.scene.nodes["rect-1:shape"]
        else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(preview_rectangle.x, 24.0);
        assert_eq!(preview_rectangle.transform.e, 32.0);

        let switched = pointer_engine.set_active_tool(EditorToolV1::Freehand);
        let SceneNodeV1::Rect(restored_rectangle) = &switched.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(restored_rectangle.x, 24.0);
        assert_eq!(switched.selection, SelectionStateV1::default());
        assert_eq!(switched.scene.document_revision, 0);
        assert_eq!(
            switched.scene.scene_revision,
            preview.update.scene.scene_revision + 1
        );

        let mut stroke_engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        stroke_engine.set_active_tool(EditorToolV1::Freehand);
        let stroke_preview = stroke_engine
            .handle_stroke_batch(
                "stroke".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(8.0, 12.0)], Some("stroke-1")),
            )
            .unwrap();
        assert_eq!(
            stroke_preview.update.scene.root_node_ids,
            vec!["stroke-1:path"]
        );

        let cancelled = stroke_engine.set_active_tool(EditorToolV1::Select);
        assert!(cancelled.scene.root_node_ids.is_empty());
        assert_eq!(cancelled.scene.document_revision, 0);
        assert!(!cancelled.history.can_undo);
        assert_eq!(
            cancelled.scene.scene_revision,
            stroke_preview.update.scene.scene_revision + 1
        );
    }

    #[test]
    fn pointer_drag_previews_without_mutation_then_commits_one_undo_entry() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();

        let down = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 1, 24.0)],
            )
            .unwrap();
        assert!(!down.did_commit);
        assert_eq!(down.processed_event_count, 1);
        assert_eq!(
            down.update.selection.selected_element_id.as_deref(),
            Some("rect-1")
        );

        let preview = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Move, 2, 56.0)],
            )
            .unwrap();
        let SceneNodeV1::Rect(preview_rectangle) = &preview.update.scene.nodes["rect-1:shape"]
        else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(preview_rectangle.x, 24.0);
        assert_eq!(preview_rectangle.transform.e, 32.0);
        assert_eq!(
            preview.update.selection.visual_bounds.as_ref().unwrap().x,
            55.0
        );
        assert_eq!(preview.update.scene.document_revision, 0);
        let ElementRecordV1::Rect(document_rectangle) = &engine.document().elements["rect-1"]
        else {
            panic!("document element should remain a rectangle");
        };
        assert_eq!(document_rectangle.x, 24.0);

        let committed = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Up, 3, 56.0)],
            )
            .unwrap();
        assert!(committed.did_commit);
        assert_eq!(committed.update.scene.document_revision, 1);
        let SceneNodeV1::Rect(committed_rectangle) = &committed.update.scene.nodes["rect-1:shape"]
        else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(committed_rectangle.x, 24.0);
        assert_eq!(committed_rectangle.transform.e, 32.0);

        let undone = engine.undo().unwrap();
        let SceneNodeV1::Rect(undone_rectangle) = &undone.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(undone_rectangle.x, 24.0);
        assert!(!undone.history.can_undo);
    }

    #[test]
    fn pointer_batches_ignore_other_pointers_and_out_of_order_sequences() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();
        let batch = engine
            .handle_pointer_events(
                "drag-batch".to_string(),
                vec![
                    pointer_event(PointerPhaseV1::Down, 10, 24.0),
                    NormalizedPointerEventV1 {
                        pointer_id: 2,
                        ..pointer_event(PointerPhaseV1::Move, 11, 40.0)
                    },
                    pointer_event(PointerPhaseV1::Move, 11, 40.0),
                    pointer_event(PointerPhaseV1::Move, 11, 48.0),
                    pointer_event(PointerPhaseV1::Move, 12, 64.0),
                ],
            )
            .unwrap();

        assert_eq!(batch.processed_event_count, 5);
        assert_eq!(batch.ignored_event_count, 2);
        let SceneNodeV1::Rect(preview_rectangle) = &batch.update.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(preview_rectangle.x, 24.0);
        assert_eq!(preview_rectangle.transform.e, 40.0);
        assert_eq!(engine.document().revision, 0);
    }

    #[test]
    fn pointer_cancel_and_zero_delta_up_do_not_create_history() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();
        let ignored = engine
            .handle_pointer_events(
                "ignored".to_string(),
                vec![pointer_event(PointerPhaseV1::Move, 1, 40.0)],
            )
            .unwrap();
        assert_eq!(ignored.ignored_event_count, 1);

        engine
            .handle_pointer_events(
                "cancelled".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 2, 24.0)],
            )
            .unwrap();
        let cancelled = engine
            .handle_pointer_events(
                "cancelled".to_string(),
                vec![pointer_event(PointerPhaseV1::Cancel, 3, 48.0)],
            )
            .unwrap();
        assert!(!cancelled.did_commit);
        assert_eq!(cancelled.update.scene.document_revision, 0);

        engine
            .handle_pointer_events(
                "zero".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 4, 24.0)],
            )
            .unwrap();
        let zero_delta = engine
            .handle_pointer_events(
                "zero".to_string(),
                vec![pointer_event(PointerPhaseV1::Up, 5, 24.0)],
            )
            .unwrap();
        assert!(!zero_delta.did_commit);
        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));
    }

    #[test]
    fn pointer_hit_test_selects_topmost_geometry_and_blank_canvas_clears_selection() {
        let mut document = document_with_rectangle();
        let top = RectElementV1 {
            id: "rect-top".to_string(),
            transform: Affine2D::identity(),
            x: 20.0,
            y: 30.0,
            width: 120.0,
            height: 80.0,
            fill: FillV1::default_rectangle(),
            stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
            stroke_width: DEFAULT_RECTANGLE_STROKE_WIDTH,
        };
        document.root_order.push(top.id.clone());
        document
            .elements
            .insert(top.id.clone(), ElementRecordV1::Rect(top));
        let mut engine = Engine::open(document).unwrap();
        let serialized_before = engine.serialize_document().unwrap();
        let scene_revision_before = engine.current_update().scene.scene_revision;

        let selected = engine
            .handle_pointer_events(
                "select-top".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 1, 32.0, 40.0)],
            )
            .unwrap();

        assert_eq!(
            selected.update.selection.selected_element_id.as_deref(),
            Some("rect-top")
        );
        assert_eq!(
            selected.update.selection.visual_bounds,
            Some(SelectionBoundsV1 {
                x: 19.0,
                y: 29.0,
                width: 122.0,
                height: 82.0,
            })
        );
        assert_eq!(selected.update.scene.document_revision, 0);
        assert_eq!(selected.update.scene.scene_revision, scene_revision_before);
        assert_eq!(engine.serialize_document().unwrap(), serialized_before);

        engine
            .handle_pointer_events(
                "select-top".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Up, 2, 32.0, 40.0)],
            )
            .unwrap();
        let cleared = engine
            .handle_pointer_events(
                "clear".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 3, 400.0, 400.0)],
            )
            .unwrap();

        assert_eq!(cleared.update.selection, SelectionStateV1::default());
        assert_eq!(cleared.update.scene.document_revision, 0);
        assert_eq!(engine.serialize_document().unwrap(), serialized_before);
    }

    #[test]
    fn pointer_hit_test_selects_strokes_with_screen_space_tolerance() {
        let document = document_with_rectangle_and_stroke();
        let mut engine = Engine::open(document).unwrap();
        engine
            .set_camera(CameraV1 {
                x: 0.0,
                y: 0.0,
                zoom: 2.0,
            })
            .unwrap();

        let selected = engine
            .handle_pointer_events(
                "select-stroke".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 1, 16.0, 24.0)],
            )
            .unwrap();

        assert_eq!(
            selected.update.selection.selected_element_id.as_deref(),
            Some("stroke-1")
        );
    }

    #[test]
    fn deleting_the_selection_is_one_undoable_transaction_and_clears_editor_state() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();
        engine
            .handle_pointer_events(
                "select".to_string(),
                vec![pointer_event_at(PointerPhaseV1::Down, 1, 32.0, 48.0)],
            )
            .unwrap();
        let delete = envelope(
            engine.document(),
            "delete-selection",
            CommandV1::DeleteElements {
                element_ids: vec!["rect-1".to_string()],
            },
        );

        let deleted = engine.execute_command(delete).unwrap();

        assert_eq!(deleted.selection, SelectionStateV1::default());
        assert!(deleted.scene.root_node_ids.is_empty());
        assert_eq!(deleted.scene.document_revision, 1);
        assert!(deleted.history.can_undo);

        let restored = engine.undo().unwrap();
        assert!(restored.scene.nodes.contains_key("rect-1:shape"));
        assert_eq!(restored.selection, SelectionStateV1::default());
        assert_eq!(restored.scene.document_revision, 2);
    }

    #[test]
    fn stroke_batches_preview_without_document_mutation_and_commit_once() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Freehand);
        let down = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(10.0, 20.0)], Some("stroke-1")),
            )
            .unwrap();
        assert!(!down.did_commit);
        assert_eq!(down.update.scene.document_revision, 0);
        assert!(engine.document().elements.is_empty());

        let preview = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(
                    StrokePhaseV1::Move,
                    2,
                    &[(12.0, 22.0), (14.0, 24.0), (16.0, 26.0)],
                    None,
                ),
            )
            .unwrap();
        let SceneNodeV1::Path(preview_path) = &preview.update.scene.nodes["stroke-1:path"] else {
            panic!("stroke preview should resolve to a path");
        };
        assert_eq!(
            preview_path.path_data,
            "M 10 20 Q 10 20 11 21 Q 12 22 13 23 Q 14 24 15 25 Q 16 26 16 26"
        );
        assert_eq!(preview.processed_point_count, 3);
        assert!(engine.document().elements.is_empty());

        let committed = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Up, 5, &[(16.0, 26.0)], None),
            )
            .unwrap();
        assert!(committed.did_commit);
        assert_eq!(committed.update.scene.document_revision, 1);
        assert_eq!(engine.document().elements.len(), 1);

        let undone = engine.undo().unwrap();
        assert!(undone.scene.nodes.is_empty());
        assert!(!undone.history.can_undo);
    }

    #[test]
    fn single_point_strokes_preview_and_commit_as_stable_round_dots() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Freehand);

        let preview = engine
            .handle_stroke_batch(
                "dot".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(10.0, 20.0)], Some("dot-1")),
            )
            .unwrap();
        let SceneNodeV1::Path(preview_path) = &preview.update.scene.nodes["dot-1:path"] else {
            panic!("stroke preview should resolve to a path");
        };
        assert_eq!(preview_path.path_data, "M 10 20 L 10 20");
        assert_eq!(preview.update.scene.document_revision, 0);

        let committed = engine
            .handle_stroke_batch(
                "dot".to_string(),
                stroke_batch(StrokePhaseV1::Up, 2, &[(10.0, 20.0)], None),
            )
            .unwrap();

        assert!(committed.did_commit);
        assert_eq!(committed.update.scene.document_revision, 1);
        let ElementRecordV1::Stroke(dot) = &engine.document().elements["dot-1"] else {
            panic!("dot should commit as a stroke");
        };
        assert_eq!(
            dot.points,
            vec![Vec2 { x: 10.0, y: 20.0 }, Vec2 { x: 10.0, y: 20.0 }]
        );
        assert_eq!(dot.stroke_width, 3.0);
        assert_eq!(committed.update.active_tool, EditorToolV1::Freehand);
        assert_eq!(committed.update.selection, SelectionStateV1::default());

        let undone = engine.undo().unwrap();
        assert!(undone.scene.nodes.is_empty());
        assert_eq!(undone.active_tool, EditorToolV1::Freehand);
    }

    #[test]
    fn shift_freehand_previews_and_commits_only_the_straight_line_endpoints() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Freehand);
        let mut down = stroke_batch(StrokePhaseV1::Down, 1, &[(10.0, 20.0)], Some("line-1"));
        down.straight_line = true;
        engine
            .handle_stroke_batch("line".to_string(), down)
            .unwrap();

        let mut preview_batch =
            stroke_batch(StrokePhaseV1::Move, 2, &[(30.0, 25.0), (60.0, 80.0)], None);
        preview_batch.straight_line = true;
        let preview = engine
            .handle_stroke_batch("line".to_string(), preview_batch)
            .unwrap();
        let SceneNodeV1::Path(path) = &preview.update.scene.nodes["line-1:path"] else {
            panic!("straight stroke preview should resolve to a path");
        };
        assert_eq!(path.path_data, "M 10 20 L 60 80");

        let mut up = stroke_batch(StrokePhaseV1::Up, 4, &[(90.0, 100.0)], None);
        up.straight_line = true;
        let committed = engine.handle_stroke_batch("line".to_string(), up).unwrap();
        assert!(committed.did_commit);
        let ElementRecordV1::Stroke(line) = &engine.document().elements["line-1"] else {
            panic!("straight line should remain a stroke element");
        };
        assert_eq!(
            line.points,
            vec![Vec2 { x: 10.0, y: 20.0 }, Vec2 { x: 90.0, y: 100.0 }]
        );
    }

    #[test]
    fn stroke_batches_filter_wrong_pointers_and_out_of_order_points() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Freehand);
        engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Down, 10, &[(0.0, 0.0)], Some("stroke-1")),
            )
            .unwrap();
        let wrong_pointer = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                StrokeInputBatchV1 {
                    pointer_id: 2,
                    ..stroke_batch(StrokePhaseV1::Move, 11, &[(1.0, 1.0)], None)
                },
            )
            .unwrap();
        assert_eq!(wrong_pointer.ignored_point_count, 1);

        engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Move, 11, &[(1.0, 1.0), (2.0, 2.0)], None),
            )
            .unwrap();
        let overlap = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Move, 12, &[(2.0, 2.0), (3.0, 3.0)], None),
            )
            .unwrap();
        assert_eq!(overlap.ignored_point_count, 1);
        let SceneNodeV1::Path(path) = &overlap.update.scene.nodes["stroke-1:path"] else {
            panic!("stroke preview should resolve to a path");
        };
        assert_eq!(
            path.path_data,
            "M 0 0 Q 0 0 0.5 0.5 Q 1 1 1.5 1.5 Q 2 2 2.5 2.5 Q 3 3 3 3"
        );

        let ignored_cancel = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                StrokeInputBatchV1 {
                    pointer_id: 2,
                    ..stroke_batch(StrokePhaseV1::Cancel, 14, &[], None)
                },
            )
            .unwrap();
        assert_eq!(
            ignored_cancel.update.scene.root_node_ids,
            vec!["stroke-1:path"]
        );
        let cancelled = engine
            .handle_stroke_batch(
                "stroke-command".to_string(),
                stroke_batch(StrokePhaseV1::Cancel, 14, &[], None),
            )
            .unwrap();
        assert!(cancelled.update.scene.nodes.is_empty());
        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));
    }

    #[test]
    fn invalid_stroke_inputs_and_commands_are_atomic() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Freehand);
        assert_eq!(
            engine.handle_stroke_batch(
                "missing-id".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(0.0, 0.0)], None),
            ),
            Err(EngineErrorV1::InvalidStrokeInput {
                reason: "down requires a strokeId".to_string(),
            })
        );
        assert_eq!(
            engine.handle_stroke_batch(
                "invalid-point".to_string(),
                stroke_batch(StrokePhaseV1::Down, 1, &[(f64::NAN, 0.0)], Some("stroke-1"),),
            ),
            Err(EngineErrorV1::InvalidStrokeInput {
                reason: "points must be finite".to_string(),
            })
        );

        let invalid = envelope(
            engine.document(),
            "invalid-stroke",
            CommandV1::CreateStroke {
                stroke: StrokeElementV1 {
                    id: "stroke-1".to_string(),
                    transform: Affine2D::identity(),
                    points: vec![Vec2 { x: 0.0, y: 0.0 }],
                    stroke: DEFAULT_INK_COLOR.to_string(),
                    stroke_width: 3.0,
                },
            },
        );
        assert_eq!(
            engine.execute_command(invalid),
            Err(EngineErrorV1::InvalidStroke {
                element_id: "stroke-1".to_string(),
            })
        );
        assert!(engine.document().elements.is_empty());
    }

    #[test]
    fn committed_strokes_can_be_translated_by_the_shared_move_command() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let create = envelope(
            engine.document(),
            "create-stroke",
            CommandV1::CreateStroke {
                stroke: StrokeElementV1 {
                    id: "stroke-1".to_string(),
                    transform: Affine2D::identity(),
                    points: vec![Vec2 { x: 1.0, y: 2.0 }, Vec2 { x: 3.0, y: 4.0 }],
                    stroke: DEFAULT_INK_COLOR.to_string(),
                    stroke_width: 2.0,
                },
            },
        );
        engine.execute_command(create).unwrap();
        let movement = envelope(
            engine.document(),
            "move-stroke",
            CommandV1::MoveElements {
                element_ids: vec!["stroke-1".to_string()],
                delta: Vec2 { x: 5.0, y: 6.0 },
            },
        );
        let moved = engine.execute_command(movement).unwrap();
        let SceneNodeV1::Path(path) = &moved.scene.nodes["stroke-1:path"] else {
            panic!("stroke should resolve to a path");
        };
        assert_eq!(path.path_data, "M 1 2 L 3 4");
        assert_eq!((path.transform.e, path.transform.f), (5.0, 6.0));
    }

    #[test]
    fn sketch_scene_is_stable_across_one_thousand_resolutions() {
        let engine = Engine::open(document_with_rectangle_and_stroke()).unwrap();
        let profile = sketch_profile(42, 1.2, SketchFillStyleV1::Hachure);
        let first = engine.resolve_scene_profile(profile.clone()).unwrap();

        for _ in 0..1_000 {
            let repeated = engine.resolve_scene_profile(profile.clone()).unwrap();
            assert_eq!(repeated.canonical_hash, first.canonical_hash);
            assert_eq!(repeated.scene, first.scene);
        }
        assert_eq!(first.engine_algorithm_version, ENGINE_ALGORITHM_VERSION);
        assert_eq!(first.scene.root_node_ids.len(), 3);
        assert!(first.scene.nodes.contains_key("rect-1:sketch:outline:v1"));
        assert!(first.scene.nodes.contains_key("rect-1:sketch:fill:v1"));
        assert!(first.scene.nodes.contains_key("stroke-1:sketch:path:v1"));
    }

    #[test]
    fn sketch_seed_profile_and_fill_changes_have_distinct_hashes() {
        let engine = Engine::open(document_with_rectangle_and_stroke()).unwrap();
        let base = engine
            .resolve_scene_profile(sketch_profile(42, 1.2, SketchFillStyleV1::Hachure))
            .unwrap();
        let different_seed = engine
            .resolve_scene_profile(sketch_profile(43, 1.2, SketchFillStyleV1::Hachure))
            .unwrap();
        let different_roughness = engine
            .resolve_scene_profile(sketch_profile(42, 2.0, SketchFillStyleV1::Hachure))
            .unwrap();
        let solid = engine
            .resolve_scene_profile(sketch_profile(42, 1.2, SketchFillStyleV1::Solid))
            .unwrap();
        let clean = engine
            .resolve_scene_profile(RenderProfileV1::clean())
            .unwrap();

        let hashes = [
            &base.canonical_hash,
            &different_seed.canonical_hash,
            &different_roughness.canonical_hash,
            &solid.canonical_hash,
            &clean.canonical_hash,
        ];
        for (index, hash) in hashes.iter().enumerate() {
            assert!(!hashes[..index].contains(hash));
        }
        assert_eq!(solid.scene.root_node_ids.len(), 2);
        assert_eq!(clean.scene.root_node_ids.len(), 2);
    }

    #[test]
    fn invalid_render_profiles_are_rejected() {
        let engine = Engine::open(document_with_rectangle_and_stroke()).unwrap();
        assert_eq!(
            engine.resolve_scene_profile(RenderProfileV1::Clean { version: 2 }),
            Err(EngineErrorV1::InvalidRenderProfile)
        );
        assert_eq!(
            engine.resolve_scene_profile(sketch_profile(42, f64::NAN, SketchFillStyleV1::Hachure,)),
            Err(EngineErrorV1::InvalidRenderProfile)
        );
        assert_eq!(
            engine.resolve_scene_profile(sketch_profile(42, 16.1, SketchFillStyleV1::Hachure,)),
            Err(EngineErrorV1::InvalidRenderProfile)
        );
    }

    #[test]
    fn persistent_styles_are_atomic_undoable_and_noops_do_not_create_history() {
        let mut engine = Engine::open(document_with_three_elements()).unwrap();

        let rectangle_update = engine
            .execute_command(envelope(
                engine.document(),
                "style-rect",
                CommandV1::UpdateElementStyle {
                    element_id: "rect-1".to_string(),
                    patch: ElementStylePatchV1::Rect {
                        fill: Some(FillV1::None),
                        stroke: Some("#2563eb".to_string()),
                        stroke_width: Some(4.0),
                    },
                },
            ))
            .unwrap();
        assert_eq!(rectangle_update.scene.document_revision, 1);
        assert_eq!(
            rectangle_update.selection.style,
            Some(SelectionStyleV1::Rect {
                fill: FillV1::None,
                stroke: "#2563eb".to_string(),
                stroke_width: 4.0,
            })
        );

        let no_op = engine
            .execute_command(envelope(
                engine.document(),
                "style-rect-noop",
                CommandV1::UpdateElementStyle {
                    element_id: "rect-1".to_string(),
                    patch: ElementStylePatchV1::Rect {
                        fill: Some(FillV1::None),
                        stroke: Some("#2563eb".to_string()),
                        stroke_width: Some(4.0),
                    },
                },
            ))
            .unwrap();
        assert_eq!(no_op.scene.document_revision, 1);
        assert!(no_op.operation.is_none());

        let undone_rectangle = engine.undo().unwrap();
        assert_eq!(undone_rectangle.scene.document_revision, 2);
        let ElementRecordV1::Rect(rectangle) = &engine.document().elements["rect-1"] else {
            panic!("fixture element must remain a rectangle");
        };
        assert_eq!(rectangle.fill, FillV1::default_rectangle());
        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));

        let stroke_update = engine
            .execute_command(envelope(
                engine.document(),
                "style-stroke",
                CommandV1::UpdateElementStyle {
                    element_id: "stroke-1".to_string(),
                    patch: ElementStylePatchV1::Stroke {
                        stroke: Some("#dc2626".to_string()),
                        stroke_width: Some(6.0),
                    },
                },
            ))
            .unwrap();
        assert_eq!(stroke_update.scene.document_revision, 3);
        assert_eq!(
            stroke_update.selection.style,
            Some(SelectionStyleV1::Stroke {
                stroke: "#dc2626".to_string(),
                stroke_width: 6.0,
            })
        );
        engine.undo().unwrap();

        let text_update = engine
            .execute_command(envelope(
                engine.document(),
                "style-text",
                CommandV1::UpdateElementStyle {
                    element_id: "text-1".to_string(),
                    patch: ElementStylePatchV1::Text {
                        color: Some("#7c3aed".to_string()),
                        text_align: Some(TextAlignV1::End),
                        font_size: Some(32.0),
                        font_weight: Some(500),
                    },
                },
            ))
            .unwrap();
        assert_eq!(text_update.scene.document_revision, 5);
        assert_eq!(
            text_update.selection.style,
            Some(SelectionStyleV1::Text {
                color: "#7c3aed".to_string(),
                text_align: TextAlignV1::End,
                font_size: 32.0,
                font_weight: 500,
            })
        );
        engine.undo().unwrap();

        let before_invalid = engine.document().clone();
        for command in [
            CommandV1::UpdateElementStyle {
                element_id: "rect-1".to_string(),
                patch: ElementStylePatchV1::Rect {
                    fill: None,
                    stroke: None,
                    stroke_width: None,
                },
            },
            CommandV1::UpdateElementStyle {
                element_id: "rect-1".to_string(),
                patch: ElementStylePatchV1::Stroke {
                    stroke: Some("#2563eb".to_string()),
                    stroke_width: None,
                },
            },
            CommandV1::UpdateElementStyle {
                element_id: "rect-1".to_string(),
                patch: ElementStylePatchV1::Rect {
                    fill: None,
                    stroke: Some("#2563EB".to_string()),
                    stroke_width: Some(129.0),
                },
            },
        ] {
            assert!(
                engine
                    .execute_command(envelope(engine.document(), "invalid-style", command))
                    .is_err()
            );
            assert_eq!(engine.document(), &before_invalid);
        }
    }

    #[test]
    fn persistent_profile_switch_is_undoable_deterministic_and_semantic_preserving() {
        let mut engine = Engine::open(document_with_rectangle_and_stroke()).unwrap();
        let semantic_elements = engine.document().elements.clone();
        let profile = sketch_profile(1_313_817_669, 1.2, SketchFillStyleV1::Hachure);
        let wire = serde_json::to_value(envelope(
            engine.document(),
            "profile-wire",
            CommandV1::SetRenderProfile {
                render_profile: profile.clone(),
            },
        ))
        .unwrap();
        assert_eq!(wire["command"]["type"], "set_render_profile");
        assert_eq!(wire["command"]["renderProfile"]["kind"], "sketch");
        assert!(wire["command"].get("profile").is_none());

        let switched = engine
            .execute_command(envelope(
                engine.document(),
                "profile-sketch",
                CommandV1::SetRenderProfile {
                    render_profile: profile.clone(),
                },
            ))
            .unwrap();
        assert_eq!(switched.scene.document_revision, 1);
        assert_eq!(switched.scene.render_profile, profile);
        assert_eq!(engine.document().elements, semantic_elements);
        let first_nodes = switched.scene.nodes.clone();
        for _ in 0..1_000 {
            assert_eq!(engine.current_update().scene.nodes, first_nodes);
        }

        let no_op = engine
            .execute_command(envelope(
                engine.document(),
                "profile-noop",
                CommandV1::SetRenderProfile {
                    render_profile: engine.document().render_profile.clone(),
                },
            ))
            .unwrap();
        assert_eq!(no_op.scene.document_revision, 1);
        assert!(no_op.operation.is_none());

        let undone = engine.undo().unwrap();
        assert_eq!(undone.scene.document_revision, 2);
        assert_eq!(undone.scene.render_profile, RenderProfileV1::clean());
        assert_eq!(engine.document().elements, semantic_elements);
        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));
    }

    #[test]
    fn scene_uses_persistent_paint_text_anchor_and_aligned_bounds() {
        let mut document = document_with_three_elements();
        let ElementRecordV1::Rect(rectangle) = document.elements.get_mut("rect-1").unwrap() else {
            panic!("fixture element must be a rectangle");
        };
        rectangle.fill = FillV1::Solid {
            color: "#fef3c7".to_string(),
        };
        rectangle.stroke = "#b45309".to_string();
        rectangle.stroke_width = 5.0;
        let ElementRecordV1::Stroke(stroke) = document.elements.get_mut("stroke-1").unwrap() else {
            panic!("fixture element must be a stroke");
        };
        stroke.stroke = "#dc2626".to_string();
        stroke.stroke_width = 7.0;
        let ElementRecordV1::Text(text) = document.elements.get_mut("text-1").unwrap() else {
            panic!("fixture element must be text");
        };
        text.color = "#7c3aed".to_string();
        text.text_align = TextAlignV1::Center;

        let mut engine = Engine::open(document).unwrap();
        let pending = engine.current_update();
        let request = pending
            .text_measure_request
            .expect("text fixture must request metrics");
        let resolved = engine
            .provide_text_metrics(product_metrics(&request, 80.0, 30.0, vec![]))
            .unwrap();

        let SceneNodeV1::Rect(rectangle) = &resolved.scene.nodes["rect-1:shape"] else {
            panic!("clean rectangle must resolve to a rectangle node");
        };
        assert_eq!(rectangle.fill, "#fef3c7");
        assert_eq!(rectangle.stroke, "#b45309");
        assert_eq!(rectangle.stroke_width, 5.0);
        let SceneNodeV1::Path(stroke) = &resolved.scene.nodes["stroke-1:path"] else {
            panic!("clean stroke must resolve to a path node");
        };
        assert_eq!(stroke.stroke, "#dc2626");
        assert_eq!(stroke.stroke_width, 7.0);
        let SceneNodeV1::Text(text) = &resolved.scene.nodes["text-1:text"] else {
            panic!("measured text must resolve to a text node");
        };
        assert_eq!(text.runs[0].fill, "#7c3aed");
        assert_eq!(text.runs[0].text_anchor, TextAnchorV1::Middle);
        assert_eq!(text.runs[0].x, 40.0);

        let selected = engine
            .set_selection(vec!["text-1".to_string()], Some("text-1".to_string()))
            .unwrap();
        assert_eq!(selected.selection.visual_bounds.unwrap().x, 0.0);
        assert_eq!(
            selected.selection.style,
            Some(SelectionStyleV1::Text {
                color: "#7c3aed".to_string(),
                text_align: TextAlignV1::Center,
                font_size: 24.0,
                font_weight: 400,
            })
        );

        let sketch = engine
            .resolve_scene_profile(sketch_profile(7, 1.2, SketchFillStyleV1::Hachure))
            .unwrap();
        let SceneNodeV1::Path(outline) = &sketch.scene.nodes["rect-1:sketch:outline:v1"] else {
            panic!("sketch rectangle must resolve to an outline");
        };
        assert_eq!(outline.stroke, "#b45309");
        assert_eq!(outline.stroke_width, 5.0);
        let SceneNodeV1::Path(hatch) = &sketch.scene.nodes["rect-1:sketch:fill:v1"] else {
            panic!("filled sketch rectangle must resolve to hatch paint");
        };
        assert_eq!(hatch.stroke, "#fef3c7");

        engine
            .execute_command(envelope(
                engine.document(),
                "remove-fill",
                CommandV1::UpdateElementStyle {
                    element_id: "rect-1".to_string(),
                    patch: ElementStylePatchV1::Rect {
                        fill: Some(FillV1::None),
                        stroke: None,
                        stroke_width: None,
                    },
                },
            ))
            .unwrap();
        let no_fill = engine
            .resolve_scene_profile(sketch_profile(7, 1.2, SketchFillStyleV1::Hachure))
            .unwrap();
        assert!(!no_fill.scene.nodes.contains_key("rect-1:sketch:fill:v1"));
    }

    #[test]
    fn product_text_defaults_and_wire_contract_are_explicit() {
        let text = product_text("text-1", "你好");
        assert_eq!(text.font_family, CANVAS_FONT_FAMILY);
        assert_eq!(text.font_size, 24.0);
        assert_eq!(text.font_weight, 400);
        assert_eq!(text.max_width, Some(120.0));
        assert_eq!(text.font_fingerprint, "font-ready-v1");

        let value = serde_json::to_value(CommandEnvelopeV1 {
            protocol_version: 1,
            command_id: "create-text".to_string(),
            document_id: "doc-1".to_string(),
            expected_revision: 0,
            command: CommandV1::CreateText { text: text.clone() },
        })
        .unwrap();
        assert_eq!(value["command"]["type"], "create_text");
        assert_eq!(
            value["command"]["text"]["fontFamily"],
            "Noto Sans SC Variable"
        );
        assert_eq!(value["command"]["text"]["fontFingerprint"], "font-ready-v1");

        let update_value = serde_json::to_value(
            Engine::open(NodeInkDocumentV1::blank("doc-1"))
                .unwrap()
                .current_update(),
        )
        .unwrap();
        assert!(update_value["textMeasureRequest"].is_null());

        let target_value = serde_json::to_value(TextEditTargetV1 {
            element: Some(text),
            update: Engine::open(NodeInkDocumentV1::blank("doc-1"))
                .unwrap()
                .current_update(),
        })
        .unwrap();
        assert_eq!(target_value["element"]["kind"], "text");
    }

    #[test]
    fn product_text_resolves_in_two_phases_without_extra_document_history() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let created = engine
            .execute_command(envelope(
                engine.document(),
                "create-text",
                CommandV1::CreateText {
                    text: product_text("text-1", "你好\nNodeInk画布"),
                },
            ))
            .unwrap();

        assert_eq!(created.scene.document_revision, 1);
        assert_eq!(created.scene.scene_revision, 1);
        assert!(created.scene.root_node_ids.is_empty());
        assert_eq!(
            created.selection,
            SelectionStateV1 {
                selected_element_ids: vec!["text-1".to_string()],
                primary_element_id: Some("text-1".to_string()),
                selected_element_id: Some("text-1".to_string()),
                visual_bounds: None,
                style: Some(SelectionStyleV1::Text {
                    color: DEFAULT_INK_COLOR.to_string(),
                    text_align: TextAlignV1::Start,
                    font_size: DEFAULT_TEXT_FONT_SIZE,
                    font_weight: DEFAULT_TEXT_FONT_WEIGHT,
                }),
                ..SelectionStateV1::default()
            }
        );
        let request = created
            .text_measure_request
            .expect("new text must request metrics");
        assert_eq!(request.font_fingerprint, "font-ready-v1");
        assert_eq!(request.runs.len(), 1);
        assert_eq!(request.runs[0].font_family, CANVAS_FONT_FAMILY);
        assert_eq!(request.runs[0].max_width, Some(120.0));

        let resolved = engine
            .provide_text_metrics(TextMetricsSnapshotV1 {
                font_fingerprint: request.font_fingerprint,
                metrics: vec![TextMetricsV1 {
                    key: request.runs[0].key.clone(),
                    width: 112.0,
                    height: 72.0,
                    baseline: 18.0,
                    line_breaks: vec![2, 9],
                }],
            })
            .unwrap();
        assert_eq!(resolved.scene.document_revision, 1);
        assert_eq!(resolved.scene.scene_revision, 2);
        assert!(resolved.history.can_undo);
        assert!(!resolved.history.can_redo);
        assert!(resolved.text_measure_request.is_none());
        assert_eq!(resolved.selection.selected_element_ids, ["text-1"]);
        assert_eq!(
            resolved.selection.primary_element_id.as_deref(),
            Some("text-1")
        );
        assert_eq!(
            resolved.selection.visual_bounds,
            Some(SelectionBoundsV1 {
                x: 40.0,
                y: 52.0,
                width: 112.0,
                height: 72.0,
            })
        );
        assert_eq!(
            resolved.selection.style,
            Some(SelectionStyleV1::Text {
                color: DEFAULT_INK_COLOR.to_string(),
                text_align: TextAlignV1::Start,
                font_size: DEFAULT_TEXT_FONT_SIZE,
                font_weight: DEFAULT_TEXT_FONT_WEIGHT,
            })
        );
        assert_eq!(resolved.selection.handles.len(), 7);
        let SceneNodeV1::Text(scene_text) = &resolved.scene.nodes["text-1:text"] else {
            panic!("resolved text must produce a SceneText node");
        };
        assert_eq!(
            scene_text
                .runs
                .iter()
                .map(|run| run.text.as_str())
                .collect::<Vec<_>>(),
            ["你好", "NodeIn", "k画布"]
        );
        assert_eq!(
            scene_text.runs.iter().map(|run| run.y).collect::<Vec<_>>(),
            [70.0, 94.0, 118.0]
        );

        let repeated = engine
            .provide_text_metrics(TextMetricsSnapshotV1 {
                font_fingerprint: "font-ready-v1".to_string(),
                metrics: vec![TextMetricsV1 {
                    key: request.runs[0].key.clone(),
                    width: 112.0,
                    height: 72.0,
                    baseline: 18.0,
                    line_breaks: vec![2, 9],
                }],
            })
            .unwrap();
        assert_eq!(repeated.scene.scene_revision, 2);
        assert_eq!(repeated.scene, resolved.scene);
    }

    #[test]
    fn text_update_move_hit_test_and_empty_delete_share_transactions() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let created = engine
            .execute_command(envelope(
                engine.document(),
                "create-text",
                CommandV1::CreateText {
                    text: product_text("text-1", "原文"),
                },
            ))
            .unwrap();
        let request = created.text_measure_request.unwrap();
        engine
            .provide_text_metrics(product_metrics(&request, 72.0, 30.0, vec![]))
            .unwrap();

        engine.set_active_tool(EditorToolV1::Select);
        let target = engine
            .begin_text_edit_at(Vec2 { x: 48.0, y: 60.0 })
            .unwrap();
        assert_eq!(target.element.as_ref().unwrap().id, "text-1");
        assert_eq!(target.update.scene.document_revision, 1);
        assert_eq!(
            target.update.selection.selected_element_id.as_deref(),
            Some("text-1")
        );

        let moved = engine
            .execute_command(envelope(
                engine.document(),
                "move-text",
                CommandV1::MoveElements {
                    element_ids: vec!["text-1".to_string()],
                    delta: Vec2 { x: 12.0, y: 8.0 },
                },
            ))
            .unwrap();
        assert_eq!(moved.scene.document_revision, 2);
        assert_eq!(moved.selection.visual_bounds.unwrap().x, 52.0);

        let changed = engine
            .execute_command(envelope(
                engine.document(),
                "update-text",
                CommandV1::UpdateText {
                    element_id: "text-1".to_string(),
                    patch: TextPatchV1 {
                        text: Some("新文本".to_string()),
                        ..TextPatchV1::default()
                    },
                },
            ))
            .unwrap();
        assert_eq!(changed.scene.document_revision, 3);
        assert!(changed.scene.root_node_ids.is_empty());
        assert!(changed.text_measure_request.is_some());

        let deleted = engine
            .execute_command(envelope(
                engine.document(),
                "empty-text-deletes",
                CommandV1::UpdateText {
                    element_id: "text-1".to_string(),
                    patch: TextPatchV1 {
                        text: Some(String::new()),
                        ..TextPatchV1::default()
                    },
                },
            ))
            .unwrap();
        assert_eq!(deleted.scene.document_revision, 4);
        assert!(engine.document().elements.is_empty());
        assert_eq!(deleted.selection, SelectionStateV1::default());

        let undone = engine.undo().unwrap();
        assert_eq!(undone.scene.document_revision, 5);
        assert!(engine.document().elements.contains_key("text-1"));
        assert!(undone.text_measure_request.is_some());
    }

    #[test]
    fn empty_text_creation_is_a_noop_and_invalid_metrics_never_mutate_state() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let empty = engine
            .execute_command(envelope(
                engine.document(),
                "empty-create",
                CommandV1::CreateText {
                    text: product_text("text-1", ""),
                },
            ))
            .unwrap();
        assert_eq!(empty.scene.document_revision, 0);
        assert!(!empty.history.can_undo);
        assert!(engine.document().elements.is_empty());

        let created = engine
            .execute_command(envelope(
                engine.document(),
                "create-text",
                CommandV1::CreateText {
                    text: product_text("text-1", "内容"),
                },
            ))
            .unwrap();
        let request = created.text_measure_request.unwrap();
        let scene_revision = created.scene.scene_revision;
        assert_eq!(
            engine.provide_text_metrics(TextMetricsSnapshotV1 {
                font_fingerprint: "stale-font".to_string(),
                metrics: vec![TextMetricsV1 {
                    key: request.runs[0].key.clone(),
                    width: 48.0,
                    height: 30.0,
                    baseline: 18.0,
                    line_breaks: vec![],
                }],
            }),
            Err(EngineErrorV1::TextFingerprintMismatch)
        );
        assert_eq!(engine.current_update().scene.scene_revision, scene_revision);
        assert_eq!(
            engine.provide_text_metrics(TextMetricsSnapshotV1 {
                font_fingerprint: "font-ready-v1".to_string(),
                metrics: vec![TextMetricsV1 {
                    key: request.runs[0].key.clone(),
                    width: 121.0,
                    height: 30.0,
                    baseline: 18.0,
                    line_breaks: vec![],
                }],
            }),
            Err(EngineErrorV1::InvalidTextMetrics)
        );
        assert_eq!(engine.current_update().scene.scene_revision, scene_revision);
    }

    #[test]
    fn text_tool_can_begin_on_blank_canvas_without_mutating_document() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        engine.set_active_tool(EditorToolV1::Text);

        let target = engine
            .begin_text_edit_at(Vec2 { x: 120.0, y: 80.0 })
            .unwrap();

        assert!(target.element.is_none());
        assert_eq!(target.update.active_tool, EditorToolV1::Text);
        assert_eq!(target.update.scene.document_revision, 0);
        assert!(!target.update.history.can_undo);
    }

    #[test]
    fn text_resolution_requests_only_missing_metrics_then_stabilizes() {
        let engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        let runs = text_runs();
        let first = engine
            .resolve_text_fixture(
                "measure-1".to_string(),
                "font-v1".to_string(),
                runs.clone(),
                None,
            )
            .unwrap();
        assert_eq!(first.request.as_ref().unwrap().runs.len(), 3);
        assert!(first.scene.is_none());

        let partial = engine
            .resolve_text_fixture(
                "measure-2".to_string(),
                "font-v1".to_string(),
                runs.clone(),
                Some(TextMetricsSnapshotV1 {
                    font_fingerprint: "font-v1".to_string(),
                    metrics: vec![text_metric("latin", 120.0)],
                }),
            )
            .unwrap();
        assert_eq!(
            partial
                .request
                .unwrap()
                .runs
                .into_iter()
                .map(|run| run.key)
                .collect::<Vec<_>>(),
            vec!["cjk", "emoji"]
        );

        let metrics = TextMetricsSnapshotV1 {
            font_fingerprint: "font-v1".to_string(),
            metrics: vec![
                text_metric("latin", 120.0),
                text_metric("cjk", 96.0),
                text_metric("emoji", 32.0),
            ],
        };
        let resolved = engine
            .resolve_text_fixture(
                "measure-3".to_string(),
                "font-v1".to_string(),
                runs.clone(),
                Some(metrics.clone()),
            )
            .unwrap();
        assert!(resolved.request.is_none());
        assert_eq!(resolved.scene.as_ref().unwrap().runs.len(), 3);
        for _ in 0..1_000 {
            let repeated = engine
                .resolve_text_fixture(
                    "different-request-id".to_string(),
                    "font-v1".to_string(),
                    runs.clone(),
                    Some(metrics.clone()),
                )
                .unwrap();
            assert_eq!(repeated.canonical_hash, resolved.canonical_hash);
        }

        let font_changed = engine
            .resolve_text_fixture(
                "measure-4".to_string(),
                "font-v2".to_string(),
                runs,
                Some(TextMetricsSnapshotV1 {
                    font_fingerprint: "font-v2".to_string(),
                    metrics: metrics.metrics,
                }),
            )
            .unwrap();
        assert_ne!(font_changed.canonical_hash, resolved.canonical_hash);
    }

    #[test]
    fn text_resolution_rejects_invalid_runs_metrics_and_fingerprints() {
        let engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
        assert_eq!(
            engine
                .resolve_text_fixture("measure".to_string(), "font-v1".to_string(), vec![], None,),
            Err(EngineErrorV1::InvalidTextFixture)
        );
        assert_eq!(
            engine.resolve_text_fixture(
                "measure".to_string(),
                "font-v1".to_string(),
                text_runs(),
                Some(TextMetricsSnapshotV1 {
                    font_fingerprint: "font-v2".to_string(),
                    metrics: vec![],
                }),
            ),
            Err(EngineErrorV1::TextFingerprintMismatch)
        );
        let mut invalid_metrics = vec![
            text_metric("latin", f64::NAN),
            text_metric("cjk", 96.0),
            text_metric("emoji", 32.0),
        ];
        assert_eq!(
            engine.resolve_text_fixture(
                "measure".to_string(),
                "font-v1".to_string(),
                text_runs(),
                Some(TextMetricsSnapshotV1 {
                    font_fingerprint: "font-v1".to_string(),
                    metrics: invalid_metrics.clone(),
                }),
            ),
            Err(EngineErrorV1::InvalidTextFixture)
        );
        invalid_metrics[0].width = 120.0;
        assert!(
            engine
                .resolve_text_fixture(
                    "measure".to_string(),
                    "font-v1".to_string(),
                    text_runs(),
                    Some(TextMetricsSnapshotV1 {
                        font_fingerprint: "font-v1".to_string(),
                        metrics: invalid_metrics,
                    }),
                )
                .is_ok()
        );
    }

    #[test]
    fn grouping_reordering_and_ungrouping_preserve_stable_sibling_order() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        for (id, x) in [("a", 0.0), ("b", 40.0), ("c", 80.0)] {
            let rectangle = rectangle(id, x);
            document.root_order.push(id.to_string());
            document
                .elements
                .insert(id.to_string(), ElementRecordV1::Rect(rectangle));
        }
        let mut engine = Engine::open(document).unwrap();
        let grouped = engine
            .execute_command(envelope(
                engine.document(),
                "group",
                CommandV1::GroupElements {
                    group_id: "group-1".to_string(),
                    element_ids: vec!["a".to_string(), "c".to_string()],
                },
            ))
            .unwrap();
        assert_eq!(engine.document().root_order, ["b", "group-1"]);
        let ElementRecordV1::Group(group) = &engine.document().elements["group-1"] else {
            panic!("group command creates a group")
        };
        assert_eq!(group.child_order, ["a", "c"]);
        assert_eq!(grouped.selection.selected_element_ids, ["group-1"]);

        let reordered = engine
            .execute_command(envelope(
                engine.document(),
                "send-back",
                CommandV1::ReorderElements {
                    element_ids: vec!["group-1".to_string()],
                    placement: ReorderPlacementV1::Back,
                },
            ))
            .unwrap();
        assert_eq!(engine.document().root_order, ["group-1", "b"]);
        assert_eq!(reordered.scene.document_revision, 2);
        let no_op = engine
            .execute_command(envelope(
                engine.document(),
                "send-back-noop",
                CommandV1::ReorderElements {
                    element_ids: vec!["group-1".to_string()],
                    placement: ReorderPlacementV1::Back,
                },
            ))
            .unwrap();
        assert_eq!(no_op.scene.document_revision, 2);

        let ungrouped = engine
            .execute_command(envelope(
                engine.document(),
                "ungroup",
                CommandV1::UngroupElements {
                    group_id: "group-1".to_string(),
                },
            ))
            .unwrap();
        assert_eq!(engine.document().root_order, ["a", "c", "b"]);
        assert!(!engine.document().elements.contains_key("group-1"));
        assert_eq!(ungrouped.selection.selected_element_ids, ["a", "c"]);
    }

    #[test]
    fn align_and_affine_transform_are_atomic_and_noop_aware() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        for (id, x) in [("a", 10.0), ("b", 50.0)] {
            let rectangle = rectangle(id, x);
            document.root_order.push(id.to_string());
            document
                .elements
                .insert(id.to_string(), ElementRecordV1::Rect(rectangle));
        }
        let mut engine = Engine::open(document).unwrap();
        engine
            .set_selection(
                vec!["a".to_string(), "b".to_string()],
                Some("b".to_string()),
            )
            .unwrap();
        let aligned = engine
            .execute_command(envelope(
                engine.document(),
                "align-left",
                CommandV1::AlignElements {
                    element_ids: vec!["a".to_string(), "b".to_string()],
                    alignment: AlignmentV1::Left,
                },
            ))
            .unwrap();
        assert_eq!(aligned.scene.document_revision, 1);
        assert_eq!(engine.document().elements["b"].transform().e, -40.0);
        let no_op = engine
            .execute_command(envelope(
                engine.document(),
                "align-left-noop",
                CommandV1::AlignElements {
                    element_ids: vec!["a".to_string(), "b".to_string()],
                    alignment: AlignmentV1::Left,
                },
            ))
            .unwrap();
        assert_eq!(no_op.scene.document_revision, 1);

        let rotated = engine
            .execute_command(envelope(
                engine.document(),
                "rotate",
                CommandV1::TransformElements {
                    element_ids: vec!["a".to_string(), "b".to_string()],
                    transform: Affine2D::rotation(std::f64::consts::FRAC_PI_2)
                        .unwrap()
                        .around(Point2D::new(10.0, 40.0))
                        .unwrap(),
                },
            ))
            .unwrap();
        assert_eq!(rotated.scene.document_revision, 2);
        assert_eq!(rotated.selection.selected_element_ids, ["a", "b"]);
    }

    #[test]
    fn opaque_clipboard_copy_and_paste_remap_subtrees_in_one_revision() {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        for (id, x) in [("a", 0.0), ("b", 40.0)] {
            let rectangle = rectangle(id, x);
            document.root_order.push(id.to_string());
            document
                .elements
                .insert(id.to_string(), ElementRecordV1::Rect(rectangle));
        }
        let mut engine = Engine::open(document).unwrap();
        engine
            .execute_command(envelope(
                engine.document(),
                "group",
                CommandV1::GroupElements {
                    group_id: "group-1".to_string(),
                    element_ids: vec!["a".to_string(), "b".to_string()],
                },
            ))
            .unwrap();
        let revision_before_copy = engine.document().revision;
        let payload = engine.copy_selection().unwrap();
        assert_eq!(engine.document().revision, revision_before_copy);

        let pasted = engine
            .execute_command(envelope(
                engine.document(),
                "paste",
                CommandV1::PasteClipboard {
                    payload: payload.data,
                    id_prefix: "paste-1".to_string(),
                    offset: Vec2 { x: 24.0, y: 24.0 },
                },
            ))
            .unwrap();
        assert_eq!(pasted.scene.document_revision, revision_before_copy + 1);
        assert_eq!(pasted.selection.selected_element_ids, ["paste-1-0"]);
        assert_eq!(engine.document().root_order, ["group-1", "paste-1-0"]);
        let ElementRecordV1::Group(group) = &engine.document().elements["paste-1-0"] else {
            panic!("pasted root remains grouped")
        };
        assert_eq!((group.transform.e, group.transform.f), (24.0, 24.0));
        assert_eq!(group.child_order, ["paste-1-1", "paste-1-2"]);
    }

    fn document_with_rectangle() -> NodeInkDocumentV1 {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        let rectangle = rectangle("rect-1", 24.0);
        document.root_order.push(rectangle.id.clone());
        document
            .elements
            .insert(rectangle.id.clone(), ElementRecordV1::Rect(rectangle));
        document
    }

    fn document_with_rectangle_and_stroke() -> NodeInkDocumentV1 {
        let mut document = document_with_rectangle();
        let stroke = StrokeElementV1 {
            id: "stroke-1".to_string(),
            transform: Affine2D::identity(),
            points: vec![
                Vec2 { x: 8.0, y: 12.0 },
                Vec2 { x: 24.0, y: 28.0 },
                Vec2 { x: 48.0, y: 16.0 },
            ],
            stroke: DEFAULT_INK_COLOR.to_string(),
            stroke_width: 3.0,
        };
        document.root_order.push(stroke.id.clone());
        document
            .elements
            .insert(stroke.id.clone(), ElementRecordV1::Stroke(stroke));
        document
    }

    fn document_with_three_elements() -> NodeInkDocumentV1 {
        let mut document = document_with_rectangle_and_stroke();
        let text = product_text("text-1", "NodeInk");
        document.root_order.push(text.id.clone());
        document
            .elements
            .insert(text.id.clone(), ElementRecordV1::Text(text));
        document
    }

    fn sketch_profile(seed: u32, roughness: f64, fill_style: SketchFillStyleV1) -> RenderProfileV1 {
        RenderProfileV1::Sketch {
            version: 1,
            seed,
            roughness,
            bowing: 0.8,
            fill_style,
        }
    }

    fn text_runs() -> Vec<TextRunV1> {
        vec![
            TextRunV1 {
                key: "latin".to_string(),
                text: "NodeInk\ncanvas".to_string(),
                font_family: "Arial".to_string(),
                font_size: 20.0,
                font_weight: 500,
                max_width: Some(240.0),
            },
            TextRunV1 {
                key: "cjk".to_string(),
                text: "你好，画布".to_string(),
                font_family: "Arial".to_string(),
                font_size: 20.0,
                font_weight: 400,
                max_width: None,
            },
            TextRunV1 {
                key: "emoji".to_string(),
                text: "✍️🎨".to_string(),
                font_family: "Arial".to_string(),
                font_size: 24.0,
                font_weight: 400,
                max_width: None,
            },
        ]
    }

    fn product_text(id: &str, content: &str) -> TextElementV1 {
        TextElementV1 {
            max_width: Some(120.0),
            ..TextElementV1::new(id, 40.0, 52.0, content, "font-ready-v1")
        }
    }

    fn product_metrics(
        request: &TextMeasureRequestV1,
        width: f64,
        height: f64,
        line_breaks: Vec<usize>,
    ) -> TextMetricsSnapshotV1 {
        TextMetricsSnapshotV1 {
            font_fingerprint: request.font_fingerprint.clone(),
            metrics: vec![TextMetricsV1 {
                key: request.runs[0].key.clone(),
                width,
                height,
                baseline: 18.0,
                line_breaks,
            }],
        }
    }

    fn text_metric(key: &str, width: f64) -> TextMetricsV1 {
        TextMetricsV1 {
            key: key.to_string(),
            width,
            height: 48.0,
            baseline: 18.0,
            line_breaks: if key == "latin" { vec![7] } else { vec![] },
        }
    }

    fn pointer_event(phase: PointerPhaseV1, sequence: u64, x: f64) -> NormalizedPointerEventV1 {
        pointer_event_at(phase, sequence, x, 40.0)
    }

    fn pointer_event_at(
        phase: PointerPhaseV1,
        sequence: u64,
        x: f64,
        y: f64,
    ) -> NormalizedPointerEventV1 {
        NormalizedPointerEventV1 {
            pointer_id: 1,
            sequence,
            phase,
            point: Vec2 { x, y },
            modifiers: PointerModifiersV1::default(),
            screen_scale: 1.0,
        }
    }

    fn stroke_batch(
        phase: StrokePhaseV1,
        sequence_start: u64,
        points: &[(f64, f64)],
        stroke_id: Option<&str>,
    ) -> StrokeInputBatchV1 {
        StrokeInputBatchV1 {
            pointer_id: 1,
            sequence_start,
            phase,
            points: points.iter().map(|&(x, y)| Vec2 { x, y }).collect(),
            stroke_id: stroke_id.map(str::to_string),
            straight_line: false,
        }
    }
}
