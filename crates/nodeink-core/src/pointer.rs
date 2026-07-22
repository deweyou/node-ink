use serde::{Deserialize, Serialize};

use crate::{
    Affine2D, ElementId, OrientedSelectionBoundsV1, SelectionBoundsV1, SelectionHandleIdV1,
    SelectionMarqueeModeV1, Vec2, transform::Point2D,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointerPhaseV1 {
    Down,
    Move,
    Up,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerModifiersV1 {
    pub shift: bool,
    pub alt: bool,
    pub meta_or_ctrl: bool,
}

fn default_screen_scale() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPointerEventV1 {
    pub pointer_id: u32,
    pub sequence: u64,
    pub phase: PointerPhaseV1,
    pub point: Vec2,
    #[serde(default)]
    pub modifiers: PointerModifiersV1,
    #[serde(default = "default_screen_scale")]
    pub screen_scale: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TargetedPointerEvent {
    pub input: NormalizedPointerEventV1,
    pub target_element_id: Option<ElementId>,
    pub selected_element_ids: Vec<ElementId>,
    pub target_handle: Option<SelectionHandleIdV1>,
    pub oriented_bounds: Option<OrientedSelectionBoundsV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PointerTransformKind {
    Move,
    Resize,
    Rotate,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerTransformPreview {
    pub element_ids: Vec<ElementId>,
    pub transform: Affine2D,
    pub kind: PointerTransformKind,
    pub disable_snap: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PointerPreview {
    Transform(PointerTransformPreview),
    Marquee {
        bounds: SelectionBoundsV1,
        mode: SelectionMarqueeModeV1,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerCommit {
    pub element_ids: Vec<ElementId>,
    pub transform: Affine2D,
    pub kind: PointerTransformKind,
    pub disable_snap: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PointerTransition {
    None,
    Preview(PointerPreview),
    Commit(PointerCommit),
    MarqueeCommit {
        bounds: SelectionBoundsV1,
        mode: SelectionMarqueeModeV1,
    },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PointerSelectionChange {
    Replace(Option<ElementId>),
    Toggle(ElementId),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerBatchOutcome {
    pub processed_event_count: usize,
    pub ignored_event_count: usize,
    pub transition: PointerTransition,
    pub selection_change: Option<PointerSelectionChange>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct PointerMachine {
    state: PointerState,
}

#[derive(Debug, Clone, Default)]
enum PointerState {
    #[default]
    Idle,
    Transforming {
        pointer_id: u32,
        element_ids: Vec<ElementId>,
        origin: Vec2,
        last_sequence: u64,
        expected_revision: u64,
        gesture: TransformGesture,
    },
    Marquee {
        pointer_id: u32,
        origin: Vec2,
        last_sequence: u64,
        mode: SelectionMarqueeModeV1,
    },
}

#[derive(Debug, Clone)]
enum TransformGesture {
    Move,
    Resize {
        handle: SelectionHandleIdV1,
        bounds: OrientedSelectionBoundsV1,
    },
    Rotate {
        bounds: OrientedSelectionBoundsV1,
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
        !matches!(self.state, PointerState::Idle)
    }

    fn process_event(
        &mut self,
        expected_revision: u64,
        event: TargetedPointerEvent,
    ) -> EventOutcome {
        let TargetedPointerEvent {
            input,
            target_element_id,
            selected_element_ids,
            target_handle,
            oriented_bounds,
        } = event;
        if !valid_input(&input) {
            return EventOutcome::Ignored;
        }
        match &mut self.state {
            PointerState::Idle => {
                if input.phase != PointerPhaseV1::Down {
                    return EventOutcome::Ignored;
                }
                if let (Some(handle), Some(bounds)) = (target_handle, oriented_bounds) {
                    if !selected_element_ids.is_empty() {
                        let gesture = if handle == SelectionHandleIdV1::Rotate {
                            TransformGesture::Rotate { bounds }
                        } else {
                            TransformGesture::Resize { handle, bounds }
                        };
                        self.state = PointerState::Transforming {
                            pointer_id: input.pointer_id,
                            element_ids: selected_element_ids,
                            origin: input.point,
                            last_sequence: input.sequence,
                            expected_revision,
                            gesture,
                        };
                    }
                    return EventOutcome::accepted(PointerTransition::None, None);
                }
                if let Some(element_id) = target_element_id {
                    if input.modifiers.shift {
                        return EventOutcome::accepted(
                            PointerTransition::None,
                            Some(PointerSelectionChange::Toggle(element_id)),
                        );
                    }
                    let was_selected = selected_element_ids.contains(&element_id);
                    let element_ids = if was_selected {
                        selected_element_ids
                    } else {
                        vec![element_id.clone()]
                    };
                    self.state = PointerState::Transforming {
                        pointer_id: input.pointer_id,
                        element_ids,
                        origin: input.point,
                        last_sequence: input.sequence,
                        expected_revision,
                        gesture: TransformGesture::Move,
                    };
                    let selection = (!was_selected)
                        .then_some(PointerSelectionChange::Replace(Some(element_id)));
                    return EventOutcome::accepted(PointerTransition::None, selection);
                }
                let mode = if input.modifiers.shift {
                    SelectionMarqueeModeV1::Toggle
                } else {
                    SelectionMarqueeModeV1::Replace
                };
                self.state = PointerState::Marquee {
                    pointer_id: input.pointer_id,
                    origin: input.point,
                    last_sequence: input.sequence,
                    mode,
                };
                EventOutcome::accepted(
                    PointerTransition::None,
                    (!input.modifiers.shift).then_some(PointerSelectionChange::Replace(None)),
                )
            }
            PointerState::Transforming {
                pointer_id,
                element_ids,
                origin,
                last_sequence,
                expected_revision,
                gesture,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let transform =
                    match gesture_transform(gesture, *origin, input.point, input.modifiers) {
                        Some(transform) => transform,
                        None => return EventOutcome::Ignored,
                    };
                let kind = match gesture {
                    TransformGesture::Move => PointerTransformKind::Move,
                    TransformGesture::Resize { .. } => PointerTransformKind::Resize,
                    TransformGesture::Rotate { .. } => PointerTransformKind::Rotate,
                };
                let transition = match input.phase {
                    PointerPhaseV1::Move => PointerTransition::Preview(PointerPreview::Transform(
                        PointerTransformPreview {
                            element_ids: element_ids.clone(),
                            transform,
                            kind,
                            disable_snap: input.modifiers.meta_or_ctrl,
                        },
                    )),
                    PointerPhaseV1::Up => {
                        let commit = PointerCommit {
                            element_ids: element_ids.clone(),
                            transform,
                            kind,
                            disable_snap: input.modifiers.meta_or_ctrl,
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
                EventOutcome::accepted(transition, None)
            }
            PointerState::Marquee {
                pointer_id,
                origin,
                last_sequence,
                mode,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let bounds = SelectionBoundsV1::from_points(*origin, input.point)
                    .expect("validated pointer points produce marquee bounds");
                let transition = match input.phase {
                    PointerPhaseV1::Move => PointerTransition::Preview(PointerPreview::Marquee {
                        bounds,
                        mode: *mode,
                    }),
                    PointerPhaseV1::Up => {
                        let mode = *mode;
                        self.state = PointerState::Idle;
                        PointerTransition::MarqueeCommit { bounds, mode }
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = PointerState::Idle;
                        PointerTransition::Cancelled
                    }
                    PointerPhaseV1::Down => return EventOutcome::Ignored,
                };
                EventOutcome::accepted(transition, None)
            }
        }
    }
}

impl EventOutcome {
    fn accepted(transition: PointerTransition, selection: Option<PointerSelectionChange>) -> Self {
        Self::Accepted {
            transition,
            selection,
        }
    }
}

enum EventOutcome {
    Ignored,
    Accepted {
        transition: PointerTransition,
        selection: Option<PointerSelectionChange>,
    },
}

fn valid_input(input: &NormalizedPointerEventV1) -> bool {
    input.point.x.is_finite()
        && input.point.y.is_finite()
        && input.screen_scale.is_finite()
        && input.screen_scale > 0.0
}

fn gesture_transform(
    gesture: &TransformGesture,
    origin: Vec2,
    point: Vec2,
    modifiers: PointerModifiersV1,
) -> Option<Affine2D> {
    match gesture {
        TransformGesture::Move => {
            Affine2D::translation(Point2D::new(point.x - origin.x, point.y - origin.y)).ok()
        }
        TransformGesture::Rotate { bounds } => {
            let center = Point2D::new(bounds.center.x, bounds.center.y);
            let start_angle = (origin.y - center.y).atan2(origin.x - center.x);
            let current_angle = (point.y - center.y).atan2(point.x - center.x);
            let mut delta = current_angle - start_angle;
            if modifiers.shift {
                let step = std::f64::consts::PI / 12.0;
                delta = (delta / step).round() * step;
            }
            Affine2D::rotation(delta).ok()?.around(center).ok()
        }
        TransformGesture::Resize { handle, bounds } => {
            resize_transform(*handle, *bounds, origin, point, modifiers)
        }
    }
}

fn resize_transform(
    handle: SelectionHandleIdV1,
    bounds: OrientedSelectionBoundsV1,
    origin: Vec2,
    point: Vec2,
    modifiers: PointerModifiersV1,
) -> Option<Affine2D> {
    let center = Point2D::new(bounds.center.x, bounds.center.y);
    let opposite = opposite_local(handle, bounds.width / 2.0, bounds.height / 2.0)?;
    let (sin, cos) = bounds.rotation.sin_cos();
    let pivot = if modifiers.alt {
        center
    } else {
        Point2D::new(
            center.x + opposite.x * cos - opposite.y * sin,
            center.y + opposite.x * sin + opposite.y * cos,
        )
    };
    let start = world_vector_in_axes(origin, pivot, cos, sin);
    let current = world_vector_in_axes(point, pivot, cos, sin);
    let affects_x = !matches!(
        handle,
        SelectionHandleIdV1::North | SelectionHandleIdV1::South
    );
    let affects_y = !matches!(
        handle,
        SelectionHandleIdV1::East | SelectionHandleIdV1::West
    );
    let mut scale_x = if affects_x && start.x.abs() > f64::EPSILON {
        current.x / start.x
    } else {
        1.0
    };
    let mut scale_y = if affects_y && start.y.abs() > f64::EPSILON {
        current.y / start.y
    } else {
        1.0
    };
    if modifiers.shift && affects_x && affects_y {
        let uniform = if (scale_x - 1.0).abs() >= (scale_y - 1.0).abs() {
            scale_x
        } else {
            scale_y
        };
        scale_x = uniform;
        scale_y = uniform;
    }
    scale_x = scale_x.max(0.01);
    scale_y = scale_y.max(0.01);
    let to_local = Affine2D::rotation(-bounds.rotation)
        .ok()?
        .around(pivot)
        .ok()?;
    let scale = Affine2D::scale(scale_x, scale_y).ok()?.around(pivot).ok()?;
    let to_world = Affine2D::rotation(bounds.rotation)
        .ok()?
        .around(pivot)
        .ok()?;
    to_local.compose(scale).ok()?.compose(to_world).ok()
}

fn world_vector_in_axes(point: Vec2, pivot: Point2D, cos: f64, sin: f64) -> Point2D {
    let x = point.x - pivot.x;
    let y = point.y - pivot.y;
    Point2D::new(x * cos + y * sin, -x * sin + y * cos)
}

fn opposite_local(
    handle: SelectionHandleIdV1,
    half_width: f64,
    half_height: f64,
) -> Option<Point2D> {
    Some(match handle {
        SelectionHandleIdV1::NorthWest => Point2D::new(half_width, half_height),
        SelectionHandleIdV1::North => Point2D::new(0.0, half_height),
        SelectionHandleIdV1::NorthEast => Point2D::new(-half_width, half_height),
        SelectionHandleIdV1::East => Point2D::new(-half_width, 0.0),
        SelectionHandleIdV1::SouthEast => Point2D::new(-half_width, -half_height),
        SelectionHandleIdV1::South => Point2D::new(0.0, -half_height),
        SelectionHandleIdV1::SouthWest => Point2D::new(half_width, -half_height),
        SelectionHandleIdV1::West => Point2D::new(half_width, 0.0),
        SelectionHandleIdV1::Rotate => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_pointer_wire_defaults_modifiers_and_screen_scale() {
        let event: NormalizedPointerEventV1 = serde_json::from_str(
            r#"{"pointerId":1,"sequence":0,"phase":"down","point":{"x":1.0,"y":2.0}}"#,
        )
        .expect("legacy pointer event remains readable");

        assert_eq!(event.modifiers, PointerModifiersV1::default());
        assert_eq!(event.screen_scale, 1.0);
    }

    fn event(phase: PointerPhaseV1, sequence: u64, point: Vec2) -> NormalizedPointerEventV1 {
        NormalizedPointerEventV1 {
            pointer_id: 1,
            sequence,
            phase,
            point,
            modifiers: PointerModifiersV1::default(),
            screen_scale: 1.0,
        }
    }

    #[test]
    fn move_preview_and_commit_use_one_affine_delta() {
        let mut machine = PointerMachine::default();
        let targeted = |input| TargetedPointerEvent {
            input,
            target_element_id: Some("rect".to_string()),
            selected_element_ids: vec!["rect".to_string()],
            target_handle: None,
            oriented_bounds: None,
        };
        machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Down,
                1,
                Vec2 { x: 2.0, y: 3.0 },
            ))],
        );
        let outcome = machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Up,
                2,
                Vec2 { x: 12.0, y: 8.0 },
            ))],
        );
        let PointerTransition::Commit(commit) = outcome.transition else {
            panic!("move commits")
        };
        assert_eq!(commit.element_ids, ["rect"]);
        assert_eq!(commit.transform.e, 10.0);
        assert_eq!(commit.transform.f, 5.0);
        assert_eq!(commit.expected_revision, 7);
    }

    #[test]
    fn blank_drag_produces_marquee_without_document_commit() {
        let mut machine = PointerMachine::default();
        let targeted = |input| TargetedPointerEvent {
            input,
            target_element_id: None,
            selected_element_ids: Vec::new(),
            target_handle: None,
            oriented_bounds: None,
        };
        machine.process_batch(
            0,
            vec![targeted(event(
                PointerPhaseV1::Down,
                1,
                Vec2 { x: 10.0, y: 20.0 },
            ))],
        );
        let outcome = machine.process_batch(
            0,
            vec![targeted(event(
                PointerPhaseV1::Up,
                2,
                Vec2 { x: 4.0, y: 32.0 },
            ))],
        );
        assert_eq!(
            outcome.transition,
            PointerTransition::MarqueeCommit {
                bounds: SelectionBoundsV1 {
                    x: 4.0,
                    y: 20.0,
                    width: 6.0,
                    height: 12.0
                },
                mode: SelectionMarqueeModeV1::Replace,
            }
        );
    }

    #[test]
    fn corner_resize_clamps_before_flip_and_shift_preserves_aspect() {
        let bounds = OrientedSelectionBoundsV1 {
            center: Vec2 { x: 50.0, y: 40.0 },
            width: 100.0,
            height: 80.0,
            rotation: 0.0,
        };
        let unconstrained = resize_transform(
            SelectionHandleIdV1::SouthEast,
            bounds,
            Vec2 { x: 100.0, y: 80.0 },
            Vec2 { x: 150.0, y: 100.0 },
            PointerModifiersV1::default(),
        )
        .unwrap();
        assert_eq!(unconstrained.a, 1.5);
        assert_eq!(unconstrained.d, 1.25);

        let constrained = resize_transform(
            SelectionHandleIdV1::SouthEast,
            bounds,
            Vec2 { x: 100.0, y: 80.0 },
            Vec2 { x: 150.0, y: 100.0 },
            PointerModifiersV1 {
                shift: true,
                ..PointerModifiersV1::default()
            },
        )
        .unwrap();
        assert_eq!(constrained.a, constrained.d);

        let clamped = resize_transform(
            SelectionHandleIdV1::East,
            bounds,
            Vec2 { x: 100.0, y: 40.0 },
            Vec2 { x: -100.0, y: 40.0 },
            PointerModifiersV1::default(),
        )
        .unwrap();
        assert_eq!(clamped.a, 0.01);
    }

    #[test]
    fn shift_rotation_snaps_to_fifteen_degrees() {
        let bounds = OrientedSelectionBoundsV1 {
            center: Vec2 { x: 0.0, y: 0.0 },
            width: 100.0,
            height: 80.0,
            rotation: 0.0,
        };
        let transform = gesture_transform(
            &TransformGesture::Rotate { bounds },
            Vec2 { x: 1.0, y: 0.0 },
            Vec2 { x: 1.0, y: 0.3 },
            PointerModifiersV1 {
                shift: true,
                ..PointerModifiersV1::default()
            },
        )
        .unwrap();
        let angle = transform.b.atan2(transform.a);
        assert!((angle - std::f64::consts::PI / 12.0).abs() < 1e-10);
    }
}
