'use strict';

const DRAWING_COMPONENTS = {
  core: ['Core and enclosure', 0.15],
  modules: ['Modules', 0.4],
  docks: ['Dock structures', 0.65],
  circulation: ['Circulation and atrium', 0.5],
  rides: ['Rides and climbing', 0.35],
  site: ['Roof shops and landscape', 1]
};

// Model layer names cover both Massing and Build. Map them to the same drawing categories.
function drawingComponent(layer) {
  if (/^(Swing_|Climbing_|Infinite_Rinse_(Water_Slide|Slide_))/.test(layer)) return 'rides';
  if (/^(Dock|Assembly_Dock)/.test(layer)) return 'docks';
  if (/^(Modules_|Module_Balconies|Senior_Care_Laundry|Assembly_Module|Assembly_Open)/.test(layer))
    return 'modules';
  if (
    /^(Corridor|Circulation|Lobby|Atrium|Assembly_(Atrium|Greenhouse)|Roof_(Lift|Pedestrian)|Infinite_Rinse_)/.test(
      layer
    )
  )
    return 'circulation';
  if (/^(Core_|Facade_|Assembly_)/.test(layer)) return 'core';
  return 'site';
}

function drawingOutlineBody({ layer, name }) {
  // Separate pods by storey and dock. Keep a pod's balcony and skin in the same body.
  if (/^(Modules|Module_Balconies|Assembly_Open)_/.test(layer))
    return `Module ${layer.match(/_L(\d+)(?:_|$)/)[1]}/${name}`;
  if (/^Assembly_Module_(Skin|Chassis)$/.test(layer)) return `Module ${name}`;
  if (/^Infinite_Rinse_(Water_Slide|Slide_(Wall_Sleeve|Flang|Flashing|Bolt))/.test(layer))
    return 'Slide';
  if (/^Swing_(Tower|Crown|Boarding_Platform)/.test(layer)) return 'Swing tower';
  if (/^Climbing_L\d+_Wall$/.test(layer)) return 'Climbing wall';
  if (/^Roof_Commercial_Retail/.test(layer)) return name;
  if (/^(Atrium_(Glass|Roof_Ridge)|Assembly_Greenhouse)/.test(layer)) return 'Atrium roof';
  if (
    /^(Core_|Facade_|Roof_Public_Deck|Assembly_(Foundation|Floor_|Roof_Deck|Exterior_Walls|Room_Partitions|Ring_Beams|Columns|Roof_Framing))/.test(
      layer
    )
  )
    return 'Core';
  return '';
}

// Weld drawing vertices so silhouettes and creases can be found across adjacent faces.
function drawingGeometry(mesh, model) {
  const groups = mesh.groups,
    first = groups.findIndex((group) => group.layer !== 'Reference'),
    parts = groups.map((group) => drawingComponent(group.layer)),
    points = [],
    faces = [],
    edges = new Map(),
    lines = [],
    indices = new Map();
  const bodies = new Map();
  const bodyIds = groups.map((group) => {
    const body = drawingOutlineBody(group);
    if (!body) return 0;
    if (!bodies.has(body)) bodies.set(body, bodies.size + 1);
    return bodies.get(body);
  });
  function vertex(data, at) {
    const point = data.slice(at, at + 3);
    const key = point.map((x) => Math.round(x * 10000)).join(',');
    if (!indices.has(key)) {
      indices.set(key, points.length);
      points.push(point);
    }
    return indices.get(key);
  }
  if (first < 0) return { points, faces, edges: [], lines };
  function groupAt(kind) {
    // The mesh stores layer boundaries as offsets into vertex buffers, one range per kind.
    let index = first;
    return (offset) => {
      while (groups[index + 1]?.[kind] <= offset) index++;
      return index;
    };
  }
  for (const kind of ['solid', 'glass']) {
    const data = mesh[kind];
    const groupAtOffset = groupAt(kind);
    for (let i = groups[first][kind]; i < data.length; i += 30) {
      const a = vertex(data, i),
        b = vertex(data, i + 10),
        c = vertex(data, i + 20);
      if (a === b || b === c || c === a) continue;
      const group = groupAtOffset(i);
      const face = {
        vertices: [a, b, c],
        normal: data.slice(i + 3, i + 6),
        color: data.slice(i + 6, i + 9),
        component: parts[group],
        body: bodyIds[group],
        glazing: kind === 'glass'
      };
      faces.push(face);
      for (const [start, end] of [
        [a, b],
        [b, c],
        [c, a]
      ]) {
        const key = Math.min(start, end) + ':' + Math.max(start, end);
        if (!edges.has(key)) edges.set(key, { start, end, faces: [] });
        edges.get(key).faces.push(face);
      }
    }
  }
  const groupAtLine = groupAt('lines');
  for (let i = groups[first].lines; i < mesh.lines.length; i += 20) {
    const a = vertex(mesh.lines, i),
      b = vertex(mesh.lines, i + 10);
    if (a !== b)
      lines.push({ a, b, component: parts[groupAtLine(i)], texture: mesh.textureStrokes?.has(i) });
  }
  return { points, faces, edges: [...edges.values()], lines, model };
}

