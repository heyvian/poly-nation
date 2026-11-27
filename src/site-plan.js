'use strict';

// All three supplied sheets share this PDF frame, in points with y increasing down.
const WEST_VILLAGE_PLAN = {
  frame: [28, 67, 1168, 658],
  limits: [93, 222, 1130, 569],
  defaultPin: [740, 430],
  // 10 Avenue SW traced on the studio master plan and identified on City ARP Map 1.6.
  tenthAvenue: [[451, 529], [557, 531], [669, 532], [784, 533], [931, 534], [1069, 538], [1170, 541]],
  terrainCentre: { latitude: 51.049, longitude: -114.103 },
  terrainSize: 2800,
  sources: {
    master: { title: 'Master Plan 1-5000.pdf', image: 'assets/site/master.webp' },
    water: { title: '5000-water.pdf', image: 'assets/site/water.webp' },
    circulation: { title: '5000-circulation.pdf', image: 'assets/site/circulation.webp' }
  }
};

// The nominal fit is a district-scale starting point. A live match replaces it when
// both crossings can be located, while the chosen point on the studio sheets stays fixed.
const WEST_VILLAGE_NOMINAL = {
  a: -(5000 * 0.0254) / 72,
  b: 0,
  page: [612, 438],
  ground: [0, 0],
  matched: false
};

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

function westVillageInside(pin) {
  const [x, y] = pin,
    [left, top, right, bottom] = WEST_VILLAGE_PLAN.limits;
  return (
    Number.isFinite(x) && Number.isFinite(y) && x >= left && x <= right && y >= top && y <= bottom
  );
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
