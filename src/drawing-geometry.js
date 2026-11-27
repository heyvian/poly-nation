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
  if (/^Site_(Foundation|Transfer)/.test(layer)) return 'core';
  if (layer.startsWith('Site_Access_')) return 'circulation';
  if (/^(Swing_|Climbing_|Infinite_Rinse_(Water_Slide|Slide_))/.test(layer)) return 'rides';
  if (/^(Dock|Assembly_Dock|Crane_)/.test(layer)) return 'docks';
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
  if (/^Crane_(Traveling_Gantry|Hoist|Transfer_Carriage|Lifting_Jaws)/.test(layer)) return 'Traveling module gantry';
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
function drawingGeometry(mesh, model, { include = () => true, component = drawingComponent } = {}) {
  const groups = mesh.groups,
    first = groups.findIndex((group) => group.layer !== 'Reference'),
    parts = groups.map((group) => include(group) ? component(group.layer) : null),
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
      const group = groupAtOffset(i);
      if (!parts[group]) continue;
      const a = vertex(data, i),
        b = vertex(data, i + 10),
        c = vertex(data, i + 20);
      if (a === b || b === c || c === a) continue;
      const face = {
        vertices: [a, b, c],
        normal: data.slice(i + 3, i + 6),
        color: data.slice(i + 6, i + 9),
        component: parts[group],
        body: bodyIds[group],
        glazing: kind === 'glass',
        cutGroup: kind === 'solid' && !groups[group].layer.startsWith('Site ') ? group : null
      };
      faces.push(face);
      // DEM triangles occlude geometry and carry color. Their contours and shoreline
      // strokes are supplied by Site, so the triangulation never becomes drawing ink.
      if (groups[group].layer.startsWith('Site ')) continue;
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
    const component = parts[groupAtLine(i)];
    if (!component) continue;
    const a = vertex(mesh.lines, i),
      b = vertex(mesh.lines, i + 10);
    if (a !== b)
      lines.push({ a, b, component, texture: mesh.textureStrokes?.has(i) });
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
function rasterDrawingFace(depth, width, height, a, b, c, pixels, color, outline, body, gradient, alpha = 1) {
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
      if (alpha === 1) depth[i] = z;
      if (gradient) {
        gradient.x[i] = dzDx;
        gradient.y[i] = dzDy;
      }
      if (pixels) {
        const offset = i * 4;
        if (alpha === 1) {
          pixels[offset] = color[0];
          pixels[offset + 1] = color[1];
          pixels[offset + 2] = color[2];
        } else {
          const remaining = 1 - alpha;
          pixels[offset] = alpha * color[0] + remaining * pixels[offset];
          pixels[offset + 1] = alpha * color[1] + remaining * pixels[offset + 1];
          pixels[offset + 2] = alpha * color[2] + remaining * pixels[offset + 2];
        }
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

function drawingFaceColor(face, sun, washLightness) {
  const shade = 0.82 + 0.18 * Math.abs(dot(face.normal, sun));
  // Keep the wash light enough for the architectural strokes and section cuts to read over it.
  return face.color.map((channel) => (washLightness + (1 - washLightness) * channel * shade) * 255);
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
function drawingExportFills(
  geometry,
  projected,
  seeThrough,
  clips,
  width,
  height,
  sun,
  projectView,
  washLightness
) {
  const resolution = 2,
    columns = width * resolution,
    rows = height * resolution,
    pixels = new Uint8ClampedArray(columns * rows * 4),
    depth = new Float32Array(columns * rows).fill(-Infinity);
  for (const face of geometry.faces) {
    if (face.glazing && seeThrough) continue;
    const polygon = trimDrawingFace(
      face.vertices.map((index) => projected[index]),
      clips
    );
    if (polygon.length >= 3) {
      const atResolution = polygon
        .map(projectView)
        .map(([x, y, z]) => [x * resolution, y * resolution, z]);
      rasterDrawingPolygon(depth, columns, rows, atResolution, pixels, drawingFaceColor(face, sun, washLightness));
    }
  }
  return traceDrawingFills(pixels, columns, rows, resolution);
}

const DRAWING_SCALES = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
const DRAWING_PIXELS_PER_INCH = 88;
const SECTION_LENS_STOPS = [8, 14, 20, 24, 28, 35, 50, 85, 105, 135, 200];
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

// Put the picture plane at the cut. Its magnification is exactly 1, even as the
// full-frame-equivalent lens changes the rate at which farther geometry recedes.
function sectionLensProjection(cutDepth, focalDistance, centerX, centerY) {
  return {
    project([x, y, z]) {
      const behind = Math.max(0, cutDepth - z),
        factor = focalDistance / (focalDistance + behind);
      if (behind < 1e-9) return [x, y, 0];
      return [centerX + (x - centerX) * factor, centerY + (y - centerY) * factor, -behind * factor];
    },
    unproject([x, y, z]) {
      const factor = 1 + z / focalDistance;
      return [
        centerX + (x - centerX) / factor,
        centerY + (y - centerY) / factor,
        cutDepth + z / factor
      ];
    },
    planeDepth(plane) {
      // Intersect a projected viewing ray with a secondary cut plane in inverse-depth space.
      const origin = plane.x * centerX + plane.y * centerY + plane.z * cutDepth - plane.level,
        divisor = plane.z + origin / focalDistance;
      return Math.abs(divisor) > 1e-9
        ? (x, y) => (plane.level - plane.x * x - plane.y * y - plane.z * cutDepth) / divisor
        : null;
    }
  };
}

// Each solid contributes oriented edges to the cut. Trace only closed loops so loose surfaces
// remain linework. Opposite winding preserves holes within a solid's compound path.
function drawingCutContours(segments) {
  const outgoing = new Map();
  const key = (point) => point.map((value) => Math.round(value * 10000)).join(',');
  for (const [a, b] of segments) {
    const start = key(a),
      end = key(b);
    if (start === end) continue;
    const reverse = outgoing.get(end);
    if (reverse?.delete(start)) {
      if (!reverse.size) outgoing.delete(end);
      continue;
    }
    if (!outgoing.has(start)) outgoing.set(start, new Map());
    outgoing.get(start).set(end, a);
  }
  const contours = [];
  while (outgoing.size) {
    let vertex = outgoing.keys().next().value;
    const positions = [],
      visited = new Map();
    while (outgoing.has(vertex) && !visited.has(vertex)) {
      const edges = outgoing.get(vertex),
        [next, position] = edges.entries().next().value;
      visited.set(vertex, positions.length);
      positions.push(position);
      edges.delete(next);
      if (!edges.size) outgoing.delete(vertex);
      vertex = next;
    }
    const start = visited.get(vertex);
    if (start != null && positions.length - start >= 3) contours.push(positions.slice(start));
  }
  return contours;
}

function collectDrawingCut(triangle, plane, groups, group) {
  const distances = triangle.map((point) => drawingDistance(point, plane));
  let start, end;
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3,
      a = distances[i],
      b = distances[j];
    if (a > 1e-7 === b > 1e-7) continue;
    const point = drawingMix(triangle[i], triangle[j], clamp(a / (a - b), 0, 1));
    if (a > 1e-7) end = point;
    else start = point;
  }
  if (!start || !end) return;
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push([start, end]);
}

function drawingCutFills(cuts, clips, { optics, depth, width, height, frontDepth, sheetEdges }) {
  const fills = [];
  let mask, visible;
  for (const [index, groups] of cuts.entries()) {
    const plane = clips[index],
      remaining = clips.filter((_, i) => i !== index),
      isFront =
        Math.abs(plane.x) < 1e-9 &&
        Math.abs(plane.y) < 1e-9 &&
        plane.z > 0.999999 &&
        Math.abs(plane.level / plane.z - frontDepth) < 1e-7;
    const paths = [...groups.values()]
      .map((segments) =>
        drawingCutContours(segments)
          .map((loop) => trimDrawingFace(loop, remaining))
          .map((loop) => trimDrawingFace(optics ? loop.map(optics.project) : loop, sheetEdges))
          .filter((loop) => loop.length >= 3)
          .map(
            (loop) =>
              loop.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('') +
              'Z'
          )
          .join('')
      )
      .filter(Boolean);
    if (isFront) {
      // The aligned cut faces the reader. Preserve its true outlines as vectors.
      fills.push(...paths);
      continue;
    }
    const depthAt = optics
      ? optics.planeDepth(plane)
      : Math.abs(plane.z) > 1e-9
        ? (x, y) => (plane.level - plane.x * x - plane.y * y) / plane.z
        : null;
    if (!paths.length || !depthAt) continue;
    if (!mask) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      mask = canvas.getContext('2d', { willReadFrequently: true });
      visible = new Uint8ClampedArray(width * height * 4);
    }
    // An oblique or secondary cut can sit behind retained geometry. Use the existing depth
    // buffer to mask it, then trace the visible black area back to an editable SVG path.
    mask.clearRect(0, 0, width, height);
    for (const d of paths) mask.fill(new Path2D(d));
    const pixels = mask.getImageData(0, 0, width, height).data;
    for (let i = 0; i < depth.length; i++) {
      if (
        pixels[i * 4 + 3] >= 128 &&
        depthAt((i % width) + 0.5, Math.floor(i / width) + 0.5) + 0.008 >= depth[i]
      )
        visible[i * 4 + 3] = 255;
    }
  }
  if (visible) for (const { d } of traceDrawingFills(visible, width, height, 1)) fills.push(d);
  return fills;
}

// Fit the clipped drawing, including new corners where planes cross faces and loose edges.
function drawingFrameBounds(geometry, points, clips) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  function include([x, y]) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (clips.length) {
    const inside = points.map((point) =>
      clips.every((plane) => drawingDistance(point, plane) <= 1e-7)
    );
    points.forEach((point, i) => {
      if (inside[i]) include(point);
    });
    for (const { vertices } of geometry.faces) {
      if (vertices.every((i) => inside[i])) continue;
      const polygon = trimDrawingFace(
        vertices.map((i) => points[i]),
        clips
      );
      if (polygon.length >= 3) polygon.forEach(include);
    }
    for (const { a, b } of geometry.lines) {
      if (inside[a] && inside[b]) continue;
      clipDrawingLine(points[a], points[b], clips)?.forEach(include);
    }
  } else points.forEach(include);
  return Number.isFinite(left)
    ? { left, top, right, bottom }
    : { left: 0, top: 0, right: 0, bottom: 0 };
}

// Project the drawing in model units, then place it at a physical sheet scale.
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
  { region, sectionLens, floorSet, focus, cutFill, washLightness = 0.49, scales = DRAWING_SCALES } = {}
) {
  const width = region?.width ?? paper.width * DRAWING_PIXELS_PER_INCH,
    height = region?.height ?? paper.height * DRAWING_PIXELS_PER_INCH,
    pixelsPerMillimetre = DRAWING_PIXELS_PER_INCH / 25.4,
    margin = region ? DRAWING_TILE_MARGIN : 10 * pixelsPerMillimetre,
    drawingHeight = height - (region ? DRAWING_TILE_RESERVED_HEIGHT : margin * 3.2);
  const basis = orbitBasis(camera),
    { right, up, back } = basis,
    projectToView = (point) => [dot(point, right), -dot(point, up), dot(point, back)],
    raw = geometry.points.map(projectToView),
    modelClips = planes.map(({ normal, offset, flip }) => {
      const sign = flip ? -1 : 1;
      return {
        x: sign * dot(normal, right),
        y: -sign * dot(normal, up),
        z: sign * dot(normal, back),
        level: sign * offset
      };
    }),
    bounds = drawingFrameBounds(geometry, raw, modelClips),
    frame = focus ? drawingFrameBounds(geometry, focus.map(projectToView), []) : bounds,
    midX = (frame.left + frame.right) / 2,
    midY = (frame.top + frame.bottom) / 2;
  // Ground stays tied to the original grade datum, even when a cut removes it from view.
  let ground = 0;
  if (Math.abs(camera.el) > 0.01) {
    for (const [i, [, y]] of raw.entries())
      if (Math.abs(geometry.points[i][1]) <= 0.25) ground = Math.max(ground, y);
  }
  // Every floor in a printed or tiled set shares the model's full fit scale.
  const fitBounds = floorSet ? drawingFrameBounds(geometry, raw, []) : frame,
    required =
      1000 *
      pixelsPerMillimetre *
      Math.max(
        (fitBounds.right - fitBounds.left) / (width - margin * 2),
        (fitBounds.bottom - fitBounds.top) / drawingHeight
      ),
    fittedDenominator = scales.find((value) => value >= required) ?? Math.ceil(required),
    denominator = scaleChoice === 'auto' ? fittedDenominator : Number(scaleChoice),
    scale = (1000 * pixelsPerMillimetre) / denominator,
    offsetScale = placement.modelUnits ? scale : pixelsPerMillimetre,
    originX = width / 2 - midX * scale + placement.x * offsetScale,
    centeredY = margin + drawingHeight / 2 - midY * scale,
    groundY = margin + drawingHeight - 5 * pixelsPerMillimetre,
    grounded = placement.ground && Math.abs(Math.cos(camera.el)) > 0.01,
    originY = (grounded ? groundY - ground * scale : centeredY) + placement.y * offsetScale,
    projected = raw.map(([x, y, z]) => [originX + x * scale, originY + y * scale, z]),
    depth = new Float32Array(width * height).fill(-Infinity),
    gradient = { x: new Float32Array(depth.length), y: new Float32Array(depth.length) },
    paint = hybrid ? new ImageData(width, height) : null,
    sun = unit([-0.4, 1, 0.65]),
    cutLines = [];
  // Calibrate the lens at fit scale. Changing the printed scale enlarges the same projected
  // drawing, so a detail beyond the cut can stay anchored just like a detail on the cut.
  const lensY =
      sectionLens?.eyeLevel == null
        ? midY
        : clamp(-sectionLens.eyeLevel, bounds.top, bounds.bottom),
    focalDistance =
      sectionLens &&
      (sectionLens.millimetres * (width - margin * 2) * fittedDenominator) /
        (36 * 1000 * pixelsPerMillimetre),
    optics =
      sectionLens &&
      sectionLensProjection(
        sectionLens.cutDepth,
        focalDistance,
        originX + midX * scale,
        originY + lensY * scale
      ),
    projectView = optics ? optics.project : (point) => point;
  const outline =
    pens.silhouette || pens.componentOutlines
      ? {
          depth: new Float32Array(width * height).fill(-Infinity),
          owner: new Uint16Array(width * height)
        }
      : null;
  // Transform model-space planes into the same pixel and depth coordinates as the mesh.
  const clips = modelClips.map(({ x, y, z, level }) => ({
    x: x / scale,
    y: y / scale,
    z,
    level: level + (x * originX + y * originY) / scale
  }));
  const capSegments = cutFill ? clips.map(() => new Map()) : [];
  for (const face of geometry.faces) {
    const triangle = face.vertices.map((index) => projected[index]);
    if (capSegments.length && face.cutGroup != null)
      for (const [i, groups] of capSegments.entries())
        collectDrawingCut(triangle, clips[i], groups, face.cutGroup);
    const polygon = trimDrawingFace(triangle, clips);
    if (polygon.length < 3) continue;
    if (!face.glazing || !seeThrough) {
      const color = paint && drawingFaceColor(face, sun, washLightness);
      rasterDrawingPolygon(
        depth,
        width,
        height,
        optics ? polygon.map(projectView) : polygon,
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
    recedingSection = [],
    seen = new Set(),
    tolerance = 0.008;
  const coordinate = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  const sheetEdges = [
    { x: -1, y: 0, z: 0, level: -margin },
    { x: 1, y: 0, z: 0, level: width - margin },
    { x: 0, y: -1, z: 0, level: -margin },
    { x: 0, y: 1, z: 0, level: margin + drawingHeight }
  ];
  function strokeVisible(startPoint, endPoint, collect, atFrontCut = false) {
    const paperLine = clipDrawingLine(projectView(startPoint), projectView(endPoint), sheetEdges);
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
      const visible =
        atFrontCut ||
        (column >= 0 &&
          column < width &&
          row >= 0 &&
          row < height &&
          z + tolerance >=
            depth[pixel] +
              (x - column - 0.5) * gradient.x[pixel] +
              (y - row - 0.5) * gradient.y[pixel]);
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
  // The camera-facing cut already clips everything in front of it. Avoid testing
  // its strokes against sampled background depths, which vary with the lens.
  const frontDepth = clips.reduce(
    (nearest, plane) =>
      Math.abs(plane.x) < 1e-9 && Math.abs(plane.y) < 1e-9 && plane.z > 0.999999
        ? Math.min(nearest, plane.level / plane.z)
        : nearest,
    Infinity
  );
  const cutFills = drawingCutFills(capSegments, clips, {
    optics,
    depth,
    width,
    height,
    frontDepth,
    sheetEdges
  });
  for (const [a, b] of cutLines) {
    const atFrontCut = Math.abs(a[2] - frontDepth) < 1e-7 && Math.abs(b[2] - frontDepth) < 1e-7;
    strokeVisible(
      a,
      b,
      (command, from, to) => {
        const lines = optics && (from[2] + to[2]) / 2 < -1e-7 ? recedingSection : section;
        lines.push(command);
      },
      atFrontCut
    );
  }
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
    const first = faces[0];
    // Silhouette edges face the lens itself in a section perspective.
    let towardLens = back;
    if (sectionLens) {
      const [x, y, z] = projected[start],
        across = midX - (x - originX) / scale,
        height = (y - originY) / scale - lensY,
        depth = sectionLens.cutDepth + focalDistance - z;
      towardLens = back.map((value, i) => value * depth + right[i] * across + up[i] * height);
    }
    const facing = dot(first.normal, towardLens);
    const silhouette =
      faces.length === 1 ||
      faces.slice(1).some((other) => {
        const similarity = Math.abs(dot(first.normal, other.normal)),
          otherFacing = dot(other.normal, towardLens);
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
    sketch = pens.style === 'sketch';
  const penPaths = (cuts) => ({
    ink: Array.from({ length: count }, () => [[], [], []]),
    texture: Array.from({ length: count }, () => []),
    pencil: [],
    pencilEcho: [],
    silhouetteInk: [],
    componentInk: [],
    section: cuts
  });
  const front = penPaths(section),
    behind = optics && penPaths(recedingSection);
  let far = Infinity,
    near = -Infinity;
  for (const mark of marks) {
    far = Math.min(far, mark.depth);
    near = Math.max(near, mark.depth);
  }
  // Base the intervals on visible strokes so a clip or a cropped sheet still uses the pen range.
  for (const mark of marks) {
    // Keep the same physical pens while giving the linework behind the cut its own opacity.
    const { ink, texture, pencil, pencilEcho, silhouetteInk, componentInk } =
      behind && mark.depth < -1e-7 ? behind : front;
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
        (point) =>
          projectView([
            originX + dot(point, right) * scale,
            originY - dot(point, up) * scale,
            dot(point, back)
          ]),
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
  function joinPaths({ ink, texture, ...lines }) {
    const paths = Object.fromEntries(
      Object.entries(lines).map(([name, commands]) => [name, commands.join('')])
    );
    return {
      ...paths,
      ink: ink.map((pen) => pen.map((commands) => commands.join(''))),
      texture: texture.map((commands) => commands.join(''))
    };
  }
  return {
    ...joinPaths(front),
    perspective: behind && joinPaths(behind),
    construction,
    cutFills,
    pens,
    heaviest: ranked[0].index,
    populated:
      marks.length > 0 || section.length > 0 || recedingSection.length > 0 || cutFills.length > 0,
    basis,
    scale,
    originX,
    originY,
    centeredY,
    grounded,
    depth,
    optics,
    wash,
    exportFills: hybrid
      ? () =>
          drawingExportFills(
            geometry,
            projected,
            seeThrough,
            clips,
            width,
            height,
            sun,
            projectView,
            washLightness
          )
      : null,
    width,
    height,
    denominator,
    margin,
    drawingHeight,
    cropped:
      originX + bounds.left * scale < margin - 0.1 ||
      originX + bounds.right * scale > width - margin + 0.1 ||
      originY + bounds.top * scale < margin - 0.1 ||
      originY + bounds.bottom * scale > margin + drawingHeight + 0.1
  };
}
