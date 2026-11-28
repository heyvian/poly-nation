'use strict';

const ATRIUM_FIN_MODES = ['none', 'open', 'shade', 'tracking'];
const CANAL_ATRIUM_MODES = ['open', 'glazed'];
const ATRIUM_FIN = { chord: 0.72, spacing: 0.76 };
const ATRIUM_ROOF_BANDS = [0, 0.33, 0.66, 1];

function atriumEnvelopeOptions(model = null) {
  if (model?.atriumEnvelope) return model.atriumEnvelope;
  return {
    opaqueFraction: clamp(state.atriumOpaquePct ?? 0, 0, 80) / 100,
    finMode: state.atriumFinMode ?? 'none',
    canalMode: state.canalAtriumSeal ?? 'open'
  };
}

// The blade axis is tangential. Track the sun projected onto the radial section.
function atriumFinTilt(mode, altitude, radialSun = 1) {
  const limit = 82 * Math.PI / 180;
  if (mode === 'none') return null;
  if (mode === 'open' || (mode === 'tracking' && altitude <= 0)) return limit;
  if (altitude <= 0) return 0;
  const section = Math.atan2(Math.sin(altitude), Math.cos(altitude) * Math.abs(radialSun)),
    direction = radialSun < 0 ? -1 : 1;
  return direction * (mode === 'shade' ? clamp(section - Math.PI / 2, -limit, 0) : Math.min(section, limit));
}

function drawAtriumRoofPanels(mesh, model, { inner, outer, point, glazeLayer, alpha, cap = null }) {
  const { opaqueFraction, finMode } = atriumEnvelopeOptions(model), sectors = 96,
    opaque = Math.round(sectors * opaqueFraction), glass = rgb('#c4dfde'),
    panel = rgb('#898c80'), edge = rgb('#70776e'), shade = rgb('#b08e63'), trim = rgb('#6d685a'),
    insulated = [], translucent = [];
  mesh.mark(glazeLayer);
  for (let i = 0; i < sectors; i++) {
    const a = i * TAU / sectors, b = (i + 1) * TAU / sectors;
    if (cap) mesh.tri(cap, point(inner, b), point(inner, a), glass, mesh.glass, alpha);
    if (!opaque) {
      mesh.quad(point(inner, b), point(outer, b), point(outer, a), point(inner, a), glass, mesh.glass, alpha);
      if (finMode === 'none') continue;
    }
    for (let j = 0; j < ATRIUM_ROOF_BANDS.length - 1; j++) {
      const u = inner + (outer - inner) * ATRIUM_ROOF_BANDS[j],
        v = inner + (outer - inner) * ATRIUM_ROOF_BANDS[j + 1],
        corners = [point(u, b), point(v, b), point(v, a), point(u, a)],
        // Stagger the insulated panels between bands at a uniform circumferential density.
        station = (i + j * 19) * opaque / sectors,
        solid = Math.floor(station + opaque / sectors + 1e-8) > Math.floor(station + 1e-8);
      if (solid) insulated.push(corners);
      else {
        if (opaque) mesh.quad(...corners, glass, mesh.glass, alpha);
        translucent.push({ u, v, a, b });
      }
    }
  }
  if (insulated.length) {
    mesh.mark('Atrium_Insulated_Roof_Panels', 'Insulated roof cassettes');
    for (const corners of insulated) {
      const underside = corners.map(([x, y, z]) => [x, y - 0.18, z]);
      mesh.quad(...corners, panel);
      mesh.quad(...underside.slice().reverse(), panel);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        mesh.quad(corners[i], underside[i], underside[j], corners[j], edge);
        mesh.line(corners[i], corners[j], edge);
      }
    }
  }
  if (finMode === 'none') return;
  const sun = typeof climateStudySun === 'function' ? climateStudySun() : { altitude: 0.27, azimuth: Math.PI },
    heading = Math.PI / 2 + sun.azimuth - (model.sitePlan?.angle ?? model.siteGeometry?.angle ?? 0);
  mesh.mark('Atrium_Solar_Fins', 'Adjustable fins below the glazed roof bays');
  for (const { u, v, a, b } of translucent) {
    const tilt = atriumFinTilt(finMode, sun.altitude, Math.cos((a + b) / 2 - heading)),
      bladeHalf = ATRIUM_FIN.chord / 2 * Math.cos(tilt), rise = ATRIUM_FIN.chord / 2 * Math.sin(tilt),
      count = Math.max(1, Math.round((v - u) / ATRIUM_FIN.spacing));
    for (let i = 0; i < count; i++) {
      const radius = u + (v - u) * (i + 0.5) / count, inset = 0.055 / radius,
        pivot = point(radius, a)[1] - 0.52,
        blade = (angle, side, thickness = 0) => [(radius + side * bladeHalf) * Math.cos(angle),
          pivot + side * rise + thickness, (radius + side * bladeHalf) * Math.sin(angle)],
        corners = [blade(b - inset, -1), blade(b - inset, 1), blade(a + inset, 1), blade(a + inset, -1)];
      mesh.quad(...corners, shade);
      mesh.quad(...corners.slice().reverse(), shade);
      mesh.line(corners[1], corners[2], trim);
      if (i % 3 === 0) {
        const [x, , z] = point(radius, a + inset);
        mesh.line([x, pivot, z], [x, point(radius, a)[1], z], trim);
      }
    }
  }
}

