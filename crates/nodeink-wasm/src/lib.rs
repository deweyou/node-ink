use nodeink_core::{
    CommandEnvelopeV1, Engine, EngineErrorV1, NodeInkDocumentV1, NormalizedPointerEventV1,
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

    #[wasm_bindgen(js_name = currentUpdate)]
    pub fn current_update(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.engine.current_update())
            .map_err(|error| js_error("serialization_failed", error))
    }

    #[wasm_bindgen(js_name = serializeDocument)]
    pub fn serialize_document(&self) -> Result<String, JsValue> {
        self.engine
            .serialize_document()
            .map_err(|error| js_error("serialization_failed", error))
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
