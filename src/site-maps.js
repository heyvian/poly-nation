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
  'https://overpass.kumi.systems/api/interpreter'
];
const WEST_VILLAGE_BOUNDS = '51.039,-114.130,51.063,-114.076';
const SITE_MAP_COLOURS = {
  woodland: '#8ba77b',
  wetland: '#a2b990',
  water: '#78acbd',
  tree: '#4d7750'
};

function siteNaturalQuery(location, size, study) {
  const { geographic } = siteCoordinates(location),
    radius = size / 2 + 45;
  const southWest = geographic([radius, -radius]),
    northEast = geographic([-radius, radius]);
  const bounds = (west, east) =>
    [southWest.latitude, west, northEast.latitude, east].map((n) => n.toFixed(6)).join(',');
  const boxes =
    southWest.longitude <= northEast.longitude
      ? [bounds(southWest.longitude, northEast.longitude)]
      : [bounds(southWest.longitude, 180), bounds(-180, northEast.longitude)];
  const features = boxes
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
    .join('');
  const controls = study
    ? `
    way["waterway"="river"]["name"="Bow River"](${WEST_VILLAGE_BOUNDS});
    way["bridge"]["name"~"Crowchild Trail|Mewata|14 Street|14 St",i](${WEST_VILLAGE_BOUNDS});`
    : '';
  return `[out:json][timeout:10];(${features}${controls});out geom;`;
}

async function fetchSiteNaturalFeatures(location, size, study, signal) {
  const query = siteNaturalQuery(location, size, study);
  for (const endpoint of SITE_OVERPASS) {
    try {
      const response = await fetch(endpoint + '?data=' + encodeURIComponent(query), { signal });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.elements) && !data.remark) return data.elements;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // The two public mirrors can have different availability.
    }
  }
  throw new Error('OpenStreetMap natural features are unavailable');
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
    names = new Set(),
    half = terrain.size / 2;
  let count = 0;
  for (const element of elements) {
    const tags = element.tags ?? {},
      kind = siteFeatureKind(tags);
    if (!kind) continue;
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
    const line = kind === 'treeRow' || kind === 'waterLine';
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
    if (tags.name && (kind === 'water' || kind === 'waterLine')) names.add(tags.name);
    count++;
  }
  const order = { woodland: 0, wetland: 1, treeRow: 2, waterLine: 3, water: 4 };
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
      ctx.strokeStyle = SITE_MAP_COLOURS[kind === 'treeRow' ? 'woodland' : 'water'];
      ctx.lineWidth = Math.max(2, (resolution * (kind === 'treeRow' ? 3 : 5)) / terrain.size);
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = SITE_MAP_COLOURS[kind];
      ctx.fill('evenodd');
    }
  }
  const raster = shapes.length ? ctx.getImageData(0, 0, resolution, resolution).data : null;
  return { trees, raster, resolution, count, names: [...names] };
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

async function alignWestVillageWater(elements, terrain, elevationAt) {
  const { project, geographic } = siteCoordinates(terrain.location);
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
  const west = crossing(/Crowchild Trail/i),
    east = crossing(/Mewata|14 Street|14 St\b/i);
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
  const transform = (x, y) => [
    west[0] + a * (x - p[0]) - b * (y - p[1]),
    west[1] + b * (x - p[0]) + a * (y - p[1])
  ];
  const triangles = (entries) =>
    entries.map(([ax, ay, bx, by, cx, cy]) => [
      transform(ax, ay),
      transform(bx, by),
      transform(cx, cy)
    ]);
  function closestOnBow(target) {
    let best,
      distance = Infinity;
    for (const channel of river)
      for (let i = 1; i < channel.length; i++) {
        const [x, z] = channel[i - 1],
          dx = channel[i][0] - x,
          dz = channel[i][1] - z;
        const length = dx * dx + dz * dz;
        if (!length) continue;
        const t = clamp(((target[0] - x) * dx + (target[1] - z) * dz) / length, 0, 1);
        const point = [x + dx * t, z + dz * t],
          separation = Math.hypot(point[0] - target[0], point[1] - target[1]);
        if (separation < distance) {
          best = point;
          distance = separation;
        }
      }
    return best;
  }
  const samples = [0.4, 0.45, 0.5, 0.55, 0.6].map((fraction) =>
    geographic(closestOnBow([west[0] + v[0] * fraction, west[1] + v[1] * fraction]))
  );
  const levels = (await Promise.all(samples.map(elevationAt))).sort((a, b) => a - b);
  const level = levels[2];
  if (!Number.isFinite(level) || level < -500 || level > 9000) return null;
  return {
    level,
    existing: triangles(WEST_VILLAGE_WATER.river),
    proposed: triangles(WEST_VILLAGE_WATER.canals)
  };
}
