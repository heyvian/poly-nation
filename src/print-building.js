'use strict';

// Fabrication volumes share the model datum. Each occupied cell contributes only
// its exposed faces, so slab edges, dock sockets and panel rebates form one shell.
function printBuildingCells(columns, rows, levels, point, hasCell, clockwise = false, wrapRows = false) {
  const triangles = [];
  const quad = (a, b, c, d) => {
    if (clockwise) triangles.push([a, b, c], [a, c, d]);
    else triangles.push([a, c, b], [a, d, c]);
  };
  const active = (i, j, k) =>
    i >= 0 && i < columns && k >= 0 && k < levels && (wrapRows || j >= 0 && j < rows) &&
    hasCell(i, wrapRows ? mod(j, rows) : j, k);
  for (let i = 0; i < columns; i++)
    for (let j = 0; j < rows; j++)
      for (let k = 0; k < levels; k++) {
        if (!active(i, j, k)) continue;
        const a = point(i, j, k), b = point(i + 1, j, k), c = point(i + 1, j + 1, k), d = point(i, j + 1, k),
          e = point(i, j, k + 1), f = point(i + 1, j, k + 1), g = point(i + 1, j + 1, k + 1), h = point(i, j + 1, k + 1);
        if (!active(i, j, k - 1)) quad(a, b, c, d);
        if (!active(i, j, k + 1)) quad(e, h, g, f);
        if (!active(i, j - 1, k)) quad(a, e, f, b);
        if (!active(i + 1, j, k)) quad(b, f, g, c);
        if (!active(i, j + 1, k)) quad(c, g, h, d);
        if (!active(i - 1, j, k)) quad(d, h, e, a);
      }
  return triangles;
}

function printBuildingStations(start, end, spacing, features = []) {
  const fixed = [start, ...features.filter((point) => point > start + 1e-7 && point < end - 1e-7), end]
    .sort((a, b) => a - b)
    .filter((point, i, list) => !i || point - list[i - 1] > 1e-7);
  const output = [start];
  for (let i = 1; i < fixed.length; i++) {
    const a = fixed[i - 1], b = fixed[i], count = Math.ceil((b - a) / spacing);
    for (let j = 1; j < count; j++) output.push(a + (b - a) * j / count);
    output.push(b);
  }
  return output;
}

function printBuildingRotate(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return ([x, y, z]) => [c * x + s * y, -s * x + c * y, z];
}

function printBuildingLocalAxis(radius, angle, elevation) {
  const rotate = printBuildingRotate(angle), [x, y] = printPolar(radius, angle);
  return (point) => {
    const [dx, dy, z] = rotate(point);
    return [dx + x, dy + y, z + elevation];
  };
}

function printKitSocket(ctx) {
  const { minWall, clearance } = ctx;
  return { depth: 2.8 * minWall, half: 1.8 * minWall, height: minWall,
    roof: minWall, allowance: clearance / 2 };
}

function printFloorBounds(ctx, floor) {
  const { model, mm, minWall, clearance } = ctx, top = mm(buildStorey(model, floor).base),
    socket = printKitSocket(ctx),
    socketTop = top - socket.roof, socketBottom = socketTop - socket.height - clearance;
  return { top, socketTop, socketBottom, bottom: Math.min(top - mm(model.slabThickness), socketBottom - minWall) };
}

function printBaseDatum(ctx) {
  const { model, mm, minWall } = ctx, plan = model.sitePlan;
  const lower = Math.min(printFloorBounds(ctx, 0).bottom - minWall, -2 * minWall);
  if (!plan) return lower;
  const terrain = Array.from({ length: 24 }, (_, i) => TAU * i / 24).flatMap((angle) =>
    [0, model.R / 2, model.R, model.R + MODULE.depth + 2.5].map((radius) =>
      mm(model.siteGroundAt(radius * Math.cos(angle), radius * Math.sin(angle)))));
  const canal = printBuildingCanal(ctx);
  return Math.min(lower, Math.max(-ctx.limit * 0.60, Math.min(...terrain, canal ?? Infinity) - minWall));
}

