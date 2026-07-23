use crate::{
    Vec2,
    selection_geometry::VisualAabb,
    transform::{Affine2D, Point2D},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BoxShapeKind {
    Ellipse,
    Diamond,
}

pub(crate) fn boxed_shape_path_data(
    kind: BoxShapeKind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> String {
    match kind {
        BoxShapeKind::Ellipse => {
            let radius_x = width / 2.0;
            let radius_y = height / 2.0;
            let center_x = x + radius_x;
            let center_y = y + radius_y;
            format!(
                "M {} {} A {} {} 0 1 0 {} {} A {} {} 0 1 0 {} {} Z",
                center_x + radius_x,
                center_y,
                radius_x,
                radius_y,
                center_x - radius_x,
                center_y,
                radius_x,
                radius_y,
                center_x + radius_x,
                center_y
            )
        }
        BoxShapeKind::Diamond => format!(
            "M {} {} L {} {} L {} {} L {} {} Z",
            x + width / 2.0,
            y,
            x + width,
            y + height / 2.0,
            x + width / 2.0,
            y + height,
            x,
            y + height / 2.0
        ),
    }
}

pub(crate) fn line_path_data(points: &[Vec2]) -> String {
    let Some(first) = points.first() else {
        return String::new();
    };
    let mut path = format!("M {} {}", first.x, first.y);
    for point in &points[1..] {
        path.push_str(&format!(" L {} {}", point.x, point.y));
    }
    path
}

pub(crate) fn arrow_path_data(points: &[Vec2], stroke_width: f64) -> String {
    let mut path = line_path_data(points);
    if let Some([left, tip, right]) = arrowhead_points(points, stroke_width) {
        path.push_str(&format!(
            " M {} {} L {} {} L {} {}",
            left.x, left.y, tip.x, tip.y, right.x, right.y
        ));
    }
    path
}

pub(crate) fn path_visual_bounds(
    points: &[Vec2],
    stroke_width: f64,
    include_arrowhead: bool,
) -> Option<VisualAabb> {
    let mut painted_points = points
        .iter()
        .map(|point| Point2D::new(point.x, point.y))
        .collect::<Vec<_>>();
    if include_arrowhead && let Some([left, tip, right]) = arrowhead_points(points, stroke_width) {
        painted_points.extend([left, tip, right]);
    }
    bounds_for_points(&painted_points, stroke_width / 2.0)
}

pub(crate) fn hit_test_box_shape(
    kind: BoxShapeKind,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    world_transform: Affine2D,
    point: Vec2,
) -> bool {
    let Ok(inverse) = world_transform.inverse() else {
        return false;
    };
    let Ok(local) = inverse.apply(Point2D::new(point.x, point.y)) else {
        return false;
    };
    let center_x = x + width / 2.0;
    let center_y = y + height / 2.0;
    let normalized_x = (local.x - center_x) / (width / 2.0);
    let normalized_y = (local.y - center_y) / (height / 2.0);
    match kind {
        BoxShapeKind::Ellipse => normalized_x * normalized_x + normalized_y * normalized_y <= 1.0,
        BoxShapeKind::Diamond => normalized_x.abs() + normalized_y.abs() <= 1.0,
    }
}

pub(crate) fn hit_test_path(
    points: &[Vec2],
    stroke_width: f64,
    include_arrowhead: bool,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
) -> bool {
    let mut segments = points
        .windows(2)
        .map(|segment| {
            (
                Point2D::new(segment[0].x, segment[0].y),
                Point2D::new(segment[1].x, segment[1].y),
            )
        })
        .collect::<Vec<_>>();
    if include_arrowhead && let Some([left, tip, right]) = arrowhead_points(points, stroke_width) {
        segments.extend([(left, tip), (tip, right)]);
    }
    let radius = stroke_width / 2.0 + tolerance;
    segments.into_iter().any(|(start, end)| {
        let Ok(world_start) = world_transform.apply(start) else {
            return false;
        };
        let Ok(world_end) = world_transform.apply(end) else {
            return false;
        };
        point_segment_distance_squared(Point2D::new(point.x, point.y), world_start, world_end)
            <= radius * radius
    })
}

fn arrowhead_points(points: &[Vec2], stroke_width: f64) -> Option<[Point2D; 3]> {
    let [.., previous, end] = points else {
        return None;
    };
    let delta_x = end.x - previous.x;
    let delta_y = end.y - previous.y;
    let segment_length = delta_x.hypot(delta_y);
    if !segment_length.is_finite() || segment_length <= f64::EPSILON {
        return None;
    }
    let direction_x = delta_x / segment_length;
    let direction_y = delta_y / segment_length;
    let length = (stroke_width * 4.0).max(12.0).min(segment_length * 0.45);
    let half_width = length * 0.45;
    let base_x = end.x - direction_x * length;
    let base_y = end.y - direction_y * length;
    let perpendicular_x = -direction_y;
    let perpendicular_y = direction_x;
    Some([
        Point2D::new(
            base_x + perpendicular_x * half_width,
            base_y + perpendicular_y * half_width,
        ),
        Point2D::new(end.x, end.y),
        Point2D::new(
            base_x - perpendicular_x * half_width,
            base_y - perpendicular_y * half_width,
        ),
    ])
}

fn bounds_for_points(points: &[Point2D], padding: f64) -> Option<VisualAabb> {
    if points.is_empty() || !padding.is_finite() || padding < 0.0 {
        return None;
    }
    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f64::NEG_INFINITY, f64::max);
    VisualAabb::new(
        min_x - padding,
        min_y - padding,
        max_x - min_x + padding * 2.0,
        max_y - min_y + padding * 2.0,
    )
    .ok()
}

fn point_segment_distance_squared(point: Point2D, start: Point2D, end: Point2D) -> f64 {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= f64::EPSILON {
        return squared_distance(point, start);
    }
    let projection =
        ((point.x - start.x) * segment_x + (point.y - start.y) * segment_y) / length_squared;
    let ratio = projection.clamp(0.0, 1.0);
    squared_distance(
        point,
        Point2D::new(start.x + segment_x * ratio, start.y + segment_y * ratio),
    )
}

fn squared_distance(first: Point2D, second: Point2D) -> f64 {
    let delta_x = first.x - second.x;
    let delta_y = first.y - second.y;
    delta_x * delta_x + delta_y * delta_y
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_deterministic_closed_and_open_paths() {
        assert_eq!(
            boxed_shape_path_data(BoxShapeKind::Diamond, 10.0, 20.0, 40.0, 60.0),
            "M 30 20 L 50 50 L 30 80 L 10 50 Z"
        );
        assert_eq!(
            line_path_data(&[Vec2 { x: 1.0, y: 2.0 }, Vec2 { x: 3.0, y: 4.0 }]),
            "M 1 2 L 3 4"
        );
        assert_eq!(
            arrow_path_data(&[Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }], 2.0),
            "M 0 0 L 100 0 M 88 5.4 L 100 0 L 88 -5.4"
        );
    }

    #[test]
    fn hit_tests_semantic_geometry_and_includes_arrowheads_in_bounds() {
        assert!(hit_test_box_shape(
            BoxShapeKind::Ellipse,
            0.0,
            0.0,
            100.0,
            60.0,
            Affine2D::IDENTITY,
            Vec2 { x: 50.0, y: 30.0 },
        ));
        assert!(!hit_test_box_shape(
            BoxShapeKind::Diamond,
            0.0,
            0.0,
            100.0,
            60.0,
            Affine2D::IDENTITY,
            Vec2 { x: 5.0, y: 5.0 },
        ));
        let points = [Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }];
        assert!(hit_test_path(
            &points,
            2.0,
            true,
            Affine2D::IDENTITY,
            Vec2 { x: 90.0, y: 4.0 },
            2.0,
        ));
        let bounds = path_visual_bounds(&points, 2.0, true).expect("arrow bounds resolve");
        assert!(bounds.min_y() < -5.0);
        assert!(bounds.max_y() > 5.0);
    }
}
