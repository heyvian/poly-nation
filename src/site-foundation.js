'use strict';

const SITE_PLATFORM_BEAM_TOP = 0.46;
const SITE_DRY_BEAM_DEPTH = 0.42;
const SITE_APPROACH_DECK_DEPTH = 0.22;
const SITE_BANK_FOUNDATION_SETBACK = 5;
const SITE_PILE_CAP_WIDTH = 0.90;
const SITE_PILE_CAP_COVER = 0.33;
const SITE_PILE_CAP_DEPTH = 0.48;
const SITE_PILE_DISPLAY_LENGTH = 3.2;

function siteDiskPlanes([x, z], radius) {
  // Tangent half-planes enclose the full circular footprint.
  return Array.from({ length: 24 }, (_, i) => {
    const angle = i * TAU / 24, nx = Math.cos(angle), nz = Math.sin(angle);
    return { x: nx, y: 0, z: nz, level: nx * x + nz * z + radius };
  });
}

// The DEM is planar within each triangle. Include its new corners where the footprint cuts it.
function siteTerrainMaximum(terrain, position, radius) {
  const { count, size, datum, elevations } = terrain, step = size / (count - 1),
    [x, z] = position, bounds = siteDiskPlanes(position, radius);
  const cell = (value) => clamp(Math.floor((size / 2 - value) / step), 0, count - 2);
  function at(row, col) {
    return [size / 2 - col * step, elevations[row * count + col] - datum, size / 2 - row * step];
  }
  let peak = siteTerrainHeight(terrain, x, z);
  for (let row = cell(z + radius * 1.01); row <= cell(z - radius * 1.01); row++) {
    for (let col = cell(x + radius * 1.01); col <= cell(x - radius * 1.01); col++) {
      const a = at(row, col), b = at(row + 1, col), c = at(row, col + 1), d = at(row + 1, col + 1);
      for (const source of [[a, b, c], [c, b, d]]) {
        let clipped = source;
        for (const limit of bounds) {
          clipped = clipDrawingPolygon(clipped, limit);
          if (!clipped.length) break;
        }
        for (const [, height] of clipped) peak = Math.max(peak, height);
      }
    }
  }
  return peak;
}

function siteFoundationWater(water, position, reach) {
  const flat = [...(water?.existing ?? []), ...(water?.proposed ?? []), ...(water?.garage ?? [])].map((triangle) => triangle.flat())
    .filter((triangle) => westVillageOverlaps(position, reach, [triangle]));
  const regions = flat.flatMap(([ax, az, bx, bz, cx, cz]) => {
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(cross) < 1e-6) return [];
    const points = [[ax, 0, az], [bx, 0, bz], [cx, 0, cz]], sign = Math.sign(cross);
    const planes = points.map(([x, , z], i) => {
      const [u, , v] = points[(i + 1) % points.length],
        nx = (v - z) * sign, nz = (x - u) * sign;
      return { x: nx, y: 0, z: nz, level: nx * x + nz * z };
    });
    return [{ points, planes }];
  });
  return {
    overlaps: (point, padding = 0) => westVillageOverlaps(point, padding, flat),
    overlapsFootprint(corners) {
      const points = corners.map(([x, z]) => [x, 0, z]);
      return regions.some(({ planes }) => trimDrawingFace(points, planes).length >= 3);
    },
    anchor(radius) {
      const bounds = siteDiskPlanes(position, radius);
      let closest = null, best = Infinity;
      for (const { points } of regions) {
        let clipped = points;
        for (const limit of bounds) {
          clipped = clipDrawingPolygon(clipped, limit);
          if (clipped.length < 3) break;
        }
        if (clipped.length < 3) continue;
        const x = clipped.reduce((sum, p) => sum + p[0], 0) / clipped.length,
          z = clipped.reduce((sum, p) => sum + p[2], 0) / clipped.length,
          distance = Math.hypot(x - position[0], z - position[1]);
        if (distance < best) {
          closest = [x, z];
          best = distance;
        }
      }
      return closest;
    },
    spans(at, low, high) {
      const point = (station) => { const [x, z] = at(station); return [x, 0, z]; },
        a = point(low), b = point(high), length = high - low,
        spans = regions.flatMap(({ planes }) => {
          const hit = clipDrawingLine(a, b, planes);
          if (!hit) return [];
          const distances = hit.map(([x, , z]) => low + Math.hypot(x - a[0], z - a[2]));
          return distances[1] - distances[0] > 0.005 ? [distances] : [];
        }).sort((x, y) => x[0] - y[0]);
      if (length <= 0) return [];
      const merged = [];
      for (const [start, end] of spans) {
        if (start <= (merged.at(-1)?.[1] ?? -Infinity) + 0.025)
          merged.at(-1)[1] = Math.max(merged.at(-1)[1], end);
        else merged.push([start, end]);
      }
      return merged;
    }
  };
}

function siteLine([x, z], angle, offset = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (station) => [x + c * station - s * offset, z + s * station + c * offset];
}

function siteCrossingAngle(water, anchor, fallback, reach) {
  if (!anchor) return fallback;
  let width = Infinity, angle = fallback;
  for (let i = 0; i < 24; i++) {
    const direction = i * Math.PI / 24,
      span = water.spans(siteLine(anchor, direction), -reach, reach).find(([a, b]) => a <= 0 && b >= 0);
    if (span && span[0] > -reach + 0.5 && span[1] < reach - 0.5 && span[1] - span[0] < width) {
      width = span[1] - span[0];
      angle = direction;
    }
  }
  return angle;
}

function siteGirderRow(position, angle, offset, radius, water, terrain, reach) {
  const at = siteLine(position, angle, offset), half = Math.sqrt(radius ** 2 - offset ** 2),
    dry = (station) => {
      const point = at(station);
      return point.every((value) => Math.abs(value) < terrain.size / 2 - 2) && !water.overlaps(point, 1.45);
    },
    findBank = (edge, direction) => {
      for (let station = edge + direction * 1.55; Math.abs(station) < reach; station += direction * 0.5)
        if (dry(station)) return station;
      return null;
    },
    channels = water.spans(at, -reach, reach).filter(([start, end]) => start < half && end > -half),
    transfers = [], supports = [];
  let unresolved = false;
  for (const [start, end] of channels) {
    const from = findBank(start, -1), to = findBank(end, 1);
    if (from === null || to === null) {
      unresolved = true;
      continue;
    }
    const previous = transfers.at(-1);
    if (previous && previous.to >= from) previous.to = to;
    else transfers.push({ from, to });
  }
  for (const span of transfers) {
    span.depth = clamp((span.to - span.from) / 20, 0.44, 1.35);
    supports.push({ at: span.from, bank: true }, { at: span.to, bank: true });
  }
  return { at, angle, offset, half, transfers, supports, unresolved };
}

function siteLandwardRuns(at, from, to, water, transfers = []) {
  const count = Math.ceil((to - from) / 0.85), runs = [];
  for (let i = 0; i < count; i++) {
    const start = from + (to - from) * i / count, end = from + (to - from) * (i + 1) / count;
    if (transfers.some((span) => start < span.to && end > span.from)) continue;
    // The disk includes this whole piece of the cap, not just the wall's centreline.
    const padding = SITE_BANK_FOUNDATION_SETBACK + SITE_PILE_CAP_WIDTH / 2 + (end - start) / 2 + 0.025;
    if (water.overlaps(at((start + end) / 2), padding)) continue;
    const previous = runs.at(-1);
    if (previous && Math.abs(previous.to - start) < 1e-6) previous.to = end;
    else runs.push({ from: start, to: end });
  }
  return runs.filter(({ from, to }) => to - from >= 1.4);
}

function siteApproach(terrain, water, position, angle, start, offset, top, kind, limit = kind === 'ramp' ? 250 : 140) {
  const at = siteLine(position, angle, offset), surfaceAt = (station) => siteTerrainHeight(terrain, ...at(station)),
    ramp = kind === 'ramp', width = ramp ? 1.9 : 2.05, junction = 1.55,
    sightLimit = limit,
    left = siteLine(position, angle, offset - width / 2), right = siteLine(position, angle, offset + width / 2),
    wet = [at, left, right].flatMap((line) => water.spans(line, start, start + sightLimit)),
    clearance = water.level + water.clearance + SITE_APPROACH_DECK_DEPTH;
  for (let distance = 4; distance <= sightLimit; distance += 0.75) {
    const end = start + distance, endPoint = at(end);
    if (endPoint.some((v) => Math.abs(v) > terrain.size / 2 - 2) || water.overlaps(endPoint, width * 0.8)) continue;
    const crossings = wet.filter(([from]) => from < end);
    if (crossings.length && top < clearance - 1e-6) break;
    // Stay level across any channel. Begin the incline after the last bank on the route.
    const landingEnd = Math.max(start + junction, ...crossings.map(([, bank]) => bank + 0.9)),
      grade = surfaceAt(end), rise = grade - top, level = Math.abs(rise) < 0.06,
      flights = ramp ? Math.max(1, Math.ceil(Math.abs(rise) * 20 / 9)) : Math.max(1, Math.ceil(Math.abs(rise) / 0.165)),
      landing = ramp ? junction : 0,
      run = (end - landingEnd - junction - (flights - 1) * landing) / flights;
    if (run < (ramp ? (Math.abs(rise) * 20) / flights : 0.30)) continue;
    const nodes = [[start, top], [landingEnd, top]];
    for (let i = 0; i < flights; i++) {
      const [last, y] = nodes.at(-1), nextY = top + rise * (i + 1) / flights;
      if (!ramp && !level) {
        nodes.push([last + run / 2, y], [last + run / 2, nextY], [last + run, nextY]);
      } else nodes.push([last + run, nextY]);
      if (ramp && i < flights - 1) nodes.push([last + run + landing, nextY]);
    }
    nodes.push([end, grade]);
    const clear = nodes.every(([b, high], i) => {
      if (!i) return true;
      const [a, low] = nodes[i - 1];
      if (b - a < 0.001) return true;
      const steps = Math.ceil((b - a) / 0.60);
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, station = a + (b - a) * t, y = low + t * (high - low);
        for (const point of [at(station), left(station), right(station)]) {
          if (water.overlaps(point)) {
            if (y < clearance - 1e-6) return false;
          } else if (y + (station > end - junction ? 0.15 : 0.05) < siteTerrainHeight(terrain, ...point))
            return false;
        }
      }
      return true;
    });
    if (clear) return { at, angle, offset, width, kind: level ? 'walk' : kind, nodes, grade, run: distance };
  }
  return null;
}

function siteDryWalk(water, position, angle, start, end, width) {
  const left = siteLine(position, angle, -width / 2), right = siteLine(position, angle, width / 2);
  return !water.overlapsFootprint([left(start), left(end), right(end), right(start)]);
}