function printBuildingCanal(ctx) {
  const { model, mm } = ctx, plan = model.sitePlan;
  if (!plan?.water.overlaps(plan.position, model.R + MODULE.depth + 3)) return null;
  const depth = clamp(Number($('siteCanalDepth')?.value) || 2, 0.5, 8);
  return mm(plan.water.level - plan.foundation - depth);
}

function printBuildingWet(model, x, z) {
  const plan = model.sitePlan;
  if (!plan) return false;
  const [east, north] = plan.position, c = Math.cos(plan.angle), s = Math.sin(plan.angle);
  return plan.water.overlaps([east + c * x - s * z, north + s * x + c * z]);
}

function printBuildingTerrain(ctx, outer) {
  const { model, mm, limit, minWall } = ctx, metres = mm(1),
    mate = Math.max(mm(model.feature.ride.towerRadius + 1.8), minWall * 4),
    floor = printFloorBounds(ctx, 0), datum = printBaseDatum(ctx),
    canalBed = printBuildingCanal(ctx),
    count = Math.ceil(2 * outer / Math.min(218, limit - 2)),
    cuts = Array.from({ length: count + 1 }, (_, i) => outer * (2 * i / count - 1)),
    spacing = Math.max(minWall * 2, Math.min(5, mm(1)));
  const top = (x, y, wet) => {
    const radius = Math.hypot(x, y),
      terrain = model.siteGroundAt ? mm(model.siteGroundAt(x / metres, -y / metres)) : 0,
      contact = radius < mm(model.R + 0.65) ? Math.min(terrain, floor.bottom) : terrain;
    return wet && canalBed != null ? Math.max(datum + minWall, canalBed)
      : Math.max(datum + minWall, Math.min(contact, datum + limit * 0.80));
  };
  for (let row = 0; row < count; row++)
    for (let col = 0; col < count; col++) {
      const xs = printBuildingStations(cuts[col], cuts[col + 1], spacing, [-mate, mate]),
        ys = printBuildingStations(cuts[row], cuts[row + 1], spacing, [-mate, mate]),
        inside = (i, j) => {
          const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
          return Math.hypot(x, y) < outer && (Math.abs(x) >= mate || Math.abs(y) >= mate);
        },
        surface = xs.map((x) => ys.map((y) => top(x, y, printBuildingWet(model, x / metres, -y / metres)))),
        triangles = printBuildingCells(xs.length - 1, ys.length - 1, 1,
          (i, j, k) => [xs[i], ys[j], k ? surface[i][j] : datum], inside);
      const id = `base-${row + 1}-${col + 1}`;
      if (triangles.length) ctx.add(id, 'Base', `Base tile ${row + 1}.${col + 1}`, triangles,
        { notes: [canalBed != null ? 'The terrain relief leaves a recessed canal.' : 'Print the flat underside on the bed.',
          'Arrange the numbered tiles in rows and leave the square mast seat open.'] });
    }
}

function printBuildingRingCuts(ctx) {
  const { model, limit, mm } = ctx, R = mm(model.R),
    facet = model.coreEnvelope === 'faceted' ? R / Math.cos(Math.PI / model.slotN) : R,
    pitch = TAU / model.slotN,
    target = Math.min(Math.PI / 2, 2 * Math.asin(Math.min(0.8, (limit - 9) / (2 * facet)))),
    bayStep = Math.floor(target / pitch),
    desired = Math.ceil(TAU / target);
  if (2 * facet < limit - 2) return [0, TAU];
  if (bayStep < 1) return Array.from({ length: desired + 1 }, (_, i) => TAU * i / desired);
  const wedges = Math.ceil(model.slotN / bayStep);
  return Array.from({ length: wedges + 1 }, (_, i) => pitch / 2 + Math.floor(i * model.slotN / wedges) * pitch);
}

