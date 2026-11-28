'use strict';

// The supplied sheets share this PDF frame, in points with y increasing down.
const WEST_VILLAGE_PLAN = {
  frame: [28, 67, 1168, 658],
  limits: [93, 222, 1130, 569],
  defaultPin: [332, 388],
  // Sites are numbered on 5000-labelled-parcels.pdf. The northern boundary follows
  // the vector shoreline in that sheet, with sub-point simplification in PDF units.
  parcel: [
    [284.971, 371.786], [289.834, 367.870], [301.814, 359.920], [302.397, 355.920],
    [307.363, 350.019], [313.722, 344.662], [324.444, 334.558], [333.843, 329.284],
    [346.565, 324.145], [379.391, 315.445], [381.685, 315.127],
    [356.257, 568.798], [303.905, 568.798]
  ],
  // 10 Avenue SW traced on the studio master plan and identified on City ARP Map 1.6.
  tenthAvenue: [[451, 529], [557, 531], [669, 532], [784, 533], [931, 534], [1069, 538], [1170, 541]],
  terrainCentre: { latitude: 51.049, longitude: -114.103 },
  terrainSize: 2800,
  sources: {
    master: { title: 'Master Plan 1-5000.pdf', image: 'assets/site/master.webp' },
    water: { title: '5000-water.pdf', image: 'assets/site/water.webp', proposedWater: true, existing: 'master' },
    circulation: { title: '5000-circulation.pdf', image: 'assets/site/circulation.webp' },
    combined: { title: 'Water and circulation', image: 'assets/site/water-circulation.webp',
      proposedWater: true, existing: 'circulation' },
    parcels: { title: '5000-labelled-parcels.pdf', image: 'assets/site/parcels.webp' }
  }
};

// The landmark points are the exact vector corners identified on the marked reference.
// GPS pairs are latitude and longitude in that order.
const WEST_VILLAGE_LANDMARKS = [
  { label: 'PumpHouse Theatre · north corner', page: [321.0699, 406.2604],
    gps: [51.04657408143171, -114.10994351062043] },
  { label: 'PumpHouse Theatre · south corner', page: [319.6578, 437.7654],
    gps: [51.0460840124423, -114.11000040885965] },
  { label: 'Former Greyhound Station · northeast corner', page: [770.7353, 382.987],
    gps: [51.046849659262335, -114.09870863269303] }
];

// The nominal fit is the fallback when landmark or bridge registration is unavailable.
const WEST_VILLAGE_NOMINAL = {
  a: -(5000 * 0.0254) / 72,
  b: 0,
  page: [612, 438],
  ground: [0, 0],
  matched: false
};

// A similarity fit preserves right angles and a common metres-per-point scale.
// Using the centred control pairs avoids making one corner the fixed origin.
function westVillageLandmarkRegistration(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== WEST_VILLAGE_LANDMARKS.length) return null;
  const { project } = siteCoordinates(WEST_VILLAGE_PLAN.terrainCentre),
    pairs = WEST_VILLAGE_LANDMARKS.flatMap(({ page }, i) => {
      const coordinate = coordinates[i];
      if (!Array.isArray(coordinate) || coordinate.length !== 2) return [];
      const [lat, lon] = coordinate;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) >= 90 || Math.abs(lon) > 180) return [];
      const ground = project({ lat, lon });
      return Math.hypot(...ground) <= WEST_VILLAGE_PLAN.terrainSize / 2 ? [{ page, ground }] : [];
    });
  if (pairs.length !== WEST_VILLAGE_LANDMARKS.length) return null;
  const centre = (key) => [0, 1].map((axis) => pairs.reduce((sum, pair) => sum + pair[key][axis], 0) / pairs.length),
    page = centre('page'), ground = centre('ground');
  let scaleSquared = 0, dotProduct = 0, crossProduct = 0;
  for (const { page: [px, py], ground: [gx, gz] } of pairs) {
    const x = px - page[0], y = py - page[1], u = gx - ground[0], v = gz - ground[1];
    scaleSquared += x * x + y * y;
    dotProduct += x * u + y * v;
    crossProduct += x * v - y * u;
  }
  const a = dotProduct / scaleSquared, b = crossProduct / scaleSquared,
    registration = { a, b, page, ground, method: 'landmarks', matched: true, controlCount: pairs.length },
    scale = westVillageScale(registration),
    errors = pairs.map(({ page, ground }) => {
      const [x, z] = westVillageToGround(page, registration);
      return Math.hypot(x - ground[0], z - ground[1]);
    }),
    rms = Math.hypot(...errors) / Math.sqrt(pairs.length);
  if (a >= 0 || !(scale >= 1.25 && scale <= 2.3) || rms > 15) return null;
  return { ...registration, rms };
}

function westVillageScale(registration) {
  return Math.hypot(registration.a, registration.b);
}

