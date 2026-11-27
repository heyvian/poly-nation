'use strict';

const CRANE_STAGES = {
  parked: 'Parked', pickup: '1 · Pick up at grade', hoist: '2 · Hoist beyond the stack',
  transfer: '3 · Engage the dock guides', insert: '4 · Feed into the dock', travel: 'Unloaded gantry travel'
};
const CRANE_PAINT = '#5d7971';
const CRANE_RUNWAYS = {
  elevated: 'Elevated outboard runway', moat: 'Moat with drawbridges', cantilever: 'Roof-only cantilever'
};
const MOAT_BRIDGE_WIDTH = 10;
const MOAT_SEGMENTS = 144;
const MOAT_HINGE_HEIGHT = 0.24;
const MOAT_BARRIER_HEIGHT = 0.92;
const MOAT_BARRIER_POST = MOAT_BRIDGE_WIDTH / 2 + 0.25;
const CRANE_BALLAST = 245; // kN, conceptual ballast over the inner bogies

function craneCassetteRig() {
  return { pickupOffset: MODULE.depth * 0.30, jawHalfWidth: MODULE.width / 2 + 0.70, pinHeight: -MODULE_CASSETTE_DEPTH / 2 };
}

function cranePaint(assignments) {
  return paintHex(assignments?.mast?.paintHex) || CRANE_PAINT;
}

function craneTouchesZone(zone, radius, angle, buffer) {
  return radius >= zone.r - buffer && radius <= zone.R + buffer &&
    angDist(angle, (zone.start + zone.end) / 2) <= (zone.end - zone.start) / 2 + buffer / radius;
}

function planModuleCrane(model, runway = 'elevated') {
  const { r, R, roofPlan, slotN } = model,
    dockTip = R + BUILD_SECTION.dockGap + MODULE.depth,
    slide = model.feature.slide,
    slideLimit = slide ? Math.max(...slide.points.map(([x, , z]) => Math.hypot(x, z))) + slide.tubeRadius : 0,
    // The cassette stays wholly outside the balcony tips throughout the lift.
    liftInner = Math.max(dockTip + 2.75, slideLimit + 1.15),
    liftOuter = liftInner + MODULE.depth,
    tower = liftOuter + 2.75,
    cantilever = runway === 'cantilever',
    rings = buildRingFrame(model),
    flightRadius = model.feature.ride?.flightRadius ?? 12,
    // Keep the whole hold-down assembly outside the glazing edge and the full swing radius.
    atriumClearRadius = Math.max(r + 0.26,
      flightRadius + Math.hypot(SWING_SEAT_WIDTH / 2, SWING_SEAT_DEPTH / 2) + 0.70),
    roofInner = cantilever ? Math.max(rings.inside, atriumClearRadius + 1.15) : rings.inside,
    roofOuter = rings.outside,
    roofHeight = Math.max(3.45, ...roofPlan.lifts.map((lift) => lift.accessHeight + lift.serviceHeight + 0.12),
      ...roofPlan.pavilions.map((pavilion) => pavilion.upper ? 6.45 : 3.45)),
    roofRail = roofPlan.y + Math.max(7.4, roofHeight + (cantilever ? 2.05 : 0.96) + 0.48),
    head = roofRail + 1.16,
    groundRail = cantilever ? null : runway === 'moat' ? -0.25 : 6.08,
    supports = [], roofTies = [],
    swingAngle = model.circulation.bridgeAngle,
    swingHalf = Math.atan2(2.65, r),
    roofObstacles = [...roofPlan.pavilions, ...roofPlan.lifts, ...roofPlan.garden.filter((zone) => zone.kind === 'gazebo')],
    approaches = model.circulation.regions.filter((zone) => zone.kind === 'bridgeAccess' || zone.kind === 'elevator'),
    lobbyOpenings = lobbyHoles(model.lobby, 1),
    blockedPost = (radius, angle) => roofObstacles.some((zone) => craneTouchesZone(zone, radius, angle, 0.79)) ||
      cantilever && (approaches.some((zone) => craneTouchesZone(zone, radius, angle, 0.52)) ||
        model.circulation.doors.some((door) => Math.abs(door.r - radius) < 0.72 && angDist(door.angle, angle) * radius < 1.40));
  if (roofOuter - roofInner < 1.8 || roofInner < 3.18) return null;
  for (let j = 0; j < slotN; j++) {
    const angle = ((j + 0.5) * TAU) / slotN;
    // Choose piers between docking bays and route the ring beams over atrium
    // openings. The roof stairs share the inner edge at the swing axis.
    if (j % 2 && slotN >= 16) continue;
    // High-level ties continue between the rings even where a post would obstruct an opening.
    roofTies.push(angle);
    if (angDist(angle, swingAngle) < swingHalf ||
        lobbyOpenings.some(([a, half]) => angDist(a, angle) < half + 0.028) ||
        slide?.connections?.some((room) => angDist(room.angle, angle) < 1.22 / R) ||
        [roofInner, roofOuter].some((radius) => blockedPost(radius, angle))) continue;
    supports.push(angle);
  }
  if (supports.length < 3) return null;
  return {
    dockTip, liftInner, liftOuter, liftCenter: (liftInner + liftOuter) / 2,
    tower, runway, extent: tower + (runway === 'moat' ? 7.1 : 3.2), groundRail, groundGauge: 3.1, roofRail, head, supports, roofTies,
    moatHalf: 4.25, gateAngles: [model.lobby.angle, model.lobby.angle + Math.PI],
    roofInner, roofOuter, atriumClearRadius,
    width: 5.7, depth: cantilever ? clamp((tower - rings.outside) / 5.6, 6.5, 9.0) :
      clamp((tower - rings.outside) / 10, 3.75, 5.75)
  };
}

