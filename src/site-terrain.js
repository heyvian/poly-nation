'use strict';

// Terrain Tiles is a public bare-earth DEM in Web Mercator. Its source resolution varies.
const SITE_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const SITE_TILE_SIZE = 256;
const SITE_EARTH_RADIUS = 6378137;

function siteElevationSampler(signal) {
  const zoom = 15,
    tilesPerSide = 2 ** zoom,
    worldPixels = tilesPerSide * SITE_TILE_SIZE,
    pixels = new Map();
  function tile(x, y) {
    const tileX = mod(Math.floor(x / SITE_TILE_SIZE), tilesPerSide),
      tileY = clamp(Math.floor(y / SITE_TILE_SIZE), 0, tilesPerSide - 1),
      path = `${zoom}/${tileX}/${tileY}.png`;
    if (!pixels.has(path))
      pixels.set(
        path,
        (async () => {
          const response = await fetch(`${SITE_TILE_URL}/${path}`, { signal });
          if (!response.ok) throw new Error('Elevation tile is unavailable');
          const image = await createImageBitmap(await response.blob(), {
            colorSpaceConversion: 'none'
          });
          try {
            if (image.width !== SITE_TILE_SIZE || image.height !== SITE_TILE_SIZE)
              throw new Error('Unexpected elevation tile dimensions');
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = SITE_TILE_SIZE;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, SITE_TILE_SIZE, SITE_TILE_SIZE).data;
          } finally {
            image.close();
          }
        })()
      );
    return pixels.get(path);
  }
  async function heightAt(x, y) {
    const data = await tile(x, y),
      address = (mod(y, SITE_TILE_SIZE) * SITE_TILE_SIZE + mod(x, SITE_TILE_SIZE)) * 4;
    // Terrarium encodes whole metres in the first two channels and fractions in blue.
    return data[address] * 256 + data[address + 1] + data[address + 2] / 256 - 32768;
  }
  return async ({ latitude, longitude }) => {
    const radians = (latitude * Math.PI) / 180,
      x = ((longitude + 180) / 360) * worldPixels - 0.5,
      y = ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * worldPixels - 0.5,
      left = Math.floor(x),
      top = Math.floor(y),
      u = x - left,
      v = y - top;
    const [a, b, c, d] = await Promise.all([
      heightAt(left, top),
      heightAt(left + 1, top),
      heightAt(left, top + 1),
      heightAt(left + 1, top + 1)
    ]);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

async function sampleSiteTerrain(location, size, elevationAt, count = 81) {
  const { geographic } = siteCoordinates(location);
  const elevations = await Promise.all(
    Array.from({ length: count ** 2 }, (_, i) =>
      elevationAt(
        geographic([
          (0.5 - (i % count) / (count - 1)) * size,
          (0.5 - Math.floor(i / count) / (count - 1)) * size
        ])
      )
    )
  );
  if (elevations.some((height) => !Number.isFinite(height) || height < -500 || height > 9000))
    throw new Error('No usable elevations');
  const datum = elevations[(elevations.length - 1) / 2];
  return { location, size, count, datum, elevations };
}

// A broad, lower-resolution DEM keeps the same geographic frame if the tile provider fails.
async function loadWestVillageTerrain(signal) {
  const { terrainCentre: location, terrainSize: size } = WEST_VILLAGE_PLAN;
  try {
    const request = AbortSignal.any([signal, AbortSignal.timeout(12500)]);
    const terrain = await sampleSiteTerrain(location, size, siteElevationSampler(request));
    return { ...terrain, provider: 'Mapzen Terrain Tiles' };
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const count = 17,
    { geographic } = siteCoordinates(location),
    elevations = [];
  const points = Array.from({ length: count ** 2 }, (_, index) =>
    geographic([
      (0.5 - (index % count) / (count - 1)) * size,
      (0.5 - Math.floor(index / count) / (count - 1)) * size
    ])
  );
  for (let start = 0; start < points.length; start += 100) {
    const batch = points.slice(start, start + 100);
    const coordinates = (field) => batch.map((point) => point[field].toFixed(6)).join(',');
    const url =
      'https://api.open-meteo.com/v1/elevation?latitude=' +
      coordinates('latitude') +
      '&longitude=' +
      coordinates('longitude');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Elevation fallback is unavailable');
    const { elevation } = await response.json();
    if (
      !Array.isArray(elevation) ||
      elevation.length !== batch.length ||
      elevation.some((height) => !Number.isFinite(height) || height < -500 || height > 9000)
    )
      throw new Error('Elevation fallback returned incomplete heights');
    elevations.push(...elevation);
  }
  return {
    location,
    size,
    count,
    elevations,
    datum: elevations[(elevations.length - 1) / 2],
    provider: 'Open-Meteo (coarser fallback)'
  };
}

// Interpolate within the original DEM. The denser overlay mesh improves map edges without
// suggesting that the elevation source has gained resolution.
function siteTerrainHeight(terrain, x, z) {
  const { count, size, datum, elevations } = terrain;
  const u = clamp((0.5 - x / size) * (count - 1), 0, count - 1),
    v = clamp((0.5 - z / size) * (count - 1), 0, count - 1);
  const col = Math.min(count - 2, Math.floor(u)),
    row = Math.min(count - 2, Math.floor(v)),
    i = row * count + col,
    fx = u - col,
    fz = v - row;
  // Match the cell diagonal used by the rendered terrain. The building datum and
  // canal walls then meet the actual land surface even where a DEM cell twists.
  const a = elevations[i],
    b = elevations[i + 1],
    c = elevations[i + count],
    d = elevations[i + count + 1];
  const ground =
    fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  const level = ground - datum;
  return terrain.groundProfile ? terrain.groundProfile(x, z, level) : level;
}

function siteMoatFootprint(moat, [x, z]) {
  const triangles = [], at = (radius, i) => {
    const angle = i * TAU / MOAT_SEGMENTS;
    return [x + radius * Math.cos(angle), z + radius * Math.sin(angle)];
  };
  for (let i = 0; i < MOAT_SEGMENTS; i++) {
    const [a, b, c, d] = [at(moat.inner, i), at(moat.outer, i), at(moat.outer, i + 1), at(moat.inner, i + 1)];
    triangles.push([a, b, c], [a, c, d]);
  }
  return triangles;
}

function siteCanalOpening(plan) {
  if (!plan?.anchor) return null;
  const { terrain, surface, crossingSoffit: soffit } = plan,
    cells = Math.max(terrain.count - 1, 32), study = siteWaterStudy(terrain, surface, cells),
    cell = (coordinate) => clamp(Math.floor((0.5 - coordinate / terrain.size) * cells), 0, cells - 1),
    roof = { x: 0, y: 1, z: 0, level: soffit };
  function dryParts(points, stripMast = false) {
    if (points.every((p) => p[1] >= soffit)) return [points];
    if (stripMast) {
      const above = { ...roof, y: -1, level: -soffit },
        part = points.length === 2 ? clipDrawingLine(...points, [above]) : clipDrawingPolygon(points, above);
      return part?.length >= points.length ? [part] : [];
    }
    const columns = points.map((p) => cell(p[0])), rows = points.map((p) => cell(p[2])), candidates = new Set();
    for (let i = Math.min(...rows); i <= Math.max(...rows); i++)
      for (let j = Math.min(...columns); j <= Math.max(...columns); j++)
        for (const planes of study.index[i * cells + j]) candidates.add(planes);
    if (!candidates.size) return [points];
    const volumes = [...candidates].map((planes) => [...planes, roof]);
    if (points.length === 3) return terrainOutsideSiteWater(points, volumes);
    let segments = [points];
    for (const volume of volumes) segments = segments.flatMap(([a, b]) => {
      const wet = clipDrawingLine(a, b, volume);
      if (!wet) return [[a, b]];
      const differs = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-6;
      return [[a, wet[0]], [wet[1], b]].filter(([start, end]) => differs(start, end));
    });
    return segments;
  }
  function append(target, points, stripMast = false, translate = null) {
    for (const polygon of dryParts(points, stripMast)) {
      const vertices = translate ? polygon.map(translate) : polygon;
      if (points.length === 2) target.push(...vertices[0], ...vertices[1]);
      else for (let j = 1; j + 1 < vertices.length; j++) target.push(...vertices[0], ...vertices[j], ...vertices[j + 1]);
    }
  }
  return { append, trimMesh(mesh, start) {
    const added = mesh.solid.splice(start);
    for (let i = 0; i < added.length; i += 30)
      append(mesh.solid, [added.slice(i, i + 10), added.slice(i + 10, i + 20), added.slice(i + 20, i + 30)]);
  } };
}

function drawSitePumphouse(mesh, terrain, registration, bounds) {
  const volume = westVillagePumphouseVolume(registration, terrain), roof = Math.max(...volume.flat().map(([, , y]) => y)),
    topColor = rgb('#b29d80'), wallColor = rgb('#a3886d');
  mesh.mark('Site_District_Pumphouse_Theatre', 'Existing Pumphouse Theatre · approximate 9 m massing');
  for (const face of volume) {
    const top = face.every(([, , y]) => y === roof),
      polygon = face.map(([x, z, y]) => [x, y, z]).reverse(),
      clipped = bounds ? trimDrawingFace(polygon, bounds) : polygon;
    for (let i = 1; i < clipped.length - 1; i++) mesh.tri(clipped[0], clipped[i], clipped[i + 1], top ? topColor : wallColor);
  }
}

function siteAssemblyMesh(
  assembly,
  terrain,
  {
    position = [0, 0],
    grade = 0,
    bearing = 0,
    natural = null,
    water = null,
    showContours = true,
    showWater = true,
    canalDepth = 2,
    relativeToBuilding = false,
    buildingCoordinates = false,
    contextRadius = null,
    supportPlan = null,
    model = null,
    includeTerrain = true,
    includeDistrictPaths = includeTerrain,
    includeContextBuildings = includeTerrain || includeDistrictPaths,
    registration = null,
    includeFoundations = true
  } = {}
) {
  const mesh = meshBuilder(), siteMoat = supportPlan?.moat, finishedTerrain = supportPlan?.terrain ?? terrain,
    bounds = contextRadius ? siteDiskPlanes(position, contextRadius) : null;
  let districtPaths = null;
  function clipWater(study) {
    if (!bounds || !study) return study;
    const faces = study.faces.map((face) => ({ ...face, polygon: trimDrawingFace(face.polygon, bounds) }))
      .filter(({ polygon }) => polygon.length >= 3),
      banks = study.banks.flatMap(({ line, kind }) => {
        const clipped = clipDrawingLine(...line, bounds);
        return clipped ? [{ line: clipped, kind }] : [];
      });
    return { ...study, faces, banks };
  }
  if (terrain && (includeTerrain || includeFoundations && siteMoat)) {
    const { size, elevations, datum } = terrain,
      count = natural?.raster ? Math.max(terrain.count, 81) : terrain.count,
      low = Math.min(...elevations),
      high = Math.max(...elevations),
      interval = high - low > 50 ? 5 : 2, step = size / (count - 1),
      contour = rgb('#879685'),
      surface = supportPlan?.surface ?? water,
      districtSurface = surface && (showWater || siteMoat || supportPlan?.boatBay ? surface : { ...surface, existing: [] }),
      study = includeTerrain || siteMoat?.connected ? siteWaterStudy(terrain, districtSurface, count - 1) : null,
      moatBounds = siteMoat ?? assembly.craneMoat,
      moat = moatBounds ? siteWaterStudy(terrain, {
        level: datum + (siteMoat?.level ?? 0), existing: [],
        proposed: siteMoat?.triangles ?? siteMoatFootprint(moatBounds, position)
      }, count - 1) : null;
    const waterPlanes = (i) => {
      const excavation = moat?.index[i], district = study?.index[i];
      return excavation?.length && district?.length ? [...excavation, ...district] : excavation?.length ? excavation : district;
    };
    const points = Array.from({ length: count ** 2 }, (_, i) => {
      const x = (0.5 - (i % count) / (count - 1)) * size,
        z = (0.5 - Math.floor(i / count) / (count - 1)) * size;
      return [x, siteTerrainHeight(finishedTerrain, x, z), z];
    });
    function tintNatural(color, x, z) {
      if (!natural?.raster) return color;
      const { raster, resolution } = natural;
      const col = clamp(Math.floor((0.5 - x / size) * resolution), 0, resolution - 1),
        row = clamp(Math.floor((0.5 - z / size) * resolution), 0, resolution - 1),
        at = (row * resolution + col) * 4,
        alpha = raster[at + 3] / 255;
      return color.map((channel, i) => (1 - alpha) * channel + (alpha * raster[at + i]) / 255);
    }
    if (includeTerrain) mesh.mark('Site terrain');
    function patch(a, b, c) {
      const mean = (a[1] + b[1] + c[1]) / 3 + datum,
        t = (mean - low) / Math.max(1, high - low);
      const color = [0.76 + t * 0.1, 0.81 + t * 0.07, 0.73 + t * 0.1];
      mesh.tri(a, b, c, tintNatural(color, (a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3));
      if (!showContours) return;
      const triangle = [a, b, c],
        min = Math.min(a[1], b[1], c[1]),
        max = Math.max(a[1], b[1], c[1]);
      for (
        let h = Math.ceil((min + datum) / interval) * interval - datum;
        h <= max;
        h += interval
      ) {
        const crossed = [];
        for (let j = 0; j < 3; j++) {
          const p = triangle[j],
            q = triangle[(j + 1) % 3];
          if (p[1] < h === q[1] < h) continue;
          const t = (h - p[1]) / (q[1] - p[1]);
          crossed.push([p[0] + (q[0] - p[0]) * t, h + 0.035, p[2] + (q[2] - p[2]) * t]);
        }
        if (crossed.length === 2) mesh.line(crossed[0], crossed[1], contour);
      }
    }
    for (let row = 0; includeTerrain && row < count - 1; row++) {
      for (let col = 0; col < count - 1; col++) {
        const i = row * count + col;
        const [x, , z] = points[i];
        if (bounds && Math.hypot(x - step / 2 - position[0], z - step / 2 - position[1]) >
          contextRadius * 1.01 + step * Math.SQRT1_2) continue;
        const candidates = waterPlanes(row * (count - 1) + col);
        const emit = (triangle) => {
          const local = bounds && triangle.some(([x, , z]) => Math.hypot(x - position[0], z - position[1]) > contextRadius)
            ? trimDrawingFace(triangle, bounds) : triangle;
          if (local.length < 3) return;
          const pieces = candidates?.length ? terrainOutsideSiteWater(local, candidates) : [local];
          for (const land of pieces)
            for (let j = 1; j + 1 < land.length; j++) patch(land[0], land[j], land[j + 1]);
        };
        if (supportPlan?.gradeReach && Math.hypot(x - step / 2 - position[0], z - step / 2 - position[1]) <
            supportPlan.gradeReach + step * Math.SQRT1_2) {
          // Locally subdivide the DEM so that small berms and dock pads can actually follow the adjusted grades.
          const divisions = Math.min(50, Math.ceil(step / 1.8)), delta = step / divisions,
            grid = Array.from({ length: (divisions + 1) ** 2 }, (_, j) => {
              const px = x - j % (divisions + 1) * delta, pz = z - Math.floor(j / (divisions + 1)) * delta;
              return [px, siteTerrainHeight(finishedTerrain, px, pz), pz];
            });
          for (let a = 0; a < divisions; a++) for (let b = 0; b < divisions; b++) {
            const j = a * (divisions + 1) + b, below = j + divisions + 1;
            emit([grid[j], grid[below], grid[j + 1]]);
            emit([grid[j + 1], grid[below], grid[below + 1]]);
          }
        } else {
          emit([points[i], points[i + count], points[i + 1]]);
          emit([points[i + 1], points[i + count], points[i + count + 1]]);
        }
      }
    }
    if (siteMoat && moat) {
      addSiteMoat(mesh, finishedTerrain, siteMoat, moat, clipWater(study), supportPlan.water, {
        showWater, canalDepth, includeTerrain, color: siteMoat.connected ? '#4a939e' : '#79a8b0'
      });
    } else if (includeTerrain) addSiteWater(mesh, finishedTerrain, clipWater(study), { showWater, canalDepth });
    if (includeDistrictPaths)
      districtPaths = drawSiteDistrictPaths(mesh, finishedTerrain, registration, surface, { model, supportPlan, bounds, bridgeTerrain: terrain });
    if (includeTerrain && natural?.trees.length) {
      mesh.mark('OpenStreetMap mapped trees');
      const bark = rgb('#7e7057'),
        canopy = rgb(SITE_MAP_COLOURS.tree),
        cells = count - 1,
        cell = (value) => clamp(Math.floor((0.5 - value / size) * cells), 0, cells - 1);
      for (const { x, z, height } of natural.trees) {
        if (bounds && Math.hypot(x - position[0], z - position[1]) > contextRadius) continue;
        if (districtPaths?.coversGround?.(x, z)) continue;
        if (
          waterPlanes(cell(z) * cells + cell(x))?.some((planes) =>
            planes.every((plane) => plane.x * x + plane.z * z <= plane.level)
          )
        )
          continue;
        const y = siteTerrainHeight(finishedTerrain, x, z),
          radius = height * 0.28;
        mesh.box(x, y, z, 0.28, height * 0.64, 0.28, 0, bark);
        const ring = (angle) => [
          x + radius * Math.cos(angle),
          y + height * 0.65,
          z + radius * Math.sin(angle)
        ];
        for (let i = 0; i < 7; i++) {
          const a = ring((i * TAU) / 7),
            b = ring(((i + 1) * TAU) / 7);
          mesh.tri(a, b, [x, y + height, z], canopy);
          mesh.tri(b, a, [x, y + height * 0.34, z], canopy);
        }
      }
    }
  }
  if (terrain && includeDistrictPaths && !districtPaths)
    districtPaths = drawSiteDistrictPaths(mesh, finishedTerrain, registration, supportPlan?.surface ?? water,
      { model, supportPlan, bounds, bridgeTerrain: terrain });
  if (terrain && registration && includeContextBuildings) drawSitePumphouse(mesh, terrain, registration, bounds);
  const [siteX, siteZ] = position,
    foundation = supportPlan?.foundation ?? (terrain ? siteTerrainHeight(terrain, siteX, siteZ) : 0) + grade,
    angle = (bearing * Math.PI) / 180,
    sin = Math.sin(angle),
    cos = Math.cos(angle),
    extendRunway = supportPlan && model.crane?.runway === 'elevated' &&
      assembly.groups.some(({ layer }) => layer === 'Crane_Elevated_Runway_Columns'),
    supportMoat = siteMoat && assembly.groups.some(({ layer }) => layer === 'Crane_Moat_Runway');
  const dryGeometry = siteCanalOpening(supportPlan);
  if (supportPlan && includeFoundations)
    drawSiteFoundations(mesh, model, supportPlan, extendRunway || supportMoat, canalDepth, dryGeometry);
  const relative = relativeToBuilding || buildingCoordinates;
  function toLocal([x, y, z, nx, ny, nz, r, g, b, alpha]) {
    const px = x - siteX, pz = z - siteZ;
    return buildingCoordinates
      ? [cos * px + sin * pz, y - foundation, -sin * px + cos * pz, cos * nx + sin * nz, ny, -sin * nx + cos * nz, r, g, b, alpha]
      : [px, y - foundation, pz, nx, ny, nz, r, g, b, alpha];
  }
  if (relative) {
    // Design views keep moving parts and light fields on their original axes.
    // Drawings keep north in district coordinates and use the same floor datum.
    for (const kind of ['solid', 'glass', 'lines']) {
      const target = mesh[kind];
      for (let i = 0; i < target.length; i += 10) {
        const vertex = toLocal(target.slice(i, i + 10));
        for (let j = 0; j < 6; j++) target[i + j] = vertex[j];
      }
    }
  }
  const world = ([x, y, z, nx, ny, nz, r, g, b, alpha]) => [
      cos * x - sin * z + siteX, y + foundation, sin * x + cos * z + siteZ,
      cos * nx - sin * nz, ny, sin * nx + cos * nz, r, g, b, alpha
    ],
    keepX = relative ? 0 : siteX, keepY = relative ? 0 : foundation, keepZ = relative ? 0 : siteZ,
    openingTop = supportPlan ? supportPlan.crossingSoffit - foundation - 1e-7 : 0,
    firstBuildingGroup = mesh.groups.length;
  for (let groupIndex = 0; groupIndex < assembly.groups.length; groupIndex++) {
    const group = assembly.groups[groupIndex],
      next = assembly.groups[groupIndex + 1];
    if (group.layer === 'Reference') continue;
    if (supportPlan && /^(Assembly_Foundation$|Core_Foundation$|Crane_Cantilever_Pile_Caps$|(?:Public|Entrance|Opposite_Lobby)_Plaza_|Opposite_Lobby_Promenade|Climbing_Ground_Approach)/.test(group.layer)) continue;
    if (extendRunway && group.layer === 'Crane_Elevated_Runway_Columns') continue;
    if (siteMoat && /^(Crane_Moat|Crane_Moat_Water|Crane_Moat_Runway_Piers|Crane_Moat_Guards)$/.test(group.layer)) continue;
    mesh.mark(group.layer, group.name, group.pick);
    const protectElevatedParts = /^(Crane_|Dock(?:ing)?_|Modules?_|Assembly_(?:Open_|Module_|Dock_)|Site_Canal_Lookout_)/.test(group.layer) &&
      group.layer !== 'Assembly_Dock_Stack_Supports',
      cut = dryGeometry && !protectElevatedParts,
      stripMast = supportPlan?.mastCrossing && group.layer === 'Swing_Tower';
    for (const kind of ['solid', 'glass', 'lines']) {
      const vertices = assembly[kind],
        target = mesh[kind],
        limit = next?.[kind] ?? vertices.length, count = kind === 'lines' ? 2 : 3;
      for (let i = group[kind]; i < limit; i += count * 10) {
        const start = target.length;
        if (cut && Math.min(vertices[i + 1], vertices[i + 11], count === 3 ? vertices[i + 21] : Infinity) < openingTop) {
          const points = Array.from({ length: count }, (_, j) => world(vertices.slice(i + j * 10, i + (j + 1) * 10)));
          dryGeometry.append(target, points, stripMast, relative ? toLocal : null);
        } else if (buildingCoordinates) {
          for (let j = 0; j < count * 10; j++) target.push(vertices[i + j]);
        } else {
          for (let j = 0; j < count; j++) {
            const k = i + j * 10, x = vertices[k], z = vertices[k + 2], nx = vertices[k + 3], nz = vertices[k + 5];
            target.push(cos * x - sin * z + keepX, vertices[k + 1] + keepY, sin * x + cos * z + keepZ,
              cos * nx - sin * nz, vertices[k + 4], sin * nx + cos * nz, vertices[k + 6], vertices[k + 7], vertices[k + 8], vertices[k + 9]);
          }
        }
        if (kind === 'lines' && assembly.textureStrokes?.has(i))
          for (let at = start; at < target.length; at += 20) mesh.textureStrokes.add(at);
      }
    }
  }
  return {
    ...mesh,
    ...(districtPaths ? { districtCirculation: {
      bridges: districtPaths.bridges.length, interrupted: districtPaths.interruptions.length,
      steepApproaches: districtPaths.bridges.filter((bridge) => bridge.grade > 0.051).length
    } } : {}),
    H: assembly.H + (relative ? 0 : Math.max(0, foundation)),
    extent: contextRadius || !includeTerrain ? assembly.extent : Math.max(assembly.extent, (terrain?.size ?? 0) / 2),
    ...(buildingCoordinates ? { firstBuildingGroup, northAzimuth: -Math.PI / 2 - angle } : {}),
    // Follow the placed assembly, independently of the district extent and drawing datum.
    orbitPivot: relative
      ? [0, assembly.H * 0.47, 0]
      : [siteX, foundation + assembly.H * 0.47, siteZ],
    foundation
  };
}
