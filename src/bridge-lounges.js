'use strict';

const BRIDGE_SEAT_RADIUS = 1.06;
const bridgeLoungeCache = new WeakMap();

// Distance to a walking segment in the plane of the floor.
function bridgeSeatDistance(point, from, to) {
  const x = to[0] - from[0], z = to[1] - from[1],
    t = clamp(((point[0] - from[0]) * x + (point[1] - from[1]) * z) / (x * x + z * z || 1), 0, 1);
  return Math.hypot(point[0] - from[0] - t * x, point[1] - from[1] - t * z);
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
      fitsRadius = BRIDGE_SEAT_RADIUS + 0.12,
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
    const samples = [],
      lateral = ([x, z]) => z * Math.cos(axis) - x * Math.sin(axis),
      seatOutline = Array.from({ length: 12 }, (_, j) => polar(fitsRadius, j * TAU / 12)),
      canPlace = (p) => {
        const offset = Math.abs(lateral(p));
        return offset >= corridor / 2 + fitsRadius && offset <= 8.5 && inFloor(p) &&
          !doorPoints.some((door) => distance(door, p) < 1.78) &&
          seatOutline.every(([x, z]) => inFloor([p[0] + x, p[1] + z])) &&
          !walking.some(([a, b]) => bridgeSeatDistance(p, a, b) < BRIDGE_SEAT_RADIUS + 0.57);
      };
    for (const q of floor) {
      const low = Math.max(r, q.r) + fitsRadius, high = Math.min(R, q.R) - fitsRadius;
      for (let radius = low + 0.1; radius <= high + 1e-6; radius += 0.56) {
        const step = 0.55 / radius, count = Math.ceil((q.end - q.start) / step);
        for (let k = 0; k < count; k++) {
          const angle = q.start + (q.end - q.start) * (k + 0.5) / count,
            p = polar(radius, angle), offset = lateral(p);
          if (!canPlace(p)) continue;
          // Avoid a straight row. The small seeded offsets in the ranking
          // vary where pods sit around the existing shoulders.
          samples.push({ p, side: Math.sign(offset), priority: rng() - Math.abs(offset) * 0.042 });
        }
      }
    }
    const occupied = lounges.filter((lounge) => lounge.f === f).flatMap((lounge) => lounge.seats),
      roomFor = (p) => occupied.every((seat) => distance(seat.p, p) >= 2.45 && clears(p, seat.route, 0.50)),
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
    const clears = (pin, route, margin) => route.slice(1).every((point, i) =>
      bridgeSeatDistance(pin, route[i], point) >= BRIDGE_SEAT_RADIUS + margin);
    // Fit inward-facing groups first, starting with a five-seat circle. An
    // opening between the end seats is aimed toward a public approach.
    const courtSizes = [
      { count: 5, opening: 92, radii: [2.25, 2.40, 2.55] },
      { count: 4, opening: 108, radii: [1.99, 2.15, 2.34] },
      { count: 3, opening: 120, radii: [1.55, 1.73, 1.93] },
      { count: 2, opening: 180, radii: [1.48, 1.64, 1.84] }
    ];
    const courts = [...samples].sort((a, b) => b.priority - a.priority);
    while (courts.length) {
      const court = findCourt();
      if (!court) break;
      court.seats = court.seats.map(decorate);
      lounges.push({ f, axis, passage: corridor, ...court });
      occupied.push(...court.seats);
      // A second group needs its own clear middle rather than sharing a
      // seat opening or overlapping the first conversation circle.
      for (let j = courts.length - 1; j >= 0; j--)
        if (distance(courts[j].p, court.court) < court.radius + 2.45) courts.splice(j, 1);
    }

    function findCourt() {
      for (const { count, opening, radii } of courtSizes) for (const { p } of courts) {
        const entries = nearby(p, 6.3).filter((a) => clearLine(a, p) &&
          occupied.every((seat) => clears(seat.p, [a, p], 0.56)));
        if (!entries.length) continue;
        for (const radius of radii) for (const anchor of entries.slice(0, 3)) {
          const face = Math.atan2(anchor[1] - p[1], anchor[0] - p[0]), gap = opening * Math.PI / 180;
          for (const turn of [0, 0.21, -0.21, 0.42, -0.42]) {
            const seats = [];
            for (let j = 0; j < count; j++) {
              const a = face + turn + gap / 2 + (TAU - gap) * j / (count - 1),
                pin = [p[0] + radius * Math.cos(a), p[1] + radius * Math.sin(a)];
              if (!canPlace(pin) || !roomFor(pin) || !clears(pin, [anchor, p], 0.58)) break;
              seats.push({ p: pin, heading: mod(a + Math.PI, TAU) });
            }
            if (seats.length !== count) continue;
            for (const seat of seats) {
              const entry = [seat.p[0] + 1.31 * Math.cos(seat.heading), seat.p[1] + 1.31 * Math.sin(seat.heading)];
              if (!clearLine(p, entry) || seats.some((other) => other !== seat && !clears(other.p, [p, entry], 0.42)) ||
                  occupied.some((other) => !clears(other.p, [p, entry], 0.42))) break;
              seat.route = [anchor, p, entry];
            }
            if (seats.every((seat) => seat.route)) return { court: p, seats, radius };
          }
        }
      }
      return null;
    }
    // Approach the open face directly or walk around its side. This lets
    // the capsules turn away from the bridge while keeping access to the seat.
    function seatApproach(p, heading, sources) {
      const rim = (angle) => [p[0] + 1.31 * Math.cos(angle), p[1] + 1.31 * Math.sin(angle)],
        entry = rim(heading),
        usable = (route) => clears(p, route, 0.09) &&
          occupied.every((seat) => clears(seat.p, route, 0.42)) &&
          route.slice(1).every((point, i) => clearLine(route[i], point));
      if (!inFloor(entry)) return null;
      for (const anchor of sources) if (usable([anchor, entry])) return [anchor, entry];
      for (const sign of [-1, 1]) {
        const rimPath = [entry];
        for (let k = 1; k <= 4; k++) {
          const point = rim(heading + sign * k * Math.PI / 6);
          if (!inFloor(point)) break;
          rimPath.unshift(point);
          for (const anchor of sources) {
            const route = [anchor, ...rimPath];
            if (usable(route)) return route;
          }
        }
      }
      return null;
    }
    // Smaller shoulders can keep scattered places to pause, including when
    // a separate pocket on the same level has already formed a circle.
    const seats = [];
    let side = rng() < 0.5 ? -1 : 1;
    while (seats.length < 4 && samples.length) {
      samples.sort((a, b) => b.priority - a.priority + 0.36 * ((b.side === side) - (a.side === side)));
      const { p, side: atSide } = samples.shift();
      if (!roomFor(p)) continue;
      const sources = nearby(p, 5.2);
      const clock = rng() * TAU;
      let placement;
      for (let step = 0; step < 12 && !placement; step++) {
        const heading = mod(clock + step * TAU / 12, TAU), route = seatApproach(p, heading, sources);
        if (route) placement = decorate({ p, heading, route });
      }
      if (!placement) continue;
      seats.push(placement);
      occupied.push(placement);
      side = -atSide;
    }
    if (seats.length >= 2) lounges.push({ f, axis, passage: corridor, seats });
  }
  return lounges;
}

