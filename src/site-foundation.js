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
  const flat = [...(water?.existing ?? []), ...(water?.proposed ?? [])].map((triangle) => triangle.flat())
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

function siteApproach(terrain, water, position, angle, start, offset, top, kind) {
  const at = siteLine(position, angle, offset), surfaceAt = (station) => siteTerrainHeight(terrain, ...at(station)),
    ramp = kind === 'ramp', width = ramp ? 1.9 : 2.05, junction = 1.55,
    sightLimit = ramp ? 250 : 140,
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

function siteFoundationPlan(model, terrain, { position, bearing, grade, water: surface }) {
  const base = buildStorey(model, 0).base, angle = bearing * Math.PI / 180,
    radius = model.R + 3.15, reach = Math.max(110, radius * 2.6),
    envelope = Math.max(radius, Math.hypot(model.R + BUILD_SECTION.dockGap + MODULE.depth + 2.05, MODULE.width / 2 + 0.4)),
    water = siteFoundationWater(surface, position, Math.max(270 + radius, reach + radius)),
    anchor = water.anchor(radius), accessAngle = model.lobby.angle + angle,
    rowAngle = siteCrossingAngle(water, anchor, accessAngle + Math.PI / 2, reach),
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
    groundAtPin = siteTerrainHeight(terrain, ...position),
    floor = Math.max(groundAtPin + grade + base,
      siteTerrainMaximum(terrain, position, envelope) + SITE_PLATFORM_BEAM_TOP + SITE_DRY_BEAM_DEPTH + 0.19,
      water.overlaps(position, envelope) ? water.level + SITE_WATER_CLEARANCE + SITE_PLATFORM_BEAM_TOP + gridDepth : -Infinity),
    foundation = floor - base, moat = craneMoatBounds(model.crane),
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
  return { position, angle, radius, foundation, floor, groundAtPin, water, rows, crossingOffset, anchor,
    terrain, accesses, accessAngle, moat, perimeter, contextReach: Math.max(envelope, model.crane?.extent ?? 0),
    unresolved: rows.some((row) => row.unresolved) };
}

function sitePileStations({ from, to }) {
  const count = Math.ceil((to - from) / 5.2);
  return Array.from({ length: count }, (_, i) => from + (to - from) * (i + 0.5) / count);
}

function drawSitePiledWall(mesh, at, tangent, run, terrain, top, concrete, cap) {
  const { from, to } = run, count = Math.ceil((to - from) / 0.85),
    level = (station) => siteTerrainHeight(terrain, ...at(station)) - SITE_PILE_CAP_COVER,
    closed = Math.hypot(...at(from).map((value, i) => value - at(to)[i])) < 1e-6;
  function ribbon(width, bottom, crown, colour) {
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
  ribbon(0.36, level, () => top, concrete);
  mesh.mark('Site_Foundation_Pile_Caps', 'Continuous grade beam over piles');
  ribbon(SITE_PILE_CAP_WIDTH, (station) => level(station) - SITE_PILE_CAP_DEPTH, level, cap);
  mesh.mark('Site_Foundation_Piles', 'Schematic bored pile shafts below grade');
  for (const station of sitePileStations(run)) {
    const [x, z] = at(station), high = level(station) - SITE_PILE_CAP_DEPTH, low = high - SITE_PILE_DISPLAY_LENGTH,
      ring = (j, y) => [x + 0.25 * Math.cos(j * TAU / 12), y, z + 0.25 * Math.sin(j * TAU / 12)];
    for (let j = 0; j < 12; j++) {
      mesh.quad(ring(j, low), ring(j, high), ring(j + 1, high), ring(j + 1, low), concrete);
      mesh.tri([x, high, z], ring(j + 1, high), ring(j, high), concrete);
      mesh.tri([x, low, z], ring(j, low), ring(j + 1, low), concrete);
    }
  }
}

function drawSiteFoundations(mesh, model, plan, extendRunway) {
  const { floor, foundation, terrain, water, radius, position, rows } = plan,
    concrete = rgb('#b3b1a1'), stone = rgb('#a6a28f'), steel = rgb('#546e65'), paving = rgb('#c7c0aa'),
    rail = rgb('#475e57'), beamTop = floor - SITE_PLATFORM_BEAM_TOP;
  function pier([x, z], angle, top, bank = false, width = 0.56) {
    const footing = siteTerrainHeight(terrain, x, z) - 0.58, size = bank ? 1.12 : width + 0.62;
    mesh.box(x, footing - 0.34, z, size, 0.34, size, angle, stone, true);
    if (top > footing) mesh.box(x, footing, z, bank ? 0.69 : width, top - footing,
      bank ? 0.69 : width, angle, concrete, true);
  }
  function girder(row, from, to, depth, colour) {
    if (to - from < 0.05) return;
    const [x, z] = row.at((from + to) / 2);
    mesh.box(x, beamTop - depth, z, depth > SITE_DRY_BEAM_DEPTH ? 0.72 : 0.39,
      depth, to - from, row.angle, colour, true);
  }
  function sector(inner, outer, bottom, depth, colour) {
    const first = mesh.solid.length;
    mesh.sector(inner, outer, 0, TAU, bottom, depth, colour);
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
      run, terrain, beamTop - 0.25, concrete, stone);
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
        support.bank ? 'Dry-bank bearings and pad foundations' : 'Footings stepped to local grade');
      pier(row.at(support.at), row.angle, beamTop - SITE_DRY_BEAM_DEPTH, support.bank);
    }
  }
  if (extendRunway) {
    const { tower, groundGauge, groundRail } = model.crane,
      count = Math.ceil(TAU * tower / 12);
    mesh.mark('Site_Foundation_Runway_Piers', 'Outer runway extensions founded on dry ground');
    for (let i = 0; i < count; i++) {
      const angle = (i + 0.5) * TAU / count + plan.angle, at = siteLine(position, angle);
      for (const radius of [tower - groundGauge / 2, tower + groundGauge / 2]) {
        const point = at(radius);
        if (!water.overlaps(point, 0.95)) pier(point, angle, foundation + groundRail - 1.28, false, 0.64);
      }
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
  for (const route of plan.accesses) {
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
  if (plan.moat) {
    const { inner } = plan.moat, from = radius - 0.4, to = Math.min(inner - 2.12, model.plaza.outer - 0.75);
    if (to > from) {
      mesh.mark('Site_Access_Moat_Approaches', 'Raised routes to the existing bascule approaches');
      for (const angle of [plan.accessAngle, plan.accessAngle + Math.PI]) {
        const route = { angle, width: 6, at: siteLine(position, angle) };
        slab(route, from, floor - 0.012, to, foundation + 0.31);
        for (let radius = from; radius < to; radius += 5) {
          const point = route.at(radius);
          if (!water.overlaps(point, 1)) pier(point, angle, floor - 0.40, false, 0.44);
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
  drawSiteFoundations(mesh, model, plan, false);

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
    reaches = water.spans(at, from, to).map(([start, end]) => ({ start, end, level: water.level, depth: canalDepth }));
  if (moat) {
    // The crane moat uses the building datum. Its section follows the same annular limits as the cutout.
    const [x, z] = at(0), [cx, cz] = plan.position, offset = Math.hypot(x - cx, z - cz);
    if (offset < moat.outer) {
      const low = Math.sqrt(Math.max(0, moat.inner ** 2 - offset ** 2)),
        high = Math.sqrt(moat.outer ** 2 - offset ** 2);
      for (const [a, b] of [[-high, -low], [low, high]]) {
        const start = Math.max(a, from), end = Math.min(b, to);
        if (end > start) reaches.push({ start, end, level: plan.foundation - 0.84, depth: 0.59, moat: true });
      }
    }
  }
  const stops = [...new Set([from, to, ...reaches.flatMap(({ start, end }) => [start, end])])].sort((a, b) => a - b),
    profile = [], surfaces = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], mid = (a + b) / 2,
      reach = reaches.findLast(({ start, end }) => start <= mid && end >= mid),
      count = Math.max(1, Math.ceil((b - a) / 1.5)), base = [];
    for (let j = 0; j <= count; j++) {
      const station = a + (b - a) * j / count, y = reach
        ? reach.moat ? reach.level - reach.depth : Math.min(ground(station), reach.level - reach.depth)
        : ground(station);
      base.push([station, y]);
    }
    profile.push(...base);
    if (reach) surfaces.push([[a, reach.level], [b, reach.level], ...base.reverse()]);
  }
  return { profile, surfaces };
}
