'use strict';

const BRIDGE_SEAT_RADIUS = 1.06;
const BRIDGE_COMPACT_SCALE = 0.92;
const bridgeLoungeCache = new WeakMap();

// Distance to a walking segment in the plane of the floor.
function bridgeSeatDistance(point, from, to) {
  const x = to[0] - from[0], z = to[1] - from[1],
    t = clamp(((point[0] - from[0]) * x + (point[1] - from[1]) * z) / (x * x + z * z || 1), 0, 1);
  return Math.hypot(point[0] - from[0] - t * x, point[1] - from[1] - t * z);
}

// Fit one textile to the conversation area and the mouths of the capsules.
// A rounded convex outline connects the seats without filling the whole bay.
function bridgeCourtRug(court, seats, inPocket) {
  const points = [],
    add = (x, z) => points.push([x, z]),
    turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < 12; i++) {
    const angle = i * TAU / 12;
    add(court[0] + 0.77 * Math.cos(angle), court[1] + 0.77 * Math.sin(angle));
  }
  for (const { p, heading, scale } of seats) {
    const x = Math.cos(heading), z = Math.sin(heading);
    for (const side of [-0.64, 0.64]) add(p[0] + scale * (0.19 * x - side * z), p[1] + scale * (0.19 * z + side * x));
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull = (list) => {
    const part = [];
    for (const p of list) {
      while (part.length > 1 && turn(part.at(-2), part.at(-1), p) <= 0) part.pop();
      part.push(p);
    }
    return part.slice(0, -1);
  };
  const polygon = [...hull(points), ...hull(points.slice().reverse())],
    lerp = (a, b, t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
    rounded = polygon.flatMap((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return [lerp(a, b, 0.16), lerp(a, b, 0.84)];
    });
  for (const scale of [1, 0.94, 0.88, 0.82]) {
    const rug = rounded.map((p) => lerp(court, p, scale));
    if (rug.every((p, i) => {
      const next = rug[(i + 1) % rug.length];
      return inPocket(p) && inPocket(lerp(p, next, 0.5)) && inPocket(lerp(court, p, 0.5));
    })) return rug;
  }
  return null;
}

function bridgeRugsOverlap(a, b) {
  const separates = (first, second) => first.some(([x, z], i) => {
    const [u, v] = first[(i + 1) % first.length];
    return second.every(([px, pz]) => (u - x) * (pz - z) - (v - z) * (px - x) <= 0);
  });
  return !separates(a, b) && !separates(b, a);
}

function bridgeLounges(model, navigation = null) {
  const circulation = model.circulation;
  if (circulation.bridgeLoungeSeed == null || !circulation.bridges.length) return [];
  // A material snapshot or drawing can open without starting a live simulation.
  // Use the same paths to fit the furniture in either order.
  if (!bridgeLoungeCache.has(model))
    bridgeLoungeCache.set(model, fitBridgeLounges(model, navigation ?? buildNavigation(model, false)));
  return bridgeLoungeCache.get(model);
}

function fitBridgeLounges(model, { nodes, edges, reachable }) {
  const { regions, bridges, width, bridgeLoungeSeed } = model.circulation,
    together = (a, b) => Math.min(Math.abs(a - b), Math.abs(a - b + TAU), Math.abs(a - b - TAU)) < 1e-6,
    midpoint = (q) => (q.start + q.end) / 2,
    angleIn = (q, angle) => angDist(midpoint(q), angle) <= (q.end - q.start) / 2 + 1e-6,
    polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)],
    flat = ([x, , z]) => [x, z],
    lounges = [];
  const landings = regions.filter((q) => q.kind === 'bridgeAccess');
  for (const [i, landing] of landings.entries()) {
    const { f, r, R } = landing, axis = midpoint(landing),
      corridor = Math.max(width, bridges.find((bridge) => bridge.f === f).width),
      rng = random((bridgeLoungeSeed ^ Math.imul(i + 1, 0x2c1b3c6d)) >>> 0),
      flanks = regions.filter((q) => q.f === f && q.kind === 'residual' && q.R > r && q.r < R &&
        (together(q.start, landing.end) || together(q.end, landing.start))),
      floor = [landing, ...flanks];
    if (R - r < 3.15) continue;
    // The room packer reserves the bridge passage first and puts the real
    // programme walls along it. An undersized room at either shoulder can
    // leave a recess. Fit seats in that resulting space, off the corridor axis.
    const inFloor = ([x, z]) => {
      const radius = Math.hypot(x, z), angle = Math.atan2(z, x);
      return floor.some((q) => radius >= q.r - 1e-6 && radius <= q.R + 1e-6 && angleIn(q, angle));
    };
    const center = polar((r + R) / 2, axis),
      distance = ([x, z], [u, v]) => Math.hypot(x - u, z - v),
      fitsRadius = BRIDGE_SEAT_RADIUS * BRIDGE_COMPACT_SCALE + 0.12,
      reach = (R - r) / 2 + 10,
      floorY = f * modelFloorPitch(model) + 0.54,
      access = nodes.filter((n) => n.f === f && n.kind === 'corridor' && n.cell && reachable.has(n.id) && inFloor(flat(n.p))),
      walking = [];
    if (!access.length) continue;
    for (const n of nodes) {
      if (Math.abs(n.f - f) > 1) continue;
      for (const edge of edges[n.id]) {
        if (edge.to < n.id) continue;
        for (let k = 1; k < edge.path.length; k++) {
          const a = edge.path[k - 1], b = edge.path[k];
          if (Math.min(a[1], b[1]) > floorY + 0.21 || Math.max(a[1], b[1]) < floorY - 0.21) continue;
          const A = flat(a), B = flat(b);
          if (bridgeSeatDistance(center, A, B) < reach) walking.push([A, B]);
        }
      }
    }
    const doorPoints = model.circulation.doors.filter((door) => door.f === f)
      .map((door) => polar(door.r, door.angle));
    const seatsInPocket = [], centers = [],
      lateral = ([x, z]) => z * Math.cos(axis) - x * Math.sin(axis),
      seatOutline = Array.from({ length: 12 }, (_, j) => polar(1, j * TAU / 12)),
      canPlace = (p, scale) => {
        const offset = Math.abs(lateral(p)), radius = BRIDGE_SEAT_RADIUS * scale, clearance = radius + 0.12;
        return offset >= corridor / 2 + clearance && offset <= 8.5 && inFloor(p) &&
          !doorPoints.some((door) => distance(door, p) < radius + 0.72) &&
          seatOutline.every(([x, z]) => inFloor([p[0] + clearance * x, p[1] + clearance * z])) &&
          !walking.some(([a, b]) => bridgeSeatDistance(p, a, b) < radius + 0.57);
      };
    for (const q of floor) {
      const low = Math.max(r, q.r) + fitsRadius, high = Math.min(R, q.R) - fitsRadius;
      for (let radius = low + 0.12; radius <= high + 1e-6; radius += 0.43) {
        const step = 0.47 / radius, count = Math.ceil((q.end - q.start) / step);
        for (let k = 0; k < count; k++) {
          const angle = q.start + (q.end - q.start) * (k + 0.5) / count,
            p = polar(radius, angle), offset = lateral(p);
          const priority = rng() - Math.abs(offset) * 0.042;
          if (Math.abs(offset) >= corridor / 2 + 0.52 && Math.abs(offset) <= 8.5)
            centers.push({ p, priority });
          if (canPlace(p, BRIDGE_COMPACT_SCALE)) seatsInPocket.push({ p, fullSize: canPlace(p, 1) });
        }
      }
    }
    const occupied = lounges.filter((lounge) => lounge.f === f).flatMap((lounge) => lounge.seats),
      roomFor = (p, scale) => occupied.every((seat) =>
        distance(seat.p, p) >= BRIDGE_SEAT_RADIUS * (seat.scale + scale) + 0.33 && clears({ p, scale }, seat.route, 0.50)),
      decorate = (seat) => ({ ...seat, fabric: Math.floor(rng() * 4), tableSide: rng() < 0.5 ? -1 : 1 }),
      anchors = access.map((n) => flat(n.p)),
      nearby = (p, max) => anchors.filter((a) => distance(a, p) < max)
        .sort((a, b) => distance(a, p) - distance(b, p)),
      clearLine = (a, b) => {
        const n = Math.max(1, Math.ceil(distance(a, b) / 0.25));
        for (let k = 0; k <= n; k++) {
          if (!inFloor([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])) return false;
        }
        return true;
      };
    const clears = (seat, route, margin) => route.slice(1).every((point, i) =>
      bridgeSeatDistance(seat.p, route[i], point) >= BRIDGE_SEAT_RADIUS * seat.scale + margin);
    const sizes = [
      { count: 5, opening: 92, radii: [2.25, 2.40, 2.55] },
      { count: 4, opening: 108, radii: [1.99, 2.15, 2.34] },
      { count: 3, opening: 120, radii: [1.55, 1.73, 1.93] },
      { count: 2, opening: 180, radii: [1.48, 1.64, 1.84] }
    ];
    const courts = centers.sort((a, b) => b.priority - a.priority), selected = lounges.filter((lounge) => lounge.f === f),
      available = seatsInPocket.slice(), inRugPocket = (side) => (p) => side * lateral(p) >= corridor / 2 + 0.08 && inFloor(p);
    // Give compact groups of three or more first choice of the landing.
    // Search irregular pockets before accepting a pair, then start again
    // with the remaining independent seating area.
    while (available.length && courts.length) {
      let group;
      for (const size of sizes) {
        group = findCircle(size, 1) ?? (size.count <= 4 ? findPocket(size.count, 1) : null) ??
          findCircle(size, BRIDGE_COMPACT_SCALE) ?? (size.count <= 4 ? findPocket(size.count, BRIDGE_COMPACT_SCALE) : null);
        if (group) break;
      }
      if (!group) break;
      group.seats = group.seats.map(decorate);
      lounges.push({ f, axis, passage: corridor, ...group });
      occupied.push(...group.seats);
      selected.push(group);
      for (let j = available.length - 1; j >= 0; j--) if (!roomFor(available[j].p, BRIDGE_COMPACT_SCALE)) available.splice(j, 1);
      for (let j = courts.length - 1; j >= 0; j--)
        if (distance(courts[j].p, group.court) < 3.12) courts.splice(j, 1);
    }

    function entriesFor(p) {
      return nearby(p, 6.45).filter((a) => clearLine(a, p) && occupied.every((seat) => clears(seat, [a, p], 0.56)));
    }
    function facing(p, court, scale) {
      const heading = mod(Math.atan2(court[1] - p[1], court[0] - p[0]), TAU);
      return { p, heading, scale, entry: [p[0] + 1.31 * scale * Math.cos(heading), p[1] + 1.31 * scale * Math.sin(heading)] };
    }
    function separate(a, b, center) {
      return distance(a.p, b.p) >= BRIDGE_SEAT_RADIUS * (a.scale + b.scale) + 0.27 &&
        clears(a, [center, b.entry], 0.42) && clears(b, [center, a.entry], 0.42);
    }
    function finishGroup(court, anchor, seats) {
      if (selected.some((group) => distance(group.court, court) < 3.12) || !seats.every((seat, i) =>
          clearLine(court, seat.entry) && occupied.every((other) => clears(other, [court, seat.entry], 0.42)) &&
          seats.slice(i + 1).every((other) => separate(seat, other, court)))) return null;
      const rug = bridgeCourtRug(court, seats, inRugPocket(Math.sign(lateral(court))));
      if (!rug || selected.some((group) => bridgeRugsOverlap(group.rug, rug))) return null;
      return { court, rug, seats: seats.map(({ entry, ...seat }) => ({ ...seat, route: [anchor, court, entry] })) };
    }
    function findCircle({ count, opening, radii }, scale) {
      for (const { p } of courts) {
        const nearSeats = available.filter(({ p: q, fullSize }) =>
          (scale < 1 || fullSize) && distance(q, p) < 3.1 && lateral(q) * lateral(p) > 0);
        if (nearSeats.length < count) continue;
        const entries = entriesFor(p);
        for (const radius of radii) for (const anchor of entries.slice(0, 3)) {
          const face = Math.atan2(anchor[1] - p[1], anchor[0] - p[0]), gap = opening * Math.PI / 180;
          for (const turn of [0, 0.21, -0.21, 0.42, -0.42, 0.63, -0.63]) {
            const seats = [];
            for (let j = 0; j < count; j++) {
              const a = face + turn + gap / 2 + (TAU - gap) * j / (count - 1),
                pin = [p[0] + radius * scale * Math.cos(a), p[1] + radius * scale * Math.sin(a)], seat = facing(pin, p, scale);
              if (lateral(pin) * lateral(p) < 0 || !canPlace(pin, scale) || !roomFor(pin, scale) || !clears(seat, [anchor, p], 0.55)) break;
              seats.push(seat);
            }
            if (seats.length !== count) continue;
            const court = finishGroup(p, anchor, seats);
            if (court) return court;
          }
        }
      }
      return null;
    }
    function findPocket(count, scale) {
      for (const { p } of courts) {
        const entries = entriesFor(p);
        if (!entries.length) continue;
        const pool = available.filter(({ p: q, fullSize }) => {
          const d = distance(q, p);
          return (scale < 1 || fullSize) && roomFor(q, scale) && d >= 1.47 * scale && d <= 2.86 && lateral(q) * lateral(p) > 0;
        }).map(({ p: q }) => facing(q, p, scale)).sort((a, b) => distance(a.p, p) - distance(b.p, p));
        if (pool.length < count) continue;
        for (const anchor of entries.slice(0, 3)) {
          const candidates = pool.filter((seat) => clears(seat, [anchor, p], 0.54) && clearLine(p, seat.entry));
          if (candidates.length < count) continue;
          for (const first of candidates.slice(0, 12)) {
            const group = [first];
            for (const seat of candidates) {
              if (group.every((other) => separate(seat, other, p))) group.push(seat);
              if (group.length !== count) continue;
              const spread = group.map(({ heading }) => heading).sort((a, b) => a - b),
                biggestGap = Math.max(...spread.map((a, j) => mod(spread[(j + 1) % count] - a, TAU)));
              // A group wraps around the center. A row along the wall does not make a room.
              const court = biggestGap <= (count === 2 ? 3.88 : 4.04) ? finishGroup(p, anchor, group) : null;
              if (court) return court;
              group.pop();
            }
          }
        }
      }
      return null;
    }
  }
  return lounges;
}

