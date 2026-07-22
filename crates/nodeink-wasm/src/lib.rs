use nodeink_core::{
    CommandEnvelopeV1, Engine, EngineErrorV1, NodeInkDocumentV1, NormalizedPointerEventV1,
    RenderProfileV1, StrokeInputBatchV1, StrokePhaseV1, TextMetricsSnapshotV1, TextRunV1, Vec2,
    benchmark_scene_patch, benchmark_scene_snapshot,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct EngineHandle {
    engine: Engine,
}

#[wasm_bindgen(js_name = openDocument)]
pub fn open_document(document_json: &str) -> Result<EngineHandle, JsValue> {
    let document: NodeInkDocumentV1 =
        serde_json::from_str(document_json).map_err(|error| js_error("schema_invalid", error))?;
    let engine = Engine::open(document).map_err(engine_error)?;
    Ok(EngineHandle { engine })
}

#[wasm_bindgen]
impl EngineHandle {
    #[wasm_bindgen(js_name = executeCommand)]
    pub fn execute_command(&mut self, command_json: &str) -> Result<String, JsValue> {
        let command: CommandEnvelopeV1 = serde_json::from_str(command_json)
            .map_err(|error| js_error("schema_invalid", error))?;
        let update = self.engine.execute_command(command).map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    pub fn undo(&mut self) -> Result<String, JsValue> {
        let update = self.engine.undo().map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    pub fn redo(&mut self) -> Result<String, JsValue> {
        let update = self.engine.redo().map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = handlePointerEvents)]
    pub fn handle_pointer_events(
        &mut self,
        events_json: &str,
        command_id: String,
    ) -> Result<String, JsValue> {
        let events: Vec<NormalizedPointerEventV1> =
            serde_json::from_str(events_json).map_err(|error| js_error("schema_invalid", error))?;
        let update = self
            .engine
            .handle_pointer_events(command_id, events)
            .map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = handleStrokeBatchJson)]
    pub fn handle_stroke_batch_json(
        &mut self,
        batch_json: &str,
        command_id: String,
    ) -> Result<String, JsValue> {
        let batch: StrokeInputBatchV1 =
            serde_json::from_str(batch_json).map_err(|error| js_error("schema_invalid", error))?;
        let update = self
            .engine
            .handle_stroke_batch(command_id, batch)
            .map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = handleStrokePoints)]
    pub fn handle_stroke_points(
        &mut self,
        pointer_id: u32,
        sequence_start: u32,
        phase: &str,
        coordinates: &[f64],
        stroke_id: Option<String>,
        command_id: String,
    ) -> Result<String, JsValue> {
        let phase = parse_stroke_phase(phase)?;
        let chunks = coordinates.chunks_exact(2);
        if !chunks.remainder().is_empty() {
            return Err(js_error(
                "schema_invalid",
                "stroke coordinate array must contain x/y pairs",
            ));
        }
        let points = chunks
            .map(|pair| Vec2 {
                x: pair[0],
                y: pair[1],
            })
            .collect();
        let update = self
            .engine
            .handle_stroke_batch(
                command_id,
                StrokeInputBatchV1 {
                    pointer_id,
                    sequence_start: u64::from(sequence_start),
                    phase,
                    points,
                    stroke_id,
                },
            )
            .map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = currentUpdate)]
    pub fn current_update(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.engine.current_update())
            .map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = resolveSceneProfile)]
    pub fn resolve_scene_profile(&self, profile_json: &str) -> Result<String, JsValue> {
        let profile: RenderProfileV1 = serde_json::from_str(profile_json)
            .map_err(|error| js_error("schema_invalid", error))?;
        let resolution = self
            .engine
            .resolve_scene_profile(profile)
            .map_err(engine_error)?;
        serde_json::to_string(&resolution).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = resolveTextFixture)]
    pub fn resolve_text_fixture(
        &self,
        request_id: String,
        font_fingerprint: String,
        runs_json: &str,
        metrics_json: Option<String>,
    ) -> Result<String, JsValue> {
        let runs: Vec<TextRunV1> =
            serde_json::from_str(runs_json).map_err(|error| js_error("schema_invalid", error))?;
        let metrics = metrics_json
            .map(|serialized| serde_json::from_str::<TextMetricsSnapshotV1>(&serialized))
            .transpose()
            .map_err(|error| js_error("schema_invalid", error))?;
        let resolution = self
            .engine
            .resolve_text_fixture(request_id, font_fingerprint, runs, metrics)
            .map_err(engine_error)?;
        serde_json::to_string(&resolution).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = benchmarkSceneSnapshot)]
    pub fn benchmark_scene_snapshot(
        &self,
        element_count: u32,
        moved_count: u32,
        after_move: bool,
    ) -> Result<String, JsValue> {
        let snapshot =
            benchmark_scene_snapshot(element_count as usize, moved_count as usize, after_move)
                .map_err(engine_error)?;
        serde_json::to_string(&snapshot).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = benchmarkScenePatch)]
    pub fn benchmark_scene_patch(
        &self,
        element_count: u32,
        moved_count: u32,
    ) -> Result<String, JsValue> {
        let patch = benchmark_scene_patch(element_count as usize, moved_count as usize)
            .map_err(engine_error)?;
        serde_json::to_string(&patch).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = serializeDocument)]
    pub fn serialize_document(&self) -> Result<String, JsValue> {
        self.engine
            .serialize_document()
            .map_err(|error| js_error("serialization_failed", error))
    }
}

fn parse_stroke_phase(phase: &str) -> Result<StrokePhaseV1, JsValue> {
    match phase {
        "down" => Ok(StrokePhaseV1::Down),
        "move" => Ok(StrokePhaseV1::Move),
        "up" => Ok(StrokePhaseV1::Up),
        "cancel" => Ok(StrokePhaseV1::Cancel),
        _ => Err(js_error("schema_invalid", "unsupported stroke phase")),
    }
}

fn engine_error(error: EngineErrorV1) -> JsValue {
    let serialized = serde_json::to_string(&error)
        .unwrap_or_else(|_| format!("{{\"code\":\"engine_unavailable\",\"message\":\"{error}\"}}"));
    JsValue::from_str(&serialized)
}

fn js_error(code: &str, error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&format!(
        "{{\"code\":\"{code}\",\"message\":{}}}",
        serde_json::to_string(&error.to_string())
            .unwrap_or_else(|_| "\"unknown error\"".to_string())
    ))
}
