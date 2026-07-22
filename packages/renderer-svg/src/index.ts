import type {
  EditorOverlayV1,
  RendererV1,
  RenderApplyResultV1,
  RenderViewportResultV1,
  ScenePatchV1,
  ScenePathV1,
  SceneRectV1,
  SceneSnapshotV1,
  SceneTextV1,
  ViewportV1,
} from '@nodeink-internal/protocol';

const svgNamespace = 'http://www.w3.org/2000/svg';

export class SvgRenderer implements RendererV1 {
  #svg: SVGSVGElement | null = null;
  #overlay: SVGGElement | null = null;
  #nodeElements = new Map<string, SVGElement>();
  #rootNodeIds: string[] = [];
  #sceneRevision: number | null = null;

  mount(target: HTMLElement): void {
    this.unmount();
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 960 640');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'NodeInk canvas');
    svg.setAttribute('data-nodeink-canvas', 'true');
    const overlay = document.createElementNS(svgNamespace, 'g');
    overlay.dataset.nodeinkOverlay = 'true';
    overlay.setAttribute('pointer-events', 'none');
    overlay.setAttribute('aria-hidden', 'true');
    svg.append(overlay);
    target.replaceChildren(svg);
    this.#svg = svg;
    this.#overlay = overlay;
  }

  setOverlay(overlay: EditorOverlayV1): void {
    if (!Number.isFinite(overlay.selectionPaddingWorld) || overlay.selectionPaddingWorld < 0) {
      throw new Error('Selection overlay padding must be a finite non-negative number');
    }
    const group = this.requireOverlay();
    group.replaceChildren();
    if (overlay.selectionBounds) {
      const outline = createSelectionRectangle(
        overlay.selectionBounds,
        overlay.selectionPaddingWorld,
      );
      outline.dataset.nodeinkSelectionOutline = 'true';
      outline.setAttribute('stroke', 'var(--nodeink-selection-color, #0b74de)');
      outline.setAttribute('stroke-width', '2');
      group.append(outline);
    }
    this.requireSvg().append(group);
  }

  setViewport(viewport: ViewportV1): RenderViewportResultV1 {
    const startedAt = performance.now();
    if (
      !Number.isFinite(viewport.x) ||
      !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      throw new Error('SVG viewport must contain finite coordinates and positive dimensions');
    }
    this.requireSvg().setAttribute(
      'viewBox',
      `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`,
    );
    return { durationMs: performance.now() - startedAt };
  }

  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1 {
    const startedAt = performance.now();
    const svg = this.requireSvg();
    const liveNodeIds = new Set(snapshot.rootNodeIds);

    if (snapshot.rootNodeIds.some((nodeId) => !snapshot.nodes[nodeId])) {
      return { ok: false, reason: 'unsupported_scene' };
    }

    for (const [nodeId, element] of this.#nodeElements) {
      if (!liveNodeIds.has(nodeId)) {
        element.remove();
        this.#nodeElements.delete(nodeId);
      }
    }

    for (const nodeId of snapshot.rootNodeIds) {
      const node = snapshot.nodes[nodeId];
      if (!node) continue;
      const element = this.upsertNode(node);
      svg.append(element);
    }

    this.#rootNodeIds = [...snapshot.rootNodeIds];
    this.#sceneRevision = snapshot.sceneRevision;
    svg.dataset.sceneRevision = String(snapshot.sceneRevision);
    svg.append(this.requireOverlay());
    return {
      ok: true,
      sceneRevision: snapshot.sceneRevision,
      durationMs: performance.now() - startedAt,
      changedNodeCount: snapshot.rootNodeIds.length,
    };
  }

