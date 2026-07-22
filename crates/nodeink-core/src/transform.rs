use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Point2D {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

impl Point2D {
    pub(crate) const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// A column-vector affine transform using the SVG/Canvas `(a, b, c, d, e, f)` layout.
///
/// A point is mapped to `(a*x + c*y + e, b*x + d*y + f)`. Values can only be
/// constructed when every coefficient and the determinant are finite and the
/// determinant is non-zero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Affine2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Affine2DError {
    NonFinite,
    Singular,
}

impl Affine2D {
    pub(crate) const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub const fn identity() -> Self {
        Self::IDENTITY
    }

    pub fn is_valid(self) -> bool {
        self.validate().is_ok()
    }

    pub(crate) fn new(
        a: f64,
        b: f64,
        c: f64,
        d: f64,
        e: f64,
        f: f64,
    ) -> Result<Self, Affine2DError> {
        let transform = Self { a, b, c, d, e, f };
        transform.validate()?;
        Ok(transform)
    }

    pub(crate) fn translation(delta: Point2D) -> Result<Self, Affine2DError> {
        Self::new(1.0, 0.0, 0.0, 1.0, delta.x, delta.y)
    }

    pub(crate) fn scale(scale_x: f64, scale_y: f64) -> Result<Self, Affine2DError> {
        Self::new(scale_x, 0.0, 0.0, scale_y, 0.0, 0.0)
    }

    pub(crate) fn rotation(radians: f64) -> Result<Self, Affine2DError> {
        if !radians.is_finite() {
            return Err(Affine2DError::NonFinite);
        }
        let (sin, cos) = radians.sin_cos();
        Self::new(cos, sin, -sin, cos, 0.0, 0.0)
    }

    pub(crate) fn determinant(self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    /// Composes two transforms in visual application order: `self` is applied
    /// first, followed by `next`.
    pub(crate) fn compose(self, next: Self) -> Result<Self, Affine2DError> {
        self.validate()?;
        next.validate()?;
        Self::new(
            next.a * self.a + next.c * self.b,
            next.b * self.a + next.d * self.b,
            next.a * self.c + next.c * self.d,
            next.b * self.c + next.d * self.d,
            next.a * self.e + next.c * self.f + next.e,
            next.b * self.e + next.d * self.f + next.f,
        )
    }

    pub(crate) fn apply(self, point: Point2D) -> Result<Point2D, Affine2DError> {
        self.validate()?;
        if !point.is_finite() {
            return Err(Affine2DError::NonFinite);
        }
        let transformed = Point2D {
            x: self.a * point.x + self.c * point.y + self.e,
            y: self.b * point.x + self.d * point.y + self.f,
        };
        if !transformed.is_finite() {
            return Err(Affine2DError::NonFinite);
        }
        Ok(transformed)
    }

    pub(crate) fn inverse(self) -> Result<Self, Affine2DError> {
        self.validate()?;
        let determinant = self.determinant();
        Self::new(
            self.d / determinant,
            -self.b / determinant,
            -self.c / determinant,
            self.a / determinant,
            (self.c * self.f - self.d * self.e) / determinant,
            (self.b * self.e - self.a * self.f) / determinant,
        )
    }

    /// Applies this transform around `pivot` instead of the origin.
    pub(crate) fn around(self, pivot: Point2D) -> Result<Self, Affine2DError> {
        if !pivot.is_finite() {
            return Err(Affine2DError::NonFinite);
        }
        Self::translation(Point2D::new(-pivot.x, -pivot.y))?
            .compose(self)?
            .compose(Self::translation(pivot)?)
    }

    fn validate(self) -> Result<(), Affine2DError> {
        if ![self.a, self.b, self.c, self.d, self.e, self.f]
            .into_iter()
            .all(f64::is_finite)
        {
            return Err(Affine2DError::NonFinite);
        }
        let determinant = self.determinant();
        if !determinant.is_finite() {
            return Err(Affine2DError::NonFinite);
        }
        if determinant == 0.0 {
            return Err(Affine2DError::Singular);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-10;

    #[test]
    fn applies_and_composes_in_visual_order() {
        let scale = Affine2D::scale(2.0, 3.0).expect("scale is valid");
        let translate =
            Affine2D::translation(Point2D::new(5.0, -4.0)).expect("translation is valid");
        let composed = scale.compose(translate).expect("composition is valid");

        assert_eq!(
            composed.apply(Point2D::new(2.0, 3.0)),
            Ok(Point2D::new(9.0, 5.0))
        );
    }

    #[test]
    fn inverse_round_trips_points() {
        let transform = Affine2D::new(1.5, 0.4, -0.25, 2.0, 19.0, -7.0)
            .expect("fixture transform is invertible");
        let point = Point2D::new(-12.5, 88.25);
        let transformed = transform.apply(point).expect("point is finite");
        let round_trip = transform
            .inverse()
            .expect("transform is invertible")
            .apply(transformed)
            .expect("inverse application is finite");

        assert_close(round_trip.x, point.x);
        assert_close(round_trip.y, point.y);
    }

    #[test]
    fn rotates_around_a_pivot_without_moving_the_pivot() {
        let pivot = Point2D::new(10.0, 20.0);
        let rotation = Affine2D::rotation(std::f64::consts::FRAC_PI_2)
            .expect("quarter rotation is valid")
            .around(pivot)
            .expect("pivot composition is valid");

        let fixed = rotation.apply(pivot).expect("pivot stays finite");
        let rotated = rotation
            .apply(Point2D::new(12.0, 20.0))
            .expect("rotated point stays finite");
        assert_close(fixed.x, 10.0);
        assert_close(fixed.y, 20.0);
        assert_close(rotated.x, 10.0);
        assert_close(rotated.y, 22.0);
    }

    #[test]
    fn rejects_non_finite_and_singular_transforms() {
        assert!(Affine2D::identity().is_valid());
        assert!(
            !Affine2D {
                a: 1.0,
                b: 0.0,
                c: 0.0,
                d: 0.0,
                e: 0.0,
                f: 0.0,
            }
            .is_valid()
        );
        assert_eq!(
            Affine2D::new(f64::NAN, 0.0, 0.0, 1.0, 0.0, 0.0),
            Err(Affine2DError::NonFinite)
        );
        assert_eq!(
            Affine2D::new(f64::MAX, 0.0, 0.0, f64::MAX, 0.0, 0.0),
            Err(Affine2DError::NonFinite)
        );
        assert_eq!(Affine2D::scale(0.0, 1.0), Err(Affine2DError::Singular));
        assert_eq!(
            Affine2D::IDENTITY.apply(Point2D::new(f64::INFINITY, 0.0)),
            Err(Affine2DError::NonFinite)
        );
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= EPSILON,
            "{actual} != {expected}"
        );
    }
}
