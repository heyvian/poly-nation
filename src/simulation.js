'use strict';

// Occupancy simulation: conceptual navigation graph derived from actual circulation sectors.
// Navigation and display are separate from area / geometry generation.
let occupancy = null,
  simLast = 0,
  simDrawLast = 0;
function buildNavigation(m) {
  const nodes = [],
    edges = [],
    cells = [],
    dest = [],
    liftNodes = [[], []],
    outdoor = [],
    roofWild = [],
    floorH = modelFloorPitch(m),
    roofLevel = m.layers.length,
    yFor = (f) => (f === roofLevel ? m.roofPlan.y + 0.082 : f * floorH + 0.54);
  const xyz = (r, a, y) => [r * Math.cos(a), y, r * Math.sin(a)];
  function node(p, kind, meta = {}) {
    const id = nodes.length;
    nodes.push({ id, p, kind, ...meta });
    edges.push([]);
    return id;
  }
  function connect(a, b, points = null, kind = 'walk') {
    if (a === b || a == null || b == null) return;
    const path = points || [nodes[a].p, nodes[b].p],
      len = path.slice(1).reduce((s, p, i) => s + Math.hypot(...sub(p, path[i])), 0);
    if (len < 1e-6) return;
    edges[a].push({ to: b, path, len, kind });
    edges[b].push({ to: a, path: [...path].reverse(), len, kind });
  }
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
      const id = node(xyz(rad, ang, yFor(c.f)), kind, {
        f: c.f,
        program: c.id,
        pair: c.pair,
        cell: c
      });
      c.node = id;
      cells.push(c);
      ids.push(id);
    }
    return ids;
  }
  const bridgeLandings = new Map();
  for (const q of m.circulation.regions) {
    if (q.kind === 'lobbyDivider') continue;
    const kind = q.kind === 'elevator' ? 'lift' : 'corridor',
      ids = addCell(q, kind, kind === 'corridor' && q.kind !== 'bridgeAccess');
    if (kind === 'lift' && ids.length) liftNodes[q.block].push({ f: q.f, id: ids[0] });
    if (q.kind === 'bridgeAccess' && ids.length) {
      if (!bridgeLandings.has(q.f)) bridgeLandings.set(q.f, []);
      bridgeLandings.get(q.f).push(ids[0]);
    }
  }
  // The two passage nodes meet the visible bridge at its centerline. Short links let the
  // encounter model identify visitors while they are midway across a long span.
  for (const [f, [start, end]] of bridgeLandings) {
    if (end == null) continue;
    const landing = (id) => {
      const { start, end } = nodes[id].cell;
      return xyz(m.r, (start + end) / 2, yFor(f));
    };
    const a = landing(start),
      b = landing(end),
      segments = Math.ceil(Math.hypot(...sub(b, a)) / 3);
    let previous = start;
    for (let i = 0; i <= segments; i++) {
      const p = a.map((x, axis) => x + ((b[axis] - x) * i) / segments);
      const id = node(p, 'corridor', { f });
      connect(previous, id, null, 'atriumBridge');
      previous = id;
    }
    connect(previous, end, null, 'atriumBridge');
  }
  for (const q of m.circulation.hubs) {
    const ids = addCell(q, 'hub');
    if (q.layout?.axis && ids.length) nodes[ids[0]].p = sharedLobbyPoint(q, 0, 0, yFor(q.f));
    dest.push(...ids);
  }
  for (const q of m.rooms) {
    if (q.id >= 5) continue;
    const ids = addCell(q, 'room');
    dest.push(...ids);
  }
  const l = m.lobby;
  const bays = lobbyBays(l),
    lobbyNodes = bays.map(
      ({ angle, span }) =>
        addCell(
          { f: 0, r: m.r, R: m.R, start: angle - span / 2, end: angle + span / 2 },
          'lobby'
        )[0]
    ),
    [lobby, oppositeLobby] = lobbyNodes;
  let entry = null;
  dest.push(...lobbyNodes.filter((id) => id != null));

  // Both straight approaches meet at the ring, where agents can pass either side of the mast.
  if (m.greenhouse?.approaches && lobby != null && oppositeLobby != null) {
    const { approaches, ringRadius, axis } = m.greenhouse;
    function crossingNode(x, z) {
      return node([x, yFor(0), z], 'greenhouse', { f: 0 });
    }
    function linkPath(ids) {
      for (let i = 1; i < ids.length; i++) connect(ids[i - 1], ids[i], null, 'atriumCrossing');
    }
    const junctions = approaches.map(([[x, z], [endX, endZ]], i) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(endX - x, endZ - z) / 3));
      const nodes = Array.from({ length: steps + 1 }, (_, j) =>
        crossingNode(x + ((endX - x) * j) / steps, z + ((endZ - z) * j) / steps)
      );
      linkPath([lobbyNodes[i], ...nodes]);
      return nodes.at(-1);
    });
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 19 }, (_, i) => {
        const angle = axis + (side * Math.PI * (i + 1)) / 20;
        return crossingNode(ringRadius * Math.cos(angle), ringRadius * Math.sin(angle));
      });
      linkPath([junctions[0], ...points, junctions[1]]);
    }
  }
  // Open atrium perimeter and the visible greenhouse promenade, kept away from the mast.
  const atriumIds = addCell(
      { f: 0, r: Math.max(0.1, m.r - 1.25), R: m.r, start: 0, end: TAU },
      'greenhouse',
      true
    );
  dest.push(...atriumIds.filter((_, i) => i % 4 === 0));
  // Roof walking loop; only direct lift/bridge access zones join the interior roof.
  const roof = m.roofPlan,
    walk = roof.walk;
  const roofLoop = addCell(
    { f: roofLevel, r: m.R - walk, R: m.R, start: 0, end: TAU },
    'roof',
    true
  );
  dest.push(...roofLoop.filter((_, i) => i % 4 === 0));
  roofWild.push(...roofLoop);
  for (const q of roof.lifts) {
    const id = addCell({ ...q, f: roofLevel }, 'lift')[0];
    if (id == null) continue;
    liftNodes[q.block].push({ f: roofLevel, id });
    const a = (q.start + q.end) / 2,
      link = addCell(
        { f: roofLevel, r: q.R, R: m.R - walk, start: a - 0.045, end: a + 0.045 },
        'roofLink',
        true
      );
  }
  // Roof greenery and pavilions are destinations beside, rather than inside, the walking ring.
  for (const q of roof.garden) {
    const a = (q.start + q.end) / 2;
    const id = node(
      xyz(m.R - walk - 0.12, a, yFor(roofLevel)),
      q.kind === 'gazebo' ? 'gazebo' : 'garden',
      { f: roofLevel }
    );
    const near = roofLoop.reduce(
      (best, n) =>
        best == null ||
        Math.hypot(...sub(nodes[id].p, nodes[n].p)) < Math.hypot(...sub(nodes[id].p, nodes[best].p))
          ? n
          : best,
      null
    );
    if (near != null) {
      connect(near, id);
      dest.push(id);
      roofWild.push(id);
    }
  }
  for (const q of roof.pavilions) {
    const a = (q.start + q.end) / 2,
      id = node(xyz(q.R + 0.1, a, yFor(roofLevel)), 'retail', { f: roofLevel });
    const near = roofLoop.reduce(
      (best, n) =>
        best == null ||
        Math.hypot(...sub(nodes[id].p, nodes[n].p)) < Math.hypot(...sub(nodes[id].p, nodes[best].p))
          ? n
          : best,
      null
    );
    if (near != null) {
      connect(near, id);
      dest.push(id);
    }
  }
  // Sector adjacency: traverse inside each sector via radial and arc-center segments, not chords across walls.
  const eps = 1e-6;
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
  function join(c, d, a, r) {
    const p = pathWithin(c, a, r),
      q = pathWithin(d, a, r).reverse();
    connect(c.node, d.node, [...p, ...q.slice(1)]);
  }
  const servicedHubs = new Map();
  for (const c of cells) if (c.kind === 'hub' && c.layout) servicedHubs.set(c.lobbyId, c);
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const c = cells[i],
        d = cells[j];
      if (c.f !== d.f) continue;
      // Lobby connections follow the clear aisle and its approaches. Generic sector
      // adjacency would leave corridor shortcuts into the rooms or across the couches.
      if (c.sharedLobby || d.sharedLobby || (c.kind === 'hub' && c.layout) || (d.kind === 'hub' && d.layout)) continue;
      // Room-to-room connections are prohibited: shared hubs create a separate intermediary.
      if (c.kind === 'room' && d.kind === 'room') continue;
      // The atrium is accessible through the ground-floor lobby, not arbitrary rooms.
      if (
        (c.kind === 'greenhouse' || d.kind === 'greenhouse') &&
        c.kind !== d.kind &&
        c.kind !== 'lobby' &&
        d.kind !== 'lobby'
      )
        continue;
      if ((c.kind === 'room' && d.kind === 'lift') || (d.kind === 'room' && c.kind === 'lift'))
        continue;
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
            (Math.max(c.r, d.r) + Math.min(c.R, d.R)) / 2
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
  for (const c of cells) {
    if (!c.sharedLobby) continue;
    const { id, angle, r, along } = c.sharedLobby,
      hub = servicedHubs.get(id);
    if (!hub) continue;
    const approach = Number.isFinite(along) ? [sharedLobbyPoint(hub, along, 0, yFor(hub.f))] : [];
    connect(c.node, hub.node, [...pathWithin(c, angle, r), ...approach, nodes[hub.node].p]);
  }
  for (const hub of servicedHubs.values()) {
    const entries = hub.layout.publicEntries ?? [{ ...hub.layout.publicEntry, radius: hub.R }],
      y = yFor(hub.f);
    for (const { angle, along, radius, inside, route } of entries) {
      const access = cells.find(
        (c) =>
          c.f === hub.f &&
          c.kind === 'corridor' &&
          (route
            ? c.lobbyRouteId === hub.lobbyId && c.route === route
            : Math.abs((inside ? c.R : c.r) - radius) < eps) &&
          [angle, angle + TAU, angle - TAU].some(
            (value) => value >= c.start - eps && value <= c.end + eps
          )
      );
      if (!access) continue;
      const arch = sharedLobbyPoint(hub, along, 0, y),
        portal = xyz(radius, angle, y);
      let path = pathWithin(access, angle, radius);
      if (hub.layout.axis) {
        // Carry the entrance alignment a short way into the corridor where its width allows.
        const direction = unit(sub(portal, arch));
        for (const distance of [0.55, 0.3, 0.15]) {
          const x = portal[0] + distance * direction[0],
            z = portal[2] + distance * direction[2],
            r = Math.hypot(x, z),
            a = Math.atan2(z, x);
          if (
            r > access.r + eps &&
            r < access.R - eps &&
            [a, a - TAU, a + TAU].some(
              (value) => value > access.start + eps && value < access.end - eps
            )
          ) {
            path = [...pathWithin(access, a, r), portal];
            break;
          }
        }
      }
      connect(access.node, hub.node, [...path, arch, nodes[hub.node].p]);
    }
  }
  for (const list of liftNodes) {
    list.sort((a, b) => a.f - b.f);
    for (let i = 1; i < list.length; i++) connect(list[i - 1].id, list[i].id, null, 'lift');
  }
  // Occupied modules and adaptive public decks are accessible destinations through their dock doors.
  for (const slot of m.slots) {
    if (slot.blocked || (slot.p === EMPTY && slot.use === 'empty')) continue;
    const a = slot.angle,
      f = slot.f,
      cr = m.R - 0.55;
    const portal = cells.filter(
      (c) =>
        c.f === f &&
        c.kind === 'corridor' &&
        c.R >= cr &&
        c.r < cr &&
        [a, a + TAU, a - TAU].some((t) => t >= c.start - 1e-6 && t <= c.end + 1e-6)
    );
    if (!portal.length) continue;
    const c = portal.sort(
        (x, y) => angDist((x.start + x.end) / 2, a) - angDist((y.start + y.end) / 2, a)
      )[0],
      kind =
        slot.p !== EMPTY
          ? 'module'
          : slot.use === 'retail'
            ? 'retail'
            : slot.use === 'garden'
              ? 'garden'
              : 'balcony',
      y = yFor(f),
      rad = m.R + MODULE.depth * 0.53 + 0.65,
      id = node(xyz(rad, a, y), kind, {
        f,
        program: slot.p >= 0 && slot.p < 5 ? slot.p : undefined,
        slot: slot.i
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
        null
      ),
      bridge = node(xyz(m.r, a, yFor(roofLevel)), 'roofLink', { f: roofLevel }),
      boardingHeight = ride.roofLevel + 0.16,
      swing = node(xyz(ride.platformRadius - 0.72, a, boardingHeight), 'swing', {
        f: roofLevel
      });
    connect(near, bridge, [nodes[near].p, xyz(m.r + 0.6, a, yFor(roofLevel)), nodes[bridge].p]);
    const stairs = ride.roofPitch?.stairs;
    const approach = stairs
      ? stairs.flatMap((step) => [xyz(step.R, a, step.y), xyz(step.r, a, step.y)])
      : [xyz(ride.roofPitch?.rampEnd ?? ride.platformRadius - 0.1, a, boardingHeight)];
    connect(
      bridge,
      swing,
      [nodes[bridge].p, ...approach, nodes[swing].p],
      stairs ? 'stairs' : 'walk'
    );
    dest.push(swing);
  }
  // Waterslide is a destination / directed experience from its actual landing rooms.
  const s = m.feature.slide;
  if (s) {
    const match = (f, a) =>
      nodes
        .filter((n) => n.kind === 'room' && n.program === 0 && n.f === f)
        .sort(
          (x, y) => angDist(Math.atan2(x.p[2], x.p[0]), a) - angDist(Math.atan2(y.p[2], y.p[0]), a)
        )[0];
    const start = match(s.startFloor, s.startAngle),
      end = match(s.endFloor, s.endAngle);
    if (start && end) {
      start.kind = 'slideStart';
      end.kind = 'slideEnd';
      start.slideTarget = end.id;
      start.slidePath = [start.p, ...s.points.map((p) => [p[0], p[1] + 0.1, p[2]]), end.p];
    }
  }
  // Visitors travel through the plaza-lobby route. If there is no lobby, do not invent a doorway.
  const p = m.plaza,
    axis = l.angle;
  if (p && lobby != null) {
    entry = node(xyz(p.outer - 0.55, axis, 0.205), 'entry', { f: 0 });
    const mouth = node(xyz(p.mouth, axis, 0.205), 'plaza', { f: 0 }),
      door = node(xyz(m.R + 0.09, axis, 0.3), 'plaza', { f: 0 });
    connect(entry, mouth);
    connect(mouth, door);
    connect(door, lobby);
    dest.push(mouth, door);
    outdoor.push(entry, mouth, door);
    for (let i = 1; i <= 4; i++) {
      const rad = p.mouth + ((p.outer - p.mouth) * i) / 5,
        id = node(
          xyz(rad, axis + (i % 2 ? 1 : -1) * Math.min(0.03, p.span * 0.06), 0.205),
          'plaza',
          { f: 0 }
        );
      connect(mouth, id);
      connect(id, entry);
      dest.push(id);
      outdoor.push(id);
    }
  }
  // A continuous outdoor promenade: same public nodes for people and wildlife.
  const outerWild = [],
    loopN = Math.max(24, Math.ceil((TAU * p.walkRadius) / 5)),
    loop = [];
  for (let i = 0; i < loopN; i++) {
    const a = axis + (i * TAU) / loopN,
      id = node(xyz(p.walkRadius, a, 0.205), 'plaza', { f: 0 });
    loop.push(id);
    outerWild.push(id);
    if (i % 4 === 0) {
      dest.push(id);
      outdoor.push(id);
    }
  }
  for (let i = 0; i < loopN; i++) {
    const a = axis + (i * TAU) / loopN,
      b = axis + ((i + 1) * TAU) / loopN;
    connect(
      loop[i],
      loop[(i + 1) % loopN],
      Array.from({ length: 5 }, (_, j) => xyz(p.walkRadius, a + ((b - a) * j) / 4, 0.205))
    );
  }
  const nearestLoop = (a) => loop[Math.round((mod(a - axis, TAU) / TAU) * loopN) % loopN];
  if (entry != null) connect(entry, loop[0]);
  if (oppositeLobby != null) {
    const rear = bays[1].angle,
      mouth = node(xyz(p.mouth, rear, 0.205), 'plaza', { f: 0 }),
      door = node(xyz(m.R + 0.09, rear, 0.3), 'plaza', { f: 0 }),
      near = nearestLoop(rear);
    connect(near, mouth, [nodes[near].p, xyz(p.walkRadius, rear, 0.205), nodes[mouth].p]);
    connect(mouth, door);
    connect(door, oppositeLobby);
    dest.push(mouth, door);
    outdoor.push(mouth, door);
  }
  for (const q of p.zones) {
    const a = q.angle,
      near = nearestLoop(a),
      rad = p.mouth + 8.4,
      kind = q.kind === 'green' ? 'garden' : 'plaza',
      id = node(xyz(rad, a, 0.205), kind, { f: 0, landscape: q.kind });
    connect(near, id);
    dest.push(id);
    outdoor.push(id);
    outerWild.push(id);
  }
  // Climbing is a directed recreational activity, not an alternative pedestrian shortcut.
  const climb = m.feature.climbing;
  if (climb) {
    const a = climb.angle,
      near = nearestLoop(a),
      base = node(xyz(climb.face + 1.35, a, 0.19), 'climbBase', { f: 0 });
    connect(near, base, [
      nodes[near].p,
      xyz(p.walkRadius, a, 0.205),
      xyz(p.mouth, a, 0.205),
      nodes[base].p
    ]);
    const route = [nodes[base].p, xyz(climb.face + 0.5, a, 0.35)];
    for (let y = 0.85; y < climb.height - 0.5; y += 0.5)
      route.push(xyz(climb.face + 0.5, a + (0.18 / climb.face) * Math.sin(y * 2.6), y));
    route.push(xyz(climb.face + 0.5, a, Math.max(0.35, climb.height - 0.5)));
    nodes[base].climbPath = [...route, ...route.slice(0, -1).reverse()];
    nodes[base].climbTarget = base;
    dest.push(base);
  }
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
    floorHeight: floorH,
    roofLevel,
    reachable
  };
}
// Offset occupants inside their destination so members of a group do not occupy one identical point.
function dwellPoint(n, a) {
  if (!n) return null;
  const base = n.p,
    phase =
      (a.i * 2.399963 +
        (a.kind === 'human' ? 0 : a.kind === 'dog' ? 1.3 : a.kind === 'bird' ? 2.8 : 4.1)) %
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
// Create a fresh simulation with its own seeded random stream and counters. Trials call this independently.
function makeOccupancy(m, seed = state.seed) {
  const graph = buildNavigation(m),
    rng = random((seed ^ 0x74b33ac) >>> 0),
    people = [],
    animals = [],
    skin = ['#e9c5a2', '#c39371', '#9e6b50', '#755039'],
    clothes = ['#597e9a', '#ba746e', '#71977b', '#967aaf', '#b69561', '#527f85'],
    hair = ['#54433b', '#65523b', '#9a7953', '#343332'],
    pick = (a) => a[Math.floor(rng() * a.length)];
  function make(kind, i, home) {
    const wheelchair = kind === 'human' && i % 9 === 2,
      child = kind === 'human' && i % 11 === 5,
      style =
        kind === 'human'
          ? {
              h: child ? 0.95 + rng() * 0.35 : 1.48 + rng() * 0.47,
              w: child ? 0.36 : 0.5 + rng() * 0.27,
              skin: pick(skin),
              cloth: pick(clothes),
              hair: pick(hair),
              stroll: (rng() - 0.5) * 0.4
            }
          : { s: 0.85 + rng() * 0.3, col: pick(['#a88d70', '#967b60', '#baa991', '#8d8172']) };
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
        : kind === 'human'
          ? 1 + rng() * 0.5
          : kind === 'dog'
            ? 1.25 + rng() * 0.45
            : kind === 'bird'
              ? 2.4 + rng()
              : 0.6 + rng() * 0.4,
      wait: rng() * 12,
      path: null,
      step: 0,
      depart: kind === 'human' || kind === 'dog' ? rng() * 170 + 95 : Infinity,
      active: true,
      lastProgram: null,
      lastRoom: null,
      funAt: -Infinity,
      home,
      visits: 0
    };
  }
  if (graph.entry != null) {
    const swing = graph.nodes.find((n) => n.kind === 'swing' && graph.reachable.has(n.id));
    const swingHasStairs = Boolean(m.feature.ride.roofPitch?.stairs);
    for (let i = 0; i < state.visitorCount; i++) {
      const home =
        i < Math.ceil(state.visitorCount * 0.25)
          ? pick(graph.outdoor.length ? graph.outdoor : [graph.entry])
          : pick(graph.dest.length ? graph.dest : [graph.entry]);
      const base = graph.nodes.find((n) => n.kind === 'climbBase');
      const visitor = make('human', i, base && i < 2 ? base.id : home);
      if (base && i < 2) visitor.depart = 360;
      // A visitor who uses a wheelchair starts on a reachable route below the stair.
      if (swingHasStairs && visitor.wheelchair && visitor.node === swing?.id) {
        visitor.home = visitor.node = graph.entry;
        visitor.p = [...graph.nodes[graph.entry].p];
      }
      if (swing && i >= 2 && i < 5 && (!swingHasStairs || !visitor.wheelchair)) {
        visitor.home = visitor.node = swing.id;
        visitor.p = [...swing.p];
        visitor.wait = 1 + i;
        visitor.depart = 350;
      }
      people.push(visitor);
    }
    for (let i = 0; i < 5; i++)
      animals.push(
        make(
          'dog',
          i,
          i < 2
            ? graph.entry
            : pick(
                graph.dest
                  .filter(
                    (n) =>
                      !['room', 'module', 'retail', 'slideStart', 'slideEnd', 'swing'].includes(
                        graph.nodes[n].kind
                      )
                  )
                  .concat(graph.entry)
              )
        )
      );
  }
  for (const [kind, n] of [
    ['bird', 9],
    ['rabbit', 5],
    ['squirrel', 5]
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
    stepBalance: 0
  };
}
// Find a route through circulation. Interior rooms and activity endpoints are destinations, rather than shortcuts.
function shortestPath(g, start, goal, kind, stairsAllowed = true) {
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
        'room',
        'module',
        'slideStart',
        'slideEnd',
        'swing',
        'retail',
        'garden',
        'balcony',
        'gazebo',
        'climbBase',
        'climbTop'
      ].includes(cur.kind)
    )
      continue;
    for (const e of g.edges[u]) {
      const v = e.to,
        b = g.nodes[v];
      if (done[v]) continue;
      if (e.kind === 'stairs' && !stairsAllowed) continue;
      if (kind !== 'human' && ['swing', 'slideStart', 'slideEnd'].includes(b.kind)) continue;
      const w = e.len + (e.kind === 'lift' ? 7 : 0);
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
function rememberDeparture(a, sim) {
  const n = sim.graph.nodes[a.node];
  if (['room', 'module', 'slideStart', 'slideEnd', 'retail'].includes(n.kind)) {
    a.lastRoom = n.id;
    a.lastProgram = n.program ?? null;
  }
}
function routeAgent(a, target, sim) {
  const path = shortestPath(sim.graph, a.node, target, a.kind, !a.wheelchair);
  if (!path || !path.length) return false;
  rememberDeparture(a, sim);
  let from = a.node;
  a.path = path.flatMap((e) => {
    const start = from;
    from = e.to;
    return e.path.slice(1).map((p) => ({
      p,
      speed: e.kind === 'lift' ? 1.5 : a.speed,
      kind: e.kind,
      from: start,
      to: e.to
    }));
  });
  a.path.unshift({
    p: [...sim.graph.nodes[a.node].p],
    speed: a.speed,
    kind: 'walk',
    from: a.node,
    to: a.node
  });
  const end = sim.graph.nodes[target];
  if (end.kind !== 'entry')
    a.path.push({ p: dwellPoint(end, a), speed: a.speed, kind: 'walk', from: target, to: target });
  a.step = 0;
  a.goal = target;
  return true;
}
// Pick an occupant’s next destination or activity after a dwell, with relationship and route preferences.
function chooseAgent(a, sim) {
  const g = sim.graph,
    r = sim.rng,
    n = g.nodes[a.node],
    pick = (arr) => arr[Math.floor(r() * arr.length)];
  if (a.kind === 'human' || a.kind === 'dog') {
    if (a.kind === 'human' && !a.wheelchair && n.kind === 'entry' && a.visits < 1 && r() < 0.22) {
      const base = g.nodes.find((v) => v.kind === 'climbBase');
      if (base && routeAgent(a, base.id, sim)) {
        a.depart = Math.max(a.depart, 480);
        return;
      }
    }
    if (a.kind === 'human' && n.kind === 'swing' && !a.rideDone && sim.clock - a.funAt > 90) {
      a.rideQueued = true;
      a.queueAt = sim.clock;
      a.depart = Math.max(a.depart, 150);
      a.wait = 0;
      return;
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
      a.kind === 'human' &&
      !a.wheelchair &&
      n.kind === 'climbBase' &&
      n.climbPath &&
      sim.clock - a.funAt > 30 &&
      r() < 0.92
    ) {
      a.path = [
        { p: [...n.p], speed: a.speed, kind: 'climb' },
        ...n.climbPath
          .slice(1)
          .map((p, i) => ({ p, speed: i < n.climbPath.length / 2 ? 0.55 : 1.15, kind: 'climb' }))
      ];
      a.step = 0;
      a.goal = n.climbTarget;
      a.onClimb = true;
      sim.fun++;
      sim.climbs = (sim.climbs || 0) + 1;
      return;
    }
    if (a.kind === 'human' && n.kind === 'slideStart' && r() < 0.65 && n.slidePath) {
      rememberDeparture(a, sim);
      a.path = n.slidePath.slice(1).map((p) => ({ p, speed: 6.2, kind: 'slide' }));
      a.step = 0;
      a.goal = n.slideTarget;
      a.onSlide = true;
      sim.fun++;
      return;
    }
    if (
      a.kind === 'human' &&
      ['room', 'module', 'slideStart', 'slideEnd'].includes(n.kind) &&
      n.program != null
    ) {
      const hubs = g.dest
        .filter((id) => {
          const h = g.nodes[id];
          return h.kind === 'hub' && h.f === n.f && h.pair.includes(n.program);
        })
        .sort(
          (i, j) => Math.hypot(...sub(g.nodes[i].p, n.p)) - Math.hypot(...sub(g.nodes[j].p, n.p))
        );
      if (hubs.length) {
        const h = g.nodes[hubs[0]],
          p = h.pair.find((x) => x !== n.program),
          weight = RELATIONSHIP_WEIGHT * relationMagnitude(n.program, p);
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
        a.kind === 'dog' &&
        ['room', 'module', 'slideStart', 'slideEnd', 'swing', 'retail'].includes(v.kind)
      )
        return false;
      return true;
    });
    for (let k = 0; k < 8 && allowed.length; k++) {
      let id;
      if (a.kind === 'human' && r() < 0.24) {
        const fun = allowed.filter((i) =>
          ['swing', 'slideStart', 'climbBase'].includes(g.nodes[i].kind)
        );
        id = fun.length ? pick(fun) : pick(allowed);
      } else if (r() < 0.7) {
        const local = allowed.filter((i) => g.nodes[i].f === n.f);
        id = local.length ? pick(local) : pick(allowed);
      } else id = pick(allowed);
      if (vRepels(n, g.nodes[id]) && r() < RELATIONSHIP_WEIGHT) continue;
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
function vRepels(a, b) {
  return (
    a.program != null &&
    b.program != null &&
    a.program !== b.program &&
    relationMode(a.program, b.program) === 'repel'
  );
}
// Use the same ride phase as the renderer to queue, seat, move, and unload simulated riders.
function advanceRide(s) {
  const ride = s.m.feature.ride,
    pose = swingPose(ride, s.clock),
    node = s.graph.nodes.find((n) => n.kind === 'swing');
  if (!node) return;
  const queue = s.people
    .filter((a) => a.active && a.rideQueued)
    .sort((a, b) => a.queueAt - b.queueAt || a.i - b.i);
  const carried = s.people.filter((a) => a.rideSeat != null);
  if (pose.phase === 'Unloading' || (pose.phase === 'Boarding' && s.rideRound !== pose.round)) {
    for (const a of carried) {
      a.rideSeat = null;
      a.rideDone = true;
      a.rideQueued = false;
      a.funAt = s.clock;
      a.wait = 3;
      a.p = dwellPoint(node, a);
      a.node = node.id;
      s.fun++;
      s.completedSwings = (s.completedSwings || 0) + 1;
    }
  }
  if (pose.phase === 'Boarding') {
    s.rideRound = pose.round;
    const taken = new Set(s.people.filter((a) => a.rideSeat != null).map((a) => a.rideSeat));
    for (const a of queue) {
      let seat = 0;
      while (taken.has(seat)) seat++;
      if (seat >= 18) break;
      a.rideQueued = false;
      a.rideSeat = seat;
      taken.add(seat);
    }
  }
  const platform = ride.platformRadius,
    inner = ride.towerRadius + 0.45,
    aa = Math.atan2(node.p[2], node.p[0]);
  let k = 0;
  for (const a of s.people) {
    if (a.rideSeat != null) {
      const theta = pose.angle + (a.rideSeat * TAU) / 18;
      a.p = [pose.rad * Math.cos(theta), pose.seatY + 0.24, pose.rad * Math.sin(theta)];
      a.angle = theta + Math.PI / 2;
      continue;
    }
    if (a.rideQueued) {
      if (a.queueAt == null) a.queueAt = s.clock;
      const radius = Math.max(inner, platform - 0.95 - (Math.floor(k / 5) % 3) * 0.82),
        theta = aa + ((k % 5) - 2) * Math.min(0.24, 0.8 / radius);
      a.p = [radius * Math.cos(theta), ride.roofLevel + 0.16, radius * Math.sin(theta)];
      a.angle = aa + Math.PI;
      k++;
    }
  }
}
// Step agent position, dwell, and activity state by simulation time.
function advanceOccupancy(s, dt) {
  if (!s) return;
  s.clock = (s.clock || 0) + dt;
  advanceRide(s);
  for (const a of [...s.people, ...s.animals]) {
    if (a.rideSeat != null || a.rideQueued) continue;
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
        a.rideDone = false;
        a.rideQueued = false;
        a.rideSeat = null;
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
            n.kind === 'hub'
              ? 8 + 25 * (a.social || 0.3) + s.rng() * 9
              : ['swing', 'climbBase', 'climbTop'].includes(n.kind)
                ? 18 + s.rng() * 8
                : ['room', 'module', 'slideStart', 'slideEnd', 'retail'].includes(n.kind)
                  ? 9 + s.rng() * 23
                  : ['garden', 'balcony', 'plaza', 'greenhouse', 'gazebo'].includes(n.kind)
                    ? 7 + s.rng() * 15
                    : 2 + s.rng() * 7;
          if (n.kind === 'hub') {
            s.gather++;
            a.social = 0;
          }
          if (n.kind === 'swing') {
            a.wait = 0;
            a.rideDone = false;
          }
          if (a.leaving && a.node === s.graph.entry) a.wait = 0.1;
        }
      }
    }
  }
}
// Cross-pollination: bounded pair encounters, measured in simulation time, not render frames.
const CP_LABELS = {
  hub: 'Shared lobby',
  room: 'Same room / module',
  garden: 'Garden / gazebo',
  plaza: 'Plaza / entrance lobby',
  balcony: 'Public balcony',
  greenhouse: 'Greenhouse',
  roof: 'Roof promenade',
  ride: 'Ride experience',
  corridor: 'Passing / circulation'
};
const CP_BONUSES = {
  memoryBonus: 'Different-room multiplier',
  programBonus: 'Different-program multiplier',
  funBonus: 'Recent fun multiplier',
  speciesBonus: 'Cross-species multiplier'
};
function newCrossScore() {
  return {
    points: 0,
    personSeconds: 0,
    encounters: 0,
    memory: 0,
    programs: 0,
    species: 0,
    crossSpecies: 0,
    fun: 0,
    by: Object.fromEntries(Object.keys(CP_LABELS).map((k) => [k, { points: 0, count: 0 }])),
    pairs: new Map()
  };
}
function scoreCategory(k) {
  return (
    {
      hub: 'hub',
      room: 'room',
      module: 'room',
      retail: 'room',
      slideStart: 'room',
      slideEnd: 'room',
      garden: 'garden',
      gazebo: 'garden',
      outdoor: 'garden',
      plaza: 'plaza',
      entry: 'plaza',
      lobby: 'plaza',
      balcony: 'balcony',
      greenhouse: 'greenhouse',
      roof: 'roof',
      swing: 'ride',
      climbBase: 'ride',
      climbTop: 'ride',
      corridor: 'corridor',
      lift: 'corridor',
      roofLink: 'corridor'
    }[k] || 'corridor'
  );
}
// Identify the spatial context used when crediting a nearby pair of agents.
function agentZone(a, s) {
  const g = s.graph;
  if (!a.path) return g.nodes[a.node];
  const t = a.path[a.step];
  if (!t || ['slide', 'climb'].includes(t.kind)) return null;
  if (t.kind === 'lift') return null;
  const [x, y, z] = a.p,
    r = Math.hypot(x, z),
    theta = mod(Math.atan2(z, x), TAU),
    f = Math.min(g.roofLevel, Math.max(0, Math.round((y - 0.54) / g.floorHeight)));
  const ids = [t.from, t.to].filter((i) => i != null);
  for (const i of ids) {
    const n = g.nodes[i],
      c = n.cell;
    if (
      c &&
      c.f === f &&
      r >= c.r - 0.01 &&
      r <= c.R + 0.01 &&
      [theta, theta + TAU, theta - TAU].some((t) => t >= c.start - 1e-6 && t <= c.end + 1e-6)
    )
      return n;
  }
  // Routes outside the room cells include the greenhouse crossing and exterior approaches.
  for (const i of ids) {
    const n = g.nodes[i];
    if (
      !n.cell &&
      [
        'entry',
        'plaza',
        'greenhouse',
        'corridor',
        'outdoor',
        'garden',
        'balcony',
        'gazebo',
        'module',
        'retail',
        'swing',
        'climbBase',
        'climbTop'
      ].includes(n.kind) &&
      Math.hypot(...sub(a.p, n.p)) <= 2.5
    )
      return n;
  }
  return null;
}
function compatibleZones(a, b, g) {
  if (!a || !b || a.f !== b.f) return false;
  if (a.id === b.id) return true;
  const ca = scoreCategory(a.kind),
    cb = scoreCategory(b.kind);
  if (ca !== cb || !['corridor', 'plaza', 'roof', 'garden', 'greenhouse'].includes(ca))
    return false;
  return g.edges[a.id].some((e) => e.to === b.id && e.kind !== 'lift');
}
// Credit eligible pair encounters up to the duration cap and accumulate active-agent time for normalization.
function scoreSample(s, dt) {
  const q = s.score,
    agents = [...s.people, ...s.animals].filter((a) => a.active),
    zones = agents.map((a) => agentZone(a, s));
  q.personSeconds += agents.length * dt;
  for (let i = 0; i < agents.length; i++)
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i],
        b = agents[j],
        za = zones[i],
        zb = zones[j];
      if (!compatibleZones(za, zb, s.graph) || Math.hypot(...sub(a.p, b.p)) > 2.5) continue;
      const key = a.kind + ':' + a.i + '|' + b.kind + ':' + b.i,
        category = scoreCategory(za.kind);
      let pair = q.pairs.get(key);
      const fresh = !pair || s.clock - pair.last > 8;
      if (fresh) {
        pair = { last: s.clock, credited: 0, flags: {}, category };
        q.pairs.set(key, pair);
        q.encounters++;
        q.by[category].count++;
      }
      pair.last = s.clock;
      const credit = Math.min(dt, 15 - pair.credited);
      if (credit <= 0) continue;
      pair.credited += credit;
      const memory = a.lastRoom != null && b.lastRoom != null && a.lastRoom !== b.lastRoom,
        programs =
          a.lastProgram != null && b.lastProgram != null && a.lastProgram !== b.lastProgram,
        species = (a.kind === 'human') !== (b.kind === 'human'),
        crossSpecies = a.kind !== b.kind,
        fun = [a, b].some((v) => s.clock >= v.funAt && s.clock - v.funAt < 90);
      for (const [k, v] of Object.entries({ memory, programs, species, crossSpecies, fun }))
        if (v && !pair.flags[k]) {
          pair.flags[k] = true;
          q[k]++;
        }
      const multiplier =
          (memory ? state.memoryBonus : 1) *
          (programs ? state.programBonus : 1) *
          (crossSpecies ? state.speciesBonus : 1) *
          (fun ? state.funBonus : 1),
        points = ((state.encounterWeights[category] * credit) / 10) * multiplier;
      q.points += points;
      q.by[category].points += points;
    }
  for (const [k, v] of q.pairs) if (s.clock - v.last > 9) q.pairs.delete(k);
}
// Use fixed quarter-second movement steps and sample encounters once per simulated second.
function advanceScored(s, dt) {
  s.stepBalance += dt;
  while (s.stepBalance >= 0.25 - 1e-8) {
    advanceOccupancy(s, 0.25);
    s.stepBalance -= 0.25;
    s.sampleClock += 0.25;
    if (s.sampleClock >= 1) {
      scoreSample(s, 1);
      s.sampleClock = 0;
    }
  }
}
function tickOccupancy(dt) {
  if (occupancy) advanceScored(occupancy, Math.min(dt, 0.6) * state.simSpeed);
}
// Normalize credited points per 100 active-agent-minutes.
function crossRate(s) {
  return s?.score.personSeconds > 0 ? (s.score.points * 6000) / s.score.personSeconds : 0;
}
let cpRendered = null,
  cpRenderedSecond = -1;
