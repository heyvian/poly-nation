'use strict';

const SITE_PLATFORM_BEAM_TOP = 0.46;
const SITE_DRY_BEAM_DEPTH = 0.42;
const SITE_WATER_CLEARANCE = 5;
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
    span.depth = clamp((span.to - span.from) / 13, 0.74, 2.8);
    supports.push({ at: span.from, bank: true }, { at: span.to, bank: true });
  }
  const count = Math.ceil(half * 2 / 7.5);
  for (let i = 0; i <= count; i++) {
    const station = (half - 0.85) * (2 * i / count - 1);
    if (dry(station) && transfers.every(({ from, to }) => station < from - 1.8 || station > to + 1.8))
      supports.push({ at: station, bank: false });
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
    clearance = water.level + SITE_WATER_CLEARANCE + SITE_APPROACH_DECK_DEPTH;
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
      floor = bay.level + SITE_WATER_CLEARANCE + SITE_PLATFORM_BEAM_TOP + SITE_DRY_BEAM_DEPTH;
    water.level = bay.level;
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
    poles = Array.from({ length: count }, (_, i) => (i + 0.5) * TAU / count + angle)
      .filter((azimuth) => radii.every((radius) => !water.overlaps(siteLine(position, azimuth)(radius), 1.3))),
    spans = poles.flatMap((from, i) => {
      const to = poles[i + 1] ?? poles[0] + TAU, length = (to - from) * tower;
      return length > TAU * tower / count * 1.25 ? [{ from, to, length, depth: clamp(length / 15, 1.35, 3.15) }] : [];
    });
  return { radii, poles, spans, unresolved: poles.length < 3 || spans.some(({ length }) => length > 42) };
}