// A dry tile only touching another at a corner would create a shared vertical
// edge with four faces. Trim that pinch before exposing the floor surfaces.
function printSeparateDryCorners(cells, wrapped) {
  const rows = cells[0].length;
  let trimmed;
  do {
    trimmed = false;
    for (let i = 1; i < cells.length; i++) for (let j = Number(!wrapped); j < rows; j++) {
      const previous = mod(j - 1, rows),
        a = cells[i - 1][previous], b = cells[i - 1][j], c = cells[i][previous], d = cells[i][j];
      const pinch = a.insideSlab && d.insideSlab && !b.insideSlab && !c.insideSlab ? a
        : b.insideSlab && c.insideSlab && !a.insideSlab && !d.insideSlab ? b : null;
      if (!pinch) continue;
      pinch.insideSlab = false;
      trimmed = true;
    }
  } while (trimmed);
}

function printBuildingRing(ctx, floor, active, cuts, grid) {
  const { model, detail, mm, minWall, limit, clearance } = ctx,
    metres = mm(1), roof = floor === model.layers.length,
    top = roof ? mm(model.roofPlan.y) : printFloorBounds(ctx, floor).top,
    slab = roof ? { top, bottom: top - Math.max(minWall, mm(model.slabThickness)) } : printFloorBounds(ctx, floor),
    next = roof ? top : floor + 1 < model.layers.length ? printFloorBounds(ctx, floor + 1).bottom
      : mm(model.roofPlan.y) - Math.max(minWall, mm(model.slabThickness)),
    levels = roof ? [slab.bottom, top] : [slab.bottom, slab.socketBottom, slab.socketTop, top, next],
    socket = printKitSocket(ctx), inner = mm(model.r), outer = mm(model.R),
    wall = Math.max(minWall, mm(facadeThickness(model))),
    rim = Math.max(inner + minWall, outer - socket.depth - clearance),
    supportZones = grid.axes.flatMap((axis) => ['inner', 'outer'].flatMap((side) => {
      if (!axis.active[side]) return [];
      const radius = mm(grid[side]), half = Math.max(minWall, mm(coreColumnSize(grid, model.crane, axis, side))) / 2,
        start = Math.max(inner, radius - half), end = Math.min(outer, radius + half);
      return end - start < minWall / 2 ? [] : [{ angle: axis.angle, half: half / radius, start, end }];
    })),
    openings = active.map((slot) => {
      const width = mm(dockBayOpening(model, slot).width);
      return { angle: slot.angle, inset: Math.atan((socket.half + socket.allowance) / rim),
        half: Math.atan(Math.max(1.2 * minWall, width / 2) / (outer - wall)) };
    }),
    lobby = roof ? [] : lobbyHoles(model.lobby, floor),
    bridgeOpenings = (model.circulation.bridges ?? []).filter((bridge) => bridge.f === floor).flatMap(({ heading, offset, width }) => {
      const angleLow = Math.acos(clamp((offset + width / 2) / model.r, -1, 1)),
        angleHigh = Math.acos(clamp((offset - width / 2) / model.r, -1, 1)),
        mid = (angleLow + angleHigh) / 2, half = (angleHigh - angleLow) / 2 + 1 / inner;
      return [[heading + mid, half], [heading - mid, half]];
    }),
    plazaGalleries = floor === 1 && model.lobby.gallery ? mm(model.lobby.gallery) : inner,
    slices = Math.ceil((outer - inner) / (limit * 0.72));
  for (let segment = 0; segment < cuts.length - 1; segment++) {
    const a = cuts[segment], b = cuts[segment + 1], heading = (a + b) / 2,
      features = coreFaceDividers(coreOutline(model), a, b),
      angular = (at, half) => {
        for (const target of [at - half, at + half]) {
          const angle = a + mod(target - a, TAU);
          if (angle > a && angle < b) features.push(angle);
        }
      };
    for (const port of openings) {
      angular(port.angle, port.half);
      angular(port.angle, port.inset);
    }
    for (const [angle, half] of lobby) angular(angle, half);
    for (const [angle, half] of bridgeOpenings) angular(angle, half);
    if (!roof && detail === 'structure') for (const zone of supportZones) angular(zone.angle, zone.half);
    const angles = printBuildingStations(a, b, Math.min(0.065, 7 / outer), features),
      rotate = printBuildingRotate(-heading),
      basePoint = (radius, angle, z) => {
        const [x, y] = printPolar(mm(coreBoundaryRadius(model, radius / metres, angle)), angle);
        return rotate([x, y, z]);
      };
    for (let stripe = 0; stripe < slices; stripe++) {
      const r = inner + stripe * (outer - inner) / slices,
        R = inner + (stripe + 1) * (outer - inner) / slices,
        details = [inner + wall, inner + wall + minWall, outer - wall, rim, plazaGalleries],
        spacing = floor === 0 && model.sitePlan?.anchor ? 5 : Infinity;
      if (detail === 'structure') for (const { start, end } of supportZones) details.push(start, end);
      const radii = printBuildingStations(r, R, spacing, details),
        cell = radii.slice(0, -1).map((value, i) => angles.slice(0, -1).map((angle, j) => {
          const radius = (value + radii[i + 1]) / 2, azimuth = (angle + angles[j + 1]) / 2,
            within = (center, half) => angDist(center, azimuth) < half,
            wet = floor === 0 && printBuildingWet(model, radius / metres * Math.cos(azimuth), radius / metres * Math.sin(azimuth)),
            lobbyVoid = lobby.some(([center, half]) => within(center, half)),
            insideSlab = !wet && !(floor === 1 && lobbyVoid && radius < plazaGalleries),
            keyway = radius >= rim && openings.some((port) => within(port.angle, port.inset)),
            inWall = radius < inner + wall || radius > outer - wall,
            bridge = radius < inner + wall + minWall && bridgeOpenings.some(([center, half]) => within(center, half)),
            door = (radius > outer - wall && openings.some((port) => within(port.angle, port.half))) || bridge,
            column = supportZones.some((zone) => radius > zone.start && radius < zone.end && within(zone.angle, zone.half));
          return { insideSlab, keyway,
            body: !lobbyVoid && !bridge && (detail === 'massing' || detail === 'assembly' && inWall && !door || detail === 'structure' && column) };
        }));
      if (floor === 0 && model.sitePlan?.anchor) printSeparateDryCorners(cell, cuts.length === 2);
      const triangles = printBuildingCells(radii.length - 1, angles.length - 1, levels.length - 1,
          (i, j, k) => basePoint(radii[i], angles[j], levels[k]), (i, j, k) => {
            const { insideSlab, body, keyway } = cell[i][j];
            if (!insideSlab) return false;
            if (k === 1 && keyway) return false;
            return k < 3 || body;
          }, true, cuts.length === 2);
      if (!triangles.length) continue;
      const tag = roof ? 'roof' : `level-${floor + 1}`,
        suffix = `${segment + 1}${slices > 1 ? '-' + (stripe + 1) : ''}`;
      ctx.add(`core-${tag}-${suffix}`, 'Core', `${roof ? 'Roof ring' : 'Level ' + (floor + 1)} · sector ${suffix}`, triangles,
        { assembly: printBuildingRotate(heading),
          notes: ['Lay the floor slab on the bed. Dry fit adjacent sector edges before joining.',
            ...(roof ? ['The atrium opening stays clear of printed glazing.'] : ['Use the numbered floor and sector for assembly.'])] });
    }
  }
}