function renderCrossScore() {
  const s = occupancy;
  if (!s) return;
  $('cpNoEntry').hidden = s.graph.entry != null;
  const status = $('cpLiveStatus');
  status.textContent = !state.simRunning ? 'Paused' : s.clock < 15 ? 'Warming up' : 'Live';
  status.dataset.paused = String(!state.simRunning);
  const second = Math.floor(s.clock);
  if (s === cpRendered && second === cpRenderedSecond) return;
  cpRendered = s;
  cpRenderedSecond = second;
  const q = s.score;
  $('cpScore').textContent = s.clock < 15 ? '—' : crossRate(s).toFixed(1);
  for (const [id, k] of [
    ['cpEncounters', 'encounters'],
    ['cpMemory', 'memory'],
    ['cpPrograms', 'programs'],
    ['cpSpecies', 'species'],
    ['cpCrossSpecies', 'crossSpecies'],
    ['cpFun', 'fun']
  ])
    $(id).textContent = q[k];
  $('cpTime').textContent = Math.floor(s.clock / 60) + 'm ' + Math.floor(s.clock % 60) + 's';
  $('cpDashTime').textContent = $('cpTime').textContent;
  $('cpDashEncounters').textContent = q.encounters;
  $('cpDashMemory').textContent = q.memory;
  $('cpDashSpecies').textContent = q.crossSpecies;
  $('cpBreakdown').innerHTML = Object.entries(CP_LABELS)
    .map(([k, label]) => {
      const v = q.by[k];
      return `<div class="cp-row"><span>${label} · ${v.count}</span><b style="text-align:right">${v.points.toFixed(1)}</b><div class="cp-track"><i style="width:${q.points ? (v.points / q.points) * 100 : 0}%"></i></div></div>`;
    })
    .join('');
}
const CP_TRIAL_SECONDS = 5 * 60;
const CP_OPTIMIZATION_BUTTONS = {
  layout: ['cpOptimize', 'Optimize layout'],
  allocation: ['cpOptimizeAllocation', 'Optimize allocation']
};
let cpHistory = [],
  cpTrialActive = null,
  cpTrialNotice = '',
  cpOptimization = null,
  cpOptimizationChoice = null;
