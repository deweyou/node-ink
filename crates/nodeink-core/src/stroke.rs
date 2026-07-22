use serde::{Deserialize, Serialize};

use crate::{ElementId, StrokeElementV1, Vec2};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StrokePhaseV1 {
    Down,
    Move,
    Up,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeInputBatchV1 {
    pub pointer_id: u32,
    pub sequence_start: u64,
    pub phase: StrokePhaseV1,
    pub points: Vec<Vec2>,
    pub stroke_id: Option<ElementId>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StrokePreview {
    pub stroke: StrokeElementV1,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StrokeCommit {
    pub stroke: StrokeElementV1,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum StrokeTransition {
    None,
    Preview(StrokePreview),
    Commit(StrokeCommit),
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StrokeBatchOutcome {
    pub processed_point_count: usize,
    pub ignored_point_count: usize,
    pub transition: StrokeTransition,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct StrokeMachine {
    state: StrokeState,
}

#[derive(Debug, Clone, Default)]
enum StrokeState {
    #[default]
    Idle,
    Drawing {
        pointer_id: u32,
        stroke_id: ElementId,
        points: Vec<Vec2>,
        last_sequence: u64,
        expected_revision: u64,
    },
}

impl StrokeMachine {
    pub fn process_batch(
        &mut self,
        expected_revision: u64,
        batch: StrokeInputBatchV1,
    ) -> StrokeBatchOutcome {
        let processed_point_count = batch.points.len();
        let (ignored_point_count, transition) = match batch.phase {
            StrokePhaseV1::Down => self.begin(expected_revision, batch),
            StrokePhaseV1::Move => self.append(batch),
            StrokePhaseV1::Up => self.finish(batch),
            StrokePhaseV1::Cancel => self.cancel_batch(batch.pointer_id),
        };
        StrokeBatchOutcome {
            processed_point_count,
            ignored_point_count,
            transition,
        }
    }

    pub fn cancel(&mut self) {
        self.state = StrokeState::Idle;
    }

    pub fn preview(&self) -> Option<StrokePreview> {
        let StrokeState::Drawing {
            stroke_id, points, ..
        } = &self.state
        else {
            return None;
        };
        Some(StrokePreview {
            stroke: StrokeElementV1 {
                id: stroke_id.clone(),
                points: points.clone(),
                stroke_width: 3.0,
            },
        })
    }

    fn begin(
        &mut self,
        expected_revision: u64,
        batch: StrokeInputBatchV1,
    ) -> (usize, StrokeTransition) {
        let Some(stroke_id) = batch.stroke_id else {
            return (batch.points.len(), StrokeTransition::None);
        };
        let Some(point) = batch.points.first().copied() else {
            return (0, StrokeTransition::None);
        };
        if !matches!(self.state, StrokeState::Idle) {
            return (batch.points.len(), StrokeTransition::None);
        }
        self.state = StrokeState::Drawing {
            pointer_id: batch.pointer_id,
            stroke_id: stroke_id.clone(),
            points: vec![point],
            last_sequence: batch.sequence_start,
            expected_revision,
        };
        let ignored = batch.points.len().saturating_sub(1);
        (
            ignored,
            StrokeTransition::Preview(StrokePreview {
                stroke: StrokeElementV1 {
                    id: stroke_id,
                    points: vec![point],
                    stroke_width: 3.0,
                },
            }),
        )
    }

    fn append(&mut self, batch: StrokeInputBatchV1) -> (usize, StrokeTransition) {
        let StrokeState::Drawing {
            pointer_id,
            stroke_id,
            points,
            last_sequence,
            ..
        } = &mut self.state
        else {
            return (batch.points.len(), StrokeTransition::None);
        };
        if batch.pointer_id != *pointer_id {
            return (batch.points.len(), StrokeTransition::None);
        }

        let ignored = append_ordered_points(
            points,
            last_sequence,
            batch.sequence_start,
            batch.points.into_iter(),
        );
        (
            ignored,
            StrokeTransition::Preview(StrokePreview {
                stroke: StrokeElementV1 {
                    id: stroke_id.clone(),
                    points: points.clone(),
                    stroke_width: 3.0,
                },
            }),
        )
    }

    fn finish(&mut self, batch: StrokeInputBatchV1) -> (usize, StrokeTransition) {
        let StrokeState::Drawing {
            pointer_id,
            stroke_id,
            points,
            last_sequence,
            expected_revision,
        } = &mut self.state
        else {
            return (batch.points.len(), StrokeTransition::None);
        };
        if batch.pointer_id != *pointer_id {
            return (batch.points.len(), StrokeTransition::None);
        }

        let ignored = append_ordered_points(
            points,
            last_sequence,
            batch.sequence_start,
            batch.points.into_iter(),
        );
        let transition = if points.len() >= 2 {
            StrokeTransition::Commit(StrokeCommit {
                stroke: StrokeElementV1 {
                    id: stroke_id.clone(),
                    points: points.clone(),
                    stroke_width: 3.0,
                },
                expected_revision: *expected_revision,
            })
        } else {
            StrokeTransition::Cancelled
        };
        self.state = StrokeState::Idle;
        (ignored, transition)
    }

    fn cancel_batch(&mut self, pointer_id: u32) -> (usize, StrokeTransition) {
        match self.state {
            StrokeState::Drawing {
                pointer_id: active_pointer,
                ..
            } if active_pointer == pointer_id => {
                self.state = StrokeState::Idle;
                (0, StrokeTransition::Cancelled)
            }
            _ => (0, StrokeTransition::None),
        }
    }
}

fn append_ordered_points(
    target: &mut Vec<Vec2>,
    last_sequence: &mut u64,
    sequence_start: u64,
    points: impl Iterator<Item = Vec2>,
) -> usize {
    let mut ignored = 0;
    for (offset, point) in points.enumerate() {
        let sequence = sequence_start.saturating_add(offset as u64);
        if sequence <= *last_sequence {
            ignored += 1;
            continue;
        }
        *last_sequence = sequence;
        if target.last() != Some(&point) {
            target.push(point);
        }
    }
    ignored
}
