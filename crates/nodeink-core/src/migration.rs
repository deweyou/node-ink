use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    Affine2D, DEFAULT_ELEMENT_SIZE, DEFAULT_INK_COLOR, DEFAULT_RECTANGLE_STROKE_COLOR,
    ElementRecordV1, ElementSizeV1, FillV1, NodeInkDocumentV1, RectElementV1, RenderProfileV1,
    SCHEMA_VERSION, StrokeElementV1, TextAlignV1, TextElementV1, validate_document,
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
                transform: Affine2D::identity(),
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
                fill: FillV1::default_rectangle(),
                stroke: DEFAULT_RECTANGLE_STROKE_COLOR.to_string(),
                size: DEFAULT_ELEMENT_SIZE,
            }),
            Self::Stroke(stroke) => ElementRecordV1::Stroke(StrokeElementV1 {
                id: stroke.id,
                transform: Affine2D::identity(),
                points: stroke.points,
                stroke: DEFAULT_INK_COLOR.to_string(),
                size: ElementSizeV1::from_legacy_stroke_width(stroke.stroke_width),
            }),
            Self::Text(text) => ElementRecordV1::Text(TextElementV1 {
                id: text.id,
                transform: Affine2D::identity(),
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
        5 => migrate_v5(value),
        4 => migrate_v4(value),
        3 => migrate_v3(value),
        2 => migrate_v2(value),
        0 | 1 => migrate_legacy(value, schema_version),
        version => Err(report(
            "schema",
            "unknown_schema",
            Some(version),
            format!("schema version {version} is not supported"),
        )),
    }
}

fn migrate_v5(mut value: Value) -> Result<MigrationResultV1, MigrationReportV1> {
    migrate_path_curves(&mut value, 5)?;
    advance_migrated_document(value, 5)
}

fn migrate_v4(mut value: Value) -> Result<MigrationResultV1, MigrationReportV1> {
    migrate_stroke_sizes(&mut value, 4)?;
    migrate_path_curves(&mut value, 4)?;
    advance_migrated_document(value, 4)
}

fn migrate_v3(mut value: Value) -> Result<MigrationResultV1, MigrationReportV1> {
    migrate_stroke_sizes(&mut value, 3)?;
    migrate_path_curves(&mut value, 3)?;
    advance_migrated_document(value, 3)
}

fn migrate_v2(mut value: Value) -> Result<MigrationResultV1, MigrationReportV1> {
    let document = value.as_object_mut().ok_or_else(|| {
        report(
            "migration",
            "v2_shape_invalid",
            Some(2),
            "schema V2 document must be an object",
        )
    })?;
    let revision = document
        .get("revision")
        .and_then(Value::as_u64)
        .and_then(|revision| revision.checked_add(1))
        .ok_or_else(|| {
            report(
                "migration",
                "revision_overflow",
                Some(2),
                "schema V2 revision cannot advance for copy-on-write migration",
            )
        })?;
    let elements = document
        .get_mut("elements")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            report(
                "migration",
                "v2_shape_invalid",
                Some(2),
                "schema V2 elements must be an object",
            )
        })?;
    let identity = serde_json::to_value(Affine2D::identity())
        .expect("identity transform serialization is infallible");
    for (element_id, element) in elements {
        let object = element.as_object_mut().ok_or_else(|| {
            report(
                "migration",
                "migration_failed",
                Some(2),
                format!("element {element_id} must be an object"),
            )
        })?;
        match object.get("kind").and_then(Value::as_str) {
            Some("rect" | "stroke" | "text") => {
                object.insert("transform".to_string(), identity.clone());
            }
            _ => {
                return Err(report(
                    "migration",
                    "migration_failed",
                    Some(2),
                    format!("element {element_id} has an unsupported kind"),
                ));
            }
        }
    }
    let _ = revision;
    migrate_stroke_sizes(&mut value, 2)?;
    migrate_path_curves(&mut value, 2)?;
    advance_migrated_document(value, 2)
}

fn migrate_stroke_sizes(
    value: &mut Value,
    source_schema_version: u32,
) -> Result<(), MigrationReportV1> {
    let elements = value
        .as_object_mut()
        .and_then(|document| document.get_mut("elements"))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            report(
                "migration",
                "migration_failed",
                Some(source_schema_version),
                "document elements must be an object",
            )
        })?;
    for (element_id, element) in elements {
        let object = element.as_object_mut().ok_or_else(|| {
            report(
                "migration",
                "migration_failed",
                Some(source_schema_version),
                format!("element {element_id} must be an object"),
            )
        })?;
        let kind = object.get("kind").and_then(Value::as_str);
        if matches!(
            kind,
            Some("rect" | "ellipse" | "diamond" | "line" | "polyline" | "arrow" | "stroke")
        ) {
            let stroke_width = object
                .remove("strokeWidth")
                .and_then(|width| width.as_f64())
                .ok_or_else(|| {
                    report(
                        "migration",
                        "migration_failed",
                        Some(source_schema_version),
                        format!("element {element_id} must contain a finite strokeWidth"),
                    )
                })?;
            let size = ElementSizeV1::from_legacy_stroke_width(stroke_width);
            object.insert(
                "size".to_string(),
                serde_json::to_value(size).expect("size serialization is infallible"),
            );
        }
    }
    Ok(())
}