// The horizontal move is available on a dock only if the whole cassette can
// pass from the lift column to the core. The existing reservations cover
// entrance voids and climbing. Check the rest of the sweep against the slide.
function craneDockClear(model, crane, slot) {
  if (slot.blocked) return false;
  if (crane.runway === 'moat' && crane.gateAngles.some((axis) =>
    angDist(axis, slot.angle) * (crane.tower - crane.moatHalf) < moatLiftFullyOpenAt(crane))) return false;
  const slide = model.feature.slide;
  if (!slide) return true;
  const y = buildStorey(model, slot.f).base, c = Math.cos(slot.angle), s = Math.sin(slot.angle),
    { jawHalfWidth } = craneCassetteRig(),
    pad = slide.tubeRadius + 0.56;
  return !slide.points.some(([x, h, z]) => {
    if (h < y - pad - 0.66 || h > crane.head + pad) return false;
    const along = x * c + z * s, across = -x * s + z * c;
    return along >= model.R + BUILD_SECTION.dockGap - pad && along <= crane.liftOuter + pad &&
      Math.abs(across) <= jawHalfWidth + 0.50 + pad;
  });
}

function moduleCranePose(model, crane, settings = {}) {
  const stage = Object.hasOwn(CRANE_STAGES, settings.craneStage) ? settings.craneStage : 'parked',
    floor = clamp((settings.craneFloor || 1) - 1, 0, model.layers.length - 1),
    bearing = mod((settings.craneBearing ?? 316) * Math.PI / 180, TAU),
    install = ['pickup', 'hoist', 'transfer', 'insert'].includes(stage);
  if (!install)
    return { stage, angle: bearing, slot: null };
  const slots = model.slots.filter((slot) => slot.f === floor && craneDockClear(model, crane, slot)),
    slot = slots.sort((a, b) => angDist(a.angle, bearing) - angDist(b.angle, bearing))[0];
  if (!slot) return { stage: 'parked', angle: bearing, slot: null, blocked: true };
  const floorY = buildStorey(model, slot.f).base, onDock = stage === 'transfer' || stage === 'insert',
    overlap = stage === 'insert' ? MODULE.depth * 0.60 : MODULE.depth * 0.15;
  return {
    stage, angle: slot.angle, slot, floorY,
    payloadY: stage === 'pickup' ? 0.36 : stage === 'hoist' ? floorY + 1.65 : floorY,
    payloadStart: onDock ? crane.dockTip - overlap : crane.liftInner,
    onDock, inboardHook: stage !== 'insert'
  };
}

function craneLoadStudy(model, crane, assignments = {}) {
  const { moduleWeight } = buildGravityStudy(model, assignments),
    load = Math.max(30 * 9.81, moduleWeight) + 3 * 9.81,
    span = crane.tower - crane.roofOuter,
    x = crane.liftCenter - crane.roofOuter;
  if (crane.runway === 'cantilever') {
    const bridgeWeight = 13, backspan = crane.roofOuter - crane.roofInner,
      moment = load * x + bridgeWeight * span ** 2 / 2,
      inner = CRANE_BALLAST + bridgeWeight * backspan / 2 - moment / backspan,
      rim = load + bridgeWeight * (span + backspan) + CRANE_BALLAST - inner;
    return { load, span, backspan, liftRadius: x, inner, rim, bridgeWeight, moment, ballast: CRANE_BALLAST };
  }
  const bridgeWeight = 8,
    outer = load * x / span + bridgeWeight * span / 2,
    rim = load + bridgeWeight * span - outer;
  return { load, span, liftRadius: x, outer, rim, bridgeWeight,
    moment: load * x * (span - x) / span + bridgeWeight * span ** 2 / 8 };
}

function craneFrame(mesh, angle) {
  const c = Math.cos(angle), s = Math.sin(angle),
    point = (r, t, y) => [r * c - t * s, y, r * s + t * c],
    block = (r, t, y, width, height, length, color, outline = false) => {
      const [x, , z] = point(r, t, y);
      mesh.box(x, y, z, width, height, length, angle, color, outline);
    },
    member = (a, b, width, color, depth) =>
      drawAssemblyMember(mesh, point(...a), point(...b), width, color, depth ?? width, angle);
  return { point, block, member };
}

function drawCraneInfrastructure(mesh, model, crane, paint, roofVisible, cutY = Infinity, pose = null, animate = false) {
  const { sector, mark } = mesh,
    { roofInner, roofOuter, roofRail, supports, roofTies } = crane,
    tread = rgb('#3e5552'), concrete = rgb('#aeb7aa'), cantilever = crane.runway === 'cantilever';
  if (crane.runway === 'moat') drawCraneMoat(mesh, model, crane, paint, pose?.angle ?? 316 * Math.PI / 180, animate);
  if (crane.runway === 'elevated') drawElevatedCraneRunway(mesh, crane, paint, cutY);
  // Both raised rails sit over the primary annular support lines. A second
  // belt at the roof picks up the pier loads through breaks in the columns.
  if (cantilever) drawCantileverAnchorage(mesh, model, crane, paint, cutY);
  else {
    mark('Crane_Core_Piers', 'Runway load path to the core foundations');
    for (const angle of supports) {
      const { block } = craneFrame(mesh, angle);
      for (const radius of [roofInner, roofOuter]) {
        block(radius, 0, 0.02, 0.83, 0.28, 0.88, concrete);
        block(radius, 0, 0.30, 0.51, Math.min(model.roofPlan.y - 0.30, cutY - 0.30), 0.48, paint);
      }
    }
  }
  if (!roofVisible) return;
  mark('Crane_Roof_Collectors', 'Roof ring collectors above the permanent core');
  for (const radius of [roofInner, roofOuter]) {
    const belt = cantilever ? 0.64 : 0.36, girder = cantilever ? 1.84 : 0.75;
    sector(radius - belt, radius + belt, 0, TAU, model.roofPlan.y - (cantilever ? 1.37 : 0.80),
      cantilever ? 1.22 : 0.58, paint);
    sector(radius - (cantilever && radius === roofInner ? 0.20 : 0.42),
      radius + (cantilever && radius === roofInner ? 0.20 : 0.42), 0, TAU, roofRail - 0.21 - girder, girder, paint);
  }
  mark('Crane_Roof_Bents', 'Steel runway posts and knee braces');
  for (const angle of supports) {
    const { block, member } = craneFrame(mesh, angle);
    const base = model.roofPlan.y;
    for (const radius of [roofInner, roofOuter]) {
      const size = cantilever ? 0.85 : 0.51;
      block(radius, 0, base, size, roofRail - (cantilever ? 2.05 : 0.96) - base, size, paint, true);
      block(radius, 0, base, size + 0.14, 0.15, size + 0.14, tread);
    }
    for (const side of [-1, 1]) {
      const from = side < 0 ? roofInner : roofOuter;
      const y = roofRail - (cantilever ? 1.16 : 0);
      member([from, 0, y - 2.18], [from - side * 0.92, 0, y - 0.77], cantilever ? 0.28 : 0.16, paint);
    }
  }
  mark('Crane_Roof_Ties', 'Overhead radial ties between roof collectors');
  for (const angle of roofTies) {
    const { member } = craneFrame(mesh, angle);
    member([roofInner, 0, roofRail - 0.69], [roofOuter, 0, roofRail - 0.69],
      cantilever ? 0.44 : 0.24, paint, cantilever ? 0.56 : 0.33);
    if (cantilever) member([roofInner, 0, roofRail - 1.78], [roofOuter, 0, roofRail - 1.78], 0.31, paint, 0.40);
  }
  mark('Crane_Roof_Rails', 'Concentric rack and flanged wheel runways');
  for (const radius of [roofInner, roofOuter]) {
    sector(radius - 0.24, radius + 0.24, 0, TAU, roofRail - 0.23, 0.075, tread);
    sector(radius - 0.065, radius + 0.065, 0, TAU, roofRail - 0.155, 0.11, paint);
    sector(radius - 0.115, radius + 0.115, 0, TAU, roofRail - 0.045, 0.045, tread);
  }
  if (cantilever) {
    mark('Crane_Cantilever_Hold_Down_Rail', 'Continuous inner hold-down flange for the captured rollers');
    sector(roofInner - 0.59, roofInner + 0.59, 0, TAU, roofRail - 0.47, 0.16, tread);
  }
}

