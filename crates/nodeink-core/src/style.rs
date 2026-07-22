use serde::{Deserialize, Serialize};

pub const DEFAULT_RECTANGLE_FILL_COLOR: &str = "#d1fae5";
pub const DEFAULT_RECTANGLE_STROKE_COLOR: &str = "#047857";
pub const DEFAULT_INK_COLOR: &str = "#0f172a";
pub const DEFAULT_RECTANGLE_STROKE_WIDTH: f64 = 2.0;
pub const DEFAULT_STROKE_WIDTH: f64 = 3.0;

const MIN_STROKE_WIDTH: f64 = 0.1;
const MAX_STROKE_WIDTH: f64 = 128.0;
const MIN_FONT_SIZE: f64 = 1.0;
const MAX_FONT_SIZE: f64 = 512.0;

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
        stroke_width: Option<f64>,
    },
    Stroke {
        stroke: Option<String>,
        stroke_width: Option<f64>,
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
            stroke_width: None,
        }
    }
}

impl ElementStylePatchV1 {
    pub(crate) fn is_empty(&self) -> bool {
        match self {
            Self::Rect {
                fill,
                stroke,
                stroke_width,
            } => fill.is_none() && stroke.is_none() && stroke_width.is_none(),
            Self::Stroke {
                stroke,
                stroke_width,
            } => stroke.is_none() && stroke_width.is_none(),
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
        stroke_width: f64,
    },
    Stroke {
        stroke: String,
        stroke_width: f64,
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

pub(crate) fn is_valid_stroke_width(width: f64) -> bool {
    width.is_finite() && (MIN_STROKE_WIDTH..=MAX_STROKE_WIDTH).contains(&width)
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
}