function canalAtriumDescription(canal) {
  if (!canal) return 'Choose a site where water passes through the atrium to study this opening.';
  if (canal.mode === 'open') return `${Math.round(canal.openingArea)} m² of the atrium opens directly to the canal.`;
  if (!canal.fitted) return canal.reason;
  const upper = canal.upperStair ? ' A dry stair alongside the enclosure reaches Level 2.' :
    ' Access to Level 2 uses the existing circulation.';
  return canal.portal ? `Sloped glazing closes the atrium. A glazed door leads to ${canal.portal.stair ? 'a guarded stair and canal dock' : 'a guarded water landing'}.${upper}` :
    'Sloped glazing closes the atrium above the navigation clearance. A public canal door needs a clear bank approach.';
}

function canalGlassEdges(polygon) {
  return polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length], x = p[2] - q[2], z = q[0] - p[0];
    return { x, y: 0, z, level: x * p[0] + z * p[2] };
  });
}

function planCanalAtriumEnclosure(model, plan, districtSurface, crossDirection) {
  if (!districtSurface || !plan.anchor || !plan.water.overlaps(plan.position, model.r)) return null;
  const mode = atriumEnvelopeOptions(model).canalMode, radius = model.r + 0.01,
    study = siteWaterStudy(plan.terrain, districtSurface, 1),
    planes = Array.from({ length: 96 }, (_, i) => {
      const angle = (i + 0.5) * TAU / 96, x = Math.cos(angle), z = Math.sin(angle);
      return { x, y: 0, z, level: x * plan.position[0] + z * plan.position[1] + radius * Math.cos(Math.PI / 96) };
    }),
    area = (polygon) => Math.abs(polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return sum + (p[0] - plan.position[0]) * (q[2] - plan.position[1]) -
        (q[0] - plan.position[0]) * (p[2] - plan.position[1]);
    }, 0)) / 2,
    clipped = study.faces.map(({ polygon }) => trimDrawingFace(polygon, planes))
      .filter((polygon) => polygon.length >= 3 && area(polygon) > 0.0001),
    faces = [];
  // Registered waterways can overlap at a confluence. Keep only the visible union.
  for (const polygon of clipped) {
    const previous = faces.map(canalGlassEdges);
    faces.push(...terrainOutsideSiteWater(polygon, previous).filter((face) => face.length >= 3 && area(face) > 0.0001));
  }
  const openingArea = faces.reduce((sum, polygon) => sum + area(polygon), 0);
  if (openingArea < 0.1) return null;
  const unsealed = { mode, fitted: false, openingArea, glazingArea: 0, residualOpenArea: openingArea };
  if (mode === 'open') return unsealed;
  const affectedTransfers = plan.rows.flatMap((row) => row.transfers.flatMap((span) => {
    if (Math.abs(row.offset) > radius) return [];
    const ends = [span.from, span.to].map((station) => {
      const [x, z] = row.at(station);
      return [x, 0, z];
    });
    return clipDrawingLine(...ends, planes) ? [span.depth] : [];
  })),
    top = plan.crossingSoffit - Math.max(0, ...affectedTransfers) - 0.08,
    bottom = Math.max(plan.floor + 2.22, study.level + plan.water.clearance + 0.15);
  if (model.layers.length < 2 || top - bottom < 0.15)
    return { ...unsealed, reason: 'The enclosure needs a second floor and room above the study navigation clearance.' };
  const stairConflict = (model.circulation.stairs ?? []).some(({ f, top, bottom, width, risers, half }) => {
    if (f !== 1) return false;
    for (let i = 0; i <= 2 * risers; i++) {
      const t = i / (2 * risers), sweep = (bottom - top) + 2 * half * Math.sign(bottom - top),
        angle = top - half * Math.sign(sweep) + t * sweep + plan.angle,
        at = siteLine(plan.position, angle);
      if (plan.water.overlaps(at(model.r - width / 2), width / 2 - 0.01)) return true;
    }
    return false;
  });
  if (stairConflict) return { ...unsealed, reason: 'The canal stays open here because glazing would cross the ground-level bridge stair.' };
  const axis = [Math.cos(crossDirection), Math.sin(crossDirection)],
    project = ([x, , z]) => (x - plan.position[0]) * axis[0] + (z - plan.position[1]) * axis[1],
    stations = faces.flat().map(project), min = Math.min(...stations), max = Math.max(...stations),
    rise = Math.min(top - bottom, 1.6), slope = rise / (max - min),
    roof = (p) => top - (project(p) - min) * slope,
    banks = study.banks.flatMap(({ line }) => {
      const cut = clipDrawingLine(...line, planes);
      if (!cut) return [];
      const [a, b] = cut, dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
      if (length < 0.01) return [];
      const center = drawingMix(a, b, 0.5), x = dz / length, z = -dx / length,
        leftWet = plan.water.overlaps([center[0] + x * 0.18, center[2] + z * 0.18]),
        rightWet = plan.water.overlaps([center[0] - x * 0.18, center[2] - z * 0.18]);
      if (leftWet === rightWet) return [];
      return [{ a, b, length, wet: leftWet ? [x, z] : [-x, -z] }];
    }),
    returns = faces.flatMap((polygon) => polygon.flatMap((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return planes.some((plane) => Math.abs(drawingDistance(a, plane)) < 1e-6 &&
        Math.abs(drawingDistance(b, plane)) < 1e-6) ? [[a, b]] : [];
    })),
    portal = canalAtriumPortal(model, plan, banks, roof),
    upperStair = canalAtriumUpperStair(model, plan, portal),
    glazingArea = openingArea * Math.hypot(1, slope) + banks.reduce((sum, { a, b, length }) =>
      sum + length * ((roof(a) + roof(b)) / 2 - plan.floor), 0) + returns.reduce((sum, [a, b]) =>
      sum + Math.hypot(a[0] - b[0], a[2] - b[2]) * (plan.crossingSoffit - (roof(a) + roof(b)) / 2), 0);
  return { mode, fitted: true, openingArea, glazingArea, residualOpenArea: 0, faces, banks, roof, returns, portal, upperStair, crossDirection,
    normalBearing: mod(crossDirection - Math.PI / 2, TAU) };
}

