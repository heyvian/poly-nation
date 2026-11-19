"use strict";
/**
 * 05-room-layout.js — the central ring ("core"): circulation and program rooms.
 * The core is an annulus (inner radius r, outer radius R) repeated on every floor. Positions are polar:
 * radius plus angle (radians). Circulation is carved out of the same floor plate, never added to it.
 */
// Returns the angular intervals of the full circle that remain after cutting out `holes` ([centre, half-width] pairs).
// SEEDED CORE ROOM GENERATOR. Each level has one or two independent annular bands.
// Consume exact gross program area budgets, with varied program-specific room sizes.
// Disjoint annular zones; circulation is carved from the same floor plate, never added to it.
function openArcs(holes) {
  const cuts = [];
  for (const [center, half] of holes) {
    if (half <= 1e-10) continue;
    const a = mod(center - half, TAU),
      b = a + 2 * half;
    cuts.push([a, Math.min(TAU, b)]);
    if (b > TAU) cuts.push([0, b - TAU]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let x = 0,
    out = [];
  for (const [a, b] of cuts) {
    if (a > x + 1e-9) out.push([x, a]);
    x = Math.max(x, b);
  }
  if (x < TAU - 1e-9) out.push([x, TAU]);
  return out;
}
// Plans corridors, lift blocks and links for every floor: an outer corridor, an optional inner one when the ring
// is wide enough, two lift blocks opposite each other and the entrance-lobby cut-out.
// Returns the circulation regions, per-floor room bands/arcs and the area left for rooms (roomCapacity).
function circulationPlan(r, R, lobby) {
  const width = R - r,
    cw = Math.min(state.corridorWidth, width * 0.38),
    dual = width >= 2 * cw + 8,
    outer = R - cw,
    mid = dual ? (r + outer) / 2 : 0,
    bands = dual
      ? [
          { r, R: mid - cw / 2 },
          { r: mid + cw / 2, R: outer },
        ]
      : [{ r, R: outer }];
  const axis = lobby.angle + Math.PI / 2,
    half = Math.min(0.3, Math.max(0.045, 4.1 / Math.max(4, r + width * 0.32))),
    liftR = Math.min(outer, r + Math.min(4.2, Math.max(0.01, (outer - r) * 0.75))),
    regions = [],
    floorPlans = [];
  const add = (f, kind, a, b, start, end, extra = {}) => {
    if (b - a < 1e-9 || end - start < 1e-9) return;
    regions.push({ f, kind, r: a, R: b, start, end, area: ((b * b - a * a) * (end - start)) / 2, ...extra });
  };
  for (let f = 0; f < state.floors; f++) {
    const lobbyHole = f < lobby.levels && lobby.area ? [[lobby.angle, lobby.span / 2]] : [],
      lifts = [
        [axis, half],
        [axis + Math.PI, half],
      ],
      arcs = openArcs([...lobbyHole, ...lifts]);
    for (const [a, b] of openArcs(lobbyHole)) add(f, "outer", outer, R, a, b);
    if (dual) for (const [a, b] of arcs) add(f, "inner", mid - cw / 2, mid + cw / 2, a, b);
    lifts.forEach(([a, h], i) => {
      add(f, "elevator", r, liftR, a - h, a, { block: i });
      add(f, "link", liftR, outer, a - h, a, { block: i });
      add(f, "link", r, outer, a, a + h, { block: i });
    });
    const area = bands.reduce(
      (s, b) => s + arcs.reduce((q, [a, z]) => q + ((b.R * b.R - b.r * b.r) * (z - a)) / 2, 0),
      0,
    );
    floorPlans.push({ arcs, bands, area });
  }
  return {
    width: cw,
    dual,
    axis,
    bridgeAngle: axis + half / 2,
    half,
    regions,
    floorPlans,
    roomCapacity: floorPlans.reduce((a, p) => a + p.area, 0),
    area: regions.reduce((a, p) => a + p.area, 0),
  };
}
// Angle on the ring where a clustered program is pulled to; clustered programs are spread evenly, offset by the seed.
// Variable sized rooms in the spaces left between corridors, lift blocks and the lobby.
function clusterAngle(id) {
  const n = state.cluster.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  return mod(
    ((state.seed % 360) * Math.PI) / 180 + (TAU * Math.max(0, n.indexOf(id))) / Math.max(1, n.length),
    TAU,
  );
}
// Weight multiplier that favours placing a clustered program's rooms near its cluster angle.
function clusterRoomBias(id, angle) {
  return id < 5 && state.cluster[id] ? Math.exp(5.8 * Math.cos(angle - clusterAngle(id))) : 1;
}
// Fills each floor/band with program rooms of varied size until every program's core area is used.
// Steps: (1) split each program's area into per-floor quotas, (2) place rooms arc by arc, choosing programs
// by attraction/repulsion to neighbours, (3) group clustered programs, (4) merge undersized rooms,
// (5) carve shared lobbies between attracted neighbours, (6) record doors.
// Returns { rooms, layers, bandN, circulation }.
function roomLayout(areas, r, R, floors, lobby, circulation) {
  const rng = random(state.seed ^ 0x719ae321),
    leftAll = areas.slice(),
    rooms = [],
    layers = [],
    bandN = circulation.dual ? 2 : 1,
    strength = state.affinity / 100,
    mix = state.mix / 100;
  const pick = (w) => {
    let x = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) {
      x -= w[i];
      if (x < 0) return i;
    }
    return w.findLastIndex((v) => v > 0);
  };
  for (let f = 0; f < floors; f++) {
    const plan = circulation.floorPlans[f],
      remaining = leftAll.slice(),
      sum = remaining.reduce((a, b) => a + b, 0);
    // Allocate floor quotas with stable random variation, keeping the global area exact.
    if (f < floors - 1) {
      remaining.fill(0);
      const weights = leftAll.map((x) => x * (0.72 + 0.56 * rng()));
      let need = plan.area;
      for (let pass = 0; pass < 12 && need > 1e-8; pass++) {
        const w = weights.map((x, i) => (leftAll[i] - remaining[i] > 1e-8 ? x : 0)),
          total = w.reduce((a, b) => a + b, 0);
        if (!total) break;
        const d = need;
        for (let i = 0; i < w.length; i++) {
          const n = Math.min(leftAll[i] - remaining[i], (d * w[i]) / total);
          remaining[i] += n;
          need -= n;
        }
      }
    }
    for (let i = 0; i < leftAll.length; i++) leftAll[i] = Math.max(0, leftAll[i] - remaining[i]);
    layers[f] = [];
    for (let band = 0; band < bandN; band++) {
      const { r: a, R: b } = plan.bands[band],
        scale = (b * b - a * a) / 2,
        list = [];
      for (const [start, end] of plan.arcs) {
        const cap = (end - start) * scale;
        let used = 0,
          prev = -1;
        while (cap - used > 1e-7) {
          const space = cap - used,
            angle = start + used / scale,
            near = [];
          if (prev >= 0) near.push(prev);
          if (band > 0) near.push(roomAt(layers[f][band - 1], angle));
          if (f > 0) near.push(roomAt(layers[f - 1][band], angle));
          const weights = remaining.map((left, id) => {
            if (left < 1e-8) return 0;
            const feasible = Math.min(space, left) >= roomRange(id)[0] ? 1 : 0.045;
            let penalty = 0;
            for (const other of near)
              penalty += strength * 3.2 * relationCost(id, other) + (id === other ? mix * 3.8 : 0);
            return (
              Math.sqrt(left / roomRange(id)[1]) *
              feasible *
              Math.exp(-penalty / Math.max(1, near.length)) *
              clusterRoomBias(id, angle + Math.min(space, roomRange(id)[1]) / (2 * scale))
            );
          });
          let id = pick(weights);
          if (id < 0) {
            if (space < 0.001) break;
            id = UNUSED;
          }
          const [lo, hi] = roomRange(id);
          let area =
            id === UNUSED && remaining[id] < 1e-8
              ? space
              : Math.min(lo + (hi - lo) * Math.pow(rng(), 1.7), remaining[id], space);
          if (remaining[id] - area > 0 && remaining[id] - area < lo * 0.65 && remaining[id] <= space)
            area = remaining[id];
          if (space - area > 0 && space - area < lo * 0.55 && remaining[id] >= space) area = space;
          if (area < 1e-10) break;
          const s = start + used / scale;
          used += area;
          remaining[id] = Math.max(0, remaining[id] - area);
          const room = { id, f, band, r: a, R: b, start: s, end: start + used / scale, area };
          list.push(room);
          rooms.push(room);
          prev = id;
        }
      }
      layers[f][band] = list;
    }
  }
  // Group selected programs in contiguous angular runs within each available arc.
  if (state.cluster.some(Boolean))
    for (const layer of layers)
      for (const list of layer) {
        for (let start = 0; start < list.length;) {
          let end = start + 1;
          while (end < list.length && Math.abs(list[end - 1].end - list[end].start) < 1e-7) end++;
          const block = list.slice(start, end),
            lo = block[0].start,
            hi = block.at(-1).end,
            mid = (lo + hi) / 2,
            scale = (block[0].R ** 2 - block[0].r ** 2) / 2;
          const locked = block.filter((q) => q.id < 5 && state.cluster[q.id]),
            rest = block.filter((q) => q.id >= 5 || !state.cluster[q.id]);
          if (locked.length) {
            const order = [...new Set(locked.map((q) => q.id))].sort(
              (a, b) =>
                Math.atan2(Math.sin(clusterAngle(a) - mid), Math.cos(clusterAngle(a) - mid)) -
                Math.atan2(Math.sin(clusterAngle(b) - mid), Math.cos(clusterAngle(b) - mid)),
            );
            let packed = [],
              free = rest.slice();
            for (const id of order) {
              const wanted = mod(clusterAngle(id) - lo, TAU);
              let pos =
                wanted > hi - lo
                  ? Math.max(
                      0,
                      Math.min(
                        hi - lo,
                        Math.atan2(Math.sin(clusterAngle(id) - mid), Math.cos(clusterAngle(id) - mid)) +
                          (hi - lo) / 2,
                      ),
                    )
                  : wanted;
              let before = lo + packed.reduce((s, q) => s + q.area / scale, 0);
              while (free.length && before + free[0].area / (2 * scale) < lo + pos) {
                const q = free.shift();
                packed.push(q);
                before += q.area / scale;
              }
              packed.push(...locked.filter((q) => q.id === id));
            }
            packed.push(...free);
            let a = lo;
            for (const q of packed) {
              q.start = a;
              q.end = a + q.area / scale;
              a = q.end;
            }
            list.splice(start, block.length, ...packed);
          }
          start = end;
        }
      }
  // Eliminate undersized residual rooms before carving hubs or routing the slide.
  // Adjacent rooms share identical radii; merging conserves the partition exactly.
  // Prefer matching programs. An isolated small sector becomes an open circulation alcove.
  let merged = 0,
    alcoves = 0,
    alcoveArea = 0;
  for (const layer of layers)
    for (const list of layer) {
      for (let i = 0; i < list.length;) {
        const q = list[i];
        if (q.area >= state.minRoomArea - 1e-7) {
          i++;
          continue;
        }
        const candidates = [];
        if (i > 0 && Math.abs(list[i - 1].end - q.start) < 1e-7) candidates.push(i - 1);
        if (i + 1 < list.length && Math.abs(q.end - list[i + 1].start) < 1e-7) candidates.push(i + 1);
        if (candidates.length) {
          candidates.sort(
            (a, b) => +(list[b].id === q.id) - +(list[a].id === q.id) || list[b].area - list[a].area,
          );
          const j = candidates[0],
            t = list[j];
          // If both pieces are small, retain the larger piece's program.
          if (t.area < state.minRoomArea && q.area > t.area) t.id = q.id;
          t.start = Math.min(t.start, q.start);
          t.end = Math.max(t.end, q.end);
          t.area = ((t.R * t.R - t.r * t.r) * (t.end - t.start)) / 2;
          list.splice(i, 1);
          merged++;
          i = Math.max(0, Math.min(i, j) - 1);
        } else {
          circulation.regions.push({ ...q, kind: "residual" });
          circulation.area += q.area;
          alcoveArea += q.area;
          alcoves++;
          list.splice(i, 1);
        }
      }
    }
  rooms.length = 0;
  for (const layer of layers) for (const list of layer) rooms.push(...list);
  circulation.roomPacking = { minimum: state.minRoomArea, merged, alcoves, alcoveArea };
  // Carve common entrance lobbies from two attracted neighbors. Both rooms open into the shared space;
  // repelling/neutral pairs retain separate doors off their common corridor (no direct inter-room opening).
  const hubs = [];
  for (const layer of layers)
    for (const list of layer) {
      const pairs = [];
      for (let j = 0; j < list.length; j++) {
        const a = list[j],
          b = list[(j + 1) % list.length];
        if (
          a === b ||
          a.id === b.id ||
          a.id >= 5 ||
          b.id >= 5 ||
          angDist(a.end, b.start) > 1e-7 ||
          relationMode(a.id, b.id) !== "attract"
        )
          continue;
        const weight = strength * relationMagnitude(a.id, b.id);
        if (weight <= 0.055) continue;
        pairs.push({ a, b, weight });
      }
      for (const { a, b, weight } of pairs) {
        const scale = (a.R * a.R - a.r * a.r) / 2,
          boundary = a.end;
        const preferredWidth = 4.3 + 5.1 * weight,
          target = Math.min(110, (scale * preferredWidth) / a.R);
        const left = Math.min(target / 2, a.area * 0.35, Math.max(0, a.area - state.minRoomArea)),
          right = Math.min(target / 2, b.area * 0.35, Math.max(0, b.area - state.minRoomArea)),
          clearWidth = ((left + right) * a.R) / scale;
        if (clearWidth < 2.0 || (Math.min(left, right) * a.R) / scale < 0.6) continue;
        a.end -= left / scale;
        b.start += right / scale;
        a.area -= left;
        b.area -= right;
        hubs.push({
          kind: "hub",
          f: a.f,
          band: a.band,
          r: a.r,
          R: a.R,
          start: boundary - left / scale,
          end: boundary + right / scale,
          area: left + right,
          clearWidth,
          pair: [a.id, b.id],
          strength: weight,
        });
      }
    }
  const hubArea = hubs.reduce((s, x) => s + x.area, 0),
    elevatorArea = circulation.regions.filter((q) => q.kind === "elevator").reduce((s, q) => s + q.area, 0);
  circulation.hubs = hubs;
  circulation.hubArea = hubArea;
  circulation.elevatorArea = elevatorArea;
  circulation.corridorArea = circulation.area - elevatorArea;
  circulation.total = circulation.area + hubArea;
  // Program door records used in both visualization and portable JSON.
  circulation.doors = [];
  for (const room of rooms) {
    if (room.area <= 0.001) continue;
    circulation.doors.push({
      f: room.f,
      program: room.id,
      angle: (room.start + room.end) / 2,
      r: room.R,
      width: Math.min(1.2, (room.end - room.start) * room.R * 0.68),
      kind: "corridor",
    });
  }
  for (const hub of hubs) {
    const edgeR = hub.R - Math.min(0.8, (hub.R - hub.r) * 0.25);
    circulation.doors.push(
      { f: hub.f, program: hub.pair[0], angle: hub.start, r: edgeR, kind: "shared", pair: hub.pair },
      { f: hub.f, program: hub.pair[1], angle: hub.end, r: edgeR, kind: "shared", pair: hub.pair },
    );
  }
  return { rooms, layers, bandN, circulation };
}
// Program id of the room covering `angle` in one band; UNUSED if none.
function roomAt(rooms, angle) {
  for (const s of rooms) {
    if (mod(angle - s.start, TAU) < s.end - s.start + 1e-8) return s.id;
  }
  return UNUSED;
}
// Labels every empty module slot as empty / balcony / garden / retail according to the vacancy shares
// (retail count is fixed first; the rest is shuffled with the seed). Returns the count per use.
function assignVacancies(slots, retailCount) {
  const vacant = slots.filter((s) => !s.blocked && s.p === EMPTY),
    weights = state.vacancy.slice(0, 3),
    counts = apportion(weights.some(Boolean) ? weights : [1, 0, 0], vacant.length - retailCount).concat(
      retailCount,
    ),
    labels = [];
  counts.forEach((n, i) => {
    for (let j = 0; j < n; j++) labels.push(i);
  });
  const rng = random(state.seed ^ 0x31beb263);
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  vacant.forEach((s, i) => (s.use = VACANCY[labels[i]].id));
  return counts;
}

