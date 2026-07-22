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
        events: Vec<NormalizedPointerEventV1>,
    ) -> PointerBatchOutcome {
        let processed_event_count = events.len();
        let mut ignored_event_count = 0;
        let mut transition = PointerTransition::None;

        for event in events {
            match self.process_event(expected_revision, event) {
                EventOutcome::Ignored => ignored_event_count += 1,
                EventOutcome::Accepted(next_transition) => {
                    if next_transition != PointerTransition::None {
                        transition = next_transition;
                    }
                }
            }
        }

        PointerBatchOutcome {
            processed_event_count,
            ignored_event_count,
            transition,
        }
    }

    pub fn cancel(&mut self) {
        self.state = PointerState::Idle;
    }

    fn process_event(
        &mut self,
        expected_revision: u64,
        event: NormalizedPointerEventV1,
    ) -> EventOutcome {
        match &mut self.state {
            PointerState::Idle => {
                let Some(element_id) = event.target_element_id else {
                    return EventOutcome::Ignored;
                };
                if event.phase != PointerPhaseV1::Down {
                    return EventOutcome::Ignored;
                }
                self.state = PointerState::Dragging {
                    pointer_id: event.pointer_id,
                    element_id,
                    origin: event.point,
                    last_sequence: event.sequence,
                    expected_revision,
                };
                EventOutcome::Accepted(PointerTransition::None)
            }
            PointerState::Dragging {
                pointer_id,
                element_id,
                origin,
                last_sequence,
                expected_revision,
            } => {
                if event.pointer_id != *pointer_id || event.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = event.sequence;
                let delta = Vec2 {
                    x: event.point.x - origin.x,
                    y: event.point.y - origin.y,
                };
                match event.phase {
                    PointerPhaseV1::Move => {
                        EventOutcome::Accepted(PointerTransition::Preview(PointerPreview {
                            element_id: element_id.clone(),
                            delta,
                        }))
                    }
                    PointerPhaseV1::Up => {
                        let commit = PointerCommit {
                            element_id: element_id.clone(),
                            delta,
                            expected_revision: *expected_revision,
                        };
                        self.state = PointerState::Idle;
                        EventOutcome::Accepted(PointerTransition::Commit(commit))
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = PointerState::Idle;
                        EventOutcome::Accepted(PointerTransition::Cancelled)
                    }
                    PointerPhaseV1::Down => EventOutcome::Ignored,
                }
            }
        }
    }
}

enum EventOutcome {
    Ignored,
    Accepted(PointerTransition),
}
