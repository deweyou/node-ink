use crate::{
    Vec2,
    selection_geometry::VisualAabb,
    transform::{Affine2D, Point2D},
};

const MIN_FLATTENING_ERROR: f64 = 0.125;
const MAX_FLATTENING_ERROR: f64 = 1.0;
const MAX_FLATTENING_DEPTH: u8 = 12;

#[derive(Debug, Clone, Copy, PartialEq)]
enum StrokeSegment {
    Line {
        start: Vec2,
        end: Vec2,
    },
    Quadratic {
        start: Vec2,
        control: Vec2,
        end: Vec2,
    },
}

pub(crate) fn resolved_stroke_path_data(points: &[Vec2]) -> String {
    let Some((start, segments)) = resolved_segments(points) else {
        return String::new();
    };
    let mut path = format!("M {} {}", start.x, start.y);
    for segment in segments {
        match segment {
            StrokeSegment::Line { end, .. } => {
                path.push_str(&format!(" L {} {}", end.x, end.y));
            }
            StrokeSegment::Quadratic { control, end, .. } => {
                path.push_str(&format!(
                    " Q {} {} {} {}",
                    control.x, control.y, end.x, end.y
                ));
            }
        }
    }
    path
}

pub(crate) fn stroke_visual_bounds(points: &[Vec2], stroke_width: f64) -> Option<VisualAabb> {
    let (start, segments) = resolved_segments(points)?;
    let mut bounds = CurveBounds::from_point(start);
    for segment in segments {
        match segment {
            StrokeSegment::Line { end, .. } => bounds.include(end),
            StrokeSegment::Quadratic {
                start,
                control,
                end,
            } => {
                bounds.include(end);
                if let Some(t) = quadratic_extremum(start.x, control.x, end.x) {
                    bounds.include(quadratic_point(start, control, end, t));
                }
                if let Some(t) = quadratic_extremum(start.y, control.y, end.y) {
                    bounds.include(quadratic_point(start, control, end, t));
                }
            }
        }
    }
    let half_width = stroke_width / 2.0;
    VisualAabb::new(
        bounds.min_x - half_width,
        bounds.min_y - half_width,
        bounds.max_x - bounds.min_x + stroke_width,
        bounds.max_y - bounds.min_y + stroke_width,
    )
    .ok()
}

pub(crate) fn flattened_world_points(
    points: &[Vec2],
    world_transform: Affine2D,
    tolerance: f64,
) -> Option<Vec<Point2D>> {
    let (start, segments) = resolved_segments(points)?;
    let start = transform_point(world_transform, start)?;
    let mut flattened = vec![start];
    let max_error = (tolerance / 4.0).clamp(MIN_FLATTENING_ERROR, MAX_FLATTENING_ERROR);
    for segment in segments {
        match segment {
            StrokeSegment::Line { end, .. } => {
                flattened.push(transform_point(world_transform, end)?);
            }
            StrokeSegment::Quadratic {
                start,
                control,
                end,
            } => {
                append_flattened_quadratic(
                    transform_point(world_transform, start)?,
                    transform_point(world_transform, control)?,
                    transform_point(world_transform, end)?,
                    max_error * max_error,
                    0,
                    &mut flattened,
                );
            }
        }
    }
    Some(flattened)
}

fn resolved_segments(points: &[Vec2]) -> Option<(Vec2, Vec<StrokeSegment>)> {
    let start = *points.first()?;
    if points.len() == 1 {
        return Some((start, vec![StrokeSegment::Line { start, end: start }]));
    }
    if points.len() == 2 {
        return Some((
            start,
            vec![StrokeSegment::Line {
                start,
                end: points[1],
            }],
        ));
    }

    let mut segments = Vec::with_capacity(points.len());
    let mut segment_start = start;
    for pair in points.windows(2) {
        let control = pair[0];
        let end = midpoint(pair[0], pair[1]);
        segments.push(StrokeSegment::Quadratic {
            start: segment_start,
            control,
            end,
        });
        segment_start = end;
    }
    let end = *points
        .last()
        .expect("a multi-point stroke has a last point");
    segments.push(StrokeSegment::Quadratic {
        start: segment_start,
        control: end,
        end,
    });
    Some((start, segments))
}

fn quadratic_extremum(start: f64, control: f64, end: f64) -> Option<f64> {
    let denominator = start - 2.0 * control + end;
    if denominator.abs() <= f64::EPSILON {
        return None;
    }
    let t = (start - control) / denominator;
    (0.0 < t && t < 1.0).then_some(t)
}

fn quadratic_point(start: Vec2, control: Vec2, end: Vec2, t: f64) -> Vec2 {
    let inverse = 1.0 - t;
    Vec2 {
        x: inverse * inverse * start.x + 2.0 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * start.y + 2.0 * inverse * t * control.y + t * t * end.y,
    }
}

fn append_flattened_quadratic(
    start: Point2D,
    control: Point2D,
    end: Point2D,
    max_error_squared: f64,
    depth: u8,
    flattened: &mut Vec<Point2D>,
) {
    if depth >= MAX_FLATTENING_DEPTH
        || point_segment_distance_squared(control, start, end) <= max_error_squared
    {
        flattened.push(end);
        return;
    }
    let start_control = midpoint_point(start, control);
    let control_end = midpoint_point(control, end);
    let curve_midpoint = midpoint_point(start_control, control_end);
    append_flattened_quadratic(
        start,
        start_control,
        curve_midpoint,
        max_error_squared,
        depth + 1,
        flattened,
    );
    append_flattened_quadratic(
        curve_midpoint,
        control_end,
        end,
        max_error_squared,
        depth + 1,
        flattened,
    );
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
    (first.x - second.x).powi(2) + (first.y - second.y).powi(2)
}

