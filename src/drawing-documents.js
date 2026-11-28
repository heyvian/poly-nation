'use strict';

const DRAWING_DOCUMENTS = ['programme', 'circulation', 'lobbies', 'structure', 'cranes', 'site-sections'];
const PROGRAMME_DRAWING_PAPER = { width: 17, height: 11 };
const SITE_SECTION_PAPER = { width: 17, height: 11 };
const LOBBY_DRAWING_SCALES = [25, 50, 75, 100, 125, 150, 200, 250, 500];
const CRANE_DRAWING_PAPER = { width: 17, height: 11 };
const CRANE_STUDY_GUIDE = {
  elevated: 'The outboard tower rolls on twin steel ring girders. Spaced piers leave crossings below the runway.',
  moat: 'The tower rolls over a continuous moat. At each lobby, a 10 m clear drawbridge lifts for gantry travel.',
  cantilever: 'The outer roof rail takes compression. Captured rollers engage the inner rail against uplift.'
};
const CRANE_STUDY_STAGES = [
  ['pickup', 'Ground pickup', 'Four independent lift heads pin into the cassette chassis.'],
  ['hoist', 'Hoist outside the stack', 'The 5.9 m cable spread clears the sides of the 4.5 m cassette.'],
  ['transfer', 'Engage the permanent guides', 'The trolley feeds the nose onto fixed rollers while all four lines carry the load.'],
  ['insert', 'Feed the cassette into the dock', 'The dock rollers take the nose while the outboard lines support the tail.']
];
const CIRCULATION_COLOURS = {
  corridor: '#8ebcb0',
  lobby: '#e1be87',
  lift: '#968bb2',
  bridge: '#589a96'
};
const STUDY_INK = '#3c564d';

function craneStudyUpperBay(model, bay) {
  return model.slots.some((slot) => slot.f === bay.f + 1 && slot.j === bay.j &&
    !slot.blocked && (slot.p !== EMPTY || slot.use === 'retail'));
}

function craneStudyModels(model, support, view) {
  const options = (support === 'all' ? Object.keys(CRANE_RUNWAYS) : [support]).flatMap((runway) => {
    const crane = planModuleCrane(model, runway);
    if (!crane) return [];
    const { R, lobby, slots, feature } = model;
    return [{ ...model, crane, plaza: designPlaza(R, lobby, slots, feature.climbing, crane, view.seed) }];
  });
  const bearing = (view.craneBearing ?? 316) * Math.PI / 180,
    floor = clamp((view.craneFloor ?? 2) - 1, 0, model.layers.length - 1),
    clear = (slot) => options.every((option) => craneDockClear(model, option.crane, slot)),
    selected = model.slots.filter((slot) => slot.f === floor && clear(slot))
      .sort((a, b) => angDist(a.angle, bearing) - angDist(b.angle, bearing)),
    common = selected.find((slot) => craneStudyUpperBay(model, slot)) ?? selected[0];
  return options.map((option) => {
    const settings = {
      ...view,
      craneFloor: floor + 1,
      craneBearing: common ? common.angle * 180 / Math.PI : view.craneBearing,
      craneStage: 'hoist'
    };
    const pose = moduleCranePose(option, option.crane, settings);
    return { model: option, settings, heading: pose.angle, bay: pose.slot };
  });
}

function craneStudyGeometry(model, view, detail, assignments = {}) {
  const mesh = detail
    ? buildAssemblyMesh(model, {
      slabs: true, facade: true, docks: true, modules: true, crane: true,
      moduleInteriors: false, dockStructure: buildViewLayers().dockStructure
    }, 0, { assignments, view, craneSettings: view })
    : buildMesh(model, false, {
      ...view, floors: model.layers.length, inspect: 0, grid: false, xray: false, programEditing: false,
      showRooms: false, showFacade: true, showModules: true, showRoofDeck: true, roof: true, supports: false
    });
  return drawingGeometry(mesh, model, {
    include: ({ layer }) => /^Crane_/.test(layer) || (detail
      ? /^(Assembly_(Floor_|Roof_Deck|Exterior_Walls|Module_(Chassis|Skin|Roof)|Dock_)|Dock_Closure_)/.test(layer)
      : /^(Core_(Foundation|L\d+_Slab)|Facade_|Modules_L|Roof_(Public_Deck|Lift_|Commercial_Retail)|Atrium_(Glass|Roof_Ridge)|Swing_Tower|Public_Plaza_(Paving|Promenade)|(?:Entrance|Opposite_Lobby)_Plaza_(?:Elevated_Walk|(?:Inner|Outer)_Court)|Infinite_Rinse_Water_Slide)/.test(layer)),
    component: craneStudyComponent
  });
}

function craneStudyComponent(layer) {
  if (layer === 'Crane_Demonstration_Module') return 'modules';
  if (layer === 'Crane_Moat_Water') return 'circulation';
  if (/^(?:Site_)?(?:Entrance|Opposite_Lobby)_Plaza_/.test(layer)) return 'circulation';
  if (layer === 'Crane_Caterpillar_Cars') return 'rides';
  if (layer === 'Crane_Hoist_Lines' || layer === 'Crane_Lifting_Jaws') return 'rides';
  if (/^(Crane_|Assembly_Dock_)/.test(layer)) return 'docks';
  return 'core';
}