function printDockShape(ctx, slot) {
  const { model, mm, minWall, clearance } = ctx, socket = printKitSocket(ctx),
    sourceRadius = mm(dockFootRadius(model)),
    face = mm(coreBoundaryRadius(model, model.R, slot.angle)) - sourceRadius,
    rim = Math.max(mm(model.r) + minWall, mm(model.R) - socket.depth - clearance),
    tongueEnd = mm(coreBoundaryRadius(model, rim / mm(1), slot.angle)) - sourceRadius + clearance / 2,
    floor = printFloorBounds(ctx, slot.f), low = floor.socketBottom + socket.allowance;
  return { socket, sourceRadius, seat: face + 0.06, tongueEnd, low, deck: floor.top - low,
    width: mm(MODULE.width) / 2 - clearance / 2, length: mm(MODULE.depth) };
}

function printDockTray(ctx, slot, id) {
  const { mm, minWall, detail } = ctx,
    { socket, sourceRadius, seat, tongueEnd, low, deck, width, length } = printDockShape(ctx, slot),
    planted = slot.use === 'garden' && detail !== 'massing',
    planter = Math.max(minWall, Math.min(width, mm(0.36))),
    x = [tongueEnd, seat, ...(planted ? [length * 0.23, length * 0.83] : []), length],
    y = printBuildingStations(-width, width, Infinity,
      [-socket.half, socket.half, ...(planted ? [-width + planter, width - planter] : [])]),
    z = [0, socket.height, deck, ...(planted ? [deck + Math.max(minWall, mm(0.45))] : [])],
    triangles = printBuildingCells(x.length - 1, y.length - 1, z.length - 1,
      (i, j, k) => [x[i], y[j], z[k]], (i, j, k) => {
        const center = (y[j] + y[j + 1]) / 2;
        if (i === 0) return k === 0 && Math.abs(center) < socket.half;
        if (k < 2) return true;
        return planted && i === 2 && Math.abs(center) > width - planter;
      });
  ctx.add(id, 'Dock supports', `Level ${slot.f + 1} · bay ${slot.j + 1} · ${slot.use === 'garden' ? 'garden deck' : slot.use === 'balcony' || slot.siteCanalLookout ? 'balcony deck' : 'docking tray'}`,
    triangles, { assembly: printBuildingLocalAxis(sourceRadius, slot.angle, low),
      notes: ['Print on the flat underside. Slide the narrow tongue into the matching core-rim socket.',
        'Seat the module on the flat tray. Leave the tongue unglued for removal.'] });
}