// A plane keeps coordinates with a signed distance of zero or less.
const drawingDistance = (p, plane) =>
  p[0] * plane.x + p[1] * plane.y + p[2] * plane.z - plane.level;
const drawingMix = (a, b, t) =>
  a.map((coordinate, axis) => coordinate + (b[axis] - coordinate) * t);

function clipDrawingPolygon(polygon, plane) {
  const clipped = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = drawingDistance(a, plane),
      db = drawingDistance(b, plane);
    if (da <= 1e-7) clipped.push(a);
    if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7))
      clipped.push(drawingMix(a, b, da / (da - db)));
  }
  return clipped;
}

function clipDrawingLine(start, end, planes) {
  let a = start,
    b = end;
  for (const plane of planes) {
    const da = drawingDistance(a, plane),
      db = drawingDistance(b, plane);
    if (da > 1e-7 && db > 1e-7) return null;
    if (da > 1e-7) a = drawingMix(a, b, da / (da - db));
    else if (db > 1e-7) b = drawingMix(a, b, da / (da - db));
  }
  return [a, b];
}

// The depth buffer hides linework behind the geometry while the strokes remain vector paths.
function rasterDrawingFace(depth, width, height, a, b, c, pixels, color, outline, body, gradient) {
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    cx = c[0] - a[0],
    cy = c[1] - a[1],
    denominator = bx * cy - by * cx;
  if (Math.abs(denominator) < 1e-7) return;
  const dzB = b[2] - a[2],
    dzC = c[2] - a[2],
    dzDx = (dzB * cy - by * dzC) / denominator,
    dzDy = (bx * dzC - dzB * cx) / denominator,
    left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
    right = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0]))),
    top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
    bottom = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - a[1];
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - a[0],
        u = (dx * cy - dy * cx) / denominator,
        v = (bx * dy - by * dx) / denominator;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = a[2] + u * dzB + v * dzC,
        i = y * width + x;
      // Keep the closest principal body independently. Site furniture and trim still occlude
      // lines in the main depth buffer but cannot punch little holes in the building silhouette.
      if (outline && z > outline.depth[i]) {
        outline.depth[i] = z;
        outline.owner[i] = body;
      }
      if (z <= depth[i]) continue;
      depth[i] = z;
      if (gradient) {
        gradient.x[i] = dzDx;
        gradient.y[i] = dzDy;
      }
      if (pixels) {
        const offset = i * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }
}

function trimDrawingFace(triangle, clips) {
  let polygon = triangle;
  for (const plane of clips) {
    polygon = clipDrawingPolygon(polygon, plane);
    if (polygon.length < 3) break;
  }
  return polygon;
}

function drawingFaceColor(face, sun) {
  const shade = 0.82 + 0.18 * Math.abs(dot(face.normal, sun));
  // Keep the wash light enough for the architectural strokes and section cuts to read over it.
  return face.color.map((channel) => (0.49 + 0.51 * channel * shade) * 255);
}

function rasterDrawingPolygon(depth, width, height, polygon, pixels, color, outline, body, gradient) {
  for (let i = 1; i + 1 < polygon.length; i++)
    rasterDrawingFace(
      depth,
      width,
      height,
      polygon[0],
      polygon[i],
      polygon[i + 1],
      pixels,
      color,
      outline,
      body,
      gradient
    );
}