function craneStudyFocus(angle, inner, outer, bottom, top, halfWidth = 3.5) {
  const { point } = craneFrame(null, angle);
  return [inner, outer].flatMap((r) => [-halfWidth, halfWidth].flatMap((t) => [bottom, top].map((y) => point(r, t, y))));
}

// Use the installed furnishings and a small window of the actual floor plan around them.
function lobbyDrawingGeometry(model, hub, seed, includeContext, includePeople = false) {
  const mesh = meshBuilder(),
    labels = [];
  if (includeContext) {
    const apron = Math.min(model.circulation.width, 2),
      radialMin = Math.max(model.r, hub.r - apron),
      radialMax = Math.min(model.R, hub.R + apron),
      start = hub.start - apron / hub.layout.radius,
      end = hub.end + apron / hub.layout.radius;
    function contextSector(region, color, top, circulation, label = '') {
      const r = Math.max(radialMin, region.r),
        R = Math.min(radialMax, region.R);
      if (R - r < 0.02) return;
      // Normalize neighbouring sectors to the side of the seam used by this lobby.
      const wrap = TAU * Math.round((hub.layout.heading - (region.start + region.end) / 2) / TAU);
      for (const shift of [wrap - TAU, wrap, wrap + TAU]) {
        const a = Math.max(start, region.start + shift),
          z = Math.min(end, region.end + shift);
        if ((z - a) * R < 0.02) continue;
        mesh.sector(r, R, a, z, -0.08, top + 0.08, color);
        drawInteriorFloorPattern(mesh, { r, R, start: a, end: z }, top, color, circulation, {
          ...region,
          start: region.start + shift,
          end: region.end + shift
        });
        if (label && ((z - a) * (R ** 2 - r ** 2)) / 2 >= 2)
          labels.push({ label, point: mesh.ringPoint((r + R) / 2, (a + z) / 2, top) });
      }
    }
    mesh.mark('Circulation_Lobby_Context');
    for (const region of model.circulation.regions) {
      if (region.f !== hub.f || region.kind === 'lobbyDivider') continue;
      const label =
        hub.lobbyId != null &&
        region.lobbyRouteId === hub.lobbyId &&
        region.route === 'outerLanding'
          ? 'Corridor'
          : '';
      contextSector(region, CIRCULATION_FLOOR_FINISH, 0, true, label);
    }
    mesh.mark('Core_Lobby_Context');
    for (const room of model.rooms) {
      if (room.f !== hub.f) continue;
      const neighbour = hub.lobbyId != null && room.sharedLobby?.id === hub.lobbyId,
        program = P[room.id],
        color = rgb(program?.color ?? '#dce2da');
      // Keep the edges of the cutaway shallow so every compass direction sees the furniture.
      contextSector(
        room,
        ROOM_FLOOR_FINISH.map((part, i) => part + (color[i] - part) * (neighbour ? 0.56 : 0.32)),
        0.085,
        false,
        neighbour ? program?.short : ''
      );
    }
  }
  mesh.mark(`Circulation_L${hub.f + 1}_Shared_Lobby`);
  drawSharedLobbyFloor(mesh, hub, 0);
  drawSharedLobby(mesh, hub, 0, seed, true,
    includePeople ? (furniture) => drawLobbyDrawingActivity(mesh, hub, seed, furniture) : undefined);
  return { geometry: drawingGeometry(mesh), labels };
}

// Heights are relative to the floor for the walker and to the seat for seated figures.
// Each pair describes height and distance forward from the hip.
const LOBBY_FIGURE_POSES = {
  walk: {
    hip: [0.82, 0], shoulder: [1.37, 0.045], head: [1.43, 0.06],
    knees: [[0.44, 0.20], [0.41, -0.19]], feet: [[0, 0.29], [0.13, -0.32]],
    elbows: [[1.10, -0.16], [1.11, 0.23]], hands: [[0.91, -0.24], [0.96, 0.31]]
  },
  sit: {
    hip: [0.085, 0], shoulder: [0.60, 0.14], head: [0.66, 0.18],
    knees: [[0.075, 0.39], [0.075, 0.42]], feet: [[-0.49, 0.48], [-0.49, 0.51]],
    elbows: [[0.29, 0.23], [0.35, 0.34]], hands: [[0.16, 0.36], [0.29, 0.61]]
  },
  recline: {
    hip: [0.10, 0], shoulder: [0.18, -0.34], head: [0.19, -0.52],
    knees: [[0.28, 0.28], [0.23, 0.32]], feet: [[0.02, 0.48], [0.04, 0.50]],
    elbows: [[0.14, -0.11], [0.16, -0.13]], hands: [[0.35, -0.02], [0.35, -0.02]]
  }
};

function drawLobbyDrawingFigure(mesh, origin, facing, pose, colours) {
  const { hip, shoulder, head, knees, feet, elbows, hands } = LOBBY_FIGURE_POSES[pose],
    [coat, skin, hair] = colours.map(rgb), trousers = rgb('#46545e'), shoes = rgb('#37403e'),
    angle = Math.atan2(facing[2], facing[0]), side = [-facing[2], 0, facing[0]],
    at = (across, [y, forward]) => [
      origin[0] + across * side[0] + forward * facing[0], origin[1] + y,
      origin[2] + across * side[2] + forward * facing[2]
    ],
    limb = (a, b, width, colour, depth = width) => drawAssemblyMember(mesh, a, b, width, colour, depth, angle);
  limb(at(0, hip), at(0, shoulder), 0.33, coat, 0.21);
  mesh.box(...at(0, head), 0.18, 0.20, 0.18, angle, skin);
  mesh.box(...at(0, [head[0] + 0.16, head[1] - 0.01]), 0.19, 0.06, 0.19, angle, hair);
  for (const [i, sign] of [-1, 1].entries()) {
    const knee = at(sign * 0.10, knees[i]), foot = at(sign * 0.10, feet[i]), elbow = at(sign * 0.21, elbows[i]);
    limb(at(sign * 0.10, hip), knee, 0.12, trousers);
    limb(knee, [foot[0], foot[1] + 0.06, foot[2]], 0.098, trousers);
    mesh.box(...foot, 0.10, 0.069, 0.20, angle, shoes);
    limb(at(sign * 0.16, shoulder), elbow, 0.095, coat);
    limb(elbow, at(sign * 0.16, hands[i]), 0.072, skin);
  }
  return at;
}

