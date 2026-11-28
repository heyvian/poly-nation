'use strict';

// Compact response craft study envelope drawn from the user's 1:200 firehall plan.
// Draft and operating clearances are schematic allowances.
const SITE_FIREBOAT = Object.freeze({ length: 11.6, beam: 3.6, draft: 1.1, airDraft: 3.5 });
const SITE_MIN_FIREBOAT_DEPTH = Number((SITE_FIREBOAT.draft + 0.55).toFixed(2));
const SITE_BOAT_SLIP = 5.25;
const SITE_BOAT_QUAY = 1.65;
const SITE_BOAT_FLOOR = 0.68;
const SITE_FIREHALL_LINK_WIDTH = 2.45;
const SITE_FIREHALL_LINK_LIMIT = 95;

function siteFirehallReserve(capacity) {
  return (capacity * (SITE_BOAT_SLIP + SITE_BOAT_QUAY) + SITE_BOAT_QUAY) * 26 +
    SITE_FIREHALL_LINK_LIMIT * SITE_FIREHALL_LINK_WIDTH;
}

function siteFirehallLinkLevels(bay, floor) {
  let station = 0;
  const { path, length } = bay.connection;
  const points = [[path[0][0], floor, path[0][1]]];
  const height = (at) => floor + (bay.serviceFloor - floor) * clamp((at - 1.5) / (length - 3), 0, 1);
  for (let i = 1; i < path.length; i++) {
    const [x, z] = path[i], [fromX, fromZ] = path[i - 1], span = Math.hypot(x - fromX, z - fromZ);
    for (const levelAt of [1.5, length - 1.5]) if (levelAt > station && levelAt < station + span) {
      const t = (levelAt - station) / span;
      points.push([fromX + t * (x - fromX), height(levelAt), fromZ + t * (z - fromZ)]);
    }
    station += span;
    points.push([x, height(station), z]);
  }
  return points;
}

function siteFirehallPortals(model, position, bearing, water) {
  const pitch = TAU / model.slotN, reach = model.R + BUILD_SECTION.dockGap + MODULE.depth + 3,
    width = SITE_FIREHALL_LINK_WIDTH, portals = [],
    dryDocks = model.slots.filter(slot => slot.f === 0 && !slot.blocked).map(slot => slot.angle);
  for (let slot = 0; slot < model.slotN; slot++) {
    if (model.blocked.has(slot)) continue;
    const angle = slot * pitch, radius = coreBoundaryRadius(model, model.R, angle),
      at = siteLine(position, angle + bearing);
    if (siteDryWalk(water, position, angle + bearing, radius - 1.15, reach, width + 0.25)) {
      const crewDistance = dryDocks.map(heading => angDist(heading, angle) * radius).sort((a, b) => a - b).slice(1, 5);
      portals.push({ slot, angle, start: at(radius - 0.27), outer: at(reach),
        accessScore: (crewDistance.reduce((sum, span) => sum + span, 0) + (4 - crewDistance.length) * radius * Math.PI) / 4 });
    }
  }
  return portals;
}

