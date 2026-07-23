use crate::{
    Affine2D, ArrowElementV1, DiamondElementV1, EditorToolV1, ElementRecordV1, EllipseElementV1,
    FillV1, LineElementV1, NormalizedPointerEventV1, PointerModifiersV1, PointerPhaseV1,
    PolylineElementV1, RectElementV1, Vec2,
    style::{DEFAULT_ELEMENT_SIZE, DEFAULT_INK_COLOR, DEFAULT_RECTANGLE_STROKE_COLOR},
};

const CREATION_DRAG_THRESHOLD_SCREEN_PX: f64 = 3.0;
const DUPLICATE_POINT_THRESHOLD_SCREEN_PX: f64 = 3.0;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ShapeCreationCommit {
    pub command_id: String,
    pub expected_revision: u64,
    pub element: ElementRecordV1,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ShapeCreationTransition {
    None,
    Preview(ElementRecordV1),
    Commit(ShapeCreationCommit),
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ShapeCreationBatchOutcome {
    pub processed_event_count: usize,
    pub ignored_event_count: usize,
    pub transition: ShapeCreationTransition,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ShapeCreationMachine {
    state: ShapeCreationState,
}

#[derive(Debug, Clone, Default)]
enum ShapeCreationState {
    #[default]
    Idle,
    Drag {
        tool: EditorToolV1,
        pointer_id: u32,
        origin: Vec2,
        current: Vec2,
        modifiers: PointerModifiersV1,
        screen_scale: f64,
        last_sequence: u64,
        expected_revision: u64,
        command_id: String,
    },
    Polyline {
        pointer: Option<PolylinePointer>,
        points: Vec<Vec2>,
        hover: Option<Vec2>,
        screen_scale: f64,
        expected_revision: u64,
        command_id: String,
    },
}

#[derive(Debug, Clone)]
struct PolylinePointer {
    pointer_id: u32,
    last_sequence: u64,
}

impl ShapeCreationMachine {
    pub(crate) fn process_batch(
        &mut self,
        active_tool: EditorToolV1,
        expected_revision: u64,
        command_id: String,
        events: Vec<NormalizedPointerEventV1>,
    ) -> ShapeCreationBatchOutcome {
        let processed_event_count = events.len();
        let mut ignored_event_count = 0;
        let mut transition = ShapeCreationTransition::None;

        for event in events {
            match self.process_event(active_tool, expected_revision, &command_id, event) {
                Some(next_transition) => {
                    if next_transition != ShapeCreationTransition::None {
                        transition = next_transition;
                    }
                }
                None => ignored_event_count += 1,
            }
        }

        ShapeCreationBatchOutcome {
            processed_event_count,
            ignored_event_count,
            transition,
        }
    }

    pub(crate) fn preview(&self) -> Option<ElementRecordV1> {
        match &self.state {
            ShapeCreationState::Idle => None,
            ShapeCreationState::Drag {
                tool,
                origin,
                current,
                modifiers,
                screen_scale,
                command_id,
                ..
            } => drag_preview(
                *tool,
                command_id,
                *origin,
                *current,
                *modifiers,
                *screen_scale,
            ),
            ShapeCreationState::Polyline {
                points,
                hover,
                command_id,
                screen_scale,
                ..
            } => polyline_preview(command_id, points, *hover, *screen_scale),
        }
    }

    pub(crate) fn finish(&mut self) -> ShapeCreationTransition {
        let ShapeCreationState::Polyline {
            points,
            expected_revision,
            command_id,
            ..
        } = &self.state
        else {
            return ShapeCreationTransition::None;
        };
        if points.len() < 3 {
            return ShapeCreationTransition::None;
        }
        let element = ElementRecordV1::Polyline(PolylineElementV1 {
            id: command_id.clone(),
            transform: Affine2D::identity(),
            points: points.clone(),
            stroke: DEFAULT_INK_COLOR.to_string(),
            size: DEFAULT_ELEMENT_SIZE,
        });
        let commit = ShapeCreationCommit {
            command_id: command_id.clone(),
            expected_revision: *expected_revision,
            element,
        };
        self.state = ShapeCreationState::Idle;
        ShapeCreationTransition::Commit(commit)
    }

    pub(crate) fn remove_last_polyline_point(&mut self) -> ShapeCreationTransition {
        let ShapeCreationState::Polyline {
            points,
            hover,
            command_id,
            screen_scale,
            ..
        } = &mut self.state
        else {
            return ShapeCreationTransition::None;
        };
        if points.pop().is_none() {
            return ShapeCreationTransition::None;
        }
        if points.is_empty() {
            self.state = ShapeCreationState::Idle;
            return ShapeCreationTransition::Cancelled;
        }
        *hover = points.last().copied();
        polyline_preview(command_id, points, *hover, *screen_scale).map_or(
            ShapeCreationTransition::None,
            ShapeCreationTransition::Preview,
        )
    }

    pub(crate) fn cancel(&mut self) -> bool {
        let was_active = self.is_active();
        self.state = ShapeCreationState::Idle;
        was_active
    }

    pub(crate) fn is_active(&self) -> bool {
        !matches!(self.state, ShapeCreationState::Idle)
    }

    fn process_event(
        &mut self,
        active_tool: EditorToolV1,
        expected_revision: u64,
        command_id: &str,
        event: NormalizedPointerEventV1,
    ) -> Option<ShapeCreationTransition> {
        if !valid_event(&event) || !active_tool.is_shape_creation_tool() {
            return None;
        }
        if active_tool == EditorToolV1::Polyline {
            return self.process_polyline_event(expected_revision, command_id, event);
        }
        self.process_drag_event(active_tool, expected_revision, command_id, event)
    }

    fn process_drag_event(
        &mut self,
        active_tool: EditorToolV1,
        expected_revision: u64,
        command_id: &str,
        event: NormalizedPointerEventV1,
    ) -> Option<ShapeCreationTransition> {
        match &mut self.state {
            ShapeCreationState::Idle => {
                if event.phase != PointerPhaseV1::Down {
                    return None;
                }
                self.state = ShapeCreationState::Drag {
                    tool: active_tool,
                    pointer_id: event.pointer_id,
                    origin: event.point,
                    current: event.point,
                    modifiers: event.modifiers,
                    screen_scale: event.screen_scale,
                    last_sequence: event.sequence,
                    expected_revision,
                    command_id: command_id.to_string(),
                };
                Some(ShapeCreationTransition::None)
            }
            ShapeCreationState::Drag {
                tool,
                pointer_id,
                origin,
                current,
                modifiers,
                screen_scale,
                last_sequence,
                expected_revision,
                command_id,
            } => {
                if *tool != active_tool
                    || event.pointer_id != *pointer_id
                    || event.sequence <= *last_sequence
                {
                    return None;
                }
                *last_sequence = event.sequence;
                *current = event.point;
                *modifiers = event.modifiers;
                *screen_scale = event.screen_scale;
                match event.phase {
                    PointerPhaseV1::Move => Some(
                        drag_preview(
                            *tool,
                            command_id,
                            *origin,
                            *current,
                            *modifiers,
                            *screen_scale,
                        )
                        .map_or(
                            ShapeCreationTransition::None,
                            ShapeCreationTransition::Preview,
                        ),
                    ),
                    PointerPhaseV1::Up => {
                        let element = drag_preview(
                            *tool,
                            command_id,
                            *origin,
                            *current,
                            *modifiers,
                            *screen_scale,
                        );
                        let commit = element.map(|element| ShapeCreationCommit {
                            command_id: command_id.clone(),
                            expected_revision: *expected_revision,
                            element,
                        });
                        self.state = ShapeCreationState::Idle;
                        Some(commit.map_or(
                            ShapeCreationTransition::Cancelled,
                            ShapeCreationTransition::Commit,
                        ))
                    }
                    PointerPhaseV1::Cancel => {
                        self.state = ShapeCreationState::Idle;
                        Some(ShapeCreationTransition::Cancelled)
                    }
                    PointerPhaseV1::Down => None,
                }
            }
            ShapeCreationState::Polyline { .. } => None,
        }
    }

    fn process_polyline_event(
        &mut self,
        expected_revision: u64,
        command_id: &str,
        event: NormalizedPointerEventV1,
    ) -> Option<ShapeCreationTransition> {
        if matches!(self.state, ShapeCreationState::Idle) {
            if event.phase != PointerPhaseV1::Down {
                return None;
            }
            self.state = ShapeCreationState::Polyline {
                pointer: Some(PolylinePointer {
                    pointer_id: event.pointer_id,
                    last_sequence: event.sequence,
                }),
                points: Vec::new(),
                hover: Some(event.point),
                screen_scale: event.screen_scale,
                expected_revision,
                command_id: command_id.to_string(),
            };
            return Some(ShapeCreationTransition::None);
        }

        let ShapeCreationState::Polyline {
            pointer,
            points,
            hover,
            screen_scale,
            command_id,
            ..
        } = &mut self.state
        else {
            return None;
        };

        if event.phase == PointerPhaseV1::Move && pointer.is_none() {
            *screen_scale = event.screen_scale;
            *hover = constrained_polyline_point(points, event.point, event.modifiers);
            return Some(
                polyline_preview(command_id, points, *hover, *screen_scale).map_or(
                    ShapeCreationTransition::None,
                    ShapeCreationTransition::Preview,
                ),
            );
        }

        if event.phase == PointerPhaseV1::Down && pointer.is_none() {
            *pointer = Some(PolylinePointer {
                pointer_id: event.pointer_id,
                last_sequence: event.sequence,
            });
            *screen_scale = event.screen_scale;
            *hover = constrained_polyline_point(points, event.point, event.modifiers);
            return Some(ShapeCreationTransition::None);
        }

        let active_pointer = pointer.as_mut()?;
        if event.pointer_id != active_pointer.pointer_id
            || event.sequence <= active_pointer.last_sequence
        {
            return None;
        }
        active_pointer.last_sequence = event.sequence;
        *screen_scale = event.screen_scale;
        *hover = constrained_polyline_point(points, event.point, event.modifiers);
        match event.phase {
            PointerPhaseV1::Move => Some(
                polyline_preview(command_id, points, *hover, *screen_scale).map_or(
                    ShapeCreationTransition::None,
                    ShapeCreationTransition::Preview,
                ),
            ),
            PointerPhaseV1::Up => {
                let point = hover.expect("pointer update always sets a polyline hover point");
                if points.last().is_none_or(|last| {
                    point_distance(*last, point) * *screen_scale
                        >= DUPLICATE_POINT_THRESHOLD_SCREEN_PX
                }) {
                    points.push(point);
                }
                *pointer = None;
                Some(
                    polyline_preview(command_id, points, *hover, *screen_scale).map_or(
                        ShapeCreationTransition::None,
                        ShapeCreationTransition::Preview,
                    ),
                )
            }
            PointerPhaseV1::Cancel => {
                self.state = ShapeCreationState::Idle;
                Some(ShapeCreationTransition::Cancelled)
            }
            PointerPhaseV1::Down => None,
        }
    }
}

fn valid_event(event: &NormalizedPointerEventV1) -> bool {
    event.point.x.is_finite()
        && event.point.y.is_finite()
        && event.screen_scale.is_finite()
        && event.screen_scale > 0.0
}

fn drag_preview(
    tool: EditorToolV1,
    element_id: &str,
    origin: Vec2,
    point: Vec2,
    modifiers: PointerModifiersV1,
    screen_scale: f64,
) -> Option<ElementRecordV1> {
    if point_distance(origin, point) * screen_scale < CREATION_DRAG_THRESHOLD_SCREEN_PX {
        return None;
    }
    match tool {
        EditorToolV1::Rectangle | EditorToolV1::Ellipse | EditorToolV1::Diamond => {
            let bounds = creation_bounds(origin, point, modifiers);
            let fill = FillV1::default_rectangle();
            let stroke = DEFAULT_RECTANGLE_STROKE_COLOR.to_string();
            let transform = Affine2D::identity();
            Some(match tool {
                EditorToolV1::Rectangle => ElementRecordV1::Rect(RectElementV1 {
                    id: element_id.to_string(),
                    transform,
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    fill,
                    stroke,
                    size: DEFAULT_ELEMENT_SIZE,
                }),
                EditorToolV1::Ellipse => ElementRecordV1::Ellipse(EllipseElementV1 {
                    id: element_id.to_string(),
                    transform,
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    fill,
                    stroke,
                    size: DEFAULT_ELEMENT_SIZE,
                }),
                EditorToolV1::Diamond => ElementRecordV1::Diamond(DiamondElementV1 {
                    id: element_id.to_string(),
                    transform,
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    fill,
                    stroke,
                    size: DEFAULT_ELEMENT_SIZE,
                }),
                _ => unreachable!("closed shape tool was matched above"),
            })
        }
        EditorToolV1::Line | EditorToolV1::Arrow => {
            let endpoint = if modifiers.shift {
                snap_endpoint(origin, point)
            } else {
                point
            };
            let points = vec![origin, endpoint];
            Some(if tool == EditorToolV1::Line {
                ElementRecordV1::Line(LineElementV1 {
                    id: element_id.to_string(),
                    transform: Affine2D::identity(),
                    points,
                    curve: None,
                    stroke: DEFAULT_INK_COLOR.to_string(),
                    size: DEFAULT_ELEMENT_SIZE,
                })
            } else {
                ElementRecordV1::Arrow(ArrowElementV1 {
                    id: element_id.to_string(),
                    transform: Affine2D::identity(),
                    points,
                    curve: None,
                    stroke: DEFAULT_INK_COLOR.to_string(),
                    size: DEFAULT_ELEMENT_SIZE,
                })
            })
        }
        EditorToolV1::Select
        | EditorToolV1::Freehand
        | EditorToolV1::Text
        | EditorToolV1::Polyline => None,
    }
}

fn polyline_preview(
    element_id: &str,
    fixed_points: &[Vec2],
    hover: Option<Vec2>,
    screen_scale: f64,
) -> Option<ElementRecordV1> {
    let mut points = fixed_points.to_vec();
    if let Some(hover) = hover
        && points.last().is_none_or(|last| {
            point_distance(*last, hover) * screen_scale >= DUPLICATE_POINT_THRESHOLD_SCREEN_PX
        })
    {
        points.push(hover);
    }
    (!points.is_empty()).then(|| {
        ElementRecordV1::Polyline(PolylineElementV1 {
            id: element_id.to_string(),
            transform: Affine2D::identity(),
            points,
            stroke: DEFAULT_INK_COLOR.to_string(),
            size: DEFAULT_ELEMENT_SIZE,
        })
    })
}

fn constrained_polyline_point(
    points: &[Vec2],
    point: Vec2,
    modifiers: PointerModifiersV1,
) -> Option<Vec2> {
    points.last().map_or(Some(point), |origin| {
        Some(if modifiers.shift {
            snap_endpoint(*origin, point)
        } else {
            point
        })
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct CreationBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn creation_bounds(origin: Vec2, point: Vec2, modifiers: PointerModifiersV1) -> CreationBounds {
    let mut delta_x = point.x - origin.x;
    let mut delta_y = point.y - origin.y;
    if modifiers.shift {
        let extent = delta_x.abs().max(delta_y.abs());
        delta_x = extent * if delta_x < 0.0 { -1.0 } else { 1.0 };
        delta_y = extent * if delta_y < 0.0 { -1.0 } else { 1.0 };
    }
    if modifiers.alt {
        CreationBounds {
            x: origin.x - delta_x.abs(),
            y: origin.y - delta_y.abs(),
            width: delta_x.abs() * 2.0,
            height: delta_y.abs() * 2.0,
        }
    } else {
        let end = Vec2 {
            x: origin.x + delta_x,
            y: origin.y + delta_y,
        };
        CreationBounds {
            x: origin.x.min(end.x),
            y: origin.y.min(end.y),
            width: delta_x.abs(),
            height: delta_y.abs(),
        }
    }
}

fn snap_endpoint(origin: Vec2, point: Vec2) -> Vec2 {
    let delta_x = point.x - origin.x;
    let delta_y = point.y - origin.y;
    let length = delta_x.hypot(delta_y);
    if length <= f64::EPSILON {
        return point;
    }
    let step = std::f64::consts::FRAC_PI_4;
    let angle = (delta_y.atan2(delta_x) / step).round() * step;
    Vec2 {
        x: origin.x + length * angle.cos(),
        y: origin.y + length * angle.sin(),
    }
}

fn point_distance(first: Vec2, second: Vec2) -> f64 {
    (second.x - first.x).hypot(second.y - first.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        phase: PointerPhaseV1,
        sequence: u64,
        point: Vec2,
        modifiers: PointerModifiersV1,
    ) -> NormalizedPointerEventV1 {
        NormalizedPointerEventV1 {
            pointer_id: 1,
            sequence,
            phase,
            point,
            modifiers,
            screen_scale: 1.0,
        }
    }

    #[test]
    fn rectangle_drag_previews_and_commits_exact_bounds() {
        let mut machine = ShapeCreationMachine::default();
        machine.process_batch(
            EditorToolV1::Rectangle,
            7,
            "rect-1".to_string(),
            vec![event(
                PointerPhaseV1::Down,
                0,
                Vec2 { x: 80.0, y: 60.0 },
                PointerModifiersV1::default(),
            )],
        );
        let preview = machine.process_batch(
            EditorToolV1::Rectangle,
            7,
            "ignored".to_string(),
            vec![event(
                PointerPhaseV1::Move,
                1,
                Vec2 { x: 20.0, y: 140.0 },
                PointerModifiersV1::default(),
            )],
        );
        assert!(matches!(
            preview.transition,
            ShapeCreationTransition::Preview(ElementRecordV1::Rect(RectElementV1 {
                x: 20.0,
                y: 60.0,
                width: 60.0,
                height: 80.0,
                ..
            }))
        ));
        let committed = machine.process_batch(
            EditorToolV1::Rectangle,
            7,
            "ignored".to_string(),
            vec![event(
                PointerPhaseV1::Up,
                2,
                Vec2 { x: 20.0, y: 140.0 },
                PointerModifiersV1::default(),
            )],
        );
        let ShapeCreationTransition::Commit(commit) = committed.transition else {
            panic!("rectangle should commit");
        };
        assert_eq!(commit.command_id, "rect-1");
        assert_eq!(commit.expected_revision, 7);
    }

    #[test]
    fn shift_and_alt_create_a_centered_square() {
        let bounds = creation_bounds(
            Vec2 { x: 100.0, y: 100.0 },
            Vec2 { x: 130.0, y: 120.0 },
            PointerModifiersV1 {
                shift: true,
                alt: true,
                meta_or_ctrl: false,
            },
        );
        assert_eq!(
            bounds,
            CreationBounds {
                x: 70.0,
                y: 70.0,
                width: 60.0,
                height: 60.0,
            }
        );
    }

    #[test]
    fn short_drag_cancels_without_a_shape() {
        let mut machine = ShapeCreationMachine::default();
        let result = machine.process_batch(
            EditorToolV1::Ellipse,
            0,
            "ellipse-1".to_string(),
            vec![
                event(
                    PointerPhaseV1::Down,
                    0,
                    Vec2 { x: 0.0, y: 0.0 },
                    PointerModifiersV1::default(),
                ),
                event(
                    PointerPhaseV1::Up,
                    1,
                    Vec2 { x: 2.0, y: 0.0 },
                    PointerModifiersV1::default(),
                ),
            ],
        );
        assert_eq!(result.transition, ShapeCreationTransition::Cancelled);
    }

    #[test]
    fn shift_snaps_line_to_a_forty_five_degree_increment() {
        let preview = drag_preview(
            EditorToolV1::Line,
            "line-1",
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: 20.0, y: 5.0 },
            PointerModifiersV1 {
                shift: true,
                ..PointerModifiersV1::default()
            },
            1.0,
        );
        let Some(ElementRecordV1::Line(line)) = preview else {
            panic!("line preview should exist");
        };
        assert!((line.points[1].y - 0.0).abs() < 1e-9);
    }

    #[test]
    fn every_drag_shape_preview_keeps_its_semantic_kind() {
        let origin = Vec2 { x: 10.0, y: 20.0 };
        let point = Vec2 { x: 50.0, y: 80.0 };
        let modifiers = PointerModifiersV1::default();

        assert!(matches!(
            drag_preview(
                EditorToolV1::Ellipse,
                "ellipse-1",
                origin,
                point,
                modifiers,
                1.0,
            ),
            Some(ElementRecordV1::Ellipse(EllipseElementV1 {
                x: 10.0,
                y: 20.0,
                width: 40.0,
                height: 60.0,
                ..
            }))
        ));
        assert!(matches!(
            drag_preview(
                EditorToolV1::Diamond,
                "diamond-1",
                origin,
                point,
                modifiers,
                1.0,
            ),
            Some(ElementRecordV1::Diamond(DiamondElementV1 {
                x: 10.0,
                y: 20.0,
                width: 40.0,
                height: 60.0,
                ..
            }))
        ));
        assert!(matches!(
            drag_preview(
                EditorToolV1::Arrow,
                "arrow-1",
                origin,
                point,
                modifiers,
                1.0,
            ),
            Some(ElementRecordV1::Arrow(ArrowElementV1 { points, .. }))
                if points == vec![origin, point]
        ));
    }

    #[test]
    fn invalid_events_and_pointer_cancel_do_not_leave_creation_state() {
        let mut machine = ShapeCreationMachine::default();
        assert!(!machine.is_active());
        assert_eq!(machine.preview(), None);
        assert_eq!(machine.finish(), ShapeCreationTransition::None);
        assert_eq!(
            machine.remove_last_polyline_point(),
            ShapeCreationTransition::None
        );
        assert!(!machine.cancel());

        let ignored = machine.process_batch(
            EditorToolV1::Select,
            0,
            "ignored".to_string(),
            vec![event(
                PointerPhaseV1::Down,
                0,
                Vec2 { x: 10.0, y: 10.0 },
                PointerModifiersV1::default(),
            )],
        );
        assert_eq!(ignored.ignored_event_count, 1);

        machine.process_batch(
            EditorToolV1::Rectangle,
            0,
            "rect-1".to_string(),
            vec![event(
                PointerPhaseV1::Down,
                0,
                Vec2 { x: 10.0, y: 10.0 },
                PointerModifiersV1::default(),
            )],
        );
        assert!(machine.is_active());
        assert_eq!(machine.preview(), None);

        let cancelled = machine.process_batch(
            EditorToolV1::Rectangle,
            0,
            "ignored".to_string(),
            vec![event(
                PointerPhaseV1::Cancel,
                1,
                Vec2 { x: 20.0, y: 20.0 },
                PointerModifiersV1::default(),
            )],
        );
        assert_eq!(cancelled.transition, ShapeCreationTransition::Cancelled);
        assert!(!machine.is_active());
    }

    #[test]
    fn polyline_adds_points_removes_the_last_and_finishes_once() {
        let mut machine = ShapeCreationMachine::default();
        for (index, point) in [
            Vec2 { x: 10.0, y: 10.0 },
            Vec2 { x: 50.0, y: 10.0 },
            Vec2 { x: 50.0, y: 50.0 },
        ]
        .into_iter()
        .enumerate()
        {
            machine.process_batch(
                EditorToolV1::Polyline,
                3,
                "polyline-1".to_string(),
                vec![
                    event(
                        PointerPhaseV1::Down,
                        0,
                        point,
                        PointerModifiersV1::default(),
                    ),
                    event(PointerPhaseV1::Up, 1, point, PointerModifiersV1::default()),
                ],
            );
            if index == 1 {
                assert!(matches!(
                    machine.remove_last_polyline_point(),
                    ShapeCreationTransition::Preview(_)
                ));
                machine.process_batch(
                    EditorToolV1::Polyline,
                    3,
                    "ignored".to_string(),
                    vec![
                        event(
                            PointerPhaseV1::Down,
                            0,
                            point,
                            PointerModifiersV1::default(),
                        ),
                        event(PointerPhaseV1::Up, 1, point, PointerModifiersV1::default()),
                    ],
                );
            }
        }
        let ShapeCreationTransition::Commit(commit) = machine.finish() else {
            panic!("polyline should finish");
        };
        let ElementRecordV1::Polyline(polyline) = commit.element else {
            panic!("polyline commit should keep its semantic kind");
        };
        assert_eq!(polyline.points.len(), 3);
        assert_eq!(commit.command_id, "polyline-1");
        assert_eq!(machine.finish(), ShapeCreationTransition::None);
    }
}
