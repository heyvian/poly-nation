"use strict";
/**
 * 07-derive.js — turns the settings into a complete building model.
 * derive() is the main calculation: it solves the core size, module inventory, room layout, features and
 * module placement so the total enclosed area fits the area cap (20,000 m² by default).
 */
// BASE_TARGET: sum of all program goals. MIN_COURT_RADIUS: smallest allowed central greenhouse/court radius (m).
// Allocate an integer module inventory without exceeding any program goal.
const BASE_TARGET = PROGRAMS.reduce((sum, p) => sum + p.goal, 0),
  MIN_COURT_RADIUS = 3;
// Program area goals after subtracting retail modules (k), lobby (l) and roof (roof) from the area cap, scaled pro rata.
function goalsForRetail(k, l = 0, roof = 0) {
  return PROGRAMS.map(
    (p) => (p.goal * Math.max(0, state.areaCap - k * MODULE.area - l - roof)) / BASE_TARGET,
  );
}
// How many 81 m² modules each program gets: bounded by its modular share and capacity, then handed out one by one to the program furthest below its share.
function inventory(request, goals = goalsForRetail(0)) {
  const weights = goals.map((g, i) => (g * (100 - state.split[i])) / 100);
  const caps = goals.map((g, i) =>
    weights[i] > 0
      ? Math.max(0, Math.floor((g - (i === 0 ? Math.PI * MIN_COURT_RADIUS ** 2 : 0)) / MODULE.area))
      : 0,
  );
  const count = Math.min(
      request,
      caps.reduce((a, b) => a + b, 0),
    ),
    counts = caps.map(() => 0),
    sum = weights.reduce((a, b) => a + b, 0);
  // Largest deficit allocation, with hard capacity caps and stable tie breaking.
  for (let k = 0; k < count; k++) {
    let best = -1,
      score = -Infinity;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= caps[i]) continue;
      const d = (count * weights[i]) / sum - counts[i];
      if (d > score) {
        score = d;
        best = i;
      }
    }
    if (best < 0) break;
    counts[best]++;
  }
  return counts;
}
// Number of module docking slots around a ring of outer radius R.
function slotCapacity(R) {
  return Math.max(1, Math.floor(TAU / (2 * Math.atan((MODULE.width + 0.9) / (2 * (R + 0.65))))));
}
// Solves the ring's outer/inner radius so that all floors together use the core area, keeping the preferred ring width where possible.
function autoGeometry(coreTotal, rinseCore) {
  const f = state.floors,
    area = coreTotal / Math.PI;
  // Preserve the preferred ring width where possible. Bound courtyard size by the remaining Infinite Rinse budget.
  const maxRinseRadius = Math.min(Math.sqrt(rinseCore / Math.PI), Math.sqrt(area));
  const RforCourt = (r) => Math.sqrt((area + (f - 1) * r * r) / f);
  const minWidth = Math.max(0.01, RforCourt(maxRinseRadius) - maxRinseRadius),
    maxWidth = RforCourt(MIN_COURT_RADIUS) - MIN_COURT_RADIUS;
  const width = clamp(state.ringWidth, minWidth, maxWidth);
  const R = -(f - 1) * width + Math.sqrt(f * (f - 1) * width * width + area),
    r = R - width;
  return { R, r, width };
}
// Main model solver. Returns the full model object (geometry, areas, rooms, slots, features, score).
// Inner function candidate(n, k) tries n program modules plus k retail modules; the loops below lower n until a
// feasible candidate exists, then raise retail as far as the vacancy share and cap allow.
function derive() {
  const sum = (a) => a.reduce((x, y) => x + y, 0),
    retailWant = (n) => apportion(state.vacancy, Math.max(0, n))[3];
  let manualClamped = false,
    manual = null;
  if (!state.autoCore) {
    let R = Math.sqrt(state.footprint / Math.PI),
      width = clamp(state.ringWidth, 0.01, R - MIN_COURT_RADIUS),
      r = R - width;
    const A = Math.PI * (state.floors * (R * R - r * r) + r * r);
    if (A > state.areaCap - 600) {
      const scale = Math.sqrt((state.areaCap - 600) / A);
      R *= scale;
      r *= scale;
      width *= scale;
      manualClamped = true;
    }
    manual = { R, r, width };
  }
  function candidate(n, k, full = false) {
    const levels = Math.min(2, state.floors),
      angle = -0.84;
    let l = state.lobby,
      geom,
      goals,
      counts,
      count,
      required,
      A,
      ringPer,
      roofBudget = 220,
      roofPlan,
      circulation,
      lobby;
    // The ground lobby is new enclosed area, its upper-level void is not. Solve gross annulus with void allowance.
    for (let pass = 0; pass < 40; pass++) {
      goals = goalsForRetail(k, l, roofBudget);
      counts = inventory(n, goals);
      count = sum(counts);
      required = goals.map((a, i) => a - counts[i] * MODULE.area);
      A = state.areaCap - (count + k) * MODULE.area - roofBudget + (levels - 1) * l;
      if (required[0] < Math.PI * MIN_COURT_RADIUS ** 2 - 1e-7 || A < Math.PI * MIN_COURT_RADIUS ** 2 + 0.01)
        return null;
      geom = manual || autoGeometry(A, required[0]);
      ringPer = Math.PI * (geom.R * geom.R - geom.r * geom.r);
      const allowed = Math.max(
        0,
        Math.min(state.lobby, ringPer * 0.38, ((A - Math.PI * geom.r * geom.r) / levels) * 0.95),
      );
      if (l > allowed + 1e-6) {
        l = allowed * 0.999;
        continue;
      }
      lobby = {
        area: l,
        voidArea: l * (levels - 1),
        volume: l * levels * 4.2,
        levels,
        angle,
        span: ringPer ? (TAU * l) / ringPer : 0,
        blocked: new Set(),
      };
      circulation = circulationPlan(geom.r, geom.R, lobby);
      roofPlan = designRoof(geom.R, geom.r, circulation);
      const need = roofPlan.area + 0.00002;
      if (Math.abs(need - roofBudget) < 0.000005) break;
      roofBudget = need;
      if (pass === 39) return null;
    }
    const { R, r, width } = geom,
      court = Math.PI * r * r,
      ringArea = ringPer * state.floors - (levels - 1) * l,
      programRing = ringArea - l,
      slotN = slotCapacity(R),
      rawMax = slotN * state.floors;
    if (
      !roofPlan ||
      count + k > rawMax ||
      ringArea + court + (count + k) * MODULE.area + roofPlan.area > state.areaCap + 1e-6 ||
      programRing < 0
    )
      return null;
    if (l > 0)
      for (let f = 0; f < levels; f++)
        for (let j = 0; j < slotN; j++)
          if (
            angDist((j * TAU) / slotN, angle) <=
            lobby.span / 2 + Math.atan((MODULE.width / 2 + 0.5) / (R + 0.65))
          )
            lobby.blocked.add(f * slotN + j);
    const available = Math.max(0, circulation.roomCapacity),
      ringDesired = required.map((a, i) => Math.max(0, a - (i === 0 ? court : 0))),
      wanted = sum(ringDesired),
      factor = wanted ? Math.min(1, available / wanted) : 0,
      ring = ringDesired.map((x) => x * factor);
    ring.push(Math.max(0, available - sum(ring)));
    const layout = roomLayout(ring, r, R, state.floors, lobby, circulation);
    const feature = designRideAndSlide(layout, R, r, slotN, lobby);
    feature.ride.roofLevel = roofPlan.y + 0.065;
    connectSlide(layout, feature, R, slotN);
    const actualRing = P.map((p, i) => sum(layout.rooms.filter((q) => q.id === i).map((q) => q.area))),
      core = actualRing.slice();
    core[0] += court;
    const adjusted = goals.map((g, i) => g - (ring[i] - actualRing[i]) - (ringDesired[i] - ring[i]));
    const result = {
      R,
      r,
      width,
      ringPer,
      court,
      ringArea,
      programRing: sum(actualRing),
      core,
      ring: actualRing,
      counts,
      slotN,
      rawMax,
      count,
      required,
      goals: adjusted,
      k,
      lobby,
      circulation,
      roofPlan,
    };
    const blocked = new Set([...feature.blocked, ...lobby.blocked, ...(feature.climbing?.blocked || [])]),
      max = rawMax - blocked.size;
    if (count + k > max) return null;
    return { ...result, ...layout, feature, blocked, max };
  }
  let best = null;
  for (let n = Math.min(state.modules, Math.floor(state.areaCap / MODULE.area)); n >= 0; n--) {
    best = candidate(n, 0, true);
    if (best) break;
  }
  if (!best) throw Error("No feasible core geometry");
  const base = best,
    upper = Math.min(
      retailWant(base.max - base.count),
      Math.max(
        0,
        Math.floor(
          (state.areaCap - base.count * MODULE.area - Math.PI * MIN_COURT_RADIUS ** 2 - 0.1) / MODULE.area,
        ),
      ),
    );
  for (let k = upper; k > 0; k--) {
    const c = candidate(base.count, k, true);
    if (c && c.count === base.count && k <= retailWant(c.max - c.count)) {
      best = c;
      break;
    }
  }
  const {
    R,
    r,
    width,
    ringPer,
    court,
    ringArea,
    programRing,
    core,
    ring,
    counts,
    slotN,
    max,
    count,
    required,
    goals,
    rooms,
    layers,
    bandN,
    feature,
    k,
    lobby,
    blocked,
    circulation,
    roofPlan,
  } = best;
  // Build one docking slot per angle per floor, then let the topology solver place modules into the free slots.
  const slots = [];
  for (let f = 0; f < state.floors; f++)
    for (let j = 0; j < slotN; j++) {
      const i = f * slotN + j,
        angle = (j * TAU) / slotN;
      slots.push({
        i,
        f,
        j,
        angle,
        anchor: roomAt(layers[f][bandN - 1], angle),
        p: EMPTY,
        blocked: blocked.has(i),
        use: blocked.has(i) ? "blocked" : null,
      });
    }
  const activeSlots = slots.filter((s) => !s.blocked);
  counts.push(0);
  const { placement, score } = place(activeSlots, slotN, counts, rooms);
  activeSlots.forEach((s, i) => (s.p = placement[i]));
  const vacancyCounts = assignVacancies(activeSlots, k),
    retail = vacancyCounts[3] * MODULE.area,
    outdoor = (vacancyCounts[1] + vacancyCounts[2]) * MODULE.area,
    primary = ringArea + court + count * MODULE.area + roofPlan.serviceArea,
    total = primary + retail + roofPlan.retailArea;
  const plaza = lobby.area ? designPlaza(R, lobby) : null;
  return {
    R,
    r,
    width,
    ringPer,
    court,
    ringArea,
    programRing,
    core,
    ring,
    counts,
    rooms,
    layers,
    bandN,
    slots,
    slotN,
    max,
    count,
    total,
    primary,
    retail,
    outdoor,
    vacancyCounts,
    score,
    required,
    goals,
    retailRequested: retailWant(max - count),
    manualClamped,
    feature,
    lobby,
    blocked,
    circulation,
    plaza,
    roofPlan,
  };
}

