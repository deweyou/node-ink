use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorToolV1 {
    #[default]
    Select,
    Freehand,
    Text,
    Rectangle,
    Ellipse,
    Diamond,
    Line,
    Polyline,
    Arrow,
}

impl EditorToolV1 {
    pub(crate) fn is_shape_creation_tool(self) -> bool {
        matches!(
            self,
            Self::Rectangle
                | Self::Ellipse
                | Self::Diamond
                | Self::Line
                | Self::Polyline
                | Self::Arrow
        )
    }
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