// A service spoke uses a reserved bay, then turns toward a door in the workshop.
// The turn stays beyond the modules and both ends of the route stay on the dry bank.
function siteFirehallConnection(bay, portals, position, terrain, water, floor, radius, crane, bearing, context) {
  const width = SITE_FIREHALL_LINK_WIDTH, hallStation = (bay.serviceBack + bay.quayBack) / 2,
    distance = (a, b) => Math.hypot(...sub(a, b)), reach = (p) => distance(position, p),
    poles = crane?.runway === 'elevated' ? elevatedRunwaySupports(crane).flatMap(angle =>
      [-1, 1].map(side => siteLine(position, angle + bearing)(crane.tower + side * crane.groundGauge / 2))) : [],
    moat = craneMoatBounds(crane),
    linkSegments = (path) => path.slice(1).map((point, i) => [path[i], point]);
  function sample(a, b, predicate) {
    const span = distance(a, b), steps = Math.max(1, Math.ceil(span / 0.7));
    return Array.from({ length: steps + 1 }, (_, i) => i / steps).every(t =>
      predicate(a.map((value, i) => value + (b[i] - value) * t)));
  }
  let best = null;
  for (const side of [-1, 1]) {
    const door = bay.point(hallStation, side * (bay.halfWidth - 0.19)),
      landing = bay.point(hallStation, side * (bay.halfWidth + 2.3));
    for (const { slot, angle, start, outer, accessScore } of portals) {
      const off = sub(outer, landing), normal = sub(landing, door);
      if (off[0] * normal[0] + off[1] * normal[1] < -0.5 * Math.hypot(...off) * Math.hypot(...normal)) continue;
      const path = [start, outer, landing, door], segments = linkSegments(path),
        length = segments.reduce((sum, [a, b]) => sum + distance(a, b), 0);
      const cost = length + 0.45 * accessScore;
      if (length > SITE_FIREHALL_LINK_LIMIT || cost >= (best?.cost ?? Infinity) || Math.abs(floor - bay.serviceFloor) > (length - 3) * 0.05) continue;
      if (!sample(outer, landing, p => reach(p) >= radius - 1.4)) continue;
      if (!segments.every(([a, b]) => {
        const span = distance(a, b), dx = b[0] - a[0], dz = b[1] - a[1];
        if (span < 0.25) return false;
        const off = [-dz * width / (2 * span), dx * width / (2 * span)],
          corners = [a.map((v, i) => v + off[i]), b.map((v, i) => v + off[i]),
            b.map((v, i) => v - off[i]), a.map((v, i) => v - off[i])];
        if (water.overlapsFootprint(corners) || context?.(corners, Math.min(floor, bay.serviceFloor) - 0.22,
          Math.max(floor, bay.serviceFloor) + 2.52)) return false;
        return sample(a, b, p => siteTerrainHeight(terrain, ...p) < Math.min(floor, bay.serviceFloor) + 0.28 &&
          !poles.some(pole => distance(p, pole) < width / 2 + 0.66) &&
          !(moat && reach(p) >= moat.inner - width / 2 && reach(p) <= moat.outer + width / 2));
      })) continue;
      best = { slot, angle, side, station: hallStation, path, width, length, area: length * width, cost };
    }
  }
  return best;
}

function siteBoatBankSamples(triangles, position, reach) {
  const edges = new Map(), coord = ([x, z]) => `${x.toFixed(4)}/${z.toFixed(4)}`;
  for (const triangle of triangles) for (let i = 0; i < 3; i++) {
    const a = triangle[i], b = triangle[(i + 1) % 3], inside = triangle[(i + 2) % 3],
      key = [coord(a), coord(b)].sort().join(':');
    if (edges.has(key)) edges.delete(key);
    else edges.set(key, { a, b, inside });
  }
  const samples = [];
  for (const { a, b, inside } of edges.values()) {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(dx, dz);
    if (length < 0.55) continue;
    const count = Math.ceil(length / 5), azimuth = Math.atan2(dz, dx),
      right = dx * (inside[1] - a[1]) - dz * (inside[0] - a[0]) > 0,
      angle = azimuth + (right ? 1 : -1) * Math.PI / 2;
    for (let i = 0; i <= count; i++) {
      const origin = [a[0] + dx * i / count, a[1] + dz * i / count],
        distance = Math.hypot(origin[0] - position[0], origin[1] - position[1]);
      if (distance <= reach) samples.push({ origin, angle, distance });
    }
  }
  return samples.sort((a, b) => a.distance - b.distance);
}