function siteLobbyWalk(terrain, water, position, angle, threshold, start, top, width, arrival = null) {
  const at = siteLine(position, angle), landing = start + 1.8;
  for (let distance = Math.max(5, (arrival?.end ?? start) - start + 1); distance <= 140; distance += 1) {
    const end = start + distance, point = at(end);
    if (point.some((value) => Math.abs(value) > terrain.size / 2 - width)) break;
    if (!siteDryWalk(water, position, angle, threshold, end, width + 0.5)) break;
    const grade = siteTerrainHeight(terrain, ...point);
    if (Math.abs(grade - top) <= (end - landing) / 20 + 1e-6) {
      const nodes = [[start, top], [landing, top], [end, grade]], courts = arrival ?
        [['Outer', arrival], ['Inner', { ...arrival, ...arrival.innerCourt }]].filter(([, court]) =>
          court.end - court.courtStart >= 4.5 && siteDryWalk(water, position, angle, court.courtStart, court.end, court.courtWidth + 0.3)) : [];
      if (arrival) for (const station of [arrival.mouth + 0.01, arrival.mouth + 3])
        if (station > landing && station < end) nodes.splice(nodes.length - 1, 0, [station, top + (grade - top) * (station - landing) / (end - landing)]);
      return { at, angle, width, kind: 'walk', threshold, nodes, arrival, courts };
    }
  }
  return null;
}

function siteWalkHeight(nodes, station) {
  const next = nodes.findIndex(([along]) => along >= station);
  if (next < 0) return nodes.at(-1)[1];
  if (next === 0) return nodes[0][1];
  const [a, y] = nodes[next - 1], [b, h] = nodes[next];
  return y + (h - y) * (station - a) / (b - a);
}

function siteLobbyGrade(terrain, routes, [x, z]) {
  const walks = routes.flatMap((route) => route.innerWalk ? [route.innerWalk, route] : [route]).map((route) => ({
    ...route, cos: Math.cos(route.angle), sin: Math.sin(route.angle)
  }));
  return (px, pz, natural) => {
    let grade = terrain.groundProfile?.(px, pz, natural) ?? natural;
    for (const { cos, sin, width, nodes, threshold, gradeEnd, arrival, courts } of walks) {
      const dx = px - x, dz = pz - z, station = dx * cos + dz * sin, offset = dz * cos - dx * sin,
        end = nodes.at(-1)[0], lane = arrival ? elevatedArrivalWidth(arrival, station) : width,
        apron = courts?.find(([, { courtStart, end }]) => courtStart - 0.75 <= station && station <= end + 0.75)?.[1],
        cross = apron?.courtWidth ?? lane,
        blend = 1 - Math.max(Math.max(0, station - (gradeEnd ?? end), threshold - station) / 1.8, (Math.abs(offset) - cross / 2 - 0.6) / 2.5, 0);
      if (blend <= 0) continue;
      const level = siteWalkHeight(nodes, station);
      grade += (level - 0.035 - grade) * blend;
    }
    return grade;
  };
}

function siteFirehallBoatBay(model, position, surface, terrain, accessAngle) {
  if (!surface?.proposed?.length) return null;
  const rim = model.R + 3.15, back = Math.max(model.r + 1.2, rim - 13.4), halfWidth = 3.7,
    canals = siteFoundationWater({ proposed: surface.proposed }, position, rim + 24),
    district = siteFoundationWater(surface, position, rim + 24), options = [];
  for (let i = 0; i < 144; i++) {
    const angle = i * TAU / 144;
    if (Math.sin(angDist(angle, accessAngle)) * rim < 7.5) continue;
    const at = siteLine(position, angle), probes = [-halfWidth + 0.3, 0, halfWidth - 0.3].map((offset) =>
      canals.spans(siteLine(position, angle, offset), back, rim + 17));
    const reach = probes[1].flatMap(([from, to]) => probes[0].flatMap(([a, b]) => probes[2].map(([p, q]) =>
      [Math.max(from, a, p, rim + 0.45), Math.min(to, b, q)])))
      .filter(([from, to]) => to - from > 1.5).sort((a, b) => a[0] - b[0])[0];
    if (!reach || reach[0] > rim + 12) continue;
    const end = reach[0] + 0.85, cos = Math.cos(angle), sin = Math.sin(angle),
      point = (station, offset) => [position[0] + station * cos - offset * sin, position[1] + station * sin + offset * cos],
      crewSide = [-1, 1].sort((a, b) =>
        Number(district.overlaps(point(rim - 2, a * (halfWidth + 1)), 0.75)) -
        Number(district.overlaps(point(rim - 2, b * (halfWidth + 1)), 0.75)))[0],
      [a, b, c, d] = [point(back, -halfWidth), point(end, -halfWidth), point(end, halfWidth), point(back, halfWidth)],
      dryRear = !district.overlaps(at(back), halfWidth * 0.55),
      level = surface.level - terrain.datum;
    options.push({ angle, at, point, back, rim, end, halfWidth, crewSide, level, dryRear,
      triangles: [[a, b, c], [a, c, d]], area: (rim - back) * 2 * halfWidth,
      score: end - rim + (dryRear ? 0 : 4) });
  }
  options.sort((a, b) => a.score - b.score);
  const moat = craneMoatBounds(model.crane), reach = rim + 52;
  return options.find((bay) => {
    const water = siteFoundationWater({ ...surface, garage: bay.triangles }, position, reach),
      floor = bay.level + modelFloorPitch(model) + 0.28;
    water.level = bay.level;
    water.clearance = modelFloorPitch(model) - 0.8;
    return siteBoatCrewAccess(bay, terrain, water, position, floor, moat);
  }) ?? options[0] ?? null;
}

function siteMoatPlan(bounds, position, surface, terrain, water, foundation) {
  if (!bounds) return null;
  const triangles = siteMoatFootprint(bounds, position),
    footprint = siteFoundationWater({ proposed: triangles }, position, bounds.outer + 1),
    connected = [...(surface?.existing ?? []), ...(surface?.proposed ?? []), ...(surface?.garage ?? [])]
      .some((polygon) => westVillageOverlaps(position, bounds.outer, [polygon.flat()]) &&
        polygon.some((point, i) => {
          const next = polygon[(i + 1) % polygon.length], length = Math.hypot(point[0] - next[0], point[1] - next[1]);
          return length > 0.001 && footprint.spans((s) => point.map((value, j) =>
            value + (next[j] - value) * s / length), 0, length).length;
        })) || triangles.some(([a, b, c]) => {
          const center = a.map((value, j) => (value + b[j] + c[j]) / 3);
          return water.overlaps(center);
        }),
    level = connected ? water.level : Math.min(foundation + MOAT_WATER_LEVEL,
      ...triangles.filter((_, i) => i % 12 === 0).map(([point]) => siteTerrainHeight(terrain, ...point) - 0.30));
  return { ...bounds, triangles, footprint, connected, level };
}

function siteRunwaySupports(crane, position, angle, water, pitch) {
  const { tower, groundGauge } = crane, count = Math.ceil(TAU * tower / pitch),
    radii = [tower - groundGauge / 2, tower + groundGauge / 2],
    stations = crane.runway === 'elevated' ? elevatedRunwaySupports(crane) : Array.from({ length: count }, (_, i) => (i + 0.5) * TAU / count),
    poles = stations.map((azimuth) => azimuth + angle)
      .filter((azimuth) => radii.every((radius) => !water.overlaps(siteLine(position, azimuth)(radius), 1.3))),
    spans = poles.flatMap((from, i) => {
      const to = poles[i + 1] ?? poles[0] + TAU, length = (to - from) * tower;
      return length > TAU * tower / count * 1.25 ? [{ from, to, length, depth: clamp(length / 15, 1.35, 3.15) }] : [];
    });
  return { radii, poles, spans, unresolved: poles.length < 3 || spans.some(({ length }) => length > 42) };
}

function siteLowerRooms(model, terrain, position, floor, perimeter, rows, water, accessAngle, moat, boatBay, bearing, innerRing) {
  const { radius } = perimeter, outer = radius - 0.20, inner = Math.max(innerRing + 0.55, model.r + 1.35, outer - 6.4),
    bayLength = (outer - inner) * 1.42, half = bayLength / (2 * radius),
    ceiling = floor - SITE_PLATFORM_BEAM_TOP - SITE_DRY_BEAM_DEPTH,
    limit = moat ? moat.inner - radius - 1 : 36, options = [];
  if (outer - inner < 3.1) return [];
  for (let i = 0; i < 96; i++) {
    const local = i * TAU / 96, angle = local + bearing, from = angle - half, to = angle + half;
    if (Math.sin(angDist(angle, accessAngle)) * radius < bayLength / 2 + 4) continue;
    const station = radius * local, width = 1.9;
    if (!perimeter.runs.some((run) => station - half * radius >= run.from && station + half * radius <= run.to)) continue;
    if (boatBay && angDist(angle, boatBay.angle) * radius < bayLength / 2 + boatBay.halfWidth + 3) continue;
    const samples = [inner, (inner + outer) / 2, outer].flatMap((r) =>
      Array.from({ length: 7 }, (_, j) => siteLine(position, from + (to - from) * j / 6)(r)));
    if (samples.some((point) => water.overlaps(point, SITE_BANK_FOUNDATION_SETBACK + 1.1))) continue;
    if (rows.some((row) => {
      const offsets = samples.map(([x, z]) => (z - position[1]) * Math.cos(row.angle) - (x - position[0]) * Math.sin(row.angle));
      return row.offset >= Math.min(...offsets) - 0.55 && row.offset <= Math.max(...offsets) + 0.55;
    })) continue;
    const at = siteLine(position, angle), [x, z] = at((outer + inner) / 2),
      bound = Math.max(...samples.map((point) => Math.hypot(point[0] - x, point[1] - z))),
      level = Math.max(siteTerrainMaximum(terrain, [x, z], bound) + 0.20,
        water.overlaps(at(radius), 35) ? water.level + 0.45 : -Infinity);
    if (ceiling - level < 2.7) continue;
    const route = siteApproach(terrain, water, position, angle, radius + 0.12, 0, level, 'ramp', limit);
    if (!route) continue;
    options.push({ angle, at, inner, outer, from, to, level, ceiling, route, area: (outer ** 2 - inner ** 2) * half,
      door: { from: station - width / 2, to: station + width / 2, sill: level, head: level + 2.24 },
      score: route.run - Math.min(ceiling - level, 4) + (boatBay ? angDist(angle, boatBay.angle) * 2 : 0) });
  }
  const rooms = [];
  for (const room of options.sort((a, b) => a.score - b.score)) {
    if (rooms.every((other) => angDist(room.angle, other.angle) * radius > bayLength + 5)) rooms.push(room);
    if (rooms.length === 2) break;
  }
  return rooms;
}

