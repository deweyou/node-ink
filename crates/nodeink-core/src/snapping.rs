use std::cmp::Ordering;

#[cfg(test)]
use crate::selection_geometry::SelectionGeometryError;
use crate::{selection_geometry::VisualAabb, transform::Point2D};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SnapTarget {
    pub(crate) element_id: String,
    /// Larger values are painted later and therefore win equal-correction ties.
    pub(crate) draw_order: usize,
    pub(crate) bounds: VisualAabb,
    pub(crate) is_selected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum SnapAnchor {
    Min,
    Center,
    Max,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SnapMatch {
    pub(crate) target_element_id: String,
    pub(crate) target_draw_order: usize,
    pub(crate) source_anchor: SnapAnchor,
    pub(crate) target_anchor: SnapAnchor,
    pub(crate) guide_position: f64,
    pub(crate) correction: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SnapOutcome {
    pub(crate) correction: Point2D,
    pub(crate) x_match: Option<SnapMatch>,
    pub(crate) y_match: Option<SnapMatch>,
    pub(crate) threshold_world: f64,
}

#[cfg(test)]
impl SnapOutcome {
    pub(crate) fn corrected_bounds(
        &self,
        moving_bounds: VisualAabb,
    ) -> Result<VisualAabb, SelectionGeometryError> {
        moving_bounds.translated(self.correction)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapError {
    CameraZoom,
    ScreenThreshold,
    Bounds,
}

/// Resolves horizontal and vertical snap corrections independently.
///
/// Modifier-key suppression intentionally stays above this pure geometry layer:
/// callers do not invoke snapping while Cmd/Ctrl is held.
pub(crate) fn snap_bounds(
    moving_bounds: VisualAabb,
    targets: &[SnapTarget],
    camera_zoom: f64,
    screen_threshold: f64,
) -> Result<SnapOutcome, SnapError> {
    moving_bounds
        .validate(false)
        .map_err(|_| SnapError::Bounds)?;
    if !camera_zoom.is_finite() || camera_zoom <= 0.0 {
        return Err(SnapError::CameraZoom);
    }
    if !screen_threshold.is_finite() || screen_threshold < 0.0 {
        return Err(SnapError::ScreenThreshold);
    }
    let threshold_world = screen_threshold / camera_zoom;
    if !threshold_world.is_finite() {
        return Err(SnapError::ScreenThreshold);
    }
    for target in targets {
        target
            .bounds
            .validate(false)
            .map_err(|_| SnapError::Bounds)?;
    }

    let x_match = best_match(
        axis_anchors(
            moving_bounds.min_x(),
            moving_bounds.center_x(),
            moving_bounds.max_x(),
        ),
        targets,
        threshold_world,
        |bounds| axis_anchors(bounds.min_x(), bounds.center_x(), bounds.max_x()),
    );
    let y_match = best_match(
        axis_anchors(
            moving_bounds.min_y(),
            moving_bounds.center_y(),
            moving_bounds.max_y(),
        ),
        targets,
        threshold_world,
        |bounds| axis_anchors(bounds.min_y(), bounds.center_y(), bounds.max_y()),
    );
    Ok(SnapOutcome {
        correction: Point2D::new(
            x_match.as_ref().map_or(0.0, |matched| matched.correction),
            y_match.as_ref().map_or(0.0, |matched| matched.correction),
        ),
        x_match,
        y_match,
        threshold_world,
    })
}

fn best_match(
    source_anchors: [(SnapAnchor, f64); 3],
    targets: &[SnapTarget],
    threshold_world: f64,
    target_anchors: impl Fn(VisualAabb) -> [(SnapAnchor, f64); 3],
) -> Option<SnapMatch> {
    let mut best: Option<SnapMatch> = None;
    for target in targets.iter().filter(|target| !target.is_selected) {
        for (source_anchor, source_position) in source_anchors {
            for (target_anchor, target_position) in target_anchors(target.bounds) {
                let correction = normalize_zero(target_position - source_position);
                if correction.abs() > threshold_world {
                    continue;
                }
                let candidate = SnapMatch {
                    target_element_id: target.element_id.clone(),
                    target_draw_order: target.draw_order,
                    source_anchor,
                    target_anchor,
                    guide_position: target_position,
                    correction,
                };
                if best
                    .as_ref()
                    .is_none_or(|current| compare_matches(&candidate, current).is_lt())
                {
                    best = Some(candidate);
                }
            }
        }
    }
    best
}

fn compare_matches(left: &SnapMatch, right: &SnapMatch) -> Ordering {
    left.correction
        .abs()
        .total_cmp(&right.correction.abs())
        .then_with(|| right.target_draw_order.cmp(&left.target_draw_order))
        .then_with(|| left.target_element_id.cmp(&right.target_element_id))
        .then_with(|| left.source_anchor.cmp(&right.source_anchor))
        .then_with(|| left.target_anchor.cmp(&right.target_anchor))
}

fn axis_anchors(min: f64, center: f64, max: f64) -> [(SnapAnchor, f64); 3] {
    [
        (SnapAnchor::Min, min),
        (SnapAnchor::Center, center),
        (SnapAnchor::Max, max),
    ]
}

fn normalize_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snaps_edges_and_centers_on_each_axis() {
        let moving = bounds(10.0, 10.0, 10.0, 10.0);
        let targets = [target("target", 1, bounds(22.0, 5.0, 10.0, 10.0))];

        let outcome = snap_bounds(moving, &targets, 1.0, 6.0).expect("snap input is valid");

        assert_eq!(outcome.correction, Point2D::new(2.0, 0.0));
        assert_eq!(
            outcome
                .x_match
                .as_ref()
                .map(|matched| matched.source_anchor),
            Some(SnapAnchor::Max)
        );
        assert_eq!(
            outcome
                .x_match
                .as_ref()
                .map(|matched| matched.target_anchor),
            Some(SnapAnchor::Min)
        );
        assert_eq!(
            outcome
                .y_match
                .as_ref()
                .map(|matched| matched.source_anchor),
            Some(SnapAnchor::Min)
        );
        assert_eq!(
            outcome
                .y_match
                .as_ref()
                .map(|matched| matched.target_anchor),
            Some(SnapAnchor::Center)
        );
        assert_eq!(
            outcome
                .corrected_bounds(moving)
                .expect("correction is finite"),
            bounds(12.0, 10.0, 10.0, 10.0)
        );
    }

    #[test]
    fn converts_screen_threshold_to_world_space() {
        let moving = bounds(10.0, 10.0, 10.0, 10.0);
        let targets = [target("target", 1, bounds(24.0, 100.0, 10.0, 10.0))];

        let zoomed_in = snap_bounds(moving, &targets, 2.0, 6.0).expect("snap input is valid");
        let one_to_one = snap_bounds(moving, &targets, 1.0, 6.0).expect("snap input is valid");

        assert_eq!(zoomed_in.threshold_world, 3.0);
        assert_eq!(zoomed_in.x_match, None);
        assert_eq!(one_to_one.threshold_world, 6.0);
        assert_eq!(one_to_one.correction.x, 4.0);
    }

    #[test]
    fn excludes_selected_elements() {
        let moving = bounds(10.0, 10.0, 10.0, 10.0);
        let mut selected = target("selected", 10, bounds(21.0, 100.0, 10.0, 10.0));
        selected.is_selected = true;
        let targets = [
            selected,
            target("available", 1, bounds(23.0, 100.0, 10.0, 10.0)),
        ];

        let outcome = snap_bounds(moving, &targets, 1.0, 6.0).expect("snap input is valid");

        assert_eq!(outcome.correction.x, 3.0);
        assert_eq!(
            outcome
                .x_match
                .as_ref()
                .map(|matched| matched.target_element_id.as_str()),
            Some("available")
        );
    }

    #[test]
    fn tie_breaks_by_correction_then_topmost_draw_order_then_stable_id() {
        let moving = bounds(10.0, 100.0, 10.0, 10.0);
        let nearest = target("nearest", 0, bounds(21.0, 200.0, 10.0, 10.0));
        let farther_topmost = target("farther", 99, bounds(24.0, 200.0, 10.0, 10.0));
        let nearest_outcome = snap_bounds(moving, &[farther_topmost, nearest], 1.0, 6.0)
            .expect("snap input is valid");
        assert_eq!(
            nearest_outcome
                .x_match
                .as_ref()
                .map(|matched| matched.target_element_id.as_str()),
            Some("nearest")
        );

        let left = target("left", 1, bounds(-2.0, 200.0, 10.0, 10.0));
        let right_topmost = target("right", 2, bounds(22.0, 200.0, 10.0, 10.0));
        let draw_order_outcome =
            snap_bounds(moving, &[left, right_topmost], 1.0, 6.0).expect("snap input is valid");
        assert_eq!(draw_order_outcome.correction.x, 2.0);
        assert_eq!(
            draw_order_outcome
                .x_match
                .as_ref()
                .map(|matched| matched.target_element_id.as_str()),
            Some("right")
        );

        let right_z = target("z-target", 2, bounds(22.0, 200.0, 10.0, 10.0));
        let right_a = target("a-target", 2, bounds(22.0, 200.0, 10.0, 10.0));
        let stable_id_outcome =
            snap_bounds(moving, &[right_z, right_a], 1.0, 6.0).expect("snap input is valid");
        assert_eq!(
            stable_id_outcome
                .x_match
                .as_ref()
                .map(|matched| matched.target_element_id.as_str()),
            Some("a-target")
        );
    }

    #[test]
    fn validates_zoom_threshold_and_all_bounds() {
        let moving = bounds(0.0, 0.0, 1.0, 1.0);
        assert_eq!(
            snap_bounds(moving, &[], 0.0, 6.0),
            Err(SnapError::CameraZoom)
        );
        assert_eq!(
            snap_bounds(moving, &[], 1.0, -1.0),
            Err(SnapError::ScreenThreshold)
        );
        let invalid_target = SnapTarget {
            element_id: "invalid".to_string(),
            draw_order: 0,
            bounds: VisualAabb {
                x: 0.0,
                y: 0.0,
                width: f64::NAN,
                height: 1.0,
            },
            is_selected: false,
        };
        assert_eq!(
            snap_bounds(moving, &[invalid_target], 1.0, 6.0),
            Err(SnapError::Bounds)
        );
    }

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> VisualAabb {
        VisualAabb::new(x, y, width, height).expect("test bounds are valid")
    }

    fn target(element_id: &str, draw_order: usize, bounds: VisualAabb) -> SnapTarget {
        SnapTarget {
            element_id: element_id.to_string(),
            draw_order,
            bounds,
            is_selected: false,
        }
    }
}
