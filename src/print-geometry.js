'use strict';

const PRINT_LIMIT = 248;
const PRINT_DETAILS = ['massing', 'assembly', 'structure'];
const PRINT_SCALES = [100, 150, 200, 250, 300, 400, 500];
const printPolar = (radius, angle) => [radius * Math.cos(angle), -radius * Math.sin(angle)];
const printTransform = (triangles, transform) => triangles.map(face => face.map(transform));

const printExtrude = extrudePolygon;

function printBox(x0, y0, z0, x1, y1, z1) {
  return printExtrude([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);
}

function printBounds(faces, transform = point => point) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) for (const vertex of face) {
    const point = transform(vertex);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

function printMeshChecks(faces, id) {
  const vertex = point => point.map(value => Math.round(value * 10000)).join(',');
  const edges = new Map(), parents = faces.map((_, i) => i);
  const volumes = [];
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  let bedArea = 0, overhangFaces = 0;
  for (const [i, [a, b, c]] of faces.entries()) {
    const normal = cross(sub(b, a), sub(c, a)), area = Math.hypot(...normal);
    if (!(area > 1e-8)) throw Error(`${id} has a degenerate face.`);
    volumes[i] = dot(a, cross(b, c)) / 6;
    if ([a, b, c].every(p => p[2] < 0.0001) && normal[2] < 0) bedArea += area / 2;
    else if (normal[2] / area < -Math.SQRT1_2 - 1e-6) overhangFaces++;
    const vertices = [vertex(a), vertex(b), vertex(c)];
    if (new Set(vertices).size !== 3) throw Error(`${id} has vertices closer than the mesh tolerance.`);
    for (let j = 0; j < 3; j++) {
      const from = vertices[j], to = vertices[(j + 1) % 3], forward = from < to,
        key = forward ? `${from}/${to}` : `${to}/${from}`, edge = edges.get(key);
      if (edge) {
        if (edge.count > 1 || edge.forward === forward) throw Error(`${id} has an inconsistent shared edge.`);
        edge.count++;
        parents[root(i)] = root(edge.face);
      } else edges.set(key, { count: 1, forward, face: i });
    }
  }
  if ([...edges.values()].some(edge => edge.count !== 2)) throw Error(`${id} has an open edge.`);
  const shellVolumes = new Map();
  volumes.forEach((v, i) => {
    const shell = root(i);
    shellVolumes.set(shell, (shellVolumes.get(shell) ?? 0) + v);
  });
  if (!shellVolumes.size || [...shellVolumes.values()].some(v => v <= 1e-7))
    throw Error(`${id} has a shell with invalid winding or volume.`);
  if (!(bedArea > 0.01)) throw Error(`${id} has too little contact with the print bed.`);
  return { components: shellVolumes.size, overhangFaces };
}

function generatePrintKit(model, { denominator = 200, detail = 'massing' } = {}, assignments = {}) {
  if (!PRINT_SCALES.includes(denominator) || !PRINT_DETAILS.includes(detail)) throw Error('Choose a listed scale and detail level.');
  const limit = PRINT_LIMIT, minWall = 1.2, clearance = 0.35,
    parts = [], ids = new Set(), warnings = [], instructions = [], inserts = [], mm = metres => metres * 1000 / denominator;
  function add(id, group, label, triangles, { assembly = p => p, notes = [], guide = false, material } = {}) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) throw Error(`Duplicate or invalid print part ID ${id}.`);
    const { min, max } = printBounds(triangles), size = sub(max, min);
    if (size.some(axis => !Number.isFinite(axis) || axis <= 0)) throw Error(`${id} has invalid dimensions.`);
    if (size.some(axis => axis > limit + 1e-6)) throw Error(`${id} exceeds ${limit} mm at 1:${denominator}. Choose a smaller print scale.`);
    const oriented = printTransform(triangles, p => sub(p, min)), checks = printMeshChecks(oriented, id),
      origin = assembly(min),
      axes = min.map((_, i) => sub(assembly(min.map((value, j) => value + Number(i === j))), origin)),
      [x, y, z] = axes;
    if (![...origin, ...axes.flat()].every(Number.isFinite) || Math.abs(dot(x, cross(y, z)) - 1) > 1e-5 ||
        axes.some(axis => Math.abs(dot(axis, axis) - 1) > 1e-5)) throw Error(`${id} has invalid assembly axes.`);
    ids.add(id);
    const part = { id, group, label, triangles: oriented, size, notes, guide, material, placement: { origin, x, y, z },
      assemblyBounds: printBounds(triangles, assembly), ...checks };
    parts.push(part);
    return part;
  }
  const ctx = { model, denominator, detail, mm, limit, minWall, clearance, add, warnings, instructions, inserts, assignments };
  planPrintBuilding(ctx);
  planPrintAtrium(ctx);
  planPrintGantry(ctx);
  if (!parts.length) throw Error('The current design did not generate any parts.');
  const insertIds = new Set();
  for (const insert of inserts) {
    if (!ids.has(insert.partId)) throw Error(`Acrylic template ${insert.id} has no matching printed part.`);
    if (insertIds.has(insert.id) || insert.shape.length < 3 || !insert.shape.flat().every(Number.isFinite) ||
        !(insert.thickness > 0)) throw Error(`Acrylic template ${insert.id} has invalid cut geometry.`);
    insertIds.add(insert.id);
  }
  const placedBounds = parts.filter(part => !part.guide).map(part => [part.assemblyBounds.min, part.assemblyBounds.max]),
    overall = printBounds(placedBounds), dimensions = sub(overall.max, overall.min);
  return { parts, denominator, detail, limit, clearance, minWall, warnings, instructions, inserts, dimensions,
    seed: state.seed, runway: model.crane?.runway ?? null,
    siteLinked: Boolean(model.sitePlan), floors: model.layers.length, slotCount: model.slotN };
}
