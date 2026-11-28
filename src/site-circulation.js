'use strict';

// Plan coordinates and widths are in PDF points. Use the same geographic fit as the water.
function siteDistrictVectors(registration, source) {
  const project = (point) => westVillageToGround(point, registration), scale = westVillageScale(registration);
  return {
    triangles: source.triangles.map(([ax, ay, bx, by, cx, cy]) =>
      [[ax, ay], [bx, by], [cx, cy]].map(project)),
    paths: source.paths.map((path) => ({ ...path, width: path.width * scale, points: path.points.map(project) }))
  };
}

function siteDistrictRegion(points) {
  const winding = Math.sign(points.reduce((sum, [x, z], i) => {
    const [u, v] = points[(i + 1) % points.length];
    return sum + x * v - z * u;
  }, 0));
  if (!winding) return null;
  return {
    points,
    minX: Math.min(...points.map(([x]) => x)), maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)), maxZ: Math.max(...points.map(([, z]) => z)),
    planes: points.map(([x, z], i) => {
      const [nextX, nextZ] = points[(i + 1) % points.length],
        nx = winding * (nextZ - z), nz = winding * (x - nextX);
      return { x: nx, y: 0, z: nz, level: nx * x + nz * z };
    })
  };
}

function siteDistrictIndex(regions, step = 32) {
  const bins = new Map();
  const visit = ({ minX, maxX, minZ, maxZ }, callback) => {
    for (let x = Math.floor(minX / step); x <= Math.floor(maxX / step); x++)
      for (let z = Math.floor(minZ / step); z <= Math.floor(maxZ / step); z++)
        callback(x + '/' + z);
  };
  for (const region of regions) visit(region, (key) => {
    if (bins.has(key)) bins.get(key).push(region);
    else bins.set(key, [region]);
  });
  return (bounds) => {
    const matches = new Set();
    visit(bounds, (key) => {
      for (const region of bins.get(key) ?? []) {
        if (region.maxX >= bounds.minX && region.minX <= bounds.maxX &&
            region.maxZ >= bounds.minZ && region.minZ <= bounds.maxZ) matches.add(region);
      }
    });
    return [...matches];
  };
}

function siteDistrictObstacles(registration, terrain, surface) {
  const theatre = westVillagePumphouseVolume(registration, terrain), elevations = theatre.flat().map(p => p[2]),
    base = Math.min(...elevations), roof = Math.max(...elevations),
    context = theatre.filter(face => face.every(p => p[2] === roof)).map(face => ({
      ...siteDistrictRegion(face.map(([x, z]) => [x, z])), bottom: () => base, top: () => roof
    }));
  if (surface) {
    const vectors = siteDistrictVectors(registration, WEST_VILLAGE_CIRCULATION),
      bridges = siteDistrictBridgeCandidates(vectors, terrain, surface, [], null).bridges;
    for (const bridge of bridges) for (const part of bridge.parts) {
      const deckHeight = p => bridge.height(part.station(p));
      context.push({ ...part, bottom: p => part.deck ? deckHeight(p) - bridge.depth : siteTerrainHeight(terrain, p[0], p[2]),
        top: p => deckHeight(p) + (part.deck ? 1.20 : 0.06) });
    }
  }
  const query = siteDistrictIndex(context);
  return (corners, lower = -Infinity, upper = Infinity) => {
    const footprint = siteDistrictRegion(corners);
    if (!footprint) return false;
    const points = corners.map(([x, z]) => [x, 0, z]);
    return query(footprint).some(({ planes, bottom, top }) => {
      const overlap = trimDrawingFace(points, planes);
      return overlap.length >= 3 && Math.min(...overlap.map(bottom)) < upper + 0.10 &&
        Math.max(...overlap.map(top)) > (typeof lower === 'function' ? Math.min(...overlap.map(lower)) : lower) - 0.10;
    });
  };
}