function siteBoatCrewAccess(bay, terrain, water, position, floor, moat) {
  const deck = bay.level + 0.48, ceiling = floor - SITE_PLATFORM_BEAM_TOP - SITE_DRY_BEAM_DEPTH;
  for (const side of [bay.crewSide, -bay.crewSide]) {
    const offset = side * (bay.halfWidth + 0.85), limit = moat ? moat.inner - bay.rim - 1 : 42,
      landing = Math.max(deck, ...[-0.95, 0, 0.95].map((shift) =>
        siteTerrainHeight(terrain, ...bay.point(bay.rim, offset + shift)) + 0.10));
    if (landing - deck <= 2.1 && landing + 2.4 <= ceiling) {
      const route = siteApproach(terrain, water, position, bay.angle, bay.rim, offset, landing, 'ramp', limit);
      if (route) return { side, route, landing };
    }
    // When a canal runs alongside the slip, reach its nearest dry bank from the crew apron.
    const origin = bay.point(bay.rim - 1.1, offset), direction = bay.angle + side * Math.PI / 2,
      at = siteLine(origin, direction);
    for (let distance = 1.6; distance <= 7; distance += 0.45) {
      const point = at(distance), top = Math.max(deck, siteTerrainHeight(terrain, ...point) + 0.18);
      if (water.overlaps(point, 0.95) || top - deck > Math.min(1.6, distance * 0.38) || top + 2.4 > ceiling) continue;
      const route = siteApproach(terrain, water, origin, direction, distance, 0, top, 'stair', 20);
      if (route) return { side, route, landing: top,
        gangway: { at, angle: direction, width: 1.86, distance, deck, landing: top } };
    }
  }
  return null;
}

function siteModuleFootprint(model, slot, position, bearing) {
  const angle = slot.angle + bearing, width = MODULE.width / 2 + 0.42,
    from = model.R - 0.24, to = model.R + BUILD_SECTION.dockGap + MODULE.depth + 2.05,
    left = siteLine(position, angle, -width), right = siteLine(position, angle, width);
  return { angle, width, from, to, corners: [left(from), left(to), right(to), right(from)] };
}

function siteGroundStorey(model, terrain, position, angle, radius, water) {
  const omitted = new Set(), wetBays = new Set(), land = [], perimeter = [], footprints = [];
  if (water.overlaps(position, radius)) {
    for (let ring = 0; ring <= radius; ring += Math.min(2, radius / 16)) {
      const count = Math.max(1, Math.ceil(ring * TAU / 2));
      for (let i = 0; i < count; i++) land.push(siteLine(position, i * TAU / count)(ring));
    }
    for (let i = 0; i < 72; i++) perimeter.push(siteLine(position, i * TAU / 72)(radius));
  }
  for (const slot of model.slots) {
    if (slot.f !== 0) continue;
    const footprint = siteModuleFootprint(model, slot, position, angle);
    if (water.overlapsFootprint(footprint.corners)) {
      wetBays.add(slot.j);
      if (!slot.blocked) omitted.add(slot.i);
      continue;
    }
    if (slot.blocked) continue;
    footprints.push(footprint);
    for (const offset of [-footprint.width, 0, footprint.width]) {
      const at = siteLine(position, footprint.angle, offset), steps = Math.ceil((footprint.to - footprint.from) / 2);
      for (let i = 0; i <= steps; i++) land.push(at(footprint.from + (footprint.to - footprint.from) * i / steps));
    }
  }
  const heights = (points) => points.filter((point) => !water.overlaps(point, 0.5))
    .map((point) => siteTerrainHeight(terrain, ...point));
  const near = heights(perimeter).sort((a, b) => a - b), dry = heights(land), grade = siteTerrainHeight(terrain, ...position);
  return { omitted, wetBays, footprints, near: near[Math.floor(near.length * 0.20)] ?? grade,
    peak: dry.length ? Math.max(...dry) : grade };
}

function siteTerraceProfile(ground, [x, z], radius, floor) {
  const footprints = ground.footprints.map(({ angle, ...bounds }) => ({ ...bounds, cos: Math.cos(angle), sin: Math.sin(angle) }));
  return (px, pz, height) => {
    if (height <= floor - 0.12) return height;
    const dx = px - x, dz = pz - z;
    let outside = Math.hypot(dx, dz) - radius;
    for (const { from, to, width, cos, sin } of footprints) {
      const along = dx * cos + dz * sin, across = Math.abs(-dx * sin + dz * cos),
        distance = Math.max(from - along, along - to, across - width);
      outside = Math.min(outside, distance);
    }
    return height - (height - floor + 0.12) * clamp(1 - (outside - 0.8) / 5, 0, 1);
  };
}

function sitePlacementModel(model, plan) {
  if (!plan) return model;
  const outdoor = plan.lookouts.find(({ type }) => type === 'dock'),
    slots = plan.omitted.size || outdoor ? model.slots.map((slot) => {
      if (plan.omitted.has(slot.i)) return { ...slot, blocked: true, p: EMPTY, use: 'empty' };
      return slot.i === outdoor?.slot ? { ...slot, siteCanalLookout: true } : slot;
    }) : model.slots,
    crane = plan.runway?.lift ? { ...model.crane, groundRail: model.crane.groundRail + plan.runway.lift } : model.crane;
  const cos = Math.cos(plan.angle), sin = Math.sin(plan.angle), [x, z] = plan.position;
  return { ...model, crane, slots, siteWetBays: plan.wetBays, siteTransferredColumns: plan.transferredColumns,
    siteCanalLookouts: plan.lookouts,
    siteTransferredLifts: new Set(plan.lateralBays.filter(({ wet }) => wet).map(({ key }) => key)),
    siteGroundAt: (px, pz) => siteTerrainHeight(plan.terrain, x + px * cos - pz * sin, z + px * sin + pz * cos) - plan.foundation };
}

function siteCanalLookouts(model, water, position, bearing) {
  if (model.layers.length < 2 || !water.overlaps(position, model.r)) return [];
  const { r, circulation } = model, depth = 2.15, c = Math.cos(bearing), s = Math.sin(bearing),
    mast = model.feature.ride.towerRadius + 1.55;
  const wet = (lookout) => {
    const reach = (lookout.end - lookout.start) * 0.34, center = (lookout.start + lookout.end) / 2;
    return [-reach, 0, reach].reduce((count, delta) => count + [1.1, 1.8].filter((out) => {
      const [x, , z] = canalLookoutPoint(lookout, center + delta, out, 0);
      return water.overlaps([position[0] + c * x - s * z, position[1] + s * x + c * z]);
    }).length, 0);
  };
  const bridge = circulation.bridges?.find(({ f }) => f === 1), candidates = [];
  if (bridge) for (const side of [-1, 1]) {
    const root = bridge.offset + side * bridge.width / 2, length = 4.8,
      edge = Math.sqrt(r ** 2 - (Math.abs(root) + depth) ** 2), limit = edge - 4;
    for (let start = -limit; start + length <= limit; start += 0.8) {
      const end = start + length, nearest = clamp(0, start, end);
      if (Math.hypot(Math.min(Math.abs(root), Math.abs(root + side * depth)), nearest) < mast) continue;
      candidates.push({ type: 'bridge', angle: bridge.heading, side, root, start, end, depth });
    }
  }
  // Use a clear public landing when the regular bridge misses the water or is switched off.
  const publicEdges = circulation.regions.filter((q) => q.f === 1 && q.r <= r + 0.001 &&
      ['link', 'residual', 'slide_bypass', 'slide_return'].includes(q.kind)),
    stairs = (circulation.stairs ?? []).filter(({ f }) => f === 1 || f === 2);
  for (const [from, to] of atriumGuardSpans(model, 1)) {
    const length = Math.min(3.8, (to - from) * r - 0.24), half = length / (2 * r);
    if (length < 2.3) continue;
    for (let angle = from + half + 0.1 / r; angle + half + 0.1 / r < to; angle += 0.45 / r) {
      if (!publicEdges.some(({ start, end }) => angDist(angle, (start + end) / 2) + half + 0.08 / r <= (end - start) / 2)) continue;
      if (stairs.some(({ top, bottom, half: landing }) =>
        angDist(angle, (top + bottom) / 2) < Math.abs(top - bottom) / 2 + landing + half + 0.25 / r)) continue;
      if (bridge && [-half, 0, half].some((delta) => {
        const cos = Math.cos(angle + delta - bridge.heading), edges = [r * cos, (r - depth) * cos];
        return Math.max(...edges) > bridge.offset - bridge.width / 2 - 0.2 &&
          Math.min(...edges) < bridge.offset + bridge.width / 2 + 0.2;
      })) continue;
      candidates.push({ type: 'ring', angle, side: -1, root: r, start: -length / 2, end: length / 2, depth });
    }
  }
  const lookouts = [], center = (q) => canalLookoutPoint(q, (q.start + q.end) / 2, depth / 2, 0),
    ranked = candidates.map((q) => ({ q, views: wet(q) })).filter(({ views }) => views >= 4)
      .sort((a, b) => (b.views - a.views) || Number(b.q.type === 'bridge') - Number(a.q.type === 'bridge'));
  for (const { q } of ranked) {
    const [x, , z] = center(q);
    if (lookouts.every((other) => {
      const [u, , v] = center(other);
      return Math.hypot(x - u, z - v) >= 9;
    })) lookouts.push(q);
    if (lookouts.length === 2) break;
  }
  return lookouts;
}

function siteOutdoorCanalLookout(model, water, position, bearing) {
  if (model.layers.length < 2) return null;
  const root = model.R, depth = BUILD_SECTION.dockGap + MODULE.depth, half = MODULE.width / 2 - 0.15,
    floorAbove = new Map(model.slots.filter(({ f }) => f === 2).map((slot) => [slot.j, slot]));
  let best = null, bestRank = -Infinity;
  for (const slot of model.slots) {
    if (slot.f !== 1 || slot.blocked || slot.p !== EMPTY || slot.use === 'retail') continue;
    const angle = slot.angle + bearing;
    if (!water.overlaps(siteLine(position, angle)(root + depth / 2), depth * 0.54)) continue;
    const upper = floorAbove.get(slot.j), exposed = !upper || upper.blocked || upper.p === EMPTY && upper.use === 'empty',
      // Check the glass strip on the canal side of the solid walking lane.
      views = [-0.32, 0.65, half - 0.26].map((offset) => siteLine(position, angle, offset));
    for (let near = 1.55; near <= depth - 2.65; near += 0.7) {
      const count = views.reduce((sum, at) => sum + [near + 0.24, near + 1.72]
        .filter((distance) => water.overlaps(at(root + distance))).length, 0);
      const rank = count * 3 + Number(exposed) * 8 + Number(slot.use === 'empty') * 2 + near / depth;
      if (count < 4 || rank <= bestRank) continue;
      bestRank = rank;
      best = { type: 'dock', slot: slot.i, angle: slot.angle, side: 1, root, start: -half, end: half, depth,
        glassFrom: near, glassTo: near + 2.0 };
    }
  }
  return best;
}

