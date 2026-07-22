use serde::{Deserialize, Serialize};

use crate::{ElementId, Vec2};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointerPhaseV1 {
    Down,
    Move,
    Up,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPointerEventV1 {
    pub pointer_id: u32,
    pub sequence: u64,
    pub phase: PointerPhaseV1,
    pub point: Vec2,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TargetedPointerEvent {
    pub input: NormalizedPointerEventV1,
    pub target_element_id: Option<ElementId>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerPreview {
    pub element_id: ElementId,
    pub delta: Vec2,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerCommit {
    pub element_id: ElementId,
    pub delta: Vec2,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PointerTransition {
    None,
    Preview(PointerPreview),
    Commit(PointerCommit),
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerBatchOutcome {
    pub processed_event_count: usize,
    pub ignored_event_count: usize,
    pub transition: PointerTransition,
    pub selection_change: Option<Option<ElementId>>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PointerMachine {
    state: PointerState,
}

#[derive(Debug, Clone, Default)]
enum PointerState {
    #[default]
    Idle,
    Dragging {
        pointer_id: u32,
        element_id: ElementId,
        origin: Vec2,
        last_sequence: u64,
        expected_revision: u64,
    },
}

impl PointerMachine {
    pub fn process_batch(
        &mut self,
        expected_revision: u64,
        events: Vec<TargetedPointerEvent>,
    ) -> PointerBatchOutcome {
        let processed_event_count = events.len();
        let mut ignored_event_count = 0;
        let mut transition = PointerTransition::None;
        let mut selection_change = None;

        for event in events {
            match self.process_event(expected_revision, event) {
                EventOutcome::Ignored => ignored_event_count += 1,
                EventOutcome::Accepted {
                    transition: next_transition,
                    selection: next_selection,
                } => {
                    if next_transition != PointerTransition::None {
                        transition = next_transition;
                    }
                    if next_selection.is_some() {
                        selection_change = next_selection;
                    }
                }
            }
        }

        PointerBatchOutcome {
            processed_event_count,
            ignored_event_count,
            transition,
            selection_change,
        }
    }

    pub fn cancel(&mut self) {
        self.state = PointerState::Idle;
    }

    pub fn is_active(&self) -> bool {
        matches!(self.state, PointerState::Dragging { .. })
    }

    fn process_event(
        &mut self,
        expected_revision: u64,
        event: TargetedPointerEvent,
    ) -> EventOutcome {
        let TargetedPointerEvent {
            input,
            target_element_id,
        } = event;
        match &mut self.state {
            PointerState::Idle => {
                if input.phase != PointerPhaseV1::Down {
                    return EventOutcome::Ignored;
                }
                if let Some(element_id) = target_element_id.as_ref() {
                    self.state = PointerState::Dragging {
                        pointer_id: input.pointer_id,
                        element_id: element_id.clone(),
                        origin: input.point,
                        last_sequence: input.sequence,
                        expected_revision,
                    };
                }
                EventOutcome::Accepted {
                    transition: PointerTransition::None,
                    selection: Some(target_element_id),
                }
            }
            PointerState::Dragging {
                pointer_id,
                element_id,
                origin,
                last_sequence,
                expected_revision,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let delta = Vec2 {
                    x: input.point.x - origin.x,
                    y: input.point.y - origin.y,
                };
                let transition = match input.phase {
                    PointerPhaseV1::Move => PointerTransition::Preview(PointerPreview {
                        element_id: element_id.clone(),
                        delta,
                    }),
                    PointerPhaseV1::Up => {
                        let commit = PointerCommit {
                            element_id: element_id.clone(),
                            delta,
                            expected_revision: *expected_revision,
                        };
                        self.state = PointerState::Idle;
                        PointerTransition::Commit(commit)
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = PointerState::Idle;
                        PointerTransition::Cancelled
                    }
                    PointerPhaseV1::Down => return EventOutcome::Ignored,
                };
                EventOutcome::Accepted {
                    transition,
                    selection: None,
                }
            }
        }
    }
}

enum EventOutcome {
    Ignored,
    Accepted {
        transition: PointerTransition,
        selection: Option<Option<ElementId>>,
    },
}