function drawLobbyDrawingActivity(mesh, hub, seed, { shelves, seatTop, canopy }) {
  const { arch, passage, tableRadius, couchInner } = hub.layout, edge = passage / 2,
    point = (along, across, y) => sharedLobbyPoint(hub, along, across, y),
    onArc = (sign, radius, angle, y) => point(radius * Math.cos(angle), sign * (edge + radius * Math.sin(angle)), y),
    heading = unit(sub(point(1, 0, 0), point(0, 0, 0))),
    facingIn = (sign, angle) => unit(sub(onArc(sign, 0, angle, 0), onArc(sign, 1, angle, 0))),
    mark = (name) => mesh.mark(`Circulation_L${hub.f + 1}_Shared_Lobby_Activity`, name),
    gameSide = canopy ? -canopy.sign : 1,
    direction = sharedLobbySeed(hub, seed) & 1 ? 1 : -1;
  mark('Walking through the lobby');
  drawLobbyDrawingFigure(mesh, point(direction * arch * 0.31, 0, 0.031),
    heading.map((part) => part * direction), 'walk', ['#b76a48', '#a46747', '#46342c']);

  // The lounge pose uses a continuous sofa and a low cabinet bay, with room behind the head.
  const seats = shelves.flatMap((bays, side) => bays.map((bay, index) => {
    const angle = (bay.start + bay.end) / 2;
    return { nook: bay.nook, type: bay.type, angle, index, sign: side ? 1 : -1,
      depth: Math.min(bay.outer(angle - 0.09), bay.outer(angle), bay.outer(angle + 0.09)) - couchInner };
  }));
  const reader = seats.find((seat) => seat.nook && seat.depth >= 1.14) ??
    seats.find((seat) => seat.type === 'seat' && seat.depth >= 1.14);
  if (reader) {
    const { sign, angle } = reader, facing = facingIn(sign, angle);
    mark('Reclining with a book in the reading nook');
    const at = drawLobbyDrawingFigure(mesh, onArc(sign, couchInner + 0.49, angle, seatTop), facing,
      'recline', ['#9c6879', '#b87f5f', '#574038']);
    mesh.quad(at(-0.15, [0.44, -0.16]), at(0, [0.40, -0.20]), at(0, [0.38, -0.01]),
      at(-0.15, [0.42, 0.04]), rgb('#e6ce9f'));
    mesh.quad(at(0, [0.40, -0.20]), at(0.15, [0.44, -0.16]), at(0.15, [0.42, 0.04]),
      at(0, [0.38, -0.01]), rgb('#f1e5ca'));
  }
  function sitter(sign, preferredBay, colours) {
    const index = reader?.sign === sign && reader.index === preferredBay ? preferredBay + 1 : preferredBay,
      angle = (index + 0.5) * Math.PI / 8;
    return drawLobbyDrawingFigure(mesh, onArc(sign, couchInner + 0.35, angle, seatTop), facingIn(sign, angle), 'sit', colours);
  }
  mark('Playing a board game');
  sitter(gameSide, 2, ['#6c82a2', '#d3a276', '#755545']);
  sitter(gameSide, 5, ['#c09552', '#714e3c', '#42352f']);
  const table = 0.766, board = (along, inset, y) => point(along, gameSide * (edge + inset), y),
    boardCentre = tableRadius * 0.65, yaw = Math.atan2(heading[2], heading[0]);
  mesh.box(...board(0, boardCentre, table), 0.42, 0.026, 0.42, yaw, rgb('#69493b'));
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++)
      mesh.box(...board((col - 1.5) * 0.096, boardCentre + (row - 1.5) * 0.096, table + 0.025),
        0.096, 0.008, 0.096, yaw, rgb((row + col) % 2 ? '#c29358' : '#ebd8a9'));
  for (const [row, col, colour] of [[-1.5, -0.5, '#783c41'], [-0.5, 0.5, '#783c41'], [1.5, 0.5, '#4c745f'], [0.5, -1.5, '#4c745f']])
    mesh.box(...board(col * 0.096, boardCentre + row * 0.096, table + 0.033), 0.049, 0.041, 0.049, yaw, rgb(colour));

  mark('Having coffee');
  const coffee = sitter(-gameSide, 4, ['#9f7951', '#dfb186', '#65493c']),
    cup = coffee(0.15, [0.30, 0.625]);
  mesh.box(...cup, 0.09, 0.105, 0.09, yaw, rgb('#e8ddd0'));
  mesh.box(cup[0], cup[1] + 0.104, cup[2], 0.072, 0.006, 0.072, yaw, rgb('#725342'));
}

