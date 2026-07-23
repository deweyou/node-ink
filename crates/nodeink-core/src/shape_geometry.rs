use crate::{
    ElementSizeV1, PathCurveV1, Vec2,
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

pub(crate) fn line_path_data_with_curve(points: &[Vec2], curve: Option<PathCurveV1>) -> String {
    match (points, curve) {
        ([start, end], Some(curve)) => {
            let control = curve.control();
            format!(
                "M {} {} Q {} {} {} {}",
                start.x, start.y, control.x, control.y, end.x, end.y
            )
        }
        _ => line_path_data(points),
    }
}

pub(crate) fn arrow_path_data(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    size: ElementSizeV1,
) -> String {
    let mut path = line_path_data_with_curve(points, curve);
    if let Some([left, tip, right]) = arrowhead_points(points, curve, size) {
        path.push_str(&format!(
            " M {} {} L {} {} L {} {}",
            left.x, left.y, tip.x, tip.y, right.x, right.y
        ));
    }
    path
}

pub(crate) fn resolved_arrow_path_data(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    size: ElementSizeV1,
    world_transform: Affine2D,
) -> String {
    let Some(points) = resolved_path_points(points, world_transform) else {
        return String::new();
    };
    let curve = resolved_curve(curve, world_transform);
    arrow_path_data(&points, curve, size)
}

pub(crate) fn resolved_arrow_visual_bounds(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    size: ElementSizeV1,
    world_transform: Affine2D,
) -> Option<VisualAabb> {
    let points = resolved_path_points(points, world_transform)?;
    let curve = resolved_curve(curve, world_transform);
    path_visual_bounds_with_curve(&points, curve, size.stroke_width(), Some(size))
}

pub(crate) fn path_visual_bounds(
    points: &[Vec2],
    stroke_width: f64,
    arrow_size: Option<ElementSizeV1>,
) -> Option<VisualAabb> {
    path_visual_bounds_with_curve(points, None, stroke_width, arrow_size)
}

pub(crate) fn path_visual_bounds_with_curve(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    stroke_width: f64,
    arrow_size: Option<ElementSizeV1>,
) -> Option<VisualAabb> {
    let mut painted_points = path_bounds_points(points, curve)?;
    if let Some(size) = arrow_size
        && let Some([left, tip, right]) = arrowhead_points(points, curve, size)
    {
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
    arrow_size: Option<ElementSizeV1>,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
) -> bool {
    hit_test_path_with_curve(
        points,
        None,
        stroke_width,
        arrow_size,
        world_transform,
        point,
        tolerance,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn hit_test_path_with_curve(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    stroke_width: f64,
    arrow_size: Option<ElementSizeV1>,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
) -> bool {
    let Some(resolved_points) = resolved_path_points(points, world_transform) else {
        return false;
    };
    let resolved_curve = resolved_curve(curve, world_transform);
    let radius = stroke_width / 2.0 + tolerance;
    let flattened = flattened_path_points(&resolved_points, resolved_curve, radius / 4.0);
    let mut segments = flattened
        .windows(2)
        .map(|segment| (segment[0], segment[1]))
        .collect::<Vec<_>>();
    if let Some(size) = arrow_size
        && let Some([left, tip, right]) = arrowhead_points(&resolved_points, resolved_curve, size)
    {
        segments.extend([(left, tip), (tip, right)]);
    }
    segments.into_iter().any(|(start, end)| {
        point_segment_distance_squared(Point2D::new(point.x, point.y), start, end)
            <= radius * radius
    })
}

pub(crate) fn hit_test_resolved_arrow(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    size: ElementSizeV1,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
) -> bool {
    hit_test_path_with_curve(
        points,
        curve,
        size.stroke_width(),
        Some(size),
        world_transform,
        point,
        tolerance,
    )
}

fn arrowhead_points(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    size: ElementSizeV1,
) -> Option<[Point2D; 3]> {
    let [.., previous, end] = points else {
        return None;
    };
    let direction_anchor = if points.len() == 2 {
        curve.map_or(*previous, PathCurveV1::control)
    } else {
        *previous
    };
    let mut delta_x = end.x - direction_anchor.x;
    let mut delta_y = end.y - direction_anchor.y;
    if delta_x.hypot(delta_y) <= f64::EPSILON {
        delta_x = end.x - points[0].x;
        delta_y = end.y - points[0].y;
    }
    let direction_length = delta_x.hypot(delta_y);
    if !direction_length.is_finite() || direction_length <= f64::EPSILON {
        return None;
    }
    let direction_x = delta_x / direction_length;
    let direction_y = delta_y / direction_length;
    let available_length = if points.len() == 2 {
        (end.x - points[0].x).hypot(end.y - points[0].y)
    } else {
        direction_length
    };
    if !available_length.is_finite() || available_length <= f64::EPSILON {
        return None;
    }
    let length = size.arrowhead_length().min(available_length * 0.45);
    let half_width = size.arrowhead_opening_width().min(length * 0.9) / 2.0;
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

pub(crate) fn curve_midpoint(points: &[Vec2], curve: Option<PathCurveV1>) -> Option<Vec2> {
    let [start, end] = points else {
        return None;
    };
    let chord_midpoint = Vec2 {
        x: (start.x + end.x) / 2.0,
        y: (start.y + end.y) / 2.0,
    };
    let Some(curve) = curve else {
        return Some(chord_midpoint);
    };
    let control = curve.control();
    Some(Vec2 {
        x: (start.x + 2.0 * control.x + end.x) / 4.0,
        y: (start.y + 2.0 * control.y + end.y) / 4.0,
    })
}

pub(crate) fn curve_from_midpoint(points: &[Vec2], midpoint: Vec2) -> Option<PathCurveV1> {
    let [start, end] = points else {
        return None;
    };
    let chord_midpoint = Vec2 {
        x: (start.x + end.x) / 2.0,
        y: (start.y + end.y) / 2.0,
    };
    let control = Vec2 {
        x: 2.0 * midpoint.x - chord_midpoint.x,
        y: 2.0 * midpoint.y - chord_midpoint.y,
    };
    if squared_distance(
        Point2D::new(control.x, control.y),
        Point2D::new(chord_midpoint.x, chord_midpoint.y),
    ) <= f64::EPSILON
    {
        None
    } else {
        Some(PathCurveV1::Quadratic { control })
    }
}

fn resolved_curve(curve: Option<PathCurveV1>, transform: Affine2D) -> Option<PathCurveV1> {
    let control = curve?.control();
    let resolved = transform.apply(Point2D::new(control.x, control.y)).ok()?;
    Some(PathCurveV1::Quadratic {
        control: Vec2 {
            x: resolved.x,
            y: resolved.y,
        },
    })
}

fn path_bounds_points(points: &[Vec2], curve: Option<PathCurveV1>) -> Option<Vec<Point2D>> {
    if let ([start, end], Some(curve)) = (points, curve) {
        let control = curve.control();
        let mut result = vec![Point2D::new(start.x, start.y), Point2D::new(end.x, end.y)];
        for (start_value, control_value, end_value) in
            [(start.x, control.x, end.x), (start.y, control.y, end.y)]
        {
            let denominator = start_value - 2.0 * control_value + end_value;
            if denominator.abs() <= f64::EPSILON {
                continue;
            }
            let ratio = (start_value - control_value) / denominator;
            if ratio > 0.0 && ratio < 1.0 {
                result.push(quadratic_point(*start, control, *end, ratio));
            }
        }
        return Some(result);
    }
    (!points.is_empty()).then(|| {
        points
            .iter()
            .map(|point| Point2D::new(point.x, point.y))
            .collect()
    })
}

fn flattened_path_points(
    points: &[Vec2],
    curve: Option<PathCurveV1>,
    flatness: f64,
) -> Vec<Point2D> {
    if let ([start, end], Some(curve)) = (points, curve) {
        let mut flattened = vec![Point2D::new(start.x, start.y)];
        flatten_quadratic(
            Point2D::new(start.x, start.y),
            Point2D::new(curve.control().x, curve.control().y),
            Point2D::new(end.x, end.y),
            flatness.max(0.05),
            0,
            &mut flattened,
        );
        return flattened;
    }
    points
        .iter()
        .map(|point| Point2D::new(point.x, point.y))
        .collect()
}

fn flatten_quadratic(
    start: Point2D,
    control: Point2D,
    end: Point2D,
    flatness: f64,
    depth: u8,
    output: &mut Vec<Point2D>,
) {
    let distance = point_segment_distance_squared(control, start, end).sqrt();
    if distance <= flatness || depth >= 12 {
        output.push(end);
        return;
    }
    let start_control = midpoint(start, control);
    let control_end = midpoint(control, end);
    let split = midpoint(start_control, control_end);
    flatten_quadratic(start, start_control, split, flatness, depth + 1, output);
    flatten_quadratic(split, control_end, end, flatness, depth + 1, output);
}

fn quadratic_point(start: Vec2, control: Vec2, end: Vec2, ratio: f64) -> Point2D {
    let inverse = 1.0 - ratio;
    Point2D::new(
        inverse * inverse * start.x + 2.0 * inverse * ratio * control.x + ratio * ratio * end.x,
        inverse * inverse * start.y + 2.0 * inverse * ratio * control.y + ratio * ratio * end.y,
    )
}

fn midpoint(first: Point2D, second: Point2D) -> Point2D {
    Point2D::new((first.x + second.x) / 2.0, (first.y + second.y) / 2.0)
}

fn resolved_path_points(points: &[Vec2], world_transform: Affine2D) -> Option<Vec<Vec2>> {
    points
        .iter()
        .map(|point| {
            world_transform
                .apply(Point2D::new(point.x, point.y))
                .ok()
                .map(|point| Vec2 {
                    x: point.x,
                    y: point.y,
                })
        })
        .collect()
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
            arrow_path_data(
                &[Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }],
                None,
                ElementSizeV1::S,
            ),
            "M 0 0 L 100 0 M 72 12.6 L 100 0 L 72 -12.6"
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
            Some(ElementSizeV1::S),
            Affine2D::IDENTITY,
            Vec2 { x: 90.0, y: 4.0 },
            2.0,
        ));
        let bounds =
            path_visual_bounds(&points, 2.0, Some(ElementSizeV1::S)).expect("arrow bounds resolve");
        assert!(bounds.min_y() < -5.0);
        assert!(bounds.max_y() > 5.0);
    }

    #[test]
    fn resolved_arrowhead_keeps_world_shape_under_non_uniform_transform() {
        let transform = Affine2D::scale(2.0, 3.0).expect("scale is valid");
        let horizontal = [Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }];
        let diagonal = [Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 100.0 }];

        for points in [&horizontal[..], &diagonal[..]] {
            let resolved = resolved_path_points(points, transform).expect("points resolve");
            let [left, tip, right] =
                arrowhead_points(&resolved, None, ElementSizeV1::S).expect("arrowhead resolves");
            let base = Point2D::new((left.x + right.x) / 2.0, (left.y + right.y) / 2.0);

            assert_close(distance(base, tip), 28.0);
            assert_close(distance(left, right), 25.2);
            assert_close(distance(left, tip), distance(right, tip));
        }

        assert_eq!(
            resolved_arrow_path_data(&horizontal, None, ElementSizeV1::S, transform),
            "M 0 0 L 200 0 M 172 12.6 L 200 0 L 172 -12.6"
        );
        let bounds = resolved_arrow_visual_bounds(&horizontal, None, ElementSizeV1::S, transform)
            .expect("resolved arrow bounds");
        assert_close(bounds.min_y(), -13.6);
        assert_close(bounds.max_y(), 13.6);
        assert!(hit_test_resolved_arrow(
            &horizontal,
            None,
            ElementSizeV1::S,
            transform,
            Vec2 { x: 186.0, y: 6.3 },
            0.25,
        ));
        assert!(!hit_test_resolved_arrow(
            &horizontal,
            None,
            ElementSizeV1::S,
            transform,
            Vec2 { x: 160.0, y: 20.0 },
            0.25,
        ));
    }

    #[test]
    fn quadratic_curves_share_path_midpoint_bounds_hit_testing_and_arrow_tangent() {
        let points = [Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 0.0 }];
        let curve = Some(PathCurveV1::Quadratic {
            control: Vec2 { x: 50.0, y: 100.0 },
        });

        assert_eq!(
            line_path_data_with_curve(&points, curve),
            "M 0 0 Q 50 100 100 0"
        );
        assert_eq!(
            curve_midpoint(&points, curve),
            Some(Vec2 { x: 50.0, y: 50.0 })
        );
        assert_eq!(
            curve_from_midpoint(&points, Vec2 { x: 50.0, y: 50.0 }),
            curve
        );
        let bounds =
            path_visual_bounds_with_curve(&points, curve, 4.0, None).expect("curve bounds resolve");
        assert_close(bounds.min_y(), -2.0);
        assert_close(bounds.max_y(), 52.0);
        assert!(hit_test_path_with_curve(
            &points,
            curve,
            4.0,
            None,
            Affine2D::IDENTITY,
            Vec2 { x: 50.0, y: 50.0 },
            1.0,
        ));
        assert!(!hit_test_path_with_curve(
            &points,
            curve,
            4.0,
            None,
            Affine2D::IDENTITY,
            Vec2 { x: 50.0, y: 20.0 },
            1.0,
        ));

        let [left, tip, right] =
            arrowhead_points(&points, curve, ElementSizeV1::S).expect("arrowhead resolves");
        let base = Point2D::new((left.x + right.x) / 2.0, (left.y + right.y) / 2.0);
        assert_eq!(tip, Point2D::new(100.0, 0.0));
        assert!(base.y > 20.0);
        assert_close(distance(base, tip), 28.0);
        assert_close(distance(left, tip), distance(right, tip));

        let near_endpoint_curve = Some(PathCurveV1::Quadratic {
            control: Vec2 { x: 99.0, y: 1.0 },
        });
        let [left, tip, right] = arrowhead_points(&points, near_endpoint_curve, ElementSizeV1::S)
            .expect("curved arrowhead resolves near its endpoint");
        let base = Point2D::new((left.x + right.x) / 2.0, (left.y + right.y) / 2.0);
        assert_close(distance(base, tip), 28.0);
        assert_close(distance(left, right), 25.2);
    }

    fn distance(first: Point2D, second: Point2D) -> f64 {
        (first.x - second.x).hypot(first.y - second.y)
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }
}
