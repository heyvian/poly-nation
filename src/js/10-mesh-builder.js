"use strict";
/**
 * 10-mesh-builder.js — buildMesh(): converts the building model into 3D geometry.
 * Used for the on-screen view and (with exporting = true) for the Rhino/3DM export.
 * The function is long because it builds each part in turn; the numbered comments inside mark the parts.
 */
// Builds all 3D geometry for model `m`. Order: courtyard, core rooms, circulation, doors, lobby, plaza, modules, roof, facade, climbing wall, swing ride, water slide, people and animals.
function buildMesh(m, exporting = false) {
  const b = meshBuilder(),
    { solid, lines, glass, quad, tri, line, sector, box, ringPoint, mark, groups } = b;
  const slab = rgb("#d8dcd4"),
    edge = rgb("#a3aea3"),
    ground = rgb("#e4e8df");
  const floorH = 4.2,
    H = state.floors * floorH;
  const extent = Math.max(m.R + MODULE.depth + 8, m.plaza ? m.plaza.outer + 2 : 0),
    plane = Math.max(170, extent * 2.6);
  mark("Reference");
  quad(
    [-plane, -0.22, -plane],
    [-plane, -0.22, plane],
    [plane, -0.22, plane],
    [plane, -0.22, -plane],
    ground,
  );
  if (state.grid) {
    let gridCol = rgb("#d3d9ce");
    for (let i = -Math.ceil(extent / 10) * 10; i <= extent + 10; i += 10) {
      line([i, -0.19, -extent - 10], [i, -0.19, extent + 10], gridCol);
      line([-extent - 10, -0.19, i], [extent + 10, -0.19, i], gridCol);
    }
  }
  mark("Core_Foundation");
  sector(0, m.R + 0.25, 0, TAU, 0, 0.18, slab);
  mark("Infinite_Rinse_Greenhouse");
  sector(0, m.r, 0, TAU, 0.19, 0.11, rgb("#c8d7c2"));
  // Symbolic bioremediation beds and paths, all within the central courtyard.
  const rr = m.r;
  let num = Math.max(2, Math.min(6, Math.floor(rr / 5)));
  const bedWidth = Math.min(3.6, rr / (num + 1));
  for (let i = 0; i < num; i++) {
    let x = (i - (num - 1) / 2) * (bedWidth + 1.2),
      zmax = Math.sqrt(Math.max(0, (rr - 1.5) ** 2 - (Math.abs(x) + bedWidth / 2) ** 2));
    if (zmax < 1) continue;
    for (const side of [-1, 1]) {
      let depth = Math.max(0.8, zmax - 0.85);
      box(
        x,
        0.3,
        side * (depth / 2 + 0.85),
        bedWidth,
        0.26,
        depth,
        -Math.PI / 2,
        rgb(i % 2 ? "#8fb8a8" : "#91b6c4"),
      );
    }
  } // central pedestrian route
  if (rr > 3) box(0, 0.32, 0, 1.6, 0.07, rr * 1.8, 0, rgb("#efeee3"));
  // Permanent ring: independent variable-size rooms, with diagrammatic seams.
  const visible = (f) => exporting || !state.inspect || f < state.inspect;
  const cut = !exporting && state.inspect > 0,
    cutY = cut ? state.inspect * floorH + 0.22 : Infinity;
  for (let f = 0; f < state.floors; f++) {
    if (!visible(f)) continue;
    const y = f * floorH + 0.22;
    mark(`Core_L${f + 1}_Slab`);
    const l = m.lobby;
    if (f === 1 && l.area && l.levels === 2)
      sector(m.r - 0.08, m.R + 0.12, l.angle + l.span / 2, l.angle + TAU - l.span / 2, y, 0.23, slab);
    else sector(m.r - 0.08, m.R + 0.12, 0, TAU, y, 0.23, slab);
    for (const room of m.rooms) {
      if (room.f !== f || (!exporting && !state.showRooms)) continue;
      mark(`Core_L${f + 1}_${P[room.id].id}`, `Room_${f + 1}_${room.band}_${room.start.toFixed(3)}`);
      const c = rgb(P[room.id].color),
        gap = Math.min(0.15 / ((room.r + room.R) / 2), (room.end - room.start) * 0.16),
        radialGap = m.bandN === 2 ? 0.13 : 0;
      const ra = room.r + (room.facadeFacing ? 0 : radialGap),
        rb = Math.min(room.R - (room.facadeFacing ? 0 : radialGap), m.R - facadeThickness(m) - 0.035),
        flat = !exporting && state.xray,
        h = flat ? 0.13 : floorH - 0.31;
      if (rb <= ra + 0.001) continue;
      let portal = null;
      if (room.slideLanding && !flat && m.feature.slide) {
        const a = (room.start + room.end) / 2,
          d = Math.min((room.end - room.start) * 0.34, 1.35 / rb),
          yy = f === m.feature.slide.startFloor ? m.feature.slide.topY : m.feature.slide.bottomY;
        portal = { a: a - d, b: a + d, lo: yy - 1.25, hi: yy + 1.25 };
      }
      sector(
        ra,
        rb,
        room.start + gap,
        room.end - gap,
        y + 0.25,
        h,
        c,
        portal,
        !exporting && !state.inspect && state.showRoofDeck && !state.xray && f === state.floors - 1,
      );
      if (portal) {
        const frame = rgb("#287fa7"),
          a = portal.a,
          b = portal.b,
          lo = Math.max(y + 0.25, portal.lo),
          hi = Math.min(y + 0.25 + h, portal.hi);
        for (const u of [a, b]) line(ringPoint(rb + 0.025, u, lo), ringPoint(rb + 0.025, u, hi), frame);
        line(ringPoint(rb + 0.025, a, hi), ringPoint(rb + 0.025, b, hi), frame);
      }
      const seam = c.map((x) => x * 0.48),
        top = flat ? y + 0.38 : y + floorH - 0.035;
      line(ringPoint(ra, room.start + gap, top), ringPoint(rb, room.start + gap, top), seam);
      line(ringPoint(rb, room.start + gap, y + 0.25), ringPoint(rb, room.start + gap, top), seam);
    }
  }
  // Circulation uses cut-out spaces between the rooms, visible in plan and section.
  const circulation = m.circulation;
  for (const q of [...circulation.regions, ...circulation.hubs]) {
    if (!visible(q.f)) continue;
    const y = q.f * floorH + 0.46,
      kind = q.kind,
      isLift = kind === "elevator",
      isHub = kind === "hub",
      color = rgb(isLift ? "#777a91" : isHub ? "#80509e" : "#eee9da");
    mark(
      `Circulation_L${q.f + 1}_${isLift ? "Lift_" + (q.block + 1) : isHub ? "Shared_" + P[q.pair[0]].id + "_" + P[q.pair[1]].id : kind}`,
      `${kind}_${q.f + 1}_${q.start.toFixed(3)}`,
    );
    sector(q.r, q.R, q.start, q.end, y, isLift ? floorH - 0.18 : 0.075, color);
    if (isLift) {
      const a = q.end,
        rad = (q.r + q.R) / 2,
        door = Math.min(1.25, (q.R - q.r) * 0.55);
      if (door > 0.1) {
        const dc = rgb("#d3d8e3"),
          v0 = ringPoint(rad - door / 2, a + 0.0008, y + 0.08),
          v1 = ringPoint(rad + door / 2, a + 0.0008, y + 0.08);
        quad(v0, v1, [v1[0], y + 2.25, v1[2]], [v0[0], y + 2.25, v0[2]], dc);
      }
    } else {
      if (isHub) {
        const a = (q.start + q.end) / 2,
          rad = q.r + (q.R - q.r) * 0.44,
          depth = q.R - q.r,
          span = (q.end - q.start) * rad;
        if (depth > 2.2 && span > 2.3) {
          const at = (rr, aa, h, w, ht, d, col) =>
            box(rr * Math.cos(aa), h, rr * Math.sin(aa), w, ht, d, aa, col, true);
          mark(`Circulation_L${q.f + 1}_Shared_Furniture`, `Shared gathering ${q.start.toFixed(3)}`);
          const timber = rgb("#d4bb9c"),
            base = rgb("#5c426a");
          const tw = Math.min(1.25, span * 0.3),
            td = Math.min(1.4, depth * 0.26);
          at(rad, a, y + 0.09, 0.28, 0.71, 0.28, base);
          at(rad, a, y + 0.8, tw, 0.12, td, timber);
          const rugW = Math.min(span * 0.68, 3.7),
            rugD = Math.min(depth * 0.65, 3.8);
          at(rad, a, y + 0.079, rugW, 0.025, rugD, rgb("#bca4ce"));
          const sofaW = Math.min(2.4, span * 0.55),
            sofaD = Math.min(0.83, depth * 0.18);
          for (const sign of [-1, 1]) {
            const dr = sign * Math.min(depth * 0.29, 1.6),
              sr = rad + dr;
            if (sr - sofaD / 2 < q.r + 0.1 || sr + sofaD / 2 > q.R - 0.1) continue;
            at(sr, a, y + 0.1, sofaW, 0.42, sofaD, rgb("#d2c7bb"));
            at(sr + sign * sofaD * 0.36, a, y + 0.5, sofaW, 0.43, sofaD * 0.27, rgb("#a69aa9"));
          }
        }
      }
      const col = rgb(isHub ? "#5e3c77" : "#bfc3b9");
      for (const radius of [q.r, q.R]) {
        const n = Math.max(1, Math.ceil((q.end - q.start) / 0.09));
        for (let i = 0; i < n; i++)
          line(
            ringPoint(radius, q.start + ((q.end - q.start) * i) / n, y + 0.087),
            ringPoint(radius, q.start + ((q.end - q.start) * (i + 1)) / n, y + 0.087),
            col,
          );
      }
    }
  }
  // Separate room thresholds and paired shared doors: diagrammatic lines, not detailed door openings.
  for (const d of circulation.doors) {
    if (!visible(d.f)) continue;
    const y = d.f * floorH + 0.56,
      co = rgb(d.kind === "shared" ? "#5d805f" : "#66786f");
    mark(`Circulation_L${d.f + 1}_Doors`);
    if (d.kind === "shared") {
      const w = 0.55;
      line(ringPoint(Math.max(0, d.r - w), d.angle, y), ringPoint(d.r + w, d.angle, y), co);
    } else {
      const w = (d.width || 1.2) / 2 / Math.max(1, d.r);
      line(ringPoint(d.r, d.angle - w, y), ringPoint(d.r, d.angle + w, y), co);
    }
  }
  // Accessible connection from the dock frame to the outer corridor; each occupied slot has a discrete threshold.
  for (const s of m.slots) {
    if (!visible(s.f) || s.blocked || (s.p === EMPTY && s.use === "empty")) continue;
    if (!exporting && !state.showModules) continue;
    mark(`Circulation_L${s.f + 1}_Dock_Thresholds`, `Dock_${s.j}`);
    const a = s.angle,
      rad = m.R + 0.325;
    box(
      rad * Math.cos(a),
      s.f * floorH + 0.46,
      rad * Math.sin(a),
      Math.min(2.0, MODULE.width),
      0.08,
      0.7,
      a,
      rgb("#eee9da"),
    );
  }
  // Double-height entrance lobby: glazed sidewalls, no intermediate floor, open portal toward approach.
  const l = m.lobby;
  if (l.area) {
    const a = l.angle - l.span / 2,
      z = l.angle + l.span / 2,
      h = l.levels * floorH,
      base = 0.45,
      top = Math.min(l.levels * floorH + 0.22, cutY),
      frame = rgb("#ac9271"),
      glaze = rgb("#c7dbd9");
    mark("Entrance_Lobby");
    sector(m.r, m.R, a, z, 0.23, 0.23, rgb("#e5d3ae"));
    if (!cut || state.inspect > l.levels) sector(m.r, m.R, a, z, top - 0.2, 0.2, rgb("#e5d3ae"));
    for (const k of [a, z]) {
      quad(
        ringPoint(m.r, k, base),
        ringPoint(m.R, k, base),
        ringPoint(m.R, k, top - 0.2),
        ringPoint(m.r, k, top - 0.2),
        glaze,
        glass,
        0.3,
      );
      line(ringPoint(m.R, k, base), ringPoint(m.R, k, top - 0.2), frame);
    }
    const portal = Math.min(l.span * 0.32, 2.8 / m.R);
    for (const [x1, x2] of [
      [a, l.angle - portal],
      [l.angle + portal, z],
    ])
      if (x2 > x1) {
        const n = Math.max(1, Math.ceil((x2 - x1) / 0.07));
        for (let j = 0; j < n; j++) {
          const u = x1 + ((x2 - x1) * j) / n,
            v = x1 + ((x2 - x1) * (j + 1)) / n;
          quad(
            ringPoint(m.R, u, base),
            ringPoint(m.R, v, base),
            ringPoint(m.R, v, top - 0.2),
            ringPoint(m.R, u, top - 0.2),
            glaze,
            glass,
            0.32,
          );
          line(ringPoint(m.R, u, base), ringPoint(m.R, u, top - 0.2), frame);
        }
      }
  }
  // Outdoor forecourt — the approach stays within the reserved entrance wedge, then
  // widens beyond the module tips. Furniture never occupies the primary entry axis.
  if (m.plaza) {
    const p = m.plaza,
      a = p.angle,
      lo = a - p.span / 2,
      hi = a + p.span / 2,
      walk = rgb("#e5d3ae"),
      paving = rgb("#ddd8cc"),
      border = rgb("#c0b6a3"),
      seat = rgb("#b69b75");
    mark("Entrance_Plaza_Paving", "Entrance approach");
    sector(p.inner, p.mouth, a - p.approachSpan / 2, a + p.approachSpan / 2, 0.01, 0.17, walk);
    mark("Entrance_Plaza_Paving", "Expanded public forecourt");
    sector(p.mouth, p.outer, lo, hi, 0.01, 0.17, paving);
    const pathHalf = Math.min(p.approachSpan / 2, p.span * 0.19, 3.2 / p.mouth);
    mark("Entrance_Plaza_Promenade", "Clear central pedestrian axis");
    sector(p.mouth, p.outer, a - pathHalf, a + pathHalf, 0.182, 0.015, walk);
    mark("Entrance_Plaza_Paving", "Paving joints and perimeter");
    for (let i = 0; i <= 5; i++) {
      const r = p.mouth + ((p.outer - p.mouth) * i) / 5;
      for (let j = 0; j < 40; j++)
        line(
          ringPoint(r, lo + ((hi - lo) * j) / 40, 0.201),
          ringPoint(r, lo + ((hi - lo) * (j + 1)) / 40, 0.201),
          border,
        );
    }
    for (const k of [lo, hi, a - pathHalf, a + pathHalf])
      line(ringPoint(p.mouth, k, 0.201), ringPoint(p.outer, k, 0.201), border);
    function at(rad, theta, y, w, h, d, col, outline = true) {
      box(rad * Math.cos(theta), y, rad * Math.sin(theta), w, h, d, theta, col, outline);
    }
    // Two planted gathering zones framing a broad unobstructed entrance promenade.
    for (const sign of [-1, 1]) {
      const theta = a + sign * p.span * 0.33;
      for (let j = 0; j < 2; j++) {
        const rad = p.mouth + 3.4 + 8.0 * j;
        mark("Entrance_Plaza_Planters", `Planter_${sign}_${j}`);
        at(rad, theta, 0.2, 3.4, 0.44, 3.6, rgb("#9a9f90"));
        mark("Entrance_Plaza_Planting", `Planting_${sign}_${j}`);
        at(rad, theta, 0.65, 3.05, 0.1, 3.23, rgb("#83a86f"));
        const cx = rad * Math.cos(theta),
          cz = rad * Math.sin(theta);
        mark("Entrance_Plaza_Tree_Trunks", `Trunk_${sign}_${j}`);
        box(cx, 0.73, cz, 0.22, 3.4, 0.22, 0, rgb("#927758"));
        mark("Entrance_Plaza_Tree_Canopies", `Canopy_${sign}_${j}`);
        const N = 9,
          canopy = rgb(j % 2 ? "#84a678" : "#75996e");
        for (let k = 0; k < N; k++) {
          const u = (k * TAU) / N,
            v = ((k + 1) * TAU) / N;
          const pt = (t, r, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
          tri([cx, 2.7, cz], pt(u, 1.65, 4.15), pt(v, 1.65, 4.15), canopy);
          tri(pt(u, 1.65, 4.15), [cx, 5.55, cz], pt(v, 1.65, 4.15), canopy);
        }
        mark("Entrance_Plaza_Seating", `Bench_${sign}_${j}`);
        const benchTheta = theta - (sign * 2.15) / rad;
        at(rad, benchTheta, 0.2, 0.42, 0.43, 2.8, rgb("#777d72"));
        mark("Entrance_Plaza_Seating_Tops", `Bench_top_${sign}_${j}`);
        at(rad, benchTheta, 0.63, 0.82, 0.14, 3.05, seat);
      }
      // Small communal table with stools, between the planted islands.
      const rad = p.mouth + 7.4;
      mark("Entrance_Plaza_Seating", `Gathering_table_${sign}`);
      at(rad, theta, 0.2, 0.25, 0.78, 0.25, rgb("#777d72"));
      at(rad, theta, 0.98, 1.35, 0.12, 1.55, seat);
      for (const off of [-1.3, 1.3]) at(rad + off, theta, 0.2, 0.64, 0.45, 0.64, seat);
    }
  }

  // Primary modules and adaptive uses share the same docking geometry.
  if (exporting || state.showModules)
    for (const s of m.slots) {
      if (!visible(s.f) || s.blocked || (s.p === EMPTY && s.use === "empty")) continue;
      const a = s.angle,
        center = m.R + 0.65 + MODULE.depth / 2,
        x = center * Math.cos(a),
        z = center * Math.sin(a),
        y = s.f * floorH + 0.43;
      const v = s.p === EMPTY ? VACANCY.find((v) => v.id === s.use) : P[s.p],
        c = rgb(v.color);
      if (exporting || state.supports) {
        mark(`Docking_L${s.f + 1}_Frames`, `Frame_${s.j}`);
        const rc = m.R + 0.35;
        box(rc * Math.cos(a), y - 0.21, rc * Math.sin(a), 3.6, 0.18, 0.85, a, edge);
        for (const off of [-1.8, 1.8]) {
          const T = [-Math.sin(a), Math.cos(a)];
          box(x + off * T[0], y - 0.17, z + off * T[1], 0.15, 0.14, MODULE.depth + 0.65, a, edge);
        }
      }
      mark(`Modules_L${s.f + 1}_${s.p === EMPTY ? s.use : P[s.p].id}`, `Slot_${s.j}`);
      if (s.p !== EMPTY || s.use === "retail") {
        box(x, y, z, MODULE.width, MODULE.height, MODULE.depth, a, c, true);
        if (s.use === "retail") {
          const ra = m.R + 0.65 + MODULE.depth + 0.01;
          box(ra * Math.cos(a), y + 0.32, ra * Math.sin(a), 3.65, 2.4, 0.06, a, rgb("#d8d2e1"), true);
        }
        continue;
      }
      // Open public decks: no enclosed volume. Railings and planting are symbolic.
      box(x, y, z, MODULE.width, 0.24, MODULE.depth, a, c, true);
      const T = [-Math.sin(a), Math.cos(a)],
        D = [Math.cos(a), Math.sin(a)],
        rail = rgb("#687e73");
      for (const side of [-1, 1]) {
        const tx = x + side * 2.15 * T[0],
          tz = z + side * 2.15 * T[1];
        box(tx, y + 1.12, tz, 0.09, 0.1, MODULE.depth, a, rail);
        for (const d of [-8.7, -3, 3, 8.7])
          box(tx + d * D[0], y + 0.24, tz + d * D[1], 0.07, 0.9, 0.07, a, rail);
      }
      box(x + 8.92 * D[0], y + 1.12, z + 8.92 * D[1], 4.32, 0.1, 0.09, a, rail);
      if (s.use === "garden") {
        for (const d of [-5.8, 0, 5.8])
          for (const side of [-1, 1]) {
            const tx = x + d * D[0] + side * 1.35 * T[0],
              tz = z + d * D[1] + side * 1.35 * T[1];
            box(tx, y + 0.25, tz, 1.2, 0.34, 4.1, a, rgb("#69875d"), true);
            box(tx, y + 0.59, tz, 0.95, 0.28, 3.7, a, rgb("#8bb276"));
          }
      } else {
        for (const d of [-5, 5]) {
          const tx = x + d * D[0] + 1.38 * T[0],
            tz = z + d * D[1] + 1.38 * T[1];
          box(tx, y + 0.24, tz, 0.55, 0.48, 2.6, a, rgb("#c6ae8b"), true);
        }
      }
    }

  // Roof access, public park and retail. The atrium glass is not a walking surface.
  if ((exporting || (!state.inspect && state.showRoofDeck && !state.xray)) && m.roofPlan) {
    const p = m.roofPlan,
      y = p.y,
      walk = rgb("#dedbd0"),
      green = rgb("#a3b79a"),
      rail = rgb("#75897b");
    mark("Roof_Public_Deck");
    sector(m.r, m.R, 0, TAU, y - 0.22, 0.22, green);
    mark("Roof_Public_Walking_Loop");
    sector(m.R - p.walk, m.R, 0, TAU, y + 0.01, 0.065, walk);
    for (const a of [m.circulation.bridgeAngle, m.circulation.bridgeAngle + Math.PI]) {
      const half = Math.min(0.2, 1.15 / Math.max(1, m.r));
      mark("Roof_Pedestrian_Links");
      sector(m.r, m.R - p.walk, a - half, a + half, y + 0.01, 0.066, walk);
    }
    mark("Roof_Railings");
    for (const radius of [m.r, m.R])
      for (let i = 0; i < 100; i++) {
        const a = (i * TAU) / 100,
          d = ((i + 1) * TAU) / 100;
        if (
          radius === m.r &&
          angDist((a + d) / 2, m.circulation.bridgeAngle) < 1.65 / Math.max(1, radius) + TAU / 100
        )
          continue;
        line(ringPoint(radius, a, y + 1.12), ringPoint(radius, d, y + 1.12), rail);
        if (i % 2 === 0) line(ringPoint(radius, a, y + 0.03), ringPoint(radius, a, y + 1.12), rail);
      }
    for (const q of p.lifts) {
      mark("Roof_Lift_Access_" + (q.block + 1));
      sector(q.r, q.R, q.start, q.end, y, q.accessHeight, rgb("#777a91"));
      mark("Roof_Lift_Service_" + (q.block + 1));
      sector(q.r, q.R, q.start, q.end, y + q.accessHeight, q.serviceHeight, rgb("#a5a4b4"));
      const a = q.end,
        rad = (q.r + q.R) / 2;
      quad(
        ringPoint(rad - 0.5, a + 0.001, y + 0.05),
        ringPoint(rad + 0.5, a + 0.001, y + 0.05),
        ringPoint(rad + 0.5, a + 0.001, y + 2.2),
        ringPoint(rad - 0.5, a + 0.001, y + 2.2),
        rgb("#d9dde6"),
      );
    }
    for (const [i, q] of p.pavilions.entries()) {
      mark("Roof_Commercial_Retail", `Pavilion ${i + 1}`);
      sector(q.r, q.R, q.start, q.end, y + 0.05, 3.0, rgb("#ad91c7"));
      const a = q.start + 0.16 * (q.end - q.start),
        d = q.end - 0.16 * (q.end - q.start),
        rad = q.R + 0.015;
      for (let j = 0; j < 12; j++)
        quad(
          ringPoint(rad, a + ((d - a) * j) / 12, y + 0.42),
          ringPoint(rad, a + ((d - a) * (j + 1)) / 12, y + 0.42),
          ringPoint(rad, a + ((d - a) * (j + 1)) / 12, y + 2.45),
          ringPoint(rad, a + ((d - a) * j) / 12, y + 2.45),
          rgb("#dfdce3"),
        );
    }
    for (const [i, q] of p.garden.entries()) {
      const a = (q.start + q.end) / 2,
        rad = (q.r + q.R) / 2,
        ww = Math.min(3.4, (q.end - q.start) * rad * 0.82),
        dd = Math.min(3.4, (q.R - q.r) * 0.7);
      if (ww < 0.5 || dd < 0.5) continue;
      const at = (r, a, h, w, ht, d, col) => box(r * Math.cos(a), h, r * Math.sin(a), w, ht, d, a, col, true);
      if (q.kind === "gazebo" && ww > 1.7 && dd > 1.7) {
        mark("Roof_Gazebos", `Gazebo ${i + 1}`);
        const x = rad * Math.cos(a),
          z = rad * Math.sin(a),
          T = [-Math.sin(a), Math.cos(a)],
          D = [Math.cos(a), Math.sin(a)];
        for (const u of [-1, 1])
          for (const v of [-1, 1])
            box(
              x + u * ww * 0.42 * T[0] + v * dd * 0.42 * D[0],
              y + 0.07,
              z + u * ww * 0.42 * T[1] + v * dd * 0.42 * D[1],
              0.13,
              2.35,
              0.13,
              a,
              rgb("#9d8b70"),
            );
        at(rad, a, y + 2.42, ww, 0.14, dd, rgb("#c1ae91"));
        at(rad, a, y + 0.08, Math.min(0.65, ww * 0.3), 0.45, Math.min(1.7, dd * 0.5), rgb("#cfbc9a"));
      } else {
        mark("Roof_Gardens", `Planter ${i + 1}`);
        at(rad, a, y + 0.065, ww, 0.35, dd, rgb("#8b9884"));
        at(rad, a, y + 0.415, ww * 0.86, 0.16, dd * 0.83, rgb("#719b63"));
        if (ww > 1.5 && dd > 1.5) {
          mark("Roof_Public_Seating", `Bench ${i + 1}`);
          at(rad, a + (q.end - q.start) * 0.51, y + 0.07, 0.46, 0.45, Math.min(2.1, dd), rgb("#c3a980"));
        }
      }
    }
  }
  // Opaque exterior envelope. Keep full-height entrance/slide portals and door-sized docking openings.
  // The wall is inside the gross footprint; X-ray and the facade toggle affect the view only.
  if (exporting || (state.showFacade && !state.xray))
    for (let f = 0; f < state.floors; f++) {
      if (!visible(f)) continue;
      const fullHeightHoles = [],
        doorHoles = [];
      if (m.lobby.area && f < m.lobby.levels) fullHeightHoles.push([m.lobby.angle, m.lobby.span / 2]);
      for (const s of m.slots)
        if (s.f === f && !s.blocked && (s.p !== EMPTY || s.use !== "empty"))
          doorHoles.push([s.angle, Math.min(0.45, 1.1 / m.R)]);
      for (const c of m.feature.slide?.connections || [])
        if (c.floor === f) fullHeightHoles.push([c.angle, Math.min(0.35, 1.45 / m.R)]);
      mark(`Facade_L${f + 1}`, `Solid exterior wall / L${f + 1}`);
      const y = f * floorH + 0.45,
        h = floorH - 0.23,
        doorH = 2.35,
        wall = rgb("#c9c8bf"),
        inner = m.R - facadeThickness(m),
        outer = m.R;
      for (const [a, b] of openArcs([...fullHeightHoles, ...doorHoles]))
        sector(inner, outer, a, b, y, doorH, wall);
      for (const [a, b] of openArcs(fullHeightHoles)) sector(inner, outer, a, b, y + doorH, h - doorH, wall);
    }

  // Full-height outdoor climbing wall. The reserved dock strip stays unoccupied.
  const climbing = m.feature.climbing;
  if (climbing) {
    const c = climbing,
      lo = c.angle - c.half,
      hi = c.angle + c.half,
      face = rgb("#baaa91"),
      holdColors = ["#ae6a59", "#537e94", "#d5ac56", "#81749c", "#719879"].map(rgb),
      rgen = random(state.seed ^ 0x6acd9b7);
    mark("Climbing_Ground_Approach");
    sector(m.R + 0.02, m.R + 3.8, lo, hi, -0.19, 0.19, rgb("#bfae9c"));
    for (let f = 0; f < state.floors && f * floorH < c.height; f++) {
      if (!visible(f)) continue;
      const y = f * floorH + 0.08,
        hgt = Math.min(floorH, c.height - y);
      if (hgt <= 0) continue;
      mark(`Climbing_L${f + 1}_Wall`);
      sector(m.R + 0.015, c.face, lo, hi, y, hgt, face);
      mark(`Climbing_L${f + 1}_Holds`);
      const rows = 7,
        cols = Math.max(1, Math.floor(c.width / 0.68));
      for (let j = 0; j < rows; j++)
        for (let k = 0; k < cols; k++) {
          const a = lo + ((hi - lo) * (k + 0.5 + (rgen() - 0.5) * 0.64)) / cols,
            rad = c.face + 0.045,
            h = y + 0.25 + j * 0.52 + rgen() * 0.18;
          if (h + 0.2 > y + hgt) continue;
          box(
            rad * Math.cos(a),
            h,
            rad * Math.sin(a),
            0.13 + rgen() * 0.13,
            0.1 + rgen() * 0.1,
            0.1,
            a,
            holdColors[(j + k * 2) % holdColors.length],
          );
        }
      mark(`Climbing_L${f + 1}_Route_Lines`);
      for (let k = 1; k < Math.max(2, Math.floor(c.width / 2.2)); k++) {
        const a = lo + ((hi - lo) * k) / Math.max(2, Math.floor(c.width / 2.2));
        line(
          ringPoint(c.face + 0.015, a, y + 0.08),
          ringPoint(c.face + 0.015, a, y + hgt - 0.03),
          rgb("#8b8276"),
        );
      }
    }
    if (exporting || !cut || cutY >= c.height) {
      mark("Climbing_Top_Anchors");
      for (let k = 0; k < Math.max(1, Math.floor(c.width / 2.2)); k++) {
        const a = lo + ((hi - lo) * (k + 0.5)) / Math.max(1, Math.floor(c.width / 2.2));
        box(
          (c.face + 0.04) * Math.cos(a),
          c.height - 0.2,
          (c.face + 0.04) * Math.sin(a),
          0.16,
          0.12,
          0.12,
          a,
          rgb("#776b60"),
        );
      }
    }
  }
  // Central swing tower, platform and glass annulus. Open-air deck (not enclosed area).
  const ride = m.feature.ride;
  if (cut) {
    mark("Swing_Tower");
    sector(0, ride.towerRadius, 0, TAU, 0, Math.min(cutY, ride.height), rgb("#c78b51"));
  }
  if (exporting || !state.inspect) {
    mark("Swing_Tower");
    const mast = rgb("#c78b51"),
      platform = rgb("#e4d6b7");
    sector(0, ride.towerRadius, 0, TAU, 0, ride.height, mast);
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      line(ringPoint(ride.towerRadius, a, 0), ringPoint(ride.towerRadius, a, ride.height), rgb("#9c704d"));
    }
    mark("Swing_Boarding_Platform");
    sector(ride.towerRadius, ride.platformRadius, 0, TAU, ride.roofLevel - 0.2, 0.36, platform);
    const bridge = (rr + ride.platformRadius) / 2,
      aBridge = m.circulation.bridgeAngle;
    box(
      bridge * Math.cos(aBridge),
      ride.roofLevel,
      bridge * Math.sin(aBridge),
      Math.min(2.4, m.circulation.width),
      0.25,
      rr - ride.platformRadius + 0.5,
      aBridge,
      platform,
      true,
    );
    sector(rr, Math.min(m.R, rr + 3), aBridge - 0.07, aBridge + 0.07, ride.roofLevel - 0.1, 0.18, platform);
    mark("Swing_Crown_and_Seats");
    const crown = ride.height - 7.5,
      crownR = 8.5;
    sector(ride.towerRadius, crownR, 0, TAU, crown, 0.7, rgb("#e2af61"));
    for (let i = 0; i < 18; i++) {
      const a = (i * TAU) / 18,
        seatY = crown - 10.5,
        rad = ride.flightRadius;
      for (const offset of [-0.3, 0.3])
        line(
          ringPoint(crownR - 0.3, a + offset / crownR, crown),
          ringPoint(rad, a + offset / rad, seatY),
          rgb("#856f59"),
        );
      box(rad * Math.cos(a), seatY - 0.35, rad * Math.sin(a), 0.95, 0.38, 1.1, a, rgb("#be866d"));
    }
    if (exporting || (state.roof && !state.xray)) {
      mark("Atrium_Glass_Roof");
      const roofc = rgb("#c4dfde"),
        frame = rgb("#9aada8"),
        roofY = H + 0.07,
        inner = ride.platformRadius;
      const n = 96;
      for (let i = 0; i < n; i++) {
        const a = (i * TAU) / n,
          d = ((i + 1) * TAU) / n;
        quad(
          ringPoint(inner, a, roofY),
          ringPoint(rr, a, roofY),
          ringPoint(rr, d, roofY),
          ringPoint(inner, d, roofY),
          roofc,
          glass,
          0.28,
        );
        line(ringPoint(rr, a, roofY + 0.01), ringPoint(rr, d, roofY + 0.01), frame);
        line(ringPoint(inner, a, roofY + 0.01), ringPoint(inner, d, roofY + 0.01), frame);
      }
      for (let i = 0; i < 24; i++) {
        const a = (i * TAU) / 24;
        line(ringPoint(inner, a, roofY + 0.035), ringPoint(rr, a, roofY + 0.035), frame);
      }
      for (const scale of [0.33, 0.66])
        for (let i = 0; i < n; i++)
          line(
            ringPoint(inner + (rr - inner) * scale, (i * TAU) / n, roofY + 0.035),
            ringPoint(inner + (rr - inner) * scale, ((i + 1) * TAU) / n, roofY + 0.035),
            frame,
          );
    }
  }
  // Swept tube, clipped to the top of the last visible storey. Full geometry remains exportable.
  const s = m.feature.slide;
  if (s) {
    mark("Infinite_Rinse_Water_Slide");
    const p = s.points,
      c = rgb("#287fa7"),
      n = 12;
    let prev = null;
    const clippedQuad = (vertices) => {
      if (!cut) {
        quad(...vertices, c);
        return;
      }
      const out = [];
      for (let j = 0; j < vertices.length; j++) {
        const a = vertices[j],
          b = vertices[(j + 1) % vertices.length],
          ain = a[1] <= cutY,
          bin = b[1] <= cutY;
        if (ain) out.push(a);
        if (ain !== bin) {
          const t = (cutY - a[1]) / (b[1] - a[1]);
          out.push(a.map((v, k) => v + t * (b[k] - v)));
        }
      }
      for (let j = 1; j + 1 < out.length; j++) tri(out[0], out[j], out[j + 1], c);
    };
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)],
        z = p[Math.min(p.length - 1, i + 1)],
        tangent = unit(sub(z, a)),
        side = unit(cross([0, 1, 0], tangent)),
        up = unit(cross(tangent, side)),
        ring = [];
      for (let j = 0; j < n; j++) {
        const theta = (j * TAU) / n;
        ring.push(
          p[i].map((v, k) => v + s.tubeRadius * (Math.cos(theta) * side[k] + Math.sin(theta) * up[k])),
        );
      }
      if (prev)
        for (let j = 0; j < n; j++) clippedQuad([prev[j], prev[(j + 1) % n], ring[(j + 1) % n], ring[j]]);
      prev = ring;
    }
  }

  // Conceptual users and animals: low-poly occupancy placeholders for scale and inclusivity.
  if (exporting && (state.showPeople || state.showAnimals)) {
    let rng = random((state.seed * 1664525 + 1013904223) >>> 0);
    const humanClothes = ["#7e97b8", "#c87f78", "#7fa888", "#b08bc1", "#c2a06f", "#7395a0"],
      humanHair = ["#6d5a49", "#4f443d", "#8a735d", "#473a31"],
      skins = ["#f0d1b5", "#d9b28b", "#b98562", "#8d5b3e"],
      groundY = 0.19;
    const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length],
      jitter = (n, s) => n + (rng() - 0.5) * s;
    function personStyle() {
      return {
        h: 1.46 + rng() * 0.46,
        w: 0.48 + rng() * 0.24,
        skin: pick(skins),
        cloth: pick(humanClothes),
        hair: pick(humanHair),
        stroll: (rng() - 0.5) * 0.8,
      };
    }
    function putPerson(x, y, z, a, wheel = false) {
      wheel
        ? lowPolyWheelchair(box, quad, tri, x, y, z, a, {
            h: 1.35 + rng() * 0.28,
            w: 0.62 + rng() * 0.12,
            skin: pick(skins),
            cloth: pick(humanClothes),
          })
        : lowPolyPerson(box, x, y, z, a, personStyle());
    }
    if (state.showPeople) {
      mark("Placeholders_People");
      if (m.plaza) {
        const p = m.plaza;
        for (let i = 0; i < 12; i++) {
          const theta = p.angle + (i % 2 ? -1 : 1) * (0.17 + 0.12 * Math.floor(i / 2)) * (p.span * 0.42),
            rad = p.mouth + 2.6 + (i % 3) * 4.7;
          putPerson(
            rad * Math.cos(theta),
            groundY,
            rad * Math.sin(theta),
            theta + Math.PI / 2,
            i === 2 || i === 9,
          );
        }
      }
      for (const q of [...m.circulation.regions, ...m.circulation.hubs]) {
        if (q.kind === "elevator" || !visible(q.f)) continue;
        const rad = (q.r + q.R) / 2,
          span = (q.end - q.start) * rad,
          depth = q.R - q.r;
        if (span < 1.5 || depth < 1.2) continue;
        const baseY = q.f * floorH + 0.54,
          count = span > 7 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const t = count === 1 ? 0.5 : (k + 0.3) / count,
            a = q.start + (q.end - q.start) * t;
          putPerson(
            rad * Math.cos(a),
            baseY,
            rad * Math.sin(a),
            a + (q.kind === "hub" ? 0 : Math.PI / 2),
            rng() < 0.11 && q.kind !== "hub",
          );
        }
      }
      if ((exporting || (!state.inspect && state.showRoofDeck && !state.xray)) && m.roofPlan) {
        const p = m.roofPlan,
          y = p.y + 0.07,
          walkR = m.R - p.walk * 0.52;
        for (let i = 0; i < 10; i++) {
          const a = (i * TAU) / 10 + 0.2;
          putPerson(walkR * Math.cos(a), y, walkR * Math.sin(a), a + Math.PI / 2, false);
        }
        for (const [i, q] of p.garden.entries()) {
          if (i > 7) break;
          const a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          putPerson(rad * Math.cos(a), y, rad * Math.sin(a), a + (rng() - 0.5), i % 5 === 0);
        }
      }
      for (let i = 0; i < 8; i++) {
        const a = -1.15 + i * 0.33,
          rad = m.R + MODULE.depth + 7 + (i % 2) * 3.2;
        putPerson(rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.4, i === 3);
      }
    }
    if (state.showAnimals) {
      rng = random((state.seed ^ 0x5f1bbcdc) >>> 0);
      mark("Placeholders_Animals");
      let indoorDogs = 0;
      for (const q of m.circulation.regions) {
        if (!visible(q.f) || q.kind === "elevator" || q.R - q.r < 1.4) continue;
        const rad = (q.r + q.R) / 2;
        if ((q.end - q.start) * rad < 5 || indoorDogs >= 5) continue;
        const a = q.start + (q.end - q.start) * 0.24;
        lowPolyDog(box, rad * Math.cos(a), q.f * floorH + 0.54, rad * Math.sin(a), a + Math.PI / 2, {
          s: 0.8 + rng() * 0.24,
          col: indoorDogs % 2 ? "#b79269" : "#9c8672",
        });
        indoorDogs++;
      }

      for (let i = 0; i < 4; i++) {
        const a = m.lobby.angle + (-0.36 + i * 0.24),
          rad = m.R + MODULE.depth + 3.8 + i * 0.7;
        lowPolyDog(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.6, {
          s: 0.82 + rng() * 0.2,
          col: i % 2 ? "#b79269" : "#9c8672",
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + 0.18,
          rad = m.R + MODULE.depth + 8.5 + (i % 2) * 2.4;
        lowPolyBird(box, rad * Math.cos(a), groundY + 0.02, rad * Math.sin(a), a + 0.9, {
          s: 0.85 + rng() * 0.25,
        });
      }
      if ((exporting || (!state.inspect && state.showRoofDeck && !state.xray)) && m.roofPlan) {
        const y = m.roofPlan.y + 0.07;
        for (let i = 0; i < 4 && i < m.roofPlan.garden.length; i++) {
          const q = m.roofPlan.garden[i],
            a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          lowPolyRabbit(box, rad * Math.cos(a), y, rad * Math.sin(a), a + 0.3, { s: 0.95 + rng() * 0.25 });
        }
        for (let i = 4; i < 8 && i < m.roofPlan.garden.length; i++) {
          const q = m.roofPlan.garden[i],
            a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          lowPolySquirrel(box, rad * Math.cos(a), y, rad * Math.sin(a), a - 0.2, { s: 0.95 + rng() * 0.25 });
        }
        for (let i = 0; i < 10; i++) {
          const a = (i * TAU) / 10 + 0.1,
            rad = m.R - 0.8;
          lowPolyBird(box, rad * Math.cos(a), y + 0.02, rad * Math.sin(a), a + 0.4, {
            s: 0.72 + rng() * 0.18,
          });
        }
      }
      for (let i = 0; i < 4; i++) {
        const a = 0.65 + i * 0.55,
          rad = m.R + MODULE.depth + 9.5;
        lowPolyRabbit(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.2, { s: 0.95 + rng() * 0.2 });
      }
      for (let i = 0; i < 4; i++) {
        const a = 2.3 + i * 0.47,
          rad = m.R + MODULE.depth + 8.7;
        lowPolySquirrel(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a - 0.3, {
          s: 0.9 + rng() * 0.18,
        });
      }
    }
  }

  return { solid, lines, glass, groups, H: cut ? state.inspect * floorH : ride.height, extent };
}
