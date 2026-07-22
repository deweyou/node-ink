use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    EngineErrorV1, NodeInkDocumentV1, SceneTextRunV1, TextAnchorV1, TextElementV1, fnv1a64_hex,
};

pub const CANVAS_FONT_FAMILY: &str = "Noto Sans SC Variable";
pub const DEFAULT_TEXT_FONT_SIZE: f64 = 24.0;
pub const DEFAULT_TEXT_FONT_WEIGHT: u16 = 400;

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

#[derive(Debug, Clone, Default)]
pub(crate) struct TextMetricsCache {
    metrics: BTreeMap<(String, String), TextMetricsV1>,
}

impl TextMetricsCache {
    pub(crate) fn metric_for(&self, element: &TextElementV1) -> Option<&TextMetricsV1> {
        let run = text_run(element);
        self.metrics
            .get(&(element.font_fingerprint.clone(), run.key))
    }

    pub(crate) fn request_for_document(
        &self,
        document: &NodeInkDocumentV1,
        request_id: String,
    ) -> Option<TextMeasureRequestV1> {
        let missing = document
            .root_order
            .iter()
            .filter_map(|element_id| document.elements.get(element_id))
            .filter_map(|element| element.as_text())
            .filter_map(|element| {
                let run = text_run(element);
                (!self
                    .metrics
                    .contains_key(&(element.font_fingerprint.clone(), run.key.clone())))
                .then_some((element.font_fingerprint.clone(), run))
            })
            .collect::<Vec<_>>();
        let fingerprint = missing.first()?.0.clone();
        let runs = missing
            .into_iter()
            .filter_map(|(candidate, run)| (candidate == fingerprint).then_some(run))
            .collect();
        Some(TextMeasureRequestV1 {
            request_id,
            font_fingerprint: fingerprint,
            runs,
        })
    }

    pub(crate) fn provide(
        &mut self,
        document: &NodeInkDocumentV1,
        snapshot: TextMetricsSnapshotV1,
    ) -> Result<bool, EngineErrorV1> {
        if snapshot.font_fingerprint.trim().is_empty()
            || !document.elements.values().any(|element| {
                element
                    .as_text()
                    .is_some_and(|text| text.font_fingerprint == snapshot.font_fingerprint)
            })
        {
            return Err(EngineErrorV1::TextFingerprintMismatch);
        }
        let expected = document
            .elements
            .values()
            .filter_map(|element| element.as_text())
            .filter(|element| element.font_fingerprint == snapshot.font_fingerprint)
            .map(|element| {
                let run = text_run(element);
                (run.key, (element.text.chars().count(), element.max_width))
            })
            .collect::<BTreeMap<_, _>>();
        let mut next = Vec::with_capacity(snapshot.metrics.len());
        for metric in snapshot.metrics {
            let Some((text_len, max_width)) = expected.get(&metric.key).copied() else {
                return Err(EngineErrorV1::InvalidTextMetrics);
            };
            validate_product_metric(&metric, text_len)?;
            if max_width.is_some_and(|width| metric.width > width + f64::EPSILON) {
                return Err(EngineErrorV1::InvalidTextMetrics);
            }
            if next
                .iter()
                .any(|candidate: &TextMetricsV1| candidate.key == metric.key)
            {
                return Err(EngineErrorV1::InvalidTextMetrics);
            }
            next.push(metric);
        }
        if next.is_empty() {
            return Err(EngineErrorV1::InvalidTextMetrics);
        }
        let mut changed = false;
        for metric in next {
            let key = (snapshot.font_fingerprint.clone(), metric.key.clone());
            changed |= self.metrics.get(&key) != Some(&metric);
            self.metrics.insert(key, metric);
        }
        Ok(changed)
    }
}

pub(crate) fn text_run(element: &TextElementV1) -> TextRunV1 {
    let canonical = serde_json::to_string(&(
        &element.text,
        &element.font_family,
        element.font_size,
        element.font_weight,
        element.max_width,
        &element.font_fingerprint,
    ))
    .expect("text run key serialization is infallible");
    TextRunV1 {
        key: format!(
            "{}:{}",
            element.id,
            fnv1a64_hex(canonical.as_bytes()).trim_start_matches("fnv1a64:")
        ),
        text: element.text.clone(),
        font_family: element.font_family.clone(),
        font_size: element.font_size,
        font_weight: element.font_weight,
        max_width: element.max_width,
    }
}

pub(crate) fn scene_runs(element: &TextElementV1, metric: &TextMetricsV1) -> Vec<SceneTextRunV1> {
    let lines = split_lines(&element.text, &metric.line_breaks);
    let line_height = metric.height / lines.len().max(1) as f64;
    lines
        .into_iter()
        .enumerate()
        .map(|(index, text)| SceneTextRunV1 {
            text,
            x: element.x,
            y: element.y + metric.baseline + line_height * index as f64,
            font_family: element.font_family.clone(),
            font_size: element.font_size,
            font_weight: element.font_weight,
            fill: element.color.clone(),
            text_anchor: TextAnchorV1::from(element.text_align),
        })
        .collect()
}

fn split_lines(text: &str, measured_breaks: &[usize]) -> Vec<String> {
    let breaks = measured_breaks
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let mut lines = Vec::new();
    let mut line = String::new();
    for (index, character) in text.chars().enumerate() {
        if character == '\n' {
            lines.push(std::mem::take(&mut line));
            continue;
        }
        if breaks.contains(&index) && !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        line.push(character);
    }
    lines.push(line);
    lines
}

fn validate_product_metric(metric: &TextMetricsV1, text_len: usize) -> Result<(), EngineErrorV1> {
    validate_metric(metric).map_err(|_| EngineErrorV1::InvalidTextMetrics)?;
    if metric.height <= 0.0
        || metric.baseline > metric.height
        || metric.line_breaks.iter().any(|index| *index >= text_len)
        || metric.line_breaks.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(EngineErrorV1::InvalidTextMetrics);
    }
    Ok(())
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
