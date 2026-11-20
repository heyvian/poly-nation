'use strict';

// Use a local metric frame for the small site extents. Model north is +Z and east is -X.
function siteCoordinates(location) {
  const metresPerDegree = (SITE_EARTH_RADIUS * Math.PI) / 180,
    longitudeScale = metresPerDegree * Math.cos((location.latitude * Math.PI) / 180);
  return {
    project({ lat, lon }) {
      return [
        (180 - mod(lon - location.longitude + 180, 360)) * longitudeScale,
        (lat - location.latitude) * metresPerDegree
      ];
    },
    geographic([x, z]) {
      return {
        latitude: location.latitude + z / metresPerDegree,
        longitude: mod(location.longitude - x / longitudeScale + 180, 360) - 180
      };
    }
  };
}

const SITE_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const SITE_OSM_MAP = 'https://api.openstreetmap.org/api/0.6/map';
const WEST_VILLAGE_BOUNDS = [51.039, -114.13, 51.063, -114.076];
const WEST_CROSSING = /Crowchild Trail/i;
const EAST_CROSSING = /Mewata|14 Street|14 St\b/i;
const SITE_MAP_COLOURS = {
  woodland: '#8ba77b',
  wetland: '#a2b990',
  tree: '#4d7750'
};

function siteMapBounds(location, size) {
  const { geographic } = siteCoordinates(location),
    radius = size / 2 + 45;
  const southWest = geographic([radius, -radius]),
    northEast = geographic([-radius, radius]);
  const bounds = (west, east) => [southWest.latitude, west, northEast.latitude, east];
  return southWest.longitude <= northEast.longitude
    ? [bounds(southWest.longitude, northEast.longitude)]
    : [bounds(southWest.longitude, 180), bounds(-180, northEast.longitude)];
}

function siteNaturalQuery(location, size, study, includeVegetation) {
  const boxes = siteMapBounds(location, size).map((box) => box.map((n) => n.toFixed(6)).join(','));
  const features = includeVegetation
    ? boxes
        .map(
          (b) => `
    way["natural"~"^(water|wood|wetland|scrub|tree_row)$"](${b});
    way["waterway"~"^(river|stream|riverbank)$"](${b});
    way["landuse"~"^(forest|meadow)$"](${b});
    rel["type"="multipolygon"]["natural"~"^(water|wood|wetland|scrub)$"](${b});
    rel["type"="multipolygon"]["landuse"~"^(forest|meadow)$"](${b});
    rel["type"="multipolygon"]["waterway"="riverbank"](${b});
    node["natural"="tree"](${b});`
        )
        .join('')
    : '';
  const controls = study
    ? `
    way["waterway"="river"]["name"="Bow River"](${WEST_VILLAGE_BOUNDS});
    way["bridge"]["name"~"Crowchild Trail|Mewata|14 Street|14 St",i](${WEST_VILLAGE_BOUNDS});`
    : '';
  return `[out:json][timeout:10];(${features}${controls});out geom;`;
}

async function fetchSiteNaturalFeatures(location, size, study, signal, includeVegetation = true) {
  const query = siteNaturalQuery(location, size, study, includeVegetation);
  let partial = null;
  for (const endpoint of SITE_OVERPASS) {
    try {
      const response = await fetch(endpoint + '?data=' + encodeURIComponent(query), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5500)])
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.elements) && !data.remark) {
          if (!study || hasWestVillageControls(data.elements)) return data.elements;
          if (!partial || data.elements.length > partial.length) partial = data.elements;
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // Give each public Overpass service its own budget before trying the main OSM API.
    }
  }
  const bounds = siteMapBounds(location, size);
  const results = await Promise.allSettled(bounds.map((box) => fetchSiteOsmBox(box, signal)));
  const maps = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (!maps.length && !partial) throw new Error('OpenStreetMap natural features are unavailable');
  const known = new Map();
  function keep(elements) {
    for (const item of elements)
      known.set(item.id == null ? item : `${item.type}/${item.id}`, item);
  }
  if (partial) keep(partial);
  for (const map of maps) keep(map);
  if (study && !hasWestVillageControls([...known.values()])) {
    // Close-up extents and partial Overpass responses can omit the district reference crossings.
    keep(await fetchSiteOsmBox(WEST_VILLAGE_BOUNDS, signal).catch(() => []));
  }
  return [...known.values()];
}

function hasWestVillageControls(elements) {
  const bridges = elements.filter(({ tags }) => tags?.bridge);
  const hasCrossing = (pattern) => bridges.some(({ tags }) => pattern.test(tags.name ?? ''));
  return (
    hasCrossing(WEST_CROSSING) &&
    hasCrossing(EAST_CROSSING) &&
    elements.some(({ tags }) => tags?.waterway === 'river' && tags.name === 'Bow River')
  );
}

