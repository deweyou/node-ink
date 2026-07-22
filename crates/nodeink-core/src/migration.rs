use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ElementRecordV1, NodeInkDocumentV1, SCHEMA_VERSION, validate_document};

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
struct LegacyDocumentV0 {
    document_id: String,
    revision: u64,
    root_order: Vec<String>,
    elements: BTreeMap<String, Value>,
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
        0 => migrate_v0(value),
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

fn migrate_v0(value: Value) -> Result<MigrationResultV1, MigrationReportV1> {
    let legacy: LegacyDocumentV0 = serde_json::from_value(value)
        .map_err(|error| report("migration", "legacy_shape_invalid", Some(0), error))?;
    let mut elements = BTreeMap::new();
    for (element_id, value) in legacy.elements {
        let element: ElementRecordV1 = serde_json::from_value(value).map_err(|error| {
            report(
                "migration",
                "migration_failed",
                Some(0),
                format!("element {element_id} cannot migrate: {error}"),
            )
        })?;
        elements.insert(element_id, element);
    }
    let document = NodeInkDocumentV1 {
        schema_version: SCHEMA_VERSION,
        document_id: legacy.document_id,
        revision: legacy.revision.checked_add(1).ok_or_else(|| {
            report(
                "migration",
                "revision_overflow",
                Some(0),
                "legacy revision cannot advance for copy-on-write migration",
            )
        })?,
        root_order: legacy.root_order,
        elements,
    };
    validate_document(&document)
        .map_err(|error| report("migration", "migrated_document_invalid", Some(0), error))?;
    Ok(success(0, true, document))
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
    fn valid_v1_opens_without_migration() {
        let payload =
            r#"{"schemaVersion":1,"documentId":"doc-1","revision":0,"rootOrder":[],"elements":{}}"#;
        let attempt = migrate_document_payload(payload);

        let result = attempt.result.expect("valid V1 must open");
        assert!(!result.migrated);
        assert_eq!(result.source_schema_version, 1);
        assert_eq!(result.canonical_payload, payload);
        assert!(attempt.report.is_none());
    }

    #[test]
    fn legacy_v0_migrates_a_copy_to_v1() {
        let source = r#"{"schemaVersion":0,"documentId":"doc-1","revision":4,"rootOrder":["rect-1"],"elements":{"rect-1":{"kind":"rect","id":"rect-1","x":1.0,"y":2.0,"width":3.0,"height":4.0}}}"#;
        let source_copy = source.to_string();
        let attempt = migrate_document_payload(source);

        let result = attempt.result.expect("valid V0 must migrate");
        assert!(result.migrated);
        assert_eq!(result.source_schema_version, 0);
        assert_eq!(result.target_schema_version, 1);
        assert_eq!(result.document.revision, 5);
        assert!(result.canonical_payload.contains(r#""schemaVersion":1"#));
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
            r#"{"schemaVersion":1,"documentId":"doc-1","revision":"bad","rootOrder":[],"elements":{}}"#,
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
            r#"{"schemaVersion":1,"documentId":"","revision":0,"rootOrder":[],"elements":{}}"#,
        );
        let legacy_shape = migrate_document_payload(
            r#"{"schemaVersion":0,"documentId":"doc-1","revision":0,"rootOrder":[]}"#,
        );

        assert_eq!(current_invariant.report.unwrap().code, "document_invalid");
        assert_eq!(legacy_shape.report.unwrap().code, "legacy_shape_invalid");
    }
}
