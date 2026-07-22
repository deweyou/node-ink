use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{EngineErrorV1, fnv1a64_hex};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRunV1 {
    pub key: String,
    pub text: String,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub max_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetricsV1 {
    pub key: String,
    pub width: f64,
    pub height: f64,
    pub baseline: f64,
    pub line_breaks: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMeasureRequestV1 {
    pub request_id: String,
    pub font_fingerprint: String,
    pub runs: Vec<TextRunV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetricsSnapshotV1 {
    pub font_fingerprint: String,
    pub metrics: Vec<TextMetricsV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTextRunV1 {
    pub run: TextRunV1,
    pub metrics: TextMetricsV1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFixtureSceneV1 {
    pub font_fingerprint: String,
    pub runs: Vec<ResolvedTextRunV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFixtureResolutionV1 {
    pub request: Option<TextMeasureRequestV1>,
    pub scene: Option<TextFixtureSceneV1>,
    pub canonical_hash: Option<String>,
}

pub(crate) fn resolve_text_fixture(
    request_id: String,
    font_fingerprint: String,
    runs: Vec<TextRunV1>,
    snapshot: Option<TextMetricsSnapshotV1>,
) -> Result<TextFixtureResolutionV1, EngineErrorV1> {
    validate_runs(&runs)?;
    let metrics_by_key = match snapshot {
        Some(snapshot) => {
            if snapshot.font_fingerprint != font_fingerprint {
                return Err(EngineErrorV1::TextFingerprintMismatch);
            }
            snapshot
                .metrics
                .into_iter()
                .map(|metric| (metric.key.clone(), metric))
                .collect::<BTreeMap<_, _>>()
        }
        None => BTreeMap::new(),
    };
    let missing_runs: Vec<TextRunV1> = runs
        .iter()
        .filter(|run| !metrics_by_key.contains_key(&run.key))
        .cloned()
        .collect();
    if !missing_runs.is_empty() {
        return Ok(TextFixtureResolutionV1 {
            request: Some(TextMeasureRequestV1 {
                request_id,
                font_fingerprint,
                runs: missing_runs,
            }),
            scene: None,
            canonical_hash: None,
        });
    }

    let resolved_runs = runs
        .into_iter()
        .map(|run| {
            let metric = metrics_by_key
                .get(&run.key)
                .expect("missing metrics were returned before scene resolution")
                .clone();
            validate_metric(&metric)?;
            Ok(ResolvedTextRunV1 {
                run,
                metrics: metric,
            })
        })
        .collect::<Result<Vec<_>, EngineErrorV1>>()?;
    let scene = TextFixtureSceneV1 {
        font_fingerprint,
        runs: resolved_runs,
    };
    let canonical =
        serde_json::to_string(&scene).expect("text fixture serialization is infallible");
    Ok(TextFixtureResolutionV1 {
        request: None,
        scene: Some(scene),
        canonical_hash: Some(fnv1a64_hex(canonical.as_bytes())),
    })
}

fn validate_runs(runs: &[TextRunV1]) -> Result<(), EngineErrorV1> {
    let valid = !runs.is_empty()
        && runs.iter().all(|run| {
            !run.key.trim().is_empty()
                && !run.font_family.trim().is_empty()
                && run.font_size.is_finite()
                && run.font_size > 0.0
                && matches!(run.font_weight, 400 | 500)
                && run
                    .max_width
                    .is_none_or(|width| width.is_finite() && width > 0.0)
        });
    if valid {
        Ok(())
    } else {
        Err(EngineErrorV1::InvalidTextFixture)
    }
}

fn validate_metric(metric: &TextMetricsV1) -> Result<(), EngineErrorV1> {
    let valid = metric.width.is_finite()
        && metric.width >= 0.0
        && metric.height.is_finite()
        && metric.height >= 0.0
        && metric.baseline.is_finite()
        && metric.baseline >= 0.0;
    if valid {
        Ok(())
    } else {
        Err(EngineErrorV1::InvalidTextFixture)
    }
}