function canalAtriumPortal(model, plan, banks, roof) {
  if (!model.greenhouse?.approaches.length) return null;
  const [centerX, centerZ] = plan.position, cos = Math.cos(plan.angle), sin = Math.sin(plan.angle),
    approachRuns = model.greenhouse.approaches.map((segment) => segment.map(([x, z]) =>
      [centerX + x * cos - z * sin, centerZ + x * sin + z * cos]));
  for (const bank of banks) {
    const { a, b, length, wet } = bank;
    for (let station = 1.8; station <= length - 1.8; station += 0.6) {
      const t = station / length, p = drawingMix(a, b, t),
        point = (along, offset, y = plan.floor) => [p[0] + along * (b[0] - a[0]) / length + offset * wet[0],
          y, p[2] + along * (b[2] - a[2]) / length + offset * wet[1]],
        dry = point(0, -0.9), approach = approachRuns.find(([from, to]) => {
          const dx = to[0] - from[0], dz = to[1] - from[1], u = clamp(((dry[0] - from[0]) * dx +
            (dry[2] - from[1]) * dz) / (dx * dx + dz * dz), 0, 1);
          if (Math.hypot(dry[0] - from[0] - dx * u, dry[2] - from[1] - dz * u) >= 0.44) return false;
          const samples = Math.ceil(Math.hypot(dx, dz) * u / 0.7);
          for (let i = 0; i <= samples; i++) {
            const t = u * i / Math.max(1, samples);
            if (plan.water.overlaps([from[0] + dx * t, from[1] + dz * t], 0.46)) return false;
          }
          return true;
        });
      if (!approach || Math.min(roof(point(-0.95, 0)), roof(point(0.95, 0))) < plan.floor + 2.17 ||
          Math.hypot(p[0] - centerX, p[2] - centerZ) > model.r - 3.8) continue;
      const edges = [-1.32, 1.32].flatMap((side) => [point(side, -0.3), point(side, 1.5)]);
      if (edges.some((q) => Math.hypot(q[0] - centerX, q[2] - centerZ) < plan.mastRadius + 1.35) ||
          ![-1.0, 1.0].every((side) => {
            const q = point(side, 3.1);
            return plan.water.overlaps([q[0], q[2]]);
          })) continue;
      const dockLevel = plan.water.level + 0.42, drop = plan.floor - dockLevel,
        risers = Math.ceil(drop / 0.175), run = (risers - 1) * 0.29,
        stairSide = drop >= 0.34 && drop <= 1.65 ? [-1, 1].find((side) => {
          const outer = 1.31 + run + 1.55;
          if (station + side * outer < 0.25 || station + side * outer > length - 0.25) return false;
          return [1.31, 1.31 + run, outer].every((along) => {
            const p = point(along * side, 4.5);
            return Math.hypot(p[0] - centerX, p[2] - centerZ) < model.r - 0.4 && plan.water.overlaps([p[0], p[2]]);
          });
        }) : null;
      return { bank, t, half: 0.95 / length, point, approach: approach[0],
        stair: stairSide ? { side: stairSide, dockLevel, drop, risers, run } : null };
    }
  }
  return null;
}

