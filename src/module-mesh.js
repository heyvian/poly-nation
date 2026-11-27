'use strict';

// The local origin is the ring-side door sill. All walls, joists, fittings and
// windows use these coordinates, so changing a layout never moves the dock.
function moduleParts(mesh, slot, x, base, z) {
  const { angle } = slot, cos = Math.cos(angle), sin = Math.sin(angle);
  const point = (across, along, up) => [x + along * cos - across * sin, base + up, z + along * sin + across * cos];
  function box(across, along, up, width, depth, height, color, outline = false, gloss = 0) {
    const [px, py, pz] = point(across, along, up);
    mesh.box(px, py, pz, width, height, depth, angle, color, outline, gloss);
  }
  return { point, box };
}

function drawFittedModule(mesh, slot, x, y, z, preview, plan, options = {}) {
  const { box, point } = moduleParts(mesh, slot, x, y, z),
    { values, wall, length, ceiling, patio, form } = plan,
    { assembly = false, enclosure = !preview.structureView, interiors = false, cover = true } = options,
    system = STRUCTURAL_SYSTEMS[values.structure],
    byProgram = preview.programColors && PROGRAMS[slot.p] ? rgb(PROGRAMS[slot.p].color) : null,
    framing = byProgram || rgb(system.color),
    post = values.structure === 'glulam' ? 0.155 : system.frame === 'stud' ? 0.075 : 0.105,
    baySpacing = system.frame === 'stud' ? 0.66 : system.frame === 'post' ? 2.40 : 1.65,
    paint = enclosure && !preview.programColors && slot.p !== EMPTY ? modulePaint(preview.assignments, slot.p) : null,
    appearance = moduleFacadeAppearance(plan, paint, byProgram),
    reference = `${slot.f + 1}/Slot_${slot.j}`;
  if (assembly) mesh.mark('Assembly_Module_Chassis', reference);
  box(0, MODULE.depth / 2, -MODULE_CASSETTE_DEPTH, MODULE.width, MODULE.depth, MODULE_CASSETTE_DEPTH, framing, true);
  const deck = enclosure || interiors ? rgb('#c5b59c') : framing;
  for (let i = 1; i < form.stations.length; i++) {
    const a = form.stations[i - 1], b = form.stations[i], A = moduleHalfAt(form, a) - 0.025, B = moduleHalfAt(form, b) - 0.025;
    mesh.quad(point(-A, a, 0.003), point(A, a, 0.003), point(B, b, 0.003), point(-B, b, 0.003), deck);
  }
  if (patio) {
    if (assembly) mesh.mark('Assembly_Module_Terrace', reference);
    drawFittedModuleTerrace(mesh, slot, x, y, z, plan);
  }
  if (assembly) mesh.mark(enclosure ? 'Assembly_Module_Skin' : 'Assembly_Module_Frame', reference);
  const elevation = (side, sign, apertures) => drawModuleElevation(mesh, plan, point, box, slot.angle, appearance, {
    side, sign, apertures, enclosure, finishJoints: preview.finishJoints, framing, post, baySpacing, system
  });
  elevation(true, -1, plan.sideWindows[0]);
  elevation(true, 1, plan.sideWindows[1]);
  elevation(false, -1, [{ center: 0, width: plan.doorWidth, bottom: 0, top: plan.doorHeight, door: true, dock: true }]);
  elevation(false, 1, [plan.endOpening]);
  if (cover) {
    if (assembly) mesh.mark('Assembly_Module_Roof', reference);
    const { profile, stations } = form,
      roofPoint = ([u, v], at, inset = 0) => point(u * (moduleHalfAt(form, at) - inset), at, moduleRoofAt(form, v, at)),
      atEave = (u, at) => point(u * moduleHalfAt(form, at), at, ceiling),
      coverColour = appearance.cover;
    if (!enclosure) {
      const count = Math.ceil(length / 2.5);
      for (let i = 0; i <= count; i++) {
        const at = wall + (length - 2 * wall) * i / count,
          sectionHalf = moduleHalfAt(form, at);
        box(0, at, ceiling - 0.10, 2 * sectionHalf, 0.106, 0.10, framing);
        if (form.kind === 'flat') continue;
        for (let j = 1; j < profile.length; j++) {
          const a = roofPoint(profile[j - 1], at, 0.065), b = roofPoint(profile[j], at, 0.065);
          a[1] -= 0.047;
          b[1] -= 0.047;
          drawAssemblyMember(mesh, a, b, 0.085, framing, 0.080, slot.angle);
        }
      }
    } else {
      // The crown, hips and trailer tail are shared with plan and section.
      // Every high point is contained by the original docking envelope.
      for (let i = 1; i < stations.length; i++) {
        const a = stations[i - 1], b = stations[i];
        for (let j = 1; j < profile.length; j++) {
          const left = profile[j - 1], right = profile[j],
            points = [roofPoint(left, a), roofPoint(right, a), roofPoint(right, b), roofPoint(left, b)];
          mesh.quad(...points, coverColour, mesh.solid, 1 + appearance.gloss);
          if (form.kind === 'streamliner' && (i > 1 || j === 3 || j === 9))
            mesh.textureLine(...(i > 1 ? points.slice(0, 2) : [points[0], points[3]]), appearance.accent);
        }
        for (const edge of [profile[0], profile.at(-1)]) {
          if (edge[1] - ceiling < 0.002) continue;
          const points = [atEave(edge[0], a), atEave(edge[0], b), roofPoint(edge, b), roofPoint(edge, a)];
          mesh.quad(...(edge[0] < 0 ? points : points.reverse()), appearance.skin);
        }
        mesh.quad(atEave(1, a), atEave(-1, a), atEave(-1, b), atEave(1, b), rgb('#d9d2c0'));
      }
      for (const at of [0, length]) for (let j = 1; j < profile.length; j++) {
        const left = profile[j - 1], right = profile[j],
          points = [atEave(left[0], at), atEave(right[0], at), roofPoint(right, at), roofPoint(left, at)];
        mesh.quad(...(at === 0 ? points : points.reverse()), appearance.skin);
      }
    }
  }
  if (interiors) drawFurnishedModuleInterior(mesh, slot, x, y, z, plan, reference);
}