function drawingBoundary(owner, width, height, from, to, bodies) {
  function bodyAt(x, y) {
    const column = Math.floor(x),
      row = Math.floor(y);
    return column >= 0 && column < width && row >= 0 && row < height
      ? owner[row * width + column]
      : 0;
  }
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    length = Math.hypot(dx, dy),
    xOffset = (-dy * 1.2) / length,
    yOffset = (dx * 1.2) / length;
  let silhouette = 0,
    component = 0;
  // Vote along the visible stroke to avoid promoting spurious one-pixel seams near corners.
  for (const fraction of [0.2, 0.5, 0.8]) {
    const x = from[0] + dx * fraction,
      y = from[1] + dy * fraction;
    const a = bodyAt(x + xOffset, y + yOffset),
      b = bodyAt(x - xOffset, y - yOffset);
    if (a === b || (!bodies.includes(a) && !bodies.includes(b))) continue;
    component++;
    if (!a || !b) silhouette++;
  }
  return silhouette >= 2 ? 'silhouette' : component >= 2 ? 'component' : '';
}

// Trace only boundaries between visible colours. Shared edges use the same grid, and tracing
// with the filled side on the right gives any holes the opposite winding from the outline.
function traceDrawingFills(pixels, width, height, resolution) {
  const stride = width + 1,
    steps = [1, stride, -1, -stride],
    colors = new Int32Array(width * height),
    boundaries = new Map();
  for (let i = 0; i < colors.length; i++) {
    const offset = i * 4;
    if (pixels[offset + 3])
      colors[i] = 1 + ((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
  }
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const color = colors[i];
      if (!color) continue;
      const top = y === 0 || colors[i - width] !== color,
        right = x + 1 === width || colors[i + 1] !== color,
        bottom = y + 1 === height || colors[i + width] !== color,
        left = x === 0 || colors[i - 1] !== color;
      if (!top && !right && !bottom && !left) continue;
      if (!boundaries.has(color)) boundaries.set(color, new Set());
      const edges = boundaries.get(color),
        corner = y * stride + x;
      if (top) edges.add(corner * 4);
      if (right) edges.add((corner + 1) * 4 + 1);
      if (bottom) edges.add((corner + stride + 1) * 4 + 2);
      if (left) edges.add((corner + stride) * 4 + 3);
    }
  }
  const position = (point) =>
    `${(point % stride) / resolution} ${Math.floor(point / stride) / resolution}`;
  return [...boundaries].map(([color, edges]) => {
    const paths = [];
    for (const start of edges) {
      const origin = Math.floor(start / 4);
      let point = origin,
        edge = start,
        previousDirection = -1;
      const corners = ['M' + position(origin)];
      do {
        edges.delete(edge);
        const direction = edge % 4;
        if (previousDirection >= 0 && direction !== previousDirection)
          corners.push('L' + position(point));
        point += steps[direction];
        previousDirection = direction;
        if (point === origin) break;
        // Prefer turning right at a diagonal touch so two touching regions get separate loops.
        const clockwise = point * 4 + ((direction + 1) % 4),
          straight = point * 4 + direction;
        edge = edges.has(clockwise)
          ? clockwise
          : edges.has(straight)
            ? straight
            : point * 4 + ((direction + 3) % 4);
      } while (edges.has(edge));
      paths.push(corners.join('') + 'Z');
    }
    return { fill: '#' + (color - 1).toString(16).padStart(6, '0'), d: paths.join('') };
  });
}

// Export uses a finer sampling grid than the interactive wash, with the same clipping and depth
// rules. Its result is a set of editable SVG fills, one compound path per visible colour.
function drawingExportFills(geometry, projected, seeThrough, clips, width, height, sun) {
  const resolution = 2,
    columns = width * resolution,
    rows = height * resolution,
    pixels = new Uint8ClampedArray(columns * rows * 4),
    depth = new Float32Array(columns * rows).fill(-Infinity),
    points = projected.map(([x, y, z]) => [x * resolution, y * resolution, z]),
    planes = clips.map(({ x, y, z, level }) => ({
      x: x / resolution,
      y: y / resolution,
      z,
      level
    }));
  for (const face of geometry.faces) {
    if (face.glazing && seeThrough) continue;
    const polygon = trimDrawingFace(
      face.vertices.map((index) => points[index]),
      planes
    );
    if (polygon.length >= 3)
      rasterDrawingPolygon(depth, columns, rows, polygon, pixels, drawingFaceColor(face, sun));
  }
  return traceDrawingFills(pixels, columns, rows, resolution);
}

