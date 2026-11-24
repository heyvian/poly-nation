'use strict';

const DRAWING_DOCUMENTS = ['programme', 'program-diagrams', 'circulation', 'structure'];
const CIRCULATION_COLOURS = {
  corridor: '#8ebcb0',
  lobby: '#e1be87',
  lift: '#968bb2',
  bridge: '#589a96'
};
const STUDY_INK = '#3c564d';

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
function studyModelFigure(model, kind, { floor, azimuth = -Math.PI / 4, exploded = false } = {}) {
  const plan = floor !== undefined,
    svg = studySVG(
      780,
      510,
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
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const { level, shapes } of plates)
    for (const shape of shapes)
      for (const vertex of shape.points) {
        const [x, y] = raw(vertex, level * stack + shape.height);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const scale = Math.min(648 / (maxX - minX || 1), 438 / (maxY - minY || 1)),
    project = (vertex, y) => {
      const [x, z] = raw(vertex, y);
      return [390 + (x - (minX + maxX) / 2) * scale, 255 + (z - (minY + maxY) / 2) * scale];
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
              'font-size': 7,
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
    studyMark(svg, 'path', {
      d: 'M727 69V37L721 48M727 37L733 48',
      fill: 'none',
      stroke: STUDY_INK,
      'stroke-width': 1.7
    });
    studyMark(
      svg,
      'text',
      { x: 727, y: 30, 'text-anchor': 'middle', fill: STUDY_INK, 'font-size': 12 },
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
    width = model.R - model.r,
    innerOffset = Math.min(0.42, width * 0.16),
    outerOffset = Math.min(0.48, width * 0.16),
    radialSpan = width - innerOffset - outerOffset,
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
    for (let j = 0; j < model.slotN * 2; j++) {
      const angle = ((j + 1) * TAU) / (model.slotN * 2),
        [x1, y1] = at(model.r + innerOffset, angle),
        [x2, y2] = at(model.R - outerOffset, angle);
      line(x1, y1, x2, y2, '#a2b3a6', 0.8);
      if (j % 2 === 0) {
        for (const [x, y] of [
          [x1, y1],
          [x2, y2]
        ])
          studyMark(svg, 'circle', { cx: x, cy: y, r: 2.7, fill: green });
      }
    }
    const a = Math.PI,
      [aX, aY] = at(model.r + innerOffset, a),
      [bX, bY] = at(model.R - outerOffset, a),
      [cX, cY] = at(model.R, a),
      [dX, dY] = at(model.R + dockLength, a);
    line(aX, aY, bX, bY, green, 3);
    line(cX, cY, dX, dY, red, 3, '5 3');
    label(488, 98, 'Typical support grid', 650);
    label(488, 128, 'Dots mark aligned column positions.');
    label(488, 155, `${radialSpan.toFixed(2)} m radial beam between ring supports`);
    label(
      488,
      182,
      `${((Math.PI * model.R) / model.slotN).toFixed(2)} m outer slab strip between radial beams`
    );
    label(488, 234, `${dockLength.toFixed(2)} m dock projection`);
    label(488, 269, 'Check local transfers around openings.');
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
  function floorPages(kind) {
    for (let i = 0; i <= model.layers.length; i++) {
      const route = kind === 'circulation',
        subtitle = route ? 'Circulation plan' : 'Programme plan',
        note = route
          ? i === 0
            ? 'Opposing lobbies lead through the biofiltration atrium.'
            : 'Corridors, lifts and any bridges at this level.'
          : 'Internal rooms and external docks are shown on the same floor plan.';
      add(`${studyFloorName(i, model)} · ${subtitle}`, note).append(
        studyModelFigure(model, kind, { floor: i }),
        legend(route ? routes : programmes)
      );
    }
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
    floorPages('program');
    const views = add(
        'Programme axonometrics',
        'Four views around the ring show how the programmes occupy the exterior docks and core.'
      ),
      grid = document.createElement('div');
    grid.className = 'study-grid';
    for (const [label, azimuth] of [
      ['NE', (3 * Math.PI) / 4],
      ['SE', (5 * Math.PI) / 4],
      ['SW', (7 * Math.PI) / 4],
      ['NW', Math.PI / 4]
    ]) {
      const figure = document.createElement('figure'),
        caption = document.createElement('figcaption');
      caption.textContent = label;
      figure.append(studyModelFigure(model, 'program', { azimuth }), caption);
      grid.append(figure);
    }
    views.append(grid, legend(programmes));
  } else if (name === 'program-diagrams' || name === 'circulation') {
    const route = name === 'circulation',
      kind = route ? 'circulation' : 'program',
      caption = route
        ? 'Lobbies, corridors, lifts and bridges are shown in colour. Rooms and modules provide neutral context.'
        : 'The separated floor plates show the internal room layouts and external programme modules.';
    add(
      route ? 'Circulation · Exploded axonometric' : 'Programme · Exploded axonometric',
      caption
    ).append(
      studyModelFigure(model, kind, { exploded: true }),
      legend(route ? routes : programmes)
    );
    floorPages(kind);
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
      'A typical bay shows loads entering the core slab and dock, moving through the frame and down to foundations.'
    );
    const dockNote = document.createElement('p');
    dockNote.textContent = `Across the ${span.toFixed(2)} m dock, the ${governing.label.toLowerCase()} case gives ${Math.round(governing.shear)} kN total service gravity load and ${(governing.rootMoment / 1000).toFixed(1)} MN·m about the core face before crediting tip supports.`;
    section.append(structuralStudyFigure(model, layers, true), dockNote);
    const page = add(
      'Structure · Support grid and spans',
      'Typical grid shown before local interruptions at the entrances and slide. The radial beams transfer slab loads to the ring girders and columns.'
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
