'use strict';

// Millimetre-scale section shared by every runner and by the calibration coupon.
const PRINT_RUNNER = {
  flange: 6.6, neck: 2.6, head: 5.4, depth: 7.4, headDepth: 1.9,
  seam: 0.16, clipLength: 8, clipTop: 3.9, clearance: 0.26, guideClearance: 0.48
};

function printRunnerSection() {
  const { flange, neck, head, depth, headDepth } = PRINT_RUNNER,
    stem = neck / 2, crown = head / 2, overlap = crown - stem, foot = flange / 2;
  return [
    [-foot, -depth], [foot, -depth], [foot, -depth + 1.3],
    [stem, -depth + 1.3], [stem, -headDepth - overlap],
    [crown, -headDepth], [crown, -0.40], [crown - 0.4, 0],
    [-crown + 0.4, 0], [-crown, -0.40], [-crown, -headDepth],
    [-stem, -headDepth - overlap], [-stem, -depth + 1.3], [-foot, -depth + 1.3]
  ];
}

function printRailClipSection(clearance, wall) {
  const crown = PRINT_RUNNER.head / 2, cavity = crown + clearance, outside = cavity + wall,
    jaw = crown - 0.36, tip = -2.28 - clearance, toe = tip - 0.9,
    relief = 2.15 + clearance, top = PRINT_RUNNER.clipTop + clearance, pad = 1.26;
  // Long relieved arms flex independently around a central running pad.
  return [
    [-outside, toe], [-outside, top], [outside, top], [outside, toe],
    [cavity - 0.06, toe], [jaw, tip], [cavity, -2.06],
    [cavity, relief], [pad + 0.30, relief], [pad, clearance],
    [-pad, clearance], [-pad - 0.30, relief], [-cavity, relief], [-cavity, -2.06],
    [-jaw, tip], [-cavity + 0.06, toe]
  ];
}

function printGantryFrame(angle, radial, crosswise, level) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [radial * cos - crosswise * sin, -radial * sin - crosswise * cos, level];
}

// Carry a watertight section around an arc. At the ends, the extruder supplies
// the same cap topology used for the straight calibration samples.
function printRunnerSweep(radius, start, end, section) {
  const maxRadius = radius + Math.max(...section.map(([u]) => u)),
    steps = Math.max(1, Math.ceil((end - start) / Math.min(0.08, 2 * Math.acos(1 - 0.028 / maxRadius)))),
    triangles = [],
    position = ([u, h], angle) => [...printPolar(radius + u, angle), h];
  for (let i = 0; i < steps; i++) {
    const a = start + (end - start) * i / steps, b = start + (end - start) * (i + 1) / steps;
    for (let j = 0; j < section.length; j++) {
      const p = section[j], q = section[(j + 1) % section.length],
        A = position(p, a), B = position(q, a), C = position(q, b), D = position(p, b);
      triangles.push([A, B, C], [A, C, D]);
    }
  }
  for (const tri of printExtrude(section, 0, 1)) {
    const [, , face] = tri[0];
    if (tri.every(([, , z]) => z === face))
      triangles.push(tri.map((p) => position(p, face ? end : start)));
  }
  return triangles;
}