function westVillageToGround([x, y], { a, b, page, ground }) {
  return [
    ground[0] + a * (x - page[0]) - b * (y - page[1]),
    ground[1] + b * (x - page[0]) + a * (y - page[1])
  ];
}

function westVillageToPage([x, z], { a, b, page, ground }) {
  const square = a * a + b * b,
    dx = x - ground[0],
    dz = z - ground[1];
  return [page[0] + (dx * a + dz * b) / square, page[1] + (dz * a - dx * b) / square];
}

function westVillageParcel(registration) {
  return WEST_VILLAGE_PLAN.parcel.map((point) => westVillageToGround(point, registration));
}

function westVillageParcelEdge([x, y]) {
  const { parcel } = WEST_VILLAGE_PLAN;
  return Math.min(...parcel.map(([ax, ay], i) => {
    const [bx, by] = parcel[(i + 1) % parcel.length], dx = bx - ax, dy = by - ay,
      t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }));
}

function westVillageInside([x, y]) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (westVillageParcelEdge([x, y]) < 1e-6) return true;
  const { parcel } = WEST_VILLAGE_PLAN;
  let inside = false;
  for (let i = 0; i < parcel.length; i++) {
    const [ax, ay] = parcel[i], [bx, by] = parcel[(i + 1) % parcel.length];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

function westVillageTenthAvenue(x, registration) {
  const route = WEST_VILLAGE_PLAN.tenthAvenue.map((point) => westVillageToGround(point, registration)),
    end = route.at(-1), meridian = clamp(x, Math.min(route[0][0], end[0]), Math.max(route[0][0], end[0]));
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    if (meridian < Math.min(a[0], b[0]) || meridian > Math.max(a[0], b[0])) continue;
    const t = (meridian - a[0]) / (b[0] - a[0]);
    return [meridian, a[1] + (b[1] - a[1]) * t];
  }
  return end;
}

// Detail placement highlights water intersections without silently shifting the pin.
function westVillageOverlaps(point, radius, triangles) {
  const [x, y] = point;
  function side(ax, ay, bx, by) {
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  }
  function close(ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay,
      square = dx * dx + dy * dy;
    const u = square ? clamp(((x - ax) * dx + (y - ay) * dy) / square, 0, 1) : 0;
    return Math.hypot(x - ax - dx * u, y - ay - dy * u) <= radius;
  }
  return triangles.some(([ax, ay, bx, by, cx, cy]) => {
    if (
      x + radius < Math.min(ax, bx, cx) ||
      x - radius > Math.max(ax, bx, cx) ||
      y + radius < Math.min(ay, by, cy) ||
      y - radius > Math.max(ay, by, cy)
    )
      return false;
    const sides = [side(ax, ay, bx, by), side(bx, by, cx, cy), side(cx, cy, ax, ay)];
    return (
      sides.every((value) => value >= 0) ||
      sides.every((value) => value <= 0) ||
      close(ax, ay, bx, by) ||
      close(bx, by, cx, cy) ||
      close(cx, cy, ax, ay)
    );
  });
}

// Sample the middle of the largest wetted span at seven stations. The bridge crossing
// areas and the proposed branch polygons never contribute to the Bow River datum.
function westVillageBowSamples() {
  return [225, 366, 490, 628, 756, 868, 1010]
    .map((x) => {
      const spans = [];
      for (const [ax, ay, bx, by, cx, cy] of WEST_VILLAGE_WATER.river) {
        const triangle = [
            [ax, ay],
            [bx, by],
            [cx, cy]
          ],
          crossings = [];
        for (let i = 0; i < 3; i++) {
          const [a, b] = [triangle[i], triangle[(i + 1) % 3]];
          if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x))
            crossings.push(a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0])));
        }
        if (crossings.length === 2) spans.push(crossings.sort((a, b) => a - b));
      }
      spans.sort((a, b) => a[0] - b[0]);
      const reaches = [];
      for (const span of spans) {
        const end = reaches.at(-1);
        if (end && span[0] <= end[1] + 0.04) end[1] = Math.max(end[1], span[1]);
        else reaches.push(span);
      }
      const middle = reaches.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
      return middle ? [x, (middle[0] + middle[1]) / 2] : null;
    })
    .filter(Boolean);
}

function westVillageWaterFromPlan(terrain, registration, proposed) {
  const transform = (point) => westVillageToGround(point, registration),
    median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
    level = median(
      westVillageBowSamples().map((point) => {
        const [x, z] = transform(point);
        return terrain.datum + siteTerrainHeight(terrain, x, z);
      })
    ),
    triangles = (entries) =>
      entries.map(([ax, ay, bx, by, cx, cy]) =>
        [
          [ax, ay],
          [bx, by],
          [cx, cy]
        ].map(transform)
      );
  return {
    level,
    existing: triangles(WEST_VILLAGE_WATER.river),
    proposed: proposed ? triangles(WEST_VILLAGE_WATER.canals) : []
  };
}
