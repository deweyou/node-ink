use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Hierarchy {
    root_order: Vec<String>,
    child_orders: BTreeMap<String, Vec<String>>,
    parent_by_element: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HierarchyError {
    DuplicateElementId {
        element_id: String,
    },
    UnknownElement {
        element_id: String,
    },
    MultipleParents {
        element_id: String,
        first_parent: Option<String>,
        second_parent: Option<String>,
    },
    MissingParent {
        element_id: String,
    },
    Cycle {
        element_id: String,
    },
    EmptySiblingSet,
    DifferentParents {
        first_element_id: String,
        element_id: String,
    },
}

impl Hierarchy {
    /// Validates and indexes explicit root and child orders without sorting them.
    /// Every known element must appear exactly once in either the root order or
    /// one parent's child order.
    pub(crate) fn new(
        element_ids: impl IntoIterator<Item = String>,
        root_order: Vec<String>,
        child_orders: BTreeMap<String, Vec<String>>,
    ) -> Result<Self, HierarchyError> {
        let mut elements = BTreeSet::new();
        for element_id in element_ids {
            if !elements.insert(element_id.clone()) {
                return Err(HierarchyError::DuplicateElementId { element_id });
            }
        }

        for parent_id in child_orders.keys() {
            ensure_known(&elements, parent_id)?;
        }

        let mut parent_by_element = BTreeMap::new();
        for element_id in &root_order {
            assign_parent(&elements, &mut parent_by_element, element_id, None)?;
        }
        for (parent_id, child_order) in &child_orders {
            for element_id in child_order {
                assign_parent(
                    &elements,
                    &mut parent_by_element,
                    element_id,
                    Some(parent_id.as_str()),
                )?;
            }
        }
        if let Some(element_id) = elements
            .iter()
            .find(|element_id| !parent_by_element.contains_key(*element_id))
        {
            return Err(HierarchyError::MissingParent {
                element_id: element_id.clone(),
            });
        }

        let hierarchy = Self {
            root_order,
            child_orders,
            parent_by_element,
        };
        hierarchy.validate_acyclic()?;
        Ok(hierarchy)
    }

    pub(crate) fn root_order(&self) -> &[String] {
        &self.root_order
    }

    pub(crate) fn children_of(&self, parent_id: &str) -> Option<&[String]> {
        self.child_orders.get(parent_id).map(Vec::as_slice)
    }

    pub(crate) fn parent_of(&self, element_id: &str) -> Option<Option<&str>> {
        self.parent_by_element
            .get(element_id)
            .map(|parent| parent.as_deref())
    }

    /// Returns the common parent for a non-empty sibling set. Root siblings
    /// return `Ok(None)`.
    pub(crate) fn ensure_same_parent(
        &self,
        element_ids: &[&str],
    ) -> Result<Option<String>, HierarchyError> {
        let Some(first_element_id) = element_ids.first() else {
            return Err(HierarchyError::EmptySiblingSet);
        };
        let first_parent = self
            .parent_by_element
            .get(*first_element_id)
            .ok_or_else(|| HierarchyError::UnknownElement {
                element_id: (*first_element_id).to_string(),
            })?;
        for element_id in &element_ids[1..] {
            let parent = self.parent_by_element.get(*element_id).ok_or_else(|| {
                HierarchyError::UnknownElement {
                    element_id: (*element_id).to_string(),
                }
            })?;
            if parent != first_parent {
                return Err(HierarchyError::DifferentParents {
                    first_element_id: (*first_element_id).to_string(),
                    element_id: (*element_id).to_string(),
                });
            }
        }
        Ok(first_parent.clone())
    }

    /// Produces a deterministic parent-before-children traversal while
    /// preserving every explicit sibling order.
    pub(crate) fn stable_depth_first_order(&self) -> Vec<&str> {
        let mut order = Vec::with_capacity(self.parent_by_element.len());
        for element_id in &self.root_order {
            self.append_subtree(element_id, &mut order);
        }
        order
    }

    fn append_subtree<'a>(&'a self, element_id: &'a str, order: &mut Vec<&'a str>) {
        order.push(element_id);
        if let Some(children) = self.child_orders.get(element_id) {
            for child_id in children {
                self.append_subtree(child_id, order);
            }
        }
    }

    fn validate_acyclic(&self) -> Result<(), HierarchyError> {
        for element_id in self.parent_by_element.keys() {
            let mut ancestors = BTreeSet::new();
            let mut current = Some(element_id.as_str());
            while let Some(current_id) = current {
                if !ancestors.insert(current_id) {
                    return Err(HierarchyError::Cycle {
                        element_id: current_id.to_string(),
                    });
                }
                current = self
                    .parent_by_element
                    .get(current_id)
                    .and_then(|parent| parent.as_deref());
            }
        }
        Ok(())
    }
}