function siteDistrictReservedLand(model, plan, includeModules = true) {
  if (!model || !plan) return [];
  const { position, angle } = plan, [x, z] = position, radius = model.R + 0.35,
    core = Array.from({ length: 36 }, (_, i) => {
      const azimuth = i * TAU / 36;
      return [x + radius * Math.cos(azimuth), z + radius * Math.sin(azimuth)];
    }),
    modules = includeModules ? model.slots.filter((slot) => !slot.f && !slot.blocked && dockInUse(slot) && !plan.omitted?.has(slot.i))
      .map((slot) => siteModuleFootprint(model, slot, position, angle).corners) : [], boat = plan.boatBay,
    hall = boat ? [boat.point(boat.serviceBack, -boat.halfWidth), boat.point(boat.rim, -boat.halfWidth),
      boat.point(boat.rim, boat.halfWidth), boat.point(boat.serviceBack, boat.halfWidth)] : null,
    link = boat?.connection && includeModules ? siteFirehallLinkCrossSections(siteFirehallLinkLevels(boat, plan.floor)) : [],
    half = (boat?.connection?.width ?? 0) / 2,
    galleries = link.slice(1).map((next, i) => [link[i](-half, 0), next(-half, 0), next(half, 0), link[i](half, 0)]
      .map(([x, , z]) => [x, z])),
    runwayPiers = plan.runway?.poles.flatMap((azimuth) => plan.runway.radii.map((radius) => {
      const left = siteLine(position, azimuth, -0.68), right = siteLine(position, azimuth, 0.68);
      return [left(radius - 0.68), left(radius + 0.68), right(radius + 0.68), right(radius - 0.68)];
    })) ?? [];
  return [core, ...modules, ...runwayPiers, ...galleries, ...(hall ? [hall] : [])].map(siteDistrictRegion).filter(Boolean);
}

// Each segment keeps its original bearing. Station variables are actual metres along the traced path.
function siteDistrictRoute(points) {
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], run = Math.hypot(dx, dz);
    if (run < 1e-5) continue;
    const angle = Math.atan2(dz, dx), lengthAtStart = length;
    segments.push({ from: length, to: length + run, angle,
      at: (station, offset = 0) => siteLine(a, angle, offset)(station - lengthAtStart) });
    length += run;
  }
  const locate = (station) => segments.find(({ to }) => station <= to) ?? segments.at(-1);
  return { segments, length, locate, at: (station, offset) => locate(station).at(station, offset) };
}

function siteDistrictWetSpans(route, water) {
  const merged = [];
  for (const part of route.segments) {
    for (const [from, to] of water.spans(part.at, part.from, part.to)) {
      const previous = merged.at(-1);
      if (previous && from <= previous[1] + 1.15) previous[1] = to;
      else merged.push([from, to]);
    }
  }
  return merged;
}

// The fill is continuous at junctions, including where a traced centerline ends.
// Follow the gentlest continuation to obtain a usable length for a graded approach.
function siteDistrictExtendedRoute(path, paths) {
  const visited = new Set([path.id]);
  function tail(first, second) {
    const points = [first];
    let heading = Math.atan2(first[1] - second[1], first[0] - second[0]), run = 0;
    while (run < 105) {
      const current = points.at(-1);
      let best = null, score = Infinity;
      for (const candidate of paths) {
        if (visited.has(candidate.id) || candidate.points.length < 2) continue;
        for (const reversed of [false, true]) {
          const a = candidate.points.at(reversed ? -1 : 0), b = candidate.points.at(reversed ? -2 : 1),
            gap = Math.hypot(a[0] - current[0], a[1] - current[1]),
            turn = angDist(heading, Math.atan2(b[1] - a[1], b[0] - a[0]));
          if (gap > 2 || turn > 1.28 || turn + gap * 0.22 >= score) continue;
          best = { candidate, reversed };
          score = turn + gap * 0.22;
        }
      }
      if (!best) break;
      const { candidate, reversed } = best, next = reversed ? [...candidate.points].reverse() : candidate.points;
      visited.add(candidate.id);
      for (const position of next) {
        const last = points.at(-1), dx = position[0] - last[0], dz = position[1] - last[1],
          step = Math.hypot(dx, dz);
        if (step < 1e-5) continue;
        points.push(position);
        heading = Math.atan2(dz, dx);
        run += step;
        if (run > 105) break;
      }
    }
    return { points: points.slice(1), run };
  }
  const before = tail(path.points[0], path.points[1]), after = tail(path.points.at(-1), path.points.at(-2)),
    route = siteDistrictRoute([...before.points.reverse(), ...path.points, ...after.points]),
    from = before.run, to = route.length - after.run;
  return { route, from, to };
}