function drawFittedModuleTerrace(mesh, slot, x, y, z, plan) {
  const { box } = moduleParts(mesh, slot, x, y, z),
    { length, broad } = plan, depth = MODULE.depth - length, mid = length + depth / 2,
    deck = rgb(broad < 0.5 ? '#bfa27b' : '#a9aca0'), rail = rgb('#5c726c');
  box(0, mid, -0.027, MODULE.width - 0.06, depth, 0.03, deck, true);
  for (const side of [-1, 1]) {
    box(side * 2.16, mid, 1.06, 0.065, depth - 0.02, 0.065, rail);
    const sections = Math.ceil(depth / 1.4);
    for (let i = 0; i <= sections; i++)
      box(side * 2.16, length + 0.13 + (depth - 0.25) * i / sections, 0, 0.065, 0.065, 1.06, rail);
    box(side * 2.16, mid, 0.16, 0.045, depth - 0.04, 0.77, rgb('#a7b6a6'));
  }
  box(0, MODULE.depth - 0.10, 0.12, 4.36, 0.065, 0.94, rail);
  box(1.43, length + 1.45, 0, 0.54, 1.50, 0.47, deck);
  if (broad > 0.36) {
    box(1.43, MODULE.depth - 1.1, 0, 0.64, 1.20, 0.35, deck);
    box(1.43, MODULE.depth - 1.1, 0.35, 0.51, 0.97, 0.34, rgb('#809f72'));
  } else {
    box(0.48, mid, 0, 0.14, 0.16, 0.68, rail);
    box(0.48, mid, 0.68, 0.74, 0.80, 0.07, deck);
  }
}