function siteCoreBearings(model, terrain, position, bearing, water, radius, rows, rowAngle, reach) {
  const grid = buildSupportGrid(model), c = Math.cos(rowAngle), s = Math.sin(rowAngle),
    columns = grid.axes.flatMap((axis) => ['inner', 'outer'].flatMap((side) => {
      if (!axis.active[side]) return [];
      const angle = axis.angle + bearing, at = siteLine(position, angle)(grid[side]);
      return [{ key: `${axis.j}/${side}`, axis, side, at, angle, station: grid[side] * axis.angle,
        size: coreColumnSize(grid, model.crane, axis, side), wet: water.overlaps(at, 1.45) }];
    })),
    lateralBays = coreLateralBays(model, 0).map((bay) => {
      const { radius: r, start, end } = bay,
        points = Array.from({ length: 5 }, (_, i) => siteLine(position, start + bearing + (end - start) * i / 4)(r)),
        ends = [start, end].map((angle, i) => ({ key: `${bay.key}/${i}`, at: points[i * 4], angle: angle + bearing,
          size: 0.6, wet: water.overlaps(points[i * 4], 1.45) }));
      return { ...bay, wet: points.some((point) => water.overlaps(point, 1.45)), ends };
    });
  for (const column of [...columns, ...lateralBays.flatMap(({ ends }) => ends)].filter(({ wet }) => wet)) {
    const dx = column.at[0] - position[0], dz = column.at[1] - position[1],
      station = dx * c + dz * s, offset = dz * c - dx * s;
    function find() {
      return rows.flatMap((row) => {
        const span = row.transfers.find(({ from, to }) => station >= from && station <= to);
        return span ? [{ row, span, distance: Math.abs(row.offset - offset) }] : [];
      }).sort((a, b) => a.distance - b.distance)[0];
    }
    let support = find();
    if (!support || support.distance > 5.5) {
      const row = siteGirderRow(position, rowAngle, offset, radius, water, terrain, reach);
      if (row.transfers.length) rows.push(row);
      support = find();
    }
    if (support) column.transfer = { at: support.row.at(station), depth: support.span.depth };
  }
  return { grid, columns, lateralBays, transferredColumns: new Set(columns.filter(({ wet }) => wet).map(({ key }) => key)) };
}

function siteFoundationPlan(model, terrain, { position, bearing, grade, water: districtSurface, lookout = 'atrium' }) {
  const storey = buildStorey(model, 0), base = storey.base, pitch = modelFloorPitch(model), angle = bearing * Math.PI / 180,
    radius = model.R + 3.15, reach = Math.max(110, radius * 2.6),
    envelope = Math.max(radius, Math.hypot(model.R + BUILD_SECTION.dockGap + MODULE.depth + 2.05, MODULE.width / 2 + 0.4)),
    accessAngle = model.lobby.angle + angle,
    boatBay = siteFirehallBoatBay(model, position, districtSurface, terrain, accessAngle),
    surface = boatBay ? { ...districtSurface, garage: boatBay.triangles } : districtSurface,
    water = siteFoundationWater(surface, position, Math.max(270 + radius, reach + radius)),
    district = boatBay ? siteFoundationWater(districtSurface, position, reach + radius) : water,
    districtAnchor = district.anchor(radius), anchor = districtAnchor ?? water.anchor(radius),
    lookouts = districtAnchor && lookout !== 'outdoor' ? siteCanalLookouts(model, district, position, angle) : [],
    outdoor = lookout !== 'atrium' ? siteOutdoorCanalLookout(model, district, position, angle) : null,
    rowAngle = siteCrossingAngle(districtAnchor ? district : water, anchor, accessAngle + Math.PI / 2, reach),
    offsets = [-0.7, -0.35, 0, 0.35, 0.7].map((fraction) => radius * fraction);
  if (outdoor) lookouts.push(outdoor);
  water.level = (surface?.level ?? terrain.datum) - terrain.datum;
  water.clearance = Math.max(1.8, pitch - (storey.base - storey.underside) - 1.0);
  let crossingOffset = 0;
  if (anchor) {
    crossingOffset = clamp((anchor[1] - position[1]) * Math.cos(rowAngle) -
      (anchor[0] - position[0]) * Math.sin(rowAngle), -radius * 0.98, radius * 0.98);
    const nearest = offsets.reduce((a, b) => Math.abs(a - crossingOffset) <= Math.abs(b - crossingOffset) ? a : b);
    if (Math.abs(nearest - crossingOffset) < radius * 0.16) offsets[offsets.indexOf(nearest)] = crossingOffset;
    else offsets.push(crossingOffset);
  }
  const mastRadius = model.feature.ride?.towerRadius ?? 0,
    mastCrossing = mastRadius > 0 && water.overlaps(position, mastRadius + 1.65);
  if (mastCrossing) for (const offset of [-mastRadius, mastRadius])
    if (!offsets.some((station) => Math.abs(station - offset) < 0.5)) offsets.push(offset);
  const rows = (anchor ? offsets : [0]).map((offset) => siteGirderRow(position, rowAngle, offset, radius, water, terrain, reach)),
    { grid, columns, lateralBays, transferredColumns } = siteCoreBearings(model, terrain, position, angle, water, radius, rows, rowAngle, reach),
    crosses = Boolean(anchor),
    ground = water.overlaps(position, envelope) ? siteGroundStorey(model, terrain, position, angle, radius, water) : null,
    groundAtPin = siteTerrainHeight(terrain, ...position), crane = model.crane,
    runway = crane?.runway === 'elevated' ? siteRunwaySupports(crane, position, angle, water, 12) : null,
    moatBounds = craneMoatBounds(crane),
    moatContact = siteMoatPlan(moatBounds, position, surface, terrain, water, Infinity),
    floor = Math.max((ground && crosses ? ground.near + 0.22 : groundAtPin + base) + grade,
      ground && crosses ? ground.peak - 2.0 : (ground ? ground.peak : siteTerrainMaximum(terrain, position, envelope)) + 0.24,
      crosses ? water.level + 0.25 : -Infinity,
      moatContact?.connected ? water.level + base + 0.65 : -Infinity),
    foundation = floor - base,
    crossingDeck = floor + (crosses ? pitch : 0),
    crossingSoffit = crossingDeck - (storey.base - storey.underside),
    moat = moatContact && { ...moatContact, level: moatContact.connected ? water.level : Math.min(moatContact.level, foundation + MOAT_WATER_LEVEL),
      runway: siteRunwaySupports(crane, position, angle, water, 4.8) },
    coreRadius = grid.outer,
    foundationRings = ['inner', 'outer'].map((side) => {
      const radius = grid[side], length = TAU * radius, at = (station) => siteLine(position, station / radius + angle)(radius);
      return { side, radius, length, at, runs: siteLandwardRuns(at, 0, length, water) };
    }),
    perimeter = foundationRings[1],
    accesses = [],
    terrace = ground && crosses ? { ...terrain, groundProfile: siteTerraceProfile(ground, position, radius, floor) } : terrain;
  if (runway) {
    const naturalHead = foundation + crane.groundRail,
      headroom = siteTerrainMaximum(terrain, position, runway.radii[1] + 0.7) + 2.6 + CRANE_ELEVATED_GIRDER_DEPTH,
      channel = runway.spans.length ? water.level + water.clearance + Math.max(...runway.spans.map(({ depth }) => depth)) : -Infinity,
      lift = Math.max(0, headroom - naturalHead, channel - naturalHead),
      available = Math.max(0, crane.roofRail - crane.groundRail - 5.0);
    runway.lift = Math.min(lift, available);
    runway.head = naturalHead + runway.lift;
    runway.unresolved ||= lift > available + 1e-6;
  }
  for (const row of rows) {
    const half = Math.sqrt(Math.max(0, coreRadius ** 2 - row.offset ** 2));
    row.landward = siteLandwardRuns(row.at, -half, half, water, row.transfers);
    row.supports = row.supports.filter((support) => support.bank ||
      !row.landward.some(({ from, to }) => support.at >= from && support.at <= to));
  }
  for (const [i, azimuth] of [accessAngle, accessAngle + Math.PI].entries()) {
    const threshold = model.R - 0.15, start = radius - 0.18, width = 3.8;
    if (moat) {
      const bridge = Math.min(moat.inner - 2.12, model.plaza.outer - 0.75), deck = foundation + 0.31;
      if (bridge <= start || Math.abs(deck - floor) > (bridge - start) / 20 ||
          !siteDryWalk(water, position, azimuth, threshold, moat.inner, width + 0.5)) continue;
      const outside = siteLobbyWalk(terrace, water, position, azimuth, moat.outer, moat.outer + 2.43, deck, width);
      if (outside) accesses.push({ ...outside, entrance: i, innerWalk: {
        at: siteLine(position, azimuth), angle: azimuth, width, threshold, gradeEnd: moat.inner,
        nodes: [[start, floor], [bridge, deck]],
      } });
    } else {
      const arrival = model.plaza.arrivals?.[i], through = arrival && siteLobbyWalk(terrace, water, position, azimuth,
        threshold, start, floor, arrival.width, { ...arrival, angle: azimuth }),
        walk = through || siteLobbyWalk(terrace, water, position, azimuth, threshold, start, floor, width);
      if (walk) accesses.push({ ...walk, entrance: i });
    }
  }
  const finishedTerrain = accesses.length ? { ...terrace, groundProfile: siteLobbyGrade(terrace, accesses, position) } : terrace,
    gradeReach = Math.max(terrace === terrain ? 0 : envelope + 6, ...accesses.map(({ nodes }) => nodes.at(-1)[0] + 5));
  const crew = boatBay && siteBoatCrewAccess(boatBay, finishedTerrain, water, position, crossingDeck, moat);
  if (crew) Object.assign(boatBay, { crewSide: crew.side, route: crew.route, landing: crew.landing, gangway: crew.gangway });
  const lowerRooms = siteLowerRooms(model, terrain, position, floor, perimeter, rows, water, accessAngle, moat, boatBay, angle, grid.inner),
    mastSeats = mastCrossing ? rows.filter((row) => Math.abs(row.offset) <= mastRadius + 0.5 &&
      row.transfers.some(({ from, to }) => from < 0 && to > 0)) : [];
  const dockFloors = new Map();
  for (const slot of model.slots) {
    if (slot.blocked || ground?.omitted.has(slot.i)) continue;
    const floors = dockFloors.get(slot.j) ?? [];
    floors.push(slot.f);
    dockFloors.set(slot.j, floors);
  }
  return { position, angle, radius, foundation, floor, pitch, roofLevel: model.roofPlan.y, dockFloors, groundAtPin, water, rows,
    crossingOffset, anchor, crossingDeck, crossingSoffit, lookouts,
    omitted: ground?.omitted ?? new Set(), wetBays: ground?.wetBays ?? new Set(), mastCrossing, mastRadius, mastSeats,
    grid, columns, lateralBays, transferredColumns, foundationRings, crane,
    terrain: finishedTerrain, gradeReach, surface, accesses, accessAngle, moat, perimeter, runway, boatBay, lowerRooms,
    contextReach: Math.max(envelope, model.crane?.extent ?? 0, ...(model.plaza.arrivals ?? []).map(({ end }) => end)),
    unresolved: rows.some((row) => row.unresolved) || [...columns, ...lateralBays.flatMap(({ ends }) => ends)]
      .some(({ wet, transfer }) => wet && !transfer) ||
      mastCrossing && mastSeats.length < 2 };
}

function sitePileStations({ from, to }) {
  const count = Math.ceil((to - from) / 5.2);
  return Array.from({ length: count }, (_, i) => from + (to - from) * (i + 0.5) / count);
}

function drawSitePile(mesh, x, z, high, concrete, length = SITE_PILE_DISPLAY_LENGTH, radius = 0.25) {
  const low = high - length,
    ring = (j, y) => [x + radius * Math.cos(j * TAU / 12), y, z + radius * Math.sin(j * TAU / 12)];
  for (let j = 0; j < 12; j++) {
    mesh.quad(ring(j, low), ring(j, high), ring(j + 1, high), ring(j + 1, low), concrete);
    mesh.tri([x, high, z], ring(j + 1, high), ring(j, high), concrete);
    mesh.tri([x, low, z], ring(j, low), ring(j + 1, low), concrete);
  }
}

