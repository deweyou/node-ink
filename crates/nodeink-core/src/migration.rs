use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    DEFAULT_INK_COLOR, DEFAULT_RECTANGLE_STROKE_COLOR, DEFAULT_RECTANGLE_STROKE_WIDTH,
    ElementRecordV1, FillV1, NodeInkDocumentV1, RectElementV1, RenderProfileV1, SCHEMA_VERSION,
    StrokeElementV1, TextAlignV1, TextElementV1, validate_document,
};
#[cfg(test)]
use crate::{DEFAULT_RECTANGLE_FILL_COLOR, Engine, SceneNodeV1};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResultV1 {
    pub source_schema_version: u32,
    pub target_schema_version: u32,
    pub migrated: bool,
    pub document: NodeInkDocumentV1,
    pub canonical_payload: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReportV1 {
    pub stage: String,
    pub code: String,
    pub source_schema_version: Option<u32>,
    pub target_schema_version: u32,
    pub message: String,
    pub recovery: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAttemptV1 {
    pub result: Option<MigrationResultV1>,
    pub report: Option<MigrationReportV1>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDocument {
    document_id: String,
    revision: u64,
    root_order: Vec<String>,
    elements: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum LegacyElementRecord {
    Rect(LegacyRectElement),
    Stroke(LegacyStrokeElement),
    Text(LegacyTextElement),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRectElement {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStrokeElement {
    id: String,
    points: Vec<crate::Vec2>,
    stroke_width: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyTextElement {
    id: String,
    x: f64,
    y: f64,
    text: String,
    font_family: String,
    font_size: f64,
    font_weight: u16,
    max_width: Option<f64>,
    font_fingerprint: String,
}

impl LegacyElementRecord {
    fn into_current(self) -> ElementRecordV1 {
        match self {
            Self::Rect(rectangle) => ElementRecordV1::Rect(RectElementV1 {
                id: rectangle.id,
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
                fill: FillV1::default_rectangle(),
                stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
                stroke_width: DEFAULT_RECTANGLE_STROKE_WIDTH,
            }),
            Self::Stroke(stroke) => ElementRecordV1::Stroke(StrokeElementV1 {
                id: stroke.id,
                points: stroke.points,
                stroke: DEFAULT_INK_COLOR.to_string(),
                stroke_width: stroke.stroke_width,
            }),
            Self::Text(text) => ElementRecordV1::Text(TextElementV1 {
                id: text.id,
                x: text.x,
                y: text.y,
                text: text.text,
                font_family: text.font_family,
                font_size: text.font_size,
                font_weight: text.font_weight,
                color: DEFAULT_INK_COLOR.to_string(),
                text_align: TextAlignV1::Start,
                max_width: text.max_width,
                font_fingerprint: text.font_fingerprint,
            }),
        }
    }
}

pub fn migrate_document_payload(payload: &str) -> MigrationAttemptV1 {
    match migrate_document_payload_inner(payload) {
        Ok(result) => MigrationAttemptV1 {
            result: Some(result),
            report: None,
        },
        Err(report) => MigrationAttemptV1 {
            result: None,
            report: Some(report),
        },
    }
}

fn migrate_document_payload_inner(payload: &str) -> Result<MigrationResultV1, MigrationReportV1> {
    let value: Value = serde_json::from_str(payload)
        .map_err(|error| report("decode", "json_invalid", None, error))?;
    let schema_version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .ok_or_else(|| {
            report(
                "schema",
                "schema_version_invalid",
                None,
                "schemaVersion must be an unsigned 32-bit integer",
            )
        })?;

    match schema_version {
        SCHEMA_VERSION => open_current(value, schema_version),
        0 | 1 => migrate_legacy(value, schema_version),
        version => Err(report(
            "schema",
            "unknown_schema",
            Some(version),
            format!("schema version {version} is not supported"),
        )),
    }
}

fn open_current(value: Value, schema_version: u32) -> Result<MigrationResultV1, MigrationReportV1> {
    let document: NodeInkDocumentV1 = serde_json::from_value(value).map_err(|error| {
        report(
            "validation",
            "document_invalid",
            Some(schema_version),
            error,
        )
    })?;
    validate_document(&document).map_err(|error| {
        report(
            "validation",
            "document_invalid",
            Some(schema_version),
            error,
        )
    })?;
    Ok(success(schema_version, false, document))
}

fn migrate_legacy(
    value: Value,
    source_schema_version: u32,
) -> Result<MigrationResultV1, MigrationReportV1> {
    let legacy: LegacyDocument = serde_json::from_value(value).map_err(|error| {
        report(
            "migration",
            "legacy_shape_invalid",
            Some(source_schema_version),
            error,
        )
    })?;
    let mut elements = BTreeMap::new();
    for (element_id, value) in legacy.elements {
        let element: LegacyElementRecord = serde_json::from_value(value).map_err(|error| {
            report(
                "migration",
                "migration_failed",
                Some(source_schema_version),
                format!("element {element_id} cannot migrate: {error}"),
            )
        })?;
        elements.insert(element_id, element.into_current());
    }
    let document = NodeInkDocumentV1 {
        schema_version: SCHEMA_VERSION,
        document_id: legacy.document_id,
        revision: legacy.revision.checked_add(1).ok_or_else(|| {
            report(
                "migration",
                "revision_overflow",
                Some(source_schema_version),
                "legacy revision cannot advance for copy-on-write migration",
            )
        })?,
        render_profile: RenderProfileV1::clean(),
        root_order: legacy.root_order,
        elements,
    };
    validate_document(&document).map_err(|error| {
        report(
            "migration",
            "migrated_document_invalid",
            Some(source_schema_version),
            error,
        )
    })?;
    Ok(success(source_schema_version, true, document))
}

fn success(
    source_schema_version: u32,
    migrated: bool,
    document: NodeInkDocumentV1,
) -> MigrationResultV1 {
    let canonical_payload =
        serde_json::to_string(&document).expect("validated Document serialization is infallible");
    MigrationResultV1 {
        source_schema_version,
        target_schema_version: SCHEMA_VERSION,
        migrated,
        document,
        canonical_payload,
    }
}

fn report(
    stage: &str,
    code: &str,
    source_schema_version: Option<u32>,
    message: impl std::fmt::Display,
) -> MigrationReportV1 {
    MigrationReportV1 {
        stage: stage.to_string(),
        code: code.to_string(),
        source_schema_version,
        target_schema_version: SCHEMA_VERSION,
        message: message.to_string(),
        recovery: "try_next_snapshot_then_readonly_diagnostic".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_v2_opens_without_migration() {
        let payload = r#"{"schemaVersion":2,"documentId":"doc-1","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#;
        let attempt = migrate_document_payload(payload);

        let result = attempt.result.expect("valid V2 must open");
        assert!(!result.migrated);
        assert_eq!(result.source_schema_version, 2);
        assert_eq!(result.canonical_payload, payload);
        assert!(attempt.report.is_none());
    }

    #[test]
    fn legacy_v0_migrates_a_copy_to_v2() {
        let source = r#"{"schemaVersion":0,"documentId":"doc-1","revision":4,"rootOrder":["rect-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":1.0,"y":2.0,"width":3.0,"height":4.0}}}"#;
        let source_copy = source.to_string();
        let attempt = migrate_document_payload(source);

        let result = attempt.result.expect("valid V0 must migrate");
        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 0);
        assert_eq!(result.target_schema_version, 2);
        assert_eq!(result.document.revision, 5);
        assert!(result.canonical_payload.contains(r#""schemaVersion":2"#));
        assert_eq!(result.document.render_profile, RenderProfileV1::clean());
        assert_eq!(source, source_copy);
    }

    #[test]
    fn v1_migration_preserves_source_and_restores_legacy_visual_defaults() {
        let source = r##"{"schemaVersion":1,"documentId":"doc-1","revision":7,"rootOrder":["rect-1","stroke-1","text-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":1.0,"y":2.0,"width":3.0,"height":4.0},"stroke-1":{"kind":"stroke","id":"stroke-1","points":[{"x":0.0,"y":0.0},{"x":1.0,"y":1.0}],"strokeWidth":3.0},"text-1":{"kind":"text","id":"text-1","x":5.0,"y":6.0,"text":"NodeInk","fontFamily":"Noto Sans SC Variable","fontSize":24.0,"fontWeight":400,"maxWidth":null,"fontFingerprint":"font-v1"}}}"##;
        let source_copy = source.to_string();

        let result = migrate_document_payload(source)
            .result
            .expect("valid V1 must migrate");

        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 1);
        assert_eq!(result.target_schema_version, 2);
        assert_eq!(result.document.revision, 8);
        assert_eq!(result.document.render_profile, RenderProfileV1::clean());
        let ElementRecordV1::Rect(rectangle) = &result.document.elements["rect-1"] else {
            panic!("legacy rectangle must remain a rectangle");
        };
        assert_eq!(rectangle.fill, FillV1::default_rectangle());
        assert_eq!(rectangle.stroke, DEFAULT_RECTANGLE_STROKE_COLOR);
        assert_eq!(rectangle.stroke_width, DEFAULT_RECTANGLE_STROKE_WIDTH);
        let ElementRecordV1::Stroke(stroke) = &result.document.elements["stroke-1"] else {
            panic!("legacy stroke must remain a stroke");
        };
        assert_eq!(stroke.stroke, DEFAULT_INK_COLOR);
        assert_eq!(stroke.stroke_width, 3.0);
        let ElementRecordV1::Text(text) = &result.document.elements["text-1"] else {
            panic!("legacy text must remain text");
        };
        assert_eq!(text.color, DEFAULT_INK_COLOR);
        assert_eq!(text.text_align, TextAlignV1::Start);
        let scene = Engine::open(result.document.clone())
            .expect("migrated document must open")
            .current_update()
            .scene;
        let SceneNodeV1::Rect(rectangle) = &scene.nodes["rect-1:shape"] else {
            panic!("migrated rectangle must preserve the Clean visual");
        };
        assert_eq!(rectangle.fill, DEFAULT_RECTANGLE_FILL_COLOR);
        assert_eq!(rectangle.stroke, DEFAULT_RECTANGLE_STROKE_COLOR);
        let SceneNodeV1::Path(stroke) = &scene.nodes["stroke-1:path"] else {
            panic!("migrated stroke must preserve the Clean visual");
        };
        assert_eq!(stroke.stroke, DEFAULT_INK_COLOR);
        assert_eq!(source, source_copy);
    }

    #[test]
    fn unknown_schema_and_invalid_schema_field_are_structured() {
        let unknown = migrate_document_payload(r#"{"schemaVersion":99}"#);
        let invalid = migrate_document_payload(r#"{"schemaVersion":"one"}"#);
        let overflow = migrate_document_payload(r#"{"schemaVersion":4294967296}"#);

        assert_eq!(unknown.report.unwrap().code, "unknown_schema");
        assert_eq!(invalid.report.unwrap().code, "schema_version_invalid");
        assert_eq!(overflow.report.unwrap().code, "schema_version_invalid");
    }

    #[test]
    fn corrupt_current_document_and_invalid_json_are_structured() {
        let corrupt = migrate_document_payload(
            r#"{"schemaVersion":2,"documentId":"doc-1","revision":"bad","renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#,
        );
        let invalid_json = migrate_document_payload("{");

        assert_eq!(corrupt.report.unwrap().code, "document_invalid");
        assert_eq!(invalid_json.report.unwrap().code, "json_invalid");
    }

    #[test]
    fn unsupported_legacy_element_reports_migration_failure() {
        let attempt = migrate_document_payload(
            r#"{"schemaVersion":0,"documentId":"doc-1","revision":0,"rootOrder":["plugin-1"],"elements":{"plugin-1":{"kind":"legacy_plugin","id":"plugin-1"}}}"#,
        );

        let report = attempt.report.expect("legacy plugin must fail migration");
        assert_eq!(report.stage, "migration");
        assert_eq!(report.code, "migration_failed");
    }

    #[test]
    fn migrated_document_still_must_satisfy_document_invariants() {
        let attempt = migrate_document_payload(
            r#"{"schemaVersion":0,"documentId":"","revision":0,"rootOrder":[],"elements":{}}"#,
        );

        assert_eq!(attempt.report.unwrap().code, "migrated_document_invalid");
    }

    #[test]
    fn current_and_legacy_document_shape_failures_are_distinguished() {
        let current_invariant = migrate_document_payload(
            r#"{"schemaVersion":2,"documentId":"","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#,
        );
        let legacy_shape = migrate_document_payload(
            r#"{"schemaVersion":0,"documentId":"doc-1","revision":0,"rootOrder":[]}"#,
        );

        assert_eq!(current_invariant.report.unwrap().code, "document_invalid");
        assert_eq!(legacy_shape.report.unwrap().code, "legacy_shape_invalid");
    }
}
