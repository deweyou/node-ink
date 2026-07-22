use crate::transform::{Affine2D, Affine2DError, Point2D};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct VisualAabb {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

impl VisualAabb {
    pub(crate) fn new(
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<Self, SelectionGeometryError> {
        let bounds = Self {
            x,
            y,
            width,
            height,
        };
        bounds.validate(false)?;
        Ok(bounds)
    }

    pub(crate) fn min_x(self) -> f64 {
        self.x
    }

    pub(crate) fn center_x(self) -> f64 {
        self.x + self.width / 2.0
    }

    pub(crate) fn max_x(self) -> f64 {
        self.x + self.width
    }

    pub(crate) fn min_y(self) -> f64 {
        self.y
    }

    pub(crate) fn center_y(self) -> f64 {
        self.y + self.height / 2.0
    }

    pub(crate) fn max_y(self) -> f64 {
        self.y + self.height
    }

    #[cfg(test)]
    pub(crate) fn translated(self, correction: Point2D) -> Result<Self, SelectionGeometryError> {
        Self::new(
            self.x + correction.x,
            self.y + correction.y,
            self.width,
            self.height,
        )
    }

    pub(crate) fn validate(
        self,
        require_positive_size: bool,
    ) -> Result<(), SelectionGeometryError> {
        if ![self.x, self.y, self.width, self.height]
            .into_iter()
            .all(f64::is_finite)
            || self.width < 0.0
            || self.height < 0.0
            || (require_positive_size && (self.width == 0.0 || self.height == 0.0))
            || !self.max_x().is_finite()
            || !self.max_y().is_finite()
        {
            return Err(SelectionGeometryError::InvalidBounds);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct OrientedCorners {
    pub(crate) top_left: Point2D,
    pub(crate) top_right: Point2D,
    pub(crate) bottom_right: Point2D,
    pub(crate) bottom_left: Point2D,
}

impl OrientedCorners {
    pub(crate) fn from_local_visual_bounds(
        local_visual_bounds: VisualAabb,
        world_transform: Affine2D,
    ) -> Result<Self, SelectionGeometryError> {
        local_visual_bounds.validate(true)?;
        Ok(Self {
            top_left: world_transform.apply(Point2D::new(
                local_visual_bounds.min_x(),
                local_visual_bounds.min_y(),
            ))?,
            top_right: world_transform.apply(Point2D::new(
                local_visual_bounds.max_x(),
                local_visual_bounds.min_y(),
            ))?,
            bottom_right: world_transform.apply(Point2D::new(
                local_visual_bounds.max_x(),
                local_visual_bounds.max_y(),
            ))?,
            bottom_left: world_transform.apply(Point2D::new(
                local_visual_bounds.min_x(),
                local_visual_bounds.max_y(),
            ))?,
        })
    }

    pub(crate) fn visual_aabb(self) -> Result<VisualAabb, SelectionGeometryError> {
        let points = [
            self.top_left,
            self.top_right,
            self.bottom_right,
            self.bottom_left,
        ];
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
        VisualAabb::new(min_x, min_y, max_x - min_x, max_y - min_y)
    }

    pub(crate) fn handles(
        self,
        rotate_handle_offset_world: f64,
    ) -> Result<[SelectionHandle; 9], SelectionGeometryError> {
        if !rotate_handle_offset_world.is_finite() || rotate_handle_offset_world < 0.0 {
            return Err(SelectionGeometryError::InvalidRotateHandleOffset);
        }
        let top = midpoint(self.top_left, self.top_right);
        let right = midpoint(self.top_right, self.bottom_right);
        let bottom = midpoint(self.bottom_right, self.bottom_left);
        let left = midpoint(self.bottom_left, self.top_left);
        let center = midpoint(self.top_left, self.bottom_right);
        let top_edge = Point2D::new(
            self.top_right.x - self.top_left.x,
            self.top_right.y - self.top_left.y,
        );
        let edge_length = top_edge.x.hypot(top_edge.y);
        if !edge_length.is_finite() || edge_length == 0.0 {
            return Err(SelectionGeometryError::DegenerateTopEdge);
        }
        let mut outward = Point2D::new(top_edge.y / edge_length, -top_edge.x / edge_length);
        let toward_top = Point2D::new(top.x - center.x, top.y - center.y);
        if outward.x * toward_top.x + outward.y * toward_top.y < 0.0 {
            outward.x = -outward.x;
            outward.y = -outward.y;
        }
        let rotate = Point2D::new(
            top.x + outward.x * rotate_handle_offset_world,
            top.y + outward.y * rotate_handle_offset_world,
        );
        if !rotate.x.is_finite() || !rotate.y.is_finite() {
            return Err(SelectionGeometryError::InvalidRotateHandleOffset);
        }
        Ok([
            SelectionHandle::new(SelectionHandleKind::TopLeft, self.top_left),
            SelectionHandle::new(SelectionHandleKind::Top, top),
            SelectionHandle::new(SelectionHandleKind::TopRight, self.top_right),
            SelectionHandle::new(SelectionHandleKind::Right, right),
            SelectionHandle::new(SelectionHandleKind::BottomRight, self.bottom_right),
            SelectionHandle::new(SelectionHandleKind::Bottom, bottom),
            SelectionHandle::new(SelectionHandleKind::BottomLeft, self.bottom_left),
            SelectionHandle::new(SelectionHandleKind::Left, left),
            SelectionHandle::new(SelectionHandleKind::Rotate, rotate),
        ])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SelectionHandleKind {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
    Rotate,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SelectionHandle {
    pub(crate) kind: SelectionHandleKind,
    pub(crate) position: Point2D,
}

impl SelectionHandle {
    const fn new(kind: SelectionHandleKind, position: Point2D) -> Self {
        Self { kind, position }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SelectionGeometry {
    pub(crate) oriented_corners: OrientedCorners,
    pub(crate) visual_aabb: VisualAabb,
    pub(crate) handles: [SelectionHandle; 9],
}

impl SelectionGeometry {
    /// `local_visual_bounds` already includes paint expansion (for example half
    /// the stroke width). This module only transforms that visual rectangle.
    pub(crate) fn resolve(
        local_visual_bounds: VisualAabb,
        world_transform: Affine2D,
        rotate_handle_offset_world: f64,
    ) -> Result<Self, SelectionGeometryError> {
        let oriented_corners =
            OrientedCorners::from_local_visual_bounds(local_visual_bounds, world_transform)?;
        Ok(Self {
            visual_aabb: oriented_corners.visual_aabb()?,
            handles: oriented_corners.handles(rotate_handle_offset_world)?,
            oriented_corners,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SelectionGeometryError {
    InvalidBounds,
    InvalidRotateHandleOffset,
    DegenerateTopEdge,
    InvalidTransform(Affine2DError),
}

impl From<Affine2DError> for SelectionGeometryError {
    fn from(error: Affine2DError) -> Self {
        Self::InvalidTransform(error)
    }
}

fn midpoint(first: Point2D, second: Point2D) -> Point2D {
    Point2D::new(
        first.x + (second.x - first.x) / 2.0,
        first.y + (second.y - first.y) / 2.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-10;

    #[test]
    fn resolves_oriented_corners_and_visual_aabb() {
        let local = VisualAabb::new(-1.0, -1.0, 12.0, 22.0).expect("bounds are valid");
        let transform = Affine2D::rotation(std::f64::consts::FRAC_PI_2)
            .expect("rotation is valid")
            .around(Point2D::new(5.0, 10.0))
            .expect("pivot transform is valid");
        let geometry = SelectionGeometry::resolve(local, transform, 12.0)
            .expect("selection geometry resolves");

        assert_point(geometry.oriented_corners.top_left, Point2D::new(16.0, 4.0));
        assert_point(
            geometry.oriented_corners.top_right,
            Point2D::new(16.0, 16.0),
        );
        assert_point(
            geometry.oriented_corners.bottom_right,
            Point2D::new(-6.0, 16.0),
        );
        assert_point(
            geometry.oriented_corners.bottom_left,
            Point2D::new(-6.0, 4.0),
        );
        assert_bounds(geometry.visual_aabb, -6.0, 4.0, 22.0, 12.0);
    }

    #[test]
    fn returns_eight_resize_handles_and_one_outward_rotate_handle() {
        let geometry = SelectionGeometry::resolve(
            VisualAabb::new(0.0, 0.0, 100.0, 60.0).expect("bounds are valid"),
            Affine2D::IDENTITY,
            20.0,
        )
        .expect("selection geometry resolves");

        assert_eq!(
            geometry.handles.map(|handle| handle.kind),
            [
                SelectionHandleKind::TopLeft,
                SelectionHandleKind::Top,
                SelectionHandleKind::TopRight,
                SelectionHandleKind::Right,
                SelectionHandleKind::BottomRight,
                SelectionHandleKind::Bottom,
                SelectionHandleKind::BottomLeft,
                SelectionHandleKind::Left,
                SelectionHandleKind::Rotate,
            ]
        );
        assert_point(geometry.handles[0].position, Point2D::new(0.0, 0.0));
        assert_point(geometry.handles[1].position, Point2D::new(50.0, 0.0));
        assert_point(geometry.handles[3].position, Point2D::new(100.0, 30.0));
        assert_point(geometry.handles[8].position, Point2D::new(50.0, -20.0));
    }

    #[test]
    fn keeps_rotate_handle_outside_reflected_geometry() {
        let reflected =
            Affine2D::new(-1.0, 0.0, 0.0, 1.0, 100.0, 0.0).expect("reflection remains invertible");
        let geometry = SelectionGeometry::resolve(
            VisualAabb::new(0.0, 0.0, 100.0, 60.0).expect("bounds are valid"),
            reflected,
            20.0,
        )
        .expect("selection geometry resolves");

        assert_point(geometry.handles[8].position, Point2D::new(50.0, -20.0));
    }

    #[test]
    fn rejects_invalid_bounds_and_handle_offsets() {
        assert_eq!(
            VisualAabb::new(0.0, 0.0, -1.0, 1.0),
            Err(SelectionGeometryError::InvalidBounds)
        );
        let corners = OrientedCorners::from_local_visual_bounds(
            VisualAabb::new(0.0, 0.0, 1.0, 1.0).expect("bounds are valid"),
            Affine2D::IDENTITY,
        )
        .expect("corners resolve");
        assert_eq!(
            corners.handles(f64::NAN),
            Err(SelectionGeometryError::InvalidRotateHandleOffset)
        );
        assert_eq!(
            SelectionGeometry::resolve(
                VisualAabb::new(0.0, 0.0, 1.0, 1.0).expect("bounds are valid"),
                Affine2D {
                    a: 1.0,
                    b: 0.0,
                    c: 0.0,
                    d: 0.0,
                    e: 0.0,
                    f: 0.0,
                },
                0.0,
            ),
            Err(SelectionGeometryError::InvalidTransform(
                Affine2DError::Singular
            ))
        );
    }

    fn assert_point(actual: Point2D, expected: Point2D) {
        assert_close(actual.x, expected.x);
        assert_close(actual.y, expected.y);
    }

    fn assert_bounds(actual: VisualAabb, x: f64, y: f64, width: f64, height: f64) {
        assert_close(actual.x, x);
        assert_close(actual.y, y);
        assert_close(actual.width, width);
        assert_close(actual.height, height);
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= EPSILON,
            "{actual} != {expected}"
        );
    }
}