function drawSitePiledWall(mesh, at, tangent, run, terrain, top, concrete, cap, openings = [], bearings = []) {
  const level = (station) => Math.min(top - 0.18, siteTerrainHeight(terrain, ...at(station)) - SITE_PILE_CAP_COVER);
  function ribbon(width, bottom, crown, colour, { from, to } = run) {
    if (to - from < 0.001) return;
    const count = Math.ceil((to - from) / 0.85),
      closed = Math.hypot(...at(from).map((value, i) => value - at(to)[i])) < 1e-6;
    const profiles = Array.from({ length: count + 1 }, (_, i) => {
      const station = from + (to - from) * i / count, [x, z] = at(station), angle = tangent(station),
        dx = Math.sin(angle) * width / 2, dz = Math.cos(angle) * width / 2,
        lo = bottom(station), hi = crown(station);
      return [[x + dx, lo, z - dz], [x - dx, lo, z + dz], [x - dx, hi, z + dz], [x + dx, hi, z - dz]];
    });
    for (let i = 1; i < profiles.length; i++) {
      const a = profiles[i - 1], b = profiles[i];
      for (let j = 0; j < 4; j++) {
        const next = (j + 1) % 4;
        mesh.quad(a[j], b[j], b[next], a[next], colour);
      }
    }
    if (closed) return;
    mesh.quad(...profiles[0], colour);
    mesh.quad(...profiles.at(-1).slice().reverse(), colour);
  }
  mesh.mark('Site_Foundation_Stem_Walls', 'Landward reinforced-concrete stem wall');
  let start = run.from;
  for (const door of openings) {
    ribbon(0.36, level, () => top, concrete, { from: start, to: door.from });
    ribbon(0.36, level, () => door.sill - 0.025, concrete, door);
    ribbon(0.36, () => door.head, () => top, concrete, door);
    start = door.to;
  }
  ribbon(0.36, level, () => top, concrete, { from: start, to: run.to });
  mesh.mark('Site_Foundation_Pile_Caps', 'Continuous grade beam over piles');
  ribbon(SITE_PILE_CAP_WIDTH, (station) => level(station) - SITE_PILE_CAP_DEPTH, level, cap);
  mesh.mark('Site_Foundation_Piles', 'Schematic bored pile shafts below grade');
  const stations = [...bearings, ...sitePileStations(run).filter((station) => bearings.every((axis) => Math.abs(axis - station) > 1.6))];
  for (const station of stations) {
    const [x, z] = at(station);
    drawSitePile(mesh, x, z, level(station) - SITE_PILE_CAP_DEPTH, concrete);
  }
}