const DRAWING_SCALES = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
const DRAWING_PIXELS_PER_INCH = 88;
const DRAWING_TILE_MARGIN = 8;
const DRAWING_TILE_RESERVED_HEIGHT = 35;
const DRAWING_PEN_PRESETS = [
  [],
  [0.35],
  [0.5, 0.22],
  [0.5, 0.3, 0.18],
  [0.6, 0.45, 0.3, 0.18],
  [0.7, 0.5, 0.35, 0.25, 0.18]
];
const DRAWING_PEN_LIMITS = { min: 0.05, max: 2, step: 0.01 };
const DRAWING_PEN_REFERENCE_SCALE = 250;

function drawingPenScale(pens, denominator) {
  // Preserve more of the stroke width than a direct geometric scale would. The bounds keep
  // overview ink legible and prevent large-scale crops from acquiring disproportionately heavy ink.
  return pens.adaptToScale
    ? clamp((DRAWING_PEN_REFERENCE_SCALE / denominator) ** 0.25, 0.45, 1.35)
    : 1;
}

function printedDrawingPenWidths(pens, denominator) {
  if (!pens.adaptToScale) return pens.widths;
  const factor = drawingPenScale(pens, denominator);
  return pens.widths.map((width) =>
    Number(clamp(width * factor, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max).toFixed(2))
  );
}

function drawingPens(saved = {}) {
  // Older sheet settings have no pen set. Validate each saved value independently.
  const count =
    Array.isArray(saved?.widths) && saved.widths.length >= 1 && saved.widths.length <= 5
      ? saved.widths.length
      : 3;
  return {
    mode: ['distance', 'component', 'profile'].includes(saved?.mode) ? saved.mode : 'distance',
    style: saved?.style === 'sketch' ? 'sketch' : 'standard',
    adaptToScale: saved?.adaptToScale === true,
    silhouette: saved?.silhouette === true,
    componentOutlines: saved?.componentOutlines === true,
    paper: paintHex(saved?.paper) || '#ffffff',
    colors: DRAWING_PEN_PRESETS[count].map((_, i) => paintHex(saved?.colors?.[i]) || '#43534c'),
    widths: DRAWING_PEN_PRESETS[count].map((width, i) =>
      Number.isFinite(saved?.widths?.[i])
        ? clamp(saved.widths[i], DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max)
        : width
    ),
    components: Object.fromEntries(
      Object.entries(DRAWING_COMPONENTS).map(([key, [, portion]]) => [
        key,
        Number.isInteger(saved?.components?.[key])
          ? clamp(saved.components[key], 0, count - 1)
          : Math.round((count - 1) * portion)
      ])
    )
  };
}

function constructionGuides(model, camera, project, coordinate) {
  if (!model) return '';
  const plan = Math.abs(Math.sin(camera.el)) > 0.99,
    radius = model.plaza.outer * 1.08,
    mastHeight = model.feature.ride.height;
  const axis = (angle) => {
    const x = radius * Math.cos(angle),
      z = radius * Math.sin(angle);
    return [
      [-x, 0, -z],
      [x, 0, z]
    ];
  };
  // In plan, the actual lobby and lift axes meet at the mast. In elevation, show the grade
  // datum facing the viewer. In axonometric, use the lobby alignment on the ground plane.
  const guides = plan
    ? [axis(model.lobby.angle), axis(model.circulation.axis)]
    : [
        axis(Math.abs(camera.el) < 0.01 ? camera.az + Math.PI / 2 : model.lobby.angle),
        [
          [0, -1, 0],
          [0, mastHeight + 4, 0]
        ]
      ];
  return guides
    .map(([a, b]) => 'M' + coordinate(project(a)) + 'L' + coordinate(project(b)))
    .join('');
}