function drawCantileverAnchorage(mesh, model, crane, paint, cutY) {
  const { roofInner, roofOuter, supports } = crane,
    concrete = rgb('#aab0a3'), steel = rgb('#526663');
  mesh.mark('Crane_Cantilever_Pile_Caps', 'Tied pile caps beneath both annular load paths');
  for (const radius of [roofInner, roofOuter])
    mesh.sector(radius - 0.72, radius + 0.72, 0, TAU, -0.86, 0.66, concrete);
  for (const angle of supports) {
    const { block } = craneFrame(mesh, angle);
    block((roofOuter + roofInner) / 2, 0, -0.83, 0.78, 0.62, roofOuter - roofInner, concrete);
    for (const radius of [roofInner, roofOuter]) for (const side of [-1, 1])
      block(radius, side * 0.46, -2.50, 0.42, 1.85, 0.42, concrete);
  }
  mesh.mark('Crane_Cantilever_Core_Frames', 'Outer compression piers and inner tension frames tied into the floor levels');
  const top = Math.min(model.roofPlan.y, cutY);
  if (top <= 0) return;
  for (const angle of supports) {
    const { block, member } = craneFrame(mesh, angle);
    block(roofOuter, 0, 0, 0.88, top, 0.94, paint, true);
    block(roofInner, 0, 0, 0.54, top, 0.56, paint, true);
    for (const side of [-1, 1])
      block(roofInner, side * 0.34, -0.58, 0.11, top + 0.58, 0.11, steel);
    for (let y = modelFloorPitch(model); y < top; y += modelFloorPitch(model))
      for (const radius of [roofInner, roofOuter])
        block(radius, 0, y - 0.13, 0.94, 0.25, 0.99, paint);
    if (top !== model.roofPlan.y) continue;
    const z = Math.max(top - 1.7, 0.4), gauge = roofOuter - roofInner;
    member([roofInner, 0, z], [roofInner + Math.min(1.65, gauge / 3), 0, top - 0.26], 0.31, paint);
    member([roofOuter, 0, z], [roofOuter - Math.min(1.65, gauge / 3), 0, top - 0.26], 0.31, paint);
  }
}