// Identify comparable trial settings while allowing the architecture to vary between trials.
function cpSignature() {
  return JSON.stringify({
    seed: state.seed,
    visitors: state.visitorCount,
    weights: state.encounterWeights,
    memory: state.memoryBonus,
    program: state.programBonus,
    fun: state.funBonus,
    species: state.speciesBonus
  });
}
function refreshTrialDashboard() {
  const t = cpHistory[0],
    label = cpTrialActive ? 'Cancel trial' : 'Run Pollination Trial',
    status = cpTrialActive
      ? 'Simulating 5 min · ' + Math.floor((cpTrialActive.clock / CP_TRIAL_SECONDS) * 100) + '%'
      : cpTrialNotice,
    result = t
      ? 'Last trial · ' +
        t.rate.toFixed(1) +
        (t.signature === cpSignature() ? '' : ' · different settings')
      : '';
  $('cpQuickTrial').textContent = label;
  $('cpTrial').textContent = label;
  $('cpQuickTrial').disabled = $('cpTrial').disabled = Boolean(cpOptimization);
  for (const [mode, [id, title]] of Object.entries(CP_OPTIMIZATION_BUTTONS)) {
    const running = cpOptimization?.mode === mode;
    $(id).disabled = Boolean(cpTrialActive || (cpOptimization && !running));
    $(id).textContent = running ? 'Cancel search' : title;
  }
  $('cpDashTrialResult').textContent = status || result || '5 simulated minutes';
  $('cpTrialStatus').textContent = status || '5 simulated minutes';
  if (cpOptimizationChoice && !isCurrentLayoutSearch(cpOptimizationChoice)) {
    cpOptimizationChoice = null;
    $('cpOptimizationResult').hidden = true;
    setOptimizationStatus('Settings changed. Run a new search to compare.');
  }
}
// Capture realized dimensions and program allocations alongside the inputs used for the trial.
function trialLayout(model, trial) {
  const { lobby, circulation, roofPlan, feature } = model;
  return {
    enclosed: model.total,
    floorHeight: model.floorHeight,
    footprint: Math.PI * model.R ** 2,
    width: model.width,
    lobby: lobby.area,
    bridges: circulation.bridges.length,
    entry: trial.graph.entry != null,
    corridors: circulation.corridorArea,
    plaza: model.plaza.area,
    roof: roofPlan.publicArea,
    slide: feature.slide?.run ?? 0,
    climb: feature.climbing?.height ?? 0,
    conflicts: model.repelConflicts,
    coreAreas: model.core.slice(),
    moduleCounts: model.counts.slice(),
    vacancyCounts: model.vacancyCounts.slice()
  };
}