function drawFurnishedModuleInterior(mesh, slot, x, y, z, plan, reference) {
  const { box } = moduleParts(mesh, slot, x, y, z),
    { inside, aisleEdge, ceiling, zones, program } = plan,
    partition = rgb('#e4dfd4'), wood = rgb('#bb9d76'), cream = rgb('#e8ded1'),
    metal = rgb('#657a79'), porcelain = rgb('#e4eae5'),
    upholstery = rgb(PROGRAMS[slot.p]?.color ?? '#819d97'),
    aisleWall = 0.10,
    roomCenter = (inside + aisleEdge) / 2;
  for (const zone of zones) {
    const { start, end, use } = zone, span = end - start, middle = (start + end) / 2;
    if (zone.partition) {
      mesh.mark('Assembly_Module_Interior_Partitions', `${reference} · ${use}`);
      const door = start + Math.min(0.81, span / 2), doorWidth = 0.86,
        openingStart = door - doorWidth / 2, openingEnd = door + doorWidth / 2;
      for (const [a, b] of [[start, openingStart], [openingEnd, end]])
        box(aisleEdge, (a + b) / 2, 0, aisleWall, b - a, ceiling, partition);
      box(aisleEdge, door, 2.12, aisleWall, doorWidth, ceiling - 2.12, partition);
      if (zone.closeStart) box(roomCenter, start, 0, inside - aisleEdge, aisleWall, ceiling, partition);
      if (zone.closeEnd) box(roomCenter, end, 0, inside - aisleEdge, aisleWall, ceiling, partition);
    }
    mesh.mark('Assembly_Module_Interior_' + use, reference);
    if (use === 'bath') {
      box(inside - 0.51, middle, 0, 0.91, Math.min(1.28, span - 0.27), 0.10, porcelain);
      box(inside - 0.48, middle, 0.10, 0.82, 0.07, 1.95, rgb('#abc6c0'));
      box(aisleEdge + 0.55, end - 0.39, 0, 0.39, 0.58, 0.42, porcelain);
      box(inside - 1.28, start + 0.39, 0, 0.63, 0.43, 0.82, wood);
      box(inside - 1.28, start + 0.39, 0.82, 0.57, 0.39, 0.08, porcelain);
    } else if (use === 'bed' || use === 'bunk' || use === 'quiet') {
      const narrow = use !== 'bed', width = narrow ? 0.96 : 1.40, center = inside - width / 2 - 0.07,
        bedAlong = end - 1.08;
      box(center, bedAlong, 0, width, 2.02, 0.31, wood);
      for (const height of use === 'bunk' ? [0.31, 1.52] : [0.31]) {
        box(center, bedAlong, height, width, 2.02, 0.18, upholstery);
        box(center, bedAlong + 0.64, height + 0.18, width * 0.70, 0.36, 0.10, cream);
      }
      if (use === 'bunk') for (const at of [bedAlong - 0.94, bedAlong + 0.94])
        box(center, at, 0.27, width + 0.04, 0.065, 1.51, metal);
      box(aisleEdge + 0.33, end - 0.37, 0, 0.51, 0.52, 0.54, wood);
    } else if (['cubbies', 'locker', 'storage'].includes(use)) {
      const count = Math.floor((span - 0.12) / 0.37);
      for (let i = 0; i < count; i++) {
        const at = start + 0.26 + i * 0.37;
        box(inside - 0.23, at, 0, 0.42, 0.35, use === 'locker' ? 1.86 : 0.83, i % 2 ? wood : upholstery);
      }
      if (use !== 'storage') box(roomCenter - 0.19, middle, 0, 0.45, span * 0.70, 0.43, wood);
    } else if (use === 'rinse' || use === 'treatment') {
      const count = Math.max(1, Math.floor((span - 0.22) / 1.85));
      for (let i = 0; i < count; i++) {
        const at = start + (span * (i + 0.5)) / count;
        box(inside - 0.64, at, 0, 1.18, Math.min(1.58, span / count - 0.12), 0.48, porcelain);
        box(inside - 0.64, at, 0.48, 0.94, Math.min(1.37, span / count - 0.24), 0.023, rgb('#7aadb8'));
        box(inside - 0.16, at, 0.51, 0.095, 0.095, 0.46, metal);
      }
    } else if (use === 'office' || use === 'meeting' || use === 'play' || use === 'shop' || use === 'counter') {
      if (use === 'play') {
        const rugLength = Math.min(2.1, span * 0.33), rugAlong = end - 0.64 * rugLength;
        box(inside - 1.1, rugAlong, 0.004, 1.61, rugLength, 0.014, rgb('#d8c491'));
      }
      const count = Math.max(1, Math.floor(span / 3.15));
      for (let i = 0; i < count; i++) {
        const at = start + (span * (i + 0.5)) / count, low = use === 'play', display = use === 'shop' || use === 'counter',
          height = low ? 0.48 : display ? 0.92 : 0.72;
        box(inside - 0.76, at, 0.025, 0.16, 0.37, height - 0.06, metal);
        box(inside - 0.76, at, height - 0.055, 1.08, Math.min(span / count - 0.28, 1.48), 0.055, wood);
        if (!display) box(inside - 1.55, at, 0, 0.43, 0.44, low ? 0.29 : 0.46, upholstery);
        if (use === 'office') box(inside - 0.41, at, height, 0.05, 0.41, 0.29, metal);
        if (use === 'shop') box(inside - 0.75, at, height, 0.43, 0.61, 0.12, cream);
      }
    } else {
      // The main social room sits toward the daylight at the outer end.
      // Kitchen runs and furniture stay on the room side of the continuous aisle.
      if (['senior', 'love', 'fire'].includes(program) && span >= 2.65) {
        const counter = Math.min(2.85, span * 0.28);
        box(inside - 0.30, start + counter / 2 + 0.08, 0, 0.56, counter, 0.88, wood);
        box(inside - 0.30, start + counter / 2 + 0.08, 0.88, 0.59, counter, 0.055, porcelain);
      }
      const at = end - Math.min(1.25, span * 0.29), depth = Math.min(1.94, span * 0.49);
      box(inside - 0.46, at, 0, 0.78, depth, 0.44, upholstery);
      box(inside - 0.16, at, 0.44, 0.18, depth, 0.39, upholstery);
      box(inside - 1.35, at, 0, 0.54, Math.min(0.93, depth), 0.39, wood);
      if (span > 5.4 && ['senior', 'love', 'fire'].includes(program)) {
        const dining = start + span * 0.48;
        box(inside - 0.73, dining, 0, 0.10, 0.13, 0.69, metal);
        box(inside - 0.73, dining, 0.68, 0.94, 1.18, 0.06, wood);
        for (const side of [-1, 1]) box(inside - 0.73, dining + side * 0.75, 0, 0.43, 0.41, 0.45, upholstery);
      }
    }
  }
}