async function fetchSiteOsmBox([south, west, north, east], signal) {
  const bbox = [west, south, east, north].map((n) => n.toFixed(6)).join(',');
  const response = await fetch(`${SITE_OSM_MAP}?bbox=${bbox}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)])
  });
  if (!response.ok) throw new Error('OSM map data is unavailable');
  return readSiteOsmXml(await response.text());
}

// The standard map endpoint returns OSM XML with node references. Normalize it to the
// same small set of natural features and bridge controls used by the Overpass path.
function readSiteOsmXml(source) {
  const root = new DOMParser().parseFromString(source, 'application/xml').documentElement;
  if (root.localName !== 'osm') throw new Error('Invalid OSM map response');
  const nodes = new Map(),
    ways = new Map(),
    relations = [],
    features = [];
  const tagsFor = (element) =>
    Object.fromEntries(
      [...element.children]
        .filter((child) => child.localName === 'tag')
        .map((tag) => [tag.getAttribute('k'), tag.getAttribute('v')])
    );
  for (const element of root.children) {
    const { localName } = element,
      id = element.getAttribute('id');
    if (localName === 'node') {
      const lat = Number(element.getAttribute('lat')),
        lon = Number(element.getAttribute('lon'));
      const tags = tagsFor(element);
      nodes.set(id, { lat, lon });
      if (tags.natural === 'tree') features.push({ type: 'node', id, tags, lat, lon });
    } else if (localName === 'relation') relations.push(element);
  }
  for (const element of root.children) {
    if (element.localName !== 'way') continue;
    const id = element.getAttribute('id'),
      tags = tagsFor(element);
    const geometry = [...element.children]
      .filter((child) => child.localName === 'nd')
      .map((child) => nodes.get(child.getAttribute('ref')));
    if (!geometry.length || geometry.some((point) => !point)) continue;
    ways.set(id, geometry);
    if (siteFeatureKind(tags) || tags.bridge) features.push({ type: 'way', id, tags, geometry });
  }
  for (const element of relations) {
    const tags = tagsFor(element);
    if (tags.type !== 'multipolygon' || !siteFeatureKind(tags)) continue;
    const members = [...element.children]
      .filter((child) => child.getAttribute('type') === 'way')
      .map((child) => ({
        role: child.getAttribute('role'),
        geometry: ways.get(child.getAttribute('ref'))
      }));
    features.push({ type: 'relation', id: element.getAttribute('id'), tags, members });
  }
  return features;
}

function siteFeatureKind(tags) {
  if (tags.natural === 'tree') return 'tree';
  if (tags.natural === 'tree_row') return 'treeRow';
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'water';
  if (tags.waterway === 'river' || tags.waterway === 'stream') return 'waterLine';
  if (tags.natural === 'wood' || tags.natural === 'scrub' || tags.landuse === 'forest')
    return 'woodland';
  if (tags.natural === 'wetland' || tags.landuse === 'meadow') return 'wetland';
  return '';
}

function siteGeometryPoints(geometry) {
  if (!Array.isArray(geometry)) return [];
  return geometry.filter(
    (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon)
  );
}

// Multipolygon ways can arrive in any order or direction. Keep only complete rings so
// an incomplete relation cannot paint a straight chord across the site.
function siteMapRings(members, role) {
  const paths = (members ?? [])
    .filter((member) =>
      role === 'outer' ? member.role === 'outer' || !member.role : member.role === role
    )
    .map((member) => siteGeometryPoints(member.geometry))
    .filter((path) => path.length > 1);
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon,
    rings = [];
  while (paths.length) {
    let ring = paths.shift();
    while (!same(ring[0], ring.at(-1))) {
      const last = ring.at(-1);
      const index = paths.findIndex((path) => same(path[0], last) || same(path.at(-1), last));
      if (index < 0) break;
      const [next] = paths.splice(index, 1);
      if (!same(next[0], last)) next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}

function siteNaturalOverlay(elements, terrain) {
  const { project } = siteCoordinates(terrain.location),
    resolution = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = resolution;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const trees = [],
    shapes = [],
    half = terrain.size / 2;
  let count = 0;
  for (const element of elements) {
    const tags = element.tags ?? {},
      kind = siteFeatureKind(tags);
    // Water is defined by the studio plan in both study conditions.
    if (!kind || kind === 'water' || kind === 'waterLine') continue;
    if (
      element.type === 'node' &&
      kind === 'tree' &&
      Number.isFinite(element.lat) &&
      Number.isFinite(element.lon)
    ) {
      const [x, z] = project(element);
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      trees.push({ x, z, height: clamp(Number.parseFloat(tags.height) || 5.5, 2, 20) });
      count++;
      continue;
    }
    const line = kind === 'treeRow';
    const geographic =
      element.type === 'relation'
        ? [...siteMapRings(element.members, 'outer'), ...siteMapRings(element.members, 'inner')]
        : [siteGeometryPoints(element.geometry)];
    const paths = geographic
      .filter((points) => points.length >= (line ? 2 : 4))
      .map((points) => points.map(project));
    const closed = (points) =>
      points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    if (element.type === 'way' && !line && paths.length && !closed(paths[0])) continue;
    if (
      !paths.some((path) => {
        let lowX = Infinity,
          highX = -Infinity,
          lowZ = Infinity,
          highZ = -Infinity;
        for (const [x, z] of path) {
          lowX = Math.min(lowX, x);
          highX = Math.max(highX, x);
          lowZ = Math.min(lowZ, z);
          highZ = Math.max(highZ, z);
        }
        return lowX <= half && highX >= -half && lowZ <= half && highZ >= -half;
      })
    )
      continue;
    shapes.push({ kind, paths, line });
    count++;
  }
  const order = { woodland: 0, wetland: 1, treeRow: 2 };
  shapes.sort((a, b) => order[a.kind] - order[b.kind]);
  for (const { kind, paths, line } of shapes) {
    ctx.beginPath();
    for (const path of paths) {
      path.forEach(([x, z], i) => {
        const px = (0.5 - x / terrain.size) * resolution;
        const py = (0.5 - z / terrain.size) * resolution;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      });
      if (!line) ctx.closePath();
    }
    if (line) {
      ctx.strokeStyle = SITE_MAP_COLOURS.woodland;
      ctx.lineWidth = Math.max(2, (resolution * 3) / terrain.size);
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = SITE_MAP_COLOURS[kind];
      ctx.fill('evenodd');
    }
  }
  const raster = shapes.length ? ctx.getImageData(0, 0, resolution, resolution).data : null;
  return { trees, raster, resolution, count };
}

function siteLineIntersection(a, b, c, d) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    ex = d[0] - c[0],
    ez = d[1] - c[1];
  const cross = dx * ez - dz * ex;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / cross;
  const u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * dx, a[1] + t * dz] : null;
}

function matchWestVillagePlan(elements) {
  const { project } = siteCoordinates(WEST_VILLAGE_PLAN.terrainCentre);
  const ways = elements.filter((element) => element.type === 'way'),
    lines = (geometry) => siteGeometryPoints(geometry).map(project),
    river = ways
      .filter((way) => way.tags?.waterway === 'river' && way.tags?.name === 'Bow River')
      .map((way) => lines(way.geometry));
  const bridges = ways.filter((way) => way.tags?.bridge);
  function crossing(pattern) {
    const hits = [];
    for (const bridge of bridges.filter((way) => pattern.test(way.tags?.name ?? ''))) {
      const points = lines(bridge.geometry);
      for (let i = 1; i < points.length; i++)
        for (const channel of river) {
          for (let j = 1; j < channel.length; j++) {
            const hit = siteLineIntersection(points[i - 1], points[i], channel[j - 1], channel[j]);
            if (hit) hits.push(hit);
          }
        }
    }
    if (!hits.length) return null;
    // A bridge can have a mapped way for each carriageway. Average the nearby crossings.
    const nearby = hits.filter(([x, z]) => Math.hypot(x - hits[0][0], z - hits[0][1]) < 80);
    return nearby[0].map(
      (_, axis) => nearby.reduce((sum, point) => sum + point[axis], 0) / nearby.length
    );
  }
  const west = crossing(WEST_CROSSING),
    east = crossing(EAST_CROSSING);
  if (!west || !east || west[0] < east[0]) return null;

  const [p, q] = WEST_VILLAGE_WATER.controls,
    u = [q[0] - p[0], q[1] - p[1]],
    v = [east[0] - west[0], east[1] - west[1]];
  const square = u[0] ** 2 + u[1] ** 2,
    a = (u[0] * v[0] + u[1] * v[1]) / square,
    b = (u[0] * v[1] - u[1] * v[0]) / square;
  const scale = Math.hypot(a, b);
  // The sheets are 1:5000 (about 1.76 m per PDF point). Reject a mismatched crossing.
  if (scale < 1.25 || scale > 2.3) return null;
  // The view is north-up. A far-off pair is more likely a service tagging error.
  if (a >= 0 || Math.abs(b / a) > 0.35) return null;
  return { a, b, page: p, ground: west, matched: true };
}