// Render the whole model with consistent framing and camera angle for each trial.
function captureTrialThumbnail(model) {
  try {
    const image = document.createElement('canvas');
    const renderer = createSoftwareRenderer(image);
    if (!renderer) return null;
    const view = {
      ...state,
      inspect: 0,
      xray: false,
      grid: false,
      showRooms: true,
      showModules: true,
      showFacade: true,
      showRoofDeck: true,
      roof: true
    };
    const mesh = buildMesh(model, false, view);
    const viewCamera = { az: -0.84, el: 0.57, zoom: 0.86, pan: -12 };
    paintSoftware(mesh, renderer, viewCamera, { clientWidth: 384, clientHeight: 216 }, 1);
    return image.toDataURL('image/webp', 0.82);
  } catch (error) {
    console.warn('Trial thumbnail unavailable', error);
    return null;
  }
}

function trialValue(value, unit = '', digits = 1) {
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString('en-CA', { maximumFractionDigits: digits }) + unit;
}

// Read historical inputs from the record, including older records that only contain settings.
function trialLogSections(record) {
  const settings = record.settings ?? {};
  const layout = record.layout ?? {};
  const area = (value) => trialValue(value, ' m²', 0);
  const metres = (value) => trialValue(value, ' m');
  const percent = (value) => trialValue(value, '%');
  const mode =
    typeof settings.autoCore === 'boolean' ? (settings.autoCore ? 'Auto' : 'Manual') : null;
  const inputs = {
    'Trial setup': {
      'Variation seed': trialValue(record.seed),
      'Human visitor setting': trialValue(record.visitors),
      'Trial duration': '5 simulated minutes'
    },
    Massing: {
      Floors: trialValue(settings.floors),
      'Concrete slab depth': trialValue(settings.slabThickness, ' m', 2),
      'Core sizing': mode,
      'Enclosed area cap': area(settings.areaCap),
      'Footprint setting': mode === 'Auto' ? 'Auto' : area(settings.footprint),
      'Preferred ring width': metres(settings.ringWidth),
      'Minimum room area setting': area(settings.minRoomArea),
      'Modules requested': trialValue(settings.modules),
      'Module arrangement': settings.dockVariant ? 'Variation ' + settings.dockVariant : 'Original'
    },
    'Circulation and play': {
      'Combined lobby area setting': area(settings.lobby),
      'Atrium bridge arrangement': BRIDGE_MODES[settings.atriumBridges ?? 'off'],
      'Preferred corridor width': metres(settings.corridorWidth),
      'Slide length setting': percent(settings.slideLength),
      'Climbing width': settings.climbWidth === 0 ? 'Off' : metres(settings.climbWidth)
    },
    'Program allocation': {
      'Core / module exchanges': trialValue(settings.allocationMoves?.length ?? 0)
    },
    'Vacant docks': {},
    'Program relationships': {
      'Clustering strength': percent(settings.affinity),
      'Clustered programs': Array.isArray(settings.cluster)
        ? PROGRAMS.filter((_, i) => settings.cluster[i])
            .map((program) => program.name)
            .join(', ') || 'None'
        : null,
      'Core program mixing': percent(settings.mix)
    },
    'Programming edits': {},
    'Scoring weights': Object.fromEntries(
      Object.entries(CP_LABELS).map(([key, label]) => [
        label,
        trialValue(settings.encounterWeights?.[key], '', 2)
      ])
    )
  };
  const model = {
    Massing: {
      'Enclosed area used': area(layout.enclosed),
      'Floor-to-floor height': trialValue(layout.floorHeight, ' m', 2),
      'Outer footprint': area(layout.footprint),
      'Actual ring width': metres(layout.width),
      'Core and greenhouse area': area(record.core),
      'Core rooms': trialValue(record.rooms),
      'Modules installed': trialValue(record.modules)
    },
    'Circulation and play': {
      'Lobby area built': area(layout.lobby),
      'Atrium bridges built': trialValue(layout.bridges),
      'Usable visitor entrance':
        typeof layout.entry === 'boolean' ? (layout.entry ? 'Yes' : 'No') : null,
      'Corridor area': area(layout.corridors),
      'Shared lobbies': trialValue(record.hubs),
      'Exterior plaza': area(layout.plaza),
      'Public roof': area(layout.roof),
      'Slide built': layout.slide === 0 ? 'Off' : metres(layout.slide),
      'Climbing height': metres(layout.climb)
    },
    'Program allocation': {},
    'Vacant docks': {},
    'Program relationships': { 'Same-floor Repel conflicts': trialValue(layout.conflicts) }
  };
  const encounters = {
    Encounters: {
      'Total encounters': trialValue(record.encounters),
      'Different previous rooms': trialValue(record.cross),
      'Different previous programs': trialValue(record.programEncounters),
      'Human / non-human': trialValue(record.species),
      'Different agent kinds': trialValue(record.kindEncounters),
      'Recent play': trialValue(record.funEncounters),
      'Active visitor-minutes': trialValue(record.visitorMinutes)
    }
  };
  for (const [index, program] of PROGRAMS.entries()) {
    inputs['Program allocation'][program.name + ' · core preference'] = percent(
      settings.split?.[index]
    );
    model['Program allocation'][program.name + ' · built core'] = area(layout.coreAreas?.[index]);
    model['Program allocation'][program.name + ' · installed modules'] = trialValue(
      layout.moduleCounts?.[index]
    );
  }
  VACANCY.forEach((use, i) => {
    inputs['Vacant docks'][use.name + ' · preference'] = percent(settings.vacancy?.[i]);
    model['Vacant docks'][use.name + ' · slots'] = trialValue(layout.vacancyCounts?.[i]);
  });
  if (settings.relations) {
    for (const [i, program] of PROGRAMS.entries())
      for (let j = i + 1; j < PROGRAMS.length; j++) {
        const savedMode = settings.relations[relationKey(i, j)];
        const relationship =
          typeof savedMode === 'string' && Object.hasOwn(MODES, savedMode) ? savedMode : 'neutral';
        const points = settings.points;
        const positioned = [points?.[i], points?.[j]].every(
          (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
        );
        const weight =
          relationship !== 'neutral' && positioned
            ? ' · ' + percent(100 * relationMagnitude(i, j, points))
            : '';
        inputs['Program relationships'][program.short + ' / ' + PROGRAMS[j].short] =
          MODES[relationship].name + weight;
      }
  }
  for (const [key, program] of Object.entries(settings.roomPrograms ?? {})) {
    const [, floor, band, angle] = key.split(':').map(Number);
    if (Number.isFinite(angle) && PROGRAMS[program])
      inputs['Programming edits'][
        `Room L${floor + 1}, band ${band + 1}, ${Math.round((angle * 180) / Math.PI)}°`
      ] = PROGRAMS[program].name;
  }
  for (const [key, edit] of Object.entries(settings.modulePrograms ?? {})) {
    const [, floor, dock] = key.split(':').map(Number);
    if (Number.isFinite(dock) && PROGRAMS[edit?.program])
      inputs['Programming edits'][`Dock ${dock + 1}, L${floor + 1}`] =
        (edit.from === null ? 'Added ' : '') + PROGRAMS[edit.program].name;
  }
  for (const [key, label] of Object.entries(CP_BONUSES))
    inputs['Scoring weights'][label] = trialValue(settings[key], '×', 2);
  return { settings: inputs, model, encounters };
}

function trialElement(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function trialThumbnailSource(data) {
  // Only display bounded, self-contained raster images from saved logs.
  return typeof data === 'string' &&
    data.length <= 150000 &&
    /^data:image\/(?:webp|png);base64,[a-z0-9+/=]+$/i.test(data)
    ? data
    : '';
}

// Flag practical score changes only between trials with matching simulation and scoring inputs.
function appendTrialScoreChange(result, record, previous) {
  if (record.signature !== previous.signature) {
    result.append(trialElement('small', 'Trial settings changed'));
    return;
  }
  const delta = Number(record.rate.toFixed(1)) - Number(previous.rate.toFixed(1));
  if (!delta) {
    result.append(trialElement('small', 'No score change'));
    return;
  }
  const major = Math.abs(record.rate - previous.rate) >= Math.max(5, previous.rate * 0.1);
  const direction = delta > 0 ? 'increase' : 'decrease';
  const label = trialElement(
    'span',
    (major ? 'Major ' : 'Minor ') + direction,
    'trial-score-change'
  );
  label.dataset.direction = direction;
  label.title = 'Major means at least 10% and 5 points versus the previous trial.';
  const signedDelta = (delta > 0 ? '+' : '−') + Math.abs(delta).toFixed(1);
  result.append(label, trialElement('small', signedDelta + ' pts vs previous'));
}

// Older trials can lack some fields. Only compare values recorded in both runs, except for added or removed edits.
function renderTrialDiffGroup(name, title, sections, previousSections) {
  const group = trialElement('div', '', 'trial-diff-group trial-diff-' + name);
  group.append(trialElement('h4', title));
  for (const [section, fields] of Object.entries(sections)) {
    const list = trialElement('dl');
    const previous = previousSections?.[section];
    const edits = section === 'Programming edits';
    const keys =
      edits && previous
        ? new Set([...Object.keys(fields), ...Object.keys(previous)])
        : Object.keys(fields);
    for (const key of keys) {
      const after = fields[key] ?? (edits ? 'None' : null);
      const before = previous?.[key] ?? (edits ? 'None' : null);
      if (after == null || (previousSections && (before == null || before === after))) continue;
      const value = trialElement('dd');
      if (previousSections) {
        value.append(
          trialElement('span', before, 'trial-before'),
          trialElement('span', ' → ', 'trial-arrow'),
          trialElement('strong', after, 'trial-after')
        );
      } else value.textContent = after;
      list.append(trialElement('dt', key), value);
    }
    if (!list.children.length) continue;
    if (name !== 'encounters') group.append(trialElement('h5', section));
    group.append(list);
  }
  return group.childElementCount > 1 ? group : null;
}

// Compare with the immediately preceding entry. Score deltas require matching trial settings.
function renderTrialEntry(record, previous, index) {
  const card = trialElement('article', '', 'trial-entry');
  const header = trialElement('div', '', 'trial-entry-head');
  const thumbnail = trialThumbnailSource(record.thumbnail);
  if (thumbnail) {
    const image = trialElement('img', '', 'trial-thumbnail');
    image.src = thumbnail;
    image.alt = 'Massing model at the time of this trial';
    header.append(image);
  }
  const result = trialElement('div');
  const number = Number.isSafeInteger(record.number) ? record.number : cpHistory.length - index;
  result.append(trialElement('h3', `Trial ${number}${previous ? '' : ' · Baseline'}`));
  result.append(trialElement('strong', record.rate.toFixed(1), 'trial-rate'));
  result.append(trialElement('small', 'pts / 100 visitor-min'));
  if (previous) appendTrialScoreChange(result, record, previous);
  header.append(result);
  card.append(header);
  const details = trialElement('details', '', 'trial-changes');
  details.classList.toggle('trial-comparison', Boolean(previous));
  details.open = index === 0;
  details.append(trialElement('summary', previous ? 'What changed' : 'Baseline details'));
  const current = trialLogSections(record);
  const prior = previous ? trialLogSections(previous) : null;
  const groupTitles = {
    settings: previous ? 'Settings changed' : 'Trial settings',
    model: previous ? 'Changes in the model' : 'Generated layout',
    encounters: previous ? 'Changes in encounters' : 'Encounters'
  };
  for (const [name, title] of Object.entries(groupTitles)) {
    const group = renderTrialDiffGroup(name, title, current[name], prior?.[name]);
    if (group) details.append(group);
  }
  if (details.childElementCount === 1)
    details.append(trialElement('p', 'No recorded changes.', 'hint'));
  card.append(details);
  return card;
}

// History runs newest first. Compare each card with the trial immediately before it.
function renderTrials() {
  refreshTrialDashboard();
  const entries = cpHistory.map((record, index) =>
    renderTrialEntry(record, cpHistory[index + 1], index)
  );
  $('cpHistory').replaceChildren(...entries);
  $('cpClear').hidden = !entries.length;
}
// Bind the live dashboard and the independent five-minute trial controls.
function initCrossUI() {
  const root = $('cpWeights'),
    rows = Object.entries(CP_LABELS)
      .map(([key, label]) => ({ key, label, min: 0, max: 10, step: 0.25, weight: true }))
      .concat(
        Object.entries(CP_BONUSES).map(([key, label]) => ({
          key,
          label,
          min: 1,
          max: 3,
          step: 0.1
        }))
      );
  root.innerHTML = '';
  for (const r of rows) {
    const label = document.createElement('label');
    label.textContent = r.label;
    const num = document.createElement('input');
    num.type = 'number';
    num.min = r.min;
    num.max = r.max;
    num.step = r.step;
    num.setAttribute('aria-label', r.label);
    const value = () => (r.weight ? state.encounterWeights[r.key] : state[r.key]);
    num.value = value();
    label.append(num);
    root.append(label);
    num.onchange = () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v)) {
        num.value = value();
        return;
      }
      if (r.weight) state.encounterWeights[r.key] = clamp(v, r.min, r.max);
      else state[r.key] = clamp(v, r.min, r.max);
      num.value = value();
      if (model) {
        occupancy = makeOccupancy(model);
        refreshPopulation();
        draw();
      }
      refreshTrialDashboard();
      queueSave();
    };
  }
  renderTrials();
}