function studySVG(width, height, name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', name);
  return svg;
}

function studyMark(svg, type, attributes, text) {
  const element = document.createElementNS(svg.namespaceURI, type);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  svg.append(element);
  return element;
}

function studyArc(r, R, start = 0, end = TAU) {
  const steps = Math.max(2, Math.ceil((end - start) * 16)),
    angles = Array.from({ length: steps + 1 }, (_, i) => start + ((end - start) * i) / steps),
    at = (radius, angle) => [radius * Math.cos(angle), radius * Math.sin(angle)];
  const outer = angles.map((angle) => at(R, angle));
  if (r === 0 && end - start >= TAU - 1e-7) return outer;
  return [...outer, ...angles.reverse().map((angle) => at(r, angle))];
}

function studyRectangle(angle, radius, width, depth, offset = 0) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [
    [-depth / 2, -width / 2],
    [depth / 2, -width / 2],
    [depth / 2, width / 2],
    [-depth / 2, width / 2]
  ].map(([along, across]) => [
    (radius + along) * cos - (across + offset) * sin,
    (radius + along) * sin + (across + offset) * cos
  ]);
}

function studyFloorName(floor, model) {
  return floor === model.layers.length
    ? 'Roof'
    : floor === 0
      ? 'Ground floor'
      : 'Level ' + (floor + 1);
}

function studyFloor(model, floor, kind) {
  const shapes = [],
    rooms = model.rooms.filter((room) => room.f === floor),
    roof = floor === model.layers.length,
    programme = kind === 'program';
  function put(points, color, height = 0, code = '', base = false) {
    shapes.push({ points, color, height, code, base });
  }
  for (const [start, end] of openArcs(roof || floor === 0 ? [] : lobbyHoles(model.lobby, floor)))
    put(studyArc(model.r, model.R, start, end), '#e7ede5', 0, '', true);

  if (roof) {
    if (!programme) put(studyArc(model.r + 0.25, model.r + 1.9), CIRCULATION_COLOURS.corridor);
    for (const q of model.roofPlan.pavilions ?? [])
      put(
        studyArc(q.r, q.R, q.start, q.end),
        programme ? '#ad91c7' : '#d7ddd4',
        q.upper ? 3.2 : 1.55,
        programme ? 'RT' : ''
      );
    return shapes;
  }

  if (floor === 0 && model.greenhouse) {
    const { axis, beds, ringRadius, width } = model.greenhouse;
    put(studyArc(0, model.r), programme ? '#d2e2ce' : '#e2e9dc', 0, '', true);
    if (programme) {
      for (const [i, bed] of beds.entries()) {
        const points = studyRectangle(axis, 0, bed.width, bed.depth).map(([x, z]) => [
          x + bed.x,
          z + bed.z
        ]);
        put(points, i % 2 ? '#91b9bd' : '#a3c1ac', 0.17);
      }
    } else {
      const { approaches } = model.greenhouse;
      if (ringRadius)
        put(
          studyArc(Math.max(0, ringRadius - width / 2), ringRadius + width / 2),
          CIRCULATION_COLOURS.corridor
        );
      for (const [a, b] of approaches ?? []) {
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          angle = Math.atan2(dz, dx),
          length = Math.hypot(dx, dz);
        const points = studyRectangle(angle, 0, width, length).map(([x, z]) => [
          x + (a[0] + b[0]) / 2,
          z + (a[1] + b[1]) / 2
        ]);
        put(points, CIRCULATION_COLOURS.corridor);
      }
    }
  }
  for (const [start, half] of lobbyHoles(model.lobby, 0)) {
    if (floor !== 0 && !(floor === 1 && model.lobby.gallery)) continue;
    put(
      studyArc(floor === 0 ? model.r : model.lobby.gallery, model.R, start - half, start + half),
      CIRCULATION_COLOURS.lobby,
      0,
      floor === 0 ? 'LOBBY' : ''
    );
  }
  for (const room of rooms) {
    const program = P[room.id] ?? P[UNUSED];
    put(
      studyArc(room.r, room.R, room.start, room.end),
      programme ? program.color : '#e1e5dc',
      programme ? 0.85 : 0,
      programme ? program.short : ''
    );
  }
  if (!programme) {
    for (const q of [...model.circulation.regions, ...model.circulation.hubs]) {
      if (q.f !== floor) continue;
      if (q.kind === 'lobbyDivider') {
        put(studyArc(q.r, q.R, q.start, q.end), '#536157');
        continue;
      }
      const key = q.kind === 'elevator' ? 'lift' : q.kind === 'hub' ? 'lobby' : 'corridor';
      put(
        studyArc(q.r, q.R, q.start, q.end),
        CIRCULATION_COLOURS[key],
        key === 'lift' ? 1.4 : 0.04
      );
      for (const { radius, start, end } of q.layout?.corridorScreens ?? [])
        put(studyArc(radius - 0.08, radius + 0.08, start, end), '#536157');
    }
    const stair = model.circulation.stairs?.find((q) => q.f === floor);
    if (stair) {
      const { start, end } = atriumStairAngles(stair);
      put(studyArc(model.r - stair.width - 0.06, model.r - 0.06,
        Math.min(start, end), Math.max(start, end)), CIRCULATION_COLOURS.bridge, 0.34, 'ST');
    }
    const bridge = model.circulation.bridges.find((q) => q.f === floor);
    if (bridge) {
      const length = 2 * Math.sqrt(model.r ** 2 - bridge.offset ** 2);
      put(
        studyRectangle(bridge.heading + Math.PI / 2, 0, bridge.width, length, -bridge.offset),
        CIRCULATION_COLOURS.bridge,
        0.18,
        'BR'
      );
    }
  }
  for (const slot of model.slots) {
    if (slot.f !== floor || slot.blocked || (slot.p === EMPTY && slot.use === 'empty')) continue;
    const primary = PROGRAMS[slot.p],
      retail = slot.use === 'retail',
      color = primary?.color ?? (retail ? '#ad91c7' : '#dce7d8'),
      code = primary?.short ?? (retail ? 'RT' : '');
    put(
      studyRectangle(
        slot.angle,
        model.R + BUILD_SECTION.dockGap + MODULE.depth / 2,
        MODULE.width,
        MODULE.depth
      ),
      programme ? color : '#e3e8df',
      primary || retail ? (programme ? MODULE.height : 0.4) : 0.18,
      programme ? code : ''
    );
  }
  return shapes;
}