function drawBridgeLounge(mesh, lounge, base) {
  const { quad, box, line, tri } = mesh,
    palette = ['#6e9290', '#957e9e', '#a58160', '#73897a'],
    walnut = rgb('#927058'), plinth = rgb('#526963');
  mesh.mark(`Circulation_L${lounge.f + 1}_Bridge_Seating_Rug`, 'Fitted conversation rug');
  const [x, z] = lounge.court, y = base + 0.012, center = [x, y, z],
    point = ([u, v], scale) => [x + scale * (u - x), y, z + scale * (v - z)],
    woven = rgb('#b0a0b9'), selvedge = rgb('#866f8f'), stitch = rgb('#c6b7c9');
  for (let i = 0; i < lounge.rug.length; i++) {
    const a = lounge.rug[i], b = lounge.rug[(i + 1) % lounge.rug.length];
    tri(center, point(b, 0.91), point(a, 0.91), woven);
    quad(point(a, 0.91), point(b, 0.91), point(b, 1), point(a, 1), selvedge);
    line(point(a, 0.95), point(b, 0.95), stitch);
  }
  mesh.mark(`Circulation_L${lounge.f + 1}_Bridge_Seating`, 'Bridge seating capsules');
  for (const seat of lounge.seats) {
    const { p, heading, scale, fabric, tableSide } = seat,
      shell = rgb(palette[fabric]), inner = materialTint(shell, 1.17), welt = materialTint(shell, 0.72),
      sin = Math.sin(heading), cos = Math.cos(heading);
    // Local z points toward the opening. The half-shell follows the back of
    // the seat, then curves inward overhead to form the capsule silhouette.
    const at = (x, z, y) => [p[0] + scale * (-x * sin + z * cos), base + y, p[1] + scale * (x * cos + z * sin)],
      arc = (a, r, y, shift = 0) => at(Math.sin(a) * r, shift - Math.cos(a) * r, y),
      profile = [[0.58, 0.12, -0.02], [0.86, 0.21, 0], [1.00, 0.43, 0], [1.04, 0.70, 0],
        [1.03, 1.68, 0.016], [0.99, 1.92, 0.045], [0.91, 2.075, 0.12], [0.77, 2.12, 0.23]],
      steps = 16, sweep = 1.37;
    const edge = (a, step, lining) => {
      const [r, y, shift] = profile[step];
      return arc(a, r - (lining ? 0.072 : 0), y - (lining ? 0.045 : 0), shift);
    };
    for (let j = 0; j < steps; j++) {
      const a = -sweep + j * 2 * sweep / steps, b = -sweep + (j + 1) * 2 * sweep / steps;
      for (let h = 1; h < profile.length; h++) {
        quad(edge(a, h - 1, false), edge(b, h - 1, false), edge(b, h, false), edge(a, h, false), shell);
        quad(edge(b, h - 1, true), edge(a, h - 1, true), edge(a, h, true), edge(b, h, true), inner);
      }
      for (const h of [0, profile.length - 1])
        quad(edge(a, h, false), edge(a, h, true), edge(b, h, true), edge(b, h, false), welt);
      const crown = profile.length - 1;
      line(edge(a, crown, false), edge(b, crown, false), welt);
    }
    for (const a of [-sweep, sweep]) for (let h = 1; h < profile.length; h++) {
      const cap = [edge(a, h - 1, false), edge(a, h, false), edge(a, h, true), edge(a, h - 1, true)];
      quad(...(a < 0 ? cap : cap.reverse()), welt);
      line(edge(a, h - 1, false), edge(a, h, false), welt);
    }
    const [x, y, z] = at(0, -0.37, 0.014);
    box(x, y, z, 0.64 * scale, 0.14, 0.47 * scale, heading, plinth);
    // Three separate upholstery segments leave a seam between sitters.
    for (let place = 0; place < 3; place++) {
      const start = -sweep + place * 2 * sweep / 3 + 0.027, end = start + 2 * sweep / 3 - 0.054;
      for (let k = 0; k < 5; k++) {
        const a = start + (end - start) * k / 5, b = start + (end - start) * (k + 1) / 5;
        quad(arc(a, 0.26, 0.54), arc(a, 0.94, 0.56), arc(b, 0.94, 0.56), arc(b, 0.26, 0.54), inner);
        quad(arc(b, 0.26, 0.54), arc(a, 0.26, 0.54), arc(a, 0.30, 0.36), arc(b, 0.30, 0.36), shell);
        quad(arc(a, 0.94, 0.56), arc(a, 0.86, 0.36), arc(b, 0.86, 0.36), arc(b, 0.94, 0.56), shell);
        quad(arc(b, 0.30, 0.36), arc(b, 0.86, 0.36), arc(a, 0.86, 0.36), arc(a, 0.30, 0.36), shell);
        if (!k || k === 4) {
          const seam = k ? b : a, cap = [arc(seam, 0.26, 0.54), arc(seam, 0.94, 0.56),
            arc(seam, 0.86, 0.36), arc(seam, 0.30, 0.36)];
          quad(...(k ? cap.reverse() : cap), welt);
          line(arc(seam, 0.27, 0.547), arc(seam, 0.94, 0.565), welt);
        }
      }
    }
    const tableX = tableSide * 0.60, tableZ = 0.27, point = (angle, y) =>
      at(tableX + Math.cos(angle) * 0.22, tableZ + Math.sin(angle) * 0.19, y);
    const [tx, ty, tz] = at(tableX, -0.22, 0.34);
    box(tx, ty, tz, 0.045 * scale, 0.365, 0.06 * scale, heading, plinth);
    const bracket = at(tableX, 0.015, 0.66);
    box(...bracket, 0.052 * scale, 0.05, 0.52 * scale, heading, plinth);
    for (let k = 0; k < 14; k++) {
      const a = k * TAU / 14, b = (k + 1) * TAU / 14;
      tri(at(tableX, tableZ, 0.75), point(a, 0.75), point(b, 0.75), walnut);
      tri(at(tableX, tableZ, 0.71), point(b, 0.71), point(a, 0.71), walnut);
      quad(point(a, 0.71), point(b, 0.71), point(b, 0.75), point(a, 0.75), walnut);
    }
  }
}