function siteLowerRooms(model, terrain, position, floor, perimeter, rows, water, accessAngle, moat, boatBay) {
  const { radius } = perimeter, outer = radius - 0.20, inner = Math.max(model.r + 1.35, outer - 6.4),
    bayLength = (outer - inner) * 1.42, half = bayLength / (2 * radius),
    ceiling = floor - SITE_PLATFORM_BEAM_TOP - SITE_DRY_BEAM_DEPTH,
    limit = moat ? moat.inner - radius - 1 : 36, options = [];
  if (outer - inner < 3.1) return [];
  for (let i = 0; i < 96; i++) {
    const angle = i * TAU / 96, from = angle - half, to = angle + half;
    if (Math.sin(angDist(angle, accessAngle)) * radius < bayLength / 2 + 4) continue;
    const station = radius * angle, width = 1.9;
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

function siteFoundationPlan(model, terrain, { position, bearing, grade, water: districtSurface }) {
  const base = buildStorey(model, 0).base, angle = bearing * Math.PI / 180,
    radius = model.R + 3.15, reach = Math.max(110, radius * 2.6),
    envelope = Math.max(radius, Math.hypot(model.R + BUILD_SECTION.dockGap + MODULE.depth + 2.05, MODULE.width / 2 + 0.4)),
    accessAngle = model.lobby.angle + angle,
    boatBay = siteFirehallBoatBay(model, position, districtSurface, terrain, accessAngle),
    surface = boatBay ? { ...districtSurface, garage: boatBay.triangles } : districtSurface,
    water = siteFoundationWater(surface, position, Math.max(270 + radius, reach + radius)),
    district = boatBay ? siteFoundationWater(districtSurface, position, reach + radius) : water,
    districtAnchor = district.anchor(radius), anchor = districtAnchor ?? water.anchor(radius),
    rowAngle = siteCrossingAngle(districtAnchor ? district : water, anchor, accessAngle + Math.PI / 2, reach),
    offsets = [-0.7, -0.35, 0, 0.35, 0.7].map((fraction) => radius * fraction);
  water.level = (surface?.level ?? terrain.datum) - terrain.datum;
  let crossingOffset = 0;
  if (anchor) {
    crossingOffset = clamp((anchor[1] - position[1]) * Math.cos(rowAngle) -
      (anchor[0] - position[0]) * Math.sin(rowAngle), -radius * 0.98, radius * 0.98);
    const nearest = offsets.reduce((a, b) => Math.abs(a - crossingOffset) <= Math.abs(b - crossingOffset) ? a : b);
    if (Math.abs(nearest - crossingOffset) < radius * 0.16) offsets[offsets.indexOf(nearest)] = crossingOffset;
    else offsets.push(crossingOffset);
  }
  const rows = offsets.map((offset) => siteGirderRow(position, rowAngle, offset, radius, water, terrain, reach)),
    gridDepth = Math.max(SITE_DRY_BEAM_DEPTH, ...rows.flatMap((row) => row.transfers.map(({ depth }) => depth))),
    groundAtPin = siteTerrainHeight(terrain, ...position), crane = model.crane,
    runway = crane?.runway === 'elevated' ? siteRunwaySupports(crane, position, angle, water, 12) : null,
    moatBounds = craneMoatBounds(crane),
    moatContact = siteMoatPlan(moatBounds, position, surface, terrain, water, Infinity),
    runwaySoffit = runway ? crane.groundRail - Math.max(CRANE_ELEVATED_GIRDER_DEPTH, ...runway.spans.map(({ depth }) => depth)) : 0,
    floor = Math.max(groundAtPin + grade + base,
      siteTerrainMaximum(terrain, position, envelope) + SITE_PLATFORM_BEAM_TOP + SITE_DRY_BEAM_DEPTH + 0.19,
      water.overlaps(position, envelope) ? water.level + SITE_WATER_CLEARANCE + SITE_PLATFORM_BEAM_TOP + gridDepth : -Infinity,
      moatContact?.connected ? water.level + base + 1.2 : -Infinity,
      runway ? siteTerrainMaximum(terrain, position, runway.radii[1] + 0.7) + base + 2.6 - runwaySoffit : -Infinity,
      runway?.spans.length ? water.level + SITE_WATER_CLEARANCE + base - runwaySoffit : -Infinity),
    foundation = floor - base,
    moat = moatContact && { ...moatContact, level: moatContact.connected ? water.level : Math.min(moatContact.level, foundation + MOAT_WATER_LEVEL),
      runway: siteRunwaySupports(crane, position, angle, water, 4.8) },
    coreRadius = buildRingFrame(model).outside, perimeterLength = TAU * coreRadius,
    perimeterAt = (station) => {
      const theta = station / coreRadius;
      return [position[0] + coreRadius * Math.cos(theta), position[1] + coreRadius * Math.sin(theta)];
    },
    perimeter = { at: perimeterAt, radius: coreRadius, length: perimeterLength,
      runs: siteLandwardRuns(perimeterAt, 0, perimeterLength, water) },
    accesses = [];
  for (const row of rows) {
    const half = Math.sqrt(Math.max(0, coreRadius ** 2 - row.offset ** 2));
    row.landward = siteLandwardRuns(row.at, -half, half, water, row.transfers);
    row.supports = row.supports.filter((support) => support.bank ||
      !row.landward.some(({ from, to }) => support.at >= from && support.at <= to));
  }
  for (const [i, azimuth] of [accessAngle, accessAngle + Math.PI].entries()) {
    const start = moat ? moat.outer + 2.43 : radius - 0.35, top = moat ? foundation + 0.31 : floor - 0.01;
    for (const [kind, offset] of [['stair', -1.24], ['ramp', 1.24]]) {
      const approach = siteApproach(terrain, water, position, azimuth, start, offset, top, kind);
      if (approach) accesses.push({ ...approach, entrance: i, requested: kind });
    }
  }
  const crew = boatBay && siteBoatCrewAccess(boatBay, terrain, water, position, floor, moat);
  if (crew) Object.assign(boatBay, { crewSide: crew.side, route: crew.route, landing: crew.landing, gangway: crew.gangway });
  const lowerRooms = siteLowerRooms(model, terrain, position, floor, perimeter, rows, water, accessAngle, moat, boatBay);
  return { position, angle, radius, foundation, floor, groundAtPin, water, rows, crossingOffset, anchor,
    terrain, surface, accesses, accessAngle, moat, perimeter, runway, boatBay, lowerRooms,
    contextReach: Math.max(envelope, model.crane?.extent ?? 0),
    unresolved: rows.some((row) => row.unresolved) };
}

function sitePileStations({ from, to }) {
  const count = Math.ceil((to - from) / 5.2);
  return Array.from({ length: count }, (_, i) => from + (to - from) * (i + 0.5) / count);
}

function drawSitePile(mesh, x, z, high, concrete) {
  const low = high - SITE_PILE_DISPLAY_LENGTH,
    ring = (j, y) => [x + 0.25 * Math.cos(j * TAU / 12), y, z + 0.25 * Math.sin(j * TAU / 12)];
  for (let j = 0; j < 12; j++) {
    mesh.quad(ring(j, low), ring(j, high), ring(j + 1, high), ring(j + 1, low), concrete);
    mesh.tri([x, high, z], ring(j + 1, high), ring(j, high), concrete);
    mesh.tri([x, low, z], ring(j, low), ring(j + 1, low), concrete);
  }
}

function drawSitePiledWall(mesh, at, tangent, run, terrain, top, concrete, cap, openings = []) {
  const level = (station) => siteTerrainHeight(terrain, ...at(station)) - SITE_PILE_CAP_COVER;
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
  for (const station of sitePileStations(run)) {
    const [x, z] = at(station);
    drawSitePile(mesh, x, z, level(station) - SITE_PILE_CAP_DEPTH, concrete);
  }
}

function drawSiteFoundations(mesh, model, plan, showRunwaySupports, canalDepth = 2) {
  const { floor, foundation, terrain, water, radius, position, rows } = plan,
    concrete = rgb('#b3b1a1'), stone = rgb('#a6a28f'), steel = rgb('#546e65'), paving = rgb('#c7c0aa'),
    rail = rgb('#475e57'), beamTop = floor - SITE_PLATFORM_BEAM_TOP;
  function pier([x, z], angle, top, piled = false, width = 0.56, ground = siteTerrainHeight(terrain, x, z)) {
    const footing = ground - 0.58, cap = piled ? 0.48 : 0.34, size = width + 0.62;
    if (top <= footing) return;
    mesh.box(x, footing - cap, z, piled ? 2.15 : size, cap, size, angle, stone, true);
    mesh.box(x, footing, z, width, top - footing, width, angle, concrete, true);
    if (piled) for (const side of [-1, 1])
      drawSitePile(mesh, x + side * Math.sin(angle) * 0.75, z - side * Math.cos(angle) * 0.75, footing - cap, concrete);
  }
  function girder(row, from, to, depth, colour) {
    if (to - from < 0.05) return;
    const [x, z] = row.at((from + to) / 2);
    mesh.box(x, beamTop - depth, z, depth > SITE_DRY_BEAM_DEPTH ? 0.72 : 0.39,
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
  mesh.mark('Site_Foundation_Platform', 'Suspended ground floor and arrival promenade');
  const storey = buildStorey(model, 0);
  sector(0, model.R, beamTop, SITE_PLATFORM_BEAM_TOP - (storey.base - storey.underside), concrete);
  sector(model.R, radius, beamTop, SITE_PLATFORM_BEAM_TOP - 0.012, paving);
  const ring = buildRingFrame(model);
  mesh.mark('Site_Foundation_Ring_Girders', 'Annular collectors below the permanent core');
  for (const r of [ring.inside, ring.outside])
    sector(r - 0.24, r + 0.24, beamTop - 0.25, 0.25, concrete);
  const perimeter = plan.perimeter;
  for (const run of perimeter.runs)
    drawSitePiledWall(mesh, perimeter.at, (station) => station / perimeter.radius + Math.PI / 2,
      run, terrain, beamTop - 0.25, concrete, stone, plan.lowerRooms.map(({ door }) => door)
        .filter(({ from, to }) => from >= run.from && to <= run.to).sort((a, b) => a.from - b.from));
  for (const row of rows) {
    mesh.mark('Site_Foundation_Girders', 'Underfloor beam grid');
    let station = -row.half;
    for (const span of row.transfers) {
      girder(row, station, span.from, SITE_DRY_BEAM_DEPTH, concrete);
      mesh.mark('Site_Transfer_Girders', 'Bank-to-bank transfer span');
      girder(row, span.from, span.to, span.depth, steel);
      mesh.mark('Site_Foundation_Girders', 'Underfloor beam grid');
      station = span.to;
    }
    girder(row, station, row.half, SITE_DRY_BEAM_DEPTH, concrete);
    for (const run of row.landward)
      drawSitePiledWall(mesh, row.at, () => row.angle, run, terrain, beamTop - SITE_DRY_BEAM_DEPTH, concrete, stone);
    for (const support of row.supports) {
      mesh.mark(support.bank ? 'Site_Foundation_Bank_Bents' : 'Site_Foundation_Piers',
        support.bank ? 'Dry-bank bearings on schematic capped piles' : 'Footings stepped to local grade');
      const span = row.transfers.find(({ from, to }) => support.at === from || support.at === to);
      pier(row.at(support.at), row.angle, beamTop - (span?.depth ?? SITE_DRY_BEAM_DEPTH), support.bank, support.bank ? 0.69 : 0.56);
    }
  }
  const { moat } = plan;
  if (showRunwaySupports) {
    const runway = moat ? moat.runway : plan.runway, head = foundation + model.crane.groundRail,
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
    const half = route.width / 2,
      p = atStation(route, a, -half, y), q = atStation(route, a, half, y),
      r = atStation(route, b, half, next), s = atStation(route, b, -half, next),
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
      deck = level + 0.48, ceiling = beamTop - SITE_DRY_BEAM_DEPTH,
      quayEdge = crewSide * (halfWidth - 1.50), apron = crewSide * (halfWidth + 0.85),
      box = (along, across, y, width, height, length, color) => {
        const [x, z] = point(along, across);
        mesh.box(x, y, z, width, height, length, angle, color, true);
      };
    mesh.mark('Site_Firehall_Boat_Garage', 'Water-level firehall bay and crew quay under the core');
    const portal = model.R - 0.10, jamb = Math.min(1.04, ceiling - level - SITE_WATER_CLEARANCE);
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
  const extraAccess = [...plan.lowerRooms.map(({ route }) => route), ...(boatBay?.route ? [boatBay.route] : [])];
  for (const route of [...plan.accesses, ...extraAccess]) {
    const [[start, top], ...nodes] = route.nodes, [end, grade] = nodes.at(-1),
      stairs = route.kind === 'stair';
    mesh.mark(stairs ? 'Site_Access_Stairs' : 'Site_Access_Ramps',
      stairs ? 'Stair from the lobby landing to grade' : 'Ramp and level landings from the lobby to grade');
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
    const { inner, outer } = moat, from = radius - 0.4, to = Math.min(inner - 2.12, model.plaza.outer - 0.75),
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
    if (to > from) {
      mesh.mark('Site_Access_Moat_Approaches', 'Raised routes to the existing bascule approaches');
      for (const angle of [plan.accessAngle, plan.accessAngle + Math.PI]) {
        const route = { angle, width: 6, at: siteLine(position, angle) };
        slab(route, from, floor - 0.012, to, foundation + 0.31);
        for (let station = from; station < to; station += 5) {
          const point = route.at(station);
          if (!water.overlaps(point, 1)) pier(point, angle, floor - 0.40, false, 0.44);
        }
        if (!showRunwaySupports) continue;
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
  drawSiteFoundations(mesh, model, plan, false, canalDepth);

  mesh.mark('Site axonometric grade', 'Dashed local grade at the concrete stem walls');
  const grade = rgb('#6d6757');
  for (const row of plan.rows) {
    for (const { from, to } of row.landward) {
      const at = (station, side) => {
        const [x, z] = row.at(station), px = x - side * 0.20 * Math.sin(row.angle),
          pz = z + side * 0.20 * Math.cos(row.angle);
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

function siteSectionCuts(plan) {
  const { rows, crossingOffset, radius, accesses } = plan,
    row = rows.find((item) => item.offset === crossingOffset && item.transfers.length) ??
      rows.find((item) => item.transfers.length) ?? rows.find((item) => item.offset === crossingOffset) ?? rows[0],
    channel = row.transfers.length > 0,
    foundation = {
      kind: 'foundation',
      title: channel ? 'Canal crossing and foundations' : 'Core foundations and site grade',
      note: channel ? 'Open bearing frames carry the crossing. Piled stem walls begin at least 5 m from the bank.'
        : plan.anchor ? 'The section shows the water crossing where dry-bank supports are unresolved.'
          : 'Pile-supported concrete walls follow the grade beneath the level ground floor.',
      at: row.at, angle: row.angle, from: Math.min(-radius - 9, ...row.transfers.map((span) => span.from - 7)),
      to: Math.max(radius + 9, ...row.transfers.map((span) => span.to + 7))
    };
  const cuts = [foundation];
  if (channel) {
    const span = row.transfers.reduce((a, b) => a.to - a.from >= b.to - b.from ? a : b);
    const underside = plan.floor - SITE_PLATFORM_BEAM_TOP - span.depth, clearance = underside - plan.water.level,
      [a, b] = plan.water.spans(row.at, span.from, span.to)
        .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? [span.from, span.to];
    cuts.push({ kind: 'canal-detail', title: 'Canal crossing · Bank bearings and girder',
      note: `Study span ${(span.to - span.from).toFixed(1)} m between dry-bank bearings. Clear height above the study water level is ${clearance.toFixed(1)} m.`,
      at: row.at, angle: row.angle, from: span.from - 8, to: span.to + 8,
      clearance: { station: (a + b) / 2, underside, height: clearance } });
  }
  const piled = [row, ...rows.filter((candidate) => candidate !== row)]
    .flatMap((candidate) => candidate.landward.map((run) => ({ row: candidate, run })))
    .sort((a, b) => (b.run.to - b.run.from) - (a.run.to - a.run.from))[0];
  if (piled) {
    const { run, row } = piled, through = (run.from + run.to) / 2,
      from = Math.max(run.from - 3, through - 9), to = Math.min(run.to + 3, through + 9),
      edge = Math.min(run.to, to), shaft = sitePileStations(run).findLast((station) => station <= to - 0.25),
      grade = (station) => siteTerrainHeight(plan.terrain, ...row.at(station)),
      capY = grade(edge) - SITE_PILE_CAP_COVER - SITE_PILE_CAP_DEPTH / 2;
    cuts.push({ kind: 'piled-detail', title: 'Landward foundation · Stem wall and piles',
      note: 'A continuous grade beam carries the stem wall. Pile lengths are shown schematically below local grade.',
      at: row.at, angle: row.angle, from, to, crown: plan.floor + 1.55, belowGrade: SITE_PILE_DISPLAY_LENGTH + 1.7,
      labels: [
        [edge, (grade(edge) + plan.floor - SITE_PLATFORM_BEAM_TOP - SITE_DRY_BEAM_DEPTH) / 2, 'Concrete stem wall'],
        [edge, capY, 'Pile-supported grade beam'],
        [shaft + 0.25, grade(shaft) - SITE_PILE_CAP_COVER - SITE_PILE_CAP_DEPTH - SITE_PILE_DISPLAY_LENGTH / 2, 'Schematic pile shaft']
      ] });
  }
  if (plan.boatBay) {
    const bay = plan.boatBay;
    cuts.push({ kind: 'boat-garage', title: 'Firehall · Canal inlet and boat garage',
      note: `${Math.round(bay.area)} m² covered wet bay in the additional site programme. The rescue boat enters directly from the canal.`,
      at: bay.at, angle: bay.angle, from: bay.back - 4, to: bay.end + 9, crown: plan.floor + 1.2,
      labels: [
        [bay.rim - 3.5, plan.floor - SITE_PLATFORM_BEAM_TOP, 'Raised core above the slip'],
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
  return [...cuts, ...['ramp', 'stair'].flatMap((kind) => {
    const route = accesses.find((entry) => entry.requested === kind && entry.kind === kind) ??
      accesses.find((entry) => entry.requested === kind);
    if (!route) return [];
    const [[start], ...nodes] = route.nodes, [end] = nodes.at(-1), lobby = route.entrance ? 'Opposite lobby' : 'Main lobby';
    return [{
      kind: 'approach',
      title: `${lobby} · ${route.kind === 'walk' ? 'Level approach' : kind === 'ramp' ? 'Entry ramp' : 'Entry stair'}`,
      note: route.kind === 'walk' ? 'The approach meets local grade with a level landing.'
        : kind === 'ramp' ? 'The entry ramp follows a 1:20 maximum design slope, with level landings.'
          : 'The stair joins the raised promenade to a landing at local grade.',
      at: route.at, angle: route.angle, from: plan.moat ? plan.radius - 4 : start - 6, to: end + 4,
      crown: Math.max(...route.nodes.map(([, y]) => y)) + 1.22
    }];
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