$('cpClear').onclick = () => {
  cpHistory = [];
  cpTrialNotice = '';
  renderTrials();
  queueSave();
};

function finishTrial(notice = '') {
  cpTrialActive = null;
  cpTrialNotice = notice;
  renderTrials();
}

// Yield during fixed-step trials so both the regular trial and the layout search can be cancelled.
async function advanceTrialBatches(trial, isCurrent, onProgress = () => {}) {
  while (trial.clock < CP_TRIAL_SECONDS) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!isCurrent()) return false;
    const deadline = performance.now() + 24;
    do {
      advanceScored(trial, 1);
    } while (trial.clock < CP_TRIAL_SECONDS && performance.now() < deadline);
    onProgress();
  }
  return true;
}

async function toggleTrial() {
  if ($('trialDrawer').hidden) openMassingDrawer($('trialDrawer'));
  if (cpOptimization) return;
  if (cpTrialActive) {
    finishTrial('Trial cancelled.');
    return;
  }
  try {
    // Clicking a trial button can commit a number field and queue a layout on the same click.
    if (pending) {
      cancelAnimationFrame(pending);
      update();
    }
    if (!model) return;
    const trialModel = model,
      signature = cpSignature(),
      trial = makeOccupancy(trialModel);
    cpTrialActive = trial;
    refreshTrialDashboard();
    const completed = await advanceTrialBatches(
      trial,
      () =>
        cpTrialActive === trial && !pending && model === trialModel && signature === cpSignature(),
      refreshTrialDashboard
    );
    if (!completed) {
      if (cpTrialActive === trial) finishTrial('Trial cancelled because the settings changed.');
      return;
    }
    const score = trial.score;
    const previousNumber = cpHistory[0]?.number;
    cpHistory.unshift({
      number: (Number.isSafeInteger(previousNumber) ? previousNumber : cpHistory.length) + 1,
      rate: crossRate(trial),
      rooms: trialModel.rooms.length,
      modules: trialModel.count,
      hubs: trialModel.circulation.hubs.length,
      core: Math.round(trialModel.ringArea + trialModel.circulation.bridgeArea + trialModel.court),
      encounters: score.encounters,
      cross: score.memory,
      species: score.species,
      programEncounters: score.programs,
      kindEncounters: score.crossSpecies,
      funEncounters: score.fun,
      visitorMinutes: score.personSeconds / 60,
      signature,
      seed: state.seed,
      visitors: state.visitorCount,
      settings: JSON.parse(JSON.stringify(state)),
      layout: trialLayout(trialModel, trial),
      thumbnail: captureTrialThumbnail(trialModel),
      breakdown: score.by
    });
    cpHistory = cpHistory.slice(0, 8);
    $('trialDrawer').scrollTop = 0;
    finishTrial();
    queueSave();
  } catch (error) {
    console.error('Cross-pollination trial failed', error);
    finishTrial('Trial failed. Try again.');
  }
}
$('cpQuickTrial').onclick = toggleTrial;
$('cpTrial').onclick = toggleTrial;

