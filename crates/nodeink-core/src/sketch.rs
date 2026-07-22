use serde::{Deserialize, Serialize};

use crate::{RectElementV1, ScenePathV1, StrokeElementV1, Vec2};

pub const ENGINE_ALGORITHM_VERSION: &str = "nodeink-scene-v2";
const MAX_SKETCH_PARAMETER: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SketchFillStyleV1 {
    Solid,
    Hachure,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RenderProfileV1 {
    Clean {
        version: u32,
    },
    Sketch {
        version: u32,
        seed: u32,
        roughness: f64,
        bowing: f64,
        fill_style: SketchFillStyleV1,
    },
}

impl RenderProfileV1 {
    pub fn clean() -> Self {
        Self::Clean { version: 1 }
    }

    pub(crate) fn validate(&self) -> bool {
        match self {
            Self::Clean { version } => *version == 1,
            Self::Sketch {
                version,
                roughness,
                bowing,
                ..
            } => {
                *version == 1
                    && roughness.is_finite()
                    && (0.0..=MAX_SKETCH_PARAMETER).contains(roughness)
                    && bowing.is_finite()
                    && (0.0..=MAX_SKETCH_PARAMETER).contains(bowing)
            }
        }
    }
}

pub(crate) fn sketch_rectangle(
    rectangle: &RectElementV1,
    profile: &RenderProfileV1,
) -> Vec<ScenePathV1> {
    let RenderProfileV1::Sketch {
        seed,
        roughness,
        bowing,
        fill_style,
        ..
    } = profile
    else {
        return Vec::new();
    };
    let mut random = SeededRandom::new(mix_seed(*seed, &rectangle.id));
    let amplitude = roughness * 1.5 + bowing * 0.25;
    let corners = [
        Vec2 {
            x: rectangle.x,
            y: rectangle.y,
        },
        Vec2 {
            x: rectangle.x + rectangle.width,
            y: rectangle.y,
        },
        Vec2 {
            x: rectangle.x + rectangle.width,
            y: rectangle.y + rectangle.height,
        },
        Vec2 {
            x: rectangle.x,
            y: rectangle.y + rectangle.height,
        },
    ];
    let mut outline_points: Vec<Vec2> = corners
        .iter()
        .map(|point| jittered(*point, amplitude, &mut random))
        .collect();
    outline_points.push(outline_points[0]);
    let mut paths = vec![ScenePathV1 {
        id: format!("{}:sketch:outline:v1", rectangle.id),
        source_element_id: rectangle.id.clone(),
        transform: crate::Affine2D::identity(),
        path_data: path_data(&outline_points),
        fill: if *fill_style == SketchFillStyleV1::Solid {
            rectangle.fill.scene_paint().to_string()
        } else {
            "none".to_string()
        },
        stroke: rectangle.stroke.clone(),
        stroke_width: rectangle.stroke_width,
    }];
    if *fill_style == SketchFillStyleV1::Hachure
        && let Some(fill_color) = rectangle.fill.solid_color()
    {
        paths.push(ScenePathV1 {
            id: format!("{}:sketch:fill:v1", rectangle.id),
            source_element_id: rectangle.id.clone(),
            transform: crate::Affine2D::identity(),
            path_data: hachure_path(rectangle, amplitude, &mut random),
            fill: "none".to_string(),
            stroke: fill_color.to_string(),
            stroke_width: 1.0,
        });
    }
    paths
}

pub(crate) fn sketch_stroke(stroke: &StrokeElementV1, profile: &RenderProfileV1) -> ScenePathV1 {
    let RenderProfileV1::Sketch {
        seed, roughness, ..
    } = profile
    else {
        unreachable!("sketch_stroke is only called for a sketch profile");
    };
    let mut random = SeededRandom::new(mix_seed(*seed, &stroke.id));
    let points: Vec<Vec2> = stroke
        .points
        .iter()
        .map(|point| jittered(*point, roughness * 0.45, &mut random))
        .collect();
    ScenePathV1 {
        id: format!("{}:sketch:path:v1", stroke.id),
        source_element_id: stroke.id.clone(),
        transform: crate::Affine2D::identity(),
        path_data: path_data(&points),
        fill: "none".to_string(),
        stroke: stroke.stroke.clone(),
        stroke_width: stroke.stroke_width,
    }
}

fn hachure_path(rectangle: &RectElementV1, amplitude: f64, random: &mut SeededRandom) -> String {
    let mut path = String::new();
    let line_count = 7;
    for index in 1..=line_count {
        let progress = f64::from(index) / f64::from(line_count + 1);
        let start = jittered(
            Vec2 {
                x: rectangle.x + rectangle.width * progress,
                y: rectangle.y + 8.0,
            },
            amplitude * 0.35,
            random,
        );
        let end = jittered(
            Vec2 {
                x: rectangle.x + rectangle.width * progress - 18.0,
                y: rectangle.y + rectangle.height - 8.0,
            },
            amplitude * 0.35,
            random,
        );
        if !path.is_empty() {
            path.push(' ');
        }
        path.push_str(&format!("M {} {} L {} {}", start.x, start.y, end.x, end.y));
    }
    path
}

fn path_data(points: &[Vec2]) -> String {
    let mut path = String::new();
    for (index, point) in points.iter().enumerate() {
        if index == 0 {
            path.push_str("M ");
        } else {
            path.push_str(" L ");
        }
        path.push_str(&format!("{} {}", point.x, point.y));
    }
    path
}

fn jittered(point: Vec2, amplitude: f64, random: &mut SeededRandom) -> Vec2 {
    Vec2 {
        x: point.x + random.unit_signed() * amplitude,
        y: point.y + random.unit_signed() * amplitude,
    }
}

fn mix_seed(seed: u32, text: &str) -> u32 {
    text.bytes().fold(seed ^ 0x811c_9dc5, |hash, byte| {
        hash.wrapping_mul(16_777_619) ^ u32::from(byte)
    })
}

struct SeededRandom(u32);

impl SeededRandom {
    fn new(seed: u32) -> Self {
        Self(if seed == 0 { 0x6d2b_79f5 } else { seed })
    }

    fn unit_signed(&mut self) -> f64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.0 = value;
        f64::from(value % 20_001) / 10_000.0 - 1.0
    }
}