function printModuleTop(form, normalized, station) {
  const end = form.profile.findIndex(([across]) => across >= normalized);
  if (end <= 0) return moduleRoofAt(form, form.profile[end === 0 ? 0 : form.profile.length - 1][1], station);
  const [a, low] = form.profile[end - 1], [b, high] = form.profile[end];
  return moduleRoofAt(form, low + (high - low) * (normalized - a) / (b - a), station);
}

function printModulePane(ctx, form) {
  const { mm, minWall, clearance } = ctx, front = form.length,
    actualHalf = mm(moduleHalfAt(form, front)),
    half = Math.min(actualHalf * 0.68, mm(1.05)),
    shoulder = minWall,
    top = Math.min(...form.stations.flatMap((x) =>
      form.profile.map(([across]) => mm(printModuleTop(form, across, x))))),
    sill = Math.max(1.5 * minWall, mm(0.45)),
    head = Math.min(top - minWall, mm(2.55)),
    rebate = 1 + clearance,
    relief = Math.max(1.4 * minWall, mm(0.72));
  if (half < 2.05 * minWall || head - sill < 4 * minWall ||
      mm(front) < relief + rebate + minWall) return null;
  return { low: sill, high: head, innerLow: sill + shoulder, innerHigh: head - shoulder,
    outer: half / actualHalf, inner: (half - shoulder) / actualHalf, width: 2 * half - clearance,
    height: head - sill - clearance, seat: mm(front) - rebate, recess: mm(front) - rebate - relief };
}