function siteFirehallBoatBay(model, position, surface, terrain, accessAngle, boatCapacity, { floor, context }) {
  if (!surface?.proposed?.length) return null;
  const capacity = Number(boatCapacity) === 6 ? 6 : 3,
    moduleEdge = model.R + BUILD_SECTION.dockGap + MODULE.depth + 3,
    protectedRadius = moduleEdge + 1.5,
    reach = protectedRadius + 120,
    district = siteFoundationWater(surface, position, reach + 50),
    canal = siteFoundationWater({ proposed: surface.proposed }, position, reach + 50),
    pitch = SITE_BOAT_SLIP + SITE_BOAT_QUAY, halfWidth = (capacity * pitch + SITE_BOAT_QUAY) / 2,
    level = surface.level - terrain.datum,
    deck = level + SITE_BOAT_FLOOR, rim = -11, back = rim - SITE_FIREBOAT.length - 3.3,
    quayBack = back - 4.85, serviceBack = quayBack - 6.25, ceiling = level + 5.2,
    entryWidth = 2.45, slipCenters = Array.from({ length: capacity }, (_, i) => (i - (capacity - 1) / 2) * pitch),
    sectionCenter = slipCenters[Math.floor((capacity - 1) / 2)], approaches = model.plaza.arrivals ?? [],
    bearing = accessAngle - model.lobby.angle,
    crewDocks = model.slots.filter(({ f, p, blocked }) => f <= 1 && p === FIREHALL && !blocked)
      .map(({ angle }) => siteLine(position, angle + bearing)(moduleEdge)),
    entryReach = Math.max(model.plaza.outer ?? 0, ...approaches.map(({ end }) => end)) + 3,
    entryHalf = Math.max(5, ...approaches.map(({ width, courtWidth }) => (courtWidth ?? width ?? 0) / 2 + 1));
  district.level = level;
  district.clearance = 2.2;
  const portals = siteFirehallPortals(model, position, bearing, district);
  if (!portals.length) return null;
  let best = null;
  for (const { origin, angle: normal, distance } of siteBoatBankSamples(surface.proposed, position, reach)) {
    if (distance < protectedRadius || distance > (best?.score ?? Infinity)) continue;
    for (const variation of [0, -Math.PI / 15, Math.PI / 15, -Math.PI / 8, Math.PI / 8]) {
      const angle = normal + variation, cos = Math.cos(angle), sin = Math.sin(angle),
        point = (station, offset = 0) => [origin[0] + station * cos - offset * sin, origin[1] + station * sin + offset * cos],
        at = (station) => point(station, sectionCenter),
        localStation = (world) => (world[0] - origin[0]) * cos + (world[1] - origin[1]) * sin,
        localOffset = (world) => (world[1] - origin[1]) * cos - (world[0] - origin[0]) * sin,
        nearest = point(clamp(localStation(position), serviceBack - 2, 7), clamp(localOffset(position), -halfWidth - 1, halfWidth + 1));
      if (Math.hypot(nearest[0] - position[0], nearest[1] - position[1]) <= protectedRadius) continue;
      const crossProbes = [-halfWidth + 0.35, ...slipCenters, halfWidth - 0.35], nearEdges = [];
      for (const offset of crossProbes) {
        const span = canal.spans((along) => point(along, offset), -7, 22)
          .find(([from, to]) => from <= 4.5 && to >= 5.25);
        if (!span || span[1] - span[0] < 2.7) break;
        nearEdges.push(span[0]);
      }
      if (nearEdges.length !== crossProbes.length) continue;
      const end = Math.max(0.55, ...nearEdges.map((edge) => edge + 1.1)),
        testStations = [serviceBack, quayBack], bounds = [serviceBack - entryWidth, end].flatMap((station) =>
          [-halfWidth, halfWidth].map((offset) => point(station, offset))),
        hallPoints = [...bounds, ...crossProbes.flatMap((offset) => [rim, back, ...testStations].map((station) => point(station, offset)))];
      if (hallPoints.some((p) => p.some((coord) => Math.abs(coord) > terrain.size / 2 - 4))) continue;
      if (hallPoints.some(([x, z]) => {
        const dx = x - position[0], dz = z - position[1], along = dx * Math.cos(accessAngle) + dz * Math.sin(accessAngle),
          across = dz * Math.cos(accessAngle) - dx * Math.sin(accessAngle);
        return Math.abs(along) < entryReach && Math.abs(across) < entryHalf;
      })) continue;
      const dryCorners = [point(serviceBack, -halfWidth), point(quayBack, -halfWidth), point(quayBack, halfWidth), point(serviceBack, halfWidth)];
      if (district.overlapsFootprint(dryCorners)) continue;
      const dryGrade = Math.max(...testStations.flatMap((station) => crossProbes.map((offset) => siteTerrainHeight(terrain, ...point(station, offset))))),
        serviceFloor = Math.max(deck, dryGrade + 0.21);
      if (serviceFloor > deck + 1.5) continue;
      const [a, b, c, d] = [point(quayBack, -halfWidth), point(end, -halfWidth), point(end, halfWidth), point(quayBack, halfWidth)],
        [rearX, rearZ] = point(serviceBack),
        separation = Math.min(74, ...crewDocks.map(([x, z]) => Math.hypot(rearX - x, rearZ - z))),
        score = distance + 2 * Math.abs(variation) + 6 * (serviceFloor - deck) + separation * 0.23,
        crewSide = Math.sign(localOffset(position)) || 1;
      if (score >= (best?.score ?? Infinity)) continue;
      const bay = { origin, angle, at, point, back, serviceBack, quayBack, rim, end, halfWidth, level, deck, serviceFloor,
        ceiling, capacity, slipCenters, crewSide, crewOffset: crewSide * (halfWidth - 2.1), berthWidth: SITE_BOAT_SLIP, boat: SITE_FIREBOAT,
        triangles: [[a, b, c], [a, c, d]], area: (rim - serviceBack) * 2 * halfWidth,
        maintenanceArea: (quayBack - serviceBack) * 2 * halfWidth,
        contextReach: Math.max(...bounds.map(([x, z]) => Math.hypot(x - position[0], z - position[1]))) + 8,
        protectedRadius, score };
      const { crane } = model,
        pierConflict = crane?.runway === 'elevated' && elevatedRunwaySupports(crane).some(axis => [-1, 1].some(side => {
          const p = siteLine(position, axis + bearing)(crane.tower + side * crane.groundGauge / 2);
          return localStation(p) > serviceBack - 1 && localStation(p) < rim + 1 && Math.abs(localOffset(p)) < halfWidth + 1;
        })),
        nearer = point(clamp(localStation(position), serviceBack, rim), clamp(localOffset(position), -halfWidth, halfWidth)),
        radialExtent = Math.max(...[serviceBack, rim].flatMap(s => [-halfWidth, halfWidth].map(x =>
          Math.hypot(...sub(point(s, x), position))))),
        crossesElevatedRail = crane?.runway === 'elevated' && radialExtent > crane.tower - crane.groundGauge / 2 - 0.6 &&
          Math.hypot(...sub(nearer, position)) < crane.tower + crane.groundGauge / 2 + 0.6;
      if (pierConflict || crossesElevatedRail || context?.([
          point(serviceBack, -halfWidth), point(rim, -halfWidth), point(rim, halfWidth), point(serviceBack, halfWidth)
        ], deck - 0.3, ceiling + 1.3)) continue;
      const connection = siteFirehallConnection(bay, portals, position, terrain, district, floor, moduleEdge, crane, bearing, context);
      if (connection && score + connection.cost * 1.5 < (best?.score ?? Infinity))
        best = { ...bay, connection, score: score + connection.cost * 1.5 };
    }
  }
  return best;
}

