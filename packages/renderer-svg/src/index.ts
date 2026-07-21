import type {
  RendererV1,
  RenderApplyResultV1,
  ScenePathV1,
  SceneRectV1,
  SceneSnapshotV1,
} from '@nodeink-internal/protocol';

const svgNamespace = 'http://www.w3.org/2000/svg';

export class SvgRenderer implements RendererV1 {
  #svg: SVGSVGElement | null = null;
  #nodeElements = new Map<string, SVGElement>();

  mount(target: HTMLElement): void {
    this.unmount();
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 960 640');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'NodeInk canvas');
    svg.setAttribute('data-nodeink-canvas', 'true');
    target.replaceChildren(svg);
    this.#svg = svg;
  }

  applySnapshot(snapshot: SceneSnapshotV1): RenderApplyResultV1 {
    const startedAt = performance.now();
    const svg = this.requireSvg();
    const liveNodeIds = new Set(snapshot.rootNodeIds);

    for (const [nodeId, element] of this.#nodeElements) {
      if (!liveNodeIds.has(nodeId)) {
        element.remove();
        this.#nodeElements.delete(nodeId);
      }
    }

    for (const nodeId of snapshot.rootNodeIds) {
      const node = snapshot.nodes[nodeId];
      if (!node) {
        return { ok: false, reason: 'unsupported_scene' };
      }
      const element = node.kind === 'rect' ? this.upsertRectangle(node) : this.upsertPath(node);
      svg.append(element);
    }

    svg.dataset.sceneRevision = String(snapshot.sceneRevision);
    return {
      ok: true,
      sceneRevision: snapshot.sceneRevision,
      durationMs: performance.now() - startedAt,
      changedNodeCount: snapshot.rootNodeIds.length,
    };
  }

  unmount(): void {
    this.#svg?.remove();
    this.#svg = null;
    this.#nodeElements.clear();
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
    rectangle.setAttribute('stroke-width', '2');
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

  private requireSvg(): SVGSVGElement {
    if (!this.#svg) {
      throw new Error('SVG renderer must be mounted before applying a scene');
    }
    return this.#svg;
  }
}