function siteDistrictBridgeParts(bridge) {
  const cuts = [bridge.from, bridge.seatFrom, bridge.wetFrom, bridge.wetTo, bridge.seatTo, bridge.to];
  return bridge.route.segments.flatMap((segment) => {
    const start = Math.max(bridge.from, segment.from), finish = Math.min(bridge.to, segment.to);
    if (finish - start < 1e-4) return [];
    const [x, z] = segment.at(start), dx = Math.cos(segment.angle), dz = Math.sin(segment.angle),
      station = ([px, , pz]) => start + (px - x) * dx + (pz - z) * dz,
      split = [start, ...cuts.filter((cut) => cut > start + 1e-5 && cut < finish - 1e-5), finish],
      regions = [];
    for (let i = 1; i < split.length; i++) {
      const a = split[i - 1], b = split[i], half = bridge.width * 0.5 + 0.28,
        outline = siteDistrictRegion([segment.at(a, -half), segment.at(b, -half),
          segment.at(b, half), segment.at(a, half)]);
      if (outline) regions.push({ ...outline, station, deck: a >= bridge.seatFrom - 1e-5 && b <= bridge.seatTo + 1e-5 });
    }
    return regions;
  });
}

function siteDistrictBridgeCandidates(vectors, terrain, surface, reserved, moat) {
  const reach = terrain.size * Math.SQRT1_2,
    proposedWater = { ...surface, garage: [] },
    water = siteFoundationWater(proposedWater, [0, 0], reach),
    orange = siteFoundationWater({ existing: vectors.triangles }, [0, 0], reach),
    elevation = (point) => siteTerrainHeight(terrain, ...point),
    waterLevel = surface.level - terrain.datum,
    occupied = siteDistrictIndex([...reserved, ...(moat?.triangles ?? []).map(siteDistrictRegion).filter(Boolean)]),
    bridges = [], interruptions = [];
  const terrainContains = (point) => point.every((v) => Math.abs(v) < terrain.size / 2 - 0.5);
  for (const path of vectors.paths) {
    if (path.points.length < 2) continue;
    const { route, from: traceFrom, to: traceTo } = siteDistrictExtendedRoute(path, vectors.paths),
      wet = siteDistrictWetSpans(route, water);
    for (const [i, [wetFrom, wetTo]] of wet.entries()) {
      const span = wetTo - wetFrom, center = (wetFrom + wetTo) / 2;
      if (span < 1.1 || wetFrom < 0.25 || wetTo > route.length - 0.25 ||
          center < traceFrom - 0.02 || center > traceTo + 0.02) continue;
      const lower = wet[i - 1]?.[1] ?? 0, upper = wet[i + 1]?.[0] ?? route.length,
        midpoint = route.at(center), bearing = route.locate(center).angle, reach = Math.max(5, path.width * 0.8),
        across = orange.spans(siteLine(midpoint, bearing + Math.PI / 2), -reach, reach)
          .find(([from, to]) => from <= 0 && to >= 0),
        width = across ? Math.min(path.width * 1.5, across[1] - across[0]) : path.width;
      if (bridges.some((bridge) => Math.hypot(midpoint[0] - bridge.midpoint[0], midpoint[1] - bridge.midpoint[1]) <
        Math.max(1.6, width * 0.35) && Math.abs(Math.sin(bridge.bearing - bearing)) < 0.32)) continue;
      const leftLimit = Math.max(lower + 0.1, wetFrom - Math.max(6.5, width * 1.2)),
        rightLimit = Math.min(upper - 0.1, wetTo + Math.max(6.5, width * 1.2));
      const abutment = (edge, direction, limit) => {
        for (let run = 0.42; direction * (edge + direction * run - limit) <= 1e-6; run += 0.24) {
          const station = edge + direction * run,
            probes = [0, -0.37, 0.37].map((offset) => route.at(station, offset * width)),
            dry = probes.map((p) => terrainContains(p) && !water.overlaps(p, 0.20));
          if (dry[0] && (dry[1] || dry[2])) return station;
        }
        return null;
      };
      const seatFrom = abutment(wetFrom, -1, leftLimit), seatTo = abutment(wetTo, 1, rightLimit);
      if (seatFrom == null || seatTo == null) continue;
      const depth = Math.min(1.25, Math.max(0.27, span / 27)),
        soffit = waterLevel + (span > 45 ? 1.65 : 0.82),
        target = soffit + depth,
        desiredA = Math.max(elevation(route.at(seatFrom)) + 0.055, target),
        desiredB = Math.max(elevation(route.at(seatTo)) + 0.055, target),
        minDeck = waterLevel + depth + 0.25;
      const approach = (seat, end, direction, desired) => {
        let station = end, natural = elevation(route.at(end)) + 0.055,
          attainable = natural + Math.abs(seat - end) * 0.05;
        for (let run = 0.5; direction * (seat + direction * run - end) < 0; run += 0.5) {
          const at = seat + direction * run, height = elevation(route.at(at)) + 0.055, canMeet = height + run * 0.05;
          if (canMeet >= desired) return { station: at, height, available: canMeet };
          if (canMeet > attainable) [station, natural, attainable] = [at, height, canMeet];
        }
        return { station, height: natural, available: attainable };
      };
      const a = approach(seatFrom, Math.max(lower + 0.12, seatFrom - 110), -1, desiredA),
        b = approach(seatTo, Math.min(upper - 0.12, seatTo + 110), 1, desiredB),
        from = a.station, to = b.station, pitch = (seatTo - seatFrom) * 0.05;
      let endA = Math.max(minDeck, Math.min(desiredA, a.available)), endB = Math.max(minDeck, Math.min(desiredB, b.available));
      endA = Math.max(endA, endB - pitch);
      endB = Math.max(endB, endA - pitch);
      const bridge = {
          id: path.id + '-' + (i + 1), kind: path.kind, route, midpoint, bearing, from, to, width,
          seatFrom, seatTo, wetFrom, wetTo, depth, level: (endA + endB) / 2, waterLevel,
          grade: Math.max(Math.abs(endA - a.height) / Math.max(0.01, seatFrom - from),
            Math.abs(endB - b.height) / Math.max(0.01, to - seatTo), Math.abs(endB - endA) / (seatTo - seatFrom)),
          at: (station) => route.at(station),
          height(station) {
            if (station < seatFrom) return a.height + (endA - a.height) * (station - from) / Math.max(0.01, seatFrom - from);
            if (station > seatTo) return endB + (b.height - endB) * (station - seatTo) / Math.max(0.01, to - seatTo);
            return endA + (endB - endA) * (station - seatFrom) / (seatTo - seatFrom);
          }
        };
      bridge.parts = siteDistrictBridgeParts(bridge);
      if (bridge.parts.some(({ deck, ...part }) => {
        if (!deck) return false;
        const points = part.points.map(([x, z]) => [x, 0, z]);
        return occupied(part).some(({ planes }) => trimDrawingFace(points, planes).length >= 3);
      })) {
        interruptions.push(bridge.id);
        continue;
      }
      bridges.push(bridge);
    }
  }
  return { bridges, interruptions };
}