function drawCraneGantry(mesh, crane, pose, paint) {
  const { angle } = pose, { mark } = mesh,
    { block, member } = craneFrame(mesh, angle),
    dark = rgb('#3f5652'), steel = materialTint(paint, 1.24),
    amber = rgb('#d2a771'),
    { roofInner, roofOuter, tower, groundRail, groundGauge, roofRail, head, depth } = crane,
    cantilever = crane.runway === 'cantilever', cross = crane.width / 2, foot = (groundRail ?? 0) + 0.47,
    divisions = Math.ceil((tower - roofInner) / 3.9),
    bottom = (r) => head + 0.25 * (r - roofInner) / (tower - roofInner),
    top = (r) => bottom(r) + depth * (cantilever ? r <= roofOuter
      ? 0.60 + 0.40 * (r - roofInner) / (roofOuter - roofInner)
      : 1 - 0.68 * (r - roofOuter) / (tower - roofOuter)
      : 0.55 + 0.45 * Math.sin(Math.PI * (r - roofInner) / (tower - roofInner))),
    towerLeg = (radius, y) => radius + (tower - radius) * (y - foot) / (head - foot),
    innerLeg = (y) => towerLeg(tower - groundGauge / 2, y),
    stations = Array.from({ length: divisions + 1 }, (_, i) => roofInner + (tower - roofInner) * i / divisions);
  if (cantilever) {
    stations.push(roofOuter);
    stations.sort((a, b) => a - b);
  }
  mark('Crane_Traveling_Gantry', cantilever ? 'Deep cantilever and inboard backspan' : 'Traveling double lattice bridge');
  for (const t of [-cross, cross]) {
    // Chords and a Warren web on both sides give the hoist a wide torsion box.
    for (const [i, r] of stations.entries()) {
      const next = stations[i + 1], atRoot = cantilever && r === roofOuter;
      member([r, t, bottom(r)], [r, t, top(r)], atRoot ? 0.46 : 0.23, paint);
      if (t < 0) {
        member([r, -cross, top(r)], [r, cross, top(r)], 0.22, paint);
        member([r, -cross, bottom(r)], [r, cross, bottom(r)], 0.24, dark);
      }
      if (next == null) break;
      for (const h of [bottom, top]) member([r, t, h(r)], [next, t, h(next)], cantilever ? 0.46 : 0.31, paint,
        cantilever ? 0.55 : 0.38);
      member([r, t, i % 2 ? top(r) : bottom(r)], [next, t, i % 2 ? bottom(next) : top(next)], cantilever ? 0.31 : 0.23, paint);
      if (t < 0) member([r, -cross, top(r)], [next, cross, top(next)], 0.14, steel);
    }
    // The paired outboard legs carry vertical load into bogies on the two
    // grade rings. Leave the lift path open on the building side of this mast.
    for (const radius of cantilever ? [] : [tower - groundGauge / 2, tower + groundGauge / 2]) {
      const leg = (y) => towerLeg(radius, y);
      member([leg(foot), t, foot], [leg(head), t, head], 0.42, paint, 0.48);
      for (let y = foot; y < head; y += 3.65) {
        const above = Math.min(head, y + 3.65);
        if (radius > tower) {
          if (t > 0) member([leg(y), -cross, y], [leg(above), cross, above], 0.20, paint);
          member([leg(y), t, y], [innerLeg(above), t, above], 0.21, paint);
          member([leg(y), t, y], [innerLeg(y), t, y], 0.23, paint);
        }
      }
      bogie(radius, t, groundRail, 0.54);
    }
    if (!cantilever) block(tower, t, head - 0.12, 0.63, bottom(tower) - head + 0.16, 0.66, paint, true);
    for (const radius of [roofInner, roofOuter]) {
      bogie(radius, t, roofRail, 0.43);
      member([Math.sqrt(radius ** 2 - t ** 2), t, roofRail + 0.39], [radius, t, bottom(radius)], cantilever ? 0.61 : 0.35, paint);
    }
  }
  if (cantilever) {
    mark('Crane_Cantilever_Restraints', 'Inboard ballast and hook rollers beneath the rail flange');
    block(roofInner + 0.45, 0, bottom(roofInner) + 0.23, crane.width - 0.24, 1.38, 2.05, dark, true);
    for (const t of [-cross, cross]) {
      const r = Math.sqrt(roofInner ** 2 - t ** 2);
      for (const side of [-1, 1]) {
        const face = r + side * 0.49;
        block(face, t, roofRail - 0.65, 0.65, 0.96, 0.22, paint, true);
        block(face - side * 0.14, t, roofRail - 0.66, 0.28, 0.18, 0.30, dark);
      }
      block(r, t, roofRail + 0.25, 0.68, 0.20, 1.22, paint, true);
      bogie(roofOuter, t * 0.61, roofRail, 0.52);
      member([roofOuter, t * 0.61, roofRail + 0.49], [roofOuter, t, bottom(roofOuter)], 0.44, paint);
    }
  }
  function bogie(radius, t, y, width) {
    block(Math.sqrt(radius ** 2 - t ** 2), t, y + 0.21, width + 0.33, 0.29, 0.52, paint);
    for (const offset of [-0.27, 0.27]) {
      const at = t + offset, r = Math.sqrt(radius ** 2 - at ** 2);
      block(r, at, y, 0.28, 0.28, width, dark);
      block(r + width * 0.45, at, y - 0.052, 0.31, 0.315, 0.09, dark);
    }
  }
  drawCraneHoist(mesh, block, member, bottom, crane, pose, dark, steel, amber);

  if (pose.slot) drawCraneCassette(mesh, angle, pose, amber);
  mark('Crane_Motion_End');
}

function drawCraneHoist(mesh, block, member, bottom, crane, pose, dark, steel, amber) {
  const { pickupOffset, jawHalfWidth, pinHeight } = craneCassetteRig(),
    center = pose.slot ? pose.payloadStart + MODULE.depth / 2 : crane.liftCenter;
  mesh.mark('Crane_Hoist_Rails', 'Continuous radial trolley rails below the boom');
  for (const t of [-crane.width / 2, crane.width / 2]) {
    const start = crane.dockTip - MODULE.depth * 0.43, end = crane.liftOuter - 1.6;
    member([start, t, bottom(start) - 0.34], [end, t, bottom(end) - 0.34], 0.21, dark, 0.38);
  }
  mesh.mark('Crane_Hoist', 'Two traveling crossheads with independently reeling side hoists');
  for (const r of [center - pickupOffset, center + pickupOffset]) {
    const y = bottom(r), width = jawHalfWidth * 2 + 0.36;
    block(r, 0, y - 0.75, width, 0.34, 0.64, steel, true);
    for (const t of [-jawHalfWidth, jawHalfWidth]) {
      block(r, t, y - 0.40, 0.38, 0.43, 0.78, dark, true);
      block(r, t, y - 0.72, 0.43, 0.48, 0.55, amber, true);
    }
  }
  mesh.mark('Crane_Hoist_Lines', 'Four vertical hoist lines outside the cassette width');
  for (const r of [center - pickupOffset, center + pickupOffset]) {
    const engaged = pose.slot && (r > center || pose.inboardHook);
    for (const t of [-jawHalfWidth, jawHalfWidth]) {
      const pinY = engaged ? pose.payloadY + pinHeight : bottom(r) - 1.45;
      member([r, t, bottom(r) - 0.69], [r, t, pinY + 0.14], 0.047, dark);
    }
  }
  mesh.mark('Crane_Lifting_Jaws', 'Independent side heads with retracting chassis pins');
  for (const r of [center - pickupOffset, center + pickupOffset]) {
    const engaged = pose.slot && (r > center || pose.inboardHook);
    for (const side of [-1, 1]) {
      const t = side * jawHalfWidth, pinY = engaged ? pose.payloadY + pinHeight : bottom(r) - 1.45;
      block(r, t, pinY - 0.10, 0.22, 0.27, 0.30, amber, true);
      if (engaged) member([r, t, pinY], [r, side * (MODULE.width / 2 - 0.07), pinY], 0.11, dark, 0.10);
    }
  }
}

function drawCraneLiftSockets(mesh, angle, [x, y, z]) {
  const { pickupOffset, pinHeight } = craneCassetteRig(), color = rgb('#394c48'),
    cos = Math.cos(angle), sin = Math.sin(angle);
  for (const d of [-pickupOffset, pickupOffset]) for (const side of [-1, 1]) {
    const t = side * (MODULE.width / 2 - 0.05);
    mesh.box(x + d * cos - t * sin, y + pinHeight - 0.07, z + d * sin + t * cos,
      0.12, 0.14, 0.28, angle, color, true);
  }
}