function siteHydrateFirehall(data) {
  if (!data) return null;
  const [x, z] = data.origin, c = Math.cos(data.angle), s = Math.sin(data.angle),
    point = (station, across = 0) => [x + station * c - across * s, z + station * s + across * c],
    sectionCenter = data.slipCenters[Math.floor((data.capacity - 1) / 2)];
  return { ...data, point, at: (station) => point(station, sectionCenter) };
}

function siteBoatCrewAccess(bay, terrain, water, position) {
  const angle = bay.angle + Math.PI, side = bay.crewSide * (bay.halfWidth - 2.1),
    inner = bay.slipCenters[Math.floor((bay.capacity - 1) / 2)],
    nearestClear = (at, end, width) => {
      const [x, z] = at(0), towards = (position[0] - x) * Math.cos(angle) + (position[1] - z) * Math.sin(angle),
        [u, v] = at(clamp(towards, 0, end));
      return Math.hypot(u - position[0], v - position[1]) > bay.protectedRadius + width / 2;
    };
  for (const kind of ['ramp', 'stair']) for (const offset of [side, -side, inner]) {
    const origin = bay.point(bay.serviceBack, offset),
      route = siteApproach(terrain, water, origin, angle, 0, 0, bay.serviceFloor, kind, kind === 'ramp' ? 28 : 12);
    if (!route || !nearestClear(route.at, route.nodes.at(-1)[0], route.width)) continue;
    return { route, crewOffset: offset };
  }
  return null;
}

