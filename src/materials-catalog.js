'use strict';

// Comparative study assumptions, per m² of floor for structure and per m² of wall for finish.
// Cost indices compare layers independently. Strength describes system behavior, not capacity.
const STRUCTURE_STUDY = {
  concrete: [420, 1, 'Stiff, continuous slabs and walls'],
  precast: [330, 1.1, 'Stiff panels with continuity governed by connections'],
  'wood-stud': [55, 0.7, 'Light, closely spaced framing'],
  clt: [100, 1.2, 'Stiff plate action across panels'],
  glulam: [85, 1.3, 'Spanning beams and discrete posts'],
  'steel-frame': [95, 1.2, 'Efficient long spans with lateral bracing'],
  'light-steel': [50, 0.8, 'Light framing with braced wall assemblies'],
  'space-frame': [75, 1.5, 'Triangulated load paths in two directions'],
  'steel-outrigger': [145, 1.75, 'Deep trusses return module cantilever reactions to the core'],
  'steel-composite': [
    185,
    1.42,
    'Steel beams and composite floors distribute reactions to the columns'
  ],
  'steel-tube': [72, 1.32, 'Closed-section chassis with a stiff perimeter'],
  'aluminum-truss': [46, 1.92, 'Light triangulated frame with connection and deflection demands'],
  'lvl-box': [73, 1.27, 'Timber webs and shear skins act together as a light box'],
  masonry: [280, 1.1, 'Strong in compression with limited tension capacity']
};
const CLADDING_STUDY = {
  'rammed-earth': [
    390,
    2.2,
    'Heavy outer leaf that needs independent support and protection from water'
  ],
  concrete: [72, 1.8, 'Rigid panel'],
  'board-concrete': [85, 2, 'Rigid, textured panel'],
  cedar: [12, 1.4, 'Light boards that can dent'],
  'charred-wood': [13, 1.6, 'Light boards with a finish that can abrade'],
  plywood: [10, 1.1, 'Light sheet with exposed edges that need protection'],
  'thermo-wood': [12, 1.55, 'Light timber slats that can weather unevenly'],
  'cork-panel': [11, 1.5, 'Light panels with a textured surface'],
  corrugated: [8, 1, 'Light skin that can dent'],
  'insulated-panel': [18, 1.45, 'Insulated enclosure panels with a steel skin'],
  aluminum: [6, 1.5, 'Light skin that can dent'],
  zinc: [9, 1.9, 'Durable skin that can dent'],
  'weathering-steel': [18, 1.6, 'Thin metal cassettes with a developing patina'],
  'perforated-aluminum': [8, 1.9, 'Light metal screen on secondary supports'],
  vinyl: [4, 0.7, 'Light skin vulnerable to impact'],
  'fiber-cement': [17, 1.25, 'Rigid sheet with edges that can chip'],
  brick: [138, 1.75, 'Rigid veneer that relies on its joints'],
  stone: [82, 2.2, 'Rigid panels with heavy loads at attachments'],
  terracotta: [38, 2.0, 'Fired clay panels supported by a separate rail system'],
  stucco: [25, 1.15, 'Continuous finish that may crack'],
  glazing: [35, 2.4, 'Rigid glazing supported by frames and joints'],
  polycarbonate: [5, 1.3, 'Light translucent sheets with thermal movement at the joints'],
  'recycled-composite': [13, 1.45, 'Light panel rainscreen with supported edges']
};

function assemblyVariants(entries, fallback) {
  const groups = new Map();
  for (const { values, quantity } of entries) {
    const key = values.structure + '/' + values.facade;
    const group = groups.get(key) || { key, values, quantity: 0 };
    group.quantity += quantity;
    groups.set(key, group);
  }
  return groups.size
    ? [...groups.values()].sort((a, b) => b.quantity - a.quantity)
    : [{ key: fallback.structure + '/' + fallback.facade, values: fallback, quantity: 0 }];
}

