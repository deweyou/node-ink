use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

mod pointer;

pub use pointer::{NormalizedPointerEventV1, PointerPhaseV1};
use pointer::{PointerMachine, PointerPreview, PointerTransition};

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
}

impl ElementRecordV1 {
    pub fn id(&self) -> &str {
        match self {
            Self::Rect(rectangle) => &rectangle.id,
        }
    }

    fn translate(&mut self, delta: Vec2) {
        match self {
            Self::Rect(rectangle) => {
                rectangle.x += delta.x;
                rectangle.y += delta.y;
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
pub struct SceneSnapshotV1 {
    pub protocol_version: u32,
    pub document_id: DocumentId,
    pub document_revision: u64,
    pub scene_revision: u64,
    pub root_node_ids: Vec<SceneNodeId>,
    pub nodes: BTreeMap<SceneNodeId, SceneNodeV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SceneNodeV1 {
    Rect(SceneRectV1),
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
        self.execute_command_without_pointer_reset(envelope)
    }

    pub fn handle_pointer_events(
        &mut self,
        command_id: String,
        events: Vec<NormalizedPointerEventV1>,
    ) -> Result<PointerUpdateV1, EngineErrorV1> {
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
        self.update_with_operation_and_preview(operation, None)
    }

    fn update_with_preview(&self, preview: Option<&PointerPreview>) -> EngineUpdateV1 {
        self.update_with_operation_and_preview(None, preview)
    }

    fn update_with_operation_and_preview(
        &self,
        operation: Option<OperationResultV1>,
        preview: Option<&PointerPreview>,
    ) -> EngineUpdateV1 {
        EngineUpdateV1 {
            operation,
            scene: resolve_scene(&self.document, self.scene_revision, preview),
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

fn resolve_scene(
    document: &NodeInkDocumentV1,
    scene_revision: u64,
    preview: Option<&PointerPreview>,
) -> SceneSnapshotV1 {
    let mut root_node_ids = Vec::with_capacity(document.root_order.len());
    let mut nodes = BTreeMap::new();

    for element_id in &document.root_order {
        let Some(element) = document.elements.get(element_id) else {
            continue;
        };
        match element {
            ElementRecordV1::Rect(rectangle) => {
                let preview_delta = preview
                    .filter(|candidate| candidate.element_id == rectangle.id)
                    .map_or(Vec2 { x: 0.0, y: 0.0 }, |candidate| candidate.delta);
                let scene_node_id = format!("{}:shape", rectangle.id);
                root_node_ids.push(scene_node_id.clone());
                nodes.insert(
                    scene_node_id.clone(),
                    SceneNodeV1::Rect(SceneRectV1 {
                        id: scene_node_id,
                        source_element_id: rectangle.id.clone(),
                        x: rectangle.x + preview_delta.x,
                        y: rectangle.y + preview_delta.y,
                        width: rectangle.width,
                        height: rectangle.height,
                        fill: "#d1fae5".to_string(),
                        stroke: "#047857".to_string(),
                    }),
                );
            }
        }
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
        let SceneNodeV1::Rect(moved_rectangle) = &moved.scene.nodes["rect-1:shape"];
        assert_eq!((moved_rectangle.x, moved_rectangle.y), (56.0, 48.0));

        let undone = engine.undo().unwrap();
        let SceneNodeV1::Rect(undone_rectangle) = &undone.scene.nodes["rect-1:shape"];
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
        let SceneNodeV1::Rect(preview_rectangle) = &preview.update.scene.nodes["rect-1:shape"];
        assert_eq!(preview_rectangle.x, 56.0);
        assert_eq!(preview.update.scene.document_revision, 0);
        let ElementRecordV1::Rect(document_rectangle) = &engine.document().elements["rect-1"];
        assert_eq!(document_rectangle.x, 24.0);

        let committed = engine
            .handle_pointer_events(
                "drag-1".to_string(),
                vec![pointer_event(PointerPhaseV1::Up, 3, 56.0, None)],
            )
            .unwrap();
        assert!(committed.did_commit);
        assert_eq!(committed.update.scene.document_revision, 1);
        let SceneNodeV1::Rect(committed_rectangle) = &committed.update.scene.nodes["rect-1:shape"];
        assert_eq!(committed_rectangle.x, 56.0);

        let undone = engine.undo().unwrap();
        let SceneNodeV1::Rect(undone_rectangle) = &undone.scene.nodes["rect-1:shape"];
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
        let SceneNodeV1::Rect(preview_rectangle) = &batch.update.scene.nodes["rect-1:shape"];
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

    fn document_with_rectangle() -> NodeInkDocumentV1 {
        let mut document = NodeInkDocumentV1::blank("doc-1");
        let rectangle = rectangle("rect-1", 24.0);
        document.root_order.push(rectangle.id.clone());
        document
            .elements
            .insert(rectangle.id.clone(), ElementRecordV1::Rect(rectangle));
        document
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
}