function printMassingModule(ctx, slot, id, form, label) {
  const { mm, minWall } = ctx,
    { socket, sourceRadius, seat, tongueEnd, low, deck, width, length } = printDockShape(ctx, slot),
    x = printBuildingStations(tongueEnd, length, Infinity, [seat, ...form.stations.map(mm)]),
    key = socket.half / width,
    y = printBuildingStations(-1, 1, Infinity, [-key, key, ...form.profile.map(([across]) => across)]),
    levels = [0, socket.height, deck, deck + minWall],
    triangles = printBuildingCells(x.length - 1, y.length - 1, levels.length,
      (i, j, k) => {
        const station = clamp(x[i] / mm(1), 0, form.length),
          side = k <= 2 ? width : mm(moduleHalfAt(form, station)),
          height = k < levels.length ? levels[k] : deck + mm(printModuleTop(form, y[j], station));
        return [x[i], side * y[j], height];
      }, (i, j, k) => {
        if (i === 0) return k === 0 && Math.abs((y[j] + y[j + 1]) / 2) < key;
        if (k < 2) return true;
        const center = (x[i] + x[i + 1]) / 2;
        return center > 0 && center < mm(form.length);
      });
  ctx.add(id, 'Modules', label, triangles, { assembly: printBuildingLocalAxis(sourceRadius, slot.angle, low),
    notes: ['Print on the flat underside. The module, chassis and docking tongue are one piece.',
      'Slide the tongue into the matching numbered core bay. Leave it unglued for removal.'] });
}

function printBuildingModule(ctx, slot, id, usePane) {
  const { model, mm, assignments } = ctx,
    material = moduleMaterialSelection(model, slot, assignments ?? {}, state.seed),
    { form } = material,
    program = slot.p === EMPTY ? 'Commercial / retail' : P[slot.p].name,
    label = `Level ${slot.f + 1} · bay ${slot.j + 1} · ${program}`;
  if (ctx.detail === 'massing') {
    printMassingModule(ctx, slot, id, form, label);
    return false;
  }
  const pane = usePane ? printModulePane(ctx, form) : null,
    x = printBuildingStations(0, mm(form.length), Infinity, [...form.stations.map(mm), ...(pane ? [pane.seat, pane.recess] : [])]),
    y = printBuildingStations(-1, 1, Infinity,
      [...form.profile.map(([point]) => point), ...(pane ? [-pane.outer, -pane.inner, pane.inner, pane.outer] : [])]),
    z = pane ? [0, pane.low, pane.innerLow, pane.innerHigh, pane.high] : [0],
    triangles = printBuildingCells(x.length - 1, y.length - 1, z.length,
      (i, j, k) => {
        const station = x[i] / mm(1);
        return [x[i], y[j] * mm(moduleHalfAt(form, station)),
          k < z.length ? z[k] : mm(printModuleTop(form, y[j], station))];
      }, (i, j, k) => {
        if (!pane) return true;
        const along = (x[i] + x[i + 1]) / 2, across = Math.abs((y[j] + y[j + 1]) / 2);
        if (along > pane.seat && across < pane.outer && k >= 1 && k <= 3) return false;
        return !(along > pane.recess && across < pane.inner && k === 2);
      }),
    notes = ['Print on the solid flat underside and place on the matching docking tray.'];
  if (pane) {
    notes.push('Fit the matching flat 1 mm acrylic panel in the shallow front rebate. The deeper recess reads as the interior opening.');
    ctx.inserts.push({ id: `insert-${id}`, label: `${label} · front panel`, partId: id,
      shape: [[0, 0], [pane.width, 0], [pane.width, pane.height], [0, pane.height]], thickness: 1,
      notes: 'Flat acrylic. The printed rebate includes the selected clearance. Test a cut against its matching module before batch cutting.' });
  }
  ctx.add(id, 'Modules', label, triangles,
    { assembly: printBuildingLocalAxis(mm(dockFootRadius(model)), slot.angle, printFloorBounds(ctx, slot.f).top),
      notes });
  return Boolean(pane);
}