function canalAtriumUpperStair(model, plan, portal) {
  if (!portal) return null;
  const width = 1.20, radius = model.r - width / 2, half = 0.68 / radius,
    going = 0.29, risers = Math.ceil(plan.pitch / 0.175), turn = 2 * half + going * (risers - 1) / radius,
    { regions, bridges, stairs } = model.circulation,
    upper = regions.filter((q) => q.f === 1 && q.r <= model.r + 0.001 &&
      ['link', 'residual', 'bridgeAccess', 'slide_bypass', 'slide_return'].includes(q.kind)),
    guard = atriumGuardSpans({ ...model, siteCanalLookouts: plan.lookouts }, 1),
    bridge = bridges?.find(({ f }) => f === 1), [doorX, , doorZ] = portal.point(0, -1.2),
    [centerX, centerZ] = plan.position, [rimX, rimZ] = portal.approach,
    approachAngle = Math.atan2(rimZ - centerZ, rimX - centerX) - plan.angle,
    conflicts = (angle) => (stairs ?? []).some((stair) => (stair.f === 1 || stair.f === 2) &&
      angDist(angle, (stair.top + stair.bottom) / 2) * radius < Math.abs(stair.top - stair.bottom) * radius / 2 + 1.2),
    dry = (angle, from = model.r - width - 0.09, to = model.r + 0.05, length = 0.42) =>
      siteDryWalk(plan.water, plan.position, angle + plan.angle, from, to, length),
    choices = [];
  if (radius < 4 || turn > 1.25) return null;
  for (const { start, end } of upper) {
    for (let top = start + half + 0.07 / radius; top + half + 0.07 / radius < end; top += 0.25 / radius) {
      if (!guard.some(([a, b]) => angDist(top, (a + b) / 2) + half + 0.04 / radius <= (b - a) / 2)) continue;
      const [topX, topZ] = siteLine(plan.position, top + plan.angle)(model.r + 0.04);
      if (plan.columns.some(({ side, at: [x, z], size }) => side === 'inner' &&
        Math.hypot(x - topX, z - topZ) < 0.66 + size / 2)) continue;
      for (const direction of [-1, 1]) {
        const bottom = top + direction * turn, [landX, landZ] = siteLine(plan.position, bottom + plan.angle)(radius),
          length = Math.hypot(landX - doorX, landZ - doorZ);
        if (length > 15 || !dry(bottom, model.r - 1.55, model.r + 0.04, 1.68)) continue;
        const delta = Math.atan2(Math.sin(bottom - approachAngle), Math.cos(bottom - approachAngle)),
          count = Math.ceil(Math.abs(delta) * radius / 0.52),
          clearApproach = Array.from({ length: count + 1 }, (_, i) => approachAngle + delta * i / Math.max(1, count))
            .every((angle) => dry(angle, model.r - 1.5, model.r - 0.04, 0.60));
        if (!clearApproach) continue;
        let near = false, clear = true;
        for (let i = -2; i <= 30; i++) {
          const t = i / 28, angle = top + direction * turn * t,
            [x, z] = siteLine(plan.position, angle + plan.angle)(radius),
            depth = plan.pitch * clamp(t, 0, 1), localY = plan.crossingDeck - depth;
          if (!dry(angle) || conflicts(angle)) {
            clear = false;
            break;
          }
          near ||= plan.water.overlaps([x, z], 4.2);
          const occupiedLanding = depth < 2.55 && plan.lookouts.some(({ type, angle: heading, start, end }) =>
            type === 'ring' && angDist(angle, heading) * model.r < (end - start) / 2 + 0.7);
          if (occupiedLanding) {
            clear = false;
            break;
          }
          if (bridge && depth < 2.55) {
            const station = radius * Math.cos(angle - bridge.heading);
            if (Math.abs(station - bridge.offset) < bridge.width / 2 + 0.72) {
              clear = false;
              break;
            }
          }
          const underTransfer = plan.rows.some((row) => {
            const dx = x - plan.position[0], dz = z - plan.position[1],
              cross = -dx * Math.sin(row.angle) + dz * Math.cos(row.angle) - row.offset,
              station = dx * Math.cos(row.angle) + dz * Math.sin(row.angle);
            return Math.abs(cross) < 1.12 && row.transfers.some(({ from, to, depth }) =>
              station > from - 0.65 && station < to + 0.65 &&
              localY - 0.25 < plan.crossingSoffit && localY + 2.25 > plan.crossingSoffit - depth);
          });
          if (underTransfer) {
            clear = false;
            break;
          }
        }
        if (near && clear) choices.push({ f: 1, top, bottom, width, radius, half, risers, going, canal: true, length });
      }
    }
  }
  return choices.sort((a, b) => a.length - b.length)[0] ?? null;
}

