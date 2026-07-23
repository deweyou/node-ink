use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{
    Affine2D, ElementId, ElementRecordV1, EngineErrorV1, NodeInkDocumentV1, SelectionStyleV1,
    TextElementV1, Vec2, aligned_text_x,
    hierarchy::Hierarchy,
    selection_geometry::{OrientedCorners, SelectionGeometry, SelectionHandleKind, VisualAabb},
    shape_geometry::{
        BoxShapeKind, hit_test_box_shape, hit_test_path, hit_test_resolved_arrow,
        path_visual_bounds, resolved_arrow_visual_bounds,
    },
    stroke_geometry::{flattened_world_points, stroke_visual_bounds},
    text::TextMetricsCache,
    transform::Point2D,
};

const SCREEN_HIT_TOLERANCE: f64 = 6.0;
const SCREEN_SELECTION_GAP: f64 = 6.0;
const SCREEN_ROTATE_HANDLE_OFFSET: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SelectionBoundsV1 {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl SelectionBoundsV1 {
    pub(crate) fn from_points(first: Vec2, second: Vec2) -> Option<Self> {
        if ![first.x, first.y, second.x, second.y]
            .into_iter()
            .all(f64::is_finite)
        {
            return None;
        }
        let x = first.x.min(second.x);
        let y = first.y.min(second.y);
        let width = first.x.max(second.x) - x;
        let height = first.y.max(second.y) - y;
        if !width.is_finite() || !height.is_finite() {
            return None;
        }
        Some(Self {
            x,
            y,
            width,
            height,
        })
    }

    fn from_visual(bounds: VisualAabb) -> Self {
        Self {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        }
    }

    fn as_visual(self) -> Option<VisualAabb> {
        VisualAabb::new(self.x, self.y, self.width, self.height).ok()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrientedSelectionBoundsV1 {
    pub center: Vec2,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionHandleIdV1 {
    NorthWest,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    Rotate,
    Vertex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionHandleTypeV1 {
    Resize,
    Rotate,
    Vertex,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionHandleV1 {
    pub id: SelectionHandleIdV1,
    pub kind: SelectionHandleTypeV1,
    pub position: Vec2,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertex_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionMarqueeModeV1 {
    Replace,
    Add,
    Toggle,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SelectionMarqueeV1 {
    pub bounds: SelectionBoundsV1,
    pub mode: SelectionMarqueeModeV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlignmentGuideAxisV1 {
    X,
    Y,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AlignmentGuideV1 {
    pub axis: AlignmentGuideAxisV1,
    pub position: f64,
    pub start: f64,
    pub end: f64,
}

impl AlignmentGuideV1 {
    fn is_valid(self) -> bool {
        [self.position, self.start, self.end]
            .into_iter()
            .all(f64::is_finite)
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionStateV1 {
    pub selected_element_ids: Vec<ElementId>,
    pub primary_element_id: Option<ElementId>,
    /// Compatibility alias for Phase 1A hosts. It is always equal to
    /// `primary_element_id`.
    pub selected_element_id: Option<ElementId>,
    pub visual_bounds: Option<SelectionBoundsV1>,
    pub oriented_bounds: Option<OrientedSelectionBoundsV1>,
    pub handles: Vec<SelectionHandleV1>,
    pub marquee: Option<SelectionMarqueeV1>,
    pub guides: Vec<AlignmentGuideV1>,
    pub style: Option<SelectionStyleV1>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HitTestMode {
    OutermostGroup,
    PierceLeaf,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SelectionModel {
    selected_element_ids: Vec<ElementId>,
    primary_element_id: Option<ElementId>,
    selected_vertex_index: Option<usize>,
    marquee: Option<SelectionMarqueeV1>,
    guides: Vec<AlignmentGuideV1>,
}

impl SelectionModel {
    pub(crate) fn selected_element_id(&self) -> Option<&str> {
        self.primary_element_id.as_deref()
    }

    pub(crate) fn selected_element_ids(&self) -> &[ElementId] {
        &self.selected_element_ids
    }

    #[cfg(test)]
    pub(crate) fn primary_element_id(&self) -> Option<&str> {
        self.primary_element_id.as_deref()
    }

    pub(crate) fn contains(&self, element_id: &str) -> bool {
        self.selected_element_ids
            .iter()
            .any(|selected_id| selected_id == element_id)
    }

    pub(crate) fn selected_vertex(&self) -> Option<(&str, usize)> {
        Some((
            self.primary_element_id.as_deref()?,
            self.selected_vertex_index?,
        ))
    }

    pub(crate) fn clear_vertex(&mut self) {
        self.selected_vertex_index = None;
    }

    pub(crate) fn set_single(
        &mut self,
        document: &NodeInkDocumentV1,
        selected_element_id: Option<ElementId>,
    ) -> Result<(), EngineErrorV1> {
        let selected_element_ids = selected_element_id.iter().cloned().collect();
        self.set(document, selected_element_ids, selected_element_id)
    }

    pub(crate) fn set(
        &mut self,
        document: &NodeInkDocumentV1,
        selected_element_ids: Vec<ElementId>,
        primary_element_id: Option<ElementId>,
    ) -> Result<(), EngineErrorV1> {
        let requested = selected_element_ids.into_iter().collect::<BTreeSet<_>>();
        if let Some(element_id) = requested
            .iter()
            .find(|element_id| !document.elements.contains_key(*element_id))
        {
            return Err(EngineErrorV1::ElementNotFound {
                element_id: element_id.clone(),
            });
        }
        if let Some(primary_element_id) = &primary_element_id
            && !requested.contains(primary_element_id)
        {
            return Err(EngineErrorV1::ElementNotFound {
                element_id: primary_element_id.clone(),
            });
        }
        let ordered_ids = stable_document_order(document)?
            .into_iter()
            .filter(|element_id| requested.contains(element_id))
            .collect::<Vec<_>>();
        self.selected_element_ids = ordered_ids;
        self.primary_element_id =
            primary_element_id.or_else(|| self.selected_element_ids.last().cloned());
        self.selected_vertex_index = None;
        self.marquee = None;
        self.guides.clear();
        Ok(())
    }

    pub(crate) fn set_vertex(
        &mut self,
        document: &NodeInkDocumentV1,
        element_id: ElementId,
        vertex_index: usize,
    ) -> Result<(), EngineErrorV1> {
        let point_count = document
            .elements
            .get(&element_id)
            .and_then(path_points)
            .map(<[Vec2]>::len)
            .ok_or_else(|| EngineErrorV1::ElementNotPath {
                element_id: element_id.clone(),
            })?;
        if vertex_index >= point_count {
            return Err(EngineErrorV1::InvalidLine { element_id });
        }
        self.set_single(document, Some(element_id))?;
        self.selected_vertex_index = Some(vertex_index);
        Ok(())
    }

    pub(crate) fn apply_hit(
        &mut self,
        document: &NodeInkDocumentV1,
        selected_element_id: Option<ElementId>,
        toggle: bool,
    ) -> Result<(), EngineErrorV1> {
        if !toggle {
            return self.set_single(document, selected_element_id);
        }
        let Some(element_id) = selected_element_id else {
            return Ok(());
        };
        if !document.elements.contains_key(&element_id) {
            return Err(EngineErrorV1::ElementNotFound { element_id });
        }
        let mut next = self
            .selected_element_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let primary = if next.remove(&element_id) {
            self.primary_element_id
                .as_ref()
                .filter(|primary| *primary != &element_id && next.contains(*primary))
                .cloned()
        } else {
            next.insert(element_id.clone());
            Some(element_id)
        };
        self.set(document, next.into_iter().collect(), primary)
    }

    pub(crate) fn update_marquee(
        &mut self,
        bounds: SelectionBoundsV1,
        mode: SelectionMarqueeModeV1,
    ) -> Result<(), EngineErrorV1> {
        if bounds.as_visual().is_none() {
            return Err(EngineErrorV1::InvalidDelta);
        }
        self.marquee = Some(SelectionMarqueeV1 { bounds, mode });
        self.guides.clear();
        Ok(())
    }

    pub(crate) fn apply_marquee(
        &mut self,
        document: &NodeInkDocumentV1,
        bounds: SelectionBoundsV1,
        mode: SelectionMarqueeModeV1,
        text_metrics: &TextMetricsCache,
    ) -> Result<(), EngineErrorV1> {
        let marquee_bounds = bounds.as_visual().ok_or(EngineErrorV1::InvalidDelta)?;
        let world_transforms = resolved_world_transforms(document)?;
        let hits = document
            .root_order
            .iter()
            .filter_map(|element_id| {
                element_world_bounds(document, element_id, &world_transforms, text_metrics)
                    .filter(|element_bounds| intersects(marquee_bounds, *element_bounds))
                    .map(|_| element_id.clone())
            })
            .collect::<Vec<_>>();

        let mut next = self
            .selected_element_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let next_primary = match mode {
            SelectionMarqueeModeV1::Replace => {
                next = hits.iter().cloned().collect();
                hits.last().cloned()
            }
            SelectionMarqueeModeV1::Add => {
                next.extend(hits.iter().cloned());
                hits.last()
                    .cloned()
                    .or_else(|| self.primary_element_id.clone())
            }
            SelectionMarqueeModeV1::Toggle => {
                let mut last_added = None;
                for element_id in &hits {
                    if !next.remove(element_id) {
                        next.insert(element_id.clone());
                        last_added = Some(element_id.clone());
                    }
                }
                last_added.or_else(|| {
                    self.primary_element_id
                        .as_ref()
                        .filter(|primary| next.contains(*primary))
                        .cloned()
                })
            }
        };
        self.set(document, next.into_iter().collect(), next_primary)?;
        self.marquee = Some(SelectionMarqueeV1 { bounds, mode });
        Ok(())
    }

    pub(crate) fn clear_marquee(&mut self) {
        self.marquee = None;
    }

    pub(crate) fn set_guides(
        &mut self,
        guides: Vec<AlignmentGuideV1>,
    ) -> Result<(), EngineErrorV1> {
        if !guides.iter().copied().all(AlignmentGuideV1::is_valid) {
            return Err(EngineErrorV1::InvalidDelta);
        }
        self.guides = guides;
        Ok(())
    }

    pub(crate) fn clear_guides(&mut self) {
        self.guides.clear();
    }

    pub(crate) fn clear(&mut self) {
        self.selected_element_ids.clear();
        self.primary_element_id = None;
        self.selected_vertex_index = None;
        self.marquee = None;
        self.guides.clear();
    }

    pub(crate) fn reconcile(&mut self, document: &NodeInkDocumentV1) {
        let requested = self
            .selected_element_ids
            .iter()
            .filter(|element_id| document.elements.contains_key(*element_id))
            .cloned()
            .collect::<BTreeSet<_>>();
        self.selected_element_ids = stable_document_order(document)
            .unwrap_or_else(|_| document.elements.keys().cloned().collect())
            .into_iter()
            .filter(|element_id| requested.contains(element_id))
            .collect();
        if self
            .primary_element_id
            .as_ref()
            .is_none_or(|primary| !requested.contains(primary))
        {
            self.primary_element_id = self.selected_element_ids.last().cloned();
        }
        if self.selected_vertex_index.is_some_and(|vertex_index| {
            self.primary_element_id
                .as_ref()
                .and_then(|element_id| document.elements.get(element_id))
                .and_then(path_points)
                .is_none_or(|points| vertex_index >= points.len())
        }) {
            self.selected_vertex_index = None;
        }
        self.marquee = None;
        self.guides.clear();
    }

    pub(crate) fn snapshot(
        &self,
        document: &NodeInkDocumentV1,
        preview: Option<(&[ElementId], Affine2D)>,
        vertex_preview: Option<(&str, usize, &[Vec2])>,
        text_metrics: &TextMetricsCache,
        camera_zoom: f64,
    ) -> SelectionStateV1 {
        let primary_element_id = self
            .primary_element_id
            .as_ref()
            .filter(|primary| self.contains(primary))
            .cloned();
        let style = (self.selected_element_ids.len() == 1)
            .then(|| {
                document
                    .elements
                    .get(&self.selected_element_ids[0])
                    .and_then(selection_style)
            })
            .flatten();
        let rotate_offset = if camera_zoom.is_finite() && camera_zoom > 0.0 {
            SCREEN_ROTATE_HANDLE_OFFSET / camera_zoom
        } else {
            SCREEN_ROTATE_HANDLE_OFFSET
        };
        let selection_gap = if camera_zoom.is_finite() && camera_zoom > 0.0 {
            SCREEN_SELECTION_GAP / camera_zoom
        } else {
            SCREEN_SELECTION_GAP
        };
        let mut geometry = vertex_preview
            .filter(|(element_id, _, _)| self.selected_element_ids.as_slice() == [*element_id])
            .and_then(|(element_id, _, points)| {
                path_selection_geometry(document, element_id, points, rotate_offset)
            })
            .or_else(|| {
                selection_geometry(
                    document,
                    &self.selected_element_ids,
                    text_metrics,
                    rotate_offset,
                )
            });
        if let Some((preview_element_ids, preview_transform)) = preview
            && preview_element_ids
                .iter()
                .any(|element_id| self.contains(element_id))
        {
            geometry = geometry.and_then(|geometry| {
                transform_selection_geometry(geometry, preview_transform, rotate_offset)
            });
        }
        let (visual_bounds, oriented_bounds, handles) = geometry.map_or_else(
            || (None, None, Vec::new()),
            |geometry| {
                let visual_bounds = SelectionBoundsV1::from_visual(geometry.visual_aabb);
                let oriented_bounds = oriented_bounds(geometry.oriented_corners);
                let is_text = self.selected_element_ids.len() == 1
                    && document
                        .elements
                        .get(&self.selected_element_ids[0])
                        .is_some_and(|element| matches!(element, ElementRecordV1::Text(_)));
                let path_handles = self
                    .selected_element_ids
                    .first()
                    .filter(|_| self.selected_element_ids.len() == 1)
                    .and_then(|element_id| {
                        let points = vertex_preview
                            .filter(|(preview_id, _, _)| *preview_id == element_id.as_str())
                            .map(|(_, _, points)| points)
                            .or_else(|| document.elements.get(element_id).and_then(path_points))?;
                        vertex_handles(
                            document,
                            element_id,
                            points,
                            self.selected_vertex_index,
                            preview
                                .filter(|(preview_ids, _)| {
                                    preview_ids
                                        .iter()
                                        .any(|preview_id| preview_id == element_id)
                                })
                                .map(|(_, transform)| transform),
                        )
                    });
                let handles = path_handles.unwrap_or_else(|| {
                    handles_for_oriented_bounds(oriented_bounds, selection_gap, rotate_offset)
                        .map_or_else(Vec::new, |handles| {
                            handles
                                .into_iter()
                                .filter(|handle| {
                                    !is_text
                                        || !matches!(
                                            handle.kind,
                                            SelectionHandleKind::Top | SelectionHandleKind::Bottom
                                        )
                                })
                                .map(|handle| selection_handle(handle.kind, handle.position))
                                .collect()
                        })
                });
                (Some(visual_bounds), Some(oriented_bounds), handles)
            },
        );

        SelectionStateV1 {
            selected_element_ids: self.selected_element_ids.clone(),
            primary_element_id: primary_element_id.clone(),
            selected_element_id: primary_element_id,
            visual_bounds,
            oriented_bounds,
            handles,
            marquee: self.marquee,
            guides: if self.selected_element_ids.is_empty() {
                Vec::new()
            } else {
                self.guides.clone()
            },
            style,
        }
    }
}

fn handles_for_oriented_bounds(
    bounds: OrientedSelectionBoundsV1,
    padding: f64,
    rotate_offset: f64,
) -> Option<[crate::selection_geometry::SelectionHandle; 9]> {
    if !padding.is_finite() || padding < 0.0 {
        return None;
    }
    let half_width = bounds.width / 2.0 + padding;
    let half_height = bounds.height / 2.0 + padding;
    let (sin, cos) = bounds.rotation.sin_cos();
    let point = |x: f64, y: f64| {
        Point2D::new(
            bounds.center.x + x * cos - y * sin,
            bounds.center.y + x * sin + y * cos,
        )
    };
    OrientedCorners {
        top_left: point(-half_width, -half_height),
        top_right: point(half_width, -half_height),
        bottom_right: point(half_width, half_height),
        bottom_left: point(-half_width, half_height),
    }
    .handles(rotate_offset)
    .ok()
}

fn path_selection_geometry(
    document: &NodeInkDocumentV1,
    element_id: &str,
    points: &[Vec2],
    rotate_offset: f64,
) -> Option<SelectionGeometry> {
    let element = document.elements.get(element_id)?;
    let world_transform = resolved_world_transforms(document)
        .ok()?
        .get(element_id)
        .copied()?;
    match element {
        ElementRecordV1::Line(line) => SelectionGeometry::resolve(
            path_visual_bounds(points, line.size.stroke_width(), None)?,
            world_transform,
            rotate_offset,
        )
        .ok(),
        ElementRecordV1::Polyline(polyline) => SelectionGeometry::resolve(
            path_visual_bounds(points, polyline.size.stroke_width(), None)?,
            world_transform,
            rotate_offset,
        )
        .ok(),
        ElementRecordV1::Arrow(arrow) => SelectionGeometry::resolve(
            resolved_arrow_visual_bounds(points, arrow.size, world_transform)?,
            Affine2D::IDENTITY,
            rotate_offset,
        )
        .ok(),
        _ => None,
    }
}

fn vertex_handles(
    document: &NodeInkDocumentV1,
    element_id: &str,
    points: &[Vec2],
    selected_vertex_index: Option<usize>,
    preview_transform: Option<Affine2D>,
) -> Option<Vec<SelectionHandleV1>> {
    let world_transform = resolved_world_transforms(document)
        .ok()?
        .get(element_id)
        .copied()?;
    let vertex_indices = match document.elements.get(element_id)? {
        ElementRecordV1::Line(_) | ElementRecordV1::Arrow(_) => {
            let last = points.len().checked_sub(1)?;
            if last == 0 { vec![0] } else { vec![0, last] }
        }
        ElementRecordV1::Polyline(_) => (0..points.len()).collect(),
        _ => return None,
    };
    vertex_indices
        .into_iter()
        .map(|vertex_index| {
            let point = points.get(vertex_index)?;
            let mut world = world_transform.apply(Point2D::new(point.x, point.y)).ok()?;
            if let Some(preview_transform) = preview_transform {
                world = preview_transform.apply(world).ok()?;
            }
            Some(SelectionHandleV1 {
                id: SelectionHandleIdV1::Vertex,
                kind: SelectionHandleTypeV1::Vertex,
                position: Vec2 {
                    x: world.x,
                    y: world.y,
                },
                vertex_index: Some(vertex_index),
                selected: Some(selected_vertex_index == Some(vertex_index)),
            })
        })
        .collect()
}

/// Phase 1A-compatible normal hit test. Group-aware pointer code can use
/// `hit_test_document_with_mode` to request Cmd/Ctrl leaf piercing.
pub(crate) fn hit_test_document(
    document: &NodeInkDocumentV1,
    point: Vec2,
    camera_zoom: f64,
    text_metrics: &TextMetricsCache,
) -> Option<ElementId> {
    hit_test_document_with_mode(
        document,
        point,
        camera_zoom,
        text_metrics,
        HitTestMode::OutermostGroup,
    )
}

pub(crate) fn hit_test_document_with_mode(
    document: &NodeInkDocumentV1,
    point: Vec2,
    camera_zoom: f64,
    text_metrics: &TextMetricsCache,
    mode: HitTestMode,
) -> Option<ElementId> {
    if !point.x.is_finite()
        || !point.y.is_finite()
        || !camera_zoom.is_finite()
        || camera_zoom <= 0.0
    {
        return None;
    }
    let hierarchy = document_hierarchy(document).ok()?;
    let world_transforms = resolved_world_transforms_with_hierarchy(document, &hierarchy).ok()?;
    let tolerance = SCREEN_HIT_TOLERANCE / camera_zoom;
    let leaf_id = hierarchy
        .stable_depth_first_order()
        .into_iter()
        .rev()
        .find(|element_id| {
            let Some(element) = document.elements.get(*element_id) else {
                return false;
            };
            let Some(world_transform) = world_transforms.get(*element_id).copied() else {
                return false;
            };
            hit_test_element(element, world_transform, point, tolerance, text_metrics)
        })?;
    if mode == HitTestMode::PierceLeaf {
        return Some(leaf_id.to_string());
    }
    let mut outermost = leaf_id;
    while let Some(Some(parent_id)) = hierarchy.parent_of(outermost) {
        outermost = parent_id;
    }
    Some(outermost.to_string())
}

fn hit_test_element(
    element: &ElementRecordV1,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
    text_metrics: &TextMetricsCache,
) -> bool {
    match element {
        ElementRecordV1::Rect(rectangle) => world_transform
            .inverse()
            .and_then(|inverse| inverse.apply(Point2D::new(point.x, point.y)))
            .is_ok_and(|local| {
                local.x >= rectangle.x
                    && local.x <= rectangle.x + rectangle.width
                    && local.y >= rectangle.y
                    && local.y <= rectangle.y + rectangle.height
            }),
        ElementRecordV1::Ellipse(ellipse) => hit_test_box_shape(
            BoxShapeKind::Ellipse,
            ellipse.x,
            ellipse.y,
            ellipse.width,
            ellipse.height,
            world_transform,
            point,
        ),
        ElementRecordV1::Diamond(diamond) => hit_test_box_shape(
            BoxShapeKind::Diamond,
            diamond.x,
            diamond.y,
            diamond.width,
            diamond.height,
            world_transform,
            point,
        ),
        ElementRecordV1::Line(line) => hit_test_path(
            &line.points,
            line.size.stroke_width(),
            None,
            world_transform,
            point,
            tolerance,
        ),
        ElementRecordV1::Polyline(polyline) => hit_test_path(
            &polyline.points,
            polyline.size.stroke_width(),
            None,
            world_transform,
            point,
            tolerance,
        ),
        ElementRecordV1::Arrow(arrow) => {
            hit_test_resolved_arrow(&arrow.points, arrow.size, world_transform, point, tolerance)
        }
        ElementRecordV1::Stroke(stroke) => {
            let radius = stroke.size.stroke_width() / 2.0 + tolerance;
            flattened_world_points(&stroke.points, world_transform, tolerance).is_some_and(
                |points| {
                    points.windows(2).any(|segment| {
                        let start = segment[0];
                        let end = segment[1];
                        point_segment_distance_squared(Point2D::new(point.x, point.y), start, end)
                            <= radius * radius
                    })
                },
            )
        }
        ElementRecordV1::Text(text) => {
            hit_test_text(text, world_transform, point, tolerance, text_metrics)
        }
        ElementRecordV1::Group(_) => false,
    }
}

fn hit_test_text(
    text: &TextElementV1,
    world_transform: Affine2D,
    point: Vec2,
    tolerance: f64,
    text_metrics: &TextMetricsCache,
) -> bool {
    let Some(metric) = text_metrics.metric_for(text) else {
        return false;
    };
    let Ok(inverse) = world_transform.inverse() else {
        return false;
    };
    let Ok(local) = inverse.apply(Point2D::new(point.x, point.y)) else {
        return false;
    };
    let inverse_norm = linear_operator_norm(inverse);
    let local_tolerance = tolerance * inverse_norm;
    if !local_tolerance.is_finite() {
        return false;
    }
    let x = aligned_text_x(text.x, metric.width, text.text_align);
    local.x >= x - local_tolerance
        && local.x <= x + metric.width + local_tolerance
        && local.y >= text.y - local_tolerance
        && local.y <= text.y + metric.height + local_tolerance
}

fn linear_operator_norm(transform: Affine2D) -> f64 {
    let sum = transform.a * transform.a
        + transform.b * transform.b
        + transform.c * transform.c
        + transform.d * transform.d;
    let determinant = transform.a * transform.d - transform.b * transform.c;
    let discriminant = (sum * sum - 4.0 * determinant * determinant).max(0.0);
    ((sum + discriminant.sqrt()) / 2.0).sqrt()
}

fn point_segment_distance_squared(point: Point2D, start: Point2D, end: Point2D) -> f64 {
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
        Point2D::new(start.x + segment_x * ratio, start.y + segment_y * ratio),
    )
}

fn squared_distance(first: Point2D, second: Point2D) -> f64 {
    let delta_x = first.x - second.x;
    let delta_y = first.y - second.y;
    delta_x * delta_x + delta_y * delta_y
}

fn stable_document_order(document: &NodeInkDocumentV1) -> Result<Vec<ElementId>, EngineErrorV1> {
    Ok(document_hierarchy(document)?
        .stable_depth_first_order()
        .into_iter()
        .map(str::to_string)
        .collect())
}

fn document_hierarchy(document: &NodeInkDocumentV1) -> Result<Hierarchy, EngineErrorV1> {
    let child_orders = document
        .elements
        .values()
        .filter_map(|element| match element {
            ElementRecordV1::Group(group) => Some((group.id.clone(), group.child_order.clone())),
            _ => None,
        })
        .collect();
    Hierarchy::new(
        document.elements.keys().cloned(),
        document.root_order.clone(),
        child_orders,
    )
    .map_err(|error| EngineErrorV1::InvalidHierarchy {
        reason: format!("{error:?}"),
    })
}

fn resolved_world_transforms(
    document: &NodeInkDocumentV1,
) -> Result<BTreeMap<ElementId, Affine2D>, EngineErrorV1> {
    let hierarchy = document_hierarchy(document)?;
    resolved_world_transforms_with_hierarchy(document, &hierarchy)
}

fn resolved_world_transforms_with_hierarchy(
    document: &NodeInkDocumentV1,
    hierarchy: &Hierarchy,
) -> Result<BTreeMap<ElementId, Affine2D>, EngineErrorV1> {
    let mut transforms = BTreeMap::new();
    for element_id in hierarchy.root_order() {
        append_world_transforms(
            document,
            hierarchy,
            element_id,
            Affine2D::identity(),
            &mut transforms,
        )?;
    }
    Ok(transforms)
}

fn append_world_transforms(
    document: &NodeInkDocumentV1,
    hierarchy: &Hierarchy,
    element_id: &str,
    parent_world: Affine2D,
    transforms: &mut BTreeMap<ElementId, Affine2D>,
) -> Result<(), EngineErrorV1> {
    let element =
        document
            .elements
            .get(element_id)
            .ok_or_else(|| EngineErrorV1::ElementNotFound {
                element_id: element_id.to_string(),
            })?;
    let world = element_transform(element)
        .compose(parent_world)
        .map_err(|_| EngineErrorV1::InvalidTransform {
            element_id: element_id.to_string(),
        })?;
    transforms.insert(element_id.to_string(), world);
    if let Some(children) = hierarchy.children_of(element_id) {
        for child_id in children {
            append_world_transforms(document, hierarchy, child_id, world, transforms)?;
        }
    }
    Ok(())
}

fn element_transform(element: &ElementRecordV1) -> Affine2D {
    match element {
        ElementRecordV1::Rect(rectangle) => rectangle.transform,
        ElementRecordV1::Ellipse(ellipse) => ellipse.transform,
        ElementRecordV1::Diamond(diamond) => diamond.transform,
        ElementRecordV1::Line(line) => line.transform,
        ElementRecordV1::Polyline(polyline) => polyline.transform,
        ElementRecordV1::Arrow(arrow) => arrow.transform,
        ElementRecordV1::Stroke(stroke) => stroke.transform,
        ElementRecordV1::Text(text) => text.transform,
        ElementRecordV1::Group(group) => group.transform,
    }
}

fn path_points(element: &ElementRecordV1) -> Option<&[Vec2]> {
    match element {
        ElementRecordV1::Line(line) => Some(&line.points),
        ElementRecordV1::Polyline(polyline) => Some(&polyline.points),
        ElementRecordV1::Arrow(arrow) => Some(&arrow.points),
        _ => None,
    }
}

fn element_local_visual_bounds(
    element: &ElementRecordV1,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    match element {
        ElementRecordV1::Rect(rectangle) => {
            let stroke_width = rectangle.size.stroke_width();
            let half_width = stroke_width / 2.0;
            VisualAabb::new(
                rectangle.x - half_width,
                rectangle.y - half_width,
                rectangle.width + stroke_width,
                rectangle.height + stroke_width,
            )
            .ok()
        }
        ElementRecordV1::Ellipse(ellipse) => boxed_visual_bounds(
            ellipse.x,
            ellipse.y,
            ellipse.width,
            ellipse.height,
            ellipse.size.stroke_width(),
        ),
        ElementRecordV1::Diamond(diamond) => boxed_visual_bounds(
            diamond.x,
            diamond.y,
            diamond.width,
            diamond.height,
            diamond.size.stroke_width(),
        ),
        ElementRecordV1::Line(line) => {
            path_visual_bounds(&line.points, line.size.stroke_width(), None)
        }
        ElementRecordV1::Polyline(polyline) => {
            path_visual_bounds(&polyline.points, polyline.size.stroke_width(), None)
        }
        ElementRecordV1::Arrow(arrow) => {
            path_visual_bounds(&arrow.points, arrow.size.stroke_width(), Some(arrow.size))
        }
        ElementRecordV1::Stroke(stroke) => {
            stroke_visual_bounds(&stroke.points, stroke.size.stroke_width())
        }
        ElementRecordV1::Text(text) => text_metrics.metric_for(text).and_then(|metric| {
            VisualAabb::new(
                aligned_text_x(text.x, metric.width, text.text_align),
                text.y,
                metric.width,
                metric.height,
            )
            .ok()
        }),
        ElementRecordV1::Group(_) => None,
    }
}

fn group_local_visual_bounds(
    document: &NodeInkDocumentV1,
    group_id: &str,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    let ElementRecordV1::Group(group) = document.elements.get(group_id)? else {
        return None;
    };
    group
        .child_order
        .iter()
        .filter_map(|child_id| element_bounds_in_parent(document, child_id, text_metrics))
        .reduce(union_visual_bounds)
}

fn element_bounds_in_parent(
    document: &NodeInkDocumentV1,
    element_id: &str,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    let element = document.elements.get(element_id)?;
    if let ElementRecordV1::Arrow(arrow) = element {
        return resolved_arrow_visual_bounds(&arrow.points, arrow.size, element_transform(element));
    }
    let local_bounds = match element {
        ElementRecordV1::Group(_) => group_local_visual_bounds(document, element_id, text_metrics)?,
        leaf => element_local_visual_bounds(leaf, text_metrics)?,
    };
    SelectionGeometry::resolve(local_bounds, element_transform(element), 0.0)
        .ok()
        .map(|geometry| geometry.visual_aabb)
}

fn element_world_bounds(
    document: &NodeInkDocumentV1,
    element_id: &str,
    world_transforms: &BTreeMap<ElementId, Affine2D>,
    text_metrics: &TextMetricsCache,
) -> Option<VisualAabb> {
    element_selection_geometry(document, element_id, world_transforms, text_metrics, 0.0)
        .map(|geometry| geometry.visual_aabb)
}

fn element_selection_geometry(
    document: &NodeInkDocumentV1,
    element_id: &str,
    world_transforms: &BTreeMap<ElementId, Affine2D>,
    text_metrics: &TextMetricsCache,
    rotate_offset: f64,
) -> Option<SelectionGeometry> {
    let element = document.elements.get(element_id)?;
    let world_transform = *world_transforms.get(element_id)?;
    if let ElementRecordV1::Arrow(arrow) = element {
        return SelectionGeometry::resolve(
            resolved_arrow_visual_bounds(&arrow.points, arrow.size, world_transform)?,
            Affine2D::IDENTITY,
            rotate_offset,
        )
        .ok();
    }
    let local_bounds = match element {
        ElementRecordV1::Group(_) => group_local_visual_bounds(document, element_id, text_metrics)?,
        leaf => element_local_visual_bounds(leaf, text_metrics)?,
    };
    SelectionGeometry::resolve(local_bounds, world_transform, rotate_offset).ok()
}

fn selection_geometry(
    document: &NodeInkDocumentV1,
    selected_element_ids: &[ElementId],
    text_metrics: &TextMetricsCache,
    rotate_offset: f64,
) -> Option<SelectionGeometry> {
    let world_transforms = resolved_world_transforms(document).ok()?;
    if let [element_id] = selected_element_ids {
        return element_selection_geometry(
            document,
            element_id,
            &world_transforms,
            text_metrics,
            rotate_offset,
        );
    }
    let visual_bounds = selected_element_ids
        .iter()
        .filter_map(|element_id| {
            element_world_bounds(document, element_id, &world_transforms, text_metrics)
        })
        .reduce(union_visual_bounds)?;
    SelectionGeometry::resolve(visual_bounds, Affine2D::identity(), rotate_offset).ok()
}

fn transform_selection_geometry(
    geometry: SelectionGeometry,
    world_delta: Affine2D,
    rotate_offset: f64,
) -> Option<SelectionGeometry> {
    let corners = OrientedCorners {
        top_left: world_delta.apply(geometry.oriented_corners.top_left).ok()?,
        top_right: world_delta
            .apply(geometry.oriented_corners.top_right)
            .ok()?,
        bottom_right: world_delta
            .apply(geometry.oriented_corners.bottom_right)
            .ok()?,
        bottom_left: world_delta
            .apply(geometry.oriented_corners.bottom_left)
            .ok()?,
    };
    Some(SelectionGeometry {
        visual_aabb: corners.visual_aabb().ok()?,
        handles: corners.handles(rotate_offset).ok()?,
        oriented_corners: corners,
    })
}

fn union_visual_bounds(first: VisualAabb, second: VisualAabb) -> VisualAabb {
    let min_x = first.min_x().min(second.min_x());
    let min_y = first.min_y().min(second.min_y());
    let max_x = first.max_x().max(second.max_x());
    let max_y = first.max_y().max(second.max_y());
    VisualAabb::new(min_x, min_y, max_x - min_x, max_y - min_y)
        .expect("union of valid bounds remains valid")
}

fn intersects(first: VisualAabb, second: VisualAabb) -> bool {
    first.min_x() <= second.max_x()
        && first.max_x() >= second.min_x()
        && first.min_y() <= second.max_y()
        && first.max_y() >= second.min_y()
}

fn oriented_bounds(corners: OrientedCorners) -> OrientedSelectionBoundsV1 {
    let center = midpoint(corners.top_left, corners.bottom_right);
    OrientedSelectionBoundsV1 {
        center: Vec2 {
            x: center.x,
            y: center.y,
        },
        width: distance(corners.top_left, corners.top_right),
        height: distance(corners.top_left, corners.bottom_left),
        rotation: (corners.top_right.y - corners.top_left.y)
            .atan2(corners.top_right.x - corners.top_left.x),
    }
}

fn selection_handle(kind: SelectionHandleKind, position: Point2D) -> SelectionHandleV1 {
    let (id, handle_type) = match kind {
        SelectionHandleKind::TopLeft => (
            SelectionHandleIdV1::NorthWest,
            SelectionHandleTypeV1::Resize,
        ),
        SelectionHandleKind::Top => (SelectionHandleIdV1::North, SelectionHandleTypeV1::Resize),
        SelectionHandleKind::TopRight => (
            SelectionHandleIdV1::NorthEast,
            SelectionHandleTypeV1::Resize,
        ),
        SelectionHandleKind::Right => (SelectionHandleIdV1::East, SelectionHandleTypeV1::Resize),
        SelectionHandleKind::BottomRight => (
            SelectionHandleIdV1::SouthEast,
            SelectionHandleTypeV1::Resize,
        ),
        SelectionHandleKind::Bottom => (SelectionHandleIdV1::South, SelectionHandleTypeV1::Resize),
        SelectionHandleKind::BottomLeft => (
            SelectionHandleIdV1::SouthWest,
            SelectionHandleTypeV1::Resize,
        ),
        SelectionHandleKind::Left => (SelectionHandleIdV1::West, SelectionHandleTypeV1::Resize),
        SelectionHandleKind::Rotate => (SelectionHandleIdV1::Rotate, SelectionHandleTypeV1::Rotate),
    };
    SelectionHandleV1 {
        id,
        kind: handle_type,
        position: Vec2 {
            x: position.x,
            y: position.y,
        },
        vertex_index: None,
        selected: None,
    }
}

fn selection_style(element: &ElementRecordV1) -> Option<SelectionStyleV1> {
    match element {
        ElementRecordV1::Rect(rectangle) => Some(SelectionStyleV1::Rect {
            fill: rectangle.fill.clone(),
            stroke: rectangle.stroke.clone(),
            size: rectangle.size,
        }),
        ElementRecordV1::Ellipse(ellipse) => Some(SelectionStyleV1::Ellipse {
            fill: ellipse.fill.clone(),
            stroke: ellipse.stroke.clone(),
            size: ellipse.size,
        }),
        ElementRecordV1::Diamond(diamond) => Some(SelectionStyleV1::Diamond {
            fill: diamond.fill.clone(),
            stroke: diamond.stroke.clone(),
            size: diamond.size,
        }),
        ElementRecordV1::Line(line) => Some(SelectionStyleV1::Line {
            stroke: line.stroke.clone(),
            size: line.size,
        }),
        ElementRecordV1::Polyline(polyline) => Some(SelectionStyleV1::Polyline {
            stroke: polyline.stroke.clone(),
            size: polyline.size,
        }),
        ElementRecordV1::Arrow(arrow) => Some(SelectionStyleV1::Arrow {
            stroke: arrow.stroke.clone(),
            size: arrow.size,
        }),
        ElementRecordV1::Stroke(stroke) => Some(SelectionStyleV1::Stroke {
            stroke: stroke.stroke.clone(),
            size: stroke.size,
        }),
        ElementRecordV1::Text(text) => Some(SelectionStyleV1::Text {
            color: text.color.clone(),
            text_align: text.text_align,
            font_size: text.font_size,
            font_weight: text.font_weight,
        }),
        ElementRecordV1::Group(_) => None,
    }
}

fn boxed_visual_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    stroke_width: f64,
) -> Option<VisualAabb> {
    let half_width = stroke_width / 2.0;
    VisualAabb::new(
        x - half_width,
        y - half_width,
        width + stroke_width,
        height + stroke_width,
    )
    .ok()
}

fn midpoint(first: Point2D, second: Point2D) -> Point2D {
    Point2D::new(
        first.x + (second.x - first.x) / 2.0,
        first.y + (second.y - first.y) / 2.0,
    )
}

fn distance(first: Point2D, second: Point2D) -> f64 {
    (second.x - first.x).hypot(second.y - first.y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ElementSizeV1, FillV1, GroupElementV1, LineElementV1, RectElementV1, RenderProfileV1,
        SCHEMA_VERSION, StrokeElementV1, TextAlignV1, TextElementV1, TextMetricsSnapshotV1,
        TextMetricsV1,
    };

    const EPSILON: f64 = 1e-9;

    #[test]
    fn hit_test_applies_world_affines_and_group_selection_modes() {
        let document = grouped_document();
        let metrics = TextMetricsCache::default();
        let point = Vec2 { x: 125.0, y: 15.0 };

        assert_eq!(
            hit_test_document(&document, point, 1.0, &metrics),
            Some("outer".to_string())
        );
        assert_eq!(
            hit_test_document_with_mode(&document, point, 1.0, &metrics, HitTestMode::PierceLeaf,),
            Some("leaf".to_string())
        );
        assert_eq!(
            hit_test_document(&document, Vec2 { x: 25.0, y: 15.0 }, 1.0, &metrics),
            None
        );
    }

    #[test]
    fn hit_test_uses_reverse_stable_draw_order() {
        let mut document = NodeInkDocumentV1::blank("draw-order");
        document.root_order = vec!["back".to_string(), "front".to_string()];
        document.elements.insert(
            "back".to_string(),
            ElementRecordV1::Rect(rect("back", Affine2D::identity(), 0.0, 0.0, 40.0, 40.0)),
        );
        document.elements.insert(
            "front".to_string(),
            ElementRecordV1::Rect(rect("front", Affine2D::identity(), 0.0, 0.0, 40.0, 40.0)),
        );

        assert_eq!(
            hit_test_document(
                &document,
                Vec2 { x: 10.0, y: 10.0 },
                1.0,
                &TextMetricsCache::default(),
            ),
            Some("front".to_string())
        );
    }

    #[test]
    fn stroke_selection_bounds_and_hit_test_follow_the_smoothed_curve() {
        let mut document = NodeInkDocumentV1::blank("smooth-stroke");
        document.root_order.push("stroke".to_string());
        document.elements.insert(
            "stroke".to_string(),
            ElementRecordV1::Stroke(StrokeElementV1 {
                id: "stroke".to_string(),
                transform: Affine2D::identity(),
                points: vec![
                    Vec2 { x: 0.0, y: 0.0 },
                    Vec2 { x: 10.0, y: 20.0 },
                    Vec2 { x: 20.0, y: 0.0 },
                ],
                size: ElementSizeV1::S,
                stroke: "#0f172a".to_string(),
            }),
        );

        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("stroke".to_string()))
            .expect("stroke selection is valid");
        let snapshot =
            selection.snapshot(&document, None, None, &TextMetricsCache::default(), 100.0);

        assert_eq!(
            snapshot.visual_bounds,
            Some(SelectionBoundsV1 {
                x: -1.0,
                y: -1.0,
                width: 22.0,
                height: 17.0,
            })
        );
        assert_eq!(
            hit_test_document(
                &document,
                Vec2 { x: 10.0, y: 15.0 },
                100.0,
                &TextMetricsCache::default(),
            ),
            Some("stroke".to_string())
        );
        assert_eq!(
            hit_test_document(
                &document,
                Vec2 { x: 10.0, y: 20.0 },
                100.0,
                &TextMetricsCache::default(),
            ),
            None
        );
    }

    #[test]
    fn multi_selection_toggle_and_reconcile_keep_document_order() {
        let mut document = NodeInkDocumentV1::blank("selection");
        document.root_order = vec![
            "back".to_string(),
            "middle".to_string(),
            "front".to_string(),
        ];
        for id in &document.root_order.clone() {
            document.elements.insert(
                id.clone(),
                ElementRecordV1::Rect(rect(id, Affine2D::identity(), 0.0, 0.0, 10.0, 10.0)),
            );
        }
        let mut selection = SelectionModel::default();
        selection
            .set(
                &document,
                vec!["front".to_string(), "back".to_string()],
                Some("front".to_string()),
            )
            .expect("selection is valid");

        assert_eq!(selection.selected_element_ids(), ["back", "front"]);
        selection
            .apply_hit(&document, Some("middle".to_string()), true)
            .expect("toggle is valid");
        assert_eq!(
            selection.selected_element_ids(),
            ["back", "middle", "front"]
        );
        assert_eq!(selection.selected_element_id(), Some("middle"));
        selection
            .apply_hit(&document, Some("middle".to_string()), true)
            .expect("toggle is valid");
        assert_eq!(selection.selected_element_ids(), ["back", "front"]);
        assert_eq!(selection.selected_element_id(), Some("front"));

        document.elements.remove("front");
        document
            .root_order
            .retain(|element_id| element_id != "front");
        selection.reconcile(&document);
        assert_eq!(selection.selected_element_ids(), ["back"]);
        assert_eq!(selection.selected_element_id(), Some("back"));
    }

    #[test]
    fn marquee_selects_root_visual_bounds_and_supports_toggle() {
        let mut document = NodeInkDocumentV1::blank("marquee");
        document.root_order = vec!["left".to_string(), "right".to_string()];
        document.elements.insert(
            "left".to_string(),
            ElementRecordV1::Rect(rect("left", Affine2D::identity(), 0.0, 0.0, 20.0, 20.0)),
        );
        document.elements.insert(
            "right".to_string(),
            ElementRecordV1::Rect(rect("right", Affine2D::identity(), 100.0, 0.0, 20.0, 20.0)),
        );
        let mut selection = SelectionModel::default();
        selection
            .update_marquee(
                SelectionBoundsV1 {
                    x: -5.0,
                    y: -5.0,
                    width: 40.0,
                    height: 40.0,
                },
                SelectionMarqueeModeV1::Replace,
            )
            .expect("finite marquee preview is valid");
        assert!(selection.marquee.is_some());
        selection
            .apply_marquee(
                &document,
                SelectionBoundsV1 {
                    x: -5.0,
                    y: -5.0,
                    width: 40.0,
                    height: 40.0,
                },
                SelectionMarqueeModeV1::Replace,
                &TextMetricsCache::default(),
            )
            .expect("marquee is valid");
        assert_eq!(selection.selected_element_ids(), ["left"]);

        selection
            .apply_marquee(
                &document,
                SelectionBoundsV1 {
                    x: -5.0,
                    y: -5.0,
                    width: 140.0,
                    height: 40.0,
                },
                SelectionMarqueeModeV1::Toggle,
                &TextMetricsCache::default(),
            )
            .expect("marquee is valid");
        assert_eq!(selection.selected_element_ids(), ["right"]);
        assert_eq!(selection.selected_element_id(), Some("right"));

        let grouped = grouped_document();
        selection.clear();
        selection
            .apply_marquee(
                &grouped,
                SelectionBoundsV1 {
                    x: 120.0,
                    y: 10.0,
                    width: 2.0,
                    height: 2.0,
                },
                SelectionMarqueeModeV1::Replace,
                &TextMetricsCache::default(),
            )
            .expect("group marquee is valid");
        assert_eq!(selection.selected_element_ids(), ["outer"]);
    }

    #[test]
    fn multi_selection_snapshot_uses_union_bounds_and_hides_single_style() {
        let mut document = NodeInkDocumentV1::blank("multi-geometry");
        document.root_order = vec!["left".to_string(), "right".to_string()];
        document.elements.insert(
            "left".to_string(),
            ElementRecordV1::Rect(rect("left", Affine2D::identity(), 0.0, 0.0, 20.0, 20.0)),
        );
        document.elements.insert(
            "right".to_string(),
            ElementRecordV1::Rect(rect("right", Affine2D::identity(), 100.0, 0.0, 20.0, 20.0)),
        );
        let mut selection = SelectionModel::default();
        selection
            .set(
                &document,
                vec!["right".to_string(), "left".to_string()],
                Some("right".to_string()),
            )
            .expect("multi selection is valid");

        let snapshot = selection.snapshot(&document, None, None, &TextMetricsCache::default(), 1.0);

        assert_eq!(snapshot.selected_element_ids, ["left", "right"]);
        assert_eq!(selection.primary_element_id(), Some("right"));
        assert_eq!(
            snapshot.visual_bounds,
            Some(SelectionBoundsV1 {
                x: -1.0,
                y: -1.0,
                width: 122.0,
                height: 22.0,
            })
        );
        assert_close(
            snapshot
                .oriented_bounds
                .expect("multi geometry resolves")
                .rotation,
            0.0,
        );
        assert_eq!(snapshot.handles.len(), 9);
        assert_eq!(snapshot.style, None);
    }

    #[test]
    fn snapshot_exposes_rotated_visual_bounds_handles_alias_and_style() {
        let mut document = NodeInkDocumentV1::blank("snapshot");
        let transform = Affine2D::rotation(std::f64::consts::FRAC_PI_2)
            .expect("rotation is valid")
            .around(Point2D::new(10.0, 5.0))
            .expect("pivot transform is valid");
        document.root_order.push("rect".to_string());
        document.elements.insert(
            "rect".to_string(),
            ElementRecordV1::Rect(rect("rect", transform, 0.0, 0.0, 20.0, 10.0)),
        );
        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("rect".to_string()))
            .expect("selection is valid");
        selection
            .set_guides(vec![AlignmentGuideV1 {
                axis: AlignmentGuideAxisV1::X,
                position: 10.0,
                start: -10.0,
                end: 30.0,
            }])
            .expect("guide is finite");

        let preview_ids = ["rect".to_string()];
        let preview =
            Affine2D::translation(Point2D::new(5.0, 7.0)).expect("preview translation is valid");
        let snapshot = selection.snapshot(
            &document,
            Some((&preview_ids, preview)),
            None,
            &TextMetricsCache::default(),
            2.0,
        );

        assert_eq!(snapshot.selected_element_ids, ["rect"]);
        assert_eq!(snapshot.primary_element_id.as_deref(), Some("rect"));
        assert_eq!(snapshot.selected_element_id, snapshot.primary_element_id);
        assert_eq!(snapshot.handles.len(), 9);
        assert_eq!(snapshot.guides.len(), 1);
        assert!(matches!(
            snapshot.style,
            Some(SelectionStyleV1::Rect { .. })
        ));
        let oriented = snapshot.oriented_bounds.expect("selection is resolved");
        assert_close(oriented.rotation, std::f64::consts::FRAC_PI_2);
        let rotate = snapshot
            .handles
            .iter()
            .find(|handle| handle.id == SelectionHandleIdV1::Rotate)
            .expect("rotate handle exists");
        let north = snapshot
            .handles
            .iter()
            .find(|handle| handle.id == SelectionHandleIdV1::North)
            .expect("north handle exists");
        assert_close(
            (rotate.position.x - north.position.x).hypot(rotate.position.y - north.position.y),
            12.0,
        );
    }

    #[test]
    fn affine_preview_recomputes_oriented_bounds_and_handles() {
        let mut document = NodeInkDocumentV1::blank("affine-preview");
        document.root_order.push("rect".to_string());
        document.elements.insert(
            "rect".to_string(),
            ElementRecordV1::Rect(rect("rect", Affine2D::identity(), 0.0, 0.0, 20.0, 10.0)),
        );
        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("rect".to_string()))
            .expect("selection is valid");
        let preview_ids = ["rect".to_string()];
        let preview = Affine2D::rotation(std::f64::consts::FRAC_PI_2)
            .expect("rotation is valid")
            .around(Point2D::new(10.0, 5.0))
            .expect("pivot preview is valid");

        let snapshot = selection.snapshot(
            &document,
            Some((&preview_ids, preview)),
            None,
            &TextMetricsCache::default(),
            1.0,
        );

        let oriented = snapshot.oriented_bounds.expect("preview geometry resolves");
        assert_close(oriented.rotation, std::f64::consts::FRAC_PI_2);
        assert_close(oriented.center.x, 10.0);
        assert_close(oriented.center.y, 5.0);
        let east = snapshot
            .handles
            .iter()
            .find(|handle| handle.id == SelectionHandleIdV1::East)
            .expect("east handle exists");
        assert_close(east.position.x, 10.0);
        assert_close(east.position.y, 22.0);
    }

    #[test]
    fn affine_preview_moves_path_vertex_handles_with_the_selection() {
        let mut document = NodeInkDocumentV1::blank("path-affine-preview");
        document.root_order.push("line".to_string());
        document.elements.insert(
            "line".to_string(),
            ElementRecordV1::Line(LineElementV1 {
                id: "line".to_string(),
                transform: Affine2D::identity(),
                points: vec![Vec2 { x: 10.0, y: 20.0 }, Vec2 { x: 70.0, y: 50.0 }],
                stroke: "#0f172a".to_string(),
                size: ElementSizeV1::S,
            }),
        );
        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("line".to_string()))
            .expect("selection is valid");
        let preview_ids = ["line".to_string()];
        let preview = Affine2D::translation(Point2D::new(15.0, -5.0)).expect("preview is valid");

        let snapshot = selection.snapshot(
            &document,
            Some((&preview_ids, preview)),
            None,
            &TextMetricsCache::default(),
            1.0,
        );

        assert_eq!(snapshot.handles.len(), 2);
        assert_eq!(snapshot.handles[0].kind, SelectionHandleTypeV1::Vertex);
        assert_eq!(snapshot.handles[0].position, Vec2 { x: 25.0, y: 15.0 });
        assert_eq!(snapshot.handles[1].position, Vec2 { x: 85.0, y: 45.0 });
    }

    #[test]
    fn text_snapshot_omits_standalone_vertical_handles() {
        let mut document = NodeInkDocumentV1::blank("text-selection");
        let text = TextElementV1 {
            id: "text".to_string(),
            transform: Affine2D::identity(),
            x: 10.0,
            y: 20.0,
            text: "NodeInk".to_string(),
            font_family: crate::CANVAS_FONT_FAMILY.to_string(),
            font_size: 24.0,
            font_weight: 400,
            color: "#0f172a".to_string(),
            text_align: TextAlignV1::Start,
            max_width: None,
            font_fingerprint: "font-v1".to_string(),
        };
        document.root_order.push("text".to_string());
        document
            .elements
            .insert("text".to_string(), ElementRecordV1::Text(text));
        let mut metrics = TextMetricsCache::default();
        let request = metrics
            .request_for_document(&document, "request".to_string())
            .expect("text requires metrics");
        metrics
            .provide(
                &document,
                TextMetricsSnapshotV1 {
                    font_fingerprint: "font-v1".to_string(),
                    metrics: vec![TextMetricsV1 {
                        key: request.runs[0].key.clone(),
                        width: 90.0,
                        height: 28.0,
                        baseline: 21.0,
                        line_breaks: Vec::new(),
                    }],
                },
            )
            .expect("metrics are valid");
        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("text".to_string()))
            .expect("selection is valid");

        let snapshot = selection.snapshot(&document, None, None, &metrics, 1.0);

        assert_eq!(snapshot.handles.len(), 7);
        assert!(!snapshot.handles.iter().any(|handle| matches!(
            handle.id,
            SelectionHandleIdV1::North | SelectionHandleIdV1::South
        )));
    }

    #[test]
    fn selection_wire_matches_protocol_field_names() {
        let value =
            serde_json::to_value(SelectionStateV1::default()).expect("selection serializes");
        assert_eq!(
            value
                .as_object()
                .expect("selection is an object")
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "guides".to_string(),
                "handles".to_string(),
                "marquee".to_string(),
                "orientedBounds".to_string(),
                "primaryElementId".to_string(),
                "selectedElementId".to_string(),
                "selectedElementIds".to_string(),
                "style".to_string(),
                "visualBounds".to_string(),
            ])
        );

        let mut document = NodeInkDocumentV1::blank("vertex-selection-wire");
        document.root_order.push("line".to_string());
        document.elements.insert(
            "line".to_string(),
            ElementRecordV1::Line(LineElementV1 {
                id: "line".to_string(),
                transform: Affine2D::identity(),
                points: vec![Vec2 { x: 10.0, y: 20.0 }, Vec2 { x: 70.0, y: 50.0 }],
                stroke: "#0f172a".to_string(),
                size: ElementSizeV1::S,
            }),
        );
        let mut selection = SelectionModel::default();
        selection
            .set_single(&document, Some("line".to_string()))
            .expect("selection is valid");
        let value = serde_json::to_value(selection.snapshot(
            &document,
            None,
            None,
            &TextMetricsCache::default(),
            1.0,
        ))
        .expect("vertex selection serializes");
        let handle = &value["handles"][0];
        assert_eq!(handle["id"], "vertex");
        assert_eq!(handle["kind"], "vertex");
        assert_eq!(handle["vertexIndex"], 0);
        assert_eq!(handle["selected"], false);
    }

    fn grouped_document() -> NodeInkDocumentV1 {
        let mut document = NodeInkDocumentV1 {
            schema_version: SCHEMA_VERSION,
            document_id: "groups".to_string(),
            revision: 0,
            render_profile: RenderProfileV1::clean(),
            root_order: vec!["outer".to_string()],
            elements: BTreeMap::new(),
        };
        document.elements.insert(
            "outer".to_string(),
            ElementRecordV1::Group(GroupElementV1 {
                id: "outer".to_string(),
                transform: Affine2D::translation(Point2D::new(100.0, 0.0))
                    .expect("translation is valid"),
                child_order: vec!["inner".to_string()],
            }),
        );
        document.elements.insert(
            "inner".to_string(),
            ElementRecordV1::Group(GroupElementV1 {
                id: "inner".to_string(),
                transform: Affine2D::translation(Point2D::new(10.0, 0.0))
                    .expect("translation is valid"),
                child_order: vec!["leaf".to_string()],
            }),
        );
        document.elements.insert(
            "leaf".to_string(),
            ElementRecordV1::Rect(rect(
                "leaf",
                Affine2D::translation(Point2D::new(5.0, 0.0)).expect("translation is valid"),
                0.0,
                0.0,
                20.0,
                20.0,
            )),
        );
        document
    }

    fn rect(
        id: &str,
        transform: Affine2D,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> RectElementV1 {
        RectElementV1 {
            id: id.to_string(),
            transform,
            x,
            y,
            width,
            height,
            fill: FillV1::default_rectangle(),
            stroke: "#047857".to_string(),
            size: ElementSizeV1::S,
        }
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= EPSILON,
            "{actual} != {expected}"
        );
    }
}
