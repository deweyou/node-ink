use serde::{Deserialize, Serialize};

use crate::{EngineErrorV1, Vec2};

pub const MIN_CAMERA_ZOOM: f64 = 0.1;
pub const MAX_CAMERA_ZOOM: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CameraV1 {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraViewportV1 {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CameraContentBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Default for CameraV1 {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CameraActionV1 {
    PanBy {
        delta: Vec2,
    },
    ZoomAt {
        factor: f64,
        anchor: Vec2,
    },
    FitContent {
        viewport: CameraViewportV1,
        padding: f64,
    },
}

impl CameraV1 {
    pub(crate) fn validate(self) -> Result<Self, EngineErrorV1> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.zoom.is_finite()
            || !(MIN_CAMERA_ZOOM..=MAX_CAMERA_ZOOM).contains(&self.zoom)
        {
            return Err(EngineErrorV1::InvalidCamera);
        }
        Ok(self)
    }

    pub(crate) fn apply_navigation(self, action: CameraActionV1) -> Result<Self, EngineErrorV1> {
        let next = match action {
            CameraActionV1::PanBy { delta } => {
                if !delta.x.is_finite() || !delta.y.is_finite() {
                    return Err(EngineErrorV1::InvalidCameraAction);
                }
                Self {
                    x: self.x - delta.x / self.zoom,
                    y: self.y - delta.y / self.zoom,
                    ..self
                }
            }
            CameraActionV1::ZoomAt { factor, anchor } => {
                if !factor.is_finite()
                    || factor <= 0.0
                    || !anchor.x.is_finite()
                    || !anchor.y.is_finite()
                {
                    return Err(EngineErrorV1::InvalidCameraAction);
                }
                let zoom = (self.zoom * factor).clamp(MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
                let anchor_world_x = self.x + anchor.x / self.zoom;
                let anchor_world_y = self.y + anchor.y / self.zoom;
                Self {
                    x: anchor_world_x - anchor.x / zoom,
                    y: anchor_world_y - anchor.y / zoom,
                    zoom,
                }
            }
            CameraActionV1::FitContent { .. } => {
                return Err(EngineErrorV1::InvalidCameraAction);
            }
        };
        next.validate()
    }

    pub(crate) fn fit_content(
        bounds: Option<CameraContentBounds>,
        viewport: CameraViewportV1,
        padding: f64,
    ) -> Result<Self, EngineErrorV1> {
        if !viewport.width.is_finite()
            || !viewport.height.is_finite()
            || viewport.width <= 0.0
            || viewport.height <= 0.0
            || !padding.is_finite()
            || padding < 0.0
            || padding * 2.0 >= viewport.width
            || padding * 2.0 >= viewport.height
        {
            return Err(EngineErrorV1::InvalidCameraAction);
        }

        let Some(bounds) = bounds else {
            return Ok(Self::default());
        };
        let available_width = viewport.width - padding * 2.0;
        let available_height = viewport.height - padding * 2.0;
        let content_width = bounds.width().max(f64::EPSILON);
        let content_height = bounds.height().max(f64::EPSILON);
        let zoom = (available_width / content_width)
            .min(available_height / content_height)
            .clamp(MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
        let center = bounds.center();

        Self {
            x: center.x - viewport.width / (2.0 * zoom),
            y: center.y - viewport.height / (2.0 * zoom),
            zoom,
        }
        .validate()
    }
}

impl CameraContentBounds {
    pub(crate) fn from_rect(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            min_x: x,
            min_y: y,
            max_x: x + width,
            max_y: y + height,
        }
    }

    pub(crate) fn from_point(point: Vec2) -> Self {
        Self {
            min_x: point.x,
            min_y: point.y,
            max_x: point.x,
            max_y: point.y,
        }
    }

    pub(crate) fn include_point(mut self, point: Vec2) -> Self {
        self.min_x = self.min_x.min(point.x);
        self.min_y = self.min_y.min(point.y);
        self.max_x = self.max_x.max(point.x);
        self.max_y = self.max_y.max(point.y);
        self
    }

    pub(crate) fn expand(mut self, amount: f64) -> Self {
        self.min_x -= amount;
        self.min_y -= amount;
        self.max_x += amount;
        self.max_y += amount;
        self
    }

    pub(crate) fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }

    fn width(self) -> f64 {
        self.max_x - self.min_x
    }

    fn height(self) -> f64 {
        self.max_y - self.min_y
    }

    fn center(self) -> Vec2 {
        Vec2 {
            x: (self.min_x + self.max_x) / 2.0,
            y: (self.min_y + self.max_y) / 2.0,
        }
    }
}