function drawSiteFoundations(mesh, model, plan, showRunwaySupports, canalDepth = 2, dryGeometry = null) {
  const { floor, foundation, terrain, water, radius, position, rows, columns, foundationRings } = plan,
    concrete = rgb('#b3b1a1'), stone = rgb('#a6a28f'), steel = rgb('#546e65'), paving = rgb('#c7c0aa'),
    rail = rgb('#475e57'), beamTop = floor - SITE_PLATFORM_BEAM_TOP;
  function pier([x, z], angle, top, piled = false, width = 0.56, ground = siteTerrainHeight(terrain, x, z)) {
    const footing = Math.min(ground - 0.58, top - 0.18), cap = piled ? 0.48 : 0.34, size = width + 0.62;
    mesh.box(x, footing - cap, z, piled ? 2.15 : size, cap, size, angle, stone, true);
    mesh.box(x, footing, z, width, top - footing, width, angle, concrete, true);
    if (piled) for (const side of [-1, 1])
      drawSitePile(mesh, x + side * Math.sin(angle) * 0.75, z - side * Math.cos(angle) * 0.75, footing - cap, concrete);
  }
  function girder(row, from, to, depth, colour, top = beamTop) {
    if (to - from < 0.05) return;
    const [x, z] = row.at((from + to) / 2);
    mesh.box(x, top - depth, z, depth > SITE_DRY_BEAM_DEPTH ? 0.72 : 0.39,
      depth, to - from, row.angle, colour, true);
  }
  function sector(inner, outer, bottom, depth, colour, from = 0, to = TAU) {
    const first = mesh.solid.length;
    mesh.sector(inner, outer, from, to, bottom, depth, colour);
    for (let i = first; i < mesh.solid.length; i += 10) {
      mesh.solid[i] += position[0];
      mesh.solid[i + 2] += position[1];
    }
  }
  function crosshead({ at: [x, z], angle, size, key, transfer }) {
    const top = plan.crossingSoffit, [px, pz] = transfer.at, depth = Math.min(0.52, transfer.depth);
    mesh.mark('Site_Core_Transfer_Crossheads', key);
    mesh.box(x, top - 0.18, z, size + 0.24, 0.18, size + 0.24, angle, steel, true);
    if (Math.hypot(px - x, pz - z) > 0.018)
      drawAssemblyMember(mesh, [x, top - depth / 2, z], [px, top - depth / 2, pz], size + 0.18, steel, depth);
  }
  const platformStart = mesh.solid.length;
  mesh.mark('Site_Foundation_Platform', 'Dry ground floor and arrival promenade');
  const storey = buildStorey(model, 0);
  sector(model.r, model.R, beamTop, SITE_PLATFORM_BEAM_TOP - (storey.base - storey.underside), concrete);
  sector(model.R, radius, beamTop, SITE_PLATFORM_BEAM_TOP, paving);
  if (dryGeometry) dryGeometry.trimMesh(mesh, platformStart);
  if (model.greenhouse) {
    const start = mesh.solid.length, underside = foundation + storey.underside;
    mesh.mark('Site_Atrium_Subbase', 'Slab-on-grade on compacted granular base');
    sector(0, model.r, underside - 0.31, 0.31, stone);
    if (dryGeometry) dryGeometry.trimMesh(mesh, start);
    const fillStart = mesh.solid.length, top = underside - 0.31,
      boundary = Array.from({ length: 96 }, (_, i) => siteLine(position, i * TAU / 96)(model.r)),
      at = ([x, z]) => [x, top, z], grade = ([x, z]) => [x, Math.min(top - 0.015, siteTerrainHeight(terrain, x, z)), z],
      centre = at(position), centreGrade = grade(position), gravel = rgb('#a79d84');
    mesh.mark('Site_Atrium_Engineered_Fill', 'Localized fill brings solid ground up to the subbase');
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i], b = boundary[(i + 1) % boundary.length];
      mesh.tri(at(b), at(a), centre, gravel);
      mesh.tri(grade(a), grade(b), centreGrade, gravel);
      mesh.quad(at(a), at(b), grade(b), grade(a), gravel);
    }
    if (dryGeometry) dryGeometry.trimMesh(mesh, fillStart);
  }
  const ringsStart = mesh.solid.length;
  mesh.mark('Site_Foundation_Ring_Girders', 'Annular collectors below the permanent core');
  for (const { radius: r } of foundationRings)
    sector(r - 0.24, r + 0.24, beamTop - 0.25, 0.25, concrete);
  if (dryGeometry) dryGeometry.trimMesh(mesh, ringsStart);
  const radialsStart = mesh.solid.length;
  mesh.mark('Site_Foundation_Radials', 'Straight ground deck beams between the two grade beam rings');
  for (const axis of plan.grid.axes) {
    const angle = axis.angle + plan.angle, reach = plan.grid.outer - plan.grid.inner,
      [x, z] = siteLine(position, angle)(plan.grid.inner + reach / 2);
    mesh.box(x, beamTop - SITE_DRY_BEAM_DEPTH, z, 0.24, SITE_DRY_BEAM_DEPTH, reach, angle, concrete);
  }
  if (dryGeometry) dryGeometry.trimMesh(mesh, radialsStart);
  if (plan.mastRadius && !plan.mastCrossing) {
    const capRadius = plan.mastRadius + 1.25, capDepth = 1.22, foot = foundation - capDepth - 0.27;
    mesh.mark('Site_Mast_Pile_Cap', 'Independent reinforced cap and mast anchor ring');
    sector(0, capRadius, foot, capDepth, concrete);
    sector(plan.mastRadius * 0.70, plan.mastRadius + 0.36, foundation - 0.27, 0.30, steel);
    mesh.mark('Site_Mast_Piles', 'Schematic group for mast gravity, overturning and uplift');
    for (let k = 0; k < 8; k++) {
      const [x, z] = siteLine(position, k * TAU / 8)(capRadius - 0.69);
      drawSitePile(mesh, x, z, foot, concrete, 5.4, 0.36);
    }
  } else if (plan.mastCrossing && plan.mastSeats.length >= 2) {
      const [x, z] = position, top = plan.crossingSoffit;
      mesh.mark('Site_Mast_Transfer', 'Mast anchor ring and transverse grillage carried to dry banks');
      sector(0, plan.mastRadius + 0.45, top - 0.18, 0.26, steel);
      for (const row of plan.mastSeats) {
        const [px, pz] = row.at(0);
        if (Math.hypot(px - x, pz - z) > 0.02)
          drawAssemblyMember(mesh, [x, top - 0.23, z], [px, top - 0.23, pz], 0.55, steel, 0.42);
      }
  }
  for (const ring of foundationRings) for (const run of ring.runs) {
    const bearings = columns.filter(({ side, station }) => side === ring.side && station >= run.from && station <= run.to),
      doors = ring.side === 'outer' ? plan.lowerRooms.map(({ door }) => door)
        .filter(({ from, to }) => from >= run.from && to <= run.to).sort((a, b) => a.from - b.from) : [];
    drawSitePiledWall(mesh, ring.at, (station) => plan.angle + station / ring.radius + Math.PI / 2,
      run, terrain, beamTop - 0.25, concrete, stone, doors, bearings.map(({ station }) => station));
  }
  for (const column of columns) {
    const { at: [x, z], angle, size, side, station, transfer } = column;
    if (transfer) {
      crosshead(column);
    } else if (!column.wet) {
      mesh.mark('Site_Foundation_Column_Bearings', column.key);
      const ring = foundationRings.find((ring) => ring.side === side),
        continuous = ring.runs.some(({ from, to }) => station >= from && station <= to);
      if (continuous) {
        const bottom = Math.min(beamTop - 0.25, foundation - 0.12);
        mesh.box(x, bottom, z, size + 0.10, foundation - bottom + 0.04, size + 0.10, angle, concrete, true);
      } else {
        pier([x, z], angle, foundation + 0.04, true, size + 0.14);
      }
    }
  }
  if (plan.crane?.runway === 'cantilever') {
    mesh.mark('Site_Foundation_Hold_Down_Ties', 'Radial ties between piled crane compression and hold-down bearings');
    for (const axis of plan.grid.axes.filter(({ angle }) => plan.crane.supports.includes(angle))) {
      const legs = columns.filter((column) => column.axis === axis);
      if (legs.length !== 2 || legs.some(({ wet }) => wet)) continue;
      const [a, b] = legs.map(({ at: [x, z] }) => [x, Math.min(foundation - 0.55, siteTerrainHeight(terrain, x, z) - 0.75), z]);
      drawAssemblyMember(mesh, a, b, 0.82, concrete, 0.59);
    }
  }
  for (const { radius, start, end, wet, ends } of plan.lateralBays) {
    const top = wet ? plan.crossingSoffit : foundation, depth = wet ? 0.46 : 0.63;
    mesh.mark('Site_Foundation_Lateral_Cores', wet ? 'Transfer collector under the lateral bay' : 'Piled grade beam below the lateral bay');
    sector(radius - 0.38, radius + 0.38, top - depth, depth, wet ? steel : concrete, start + plan.angle, end + plan.angle);
    for (const leg of ends) {
      if (leg.transfer) crosshead(leg);
      else if (!leg.wet) pier(leg.at, leg.angle, top - depth + 0.02, true, 0.67);
    }
  }
  for (const row of rows) {
    for (const span of row.transfers) {
      mesh.mark('Site_Transfer_Girders', 'Bank-to-bank transfer span');
      girder(row, span.from, span.to, span.depth, steel, plan.crossingSoffit);
      mesh.mark('Site_Foundation_Bank_Bents', 'Dry-bank bearings on schematic capped piles');
      for (const at of [span.from, span.to]) pier(row.at(at), row.angle, plan.crossingSoffit - span.depth, true, 0.69);
    }
  }
  const { moat } = plan;
  if (showRunwaySupports) {
    const runway = moat ? moat.runway : plan.runway, head = moat ? foundation + model.crane.groundRail : runway.head,
      baseDepth = moat ? 0.32 : CRANE_ELEVATED_GIRDER_DEPTH,
      spanDepth = (span) => moat ? Math.min(span.depth, head - moat.level - 0.28) : span.depth;
    mesh.mark('Site_Foundation_Runway_Piers', 'Piled supports step to the local surface under the level rails');
    for (const angle of runway.poles) for (const radius of runway.radii) {
      const point = siteLine(position, angle)(radius), span = runway.spans.find(({ from, to }) =>
        angDist(from, angle) < 1e-6 || angDist(to, angle) < 1e-6),
        bed = moat ? Math.min(siteTerrainHeight(terrain, ...point), moat.level - (moat.connected ? canalDepth : MOAT_BED_DEPTH)) : undefined;
      pier(point, angle, head - (span ? Math.max(baseDepth, spanDepth(span)) : baseDepth), true, moat ? 0.48 : 0.64, bed);
    }
    mesh.mark('Site_Foundation_Runway_Transfers', 'Local strengthening between bank supports at channel openings');
    for (const span of runway.spans) for (const radius of runway.radii) {
      const depth = spanDepth(span) - baseDepth;
      if (depth > 0.03) sector(radius - 0.36, radius + 0.36, head - spanDepth(span), depth, steel, span.from, span.to);
    }
  }
  const atStation = (route, station, across, y) => {
    const [x, z] = route.at(station);
    return [x - Math.sin(route.angle) * across, y, z + Math.cos(route.angle) * across];
  };
  function slab(route, a, y, b, next) {
    const halfA = (route.arrival ? elevatedArrivalWidth(route.arrival, a) : route.width) / 2,
      halfB = (route.arrival ? elevatedArrivalWidth(route.arrival, b) : route.width) / 2,
      p = atStation(route, a, -halfA, y), q = atStation(route, a, halfA, y),
      r = atStation(route, b, halfB, next), s = atStation(route, b, -halfB, next),
      lower = ([x, y, z]) => [x, y - SITE_APPROACH_DECK_DEPTH, z];
    if (b - a < 1e-5) {
      // A stair riser is vertical at the end of the tread.
      mesh.quad(p, q, r, s, paving);
      return;
    }
    mesh.quad(p, q, r, s, paving);
    mesh.quad(lower(s), lower(r), lower(q), lower(p), paving);
    mesh.quad(lower(p), p, s, lower(s), concrete);
    mesh.quad(lower(q), lower(r), r, q, concrete);
    mesh.quad(lower(p), lower(q), q, p, concrete);
    mesh.quad(lower(s), s, r, lower(r), concrete);
  }
  for (const room of plan.lowerRooms) {
    const { inner, outer, from, to, level, ceiling } = room;
    mesh.mark('Site_Lower_Programme', 'Additional dry programme beneath the raised core');
    sector(inner, outer + 0.2, level - 0.24, 0.24, rgb('#ac8d6f'), from, to);
    sector(inner, inner + 0.20, level, ceiling - level, concrete, from, to);
    for (const angle of [from, to]) {
      const [x, z] = siteLine(position, angle)((inner + outer) / 2);
      mesh.box(x, level, z, 0.2, ceiling - level, outer - inner, angle, concrete, true);
    }
    mesh.mark('Site_Lower_Programme_Door', 'Recessed lower-level entrance and threshold');
    const [x, z] = room.at(outer + 0.18), { sill, head } = room.door;
    mesh.box(x, sill, z, 1.83, 0.07, 0.34, room.angle, steel);
    mesh.box(x, head - 0.07, z, 1.83, 0.07, 0.23, room.angle, steel);
    const route = { ...room.route, width: 1.9 };
    slab(route, outer, level, route.nodes[0][0], level);
  }
  const { boatBay } = plan;
  if (boatBay) {
    const { back, rim, point, halfWidth, angle, crewSide, level, dryRear } = boatBay,
      deck = level + 0.48, ceiling = plan.crossingSoffit,
      quayEdge = crewSide * (halfWidth - 1.50), apron = crewSide * (halfWidth + 0.85),
      box = (along, across, y, width, height, length, color) => {
        const [x, z] = point(along, across);
        mesh.box(x, y, z, width, height, length, angle, color, true);
      };
    mesh.mark('Site_Firehall_Boat_Garage', 'Water-level firehall bay and crew quay under the core');
    const portal = model.R - 0.10, jamb = Math.min(0.74, ceiling - level - water.clearance);
    if (jamb > 0.28) {
      box(portal, 0, ceiling - 0.28, halfWidth * 2 + 0.28, 0.28, 0.36, steel);
      for (const side of [-1, 1]) box(portal, side * halfWidth, ceiling - jamb, 0.25, jamb, 0.36, steel);
    }
    box((rim + back) / 2, (quayEdge + apron) / 2, deck - 0.24, Math.abs(apron - quayEdge) + 1.25, 0.24, rim - back, paving);
    for (const side of [-1, 1]) {
      const edge = side * (halfWidth + (side === crewSide ? 1.44 : 0.13)),
        face = Math.min(model.R - 0.1, rim - 1);
      if (!water.overlaps(point((back + face) / 2, edge), 0.18))
        box((back + face) / 2, edge, deck - 0.24, 0.26, ceiling - deck + 0.24, face - back, concrete);
    }
    if (dryRear) box(back - 0.18, 0, deck - 0.24, halfWidth * 2, ceiling - deck + 0.24, 0.36, concrete);
    for (const along of [back + 0.8, back + (rim - back) / 2, rim - 0.65])
      box(along, quayEdge + crewSide * 0.16, deck, 0.14, 0.28, 0.2, steel);
    if (boatBay.gangway) {
      const gangway = boatBay.gangway, { distance, landing } = gangway,
        steps = Math.max(1, Math.ceil((landing - deck) / 0.165));
      for (let i = 0; i < steps; i++) {
        const a = distance * i / steps, b = distance * (i + 1) / steps,
          y = deck + (landing - deck) * i / steps, next = deck + (landing - deck) * (i + 1) / steps;
        slab(gangway, a, y, a, next);
        slab(gangway, a, next, b, next);
      }
    } else if (boatBay.route) {
      const rise = boatBay.landing - deck, steps = Math.max(1, Math.ceil(rise / 0.165));
      for (let i = 0; i < steps; i++) {
        const y = deck + rise * (i + 1) / steps;
        box(rim - 0.3 * (steps - i - 0.5), apron, deck - 0.12, 1.9, y - deck + 0.12, 0.30, paving);
      }
    }

    mesh.mark('Site_Firehall_Rescue_Boat', 'Schematic fire rescue boat at the wet berth');
    const center = (back + rim) / 2, across = -crewSide * 0.55, length = Math.min(5.6, rim - back - 0.65),
      hull = [[-0.49, -0.99], [-0.49, 0.99], [0.28, 0.99], [0.5, 0], [0.28, -0.99]],
      hullPoint = ([u, v], y, scale = 1) => {
        const [x, z] = point(center + u * length * scale, across + v * scale);
        return [x, y, z];
      }, red = rgb('#935b4c'), white = rgb('#d1c7ad');
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      mesh.quad(hullPoint(a, level - 0.22, 0.79), hullPoint(b, level - 0.22, 0.79),
        hullPoint(b, level + 0.31), hullPoint(a, level + 0.31), red);
      mesh.tri(hullPoint([0, 0], level + 0.31), hullPoint(b, level + 0.31), hullPoint(a, level + 0.31), white);
    }
    box(center + length * 0.03, across, level + 0.30, 1.0, 0.79, Math.min(1.25, length / 3), red);
  }
  for (const access of plan.accesses) {
    mesh.mark('Site_Access_Lobby_Walks', 'Graded approaches to the ground-floor lobbies');
    for (const route of access.innerWalk ? [access.innerWalk, access] : [access]) {
      for (let i = 1; i < route.nodes.length; i++) {
        const [a, y] = route.nodes[i - 1], [b, h] = route.nodes[i];
        slab(route, a, y, b, h);
      }
    }
    for (const [court, geometry] of access.courts ?? [])
      drawElevatedArrivalCourt(mesh, geometry, (station) => siteWalkHeight(access.nodes, station), plan.position, 'Site_Entrance_Plaza', court);
  }
  const extraAccess = [...plan.lowerRooms.map(({ route }) => route), ...(boatBay?.route ? [boatBay.route] : [])];
  for (const route of extraAccess) {
    const [[start, top], ...nodes] = route.nodes, [end] = nodes.at(-1),
      stairs = route.kind === 'stair';
    mesh.mark(stairs ? 'Site_Access_Stairs' : 'Site_Access_Ramps',
      stairs ? 'Lower-level service stair to grade' : 'Lower-level ramp and landings to grade');
    for (const [i, [b, y]] of nodes.entries()) {
      const [a, before] = i ? nodes[i - 1] : [start, top];
      slab(route, a, before, b, y);
    }
    mesh.mark('Site_Access_Handrails');
    const sides = [-route.width / 2 + 0.055, route.width / 2 - 0.055];
    for (const side of sides) {
      let previous = null;
      const steps = Math.ceil((end - start) / 1.75);
      for (let i = 0; i <= steps; i++) {
        const station = start + (end - start) * i / steps;
        const next = route.nodes.findIndex(([r]) => r > station);
        const [a, y] = route.nodes[next === -1 ? route.nodes.length - 2 : next - 1],
          [b, h] = route.nodes[next === -1 ? route.nodes.length - 1 : next],
          height = y + (h - y) * clamp((station - a) / Math.max(0.001, b - a), 0, 1);
        const foot = atStation(route, station, side, height + 0.02),
          hand = atStation(route, station, side, height + 1.02);
        drawAssemblyMember(mesh, foot, hand, 0.052, rail);
        if (previous) drawAssemblyMember(mesh, previous, hand, 0.047, rail);
        previous = hand;
      }
    }
    mesh.mark('Site_Foundation_Access_Piers', 'Dry supports under the access landing and flights');
    for (const [station, y] of route.nodes.filter(([station], i, all) =>
      i === 0 || (i < all.length - 1 && i % Math.max(1, Math.ceil(all.length / Math.max(1, (end - start) / 5))) === 0))) {
      const point = route.at(station);
      if (!water.overlaps(point, 0.9) && y - 0.30 > siteTerrainHeight(terrain, ...point))
        pier(point, route.angle, y - 0.22, false, 0.29);
    }
  }
  if (moat) {
    const { inner, outer } = moat,
      bankHeight = (point) => Math.max(moat.level + 0.28, siteTerrainHeight(terrain, ...point));
    mesh.mark('Site_Moat_Guards', 'Bank guards stop at the canal openings and drawbridge landings');
    for (const bank of [inner - 0.12, outer + 0.12]) {
      const count = Math.ceil(TAU * bank / 2.65), point = (angle) => siteLine(position, angle)(bank), openings = [plan.accessAngle, plan.accessAngle + Math.PI];
      for (let i = 0; i < count; i++) {
        const a = i * TAU / count, b = (i + 1) * TAU / count, p = point(a), q = point(b);
        if (openings.some((angle) => angDist((a + b) / 2, angle) * bank < MOAT_BRIDGE_WIDTH / 2 + 1.25) ||
            water.overlaps(p, 0.3) || water.overlaps(q, 0.3) || water.overlaps(point((a + b) / 2), 0.35)) continue;
        const low = bankHeight(p), next = bankHeight(q);
        mesh.box(p[0], low, p[1], 0.075, 1.04, 0.075, a, rail);
        for (const y of [0.44, 1.04])
          drawAssemblyMember(mesh, [p[0], low + y, p[1]], [q[0], next + y, q[1]], 0.047, rail);
      }
    }
    if (showRunwaySupports) {
      mesh.mark('Site_Access_Moat_Approaches', 'Foundations at the drawbridge approaches');
      for (const angle of [plan.accessAngle, plan.accessAngle + Math.PI]) {
        for (const station of [inner - 0.65, outer + 0.65]) for (const offset of [-3.6, 3.6]) {
          const point = siteLine(position, angle, offset)(station);
          if (!water.overlaps(point, 1.35)) pier(point, angle, foundation - 1.42, true, 0.88);
        }
      }
    }
  }
}

