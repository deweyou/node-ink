use nodeink_core::{
    ElementRecordV1, Engine, NodeInkDocumentV1, RectElementV1, RenderProfileV1, SketchFillStyleV1,
    StrokeElementV1, Vec2,
};
use serde_json::json;

fn main() {
    let engine = Engine::open(fixture_document()).expect("fixture document must be valid");
    let profiles = [
        ("clean", RenderProfileV1::clean()),
        ("sketchSeed42", sketch_profile(42, 1.2)),
        ("sketchSeed43", sketch_profile(43, 1.2)),
        ("sketchRoughness2", sketch_profile(42, 2.0)),
    ];
    let hashes = profiles
        .into_iter()
        .map(|(name, profile)| {
            let resolved = engine
                .resolve_scene_profile(profile)
                .expect("fixture profile must be valid");
            (name, resolved.canonical_hash)
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "engineAlgorithmVersion": nodeink_core::ENGINE_ALGORITHM_VERSION,
            "hashes": hashes,
        }))
        .expect("benchmark output must serialize")
    );
}

fn fixture_document() -> NodeInkDocumentV1 {
    let mut document = NodeInkDocumentV1::blank("sketch-fixture");
    let rectangle = RectElementV1 {
        id: "rect-1".to_string(),
        x: 24.0,
        y: 40.0,
        width: 160.0,
        height: 96.0,
    };
    let stroke = StrokeElementV1 {
        id: "stroke-1".to_string(),
        points: vec![
            Vec2 { x: 8.0, y: 12.0 },
            Vec2 { x: 24.0, y: 28.0 },
            Vec2 { x: 48.0, y: 16.0 },
        ],
        stroke_width: 3.0,
    };
    document.root_order = vec![rectangle.id.clone(), stroke.id.clone()];
    document
        .elements
        .insert(rectangle.id.clone(), ElementRecordV1::Rect(rectangle));
    document
        .elements
        .insert(stroke.id.clone(), ElementRecordV1::Stroke(stroke));
    document
}

fn sketch_profile(seed: u32, roughness: f64) -> RenderProfileV1 {
    RenderProfileV1::Sketch {
        version: 1,
        seed,
        roughness,
        bowing: 0.8,
        fill_style: SketchFillStyleV1::Hachure,
    }
}