function siteDistrictDrape(polygon, terrain, add) {
  const count = terrain.count - 1, span = terrain.size / count, origin = -terrain.size / 2,
    cell = (p) => clamp(Math.floor((p - origin) / span), 0, count - 1),
    minX = Math.min(...polygon.map(([x]) => x)), maxX = Math.max(...polygon.map(([x]) => x)),
    minZ = Math.min(...polygon.map(([, , z]) => z)), maxZ = Math.max(...polygon.map(([, , z]) => z)),
    divisions = terrain.groundProfile ? Math.ceil(span / 10) : 1;
  const clip = (part, x, z, size) => trimDrawingFace(part, [
    { x: -1, y: 0, z: 0, level: -x }, { x: 1, y: 0, z: 0, level: x + size },
    { x: 0, y: 0, z: -1, level: -z }, { x: 0, y: 0, z: 1, level: z + size }
  ]);
  for (let col = cell(minX); col <= cell(maxX); col++) {
    const x = origin + col * span, column = trimDrawingFace(polygon, [
      { x: -1, y: 0, z: 0, level: -x }, { x: 1, y: 0, z: 0, level: x + span }
    ]);
    if (column.length < 3) continue;
    for (let row = cell(minZ); row <= cell(maxZ); row++) {
      const z = origin + row * span,
        patch = trimDrawingFace(column, [
          { x: 0, y: 0, z: -1, level: -z }, { x: 0, y: 0, z: 1, level: z + span }
        ]);
      if (patch.length < 3) continue;
      for (const side of [-1, 1]) {
        // The shared diagonal is where interpolation changes in the rendered DEM.
        const planar = clipDrawingPolygon(patch, { x: side, y: 0, z: side, level: side * (x + z + span) });
        if (planar.length < 3) continue;
        if (divisions === 1) add(planar);
        else {
          const size = span / divisions;
          for (let u = 0; u < divisions; u++) for (let v = 0; v < divisions; v++) {
            const piece = clip(planar, x + u * size, z + v * size, size);
            if (piece.length >= 3) add(piece);
          }
        }
      }
    }
  }
}

