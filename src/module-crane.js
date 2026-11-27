'use strict';

const CRANE_STAGES = {
  parked: 'Parked', pickup: '1 · Pick up at grade', hoist: '2 · Hoist beyond the stack',
  transfer: '3 · Set onto the cradle', insert: '4 · Slide into the dock', travel: 'Unloaded gantry travel'
};
const CRANE_PAINT = '#5d7971';
const CRANE_RUNWAYS = { elevated: 'Elevated outboard runway', moat: 'Moat with drawbridges' };

function craneCassetteRig() {
  return { pickupOffset: MODULE.depth * 0.30, jawHalfWidth: MODULE.width / 2 + 0.42, pinHeight: -MODULE_CASSETTE_DEPTH / 2 };
}

function cranePaint(assignments) {
  return paintHex(assignments?.mast?.paintHex) || CRANE_PAINT;
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
    rings = buildRingFrame(model),
    roofRail = roofPlan.y + 7.4,
    head = roofRail + 1.16,
    groundRail = runway === 'moat' ? -0.25 : 6.08,
    supports = [], roofTies = [],
    swingAngle = model.circulation.bridgeAngle;
  if (rings.outside - rings.inside < 1.8 || rings.inside < 3.18) return null;
  for (let j = 0; j < slotN; j++) {
    const angle = ((j + 0.5) * TAU) / slotN;
    // Choose piers between docking bays and route the ring beams over atrium
    // openings. The roof stairs share the inner edge at the swing axis.
    if (j % 2 && slotN >= 16) continue;
    // High-level ties continue between the rings even where a post would obstruct an opening.
    roofTies.push(angle);
    if (angDist(angle, swingAngle) < 2.35 / r ||
        lobbyHoles(model.lobby, 1).some(([a, half]) => angDist(a, angle) < half + 0.028) ||
        slide?.connections?.some((room) => angDist(room.angle, angle) < 1.22 / R)) continue;
    supports.push(angle);
  }
  return {
    dockTip, liftInner, liftOuter, liftCenter: (liftInner + liftOuter) / 2,
    tower, runway, extent: tower + (runway === 'moat' ? 7.1 : 3.2), groundRail, groundGauge: 3.1, roofRail, head, supports, roofTies,
    moatHalf: 4.25, gateAngles: [model.lobby.angle, model.lobby.angle + Math.PI],
    roofInner: rings.inside, roofOuter: rings.outside,
    width: 5.7, depth: clamp((tower - rings.outside) / 10, 3.75, 5.75)
  };
}