function drawCraneCassette(mesh, angle, pose, amber) {
  const { block, point } = craneFrame(mesh, angle), r = pose.payloadStart + MODULE.depth / 2, y = pose.payloadY,
    shell = rgb('#d7c398'), glazing = rgb('#91aca8'), frame = rgb('#626e66');
  mesh.mark('Crane_Demonstration_Module', '18 m reference cassette');
  block(r, 0, y - MODULE_CASSETTE_DEPTH, MODULE.width, MODULE_CASSETTE_DEPTH, MODULE.depth, frame, true);
  block(r, 0, y, MODULE.width - 0.06, 3.31, MODULE.depth - 0.08, shell, true);
  block(r, 0, y + 3.31, MODULE.width - 0.03, 0.19, MODULE.depth, amber, true);
  for (const s of [-1, 1]) for (const offset of [-5.2, -1.7, 1.9, 5.5])
    block(r + offset, s * (MODULE.width / 2 - 0.02), y + 1.02, 0.025, 1.27, 1.55, glazing, true);
  drawCraneLiftSockets(mesh, angle, point(r, 0, y));
  if (pose.stage === 'pickup') {
    // The ground pickup uses removable crib rails on the service apron.
    for (const d of [-6.1, 6.1]) block(r + d, 0, 0.02, 4.94, 0.16, 0.48, frame);
  }
}

const craneAnimation = { angle: 0, last: 0 };

function craneDegrees(angle) {
  return mod(Math.round(angle * 180 / Math.PI), 360);
}

function showCranePosition(model, pose) {
  const crane = model.crane;
  $('craneBearingValue').value = craneDegrees(pose.angle) + '°';
  const above = pose.slot && model.slots.some((slot) => slot.f > pose.slot.f && slot.j === pose.slot.j && !slot.blocked && slot.p !== EMPTY);
  let message = pose.blocked ? 'This level has no clear insertion lane.'
    : pose.slot ? `Level ${pose.slot.f + 1} · Bay ${pose.slot.j + 1}${above ? ' · Occupied above' : ''}`
      : pose.stage === 'travel' ? 'Unloaded gantry travel' : 'Parked';
  if (crane.runway === 'moat') {
    const axis = crane.gateAngles.find((a) => barrierLift(crane, a, pose.angle) < Math.PI / 2);
    if (axis != null) {
      const lift = gateLift(crane, axis, pose.angle);
      message += lift === Math.PI / 2 ? ' · Drawbridge raised'
        : lift > 0 ? ' · Drawbridge between positions' : ' · Approach barriers active';
    }
  }
  const notice = $('craneStatus');
  if (notice.textContent !== message) notice.textContent = message;
}

function refreshCraneControls(model) {
  const crane = model?.crane, control = $('craneStage'), floor = $('craneFloor');
  $('craneRunway').value = state.craneRunway;
  control.value = state.craneStage;
  for (const id of ['craneStage', 'craneBearing', 'craneBearingDegrees', 'focusCrane']) $(id).disabled = !crane;
  $('parkCrane').hidden = !crane || state.craneStage !== 'travel';
  $('craneBearing').value = $('craneBearingDegrees').value = String(state.craneBearing);
  floor.max = String(model?.layers.length ?? 1);
  floor.value = String(clamp(state.craneFloor, 1, model?.layers.length ?? 1));
  floor.disabled = !crane || ['parked', 'travel'].includes(state.craneStage);
  if (!crane) {
    $('craneBearingValue').value = '—';
    $('craneStatus').textContent = state.craneRunway === 'cantilever'
      ? 'The roof-only crane needs room for two rails and piers clear of the atrium, swing and approaches.'
      : 'Two roof runways need 1.8 m between rails and at least three clear pier locations.';
    return;
  }
  showCranePosition(model, moduleCranePose(model, crane, state));
}

function initCraneControls() {
  const select = $('craneStage');
  select.replaceChildren(...Object.entries(CRANE_STAGES).map(([key, label]) => new Option(label, key)));
  const runway = $('craneRunway');
  runway.replaceChildren(...Object.entries(CRANE_RUNWAYS).map(([key, label]) => new Option(label, key)));
  runway.onchange = () => {
    state.craneRunway = runway.value;
    craneAnimation.angle = 0;
    craneAnimation.last = 0;
    scheduleUpdate();
  };
  let frame = 0;
  const change = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    state.craneStage = select.value;
    state.craneFloor = clamp(Math.round($('craneFloor').valueAsNumber || 1), 1, model?.layers.length ?? 10);
    state.craneBearing = Number($('craneBearing').value);
    craneAnimation.angle = 0;
    craneAnimation.last = 0;
    refreshCraneControls(model);
    if (model && !pending) upload(model);
    queueSave();
  };
  for (const id of ['craneStage', 'craneFloor']) $(id).onchange = change;
  function setBearing(degrees) {
    if (!model?.crane) return;
    state.craneBearing = Number.isFinite(degrees) ? clamp(Math.round(degrees), 0, 359) : state.craneBearing;
    $('craneBearing').value = $('craneBearingDegrees').value = String(state.craneBearing);
    craneAnimation.angle = 0;
    craneAnimation.last = 0;
    const mesh = software ? softwareMesh : gpu?.mesh, pose = moduleCranePose(model, model.crane, state);
    showCranePosition(model, pose);
    if (!pending && mesh?.craneMotion) {
      moveCraneTo(mesh, pose.angle, software ? null : gl, gpu);
      draw();
    } else if (!pending && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) upload(model);
      });
    }
    queueSave();
  }
  $('craneBearing').oninput = (event) => setBearing(event.target.valueAsNumber);
  $('craneBearingDegrees').onchange = (event) => setBearing(event.target.valueAsNumber);
  $('parkCrane').onclick = () => {
    const requested = state.craneBearing * Math.PI / 180 + craneAnimation.angle;
    $('craneBearing').value = String(craneDegrees(requested));
    select.value = 'parked';
    change();
  };
  $('focusCrane').onclick = () => {
    const mesh = software ? softwareMesh : gpu?.mesh, crane = model?.crane;
    if (!mesh || !crane) return;
    if (state.inspect || !state.showRoofDeck) {
      state.inspect = 0;
      state.showRoofDeck = true;
      syncControls();
      upload(model);
    }
    const pose = moduleCranePose(model, crane, state), current = software ? softwareMesh : gpu?.mesh,
      angle = pose.angle + (pose.stage === 'travel' ? craneAnimation.angle : 0),
      { point } = craneFrame(current, angle), aspect = canvas.clientWidth / canvas.clientHeight,
      pivot = modelViewPivot(current), corners = [];
    // A side-on oblique reads the lift column and insertion direction in one view.
    camera.az = angle + 0.96;
    camera.el = 0.34;
    const { right, up } = orbitBasis(camera);
    for (const radius of [crane.roofInner - 2, crane.tower + 3])
      for (const t of [-4, 4]) for (const y of [0, crane.head + crane.depth + 1])
        corners.push(sub(point(radius, t, y), pivot));
    const x = corners.map((p) => dot(p, right)), y = corners.map((p) => dot(p, up)),
      half = Math.max((Math.max(...x) - Math.min(...x)) / aspect, Math.max(...y) - Math.min(...y)) * 0.59;
    camera.panX = (Math.max(...x) + Math.min(...x)) / 2;
    camera.pan = (Math.max(...y) + Math.min(...y)) / 2;
    camera.zoom = half / baseViewHalf(current, camera, aspect);
    draw();
    queueSave();
  };
}