function drawCanalAtriumEnclosure(mesh, plan) {
  const canal = plan.canalAtrium;
  if (!canal?.fitted) return;
  const { faces, banks, returns, roof, portal, crossDirection } = canal,
    glass = rgb('#a6cdce'), metal = rgb('#536c68'), deck = rgb('#b7a68c'),
    at = ([x, , z], y) => [x, y, z], upper = (p) => at(p, roof(p)),
    pane = (a, b, lowA, lowB, highA = roof(a), highB = roof(b), opacity = 0.34) => {
      if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 0.001) return;
      mesh.quad(at(a, lowA), at(b, lowB), at(b, highB), at(a, highA), glass, mesh.glass, opacity);
    };
  mesh.mark('Site_Canal_Atrium_Glazing', 'Sloped atrium enclosure above the canal');
  for (const polygon of faces) {
    const points = polygon.map(upper);
    for (let i = 1; i < points.length - 1; i++) mesh.tri(points[0], points[i], points[i + 1], glass, mesh.glass, 0.31);
  }
  for (const bank of banks) {
    const { a, b, length } = bank, count = Math.ceil(length / 1.55),
      steps = Array.from({ length: count + 1 }, (_, i) => i / count);
    const doorway = portal?.bank === bank ? [portal.t - portal.half, portal.t + portal.half] : null;
    const stations = doorway ? [...steps.filter((t) => t < doorway[0] || t > doorway[1]), ...doorway].sort((x, y) => x - y) : steps;
    for (let i = 0; i < stations.length - 1; i++) {
      const p = drawingMix(a, b, stations[i]), q = drawingMix(a, b, stations[i + 1]),
        door = doorway && stations[i] === doorway[0], sill = plan.floor + (door ? 2.12 : 0);
      pane(p, q, sill, sill);
      mesh.line(at(p, sill), upper(p), metal);
      mesh.line(upper(p), upper(q), metal);
    }
  }
  for (const [a, b] of returns) pane(a, b, roof(a), roof(b), plan.crossingSoffit, plan.crossingSoffit);
  // The existing crossing rows take the glazed span to bank bearings. Keep new steel out of the water.
  mesh.mark('Site_Canal_Atrium_Rafters', 'Glazing rails and hangers at the raised crossing frame');
  const planes = faces.map(canalGlassEdges), reach = plan.radius * 1.01,
    spans = (atStation, from, to) => {
      const [x, z] = atStation(from), [u, v] = atStation(to), a = [x, 0, z], b = [u, 0, v];
      return planes.map((sides) => clipDrawingLine(a, b, sides)).filter((span) => span &&
        Math.hypot(span[0][0] - span[1][0], span[0][2] - span[1][2]) > 0.05);
    };
  for (const [angle, spacing] of [[crossDirection, 1.65], [crossDirection + Math.PI / 2, 2.75]]) {
    for (let offset = Math.ceil(-reach / spacing) * spacing; offset < reach; offset += spacing) {
      for (const [a, b] of spans(siteLine(plan.position, angle, offset), -reach, reach))
        drawAssemblyMember(mesh, at(a, roof(a) - 0.04), at(b, roof(b) - 0.04), 0.07, metal);
    }
  }
  for (const row of plan.rows) for (const { from, to, depth } of row.transfers) {
    for (const [a, b] of spans(row.at, from, to)) {
      const count = Math.ceil(Math.hypot(a[0] - b[0], a[2] - b[2]) / 2.12);
      for (let i = 0; i < count; i++) {
        const p = drawingMix(a, b, (i + 0.5) / count);
        drawAssemblyMember(mesh, upper(p), at(p, plan.crossingSoffit - depth), 0.045, metal);
      }
    }
  }
  if (!portal) return;
  const { point, stair } = portal, floor = plan.floor, angle = Math.atan2(portal.bank.wet[1], portal.bank.wet[0]),
    height = 2.12, [x, , z] = point(0, 0.65);
  mesh.mark('Site_Canal_Atrium_Public_Door', 'Weather-sealed double door to the public water landing');
  for (const [from, to] of [[-0.95, 0], [0, 0.95]]) {
    const a = point(from, 0), b = point(to, 0);
    pane(a, b, floor, floor, floor + height, floor + height, 0.39);
    drawAssemblyMember(mesh, a, point(from, 0, floor + height), 0.069, metal);
  }
  drawAssemblyMember(mesh, point(0.95, 0), point(0.95, 0, floor + height), 0.069, metal);
  drawAssemblyMember(mesh, point(-0.95, 0, floor + height), point(0.95, 0, floor + height), 0.09, metal);
  mesh.mark('Site_Canal_Atrium_Public_Landing', 'Guarded bank-mounted landing at the atrium threshold');
  mesh.box(x, floor - 0.19, z, 2.62, 0.19, 1.7, angle, deck, true);
  for (const side of [-1, 1]) {
    const w = side * 1.16;
    drawAssemblyMember(mesh, point(w, -0.21, floor - 0.74), point(w, 1.44, floor - 0.20), 0.13, metal);
    if (stair?.side !== side)
      drawAssemblyMember(mesh, point(w, 0.03, floor + 1.05), point(w, 1.44, floor + 1.05), 0.06, metal);
    for (const d of [0.03, 1.44]) drawAssemblyMember(mesh, point(w, d), point(w, d, floor + 1.05), 0.07, metal);
  }
  drawAssemblyMember(mesh, point(-1.16, 1.44, floor + 1.05), point(1.16, 1.44, floor + 1.05), 0.06, metal);
  if (stair) drawCanalAtriumDockStair(mesh, portal, angle, floor, metal, deck);
}

