use serde::{Deserialize, Serialize};

use crate::{
    ElementId, ElementRecordV1, EngineErrorV1, NodeInkDocumentV1, RECTANGLE_STROKE_WIDTH, Vec2,
    text::TextMetricsCache,
};

const SCREEN_HIT_TOLERANCE: f64 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SelectionBoundsV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl SelectionBoundsV1 {
    fn translated(self, delta: Vec2) -> Self {
        Self {
            x: self.x + delta.x,
            y: self.y + delta.y,
            ..self
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionStateV1 {
    pub selected_element_id: Option<ElementId>,
    pub bounds: Option<SelectionBoundsV1>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SelectionModel {
    selected_element_id: Option<ElementId>,
}

impl SelectionModel {
    pub(crate) fn selected_element_id(&self) -> Option<&str> {
        self.selected_element_id.as_deref()
    }

    pub(crate) fn set(
        &mut self,
        document: &NodeInkDocumentV1,
        selected_element_id: Option<ElementId>,
    ) -> Result<(), EngineErrorV1> {
        if let Some(element_id) = &selected_element_id
            && !document.elements.contains_key(element_id)
        {
            return Err(EngineErrorV1::ElementNotFound {
                element_id: element_id.clone(),
            });
        }
        self.selected_element_id = selected_element_id;
        Ok(())
    }

    pub(crate) fn set_from_hit_test(&mut self, selected_element_id: Option<ElementId>) {
        self.selected_element_id = selected_element_id;
    }

    pub(crate) fn clear(&mut self) {
        self.selected_element_id = None;
    }

    pub(crate) fn reconcile(&mut self, document: &NodeInkDocumentV1) {
        if self
            .selected_element_id
            .as_ref()
            .is_some_and(|element_id| !document.elements.contains_key(element_id))
        {
            self.selected_element_id = None;
        }
    }

    pub(crate) fn snapshot(
        &self,
        document: &NodeInkDocumentV1,
        preview: Option<(&str, Vec2)>,
        text_metrics: &TextMetricsCache,
    ) -> SelectionStateV1 {
        let Some(element_id) = self.selected_element_id.as_ref() else {
            return SelectionStateV1::default();
        };
        let Some(element) = document.elements.get(element_id) else {
            return SelectionStateV1::default();
        };
        let preview_delta = preview
            .filter(|(preview_element_id, _)| *preview_element_id == element_id)
            .map_or(Vec2 { x: 0.0, y: 0.0 }, |(_, delta)| delta);
        let Some(bounds) = element_bounds(element, text_metrics) else {
            return SelectionStateV1::default();
        };
        SelectionStateV1 {
            selected_element_id: Some(element_id.clone()),
            bounds: Some(bounds.translated(preview_delta)),
        }
    }
}

pub(crate) fn hit_test_document(
    document: &NodeInkDocumentV1,
    point: Vec2,
    camera_zoom: f64,
    text_metrics: &TextMetricsCache,
) -> Option<ElementId> {
    let tolerance = SCREEN_HIT_TOLERANCE / camera_zoom;
    document.root_order.iter().rev().find_map(|element_id| {
        let element = document.elements.get(element_id)?;
        hit_test_element(element, point, tolerance, text_metrics).then(|| element_id.clone())
    })
}

fn hit_test_element(
    element: &ElementRecordV1,
    point: Vec2,
    tolerance: f64,
    text_metrics: &TextMetricsCache,
) -> bool {
    match element {
        ElementRecordV1::Rect(rectangle) => {
            point.x >= rectangle.x
                && point.x <= rectangle.x + rectangle.width
                && point.y >= rectangle.y
                && point.y <= rectangle.y + rectangle.height
        }
        ElementRecordV1::Stroke(stroke) => {
            let radius = stroke.stroke_width / 2.0 + tolerance;
            stroke.points.windows(2).any(|segment| {
                point_segment_distance_squared(point, segment[0], segment[1]) <= radius * radius
            })
        }
        ElementRecordV1::Text(_) => element_bounds(element, text_metrics).is_some_and(|bounds| {
            point.x >= bounds.x - tolerance
                && point.x <= bounds.x + bounds.width + tolerance
                && point.y >= bounds.y - tolerance
                && point.y <= bounds.y + bounds.height + tolerance
        }),
    }
}

fn point_segment_distance_squared(point: Vec2, start: Vec2, end: Vec2) -> f64 {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= f64::EPSILON {
        return squared_distance(point, start);
    }
    let projection =
        ((point.x - start.x) * segment_x + (point.y - start.y) * segment_y) / length_squared;
    let ratio = projection.clamp(0.0, 1.0);
    squared_distance(
        point,
        Vec2 {
            x: start.x + segment_x * ratio,
            y: start.y + segment_y * ratio,
        },
    )
}

fn squared_distance(first: Vec2, second: Vec2) -> f64 {
    let delta_x = first.x - second.x;
    let delta_y = first.y - second.y;
    delta_x * delta_x + delta_y * delta_y
}

fn element_bounds(
    element: &ElementRecordV1,
    text_metrics: &TextMetricsCache,
) -> Option<SelectionBoundsV1> {
    match element {
        ElementRecordV1::Rect(rectangle) => {
            let half_width = RECTANGLE_STROKE_WIDTH / 2.0;
            Some(SelectionBoundsV1 {
                x: rectangle.x - half_width,
                y: rectangle.y - half_width,
                width: rectangle.width + RECTANGLE_STROKE_WIDTH,
                height: rectangle.height + RECTANGLE_STROKE_WIDTH,
            })
        }
        ElementRecordV1::Stroke(stroke) => {
            let mut points = stroke.points.iter();
            let first = points.next()?;
            let half_width = stroke.stroke_width / 2.0;
            let (min_x, min_y, max_x, max_y) = points.fold(
                (first.x, first.y, first.x, first.y),
                |(min_x, min_y, max_x, max_y), point| {
                    (
                        min_x.min(point.x),
                        min_y.min(point.y),
                        max_x.max(point.x),
                        max_y.max(point.y),
                    )
                },
            );
            Some(SelectionBoundsV1 {
                x: min_x - half_width,
                y: min_y - half_width,
                width: max_x - min_x + stroke.stroke_width,
                height: max_y - min_y + stroke.stroke_width,
            })
        }
        ElementRecordV1::Text(text) => {
            text_metrics
                .metric_for(text)
                .map(|metric| SelectionBoundsV1 {
                    x: text.x,
                    y: text.y,
                    width: metric.width,
                    height: metric.height,
                })
        }
    }
}
