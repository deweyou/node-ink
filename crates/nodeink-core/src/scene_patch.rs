use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{EngineErrorV1, PROTOCOL_VERSION, SceneNodeV1, SceneRectV1, SceneSnapshotV1};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePatchV1 {
    pub protocol_version: u32,
    pub document_revision: u64,
    pub base_scene_revision: u64,
    pub scene_revision: u64,
    pub added_nodes: BTreeMap<String, SceneNodeV1>,
    pub updated_nodes: BTreeMap<String, SceneNodeV1>,
    pub removed_node_ids: Vec<String>,
    pub root_node_ids: Option<Vec<String>>,
}

pub fn diff_scene(before: &SceneSnapshotV1, after: &SceneSnapshotV1) -> ScenePatchV1 {
    let before_ids: BTreeSet<_> = before.nodes.keys().cloned().collect();
    let after_ids: BTreeSet<_> = after.nodes.keys().cloned().collect();
    let added_nodes = after_ids
        .difference(&before_ids)
        .filter_map(|id| after.nodes.get(id).cloned().map(|node| (id.clone(), node)))
        .collect();
    let removed_node_ids = before_ids.difference(&after_ids).cloned().collect();
    let updated_nodes = before_ids
        .intersection(&after_ids)
        .filter_map(|id| {
            let before_node = before.nodes.get(id)?;
            let after_node = after.nodes.get(id)?;
            (before_node != after_node).then(|| (id.clone(), after_node.clone()))
        })
        .collect();
    ScenePatchV1 {
        protocol_version: PROTOCOL_VERSION,
        document_revision: after.document_revision,
        base_scene_revision: before.scene_revision,
        scene_revision: after.scene_revision,
        added_nodes,
        updated_nodes,
        removed_node_ids,
        root_node_ids: (before.root_node_ids != after.root_node_ids)
            .then(|| after.root_node_ids.clone()),
    }
}

pub fn benchmark_scene_snapshot(
    element_count: usize,
    moved_count: usize,
    after_move: bool,
) -> Result<SceneSnapshotV1, EngineErrorV1> {
    validate_fixture(element_count, moved_count)?;
    let scene_revision = if after_move { 2 } else { 1 };
    let mut root_node_ids = Vec::with_capacity(element_count);
    let mut nodes = BTreeMap::new();
    for index in 0..element_count {
        let element_id = format!("rect-{index:05}");
        let node_id = format!("{element_id}:shape");
        let column = index % 100;
        let row = index / 100;
        let moved = after_move && index < moved_count;
        root_node_ids.push(node_id.clone());
        nodes.insert(
            node_id.clone(),
            SceneNodeV1::Rect(SceneRectV1 {
                id: node_id,
                source_element_id: element_id,
                x: column as f64 * 14.0 + if moved { 32.0 } else { 0.0 },
                y: row as f64 * 14.0 + if moved { 16.0 } else { 0.0 },
                width: 10.0,
                height: 10.0,
                fill: "#d1fae5".to_string(),
                stroke: "#047857".to_string(),
                stroke_width: crate::RECTANGLE_STROKE_WIDTH,
            }),
        );
    }
    Ok(SceneSnapshotV1 {
        protocol_version: PROTOCOL_VERSION,
        document_id: "scene-patch-fixture".to_string(),
        document_revision: scene_revision,
        scene_revision,
        root_node_ids,
        nodes,
    })
}

pub fn benchmark_scene_patch(
    element_count: usize,
    moved_count: usize,
) -> Result<ScenePatchV1, EngineErrorV1> {
    let before = benchmark_scene_snapshot(element_count, moved_count, false)?;
    let after = benchmark_scene_snapshot(element_count, moved_count, true)?;
    Ok(diff_scene(&before, &after))
}

fn validate_fixture(element_count: usize, moved_count: usize) -> Result<(), EngineErrorV1> {
    if element_count == 0 || moved_count == 0 || moved_count > element_count {
        Err(EngineErrorV1::InvalidBenchmarkFixture)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn benchmark_patch_contains_only_the_moved_nodes() {
        let patch = benchmark_scene_patch(1_000, 100).expect("fixture must be valid");

        assert_eq!(patch.base_scene_revision, 1);
        assert_eq!(patch.scene_revision, 2);
        assert_eq!(patch.document_revision, 2);
        assert_eq!(patch.updated_nodes.len(), 100);
        assert!(patch.added_nodes.is_empty());
        assert!(patch.removed_node_ids.is_empty());
        assert_eq!(patch.root_node_ids, None);
        assert_eq!(
            patch.updated_nodes["rect-00000:shape"],
            SceneNodeV1::Rect(SceneRectV1 {
                id: "rect-00000:shape".to_string(),
                source_element_id: "rect-00000".to_string(),
                x: 32.0,
                y: 16.0,
                width: 10.0,
                height: 10.0,
                fill: "#d1fae5".to_string(),
                stroke: "#047857".to_string(),
                stroke_width: crate::RECTANGLE_STROKE_WIDTH,
            })
        );
    }

    #[test]
    fn diff_reports_add_remove_update_and_root_order_changes() {
        let before = benchmark_scene_snapshot(2, 1, false).expect("fixture must be valid");
        let mut after = benchmark_scene_snapshot(2, 1, true).expect("fixture must be valid");
        after.nodes.remove("rect-00001:shape");
        after.root_node_ids.remove(1);
        let added = SceneNodeV1::Rect(SceneRectV1 {
            id: "rect-added:shape".to_string(),
            source_element_id: "rect-added".to_string(),
            x: 4.0,
            y: 8.0,
            width: 12.0,
            height: 16.0,
            fill: "none".to_string(),
            stroke: "black".to_string(),
            stroke_width: crate::RECTANGLE_STROKE_WIDTH,
        });
        after
            .nodes
            .insert("rect-added:shape".to_string(), added.clone());
        after
            .root_node_ids
            .insert(0, "rect-added:shape".to_string());

        let patch = diff_scene(&before, &after);

        assert_eq!(patch.added_nodes["rect-added:shape"], added);
        assert!(patch.updated_nodes.contains_key("rect-00000:shape"));
        assert_eq!(patch.removed_node_ids, ["rect-00001:shape"]);
        assert_eq!(patch.root_node_ids, Some(after.root_node_ids));
    }

    #[test]
    fn benchmark_snapshot_is_deterministic_and_moves_only_the_requested_prefix() {
        let before = benchmark_scene_snapshot(100, 1, false).expect("fixture must be valid");
        let after = benchmark_scene_snapshot(100, 1, true).expect("fixture must be valid");

        assert_eq!(before.root_node_ids.len(), 100);
        assert_ne!(
            before.nodes["rect-00000:shape"],
            after.nodes["rect-00000:shape"]
        );
        assert_eq!(
            before.nodes["rect-00001:shape"],
            after.nodes["rect-00001:shape"]
        );
    }

    #[test]
    fn benchmark_fixture_rejects_empty_or_overlarge_move_counts() {
        assert_eq!(
            benchmark_scene_snapshot(0, 0, false),
            Err(EngineErrorV1::InvalidBenchmarkFixture)
        );
        assert_eq!(
            benchmark_scene_snapshot(10, 0, false),
            Err(EngineErrorV1::InvalidBenchmarkFixture)
        );
        assert_eq!(
            benchmark_scene_patch(10, 11),
            Err(EngineErrorV1::InvalidBenchmarkFixture)
        );
    }
}