fn migrate_path_curves(
    value: &mut Value,
    source_schema_version: u32,
) -> Result<(), MigrationReportV1> {
    let elements = value
        .as_object_mut()
        .and_then(|document| document.get_mut("elements"))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            report(
                "migration",
                "migration_failed",
                Some(source_schema_version),
                "document elements must be an object",
            )
        })?;
    for (element_id, element) in elements {
        let object = element.as_object_mut().ok_or_else(|| {
            report(
                "migration",
                "migration_failed",
                Some(source_schema_version),
                format!("element {element_id} must be an object"),
            )
        })?;
        if matches!(
            object.get("kind").and_then(Value::as_str),
            Some("line" | "arrow")
        ) {
            object.insert("curve".to_string(), Value::Null);
        }
    }
    Ok(())
}

fn advance_migrated_document(
    mut value: Value,
    source_schema_version: u32,
) -> Result<MigrationResultV1, MigrationReportV1> {
    let document = value.as_object_mut().ok_or_else(|| {
        report(
            "migration",
            "migration_failed",
            Some(source_schema_version),
            "document must be an object",
        )
    })?;
    let revision = document
        .get("revision")
        .and_then(Value::as_u64)
        .and_then(|revision| revision.checked_add(1))
        .ok_or_else(|| {
            report(
                "migration",
                "revision_overflow",
                Some(source_schema_version),
                format!(
                    "schema V{source_schema_version} revision cannot advance for copy-on-write migration"
                ),
            )
        })?;
    document.insert("schemaVersion".to_string(), Value::from(SCHEMA_VERSION));
    document.insert("revision".to_string(), Value::from(revision));
    let migrated: NodeInkDocumentV1 = serde_json::from_value(value).map_err(|error| {
        report(
            "migration",
            "migrated_document_invalid",
            Some(source_schema_version),
            error,
        )
    })?;
    validate_document(&migrated).map_err(|error| {
        report(
            "migration",
            "migrated_document_invalid",
            Some(source_schema_version),
            error,
        )
    })?;
    Ok(success(source_schema_version, true, migrated))
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
    fn valid_v3_migrates_copy_on_write_without_changing_semantics() {
        let source = r##"{"schemaVersion":3,"documentId":"doc-1","revision":8,"renderProfile":{"kind":"clean","version":1},"rootOrder":["rect-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":12.0,"f":8.0},"x":1.0,"y":2.0,"width":30.0,"height":40.0,"fill":{"kind":"solid","color":"#d1fae5"},"stroke":"#047857","strokeWidth":2.0}}}"##;
        let source_copy = source.to_string();

        let result = migrate_document_payload(source)
            .result
            .expect("valid V3 must migrate");

        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 3);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 9);
        assert_eq!(result.document.root_order, ["rect-1"]);
        let ElementRecordV1::Rect(rectangle) = &result.document.elements["rect-1"] else {
            panic!("V3 rectangle must remain a rectangle");
        };
        assert_eq!((rectangle.transform.e, rectangle.transform.f), (12.0, 8.0));
        assert_eq!(rectangle.size, ElementSizeV1::S);
        assert!(result.canonical_payload.contains(r#""schemaVersion":6"#));
        assert_eq!(source, source_copy);
    }

    #[test]
    fn valid_v2_migrates_with_identity_transforms() {
        let payload = r##"{"schemaVersion":2,"documentId":"doc-1","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":["rect-1","stroke-1","text-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":1.0,"y":2.0,"width":3.0,"height":4.0,"fill":{"kind":"solid","color":"#d1fae5"},"stroke":"#047857","strokeWidth":2.0},"stroke-1":{"kind":"stroke","id":"stroke-1","points":[{"x":0.0,"y":0.0},{"x":1.0,"y":1.0}],"strokeWidth":3.0,"stroke":"#0f172a"},"text-1":{"kind":"text","id":"text-1","x":5.0,"y":6.0,"text":"NodeInk","fontFamily":"Noto Sans SC Variable","fontSize":24.0,"fontWeight":400,"maxWidth":null,"fontFingerprint":"font-v1","color":"#0f172a","textAlign":"start"}}}"##;
        let attempt = migrate_document_payload(payload);

        let result = attempt.result.expect("valid V2 must open");
        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 2);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 1);
        assert!(
            result
                .document
                .elements
                .values()
                .all(|element| element.transform() == Affine2D::identity())
        );
        assert!(result.canonical_payload.contains(r#""schemaVersion":6"#));
        assert!(attempt.report.is_none());
    }

    #[test]
    fn v2_shape_and_element_failures_are_structured() {
        let fixtures = [
            (r#"{"schemaVersion":2}"#, "revision_overflow"),
            (
                r#"{"schemaVersion":2,"revision":18446744073709551615,"elements":{}}"#,
                "revision_overflow",
            ),
            (
                r#"{"schemaVersion":2,"revision":0,"elements":[]}"#,
                "v2_shape_invalid",
            ),
            (
                r#"{"schemaVersion":2,"revision":0,"elements":{"bad":1}}"#,
                "migration_failed",
            ),
            (
                r#"{"schemaVersion":2,"revision":0,"elements":{"bad":{"kind":"group"}}}"#,
                "migration_failed",
            ),
            (
                r##"{"schemaVersion":2,"documentId":"doc-1","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":["rect-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":null,"y":2.0,"width":3.0,"height":4.0,"fill":{"kind":"solid","color":"#d1fae5"},"stroke":"#047857","strokeWidth":2.0}}}"##,
                "migrated_document_invalid",
            ),
        ];

        for (payload, expected_code) in fixtures {
            let attempt = migrate_document_payload(payload);
            assert_eq!(
                attempt.report.expect("invalid V2 must report").code,
                expected_code
            );
        }
    }

    #[test]
    fn legacy_v0_migrates_a_copy_to_v6() {
        let source = r#"{"schemaVersion":0,"documentId":"doc-1","revision":4,"rootOrder":["rect-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":1.0,"y":2.0,"width":3.0,"height":4.0}}}"#;
        let source_copy = source.to_string();
        let attempt = migrate_document_payload(source);

        let result = attempt.result.expect("valid V0 must migrate");
        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 0);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 5);
        assert!(result.canonical_payload.contains(r#""schemaVersion":6"#));
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
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 8);
        assert_eq!(result.document.render_profile, RenderProfileV1::clean());
        let ElementRecordV1::Rect(rectangle) = &result.document.elements["rect-1"] else {
            panic!("legacy rectangle must remain a rectangle");
        };
        assert_eq!(rectangle.fill, FillV1::default_rectangle());
        assert_eq!(rectangle.stroke, DEFAULT_RECTANGLE_STROKE_COLOR);
        assert_eq!(rectangle.size, ElementSizeV1::M);
        let ElementRecordV1::Stroke(stroke) = &result.document.elements["stroke-1"] else {
            panic!("legacy stroke must remain a stroke");
        };
        assert_eq!(stroke.stroke, DEFAULT_INK_COLOR);
        assert_eq!(stroke.size, ElementSizeV1::M);
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
            r#"{"schemaVersion":6,"documentId":"doc-1","revision":"bad","renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#,
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
            r#"{"schemaVersion":6,"documentId":"","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#,
        );
        let legacy_shape = migrate_document_payload(
            r#"{"schemaVersion":0,"documentId":"doc-1","revision":0,"rootOrder":[]}"#,
        );

        assert_eq!(current_invariant.report.unwrap().code, "document_invalid");
        assert_eq!(legacy_shape.report.unwrap().code, "legacy_shape_invalid");
    }

    #[test]
    fn valid_v4_maps_numeric_widths_to_semantic_sizes_copy_on_write() {
        let source = r##"{"schemaVersion":4,"documentId":"doc-1","revision":3,"renderProfile":{"kind":"clean","version":1},"rootOrder":["rect-s","arrow-m","stroke-l","line-xl"],"elements":{"rect-s":{"kind":"rect","id":"rect-s","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"x":0.0,"y":0.0,"width":30.0,"height":20.0,"fill":{"kind":"solid","color":"#d1fae5"},"stroke":"#047857","strokeWidth":2.0},"arrow-m":{"kind":"arrow","id":"arrow-m","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"points":[{"x":0.0,"y":0.0},{"x":20.0,"y":10.0}],"stroke":"#0f172a","strokeWidth":4.0},"stroke-l":{"kind":"stroke","id":"stroke-l","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"points":[{"x":0.0,"y":0.0},{"x":5.0,"y":5.0}],"stroke":"#0f172a","strokeWidth":6.0},"line-xl":{"kind":"line","id":"line-xl","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"points":[{"x":0.0,"y":0.0},{"x":10.0,"y":0.0}],"stroke":"#0f172a","strokeWidth":8.0}}}"##;
        let source_copy = source.to_string();

        let result = migrate_document_payload(source)
            .result
            .expect("valid V4 must migrate");

        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 4);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 4);
        let ElementRecordV1::Rect(rectangle) = &result.document.elements["rect-s"] else {
            panic!("rect-s must stay a rectangle");
        };
        let ElementRecordV1::Arrow(arrow) = &result.document.elements["arrow-m"] else {
            panic!("arrow-m must stay an arrow");
        };
        let ElementRecordV1::Stroke(stroke) = &result.document.elements["stroke-l"] else {
            panic!("stroke-l must stay a stroke");
        };
        let ElementRecordV1::Line(line) = &result.document.elements["line-xl"] else {
            panic!("line-xl must stay a line");
        };
        assert_eq!(rectangle.size, ElementSizeV1::S);
        assert_eq!(arrow.size, ElementSizeV1::M);
        assert_eq!(stroke.size, ElementSizeV1::L);
        assert_eq!(line.size, ElementSizeV1::Xl);
        assert!(result.canonical_payload.contains(r#""schemaVersion":6"#));
        assert!(!result.canonical_payload.contains("strokeWidth"));
        assert_eq!(source, source_copy);
    }

    #[test]
    fn v4_migration_failures_are_structured() {
        let fixtures = [
            (r#"{"schemaVersion":4,"revision":0}"#, "migration_failed"),
            (
                r#"{"schemaVersion":4,"revision":0,"elements":{"bad":1}}"#,
                "migration_failed",
            ),
            (
                r#"{"schemaVersion":4,"revision":0,"elements":{"rect-1":{"kind":"rect"}}}"#,
                "migration_failed",
            ),
            (
                r#"{"schemaVersion":4,"revision":18446744073709551615,"elements":{}}"#,
                "revision_overflow",
            ),
            (
                r##"{"schemaVersion":4,"documentId":"doc-1","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":["text-1"],"elements":{"text-1":{"kind":"text","id":"text-1","x":0.0,"y":0.0,"text":"NodeInk","fontFamily":"Noto Sans SC Variable","fontSize":24.0,"fontWeight":400,"maxWidth":null,"fontFingerprint":"font-v1","color":"#0f172a","textAlign":"start"}}}"##,
                "migrated_document_invalid",
            ),
            (
                r#"{"schemaVersion":4,"documentId":"","revision":0,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#,
                "migrated_document_invalid",
            ),
        ];

        for (payload, expected_code) in fixtures {
            let attempt = migrate_document_payload(payload);
            assert_eq!(
                attempt.report.expect("invalid V4 must report").code,
                expected_code
            );
        }
    }

    #[test]
    fn valid_v5_adds_null_curves_copy_on_write() {
        let payload = r##"{"schemaVersion":5,"documentId":"doc-1","revision":7,"renderProfile":{"kind":"clean","version":1},"rootOrder":["line-1","arrow-1"],"elements":{"line-1":{"kind":"line","id":"line-1","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"points":[{"x":0.0,"y":0.0},{"x":10.0,"y":0.0}],"stroke":"#0f172a","size":"m"},"arrow-1":{"kind":"arrow","id":"arrow-1","transform":{"a":1.0,"b":0.0,"c":0.0,"d":1.0,"e":0.0,"f":0.0},"points":[{"x":0.0,"y":10.0},{"x":10.0,"y":10.0}],"stroke":"#0f172a","size":"m"}}}"##;
        let result = migrate_document_payload(payload)
            .result
            .expect("valid V5 must migrate");

        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 5);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 8);
        let ElementRecordV1::Line(line) = &result.document.elements["line-1"] else {
            panic!("line-1 must remain a line");
        };
        let ElementRecordV1::Arrow(arrow) = &result.document.elements["arrow-1"] else {
            panic!("arrow-1 must remain an arrow");
        };
        assert!(line.curve.is_none());
        assert!(arrow.curve.is_none());
        assert!(result.canonical_payload.contains(r#""schemaVersion":6"#));
        assert_eq!(payload.matches(r#""curve""#).count(), 0);
    }

    #[test]
    fn current_v6_opens_without_migration() {
        let payload = r#"{"schemaVersion":6,"documentId":"doc-1","revision":7,"renderProfile":{"kind":"clean","version":1},"rootOrder":[],"elements":{}}"#;
        let result = migrate_document_payload(payload)
            .result
            .expect("valid V6 must open");

        assert!(!result.migrated);
        assert_eq!(result.source_schema_version, 6);
        assert_eq!(result.target_schema_version, 6);
        assert_eq!(result.document.revision, 7);
        assert_eq!(result.canonical_payload, payload);
    }
}