// Unoccupied docks keep their shared walking surface and supports. Vary the
// furnishings inside the guards and keep one strip clear from the ring entry.
function drawVariedDockDeck(mesh, slot, x, y, z, seed) {
  const depth = MODULE.depth, angle = slot.angle,
    footX = x - Math.cos(angle) * depth / 2, footZ = z - Math.sin(angle) * depth / 2,
    { box } = moduleParts(mesh, slot, footX, y, footZ),
    rng = random(dockDesignSeed(seed, slot)), garden = slot.use === 'garden',
    deck = rgb(rng() < 0.5 ? '#beb49b' : '#aeb4aa'), rail = rgb('#697f76'),
    timber = rgb('#b69873'), plants = ['#92a67b', '#6a885e', '#9db294'];
  box(0, depth / 2, -MODULE_CASSETTE_DEPTH, MODULE.width, depth, MODULE_CASSETTE_DEPTH, deck, true);
  for (const side of [-1, 1]) {
    box(side * 2.17, depth / 2, 1.06, 0.07, depth, 0.065, rail);
    box(side * 2.17, depth / 2, 0.14, 0.042, depth, 0.8, rgb('#a6b4a4'));
    for (let along = 0.14; along < depth; along += 1.49)
      box(side * 2.17, along, 0, 0.067, 0.065, 1.08, rail);
  }
  box(0, depth - 0.11, 0.15, 4.34, 0.06, 0.97, rail);
  const seedSide = rng() < 0.5 ? -1 : 1, count = garden ? 4 : 2 + Number(rng() > 0.45);
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? seedSide : -seedSide, along = 3 + i * 3.55, size = 1.45 + rng() * 1.24,
      bed = garden || i === 2;
    box(side * 1.49, along, 0, 0.65, size, bed ? 0.40 : 0.46, timber);
    if (!bed) continue;
    box(side * 1.49, along, 0.40, 0.52, size - 0.16, 0.07, rgb('#746954'));
    for (let d = -size / 2 + 0.24; d < size / 2 - 0.08; d += 0.36)
      box(side * 1.49, along + d, 0.46, 0.43, 0.27, 0.19 + rng() * 0.34, rgb(plants[Math.floor(rng() * plants.length)]));
  }
  if (rng() < 0.58) {
    for (const side of [-1, 1]) for (const end of [13.95, 17.78])
      box(side * 2.03, end, 0, 0.13, 0.13, 2.38, timber);
    for (let along = 13.89; along < 17.88; along += 0.38)
      box(0, along, 2.38, 4.31, 0.12, 0.12, timber);
    for (const side of [-1, 1]) box(side * 2.03, 15.86, 2.26, 0.14, 4.02, 0.14, timber);
  }
}

