'use strict';

// Both outlines run counter-clockwise. Each wall is lofted independently so the
// wall around a bore or a glazing rebate remains a single closed solid.
function printAtriumSleeve(outer, inner) {
  const triangles = [];
  const quad = (a, b, c, d) => triangles.push([a, b, c], [a, c, d]);
  const ring = ([z, points]) => points.map(([x, y]) => [x, y, z]);
  const walls = (profiles, reverse) => {
    for (let i = 1; i < profiles.length; i++) {
      const a = ring(profiles[i - 1]), b = ring(profiles[i]);
      for (let j = 0; j < a.length; j++) {
        const k = (j + 1) % a.length;
        if (reverse) quad(a[k], a[j], b[j], b[k]);
        else quad(a[j], a[k], b[k], b[j]);
      }
    }
  };
  walls(outer, false);
  walls(inner, true);
  for (const i of [0, -1]) {
    const a = ring(outer.at(i)), b = ring(inner.at(i));
    for (let j = 0; j < a.length; j++) {
      const k = (j + 1) % a.length;
      if (i === 0) quad(a[k], a[j], b[j], b[k]);
      else quad(a[j], a[k], b[k], b[j]);
    }
  }
  return triangles;
}

function printAtriumCircle(radius, stations, profile = (_, r) => r) {
  return Array.from({ length: stations }, (_, i) => {
    const angle = i * TAU / stations, r = profile(angle, radius);
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
}

function printAtriumMast(ctx, ride) {
  const { mm, model, detail, minWall, clearance, limit, add, warnings, instructions } = ctx,
    height = mm(ride.height), nominal = mm(ride.towerRadius), shaft = Math.max(nominal, 4.8),
    stations = 36, relief = detail === 'structure' ? 0.32 : 0,
    bore = Math.max(0.88, shaft - 3.88),
    spigot = shaft - minWall - relief - clearance,
    keyDepth = minWall * 0.34,
    baseDatum = typeof printBaseDatum === 'function' ? printBaseDatum(ctx) : -minWall * 5,
    well = Math.max(mm(ride.towerRadius + 1.8), minWall * 4) - clearance / 2,
    insertion = 5.4, firstInsertion = Math.min(insertion, -baseDatum - clearance),
    profile = (r, mode = 'round') => printAtriumCircle(r, stations, (angle, radius) => {
      if (mode === 'square') return radius / Math.max(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle)));
      if (mode === 'key' && Math.cos(angle) > 0) return Math.min(radius, (radius - keyDepth) / Math.cos(angle));
      if (mode === 'shaft') return radius - relief * (1 - Math.cos(6 * angle)) / 2;
      return radius;
    }),
    cuts = Math.ceil(height / Math.min(limit - insertion - 2, 24 * shaft)),
    socket = spigot + clearance;
  if (shaft > nominal + 0.1) warnings.push('The sensor mast has been widened to preserve the bore and keyed sockets at this scale.');
  if (!(firstInsertion > minWall) || well < socket + minWall - 0.01)
    throw Error('The central mast receiver needs more print clearance at this scale.');
  const socketFloor = -firstInsertion - clearance,
    mouth = [0, profile(socket, 'key')],
    receiver = socketFloor - baseDatum >= minWall
      ? [[baseDatum, profile(bore)], [socketFloor, profile(bore)], [socketFloor, profile(socket, 'key')], mouth]
      : [[baseDatum, profile(socket, 'key')], mouth];
  add('mast-foundation-key', 'Mast', 'Central mast foundation receiver', printAtriumSleeve(
    [[baseDatum, profile(well, 'square')], [0, profile(well, 'square')]],
    receiver
  ), { notes: ['Place in the square base opening. The horizontal face is at atrium ground datum.',
    'The larger opening faces up. Align the flat of the mast foot with the flat in the socket.'] });
  for (let i = 0; i < cuts; i++) {
    const start = height * i / cuts, end = height * (i + 1) / cuts,
      label = String(i + 1).padStart(2, '0'),
      foot = i ? insertion : firstInsertion,
      shoulder = shaft - spigot + 0.12,
      outer = [[start - foot, profile(spigot, 'key')], [start, profile(spigot, 'key')],
        [start + shoulder + keyDepth, profile(shaft, 'shaft')], [end, profile(shaft, 'shaft')]],
      inner = [[start - foot, profile(bore)]];
    if (i < cuts - 1) inner.push([end - insertion - clearance, profile(bore)],
      [end - insertion - clearance, profile(socket, 'key')], [end, profile(socket, 'key')]);
    else inner.push([end, profile(bore)]);
    add(`mast-section-${label}`, 'Mast', `Sensor mast section ${i + 1} of ${cuts}`, printAtriumSleeve(outer, inner),
      { notes: ['Print upright with a 6–8 mm brim. The bore remains open through the stack.',
        'Fit the lower flat-sided key into its receiver. Work from the base up and clear brim residue before assembly.'] });
  }
  instructions.push('Dry-fit the mast sections in numerical order. Fit the boarding deck and swing crown onto their own sections before joining the sections above them.');
  return { shaft, profile, stations };
}