// Project the complete model on a physical sheet. Clipping offsets keep a stable frame.
function renderDrawing(
  geometry,
  camera,
  planes,
  paper,
  scaleChoice,
  seeThrough,
  placement,
  hybrid,
  pens,
  region = null
) {
  const width = region?.width ?? paper.width * DRAWING_PIXELS_PER_INCH,
    height = region?.height ?? paper.height * DRAWING_PIXELS_PER_INCH,
    pixelsPerMillimetre = DRAWING_PIXELS_PER_INCH / 25.4,
    margin = region ? DRAWING_TILE_MARGIN : 10 * pixelsPerMillimetre,
    drawingHeight = height - (region ? DRAWING_TILE_RESERVED_HEIGHT : margin * 3.2);
  const basis = orbitBasis(camera),
    { right, up, back } = basis,
    raw = geometry.points.map((p) => [dot(p, right), -dot(p, up), dot(p, back)]);
  let left = Infinity,
    top = Infinity,
    rightEdge = -Infinity,
    bottom = -Infinity,
    ground = 0;
  for (const [i, [x, y]] of raw.entries()) {
    left = Math.min(left, x);
    rightEdge = Math.max(rightEdge, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    // In an axonometric, anchor the foremost ground edge. Elevations use the zero grade datum.
    if (Math.abs(camera.el) > 0.01 && Math.abs(geometry.points[i][1]) <= 0.25)
      ground = Math.max(ground, y);
  }
  if (!raw.length) {
    left = top = 0;
    rightEdge = bottom = 1;
  }
  const available = Math.min(
      (width - margin * 2) / (rightEdge - left),
      drawingHeight / (bottom - top)
    ),
    minimumDenominator = (1000 * pixelsPerMillimetre) / available,
    denominator =
      scaleChoice === 'auto'
        ? (DRAWING_SCALES.find((value) => value >= minimumDenominator) ?? DRAWING_SCALES.at(-1))
        : Number(scaleChoice),
    scale = (1000 * pixelsPerMillimetre) / denominator,
    originX = width / 2 - ((left + rightEdge) * scale) / 2 + placement.x * pixelsPerMillimetre,
    centeredY = margin + drawingHeight / 2 - ((top + bottom) * scale) / 2,
    groundY = margin + drawingHeight - 5 * pixelsPerMillimetre,
    originY =
      (placement.ground && Math.abs(Math.cos(camera.el)) > 0.01
        ? groundY - ground * scale
        : centeredY) +
      placement.y * pixelsPerMillimetre,
    projected = raw.map(([x, y, z]) => [originX + x * scale, originY + y * scale, z]),
    depth = new Float32Array(width * height).fill(-Infinity),
    gradient = { x: new Float32Array(depth.length), y: new Float32Array(depth.length) },
    paint = hybrid ? new ImageData(width, height) : null,
    sun = unit([-0.4, 1, 0.65]),
    cutLines = [];
  const outline =
    pens.silhouette || pens.componentOutlines
      ? {
          depth: new Float32Array(width * height).fill(-Infinity),
          owner: new Uint16Array(width * height)
        }
      : null;
  // Transform model-space planes into the same pixel and depth coordinates as the mesh.
  const clips = planes.map(({ normal, offset, flip }) => {
    const sign = flip ? -1 : 1,
      x = (sign * dot(normal, right)) / scale,
      y = (-sign * dot(normal, up)) / scale;
    return { x, y, z: sign * dot(normal, back), level: sign * offset + x * originX + y * originY };
  });
  for (const face of geometry.faces) {
    const triangle = face.vertices.map((index) => projected[index]);
    const polygon = trimDrawingFace(triangle, clips);
    if (polygon.length < 3) continue;
    if (!face.glazing || !seeThrough) {
      const color = paint && drawingFaceColor(face, sun);
      rasterDrawingPolygon(
        depth,
        width,
        height,
        polygon,
        paint?.data,
        color,
        face.body ? outline : null,
        face.body,
        gradient
      );
    }
    for (const plane of clips) {
      if (
        !triangle.some((p) => drawingDistance(p, plane) > 1e-7) ||
        !triangle.some((p) => drawingDistance(p, plane) < -1e-7)
      )
        continue;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        if (
          Math.abs(drawingDistance(a, plane)) < 1e-6 &&
          Math.abs(drawingDistance(b, plane)) < 1e-6
        )
          cutLines.push([a, b]);
      }
    }
  }
  const marks = [],
    section = [],
    seen = new Set(),
    tolerance = 0.008;
  const coordinate = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  const sheetEdges = [
    { x: -1, y: 0, z: 0, level: -margin },
    { x: 1, y: 0, z: 0, level: width - margin },
    { x: 0, y: -1, z: 0, level: -margin },
    { x: 0, y: 1, z: 0, level: margin + drawingHeight }
  ];
  function strokeVisible(startPoint, endPoint, collect) {
    const paperLine = clipDrawingLine(startPoint, endPoint, sheetEdges);
    if (!paperLine) return;
    const [a, b] = paperLine;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.35) return;
    const steps = Math.ceil(length);
    let start = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        x = a[0] + (b[0] - a[0]) * t,
        y = a[1] + (b[1] - a[1]) * t,
        z = a[2] + (b[2] - a[2]) * t,
        column = Math.floor(x),
        row = Math.floor(y),
        pixel = row * width + column;
      // Match the face depth to the exact stroke position. A pixel-sized allowance in
      // model units can otherwise show geometry through thin opaque surfaces at small scales.
      const visible = column >= 0 && column < width && row >= 0 && row < height &&
        z + tolerance >= depth[pixel] +
          (x - column - 0.5) * gradient.x[pixel] + (y - row - 0.5) * gradient.y[pixel];
      if (visible && start == null) start = i;
      if ((!visible || i === steps) && start != null) {
        const end = visible ? i : i - 0.5;
        if (end - start > 0.2) {
          const first = drawingMix(a, b, start / steps),
            last = drawingMix(a, b, end / steps),
            from = coordinate(first),
            to = coordinate(last),
            key = from < to ? from + '/' + to : to + '/' + from;
          if (!seen.has(key)) {
            collect('M' + from + 'L' + to, first, last);
            seen.add(key);
          }
        }
        start = null;
      }
    }
  }
  // Draw section cuts first in the deduplication set so their heavier weight wins.
  for (const [a, b] of cutLines) strokeVisible(a, b, (command) => section.push(command));
  function strokeModelEdge(a, b, component, detail, texture = false, bodies = null) {
    const clipped = clipDrawingLine(projected[a], projected[b], clips);
    if (clipped)
      strokeVisible(clipped[0], clipped[1], (command, from, to) => {
        const boundary = bodies?.length
          ? drawingBoundary(outline.owner, width, height, from, to, bodies)
          : '';
        marks.push({
          command,
          depth: (from[2] + to[2]) / 2,
          component,
          detail,
          texture,
          from,
          to,
          boundary
        });
      });
  }
  for (const { start, end, faces } of geometry.edges) {
    const first = faces[0],
      facing = dot(first.normal, back);
    const silhouette =
      faces.length === 1 ||
      faces.slice(1).some((other) => {
        const similarity = Math.abs(dot(first.normal, other.normal)),
          otherFacing = dot(other.normal, back);
        // Coplanar triangles disappear. Smooth fans show a stroke only at a silhouette.
        return similarity < 0.9999 && facing * otherFacing <= 0;
      });
    const crease = faces
      .slice(1)
      .some((other) => Math.abs(dot(first.normal, other.normal)) < 0.985);
    const bodies = outline && faces.map((face) => face.body).filter(Boolean);
    const joint = pens.componentOutlines && bodies.some((body) => body !== bodies[0]);
    if (silhouette || crease || joint)
      strokeModelEdge(start, end, first.component, silhouette ? 0 : 0.52, false, bodies);
  }
  for (const { a, b, component, texture } of geometry.lines)
    strokeModelEdge(a, b, component, 1, texture);
  const ranked = pens.widths
      .map((width, index) => ({ width, index }))
      .sort((a, b) => b.width - a.width),
    count = ranked.length,
    ink = Array.from({ length: count }, () => [[], [], []]),
    texture = Array.from({ length: count }, () => []),
    pencil = [],
    pencilEcho = [],
    silhouetteInk = [],
    componentInk = [],
    sketch = pens.style === 'sketch';
  let far = Infinity,
    near = -Infinity;
  for (const mark of marks) {
    far = Math.min(far, mark.depth);
    near = Math.max(near, mark.depth);
  }
  // Base the intervals on visible strokes so a clip or a cropped sheet still uses the pen range.
  for (const mark of marks) {
    const position = near > far ? (near - mark.depth) / (near - far) : 0;
    const index =
      pens.mode === 'component'
        ? pens.components[mark.component]
        : ranked[
            pens.mode === 'distance'
              ? Math.min(count - 1, Math.floor(position * count))
              : Math.round((count - 1) * mark.detail)
          ].index;
    if (mark.texture) {
      texture[index].push(mark.command);
      continue;
    }
    const { from, to } = mark,
      noise = sketch ? Math.sin(from[0] * 12.9898 + from[1] * 78.233) * 43758.5453 : 0,
      variation = noise - Math.floor(noise),
      pressure = sketch && mark.detail < 1 ? (variation < 0.22 ? 1 : variation > 0.78 ? 2 : 0) : 0;
    // Promote each stroke once. When both options apply, the overall silhouette owns the stroke.
    if (pens.silhouette && mark.boundary === 'silhouette') silhouetteInk.push(mark.command);
    else if (pens.componentOutlines && mark.boundary) componentInk.push(mark.command);
    else ink[index][pressure].push(mark.command);
    if (!sketch || mark.detail >= 1 || (mark.detail > 0 && variation > 0.38)) continue;

    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      length = Math.hypot(dx, dy);
    if (length < 5) continue;
    // Follow a visible edge with a bowed graphite stroke. An occasional shorter pass gives
    // longer edges the retraced look of a pencil layout. The offsets are stable on re-export.
    const tx = dx / length,
      ty = dy / length,
      bow = (variation < 0.5 ? -1 : 1) * (1.5 + variation * 2.1),
      lead = 1.5 + variation * 2.1,
      a = [from[0] - tx * lead - ty * bow * 0.4, from[1] - ty * lead + tx * bow * 0.4],
      b = [to[0] + tx * lead - ty * bow * 0.3, to[1] + ty * lead + tx * bow * 0.3],
      middle = [(from[0] + to[0]) / 2 - ty * bow, (from[1] + to[1]) / 2 + tx * bow];
    pencil.push('M' + coordinate(a) + 'Q' + coordinate(middle) + ' ' + coordinate(b));
    if (length > 13 && variation > 0.72) {
      const start = [from[0] - tx * 2 + ty * bow * 0.6, from[1] - ty * 2 - tx * bow * 0.6],
        end = [from[0] + dx * 0.68 + ty * bow * 0.7, from[1] + dy * 0.68 - tx * bow * 0.7];
      pencilEcho.push('M' + coordinate(start) + 'L' + coordinate(end));
    }
  }
  const construction = sketch
    ? constructionGuides(
        geometry.model,
        camera,
        (point) => [originX + dot(point, right) * scale, originY - dot(point, up) * scale],
        coordinate
      )
    : '';
  let wash = '';
  if (paint) {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const ctx = image.getContext('2d');
    ctx.putImageData(paint, 0, 0);
    wash = image.toDataURL('image/png');
  }
  return {
    ink: ink.map((pressure) => pressure.map((paths) => paths.join(''))),
    silhouetteInk: silhouetteInk.join(''),
    componentInk: componentInk.join(''),
    texture: texture.map((paths) => paths.join('')),
    pencil: pencil.join(''),
    pencilEcho: pencilEcho.join(''),
    construction,
    section: section.join(''),
    pens,
    heaviest: ranked[0].index,
    populated: marks.length > 0 || section.length > 0,
    basis,
    scale,
    originX,
    originY,
    depth,
    wash,
    exportFills: hybrid
      ? () => drawingExportFills(geometry, projected, seeThrough, clips, width, height, sun)
      : null,
    width,
    height,
    denominator,
    margin,
    drawingHeight,
    cropped:
      originX + left * scale < margin - 0.1 ||
      originX + rightEdge * scale > width - margin + 0.1 ||
      originY + top * scale < margin - 0.1 ||
      originY + bottom * scale > margin + drawingHeight + 0.1
  };
}
