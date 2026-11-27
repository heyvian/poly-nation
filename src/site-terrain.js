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
  return ground - datum;
}

function siteMoatExcavation(terrain, moat, [x, z], cells) {
  if (!moat) return null;
  const existing = [], at = (radius, i) => {
    const angle = i * TAU / MOAT_SEGMENTS;
    return [x + radius * Math.cos(angle), z + radius * Math.sin(angle)];
  };
  for (let i = 0; i < MOAT_SEGMENTS; i++) {
    const a = at(moat.inner, i), b = at(moat.outer, i), c = at(moat.outer, i + 1), d = at(moat.inner, i + 1);
    existing.push([a, b, c], [a, c, d]);
  }
  return siteWaterStudy(terrain, { level: terrain.datum, existing, proposed: [] }, cells);
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
    supportPlan = null,
    model = null,
    includeTerrain = true
  } = {}
) {
  const mesh = meshBuilder();
  if (terrain && includeTerrain) {
    const { size, elevations, datum } = terrain,
      count = natural?.raster ? Math.max(terrain.count, 81) : terrain.count,
      low = Math.min(...elevations),
      high = Math.max(...elevations),
      interval = high - low > 50 ? 5 : 2,
      contour = rgb('#879685'),
      study = siteWaterStudy(
        terrain,
        water && (showWater ? water : { ...water, existing: [] }),
        count - 1
      ), moat = siteMoatExcavation(terrain, assembly.craneMoat, position, count - 1);
    const waterPlanes = (i) => {
      const excavation = moat?.index[i], district = study?.index[i];
      return excavation?.length && district?.length ? [...excavation, ...district] : excavation?.length ? excavation : district;
    };
    const points = Array.from({ length: count ** 2 }, (_, i) => {
      const x = (0.5 - (i % count) / (count - 1)) * size,
        z = (0.5 - Math.floor(i / count) / (count - 1)) * size;
      return [x, siteTerrainHeight(terrain, x, z), z];
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
    mesh.mark('Site terrain');
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
    for (let row = 0; row < count - 1; row++) {
      for (let col = 0; col < count - 1; col++) {
        const i = row * count + col;
        const candidates = waterPlanes(row * (count - 1) + col);
        const triangles = [
          [points[i], points[i + count], points[i + 1]],
          [points[i + 1], points[i + count], points[i + count + 1]]
        ];
        for (const triangle of triangles) {
          if (!candidates?.length) patch(...triangle);
          else
            for (const land of terrainOutsideSiteWater(triangle, candidates))
              for (let j = 1; j + 1 < land.length; j++) patch(land[0], land[j], land[j + 1]);
        }
      }
    }
    addSiteWater(mesh, terrain, study, { showWater, canalDepth });
    if (natural?.trees.length) {
      mesh.mark('OpenStreetMap mapped trees');
      const bark = rgb('#7e7057'),
        canopy = rgb(SITE_MAP_COLOURS.tree),
        cells = count - 1,
        cell = (value) => clamp(Math.floor((0.5 - value / size) * cells), 0, cells - 1);
      for (const { x, z, height } of natural.trees) {
        if (
          waterPlanes(cell(z) * cells + cell(x))?.some((planes) =>
            planes.every((plane) => plane.x * x + plane.z * z <= plane.level)
          )
        )
          continue;
        const y = siteTerrainHeight(terrain, x, z),
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
  const [siteX, siteZ] = position,
    foundation = supportPlan?.foundation ?? (terrain ? siteTerrainHeight(terrain, siteX, siteZ) : 0) + grade,
    angle = (bearing * Math.PI) / 180,
    sin = Math.sin(angle),
    cos = Math.cos(angle),
    extendRunway = supportPlan && model.crane?.runway === 'elevated' &&
      assembly.groups.some(({ layer }) => layer === 'Crane_Elevated_Runway_Columns');
  if (supportPlan) drawSiteFoundations(mesh, model, supportPlan, extendRunway);
  if (relativeToBuilding) {
    // Drawings clip and align to the building datum, even when the wider site is visible.
    for (const kind of ['solid', 'glass', 'lines']) {
      const target = mesh[kind];
      for (let i = 0; i < target.length; i += 10) {
        target[i] -= siteX;
        target[i + 1] -= foundation;
        target[i + 2] -= siteZ;
      }
    }
  }
  for (let groupIndex = 0; groupIndex < assembly.groups.length; groupIndex++) {
    const group = assembly.groups[groupIndex],
      next = assembly.groups[groupIndex + 1];
    if (group.layer === 'Reference') continue;
    if (supportPlan && /^(Assembly_Foundation$|Core_Foundation$|Crane_Cantilever_Pile_Caps$|(?:Public|Entrance|Opposite_Lobby)_Plaza_|Opposite_Lobby_Promenade|Climbing_Ground_Approach)/.test(group.layer)) continue;
    if (extendRunway && group.layer === 'Crane_Elevated_Runway_Columns') continue;
    mesh.mark(group.layer, group.name);
    // Model north is +Z. Rotating the building and its normals together keeps the
    // source materials and named component layers available in both viewers.
    for (const kind of ['solid', 'glass', 'lines']) {
      const vertices = assembly[kind],
        target = mesh[kind],
        limit = next?.[kind] ?? vertices.length;
      for (let i = group[kind]; i < limit; i += 10) {
        const [x, y, z, nx, ny, nz, r, g, b, alpha] = vertices.slice(i, i + 10);
        if (kind === 'lines' && assembly.textureStrokes?.has(i))
          mesh.textureStrokes.add(target.length);
        target.push(
          cos * x - sin * z + (relativeToBuilding ? 0 : siteX),
          y + (relativeToBuilding ? 0 : foundation),
          sin * x + cos * z + (relativeToBuilding ? 0 : siteZ),
          cos * nx - sin * nz,
          ny,
          sin * nx + cos * nz,
          r,
          g,
          b,
          alpha
        );
      }
    }
  }
  return {
    ...mesh,
    H: assembly.H + Math.max(0, foundation),
    extent: Math.max(assembly.extent, (terrain?.size ?? 0) / 2),
    // Follow the placed assembly, independently of the district extent and drawing datum.
    orbitPivot: relativeToBuilding
      ? [0, assembly.H * 0.47, 0]
      : [siteX, foundation + assembly.H * 0.47, siteZ],
    foundation
  };
}
