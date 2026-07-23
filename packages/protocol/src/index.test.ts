import { describe, expect, it } from 'vitest';

import {
  canvasFontFamily,
  createBlankDocument,
  createIdentityAffine2D,
  nodeInkClipboardMime,
  parseCamera,
  parseClipboardPayload,
  parseCommandEnvelope,
  parseDiagramOperationBatchResult,
  parseEngineUpdate,
  parseMigrationAttempt,
  parseNodeInkDocument,
  parseNormalizedPointerEvents,
  parsePointerUpdate,
  parseScenePatch,
  parseSceneResolution,
  parseSceneSnapshot,
  parseStrokeUpdate,
  parseTextEditTarget,
  parseTextFixtureResolution,
  parseVertexEditUpdate,
} from './index';

const fixtureFontFingerprint = 'noto-sans-sc-v40-fontsource-5.3.0';

describe('protocol V1 with schema V4 documents', () => {
  it('parses finite Camera state within the supported zoom range', () => {
    expect(parseCamera('{"x":-12,"y":24,"zoom":1.5}')).toEqual({
      x: -12,
      y: 24,
      zoom: 1.5,
    });
    expect(() => parseCamera('{"x":0,"y":0,"zoom":0.09}')).toThrow('Camera V1');
    expect(() => parseCamera('{"x":0,"y":0,"zoom":9}')).toThrow('Camera V1');
  });

  it.each([
    null,
    { x: '0', y: 0, zoom: 1 },
    { x: null, y: 0, zoom: 1 },
    { x: 0, y: '0', zoom: 1 },
    { x: 0, y: null, zoom: 1 },
    { x: 0, y: 0, zoom: '1' },
    { x: 0, y: 0, zoom: null },
  ])('rejects each malformed Camera boundary %o', (camera) => {
    expect(() => parseCamera(JSON.stringify(camera))).toThrow('Camera V1');
  });

  it('creates a blank document with explicit versions', () => {
    expect(createBlankDocument('doc-1')).toEqual({
      schemaVersion: 6,
      documentId: 'doc-1',
      revision: 0,
      renderProfile: { kind: 'clean', version: 1 },
      rootOrder: [],
      elements: {},
    });
  });

  it('rejects an update with an unsupported protocol version', () => {
    expect(() =>
      parseEngineUpdate(
        JSON.stringify({
          operation: null,
          scene: {
            protocolVersion: 2,
            documentRevision: 0,
            sceneRevision: 0,
            renderProfile: { kind: 'clean', version: 1 },
            rootNodeIds: [],
            nodes: {},
          },
          history: { canUndo: false, canRedo: false },
          selection: emptySelectionFixture(),
        }),
      ),
    ).toThrow('protocol V1');
  });

  it('parses a valid engine update', () => {
    const update = {
      activeTool: 'freehand',
      textMeasureRequest: {
        requestId: 'measure-text-1',
        fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
        runs: [
          {
            key: 'text-1',
            text: '第一行\nSecond line',
            fontFamily: 'Noto Sans SC Variable',
            fontSize: 20,
            fontWeight: 400,
            maxWidth: 240,
          },
        ],
      },
      operation: null,
      scene: {
        protocolVersion: 1,
        documentId: 'doc-1',
        documentRevision: 3,
        sceneRevision: 4,
        renderProfile: { kind: 'clean', version: 1 },
        rootNodeIds: [],
        nodes: {},
      },
      history: { canUndo: true, canRedo: false },
      selection: {
        selectedElementIds: ['rect-1'],
        primaryElementId: 'rect-1',
        selectedElementId: 'rect-1',
        visualBounds: { x: 8, y: 12, width: 120, height: 80 },
        orientedBounds: {
          center: { x: 68, y: 52 },
          width: 120,
          height: 80,
          rotation: 0,
        },
        handles: selectionHandlesFixture(),
        marquee: null,
        guides: [],
        style: {
          kind: 'rect',
          fill: { kind: 'solid', color: '#d1fae5' },
          stroke: '#047857',
          size: 'm',
        },
      },
    };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it('keeps selected unresolved text style while its measured bounds are pending', () => {
    const update = {
      ...updateFixture(),
      selection: {
        selectedElementIds: ['text-1'],
        primaryElementId: 'text-1',
        selectedElementId: 'text-1',
        visualBounds: null,
        orientedBounds: null,
        handles: [],
        marquee: null,
        guides: [],
        style: textSelectionStyle(),
      },
    };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it('defaults legacy engine updates to the select tool', () => {
    const legacy = updateFixture();
    delete (legacy as { activeTool?: unknown }).activeTool;
    delete (legacy as { textMeasureRequest?: unknown }).textMeasureRequest;

    expect(parseEngineUpdate(JSON.stringify(legacy))).toEqual({
      ...legacy,
      activeTool: 'select',
      textMeasureRequest: null,
    });
  });

  it('does not synthesize required schema V4 scene or selection fields', () => {
    const missingProfile = updateFixture();
    delete (missingProfile.scene as { renderProfile?: unknown }).renderProfile;
    expect(() => parseEngineUpdate(JSON.stringify(missingProfile))).toThrow('protocol V1');

    const missingStyle = updateFixture();
    delete (missingStyle.selection as { style?: unknown }).style;
    expect(() => parseEngineUpdate(JSON.stringify(missingStyle))).toThrow('protocol V1');
  });

  it('strictly parses schema V4 document paint, profile, transform, and finite style values', () => {
    const document = styledDocumentFixture();
    expect(parseNodeInkDocument(JSON.stringify(document))).toEqual(document);

    expect(() =>
      parseNodeInkDocument(
        JSON.stringify({
          ...document,
          elements: {
            ...document.elements,
            'rect-1': {
              ...document.elements['rect-1'],
              fill: { kind: 'solid', color: '#D1FAE5' },
            },
          },
        }),
      ),
    ).toThrow('serialized Document');
    expect(() =>
      parseNodeInkDocument(
        JSON.stringify({
          ...document,
          renderProfile: {
            kind: 'sketch',
            version: 1,
            seed: 7,
            roughness: null,
            bowing: 0.8,
            fillStyle: 'hachure',
          },
        }),
      ),
    ).toThrow('serialized Document');
  });

  it('parses a nested group tree where every element has one parent', () => {
    const document = groupedDocumentFixture();

    expect(parseNodeInkDocument(JSON.stringify(document))).toEqual(document);
  });

  it('parses every current leaf element kind with identity transforms', () => {
    const rectangle = rectangleElementFixture('rect-1');
    const ellipse = closedShapeElementFixture('ellipse', 'ellipse-1');
    const diamond = closedShapeElementFixture('diamond', 'diamond-1');
    const line = lineShapeElementFixture('line', 'line-1');
    const polyline = lineShapeElementFixture('polyline', 'polyline-1', [
      { x: 0, y: 20 },
      { x: 10, y: 0 },
      { x: 20, y: 20 },
    ]);
    const arrow = lineShapeElementFixture('arrow', 'arrow-1');
    const stroke = lineShapeElementFixture('stroke', 'stroke-1');
    const text = textElementFixture();
    const document = {
      schemaVersion: 6 as const,
      documentId: 'all-leaves',
      revision: 0,
      renderProfile: { kind: 'clean' as const, version: 1 as const },
      rootOrder: [
        rectangle.id,
        ellipse.id,
        diamond.id,
        line.id,
        polyline.id,
        arrow.id,
        stroke.id,
        text.id,
      ],
      elements: {
        [rectangle.id]: rectangle,
        [ellipse.id]: ellipse,
        [diamond.id]: diamond,
        [line.id]: line,
        [polyline.id]: polyline,
        [arrow.id]: arrow,
        [stroke.id]: stroke,
        [text.id]: text,
      },
    };

    expect(parseNodeInkDocument(JSON.stringify(document))).toEqual(document);
  });

  it('parses one quadratic curve on a two-point line or arrow', () => {
    for (const kind of ['line', 'arrow'] as const) {
      const element = {
        ...lineShapeElementFixture(kind, `${kind}-1`),
        curve: { kind: 'quadratic' as const, control: { x: 50, y: 80 } },
      };
      const document = {
        ...createBlankDocument(`curved-${kind}`),
        rootOrder: [element.id],
        elements: { [element.id]: element },
      };

      expect(parseNodeInkDocument(JSON.stringify(document))).toEqual(document);
    }
  });

  it.each([
    [
      'line with more than two points',
      lineShapeElementFixture('line', 'line-1', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ],
    ['polyline with fewer than three points', lineShapeElementFixture('polyline', 'polyline-1')],
    [
      'arrow with duplicate consecutive points',
      lineShapeElementFixture('arrow', 'arrow-1', [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
    ],
    [
      'multi-point arrow with a quadratic curve',
      {
        ...lineShapeElementFixture('arrow', 'arrow-1', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
        ]),
        curve: { kind: 'quadratic', control: { x: 10, y: 20 } },
      },
    ],
  ])('rejects a %s', (_label, element) => {
    const document = {
      ...createBlankDocument('invalid-shape'),
      rootOrder: [element.id],
      elements: { [element.id]: element },
    };

    expect(() => parseNodeInkDocument(JSON.stringify(document))).toThrow('serialized Document');
  });

  it.each([
    [
      'missing transform',
      (() => {
        const document = styledDocumentFixture();
        delete (document.elements['rect-1'] as { transform?: unknown }).transform;
        return document;
      })(),
    ],
    [
      'non-finite transform',
      (() => {
        const document = styledDocumentFixture();
        return {
          ...document,
          elements: {
            ...document.elements,
            'rect-1': { ...document.elements['rect-1'], transform: { ...identity(), e: null } },
          },
        };
      })(),
    ],
    [
      'dangling child',
      (() => {
        const document = groupedDocumentFixture();
        (document.elements['group-1'] as { childOrder: string[] }).childOrder.push('missing');
        return document;
      })(),
    ],
    [
      'duplicate parent',
      (() => {
        const document = groupedDocumentFixture();
        document.rootOrder.push('rect-1');
        return document;
      })(),
    ],
    [
      'cycle',
      (() => {
        const document = groupedDocumentFixture();
        (document.elements['group-1'] as { childOrder: string[] }).childOrder = ['group-1'];
        return document;
      })(),
    ],
    [
      'unreachable element',
      (() => {
        const document = groupedDocumentFixture();
        document.elements['rect-2'] = rectangleElementFixture('rect-2');
        return document;
      })(),
    ],
  ])('rejects a schema V4 document with %s', (_label, document) => {
    expect(() => parseNodeInkDocument(JSON.stringify(document))).toThrow('serialized Document');
  });

  it.each([
    { type: 'create_rectangle', rectangle: rectangleElementFixture('rect-1') },
    {
      type: 'create_ellipse',
      ellipse: closedShapeElementFixture('ellipse', 'ellipse-1'),
    },
    {
      type: 'create_diamond',
      diamond: closedShapeElementFixture('diamond', 'diamond-1'),
    },
    {
      type: 'create_line',
      line: lineShapeElementFixture('line', 'line-1'),
    },
    {
      type: 'create_polyline',
      polyline: lineShapeElementFixture('polyline', 'polyline-1', [
        { x: 0, y: 20 },
        { x: 10, y: 0 },
        { x: 20, y: 20 },
      ]),
    },
    {
      type: 'create_arrow',
      arrow: lineShapeElementFixture('arrow', 'arrow-1'),
    },
    {
      type: 'create_stroke',
      stroke: {
        kind: 'stroke',
        id: 'stroke-1',
        transform: identity(),
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        size: 'm',
        stroke: '#0f172a',
      },
    },
    { type: 'create_text', text: textElementFixture() },
    { type: 'move_elements', elementIds: ['rect-1'], delta: { x: 10, y: -5 } },
    { type: 'update_text', elementId: 'text-1', patch: { text: 'updated' } },
    { type: 'update_rectangle', elementId: 'rect-1', patch: { width: 200 } },
    {
      type: 'update_element_style',
      elementId: 'rect-1',
      patch: { kind: 'rect', stroke: '#0f172a' },
    },
    {
      type: 'update_element_style',
      elementId: 'ellipse-1',
      patch: { kind: 'ellipse', fill: { kind: 'none' } },
    },
    {
      type: 'update_element_style',
      elementId: 'diamond-1',
      patch: { kind: 'diamond', size: 'm' },
    },
    {
      type: 'update_element_style',
      elementId: 'line-1',
      patch: { kind: 'line', stroke: '#2563eb' },
    },
    {
      type: 'update_element_style',
      elementId: 'polyline-1',
      patch: { kind: 'polyline', size: 'm' },
    },
    {
      type: 'update_element_style',
      elementId: 'arrow-1',
      patch: { kind: 'arrow', stroke: '#dc2626', size: 'm' },
    },
    { type: 'set_render_profile', renderProfile: { kind: 'clean', version: 1 } },
    { type: 'transform_elements', elementIds: ['rect-1'], transform: identity() },
    { type: 'group_elements', groupId: 'group-1', elementIds: ['rect-1', 'rect-2'] },
    { type: 'ungroup_elements', groupId: 'group-1' },
    { type: 'reorder_elements', elementIds: ['rect-1'], placement: 'front' },
    { type: 'reorder_elements', elementIds: ['rect-1'], placement: 'forward' },
    { type: 'reorder_elements', elementIds: ['rect-1'], placement: 'backward' },
    { type: 'reorder_elements', elementIds: ['rect-1'], placement: 'back' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'left' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'center' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'right' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'top' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'middle' },
    { type: 'align_elements', elementIds: ['rect-1', 'rect-2'], alignment: 'bottom' },
    {
      type: 'paste_clipboard',
      payload: '{"version":1}',
      idPrefix: 'paste-1',
      offset: { x: 24, y: 24 },
    },
    {
      type: 'update_path_points',
      elementId: 'polyline-1',
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 10 },
        { x: 40, y: 0 },
      ],
    },
    {
      type: 'update_path_curve',
      elementId: 'arrow-1',
      curve: { kind: 'quadratic', control: { x: 20, y: 40 } },
    },
    {
      type: 'update_path_curve',
      elementId: 'line-1',
      curve: null,
    },
    { type: 'delete_elements', elementIds: ['rect-1'] },
  ])('strictly parses the %s command', (command) => {
    const envelope = commandEnvelopeFixture(command);

    expect(parseCommandEnvelope(JSON.stringify(envelope))).toEqual(envelope);
  });

  it.each([
    commandEnvelopeFixture({
      type: 'transform_elements',
      elementIds: ['rect-1'],
      transform: { ...identity(), a: null },
    }),
    commandEnvelopeFixture({
      type: 'transform_elements',
      elementIds: ['rect-1'],
      transform: { ...identity(), d: 0 },
    }),
    commandEnvelopeFixture({
      type: 'transform_elements',
      elementIds: [],
      transform: identity(),
    }),
    commandEnvelopeFixture({
      type: 'transform_elements',
      elementIds: ['rect-1'],
      transform: identity(),
      extra: true,
    }),
    commandEnvelopeFixture({
      type: 'group_elements',
      groupId: 'group-1',
      elementIds: ['rect-1'],
    }),
    commandEnvelopeFixture({
      type: 'group_elements',
      groupId: 'rect-1',
      elementIds: ['rect-1', 'rect-2'],
    }),
    commandEnvelopeFixture({
      type: 'group_elements',
      groupId: '',
      elementIds: ['rect-1', 'rect-2'],
    }),
    commandEnvelopeFixture({
      type: 'group_elements',
      groupId: 'group-1',
      elementIds: ['rect-1', 'rect-2'],
      extra: true,
    }),
    commandEnvelopeFixture({ type: 'ungroup_elements', groupId: '' }),
    commandEnvelopeFixture({ type: 'ungroup_elements', groupId: 'group-1', extra: true }),
    commandEnvelopeFixture({
      type: 'reorder_elements',
      elementIds: ['rect-1', 'rect-1'],
      placement: 'front',
    }),
    commandEnvelopeFixture({
      type: 'reorder_elements',
      elementIds: ['rect-1'],
      placement: 'above',
    }),
    commandEnvelopeFixture({
      type: 'reorder_elements',
      elementIds: [],
      placement: 'front',
    }),
    commandEnvelopeFixture({
      type: 'reorder_elements',
      elementIds: ['rect-1'],
      placement: 'front',
      extra: true,
    }),
    commandEnvelopeFixture({
      type: 'align_elements',
      elementIds: ['rect-1'],
      alignment: 'left',
    }),
    commandEnvelopeFixture({
      type: 'align_elements',
      elementIds: ['rect-1', 'rect-2'],
      alignment: 'diagonal',
    }),
    commandEnvelopeFixture({
      type: 'align_elements',
      elementIds: ['rect-1', 'rect-2'],
      alignment: 'left',
      extra: true,
    }),
    commandEnvelopeFixture({
      type: 'paste_clipboard',
      payload: '',
      idPrefix: 'paste-1',
      offset: { x: 24, y: 24 },
    }),
    commandEnvelopeFixture({
      type: 'paste_clipboard',
      payload: '{"version":1}',
      idPrefix: '',
      offset: { x: 24, y: 24 },
    }),
    commandEnvelopeFixture({
      type: 'paste_clipboard',
      payload: '{"version":1}',
      idPrefix: 'paste-1',
      offset: { x: null, y: 24 },
    }),
    commandEnvelopeFixture({
      type: 'paste_clipboard',
      payload: '{"version":1}',
      idPrefix: 'paste-1',
      offset: { x: 24, y: 24 },
      extra: true,
    }),
    commandEnvelopeFixture({
      type: 'update_path_points',
      elementId: 'polyline-1',
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
    }),
    commandEnvelopeFixture({
      type: 'update_path_curve',
      elementId: 'line-1',
      curve: { kind: 'quadratic', control: { x: Number.NaN, y: 24 } },
    }),
    commandEnvelopeFixture({
      type: 'update_path_curve',
      elementId: 'line-1',
      curve: { kind: 'cubic', control: { x: 12, y: 24 } },
    }),
    { ...commandEnvelopeFixture({ type: 'ungroup_elements', groupId: 'group-1' }), extra: true },
  ])('rejects an invalid command envelope %#', (envelope) => {
    expect(() => parseCommandEnvelope(JSON.stringify(envelope))).toThrow('protocol V1');
  });

  it('strictly parses the NodeInk clipboard wrapper', () => {
    const payload = { mime: nodeInkClipboardMime, data: '{"version":1,"elements":[]}' };

    expect(parseClipboardPayload(JSON.stringify(payload))).toEqual(payload);
    expect(() => parseClipboardPayload(JSON.stringify({ ...payload, mime: 'text/plain' }))).toThrow(
      'protocol V1',
    );
    expect(() => parseClipboardPayload(JSON.stringify({ ...payload, extra: true }))).toThrow(
      'protocol V1',
    );
  });

  it('strictly parses pointer modifiers and screen scale', () => {
    const events = [
      {
        pointerId: 7,
        sequence: 1,
        phase: 'down',
        point: { x: 12, y: 24 },
        modifiers: { shift: true, alt: false, metaOrCtrl: true },
        screenScale: 2,
      },
    ];

    expect(parseNormalizedPointerEvents(JSON.stringify(events))).toEqual(events);
    expect(() =>
      parseNormalizedPointerEvents(JSON.stringify([{ ...events[0], screenScale: 0 }])),
    ).toThrow('protocol V1');
    expect(() =>
      parseNormalizedPointerEvents(
        JSON.stringify([{ ...events[0], modifiers: { shift: true, alt: false } }]),
      ),
    ).toThrow('protocol V1');
    expect(() =>
      parseNormalizedPointerEvents(JSON.stringify([{ ...events[0], extra: true }])),
    ).toThrow('protocol V1');
  });

  it.each([null, '', 'pen', {}, 1])('rejects an invalid active tool %o', (activeTool) => {
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), activeTool }))).toThrow(
      'protocol V1',
    );
  });

  it.each(['rectangle', 'ellipse', 'diamond', 'line', 'polyline', 'arrow'] as const)(
    'accepts the %s shape creation tool',
    (activeTool) => {
      expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), activeTool })).activeTool).toBe(
        activeTool,
      );
    },
  );

  it.each([
    {},
    {
      requestId: 1,
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: [],
    },
    { requestId: 'measure-1', fontFingerprint: 1, runs: [] },
    {
      requestId: 'measure-1',
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: {},
    },
    {
      requestId: 'measure-1',
      fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
      runs: [
        {
          key: 'text-1',
          text: 'hello',
          fontFamily: 'Noto Sans SC Variable',
          fontSize: 20,
          fontWeight: 700,
          maxWidth: null,
        },
      ],
    },
  ])('rejects an invalid text measurement request %o', (textMeasureRequest) => {
    expect(() =>
      parseEngineUpdate(JSON.stringify({ ...updateFixture(), textMeasureRequest })),
    ).toThrow('protocol V1');
  });

  it('parses a multi-line text Scene node with an explicit source element', () => {
    const textNode = sceneTextFixture();
    const scene = {
      ...updateFixture().scene,
      rootNodeIds: [textNode.id],
      nodes: { [textNode.id]: textNode },
    };

    expect(parseSceneSnapshot(JSON.stringify(scene))).toEqual(scene);
  });

  it('parses rectangle and path Scene nodes with resolved affine transforms', () => {
    const rectangle = {
      kind: 'rect' as const,
      id: 'rect-1:rect',
      sourceElementId: 'rect-1',
      transform: identity(),
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      fill: '#d1fae5',
      stroke: '#047857',
      strokeWidth: 2,
    };
    const path = {
      kind: 'path' as const,
      id: 'stroke-1:path',
      sourceElementId: 'stroke-1',
      transform: identity(),
      pathData: 'M 0 0 L 10 10',
      fill: 'none',
      stroke: '#0f172a',
      strokeWidth: 3,
    };
    const scene = {
      ...updateFixture().scene,
      rootNodeIds: [rectangle.id, path.id],
      nodes: { [rectangle.id]: rectangle, [path.id]: path },
    };

    expect(parseSceneSnapshot(JSON.stringify(scene))).toEqual(scene);
  });

  it('parses a committed operation summary in an engine update', () => {
    const operation = {
      commandId: 'command-1',
      previousRevision: 0,
      revision: 1,
      changedElementIds: ['rect-1'],
      sceneRevision: 1,
    };
    const update = { ...updateFixture(), operation };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it('parses a text edit target without deriving the semantic target from SVG', () => {
    const value = {
      element: textElementFixture(),
      update: {
        ...updateFixture(),
        activeTool: 'text',
        selection: {
          selectedElementIds: ['text-1'],
          primaryElementId: 'text-1',
          selectedElementId: 'text-1',
          visualBounds: { x: 40, y: 48, width: 240, height: 48 },
          orientedBounds: {
            center: { x: 160, y: 72 },
            width: 240,
            height: 48,
            rotation: 0,
          },
          handles: [],
          marquee: null,
          guides: [],
          style: {
            kind: 'text',
            color: '#0f172a',
            fontSize: 20,
            fontWeight: 400,
            textAlign: 'start',
          },
        },
      },
    };

    expect(parseTextEditTarget(JSON.stringify(value))).toEqual(value);
    expect(parseTextEditTarget(JSON.stringify({ element: null, update: updateFixture() }))).toEqual(
      { element: null, update: updateFixture() },
    );
  });

  it.each([
    null,
    {},
    { element: null, update: null },
    { element: { ...textElementFixture(), fontFamily: 'Arial' }, update: updateFixture() },
    { element: { ...textElementFixture(), fontFingerprint: '' }, update: updateFixture() },
    { element: { ...textElementFixture(), maxWidth: 0 }, update: updateFixture() },
    { element: textElementFixture(), update: {} },
  ])('rejects an invalid text edit target %o', (value) => {
    expect(() => parseTextEditTarget(JSON.stringify(value))).toThrow('text edit target');
  });

  it.each([
    { ...sceneTextFixture(), sourceElementId: null },
    { ...sceneTextFixture(), transform: null },
    { ...sceneTextFixture(), transform: { ...identity(), f: null } },
    { ...sceneTextFixture(), runs: {} },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], fontWeight: 700 }],
    },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], x: null }],
    },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], fill: '#1F2937' }],
    },
    {
      ...sceneTextFixture(),
      runs: [{ ...sceneTextFixture().runs[0], textAnchor: 'left' }],
    },
  ])('rejects an invalid text Scene node %o', (textNode) => {
    const scene = {
      ...updateFixture().scene,
      rootNodeIds: ['text-1:text'],
      nodes: { 'text-1:text': textNode },
    };

    expect(() => parseSceneSnapshot(JSON.stringify(scene))).toThrow('protocol V1');
  });

  it('parses a standalone scene snapshot', () => {
    const scene = updateFixture().scene;

    expect(parseSceneSnapshot(JSON.stringify(scene))).toEqual(scene);
  });

  it('parses a versioned incremental scene patch', () => {
    const patch = patchFixture();

    expect(parseScenePatch(JSON.stringify(patch))).toEqual(patch);
  });

  it('parses applied and planned diagram operation results with renderer-only patches', () => {
    const applied = diagramOperationResultFixture();
    const planned = diagramOperationResultFixture({ mode: 'dry_run', revision: null });
    planned.results[0]!.status = 'planned';

    expect(parseDiagramOperationBatchResult(JSON.stringify(applied))).toEqual(applied);
    expect(parseDiagramOperationBatchResult(JSON.stringify(planned))).toEqual(planned);
  });

  it.each([
    null,
    {},
    diagramOperationResultFixture({ batchId: 1 }),
    diagramOperationResultFixture({ mode: 'preview' }),
    diagramOperationResultFixture({ previousRevision: '0' }),
    diagramOperationResultFixture({ revision: '1' }),
    diagramOperationResultFixture({ results: {} }),
    diagramOperationResultFixture({ results: [null] }),
    diagramOperationResultFixture({ results: [{ opId: 1 }] }),
    diagramOperationResultFixture({ results: [{ opId: 'op-1', status: 'failed' }] }),
    diagramOperationResultFixture({
      results: [{ opId: 'op-1', status: 'applied', affectedElementIds: [1] }],
    }),
    diagramOperationResultFixture({ scenePatch: null }),
    diagramOperationResultFixture({ scenePatch: patchFixture({ protocolVersion: 2 }) }),
  ])('rejects invalid diagram operation result payloads', (value) => {
    expect(() => parseDiagramOperationBatchResult(JSON.stringify(value))).toThrow('protocol V1');
  });

  it.each([
    null,
    {},
    { protocolVersion: 2 },
    patchFixture({ documentRevision: '2' }),
    patchFixture({ baseSceneRevision: '1' }),
    patchFixture({ sceneRevision: '2' }),
    patchFixture({ addedNodes: [] }),
    patchFixture({ updatedNodes: [] }),
    patchFixture({ removedNodeIds: {} }),
    patchFixture({ rootNodeIds: {} }),
    patchFixture({ addedNodes: { 'text-1:text': { ...sceneTextFixture(), runs: {} } } }),
  ])('rejects invalid scene patch payloads', (value) => {
    expect(() => parseScenePatch(JSON.stringify(value))).toThrow('protocol V1');
  });

  it.each([
    null,
    {},
    { scene: null, history: {} },
    { scene: {}, history: null },
    { ...updateFixture(), selection: null },
  ])('rejects structurally invalid update payloads', (value) => {
    expect(() => parseEngineUpdate(JSON.stringify(value))).toThrow('invalid update payload');
  });

  it.each([
    {},
    {
      ...emptySelectionFixture(),
      selectedElementIds: ['rect-1', 'rect-1'],
      primaryElementId: 'rect-1',
      selectedElementId: 'rect-1',
    },
    {
      ...selectedRectangleFixture(),
      primaryElementId: 'rect-2',
      selectedElementId: 'rect-2',
    },
    { ...selectedRectangleFixture(), selectedElementId: 'rect-2' },
    { ...emptySelectionFixture(), visualBounds: { x: 0, y: 0, width: 10, height: 10 } },
    { ...emptySelectionFixture(), style: textSelectionStyle() },
    {
      ...selectedRectangleFixture(),
      orientedBounds: null,
    },
    {
      ...selectedRectangleFixture(),
      visualBounds: { x: 0, y: 0, width: -1, height: 10 },
    },
    {
      ...selectedRectangleFixture(),
      orientedBounds: {
        center: { x: 5, y: 5 },
        width: 10,
        height: 10,
        rotation: null,
      },
    },
    {
      ...selectedRectangleFixture(),
      handles: [{ id: 'rotate', kind: 'resize', position: { x: 5, y: -10 } }],
    },
    {
      ...selectedRectangleFixture(),
      marquee: { bounds: { x: 0, y: 0, width: 10, height: 10 }, mode: 'subtract' },
    },
    {
      ...selectedRectangleFixture(),
      guides: [{ axis: 'z', position: 5, start: 0, end: 10 }],
    },
    {
      ...selectedRectangleFixture(),
      selectedElementId: 'rect-1',
      style: { ...rectangleSelectionStyle(), size: 'xxl' },
    },
    {
      ...selectedRectangleFixture(),
      style: { ...textSelectionStyle(), color: '#0F172A' },
    },
  ])('rejects invalid selection state %o', (selection) => {
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    null,
    { id: 'north_west', kind: 'resize', position: { x: 0, y: 0 }, extra: true },
    { id: 'unknown', kind: 'resize', position: { x: 0, y: 0 } },
    { id: 'north', kind: 'move', position: { x: 0, y: 0 } },
    { id: 'east', kind: 'resize', position: { x: null, y: 0 } },
    { id: 'north', kind: 'rotate', position: { x: 0, y: 0 } },
    { id: 'rotate', kind: 'resize', position: { x: 0, y: 0 } },
    {
      id: 'vertex',
      kind: 'vertex',
      position: { x: 0, y: 0 },
      vertexIndex: -1,
      selected: true,
    },
    { id: 'vertex', kind: 'vertex', position: { x: 0, y: 0 }, vertexIndex: 0 },
    { id: 'vertex', kind: 'resize', position: { x: 0, y: 0 } },
    { id: 'curve', kind: 'curve', position: { x: 0, y: 0 }, extra: true },
    { id: 'curve', kind: 'resize', position: { x: 0, y: 0 } },
    { id: 'north', kind: 'curve', position: { x: 0, y: 0 } },
  ])('rejects each malformed selection handle boundary %o', (handle) => {
    const selection = { ...selectedRectangleFixture(), handles: [handle] };
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    { id: 'north', kind: 'resize', position: { x: 5, y: 0 } },
    { id: 'east', kind: 'resize', position: { x: 10, y: 5 } },
    { id: 'south', kind: 'resize', position: { x: 5, y: 10 } },
    { id: 'west', kind: 'resize', position: { x: 0, y: 5 } },
  ])('accepts the remaining resize handle id %s', (handle) => {
    const selection = { ...selectedRectangleFixture(), handles: [handle] };
    expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection })).selection).toEqual(
      selection,
    );
  });

  it('accepts multiple indexed vertex handles and their selected state', () => {
    const handles = [
      {
        id: 'vertex',
        kind: 'vertex',
        position: { x: 0, y: 0 },
        vertexIndex: 0,
        selected: false,
      },
      {
        id: 'vertex',
        kind: 'vertex',
        position: { x: 10, y: 10 },
        vertexIndex: 1,
        selected: true,
      },
    ];
    const selection = { ...selectedRectangleFixture(), handles };

    expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection })).selection).toEqual(
      selection,
    );
  });

  it('accepts one curve handle alongside path endpoint handles', () => {
    const handles = [
      {
        id: 'vertex',
        kind: 'vertex',
        position: { x: 0, y: 0 },
        vertexIndex: 0,
        selected: false,
      },
      {
        id: 'vertex',
        kind: 'vertex',
        position: { x: 100, y: 0 },
        vertexIndex: 1,
        selected: false,
      },
      { id: 'curve', kind: 'curve', position: { x: 50, y: 30 } },
    ];
    const selection = { ...selectedRectangleFixture(), handles };

    expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection })).selection).toEqual(
      selection,
    );
  });

  it.each([
    { center: null, width: 10, height: 10, rotation: 0 },
    { center: { x: 5, y: 5 }, width: -1, height: 10, rotation: 0 },
    { center: { x: 5, y: 5 }, width: 10, height: -1, rotation: 0 },
    { center: { x: 5, y: 5 }, width: 10, height: 10, rotation: 0, extra: true },
  ])('rejects each malformed oriented selection bound %o', (orientedBounds) => {
    const selection = { ...selectedRectangleFixture(), orientedBounds };
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    { bounds: null, mode: 'replace' },
    { bounds: { x: 0, y: 0, width: -1, height: 10 }, mode: 'replace' },
    { bounds: { x: 0, y: 0, width: 10, height: 10 }, mode: 'replace', extra: true },
  ])('rejects each malformed marquee boundary %o', (marquee) => {
    const selection = { ...selectedRectangleFixture(), marquee };
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it.each(['replace', 'toggle'] as const)('accepts marquee mode %s', (mode) => {
    const marquee = { bounds: { x: 0, y: 0, width: 10, height: 10 }, mode };
    const selection = { ...selectedRectangleFixture(), marquee };
    expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection })).selection).toEqual(
      selection,
    );
  });

  it.each([
    { axis: 'x', position: null, start: 0, end: 10 },
    { axis: 'x', position: 5, start: null, end: 10 },
    { axis: 'x', position: 5, start: 0, end: null },
    { axis: 'x', position: 5, start: 0, end: 10, extra: true },
  ])('rejects each malformed guide boundary %o', (guide) => {
    const selection = { ...selectedRectangleFixture(), guides: [guide] };
    expect(() => parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection }))).toThrow(
      'protocol V1',
    );
  });

  it('accepts a horizontal guide and the stroke selection style', () => {
    const selection = {
      ...selectedRectangleFixture(),
      guides: [{ axis: 'y' as const, position: 5, start: 0, end: 10 }],
      style: { kind: 'stroke' as const, stroke: '#0f172a', size: 's' as const },
    };
    expect(parseEngineUpdate(JSON.stringify({ ...updateFixture(), selection })).selection).toEqual(
      selection,
    );
  });

  it('parses multi-selection overlays with a primary element, marquee, and guides', () => {
    const selection = {
      ...selectedRectangleFixture(),
      selectedElementIds: ['rect-1', 'rect-2'],
      primaryElementId: 'rect-2',
      selectedElementId: 'rect-2',
      style: null,
      marquee: {
        bounds: { x: -10, y: -10, width: 160, height: 120 },
        mode: 'add' as const,
      },
      guides: [{ axis: 'x' as const, position: 64, start: 0, end: 120 }],
    };
    const update = { ...updateFixture(), selection };

    expect(parseEngineUpdate(JSON.stringify(update))).toEqual(update);
  });

  it.each([
    ['document revision', { documentRevision: '0' }],
    ['scene revision', { sceneRevision: '0' }],
    ['render profile', { renderProfile: { kind: 'sketch', version: 1, seed: -1 } }],
    ['root node ids', { rootNodeIds: {} }],
    ['scene nodes', { nodes: [] }],
  ])('rejects an invalid %s', (_label, sceneOverride) => {
    expect(() => parseEngineUpdate(JSON.stringify(updateFixture(sceneOverride)))).toThrow(
      'protocol V1',
    );
  });

  it.each([
    ['undo state', { canUndo: 'false' }],
    ['redo state', { canRedo: 'false' }],
  ])('rejects an invalid %s', (_label, historyOverride) => {
    expect(() =>
      parseEngineUpdate(
        JSON.stringify(updateFixture(undefined, historyOverride as Record<string, unknown>)),
      ),
    ).toThrow('protocol V1');
  });

  it('parses pointer processing metadata around a valid engine update', () => {
    const value = {
      update: updateFixture(),
      processedEventCount: 8,
      ignoredEventCount: 1,
      didCommit: false,
    };

    expect(parsePointerUpdate(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    null,
    {},
    { update: null, processedEventCount: 1, ignoredEventCount: 0, didCommit: false },
    { update: {}, processedEventCount: '1', ignoredEventCount: 0, didCommit: false },
    { update: {}, processedEventCount: 1, ignoredEventCount: '0', didCommit: false },
    { update: {}, processedEventCount: 1, ignoredEventCount: 0, didCommit: 'false' },
  ])('rejects invalid pointer update metadata', (value) => {
    expect(() => parsePointerUpdate(JSON.stringify(value))).toThrow('invalid pointer update');
  });

  it('parses vertex edit metadata around a valid engine update', () => {
    const value = {
      update: updateFixture(),
      didCommit: true,
    };

    expect(parseVertexEditUpdate(JSON.stringify(value))).toEqual(value);
    expect(() =>
      parseVertexEditUpdate(JSON.stringify({ update: updateFixture(), didCommit: 'true' })),
    ).toThrow('invalid vertex edit update');
  });

  it('parses stroke processing metadata around a valid engine update', () => {
    const value = {
      update: updateFixture(),
      processedPointCount: 32,
      ignoredPointCount: 2,
      didCommit: true,
    };

    expect(parseStrokeUpdate(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    null,
    {},
    { update: null, processedPointCount: 1, ignoredPointCount: 0, didCommit: false },
    { update: {}, processedPointCount: '1', ignoredPointCount: 0, didCommit: false },
    { update: {}, processedPointCount: 1, ignoredPointCount: '0', didCommit: false },
    { update: {}, processedPointCount: 1, ignoredPointCount: 0, didCommit: 'false' },
  ])('rejects invalid stroke update metadata', (value) => {
    expect(() => parseStrokeUpdate(JSON.stringify(value))).toThrow('invalid stroke update');
  });

  it('parses an explicit deterministic scene resolution', () => {
    const resolution = {
      engineAlgorithmVersion: 'nodeink-scene-v1',
      canonicalHash: 'fnv1a64:1234',
      renderProfile: { kind: 'clean', version: 1 },
      scene: updateFixture().scene,
    };

    expect(parseSceneResolution(JSON.stringify(resolution))).toEqual(resolution);
  });

  it.each([
    null,
    {},
    { engineAlgorithmVersion: 1, canonicalHash: 'hash', renderProfile: {}, scene: {} },
    { engineAlgorithmVersion: 'v1', canonicalHash: 1, renderProfile: {}, scene: {} },
    { engineAlgorithmVersion: 'v1', canonicalHash: 'hash', renderProfile: null, scene: {} },
    {
      engineAlgorithmVersion: 'v1',
      canonicalHash: 'hash',
      renderProfile: { kind: 'clean', version: 1 },
      scene: {
        ...updateFixture().scene,
        renderProfile: {
          kind: 'sketch',
          version: 1,
          seed: 1,
          roughness: 1,
          bowing: 1,
          fillStyle: 'solid',
        },
      },
    },
  ])('rejects invalid scene resolution metadata', (value) => {
    expect(() => parseSceneResolution(JSON.stringify(value))).toThrow('invalid scene resolution');
  });

  it('parses pending and resolved text fixtures', () => {
    const pending = {
      request: {
        requestId: 'measure-1',
        fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0',
        runs: [],
      },
      scene: null,
      canonicalHash: null,
    };
    const resolved = {
      request: null,
      scene: { fontFingerprint: 'noto-sans-sc-v40-fontsource-5.3.0', runs: [] },
      canonicalHash: 'fnv1a64:text',
    };

    expect(parseTextFixtureResolution(JSON.stringify(pending))).toEqual(pending);
    expect(parseTextFixtureResolution(JSON.stringify(resolved))).toEqual(resolved);
  });

  it('parses a resolved text fixture containing measured runs', () => {
    const run = {
      key: 'text-1:run-0',
      text: 'NodeInk',
      fontFamily: canvasFontFamily,
      fontSize: 24,
      fontWeight: 400 as const,
      maxWidth: null,
    };
    const metrics = {
      key: run.key,
      width: 96,
      height: 32,
      baseline: 24,
      lineBreaks: [],
    };
    const resolved = {
      request: null,
      scene: {
        fontFingerprint: fixtureFontFingerprint,
        runs: [{ run, metrics }],
      },
      canonicalHash: 'fnv1a64:text-runs',
    };

    expect(parseTextFixtureResolution(JSON.stringify(resolved))).toEqual(resolved);
  });

  it('parses successful and failed migration attempts', () => {
    const success = {
      result: {
        sourceSchemaVersion: 0,
        targetSchemaVersion: 6,
        migrated: true,
        document: createBlankDocument('doc-1'),
        canonicalPayload: '{}',
      },
      report: null,
    };
    const failure = {
      result: null,
      report: {
        stage: 'schema',
        code: 'unknown_schema',
        sourceSchemaVersion: 99,
        targetSchemaVersion: 6,
        message: 'unsupported',
        recovery: 'try_next_snapshot_then_readonly_diagnostic',
      },
    };

    expect(parseMigrationAttempt(JSON.stringify(success))).toEqual(success);
    expect(parseMigrationAttempt(JSON.stringify(failure))).toEqual(failure);
  });

  it.each([
    null,
    {},
    { result: {}, report: null },
    { result: null, report: {} },
    { result: null, report: { stage: 1 } },
  ])('rejects invalid migration attempts', (value) => {
    expect(() => parseMigrationAttempt(JSON.stringify(value))).toThrow('migration');
  });

  it.each([
    null,
    {},
    { request: [], scene: null, canonicalHash: null },
    { request: null, scene: [], canonicalHash: null },
    { request: null, scene: null, canonicalHash: 1 },
  ])('rejects invalid text fixture resolutions', (value) => {
    expect(() => parseTextFixtureResolution(JSON.stringify(value))).toThrow(
      'invalid text fixture resolution',
    );
  });
});

function identity() {
  return createIdentityAffine2D();
}

function emptySelectionFixture() {
  return {
    selectedElementIds: [] as string[],
    primaryElementId: null,
    selectedElementId: null,
    visualBounds: null,
    orientedBounds: null,
    handles: [],
    marquee: null,
    guides: [],
    style: null,
  };
}

function selectedRectangleFixture() {
  return {
    selectedElementIds: ['rect-1'],
    primaryElementId: 'rect-1',
    selectedElementId: 'rect-1',
    visualBounds: { x: 0, y: 0, width: 10, height: 10 },
    orientedBounds: {
      center: { x: 5, y: 5 },
      width: 10,
      height: 10,
      rotation: 0,
    },
    handles: selectionHandlesFixture(),
    marquee: null,
    guides: [],
    style: rectangleSelectionStyle(),
  };
}

function selectionHandlesFixture() {
  return [
    { id: 'north_west' as const, kind: 'resize' as const, position: { x: 0, y: 0 } },
    { id: 'north_east' as const, kind: 'resize' as const, position: { x: 10, y: 0 } },
    { id: 'south_east' as const, kind: 'resize' as const, position: { x: 10, y: 10 } },
    { id: 'south_west' as const, kind: 'resize' as const, position: { x: 0, y: 10 } },
    { id: 'rotate' as const, kind: 'rotate' as const, position: { x: 5, y: -12 } },
  ];
}

function updateFixture(
  sceneOverride: Record<string, unknown> = {},
  historyOverride: Record<string, unknown> = {},
) {
  return {
    activeTool: 'select',
    textMeasureRequest: null,
    operation: null,
    scene: {
      protocolVersion: 1,
      documentId: 'doc-1',
      documentRevision: 0,
      sceneRevision: 0,
      renderProfile: { kind: 'clean', version: 1 },
      rootNodeIds: [],
      nodes: {},
      ...sceneOverride,
    },
    history: { canUndo: false, canRedo: false, ...historyOverride },
    selection: emptySelectionFixture(),
  };
}

function sceneTextFixture() {
  return {
    kind: 'text' as const,
    id: 'text-1:text',
    sourceElementId: 'text-1',
    transform: identity(),
    runs: [
      {
        text: '第一行',
        x: 40,
        y: 64,
        fontFamily: canvasFontFamily,
        fontSize: 20,
        fontWeight: 400 as const,
        fill: '#1f2937',
        textAnchor: 'start' as const,
      },
      {
        text: 'Second line',
        x: 40,
        y: 88,
        fontFamily: canvasFontFamily,
        fontSize: 20,
        fontWeight: 400 as const,
        fill: '#1f2937',
        textAnchor: 'start' as const,
      },
    ],
  };
}

function textElementFixture() {
  return {
    kind: 'text' as const,
    id: 'text-1',
    transform: identity(),
    x: 40,
    y: 48,
    text: '第一行\nSecond line',
    fontFamily: canvasFontFamily,
    fontSize: 20,
    fontWeight: 400 as const,
    maxWidth: 240,
    fontFingerprint: fixtureFontFingerprint,
    color: '#0f172a',
    textAlign: 'start' as const,
  };
}

function rectangleSelectionStyle() {
  return {
    kind: 'rect' as const,
    fill: { kind: 'solid' as const, color: '#d1fae5' },
    stroke: '#047857',
    size: 'm' as const,
  };
}

function textSelectionStyle() {
  return {
    kind: 'text' as const,
    color: '#0f172a',
    fontSize: 20,
    fontWeight: 400 as const,
    textAlign: 'start' as const,
  };
}

function styledDocumentFixture() {
  return {
    schemaVersion: 6 as const,
    documentId: 'doc-1',
    revision: 3,
    renderProfile: {
      kind: 'sketch' as const,
      version: 1 as const,
      seed: 7,
      roughness: 1.2,
      bowing: 0.8,
      fillStyle: 'hachure' as const,
    },
    rootOrder: ['rect-1'],
    elements: {
      'rect-1': rectangleElementFixture('rect-1'),
    },
  };
}

function groupedDocumentFixture() {
  return {
    schemaVersion: 6 as const,
    documentId: 'doc-groups',
    revision: 1,
    renderProfile: { kind: 'clean' as const, version: 1 as const },
    rootOrder: ['group-1'],
    elements: {
      'group-1': {
        kind: 'group' as const,
        id: 'group-1',
        transform: identity(),
        childOrder: ['rect-1'],
      },
      'rect-1': rectangleElementFixture('rect-1'),
    } as Record<
      string,
      | ReturnType<typeof rectangleElementFixture>
      | {
          kind: 'group';
          id: string;
          transform: ReturnType<typeof identity>;
          childOrder: string[];
        }
    >,
  };
}

function rectangleElementFixture(id: string) {
  return {
    ...rectangleSelectionStyle(),
    id,
    transform: identity(),
    x: 12,
    y: 24,
    width: 160,
    height: 96,
  };
}

function closedShapeElementFixture(kind: 'ellipse' | 'diamond', id: string) {
  return {
    kind,
    id,
    transform: identity(),
    x: 12,
    y: 24,
    width: 160,
    height: 96,
    fill: { kind: 'solid' as const, color: '#d1fae5' },
    stroke: '#047857',
    size: 'm' as const,
  };
}

function lineShapeElementFixture(
  kind: 'line' | 'polyline' | 'arrow' | 'stroke',
  id: string,
  points = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
) {
  return {
    kind,
    id,
    transform: identity(),
    points,
    ...(kind === 'line' || kind === 'arrow' ? { curve: null } : {}),
    size: 'm' as const,
    stroke: '#0f172a',
  };
}

function commandEnvelopeFixture(command: Record<string, unknown>) {
  return {
    protocolVersion: 1,
    commandId: 'command-1',
    documentId: 'doc-1',
    expectedRevision: 0,
    command,
  };
}

function patchFixture(override: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    documentRevision: 2,
    baseSceneRevision: 1,
    sceneRevision: 2,
    addedNodes: {},
    updatedNodes: {},
    removedNodeIds: [],
    rootNodeIds: null,
    ...override,
  };
}

function diagramOperationResultFixture(override: Record<string, unknown> = {}) {
  return {
    batchId: 'batch-1',
    mode: 'apply' as const,
    previousRevision: 0,
    revision: 1 as number | null,
    results: [
      {
        opId: 'create-1',
        status: 'applied' as 'applied' | 'planned',
        affectedElementIds: ['rect-1'],
      },
    ],
    scenePatch: patchFixture(),
    ...override,
  };
}