// Render a schematic axonometric with space between the finish and its support system.
function drawExplodedAssembly(
  canvas,
  values,
  ring,
  viewport = canvas,
  dpr = Math.min(2, devicePixelRatio || 1)
) {
  const width = viewport.clientWidth,
    height = viewport.clientHeight;
  if (!width || !height) return;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'round';
  const structure = STRUCTURAL_SYSTEMS[values.structure],
    finish = EXTERIOR_FINISHES[values.facade];
  const scale = Math.min((width - 30) / (ring ? 11.2 : 10.8), (height - 23) / 11.4);
  const project = ([x, y, z]) => [
    width / 2 + 0.86 * (x - z) * scale,
    height / 2 + (2.75 + 0.46 * (x + z) - y) * scale
  ];
  function path(points, fill, stroke, weight = 0.7) {
    ctx.beginPath();
    points.map(project).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = weight;
      ctx.stroke();
    }
  }
  const line = (a, b, stroke, weight) => path([a, b], null, stroke, weight);
  const panel = (corners, tint, seam) => path(corners, tint, seam);
  const edge = '#496052';
  const paintedStructure = structure.color + '92';
  const paintedFinish = values.facade === 'glazing' ? finish.color + '96' : finish.color;
  const dashed = (points) => {
    ctx.setLineDash([3, 3]);
    points.forEach((point) =>
      line([point[0], 0.1, point[1]], [point[0], 5.55, point[1]], '#91a69a')
    );
    ctx.setLineDash([]);
  };
  if (ring) {
    const radius = 4.35,
      inner = clamp(ring.r / ring.R, 0.15, 0.93) * radius;
    const point = (r, angle, y) => [r * Math.cos(angle), y, r * Math.sin(angle)];
    const segments = 48;
    const at = (index) => (index * TAU) / segments;
    const band = (y, fill, seam) => {
      for (let i = 0; i < segments; i++)
        panel(
          [
            point(inner, at(i), y),
            point(radius, at(i), y),
            point(radius, at(i + 1), y),
            point(inner, at(i + 1), y)
          ],
          fill,
          fill
        );
      for (const r of [inner, radius])
        path(
          Array.from({ length: segments + 1 }, (_, i) => point(r, at(i), y)),
          null,
          seam
        );
    };
    dashed([
      [-radius * 0.7, radius * 0.7],
      [radius * 0.7, -radius * 0.7]
    ]);
    band(0, paintedStructure, edge);
    const levels = clamp(ring.layers.length, 1, 10);
    const thickness = 2.4 / levels;
    const postCount = structure.frame === 'stud' ? 28 : 14;
    for (let level = 0; level < levels; level++) {
      const low = level * thickness,
        high = low + thickness;
      for (let i = 0; i < postCount; i++) {
        const a = (i * TAU) / postCount,
          next = ((i + 1) * TAU) / postCount;
        const r = radius * 0.98;
        line(
          point(r, a, low),
          point(r, a, high),
          structure.color,
          structure.frame === 'solid' ? 2 : 1.5
        );
        if (structure.frame === 'brace')
          line(point(r, a, low), point(r, next, high), structure.color);
      }
      band(high, paintedStructure, edge);
    }
    // An open seam in the raised skin makes the courtyard and the shell depth legible.
    const shell = Array.from({ length: segments }, (_, i) => i).filter((i) => i < 5 || i >= 12);
    shell.sort((a, b) => Math.cos(at(a) - Math.PI / 4) - Math.cos(at(b) - Math.PI / 4));
    for (const i of shell) {
      const a = at(i),
        z = at(i + 1);
      const strip = (low, high, fill, stroke) =>
        panel(
          [
            point(radius, a, low),
            point(radius, z, low),
            point(radius, z, high),
            point(radius, a, high)
          ],
          fill,
          stroke
        );
      if (finish.texture === 'earth') {
        for (const band of earthBands(4.2, 1.35, rgb(finish.color), 0.24)) {
          const tint =
            'rgb(' + band.color.map((channel) => Math.round(channel * 255)).join(',') + ')';
          strip(band.low, band.high, tint, tint);
        }
      } else {
        strip(4.2, 5.55, paintedFinish, finish.seam);
        if (finish.course) line(point(radius, a, 4.85), point(radius, z, 4.85), finish.seam);
      }
    }
    return;
  }

  // Module dimensions are proportional to the standard 4.5 × 18 m bay.
  const x = 1.02,
    z = 4.08;
  const slab = (y, fill, stroke) =>
    panel(
      [
        [-x, y, -z],
        [x, y, -z],
        [x, y, z],
        [-x, y, z]
      ],
      fill,
      stroke
    );
  dashed([
    [-x, -z],
    [x, z],
    [-x, z]
  ]);
  slab(0, paintedStructure, edge);
  for (const side of [-1, 1]) {
    if (structure.frame === 'solid') {
      panel(
        [
          [side * x, 0, -z],
          [side * x, 0, z],
          [side * x, 2.4, z],
          [side * x, 2.4, -z]
        ],
        paintedStructure,
        edge
      );
      for (const station of [-z / 2, 0, z / 2])
        line([side * x, 0, station], [side * x, 2.4, station], structure.color);
    } else {
      const stations = structure.frame === 'stud' ? 12 : 5;
      for (let i = 0; i <= stations; i++) {
        const position = -z + (2 * z * i) / stations;
        line([side * x, 0, position], [side * x, 2.4, position], structure.color, 1.6);
        if (structure.frame === 'brace' && i < stations)
          line(
            [side * x, 0, position],
            [side * x, 2.4, position + (2 * z) / stations],
            structure.color
          );
      }
    }
    line([side * x, 2.4, -z], [side * x, 2.4, z], structure.color, 1.8);
  }
  for (const station of [-z, -z / 2, 0, z / 2, z])
    line([-x, 2.4, station], [x, 2.4, station], structure.color, 1.4);
  // Show the long elevation and end panel below the detached roof sheet.
  panel(
    [
      [x, 4.05, -z],
      [x, 4.05, z],
      [x, 5.15, z],
      [x, 5.15, -z]
    ],
    paintedFinish,
    finish.seam
  );
  panel(
    [
      [-x, 4.05, z],
      [x, 4.05, z],
      [x, 5.15, z],
      [-x, 5.15, z]
    ],
    paintedFinish,
    finish.seam
  );
  slab(5.55, paintedFinish, finish.seam);
  if (finish.joint)
    for (let s = -z + 0.6; s < z; s += finish.joint < 0.7 ? 0.55 : 1.35) {
      line([x, 4.05, s], [x, 5.15, s], finish.seam);
      line([-x, 5.55, s], [x, 5.55, s], finish.seam);
    }
  if (finish.course)
    for (const y of [4.32, 4.6, 4.88]) {
      line([x, y, -z], [x, y, z], finish.seam);
      line([-x, y, z], [x, y, z], finish.seam);
    }
}

