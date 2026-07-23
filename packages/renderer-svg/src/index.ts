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
const selectionColor = 'var(--nodeink-selection-color, #2563eb)';
const selectionGapPx = 6;
const resizeHandleSizePx = 8;
const rotateHandleRadiusPx = 5;

export class SvgRenderer implements RendererV1 {
  #svg: SVGSVGElement | null = null;
  #overlay: SVGGElement | null = null;
  #nodeElements = new Map<string, SVGElement>();
  #rootNodeIds: string[] = [];
  #sceneRevision: number | null = null;
  #screenPixelsPerWorldUnit = 1;

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
    this.#screenPixelsPerWorldUnit = 1;
  }

  setOverlay(overlay: EditorOverlayV1): void {
    validateOverlay(overlay);
    const group = this.requireOverlay();
    group.replaceChildren();
    for (const guide of overlay.guides) {
      group.append(createAlignmentGuide(guide));
    }
    if (overlay.marquee) {
      group.append(createMarquee(overlay.marquee));
    }
    const isPathEditingSelection =
      overlay.selectionHandles.length > 0 &&
      overlay.selectionHandles.some((handle) => handle.kind === 'vertex') &&
      overlay.selectionHandles.every(
        (handle) => handle.kind === 'vertex' || handle.kind === 'curve',
      );
    const outline = isPathEditingSelection
      ? null
      : overlay.selectionOrientedBounds
        ? createOrientedSelectionRectangle(
            overlay.selectionOrientedBounds,
            overlay.selectionPaddingWorld,
          )
        : overlay.selectionBounds
          ? createSelectionRectangle(overlay.selectionBounds, overlay.selectionPaddingWorld)
          : null;
    if (outline) {
      outline.dataset.nodeinkSelectionOutline = 'true';
      outline.setAttribute('stroke', selectionColor);
      outline.setAttribute('stroke-width', '2');
      group.append(outline);
    }
    const worldPerScreenPixel =
      overlay.selectionPaddingWorld > 0 ? overlay.selectionPaddingWorld / selectionGapPx : 1;
    const rotateHandle = overlay.selectionHandles.find((handle) => handle.kind === 'rotate');
    if (rotateHandle) {
      group.append(
        createRotateConnector(
          overlay.selectionOrientedBounds,
          rotateHandle.position,
          overlay.selectionPaddingWorld,
        ),
      );
    }
    for (const handle of overlay.selectionHandles) {
      group.append(createSelectionHandle(handle, worldPerScreenPixel));
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
    const svg = this.requireSvg();
    svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
    this.#screenPixelsPerWorldUnit = screenPixelsPerWorldUnit(svg, viewport);
    for (const element of this.#nodeElements.values()) {
      const strokeWidth = Number(element.dataset.nodeinkStrokeWidth);
      if (Number.isFinite(strokeWidth)) {
        setDocumentStroke(element, strokeWidth, this.#screenPixelsPerWorldUnit);
      }
    }
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
    this.#screenPixelsPerWorldUnit = 1;
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
    setDocumentStroke(rectangle, node.strokeWidth, this.#screenPixelsPerWorldUnit);
    setTransform(rectangle, node.transform);
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
    setDocumentStroke(path, node.strokeWidth, this.#screenPixelsPerWorldUnit);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    setTransform(path, node.transform);
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
    setTransform(text, node.transform);
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
        span.setAttribute('text-anchor', run.textAnchor);
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

function createOrientedSelectionRectangle(
  bounds: NonNullable<EditorOverlayV1['selectionOrientedBounds']>,
  padding: number,
): SVGRectElement {
  const rectangle = document.createElementNS(svgNamespace, 'rect');
  rectangle.setAttribute('x', String(-(bounds.width / 2 + padding)));
  rectangle.setAttribute('y', String(-(bounds.height / 2 + padding)));
  rectangle.setAttribute('width', String(bounds.width + padding * 2));
  rectangle.setAttribute('height', String(bounds.height + padding * 2));
  rectangle.setAttribute('fill', 'none');
  rectangle.setAttribute('vector-effect', 'non-scaling-stroke');
  rectangle.setAttribute(
    'transform',
    `translate(${bounds.center.x} ${bounds.center.y}) rotate(${radiansToDegrees(bounds.rotation)})`,
  );
  return rectangle;
}

function createSelectionHandle(
  handle: EditorOverlayV1['selectionHandles'][number],
  worldPerScreenPixel: number,
): SVGElement {
  if (handle.kind === 'rotate' || handle.kind === 'curve') {
    const circle = document.createElementNS(svgNamespace, 'circle');
    circle.setAttribute('cx', String(handle.position.x));
    circle.setAttribute('cy', String(handle.position.y));
    circle.setAttribute('r', String(rotateHandleRadiusPx * worldPerScreenPixel));
    applyHandlePaint(circle, handle);
    return circle;
  }
  const rectangle = document.createElementNS(svgNamespace, 'rect');
  const size = resizeHandleSizePx * worldPerScreenPixel;
  rectangle.setAttribute('x', String(handle.position.x - size / 2));
  rectangle.setAttribute('y', String(handle.position.y - size / 2));
  rectangle.setAttribute('width', String(size));
  rectangle.setAttribute('height', String(size));
  applyHandlePaint(rectangle, handle);
  return rectangle;
}

function applyHandlePaint(
  element: SVGElement,
  handle: EditorOverlayV1['selectionHandles'][number],
): void {
  element.dataset.nodeinkSelectionHandle =
    handle.kind === 'vertex' ? `vertex:${handle.vertexIndex}` : handle.id;
  element.setAttribute(
    'fill',
    handle.kind === 'vertex' && handle.selected
      ? selectionColor
      : handle.kind === 'curve'
        ? 'var(--nodeink-selection-curve-fill, #dbeafe)'
        : 'var(--nodeink-selection-handle-fill, #ffffff)',
  );
  element.setAttribute('stroke', selectionColor);
  element.setAttribute('stroke-width', '1.5');
  element.setAttribute('vector-effect', 'non-scaling-stroke');
}

function createRotateConnector(
  bounds: EditorOverlayV1['selectionOrientedBounds'],
  rotatePosition: { x: number; y: number },
  padding: number,
): SVGLineElement {
  const line = document.createElementNS(svgNamespace, 'line');
  const start = bounds
    ? rotatePoint(
        { x: bounds.center.x, y: bounds.center.y - bounds.height / 2 - padding },
        bounds.center,
        bounds.rotation,
      )
    : rotatePosition;
  line.dataset.nodeinkRotateConnector = 'true';
  line.setAttribute('x1', String(start.x));
  line.setAttribute('y1', String(start.y));
  line.setAttribute('x2', String(rotatePosition.x));
  line.setAttribute('y2', String(rotatePosition.y));
  line.setAttribute('stroke', selectionColor);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  return line;
}

function createMarquee(marquee: NonNullable<EditorOverlayV1['marquee']>): SVGRectElement {
  const rectangle = document.createElementNS(svgNamespace, 'rect');
  rectangle.dataset.nodeinkSelectionMarquee = marquee.mode;
  rectangle.setAttribute('x', String(marquee.bounds.x));
  rectangle.setAttribute('y', String(marquee.bounds.y));
  rectangle.setAttribute('width', String(marquee.bounds.width));
  rectangle.setAttribute('height', String(marquee.bounds.height));
  rectangle.setAttribute('fill', 'var(--nodeink-selection-marquee-fill, rgba(37, 99, 235, 0.12))');
  rectangle.setAttribute('stroke', selectionColor);
  rectangle.setAttribute('stroke-width', '1');
  rectangle.setAttribute('stroke-dasharray', '4 3');
  rectangle.setAttribute('vector-effect', 'non-scaling-stroke');
  return rectangle;
}

function createAlignmentGuide(guide: EditorOverlayV1['guides'][number]): SVGLineElement {
  const line = document.createElementNS(svgNamespace, 'line');
  line.dataset.nodeinkAlignmentGuide = guide.axis;
  if (guide.axis === 'x') {
    line.setAttribute('x1', String(guide.position));
    line.setAttribute('x2', String(guide.position));
    line.setAttribute('y1', String(guide.start));
    line.setAttribute('y2', String(guide.end));
  } else {
    line.setAttribute('x1', String(guide.start));
    line.setAttribute('x2', String(guide.end));
    line.setAttribute('y1', String(guide.position));
    line.setAttribute('y2', String(guide.position));
  }
  line.setAttribute('stroke', 'var(--nodeink-guide-color, #2563eb)');
  line.setAttribute('stroke-width', '1');
  line.setAttribute('stroke-dasharray', '4 4');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  return line;
}

function setTransform(element: SVGElement, transform: SceneRectV1['transform']): void {
  element.setAttribute(
    'transform',
    `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`,
  );
}

function setDocumentStroke(
  element: SVGElement,
  strokeWidth: number,
  screenPixelsPerWorldUnit: number,
): void {
  element.dataset.nodeinkStrokeWidth = String(strokeWidth);
  element.setAttribute('stroke-width', String(strokeWidth * screenPixelsPerWorldUnit));
  element.setAttribute('vector-effect', 'non-scaling-stroke');
}

function screenPixelsPerWorldUnit(svg: SVGSVGElement, viewport: ViewportV1): number {
  const bounds = svg.getBoundingClientRect();
  const scaleX = bounds.width / viewport.width;
  const scaleY = bounds.height / viewport.height;
  return Number.isFinite(scaleX) && scaleX > 0 && Number.isFinite(scaleY) && scaleY > 0
    ? Math.min(scaleX, scaleY)
    : 1;
}

function validateOverlay(overlay: EditorOverlayV1): void {
  if (!Number.isFinite(overlay.selectionPaddingWorld) || overlay.selectionPaddingWorld < 0) {
    throw new Error('Selection overlay padding must be a finite non-negative number');
  }
  const finite = (values: number[]) => values.every(Number.isFinite);
  if (
    overlay.selectionOrientedBounds &&
    (!finite([
      overlay.selectionOrientedBounds.center.x,
      overlay.selectionOrientedBounds.center.y,
      overlay.selectionOrientedBounds.width,
      overlay.selectionOrientedBounds.height,
      overlay.selectionOrientedBounds.rotation,
    ]) ||
      overlay.selectionOrientedBounds.width < 0 ||
      overlay.selectionOrientedBounds.height < 0)
  ) {
    throw new Error('Selection overlay contains invalid oriented bounds');
  }
  if (
    overlay.selectionHandles.some((handle) => !finite([handle.position.x, handle.position.y])) ||
    overlay.guides.some((guide) => !finite([guide.position, guide.start, guide.end])) ||
    (overlay.marquee &&
      (!finite([
        overlay.marquee.bounds.x,
        overlay.marquee.bounds.y,
        overlay.marquee.bounds.width,
        overlay.marquee.bounds.height,
      ]) ||
        overlay.marquee.bounds.width < 0 ||
        overlay.marquee.bounds.height < 0))
  ) {
    throw new Error('Selection overlay contains non-finite geometry');
  }
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function rotatePoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}