function prepareCraneMotion(mesh) {
  if (!['parked', 'travel'].includes(state.craneStage) || !model?.crane) return;
  const start = mesh.groups.find((g) => g.layer === 'Crane_Traveling_Gantry'),
    end = mesh.groups.find((g) => g.layer === 'Crane_Motion_End');
  if (!start || !end) return;
  mesh.craneMotion = ['solid', 'lines'].map((kind) => ({ kind, start: start[kind],
    source: mesh[kind].slice(start[kind], end[kind]) }));
  const crane = model.crane;
  mesh.craneBaseBearing = state.craneBearing * Math.PI / 180;
  if (crane.runway === 'moat') {
    mesh.craneGateMotion = crane.gateAngles.map((axis, i) => {
      const capture = (layer) => {
        const index = mesh.groups.findIndex((group) => group.layer === `${layer}_${i + 1}`);
        return captureCraneRanges(mesh, mesh.groups[index], mesh.groups[index + 1]);
      };
      const range = (side) => {
        const index = mesh.groups.findIndex((group) => group.layer === `Crane_Moat_Barrier_${i + 1}_${side}`);
        return { side, mesh: captureCraneRanges(mesh, mesh.groups[index], mesh.groups[index + 1]) };
      };
      return { axis, ranges: capture('Crane_Drawbridge'), barriers: [-1, 1].map(range) };
    });
  }
  moveCraneTo(mesh, mesh.craneBaseBearing + (state.craneStage === 'travel' ? craneAnimation.angle : 0));
}

function animateCraneMotion(mesh, dt, gl, renderer) {
  craneAnimation.angle = mod(craneAnimation.angle + dt * TAU / 58, TAU);
  const angle = state.craneBearing * Math.PI / 180 + craneAnimation.angle;
  moveCraneTo(mesh, angle, gl, renderer);
  if ($('moduleCraneControls').open) showCranePosition(model, { angle, stage: 'travel' });
}

function moveCraneTo(mesh, angle, gl, renderer) {
  const turn = angle - mesh.craneBaseBearing, c = Math.cos(turn), s = Math.sin(turn);
  moveAnimatedMoatGates(mesh, angle, gl, renderer);
  for (const { kind, start, source } of mesh.craneMotion) {
    const target = mesh[kind];
    for (let i = 0; i < source.length; i += 10) {
      target[start + i] = source[i] * c - source[i + 2] * s;
      target[start + i + 2] = source[i] * s + source[i + 2] * c;
      target[start + i + 3] = source[i + 3] * c - source[i + 5] * s;
      target[start + i + 5] = source[i + 3] * s + source[i + 5] * c;
    }
    if (gl && renderer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffers[kind]);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, new Float32Array(target.slice(start, start + source.length)));
    }
  }
}

// The elevated pair carries both bogie lines on continuous steel girders.
// Discrete columns leave openings between the grade footings for the approach.
function drawElevatedCraneRunway(mesh, crane, paint, cutY) {
  const { sector, mark } = mesh, { tower, groundGauge, groundRail } = crane,
    dark = rgb('#3c5854'), concrete = rgb('#b4b8ac'), gauge = groundGauge / 2,
    soffit = groundRail - 1.28;
  mark('Crane_Elevated_Runway_Columns', 'Spaced pier pairs and independent footings');
  const count = Math.ceil(TAU * tower / 12);
  for (let i = 0; i < count; i++) {
    const { block } = craneFrame(mesh, (i + 0.5) * TAU / count);
    for (const radius of [tower - gauge, tower + gauge]) {
      block(radius, 0, -0.07, 1.32, 0.31, 1.21, concrete);
      block(radius, 0, 0.24, 0.64, Math.max(0, Math.min(soffit, cutY) - 0.24), 0.62, paint, true);
    }
  }
  if (cutY < soffit) return;
  mark('Crane_Elevated_Runway', 'Twin ring girders with clear crossings below');
  for (const radius of [tower - gauge, tower + gauge]) {
    sector(radius - 0.34, radius + 0.34, 0, TAU, soffit, 0.22, dark);
    sector(radius - 0.22, radius + 0.22, 0, TAU, soffit + 0.22, 0.84, paint);
    sector(radius - 0.38, radius + 0.38, 0, TAU, groundRail - 0.22, 0.16, paint);
    sector(radius - 0.097, radius + 0.097, 0, TAU, groundRail - 0.07, 0.07, dark);
  }
  for (let i = 0; i < count * 2; i++) {
    const angle = (i + 0.5) * TAU / (count * 2), { block, member } = craneFrame(mesh, angle);
    block(tower, 0, soffit + 0.23, 0.33, 0.61, groundGauge, paint);
    if (i % 2 === 0) member([tower - gauge, 0, soffit + 0.63], [tower + gauge, 1.9, soffit + 0.63], 0.19, dark);
  }
}