function printCanalTransferBeams(ctx) {
  const { model, mm, limit, minWall, detail } = ctx, plan = model.sitePlan;
  if (detail !== 'structure' || !plan?.anchor || model.layers.length < 2) return;
  const c = Math.cos(plan.angle), s = Math.sin(plan.angle), [x, z] = plan.position,
    upper = printFloorBounds(ctx, 1).bottom, width = Math.max(1.7 * minWall, mm(0.48));
  const local = ([px, pz]) => [mm(c * (px - x) + s * (pz - z)), mm(s * (px - x) - c * (pz - z))];
  for (const [rowIndex, row] of plan.rows.entries()) {
    for (const [spanIndex, beam] of row.transfers.entries()) {
      const [ax, ay] = local(row.at(beam.from)), [bx, by] = local(row.at(beam.to)),
        length = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / length, uy = (by - ay) / length,
        height = Math.max(minWall, mm(beam.depth)), count = Math.ceil(length / (limit - 4));
      for (let i = 0; i < count; i++) {
        const start = i * length / count, end = (i + 1) * length / count;
        ctx.add(`canal-transfer-${rowIndex + 1}-${spanIndex + 1}-${i + 1}`, 'Base',
          `Canal transfer · row ${rowIndex + 1} · span ${spanIndex + 1} · piece ${i + 1}`,
          printBox(0, -width / 2, 0, end - start, width / 2, height),
          { assembly: ([along, across, up]) => [ax + ux * (along + start) - uy * across,
            ay + uy * (along + start) + ux * across, upper - height + up],
            notes: ['The transfer fits under the first elevated level. Align its ends with the dry banks before joining.'] });
      }
    }
  }
}

function planPrintBuilding(ctx) {
  const { model, detail, mm, instructions, warnings } = ctx,
    grid = buildSupportGrid(model), cuts = printBuildingRingCuts(ctx),
    slots = model.slots.filter((slot) => !slot.blocked && dockInUse(slot)),
    glazed = new Set(),
    radius = Math.max(mm(model.R + 2.5), mm(model.R + BUILD_SECTION.dockGap + MODULE.depth + 1.8));
  printBuildingTerrain(ctx, radius);
  printCanalTransferBeams(ctx);
  for (let f = 0; f <= model.layers.length; f++)
    printBuildingRing(ctx, f, slots.filter((slot) => slot.f === f), cuts, grid);
  for (const slot of slots) {
    const key = `l${slot.f + 1}-b${slot.j + 1}`,
      enclosed = slot.p !== EMPTY || slot.use === 'retail';
    if (!enclosed || detail !== 'massing') printDockTray(ctx, slot, `dock-${key}`);
    if (!enclosed) continue;
    const canGlaze = detail !== 'massing' && !glazed.has(slot.p);
    if (printBuildingModule(ctx, slot, `module-${key}`, canGlaze)) glazed.add(slot.p);
  }
  instructions.push('Join the numbered base tiles, then assemble core sectors by level. Leave the mast receiver opening clear.',
    detail === 'massing'
      ? 'Trial-fit each one-piece module in its matching indexed bay before gluing the core tiers together.'
      : 'Docking trays share the indexed bay numbers on each floor. Trial-fit the tongue before attaching the module to its tray.',
    'Adjacent core sectors meet at flat seams. Use removable tape to register a level during dry fit.',
    'The core kit thickens thin slab edges and support details to the selected printable wall thickness.');
  if (glazed.size) instructions.push('Flat acrylic inserts are provided for one representative enclosed module per available programme. The roof atrium stays open.');
  else if (detail !== 'massing' && slots.some((slot) => slot.p !== EMPTY || slot.use === 'retail'))
    warnings.push('The modules are too small at this scale for a 1 mm acrylic insert with printable edges.');
}
