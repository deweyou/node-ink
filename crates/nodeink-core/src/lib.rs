use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod pointer;
mod sketch;
mod stroke;

pub use pointer::{NormalizedPointerEventV1, PointerPhaseV1};
use pointer::{PointerMachine, PointerPreview, PointerTransition};
pub use sketch::{ENGINE_ALGORITHM_VERSION, RenderProfileV1, SketchFillStyleV1};
use sketch::{sketch_rectangle, sketch_stroke};
pub use stroke::{StrokeInputBatchV1, StrokePhaseV1};
use stroke::{StrokeMachine, StrokePreview, StrokeTransition};

pub const PROTOCOL_VERSION: u32 = 1;
pub const SCHEMA_VERSION: u32 = 1;

pub type DocumentId = String;
pub type ElementId = String;
pub type SceneNodeId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInkDocumentV1 {
    pub schema_version: u32,
    pub document_id: DocumentId,
    pub revision: u64,
    pub root_order: Vec<ElementId>,
    pub elements: BTreeMap<ElementId, ElementRecordV1>,
}

impl NodeInkDocumentV1 {
    pub fn blank(document_id: impl Into<DocumentId>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            document_id: document_id.into(),
            revision: 0,
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
}

impl ElementRecordV1 {
    pub fn id(&self) -> &str {
        match self {
            Self::Rect(rectangle) => &rectangle.id,
            Self::Stroke(stroke) => &stroke.id,
        }
    }

