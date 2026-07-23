use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::{
    CommandV1, DocumentId, ElementId, EngineErrorV1, PROTOCOL_VERSION, RectElementV1, Vec2,
};

pub const MAX_OPERATION_BATCH_SIZE: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagramOperationModeV1 {
    Apply,
    DryRun,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramOperationBatchV1 {
    pub protocol_version: u32,
    pub batch_id: String,
    pub document_id: DocumentId,
    pub expected_revision: u64,
    pub mode: DiagramOperationModeV1,
    pub atomic: bool,
    pub operations: Vec<DiagramOperationV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DiagramOperationV1 {
    CreateRectangle {
        op_id: String,
        rectangle: RectElementV1,
    },
    MoveElements {
        op_id: String,
        element_ids: Vec<ElementId>,
        delta: Vec2,
    },
    UpdateRectangle {
        op_id: String,
        element_id: ElementId,
        patch: RectanglePatchV1,
    },
    DeleteElements {
        op_id: String,
        element_ids: Vec<ElementId>,
    },
}

impl DiagramOperationV1 {
    pub(crate) fn op_id(&self) -> &str {
        match self {
            Self::CreateRectangle { op_id, .. }
            | Self::MoveElements { op_id, .. }
            | Self::UpdateRectangle { op_id, .. }
            | Self::DeleteElements { op_id, .. } => op_id,
        }
    }

    pub(crate) fn into_command(self) -> CommandV1 {
        match self {
            Self::CreateRectangle { rectangle, .. } => CommandV1::CreateRectangle { rectangle },
            Self::MoveElements {
                element_ids, delta, ..
            } => CommandV1::MoveElements { element_ids, delta },
            Self::UpdateRectangle {
                element_id, patch, ..
            } => CommandV1::UpdateRectangle { element_id, patch },
            Self::DeleteElements { element_ids, .. } => CommandV1::DeleteElements { element_ids },
        }
    }

    fn referenced_element_ids(&self) -> Option<&[ElementId]> {
        match self {
            Self::MoveElements { element_ids, .. } | Self::DeleteElements { element_ids, .. } => {
                Some(element_ids)
            }
            Self::CreateRectangle { .. } | Self::UpdateRectangle { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectanglePatchV1 {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

impl RectanglePatchV1 {
    pub(crate) fn is_empty(&self) -> bool {
        self.x.is_none() && self.y.is_none() && self.width.is_none() && self.height.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagramOperationStatusV1 {
    Applied,
    Planned,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramOperationResultV1 {
    pub op_id: String,
    pub status: DiagramOperationStatusV1,
    pub affected_element_ids: Vec<ElementId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramOperationBatchResultV1 {
    pub batch_id: String,
    pub mode: DiagramOperationModeV1,
    pub previous_revision: u64,
    pub revision: Option<u64>,
    pub results: Vec<DiagramOperationResultV1>,
    pub scene_patch: crate::ScenePatchV1,
}

pub(crate) fn validate_operation_batch(
    batch: &DiagramOperationBatchV1,
) -> Result<(), EngineErrorV1> {
    if batch.protocol_version != PROTOCOL_VERSION {
        return Err(EngineErrorV1::UnsupportedProtocol {
            actual: batch.protocol_version,
        });
    }
    if batch.batch_id.trim().is_empty() {
        return Err(invalid_batch("batchId must not be empty"));
    }
    if !batch.atomic {
        return Err(invalid_batch("atomic must be true in protocol V1"));
    }
    if batch.operations.is_empty() {
        return Err(invalid_batch("operations must not be empty"));
    }
    if batch.operations.len() > MAX_OPERATION_BATCH_SIZE {
        return Err(invalid_batch(
            "operation count exceeds the protocol V1 limit",
        ));
    }

    let mut op_ids = BTreeSet::new();
    for operation in &batch.operations {
        if operation.op_id().trim().is_empty() {
            return Err(invalid_batch("opId must not be empty"));
        }
        if !op_ids.insert(operation.op_id()) {
            return Err(invalid_batch("opId must be unique within a batch"));
        }
        if operation
            .referenced_element_ids()
            .is_some_and(<[ElementId]>::is_empty)
        {
            return Err(invalid_batch("elementIds must not be empty"));
        }
        if let DiagramOperationV1::UpdateRectangle { patch, .. } = operation
            && patch.is_empty()
        {
            return Err(invalid_batch(
                "rectangle patch must change at least one field",
            ));
        }
    }
    Ok(())
}

fn invalid_batch(reason: &str) -> EngineErrorV1 {
    EngineErrorV1::InvalidOperationBatch {
        reason: reason.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(operation: DiagramOperationV1) -> DiagramOperationBatchV1 {
        DiagramOperationBatchV1 {
            protocol_version: PROTOCOL_VERSION,
            batch_id: "batch-1".to_string(),
            document_id: "doc-1".to_string(),
            expected_revision: 0,
            mode: DiagramOperationModeV1::Apply,
            atomic: true,
            operations: vec![operation],
        }
    }

    fn create(op_id: &str) -> DiagramOperationV1 {
        DiagramOperationV1::CreateRectangle {
            op_id: op_id.to_string(),
            rectangle: RectElementV1 {
                id: "rect-1".to_string(),
                transform: crate::Affine2D::identity(),
                x: 1.0,
                y: 2.0,
                width: 3.0,
                height: 4.0,
                fill: crate::FillV1::default_rectangle(),
                stroke: crate::DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
                size: crate::DEFAULT_ELEMENT_SIZE,
            },
        }
    }

    #[test]
    fn operation_wire_format_is_versioned_and_framework_neutral() {
        let value = serde_json::to_value(batch(DiagramOperationV1::UpdateRectangle {
            op_id: "update-1".to_string(),
            element_id: "rect-1".to_string(),
            patch: RectanglePatchV1 {
                width: Some(24.0),
                ..RectanglePatchV1::default()
            },
        }))
        .unwrap();

        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["mode"], "apply");
        assert_eq!(value["operations"][0]["type"], "update_rectangle");
        assert_eq!(value["operations"][0]["elementId"], "rect-1");
        assert_eq!(value["operations"][0]["patch"]["width"], 24.0);
    }

    #[test]
    fn every_operation_maps_to_the_shared_command_protocol() {
        let rectangle = match create("create-1").into_command() {
            CommandV1::CreateRectangle { rectangle } => rectangle,
            _ => panic!("create operation must map to create command"),
        };
        assert_eq!(rectangle.id, "rect-1");

        assert!(matches!(
            DiagramOperationV1::MoveElements {
                op_id: "move-1".to_string(),
                element_ids: vec!["rect-1".to_string()],
                delta: Vec2 { x: 1.0, y: 2.0 },
            }
            .into_command(),
            CommandV1::MoveElements { .. }
        ));
        assert!(matches!(
            DiagramOperationV1::UpdateRectangle {
                op_id: "update-1".to_string(),
                element_id: "rect-1".to_string(),
                patch: RectanglePatchV1 {
                    x: Some(4.0),
                    ..RectanglePatchV1::default()
                },
            }
            .into_command(),
            CommandV1::UpdateRectangle { .. }
        ));
        assert!(matches!(
            DiagramOperationV1::DeleteElements {
                op_id: "delete-1".to_string(),
                element_ids: vec!["rect-1".to_string()],
            }
            .into_command(),
            CommandV1::DeleteElements { .. }
        ));
    }

    #[test]
    fn rejects_invalid_batch_headers_limits_and_operation_ids() {
        let mut fixture = batch(create("create-1"));
        fixture.protocol_version = 2;
        assert_eq!(
            validate_operation_batch(&fixture),
            Err(EngineErrorV1::UnsupportedProtocol { actual: 2 })
        );

        for (mut fixture, reason) in [
            (
                {
                    let mut value = batch(create("create-1"));
                    value.batch_id = " ".to_string();
                    value
                },
                "batchId must not be empty",
            ),
            (
                {
                    let mut value = batch(create("create-1"));
                    value.atomic = false;
                    value
                },
                "atomic must be true in protocol V1",
            ),
            (
                {
                    let mut value = batch(create("create-1"));
                    value.operations.clear();
                    value
                },
                "operations must not be empty",
            ),
            (
                {
                    let mut value = batch(create("create-1"));
                    value.operations = (0..=MAX_OPERATION_BATCH_SIZE)
                        .map(|index| create(&format!("create-{index}")))
                        .collect();
                    value
                },
                "operation count exceeds the protocol V1 limit",
            ),
            (batch(create(" ")), "opId must not be empty"),
            (
                {
                    let mut value = batch(create("duplicate"));
                    value.operations.push(create("duplicate"));
                    value
                },
                "opId must be unique within a batch",
            ),
        ] {
            assert_eq!(
                validate_operation_batch(&fixture),
                Err(EngineErrorV1::InvalidOperationBatch {
                    reason: reason.to_string(),
                })
            );
            fixture.operations.clear();
        }
    }

    #[test]
    fn rejects_empty_element_lists_and_empty_rectangle_patches() {
        for operation in [
            DiagramOperationV1::MoveElements {
                op_id: "move-1".to_string(),
                element_ids: vec![],
                delta: Vec2 { x: 1.0, y: 2.0 },
            },
            DiagramOperationV1::DeleteElements {
                op_id: "delete-1".to_string(),
                element_ids: vec![],
            },
        ] {
            assert_eq!(
                validate_operation_batch(&batch(operation)),
                Err(invalid_batch("elementIds must not be empty"))
            );
        }

        assert_eq!(
            validate_operation_batch(&batch(DiagramOperationV1::UpdateRectangle {
                op_id: "update-1".to_string(),
                element_id: "rect-1".to_string(),
                patch: RectanglePatchV1::default(),
            })),
            Err(invalid_batch(
                "rectangle patch must change at least one field"
            ))
        );
    }
}