fn midpoint(first: Vec2, second: Vec2) -> Vec2 {
    Vec2 {
        x: first.x + (second.x - first.x) / 2.0,
        y: first.y + (second.y - first.y) / 2.0,
    }
}

fn midpoint_point(first: Point2D, second: Point2D) -> Point2D {
    Point2D::new(
        first.x + (second.x - first.x) / 2.0,
        first.y + (second.y - first.y) / 2.0,
    )
}

fn transform_point(transform: Affine2D, point: Vec2) -> Option<Point2D> {
    transform.apply(Point2D::new(point.x, point.y)).ok()
}

struct CurveBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl CurveBounds {
    fn from_point(point: Vec2) -> Self {
        Self {
            min_x: point.x,
            min_y: point.y,
            max_x: point.x,
            max_y: point.y,
        }
    }

    fn include(&mut self, point: Vec2) {
        self.min_x = self.min_x.min(point.x);
        self.min_y = self.min_y.min(point.y);
        self.max_x = self.max_x.max(point.x);
        self.max_y = self.max_y.max(point.y);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    #[test]
    fn path_data_keeps_dots_and_straight_lines_exact_but_smooths_multi_point_strokes() {
        assert_eq!(resolved_stroke_path_data(&[]), "");
        assert_eq!(
            resolved_stroke_path_data(&[Vec2 { x: 1.0, y: 2.0 }]),
            "M 1 2 L 1 2"
        );
        assert_eq!(
            resolved_stroke_path_data(&[Vec2 { x: 1.0, y: 2.0 }, Vec2 { x: 5.0, y: 8.0 }]),
            "M 1 2 L 5 8"
        );
        assert_eq!(
            resolved_stroke_path_data(&[
                Vec2 { x: 0.0, y: 0.0 },
                Vec2 { x: 10.0, y: 20.0 },
                Vec2 { x: 20.0, y: 0.0 },
            ]),
            "M 0 0 Q 0 0 5 10 Q 10 20 15 10 Q 20 0 20 0"
        );
    }

    #[test]
    fn visual_bounds_use_quadratic_extrema_and_paint_expansion() {
        assert_eq!(stroke_visual_bounds(&[], 2.0), None);
        let bounds = stroke_visual_bounds(
            &[
                Vec2 { x: 0.0, y: 0.0 },
                Vec2 { x: 10.0, y: 20.0 },
                Vec2 { x: 20.0, y: 0.0 },
            ],
            2.0,
        )
        .expect("smooth stroke has finite bounds");

        assert_close(bounds.x, -1.0);
        assert_close(bounds.y, -1.0);
        assert_close(bounds.width, 22.0);
        assert_close(bounds.height, 17.0);

        let straight =
            stroke_visual_bounds(&[Vec2 { x: -2.0, y: 3.0 }, Vec2 { x: 8.0, y: 3.0 }], 4.0)
                .expect("straight stroke has finite bounds");
        assert_eq!(
            straight,
            VisualAabb {
                x: -4.0,
                y: 1.0,
                width: 14.0,
                height: 4.0,
            }
        );
    }

    #[test]
    fn flattening_tracks_the_transformed_curve_with_bounded_error() {
        let points = [
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: 10.0, y: 20.0 },
            Vec2 { x: 20.0, y: 0.0 },
        ];
        let transform =
            Affine2D::translation(Point2D::new(5.0, -2.0)).expect("translation is valid");
        let flattened =
            flattened_world_points(&points, transform, 0.01).expect("valid curve can be flattened");

        assert_eq!(flattened.first(), Some(&Point2D::new(5.0, -2.0)));
        assert_eq!(flattened.last(), Some(&Point2D::new(25.0, -2.0)));
        let max_y = flattened
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max);
        assert_close(max_y, 13.0);
        assert!(flattened.len() > points.len());
    }

    #[test]
    fn flattening_rejects_invalid_inputs_and_terminates_degenerate_curves() {
        assert_eq!(flattened_world_points(&[], Affine2D::identity(), 1.0), None);
        let invalid_transform = Affine2D {
            a: f64::NAN,
            ..Affine2D::identity()
        };
        assert_eq!(
            flattened_world_points(
                &[Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 1.0, y: 1.0 }],
                invalid_transform,
                1.0,
            ),
            None
        );

        let mut flattened = vec![Point2D::new(0.0, 0.0)];
        append_flattened_quadratic(
            Point2D::new(0.0, 0.0),
            Point2D::new(0.0, 0.0),
            Point2D::new(0.0, 0.0),
            0.0,
            0,
            &mut flattened,
        );
        append_flattened_quadratic(
            Point2D::new(0.0, 0.0),
            Point2D::new(100.0, 100.0),
            Point2D::new(200.0, 0.0),
            0.0,
            MAX_FLATTENING_DEPTH,
            &mut flattened,
        );
        assert_eq!(flattened.last(), Some(&Point2D::new(200.0, 0.0)));
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= EPSILON,
            "expected {expected}, got {actual}"
        );
    }
}