const CP_LAYOUT_ALTERNATIVES = 8;
const ALLOCATION_EXCHANGE_LIMIT = 3;

function programBuiltArea(layout, program) {
  return layout.core[program] + layout.counts[program] * MODULE.area;
}

function preservesProgramAreas(candidate, original) {
  return (
    Math.abs(candidate.total - original.total) <= 0.01 &&
    PROGRAMS.every(
      (_, i) => Math.abs(programBuiltArea(candidate, i) - programBuiltArea(original, i)) <= 0.01
    )
  );
}

function allocationProposals(original) {
  const moves = [];
  for (const floor of original.layers)
    for (const band of floor)
      for (let i = 1; i < band.length; i++) {
        const left = band[i - 1];
        const right = band[i];
        if (!exchangeableRooms(left, right)) continue;
        for (const [donor, receiver, direction] of [
          [left, right, 1],
          [right, left, -1]
        ]) {
          const limit = Math.min(
            ALLOCATION_EXCHANGE_LIMIT,
            original.counts[receiver.id],
            Math.floor((donor.area - state.minRoomArea + 1e-7) / MODULE.area)
          );
          for (let modules = 1; modules <= limit; modules++) {
            const counts = original.counts.slice();
            counts[donor.id] += modules;
            counts[receiver.id] -= modules;
            moves.push({
              key: counts.join(','),
              move: {
                left: left.editKey,
                right: right.editKey,
                leftProgram: left.id,
                rightProgram: right.id,
                count: modules * direction
              }
            });
          }
        }
      }
  // Visit the first candidate for each distinct allocation before trying alternate walls.
  const first = new Map();
  const alternatives = [];
  for (const proposal of moves) {
    if (first.has(proposal.key)) alternatives.push(proposal);
    else first.set(proposal.key, proposal);
  }
  return [...first.values(), ...alternatives];
}

