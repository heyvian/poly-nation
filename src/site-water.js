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
  for (const source of ['existing', 'proposed', 'garage']) {
    const kind = source === 'garage' ? 'proposed' : source;
    for (const original of aligned[source] ?? []) {
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
          id = (source === 'garage' ? 'garage/' : '') + [key(p), key(q)].sort().join('|');
        if (outlines.has(id)) outlines.delete(id);
        else outlines.set(id, { p, q, kind, source });
      }
    }
  }
  const banks = [],
    garage = aligned.garage?.length ? siteFoundationWater({ garage: aligned.garage }, [0, 0], half * 2) : null,
    district = garage ? siteFoundationWater({ ...aligned, garage: [] }, [0, 0], half * 2) : null;
  for (const { p, q, kind, source } of outlines.values()) {
    const line = clipDrawingLine([p[0], level, p[1]], [q[0], level, q[1]], square);
    if (!line) continue;
    if (garage) banks.push(...siteDryBankParts({ line, kind }, source === 'garage' ? district : garage));
    else banks.push({ line, kind });
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

function addSiteWater(mesh, terrain, study, { showWater, canalDepth, waterColour, moat = false }) {
  if (!study?.faces.length) return;
  const proposedBed = ([x, level, z]) => [
      x,
      Math.min(level - canalDepth, siteTerrainHeight(terrain, x, z)),
      z
    ],
    atGround = ([x, , z]) => [x, siteTerrainHeight(terrain, x, z), z];
  function faces(kind, name, color, project) {
    const fill = rgb(color);
    mesh.mark(name);
    for (const { kind: faceKind, polygon } of study.faces) {
      if (faceKind !== kind) continue;
      const p = project ? polygon.map(project) : polygon;
      for (let i = 1; i + 1 < p.length; i++) mesh.tri(p[0], p[i], p[i + 1], fill);
    }
  }
  if (study.faces.some(({ kind }) => kind === 'proposed'))
    faces('proposed', moat ? 'Site moat bed' : 'Site canal bed', '#a59b7c', proposedBed);
  if (showWater) {
    if (!moat) faces('existing', 'Site Bow River water', waterColour ?? '#7cb2c4');
    if (study.faces.some(({ kind }) => kind === 'proposed'))
      faces('proposed', moat ? 'Site moat water' : 'Site canal water', waterColour ?? '#4a939e');
  }
  mesh.mark('Site water banks');
  const clay = rgb('#9d9d81'),
    edge = rgb('#60877d');
  for (const {
    line: [a, b],
    kind
  } of study.banks) {
    // The excavation follows the PDF edge. Short vertical faces join the unmodified
    // ground to the conceptual canal bed, independently of water visibility.
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 6));
    for (let i = 0; i < steps; i++) {
      const p = drawingMix(a, b, i / steps),
        q = drawingMix(a, b, (i + 1) / steps);
      const low = kind === 'proposed' ? proposedBed : (point) => point,
        up =
          kind === 'proposed'
            ? atGround
            : ([x, level, z]) => [x, Math.max(level, siteTerrainHeight(terrain, x, z)), z];
      const topP = up(p),
        topQ = up(q);
      mesh.quad(low(p), low(q), topQ, topP, clay);
      mesh.line([topP[0], topP[1] + 0.02, topP[2]], [topQ[0], topQ[1] + 0.02, topQ[2]], edge);
    }
  }
}

function siteDryBankParts({ line: [a, b], kind }, water) {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (length < 0.01) return [];
  const point = (station) => drawingMix(a, b, station / length),
    wet = water.spans((station) => { const [x, , z] = point(station); return [x, z]; }, 0, length),
    dry = [];
  let start = 0;
  for (const [from, to] of [...wet, [length, length]]) {
    if (from - start > 0.01) dry.push({ line: [point(start), point(from)], kind });
    start = to;
  }
  return dry;
}

function addSiteMoat(mesh, terrain, moat, annulus, district, water, { showWater, canalDepth, includeTerrain, color }) {
  const depth = moat.connected ? canalDepth : MOAT_BED_DEPTH,
    banks = moat.connected ? annulus.banks.flatMap((bank) => siteDryBankParts(bank, water)) : annulus.banks;
  let faces = annulus.faces;
  if (moat.connected && district && includeTerrain) {
    const cells = Math.sqrt(district.index.length),
      cell = (value) => clamp(Math.floor((0.5 - value / terrain.size) * cells), 0, cells - 1);
    faces = faces.flatMap(({ polygon, kind }) => {
      const xs = polygon.map(([x]) => x), zs = polygon.map(([, , z]) => z), candidates = new Set();
      for (let i = cell(Math.max(...zs)); i <= cell(Math.min(...zs)); i++)
        for (let j = cell(Math.max(...xs)); j <= cell(Math.min(...xs)); j++)
          for (const planes of district.index[i * cells + j]) candidates.add(planes);
      return terrainOutsideSiteWater(polygon, [...candidates]).map((piece) => ({ polygon: piece, kind }));
    });
  }
  if (includeTerrain && district) addSiteWater(mesh, terrain, {
    ...district, banks: moat.connected ? district.banks.flatMap((bank) => siteDryBankParts(bank, moat.footprint)) : district.banks
  }, { showWater, canalDepth, waterColour: moat.connected ? color : undefined });
  addSiteWater(mesh, terrain, { banks, faces }, { showWater, canalDepth: depth, waterColour: color, moat: true });
}