fn ensure_known(elements: &BTreeSet<String>, element_id: &str) -> Result<(), HierarchyError> {
    if !elements.contains(element_id) {
        return Err(HierarchyError::UnknownElement {
            element_id: element_id.to_string(),
        });
    }
    Ok(())
}

fn assign_parent(
    elements: &BTreeSet<String>,
    parent_by_element: &mut BTreeMap<String, Option<String>>,
    element_id: &str,
    parent: Option<&str>,
) -> Result<(), HierarchyError> {
    ensure_known(elements, element_id)?;
    let next_parent = parent.map(str::to_string);
    if let Some(first_parent) =
        parent_by_element.insert(element_id.to_string(), next_parent.clone())
    {
        return Err(HierarchyError::MultipleParents {
            element_id: element_id.to_string(),
            first_parent,
            second_parent: next_parent,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_root_child_and_depth_first_orders() {
        let hierarchy = hierarchy(
            &["back", "group", "front", "second", "first", "nested"],
            &["back", "group", "front"],
            &[("group", &["second", "first"]), ("first", &["nested"])],
        )
        .expect("fixture hierarchy is valid");

        assert_eq!(hierarchy.root_order(), ["back", "group", "front"]);
        assert_eq!(
            hierarchy
                .children_of("group")
                .expect("group has children")
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["second", "first"]
        );
        assert_eq!(
            hierarchy.stable_depth_first_order(),
            ["back", "group", "second", "first", "nested", "front"]
        );
        assert_eq!(hierarchy.parent_of("group"), Some(None));
        assert_eq!(hierarchy.parent_of("nested"), Some(Some("first")));
        assert_eq!(hierarchy.parent_of("missing"), None);
    }

    #[test]
    fn rejects_multiple_parents_and_duplicate_sibling_entries() {
        assert_eq!(
            hierarchy(
                &["group-a", "group-b", "child"],
                &["group-a", "group-b"],
                &[("group-a", &["child"]), ("group-b", &["child"])],
            ),
            Err(HierarchyError::MultipleParents {
                element_id: "child".to_string(),
                first_parent: Some("group-a".to_string()),
                second_parent: Some("group-b".to_string()),
            })
        );
        assert!(matches!(
            hierarchy(
                &["group", "child"],
                &["group"],
                &[("group", &["child", "child"])],
            ),
            Err(HierarchyError::MultipleParents { element_id, .. }) if element_id == "child"
        ));
    }

    #[test]
    fn rejects_disconnected_cycles_and_missing_placements() {
        assert!(matches!(
            hierarchy(
                &["root", "cycle-a", "cycle-b"],
                &["root"],
                &[("cycle-a", &["cycle-b"]), ("cycle-b", &["cycle-a"])],
            ),
            Err(HierarchyError::Cycle { .. })
        ));
        assert_eq!(
            hierarchy(&["root", "orphan"], &["root"], &[]),
            Err(HierarchyError::MissingParent {
                element_id: "orphan".to_string(),
            })
        );
    }

    #[test]
    fn validates_same_parent_sibling_sets() {
        let hierarchy = hierarchy(
            &["group", "first", "second", "root-sibling"],
            &["group", "root-sibling"],
            &[("group", &["first", "second"])],
        )
        .expect("fixture hierarchy is valid");

        assert_eq!(
            hierarchy.ensure_same_parent(&["first", "second"]),
            Ok(Some("group".to_string()))
        );
        assert_eq!(
            hierarchy.ensure_same_parent(&["group", "root-sibling"]),
            Ok(None)
        );
        assert!(matches!(
            hierarchy.ensure_same_parent(&["first", "root-sibling"]),
            Err(HierarchyError::DifferentParents { .. })
        ));
        assert_eq!(
            hierarchy.ensure_same_parent(&[]),
            Err(HierarchyError::EmptySiblingSet)
        );
    }

    #[test]
    fn rejects_unknown_ids_and_duplicate_element_declarations() {
        assert_eq!(
            hierarchy(&["known"], &["missing"], &[]),
            Err(HierarchyError::UnknownElement {
                element_id: "missing".to_string(),
            })
        );
        assert_eq!(
            Hierarchy::new(
                ["same".to_string(), "same".to_string()],
                vec!["same".to_string()],
                BTreeMap::new(),
            ),
            Err(HierarchyError::DuplicateElementId {
                element_id: "same".to_string(),
            })
        );
    }

    fn hierarchy(
        element_ids: &[&str],
        root_order: &[&str],
        child_orders: &[(&str, &[&str])],
    ) -> Result<Hierarchy, HierarchyError> {
        Hierarchy::new(
            element_ids
                .iter()
                .map(|element_id| (*element_id).to_string()),
            root_order
                .iter()
                .map(|element_id| (*element_id).to_string())
                .collect(),
            child_orders
                .iter()
                .map(|(parent_id, children)| {
                    (
                        (*parent_id).to_string(),
                        children
                            .iter()
                            .map(|element_id| (*element_id).to_string())
                            .collect(),
                    )
                })
                .collect(),
        )
    }
}