// The document figures use analytical volumes. All footprints and floor assignments come from the plan.
function studyModelFigure(model, kind, { floor, azimuth = -Math.PI / 4, exploded = false, planRadius } = {}) {
  const plan = floor !== undefined,
    width = planRadius ? 610 : 780,
    height = planRadius ? 610 : 510,
    svg = studySVG(
      width,
      height,
      plan
        ? studyFloorName(floor, model) + ' ' + kind + ' plan'
        : (exploded ? 'Exploded ' : '') + kind + ' axonometric'
    ),
    basis = orbitBasis({ az: azimuth, el: 0.59 }),
    stack = exploded ? Math.max(15, model.R * 0.9) : modelFloorPitch(model),
    floors = plan ? [floor] : Array.from({ length: model.layers.length + 1 }, (_, i) => i),
    plates = floors.map((level) => ({ level, shapes: studyFloor(model, level, kind) }));
  const raw = ([x, z], y) =>
    plan ? [-x, -z] : [dot([x, y, z], basis.right), -dot([x, y, z], basis.up)];
  let minX = planRadius ? -planRadius : Infinity,
    maxX = planRadius ?? -Infinity,
    minY = minX,
    maxY = maxX;
  if (!planRadius) {
    for (const { level, shapes } of plates)
      for (const shape of shapes)
        for (const vertex of shape.points) {
          const [x, y] = raw(vertex, level * stack + shape.height);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
  }
  const scale = Math.min(
      (planRadius ? width - 44 : 648) / (maxX - minX || 1),
      (planRadius ? height - 44 : 438) / (maxY - minY || 1)
    ),
    project = (vertex, y) => {
      const [x, z] = raw(vertex, y);
      return [width / 2 + (x - (minX + maxX) / 2) * scale, height / 2 + (z - (minY + maxY) / 2) * scale];
    };
  function polygon(points, fill, opacity = 1) {
    studyMark(svg, 'polygon', {
      points: points.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' '),
      fill,
      'fill-opacity': opacity,
      stroke: '#526a5d',
      'stroke-width': plan ? 0.65 : 0.8,
      'stroke-linejoin': 'round'
    });
  }
  if (exploded) {
    const [x1, y1] = project([0, 0], 0),
      [x2, y2] = project([0, 0], floors.at(-1) * stack);
    studyMark(svg, 'line', {
      x1,
      y1,
      x2,
      y2,
      stroke: '#728679',
      'stroke-width': 1.35,
      'stroke-dasharray': '5 5'
    });
  }
  for (const { level, shapes } of plates) {
    const y = level * stack,
      midpoint = (shape) =>
        shape.points.reduce((sum, [x, z]) => sum + x * basis.back[0] + z * basis.back[2], 0) /
        shape.points.length;
    const order = plan
      ? shapes
      : [...shapes].sort((a, b) => Number(b.base) - Number(a.base) || midpoint(a) - midpoint(b));
    for (const shape of order) {
      const roofHeight = y + shape.height;
      if (!plan && shape.height > 0.1) {
        const shade = rgb(shape.color).map((channel) => Math.round(channel * 210));
        for (let i = 0; i < shape.points.length; i++) {
          const a = shape.points[i],
            b = shape.points[(i + 1) % shape.points.length],
            side = [project(a, y), project(b, y), project(b, roofHeight), project(a, roofHeight)];
          const [p, q, r] = side;
          if ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) < 0)
            polygon(side, `rgb(${shade.join(',')})`);
        }
      }
      const points = shape.points.map((point) => project(point, roofHeight));
      polygon(points, shape.color);
      if (plan && shape.code) {
        const [x, y] = points
          .reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0])
          .map((sum) => sum / points.length);
        if (shape.points.length === 4 || points.some(([px]) => Math.abs(px - x) > 12))
          studyMark(
            svg,
            'text',
            {
              x,
              y: y + 2.2,
              'text-anchor': 'middle',
              'font-size': planRadius ? 8 : 7,
              'font-weight': 650,
              fill: '#273b34'
            },
            shape.code
          );
      }
    }
    if (exploded) {
      const [, labelY] = project([0, 0], y);
      studyMark(
        svg,
        'text',
        { x: 31, y: labelY + 4, fill: STUDY_INK, 'font-size': 12, 'font-weight': 650 },
        studyFloorName(level, model)
      );
    }
  }
  if (plan) {
    const x = width - 53;
    studyMark(svg, 'path', {
      d: `M${x} 69V37L${x - 6} 48M${x} 37L${x + 6} 48`,
      fill: 'none',
      stroke: STUDY_INK,
      'stroke-width': 1.7
    });
    studyMark(
      svg,
      'text',
      { x, y: 30, 'text-anchor': 'middle', fill: STUDY_INK, 'font-size': 12 },
      'N'
    );
  }
  return svg;
}

