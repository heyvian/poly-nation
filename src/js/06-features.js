"use strict";
/**
 * 06-features.js — signature features: climbing wall, swing-ride tower, water slide, roof deck and the
 * reconfiguration of the core where the slide lands.
 */
// Smallest absolute difference between two angles (radians, 0 to PI).
function angDist(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}
// Outdoor climbing wall opposite the entrance: its angle/width/height and the module slots it blocks.
function designClimbing(R, slotN, lobby) {
  if (!state.climbWidth) return null;
  const angle = mod(lobby.angle + Math.PI, TAU),
    face = R + 0.3,
    width = Math.min(state.climbWidth, face * Math.PI * 0.6),
    half = width / (2 * face),
    blocked = new Set(),
    pad = Math.atan((MODULE.width / 2 + 1) / (R + 0.65));
  const height = Math.min(19.8, state.floors * 4.2);
  for (let f = 0; f < state.floors && f * 4.2 < height; f++)
    for (let j = 0; j < slotN; j++)
      if (angDist((j * TAU) / slotN, angle) <= half + pad) blocked.add(f * slotN + j);
  return { angle, width, half, face, height, clearance: 5, blocked };
}
// Defines the central swing-ride tower and the water slide.
// The slide search tries pairs of Infinite Rinse facade rooms (upper start, lower landing) in both directions and
// keeps the route with a good gradient and length close to the requested one that avoids the lobby and climbing wall.
// Returns { ride, slide, climbing, blocked } where `blocked` lists dock slots the slide tube would hit.
function designRideAndSlide(layout, R, r, slotN, lobby) {
  const floorH = 4.2,
    platformRadius = Math.min(8.2, r * 0.64),
    towerRadius = Math.min(2.2, platformRadius * 0.37);
  const ride = {
    towerRadius,
    platformRadius,
    glassInnerRadius: platformRadius,
    height: 117,
    roofLevel: state.floors * floorH + 0.18,
    flightRadius: 15,
    speedKmh: 60,
    rpm: (60 / 3.6 / (TAU * 15)) * 60,
  };
  const climbing = designClimbing(R, slotN, lobby),
    none = () => ({ ride, slide: null, climbing, blocked: new Set() });
  if (!state.slideLength || state.floors < 2) return none();
  const outer = layout.rooms.filter(
    (q) =>
      q.id === 0 &&
      q.band === layout.bandN - 1 &&
      (q.end - q.start) * R >= 5.2 &&
      q.R - q.r >= 2.4 &&
      detourRoomArea(q, R, layout.circulation) >= state.minRoomArea - 1e-7,
  );
  const desired = 20 + state.slideLength * 1.45,
    radius = R + Math.min(5.5, Math.max(3.5, R * 0.18)),
    tubeRadius = 1.15;
  // Pad the angular crossing by the tube radius, plus a smooth 6 m transition at either side.
  const expanded = climbing ? climbing.half + (tubeRadius + 0.5) / climbing.face : 0,
    shoulder = 6 / R;
  const bulge = (angle, base) => {
    if (!climbing) return base;
    const d = angDist(angle, climbing.angle),
      t = clamp((d - expanded) / shoulder, 0, 1),
      w = 1 - t * t * (3 - 2 * t),
      target = climbing.face + climbing.clearance + tubeRadius + 0.18;
    return Math.max(base, base + w * Math.max(0, target - base));
  };
  let best = null;
  // Prefer a launch in a large upper Rinse cluster, then match a lower Rinse facade room and desired travel length.
  const rooms = outer.map((room) => ({
    ...room,
    angle: (room.start + room.end) / 2,
    cluster: outer.reduce(
      (a, q) =>
        a +
        (Math.abs(q.f - room.f) <= 1 && angDist((q.start + q.end) / 2, (room.start + room.end) / 2) < 0.48
          ? q.area
          : 0),
      0,
    ),
  }));
  for (const a of rooms)
    for (const b of rooms) {
      if (a.f <= b.f) continue;
      if (climbing && [a, b].some((q) => angDist(q.angle, climbing.angle) < expanded + shoulder)) continue;
      const topY = a.f * floorH + 2.85,
        bottomY = b.f * floorH + 1.72,
        drop = topY - bottomY;
      for (const dir of [-1, 1]) {
        const arc = dir * mod(dir * (b.angle - a.angle), TAU);
        const length = Math.abs(arc) * radius;
        if (length < 7 || Math.abs(arc) > TAU * 0.92) continue;
        const approx = length + radius - R,
          grade = drop / approx;
        if (grade < 0.055 || grade > 0.32) continue;
        if (
          lobby.area &&
          Array.from({ length: 65 }, (_, i) => i / 64).some(
            (t) =>
              topY - drop * t < lobby.levels * floorH + 1.8 &&
              angDist(a.angle + arc * t, lobby.angle) < lobby.span / 2 + 0.1,
          )
        )
          continue;
        const score =
          (Math.abs(approx - desired) / Math.max(20, desired)) * 2.6 +
          Math.abs(grade - 0.15) * 3 -
          0.45 * Math.min(1, a.cluster / 850) -
          (0.18 * a.f) / Math.max(1, state.floors - 1);
        if (!best || score < best.score) best = { a, b, arc, topY, bottomY, drop, score };
      }
    }
  if (!best) return none();
  const { a, b, arc, topY, bottomY, drop } = best;
  // Continuous sloped centreline: exit and entry at the facade, curving out over the dock band.
  const n = Math.max(40, Math.ceil((Math.abs(arc) * (radius + 3) + 12) / 0.35)),
    points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      angle = a.angle + arc * t,
      inside = R - Math.min(OUTER_WALL_THICKNESS, (R - r) * 0.45) - 0.3,
      base = inside + (radius - inside) * Math.min(1, Math.sin(Math.PI * t) * 4),
      rad = bulge(angle, base);
    points.push([rad * Math.cos(angle), 0, rad * Math.sin(angle)]);
  }
  let run = 0;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
    distances.push(run);
  }
  points.forEach((p, i) => (p[1] = topY - (drop * distances[i]) / run));
  const blocked = new Set();
  for (let f = 0; f < state.floors; f++)
    for (let j = 0; j < slotN; j++) {
      const angle = (j * TAU) / slotN,
        c = Math.cos(angle),
        s = Math.sin(angle),
        y = f * floorH + 0.43;
      // Expanded dock box, including clearance for rails and frames. Sample interval below one meter.
      if (
        points.some((p) => {
          const rad = p[0] * c + p[2] * s,
            tan = -p[0] * s + p[2] * c,
            pad = tubeRadius + 0.65;
          return (
            rad >= R - 0.15 - pad &&
            rad <= R + 0.65 + MODULE.depth + pad &&
            Math.abs(tan) <= MODULE.width / 2 + pad &&
            p[1] >= y - 0.25 - pad &&
            p[1] <= y + MODULE.height + pad
          );
        })
      )
        blocked.add(f * slotN + j);
    }
  const slide = {
    startFloor: a.f,
    endFloor: b.f,
    startAngle: a.angle,
    endAngle: b.angle,
    arc,
    radius,
    tubeRadius,
    topY,
    bottomY,
    run: Math.hypot(run, drop),
    horizontalRun: run,
    drop,
    grade: drop / run,
    points,
  };
  if (climbing) {
    const crossing = points.filter((p) => angDist(Math.atan2(p[2], p[0]), climbing.angle) <= expanded);
    slide.climbCrossing = crossing.length > 0;
    slide.climbClearance = crossing.length
      ? Math.min(...crossing.map((p) => Math.hypot(p[0], p[2]) - climbing.face - tubeRadius))
      : null;
  }
  return { ride, slide, climbing, blocked };
}