function printAtriumSwings(ctx, ride, mast) {
  const { mm, minWall, clearance, add, instructions, limit } = ctx, pose = swingPose(ride, 0),
    count = 8, armRadius = Math.max(mast.shaft + 4 * minWall, mm(pose.attach)),
    seatRadius = Math.max(armRadius + 3 * minWall, mm(pose.rad)),
    drop = Math.max(3 * minWall, mm(pose.crown - pose.seatY)),
    base = mm(pose.crown), thickness = Math.max(1.6 * minWall, mm(0.35)),
    inner = mast.shaft + clearance, root = inner + Math.max(1.7 * minWall, mm(0.45)),
    grip = Math.max(1.35 * minWall, mm(0.42)),
    shoulder = Math.min(armRadius - minWall, root + Math.max(2 * minWall, mm(0.65))),
    pitch = TAU / count, arc = Math.min(pitch * 0.20, grip / armRadius * 0.68),
    shape = Array.from({ length: count }, (_, i) => {
      const a = i * pitch;
      return [[a - pitch / 2, root], [a - arc * 1.7, root], [a - arc * 1.10, shoulder],
        [a - arc, armRadius + grip * 0.5], [a + arc, armRadius + grip * 0.5], [a + arc * 1.7, root]];
    }).flat(),
    at = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)],
    crown = shape.map(([angle, r]) => at(r, angle)), opening = shape.map(([angle]) => at(inner, angle));
  if ((armRadius + grip) * 2 > limit) {
    ctx.warnings.push('The swing crown is omitted because its one-piece span exceeds the build plate at this scale.');
    return;
  }
  add('swing-crown', 'Swings', 'Eight-arm schematic swing crown', printAtriumSleeve(
    [[base, crown], [base + thickness, crown]], [[base, opening], [base + thickness, opening]]
  ), { notes: ['Print the crown flat. Slide over the upper mast and fix at the display height after checking fit.',
    `Set the underside ${base.toFixed(1)} mm above the atrium ground datum.`] });
  const spar = Math.max(1.5 * minWall, mm(0.31)), seatWidth = Math.max(2 * minWall, mm(SWING_SEAT_WIDTH)),
    seatDepth = Math.max(2 * minWall, mm(SWING_SEAT_DEPTH)),
    silhouette = [[armRadius - grip, 0], [armRadius + grip / 2, 0], [seatRadius + spar / 2, -drop + seatDepth],
      [seatRadius + seatWidth / 2, -drop + seatDepth], [seatRadius + seatWidth / 2, -drop],
      [seatRadius - seatWidth / 2, -drop], [seatRadius - seatWidth / 2, -drop + spar],
      [armRadius - grip, -spar]],
    chairs = printExtrude(silhouette, -spar / 2, spar / 2);
  for (let i = 0; i < count; i++) {
    const angle = i * pitch, c = Math.cos(angle), s = Math.sin(angle),
      label = String(i + 1).padStart(2, '0');
    add(`swing-seat-${label}`, 'Swings', `Simplified swing ${i + 1} of ${count}`, chairs,
      { assembly: ([r, y, t]) => [r * c + t * s, r * s - t * c, base + y],
        notes: ['Print flat on its side. Fix the saddle flush beneath one crown arm with a small amount of suitable adhesive.'] });
  }
  if (drop > 6 * grip) instructions.push('The eight swing seats represent a fixed ride pose. Assemble after the tall mast has been stood on its base.');
}