function drawBridgeLounge(mesh, lounge, base) {
  const { quad, box, line, tri } = mesh,
    palette = ['#6e9290', '#957e9e', '#a58160', '#73897a'],
    walnut = rgb('#927058'), plinth = rgb('#526963');
  if (lounge.court) {
    // A small woven center picks up the violet of the shared programme lobby.
    mesh.mark(`Circulation_L${lounge.f + 1}_Bridge_Seating_Rug`, 'Conversation circle rug');
    const [x, z] = lounge.court, center = [x, base + 0.012, z],
      radius = Math.min(1.12, lounge.radius - 0.62),
      point = (r, angle) => [x + r * Math.cos(angle), center[1], z + r * Math.sin(angle)],
      woven = rgb('#aca0af'), border = rgb('#8e7e92');
    for (let j = 0; j < 32; j++) {
      const a = j * TAU / 32, b = (j + 1) * TAU / 32;
      tri(center, point(radius - 0.10, b), point(radius - 0.10, a), woven);
      quad(point(radius - 0.10, a), point(radius - 0.10, b), point(radius, b), point(radius, a), border);
    }
  }
  mesh.mark(`Circulation_L${lounge.f + 1}_Bridge_Seating`, 'Bridge seating capsules');
  for (const seat of lounge.seats) {
    const { p, heading, fabric, tableSide } = seat,
      shell = rgb(palette[fabric]), inner = materialTint(shell, 1.17), welt = materialTint(shell, 0.72),
      sin = Math.sin(heading), cos = Math.cos(heading);
    // Local z points toward the opening. The half-shell follows the back of
    // the seat, then curves inward overhead to form the capsule silhouette.
    const at = (x, z, y) => [p[0] - x * sin + z * cos, base + y, p[1] + x * cos + z * sin],
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
    box(x, y, z, 0.64, 0.14, 0.47, heading, plinth);
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
    box(tx, ty, tz, 0.045, 0.365, 0.06, heading, plinth);
    const bracket = at(tableX, 0.015, 0.66);
    box(...bracket, 0.052, 0.05, 0.52, heading, plinth);
    for (let k = 0; k < 14; k++) {
      const a = k * TAU / 14, b = (k + 1) * TAU / 14;
      tri(at(tableX, tableZ, 0.75), point(a, 0.75), point(b, 0.75), walnut);
      tri(at(tableX, tableZ, 0.71), point(b, 0.71), point(a, 0.71), walnut);
      quad(point(a, 0.71), point(b, 0.71), point(b, 0.75), point(a, 0.75), walnut);
    }
  }
}