  applyPatch(patch: ScenePatchV1): RenderApplyResultV1 {
    const startedAt = performance.now();
    const svg = this.requireSvg();
    if (this.#sceneRevision !== patch.baseSceneRevision) {
      return { ok: false, reason: 'snapshot_required' };
    }

    const nextRootNodeIds = patch.rootNodeIds ?? this.#rootNodeIds;
    const removedNodeIds = new Set(patch.removedNodeIds);
    if (
      nextRootNodeIds.some(
        (nodeId) =>
          !patch.addedNodes[nodeId] &&
          !patch.updatedNodes[nodeId] &&
          (!this.#nodeElements.has(nodeId) || removedNodeIds.has(nodeId)),
      )
    ) {
      return { ok: false, reason: 'unsupported_scene' };
    }

    for (const nodeId of patch.removedNodeIds) {
      this.#nodeElements.get(nodeId)?.remove();
      this.#nodeElements.delete(nodeId);
    }
    for (const node of Object.values(patch.addedNodes)) {
      this.upsertNode(node);
    }
    for (const node of Object.values(patch.updatedNodes)) {
      this.upsertNode(node);
    }
    if (patch.rootNodeIds) {
      for (const nodeId of patch.rootNodeIds) {
        const element = this.#nodeElements.get(nodeId);
        if (element) svg.append(element);
      }
      this.#rootNodeIds = [...patch.rootNodeIds];
    }

    this.#sceneRevision = patch.sceneRevision;
    svg.dataset.sceneRevision = String(patch.sceneRevision);
    svg.append(this.requireOverlay());
    return {
      ok: true,
      sceneRevision: patch.sceneRevision,
      durationMs: performance.now() - startedAt,
      changedNodeCount: new Set([
        ...Object.keys(patch.addedNodes),
        ...Object.keys(patch.updatedNodes),
        ...patch.removedNodeIds,
      ]).size,
    };
  }

  unmount(): void {
    this.#svg?.remove();
    this.#svg = null;
    this.#overlay = null;
    this.#nodeElements.clear();
    this.#rootNodeIds = [];
    this.#sceneRevision = null;
  }

  private upsertNode(node: SceneRectV1 | ScenePathV1 | SceneTextV1): SVGElement {
    if (node.kind === 'rect') return this.upsertRectangle(node);
    return node.kind === 'path' ? this.upsertPath(node) : this.upsertText(node);
  }

  private upsertRectangle(node: SceneRectV1): SVGRectElement {
    const existing = this.#nodeElements.get(node.id);
    const rectangle =
      existing?.tagName.toLowerCase() === 'rect'
        ? (existing as SVGRectElement)
        : document.createElementNS(svgNamespace, 'rect');
    rectangle.dataset.sceneNodeId = node.id;
    rectangle.dataset.sourceElementId = node.sourceElementId;
    rectangle.setAttribute('x', String(node.x));
    rectangle.setAttribute('y', String(node.y));
    rectangle.setAttribute('width', String(node.width));
    rectangle.setAttribute('height', String(node.height));
    rectangle.setAttribute('rx', '12');
    rectangle.setAttribute('fill', node.fill);
    rectangle.setAttribute('stroke', node.stroke);
    rectangle.setAttribute('stroke-width', String(node.strokeWidth));
    this.#nodeElements.set(node.id, rectangle);
    return rectangle;
  }

  private upsertPath(node: ScenePathV1): SVGPathElement {
    const existing = this.#nodeElements.get(node.id);
    const path =
      existing?.tagName.toLowerCase() === 'path'
        ? (existing as SVGPathElement)
        : document.createElementNS(svgNamespace, 'path');
    path.dataset.sceneNodeId = node.id;
    path.dataset.sourceElementId = node.sourceElementId;
    path.setAttribute('d', node.pathData);
    path.setAttribute('fill', node.fill);
    path.setAttribute('stroke', node.stroke);
    path.setAttribute('stroke-width', String(node.strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    this.#nodeElements.set(node.id, path);
    return path;
  }

  private upsertText(node: SceneTextV1): SVGTextElement {
    const existing = this.#nodeElements.get(node.id);
    const text =
      existing?.tagName.toLowerCase() === 'text'
        ? (existing as SVGTextElement)
        : document.createElementNS(svgNamespace, 'text');
    text.dataset.sceneNodeId = node.id;
    text.dataset.sourceElementId = node.sourceElementId;
    text.replaceChildren(
      ...node.runs.map((run) => {
        const span = document.createElementNS(svgNamespace, 'tspan');
        span.textContent = run.text;
        span.setAttribute('x', String(run.x));
        span.setAttribute('y', String(run.y));
        span.setAttribute('font-family', run.fontFamily);
        span.setAttribute('font-size', String(run.fontSize));
        span.setAttribute('font-weight', String(run.fontWeight));
        span.setAttribute('fill', run.fill);
        return span;
      }),
    );
    this.#nodeElements.set(node.id, text);
    return text;
  }

  private requireSvg(): SVGSVGElement {
    if (!this.#svg) {
      throw new Error('SVG renderer must be mounted before applying a scene');
    }
    return this.#svg;
  }

  private requireOverlay(): SVGGElement {
    if (!this.#overlay) {
      throw new Error('SVG renderer must be mounted before applying an editor overlay');
    }
    return this.#overlay;
  }
}

function createSelectionRectangle(
  bounds: NonNullable<EditorOverlayV1['selectionBounds']>,
  padding: number,
): SVGRectElement {
  const rectangle = document.createElementNS(svgNamespace, 'rect');
  rectangle.setAttribute('x', String(bounds.x - padding));
  rectangle.setAttribute('y', String(bounds.y - padding));
  rectangle.setAttribute('width', String(bounds.width + padding * 2));
  rectangle.setAttribute('height', String(bounds.height + padding * 2));
  rectangle.setAttribute('fill', 'none');
  rectangle.setAttribute('vector-effect', 'non-scaling-stroke');
  return rectangle;
}