function printAtriumBridge(ctx, bridge, mast) {
  const { model, mm, limit, minWall, clearance, add, warnings } = ctx, r = mm(model.r),
    width = Math.max(mm(bridge.width), minWall * 2), offset = mm(bridge.offset), level = bridge.f + 1,
    near = Math.max(offset - width / 2, mast.shaft + clearance), far = offset + width / 2,
    top = mm(buildStorey(model, bridge.f).base), depth = Math.max(minWall * 1.8, mm(atriumBridgeDepth(model.r, bridge))),
    span = Math.sqrt(r * r - far * far) - clearance / 2,
    lip = Math.sqrt(r * r - near * near) - span + 2 * minWall,
    c = Math.cos(bridge.heading), s = Math.sin(bridge.heading),
    count = Math.ceil(2 * span / (limit - 2 * lip - 8)),
    pieces = count > 1 ? count + count % 2 : 1,
    splice = 1.8 * minWall, half = (depth - clearance) / 2;
  if (!Number.isFinite(span) || span < 3 * minWall || far - near < 1.35 * minWall) {
    warnings.push(`Level ${level} atrium bridge has too little clearance at this print scale.`);
    return;
  }
  for (let i = 0; i < pieces; i++) {
    const a = -span + i * 2 * span / pieces, b = -span + (i + 1) * 2 * span / pieces,
      left = i === 0 ? [[a - lip, 0], [a, 0], [a, -depth]] :
        [[a - splice, 0], [a - splice, -half], [a + splice, -half], [a + splice, -depth]],
      right = i === pieces - 1 ? [[b, -depth], [b, 0], [b + lip, 0], [b + lip, minWall]] :
        [[b + splice - clearance, -depth], [b + splice - clearance, -half - clearance],
          [b - splice - clearance, -half - clearance], [b - splice - clearance, minWall]],
      outline = [...left, ...right, [left[0][0], minWall]],
      id = `atrium-bridge-l${level}-${i + 1}`;
    add(id, 'Atrium', `Level ${level} atrium bridge · bay ${i + 1} of ${pieces}`,
      printExtrude(outline, -far, -near), { assembly: ([along, y, across]) =>
        [-c * across - s * along, s * across - c * along, top + y],
        notes: [pieces > 1 ? 'Join the stepped laps on a flat surface before placing the bridge. Check the center support height.' :
          'The end shoes sit on the printed floor ledge.', 'Print on its long edge as supplied.'] });
  }
  const support = Math.max(mast.shaft + 2 * minWall, near + 1.9 * minWall), seat = top - depth,
    bore = mast.shaft + clearance, skin = Math.min(support - bore, Math.max(minWall, mm(0.30))),
    ring = (radius) => printAtriumCircle(radius, mast.stations);
  add(`atrium-bridge-l${level}-collar`, 'Atrium', `Level ${level} bridge mast bearing`, printAtriumSleeve(
    [[seat - skin, ring(support)], [seat, ring(support)]], [[seat - skin, ring(bore)], [seat, ring(bore)]]
  ), { notes: [`Slide onto the mast and set the top at ${seat.toFixed(1)} mm above the atrium ground datum.`,
    'Use the bridge itself to set the bearing height before fixing the collar.' ] });
}