function structuralStudyFigure(model, layers, section) {
  const svg = studySVG(
    780,
    420,
    section ? 'Radial section showing gravity load paths' : 'Plan showing the radial span grid'
  );
  const green = '#3f6f62',
    red = '#a25541';
  function line(x1, y1, x2, y2, stroke = STUDY_INK, width = 1, dash = 'none') {
    studyMark(svg, 'line', {
      x1,
      y1,
      x2,
      y2,
      stroke,
      'stroke-width': width,
      'stroke-dasharray': dash
    });
  }
  function box(x, y, width, height, fill) {
    studyMark(svg, 'rect', { x, y, width, height, fill, stroke: STUDY_INK, 'stroke-width': 1 });
  }
  function label(x, y, text, weight = 500) {
    studyMark(svg, 'text', { x, y, fill: STUDY_INK, 'font-size': 13, 'font-weight': weight }, text);
  }
  function arrow(x1, y1, x2, y2, color = red) {
    line(x1, y1, x2, y2, color, 2.2);
    const angle = Math.atan2(y2 - y1, x2 - x1),
      a = [x2 - 9 * Math.cos(angle - 0.43), y2 - 9 * Math.sin(angle - 0.43)],
      b = [x2 - 9 * Math.cos(angle + 0.43), y2 - 9 * Math.sin(angle + 0.43)];
    studyMark(svg, 'polygon', { points: `${x2},${y2} ${a.join(',')} ${b.join(',')}`, fill: color });
  }
  const thickness = layers.slabThickness,
    structure = layers.dockStructure,
    floors = model.layers.length,
    grid = buildSupportGrid(model), { inner, outer } = grid,
    radialSpan = outer - inner,
    dockLength = BUILD_SECTION.dockGap + MODULE.depth;
  if (section) {
    const floorSpace = Math.min(59, 242 / floors),
      bottom = 326,
      top = bottom - floors * floorSpace,
      deck = bottom - floorSpace * Math.min(1, floors - 1),
      xInner = 194,
      xOuter = 446,
      xTip = 695;
    label(37, 48, 'ATRIUM', 650);
    label(239, 48, 'PERMANENT CORE', 650);
    label(526, 48, 'DOCK + MODULE', 650);
    // The vertical lines reflect the typical stacking grid. Lobby and slide openings interrupt it locally.
    for (const x of [xInner, xOuter]) {
      box(x - 5, top, 10, bottom - top, '#b1c4b8');
      box(x - 25, bottom, 50, 13, '#d9d8c9');
      arrow(x, bottom - 25, x, bottom + 8);
    }
    for (let f = 0; f <= floors; f++) {
      const y = bottom - f * floorSpace;
      box(
        xInner - 14,
        y - 2,
        xOuter - xInner + 28,
        Math.max(3, (thickness / modelFloorPitch(model)) * floorSpace),
        '#cbd0c6'
      );
      if (f !== 0 && f !== floors)
        box(
          xOuter - 12,
          y + 2,
          24,
          Math.max(5, (buildGirderDepth(model) / modelFloorPitch(model)) * floorSpace),
          '#91aba0'
        );
    }
    if (model.crane) {
      for (const x of [xInner, xOuter]) {
        const holdDown = x === xInner && model.crane.runway === 'cantilever';
        line(x, top - 28, x, top, green, 4);
        line(x - 20, top - 28, x + 20, top - 28, green, 4);
        if (holdDown) arrow(x, top + 4, x, top - 19, green);
        else arrow(x, top - 50, x, top - 19);
      }
    }
    arrow(xOuter - 14, top + 32, xInner + 9, top + 32, green);
    box(xOuter + 9, deck - 30, xTip - xOuter - 8, 30, '#e2e7da');
    [xOuter + 44, xOuter + 111, xOuter + 180].forEach((x) => arrow(x, deck - 49, x, deck - 3));
    line(xOuter, deck + 4, xTip, deck + 4, green, 5);
    if (structure === 'cable-stayed') {
      const y = deck - floorSpace + 5;
      line(xOuter, y, xTip, deck + 4, green, 3);
      arrow(xTip - 60, deck - 8, xOuter + 22, y + 5, green);
      arrow(xOuter - 5, y, xInner + 9, y, green);
    } else if (structure === 'roof-hung') {
      line(xOuter, top - 9, xTip, top - 9, green, 5);
      line(xTip, top - 9, xTip, deck + 4, green, 3);
      line(xOuter, top - 9, xOuter, top + 11, green, 4);
      arrow(xOuter, top + 11, xInner + 7, top + 11, green);
      arrow(xTip, deck - 6, xTip, top + 5, green);
    } else if (structure === 'columns') {
      line(xTip, deck + 4, xTip, bottom, green, 5);
      box(xTip - 15, bottom, 30, 13, '#d9d8c9');
      arrow(xTip, bottom - 25, xTip, bottom + 8);
    } else {
      line(xOuter, deck + 13, xTip, deck + 6, green, structure === 'box-floor' ? 4 : 3);
      if (structure === 'side-truss') line(xOuter, deck + 13, xOuter + 72, deck + 4, green, 2);
      if (structure === 'side-portal')
        line(xOuter + 64, deck + 11, xOuter + 64, deck + 4, green, 2.5);
    }
    arrow(xOuter + 78, deck + 4, xOuter + 2, deck + 4, green);
    // The water load is drawn at a core strip so its load path remains explicit.
    const wetBayY = bottom - floorSpace * Math.max(0, Math.min(2, floors - 1));
    box(xInner + 65, wetBayY - 20, 96, 17, '#b7d9d8');
    arrow(xInner + 113, wetBayY - 35, xInner + 113, wetBayY - 2);
    arrow(xInner + 63, wetBayY + 7, xInner + 8, wetBayY + 7, green);
    label(27, 367, 'Gravity loads', 650);
    line(120, 362, 146, 362, red, 2.2);
    label(181, 367, 'Load path through structure', 650);
    line(383, 362, 409, 362, green, 2.2);
    label(
      27,
      392,
      `${Math.round(thickness * 1000)} mm reference concrete slab · ${DOCK_STRUCTURES[structure].name}`
    );
  } else {
    const scale = Math.min(152 / model.R, 242 / (model.R + dockLength)),
      centre = [224, 208],
      at = (r, a) => [centre[0] - r * scale * Math.cos(a), centre[1] - r * scale * Math.sin(a)];
    for (const radius of [model.r, model.R])
      studyMark(svg, 'circle', {
        cx: centre[0],
        cy: centre[1],
        r: radius * scale,
        fill: 'none',
        stroke: STUDY_INK,
        'stroke-width': radius === model.R ? 1.8 : 1
      });
    for (const axis of grid.axes) {
      const [x1, y1] = at(inner, axis.angle), [x2, y2] = at(outer, axis.angle),
        [sx, sy] = at(grid.inside, axis.angle + grid.pitch / 2), [ex, ey] = at(outer, axis.angle + grid.pitch / 2),
        crane = model.crane?.supports.includes(axis.angle);
      line(sx, sy, ex, ey, '#c4cec4', 0.55);
      line(x1, y1, x2, y2, green, axis.active.inner && axis.active.outer ? 1.1 : 0.65, axis.active.inner && axis.active.outer ? 'none' : '3 2');
      for (const [x, y, active] of [[x1, y1, axis.active.inner], [x2, y2, axis.active.outer]])
        if (active) studyMark(svg, 'circle', { cx: x, cy: y, r: crane ? 3.6 : 2.1, fill: crane ? red : green });
    }
    const a = grid.axes.find((axis) => axis.active.inner && axis.active.outer)?.angle ?? Math.PI,
      [aX, aY] = at(inner, a),
      [bX, bY] = at(outer, a),
      [cX, cY] = at(model.R, a),
      [dX, dY] = at(model.R + dockLength, a);
    line(aX, aY, bX, bY, green, 3);
    line(cX, cY, dX, dY, red, 3, '5 3');
    label(488, 98, 'Typical support grid', 650);
    label(488, 128, 'Dots mark stacked column positions.');
    label(488, 155, `${radialSpan.toFixed(2)} m radial beam between ring supports`);
    label(
      488,
      182,
      `${((Math.PI * model.R) / model.slotN).toFixed(2)} m outer slab strip between radial beams`
    );
    label(488, 234, `${dockLength.toFixed(2)} m dock projection`);
    label(488, 269, 'Red dots also carry the roof runway.');
    label(488, 301, 'Dashed lines mark local ring transfers.');
  }
  return svg;
}