function printRailParts(ctx, id, label, radius, level, bearing, fixedWidth = 0) {
  const { seam } = PRINT_RUNNER, flange = fixedWidth || PRINT_RUNNER.flange,
    depth = fixedWidth ? 2.4 : PRINT_RUNNER.depth,
    section = fixedWidth ? [[-flange / 2, -depth], [flange / 2, -depth], [flange / 2, 0], [-flange / 2, 0]]
      : printRunnerSection(),
    count = Math.max(3, Math.ceil(TAU * (radius + flange / 2) / (ctx.limit - 12))),
    span = TAU / count, segmentHalf = span / 2 - seam / (2 * radius),
    saddleHalf = Math.min(8, radius * span / 4) / radius, lip = flange / 2 + 0.18,
    cleat = lip + ctx.minWall, saddle = fixedWidth ? [
      [-flange / 2, -1.45], [flange / 2, -1.45], [flange / 2, 0], [-flange / 2, 0]
    ] : [
      [-cleat, -1.45], [cleat, -1.45], [cleat, 0.85], [lip, 0.85],
      [lip, 0], [-lip, 0], [-lip, 0.85], [-cleat, 0.85]
    ];
  const saddleDepth = 1.45;
  for (let i = 0; i < count; i++) {
    const n = String(i + 1).padStart(2, '0'), angle = bearing + i * span,
      at = (phase, height) => ([x, y, z]) => printGantryFrame(phase, x, -y, height + z);
    ctx.add(`rail-${id}-${n}`, 'Rail', `${label} arc ${i + 1}/${count}`,
      printRunnerSweep(radius, -segmentHalf, segmentHalf, section), {
        assembly: at(angle, level),
        notes: [fixedWidth ? 'Print flat and glue to the pier tops. This rail carries the fixed display gantry.'
          : 'Print flange down. Keep the track head and running faces free of glue and burrs.']
      });
    ctx.add(`rail-${id}-splice-${n}`, 'Rail', `${label} seam saddle ${i + 1}/${count}`,
      printRunnerSweep(radius, -saddleHalf, saddleHalf, saddle), {
        assembly: at(angle + span / 2, level - depth),
        notes: [fixedWidth ? 'Glue the seam strip under both rail segments to align the joint.'
          : 'Print flat. Seat both flanges fully in the saddle and glue from below with the rail heads flush.']
      });
  }
  return (angle, width) => {
    const seamDistance = Math.abs(mod(angle - bearing, span) - span / 2);
    const underSaddle = seamDistance < saddleHalf + width / (2 * radius);
    return level - depth - (underSaddle ? saddleDepth : 0);
  };
}

function printGantryPier(ctx, id, label, angle, radius, base, top, width) {
  const tall = top - base;
  if (tall < 1.6) return;
  // A square cap and splayed base enlarge the glue faces while keeping this
  // piece support-free and strong with its long axis parallel to the bed.
  const core = width / 2, ledge = core + 1.0,
    stem = Math.min(tall * 0.14, 2.0), upper = tall - stem,
    points = [[-ledge, 0], [ledge, 0], [ledge, stem * 0.28], [core, stem],
      [core, upper], [ledge, tall], [-ledge, tall], [-core, upper], [-core, stem],
      [-ledge, stem * 0.28]],
    solid = printExtrude(points, 0, width);
  ctx.add(id, 'Rail', label, solid, {
    assembly: ([u, h, t]) => printGantryFrame(angle, radius + u, t - width / 2, base + h),
    notes: ['Print the pier on its broad side. Glue the cap to the rail flange and the foot to the roof, base or separate pad.']
  });
}

function printWarrenPanel(stations, chord, thickness, lattice) {
  // Triangulate the solid face once, then add sidewalls only on its real edges.
  // Each diagonal shares vertices with its post and chord, so no ribs overlap.
  const face = [], boundary = new Map();
  const triangle = (a, b, c) => {
    if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-7) return;
    face.push([a, b, c]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = [p.join(','), q.join(',')].sort().join('/');
      if (boundary.has(key)) boundary.delete(key);
      else boundary.set(key, [p, q]);
    }
  };
  const quad = (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); };
  const station = ([x, low, high]) => [[x, low], [x, low + chord], [x, high - chord], [x, high]];
  for (let i = 1; i < stations.length; i++) {
    const left = stations[i - 1], right = stations[i], pitch = right[0] - left[0],
      A = station(left), B = station(right), offset = Math.min(pitch * 0.2, chord * 0.72),
      at = (distance) => station(left.map((v, j) => v + (right[j] - v) * distance / pitch)),
      C = at(offset), D = at(pitch - offset),
      rise = Math.min(C[2][1] - C[1][1], D[2][1] - D[1][1]);
    if (!lattice || rise < chord * 1.55) {
      for (let band = 0; band < 3; band++) quad(A[band], B[band], B[band + 1], A[band + 1]);
      continue;
    }
    const ascending = i % 2 !== 0, web = chord * 1.1,
      E = [C[1][0], ascending ? C[1][1] + web : C[2][1] - web],
      F = [D[1][0], ascending ? D[2][1] - web : D[1][1] + web];
    quad(A[0], C[0], C[1], A[1]);
    quad(A[2], C[2], C[3], A[3]);
    triangle(A[1], C[1], E);
    triangle(A[1], E, C[2]);
    triangle(A[1], C[2], A[2]);
    quad(D[0], B[0], B[1], D[1]);
    quad(D[2], B[2], B[3], D[3]);
    triangle(B[1], B[2], D[2]);
    triangle(B[1], D[2], F);
    triangle(B[1], F, D[1]);
    quad(C[0], D[0], D[1], C[1]);
    if (ascending) quad(C[1], F, D[2], E);
    else quad(E, D[1], F, C[2]);
    quad(C[2], D[2], D[3], C[3]);
  }
  const triangles = [], layer = (point, z) => [...point, z];
  for (const [a, b, c] of face)
    triangles.push([layer(c, 0), layer(b, 0), layer(a, 0)],
      [layer(a, thickness), layer(b, thickness), layer(c, thickness)]);
  for (const [a, b] of boundary.values())
    triangles.push([layer(a, 0), layer(b, 0), layer(b, thickness)],
      [layer(a, 0), layer(b, thickness), layer(a, thickness)]);
  return triangles;
}