function printAtriumCanopy(ctx, ride, mast) {
  const { model, mm, limit, minWall, clearance, add, warnings, instructions, inserts } = ctx,
    pitch = ride.roofPitch, innerRadius = mm(ride.platformRadius), openingRadius = mm(model.r),
    outerRadius = openingRadius + minWall * 1.8, acrylic = 1.0, frame = minWall + acrylic,
    inner = mast.shaft + clearance;
  if (!pitch || outerRadius - innerRadius < 10 || innerRadius - inner < minWall * 3) {
    warnings.push('The atrium roof opening is too small to seat a removable clear insert at this scale.');
    return;
  }
  // Straight glazed facets rest on a raised lip on the mast deck and independently
  // overlap the outer roof plate. Every insert lies in its own flat cutting plane.
  const sectorCount = Math.max(12, Math.ceil(TAU * outerRadius / (limit - 8))),
    halfAngle = Math.PI / sectorCount, chord = Math.cos(halfAngle),
    outerChord = Math.max(outerRadius * chord, openingRadius + minWall),
    innerChord = innerRadius * chord, ridge = mm(pitch.ridgeGlazingY ?? pitch.canopyRidgeY ?? (pitch.eaveY + pitch.rise)),
    eave = mm(model.roofPlan.y) + clearance / 2, rise = Math.max(0.2, ridge - eave),
    dx = outerChord - innerChord, distance = Math.hypot(dx, rise), lean = rise / distance, run = dx / distance,
    radialCount = Math.ceil(distance / (limit - 5)),
    halfInner = innerChord * Math.tan(halfAngle), halfOuter = outerChord * Math.tan(halfAngle),
    flare = (halfOuter - halfInner) / distance,
    ring = (radius) => printAtriumCircle(radius, mast.stations),
    deckRadius = innerChord - clearance, lipRadius = innerRadius + minWall * 1.8,
    deckTop = Math.max(ridge + frame, mm(pitch.canopyRidgeY ?? ride.roofLevel)),
    deckBottom = ridge - minWall * 1.1 - (lipRadius - deckRadius) - 0.10;
  if (halfInner < minWall * 2.6) {
    warnings.push('The roof facets are too narrow for a durable glazing pocket at this scale.');
    return;
  }
  add('atrium-boarding-deck', 'Atrium', 'Mast boarding deck and roof bearing', printAtriumSleeve(
    [[deckBottom, ring(deckRadius)], [ridge - minWall * 1.1, ring(lipRadius)], [ridge - 0.04, ring(lipRadius)],
      [ridge - 0.04, ring(deckRadius)], [deckTop, ring(deckRadius)]],
    [[deckBottom, ring(inner)], [deckTop, ring(inner)]]
  ), { notes: ['The outer lip carries the inner end of the glazing frames.',
    `Dry-fit its bearing ledge at ${ridge.toFixed(1)} mm above the atrium ground before attaching the roof panels.`] });
  for (let i = 0; i < sectorCount; i++) {
    const angle = i * TAU / sectorCount, c = Math.cos(angle), s = Math.sin(angle);
    for (let j = 0; j < radialCount; j++) {
      const a = distance * j / radialCount, b = distance * (j + 1) / radialCount,
        side = (v, inset) => halfInner + v * flare - inset * Math.hypot(1, flare),
        profile = (inset, shorten = inset) => {
          const p = a + shorten, q = b - shorten, low = side(p, inset), high = side(q, inset);
          return [[-low, p], [low, p], [high, q], [-high, q]];
        },
        outer = profile(clearance / 7), pocket = profile(minWall + clearance / 7),
        opening = profile(minWall * 1.8 + clearance / 7),
        id = `atrium-roof-${String(i + 1).padStart(2, '0')}-${j + 1}`;
      add(id, 'Atrium', `Roof glazing cassette ${i + 1}${radialCount > 1 ? ` · course ${j + 1}` : ''}`,
        printAtriumSleeve([[0, outer], [frame, outer]],
          [[0, opening], [minWall, opening], [minWall, pocket], [frame, pocket]]),
        { assembly: ([u, v, z]) => {
          const r = innerChord + v * run + z * lean;
          return [c * r - s * u, -s * r - c * u, ridge - v * lean + z * run];
        }, notes: ['Print flat with the acrylic pocket facing up. Insert from the recessed face.',
          'Seat one end on the boarding deck lip and the other on the perimeter roof. Join adjacent outer rails for a removable assembly.'] });
      inserts.push({ id: `${id}-acrylic`, label: `Clear atrium panel ${i + 1}${radialCount > 1 ? ` · course ${j + 1}` : ''}`,
        partId: id, shape: profile(minWall + clearance * (1 / 7 + 1 / 2)), thickness: acrylic,
        notes: 'Cut the matching clear panel from 1 mm sheet. Test the fit before removing the protective film.' });
    }
  }
  if (radialCount > 1) instructions.push('Join the numbered courses of each roof sector edge to edge before placing the joined roof sector on its two ledges.');
  instructions.push('Print the roof cut templates at actual size. Cut the glazing from 1 mm acrylic and fit it into the printed rebates. Dry-fit all roof cassettes before joining them.');
}

function planPrintAtrium(ctx) {
  const ride = ctx.model.feature.ride, mast = printAtriumMast(ctx, ride);
  printAtriumSwings(ctx, ride, mast);
  if (ctx.detail === 'massing') return;
  for (const bridge of ctx.model.circulation.bridges ?? []) printAtriumBridge(ctx, bridge, mast);
  printAtriumCanopy(ctx, ride, mast);
}