    fn translate(&mut self, delta: Vec2) {
        match self {
            Self::Rect(rectangle) => {
                rectangle.x += delta.x;
                rectangle.y += delta.y;
            }
            Self::Stroke(stroke) => {
                for point in &mut stroke.points {
                    point.x += delta.x;
                    point.y += delta.y;
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectElementV1 {
    pub id: ElementId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeElementV1 {
    pub id: ElementId,
    pub points: Vec<Vec2>,
    pub stroke_width: f64,
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneRectV1 {
    pub id: SceneNodeId,
    pub source_element_id: ElementId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub fill: String,
    pub stroke: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePathV1 {
    pub id: SceneNodeId,
    pub source_element_id: ElementId,
    pub path_data: String,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
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
    #[error("invalid stroke geometry for {element_id}")]
    InvalidStroke { element_id: ElementId },
    #[error("invalid stroke input: {reason}")]
    InvalidStrokeInput { reason: String },
    #[error("invalid render profile")]
    InvalidRenderProfile,
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
    scene_revision: u64,
    undo_stack: Vec<NodeInkDocumentV1>,
    redo_stack: Vec<NodeInkDocumentV1>,
    pointer_machine: PointerMachine,
    stroke_machine: StrokeMachine,
}

impl Engine {
    pub fn open(document: NodeInkDocumentV1) -> Result<Self, EngineErrorV1> {
        validate_document(&document)?;
        Ok(Self {
            document,
            scene_revision: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            pointer_machine: PointerMachine::default(),
            stroke_machine: StrokeMachine::default(),
        })
    }

    pub fn document(&self) -> &NodeInkDocumentV1 {
        &self.document
    }

    pub fn execute_command(
        &mut self,
        envelope: CommandEnvelopeV1,
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.pointer_machine.cancel();
        self.stroke_machine.cancel();
        self.execute_command_without_pointer_reset(envelope)
    }

    pub fn handle_pointer_events(
        &mut self,
        command_id: String,
        events: Vec<NormalizedPointerEventV1>,
    ) -> Result<PointerUpdateV1, EngineErrorV1> {
        self.stroke_machine.cancel();
        let outcome = self
            .pointer_machine
            .process_batch(self.document.revision, events);
        let (update, did_commit) = match outcome.transition {
            PointerTransition::None => (self.current_update(), false),
            PointerTransition::Preview(preview) => {
                self.scene_revision += 1;
                (self.update_with_preview(Some(&preview)), false)
            }
            PointerTransition::Cancelled => {
                self.scene_revision += 1;
                (self.current_update(), false)
            }
            PointerTransition::Commit(commit) => {
                let has_movement = commit.delta.x != 0.0 || commit.delta.y != 0.0;
                if !has_movement {
                    self.scene_revision += 1;
                    (self.current_update(), false)
                } else {
                    let envelope = CommandEnvelopeV1 {
                        protocol_version: PROTOCOL_VERSION,
                        command_id,
                        document_id: self.document.document_id.clone(),
                        expected_revision: commit.expected_revision,
                        command: CommandV1::MoveElements {
                            element_ids: vec![commit.element_id],
                            delta: commit.delta,
                        },
                    };
                    (self.execute_command_without_pointer_reset(envelope)?, true)
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

    pub fn handle_stroke_batch(
        &mut self,
        command_id: String,
        batch: StrokeInputBatchV1,
    ) -> Result<StrokeUpdateV1, EngineErrorV1> {
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
                (self.execute_command_without_pointer_reset(envelope)?, true)
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
    ) -> Result<EngineUpdateV1, EngineErrorV1> {
        self.validate_envelope(&envelope)?;

        let previous_revision = self.document.revision;
        let mut candidate = self.document.clone();
        let changed_element_ids = apply_command(&mut candidate, envelope.command)?;
        candidate.revision = previous_revision + 1;
        validate_document(&candidate)?;

        self.undo_stack.push(self.document.clone());
        self.redo_stack.clear();
        self.document = candidate;
        self.scene_revision += 1;

        Ok(self.update(Some(OperationResultV1 {
            command_id: envelope.command_id,
            previous_revision,
            revision: self.document.revision,
            changed_element_ids,
            scene_revision: self.scene_revision,
        })))
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
        self.scene_revision += 1;
        Ok(self.update(None))
    }

    pub fn current_update(&self) -> EngineUpdateV1 {
        self.update(None)
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
        let scene = resolve_scene(&self.document, self.scene_revision, None, None, &profile);
        let canonical =
            serde_json::to_string(&scene).expect("SceneSnapshot serialization is infallible");
        Ok(SceneResolutionV1 {
            engine_algorithm_version: ENGINE_ALGORITHM_VERSION.to_string(),
            render_profile: profile,
            canonical_hash: fnv1a64_hex(canonical.as_bytes()),
            scene,
        })
    }

    fn validate_envelope(&self, envelope: &CommandEnvelopeV1) -> Result<(), EngineErrorV1> {
        if envelope.protocol_version != PROTOCOL_VERSION {
            return Err(EngineErrorV1::UnsupportedProtocol {
                actual: envelope.protocol_version,
            });
        }
        if envelope.document_id != self.document.document_id {
            return Err(EngineErrorV1::DocumentMismatch);
        }
        if envelope.expected_revision != self.document.revision {
            return Err(EngineErrorV1::RevisionConflict {
                expected: envelope.expected_revision,
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
                &RenderProfileV1::clean(),
            ),
            history: HistoryStateV1 {
                can_undo: !self.undo_stack.is_empty(),
                can_redo: !self.redo_stack.is_empty(),
            },
        }
    }
}

fn apply_command(
    document: &mut NodeInkDocumentV1,
    command: CommandV1,
) -> Result<Vec<ElementId>, EngineErrorV1> {
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
            Ok(vec![element_id])
        }
        CommandV1::MoveElements { element_ids, delta } => {
            if !delta.x.is_finite() || !delta.y.is_finite() {
                return Err(EngineErrorV1::InvalidDelta);
            }
            for element_id in &element_ids {
                if !document.elements.contains_key(element_id) {
                    return Err(EngineErrorV1::ElementNotFound {
                        element_id: element_id.clone(),
                    });
                }
            }
            for element_id in &element_ids {
                let element = document
                    .elements
                    .get_mut(element_id)
                    .expect("element existence was validated before mutation");
                element.translate(delta);
            }
            Ok(element_ids)
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
            Ok(vec![element_id])
        }
    }
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
    if document.root_order.len() != document.elements.len() {
        return Err(EngineErrorV1::InvalidDocument {
            reason: "rootOrder and elements must contain the same ids".to_string(),
        });
    }
    for element_id in &document.root_order {
        let element =
            document
                .elements
                .get(element_id)
                .ok_or_else(|| EngineErrorV1::InvalidDocument {
                    reason: format!("rootOrder references missing element {element_id}"),
                })?;
        if element.id() != element_id {
            return Err(EngineErrorV1::InvalidDocument {
                reason: format!("element key {element_id} does not match its id"),
            });
        }
        match element {
            ElementRecordV1::Rect(rectangle) => validate_rectangle(rectangle)?,
            ElementRecordV1::Stroke(stroke) => validate_stroke(stroke)?,
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
        && rectangle.height > 0.0;
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
        && stroke.stroke_width.is_finite()
        && stroke.stroke_width > 0.0;
    if !is_valid {
        return Err(EngineErrorV1::InvalidStroke {
            element_id: stroke.id.clone(),
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

fn resolve_scene(
    document: &NodeInkDocumentV1,
    scene_revision: u64,
    pointer_preview: Option<&PointerPreview>,
    stroke_preview: Option<&StrokePreview>,
    profile: &RenderProfileV1,
) -> SceneSnapshotV1 {
    let mut root_node_ids =
        Vec::with_capacity(document.root_order.len() + usize::from(stroke_preview.is_some()));
    let mut nodes = BTreeMap::new();

    for element_id in &document.root_order {
        let Some(element) = document.elements.get(element_id) else {
            continue;
        };
        match element {
            ElementRecordV1::Rect(rectangle) => {
                let preview_delta = pointer_preview
                    .filter(|candidate| candidate.element_id == rectangle.id)
                    .map_or(Vec2 { x: 0.0, y: 0.0 }, |candidate| candidate.delta);
                let resolved = RectElementV1 {
                    x: rectangle.x + preview_delta.x,
                    y: rectangle.y + preview_delta.y,
                    ..rectangle.clone()
                };
                if matches!(profile, RenderProfileV1::Clean { .. }) {
                    let scene_node_id = format!("{}:shape", rectangle.id);
                    root_node_ids.push(scene_node_id.clone());
                    nodes.insert(
                        scene_node_id.clone(),
                        SceneNodeV1::Rect(SceneRectV1 {
                            id: scene_node_id,
                            source_element_id: rectangle.id.clone(),
                            x: resolved.x,
                            y: resolved.y,
                            width: resolved.width,
                            height: resolved.height,
                            fill: "#d1fae5".to_string(),
                            stroke: "#047857".to_string(),
                        }),
                    );
                } else {
                    for path in sketch_rectangle(&resolved, profile) {
                        root_node_ids.push(path.id.clone());
                        nodes.insert(path.id.clone(), SceneNodeV1::Path(path));
                    }
                }
            }
            ElementRecordV1::Stroke(stroke) => {
                insert_stroke_scene_node(&mut root_node_ids, &mut nodes, stroke, profile);
            }
        }
    }

    if let Some(preview) = stroke_preview {
        insert_stroke_scene_node(&mut root_node_ids, &mut nodes, &preview.stroke, profile);
    }

    SceneSnapshotV1 {
        protocol_version: PROTOCOL_VERSION,
        document_id: document.document_id.clone(),
        document_revision: document.revision,
        scene_revision,
        root_node_ids,
        nodes,
    }
}

fn insert_stroke_scene_node(
    root_node_ids: &mut Vec<SceneNodeId>,
    nodes: &mut BTreeMap<SceneNodeId, SceneNodeV1>,
    stroke: &StrokeElementV1,
    profile: &RenderProfileV1,
) {
    let path = if matches!(profile, RenderProfileV1::Clean { .. }) {
        let scene_node_id = format!("{}:path", stroke.id);
        ScenePathV1 {
            id: scene_node_id,
            source_element_id: stroke.id.clone(),
            path_data: stroke_path_data(&stroke.points),
            fill: "none".to_string(),
            stroke: "#0f172a".to_string(),
            stroke_width: stroke.stroke_width,
        }
    } else {
        sketch_stroke(stroke, profile)
    };
    root_node_ids.push(path.id.clone());
    nodes.insert(path.id.clone(), SceneNodeV1::Path(path));
}

fn stroke_path_data(points: &[Vec2]) -> String {
    let mut path = String::new();
    for (index, point) in points.iter().enumerate() {
        if index == 0 {
            path.push_str("M ");
        } else {
            path.push_str(" L ");
        }
        path.push_str(&format!("{} {}", point.x, point.y));
    }
    path
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
            x,
            y: 40.0,
            width: 160.0,
            height: 96.0,
        }
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
        assert_eq!((moved_rectangle.x, moved_rectangle.y), (56.0, 48.0));

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
        unsupported_schema.schema_version = 2;
        assert_eq!(
            Engine::open(unsupported_schema).unwrap_err(),
            EngineErrorV1::UnsupportedSchema { actual: 2 }
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
            EngineErrorV1::InvalidDocument {
                reason: "rootOrder and elements must contain the same ids".to_string(),
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
            EngineErrorV1::InvalidDocument {
                reason: "rootOrder references missing element missing".to_string(),
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
        assert_eq!(
            engine.serialize_document().unwrap(),
            r#"{"schemaVersion":1,"documentId":"doc-1","revision":0,"rootOrder":[],"elements":{}}"#
        );
    }

    #[test]
    fn pointer_drag_previews_without_mutation_then_commits_one_undo_entry() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();

        let down = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 1, 24.0, Some("rect-1"))],
            )
            .unwrap();
        assert!(!down.did_commit);
        assert_eq!(down.processed_event_count, 1);

        let preview = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Move, 2, 56.0, None)],
            )
            .unwrap();
        let SceneNodeV1::Rect(preview_rectangle) = &preview.update.scene.nodes["rect-1:shape"]
        else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(preview_rectangle.x, 56.0);
        assert_eq!(preview.update.scene.document_revision, 0);
        let ElementRecordV1::Rect(document_rectangle) = &engine.document().elements["rect-1"]
        else {
            panic!("document element should remain a rectangle");
        };
        assert_eq!(document_rectangle.x, 24.0);

        let committed = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Up, 3, 56.0, None)],
            )
            .unwrap();
        assert!(committed.did_commit);
        assert_eq!(committed.update.scene.document_revision, 1);
        let SceneNodeV1::Rect(committed_rectangle) = &committed.update.scene.nodes["rect-1:shape"]
        else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(committed_rectangle.x, 56.0);

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
                    pointer_event(PointerPhaseV1::Down, 10, 24.0, Some("rect-1")),
                    NormalizedPointerEventV1 {
                        pointer_id: 2,
                        ..pointer_event(PointerPhaseV1::Move, 11, 40.0, None)
                    },
                    pointer_event(PointerPhaseV1::Move, 11, 40.0, None),
                    pointer_event(PointerPhaseV1::Move, 11, 48.0, None),
                    pointer_event(PointerPhaseV1::Move, 12, 64.0, None),
                ],
            )
            .unwrap();

        assert_eq!(batch.processed_event_count, 5);
        assert_eq!(batch.ignored_event_count, 2);
        let SceneNodeV1::Rect(preview_rectangle) = &batch.update.scene.nodes["rect-1:shape"] else {
            panic!("rectangle should resolve to a rectangle scene node");
        };
        assert_eq!(preview_rectangle.x, 64.0);
        assert_eq!(engine.document().revision, 0);
    }

    #[test]
    fn pointer_cancel_and_zero_delta_up_do_not_create_history() {
        let mut engine = Engine::open(document_with_rectangle()).unwrap();
        let ignored = engine
            .handle_pointer_events(
                "ignored".to_string(),
                vec![pointer_event(PointerPhaseV1::Move, 1, 40.0, None)],
            )
            .unwrap();
        assert_eq!(ignored.ignored_event_count, 1);

        engine
            .handle_pointer_events(
                "cancelled".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 2, 24.0, Some("rect-1"))],
            )
            .unwrap();
        let cancelled = engine
            .handle_pointer_events(
                "cancelled".to_string(),
                vec![pointer_event(PointerPhaseV1::Cancel, 3, 48.0, None)],
            )
            .unwrap();
        assert!(!cancelled.did_commit);
        assert_eq!(cancelled.update.scene.document_revision, 0);

        engine
            .handle_pointer_events(
                "zero".to_string(),
                vec![pointer_event(PointerPhaseV1::Down, 4, 24.0, Some("rect-1"))],
            )
            .unwrap();
        let zero_delta = engine
            .handle_pointer_events(
                "zero".to_string(),
                vec![pointer_event(PointerPhaseV1::Up, 5, 24.0, None)],
            )
            .unwrap();
        assert!(!zero_delta.did_commit);
        assert_eq!(engine.undo(), Err(EngineErrorV1::UndoUnavailable));
    }

    #[test]
    fn stroke_batches_preview_without_document_mutation_and_commit_once() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
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
        assert_eq!(preview_path.path_data, "M 10 20 L 12 22 L 14 24 L 16 26");
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
    fn stroke_batches_filter_wrong_pointers_and_out_of_order_points() {
        let mut engine = Engine::open(NodeInkDocumentV1::blank("doc-1")).unwrap();
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
        assert_eq!(path.path_data, "M 0 0 L 1 1 L 2 2 L 3 3");

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
                    points: vec![Vec2 { x: 0.0, y: 0.0 }],
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
                    points: vec![Vec2 { x: 1.0, y: 2.0 }, Vec2 { x: 3.0, y: 4.0 }],
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
        assert_eq!(path.path_data, "M 6 8 L 8 10");
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
            points: vec![
                Vec2 { x: 8.0, y: 12.0 },
                Vec2 { x: 24.0, y: 28.0 },
                Vec2 { x: 48.0, y: 16.0 },
            ],
            stroke_width: 3.0,
        };
        document.root_order.push(stroke.id.clone());
        document
            .elements
            .insert(stroke.id.clone(), ElementRecordV1::Stroke(stroke));
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

    fn pointer_event(
        phase: PointerPhaseV1,
        sequence: u64,
        x: f64,
        target_element_id: Option<&str>,
    ) -> NormalizedPointerEventV1 {
        NormalizedPointerEventV1 {
            pointer_id: 1,
            sequence,
            phase,
            point: Vec2 { x, y: 40.0 },
            target_element_id: target_element_id.map(str::to_string),
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
        }
    }
}