function printRailClipLength(radius) {
  // A straight shoe riding a curved rail is shorter on the tightest rings.
  // At each end the inner running face can bow by at most 0.11 mm.
  const innerRadius = radius - PRINT_RUNNER.head / 2, sag = 0.11;
  return Math.min(PRINT_RUNNER.clipLength, 2 * Math.sqrt(sag * (2 * innerRadius - sag)));
}

function printGantryClip(ctx, id, label, radius, level, angle, clearance, guide = false) {
  const clipLength = printRailClipLength(radius),
    clip = printExtrude(printRailClipSection(clearance, ctx.minWall), 0, clipLength);
  ctx.add(id, guide ? 'Test pieces' : 'Gantry', label, clip, {
    guide,
    material: 'petg',
    assembly: ([u, h, t]) => printGantryFrame(angle, radius + u, t - clipLength / 2, level + h),
    notes: [`Print the C-profile flat on its end in PETG. Nominal side clearance is ${clearance.toFixed(2)} mm.`,
      'Press the shoe onto the head squarely. Flex the arms by hand to remove it. Leave the arms free of glue.']
  });
}

function printGantrySideFrames(ctx, crane, angle, functional) {
  const { mm } = ctx, cantilever = crane.runway === 'cantilever', r0 = crane.roofInner, r1 = crane.tower,
    thick = Math.max(2, ctx.minWall * 1.65), chord = Math.max(2, ctx.minWall * 1.8),
    half = Math.max(mm(crane.width) / 2, 4), lattice = ctx.detail !== 'massing',
    split = Math.max(1, Math.ceil(mm(r1 - r0) / (ctx.limit - 10))),
    top = (radius) => craneBoomUnderside(crane, radius) + crane.depth * (cantilever
      ? radius <= crane.roofOuter
        ? 0.60 + 0.40 * (radius - r0) / (crane.roofOuter - r0)
        : 1 - 0.68 * (radius - crane.roofOuter) / (r1 - crane.roofOuter)
      : 0.55 + 0.45 * Math.sin(Math.PI * (radius - r0) / (r1 - r0)));
  const acrossBar = (id, label, radial, width, bottom, height) => {
    ctx.add(id, 'Gantry', label, printBox(radial - width / 2, -half, bottom,
      radial + width / 2, half, bottom + height), {
      assembly: ([r, a, h]) => printGantryFrame(angle, r, -a, h),
      notes: ['Use this crosspiece to set the distance between the two gantry sides.']
    });
  };
  for (let s = 0; s < split; s++) {
    const start = r0 + (r1 - r0) * s / split, end = r0 + (r1 - r0) * (s + 1) / split,
      panels = Math.max(1, Math.ceil((end - start) / 4.0)),
      stations = Array.from({ length: panels + 1 }, (_, i) => {
        const r = start + (end - start) * i / panels, low = mm(craneBoomUnderside(crane, r));
        return [mm(r), low, Math.max(low + chord * 2.6, mm(top(r)))];
      });
    for (const side of [-1, 1]) {
      const t = side * half, sideName = side < 0 ? 'Left' : 'Right';
      ctx.add(`gantry-boom-${sideName.toLowerCase()}-${s + 1}`, 'Gantry', `${sideName} boom panel ${s + 1}/${split}`,
        printWarrenPanel(stations, chord, thick, lattice), {
          assembly: ([r, h, a]) => printGantryFrame(angle, r, t + a - thick / 2, h),
          notes: ['Print flat. Glue matching panels end to end and reinforce the joints on the inside with the splice pieces.']
        });
      if (s + 1 === split) continue;
      const endZ = stations.at(-1)[1], splitX = mm(end);
      for (const z of [endZ, stations.at(-1)[2] - chord]) {
        const step = z === endZ ? 'lower' : 'upper', to = -t + side * thick / 2;
        ctx.add(`gantry-boom-splice-${sideName.toLowerCase()}-${s + 1}-${step}`, 'Gantry', `${sideName} ${step} boom splice`,
          printBox(splitX - 6, Math.min(to, to + side * 1.35), z, splitX + 6, Math.max(to, to + side * 1.35), z + chord), {
            assembly: ([r, a, h]) => printGantryFrame(angle, r, -a, h),
            notes: ['Glue the splice over the inside face of the butt joint. Let the panels rest flat while curing.']
          });
      }
    }
    acrossBar(`gantry-boom-crosspiece-${s + 1}`, 'Boom crosspiece', mm((start + end) / 2), chord,
      mm(craneBoomUnderside(crane, (start + end) / 2)), chord);
  }
  const shoeRise = (clearance) => functional ? PRINT_RUNNER.clipTop + clearance : 0,
    roofClipHeight = mm(crane.roofRail) + shoeRise(PRINT_RUNNER.clearance),
    roofSill = mm(craneBoomUnderside(crane, crane.roofOuter)) + 0.2;
  acrossBar('gantry-roof-carrier', 'Roof bogie crossbar', mm(crane.roofOuter), 5.1, roofClipHeight,
    Math.max(chord, roofSill - roofClipHeight));
  if (cantilever) {
    const innerClipHeight = mm(crane.roofRail) + shoeRise(PRINT_RUNNER.guideClearance);
    acrossBar('gantry-hold-down-carrier', 'Cantilever inboard hold-down crossbar', mm(crane.roofInner), 4.2,
      innerClipHeight, Math.max(chord, mm(craneBoomUnderside(crane, crane.roofInner)) + 0.3 - innerClipHeight));
    return;
  }

  const low = mm(crane.groundRail) + shoeRise(PRINT_RUNNER.guideClearance),
    high = mm(craneBoomUnderside(crane, crane.tower)) + 0.65,
    mid = mm(crane.tower), gauge = mm(crane.groundGauge) / 2,
    pieces = Math.max(1, Math.ceil((high - low) / (ctx.limit - 10)));
  for (let s = 0; s < pieces; s++) {
    const bottom = low + (high - low) * s / pieces, top = low + (high - low) * (s + 1) / pieces,
      rows = Math.max(1, Math.ceil((top - bottom) / mm(3.65))),
      stations = Array.from({ length: rows + 1 }, (_, i) => {
        const y = bottom + (top - bottom) * i / rows,
          foot = Math.max(chord * 1.45, gauge * (1 - 0.63 * (y - low) / (high - low)));
        return [y, mid - foot, mid + foot];
      });
    for (const side of [-1, 1]) {
      const name = side < 0 ? 'Left' : 'Right', sideKey = name.toLowerCase();
      ctx.add(`gantry-tower-${sideKey}-${s + 1}`, 'Gantry', `${name} tower panel ${s + 1}/${pieces}`,
        printWarrenPanel(stations, chord, thick, lattice), {
          assembly: ([h, r, a]) => printGantryFrame(angle, r, side * half + thick / 2 - a, h),
          notes: ['Print flat. Join the tower head to the end of the boom and brace both sides with the crossbars.']
        });
      if (s + 1 < pieces) {
        const [joint, inner, outer] = stations.at(-1), to = -side * (half - thick / 2),
          from = to + side * 1.35;
        for (const [end, r] of [['inner', inner], ['outer', outer - chord]]) {
          ctx.add(`gantry-tower-splice-${sideKey}-${s + 1}-${end}`, 'Gantry', `${name} ${end} tower splice`,
            printBox(r, Math.min(to, from), joint - 6, r + chord, Math.max(to, from), joint + 6), {
              assembly: ([radial, crosswise, height]) => printGantryFrame(angle, radial, -crosswise, height),
              notes: ['Glue over the inside of the tower butt joint before attaching the crossbars.']
            });
        }
      }
    }
  }
  acrossBar('gantry-tower-foot', 'Outboard bogie crossbar', mid - gauge, Math.max(4, chord * 2), low, chord * 1.40);
  acrossBar('gantry-tower-head', 'Tower head crossbar', mid, chord * 2, high - chord, chord);
}