function siteFoundationAxo(model, plan, surface, canalDepth) {
  const mesh = meshBuilder(), [x, z] = plan.position,
    reach = Math.max(plan.radius, ...plan.rows.flatMap((row) => row.transfers.flatMap(({ from, to }) =>
      [Math.hypot(row.offset, from), Math.hypot(row.offset, to)]))) + 9,
    limits = [
      { x: 1, y: 0, z: 0, level: x + reach }, { x: -1, y: 0, z: 0, level: -x + reach },
      { x: 0, y: 0, z: 1, level: z + reach }, { x: 0, y: 0, z: -1, level: -z + reach }
    ],
    water = siteWaterStudy(plan.terrain, surface, 1);
  if (water) {
    // Cut the same registered water and banks to the local view. Omit the solid earth surface to reveal the piles.
    const faces = water.faces.map((face) => ({ ...face, polygon: limits.reduce(clipDrawingPolygon, face.polygon) }))
        .filter(({ polygon }) => polygon.length >= 3),
      banks = water.banks.flatMap(({ line, kind }) => {
        const clipped = clipDrawingLine(...line, limits);
        return clipped ? [{ line: clipped, kind }] : [];
      });
    addSiteWater(mesh, plan.terrain, { faces, banks }, { showWater: true, canalDepth });
  }
  drawSiteFoundations(mesh, model, plan, false, canalDepth, siteCanalOpening(plan));

  mesh.mark('Site axonometric grade', 'Dashed local grade at the concrete stem walls');
  const grade = rgb('#6d6757');
  for (const ring of plan.foundationRings) {
    for (const { from, to } of ring.runs) {
      const at = (station, side) => {
        const [x, z] = ring.at(station), angle = station / ring.radius + plan.angle,
          px = x + side * 0.20 * Math.cos(angle), pz = z + side * 0.20 * Math.sin(angle);
        return [px, siteTerrainHeight(plan.terrain, px, pz) + 0.025, pz];
      };
      for (let station = from; station < to - 0.15; station += 1.3)
        for (const side of [-1, 1]) mesh.line(at(station, side), at(Math.min(station + 0.73, to), side), grade);
    }
  }
  for (const vertices of [mesh.solid, mesh.glass, mesh.lines]) {
    for (let i = 0; i < vertices.length; i += 10) {
      vertices[i] -= x;
      vertices[i + 1] -= plan.foundation;
      vertices[i + 2] -= z;
    }
  }
  return { mesh, reach };
}

function siteStructuralCut(plan, dockStructure) {
  const { grid, crane, floor, foundation, roofLevel } = plan,
    ranked = grid.axes.filter(({ active }) => active.inner && active.outer).map((axis) => {
      const bearings = plan.columns.filter((column) => column.axis === axis),
        wet = bearings.filter(({ wet }) => wet).length,
        bent = Boolean(crane?.supports.includes(axis.angle)), floors = plan.dockFloors.get(axis.j) ?? [],
        dockFloor = floors.includes(1) ? 1 : floors[0];
      return { axis, bearings, wet, bent, dockFloor, rank: wet * 4 + Number(!bent) * 2 + Number(dockFloor === undefined) };
    }).sort((a, b) => a.rank - b.rank)[0];
  if (!ranked) return null;
  const { axis, bearings, wet, bent, dockFloor } = ranked, angle = axis.angle + plan.angle,
    roof = foundation + (bent ? crane.roofRail : roofLevel), top = roof + 0.55,
    deck = floor + (dockFloor ?? 0) * plan.pitch,
    dockPaths = {
      'side-truss': ['Side truss roots feed the jambs.', 'The chord couple resolves into the', 'two floor rings and radial beams.'],
      'side-portal': ['Portal frames feed the dock jambs.', 'Rigid frame joints carry shear and', 'return the root moment into the ring.'],
      'box-floor': ['The box floor returns shear and', 'bending through its root seats into', 'the perimeter and radial beam grid.'],
      'cable-stayed': ['The upper anchor takes tension.', 'The lower seat returns compression.', 'Both meet the diaphragm at the jamb.'],
      'roof-hung': ['The hangers lift the dock tips.', 'Roof backspans return the reaction', 'to the inner and outer stacks.'],
      columns: ['Tip posts bear at the plaza edge.', 'Roots take lateral loads into the core.', 'Wet bays use side trusses.']
    },
    notes = [
      ['Roof and columns', ...(bent ? ['Roof rail loads land on this bent.', 'The posts share the dock-jamb axes.'] :
        ['Inner and perimeter stacks share', 'a single dock-divider axis.'])],
      ['Dock reactions', ...dockPaths[dockStructure]],
      ['Lateral load path', 'Radial beams tie the ring girders.', 'Slab diaphragms carry sideways', 'forces to the paired lift cores.'],
      [wet ? 'Canal transfer' : 'Foundation', ...(wet ? ['Interrupted stacks bear on steel', 'crossheads and dry-bank girders.'] :
        ['Aligned bases bear on grade beams', 'or individual caps over study piles.'])]
    ];
  if (bent && crane.runway === 'cantilever') notes[0].push('The inner rail picks up uplift.');
  else if (bent) notes[0].push('The outboard rail has its own piers.');
  const from = -Math.max(5, plan.mastRadius + 2.2), to = crane?.groundRail != null
    ? crane.tower + 5 : grid.outer + BUILD_SECTION.dockGap + MODULE.depth + 5;
  const arrows = bearings.flatMap(({ side, wet }) => {
    const r = grid[side], foot = wet ? plan.crossingSoffit : foundation - 0.28, x = r + (side === 'inner' ? -0.62 : 0.62),
      uplift = bent && side === 'inner' && crane.runway === 'cantilever';
    const arrow = (a, b) => uplift ? [b, a, 'lateral'] : [a, b, 'gravity'];
    return [arrow([x, roof - 0.24], [x, roof - 3.3]), arrow([x, foot + 2.5], [x, foot - 0.14])];
  });
  const dockTip = grid.outer + BUILD_SECTION.dockGap + MODULE.depth - 0.5, dockMiddle = (dockTip + grid.outer) / 2;
  arrows.push([[grid.outer - 0.8, deck - 0.55], [grid.inner + 0.6, deck - 0.55], 'lateral']);
  if (dockFloor !== undefined) {
    arrows.push([[dockMiddle, deck + 2.5], [dockMiddle, deck + 0.75], 'gravity']);
    if (dockStructure === 'cable-stayed')
      arrows.push([[dockTip - 1.6, deck + 0.2], [grid.outer + 0.8, deck + plan.pitch - 0.65], 'lateral']);
    else if (dockStructure === 'roof-hung') {
      const collector = foundation + roofLevel - 0.62;
      arrows.push([[dockTip, deck + 0.45], [dockTip, collector + 0.8], 'lateral'],
        [[grid.outer - 0.9, collector], [grid.inner + 0.55, collector], 'lateral']);
    } else if (dockStructure === 'columns' && !plan.wetBays.has(axis.j)) {
      const tipGrade = siteTerrainHeight(plan.terrain, ...siteLine(plan.position, angle)(dockTip));
      arrows.push([[dockTip, Math.max(deck - 0.32, tipGrade + 0.65)], [dockTip, tipGrade - 0.24], 'gravity']);
    } else arrows.push([[dockMiddle - 0.5, deck - 0.48], [grid.outer + 0.55, deck - 0.48], 'lateral']);
  }
  return { kind: 'structural-axis', title: 'Structural load path · Dock, runway and core',
    note: `Section on dock-divider axis ${axis.j + 1}. Arrows show the direction of load transfer.`,
    at: siteLine(plan.position, angle), angle, from, to, crown: top, belowGrade: SITE_PILE_DISPLAY_LENGTH + 2.3, notes, arrows };
}