function drawingSetPages(name, model, assignments) {
  const pages = [];
  function add(title, note) {
    const page = document.createElement('article');
    page.className = 'study-page';
    const heading = document.createElement('h3'),
      paragraph = document.createElement('p');
    heading.textContent = title;
    paragraph.textContent = note;
    page.append(heading, paragraph);
    pages.push(page);
    return page;
  }
  const programmes = [
    ...P.map((p) => [p === UNASSIGNED ? p.name : `${p.short} · ${p.name}`, p.color]),
    ['Retail', '#ad91c7'],
    ['Lobby atriums', CIRCULATION_COLOURS.lobby]
  ];
  const routes = [
    ['Corridors and links', CIRCULATION_COLOURS.corridor],
    ['Lobbies and atrium', CIRCULATION_COLOURS.lobby],
    ['Lifts', CIRCULATION_COLOURS.lift],
    ['Bridges', CIRCULATION_COLOURS.bridge]
  ];
  function legend(entries) {
    const list = document.createElement('ul');
    list.className = 'study-legend';
    for (const [name, color] of entries) {
      const item = document.createElement('li'),
        dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.backgroundColor = color;
      item.append(dot, name);
      list.append(item);
    }
    return list;
  }
  function captionedStudy(label, svg) {
    const figure = document.createElement('figure'), caption = document.createElement('figcaption');
    caption.textContent = label;
    figure.append(caption, svg);
    return figure;
  }
  if (name === 'programme') {
    const page = add(
      'Poly Nation · Programme schedule',
      `${fmt(model.total)} m² enclosed area · ${model.count} primary modules · ${model.layers.length} occupied floor levels plus roof`
    );
    const wrapper = document.createElement('div'),
      table = $('schedule').closest('table').cloneNode(true),
      units = document.createElement('p');
    wrapper.className = 'study-table';
    units.textContent = 'Areas are in m². Pods marked with an asterisk are enclosed retail docks.';
    for (const node of table.querySelectorAll('[id]')) node.removeAttribute('id');
    wrapper.append(table);
    page.append(wrapper, units, legend(programmes));
    const exploded = add(
      'Programme · Exploded axonometric',
      'The separated floor plates show the internal room layouts and external programme modules.'
    );
    exploded.classList.add('study-programme-exploded');
    exploded.append(studyModelFigure(model, 'program', { exploded: true }), legend(programmes));

    // Fit every plan to the full module envelope so paired levels and the roof share a scale.
    const planRadius = Math.hypot(model.R + BUILD_SECTION.dockGap + MODULE.depth, MODULE.width / 2);
    for (let first = 0; first <= model.layers.length; first += 2) {
      const roofOnly = first === model.layers.length,
        last = Math.min(first + 1, model.layers.length), pair = document.createElement('div'),
        plans = add(roofOnly ? 'Programme · Roof plan' : 'Programme · Floor plans',
          roofOnly ? 'Rooftop pavilions at the same scale as the floor plans.'
            : 'Core rooms and exterior docks at a common scale across the document.');
      pair.className = 'study-grid study-plan-pair';
      for (let floor = first; floor <= last; floor++)
        pair.append(captionedStudy(studyFloorName(floor, model), studyModelFigure(model, 'program', { floor, planRadius })));
      plans.append(pair, legend(programmes));
    }

    const views = add(
        'Programme axonometrics',
        'Four views around the ring show how the programmes occupy the exterior docks and core.'
      ),
      grid = document.createElement('div');
    grid.className = 'study-grid study-programme-axos';
    for (const [label, azimuth] of [
      ['NE', (3 * Math.PI) / 4],
      ['SE', (5 * Math.PI) / 4],
      ['SW', (7 * Math.PI) / 4],
      ['NW', Math.PI / 4]
    ]) grid.append(captionedStudy(label, studyModelFigure(model, 'program', { azimuth })));
    views.append(grid, legend(programmes));
  } else if (name === 'circulation') {
    add(
      'Circulation · Exploded axonometric',
      'Lobbies, corridors, lifts and bridges are shown in colour. Rooms and modules provide neutral context.'
    ).append(studyModelFigure(model, 'circulation', { exploded: true }), legend(routes));
    for (let floor = 0; floor <= model.layers.length; floor++) {
      add(`${studyFloorName(floor, model)} · Circulation plan`, floor === 0
        ? 'Opposing lobbies lead through the biofiltration atrium.'
        : 'Corridors, lifts and any bridges at this level.').append(
        studyModelFigure(model, 'circulation', { floor }), legend(routes));
    }
  } else {
    const layers = buildViewLayers();
    const demand = dockSupportDemand(
      model,
      assignments,
      layers.dockStructure,
      layers.slabThickness
    ), { governing, span, slabSpan, slabMoment, dryLoad } = demand;
    const waterDepth = clamp(Number($('buildWaterDepth').value) || 0, 0, 10);
    const water = 9.81 * waterDepth,
      wetMoment = slabMoment + (water * slabSpan ** 2) / 8;
    const section = add(
      'Structure · Radial load-path section',
      'Runway and dock reactions enter the same stacked frame. The floor diaphragms bring lateral loads to the paired lift bays.'
    );
    const dockNote = document.createElement('p');
    dockNote.textContent = `Across the ${span.toFixed(2)} m dock, the ${governing.label.toLowerCase()} case gives ${Math.round(governing.shear)} kN total service gravity load and ${(governing.rootMoment / 1000).toFixed(1)} MN·m about the core face before crediting tip supports.`;
    section.append(structuralStudyFigure(model, layers, true), dockNote);
    const page = add(
      'Structure · Support grid and spans',
      'The active support grid and its local openings. Straight radial beams connect the two primary rings.'
    );
    page.append(structuralStudyFigure(model, layers, false));
    const note = document.createElement('p');
    note.textContent = `The ${Math.round(layers.slabThickness * 1000)} mm concrete strip at the ${slabSpan.toFixed(2)} m span carries ${dryLoad.toFixed(1)} kPa dry and ${(dryLoad + water).toFixed(1)} kPa with ${waterDepth.toFixed(2)} m of water. The corresponding service moments are ${slabMoment.toFixed(1)} and ${wetMoment.toFixed(1)} kN·m/m. Reinforcement, concentrated loads, connections and foundations require separate checks.`;
    page.append(note);
    const structure = layers.dockStructure,
      summary = connectionDemandCopy('support', structure, demand),
      hardware = add('Structure · Dock fittings', `${DOCK_STRUCTURES[structure].name} · Exterior elevations`),
      elevations = studySVG(880, 172, 'Exterior elevations of the selected dock fittings'),
      demandNote = document.createElement('p'),
      sources = document.createElement('p');
    drawFittingPanels(elevations, fittingPanels('support', structure, demand), { x: 8, y: 8, width: 864 }, {
      ink: STUDY_INK, paper: '#fafbf7', thin: 0.75, thick: 1.55, emit: studyMark
    });
    demandNote.textContent = `${summary.value} in the unfactored ${governing.label.toLowerCase()} case. ${summary.check}`;
    sources.textContent = 'Catalog ratings and final connection design require verification. See the 1:25 connection presets for the assembly view and scaled fitting elevations.';
    hardware.append(elevations, demandNote, sources);
  }
  return pages;
}