function assemblyQuantity(ring, quantity) {
  return ring ? fmt(quantity) + ' m²' : quantity + (quantity === 1 ? ' module' : ' modules');
}

// Build a sheet from the material study itself so labels and diagrams are independent of UI collapse state.
function drawMaterialSnapshot(study, cards, variantsInView, renderModel, date) {
  const width = 1800;
  const margin = 50;
  const gap = 20;
  const contentWidth = width - 2 * margin;
  const cardWidth = (contentWidth - 2 * gap) / 3;
  const modelTop = 146;
  const modelHeight = 572;
  const cardsTop = modelTop + modelHeight + 54;
  const cardBodyHeights = cards.map(({ variants }) => Math.max(170, variants.length * 78));
  const rowHeights = [
    80 + Math.max(...cardBodyHeights.slice(0, 3)),
    80 + Math.max(...cardBodyHeights.slice(3))
  ];
  const height = cardsTop + rowHeights[0] + gap + rowHeights[1] + margin;
  // Keep a single PNG usable on mobile even with many material combinations in an older study.
  const scale = Math.min(1, 4096 / height);
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(width * scale);
  sheet.height = Math.round(height * scale);
  const ctx = sheet.getContext('2d');
  if (!ctx) throw Error('Canvas export is unavailable.');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';
  const ink = '#243b30';
  const muted = '#52665a';
  const rule = '#d2dbcf';
  function text(value, x, y, size, weight = 400, color = ink, maxWidth = width) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y, maxWidth);
  }
  function box(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  box(0, 0, width, height, '#f7f8f3');
  text('Poly Nation', margin, 31, 23, 700, muted);
  text('Materials snapshot', margin, 56, 50, 700);
  ctx.textAlign = 'right';
  text(
    date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    width - margin,
    40,
    22,
    400,
    muted
  );
  const { model, view } = study;
  text(
    fmt(model.total) +
      ' m² enclosed  ·  ' +
      view.floors +
      (view.floors === 1 ? ' floor' : ' floors') +
      '  ·  ' +
      assemblyQuantity(false, model.count),
    width - margin,
    78,
    24,
    600
  );
  ctx.textAlign = 'left';

  ctx.drawImage(
    renderModel(contentWidth, modelHeight),
    margin,
    modelTop,
    contentWidth,
    modelHeight
  );
  ctx.strokeStyle = rule;
  ctx.strokeRect(margin, modelTop, contentWidth, modelHeight);
  text('Assemblies', margin, cardsTop - 38, 25, 700);

  const diagram = document.createElement('canvas');
  const diagramSize = { clientWidth: 174, clientHeight: 142 };
  cards.forEach(({ key, title, program, ring, variants }, index) => {
    const x = margin + (index % 3) * (cardWidth + gap);
    const row = Math.floor(index / 3);
    const y = row ? cardsTop + rowHeights[0] + gap : cardsTop;
    const selected =
      variants.find((variant) => variant.key === variantsInView.get(key)) ?? variants[0];
    const ordered = [selected, ...variants.filter((variant) => variant !== selected)];
    const quantity = variants.reduce((total, variant) => total + variant.quantity, 0);

    box(x, y, cardWidth, rowHeights[row], '#fffefa');
    ctx.strokeRect(x, y, cardWidth, rowHeights[row]);
    box(x, y, 6, rowHeights[row], PROGRAMS[program]?.color || '#547765');
    text(title, x + 20, y + 16, 25, 700, ink, cardWidth - 40);
    text(
      assemblyQuantity(ring, quantity) + (ring ? ' of rooms' : ''),
      x + 20,
      y + 46,
      17,
      400,
      muted
    );
    box(x + 20, y + 76, diagramSize.clientWidth, diagramSize.clientHeight, '#edf1e9');
    drawExplodedAssembly(diagram, selected.values, ring, diagramSize, 1);
    ctx.drawImage(diagram, x + 20, y + 76);

    const labelX = x + 210;
    const available = cardWidth - 232;
    const many = variants.length > 1;
    if (many)
      text(
        'Shown · ' + assemblyQuantity(ring, selected.quantity),
        x + 20,
        y + 222,
        13,
        500,
        muted,
        174
      );
    ordered.forEach((variant, i) => {
      const line = y + 76 + i * 78;
      const structure = STRUCTURAL_SYSTEMS[variant.values.structure];
      const finish = EXTERIOR_FINISHES[variant.values.facade];
      if (many)
        text(assemblyQuantity(ring, variant.quantity), labelX, line, 15, 650, muted, available);
      const detail = line + (many ? 22 : 2);
      box(labelX, detail + 4, 12, 12, structure.color);
      text('Structure · ' + structure.name, labelX + 20, detail, 17, 550, ink, available - 20);
      box(labelX, detail + 30, 12, 12, finish.color);
      text('Cladding · ' + finish.name, labelX + 20, detail + 26, 17, 550, ink, available - 20);
    });
  });
  return sheet;
}