function drawCraneGround(mesh, extent, ground, height, crane) {
  const moat = craneMoatBounds(crane);
  if (!moat) {
    mesh.quad([-extent, height, -extent], [-extent, height, extent], [extent, height, extent], [extent, height, -extent], ground);
    return;
  }
  for (const [r, R] of [[0, moat.inner], [moat.outer, extent * Math.SQRT2]]) {
    for (let i = 0; i < MOAT_SEGMENTS; i++) {
      const a = i * TAU / MOAT_SEGMENTS, b = (i + 1) * TAU / MOAT_SEGMENTS, pt = (radius, az) => mesh.ringPoint(radius, az, height);
      if (!r) mesh.tri(pt(0, a), pt(R, b), pt(R, a), ground);
      else mesh.quad(pt(r, a), pt(r, b), pt(R, b), pt(R, a), ground);
    }
  }
}

function craneMoatBounds(crane) {
  return crane?.runway === 'moat' ? { inner: crane.tower - crane.moatHalf, outer: crane.tower + crane.moatHalf } : null;
}

function drawCraneMoat(mesh, model, crane, paint, angle, animate) {
  const { tower, groundRail, groundGauge, gateAngles } = crane,
    { sector, mark, box } = mesh, { inner, outer } = craneMoatBounds(crane),
    bank = rgb('#b2b6a6'), wet = rgb('#79a8b0'), steel = rgb('#516763'), wood = rgb('#c2ac89'),
    waterLevel = -0.84, beamBase = groundRail - 0.32, basinTop = -1.19,
    walkway = MOAT_BRIDGE_WIDTH, deckWidth = walkway + 0.32;
  mark('Crane_Moat', 'Basin and retaining banks');
  sector(inner, outer, 0, TAU, -1.43, 0.24, bank);
  for (const radius of [inner + 0.20, outer - 0.20])
    sector(radius - 0.24, radius + 0.24, 0, TAU, -1.2, 1.40, bank);
  mark('Crane_Moat_Water', 'Continuous water below the runway');
  sector(inner + 0.40, outer - 0.40, 0, TAU, waterLevel - 0.025, 0.025, wet);
  mark('Crane_Moat_Runway', 'Raised rail beams on discrete piers');
  const piers = Math.ceil(TAU * tower / 4.8);
  for (const radius of [tower - groundGauge / 2, tower + groundGauge / 2]) {
    sector(radius - 0.21, radius + 0.21, 0, TAU, beamBase, groundRail - 0.10 - beamBase, paint);
    sector(radius - 0.10, radius + 0.10, 0, TAU, groundRail - 0.10, 0.10, steel);
    for (let i = 0; i < piers; i++) {
      const theta = (i + 0.5) * TAU / piers, [x, , z] = mesh.ringPoint(radius, theta, basinTop);
      box(x, basinTop, z, 0.48, beamBase - basinTop, 0.44, theta, bank);
    }
  }
  mark('Crane_Moat_Guards', 'Bank guards with openings at the drawbridges');
  for (const radius of [inner - 0.10, outer + 0.10])
    for (const [a, b] of openArcs(gateAngles.map((axis) => [axis, Math.asin((deckWidth / 2 + 0.20) / radius)])))
      for (let j = 0, n = Math.ceil((b - a) * radius / 3.1); j < n; j++) {
        const p = a + (b - a) * j / n, q = a + (b - a) * (j + 1) / n,
          [x, y, z] = mesh.ringPoint(radius, p, 0.16);
        box(x, y, z, 0.068, 1.06, 0.07, p, steel);
        for (const y of [0.61, 1.21]) mesh.line(mesh.ringPoint(radius, p, y), mesh.ringPoint(radius, q, y), steel);
      }

  for (const [i, axis] of gateAngles.entries()) {
    const { block, member } = craneFrame(mesh, axis), from = Math.min(inner - 2.12, model.plaza.outer - 0.75),
      leaf = outer - inner + 0.12, mid = inner + leaf / 2, girderLines = [-4.33, -1.44, 1.44, 4.33],
      approach = [inner - 1.64, outer + 1.10], pin = MOAT_HINGE_HEIGHT;
    mark('Crane_Moat_Crossings', 'Lobby walks, reinforced bascule pocket and end bearings');
    block((from + inner) / 2, 0, 0.17, walkway, 0.14, inner - from, wood, true);
    block(outer + 1.24, 0, 0.17, walkway, 0.14, 2.40, wood, true);
    block(inner - 0.46, 0, -1.45, deckWidth + 0.56, 1.60, 0.78, bank, true);
    block(outer - 0.03, 0, -1.45, deckWidth + 0.56, 1.42, 0.76, bank, true);
    for (const t of girderLines) {
      block(inner - 0.10, t, -0.04, 0.58, 0.37, 0.42, steel, true);
      block(outer - 0.06, t, -0.10, 0.48, 0.14, 0.37, steel, true);
    }
    member([inner, -deckWidth / 2 - 0.21, pin], [inner, deckWidth / 2 + 0.21, pin], 0.17, steel);
    for (const side of [-1, 1])
      block(inner - 0.23, side * (deckWidth / 2 + 0.16), -0.01, 0.43, 0.64, 0.68, steel, true);
    for (const r of approach) for (const side of [-1, 1])
      block(r, side * MOAT_BARRIER_POST, 0.18, 0.25, 0.84, 0.27, steel, true);
    for (const side of [-1, 1]) {
      const start = { solid: mesh.solid.length, lines: mesh.lines.length };
      mark(`Crane_Moat_Barrier_${i + 1}_${side}`, 'Paired pedestrian barriers close before the leaf rises');
      for (const r of approach) {
        const t = side * (MOAT_BARRIER_POST + 0.045) / 2;
        block(r, t, MOAT_BARRIER_HEIGHT - 0.059, MOAT_BARRIER_POST - 0.045, 0.118, 0.088, rgb('#bc8b5f'), true);
        for (const band of [1.1, 2.6, 4.1])
          block(r, side * band, MOAT_BARRIER_HEIGHT + 0.032, 0.19, 0.034, 0.093, steel);
      }
      mark('Crane_Moat_Barrier_Stop');
      if (!animate) rotateMoatGate(mesh, axis - side * Math.PI / 2, -MOAT_BARRIER_POST, barrierLift(crane, axis, angle),
        captureCraneRanges(mesh, start, mesh.groups.at(-1)), null, null, MOAT_BARRIER_HEIGHT);
    }
    const start = { solid: mesh.solid.length, lines: mesh.lines.length };
    mark(`Crane_Drawbridge_${i + 1}`, '10 m clear single-leaf bascule drawbridge');
    block(mid, 0, 0.20, deckWidth, 0.11, leaf, wood, true);
    for (const t of girderLines) {
      // A shallow welded box clears the rail heads when the leaf is seated.
      block(mid, t, -0.10, 0.24, 0.32, leaf - 0.10, paint);
      block(mid, t, -0.12, 0.38, 0.065, leaf - 0.14, steel);
      block(inner - 0.80, t, -0.11, 0.34, 0.29, 1.58, paint);
      block(inner - 1.55, t, -0.42, 0.91, 0.57, 0.74, steel, true);
    }
    for (let r = inner + 0.19; r < outer; r += 1.35)
      block(r, 0, -0.075, deckWidth - 0.34, 0.26, 0.18, paint);
    for (const t of [-1, 1].map((side) => side * (walkway / 2 + 0.055))) {
      block(mid, t, 1.31, 0.11, 0.082, leaf, steel);
      for (let r = inner + 0.13; r < outer; r += 1.48) block(r, t, 0.31, 0.072, 1.00, 0.070, steel);
      for (const y of [0.63, 0.96]) member([inner, t, y], [inner + leaf, t, y], 0.029, steel);
    }
    mark('Crane_Drawbridge_Stop');
    if (!animate)
      rotateMoatGate(mesh, axis, inner, gateLift(crane, axis, angle),
        captureCraneRanges(mesh, start, mesh.groups.at(-1)), null, null, pin);
  }
}

