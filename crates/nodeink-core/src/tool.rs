use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorToolV1 {
    #[default]
    Select,
    Freehand,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ToolState {
    active_tool: EditorToolV1,
}

impl ToolState {
    pub(crate) fn active_tool(self) -> EditorToolV1 {
        self.active_tool
    }

    pub(crate) fn set_active_tool(&mut self, active_tool: EditorToolV1) -> bool {
        if self.active_tool == active_tool {
            return false;
        }
        self.active_tool = active_tool;
        true
    }
}