function drawSiteDistrictPaths(mesh, terrain, registration, surface, {
  model = null, supportPlan = null, bounds = null, bridgeTerrain = terrain,
  source = typeof WEST_VILLAGE_CIRCULATION === 'undefined' ? null : WEST_VILLAGE_CIRCULATION
} = {}) {
  if (!terrain || !registration || !source || !surface) return { bridges: [], interruptions: [] };
  const vectors = siteDistrictVectors(registration, source), reserved = siteDistrictReservedLand(model, supportPlan),
    moat = supportPlan?.moat,
    plan = siteDistrictBridgeCandidates(vectors, bridgeTerrain, surface, siteDistrictReservedLand(model, supportPlan, false), moat),
    waterRegions = [...(surface.existing ?? []), ...(surface.proposed ?? []), ...(surface.garage ?? []),
      ...(moat?.triangles ?? [])].map(siteDistrictRegion).filter(Boolean),
    cutsAt = siteDistrictIndex([...waterRegions, ...reserved]),
    orange = vectors.triangles.map((triangle) => {
      const outline = siteDistrictRegion(triangle);
      if (!outline) return null;
      const points = triangle.map(([x, z]) => [x, 0, z]);
      if ((points[1][0] - points[0][0]) * (points[2][2] - points[0][2]) -
          (points[1][2] - points[0][2]) * (points[2][0] - points[0][0]) > 0) points.reverse();
      return { ...outline, points };
    }).filter(Boolean),
    orangeAt = siteDistrictIndex(orange),
    bridgesAt = siteDistrictIndex(plan.bridges.flatMap(({ parts }) => parts)),
    range = terrain.size / 2,
    viewCuts = [...(bounds ?? []), { x: -1, y: 0, z: 0, level: range }, { x: 1, y: 0, z: 0, level: range },
      { x: 0, y: 0, z: -1, level: range }, { x: 0, y: 0, z: 1, level: range }],
    ground = ([x, , z]) => siteTerrainHeight(terrain, x, z),
    paving = rgb('#e2a66c'), landing = rgb('#e8b27d'), deck = rgb('#edbc87'),
    beam = rgb('#8e7e68'), rail = rgb('#776652'), concrete = rgb('#a69d88');
  const face = (points, height, color, depth = 0) => {
    const top = points.map((point) => [point[0], height(point), point[2]]);
    for (let i = 1; i + 1 < top.length; i++) {
      const tri = [top[0], top[i], top[i + 1]];
      if (Math.abs((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) -
          (tri[1][2] - tri[0][2]) * (tri[2][0] - tri[0][0])) < 1e-8) continue;
      mesh.tri(...tri, color);
      if (depth) mesh.tri(...tri.reverse().map(([x, y, z]) => [x, y - depth, z]), beam);
    }
  };
  mesh.mark('Site_District_Paths', 'Mapped pedestrian, cycling and shared-use corridors');
  for (const entry of orange) {
    const bounded = trimDrawingFace(entry.points, viewCuts);
    if (bounded.length < 3) continue;
    const dry = terrainOutsideSiteWater(bounded, [...cutsAt(entry), ...bridgesAt(entry)].map(({ planes }) => planes));
    for (const piece of dry) siteDistrictDrape(piece, terrain, (patch) => face(patch, (p) => ground(p) + 0.055, paving));
  }

  for (const bridge of plan.bridges) {
    const { id, route, width, depth, seatFrom, seatTo } = bridge;
    let visible = false;
    for (const part of bridge.parts) {
      const { station, planes, deck: isDeck } = part;
      const patches = orangeAt(part).map(({ points }) => trimDrawingFace(points, [...planes, ...viewCuts]))
        .filter((polygon) => polygon.length >= 3);
      if (!patches.length) continue;
      mesh.mark(isDeck ? 'Site_District_Pedestrian_Bridge_Decks' : 'Site_District_Pedestrian_Bridge_Approaches', id);
      for (const patch of patches) {
        if (isDeck) face(patch, (p) => bridge.height(station(p)), deck, depth);
        else for (const dry of terrainOutsideSiteWater(patch, cutsAt(part).map(({ planes }) => planes)))
          siteDistrictDrape(dry, terrain, (piece) => face(piece, (p) => Math.max(ground(p) + 0.055, bridge.height(station(p))), landing));
      }
      visible ||= isDeck;
    }
    if (!visible) continue;
    mesh.mark('Site_District_Pedestrian_Bridge_Rails', id);
    for (const part of route.segments) {
      const from = Math.max(seatFrom, part.from), to = Math.min(seatTo, part.to);
      if (to - from < 0.02) continue;
      const count = Math.max(1, Math.ceil((to - from) / 3.2));
      for (const side of [-1, 1]) {
        // Use the mapped orange edge so guard lines stay inside the deck.
        const edge = (station, y) => {
          const center = part.at(station), across = siteLine(center, part.angle + Math.PI / 2),
            span = Math.max(2.5, width * 0.85), hits = orangeAt({
              minX: center[0] - span, maxX: center[0] + span, minZ: center[1] - span, maxZ: center[1] + span
            });
          const steps = Math.ceil(span / 0.20);
          let offset = side * Math.min(width / 2 + 0.18, span);
          for (let i = 0; i <= steps; i++, offset -= side * 0.20) {
            const [x, z] = across(offset);
            if (hits.some(({ planes }) => planes.every((plane) => plane.x * x + plane.z * z <= plane.level + 1e-6)))
              return [x, y, z];
          }
          const [x, z] = across(side * Math.max(0.22, width * 0.41));
          return [x, y, z];
        };
        for (let i = 0; i < count; i++) {
          const a = from + (to - from) * i / count, b = from + (to - from) * (i + 1) / count,
            start = edge(a, bridge.height(a)), end = edge(b, bridge.height(b)), rise = ([x, y, z], d) => [x, y + d, z],
            railTop = clipDrawingLine(rise(start, 1.13), rise(end, 1.13), viewCuts),
            midRail = clipDrawingLine(rise(start, 0.57), rise(end, 0.57), viewCuts),
            girder = clipDrawingLine(rise(start, -depth / 2), rise(end, -depth / 2), viewCuts);
          if (railTop) drawAssemblyMember(mesh, ...railTop, 0.073, rail);
          if (midRail) mesh.line(...midRail, rail);
          if (girder) drawAssemblyMember(mesh, ...girder, 0.13, beam, depth);
          if (viewCuts.every((plane) => drawingDistance(start, plane) <= 0))
            mesh.box(start[0], start[1], start[2], 0.095, 1.15, 0.095, part.angle, rail);
        }
      }
    }
    mesh.mark('Site_District_Pedestrian_Bridge_Abutments', id);
    const pier = (station, footing, size, across = 0) => {
      const [x, z] = route.at(station, across), top = bridge.height(station) - depth;
      if (top - footing < 0.02 || viewCuts.some((plane) => drawingDistance([x, 0, z], plane) > 0)) return;
      mesh.box(x, footing, z, size, top - footing, size * 0.85, route.locate(station).angle, concrete);
    };
    for (const station of [seatFrom, seatTo]) {
      const [x, z] = route.at(station);
      pier(station, siteTerrainHeight(terrain, x, z) - 0.6, Math.max(0.80, width * 0.32), -width * 0.27);
      pier(station, siteTerrainHeight(terrain, x, z) - 0.6, Math.max(0.80, width * 0.32), width * 0.27);
    }
    const count = Math.ceil((seatTo - seatFrom) / 32);
    for (let i = 1; i < count; i++) {
      const station = seatFrom + (seatTo - seatFrom) * i / count,
        bed = Math.min(siteTerrainHeight(terrain, ...route.at(station)) - 0.5, bridge.waterLevel - 1.8);
      for (const side of [-1, 1]) pier(station, bed, 0.68, side * width * 0.24);
    }
  }
  mesh.mark('Site_District_Parcel_4_Outline', 'Parcel 4 project boundary');
  const parcel = westVillageParcel(registration), boundary = rgb('#5d795f');
  for (const [i, a] of parcel.entries()) {
    const b = parcel[(i + 1) % parcel.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const point = (t) => {
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      return [x, ground([x, 0, z]) + 0.14, z];
    };
    for (let from = 0; from < length; from += 6) {
      const line = clipDrawingLine(point(from / length), point(Math.min(length, from + 3.8) / length), viewCuts);
      if (line) mesh.line(...line, boundary);
    }
  }
  return { ...plan, coversGround(x, z) {
    return orangeAt({ minX: x, maxX: x, minZ: z, maxZ: z }).some(({ planes }) =>
      planes.every((plane) => plane.x * x + plane.z * z <= plane.level));
  } };
}