function assemblyLayerMarkup(values) {
  const structure = STRUCTURAL_SYSTEMS[values.structure],
    finish = EXTERIOR_FINISHES[values.facade];
  const [structureMass, structureCost, strength] = STRUCTURE_STUDY[values.structure];
  const [claddingMass, claddingCost, resilience] = CLADDING_STUDY[values.facade];
  function layer(label, preset, weight, basis, cost, behavior) {
    return (
      '<section class="assembly-layer"><h5>' +
      label +
      '</h5><p class="assembly-material" style="--swatch:' +
      preset.color +
      '">' +
      preset.name +
      '</p><p>≈ ' +
      weight +
      ' kg/m² ' +
      basis +
      ' · ' +
      cost +
      '× cost</p><p>' +
      behavior +
      '</p></section>'
    );
  }
  return (
    layer(
      'Structure',
      structure,
      structureMass,
      'floor',
      structureCost,
      'Strength profile · ' + strength
    ) + layer('Cladding', finish, claddingMass, 'wall', claddingCost, resilience)
  );
}

// CAD scenario rates are editable assumptions. Apply each layer's index to its own physical area.
const DEFAULT_MATERIAL_RATES = { structure: 350, facade: 95 };

function estimateMaterialAssemblies(model, assignments, rates) {
  const core = { label: 'Core ring', count: 1, cost: 0, mass: 0 };
  const modules = PROGRAMS.map((program) => ({ label: program.name, count: 0, cost: 0, mass: 0 }));
  const other = { label: 'Other enclosed modules', count: 0, cost: 0, mass: 0 };
  const structureAreas = new Map();
  const finishes = new Set();
  const modulePairs = new Set();
  const moduleSystems = new Set();
  let structuralCost = 0;
  function measure(row, kind, key, area) {
    if (area <= 0) return;
    const catalog = kind === 'structure' ? STRUCTURE_STUDY : CLADDING_STUDY;
    const [mass, multiplier] = catalog[key];
    const cost = area * rates[kind] * multiplier;
    row.cost += cost;
    row.mass += area * mass;
    if (kind === 'structure') {
      structureAreas.set(key, (structureAreas.get(key) || 0) + area);
      structuralCost += cost;
    } else finishes.add(key);
  }

  // Allocate modeled room area by program and price the remaining annulus at the core default.
  let roomsArea = 0;
  for (const room of model.rooms) {
    roomsArea += room.area;
    measure(core, 'structure', materialValues(assignments, 'core', room.id).structure, room.area);
  }
  measure(
    core,
    'structure',
    materialValues(assignments, 'core').structure,
    Math.max(0, model.ringArea + (model.circulation.bridgeArea ?? 0) - roomsArea)
  );
  for (let floor = 0; floor < model.layers.length; floor++)
    for (const wall of coreFacadeSpans(model, floor))
      for (const span of coreFacadeSegments(model, floor, wall.span)) {
        const { facade } = materialValues(assignments, 'core', span.program);
        measure(core, 'facade', facade, (span.end - span.start) * model.R * wall.height);
      }

  const moduleWallArea = 2 * (MODULE.width + MODULE.depth) * MODULE.height;
  for (const slot of model.slots) {
    if (slot.blocked || (slot.p === EMPTY && slot.use !== 'retail')) continue;
    const row = modules[slot.p] || other;
    const values = materialValues(assignments, 'module', slot.p, materialSlotKey(model, slot));
    row.count++;
    measure(row, 'structure', values.structure, MODULE.area);
    measure(row, 'facade', values.facade, moduleWallArea);
    modulePairs.add(values.structure + '/' + values.facade);
    moduleSystems.add(values.structure);
  }

  const rows = [core, ...modules];
  if (other.count) rows.push(other);
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const mass = rows.reduce((sum, row) => sum + row.mass, 0);
  const leadingStructure = [...structureAreas].sort((a, b) => b[1] - a[1])[0];
  return {
    rows,
    total,
    mass,
    structuralCost,
    leadingStructure,
    structureAreas,
    finishes,
    modulePairs,
    moduleSystems
  };
}
