use nodeink_core::{
    CameraActionV1, CameraV1, CameraViewportV1, CommandEnvelopeV1, DiagramOperationBatchV1,
    ENGINE_ALGORITHM_VERSION, EditorToolV1, Engine, EngineErrorV1, NodeInkDocumentV1,
    NormalizedPointerEventV1, RenderProfileV1, StrokeInputBatchV1, StrokePhaseV1,
    TextMetricsSnapshotV1, TextRunV1, Vec2, benchmark_scene_patch, benchmark_scene_snapshot,
    migrate_document_payload,
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
    #[wasm_bindgen(js_name = currentCamera)]
    pub fn current_camera(&self) -> Result<String, JsValue> {
        serialize_camera(self.engine.camera())
    }

    #[wasm_bindgen(js_name = setCamera)]
    pub fn set_camera(&mut self, camera_json: &str) -> Result<String, JsValue> {
        let camera: CameraV1 =
            serde_json::from_str(camera_json).map_err(|error| js_error("schema_invalid", error))?;
        let camera = self.engine.set_camera(camera).map_err(engine_error)?;
        serialize_camera(camera)
    }

    #[wasm_bindgen(js_name = fitCamera)]
    pub fn fit_camera(
        &self,
        viewport_width: f64,
        viewport_height: f64,
        padding: f64,
    ) -> Result<String, JsValue> {
        let camera = self
            .engine
            .fit_camera(
                CameraViewportV1 {
                    width: viewport_width,
                    height: viewport_height,
                },
                padding,
            )
            .map_err(engine_error)?;
        serialize_camera(camera)
    }

    #[wasm_bindgen(js_name = applyCameraAction)]
    pub fn apply_camera_action(&mut self, action_json: &str) -> Result<String, JsValue> {
        let action: CameraActionV1 =
            serde_json::from_str(action_json).map_err(|error| js_error("schema_invalid", error))?;
        let camera = self
            .engine
            .apply_camera_action(action)
            .map_err(engine_error)?;
        serialize_camera(camera)
    }

    #[wasm_bindgen(js_name = executeCommand)]
    pub fn execute_command(&mut self, command_json: &str) -> Result<String, JsValue> {
        let command: CommandEnvelopeV1 = serde_json::from_str(command_json)
            .map_err(|error| js_error("schema_invalid", error))?;
        let update = self.engine.execute_command(command).map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = setSelection)]
    pub fn set_selection(
        &mut self,
        element_ids_json: &str,
        primary_element_id: Option<String>,
    ) -> Result<String, JsValue> {
        let element_ids: Vec<String> = serde_json::from_str(element_ids_json)
            .map_err(|error| js_error("schema_invalid", error))?;
        let update = self
            .engine
            .set_selection(element_ids, primary_element_id)
            .map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = copySelection)]
    pub fn copy_selection(&self) -> Result<String, JsValue> {
        let payload = self.engine.copy_selection().map_err(engine_error)?;
        serde_json::to_string(&payload).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = beginTextEditAt)]
    pub fn begin_text_edit_at(&mut self, point_json: &str) -> Result<String, JsValue> {
        let point: Vec2 =
            serde_json::from_str(point_json).map_err(|error| js_error("schema_invalid", error))?;
        let target = self
            .engine
            .begin_text_edit_at(point)
            .map_err(engine_error)?;
        serde_json::to_string(&target).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = provideTextMetrics)]
    pub fn provide_text_metrics(&mut self, metrics_json: &str) -> Result<String, JsValue> {
        let metrics: TextMetricsSnapshotV1 = serde_json::from_str(metrics_json)
            .map_err(|error| js_error("schema_invalid", error))?;
        let update = self
            .engine
            .provide_text_metrics(metrics)
            .map_err(engine_error)?;
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = setActiveTool)]
    pub fn set_active_tool(&mut self, active_tool: &str) -> Result<String, JsValue> {
        let active_tool = parse_editor_tool(active_tool)?;
        let update = self.engine.set_active_tool(active_tool);
        serde_json::to_string(&update).map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = executeDiagramOperation)]
    pub fn execute_diagram_operation(&mut self, batch_json: &str) -> Result<String, JsValue> {
        let batch: DiagramOperationBatchV1 =
            serde_json::from_str(batch_json).map_err(|error| js_error("schema_invalid", error))?;
        let result = self
            .engine
            .execute_diagram_operation(batch)
            .map_err(engine_error)?;
        serde_json::to_string(&result).map_err(|error| js_error("serialization_failed", error))
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
    #[allow(clippy::too_many_arguments)] // Keep the hot-path WASM ABI flat and allocation-free.
    pub fn handle_stroke_points(
        &mut self,
        pointer_id: u32,
        sequence_start: u32,
        phase: &str,
        coordinates: &[f64],
        stroke_id: Option<String>,
        straight_line: bool,
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
                    straight_line,
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

    #[wasm_bindgen(js_name = migrateDocumentPayload)]
    pub fn migrate_document_payload(&self, payload_json: &str) -> Result<String, JsValue> {
        serde_json::to_string(&migrate_document_payload(payload_json))
            .map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = serializeDocument)]
    pub fn serialize_document(&self) -> Result<String, JsValue> {
        self.engine
            .serialize_document()
            .map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = engineAlgorithmVersion)]
    pub fn engine_algorithm_version(&self) -> String {
        ENGINE_ALGORITHM_VERSION.to_string()
    }
}

fn serialize_camera(camera: CameraV1) -> Result<String, JsValue> {
    serde_json::to_string(&camera).map_err(|error| js_error("serialization_failed", error))
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

fn parse_editor_tool(active_tool: &str) -> Result<EditorToolV1, JsValue> {
    match active_tool {
        "select" => Ok(EditorToolV1::Select),
        "freehand" => Ok(EditorToolV1::Freehand),
        "text" => Ok(EditorToolV1::Text),
        _ => Err(js_error("schema_invalid", "unsupported editor tool")),
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