// A candidate changes only the module solver's random stream. Rooms, quotas and topology stay fixed.
function eligibleModuleLayout(candidate, original) {
  const sameArea = (a, b) => Math.abs(a - b) <= 0.01;
  return (
    sameArea(candidate.total, original.total) &&
    original.core.every((area, i) => sameArea(area, candidate.core[i])) &&
    original.counts.every((count, i) => count === candidate.counts[i]) &&
    candidate.repelConflicts === 0 &&
    candidate.firehallUnplaced === 0 &&
    candidate.firehallOmitted.size === 0 &&
    original.slots.every(
      (slot) =>
        !slot.editKey ||
        (candidate.slots[slot.i]?.editKey === slot.editKey && candidate.slots[slot.i].p === slot.p)
    )
  );
}

function isCurrentLayoutSearch(search) {
  return !pending && model === search.original && cpSignature() === search.signature;
}

function setOptimizationStatus(message) {
  const status = $('cpOptimizeStatus');
  status.textContent = message;
  status.hidden = !message;
}

function finishLayoutSearch(message) {
  cpOptimization = null;
  setOptimizationStatus(message);
  refreshTrialDashboard();
}

async function meanLayoutRate(layout, seeds, isCurrent) {
  let sum = 0;
  for (const seed of seeds) {
    if (!isCurrent()) return null;
    const trial = makeOccupancy(layout, seed);
    if (trial.graph.entry == null || !(await advanceTrialBatches(trial, isCurrent))) return null;
    sum += crossRate(trial);
  }
  return sum / seeds.length;
}