function drawCanalAtriumDockStair(mesh, { point, stair }, angle, floor, metal, deck) {
  const { side, dockLevel, drop, risers, run } = stair, landing = 1.31,
    y = (i) => floor - drop * i / risers, edge = (i) => side * (landing + i * 0.29),
    angleAlong = angle + Math.PI / 2;
  mesh.mark('Site_Canal_Atrium_Water_Stair', 'Bank-supported public stair down to the canal');
  for (let i = 0; i < risers - 1; i++) {
    const [x, , z] = point((edge(i) + edge(i + 1)) / 2, 0.80);
    mesh.box(x, y(i + 1) - 0.10, z, 1.28, 0.10, 0.29, angleAlong, deck);
  }
  for (const offset of [0.18, 1.42]) {
    drawAssemblyMember(mesh, point(edge(0), offset, floor - 0.18), point(edge(risers - 1), offset, dockLevel - 0.18), 0.09, metal);
    drawAssemblyMember(mesh, point(edge(0), offset, floor + 1.05), point(edge(risers - 1), offset, dockLevel + 1.05), 0.06, metal);
    for (const i of [0, Math.floor((risers - 1) / 2), risers - 1]) drawAssemblyMember(mesh,
      point(edge(i), offset, y(i) - 0.05), point(edge(i), offset, y(i) + 1.05), 0.062, metal);
  }
  mesh.mark('Site_Canal_Atrium_Dock', 'Cantilevered landing at the study canal level');
  const near = side * (landing + run), far = near + side * 1.55, [x, , z] = point((near + far) / 2, 0.8);
  mesh.box(x, dockLevel - 0.21, z, 1.58, 0.21, 1.55, angleAlong, deck, true);
  for (const at of [near + side * 0.20, far - side * 0.16])
    drawAssemblyMember(mesh, point(at, -0.18, dockLevel - 0.66), point(at, 1.53, dockLevel - 0.19), 0.14, metal);
  for (const offset of [0.08, 1.5])
    drawAssemblyMember(mesh, point(far, offset, dockLevel), point(far, offset, dockLevel + 1.05), 0.068, metal);
  drawAssemblyMember(mesh, point(far, 0.08, dockLevel + 1.05), point(far, 1.5, dockLevel + 1.05), 0.06, metal);
}

