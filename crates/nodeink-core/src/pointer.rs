use serde::{Deserialize, Serialize};

use crate::{
    Affine2D, ElementId, OrientedSelectionBoundsV1, PathCurveV1, SelectionBoundsV1,
    SelectionHandleIdV1, SelectionMarqueeModeV1, TextAlignV1, Vec2,
    shape_geometry::curve_from_midpoint, transform::Point2D,
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

const CLICK_DRAG_THRESHOLD_SCREEN_PX: f64 = 3.0;

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
    pub target_vertex: Option<TargetedVertexHandle>,
    pub target_curve: Option<TargetedCurveHandle>,
    pub target_text_resize: Option<TargetedTextResize>,
    pub oriented_bounds: Option<OrientedSelectionBoundsV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TargetedVertexHandle {
    pub element_id: ElementId,
    pub vertex_index: usize,
    pub points: Vec<Vec2>,
    pub world_to_local: Affine2D,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TargetedCurveHandle {
    pub element_id: ElementId,
    pub points: Vec<Vec2>,
    pub curve: Option<PathCurveV1>,
    pub world_to_local: Affine2D,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TargetedTextResize {
    pub element_id: ElementId,
    pub handle: SelectionHandleIdV1,
    pub world_to_local: Affine2D,
    pub x: f64,
    pub y: f64,
    pub font_size: f64,
    pub max_width: Option<f64>,
    pub text_align: TextAlignV1,
    pub measured_width: f64,
    pub measured_height: f64,
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
    TextResize(PointerTextResizePreview),
    Vertex(PointerVertexPreview),
    Curve(PointerCurvePreview),
    Marquee {
        bounds: SelectionBoundsV1,
        mode: SelectionMarqueeModeV1,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerTextResizePreview {
    pub element_id: ElementId,
    pub x: f64,
    pub y: f64,
    pub font_size: f64,
    pub max_width: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerVertexPreview {
    pub element_id: ElementId,
    pub vertex_index: usize,
    pub points: Vec<Vec2>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PointerCurvePreview {
    pub element_id: ElementId,
    pub curve: Option<PathCurveV1>,
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
    TextResizeCommit {
        preview: PointerTextResizePreview,
        expected_revision: u64,
    },
    VertexCommit {
        preview: PointerVertexPreview,
        expected_revision: u64,
    },
    CurveCommit {
        preview: PointerCurvePreview,
        expected_revision: u64,
    },
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
    ClearVertex,
    Vertex {
        element_id: ElementId,
        vertex_index: usize,
    },
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
    preview: Option<PointerPreview>,
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
    ResizingText {
        pointer_id: u32,
        origin: Vec2,
        target: TargetedTextResize,
        last_sequence: u64,
        expected_revision: u64,
    },
    EditingVertex {
        pointer_id: u32,
        element_id: ElementId,
        vertex_index: usize,
        points: Vec<Vec2>,
        world_to_local: Affine2D,
        last_sequence: u64,
        expected_revision: u64,
    },
    EditingCurve {
        pointer_id: u32,
        element_id: ElementId,
        points: Vec<Vec2>,
        curve: Option<PathCurveV1>,
        world_to_local: Affine2D,
        last_sequence: u64,
        expected_revision: u64,
    },
    ShiftTarget {
        pointer_id: u32,
        target_element_id: ElementId,
        selected_element_ids: Vec<ElementId>,
        target_was_selected: bool,
        origin: Vec2,
        last_sequence: u64,
        expected_revision: u64,
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

        match &transition {
            PointerTransition::Preview(preview) => self.preview = Some(preview.clone()),
            PointerTransition::Commit(_)
            | PointerTransition::TextResizeCommit { .. }
            | PointerTransition::VertexCommit { .. }
            | PointerTransition::CurveCommit { .. }
            | PointerTransition::MarqueeCommit { .. }
            | PointerTransition::Cancelled => self.preview = None,
            PointerTransition::None => {}
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
        self.preview = None;
    }

    pub fn is_active(&self) -> bool {
        !matches!(self.state, PointerState::Idle)
    }

    pub fn preview(&self) -> Option<&PointerPreview> {
        self.preview.as_ref()
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
            target_vertex,
            target_curve,
            target_text_resize,
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
                if let Some(target_vertex) = target_vertex {
                    self.state = PointerState::EditingVertex {
                        pointer_id: input.pointer_id,
                        element_id: target_vertex.element_id.clone(),
                        vertex_index: target_vertex.vertex_index,
                        points: target_vertex.points,
                        world_to_local: target_vertex.world_to_local,
                        last_sequence: input.sequence,
                        expected_revision,
                    };
                    return EventOutcome::accepted(
                        PointerTransition::None,
                        Some(PointerSelectionChange::Vertex {
                            element_id: target_vertex.element_id,
                            vertex_index: target_vertex.vertex_index,
                        }),
                    );
                }
                if let Some(target_curve) = target_curve {
                    self.state = PointerState::EditingCurve {
                        pointer_id: input.pointer_id,
                        element_id: target_curve.element_id,
                        points: target_curve.points,
                        curve: target_curve.curve,
                        world_to_local: target_curve.world_to_local,
                        last_sequence: input.sequence,
                        expected_revision,
                    };
                    return EventOutcome::accepted(PointerTransition::None, None);
                }
                if let Some(target) = target_text_resize {
                    self.state = PointerState::ResizingText {
                        pointer_id: input.pointer_id,
                        origin: input.point,
                        target,
                        last_sequence: input.sequence,
                        expected_revision,
                    };
                    return EventOutcome::accepted(PointerTransition::None, None);
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
                        let target_was_selected = selected_element_ids.contains(&element_id);
                        self.state = PointerState::ShiftTarget {
                            pointer_id: input.pointer_id,
                            target_element_id: element_id,
                            selected_element_ids,
                            target_was_selected,
                            origin: input.point,
                            last_sequence: input.sequence,
                            expected_revision,
                        };
                        return EventOutcome::accepted(PointerTransition::None, None);
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
                    let selection = if was_selected {
                        Some(PointerSelectionChange::ClearVertex)
                    } else {
                        Some(PointerSelectionChange::Replace(Some(element_id)))
                    };
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
            PointerState::ShiftTarget {
                pointer_id,
                target_element_id,
                selected_element_ids,
                target_was_selected,
                origin,
                last_sequence,
                expected_revision,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                if input.phase == PointerPhaseV1::Cancel {
                    self.state = PointerState::Idle;
                    return EventOutcome::accepted(PointerTransition::Cancelled, None);
                }
                let delta = Point2D::new(input.point.x - origin.x, input.point.y - origin.y);
                let crossed_drag_threshold =
                    delta.x.hypot(delta.y) * input.screen_scale >= CLICK_DRAG_THRESHOLD_SCREEN_PX;
                if !crossed_drag_threshold {
                    if input.phase == PointerPhaseV1::Up {
                        let element_id = target_element_id.clone();
                        self.state = PointerState::Idle;
                        return EventOutcome::accepted(
                            PointerTransition::None,
                            Some(PointerSelectionChange::Toggle(element_id)),
                        );
                    }
                    return EventOutcome::accepted(PointerTransition::None, None);
                }

                let mut element_ids = selected_element_ids.clone();
                if !*target_was_selected {
                    element_ids.push(target_element_id.clone());
                }
                let transform = gesture_transform(
                    &TransformGesture::Move,
                    *origin,
                    input.point,
                    input.modifiers,
                )
                .expect("validated pointer points produce a translation");
                let preview = PointerTransformPreview {
                    element_ids: element_ids.clone(),
                    transform,
                    kind: PointerTransformKind::Move,
                    disable_snap: input.modifiers.meta_or_ctrl,
                };
                let selection = if *target_was_selected {
                    Some(PointerSelectionChange::ClearVertex)
                } else {
                    Some(PointerSelectionChange::Toggle(target_element_id.clone()))
                };
                let transition = if input.phase == PointerPhaseV1::Up {
                    let commit = PointerCommit {
                        element_ids,
                        transform,
                        kind: PointerTransformKind::Move,
                        disable_snap: input.modifiers.meta_or_ctrl,
                        expected_revision: *expected_revision,
                    };
                    self.state = PointerState::Idle;
                    PointerTransition::Commit(commit)
                } else {
                    self.state = PointerState::Transforming {
                        pointer_id: input.pointer_id,
                        element_ids,
                        origin: *origin,
                        last_sequence: input.sequence,
                        expected_revision: *expected_revision,
                        gesture: TransformGesture::Move,
                    };
                    PointerTransition::Preview(PointerPreview::Transform(preview))
                };
                EventOutcome::accepted(transition, selection)
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
            PointerState::ResizingText {
                pointer_id,
                origin,
                target,
                last_sequence,
                expected_revision,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let Some(preview) = resize_text(target, *origin, input.point, input.modifiers.alt)
                else {
                    return EventOutcome::Ignored;
                };
                let transition = match input.phase {
                    PointerPhaseV1::Move => {
                        PointerTransition::Preview(PointerPreview::TextResize(preview))
                    }
                    PointerPhaseV1::Up => {
                        let expected_revision = *expected_revision;
                        let did_change = preview.x != target.x
                            || preview.y != target.y
                            || preview.font_size != target.font_size
                            || preview.max_width != target.max_width;
                        self.state = PointerState::Idle;
                        if did_change {
                            PointerTransition::TextResizeCommit {
                                preview,
                                expected_revision,
                            }
                        } else {
                            PointerTransition::None
                        }
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = PointerState::Idle;
                        PointerTransition::Cancelled
                    }
                    PointerPhaseV1::Down => return EventOutcome::Ignored,
                };
                EventOutcome::accepted(transition, None)
            }
            PointerState::EditingVertex {
                pointer_id,
                element_id,
                vertex_index,
                points,
                world_to_local,
                last_sequence,
                expected_revision,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let transition = match input.phase {
                    PointerPhaseV1::Move | PointerPhaseV1::Up => {
                        let Ok(local) =
                            world_to_local.apply(Point2D::new(input.point.x, input.point.y))
                        else {
                            return EventOutcome::Ignored;
                        };
                        let Some(next_points) = move_vertex(
                            points,
                            *vertex_index,
                            Vec2 {
                                x: local.x,
                                y: local.y,
                            },
                            input.modifiers.shift,
                        ) else {
                            return EventOutcome::Ignored;
                        };
                        let preview = PointerVertexPreview {
                            element_id: element_id.clone(),
                            vertex_index: *vertex_index,
                            points: next_points,
                        };
                        if input.phase == PointerPhaseV1::Up {
                            let expected_revision = *expected_revision;
                            let did_change = preview.points != *points;
                            self.state = PointerState::Idle;
                            if did_change {
                                PointerTransition::VertexCommit {
                                    preview,
                                    expected_revision,
                                }
                            } else {
                                PointerTransition::None
                            }
                        } else {
                            PointerTransition::Preview(PointerPreview::Vertex(preview))
                        }
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = PointerState::Idle;
                        PointerTransition::Cancelled
                    }
                    PointerPhaseV1::Down => return EventOutcome::Ignored,
                };
                EventOutcome::accepted(transition, None)
            }
            PointerState::EditingCurve {
                pointer_id,
                element_id,
                points,
                curve,
                world_to_local,
                last_sequence,
                expected_revision,
            } => {
                if input.pointer_id != *pointer_id || input.sequence <= *last_sequence {
                    return EventOutcome::Ignored;
                }
                *last_sequence = input.sequence;
                let transition = match input.phase {
                    PointerPhaseV1::Move | PointerPhaseV1::Up => {
                        let Ok(local) =
                            world_to_local.apply(Point2D::new(input.point.x, input.point.y))
                        else {
                            return EventOutcome::Ignored;
                        };
                        let next_curve = curve_from_midpoint(
                            points,
                            Vec2 {
                                x: local.x,
                                y: local.y,
                            },
                        );
                        let preview = PointerCurvePreview {
                            element_id: element_id.clone(),
                            curve: next_curve,
                        };
                        if input.phase == PointerPhaseV1::Up {
                            let expected_revision = *expected_revision;
                            let did_change = preview.curve != *curve;
                            self.state = PointerState::Idle;
                            if did_change {
                                PointerTransition::CurveCommit {
                                    preview,
                                    expected_revision,
                                }
                            } else {
                                PointerTransition::None
                            }
                        } else {
                            PointerTransition::Preview(PointerPreview::Curve(preview))
                        }
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

fn resize_text(
    target: &TargetedTextResize,
    origin: Vec2,
    point: Vec2,
    from_center: bool,
) -> Option<PointerTextResizePreview> {
    let origin = target
        .world_to_local
        .apply(Point2D::new(origin.x, origin.y))
        .ok()?;
    let point = target
        .world_to_local
        .apply(Point2D::new(point.x, point.y))
        .ok()?;
    let delta = Point2D::new(point.x - origin.x, point.y - origin.y);
    if matches!(
        target.handle,
        SelectionHandleIdV1::East | SelectionHandleIdV1::West
    ) {
        return resize_text_width(target, delta.x, from_center);
    }
    resize_text_proportionally(target, delta, from_center)
}

fn resize_text_width(
    target: &TargetedTextResize,
    delta_x: f64,
    from_center: bool,
) -> Option<PointerTextResizePreview> {
    let direction = if target.handle == SelectionHandleIdV1::East {
        1.0
    } else {
        -1.0
    };
    let width_delta = direction * delta_x * if from_center { 2.0 } else { 1.0 };
    let width = (target.measured_width + width_delta).max(target.font_size);
    if !width.is_finite() {
        return None;
    }
    let left = aligned_left(target.x, target.measured_width, target.text_align);
    let next_left = if from_center {
        left + (target.measured_width - width) / 2.0
    } else if target.handle == SelectionHandleIdV1::West {
        left + target.measured_width - width
    } else {
        left
    };
    Some(PointerTextResizePreview {
        element_id: target.element_id.clone(),
        x: aligned_anchor(next_left, width, target.text_align),
        y: target.y,
        font_size: target.font_size,
        max_width: Some(width),
    })
}

fn resize_text_proportionally(
    target: &TargetedTextResize,
    delta: Point2D,
    from_center: bool,
) -> Option<PointerTextResizePreview> {
    let horizontal = match target.handle {
        SelectionHandleIdV1::NorthEast | SelectionHandleIdV1::SouthEast => 1.0,
        SelectionHandleIdV1::NorthWest | SelectionHandleIdV1::SouthWest => -1.0,
        _ => return None,
    };
    let vertical = match target.handle {
        SelectionHandleIdV1::SouthEast | SelectionHandleIdV1::SouthWest => 1.0,
        SelectionHandleIdV1::NorthEast | SelectionHandleIdV1::NorthWest => -1.0,
        _ => return None,
    };
    let pivot_fraction = if from_center { 0.5 } else { 1.0 };
    let handle_vector = Point2D::new(
        horizontal * target.measured_width * pivot_fraction,
        vertical * target.measured_height * pivot_fraction,
    );
    let target_vector = Point2D::new(handle_vector.x + delta.x, handle_vector.y + delta.y);
    let scale_denominator = handle_vector.x * handle_vector.x + handle_vector.y * handle_vector.y;
    if !scale_denominator.is_finite() || scale_denominator <= f64::EPSILON {
        return None;
    }
    let requested_scale =
        (target_vector.x * handle_vector.x + target_vector.y * handle_vector.y) / scale_denominator;
    let font_size = (target.font_size * requested_scale).clamp(1.0, 512.0);
    let scale = font_size / target.font_size;
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let left = aligned_left(target.x, target.measured_width, target.text_align);
    let right = left + target.measured_width;
    let bottom = target.y + target.measured_height;
    let pivot = if from_center {
        Point2D::new(
            left + target.measured_width / 2.0,
            target.y + target.measured_height / 2.0,
        )
    } else {
        Point2D::new(
            if horizontal > 0.0 { left } else { right },
            if vertical > 0.0 { target.y } else { bottom },
        )
    };
    Some(PointerTextResizePreview {
        element_id: target.element_id.clone(),
        x: pivot.x + (target.x - pivot.x) * scale,
        y: pivot.y + (target.y - pivot.y) * scale,
        font_size,
        max_width: target.max_width.map(|width| width * scale),
    })
}

fn aligned_left(anchor: f64, width: f64, align: TextAlignV1) -> f64 {
    match align {
        TextAlignV1::Start => anchor,
        TextAlignV1::Center => anchor - width / 2.0,
        TextAlignV1::End => anchor - width,
    }
}

fn aligned_anchor(left: f64, width: f64, align: TextAlignV1) -> f64 {
    match align {
        TextAlignV1::Start => left,
        TextAlignV1::Center => left + width / 2.0,
        TextAlignV1::End => left + width,
    }
}

fn move_vertex(
    points: &[Vec2],
    vertex_index: usize,
    point: Vec2,
    constrain_to_forty_five_degrees: bool,
) -> Option<Vec<Vec2>> {
    if vertex_index >= points.len() || !point.x.is_finite() || !point.y.is_finite() {
        return None;
    }
    let point = if constrain_to_forty_five_degrees {
        constrained_vertex(points, vertex_index, point)?
    } else {
        point
    };
    let mut next = points.to_vec();
    next[vertex_index] = point;
    Some(next)
}

fn constrained_vertex(points: &[Vec2], vertex_index: usize, point: Vec2) -> Option<Vec2> {
    let previous = vertex_index
        .checked_sub(1)
        .and_then(|index| points.get(index));
    let next = points.get(vertex_index + 1);
    match (previous, next) {
        (Some(previous), Some(next)) => {
            let from_previous = snap_point_to_forty_five_degrees(*previous, point)?;
            let from_next = snap_point_to_forty_five_degrees(*next, point)?;
            let previous_correction = squared_distance(from_previous, point);
            let next_correction = squared_distance(from_next, point);
            Some(if previous_correction <= next_correction {
                from_previous
            } else {
                from_next
            })
        }
        (Some(anchor), None) | (None, Some(anchor)) => {
            snap_point_to_forty_five_degrees(*anchor, point)
        }
        (None, None) => None,
    }
}

fn snap_point_to_forty_five_degrees(anchor: Vec2, point: Vec2) -> Option<Vec2> {
    let delta_x = point.x - anchor.x;
    let delta_y = point.y - anchor.y;
    let length = delta_x.hypot(delta_y);
    if !length.is_finite() {
        return None;
    }
    if length <= f64::EPSILON {
        return Some(point);
    }
    let step = std::f64::consts::FRAC_PI_4;
    let angle = (delta_y.atan2(delta_x) / step).round() * step;
    Some(Vec2 {
        x: anchor.x + length * angle.cos(),
        y: anchor.y + length * angle.sin(),
    })
}

fn squared_distance(first: Vec2, second: Vec2) -> f64 {
    let delta_x = first.x - second.x;
    let delta_y = first.y - second.y;
    delta_x * delta_x + delta_y * delta_y
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
            let mut delta = Point2D::new(point.x - origin.x, point.y - origin.y);
            if modifiers.shift {
                if delta.x.abs() >= delta.y.abs() {
                    delta.y = 0.0;
                } else {
                    delta.x = 0.0;
                }
            }
            Affine2D::translation(delta).ok()
        }
        TransformGesture::Rotate { bounds } => {
            let center = Point2D::new(bounds.center.x, bounds.center.y);
            let start_angle = (origin.y - center.y).atan2(origin.x - center.x);
            let current_angle = (point.y - center.y).atan2(point.x - center.x);
            let mut delta = current_angle - start_angle;
            if modifiers.shift {
                let step = std::f64::consts::FRAC_PI_4;
                let final_orientation = bounds.rotation + delta;
                delta = (final_orientation / step).round() * step - bounds.rotation;
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
        SelectionHandleIdV1::Rotate | SelectionHandleIdV1::Vertex | SelectionHandleIdV1::Curve => {
            return None;
        }
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
            target_vertex: None,
            target_curve: None,
            target_text_resize: None,
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
    fn shift_click_toggles_selection_while_shift_drag_starts_axis_locked_move() {
        let targeted = |mut input: NormalizedPointerEventV1| {
            input.modifiers.shift = true;
            TargetedPointerEvent {
                input,
                target_element_id: Some("rect".to_string()),
                selected_element_ids: vec!["rect".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: None,
                target_text_resize: None,
                oriented_bounds: None,
            }
        };
        let mut click_machine = PointerMachine::default();
        click_machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Down,
                1,
                Vec2 { x: 2.0, y: 3.0 },
            ))],
        );
        let click = click_machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Up,
                2,
                Vec2 { x: 2.0, y: 3.0 },
            ))],
        );
        assert_eq!(
            click.selection_change,
            Some(PointerSelectionChange::Toggle("rect".to_string()))
        );

        let mut drag_machine = PointerMachine::default();
        drag_machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Down,
                1,
                Vec2 { x: 2.0, y: 3.0 },
            ))],
        );
        let drag = drag_machine.process_batch(
            7,
            vec![targeted(event(
                PointerPhaseV1::Move,
                2,
                Vec2 { x: 42.0, y: 13.0 },
            ))],
        );
        let PointerTransition::Preview(PointerPreview::Transform(preview)) = drag.transition else {
            panic!("Shift drag should start a transform preview")
        };
        assert_eq!((preview.transform.e, preview.transform.f), (40.0, 0.0));
        assert_eq!(
            drag.selection_change,
            Some(PointerSelectionChange::ClearVertex)
        );
    }

    #[test]
    fn vertex_constraint_helpers_cover_invalid_and_middle_vertex_edges() {
        let points = [
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: 10.0, y: 10.0 },
            Vec2 { x: 20.0, y: 0.0 },
        ];

        assert!(move_vertex(&points, 3, Vec2 { x: 1.0, y: 1.0 }, false).is_none());
        assert!(
            move_vertex(
                &points,
                1,
                Vec2 {
                    x: f64::NAN,
                    y: 1.0
                },
                false
            )
            .is_none()
        );
        assert!(
            snap_point_to_forty_five_degrees(
                Vec2 { x: 0.0, y: 0.0 },
                Vec2 {
                    x: f64::INFINITY,
                    y: 1.0,
                },
            )
            .is_none()
        );

        let constrained =
            move_vertex(&points, 1, Vec2 { x: 12.0, y: 3.0 }, true).expect("middle vertex snaps");
        assert_ne!(constrained[1], points[1]);
        assert!(constrained[1].x.is_finite());
        assert!(constrained[1].y.is_finite());
    }

    #[test]
    fn every_resize_handle_has_a_stable_opposite_pivot() {
        let expected = [
            (SelectionHandleIdV1::NorthWest, Point2D::new(4.0, 3.0)),
            (SelectionHandleIdV1::North, Point2D::new(0.0, 3.0)),
            (SelectionHandleIdV1::NorthEast, Point2D::new(-4.0, 3.0)),
            (SelectionHandleIdV1::East, Point2D::new(-4.0, 0.0)),
            (SelectionHandleIdV1::SouthEast, Point2D::new(-4.0, -3.0)),
            (SelectionHandleIdV1::South, Point2D::new(0.0, -3.0)),
            (SelectionHandleIdV1::SouthWest, Point2D::new(4.0, -3.0)),
            (SelectionHandleIdV1::West, Point2D::new(4.0, 0.0)),
        ];

        for (handle, pivot) in expected {
            assert_eq!(opposite_local(handle, 4.0, 3.0), Some(pivot));
        }
        assert_eq!(opposite_local(SelectionHandleIdV1::Rotate, 4.0, 3.0), None);
        assert_eq!(opposite_local(SelectionHandleIdV1::Vertex, 4.0, 3.0), None);
    }

    #[test]
    fn blank_drag_produces_marquee_without_document_commit() {
        let mut machine = PointerMachine::default();
        let targeted = |input| TargetedPointerEvent {
            input,
            target_element_id: None,
            selected_element_ids: Vec::new(),
            target_handle: None,
            target_vertex: None,
            target_curve: None,
            target_text_resize: None,
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
    fn shift_move_locks_to_the_dominant_axis() {
        let horizontal = gesture_transform(
            &TransformGesture::Move,
            Vec2 { x: 10.0, y: 10.0 },
            Vec2 { x: 50.0, y: 24.0 },
            PointerModifiersV1 {
                shift: true,
                ..PointerModifiersV1::default()
            },
        )
        .unwrap();
        assert_eq!((horizontal.e, horizontal.f), (40.0, 0.0));

        let vertical = gesture_transform(
            &TransformGesture::Move,
            Vec2 { x: 10.0, y: 10.0 },
            Vec2 { x: 20.0, y: 60.0 },
            PointerModifiersV1 {
                shift: true,
                ..PointerModifiersV1::default()
            },
        )
        .unwrap();
        assert_eq!((vertical.e, vertical.f), (0.0, 50.0));
    }

    #[test]
    fn shift_rotation_snaps_absolute_orientation_to_forty_five_degrees() {
        let bounds = OrientedSelectionBoundsV1 {
            center: Vec2 { x: 0.0, y: 0.0 },
            width: 100.0,
            height: 80.0,
            rotation: 0.2,
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
        let final_orientation = bounds.rotation + angle;
        assert!((final_orientation - std::f64::consts::FRAC_PI_4).abs() < 1e-10);
    }

    #[test]
    fn text_resize_helpers_preserve_alignment_and_auto_width_semantics() {
        let centered = TargetedTextResize {
            element_id: "text".to_string(),
            handle: SelectionHandleIdV1::West,
            world_to_local: Affine2D::identity(),
            x: 100.0,
            y: 20.0,
            font_size: 24.0,
            max_width: None,
            text_align: TextAlignV1::Center,
            measured_width: 80.0,
            measured_height: 40.0,
        };
        let width = resize_text_width(&centered, -20.0, false).unwrap();
        assert_eq!(width.x, 90.0);
        assert_eq!(width.font_size, 24.0);
        assert_eq!(width.max_width, Some(100.0));

        let corner = TargetedTextResize {
            handle: SelectionHandleIdV1::SouthWest,
            measured_width: 100.0,
            measured_height: 50.0,
            ..centered
        };
        let scaled = resize_text_proportionally(&corner, Point2D::new(-50.0, 25.0), false).unwrap();
        assert_eq!(scaled.x, 75.0);
        assert_eq!(scaled.y, 20.0);
        assert_eq!(scaled.font_size, 36.0);
        assert_eq!(scaled.max_width, None);
    }

    #[test]
    fn text_corner_resize_uses_the_closest_proportional_position_to_the_pointer() {
        let target = TargetedTextResize {
            element_id: "text".to_string(),
            handle: SelectionHandleIdV1::SouthEast,
            world_to_local: Affine2D::identity(),
            x: 0.0,
            y: 0.0,
            font_size: 24.0,
            max_width: Some(200.0),
            text_align: TextAlignV1::Start,
            measured_width: 200.0,
            measured_height: 30.0,
        };
        let pointer_delta = Point2D::new(20.0, 20.0);
        let preview = resize_text_proportionally(&target, pointer_delta, false).unwrap();
        let expected_scale = (220.0 * 200.0 + 50.0 * 30.0) / (200.0_f64.powi(2) + 30.0_f64.powi(2));
        let actual_scale = preview.font_size / target.font_size;
        assert!((actual_scale - expected_scale).abs() < 1e-10);
        assert!(
            (preview.max_width.unwrap() - target.measured_width * expected_scale).abs() < 1e-10
        );

        let preview_corner = Point2D::new(
            preview.x + target.measured_width * actual_scale,
            preview.y + target.measured_height * actual_scale,
        );
        let desired_corner = Point2D::new(
            target.measured_width + pointer_delta.x,
            target.measured_height + pointer_delta.y,
        );
        let residual = Point2D::new(
            desired_corner.x - preview_corner.x,
            desired_corner.y - preview_corner.y,
        );
        assert!(
            (residual.x * target.measured_width + residual.y * target.measured_height).abs()
                < 1e-10
        );
    }

    #[test]
    fn vertex_drag_previews_local_points_and_shift_snaps_the_adjacent_segment() {
        let mut machine = PointerMachine::default();
        let points = vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 10.0, y: 0.0 }];
        let down = TargetedPointerEvent {
            input: event(PointerPhaseV1::Down, 1, Vec2 { x: 10.0, y: 0.0 }),
            target_element_id: None,
            selected_element_ids: vec!["line".to_string()],
            target_handle: None,
            target_vertex: Some(TargetedVertexHandle {
                element_id: "line".to_string(),
                vertex_index: 1,
                points,
                world_to_local: Affine2D::identity(),
            }),
            target_curve: None,
            target_text_resize: None,
            oriented_bounds: None,
        };
        let down_outcome = machine.process_batch(4, vec![down]);
        assert_eq!(
            down_outcome.selection_change,
            Some(PointerSelectionChange::Vertex {
                element_id: "line".to_string(),
                vertex_index: 1,
            })
        );

        let mut move_input = event(PointerPhaseV1::Move, 2, Vec2 { x: 9.0, y: 4.0 });
        move_input.modifiers.shift = true;
        let moved = machine.process_batch(
            4,
            vec![TargetedPointerEvent {
                input: move_input,
                target_element_id: None,
                selected_element_ids: vec!["line".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: None,
                target_text_resize: None,
                oriented_bounds: None,
            }],
        );
        let PointerTransition::Preview(PointerPreview::Vertex(preview)) = moved.transition else {
            panic!("vertex drag must preview updated points");
        };
        assert!((preview.points[1].x - preview.points[1].y).abs() < 1e-10);

        let mut up_input = event(PointerPhaseV1::Up, 3, Vec2 { x: 9.0, y: 4.0 });
        up_input.modifiers.shift = true;
        let committed = machine.process_batch(
            4,
            vec![TargetedPointerEvent {
                input: up_input,
                target_element_id: None,
                selected_element_ids: vec!["line".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: None,
                target_text_resize: None,
                oriented_bounds: None,
            }],
        );
        let PointerTransition::VertexCommit {
            preview,
            expected_revision,
        } = committed.transition
        else {
            panic!("vertex pointer up must produce one commit");
        };
        assert_eq!(expected_revision, 4);
        assert!((preview.points[1].x - preview.points[1].y).abs() < 1e-10);
    }

    #[test]
    fn curve_handle_drag_previews_and_commits_one_quadratic_control() {
        let mut machine = PointerMachine::default();
        let points = vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 10.0, y: 0.0 }];
        machine.process_batch(
            8,
            vec![TargetedPointerEvent {
                input: event(PointerPhaseV1::Down, 1, Vec2 { x: 5.0, y: 0.0 }),
                target_element_id: None,
                selected_element_ids: vec!["line".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: Some(TargetedCurveHandle {
                    element_id: "line".to_string(),
                    points,
                    curve: None,
                    world_to_local: Affine2D::identity(),
                }),
                target_text_resize: None,
                oriented_bounds: None,
            }],
        );

        let moved = machine.process_batch(
            8,
            vec![TargetedPointerEvent {
                input: event(PointerPhaseV1::Move, 2, Vec2 { x: 5.0, y: 5.0 }),
                target_element_id: None,
                selected_element_ids: vec!["line".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: None,
                target_text_resize: None,
                oriented_bounds: None,
            }],
        );
        let PointerTransition::Preview(PointerPreview::Curve(preview)) = moved.transition else {
            panic!("curve drag must preview");
        };
        assert_eq!(
            preview.curve,
            Some(PathCurveV1::Quadratic {
                control: Vec2 { x: 5.0, y: 10.0 },
            })
        );

        let committed = machine.process_batch(
            8,
            vec![TargetedPointerEvent {
                input: event(PointerPhaseV1::Up, 3, Vec2 { x: 5.0, y: 5.0 }),
                target_element_id: None,
                selected_element_ids: vec!["line".to_string()],
                target_handle: None,
                target_vertex: None,
                target_curve: None,
                target_text_resize: None,
                oriented_bounds: None,
            }],
        );
        let PointerTransition::CurveCommit {
            preview,
            expected_revision,
        } = committed.transition
        else {
            panic!("curve pointer up must commit");
        };
        assert_eq!(expected_revision, 8);
        assert_eq!(
            preview.curve,
            Some(PathCurveV1::Quadratic {
                control: Vec2 { x: 5.0, y: 10.0 },
            })
        );
    }
}