function drawSiteFirehallBoatHall(mesh, bay, terrain, concrete, steel, paving) {
  if (!bay) return;
  const { back, quayBack, serviceBack, rim, halfWidth, angle, point, level, deck, serviceFloor, ceiling, slipCenters, boat } = bay,
    walls = rgb('#dddbca'), siding = rgb('#a36051'), trim = rgb('#e3c6a0'), roof = rgb('#50615b'), glass = rgb('#9eb7b3'),
    red = rgb('#a7483c'), white = rgb('#eadfca'), dark = rgb('#3c514f'),
    box = (along, across, y, width, height, length, color) => {
      const [x, z] = point(along, across);
      mesh.box(x, y, z, width, height, length, angle, color, true);
    },
    vertex = (along, across, y) => { const [x, z] = point(along, across); return [x, y, z]; },
    longitudinal = (from, to, cross, y, width, height, color) => box((from + to) / 2, cross, y, width, height, to - from, color),
    transverse = (along, from, to, y, length, height, color) => box(along, (from + to) / 2, y, to - from, height, length, color),
    outerQuays = [-halfWidth + SITE_BOAT_QUAY / 2, halfWidth - SITE_BOAT_QUAY / 2],
    fingers = [outerQuays[0], ...slipCenters.slice(1).map((right, i) => (slipCenters[i] + right) / 2), outerQuays[1]],
    frames = [serviceBack + 0.25, quayBack, (back + rim) / 2, rim - 0.16];
  mesh.mark('Site_Firehall_Boat_Garage', 'Enclosed canal fireboat hall and connected launch apron');
  transverse((back + quayBack) / 2, -halfWidth, halfWidth, deck - 0.26, back - quayBack, 0.26, paving);
  for (const cross of fingers) {
    longitudinal(back, rim + 1.35, cross, deck - 0.26, SITE_BOAT_QUAY, 0.26, paving);
    for (const station of [back + 0.9, (back + rim) / 2, rim - 1.2]) {
      box(station, cross - SITE_BOAT_QUAY / 2 + 0.17, deck, 0.18, 0.26, 0.2, steel);
      box(station, cross + SITE_BOAT_QUAY / 2 - 0.17, deck, 0.18, 0.26, 0.2, steel);
    }
  }

  mesh.mark('Site_Firehall_Boat_Foundations', 'Independent landward service foundations and pile-supported wet quays');
  transverse((serviceBack + quayBack) / 2, -halfWidth, halfWidth, serviceFloor - 0.29, quayBack - serviceBack, 0.29, concrete);
  for (const cross of fingers) for (const station of [...frames, back + 1.6]) {
    const [x, z] = point(station, cross), wet = station >= quayBack,
      top = station < quayBack ? serviceFloor - 0.18 : deck - 0.18,
      low = wet ? level - 2.2 : Math.min(top - 0.25, siteTerrainHeight(terrain, x, z) - 0.42);
    box(station, cross, low, 0.47, top - low, 0.47, concrete);
    drawSitePile(mesh, x, z, low, concrete, SITE_PILE_DISPLAY_LENGTH, 0.17);
  }

  mesh.mark('Site_Firehall_Boat_Maintenance', 'Marine workshop, gear storage, washdown and continuous transfer quay');
  const accessWidth = 2.1;
  for (const [from, to] of [[-halfWidth, bay.crewOffset - accessWidth / 2], [bay.crewOffset + accessWidth / 2, halfWidth]])
    transverse(serviceBack + 0.12, from, to, serviceFloor, 0.24, ceiling - serviceFloor, walls);
  transverse(serviceBack + 0.12, bay.crewOffset - accessWidth / 2, bay.crewOffset + accessWidth / 2,
    serviceFloor + 2.45, 0.24, ceiling - serviceFloor - 2.45, walls);
  box(serviceBack + 0.12, bay.crewOffset, serviceFloor, accessWidth, 2.45, 0.16, glass);
  const clearOfDoor = (offset, width) => Math.abs(offset - bay.crewOffset) > (width + accessWidth) / 2 + 0.12;
  for (const offset of slipCenters) {
    if (clearOfDoor(offset, 2.95)) {
      box(serviceBack + 0.86, offset, serviceFloor, 2.85, 0.96, 0.68, steel);
      box(serviceBack + 0.86, offset, serviceFloor + 0.93, 2.95, 0.07, 0.75, trim);
    }
    if (clearOfDoor(offset + 2.03, 0.86)) box(serviceBack + 1.0, offset + 2.03, serviceFloor, 0.86, 2.02, 0.72, siding);
    box(quayBack - 0.37, offset + 1.17, serviceFloor + 0.01, 0.85, 0.06, 0.16, steel);
  }
  const steps = Math.ceil((serviceFloor - deck) / 0.16);
  for (let step = 0; step < steps; step++) {
    const run = (back - quayBack - 1.85) / steps, top = serviceFloor - (serviceFloor - deck) * (step + 1) / steps;
    transverse(quayBack + (step + 0.5) * run, -halfWidth, halfWidth, deck - 0.12, run, top - deck + 0.12, paving);
  }
  const equipmentTrack = Math.min(serviceFloor + 2.95, ceiling - 0.72);
  transverse(quayBack - 0.44, -halfWidth, halfWidth, equipmentTrack, 0.28, 0.32, steel);
  for (const offset of slipCenters) box(quayBack - 0.44, offset, equipmentTrack - 0.30, 0.4, 0.4, 0.5, siding);

  mesh.mark('Site_Firehall_Boat_Structure', 'Portal frames, insulated hall and independent steel door guides');
  for (const side of [-1, 1]) {
    const connection = bay.connection?.side === side ? bay.connection : null,
      cross = side * (halfWidth - 0.13),
      opening = connection && [connection.station - connection.width / 2, connection.station + connection.width / 2],
      bands = [[deck - 0.12, deck + 2.92, 0.26, siding], [deck + 2.92, deck + 3.92, 0.19, glass],
        [deck + 3.92, ceiling, 0.26, siding]];
    for (const [low, high, depth, color] of bands) {
      const runs = opening ? [[serviceBack, opening[0]], [opening[1], rim]] : [[serviceBack, rim]];
      for (const [from, to] of runs) longitudinal(from, to, cross, low, depth, high - low, color);
      const head = serviceFloor + 2.36;
      if (!opening) continue;
      if (head < high) longitudinal(...opening, cross, Math.max(low, head), depth, high - Math.max(low, head), color);
    }
    if (opening) {
      box(connection.station, cross, serviceFloor + 2.23, connection.width, 0.13, 0.30, steel);
      for (const jamb of opening) box(jamb, cross, serviceFloor, 0.09, 2.34, 0.30, steel);
    }
    for (let station = serviceBack + 0.7; station < rim - 0.12; station += 3.4)
      if (!opening || station < opening[0] - 0.1 || station > opening[1] + 0.1)
        box(station, cross, deck + 2.92, 0.32, 1.0, 0.12, steel);
  }
  for (const station of frames) {
    transverse(station, -halfWidth, halfWidth, ceiling - 0.41, 0.35, 0.41, steel);
    for (const cross of fingers) {
      const floor = station < quayBack ? serviceFloor : deck;
      box(station, cross, floor, 0.27, ceiling - floor, 0.28, steel);
    }
  }
  for (const offset of slipCenters) {
    const portalClearance = ceiling - level - 0.78;
    box(rim - 0.16, offset, level + portalClearance, SITE_BOAT_SLIP + 0.24, 0.57, 0.52, roof);
    for (const side of [-1, 1]) box(rim - 0.16, offset + side * (SITE_BOAT_SLIP / 2 + 0.07),
      deck - 0.14, level + portalClearance - deck + 0.19, 0.13, 0.28, steel);
  }
  function roofPanel(lo, hi, y1, y2, color, glazed = false) {
    const rear = serviceBack - 0.28, front = rim + 0.29;
    const bottom = [vertex(rear, lo, y1), vertex(front, lo, y1), vertex(front, hi, y2), vertex(rear, hi, y2)],
      top = bottom.map(([x, y, z]) => [x, y + 0.14, z]);
    if (glazed) {
      mesh.quad(...top, color, mesh.glass, 0.58);
      return;
    }
    mesh.quad(...top, color);
    mesh.quad(...bottom.slice().reverse(), color);
    for (let i = 0; i < 4; i++) mesh.quad(bottom[i], bottom[(i + 1) % 4], top[(i + 1) % 4], top[i], color);
  }
  const ridge = ceiling + 1.15;
  for (const side of [-1, 1]) {
    roofPanel(0, side * 0.85, ridge, ridge - 0.12, glass, true);
    roofPanel(side * 0.85, side * (halfWidth + 0.32), ridge - 0.12, ceiling, roof);
    for (const station of [serviceBack + 0.12, rim - 0.16])
      mesh.tri(vertex(station, 0, ridge), vertex(station, side * halfWidth, ceiling), vertex(station, 0, ceiling), siding);
  }

  mesh.mark('Site_Firehall_Rescue_Boat', 'Compact fire response vessels at the interior berths');
  const center = (back + rim) / 2, hull = [[-0.5, -0.48], [-0.5, 0.48], [0.22, 0.5], [0.41, 0.31], [0.5, 0], [0.41, -0.31], [0.22, -0.5]];
  for (const offset of slipCenters) {
    const hullPoint = ([u, v], y, scale = 1) => vertex(center + u * boat.length * scale, offset + v * boat.beam * scale, y);
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      mesh.quad(hullPoint(a, level - boat.draft + 0.1, 0.74), hullPoint(b, level - boat.draft + 0.1, 0.74),
        hullPoint(b, level + 0.6), hullPoint(a, level + 0.6), red);
      mesh.tri(hullPoint([0, 0], level + 0.6), hullPoint(b, level + 0.6), hullPoint(a, level + 0.6), white);
      const keel = level - boat.draft + 0.1;
      mesh.tri(hullPoint([0, 0], keel, 0.74), hullPoint(a, keel, 0.74), hullPoint(b, keel, 0.74), red);
    }
    box(center + 0.58, offset, level + 0.6, 2.68, 1.43, 3.35, red);
    box(center + 0.63, offset, level + 2.03, 2.72, 0.58, 3.19, glass);
    box(center + 0.53, offset, level + 2.61, 2.80, 0.13, 3.48, white);
    box(center - 0.28, offset, level + 2.72, 0.095, boat.airDraft - 2.72, 0.10, dark);
    box(center + 3.08, offset, level + 0.58, 0.27, 0.51, 0.30, steel);
    box(center + 3.21, offset, level + 1.03, 0.18, 0.15, 0.49, red);
    for (const cross of [-0.72, 0.72]) box(center - 4.17, offset + cross, level + 0.19, 0.52, 0.74, 0.81, dark);
  }
}