function moatLiftFullyOpenAt(crane) {
  return MOAT_BRIDGE_WIDTH / 2 + crane.width / 2 + 2.4;
}

function gateLift(crane, axis, angle) {
  const distance = angDist(axis, angle) * (crane.tower - crane.moatHalf),
    t = clamp((moatLiftFullyOpenAt(crane) + 12 - distance) / 12, 0, 1);
  return (Math.PI / 2) * t * t * (3 - 2 * t);
}

function barrierLift(crane, axis, angle) {
  const distance = angDist(axis, angle) * (crane.tower - crane.moatHalf),
    t = clamp((distance - moatLiftFullyOpenAt(crane) - 14) / 8, 0, 1);
  return (Math.PI / 2) * t * t * (3 - 2 * t);
}

function captureCraneRanges(mesh, start, end) {
  if (!start || !end) return [];
  return ['solid', 'lines'].map((kind) => ({ kind, start: start[kind], source: mesh[kind].slice(start[kind], end[kind]) }));
}

function rotateMoatGate(mesh, axis, hinge, rise, ranges, gl = null, renderer = null, y = 0.19) {
  const c = Math.cos(axis), s = Math.sin(axis), u = Math.cos(rise), v = Math.sin(rise);
  for (const { kind, start, source } of ranges) {
    const target = mesh[kind];
    for (let i = 0; i < source.length; i += 10) {
      const radial = source[i] * c + source[i + 2] * s - hinge,
        height = source[i + 1] - y, dr = radial * (u - 1) - height * v,
        nr = source[i + 3] * c + source[i + 5] * s, ny = source[i + 4], N = nr * (u - 1) - ny * v;
      target[start + i] = source[i] + dr * c;
      target[start + i + 1] = y + radial * v + height * u;
      target[start + i + 2] = source[i + 2] + dr * s;
      target[start + i + 3] = source[i + 3] + N * c;
      target[start + i + 4] = nr * v + ny * u;
      target[start + i + 5] = source[i + 5] + N * s;
    }
    if (gl && renderer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffers[kind]);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, new Float32Array(target.slice(start, start + source.length)));
    }
  }
}

function moveAnimatedMoatGates(mesh, angle, gl = null, renderer = null) {
  if (!mesh.craneGateMotion) return;
  const crane = model.crane;
  for (const gate of mesh.craneGateMotion) {
    const height = gateLift(crane, gate.axis, angle), barrier = barrierLift(crane, gate.axis, angle);
    if (gate.rise !== height) {
      rotateMoatGate(mesh, gate.axis, crane.tower - crane.moatHalf, height, gate.ranges, gl, renderer, MOAT_HINGE_HEIGHT);
      gate.rise = height;
    }
    if (gate.barrierAngle !== barrier) {
      for (const { side, mesh: parts } of gate.barriers)
        rotateMoatGate(mesh, gate.axis - side * Math.PI / 2, -MOAT_BARRIER_POST, barrier, parts, gl, renderer, MOAT_BARRIER_HEIGHT);
      gate.barrierAngle = barrier;
    }
  }
}

// Twin shallow guides align the cassette shoes with the receiving tray.
// The channel crowns stay at the existing underside datum of the cassette.
function drawDockInsertionGuides(mesh, model, slot, base) {
  const { block } = craneFrame(mesh, slot.angle),
    foot = model.R + BUILD_SECTION.dockGap, tip = foot + MODULE.depth,
    underside = base - MODULE_CASSETTE_DEPTH, steel = rgb('#566c62'), keys = rgb('#ab8c66');
  mesh.mark(`Crane_Dock_Guides_L${slot.f + 1}`, `Dock ${slot.j + 1} · receiving guides`);
  for (const t of [-1.74, 1.74]) {
    block((foot + tip) / 2, t, underside - 0.18, 0.20, 0.10, MODULE.depth, steel);
    for (const inset of [0.25, 2.05, 4.3, 6.55, 8.8, 11.05, 13.3, 15.55, 17.5])
      block(tip - inset, t, underside - 0.083, 0.26, 0.083, 0.18, keys);
    block(tip - 0.20, t, underside - 0.18, 0.51, 0.10, 0.40, steel, true);
  }
}