// The removable collar uses the same doorway on every unit. Its lower
// service cassette is shown separately from the clear pedestrian opening.
function drawModuleDockCollar(mesh, slot, x, y, z, plan, head, enclosure) {
  const { box } = moduleParts(mesh, slot, x, y, z),
    { dockGap } = BUILD_SECTION, middle = -dockGap / 2, depth = dockGap + 0.048,
    width = plan.doorWidth / 2 + 0.07, clearHeight = Math.min(plan.doorHeight, head - y - 0.06),
    gasket = rgb('#526864'), casing = rgb('#8a9a8e');
  mesh.mark('Assembly_Module_Dock_Collar', `${slot.f + 1}/Slot_${slot.j}`);
  box(0, middle, -0.077, width * 2 + 0.13, depth, 0.077, casing);
  if (enclosure) {
    for (const side of [-1, 1]) box(side * width, middle, 0, 0.12, depth, clearHeight, casing);
    box(0, middle, clearHeight, width * 2 + 0.12, depth, 0.095, casing);
    for (const end of [-dockGap + 0.02, -0.016]) {
      for (const side of [-1, 1]) box(side * width, end, 0, 0.135, 0.033, clearHeight, gasket);
      box(0, end, clearHeight - 0.01, width * 2 + 0.14, 0.033, 0.112, gasket);
    }
  }
  box(0.57, middle, -0.21, 0.32, depth * 0.96, 0.14, gasket);
}

// Small variants share the same bounded rooftop footprint and skids. The
// glazed facade is split at the doors and window openings just like a pod.
function drawVariedRoofShop(mesh, pavilion, preview, index, floor, part, point, width, depth, y, system, finish) {
  const rng = random((preview.view.seed ^ Math.imul(index + 1, 0x632be5ab) ^ Math.imul(floor + 1, 0x85157af5)) >>> 0),
    type = Math.floor(rng() * 4), shell = materialTint(rgb(finish.color), 0.83 + rng() * 0.32),
    frame = rgb(system.color), cladding = rgb(['#6f857c', '#b59573', '#83979d', '#985f55'][type]),
    glass = rgb('#a2bbc0'), cap = rgb('#c6ccc3'),
    wall = type === 2 ? 0.25 : 0.16, across = width / 2, along = depth / 2,
    head = type === 1 ? 2.54 : 2.70,
    door = Math.min(1.16, width * 0.57), center = (type % 2 ? 1 : -1) * (width - door) * 0.19,
    left = center - door / 2, right = center + door / 2,
    entry = floor === 0;
  part(0, 0, y - 0.007, width, 0.072, depth, frame);
  for (const side of [-1, 1])
    part(side * (across - wall / 2), 0, y + 0.06, wall, head - 0.06, depth - 2 * wall, shell);
  part(0, -along + wall / 2, y + 0.06, width, head - 0.06, wall, shell);
  const front = along - wall / 2, openingHead = 2.18,
    face = (lo, hi, bottom, top, color) => {
      if (hi - lo > 0.018) part((lo + hi) / 2, front, y + bottom, hi - lo, top - bottom, wall, color);
    },
    pane = (lo, hi, bottom, top) => {
      if (hi - lo < 0.08) return;
      const at = (position, up) => point(position, along - wall * 0.57, y + up);
      mesh.quad(at(lo, bottom), at(lo, top), at(hi, top), at(hi, bottom), glass, mesh.glass, 0.77);
    };
  face(-across, across, openingHead, head, cladding);
  const jamb = 0.075;
  for (const edge of [-across + jamb, left, right, across - jamb])
    face(edge - jamb / 2, edge + jamb / 2, 0.06, openingHead, shell);
  for (const [a, b] of [[-across + jamb, left], [left, right], [right, across - jamb]]) {
    const sill = entry && a === left ? 0.065 : type === 0 ? 0.35 : 0.61;
    if (sill > 0.1) face(a, b, 0.06, sill, shell);
    pane(a + jamb * 0.64, b - jamb * 0.64, sill, openingHead);
  }
  part(0, 0, y + head, width + 0.09, 0.11, depth + 0.09, cap);
  if (!floor && pavilion.upper)
    for (const side of [-1, 1]) part(side * width * 0.21, 0, y + head + 0.11, 0.20, 2.76 - head, depth * 0.84, frame);
  if (type === 1 && !pavilion.upper) {
    const A = point(-across, -along, y + head + 0.105), B = point(across, -along, y + head + 0.28),
      C = point(across, along, y + head + 0.28), D = point(-across, along, y + head + 0.105);
    mesh.quad(A, B, C, D, cladding);
    for (const [side, a, b] of [[-1, A, B], [1, C, D]])
      mesh.tri(a, b, point(across, side * along, y + head + 0.105), cap);
    mesh.quad(B, point(across, -along, y + head + 0.105), point(across, along, y + head + 0.105), C, cladding);
  }
  if (floor || !pavilion.upper)
    part(width * 0.23, -depth * 0.28, y + 2.81, Math.min(0.62, width * 0.33), 0.16, 0.49, frame);
  if (entry && width >= 1.55)
    part(center, along + 0.09, y + 2.29, Math.min(width - 0.05, door + 0.39), 0.07, 0.29, cladding);
  if (preview.finishJoints)
    for (const side of [-1, 1])
      drawFinishJoints(finish, depth - 2 * wall, head - 0.06,
        (distance, up) => point(side * (across + 0.003), -along + wall + distance, y + 0.06 + up),
        mesh.textureLine, shell, index * 11 + floor);
}

