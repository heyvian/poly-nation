'use strict';

// Terrain Tiles is a public bare-earth DEM in Web Mercator. Its source resolution varies.
const SITE_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const SITE_TILE_SIZE = 256;
const SITE_EARTH_RADIUS = 6378137;

function parseSiteCoordinates(value) {
  if (typeof value !== 'string') return null;
  const [lat, lon, extra] = value.trim().split(/\s*[,;]\s*|\s+/);
  const latitude = Number(lat),
    longitude = Number(lon);
  if (
    !lat ||
    !lon ||
    extra !== undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 85 ||
    Math.abs(longitude) > 180
  )
    return null;
  return { latitude, longitude };
}

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

async function sampleSiteTerrain(location, size, elevationAt) {
  const count = 41,
    { geographic } = siteCoordinates(location);
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
  if (elevations.some((height) => height < -500 || height > 9000))
    throw new Error('No usable elevations');
  const datum = elevations[(elevations.length - 1) / 2];
  return { location, size, count, datum, elevations };
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
  const top = elevations[i] * (1 - fx) + elevations[i + 1] * fx,
    bottom = elevations[i + count] * (1 - fx) + elevations[i + count + 1] * fx;
  return top * (1 - fz) + bottom * fz - datum;
}

function siteAssemblyMesh(
  assembly,
  terrain,
  grade,
  bearing,
  natural = null,
  alignedWater = null,
  showContours = true
) {
  const mesh = meshBuilder();
  if (terrain) {
    const { size, elevations, datum } = terrain,
      count = natural?.raster ? 81 : terrain.count,
      low = Math.min(...elevations),
      high = Math.max(...elevations),
      interval = high - low > 50 ? 5 : 2,
      contour = rgb('#879685'),
      study = siteWaterStudy(terrain, alignedWater, count - 1);
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
        const candidates = study?.index[row * (count - 1) + col];
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
    addSiteWater(mesh, terrain, study);
    if (natural?.trees.length) {
      mesh.mark('OpenStreetMap mapped trees');
      const bark = rgb('#7e7057'),
        canopy = rgb(SITE_MAP_COLOURS.tree);
      for (const { x, z, height } of natural.trees) {
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
  const first = assembly.groups.find((group) => group.layer !== 'Reference');
  if (first) {
    mesh.mark('Building assembly');
    const angle = (bearing * Math.PI) / 180,
      sin = Math.sin(angle),
      cos = Math.cos(angle);
    // +Z is north and -X is east in the drawing camera. Rotate positions and normals together.
    for (const kind of ['solid', 'glass', 'lines']) {
      const vertices = assembly[kind];
      for (let i = first[kind]; i < vertices.length; i += 10) {
        const [x, y, z, nx, ny, nz, r, g, b, alpha] = vertices.slice(i, i + 10);
        mesh[kind].push(
          cos * x - sin * z,
          y + grade,
          sin * x + cos * z,
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
    H: assembly.H + Math.max(0, grade),
    extent: Math.max(assembly.extent, (terrain?.size ?? 0) / 2)
  };
}

const openSiteWorkspace = (() => {
  const panel = $('sitePhase'),
    canvas = $('siteCanvas'),
    status = $('siteStatus'),
    naturalStatus = $('siteNaturalStatus'),
    waterStatus = $('siteWaterStatus'),
    study = $('siteCanalStudy'),
    contours = $('siteContours'),
    westVillage = $('loadWestVillage'),
    input = $('siteCoordinates'),
    extent = $('siteExtent'),
    load = $('loadSite'),
    grade = $('siteGrade'),
    bearing = $('siteBearing'),
    view = { az: -0.84, el: 0.57, zoom: 1, pan: 0, panX: 0 },
    storageKey = 'poly-nation-site-v1';
  let terrain = null,
    natural = null,
    water = null,
    scene = null,
    assembly = null,
    source = null,
    signature = '',
    context = null,
    renderer = null,
    fallback = null,
    loading = false,
    autoLoad = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    contours.checked = saved?.contours !== false;
    if (saved && parseSiteCoordinates(saved.coordinates)) {
      input.value = saved.coordinates;
      extent.value = ['300', '500', '1000', '2200'].includes(saved.extent) ? saved.extent : '500';
      grade.value = clamp(Number(saved.grade) || 0, -100, 100);
      bearing.value = clamp(Number(saved.bearing) || 0, 0, 360);
      study.checked = saved.study === true;
      autoLoad = true;
    }
  } catch {
    // Site placement can also be used without browser storage.
  }

  function present() {
    if (panel.hidden || !scene) return;
    if (renderer) paintWebGL(canvas, context, renderer, view);
    else if (fallback) paintSoftware(scene, fallback, view);
  }
  function rebuild(fit = false) {
    if (!assembly) return;
    scene = siteAssemblyMesh(
      assembly,
      terrain,
      clamp(Number(grade.value) || 0, -100, 100),
      clamp(Number(bearing.value) || 0, 0, 360),
      natural,
      water,
      contours.checked
    );
    if (renderer) uploadWebGLMesh(context, renderer, scene);
    if (fit) fitModel(scene, view, canvas);
    present();
  }
  function savePlacement() {
    try {
      const previous = terrain ? null : JSON.parse(localStorage.getItem(storageKey));
      const placement = { ...previous, contours: contours.checked };
      if (terrain) {
        const { location, size } = terrain;
        Object.assign(placement, {
          coordinates: `${location.latitude}, ${location.longitude}`,
          extent: String(size),
          grade: grade.value,
          bearing: bearing.value,
          study: study.checked
        });
      }
      localStorage.setItem(storageKey, JSON.stringify(placement));
    } catch {
      // Toggling or positioning the assembly does not depend on saved state.
    }
  }
  function setLoading(active) {
    loading = active;
    for (const control of [input, extent, study, westVillage, load]) control.disabled = active;
  }
  async function loadTerrain() {
    if (loading) return;
    const location = parseSiteCoordinates(input.value);
    if (!location) {
      status.textContent = 'Enter two decimal coordinates, for example 51.0000, -114.0000.';
      return;
    }
    setLoading(true);
    status.textContent = 'Loading public bare-earth elevations…';
    const previousNaturalStatus = naturalStatus.textContent;
    const previousWaterStatus = waterStatus.textContent;
    const waterStatusWasHidden = waterStatus.hidden;
    naturalStatus.textContent = 'Loading mapped rivers and vegetation…';
    waterStatus.hidden = !study.checked;
    waterStatus.textContent = study.checked
      ? 'Matching the study drawings to the Bow River crossings…'
      : '';
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 30000),
      elevationAt = siteElevationSampler(controller.signal),
      mapRequest = fetchSiteNaturalFeatures(
        location,
        Number(extent.value),
        study.checked,
        controller.signal
      ).catch(() => null);
    try {
      const nextTerrain = await sampleSiteTerrain(
        location,
        Number(extent.value),
        elevationAt
      ).catch(() => null);
      if (!nextTerrain) {
        status.textContent = terrain
          ? `Terrain could not be loaded. Showing the previous site at ${terrain.location.latitude}, ${terrain.location.longitude}.`
          : 'Terrain could not be loaded from the public service. Check the coordinates and try again.';
        naturalStatus.textContent = terrain
          ? previousNaturalStatus
          : 'Natural features need a loaded terrain extent.';
        waterStatus.hidden = waterStatusWasHidden;
        waterStatus.textContent = previousWaterStatus;
        return;
      }
      terrain = nextTerrain;
      natural = water = null;
      $('siteNaturalLegend').hidden = $('siteCanalLegend').hidden = true;
      const { elevations, datum, size } = terrain,
        low = Math.min(...elevations),
        high = Math.max(...elevations);
      status.textContent = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ${size} m square. Centre ${datum.toFixed(1)} m elevation. Relief ${(high - low).toFixed(1)} m.`;
      rebuild(true);
      savePlacement();
      const elements = await mapRequest;
      if (elements) natural = siteNaturalOverlay(elements, terrain);
      naturalStatus.textContent = natural?.count
        ? `${natural.count} mapped natural features.${natural.names.length ? ' ' + natural.names.slice(0, 3).join(', ') + '.' : ''}`
        : elements
          ? 'No mapped natural features were found in this extent.'
          : 'OpenStreetMap is unavailable. The elevation terrain is ready.';
      if (study.checked) {
        if (elements)
          water = await alignWestVillageWater(elements, terrain, elevationAt).catch(() => null);
        const hasCanals =
          water && siteWaterStudy(terrain, water, 1).faces.some(({ kind }) => kind === 'proposed');
        waterStatus.textContent = hasCanals
          ? `West Village aligned at Crowchild Trail and 14 Street. The Bow River and canals share a ${water.level.toFixed(1)} m study plane sampled from the Bow DEM.`
          : water
            ? 'The aligned canal study is outside the current terrain extent.'
            : 'The study needs two mapped bridge crossings and a Bow River elevation sample. The original terrain is shown.';
        $('siteCanalLegend').hidden = !hasCanals;
      }
      $('siteNaturalLegend').hidden = !natural?.count && $('siteCanalLegend').hidden;
      if (natural?.count || water) rebuild();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      setLoading(false);
    }
  }
  $('siteForm').onsubmit = (event) => {
    event.preventDefault();
    loadTerrain();
  };
  westVillage.onclick = () => {
    // This preset is a framing point for the district, separate from the final project pin.
    input.value = '51.0490, -114.1030';
    extent.value = '2200';
    study.checked = true;
    loadTerrain();
  };
  grade.onchange =
    bearing.onchange =
    contours.onchange =
      () => {
        rebuild();
        savePlacement();
      };
  bindModelCamera({
    canvas,
    getCamera: () => view,
    getMesh: () => scene,
    onChange: present,
    buttons: { axo: 'siteAxo', plan: 'sitePlan', fit: 'siteFit' }
  });
  new ResizeObserver(present).observe(canvas);

  return (model, assignments) => {
    if (!renderer && !fallback) {
      context = canvas.getContext('webgl', { antialias: true, alpha: false });
      renderer = createWebGLRenderer(context);
      if (!renderer) fallback = createSoftwareRenderer(canvas);
    }
    const layers = buildViewLayers(),
      next = JSON.stringify([assignments, layers]);
    if (source !== model || signature !== next) {
      const firstVisit = !assembly;
      source = model;
      signature = next;
      assembly = buildAssemblyMesh(model, layers, 0, {
        assignments,
        view: { seed: state.seed },
        programColors: false,
        structureView: false,
        finishJoints: Boolean(renderer)
      });
      rebuild(firstVisit);
    } else present();
    if (autoLoad) {
      autoLoad = false;
      loadTerrain();
    }
  };
})();