function siteFirehallLinkCrossSections(path) {
  const directions = path.slice(1).map(([x, , z], i) => {
    const dx = x - path[i][0], dz = z - path[i][2], distance = Math.hypot(dx, dz);
    return [-dz / distance, dx / distance];
  });
  return path.map((point, i) => {
    const a = directions[Math.max(0, i - 1)], b = directions[Math.min(i, directions.length - 1)],
      scale = 1 / Math.max(0.6, 1 + a[0] * b[0] + a[1] * b[1]);
    return (side, y) => [point[0] + side * (a[0] + b[0]) * scale, point[1] + y,
      point[2] + side * (a[1] + b[1]) * scale];
  });
}

function drawSiteFirehallLink(mesh, bay, floor, terrain, concrete, steel, paving) {
  const path = siteFirehallLinkLevels(bay, floor), half = bay.connection.width / 2,
    cross = siteFirehallLinkCrossSections(path),
    roof = rgb('#50615b'), glass = rgb('#9eb7b3'), siding = rgb('#a36051');
  mesh.mark('Site_Firehall_Boat_Core_Link', 'Enclosed crew gallery from the core to the marine workshop');
  for (let i = 1; i < cross.length; i++) {
    const a = cross[i - 1], b = cross[i];
    for (const [y, color] of [[0, paving], [-0.22, concrete], [2.52, roof], [2.36, roof]])
      mesh.quad(a(-half, y), a(half, y), b(half, y), b(-half, y), color);
    for (const edge of [-half, half]) {
      for (const [low, high, color] of [[-0.22, 0.93, siding], [0.93, 2.13, glass], [2.13, 2.52, roof]])
        mesh.quad(a(edge, low), b(edge, low), b(edge, high), a(edge, high), color);
      const span = Math.hypot(...sub(path[i], path[i - 1])), steps = Math.ceil(span / 3.1);
      for (let j = 0; j < steps; j++) {
        const p = a(edge, 0), q = b(edge, 0), t = j / steps,
          [x, y, z] = p.map((value, axis) => value + (q[axis] - value) * t);
        mesh.box(x, y + 0.93, z, 0.10, 1.2, 0.10, 0, steel);
      }
    }
  }
  mesh.mark('Site_Firehall_Boat_Link_Supports', 'Independent crew gallery supports and pinned connection to the core');
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], steps = Math.ceil(Math.hypot(...sub(b, a)) / 5.4);
    for (let j = i === 1 ? 1 : 0; j < steps; j++) for (const side of [-1, 1]) {
      const p = cross[i - 1](side * (half - 0.35), 0), q = cross[i](side * (half - 0.35), 0),
        [x, y, z] = p.map((value, axis) => value + (q[axis] - value) * j / steps),
        base = Math.min(siteTerrainHeight(terrain, x, z) - 0.24, y - 0.28);
      mesh.box(x, base, z, 0.36, y - base - 0.20, 0.36, 0, concrete);
    }
  }
}