// Planter and canopy fittings use only the roof's allocated landscape patches.
function drawVariedRoofGardens(mesh, roof, seed) {
  for (const [i, garden] of roof.garden.entries()) {
    const angle = (garden.start + garden.end) / 2, radius = (garden.r + garden.R) / 2,
      depth = Math.min(3.8, 0.72 * (garden.R - garden.r)),
      width = Math.min(4.5, 0.77 * (garden.end - garden.start) * (radius - depth / 2));
    if (width < 0.55 || depth < 0.55) continue;
    const { box } = moduleParts(mesh, { angle }, radius * Math.cos(angle), roof.y, radius * Math.sin(angle)),
      rng = random((seed ^ Math.imul(i + 1, 0x43cba27f)) >>> 0),
      timber = rgb('#b49b77'), metal = rgb('#82928a'),
      planting = ['#8ea77b', '#78946a', '#a6b48a', '#a1ad95'];
    if (garden.kind === 'gazebo' && Math.min(width, depth) > 1.8) {
      mesh.mark('Roof_Gazebos', `Canopy ${i + 1}`);
      const height = 2.28 + rng() * 0.15;
      for (const side of [-1, 1]) {
        for (const end of [-1, 1]) box(side * width * 0.44, end * depth * 0.44, 0, 0.13, 0.13, height, timber);
        box(side * width * 0.44, 0, height - 0.06, 0.13, depth, 0.085, timber);
      }
      for (let across = -depth / 2 + 0.13; across < depth / 2; across += 0.27 + rng() * 0.11)
        box(0, across, height + 0.02, width, 0.10, 0.12, timber);
      box(-width * 0.30, 0, 0, 0.51, Math.min(depth - 0.24, 1.83), 0.46, timber);
      continue;
    }
    mesh.mark('Roof_Gardens', `Garden ${i + 1}`);
    const rows = width > 1.75 && rng() > 0.35 ? 2 : 1,
      size = rows === 2 ? Math.min(0.86, width * 0.32) : width * 0.84,
      base = rng() > 0.48 ? timber : metal;
    for (let row = 0; row < rows; row++) {
      const across = rows === 2 ? (row ? -1 : 1) * (width - size) * 0.46 : 0;
      box(across, 0, 0, size, depth, 0.35, base);
      box(across, 0, 0.35, size * 0.84, depth * 0.89, 0.07, rgb('#827359'));
      for (let along = -depth * 0.37; along < depth * 0.4; along += 0.30 + rng() * 0.24)
        box(across, along, 0.42, size * (0.43 + rng() * 0.31), Math.min(0.28, depth * 0.23),
          0.10 + rng() * 0.42, rgb(planting[Math.floor(rng() * planting.length)]));
    }
  }
}