function printGantryPierStations(stations, radius, stride, keep = () => false) {
  const ordered = stations.toSorted((a, b) => a - b), chosen = new Set();
  for (const [i, angle] of ordered.entries())
    if (i % stride === 0 || keep(angle)) chosen.add(angle);
  const current = [...chosen];
  for (const [i, start] of current.entries()) {
    const end = current[i + 1] ?? current[0] + TAU;
    const possible = ordered.map((angle) => angle <= start ? angle + TAU : angle)
      .filter((angle) => angle < end).sort((a, b) => a - b);
    let previous = start;
    for (const angle of possible) {
      if ((end - previous) * radius < 125) break;
      if ((angle - previous) * radius >= 72) {
        chosen.add(mod(angle, TAU));
        previous = angle;
      }
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

function planPrintGantry(ctx) {
  const { model, mm } = ctx, crane = model.crane;
  if (!crane) {
    ctx.warnings.push('The current massing cannot fit a gantry and its roof runway. No gantry kit is included.');
    return;
  }
  const angle = moduleCranePose(model, crane, state).angle,
    roofHeight = mm(crane.roofRail), roofBase = mm(model.roofPlan.y), primary = mm(crane.roofOuter),
    { clearance, guideClearance } = PRINT_RUNNER, outboard = crane.runway !== 'cantilever',
    roofGauge = mm(crane.roofOuter - crane.roofInner), outboardGauge = outboard ? mm(crane.groundGauge) : Infinity,
    functional = roofGauge >= (outboard ? 7.3 : 9) && outboardGauge >= 7.3,
    massing = ctx.detail === 'massing',
    fixedWidth = functional ? 0 : Math.max(ctx.minWall, Math.min(3, Math.min(roofGauge, outboardGauge) - 0.60));
  for (const [kind, title, radius] of [['inner', 'Inner roof rail', mm(crane.roofInner)], ['outer', 'Outer roof rail', primary]]) {
    const undersideAt = printRailParts(ctx, `roof-${kind}`, title, radius, roofHeight, angle, fixedWidth),
      positions = massing ? printGantryPierStations(crane.supports, radius, 2) : crane.supports;
    for (const [i, at] of positions.entries()) {
      const section = Math.max(2.8, mm(crane.runway === 'cantilever' ? 0.85 : 0.51));
      printGantryPier(ctx, `rail-roof-${kind}-pier-${i + 1}`, `${title} pier ${i + 1}`,
        at, radius, roofBase, undersideAt(at, section), section);
    }
  }
  if (outboard) {
    const elevated = crane.runway === 'elevated', runwayHeight = mm(crane.groundRail),
      pierCount = Math.ceil(TAU * crane.tower / 4.8),
      supports = elevated ? elevatedRunwaySupports(crane) :
        Array.from({ length: pierCount }, (_, i) => (i + 0.5) * TAU / pierCount);
    for (const side of [-1, 1]) {
      const radius = crane.tower + side * crane.groundGauge / 2,
        id = side < 0 ? 'inner' : 'outer', label = elevated ? 'Elevated runway' : 'Moat runway',
        gateSupport = (at) => elevated && (crane.gateAngles ?? []).some((gate) => angDist(gate, at) * crane.tower < 7),
        positions = massing ? printGantryPierStations(supports, mm(radius), elevated ? 2 : 3, gateSupport) : supports,
        undersideAt = printRailParts(ctx, `ground-${id}`, `${label} ${id} rail`, mm(radius), runwayHeight, angle, fixedWidth);
      for (const [i, at] of positions.entries()) {
        const [x, z] = [radius * Math.cos(at), radius * Math.sin(at)],
          width = Math.max(3, mm(elevated ? 0.64 : 0.48)), top = undersideAt(at, width),
          grade = elevated ? mm(model.siteGroundAt?.(x, z) ?? 0) :
            Math.min(mm(MOAT_WATER_LEVEL - MOAT_BED_DEPTH), top - 2.4);
        printGantryPier(ctx, `rail-ground-${id}-pier-${i + 1}`, `${label} ${id} pier ${i + 1}`,
          at, mm(radius), grade, top, width);
      }
    }
  }
  printGantrySideFrames(ctx, crane, angle, functional);
  if (!functional) {
    ctx.warnings.push('The selected scale and rail spacing leave too little room for clip flanges. This kit uses a fixed display gantry on narrow rails. Increase the print size to enable the sliding version.');
    ctx.instructions.push('Glue the fixed gantry crossbars to the roof and outboard rails, or leave them unglued for display placement.');
    return;
  }
  printGantryClip(ctx, 'gantry-roof-clip', 'Roof rail drive shoe', primary, roofHeight, angle, clearance);
  if (crane.runway === 'cantilever')
    printGantryClip(ctx, 'gantry-hold-down-clip', 'Inboard hold-down guide shoe',
      mm(crane.roofInner), roofHeight, angle, guideClearance);
  else printGantryClip(ctx, 'gantry-outboard-clip', 'Outboard guide shoe',
    mm(crane.tower - crane.groundGauge / 2), mm(crane.groundRail), angle, guideClearance);

  ctx.add('rail-fit-test', 'Test pieces', 'Rail fit coupon (print first)',
    printRunnerSweep(primary, -15 / primary, 15 / primary, printRunnerSection()), {
      guide: true,
      notes: ['Print this sample and both shoe coupons with the same slicer profile and materials as the final parts.']
    });
  printGantryClip(ctx, 'gantry-clip-fit-test', 'Roof shoe fit coupon', primary, roofHeight, angle, clearance, true);
  printGantryClip(ctx, 'gantry-guide-fit-test', 'Guide shoe fit coupon', primary, roofHeight, angle, guideClearance, true);

  ctx.instructions.push(
    'Print the rail coupon flange-down and the shoe coupons end-on. Use PETG for the spring shoes, a 0.4 mm nozzle and 0.16–0.20 mm layers. Use a brim if an end-on shoe lifts.',
    'Press the roof shoe onto the coupon. It should click over the head, slide freely and lift off when the arms are flexed. For a tight fit, deburr the contact surfaces and tune XY compensation on the coupon before printing the full ring.',
    'Dry-fit each ring on its piers. Place matching seam saddles underneath the flange, align the rail heads and run the test shoe across each joint before gluing from below. Keep the lobby gaps and running faces clear.',
    'Assemble the two flat gantry frames and crossbars off the model. With the shoes clipped to their corresponding rails, settle the gantry onto the flat shoe tops and tack the joint without gluing the shoe arms or the rails. The secondary shoe has extra side clearance so the two circular guides can turn together.'
  );
  ctx.warnings.push('Rail heads, clips and piers are thickened for FDM. The gantry travels by hand. Trim seam burrs and check the coupon before assembly.');
  if (crane.runway === 'moat')
    ctx.warnings.push('The moat kit uses a continuous runway around its low piers. The motor and automatic drawbridge movement are outside the print mechanism.');
  if (crane.runway === 'elevated')
    ctx.warnings.push('The elevated runway retains its entrance pier gaps. The Caterpillar motion and hoist operation are outside the print mechanism.');
}