function canalAtriumSectionCut(plan) {
  if (!plan.canalAtrium?.fitted) return null;
  const { portal, roof, faces, crossDirection } = plan.canalAtrium,
    points = faces.flat(), p = portal ? portal.point(0, 0) : points.reduce((sum, q) => sum.map((value, i) =>
      value + q[i] / points.length), [0, 0, 0]),
    angle = portal ? Math.atan2(portal.bank.wet[1], portal.bank.wet[0]) : crossDirection,
    at = siteLine([p[0], p[2]], angle),
    spans = plan.water.spans(at, -plan.radius * 2, plan.radius * 2),
    span = spans.find(([a, b]) => a < 0.1 && b > 0.1) ?? spans.sort(([a, b], [c, d]) => (d - c) - (b - a))[0];
  if (!span) return null;
  const [from, to] = span, studySpan = Math.min(to, plan.radius), glazingStation = (Math.max(-plan.radius, from) + studySpan) / 2,
    [x, z] = at(glazingStation);
  return { kind: 'canal-envelope', title: 'Atrium and canal · Sloped glass enclosure',
    note: 'The glazing rises to the next-storey crossing. The channel stays open underneath, with structural bearings on the banks.',
    at, angle, from: Math.max(-plan.radius - 5, from - 6), to: Math.min(plan.radius + 5, to + 6),
    crown: plan.crossingDeck + 1.6, recede: 2.4,
    labels: [[glazingStation, roof([x, 0, z]), 'Sloped insulated glazing'],
      [glazingStation, plan.water.level - 0.18, 'Continuous water channel'],
      ...(portal ? [[0, plan.floor + 1.25, 'Weather-sealed public canal door'], [0.8, plan.floor, 'Guarded water landing']] : [])] };
}