// Entrance forecourt: the existing approach widens only beyond the outermost docking tips.
function designPlaza(R, lobby) {
  const mouth = R + MODULE.depth + 2,
    outer = mouth + 15,
    span = Math.max(lobby.span, Math.min(0.95, 32 / mouth));
  return {
    angle: lobby.angle,
    approachSpan: lobby.span,
    inner: R,
    mouth,
    outer,
    span,
    extension: 15,
    area: 0.5 * ((mouth * mouth - R * R) * lobby.span + (outer * outer - mouth * mouth) * span),
  };
}
// SEEDED TOPOLOGY SOLVER — fixed inventory; swap labels including vacancies; local pair energy.
function place(slots, n, counts, rooms = []) {
  const N = slots.length,
    rng = random(state.seed),
    a = Array(N).fill(EMPTY),
    locked = new Set(),
    centers = Array(5).fill(null);
  for (let id = 0; id < 5; id++)
    if (state.cluster[id]) {
      const own = rooms.filter((q) => q.id === id);
      let x = 0,
        z = 0;
      for (const q of own) {
        const ang = (q.start + q.end) / 2;
        x += Math.cos(ang) * q.area;
        z += Math.sin(ang) * q.area;
      }
      centers[id] = Math.hypot(x, z) > 1e-7 ? mod(Math.atan2(z, x), TAU) : clusterAngle(id);
    }
  const active = state.cluster
    .map((v, i) => (v ? i : -1))
    .filter((i) => i >= 0)
    .sort((i, j) => counts[j] - counts[i]);
  // Reserve a dense vertical facade cluster around the actual area-weighted angular centroid.
  // Nearest relevant rooms per level and matching adjacent anchors improve direct cores-to-pods alignment.
  for (const id of active) {
    const own = rooms.filter((q) => q.id === id),
      base = centers[id],
      rank = slots
        .map((s, i) => {
          const same = own.filter((q) => q.f === s.f);
          const angular = angDist(s.angle, base),
            local = same.length
              ? Math.min(
                  ...same.map((q) =>
                    Math.max(0, angDist(s.angle, (q.start + q.end) / 2) - (q.end - q.start) / 2),
                  ),
                )
              : 0.85;
          const score = angular * 5 + local * 3 + (s.anchor === id ? -2.5 : 0) + s.f * 0.015;
          return { i, score };
        })
        .filter((q) => !locked.has(q.i))
        .sort((a, b) => a.score - b.score || a.i - b.i);
    for (const q of rank.slice(0, counts[id])) {
      a[q.i] = id;
      locked.add(q.i);
    }
  }
  const free = slots.map((_, i) => i).filter((i) => !locked.has(i)),
    labels = [];
  counts.forEach((c, i) => {
    if (!state.cluster[i]) for (let j = 0; j < c; j++) labels.push(i);
  });
  while (labels.length < free.length) labels.push(EMPTY);
  for (let i = labels.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  free.forEach((i, j) => (a[i] = labels[j]));
  const strength = state.affinity / 100,
    dist = Array.from({ length: 5 }, (_, i) => Array.from({ length: 5 }, (_, j) => relationCost(i, j)));
  const edges = [],
    adj = Array.from({ length: N }, () => []);
  const gridToLocal = new Map(slots.map((s, i) => [s.i, i]));
  // Registers an interaction between slots i and j with weight w (used by the energy function).
  function edge(i, j, w) {
    if (i === j || i == null || j == null) return;
    const k = edges.length;
    edges.push({ i, j, w });
    adj[i].push(k);
    adj[j].push(k);
  }
  for (let i = 0; i < N; i++) {
    const { f, j } = slots[i];
    if (n > 1 && (n > 2 || j === 0)) edge(i, gridToLocal.get(f * n + ((j + 1) % n)), 1);
    if (f + 1 < state.floors) edge(i, gridToLocal.get((f + 1) * n + j), 0.8);
  }
  // Cost of putting program x next to program y (from relationCost).
  function pair(x, y) {
    if (x === EMPTY && y === EMPTY) return 0;
    if (x === EMPTY || y === EMPTY) return 0.16;
    if (x === UNUSED || y === UNUSED) return 0.25;
    return dist[x][y];
  }
  // Cost of putting a program at a slot, based on the core room it faces.
  function anchor(i) {
    const x = a[i],
      y = slots[i].anchor;
    if (x === EMPTY || x === UNUSED || y === UNUSED) return 0;
    return (
      0.9 * dist[x][y] * strength +
      (state.cluster[x] ? 5.4 * (1 - Math.cos(slots[i].angle - centers[x])) + (x === y ? -4 : 0) : 0)
    );
  }
  // Total cost of all interactions touching slot k.
  function edgeCost(k) {
    const e = edges[k];
    const x = a[e.i],
      y = a[e.j];
    return (pair(x, y) * strength + (x === y && x >= 0 && x < 5 && state.cluster[x] ? -3.6 : 0)) * e.w;
  }
  // Cost contribution of swapping slots i and j.
  function local(i, j) {
    let sum = anchor(i) + anchor(j);
    for (const k of adj[i]) sum += edgeCost(k);
    for (const k of adj[j]) if (!adj[i].includes(k)) sum += edgeCost(k);
    return sum;
  }
  if ((strength > 0 || state.cluster.some(Boolean)) && free.length > 1) {
    const steps = Math.min(22000, Math.max(2400, N * 48));
    for (let t = 0; t < steps; t++) {
      const i = free[Math.floor(rng() * free.length)],
        j = free[Math.floor(rng() * free.length)];
      if (a[i] === a[j]) continue;
      const before = local(i, j);
      [a[i], a[j]] = [a[j], a[i]];
      const change = local(i, j) - before,
        temp = 0.23 * (1 - t / steps) + 0.007;
      if (change > 0 && rng() > Math.exp(-change / temp)) [a[i], a[j]] = [a[j], a[i]];
    }
  }
  let score = edges.reduce((s, e, i) => s + edgeCost(i), 0) + slots.reduce((s, _, i) => s + anchor(i), 0);
  return { placement: a, score: score / Math.max(1, N) };
}