function showLayoutSuggestion(search, best, currentRate, seedCount) {
  const allocation = search.mode === 'allocation';
  const title = allocation ? 'Suggested allocation' : 'Suggested module layout';
  $('cpOptimizationTitle').textContent = title;
  $('cpApplyLayout').textContent = allocation ? 'Apply allocation' : 'Apply layout';
  const image = $('cpOptimizationThumbnail');
  image.alt = title;
  const thumbnail = trialThumbnailSource(captureTrialThumbnail(best.layout));
  if (thumbnail) image.src = thumbnail;
  image.hidden = !thumbnail;
  $('cpOptimizationScores').textContent =
    currentRate.toFixed(1) +
    ' → ' +
    best.rate.toFixed(1) +
    ' pts / 100 visitor-min · average of ' +
    seedCount +
    ' matched trials';
  const ratios = $('cpOptimizationRatios');
  ratios.replaceChildren();
  ratios.hidden = !allocation;
  if (allocation) {
    const split = (layout, i) => ((100 * layout.core[i]) / programBuiltArea(layout, i)).toFixed(1);
    for (const [i, program] of PROGRAMS.entries()) {
      if (search.original.counts[i] === best.layout.counts[i]) continue;
      ratios.append(
        trialElement('dt', program.name),
        trialElement('dd', split(search.original, i) + '% → ' + split(best.layout, i) + '% core')
      );
    }
  }
  cpOptimizationChoice = { ...search, variant: best.variant, move: best.move };
  $('cpOptimizationResult').hidden = false;
}

async function optimizeDesign(mode) {
  if (cpOptimization) {
    if (cpOptimization.mode !== mode) return;
    finishLayoutSearch('Layout search cancelled.');
    return;
  }
  if (cpTrialActive) return;
  cpOptimizationChoice = null;
  $('cpOptimizationResult').hidden = true;
  let search = null;
  let message = 'Layout search stopped because the settings changed.';
  try {
    if (pending) {
      cancelAnimationFrame(pending);
      update();
    }
    if (!model?.count) {
      message = 'The model needs modules to search for alternate placements.';
      return;
    }
    const original = model;
    search = { original, signature: cpSignature(), mode };
    const isCurrent = () => cpOptimization === search && isCurrentLayoutSearch(search);
    const seeds = [state.seed, (state.seed ^ 0x9e3779b9) >>> 0, (state.seed ^ 0x85ebca6b) >>> 0];
    const proposals =
      mode === 'allocation'
        ? allocationProposals(original)
        : Array.from({ length: CP_LAYOUT_ALTERNATIVES }, (_, i) => ({
            variant: (state.dockVariant + i + 1) >>> 0
          }));
    cpOptimization = search;
    $('trialDrawer').scrollTop = 0;
    setOptimizationStatus('Scoring your current design…');
    refreshTrialDashboard();
    const currentRate = await meanLayoutRate(original, seeds, isCurrent);
    if (!isCurrent()) return;
    if (currentRate == null) {
      message = 'The model needs a usable entrance to compare visitor encounters.';
      return;
    }
    const candidateKey = (layout) =>
      mode === 'allocation'
        ? layout.counts.join(',')
        : layout.slots.map((slot) => slot.p).join(',');
    const seen = new Set([candidateKey(original)]);
    let best = null;
    let checked = 0;
    let attempts = 0;
    for (const proposal of proposals) {
      if (checked >= CP_LAYOUT_ALTERNATIVES || attempts >= 4 * CP_LAYOUT_ALTERNATIVES) break;
      if (proposal.key && seen.has(proposal.key)) continue;
      attempts++;
      setOptimizationStatus(
        'Looking for eligible ' + (mode === 'allocation' ? 'allocations…' : 'placements…')
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!isCurrent()) return;
      const layout = proposal.move
        ? applyAllocationMoves(original, [proposal.move], state.dockVariant)
        : derive(proposal.variant);
      const eligible = proposal.move
        ? layout && preservesProgramAreas(layout, original)
        : eligibleModuleLayout(layout, original);
      if (!eligible) continue;
      const key = candidateKey(layout);
      if (seen.has(key)) continue;
      seen.add(key);
      setOptimizationStatus(
        'Scoring ' + (mode === 'allocation' ? 'allocation ' : 'placement ') + (checked + 1) + '…'
      );
      const rate = await meanLayoutRate(layout, seeds, isCurrent);
      if (!isCurrent()) return;
      if (rate == null) continue;
      checked++;
      if (!best || rate > best.rate) best = { ...proposal, layout, rate };
    }
    if (!best) {
      message = 'No alternative met the area and topology constraints.';
    } else if (Number(best.rate.toFixed(1)) <= Number(currentRate.toFixed(1))) {
      message = 'Your layout matched or beat the ' + checked + ' eligible alternatives.';
    } else {
      showLayoutSuggestion(search, best, currentRate, seeds.length);
      message = 'Found an improvement among ' + checked + ' eligible alternatives.';
    }
  } catch (error) {
    console.error('Design search failed', error);
    message = 'Layout search failed. Try again.';
  } finally {
    if (!search || cpOptimization === search) finishLayoutSearch(message);
  }
}

for (const [mode, [id]] of Object.entries(CP_OPTIMIZATION_BUTTONS))
  $(id).onclick = () => optimizeDesign(mode);
$('cpApplyLayout').onclick = () => {
  const choice = cpOptimizationChoice;
  if (!choice || cpTrialActive || cpOptimization || !isCurrentLayoutSearch(choice)) return;
  cpOptimizationChoice = null;
  $('cpOptimizationResult').hidden = true;
  if (choice.move) state.allocationMoves = [...state.allocationMoves, choice.move];
  else state.dockVariant = choice.variant;
  update();
  setOptimizationStatus(
    choice.move ? 'Suggested allocation applied.' : 'Suggested module layout applied.'
  );
  toggleTrial();
};
