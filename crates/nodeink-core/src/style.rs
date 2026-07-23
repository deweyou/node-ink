use serde::{Deserialize, Serialize};

pub const DEFAULT_RECTANGLE_FILL_COLOR: &str = "#d1fae5";
pub const DEFAULT_RECTANGLE_STROKE_COLOR: &str = "#047857";
pub const DEFAULT_INK_COLOR: &str = "#0f172a";
pub const DEFAULT_ELEMENT_SIZE: ElementSizeV1 = ElementSizeV1::M;

const MIN_FONT_SIZE: f64 = 1.0;
const MAX_FONT_SIZE: f64 = 512.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ElementSizeV1 {
    S,
    M,
    L,
    Xl,
}

impl ElementSizeV1 {
    pub const fn stroke_width(self) -> f64 {
        match self {
            Self::S => 2.0,
            Self::M => 4.0,
            Self::L => 6.0,
            Self::Xl => 8.0,
        }
    }

    pub const fn arrowhead_length(self) -> f64 {
        match self {
            Self::S => 28.0,
            Self::M => 40.0,
            Self::L => 56.0,
            Self::Xl => 72.0,
        }
    }

    pub const fn arrowhead_opening_width(self) -> f64 {
        self.arrowhead_length() * 0.9
    }

    pub(crate) fn from_legacy_stroke_width(stroke_width: f64) -> Self {
        if stroke_width <= 2.0 {
            Self::S
        } else if stroke_width <= 4.0 {
            Self::M
        } else if stroke_width <= 6.0 {
            Self::L
        } else {
            Self::Xl
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FillV1 {
    None,
    Solid { color: String },
}

impl FillV1 {
    pub fn default_rectangle() -> Self {
        Self::Solid {
            color: DEFAULT_RECTANGLE_FILL_COLOR.to_string(),
        }
    }

    pub(crate) fn scene_paint(&self) -> &str {
        match self {
            Self::None => "none",
            Self::Solid { color } => color,
        }
    }

    pub(crate) fn solid_color(&self) -> Option<&str> {
        match self {
            Self::None => None,
            Self::Solid { color } => Some(color),
        }
    }

    pub(crate) fn validate(&self) -> bool {
        match self {
            Self::None => true,
            Self::Solid { color } => is_canonical_color(color),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextAlignV1 {
    Start,
    Center,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextAnchorV1 {
    Start,
    Middle,
    End,
}

impl From<TextAlignV1> for TextAnchorV1 {
    fn from(value: TextAlignV1) -> Self {
        match value {
            TextAlignV1::Start => Self::Start,
            TextAlignV1::Center => Self::Middle,
            TextAlignV1::End => Self::End,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ElementStylePatchV1 {
    Rect {
        fill: Option<FillV1>,
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Ellipse {
        fill: Option<FillV1>,
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Diamond {
        fill: Option<FillV1>,
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Line {
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Polyline {
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Arrow {
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Stroke {
        stroke: Option<String>,
        size: Option<ElementSizeV1>,
    },
    Text {
        color: Option<String>,
        text_align: Option<TextAlignV1>,
        font_size: Option<f64>,
        font_weight: Option<u16>,
    },
}

impl Default for ElementStylePatchV1 {
    fn default() -> Self {
        Self::Rect {
            fill: None,
            stroke: None,
            size: None,
        }
    }
}

impl ElementStylePatchV1 {
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Self::Rect { fill, stroke, size }
            | Self::Ellipse { fill, stroke, size }
            | Self::Diamond { fill, stroke, size } => {
                fill.is_none() && stroke.is_none() && size.is_none()
            }
            Self::Line { stroke, size }
            | Self::Polyline { stroke, size }
            | Self::Arrow { stroke, size }
            | Self::Stroke { stroke, size } => stroke.is_none() && size.is_none(),
            Self::Text {
                color,
                text_align,
                font_size,
                font_weight,
            } => {
                color.is_none()
                    && text_align.is_none()
                    && font_size.is_none()
                    && font_weight.is_none()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SelectionStyleV1 {
    Rect {
        fill: FillV1,
        stroke: String,
        size: ElementSizeV1,
    },
    Ellipse {
        fill: FillV1,
        stroke: String,
        size: ElementSizeV1,
    },
    Diamond {
        fill: FillV1,
        stroke: String,
        size: ElementSizeV1,
    },
    Line {
        stroke: String,
        size: ElementSizeV1,
    },
    Polyline {
        stroke: String,
        size: ElementSizeV1,
    },
    Arrow {
        stroke: String,
        size: ElementSizeV1,
    },
    Stroke {
        stroke: String,
        size: ElementSizeV1,
    },
    Text {
        color: String,
        text_align: TextAlignV1,
        font_size: f64,
        font_weight: u16,
    },
}

pub(crate) fn is_canonical_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn is_valid_font_size(size: f64) -> bool {
    size.is_finite() && (MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&size)
}

pub(crate) fn aligned_text_x(x: f64, width: f64, align: TextAlignV1) -> f64 {
    match align {
        TextAlignV1::Start => x,
        TextAlignV1::Center => x - width / 2.0,
        TextAlignV1::End => x - width,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_are_canonical_lowercase_hex_only() {
        assert!(is_canonical_color("#0f172a"));
        assert!(!is_canonical_color("#0F172A"));
        assert!(!is_canonical_color("#fff"));
        assert!(!is_canonical_color("black"));
        assert!(!is_canonical_color("#gg172a"));
    }

    #[test]
    fn default_style_patch_is_an_empty_rectangle_patch() {
        let patch = ElementStylePatchV1::default();

        assert!(patch.is_empty());
        assert!(matches!(patch, ElementStylePatchV1::Rect { .. }));
    }

    #[test]
    fn every_basic_shape_style_patch_reports_empty_and_changed_fields() {
        let empty = [
            ElementStylePatchV1::Ellipse {
                fill: None,
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Diamond {
                fill: None,
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Line {
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Polyline {
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Arrow {
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Stroke {
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Text {
                color: None,
                text_align: None,
                font_size: None,
                font_weight: None,
            },
        ];
        assert!(empty.iter().all(ElementStylePatchV1::is_empty));

        let changed = [
            ElementStylePatchV1::Ellipse {
                fill: Some(FillV1::None),
                stroke: None,
                size: None,
            },
            ElementStylePatchV1::Diamond {
                fill: None,
                stroke: Some("#2563eb".to_string()),
                size: None,
            },
            ElementStylePatchV1::Line {
                stroke: None,
                size: Some(ElementSizeV1::M),
            },
            ElementStylePatchV1::Polyline {
                stroke: Some("#2563eb".to_string()),
                size: None,
            },
            ElementStylePatchV1::Arrow {
                stroke: None,
                size: Some(ElementSizeV1::M),
            },
            ElementStylePatchV1::Stroke {
                stroke: Some("#2563eb".to_string()),
                size: None,
            },
            ElementStylePatchV1::Text {
                color: None,
                text_align: Some(TextAlignV1::Center),
                font_size: None,
                font_weight: None,
            },
        ];
        assert!(changed.iter().all(|patch| !patch.is_empty()));
    }

    #[test]
    fn element_sizes_resolve_stroke_and_arrowhead_metrics() {
        let metrics = [
            (ElementSizeV1::S, 2.0, 28.0, 25.2),
            (ElementSizeV1::M, 4.0, 40.0, 36.0),
            (ElementSizeV1::L, 6.0, 56.0, 50.4),
            (ElementSizeV1::Xl, 8.0, 72.0, 64.8),
        ];

        for (size, stroke_width, arrowhead_length, arrowhead_opening_width) in metrics {
            assert_eq!(size.stroke_width(), stroke_width);
            assert_eq!(size.arrowhead_length(), arrowhead_length);
            assert_eq!(size.arrowhead_opening_width(), arrowhead_opening_width);
        }
        assert_eq!(DEFAULT_ELEMENT_SIZE, ElementSizeV1::M);
    }
}