// The horizontal move is available on a dock only if the whole cassette can
// pass from the lift column to the core. The existing reservations cover
// entrance voids and climbing. Check the rest of the sweep against the slide.
function craneDockClear(model, crane, slot) {
  if (slot.blocked) return false;
  const slide = model.feature.slide;
  if (!slide) return true;
  const y = buildStorey(model, slot.f).base, c = Math.cos(slot.angle), s = Math.sin(slot.angle),
    pad = slide.tubeRadius + 0.56;
  return !slide.points.some(([x, h, z]) => {
    if (h < y - pad - 0.66 || h > y + MODULE.height + pad) return false;
    const along = x * c + z * s, across = -x * s + z * c;
    return along >= model.R + BUILD_SECTION.dockGap - pad && along <= crane.liftOuter + pad &&
      Math.abs(across) <= 3.45 + pad;
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
  const floorY = buildStorey(model, slot.f).base;
  return {
    stage, angle: slot.angle, slot, floorY,
    payloadY: stage === 'pickup' ? 0.36 : stage === 'hoist' ? floorY + 1.65 : floorY,
    payloadStart: stage === 'insert' ? crane.dockTip - MODULE.depth * 0.66 : crane.liftInner,
    onHook: stage === 'pickup' || stage === 'hoist',
    onCradle: stage === 'transfer' || stage === 'insert'
  };
}

function craneLoadStudy(model, crane, assignments = {}) {
  const { moduleWeight } = buildGravityStudy(model, assignments),
    load = Math.max(30 * 9.81, moduleWeight) + 3 * 9.81,
    bridgeWeight = 8.0,
    span = crane.tower - crane.roofOuter,
    x = crane.liftCenter - crane.roofOuter,
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
    tread = rgb('#3e5552'), concrete = rgb('#aeb7aa');
  if (crane.runway === 'moat') drawCraneMoat(mesh, model, crane, paint, pose?.angle ?? 316 * Math.PI / 180, animate);
  else drawElevatedCraneRunway(mesh, crane, paint, cutY);
  // Both raised rails sit over the primary annular support lines. A second
  // belt at the roof picks up the pier loads through breaks in the columns.
  mark('Crane_Core_Piers', 'Runway load path to the core foundations');
  for (const angle of supports) {
    const { block } = craneFrame(mesh, angle);
    for (const radius of [roofInner, roofOuter]) {
      block(radius, 0, 0.02, 0.83, 0.28, 0.88, concrete);
      block(radius, 0, 0.30, 0.51, Math.min(model.roofPlan.y - 0.30, cutY - 0.30), 0.48, paint);
    }
  }
  if (!roofVisible) return;
  mark('Crane_Roof_Collectors', 'Roof ring collectors above the permanent core');
  for (const radius of [roofInner, roofOuter]) {
    sector(radius - 0.36, radius + 0.36, 0, TAU, model.roofPlan.y - 0.80, 0.58, paint);
    sector(radius - 0.42, radius + 0.42, 0, TAU, roofRail - 0.96, 0.75, paint);
  }
  mark('Crane_Roof_Bents', 'Steel runway posts and knee braces');
  for (const angle of supports) {
    const { block, member } = craneFrame(mesh, angle);
    const base = model.roofPlan.y;
    for (const radius of [roofInner, roofOuter]) {
      block(radius, 0, base, 0.51, roofRail - 0.96 - base, 0.48, paint, true);
      block(radius, 0, base, 0.63, 0.15, 0.64, tread);
    }
    for (const side of [-1, 1]) {
      const from = side < 0 ? roofInner : roofOuter;
      member([from, 0, roofRail - 2.18], [from - side * 0.92, 0, roofRail - 0.77], 0.16, paint);
    }
  }
  mark('Crane_Roof_Ties', 'Overhead radial ties between roof collectors');
  for (const angle of roofTies) {
    const { member } = craneFrame(mesh, angle);
    member([roofInner, 0, roofRail - 0.69], [roofOuter, 0, roofRail - 0.69], 0.24, paint, 0.33);
  }
  mark('Crane_Roof_Rails', 'Concentric rack and flanged wheel runways');
  for (const radius of [roofInner, roofOuter]) {
    sector(radius - 0.24, radius + 0.24, 0, TAU, roofRail - 0.23, 0.075, tread);
    sector(radius - 0.065, radius + 0.065, 0, TAU, roofRail - 0.155, 0.11, paint);
    sector(radius - 0.115, radius + 0.115, 0, TAU, roofRail - 0.045, 0.045, tread);
  }
}

function drawCraneGantry(mesh, crane, pose, paint) {
  const { angle } = pose, { mark } = mesh,
    { block, member } = craneFrame(mesh, angle),
    dark = rgb('#3f5652'), steel = materialTint(paint, 1.24),
    amber = rgb('#d2a771'),
    { roofInner, roofOuter, tower, groundRail, groundGauge, roofRail, head, depth } = crane,
    cross = crane.width / 2, foot = groundRail + 0.47,
    divisions = Math.ceil((tower - roofInner) / 3.9),
    bottom = (r) => head + 0.25 * (r - roofInner) / (tower - roofInner),
    top = (r) => bottom(r) + depth * (0.55 + 0.45 * Math.sin(Math.PI * (r - roofInner) / (tower - roofInner))),
    towerLeg = (radius, y) => radius + (tower - radius) * (y - foot) / (head - foot),
    innerLeg = (y) => towerLeg(tower - groundGauge / 2, y);
  mark('Crane_Traveling_Gantry', 'Traveling double lattice bridge');
  for (const t of [-cross, cross]) {
    // Chords and a Warren web on both sides give the hoist a wide torsion box.
    for (let i = 0; i <= divisions; i++) {
      const r = roofInner + (tower - roofInner) * i / divisions,
        next = roofInner + (tower - roofInner) * (i + 1) / divisions;
      member([r, t, bottom(r)], [r, t, top(r)], 0.23, paint);
      if (t < 0) {
        member([r, -cross, top(r)], [r, cross, top(r)], 0.22, paint);
        member([r, -cross, bottom(r)], [r, cross, bottom(r)], 0.24, dark);
      }
      if (i === divisions) break;
      for (const h of [bottom, top]) member([r, t, h(r)], [next, t, h(next)], 0.31, paint, 0.38);
      member([r, t, i % 2 ? top(r) : bottom(r)], [next, t, i % 2 ? bottom(next) : top(next)], 0.23, paint);
      if (t < 0) member([r, -cross, top(r)], [next, cross, top(next)], 0.14, steel);
    }
    // The paired outboard legs carry vertical load into bogies on the two
    // grade rings. Leave the lift path open on the building side of this mast.
    for (const radius of [tower - groundGauge / 2, tower + groundGauge / 2]) {
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
    block(tower, t, head - 0.12, 0.63, bottom(tower) - head + 0.16, 0.66, paint, true);
    for (const radius of [roofInner, roofOuter]) {
      bogie(radius, t, roofRail, 0.43);
      member([Math.sqrt(radius ** 2 - t ** 2), t, roofRail + 0.39], [radius, t, bottom(radius)], 0.35, paint);
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

  mark('Crane_Transfer_Carriage', 'Guided carriage and deployable insertion rails');
  const y = pose.onCradle ? pose.floorY : Math.max(0.72, groundRail + 0.83);
  for (const t of [-cross, cross]) {
    const guide = tower - 2.18, guideTop = head - 0.12;
    member([guide, t, foot], [guide, t, guideTop], 0.18, dark);
    for (let at = foot; at < guideTop; at += 3.65) {
      member([guide, t, at], [innerLeg(at), t, at], 0.21, paint);
      if (at + 3.65 < guideTop)
        member([guide, t, at + 3.65], [innerLeg(at), t, at], 0.16, paint);
    }
    member([guide, t, guideTop], [innerLeg(head), t, head], 0.21, paint);
    const guideBottom = pose.onCradle ? Math.max(0.18, y - 3.05) : groundRail + 0.48,
      guideHead = Math.max(groundRail + 1.08, y + 0.33);
    block(tower - 2.18, t, guideBottom, 0.53, guideHead - guideBottom, 0.73, amber);
    if (!pose.onCradle) continue;
    // Side beams stay outside the cassette. Only shallow bearings reach the
    // permanent dock tip, in the gap below the incoming cassette.
    const a = crane.dockTip + 0.80, z = tower - 2.18, low = Math.min(y - 0.22, Math.max(0.18, y - 3.05));
    member([a, t, y - 0.22], [z, t, y - 0.22], 0.23, steel);
    member([a, t, y - 0.22], [z, t, low], 0.29, paint);
    for (let j = 1; j < 7; j++) {
      const r = a + (z - a) * j / 7;
      member([r, t, y - 0.22], [r, t, y - 0.22 - (y - 0.22 - low) * j / 7], 0.13, steel);
    }
    const runner = t < 0 ? -1.74 : 1.74;
    member([crane.dockTip - 0.22, runner, y - 0.26], [z, runner, y - 0.26], 0.16, dark);
    block(crane.dockTip + 0.08, runner, y - 0.33, 0.34, 0.15, 0.64, amber);
  }
  if (pose.onCradle) for (let r = crane.dockTip + 1.05; r < crane.liftOuter; r += 2.0)
    block(r, 0, y - 0.33, 5.84, 0.13, 0.17, steel);
  if (pose.slot) drawCraneCassette(mesh, angle, pose, amber);
  mark('Crane_Motion_End');
}

function drawCraneHoist(mesh, block, member, bottom, crane, pose, dark, steel, amber) {
  const { pickupOffset, jawHalfWidth, pinHeight } = craneCassetteRig(),
    inner = crane.liftCenter - pickupOffset, outer = crane.liftCenter + pickupOffset,
    rig = pose.onHook ? pose.payloadY + MODULE.height + 0.64 : bottom(inner) - 1.06;
  mesh.mark('Crane_Hoist', 'Mounted hoist heads and four-point cassette spreader');
  for (const r of [inner, outer]) {
    // The head spans between both lower chords. The hoist drums bolt to the crosshead.
    block(r, 0, bottom(r) - 0.43, crane.width + 0.27, 0.39, 0.58, dark, true);
    for (const t of [-jawHalfWidth, jawHalfWidth]) {
      block(r, t, bottom(r) - 0.07, 0.42, 0.51, 0.76, amber);
      member([r, t, bottom(r) - 0.43], [r, t, rig + 0.23], 0.041, dark);
    }
    block(r, 0, rig, 2 * jawHalfWidth + 0.24, 0.23, 0.26, amber, true);
  }
  for (const t of [-jawHalfWidth, jawHalfWidth])
    block(crane.liftCenter, t, rig + 0.02, 0.18, 0.18, 2 * pickupOffset + 0.26, steel, true);

  mesh.mark('Crane_Lifting_Jaws', pose.onHook ? 'Chassis-side drop arms and locking pins' : 'Folded lifting jaws');
  for (const r of [inner, outer]) for (const side of [-1, 1]) {
    const t = side * jawHalfWidth;
    block(r, t, rig - 0.12, 0.28, 0.26, 0.34, steel);
    if (!pose.onHook) {
      block(r, t - side * 0.78, rig - 0.24, 1.66, 0.19, 0.20, dark);
      continue;
    }
    const pinY = pose.payloadY + pinHeight, stroke = (rig - pinY) / 3;
    // Overlapping sleeves retract before the arms fold against the crosshead.
    for (const [i, width] of [0.18, 0.15, 0.12].entries()) {
      const top = rig - i * stroke, end = Math.max(pinY, top - stroke - 0.20);
      member([r, t, top], [r, t, end], width, i % 2 ? dark : steel);
    }
    // Positive engagement is into the side of the chassis at its mid-depth.
    member([r, t, pinY], [r, side * (MODULE.width / 2 - 0.07), pinY], 0.11, dark, 0.10);
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

function refreshCraneControls(model) {
  const crane = model?.crane, control = $('craneStage'), fields = $('cranePlacement'),
    notice = $('craneStatus');
  fields.hidden = !crane;
  if (!crane) {
    notice.textContent = 'Two roof runways need at least 1.8 m between their support lines.';
    return;
  }
  const pose = moduleCranePose(model, crane, state), floor = $('craneFloor'), bearing = $('craneBearing');
  control.value = state.craneStage;
  $('craneRunway').value = state.craneRunway;
  floor.max = String(model.layers.length);
  floor.value = String(clamp(state.craneFloor, 1, model.layers.length));
  floor.disabled = ['parked', 'travel'].includes(state.craneStage);
  bearing.value = String(state.craneBearing);
  $('craneBearingValue').value = Math.round((pose.slot ? pose.angle * 180 / Math.PI : state.craneBearing) % 360) + '°';
  const above = pose.slot && model.slots.some((slot) => slot.f > pose.slot.f && slot.j === pose.slot.j && !slot.blocked && slot.p !== EMPTY);
  notice.textContent = pose.blocked ? 'This level has no clear insertion lane.'
    : pose.slot ? `Level ${pose.slot.f + 1} · Bay ${pose.slot.j + 1}${above ? ' · Occupied above' : ''}`
      : pose.stage === 'travel' ? 'Unloaded gantry travel shown in time-lapse.' : 'Bogie bridge parked on the runways.';
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
  const change = () => {
    state.craneStage = select.value;
    state.craneFloor = clamp(Math.round($('craneFloor').valueAsNumber || 1), 1, model?.layers.length ?? 10);
    state.craneBearing = Number($('craneBearing').value);
    craneAnimation.angle = 0;
    craneAnimation.last = 0;
    refreshCraneControls(model);
    if (model && !pending) upload(model);
    queueSave();
  };
  for (const id of ['craneStage', 'craneFloor', 'craneBearing']) $(id).onchange = change;
  $('craneBearing').oninput = () => { $('craneBearingValue').value = $('craneBearing').value + '°'; };
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
      { point } = craneFrame(current, pose.angle), aspect = canvas.clientWidth / canvas.clientHeight,
      pivot = modelViewPivot(current), corners = [];
    // A side-on oblique reads the lift column and insertion direction in one view.
    camera.az = pose.angle + 0.96;
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
  if (state.craneStage !== 'travel' || !model?.crane) return;
  const start = mesh.groups.find((g) => g.layer === 'Crane_Traveling_Gantry'),
    end = mesh.groups.find((g) => g.layer === 'Crane_Motion_End');
  if (!start || !end) return;
  mesh.craneMotion = ['solid', 'lines'].map((kind) => ({ kind, start: start[kind],
    source: mesh[kind].slice(start[kind], end[kind]) }));
  const crane = model.crane;
  if (crane.runway === 'moat') {
    mesh.craneGateMotion = crane.gateAngles.map((axis, i) => {
      const capture = (layer) => {
        const index = mesh.groups.findIndex((group) => group.layer === `${layer}_${i + 1}`);
        return captureCraneRanges(mesh, mesh.groups[index], mesh.groups[index + 1]);
      };
      return { axis, ranges: capture('Crane_Drawbridge'), barrier: capture('Crane_Moat_Barrier') };
    });
    moveAnimatedMoatGates(mesh, 0);
  }
}

function animateCraneMotion(mesh, dt, gl, renderer) {
  craneAnimation.angle = mod(craneAnimation.angle + dt * TAU / 58, TAU);
  const c = Math.cos(craneAnimation.angle), s = Math.sin(craneAnimation.angle);
  moveAnimatedMoatGates(mesh, craneAnimation.angle, gl, renderer);
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
  if (crane?.runway !== 'moat') {
    mesh.quad([-extent, height, -extent], [-extent, height, extent], [extent, height, extent], [extent, height, -extent], ground);
    return;
  }
  const { tower, moatHalf } = crane;
  for (const [r, R] of [[0, tower - moatHalf], [tower + moatHalf, extent * Math.SQRT2]]) {
    for (let i = 0; i < 144; i++) {
      const a = i * TAU / 144, b = (i + 1) * TAU / 144, pt = (radius, az) => mesh.ringPoint(radius, az, height);
      if (!r) mesh.tri(pt(0, a), pt(R, b), pt(R, a), ground);
      else mesh.quad(pt(r, a), pt(r, b), pt(R, b), pt(R, a), ground);
    }
  }
}

function drawCraneMoat(mesh, model, crane, paint, angle, animate) {
  const { tower, moatHalf, groundRail, groundGauge, gateAngles } = crane,
    { sector, mark, box } = mesh, inner = tower - moatHalf, outer = tower + moatHalf,
    bank = rgb('#b2b6a6'), wet = rgb('#81a8a7'), steel = rgb('#516763'), wood = rgb('#c2ac89'),
    walkway = 4.30;
  mark('Crane_Moat', 'Recessed water, retaining banks and protected rail plinths');
  sector(inner, outer, 0, TAU, -1.43, 0.24, bank);
  sector(inner + 0.11, outer - 0.11, 0, TAU, -0.87, 0.025, wet);
  for (const radius of [inner + 0.20, outer - 0.20])
    sector(radius - 0.24, radius + 0.24, 0, TAU, -1.2, 1.40, bank);
  for (const radius of [tower - groundGauge / 2, tower + groundGauge / 2]) {
    sector(radius - 0.45, radius + 0.45, 0, TAU, -1.21, groundRail + 1.11, bank);
    sector(radius - 0.10, radius + 0.10, 0, TAU, groundRail - 0.10, 0.10, steel);
  }
  for (const radius of [inner - 0.10, outer + 0.10])
    for (const [a, b] of openArcs(gateAngles.map((axis) => [axis, (walkway / 2 + 0.14) / radius])))
      for (let j = 0, n = Math.ceil((b - a) * radius / 3.1); j < n; j++) {
        const p = a + (b - a) * j / n, q = a + (b - a) * (j + 1) / n,
          [x, y, z] = mesh.ringPoint(radius, p, 0.16);
        box(x, y, z, 0.068, 1.06, 0.07, p, steel);
        for (const y of [0.61, 1.21]) mesh.line(mesh.ringPoint(radius, p, y), mesh.ringPoint(radius, q, y), steel);
      }
  for (const [i, axis] of gateAngles.entries()) {
    const { block } = craneFrame(mesh, axis), from = Math.min(inner - 0.4, model.plaza.outer - 0.75),
      deck = outer - inner + 0.13;
    mark('Crane_Moat_Crossings', 'Lobby approach paths, hinge and receiving abutment');
    block((from + inner) / 2, 0, 0.05, walkway, 0.13, inner - from + 0.07, wood, true);
    block(outer + 1.18, 0, 0.05, walkway, 0.13, 2.43, wood, true);
    block(inner - 0.13, 0, 0.015, walkway + 0.22, 0.22, 0.34, steel);
    for (const bank of [inner - 0.72, outer + 0.72])
      block(bank, -2.05, 0.15, 0.23, 0.78, 0.24, steel, true);
    const barrierStart = { solid: mesh.solid.length, lines: mesh.lines.length };
    mark(`Crane_Moat_Barrier_${i + 1}`, 'Approach barriers close before the bridges rise');
    for (const bank of [inner - 0.72, outer + 0.72]) {
      block(bank, 0.01, 0.81, 4.14, 0.115, 0.085, rgb('#bc8b5f'), true);
      for (const t of [-1.42, 0, 1.42]) block(bank, t, 0.925, 0.22, 0.012, 0.086, steel);
    }
    mark('Crane_Moat_Barrier_Stop');
    if (!animate) rotateMoatGate(mesh, axis + Math.PI / 2, -2.05, barrierLift(crane, axis, angle),
      captureCraneRanges(mesh, barrierStart, mesh.groups.at(-1)), null, null, 0.87);
    const start = { solid: mesh.solid.length, lines: mesh.lines.length };
    mark(`Crane_Drawbridge_${i + 1}`, 'Counterweighted leaf on lobby axis');
    block(inner + deck / 2, 0, 0.135, walkway, 0.14, deck, wood, true);
    for (const side of [-1, 1]) {
      const t = side * (walkway / 2 - 0.13);
      block(inner + deck / 2, t, 0.20, 0.11, 1.07, 0.09, paint);
      block(inner + deck / 2, t, 1.19, 0.07, 0.084, deck, steel);
      for (let r = inner + 0.26; r < outer; r += 1.50) block(r, t, 0.274, 0.071, 0.94, 0.071, steel);
    }
    mark('Crane_Drawbridge_Stop');
    if (!animate)
      rotateMoatGate(mesh, axis, inner, gateLift(crane, axis, angle), captureCraneRanges(mesh, start, mesh.groups.at(-1)));
  }
}

function gateLift(crane, axis, angle) {
  const distance = angDist(axis, angle) * crane.tower,
    t = clamp((18 - distance) / 10, 0, 1);
  return (Math.PI / 2) * t * t * (3 - 2 * t);
}

function barrierLift(crane, axis, angle) {
  const t = clamp((angDist(axis, angle) * crane.tower - 19) / 7, 0, 1);
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

function moveAnimatedMoatGates(mesh, movement, gl = null, renderer = null) {
  if (!mesh.craneGateMotion) return;
  const crane = model.crane, angle = state.craneBearing * Math.PI / 180 + movement;
  for (const gate of mesh.craneGateMotion) {
    const height = gateLift(crane, gate.axis, angle), barrier = barrierLift(crane, gate.axis, angle);
    if (gate.rise !== height) {
      rotateMoatGate(mesh, gate.axis, crane.tower - crane.moatHalf, height, gate.ranges, gl, renderer);
      gate.rise = height;
    }
    if (gate.barrierAngle !== barrier) {
      rotateMoatGate(mesh, gate.axis + Math.PI / 2, -2.05, barrier, gate.barrier, gl, renderer, 0.87);
      gate.barrierAngle = barrier;
    }
  }
}

// Twin shallow guides align the cassette shoes with the receiving tray.
// The channel crowns stay at the existing underside datum of the cassette.
function drawDockInsertionGuides(mesh, model, slot, base) {
  const { block } = craneFrame(mesh, slot.angle),
    foot = model.R + BUILD_SECTION.dockGap, tip = foot + MODULE.depth,
    steel = rgb('#566c62'), keys = rgb('#ab8c66');
  mesh.mark(`Crane_Dock_Guides_L${slot.f + 1}`, `Dock ${slot.j + 1} · receiving guides`);
  for (const t of [-1.74, 1.74]) {
    block((foot + tip) / 2, t, base - MODULE_CASSETTE_DEPTH - 0.084,
      0.12, 0.084, MODULE.depth, steel);
    block(tip - 0.19, t, base - MODULE_CASSETTE_DEPTH - 0.115,
      0.24, 0.112, 0.38, keys);
  }
}