// Roof deck: lift/bridge housings (service area), public park patches and small retail pavilions, within a size budget.
function designRoof(R, r, circulation) {
  const y = state.floors * 4.2 + 0.48,
    w = R - r,
    walk = Math.min(2.4, w * 0.33),
    outer = R - walk - 0.35,
    inner = r + Math.min(1.3, w * 0.14);
  const lifts = circulation.regions
    .filter((q) => q.kind === "elevator" && q.f === state.floors - 1)
    .map((q) => ({ ...q, y, accessHeight: 3.0, serviceHeight: 1.8, area: q.area }));
  const serviceArea = 2 * lifts.reduce((a, q) => a + q.area, 0),
    rng = random(state.seed ^ 0x88762ab),
    pavilions = [],
    garden = [];
  // Use bounded annular patches. Keep the continuous outer walk and lift/bridge approaches clear.
  const free = openArcs([
    [circulation.axis, circulation.half + 0.19],
    [circulation.axis + Math.PI, circulation.half + 0.19],
  ]);
  if (outer - inner > 1.15) {
    const scale = (outer * outer - inner * inner) / 2;
    const segments = [];
    for (const [a, b] of free) {
      const n = Math.max(1, Math.floor(((b - a) * (inner + outer)) / 2 / 13));
      for (let j = 0; j < n; j++) {
        const start = a + ((b - a) * j) / n,
          end = a + ((b - a) * (j + 1)) / n;
        if ((end - start) * scale > 12) segments.push({ start, end });
      }
    }
    const ordered = segments.map((q) => ({ ...q, key: rng() })).sort((a, b) => a.key - b.key),
      desired = Math.min(5, 3 + Math.floor(rng() * 3));
    const budget = Math.min(240, state.areaCap * 0.012, Math.PI * (R * R - r * r) * 0.11);
    for (const q of ordered) {
      if (pavilions.length >= desired) break;
      const area = Math.min((budget / desired) * (0.78 + 0.35 * rng()), (q.end - q.start) * scale * 0.5);
      if (area < 11) continue;
      const mid = (q.start + q.end) / 2,
        span = area / scale;
      pavilions.push({ r: inner, R: outer, start: mid - span / 2, end: mid + span / 2, area });
    }
    for (const q of segments) {
      if (pavilions.some((p) => p.start < q.end && p.end > q.start)) continue;
      const mid = (q.start + q.end) / 2,
        half = Math.min((q.end - q.start) * 0.25, 3.8 / ((inner + outer) / 2));
      if (half > 0.025)
        garden.push({
          r: inner + 0.12,
          R: outer - 0.12,
          start: mid - half,
          end: mid + half,
          kind: rng() < 0.22 ? "gazebo" : "garden",
        });
    }
  }
  const retailArea = pavilions.reduce((a, q) => a + q.area, 0),
    liftFootprint = serviceArea / 2,
    area = serviceArea + retailArea;
  return {
    y,
    walk,
    lifts,
    pavilions,
    garden,
    retailArea,
    serviceArea,
    area,
    publicArea: Math.max(0, Math.PI * (R * R - r * r) - liftFootprint - retailArea),
  };
}
// Reconfigure the outer corridor at each slide landing. The original room's angular
// extent becomes a facade room with an inner bypass and two radial returns. No overlapping floor area.
function connectSlide(layout, feature, R, slotN) {
  const s = feature.slide;
  if (!s) return;
  const c = layout.circulation,
    endpoints = [
      { f: s.startFloor, a: s.startAngle },
      { f: s.endFloor, a: s.endAngle },
    ],
    clearance = new Set(feature.blocked),
    halfCell = TAU / (slotN * 2);
  s.connections = [];
  s.facadeDetours = [];
  s.clearanceBlockedSlots = [...clearance];
  function moveRoom(q, landing = false) {
    const a = q.start,
      b = q.end,
      depth = q.R - q.r,
      old = q.area,
      center = (a + b) / 2,
      w = Math.min(c.width, depth * 0.45),
      side = Math.min(c.width / Math.max(1, q.R), (b - a) * 0.21),
      start = a + side,
      end = b - side;
    const region = c.regions.find(
      (x) => x.f === q.f && x.kind === "outer" && x.start <= a + 1e-7 && x.end >= b - 1e-7,
    );
    if (!region || detourRoomArea(q, R, c) < state.minRoomArea - 1e-7) return false;
    const i = c.regions.indexOf(region),
      replacement = [];
    const add = (kind, r, rad, lo, hi) => {
      if (hi - lo > 1e-9 && rad - r > 1e-9)
        replacement.push({
          f: q.f,
          kind,
          r,
          R: rad,
          start: lo,
          end: hi,
          area: ((rad * rad - r * r) * (hi - lo)) / 2,
        });
    };
    add("outer", region.r, region.R, region.start, a);
    add("outer", region.r, region.R, b, region.end);
    add("slide_return", q.r, R, a, start);
    add("slide_return", q.r, R, end, b);
    add("slide_bypass", q.r, q.r + w, start, end);
    c.regions.splice(i, 1, ...replacement);
    q.r += w;
    q.R = R;
    q.start = start;
    q.end = end;
    q.area = ((R * R - q.r * q.r) * (end - start)) / 2;
    q.facadeFacing = true;
    q.slideLanding = landing;
    q.slideDetour = !landing;
    q.slideDoorRadius = q.r;
    c.doors = c.doors.filter(
      (d) => !(d.f === q.f && d.program === q.id && d.kind === "corridor" && angDist(d.angle, center) < 1e-6),
    );
    c.doors.push({
      f: q.f,
      program: q.id,
      angle: center,
      r: q.r,
      width: Math.min(1.2, (end - start) * q.r * 0.6),
      kind: "corridor",
    });
    // The new room front cannot serve a dock. Reserve every overlapping docking threshold
    // (but do not cascade the next detour selection from these additional frontage reservations).
    const pad = Math.atan((MODULE.width / 2 + 0.5) / R);
    for (let j = 0; j < slotN; j++) {
      const angle = (j * TAU) / slotN;
      if (mod(angle - start + pad, TAU) < end - start + 2 * pad) feature.blocked.add(q.f * slotN + j);
    }
    const info = {
      floor: q.f,
      program: P[q.id].id,
      angle: center,
      roomArea: q.area,
      previousRoomArea: old,
      bypassWidth: w,
      roomStart: q.start,
      roomEnd: q.end,
      roomInner: q.r,
      roomOuter: q.R,
    };
    (landing ? s.connections : s.facadeDetours).push(info);
    return true;
  }
  for (const e of endpoints) {
    const q = layout.rooms.find(
      (q) =>
        q.id === 0 &&
        q.f === e.f &&
        q.band === layout.bandN - 1 &&
        angDist((q.start + q.end) / 2, e.a) < 1e-6,
    );
    if (!q || !moveRoom(q, true)) throw Error("Slide landing missing");
  }
  // Slide clearance is a spatial opportunity, even where the ride does not enter the core.
  // Reposition each *eligible* outer room that substantially overlaps a physical blocked bay.
  // Do not overwrite the lobby, lift links, shared hubs, or the direct Rinse endpoints.
  const byFloor = Array.from({ length: state.floors }, () => []);
  for (const idx of clearance) byFloor[Math.floor(idx / slotN)].push(((idx % slotN) * TAU) / slotN);
  for (const q of layout.rooms) {
    if (
      q.facadeFacing ||
      q.band !== layout.bandN - 1 ||
      q.id >= P.length ||
      q.R - q.r < 2.2 ||
      (q.end - q.start) * R < 3.6
    )
      continue;
    const mid = (q.start + q.end) / 2,
      half = (q.end - q.start) / 2;
    if (
      !byFloor[q.f].some((a) => {
        const d = angDist(a, mid),
          overlap = Math.min(2 * half, 2 * halfCell, half + halfCell - d);
        return overlap >= 0.3 * Math.min(2 * half, 2 * halfCell);
      })
    )
      continue;
    moveRoom(q, false);
  }
  c.area = c.regions.reduce((a, q) => a + q.area, 0);
  c.corridorArea = c.area - c.elevatorArea;
  c.total = c.area + c.hubArea;
}

