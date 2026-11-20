'use strict';

// Register one horizontal water plane to the PDF footprint. An index limits terrain clipping
// to the water faces that overlap each DEM cell.
function siteWaterStudy(terrain, aligned, cells) {
  if (!aligned) return null;
  const half = terrain.size / 2,
    level = aligned.level - terrain.datum,
    square = [
      { x: 1, y: 0, z: 0, level: half },
      { x: -1, y: 0, z: 0, level: half },
      { x: 0, y: 0, z: 1, level: half },
      { x: 0, y: 0, z: -1, level: half }
    ],
    index = Array.from({ length: cells * cells }, () => []),
    faces = [],
    outlines = new Map();
  const cell = (coordinate) =>
    clamp(Math.floor((0.5 - coordinate / terrain.size) * cells), 0, cells - 1);
  const key = ([x, z]) => x.toFixed(3) + '/' + z.toFixed(3);
  for (const kind of ['existing', 'proposed']) {
    for (const original of aligned[kind]) {
      const points = original.map(([x, z]) => [x, level, z]);
      let polygon = points;
      for (const side of square) polygon = clipDrawingPolygon(polygon, side);
      if (polygon.length < 3) continue;
      const [a, b, c] = points;
      const cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      if (Math.abs(cross) < 1e-7) continue;
      const winding = Math.sign(cross);
      const planes = points.map((p, i) => {
        const q = points[(i + 1) % 3],
          x = (q[2] - p[2]) * winding,
          z = (p[0] - q[0]) * winding;
        return { x, y: 0, z, level: x * p[0] + z * p[2] };
      });
      if (winding > 0) polygon.reverse();
      faces.push({ kind, polygon });
      const xs = polygon.map((p) => p[0]),
        zs = polygon.map((p) => p[2]);
      for (let i = cell(Math.max(...zs)); i <= cell(Math.min(...zs)); i++)
        for (let j = cell(Math.max(...xs)); j <= cell(Math.min(...xs)); j++)
          index[i * cells + j].push(planes);
      for (let i = 0; i < 3; i++) {
        const p = original[i],
          q = original[(i + 1) % 3],
          id = [key(p), key(q)].sort().join('|');
        if (outlines.has(id)) outlines.delete(id);
        else outlines.set(id, [p, q]);
      }
    }
  }
  const banks = [];
  for (const [p, q] of outlines.values()) {
    const line = clipDrawingLine([p[0], level, p[1]], [q[0], level, q[1]], square);
    if (line) banks.push(line);
  }
  return { level, faces, banks, index };
}

function terrainOutsideSiteWater(triangle, waterPlanes) {
  let land = [triangle];
  for (const boundary of waterPlanes) {
    land = land.flatMap((polygon) => {
      let inside = polygon;
      const outside = [];
      // A convex triangle's outside is the union of its side half-planes. Retain each
      // non-overlapping outside piece while sending only the inside on to the next side.
      for (const plane of boundary) {
        const { x, y, z, level } = plane;
        const piece = clipDrawingPolygon(inside, { x: -x, y: -y, z: -z, level: -level });
        if (piece.length >= 3) outside.push(piece);
        inside = clipDrawingPolygon(inside, plane);
        if (inside.length < 3) break;
      }
      return outside;
    });
  }
  return land;
}

function addSiteWater(mesh, terrain, study) {
  if (!study?.faces.length) return;
  for (const [kind, name, color] of [
    ['existing', 'Bow River · shared study water plane', '#7cb2c4'],
    ['proposed', 'Proposed canals · shared study water plane', '#4a939e']
  ]) {
    mesh.mark(name);
    for (const face of study.faces) {
      if (face.kind !== kind) continue;
      const p = face.polygon;
      for (let i = 1; i + 1 < p.length; i++) mesh.tri(p[0], p[i], p[i + 1], rgb(color));
    }
  }
  mesh.mark('Study banks');
  const clay = rgb('#9d9d81');
  for (const [a, b] of study.banks) {
    // Short vertical facets close the gap between sampled terrain and the study plane.
    // The model leaves flood extent and bank slopes undefined.
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 6));
    for (let i = 0; i < steps; i++) {
      const p = drawingMix(a, b, i / steps),
        q = drawingMix(a, b, (i + 1) / steps);
      const up = ([x, y, z]) => [x, Math.max(y, siteTerrainHeight(terrain, x, z)), z];
      mesh.quad(p, q, up(q), up(p), clay);
    }
  }
}
