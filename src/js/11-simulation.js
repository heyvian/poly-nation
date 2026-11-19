"use strict";
/**
 * 11-simulation.js — visitor and animal movement simulation.
 * Builds a navigation graph from the circulation spaces, creates simulated visitors/animals, and moves them
 * along routes. This only supplies movement; scoring is in 12-cross-pollination.js.
 */
// Current simulation (graph + agents + score + clock); null until the first model exists.
// Occupancy simulation: conceptual navigation graph derived from actual circulation sectors.
// Navigation and display are separate from area / geometry generation.
let occupancy = null,
  simLast = 0,
  simDrawLast = 0;
// Builds the walkable graph: nodes (rooms, lobbies, plaza, modules, roof, ride, climbing...) and edges (corridors,
// lifts, slide, climbing). Rooms are terminal nodes; routes between rooms go through corridors or shared lobbies.
function buildNavigation(m) {
  const nodes = [],
    edges = [],
    cells = [],
    dest = [],
    liftNodes = [[], []],
    outdoor = [],
    roofWild = [],
    floorH = 4.2,
    roofLevel = state.floors,
    yFor = (f) => (f === roofLevel ? m.roofPlan.y + 0.082 : f * floorH + 0.54);
  const xyz = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
  // Adds a graph node of a kind at position p.
  function node(p, kind, meta = {}) {
    const id = nodes.length;
    nodes.push({ id, p, kind, ...meta });
    edges.push([]);
    return id;
  }
  // Adds a two-way edge between nodes a and b.
  function connect(a, b, points = null, kind = "walk") {
    if (a === b || a == null || b == null) return;
    const path = points || [nodes[a].p, nodes[b].p],
      len = path.slice(1).reduce((s, p, i) => s + Math.hypot(...sub(p, path[i])), 0);
    if (len < 1e-6) return;
    edges[a].push({ to: b, path, len, kind });
    edges[b].push({ to: a, path: [...path].reverse(), len, kind });
  }
  // Adds a node for a ring sector (room, corridor, hub...).
  function addCell(q, kind, split = false) {
    if (q.R - q.r < 0.18 || q.end - q.start < 1e-7) return [];
    const n = split ? Math.max(1, Math.ceil(((q.end - q.start) * (q.r + q.R)) / 2 / 4.5)) : 1,
      ids = [];
    for (let i = 0; i < n; i++) {
      const a = q.start + ((q.end - q.start) * i) / n,
        b = q.start + ((q.end - q.start) * (i + 1)) / n,
        c = { ...q, start: a, end: b, kind },
        rad = (c.r + c.R) / 2,
        ang = (a + b) / 2;
      const id = node(xyz(rad, ang, yFor(c.f)), kind, { f: c.f, program: c.id, pair: c.pair, cell: c });
      c.node = id;
      cells.push(c);
      ids.push(id);
    }
    return ids;
  }
  for (const q of m.circulation.regions) {
    const kind = q.kind === "elevator" ? "lift" : "corridor",
      ids = addCell(q, kind, kind === "corridor");
    if (kind === "lift" && ids.length) liftNodes[q.block].push({ f: q.f, id: ids[0] });
  }
  for (const q of m.circulation.hubs) {
    const ids = addCell(q, "hub");
    dest.push(...ids);
  }
  for (const q of m.rooms) {
    if (q.id >= 5) continue;
    const ids = addCell(q, "room");
    dest.push(...ids);
  }
  const l = m.lobby;
  let lobby = null,
    entry = null;
  if (l.area) {
    lobby = addCell(
      { f: 0, r: m.r, R: m.R, start: l.angle - l.span / 2, end: l.angle + l.span / 2 },
      "lobby",
    )[0];
    if (lobby != null) dest.push(lobby);
  }
  // Open atrium perimeter and the visible greenhouse promenade, kept away from the mast.
  const atriumR = Math.max(0.3, m.r - 0.6),
    atriumIds = addCell(
      { f: 0, r: Math.max(0.1, m.r - 1.25), R: m.r, start: 0, end: TAU },
      "greenhouse",
      true,
    );
  dest.push(...atriumIds.filter((_, i) => i % 4 === 0));
  // Roof walking loop; only direct lift/bridge access zones join the interior roof.
  const roof = m.roofPlan,
    walk = roof.walk;
  const roofLoop = addCell({ f: roofLevel, r: m.R - walk, R: m.R, start: 0, end: TAU }, "roof", true);
  dest.push(...roofLoop.filter((_, i) => i % 4 === 0));
  roofWild.push(...roofLoop);
  for (const q of roof.lifts) {
    const id = addCell({ ...q, f: roofLevel }, "lift")[0];
    if (id == null) continue;
    liftNodes[q.block].push({ f: roofLevel, id });
    const a = (q.start + q.end) / 2,
      link = addCell(
        { f: roofLevel, r: q.R, R: m.R - walk, start: a - 0.045, end: a + 0.045 },
        "roofLink",
        true,
      );
  }
  // Roof greenery and pavilions are destinations beside, rather than inside, the walking ring.
  for (const q of roof.garden) {
    const a = (q.start + q.end) / 2;
    const id = node(xyz(m.R - walk - 0.12, a, yFor(roofLevel)), q.kind === "gazebo" ? "gazebo" : "garden", {
      f: roofLevel,
    });
    const near = roofLoop.reduce(
      (best, n) =>
        best == null ||
        Math.hypot(...sub(nodes[id].p, nodes[n].p)) < Math.hypot(...sub(nodes[id].p, nodes[best].p))
          ? n
          : best,
      null,
    );
    if (near != null) {
      connect(near, id);
      dest.push(id);
      roofWild.push(id);
    }
  }
  for (const q of roof.pavilions) {
    const a = (q.start + q.end) / 2,
      id = node(xyz(q.R + 0.1, a, yFor(roofLevel)), "retail", { f: roofLevel });
    const near = roofLoop.reduce(
      (best, n) =>
        best == null ||
        Math.hypot(...sub(nodes[id].p, nodes[n].p)) < Math.hypot(...sub(nodes[id].p, nodes[best].p))
          ? n
          : best,
      null,
    );
    if (near != null) {
      connect(near, id);
      dest.push(id);
    }
  }
  // Sector adjacency: traverse inside each sector via radial and arc-center segments, not chords across walls.
  const eps = 1e-6;
  // Walk path inside one sector between two points, following radial/arc lines instead of cutting through walls.
  function pathWithin(c, a, r) {
    const center = nodes[c.node].p,
      ca = (c.start + c.end) / 2,
      cr = (c.r + c.R) / 2,
      delta = Math.atan2(Math.sin(a - ca), Math.cos(a - ca)),
      steps = Math.max(1, Math.ceil((Math.abs(delta) * cr) / 2)),
      p = [center];
    for (let i = 1; i <= steps; i++) p.push(xyz(cr, ca + (delta * i) / steps, yFor(c.f)));
    p.push(xyz(r, a, yFor(c.f)));
    return p;
  }
  // Connects two adjacent sectors if the rules permit (no room-to-room shortcuts).
  function join(c, d, a, r) {
    const p = pathWithin(c, a, r),
      q = pathWithin(d, a, r).reverse();
    connect(c.node, d.node, [...p, ...q.slice(1)]);
  }
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const c = cells[i],
        d = cells[j];
      if (c.f !== d.f) continue;
      // Room-to-room connections are prohibited: shared hubs create a separate intermediary.
      if (c.kind === "room" && d.kind === "room") continue;
      // The atrium is accessible through the ground-floor lobby, not arbitrary rooms.
      if (
        (c.kind === "greenhouse" || d.kind === "greenhouse") &&
        c.kind !== d.kind &&
        c.kind !== "lobby" &&
        d.kind !== "lobby"
      )
        continue;
      if ((c.kind === "room" && d.kind === "lift") || (d.kind === "room" && c.kind === "lift")) continue;
      const radialOverlap = Math.min(c.R, d.R) - Math.max(c.r, d.r);
      let done = false;
      for (const shift of [-TAU, 0, TAU]) {
        const a = d.start + shift,
          b = d.end + shift,
          overlap = Math.min(c.end, b) - Math.max(c.start, a);
        if (radialOverlap > 0.2 && (Math.abs(c.end - a) < eps || Math.abs(c.start - b) < eps)) {
          join(
            c,
            d,
            Math.abs(c.end - a) < eps ? c.end : c.start,
            (Math.max(c.r, d.r) + Math.min(c.R, d.R)) / 2,
          );
          done = true;
          break;
        }
        if (overlap > eps && (Math.abs(c.R - d.r) < eps || Math.abs(c.r - d.R) < eps)) {
          const rr = Math.abs(c.R - d.r) < eps ? c.R : c.r;
          if (overlap * rr > 0.21) {
            join(c, d, (Math.max(c.start, a) + Math.min(c.end, b)) / 2, rr);
            done = true;
            break;
          }
        }
      }
    }
  for (const list of liftNodes) {
    list.sort((a, b) => a.f - b.f);
    for (let i = 1; i < list.length; i++) connect(list[i - 1].id, list[i].id, null, "lift");
  }
  // Occupied modules and adaptive public decks are accessible destinations through their dock doors.
  for (const slot of m.slots) {
    if (slot.blocked || (slot.p === EMPTY && slot.use === "empty")) continue;
    const a = slot.angle,
      f = slot.f,
      cr = m.R - 0.55;
    const portal = cells.filter(
      (c) =>
        c.f === f &&
        c.kind === "corridor" &&
        c.R >= cr &&
        c.r < cr &&
        [a, a + TAU, a - TAU].some((t) => t >= c.start - 1e-6 && t <= c.end + 1e-6),
    );
    if (!portal.length) continue;
    const c = portal.sort((x, y) => angDist((x.start + x.end) / 2, a) - angDist((y.start + y.end) / 2, a))[0],
      kind =
        slot.p !== EMPTY
          ? "module"
          : slot.use === "retail"
            ? "retail"
            : slot.use === "garden"
              ? "garden"
              : "balcony",
      y = yFor(f),
      rad = m.R + MODULE.depth * 0.53 + 0.65,
      id = node(xyz(rad, a, y), kind, {
        f,
        program: slot.p >= 0 && slot.p < 5 ? slot.p : undefined,
        slot: slot.i,
      });
    const path = pathWithin(c, a, cr);
    connect(c.node, id, [...path, xyz(m.R + 0.68, a, y), nodes[id].p]);
    dest.push(id);
  }
  // A roof bridge connects the walking ring to the ride boarding platform.
  const a = m.circulation.bridgeAngle,
    ride = m.feature.ride;
  if (roofLoop.length) {
    const near = roofLoop.reduce(
        (best, n) =>
          best == null ||
          angDist(Math.atan2(nodes[n].p[2], nodes[n].p[0]), a) <
            angDist(Math.atan2(nodes[best].p[2], nodes[best].p[0]), a)
            ? n
            : best,
        null,
      ),
      bridge = node(xyz(m.r - 0.05, a, yFor(roofLevel)), "roofLink", { f: roofLevel }),
      swing = node(xyz(ride.platformRadius - 0.45, a, ride.roofLevel + 0.27), "swing", { f: roofLevel });
    connect(near, bridge);
    connect(bridge, swing);
    dest.push(swing);
  }
  // Waterslide is a destination / directed experience from its actual landing rooms.
  const s = m.feature.slide;
  if (s) {
    const match = (f, a) =>
      nodes
        .filter((n) => n.kind === "room" && n.program === 0 && n.f === f)
        .sort((x, y) => angDist(Math.atan2(x.p[2], x.p[0]), a) - angDist(Math.atan2(y.p[2], y.p[0]), a))[0];
    const start = match(s.startFloor, s.startAngle),
      end = match(s.endFloor, s.endAngle);
    if (start && end) {
      start.kind = "slideStart";
      end.kind = "slideEnd";
      start.slideTarget = end.id;
      start.slidePath = [start.p, ...s.points.map((p) => [p[0], p[1] + 0.1, p[2]]), end.p];
    }
  }
  // Visitors travel through the plaza-lobby route. If there is no lobby, do not invent a doorway.
  const p = m.plaza,
    axis = l.angle;
  if (p && lobby != null) {
    entry = node(xyz(p.outer - 0.55, axis, 0.205), "entry", { f: 0 });
    const mouth = node(xyz(p.mouth, axis, 0.205), "plaza", { f: 0 }),
      door = node(xyz(m.R + 0.09, axis, 0.3), "plaza", { f: 0 });
    connect(entry, mouth);
    connect(mouth, door);
    connect(door, lobby);
    dest.push(mouth, door);
    outdoor.push(entry, mouth, door);
    for (let i = 1; i <= 4; i++) {
      const rad = p.mouth + ((p.outer - p.mouth) * i) / 5,
        id = node(xyz(rad, axis + (i % 2 ? 1 : -1) * Math.min(0.03, p.span * 0.06), 0.205), "plaza", {
          f: 0,
        });
      connect(mouth, id);
      connect(id, entry);
      dest.push(id);
      outdoor.push(id);
    }
  }
  // Climbing is a directed recreational activity, not an alternative pedestrian shortcut.
  const climb = m.feature.climbing;
  if (climb && entry != null) {
    const a = climb.angle,
      rad = m.R + MODULE.depth + 3.5,
      from = axis,
      delta = Math.atan2(Math.sin(a - from), Math.cos(a - from)),
      path = [nodes[entry].p, xyz(rad, from, 0.205)],
      steps = Math.max(3, Math.ceil((Math.abs(delta) * rad) / 2.0));
    for (let j = 1; j <= steps; j++) path.push(xyz(rad, from + (delta * j) / steps, 0.02));
    const base = node(xyz(climb.face + 1.35, a, 0.02), "climbBase", { f: 0 });
    path.push(nodes[base].p);
    connect(entry, base, path);
    const route = [nodes[base].p, xyz(climb.face + 0.5, a, 0.35)];
    for (let y = 0.85; y < climb.height - 0.5; y += 0.5)
      route.push(xyz(climb.face + 0.5, a + (0.18 / climb.face) * Math.sin(y * 2.6), y));
    route.push(xyz(climb.face + 0.5, a, Math.max(0.35, climb.height - 0.5)));
    nodes[base].climbPath = [...route, ...route.slice(0, -1).reverse()];
    nodes[base].climbTarget = base;
    dest.push(base);
  }
  // Separate open habitats for wildlife, independent from the human circulation network.
  const outsideR = m.R + MODULE.depth + 6,
    outerWild = [];
  for (let i = 0; i < 24; i++) {
    const a = (i * TAU) / 24;
    outerWild.push(node(xyz(outsideR, a, 0.02), "outdoor", { f: 0 }));
  }
  for (let i = 0; i < outerWild.length; i++) connect(outerWild[i], outerWild[(i + 1) % outerWild.length]);
  // Connected public destinations only. Rooms are terminal nodes, never shortcuts.
  const reachable = new Set();
  if (entry != null) {
    const queue = [entry];
    reachable.add(entry);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of edges[id])
        if (!reachable.has(e.to)) {
          reachable.add(e.to);
          queue.push(e.to);
        }
    }
  }
  return {
    nodes,
    edges,
    dest: dest.filter((i) => reachable.has(i)),
    entry,
    outdoor,
    outerWild,
    roofWild,
    reachable,
  };
}
// A resting position near a node for an agent to dwell at.
function dwellPoint(n, a) {
  if (!n) return null;
  const base = n.p,
    phase =
      (a.i * 2.399963 + (a.kind === "human" ? 0 : a.kind === "dog" ? 1.3 : a.kind === "bird" ? 2.8 : 4.1)) %
      TAU;
  let dx = 0.65 * Math.cos(phase),
    dz = 0.65 * Math.sin(phase);
  if (n.cell) {
    const c = n.cell,
      rad = (c.r + c.R) / 2,
      ang = (c.start + c.end) / 2,
      rr = rad + Math.sin(phase) * Math.min(0.62, (c.R - c.r) * 0.24),
      aa = ang + Math.cos(phase) * Math.min(0.82 / Math.max(1, rad), (c.end - c.start) * 0.25);
    return [rr * Math.cos(aa), base[1], rr * Math.sin(aa)];
  }
  return [base[0] + dx, base[1], base[2] + dz];
}
// Creates the simulation state: a seeded population of human visitors and animals, with their home places and starting nodes, plus a fresh score.
function makeOccupancy(m) {
  const graph = buildNavigation(m),
    rng = random((state.seed ^ 0x74b33ac) >>> 0),
    people = [],
    animals = [],
    skin = ["#e9c5a2", "#c39371", "#9e6b50", "#755039"],
    clothes = ["#597e9a", "#ba746e", "#71977b", "#967aaf", "#b69561", "#527f85"],
    hair = ["#54433b", "#65523b", "#9a7953", "#343332"],
    pick = (a) => a[Math.floor(rng() * a.length)];
  function make(kind, i, home) {
    const wheelchair = kind === "human" && i % 9 === 2,
      child = kind === "human" && i % 11 === 5,
      style =
        kind === "human"
          ? {
              h: child ? 0.95 + rng() * 0.35 : 1.48 + rng() * 0.47,
              w: child ? 0.36 : 0.5 + rng() * 0.27,
              skin: pick(skin),
              cloth: pick(clothes),
              hair: pick(hair),
              stroll: (rng() - 0.5) * 0.4,
            }
          : { s: 0.85 + rng() * 0.3, col: pick(["#a88d70", "#967b60", "#baa991", "#8d8172"]) };
    const n = graph.nodes[home];
    return {
      kind,
      i,
      wheelchair,
      style,
      node: home,
      p: [...n.p],
      angle: rng() * TAU,
      speed: wheelchair
        ? 0.9 + rng() * 0.2
        : kind === "human"
          ? 1 + rng() * 0.5
          : kind === "dog"
            ? 1.25 + rng() * 0.45
            : kind === "bird"
              ? 2.4 + rng()
              : 0.6 + rng() * 0.4,
      wait: rng() * 12,
      path: null,
      step: 0,
      depart: kind === "human" || kind === "dog" ? rng() * 170 + 95 : Infinity,
      active: true,
      lastProgram: null,
      lastRoom: null,
      funAt: -Infinity,
      home,
      visits: 0,
    };
  }
  if (graph.entry != null) {
    for (let i = 0; i < state.visitorCount; i++) {
      const home =
        i < Math.ceil(state.visitorCount * 0.25)
          ? pick(graph.outdoor.length ? graph.outdoor : [graph.entry])
          : pick(graph.dest.length ? graph.dest : [graph.entry]);
      const base = graph.nodes.find((n) => n.kind === "climbBase");
      const visitor = make("human", i, base && i < 2 ? base.id : home);
      if (base && i < 2) visitor.depart = 360;
      people.push(visitor);
    }
    for (let i = 0; i < 5; i++)
      animals.push(
        make(
          "dog",
          i,
          i < 2
            ? graph.entry
            : pick(
                graph.dest
                  .filter(
                    (n) =>
                      !["room", "module", "retail", "slideStart", "slideEnd", "swing"].includes(
                        graph.nodes[n].kind,
                      ),
                  )
                  .concat(graph.entry),
              ),
        ),
      );
  }
  for (const [kind, n] of [
    ["bird", 9],
    ["rabbit", 5],
    ["squirrel", 5],
  ])
    for (let i = 0; i < n; i++) {
      const pool = i % 2 && graph.roofWild.length ? graph.roofWild : graph.outerWild;
      animals.push(make(kind, i, pick(pool)));
    }
  for (const a of [...people, ...animals]) a.p = dwellPoint(graph.nodes[a.node], a);
  return {
    m,
    graph,
    rng,
    people,
    animals,
    gather: 0,
    fun: 0,
    entries: 0,
    exits: 0,
    clock: 0,
    score: newCrossScore(),
    sampleClock: 0,
    stepBalance: 0,
  };
}
// Shortest-path search (Dijkstra with a binary heap) over the graph; `kind` limits who may use which edges.
function shortestPath(g, start, goal, kind) {
  if (start === goal) return [];
  const n = g.nodes.length,
    d = new Float64Array(n);
  d.fill(Infinity);
  d[start] = 0;
  const prev = Array(n),
    done = new Uint8Array(n),
    heap = [[0, start]];
  function push(x) {
    let i = heap.length;
    heap.push(x);
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= x[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = x;
  }
  function pop() {
    const x = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1][0] < heap[j][0]) j++;
        if (heap[j][0] >= last[0]) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = last;
    }
    return x;
  }
  while (heap.length) {
    const [cost, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    const cur = g.nodes[u];
    if (
      u !== start &&
      [
        "room",
        "module",
        "slideStart",
        "slideEnd",
        "swing",
        "retail",
        "garden",
        "balcony",
        "gazebo",
        "climbBase",
        "climbTop",
      ].includes(cur.kind)
    )
      continue;
    for (const e of g.edges[u]) {
      const v = e.to,
        b = g.nodes[v];
      if (done[v]) continue;
      if (kind !== "human" && ["swing", "slideStart", "slideEnd"].includes(b.kind)) continue;
      const w = e.len + (e.kind === "lift" ? 7 : 0);
      if (cost + w < d[v]) {
        d[v] = cost + w;
        prev[v] = { u, e };
        push([d[v], v]);
      }
    }
  }
  if (!Number.isFinite(d[goal])) return null;
  let path = [],
    v = goal;
  while (v !== start) {
    const a = prev[v];
    if (!a) return null;
    path.push(a.e);
    v = a.u;
  }
  return path.reverse();
}
// Records the room/program an agent just left so the score can credit meeting people from different places.
function rememberDeparture(a, sim) {
  const n = sim.graph.nodes[a.node];
  if (["room", "module", "slideStart", "slideEnd", "retail"].includes(n.kind)) {
    a.lastRoom = n.id;
    a.lastProgram = n.program ?? null;
  }
  if (n.kind === "swing") a.funAt = sim.clock;
}
// Gives an agent a path to a target node.
function routeAgent(a, target, sim) {
  const path = shortestPath(sim.graph, a.node, target, a.kind);
  if (!path || !path.length) return false;
  rememberDeparture(a, sim);
  let from = a.node;
  a.path = path.flatMap((e) => {
    const start = from;
    from = e.to;
    return e.path
      .slice(1)
      .map((p) => ({ p, speed: e.kind === "lift" ? 1.5 : a.speed, kind: e.kind, from: start, to: e.to }));
  });
  a.path.unshift({
    p: [...sim.graph.nodes[a.node].p],
    speed: a.speed,
    kind: "walk",
    from: a.node,
    to: a.node,
  });
  const end = sim.graph.nodes[target];
  if (end.kind !== "entry")
    a.path.push({ p: dwellPoint(end, a), speed: a.speed, kind: "walk", from: target, to: target });
  a.step = 0;
  a.goal = target;
  return true;
}
// Decision step: what an agent does next (wander, visit a room, use the slide, swing, climb...).
function chooseAgent(a, sim) {
  const g = sim.graph,
    r = sim.rng,
    n = g.nodes[a.node],
    pick = (arr) => arr[Math.floor(r() * arr.length)];
  if (a.kind === "human" || a.kind === "dog") {
    if (a.kind === "human" && !a.wheelchair && n.kind === "entry" && a.visits < 1 && r() < 0.22) {
      const base = g.nodes.find((v) => v.kind === "climbBase");
      if (base && routeAgent(a, base.id, sim)) {
        a.depart = Math.max(a.depart, 480);
        return;
      }
    }
    if (a.depart <= 0 && g.entry != null) {
      if (a.node === g.entry) {
        a.active = false;
        a.wait = 8 + r() * 22;
        a.leaving = false;
        sim.exits++;
        return;
      }
      if (routeAgent(a, g.entry, sim)) {
        a.leaving = true;
        return;
      }
    }
    if (a.leaving && a.node === g.entry) {
      a.active = false;
      a.wait = 8 + r() * 22;
      a.leaving = false;
      sim.exits++;
      return;
    }
    if (
      a.kind === "human" &&
      !a.wheelchair &&
      n.kind === "climbBase" &&
      n.climbPath &&
      sim.clock - a.funAt > 30 &&
      r() < 0.92
    ) {
      a.path = [
        { p: [...n.p], speed: a.speed, kind: "climb" },
        ...n.climbPath
          .slice(1)
          .map((p, i) => ({ p, speed: i < n.climbPath.length / 2 ? 0.55 : 1.15, kind: "climb" })),
      ];
      a.step = 0;
      a.goal = n.climbTarget;
      a.onClimb = true;
      sim.fun++;
      sim.climbs = (sim.climbs || 0) + 1;
      return;
    }
    if (a.kind === "human" && n.kind === "slideStart" && r() < 0.65 && n.slidePath) {
      rememberDeparture(a, sim);
      a.path = n.slidePath.slice(1).map((p) => ({ p, speed: 6.2, kind: "slide" }));
      a.step = 0;
      a.goal = n.slideTarget;
      a.onSlide = true;
      sim.fun++;
      return;
    }
    if (
      a.kind === "human" &&
      ["room", "module", "slideStart", "slideEnd"].includes(n.kind) &&
      n.program != null
    ) {
      const hubs = g.dest
        .filter((id) => {
          const h = g.nodes[id];
          return h.kind === "hub" && h.f === n.f && h.pair.includes(n.program) && state.affinity > 0;
        })
        .sort((i, j) => Math.hypot(...sub(g.nodes[i].p, n.p)) - Math.hypot(...sub(g.nodes[j].p, n.p)));
      if (hubs.length) {
        const h = g.nodes[hubs[0]],
          p = h.pair.find((x) => x !== n.program),
          weight = (state.affinity / 100) * relationMagnitude(n.program, p);
        if (r() < 0.42 + 0.53 * weight && routeAgent(a, h.id, sim)) {
          a.social = weight;
          return;
        }
      }
    }
    const allowed = g.dest.filter((id) => {
      const v = g.nodes[id];
      if (id === a.node) return false;
      if (
        a.kind === "dog" &&
        ["room", "module", "slideStart", "slideEnd", "swing", "retail"].includes(v.kind)
      )
        return false;
      return true;
    });
    for (let k = 0; k < 8 && allowed.length; k++) {
      let id;
      if (a.kind === "human" && r() < 0.24) {
        const fun = allowed.filter((i) => ["swing", "slideStart", "climbBase"].includes(g.nodes[i].kind));
        id = fun.length ? pick(fun) : pick(allowed);
      } else if (r() < 0.7) {
        const local = allowed.filter((i) => g.nodes[i].f === n.f);
        id = local.length ? pick(local) : pick(allowed);
      } else id = pick(allowed);
      if (vRepels(n, g.nodes[id]) && r() < state.affinity / 100) continue;
      if (routeAgent(a, id, sim)) return;
    }
  } else {
    const pool = g.roofWild.includes(a.home) ? g.roofWild : g.outerWild;
    for (let i = 0; i < 5; i++) {
      const id = pick(pool);
      if (id !== a.node && routeAgent(a, id, sim)) return;
    }
  }
  a.wait = 2 + r() * 5;
}
// Whether two agents are close enough to push each other apart (simple crowd avoidance).
function vRepels(a, b) {
  return (
    a.program != null &&
    b.program != null &&
    a.program !== b.program &&
    relationMode(a.program, b.program) === "repel"
  );
}
// Advances every agent by dt seconds of simulated time, moving along paths and avoiding collisions.
function advanceOccupancy(s, dt) {
  if (!s) return;
  s.clock = (s.clock || 0) + dt;
  for (const a of [...s.people, ...s.animals]) {
    if (!a.active) {
      a.wait -= dt;
      if (a.wait <= 0) {
        a.active = true;
        a.node = s.graph.entry;
        a.p = [...s.graph.nodes[a.node].p];
        a.depart = 100 + s.rng() * 190;
        a.lastRoom = null;
        a.lastProgram = null;
        a.funAt = -Infinity;
        a.onSlide = false;
        a.onClimb = false;
        a.visits = 0;
        a.wait = 0;
        s.entries++;
      }
      continue;
    }
    a.depart -= dt;
    if (a.wait > 0) {
      a.wait -= dt;
      continue;
    }
    if (!a.path) {
      chooseAgent(a, s);
      continue;
    }
    let remain = dt;
    while (a.path && remain > 0) {
      const target = a.path[a.step],
        d = sub(target.p, a.p),
        len = Math.hypot(...d),
        time = len / target.speed;
      if (len > 0.01 && Math.hypot(d[0], d[2]) > 0.01) a.angle = Math.atan2(d[2], d[0]);
      if (time > remain) {
        a.p = a.p.map((v, i) => v + (d[i] * remain) / time);
        remain = 0;
      } else {
        a.p = [...target.p];
        remain -= time;
        a.step++;
        if (a.step >= a.path.length) {
          a.node = a.goal;
          a.path = null;
          const n = s.graph.nodes[a.node];
          a.visits++;
          if (a.onSlide || a.onClimb) {
            if (a.onClimb) s.completedClimbs = (s.completedClimbs || 0) + 1;
            a.funAt = s.clock;
            a.onSlide = false;
            a.onClimb = false;
          }
          a.wait =
            n.kind === "hub"
              ? 8 + 25 * (a.social || 0.3) + s.rng() * 9
              : ["swing", "climbBase", "climbTop"].includes(n.kind)
                ? 18 + s.rng() * 8
                : ["room", "module", "slideStart", "slideEnd", "retail"].includes(n.kind)
                  ? 9 + s.rng() * 23
                  : ["garden", "balcony", "plaza", "greenhouse", "gazebo"].includes(n.kind)
                    ? 7 + s.rng() * 15
                    : 2 + s.rng() * 7;
          if (n.kind === "hub") {
            s.gather++;
            a.social = 0;
          }
          if (n.kind === "swing") s.fun++;
          if (a.leaving && a.node === s.graph.entry) a.wait = 0.1;
        }
      }
    }
  }
}