function siteSectionCuts(plan, dockStructure = 'side-truss') {
  const { rows, crossingOffset, radius, accesses } = plan,
    row = rows.find((item) => item.offset === crossingOffset && item.transfers.length) ??
      rows.find((item) => item.transfers.length) ?? rows.find((item) => item.offset === crossingOffset) ?? rows[0],
    channel = row.transfers.length > 0,
    foundation = {
      kind: 'foundation',
      title: channel ? 'Canal crossing and foundations' : 'Core foundations and site grade',
      note: channel ? 'The first elevated deck bridges the canal. The ground storey remains open where the water passes through.'
        : plan.anchor ? 'The section shows the water crossing where dry-bank supports are unresolved.'
          : 'Pile-supported concrete walls follow the grade beneath the level ground floor.',
      at: row.at, angle: row.angle, from: Math.min(-radius - 9, ...row.transfers.map((span) => span.from - 7)),
      to: Math.max(radius + 9, ...row.transfers.map((span) => span.to + 7))
    };
  const cuts = [foundation];
  if (channel) {
    const span = row.transfers.reduce((a, b) => a.to - a.from >= b.to - b.from ? a : b);
    const underside = plan.crossingSoffit - span.depth, clearance = underside - plan.water.level,
      [a, b] = plan.water.spans(row.at, span.from, span.to)
        .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? [span.from, span.to];
    cuts.push({ kind: 'canal-detail', title: 'Canal crossing · Bank bearings and girder',
      note: `Study span ${(span.to - span.from).toFixed(1)} m between dry-bank bearings. Clear height above the study water level is ${clearance.toFixed(1)} m.`,
      at: row.at, angle: row.angle, from: span.from - 8, to: span.to + 8, crown: plan.crossingDeck + 1.55,
      clearance: { station: (a + b) / 2, underside, height: clearance } });
  }
  const indoor = plan.lookouts.find(({ type }) => type !== 'dock'), outdoor = plan.lookouts.find(({ type }) => type === 'dock'),
    upperFloor = plan.floor + plan.pitch;
  for (const lookout of [indoor, outdoor].filter(Boolean)) {
    const outside = lookout === outdoor,
      station = outside ? 0.15 : (lookout.start + lookout.end) / 2 + 0.24,
      [x, , z] = canalLookoutPoint(lookout, station, 0, 0),
      c = Math.cos(plan.angle), s = Math.sin(plan.angle), [px, pz] = plan.position,
      angle = plan.angle + lookout.angle + (lookout.side < 0 ? Math.PI : 0) +
        (lookout.type === 'ring' ? station / lookout.root : 0),
      at = siteLine([px + x * c - z * s, pz + x * s + z * c], angle);
    cuts.push({ kind: outside ? 'canal-lookout-open-air' : 'canal-lookout',
      title: `${outside ? 'Open-air' : 'Atrium'} canal lookout · First elevated level`,
      note: outside ? 'The public ring corridor opens onto an outdoor dock deck with a view to the canal.'
        : 'The public route opens onto a flush viewing bay with framed glass over the canal.',
      at, angle, from: -7, to: outside ? lookout.depth + 4 : 9, crown: upperFloor + 2.7,
      labels: [[outside ? (lookout.glassFrom + lookout.glassTo) / 2 : 1.35, upperFloor, 'Walk-on glass', -40],
        [outside ? lookout.glassFrom - 0.4 : 0.38, upperFloor - 0.24, outside ? 'Dock deck frame' : 'Cantilevered floor frame', 37]] });
  }
  const structural = siteStructuralCut(plan, dockStructure);
  if (structural) cuts.push(structural);
  const bearing = plan.columns.find(({ wet, side, station }) => !wet && side === 'outer' &&
    plan.perimeter.runs.some(({ from, to }) => station >= from + 0.3 && station <= to - 0.3));
  if (bearing) {
    const { angle } = bearing, at = siteLine(plan.position, angle), edge = plan.grid.outer,
      crown = plan.floor - SITE_PLATFORM_BEAM_TOP - 0.25,
      cap = Math.min(crown - 0.18, siteTerrainHeight(plan.terrain, ...bearing.at) - SITE_PILE_CAP_COVER),
      capY = cap - SITE_PILE_CAP_DEPTH / 2;
    cuts.push({ kind: 'piled-detail', title: 'Landward foundation · Stem wall and piles',
      note: 'A piled grade beam receives the column on the same axis. Pile lengths are shown schematically.',
      at, angle, from: edge - 8, to: edge + 7, crown: plan.floor + 2.25, belowGrade: SITE_PILE_DISPLAY_LENGTH + 1.8,
      labels: [
        [edge, plan.floor + 1.25, 'Stacked dock-jamb column'],
        [edge, (cap + crown) / 2, 'Concrete stem wall'],
        [edge, capY, 'Pile-supported grade beam'],
        [edge, cap - SITE_PILE_CAP_DEPTH - SITE_PILE_DISPLAY_LENGTH / 2, 'Schematic pile shaft']
      ] });
  }
  if (plan.mastRadius > 0) {
    const mastRow = [...plan.mastSeats].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))[0],
      at = mastRow?.at ?? siteLine(plan.position, 0), angle = mastRow?.angle ?? 0,
      span = mastRow?.transfers.find(({ from, to }) => from < 0 && to > 0),
      reaches = [plan.grid.inner + 4, Math.abs(span?.from ?? 0) + 4, (span?.to ?? 0) + 4],
      mastBase = plan.mastCrossing ? plan.crossingSoffit : plan.foundation, unresolved = plan.mastCrossing && plan.mastSeats.length < 2,
      atrium = [-0.67, 0.67, 0.83, -0.83].map((part) => plan.grid.inside * part)
        .find((station) => !plan.water.overlaps(at(station), 0.5)),
      bank = span?.to ?? 0, pileLabel = plan.mastCrossing && span
        ? siteTerrainHeight(plan.terrain, ...at(bank)) - 2.1 : mastBase - 4.7;
    cuts.push({ kind: 'mast-foundation', title: 'Swing mast and greenhouse foundations',
      note: unresolved ? 'This placement still needs a transfer span to support the mast from the dry banks.'
        : plan.mastCrossing ? 'The mast transfers across the open channel to the dry banks. The atrium slab bears on dry ground.'
        : 'The mast has its own anchored cap. The greenhouse floor bears on compacted granular fill.',
      at, angle, from: -Math.max(reaches[0], reaches[1]), to: Math.max(reaches[0], reaches[2]),
      crown: Math.max(plan.floor, mastBase) + 4.25, belowGrade: 7.9,
      labels: [
        [0, mastBase + 2.0, 'Fixed steel mast'],
        ...(!unresolved ? [
          [plan.mastRadius, mastBase - 0.08, plan.mastCrossing ? 'Mast seat and transfer grillage' : 'Anchor ring on independent cap'],
          [bank, pileLabel, plan.mastCrossing ? 'Dry-bank pile group' : 'Schematic mast pile group']
        ] : []),
        ...(atrium === undefined ? [] : [[atrium, plan.floor - 0.27, 'Atrium slab and granular subbase', -25]])
      ] });
  }
  if (plan.boatBay) {
    const bay = plan.boatBay;
    cuts.push({ kind: 'boat-garage', title: 'Firehall · Canal inlet and boat garage',
      note: `${Math.round(bay.area)} m² covered wet bay in the additional site programme. The rescue boat enters directly from the canal.`,
      at: bay.at, angle: bay.angle, from: bay.back - 4, to: bay.end + 9, crown: plan.crossingDeck + 1.2,
      labels: [
        [bay.rim - 3.5, plan.crossingSoffit, 'First elevated deck above the slip'],
        [(bay.back + bay.rim) / 2, bay.level + 0.88, 'Rescue boat and crew quay'],
        [bay.end + 0.6, bay.level - 0.3, 'Canal water entering the bay']
      ] });
  }
  if (plan.lowerRooms.length) {
    const [room] = plan.lowerRooms, area = plan.lowerRooms.reduce((sum, bay) => sum + bay.area, 0);
    cuts.push({ kind: 'lower-programme', title: 'Landward core · Additional lower-level programme',
      note: `${Math.round(area)} m² of dry lower-level space tracked separately from the building programme.`,
      at: room.at, angle: room.angle, from: room.inner - 3, to: room.route.nodes.at(-1)[0] + 4, crown: plan.floor + 1.2,
      labels: [
        [(room.inner + room.outer) / 2, (room.ceiling + room.level) / 2, 'Dry lower-level programme'],
        [room.outer + 1.7, room.level - 0.12, 'Approach from local grade']
      ] });
  }
  return [...cuts, ...accesses.map((route) => {
    const [end] = route.nodes.at(-1), lobby = route.entrance ? 'Opposite lobby' : 'Main lobby';
    return {
      kind: 'approach',
      title: `${lobby} · Ground-level approach`,
      note: route.innerWalk ? 'The graded walk meets the ground-floor lobby via the closed drawbridge.'
        : route.arrival ? 'The ground-level walk runs from the outer forecourt under the elevated track to the lobby.'
        : 'The graded walk meets the ground-floor lobby with a level landing and a maximum study slope of 1:20.',
      at: route.at, angle: route.angle, from: (route.innerWalk ?? route).threshold - 2.5, to: end + 4,
      crown: Math.max(plan.floor, ...route.nodes.map(([, y]) => y), route.arrival ? plan.runway.head : -Infinity) + 2.4,
      elevatedArrival: Boolean(route.arrival)
    };
  })];
}

function siteDistrictCut(plan, surface, registration) {
  if (!surface) return null;
  const [x, z] = plan.position, [cutX, avenueZ] = westVillageTenthAvenue(x, registration),
    angle = Math.PI / 2, offset = x - cutX, at = siteLine(plan.position, angle, offset),
    avenue = avenueZ - z, half = plan.terrain.size / 2,
    water = siteFoundationWater(surface, plan.position, plan.terrain.size * 2),
    river = siteFoundationWater({ existing: surface.existing }, plan.position, plan.terrain.size * 2)
      .spans(at, Math.max(avenue, -half - z), half - z)
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  if (!river) return null;
  water.level = plan.water.level;
  const shifted = Math.abs(offset) > 0.1;
  return {
    kind: 'district', title: 'Bow River to 10 Avenue SW',
    note: `North–south section looking west${shifted ? ' through the nearest mapped avenue crossing' : ' through the building placement'}.`,
    at, angle, water, avenue, river: (river[0] + river[1]) / 2,
    from: Math.max(-half - z, Math.min(avenue - 22, -plan.contextReach - 8)),
    to: Math.min(half - z, Math.max(river[1] + 22, plan.contextReach + 8))
  };
}

function siteSectionGround(plan, cut, canalDepth) {
  const { at, from, to, water = plan.water } = cut, { terrain, moat } = plan,
    ground = (station) => siteTerrainHeight(terrain, ...at(station)),
    district = water.spans(at, from, to), reaches = [];
  if (moat) {
    const basin = moat.footprint.spans(at, from, to);
    if (moat.connected) district.push(...basin);
    else reaches.push(...basin.map(([start, end]) => ({ start, end, level: moat.level, depth: MOAT_BED_DEPTH })));
  }
  for (const [start, end] of district.sort((a, b) => a[0] - b[0])) {
    const last = reaches.at(-1);
    if (last?.level === water.level && start <= last.end + 0.025) last.end = Math.max(end, last.end);
    else reaches.push({ start, end, level: water.level, depth: canalDepth });
  }
  const stops = [...new Set([from, to, ...reaches.flatMap(({ start, end }) => [start, end])])].sort((a, b) => a - b),
    profile = [], surfaces = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], mid = (a + b) / 2,
      reach = reaches.findLast(({ start, end }) => start <= mid && end >= mid),
      count = Math.max(1, Math.ceil((b - a) / 1.5)), base = [];
    for (let j = 0; j <= count; j++) {
      const station = a + (b - a) * j / count,
        y = reach ? Math.min(ground(station), reach.level - reach.depth) : ground(station);
      base.push([station, y]);
    }
    profile.push(...base);
    if (reach) surfaces.push([[a, reach.level], [b, reach.level], ...base.reverse()]);
  }
  return { profile, surfaces };
}
