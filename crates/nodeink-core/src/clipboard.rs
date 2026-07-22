use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    ElementId, ElementRecordV1, EngineErrorV1, GroupElementV1,
    hierarchy::Hierarchy,
    transform::{Affine2D, Point2D},
};

const CLIPBOARD_VERSION: u32 = 1;
const CLIPBOARD_MIME: &str = "application/x-nodeink-elements+json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardPayloadV1 {
    pub mime: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardDocumentV1 {
    version: u32,
    source_document_id: String,
    root_element_ids: Vec<ElementId>,
    elements: BTreeMap<ElementId, ElementRecordV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DecodedClipboardV1 {
    pub(crate) root_element_ids: Vec<ElementId>,
    pub(crate) elements: BTreeMap<ElementId, ElementRecordV1>,
}

pub(crate) fn encode_clipboard(
    source_document_id: &str,
    root_element_ids: Vec<ElementId>,
    elements: BTreeMap<ElementId, ElementRecordV1>,
) -> Result<ClipboardPayloadV1, EngineErrorV1> {
    validate_clipboard_hierarchy(&root_element_ids, &elements)?;
    let data = serde_json::to_string(&ClipboardDocumentV1 {
        version: CLIPBOARD_VERSION,
        source_document_id: source_document_id.to_string(),
        root_element_ids,
        elements,
    })
    .map_err(|_| EngineErrorV1::InvalidClipboard)?;
    Ok(ClipboardPayloadV1 {
        mime: CLIPBOARD_MIME.to_string(),
        data,
    })
}

pub(crate) fn decode_clipboard(payload: &str) -> Result<DecodedClipboardV1, EngineErrorV1> {
    let decoded: ClipboardDocumentV1 =
        serde_json::from_str(payload).map_err(|_| EngineErrorV1::InvalidClipboard)?;
    if decoded.version != CLIPBOARD_VERSION || decoded.source_document_id.trim().is_empty() {
        return Err(EngineErrorV1::InvalidClipboard);
    }
    validate_clipboard_hierarchy(&decoded.root_element_ids, &decoded.elements)?;
    Ok(DecodedClipboardV1 {
        root_element_ids: decoded.root_element_ids,
        elements: decoded.elements,
    })
}

pub(crate) fn remap_clipboard(
    decoded: DecodedClipboardV1,
    id_prefix: &str,
    offset: Point2D,
) -> Result<DecodedClipboardV1, EngineErrorV1> {
    if id_prefix.trim().is_empty() || !offset.x.is_finite() || !offset.y.is_finite() {
        return Err(EngineErrorV1::InvalidClipboard);
    }
    let hierarchy = clipboard_hierarchy(&decoded.root_element_ids, &decoded.elements)?;
    let order = hierarchy.stable_depth_first_order();
    let id_map = order
        .iter()
        .enumerate()
        .map(|(index, element_id)| ((*element_id).to_string(), format!("{id_prefix}-{index}")))
        .collect::<BTreeMap<_, _>>();
    let mut elements = BTreeMap::new();
    for element_id in order {
        let mut element = decoded
            .elements
            .get(element_id)
            .cloned()
            .ok_or(EngineErrorV1::InvalidClipboard)?;
        let remapped_id = id_map
            .get(element_id)
            .cloned()
            .ok_or(EngineErrorV1::InvalidClipboard)?;
        match &mut element {
            ElementRecordV1::Rect(rectangle) => rectangle.id = remapped_id.clone(),
            ElementRecordV1::Stroke(stroke) => stroke.id = remapped_id.clone(),
            ElementRecordV1::Text(text) => text.id = remapped_id.clone(),
            ElementRecordV1::Group(group) => {
                group.id = remapped_id.clone();
                group.child_order = group
                    .child_order
                    .iter()
                    .map(|child_id| {
                        id_map
                            .get(child_id)
                            .cloned()
                            .ok_or(EngineErrorV1::InvalidClipboard)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
            }
        }
        if decoded
            .root_element_ids
            .iter()
            .any(|root| root == element_id)
        {
            let translation =
                Affine2D::translation(offset).map_err(|_| EngineErrorV1::InvalidClipboard)?;
            let transform = element
                .transform()
                .compose(translation)
                .map_err(|_| EngineErrorV1::InvalidClipboard)?;
            element.set_transform(transform);
        }
        elements.insert(remapped_id, element);
    }
    let root_element_ids = decoded
        .root_element_ids
        .iter()
        .map(|element_id| {
            id_map
                .get(element_id)
                .cloned()
                .ok_or(EngineErrorV1::InvalidClipboard)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DecodedClipboardV1 {
        root_element_ids,
        elements,
    })
}

fn validate_clipboard_hierarchy(
    root_element_ids: &[ElementId],
    elements: &BTreeMap<ElementId, ElementRecordV1>,
) -> Result<(), EngineErrorV1> {
    clipboard_hierarchy(root_element_ids, elements).map(|_| ())
}

fn clipboard_hierarchy(
    root_element_ids: &[ElementId],
    elements: &BTreeMap<ElementId, ElementRecordV1>,
) -> Result<Hierarchy, EngineErrorV1> {
    let child_orders = elements
        .values()
        .filter_map(|element| match element {
            ElementRecordV1::Group(GroupElementV1 {
                id, child_order, ..
            }) => Some((id.clone(), child_order.clone())),
            _ => None,
        })
        .collect();
    Hierarchy::new(
        elements.keys().cloned(),
        root_element_ids.to_vec(),
        child_orders,
    )
    .map_err(|_| EngineErrorV1::InvalidClipboard)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FillV1, RectElementV1};

    #[test]
    fn opaque_payload_round_trips_and_remaps_every_id() {
        let group = GroupElementV1 {
            id: "group".to_string(),
            transform: Affine2D::IDENTITY,
            child_order: vec!["rect".to_string()],
        };
        let rectangle = RectElementV1 {
            id: "rect".to_string(),
            transform: Affine2D::IDENTITY,
            x: 1.0,
            y: 2.0,
            width: 10.0,
            height: 20.0,
            fill: FillV1::default_rectangle(),
            stroke: "#047857".to_string(),
            stroke_width: 2.0,
        };
        let payload = encode_clipboard(
            "source",
            vec!["group".to_string()],
            BTreeMap::from([
                ("group".to_string(), ElementRecordV1::Group(group)),
                ("rect".to_string(), ElementRecordV1::Rect(rectangle)),
            ]),
        )
        .expect("clipboard fixture is valid");
        assert_eq!(payload.mime, CLIPBOARD_MIME);

        let remapped = remap_clipboard(
            decode_clipboard(&payload.data).expect("opaque payload decodes"),
            "paste",
            Point2D::new(24.0, 32.0),
        )
        .expect("clipboard remaps");
        assert_eq!(remapped.root_element_ids, ["paste-0"]);
        let ElementRecordV1::Group(group) = &remapped.elements["paste-0"] else {
            panic!("root remains a group")
        };
        assert_eq!(group.child_order, ["paste-1"]);
        assert_eq!(group.transform.e, 24.0);
        assert_eq!(group.transform.f, 32.0);
    }

    #[test]
    fn rejects_malformed_unknown_and_cyclic_payloads() {
        assert_eq!(
            decode_clipboard("not json"),
            Err(EngineErrorV1::InvalidClipboard)
        );
        assert_eq!(
            decode_clipboard(
                r#"{"version":2,"sourceDocumentId":"source","rootElementIds":[],"elements":{}}"#
            ),
            Err(EngineErrorV1::InvalidClipboard)
        );
    }
}
