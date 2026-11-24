'use strict';

// PROGRAM AND STATE — all dimensions in meters, floor areas in square meters.
const PROGRAMS = [
  {
    id: 'rinse',
    name: 'Infinite Rinse',
    short: 'IR',
    goal: 7500,
    color: '#72a9c8',
    split: 80,
    pos: [0.0, -0.7]
  },
  {
    id: 'love',
    name: 'Love hotel',
    short: 'LH',
    goal: 8000,
    color: '#d681a7',
    split: 35,
    pos: [0.65, -0.1]
  },
  {
    id: 'fire',
    name: 'Marine firehall',
    short: 'FH',
    goal: 1500,
    color: '#d46f62',
    split: 75,
    pos: [-0.67, -0.18]
  },
  {
    id: 'day',
    name: 'Daycare',
    short: 'DC',
    goal: 1000,
    color: '#e0bb62',
    split: 40,
    pos: [0.05, 0.69]
  },
  {
    id: 'senior',
    name: 'Senior care',
    short: 'SC',
    goal: 2000,
    color: '#8bb28a',
    split: 35,
    pos: [-0.4, 0.47]
  }
];
const UNASSIGNED = { id: 'unused', name: 'Unassigned', short: '—', goal: 0, color: '#c4c9c2' },
  P = [...PROGRAMS, UNASSIGNED],
  EMPTY = -1,
  UNUSED = 5,
  TAU = 2 * Math.PI,
  MODULE = { width: 4.5, depth: 18, height: 3.5, area: 81 },
  defaults = () => ({
    autoCore: true,
    floors: 4,
    slabThickness: BUILD_SECTION.slabThickness,
    footprint: 4700,
    ringWidth: 10,
    modules: 110,
    affinity: 70,
    seed: 606,
    dockVariant: 0,
    allocationMoves: [],
    split: PROGRAMS.map((p) => p.split),
    points: PROGRAMS.map((p) => p.pos.slice()),
    roof: true,
    grid: true,
    supports: true,
    showModules: true,
    showPeople: true,
    showAnimals: true,
    inspect: 0,
    mix: 65,
    vacancy: [25, 30, 30, 15],
    slideLength: 40,
    climbWidth: 10,
    atriumBridges: 'off',
    lobby: 240,
    relations: {},
    corridorWidth: 2.4,
    areaCap: 20000,
    xray: false,
    showRooms: true,
    showRoofDeck: true,
    showFacade: true,
    animateSwing: true,
    minRoomArea: 80,
    cluster: [false, false, false, false, false],
    roomPrograms: {},
    modulePrograms: {},
    simRunning: true,
    simSpeed: 3,
    visitorCount: 36,
    encounterWeights: {
      hub: 5,
      room: 3,
      garden: 2.5,
      plaza: 2.5,
      balcony: 2.5,
      greenhouse: 2.5,
      roof: 2,
      ride: 2.5,
      corridor: 0.5
    },
    memoryBonus: 1.5,
    programBonus: 1.2,
    funBonus: 1.4,
    speciesBonus: 1.3
  });
const VACANCY = [
  { id: 'empty', name: 'Empty', color: '#d1d6ce' },
  { id: 'balcony', name: 'Public balcony', color: '#a8bbc2' },
  { id: 'garden', name: 'Community garden', color: '#548b57' },
  { id: 'retail', name: 'Commercial / retail', color: '#ad91c7' }
];
const BRIDGE_MODES = { off: 'Off', radial: 'Radial', aligned: 'Vertically aligned' };
// Conceptual gross room / zone area ranges; not code minima. Large rooms may be subdivided later.
const BUILD_SECTION = {
  floorHeight: 4.2,
  slabBase: 0.24,
  slabThickness: 0.22,
  dockGap: 0.65,
  rootDepth: 3.15,
  tipDepth: 0.6,
  chordWidth: 0.2,
  chordDepth: 0.3,
  chordWall: 0.012
};
const SLAB_DEPTHS = [0.22, 0.26, 0.3];
const LEGACY_SLAB_KEY = 'poly-nation-build-slab-thickness';

// The reference clear height stays fixed. Only the slab allowance adds to the storey pitch.
function floorPitch(thickness) {
  return BUILD_SECTION.floorHeight - BUILD_SECTION.slabThickness + thickness;
}

function modelFloorPitch(model) {
  return model?.floorHeight ?? BUILD_SECTION.floorHeight;
}
const OUTER_WALL_THICKNESS = 0.5;
const facadeThickness = (m) => Math.min(OUTER_WALL_THICKNESS, m.width * 0.45);
// Preferred gross program-zone sizes. The global minimum is enforced by the packing pass.
const FIREHALL = PROGRAMS.findIndex((program) => program.id === 'fire');
const ROOM_RANGES = [
  [150, 540],
  [80, 210],
  [120, 360],
  [100, 240],
  [80, 210],
  [80, 240]
];
function roomRange(id) {
  const lo = Math.max(state.minRoomArea, ROOM_RANGES[id][0]);
  return [lo, Math.max(lo * 1.65, ROOM_RANGES[id][1])];
}
function detourRoomArea(q, R, c) {
  const depth = q.R - q.r,
    w = Math.min(c.width, depth * 0.45),
    side = Math.min(c.width / Math.max(1, q.R), (q.end - q.start) * 0.21);
  return ((R * R - (q.r + w) ** 2) * Math.max(0, q.end - q.start - 2 * side)) / 2;
}

let state = defaults(),
  model = null,
  pending = 0;
const $ = (id) => document.getElementById(id),
  fmt = (n) => Math.round(n).toLocaleString('en-US'),
  clamp = (x, a, b) => Math.max(a, Math.min(b, x)),
  mod = (x, n) => ((x % n) + n) % n,
  signed = (n) => (n > 0 ? '+' : '') + fmt(n);
const coreSpecs = [
  ['areaCap', 'Floor area cap', 5000, 50000, 500, ' m²'],
  ['floors', 'Floors', 1, 10, 1, ''],
  ['footprint', 'Outer footprint', 100, 22000, 1, ' m²'],
  ['ringWidth', 'Preferred ring width', 5, 35, 0.5, ' m'],
  ['lobby', 'Combined lobby area', 0, 1000, 20, ' m²'],
  ['minRoomArea', 'Minimum core room area', 40, 200, 5, ' m²']
];
const moduleSpecs = [['modules', 'Requested modules', 0, 300, 1, '']];
// Create linked slider and numeric inputs. Send edits through the shared state and update queue.
function slider(parent, spec) {
  const [id, title, min, max, step, suffix] = spec;
  const row = document.createElement('div');
  row.className = 'field';
  row.innerHTML = `<label for="${id}">${title}<output id="${id}Out"></output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${state[id]}">`;
  $(parent).append(row);
  const range = $(id),
    out = $(id + 'Out');
  const number = document.createElement('input');
  number.type = 'number';
  number.className = 'num-edit';
  number.title = title + suffix;
  number.setAttribute('aria-label', title + (suffix ? ' (' + suffix.trim() + ')' : ''));
  number.min = min;
  number.max = max;
  number.step = step;
  out.hidden = true;
  out.after(number);
  if (suffix) {
    const unit = document.createElement('span');
    unit.className = 'field-unit';
    unit.textContent = suffix.trim();
    number.after(unit);
  }
  range.addEventListener('input', () => {
    state[id] = Number(range.value);
    if (id === 'simSpeed') {
      queueSave();
    } else scheduleUpdate();
  });
  number.addEventListener('change', () => {
    const v = Number(number.value);
    if (number.value.trim() !== '' && Number.isFinite(v)) {
      range.value = clamp(v, +range.min, +range.max);
      state[id] = Number(range.value);
      if (id === 'simSpeed') {
        queueSave();
      } else scheduleUpdate();
    } else number.value = range.value;
  });
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      number.blur();
    }
  });
  return () => {
    range.value = state[id];
    number.min = range.min;
    number.max = range.max;
    number.disabled = range.disabled;
    if (document.activeElement !== number) number.value = range.value;
    out.textContent = Number(state[id]).toLocaleString('en-US') + suffix;
  };
}
const refreshInputs = [
  ...coreSpecs.map((s) => slider('coreFields', s)),
  ...moduleSpecs.map((s) => slider('moduleFields', s)),
  slider('circulationFields', ['corridorWidth', 'Preferred corridor width', 1.5, 5, 0.1, ' m']),
  slider('featureFields', ['slideLength', 'Water slide length', 0, 100, 5, '%']),
  slider('climbFields', ['climbWidth', 'Climbing wall width', 0, 24, 0.5, ' m']),
  slider('affinityField', ['affinity', 'Clustering strength', 0, 100, 5, '%']),
  slider('mixField', ['mix', 'Core cross-pollination', 0, 100, 5, '%'])
];
refreshInputs.push(
  slider('simFields', ['simSpeed', 'Simulation speed', 1, 12, 1, '×']),
  slider('simFields', ['visitorCount', 'Human visitors', 8, 70, 1, ''])
);

VACANCY.forEach((v, i) => {
  const d = document.createElement('div');
  d.className = 'program-row';
  d.style.setProperty('--program', v.color);
  d.innerHTML = `<div class="top"><label for="vac${i}"><i class="dot" style="background:${v.color}"></i>${v.name}</label><span id="vacOut${i}"></span></div><input id="vac${i}" type="range" min="0" max="100" step="1"><div class="split"><span id="vacCount${i}"></span></div>`;
  $('vacancyFields').append(d);
  $('vac' + i).oninput = () => {
    const v = +$('vac' + i).value,
      others = state.vacancy.map((x, j) => (i === j ? 0 : x)),
      weights = others.some(Boolean) ? others : others.map((_, j) => +(j !== i));
    state.vacancy = apportion(weights, 100 - v);
    state.vacancy[i] = v;
    scheduleUpdate();
  };
});
$('autoCore').onchange = () => {
  if (!$('autoCore').checked && model) {
    state.footprint = Math.PI * model.R * model.R;
    state.ringWidth = model.width;
  }
  state.autoCore = $('autoCore').checked;
  scheduleUpdate();
};
$('inspect').onchange = () => {
  state.inspect = +$('inspect').value;
  if (model && !pending) {
    upload(model);
    queueSave();
  } else scheduleUpdate();
};
$('atriumBridges').onchange = () => {
  state.atriumBridges = $('atriumBridges').value;
  scheduleUpdate();
};
PROGRAMS.forEach((p, i) => {
  const d = document.createElement('div');
  d.className = 'program-row';
  d.style.setProperty('--program', p.color);
  d.innerHTML = `<div class="top"><label for="split${i}"><i class="dot" style="background:${p.color}"></i>${p.name}</label><span>${fmt(p.goal)} m²</span></div><input id="split${i}" type="range" min="0" max="100" step="1" value="${p.split}"><div class="split"><span id="core${i}"></span><span id="mod${i}"></span></div><div class="hint" id="actual${i}"></div>`;
  $('programFields').append(d);
  $('split' + i).addEventListener('input', () => {
    state.split[i] = Number($('split' + i).value);
    state.allocationMoves = [];
    scheduleUpdate();
  });
});
$('legend').innerHTML = PROGRAMS.map(
  (p) => `<span><i class="dot" style="background:${p.color}"></i>${p.name}</span>`
).join('');
// Reflect imported or derived state in the form without firing another edit event.
function syncControls() {
  refreshInputs.forEach((f) => f());
  $('autoCore').checked = state.autoCore;
  $('atriumBridges').value = state.atriumBridges;
  $('buildSlabThickness').value = String(state.slabThickness);
  const pitch = floorPitch(state.slabThickness);
  $('buildStoreyNote').textContent =
    `${pitch.toFixed(2)} m floor to floor · ${(pitch - state.slabThickness).toFixed(2)} m typical clear to slab soffit.`;
  $('footprint').disabled = state.autoCore;
  $('footprint').closest('.field').querySelector('.num-edit').disabled = state.autoCore;
  PROGRAMS.forEach((p, i) => {
    $('split' + i).value = state.split[i];
    $('core' + i).textContent = state.split[i] + '% core';
    $('mod' + i).textContent = 100 - state.split[i] + '% modular';
  });
  for (const k of ['roof', 'grid', 'supports', 'showModules', 'showPeople', 'showAnimals'])
    $(k).checked = state[k];
  state.inspect = Math.min(state.inspect, state.floors);
  $('inspect').innerHTML =
    '<option value="0">All + roof</option>' +
    Array.from({ length: state.floors }, (_, i) => state.floors - i)
      .map((n) => `<option value="${n}">${n === 1 ? 'Ground only' : 'Ground – L' + n}</option>`)
      .join('');
  $('inspect').value = state.inspect;
  VACANCY.forEach((v, i) => {
    $('vac' + i).value = state.vacancy[i];
    $('vacOut' + i).textContent = state.vacancy[i] + '%';
  });
}
// Keep the former default relationship influence independent of clustering.
const RELATIONSHIP_WEIGHT = 0.7;
// Signed relationships: proximity controls magnitude, the edge mode controls sign.
const relationKey = (i, j) => Math.min(i, j) + '-' + Math.max(i, j);
function relationMode(i, j) {
  return state.relations[relationKey(i, j)] || 'neutral';
}
function programsRepel(i, j) {
  return i !== j && relationMode(i, j) === 'repel';
}
function relationMagnitude(i, j, points = state.points) {
  return Math.max(
    0.05,
    1 -
      Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) /
        1.72
  );
}
function relationCost(i, j, sameFloor = true) {
  if (i < 0 || j < 0 || i >= 5 || j >= 5 || i === j) return 0;
  const mode = relationMode(i, j);
  return mode === 'neutral'
    ? 0
    : (mode === 'repel' ? (sameFloor ? 1 : 0) : -1) * relationMagnitude(i, j);
}
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function apportion(weights, count) {
  let s = weights.reduce((a, b) => a + b, 0);
  if (!count || !s) return weights.map(() => 0);
  let raw = weights.map((x) => (x / s) * count),
    out = raw.map(Math.floor);
  let order = raw.map((x, i) => ({ i, r: x - out[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  let left = count - out.reduce((a, b) => a + b, 0);
  for (let j = 0; j < left; j++) out[order[j].i]++;
  return out;
}
// SEEDED CORE ROOM GENERATOR. Each level has one or two independent annular bands.
// Consume exact gross program area budgets, with varied program-specific room sizes.
// Disjoint annular zones; circulation is carved from the same floor plate, never added to it.
// Subtract angular reservations from the ring and return sorted free intervals in [0, 2π].
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
// Saved material studies may still contain the original single entrance.
function lobbyBays(lobby) {
  return lobby.area ? (lobby.bays ?? [{ angle: lobby.angle, span: lobby.span }]) : [];
}

function lobbyHoles(lobby, floor) {
  return floor < lobby.levels ? lobbyBays(lobby).map(({ angle, span }) => [angle, span / 2]) : [];
}

// A bridge spans one upper level on a chord beside the mast, with a passage to the outer corridor
// at either end. Rotating the same chord makes the radial and aligned spans comparable.
function designAtriumBridges(r, lobby, liftHalf) {
  if (state.atriumBridges === 'off' || state.floors < 2) return [];
  // Keep the edge close to the mast with a fixed schematic gap at any atrium size.
  const width = Math.min(2.2, r * 0.32),
    mastGap = 0.65,
    offset = swingMastRadius(r) + width / 2 + mastGap,
    halfSpan = Math.acos(offset / r);
  const outerEdge = offset + width / 2;
  if (outerEdge >= r - 0.05) return [];
  const accessHalf = Math.acos((offset - width / 2) / r) - Math.acos(outerEdge / r) + 0.015,
    phases = Array.from({ length: state.floors - 1 }, (_, i) =>
      state.atriumBridges === 'radial' ? (i * TAU) / (state.floors - 1) : 0
    ),
    lift = lobby.angle + Math.PI / 2;
  function fits(heading, f) {
    const reserved = [[lift, liftHalf], [lift + Math.PI, liftHalf], ...lobbyHoles(lobby, f)];
    return [-1, 1].every((side) =>
      reserved.every(
        ([angle, half]) => angDist(heading + side * halfSpan, angle) > half + accessHalf
      )
    );
  }
  // Prefer an even rotation across the full stack. If a reservation prevents it, keep
  // the best fit and move only the affected radial landings to the nearest clear heading.
  const headings = Array.from({ length: 180 }, (_, i) => lobby.angle + (i * TAU) / 180);
  let start = lobby.angle,
    bestFit = -1;
  for (const heading of headings) {
    const fit = phases.filter((phase, i) => fits(heading + phase, i + 1)).length;
    if (fit > bestFit) {
      start = heading;
      bestFit = fit;
    }
    if (fit === phases.length) break;
  }
  // Integrate the circular ends so the counted floor area stops at the inner ring.
  const chordIntegral = (x) => x * Math.sqrt(r * r - x * x) + r * r * Math.asin(x / r);
  const area = chordIntegral(outerEdge) - chordIntegral(offset - width / 2);
  const bridges = [];
  for (const [i, phase] of phases.entries()) {
    const f = i + 1,
      ideal = start + phase;
    const heading = fits(ideal, f)
      ? ideal
      : state.atriumBridges === 'radial'
        ? headings.reduce(
            (best, angle) =>
              fits(angle, f) && (best == null || angDist(angle, ideal) < angDist(best, ideal))
                ? angle
                : best,
            null
          )
        : null;
    if (heading == null) continue;
    bridges.push({
      f,
      heading,
      width,
      offset,
      area,
      accessHalf,
      angles: [heading - halfSpan, heading + halfSpan]
    });
  }
  return bridges;
}

// Reserve the corridors, opposed lifts, and lobby voids before assigning room area.
function circulationPlan(r, R, lobby) {
  const width = R - r,
    cw = Math.min(state.corridorWidth, width * 0.38),
    dual = width >= 2 * cw + 8,
    outer = R - cw,
    mid = dual ? (r + outer) / 2 : 0,
    bands = dual
      ? [
          { r, R: mid - cw / 2 },
          { r: mid + cw / 2, R: outer }
        ]
      : [{ r, R: outer }];
  const axis = lobby.angle + Math.PI / 2,
    half = Math.min(0.3, Math.max(0.045, 4.1 / Math.max(4, r + width * 0.32))),
    liftR = Math.min(outer, r + Math.min(4.2, Math.max(0.01, (outer - r) * 0.75))),
    bridges = designAtriumBridges(r, lobby, half),
    bridgeArea = bridges.reduce((total, bridge) => total + bridge.area, 0),
    regions = [],
    floorPlans = [];
  const add = (f, kind, a, b, start, end, extra = {}) => {
    if (b - a < 1e-9 || end - start < 1e-9) return;
    regions.push({
      f,
      kind,
      r: a,
      R: b,
      start,
      end,
      area: ((b * b - a * a) * (end - start)) / 2,
      ...extra
    });
  };
  for (let f = 0; f < state.floors; f++) {
    const lobbyHole = lobbyHoles(lobby, f),
      lifts = [
        [axis, half],
        [axis + Math.PI, half]
      ],
      bridge = bridges.find((item) => item.f === f),
      approaches = bridge ? bridge.angles.map((angle) => [angle, bridge.accessHalf]) : [],
      arcs = openArcs([...lobbyHole, ...lifts, ...approaches]);
    // The upper gallery bridges both lobby voids so the outer corridor stays continuous.
    for (const [a, b] of openArcs(f === 1 && lobby.gallery ? [] : lobbyHole))
      add(f, 'outer', outer, R, a, b);
    if (dual) for (const [a, b] of arcs) add(f, 'inner', mid - cw / 2, mid + cw / 2, a, b);
    for (const [a, h] of approaches) add(f, 'bridgeAccess', r, outer, a - h, a + h);
    lifts.forEach(([a, h], i) => {
      add(f, 'elevator', r, liftR, a - h, a, { block: i });
      add(f, 'link', liftR, outer, a - h, a, { block: i });
      add(f, 'link', r, outer, a, a + h, { block: i });
    });
    const area = bands.reduce(
      (s, b) => s + arcs.reduce((q, [a, z]) => q + ((b.R * b.R - b.r * b.r) * (z - a)) / 2, 0),
      0
    );
    floorPlans.push({ arcs, bands, area });
  }
  return {
    width: cw,
    dual,
    axis,
    bridgeAngle: axis + half / 2,
    bridges,
    bridgeArea,
    half,
    regions,
    floorPlans,
    roomCapacity: floorPlans.reduce((a, p) => a + p.area, 0),
    area: bridgeArea + regions.reduce((a, p) => a + p.area, 0)
  };
}
// Variable sized rooms in the spaces left between corridors, lift blocks and the lobby.
// Give selected programs stable angular targets across floors, spaced apart when several are active.
// A selected program always groups. The slider adjusts the additional emphasis.
function clusterStrength() {
  return 0.6 + 0.4 * (state.affinity / 100);
}

function clusterAngle(id) {
  const n = state.cluster.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  return mod(
    ((state.seed % 360) * Math.PI) / 180 +
      (TAU * Math.max(0, n.indexOf(id))) / Math.max(1, n.length),
    TAU
  );
}
function clusterRoomBias(id, angle, clusteringStrength) {
  return state.cluster[id]
    ? Math.exp(clusteringStrength * 5.8 * Math.cos(angle - clusterAngle(id)))
    : 1;
}
// Recognize touching rooms along a band and overlapping frontages across bands on the same floor.
function roomsAreNeighbors(a, b) {
  if (a.f !== b.f) return false;
  return a.band === b.band
    ? angDist(a.end, b.start) < 1e-7 || angDist(b.end, a.start) < 1e-7
    : a.start < b.end - 1e-7 && b.start < a.end - 1e-7;
}
function repellingRoomContacts(rooms) {
  let count = 0;
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i],
        b = rooms[j];
      if (programsRepel(a.id, b.id) && roomsAreNeighbors(a, b)) count++;
    }
  return count;
}
// Improve room order inside each uninterrupted arc before carving shared lobbies.
function refineRoomPlacement(layers, corridorWidth) {
  const strength = clusterStrength();
  const clustering = state.cluster.some(Boolean);
  const repulsion = Object.values(state.relations).includes('repel');
  const attraction = Object.values(state.relations).includes('attract');
  if (!repulsion && !clustering && !attraction) return;
  const targetAngles = state.cluster.map((active, id) => (active ? clusterAngle(id) : null));
  for (const layer of layers) {
    const rooms = layer.flat();
    const initialAngles = new Map(rooms.map((room) => [room, (room.start + room.end) / 2]));
    // Repulsion wins first. For ties, align selected rooms around a shared angle
    // across floors, while preserving attracted neighbors and the seeded layout.
    function placementCost() {
      let cost = 0;
      for (const room of rooms) {
        const angle = (room.start + room.end) / 2,
          target = targetAngles[room.id];
        cost += 2 * room.area * (1 - Math.cos(angle - initialAngles.get(room)));
        if (target != null) cost += 8 * strength * room.area * (1 - Math.cos(angle - target));
      }
      for (let i = 0; i < rooms.length; i++)
        for (let j = i + 1; j < rooms.length; j++) {
          const a = rooms[i],
            b = rooms[j];
          if (relationMode(a.id, b.id) === 'attract' && roomsAreNeighbors(a, b)) {
            const [left, right] = angDist(a.end, b.start) < 1e-7 ? [a, b] : [b, a];
            const lobby = a.band === layer.length - 1 && a.band === b.band && angDist(left.end, right.start) < 1e-7
              ? sharedLobbyFit(left, right, corridorWidth) : null;
            const weight = RELATIONSHIP_WEIGHT * relationMagnitude(a.id, b.id);
            cost -= weight * (Math.min(a.area, b.area) + (lobby ? 180 : 0));
          }
        }
      return cost;
    }
    let conflicts = repulsion ? repellingRoomContacts(rooms) : 0;
    if (!conflicts && !clustering && !attraction) continue;
    let cost = placementCost();
    const arcs = [];
    for (const band of layer) {
      for (let start = 0; start < band.length; ) {
        let end = start + 1;
        while (end < band.length && Math.abs(band[end - 1].end - band[end].start) < 1e-7) end++;
        arcs.push({ band, start, end, angle: band[start].start });
        start = end;
      }
    }
    // Reorder whole rooms inside an arc, preserving their area and the circulation cuts.
    function swap(arc, i, j) {
      const { band, start, end, angle } = arc;
      [band[i], band[j]] = [band[j], band[i]];
      let cursor = angle;
      for (let k = start; k < end; k++) {
        const room = band[k],
          scale = (room.R ** 2 - room.r ** 2) / 2;
        room.start = cursor;
        cursor += room.area / scale;
        room.end = cursor;
      }
    }
    for (let pass = 0; pass < rooms.length && (conflicts || clustering || attraction); pass++) {
      let best = null,
        bestCount = conflicts,
        bestCost = cost;
      for (const arc of arcs)
        for (let i = arc.start; i < arc.end; i++)
          for (let j = i + 1; j < arc.end; j++) {
            if (arc.band[i].id === arc.band[j].id) continue;
            swap(arc, i, j);
            const count = repulsion ? repellingRoomContacts(rooms) : 0;
            const candidateCost = count <= bestCount ? placementCost() : Infinity;
            swap(arc, i, j);
            if (count < bestCount || (count === bestCount && candidateCost < bestCost - 1e-7)) {
              best = { arc, i, j };
              bestCount = count;
              bestCost = candidateCost;
            }
          }
      if (!best) break;
      swap(best.arc, best.i, best.j);
      conflicts = bestCount;
      cost = bestCost;
    }
  }
}
// Keep manual room assignments at the same physical location when the ring resizes.
function assignRoomPrograms(rooms) {
  const used = new Set();
  for (const room of rooms) {
    room.editKey = [state.seed, room.f, room.band, room.start.toFixed(5), room.end.toFixed(5)].join(
      ':'
    );
    if (!Object.hasOwn(state.roomPrograms, room.editKey)) continue;
    room.id = state.roomPrograms[room.editKey];
    used.add(room);
  }
  for (const [key, program] of Object.entries(state.roomPrograms)) {
    if (rooms.some((room) => room.editKey === key)) continue;
    const [seed, floor, band, start, end] = key.split(':').map(Number);
    if (seed !== state.seed) continue;
    let best = null,
      overlap = 0.55;
    for (const room of rooms) {
      if (used.has(room) || room.f !== floor || room.band !== band) continue;
      const shared = Math.min(end, room.end) - Math.max(start, room.start);
      const union = Math.max(end, room.end) - Math.min(start, room.start);
      if (shared / union > overlap) {
        best = room;
        overlap = shared / union;
      }
    }
    if (best) {
      best.editKey = key;
      best.id = program;
      used.add(best);
    }
  }
}

// Pack the usable ring area into program rooms while keeping the floor plates and reservations fixed.
function roomLayout(areas, r, R, floors, lobby, circulation, attempt = 0) {
  const rng = random((state.seed + attempt) ^ 0x719ae321),
    leftAll = areas.slice(),
    rooms = [],
    layers = [],
    bandN = circulation.dual ? 2 : 1,
    clusteringStrength = clusterStrength(),
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
          const below = f > 0 ? roomAt(layers[f - 1][band], angle) : UNUSED;
          const separated = [];
          const weights = remaining.map((left, id) => {
            if (left < 1e-8) return 0;
            const [minArea, maxArea] = roomRange(id),
              feasible = Math.min(space, left) >= minArea ? 1 : 0.045;
            const sameProgramPenalty =
              mix * 3.8 - (state.cluster[id] ? clusteringStrength * 3.2 : 0);
            let penalty = 0;
            for (const other of near)
              penalty +=
                id === other
                  ? sameProgramPenalty
                  : RELATIONSHIP_WEIGHT * 3.2 * relationCost(id, other);
            penalty +=
              id === below
                ? sameProgramPenalty
                : RELATIONSHIP_WEIGHT * 3.2 * relationCost(id, below, false);
            const span = Math.min(space, left, maxArea) / scale;
            separated[id] =
              !near.some((other) => programsRepel(id, other)) &&
              !(
                band > 0 &&
                layers[f][band - 1].some(
                  (other) =>
                    programsRepel(id, other.id) &&
                    other.start < angle + span - 1e-7 &&
                    other.end > angle + 1e-7
                )
              );
            const center = angle + Math.min(space, maxArea) / (2 * scale);
            return (
              Math.sqrt(left / maxArea) *
              feasible *
              Math.exp(-penalty / Math.max(1, near.length + (f > 0 ? 1 : 0))) *
              clusterRoomBias(id, center, clusteringStrength)
            );
          });
          const canSeparate = weights.some((weight, id) => weight > 0 && separated[id]);
          let id = pick(
            canSeparate ? weights.map((weight, id) => (separated[id] ? weight : 0)) : weights
          );
          if (id < 0) {
            if (space < 0.001) break;
            id = UNUSED;
          }
          const [lo, hi] = roomRange(id);
          let area =
            id === UNUSED && remaining[id] < 1e-8
              ? space
              : Math.min(lo + (hi - lo) * Math.pow(rng(), 1.7), remaining[id], space);
          if (
            remaining[id] - area > 0 &&
            remaining[id] - area < lo * 0.65 &&
            remaining[id] <= space
          )
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
  // Eliminate undersized residual rooms before carving hubs or routing the slide.
  // Adjacent rooms share identical radii; merging conserves the partition exactly.
  // Prefer matching programs. An isolated small sector becomes an open circulation alcove.
  let merged = 0,
    alcoves = 0,
    alcoveArea = 0;
  for (const layer of layers)
    for (const list of layer) {
      for (let i = 0; i < list.length; ) {
        const q = list[i];
        if (q.area >= state.minRoomArea - 1e-7) {
          i++;
          continue;
        }
        const candidates = [];
        if (i > 0 && Math.abs(list[i - 1].end - q.start) < 1e-7) candidates.push(i - 1);
        if (i + 1 < list.length && Math.abs(q.end - list[i + 1].start) < 1e-7)
          candidates.push(i + 1);
        if (candidates.length) {
          candidates.sort(
            (a, b) => +(list[b].id === q.id) - +(list[a].id === q.id) || list[b].area - list[a].area
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
          circulation.regions.push({ ...q, kind: 'residual' });
          circulation.area += q.area;
          alcoveArea += q.area;
          alcoves++;
          list.splice(i, 1);
        }
      }
    }
  refineRoomPlacement(layers, circulation.width);
  rooms.length = 0;
  for (const layer of layers) for (const list of layer) rooms.push(...list);
  // Resolve manual programs before carving lobbies or routing the slide.
  assignRoomPrograms(rooms);
  circulation.roomPacking = { minimum: state.minRoomArea, merged, alcoves, alcoveArea };
  circulation.hubs = [];
  circulation.hubArea = 0;
  circulation.doors = [];
  circulation.elevatorArea = circulation.regions
    .filter((q) => q.kind === 'elevator')
    .reduce((sum, q) => sum + q.area, 0);
  circulation.corridorArea = circulation.area - circulation.elevatorArea;
  circulation.total = circulation.area;
  return { rooms, layers, bandN, circulation };
}
// Use the same furniture and walking dimensions for placement, drawing and navigation.
function sharedLobbyFit(a, b, corridorWidth) {
  const passage = 0.8 * corridorWidth,
    depth = a.R - a.r,
    couchDepth = 0.88,
    shelfDepth = 0.25,
    tableGap = 0.34,
    radius = (a.r + a.R) / 2,
    scale = (a.R ** 2 - a.r ** 2) / 2,
    leftAvailable = Math.max(0, a.area - state.minRoomArea),
    rightAvailable = Math.max(0, b.area - state.minRoomArea),
    availableHalfLength =
      radius * Math.tan(Math.min(1, (leftAvailable + rightAvailable) / (2 * scale))),
    tableRadius = Math.min(
      1.18,
      (depth - passage) / 2 - couchDepth - shelfDepth - tableGap - 0.18,
      availableHalfLength - couchDepth - shelfDepth - tableGap - 1.22
    );
  if (tableRadius < 0.9) return null;
  const couchInner = tableRadius + tableGap,
    couchOuter = couchInner + couchDepth,
    shelfOuter = couchOuter + shelfDepth,
    arch = shelfOuter + 0.22,
    approach = arch + 0.68,
    halfSpan = Math.atan((approach + 0.32) / radius),
    target = 2 * halfSpan * scale;
  if (leftAvailable + rightAvailable < target - 1e-7) return null;
  // Use surplus on one side when the other room is already near its minimum.
  const left = clamp(target / 2, Math.max(0, target - rightAvailable), leftAvailable),
    start = a.end - left / scale,
    end = start + 2 * halfSpan;
  return {
    start,
    end,
    area: target,
    heading: (start + end) / 2,
    radius,
    passage,
    tableRadius,
    couchDepth,
    couchInner,
    couchOuter,
    shelfOuter,
    arch,
    approach
  };
}

function sharedLobbyPoint(q, along, across, y) {
  const { heading, radius } = q.layout,
    cos = Math.cos(heading),
    sin = Math.sin(heading);
  return [(radius + across) * cos - along * sin, y, (radius + across) * sin + along * cos];
}

// Trade a corridor strip with one programme room, with a return at the far end.
function planLobbyShoulder(regions, room, fit, side, inside, lobbyId) {
  const left = side < 0,
    kind = inside ? 'inner' : 'outer',
    edge = inside ? room.r : room.R,
    start = left ? room.start : fit.end,
    end = left ? fit.start : room.end,
    first = Math.min(start, fit.start),
    last = Math.max(end, fit.end);
  const corridor = regions.find(
    (q) =>
      q.f === room.f &&
      q.kind === kind &&
      Math.abs((inside ? q.R : q.r) - edge) < 1e-7 &&
      q.start <= first + 1e-7 &&
      q.end >= last - 1e-7
  );
  if (!corridor) return null;

  const low = inside ? corridor.r : room.r,
    high = inside ? room.R : corridor.R,
    returnAngle = fit.passage / low,
    doorwayAngle = left ? fit.start : fit.end,
    movedStart = left ? start + returnAngle : start,
    movedEnd = left ? end : end - returnAngle,
    movedInner = inside ? low : room.r + fit.passage,
    movedOuter = inside ? room.R - fit.passage : high,
    area = ((movedOuter ** 2 - movedInner ** 2) * (movedEnd - movedStart)) / 2;
  if (movedEnd <= movedStart || area < state.minRoomArea - 1e-7) return null;
  // The room threshold keeps the full aisle width at the end of the lounge.
  const skew = Math.cos(doorwayAngle - fit.heading);
  if (
    (fit.radius - fit.passage / 2) / skew < movedInner + 0.04 ||
    (fit.radius + fit.passage / 2) / skew > movedOuter - 0.04
  )
    return null;

  const landing = kind + 'Landing',
    shoulder = kind + 'Shoulder',
    walkingInner = inside ? movedOuter : low,
    walkingOuter = inside ? high : movedInner,
    landingAngle = left ? fit.end : fit.start;
  const sections = [];
  function add(kind, r, R, start, end, route) {
    if (end - start > 1e-8)
      sections.push({
        f: room.f,
        kind,
        r,
        R,
        start,
        end,
        area: ((R ** 2 - r ** 2) * (end - start)) / 2,
        ...(route ? { lobbyRouteId: lobbyId, route } : {})
      });
  }
  add(kind, corridor.r, corridor.R, corridor.start, first);
  add('lobbyReturn', low, high, left ? start : movedEnd, left ? movedStart : end);
  add('lobbyShoulder', walkingInner, walkingOuter, movedStart, movedEnd, shoulder);
  add('lobbyLanding', corridor.r, corridor.R, fit.start, fit.end, landing);
  add(kind, corridor.r, corridor.R, last, corridor.end);
  const entries = [
    {
      route: landing,
      angle: landingAngle + side * Math.min(0.5 / edge, (fit.end - fit.start) / 4),
      radius: edge,
      along: -side * fit.approach
    },
    {
      route: shoulder,
      angle: doorwayAngle,
      radius: (walkingInner + walkingOuter) / 2,
      along: side * fit.approach
    }
  ];
  return {
    room,
    corridor,
    sections,
    entries,
    moved: {
      r: movedInner,
      R: movedOuter,
      start: movedStart,
      end: movedEnd,
      area,
      facadeFacing: !inside,
      lobbyShoulder: true
    }
  };
}

function lobbyApproaches(layout, a, b, fit, lobbyId, slotN, blocked, pinned) {
  const { regions, dual } = layout.circulation;
  let best = null;
  for (const side of [1, -1]) {
    const outer = planLobbyShoulder(regions, side > 0 ? b : a, fit, side, false, lobbyId);
    if (!outer) continue;
    const inner = dual
      ? planLobbyShoulder(regions, side > 0 ? a : b, fit, -side, true, lobbyId)
      : null;
    if (dual && !inner) continue;
    const clearance = Math.atan(0.8 / outer.moved.R),
      docks = [];
    for (let dock = 0; dock < slotN; dock++) {
      const angle = (dock * TAU) / slotN,
        id = outer.room.f * slotN + dock;
      if (
        !blocked.has(id) &&
        mod(angle - outer.moved.start + clearance, TAU) <
          outer.moved.end - outer.moved.start + 2 * clearance
      )
        docks.push(id);
    }
    if (docks.some((id) => pinned.has(id))) continue;
    if (!best || docks.length < best.docks.length)
      best = { approaches: inner ? [outer, inner] : [outer], docks };
  }
  return best;
}

// Slide the lounge within the available room surplus to find a genuine corner
// without taking a manually assigned dock or reducing a room below its minimum.
function placeLobbyApproaches(layout, a, b, fit, lobbyId, slotN, blocked, pinned, dockBudget) {
  const areaPerRadian = (a.R ** 2 - a.r ** 2) / 2,
    minimum = a.end - Math.min(fit.area, a.area - state.minRoomArea) / areaPerRadian,
    maximum = a.end - Math.max(0, fit.area - (b.area - state.minRoomArea)) / areaPerRadian;
  const choices = [
    fit.start,
    ...Array.from({ length: 9 }, (_, i) => minimum + ((maximum - minimum) * i) / 8)
  ].sort((x, y) => Math.abs(x - fit.start) - Math.abs(y - fit.start));
  for (const start of choices) {
    const offset = start - fit.start,
      shifted = { ...fit, start, end: fit.end + offset, heading: fit.heading + offset },
      plan = lobbyApproaches(layout, a, b, shifted, lobbyId, slotN, blocked, pinned);
    if (plan && plan.docks.length <= dockBudget) return { ...plan, fit: shifted };
  }
  return null;
}

// Carve lobbies after the slide has reserved its landing rooms and façade bypasses.
function formSharedLobbies(layout, slotN, blocked, blockedLimit) {
  const { circulation, rooms } = layout;
  const hubs = [],
    pinned = new Set(
      Object.keys(state.modulePrograms).map((key) => {
        const [columns, floor, dock] = key.split(':').map(Number);
        return floor * slotN + (Math.round((dock / columns) * slotN) % slotN);
      })
    );
  for (const layer of layout.layers)
    for (const list of layer) {
      const pairs = [];
      for (let j = 0; j < list.length; j++) {
        const a = list[j],
          b = list[(j + 1) % list.length];
        if (
          a === b ||
          a.facadeFacing ||
          b.facadeFacing ||
          a.lobbyShoulder ||
          b.lobbyShoulder ||
          !PROGRAMS[a.id] ||
          !PROGRAMS[b.id] ||
          angDist(a.end, b.start) > 1e-7 ||
          relationMode(a.id, b.id) !== 'attract'
        )
          continue;
        const fit = sharedLobbyFit(a, b, circulation.width);
        if (fit)
          pairs.push({ a, b, fit, weight: RELATIONSHIP_WEIGHT * relationMagnitude(a.id, b.id) });
      }
      pairs.sort((a, b) => b.weight - a.weight);
      for (const { a, b, fit: initialFit, weight } of pairs) {
        if (a.sharedLobby || b.sharedLobby) continue;
        const boundary = a.end,
          scale = (a.R ** 2 - a.r ** 2) / 2,
          id = hubs.length,
          plan = placeLobbyApproaches(
            layout,
            a,
            b,
            initialFit,
            id,
            slotN,
            blocked,
            pinned,
            blockedLimit - blocked.size
          );
        if (!plan) continue;
        const { approaches, docks, fit } = plan;
        const hubInner = a.r,
          hubOuter = a.R;
        a.end = fit.start;
        b.start = fit.end - (b.start < boundary - Math.PI ? TAU : 0);
        a.area -= (boundary - fit.start) * scale;
        b.area -= (fit.end - boundary) * scale;
        for (const { room, corridor, moved, sections } of approaches) {
          circulation.area += sections.reduce((sum, q) => sum + q.area, 0) - corridor.area;
          circulation.regions.splice(circulation.regions.indexOf(corridor), 1, ...sections);
          Object.assign(room, moved);
        }
        for (const dock of docks) blocked.add(dock);
        const doors = [a, b].map((room, side) => {
          const angle = side ? b.start : a.end,
            skew = Math.cos(angle - fit.heading);
          room.sharedLobby = {
            id,
            angle,
            r: fit.radius / skew,
            width: fit.passage / skew
          };
          return {
            ...room.sharedLobby,
            f: room.f,
            program: room.id,
            kind: 'shared',
            pair: [a.id, b.id]
          };
        });
        hubs.push({
          kind: 'hub',
          f: a.f,
          band: a.band,
          r: hubInner,
          R: hubOuter,
          start: fit.start,
          end: fit.end,
          area: fit.area,
          clearWidth: fit.passage,
          pair: [a.id, b.id],
          strength: weight,
          lobbyId: id,
          doors,
          layout: {
            ...fit,
            publicEntries: approaches.flatMap((approach) => approach.entries)
          }
        });
      }
    }
  circulation.hubs = hubs;
  circulation.corridorArea = circulation.area - circulation.elevatorArea;
  circulation.hubArea = hubs.reduce((total, hub) => total + hub.area, 0);
  circulation.total = circulation.area + circulation.hubArea;
  circulation.doors = [
    ...rooms
      .filter((room) => !room.sharedLobby && room.area > 0.001)
      .map((room) => {
        const r = room.facadeFacing ? room.r : room.R;
        return {
          f: room.f,
          program: room.id,
          angle: (room.start + room.end) / 2,
          r,
          width: Math.min(1.2, (room.end - room.start) * r * (room.facadeFacing ? 0.6 : 0.68)),
          kind: 'corridor'
        };
      }),
    ...hubs.flatMap((hub) => hub.doors)
  ];
}

function roomAt(rooms, angle) {
  for (const s of rooms) {
    if (mod(angle - s.start, TAU) < s.end - s.start + 1e-8) return s.id;
  }
  return UNUSED;
}
// Distribute adaptive uses across only the vacant, unblocked docks.
function assignVacancies(slots, retailCount) {
  const vacant = slots.filter((s) => !s.blocked && s.p === EMPTY),
    weights = state.vacancy.slice(0, 3),
    counts = apportion(
      weights.some(Boolean) ? weights : [1, 0, 0],
      vacant.length - retailCount
    ).concat(retailCount),
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

function angDist(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}
// Size the exterior climb and reserve any dock that would intersect the wall.
function designClimbing(R, slotN, lobby, floorH) {
  if (!state.climbWidth) return null;
  const face = R + 0.3,
    width = Math.min(state.climbWidth, face * Math.PI * 0.6),
    half = width / (2 * face),
    rear = lobbyBays(lobby)[1],
    // Keep the climbing face beside the rear lobby instead of across its opening.
    angle = mod(lobby.angle + Math.PI + (rear ? rear.span / 2 + half + 1.6 / face : 0), TAU),
    blocked = new Set(),
    pad = Math.atan((MODULE.width / 2 + 1) / (R + 0.65));
  const height = Math.min(19.8, state.floors * floorH);
  for (let f = 0; f < state.floors && f * floorH < height; f++)
    for (let j = 0; j < slotN; j++)
      if (angDist((j * TAU) / slotN, angle) <= half + pad) blocked.add(f * slotN + j);
  return { angle, width, half, face, height, clearance: 5, blocked };
}
// Choose feasible Infinite Rinse slide endpoints, sweep the path, and reserve its dock crossings.
function swingMastRadius(radius) {
  return Math.min(2.2, radius * 0.64 * 0.37);
}

const SWING_SEAT_WIDTH = 0.85;
const SWING_SEAT_DEPTH = 0.52;

function designRideAndSlide(layout, R, r, slotN, lobby, floorH) {
  const towerRadius = swingMastRadius(r),
    originalPlatform = Math.min(8.2, r * 0.64),
    boardingRadius = Math.max(towerRadius + 0.18, originalPlatform - 0.55),
    seatOuterEdge = Math.hypot(boardingRadius + SWING_SEAT_WIDTH / 2, SWING_SEAT_DEPTH / 2),
    // Leave room for the stair in a small atrium without expanding the chair orbit.
    platformRadius = Math.min(seatOuterEdge + 1, Math.max(originalPlatform, r - 0.9));
  const flightRadius = 12,
    speedKmh = 40;
  const ride = {
    towerRadius,
    boardingRadius,
    platformRadius,
    glassInnerRadius: platformRadius,
    height: 117,
    roofLevel: state.floors * floorH + 0.18,
    flightRadius,
    speedKmh,
    rpm: (speedKmh / 3.6 / (TAU * flightRadius)) * 60
  };
  const climbing = designClimbing(R, slotN, lobby, floorH),
    none = () => ({ ride, slide: null, climbing, blocked: new Set() });
  if (!state.slideLength || state.floors < 2) return none();
  const outer = layout.rooms.filter(
    (q) =>
      q.id === 0 &&
      q.band === layout.bandN - 1 &&
      (q.end - q.start) * R >= 5.2 &&
      q.R - q.r >= 2.4 &&
      detourRoomArea(q, R, layout.circulation) >= state.minRoomArea - 1e-7
  );
  const desired = 20 + state.slideLength * 1.45,
    radius = R + Math.min(5.5, Math.max(3.5, R * 0.18)),
    tubeRadius = 1.15;
  // Pad the angular crossing by the tube radius, plus a smooth 6 m transition at either side.
  const expanded = climbing ? climbing.half + (tubeRadius + 0.5) / climbing.face : 0,
    shoulder = 6 / R;
  const bulge = (angle, base) => {
    if (!climbing) return base;
    const d = angDist(angle, climbing.angle),
      t = clamp((d - expanded) / shoulder, 0, 1),
      w = 1 - t * t * (3 - 2 * t),
      target = climbing.face + climbing.clearance + tubeRadius + 0.18;
    return Math.max(base, base + w * Math.max(0, target - base));
  };
  let best = null;
  // Prefer a launch in a large upper Rinse cluster, then match a lower Rinse facade room and desired travel length.
  const rooms = outer.map((room) => ({
    ...room,
    angle: (room.start + room.end) / 2,
    cluster: outer.reduce(
      (a, q) =>
        a +
        (Math.abs(q.f - room.f) <= 1 &&
        angDist((q.start + q.end) / 2, (room.start + room.end) / 2) < 0.48
          ? q.area
          : 0),
      0
    )
  }));
  for (const a of rooms)
    for (const b of rooms) {
      if (a.f <= b.f) continue;
      if (climbing && [a, b].some((q) => angDist(q.angle, climbing.angle) < expanded + shoulder))
        continue;
      const topY = a.f * floorH + 2.85,
        bottomY = b.f * floorH + 1.72,
        drop = topY - bottomY;
      for (const dir of [-1, 1]) {
        const arc = dir * mod(dir * (b.angle - a.angle), TAU);
        const length = Math.abs(arc) * radius;
        if (length < 7 || Math.abs(arc) > TAU * 0.92) continue;
        const approx = length + radius - R,
          grade = drop / approx;
        if (grade < 0.055 || grade > 0.32) continue;
        if (
          lobby.area &&
          Array.from({ length: 65 }, (_, i) => i / 64).some(
            (t) =>
              topY - drop * t < lobby.levels * floorH + 1.8 &&
              lobbyBays(lobby).some(
                (bay) => angDist(a.angle + arc * t, bay.angle) < bay.span / 2 + 0.1
              )
          )
        )
          continue;
        const score =
          (Math.abs(approx - desired) / Math.max(20, desired)) * 2.6 +
          Math.abs(grade - 0.15) * 3 -
          0.45 * Math.min(1, a.cluster / 850) -
          (0.18 * a.f) / Math.max(1, state.floors - 1);
        if (!best || score < best.score) best = { a, b, arc, topY, bottomY, drop, score };
      }
    }
  if (!best) return none();
  const { a, b, arc, topY, bottomY, drop } = best;
  // Continuous sloped centreline: exit and entry at the facade, curving out over the dock band.
  const n = Math.max(40, Math.ceil((Math.abs(arc) * (radius + 3) + 12) / 0.35)),
    points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      angle = a.angle + arc * t,
      inside = R - Math.min(OUTER_WALL_THICKNESS, (R - r) * 0.45) - 0.3,
      base = inside + (radius - inside) * Math.min(1, Math.sin(Math.PI * t) * 4),
      rad = bulge(angle, base);
    points.push([rad * Math.cos(angle), 0, rad * Math.sin(angle)]);
  }
  let run = 0;
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
    distances.push(run);
  }
  points.forEach((p, i) => (p[1] = topY - (drop * distances[i]) / run));
  const blocked = new Set();
  for (let f = 0; f < state.floors; f++)
    for (let j = 0; j < slotN; j++) {
      const angle = (j * TAU) / slotN,
        c = Math.cos(angle),
        s = Math.sin(angle),
        y = f * floorH + 0.43;
      // Expanded dock box, including clearance for rails and frames. Sample interval below one meter.
      if (
        points.some((p) => {
          const rad = p[0] * c + p[2] * s,
            tan = -p[0] * s + p[2] * c,
            pad = tubeRadius + 0.65;
          return (
            rad >= R - 0.15 - pad &&
            rad <= R + 0.65 + MODULE.depth + pad &&
            Math.abs(tan) <= MODULE.width / 2 + pad &&
            p[1] >= y - 0.25 - pad &&
            p[1] <= y + MODULE.height + pad
          );
        })
      )
        blocked.add(f * slotN + j);
    }
  const slide = {
    startFloor: a.f,
    endFloor: b.f,
    startAngle: a.angle,
    endAngle: b.angle,
    arc,
    radius,
    tubeRadius,
    topY,
    bottomY,
    run: Math.hypot(run, drop),
    horizontalRun: run,
    drop,
    grade: drop / run,
    points
  };
  if (climbing) {
    const crossing = points.filter(
      (p) => angDist(Math.atan2(p[2], p[0]), climbing.angle) <= expanded
    );
    slide.climbCrossing = crossing.length > 0;
    slide.climbClearance = crossing.length
      ? Math.min(...crossing.map((p) => Math.hypot(p[0], p[2]) - climbing.face - tubeRadius))
      : null;
  }
  return { ride, slide, climbing, blocked };
}

// Lay out the public roof, keeping enclosed service and retail area separate from open paths and gardens.
function designRoof(R, r, circulation, floorH) {
  const y = state.floors * floorH + 0.48,
    w = R - r,
    walk = Math.min(2.4, w * 0.33),
    outer = R - walk - 0.35,
    inner = r + Math.min(1.3, w * 0.14);
  const lifts = circulation.regions
    .filter((q) => q.kind === 'elevator' && q.f === state.floors - 1)
    .map((q) => ({ ...q, y, accessHeight: 3.0, serviceHeight: 1.8, area: q.area }));
  const serviceArea = 2 * lifts.reduce((a, q) => a + q.area, 0),
    rng = random(state.seed ^ 0x88762ab),
    heightRandom = random(state.seed ^ 0x51a709f2),
    pavilions = [],
    garden = [];
  // Use bounded annular patches. Keep the continuous outer walk and lift/bridge approaches clear.
  const free = openArcs([
    [circulation.axis, circulation.half + 0.19],
    [circulation.axis + Math.PI, circulation.half + 0.19]
  ]);
  if (outer - inner > 1.15) {
    const scale = (outer * outer - inner * inner) / 2;
    const segments = [];
    for (const [a, b] of free) {
      const n = Math.max(1, Math.floor(((b - a) * (inner + outer)) / 2 / 13));
      for (let j = 0; j < n; j++) {
        const start = a + ((b - a) * j) / n,
          end = a + ((b - a) * (j + 1)) / n;
        if ((end - start) * scale > 12) segments.push({ start, end });
      }
    }
    const ordered = segments.map((q) => ({ ...q, key: rng() })).sort((a, b) => a.key - b.key),
      desired = Math.min(5, 3 + Math.floor(rng() * 3));
    const budget = Math.min(240, state.areaCap * 0.012, Math.PI * (R * R - r * r) * 0.11);
    for (const q of ordered) {
      if (pavilions.length >= desired) break;
      const area = Math.min(
        (budget / desired) * (0.78 + 0.35 * rng()),
        (q.end - q.start) * scale * 0.5
      );
      if (area < 11) continue;
      const mid = (q.start + q.end) / 2,
        twoStoreys = area >= 28 && heightRandom() < 0.42,
        footprint = twoStoreys ? area / 1.62 : area,
        span = footprint / scale,
        // A smaller upper room varies the silhouette within the same enclosed area.
        upperSpan = twoStoreys ? span * 0.62 : 0;
      pavilions.push({
        r: inner,
        R: outer,
        start: mid - span / 2,
        end: mid + span / 2,
        area: footprint,
        upper: twoStoreys
          ? {
              start: mid - upperSpan / 2,
              end: mid + upperSpan / 2,
              area: footprint * 0.62
            }
          : null
      });
    }
    for (const q of segments) {
      if (pavilions.some((p) => p.start < q.end && p.end > q.start)) continue;
      const mid = (q.start + q.end) / 2,
        half = Math.min((q.end - q.start) * 0.25, 3.8 / ((inner + outer) / 2));
      if (half > 0.025)
        garden.push({
          r: inner + 0.12,
          R: outer - 0.12,
          start: mid - half,
          end: mid + half,
          kind: rng() < 0.22 ? 'gazebo' : 'garden'
        });
    }
  }
  const retailFootprint = pavilions.reduce((a, q) => a + q.area, 0),
    retailArea = retailFootprint + pavilions.reduce((a, q) => a + (q.upper?.area ?? 0), 0),
    liftFootprint = serviceArea / 2,
    area = serviceArea + retailArea;
  return {
    y,
    walk,
    lifts,
    pavilions,
    garden,
    retailArea,
    serviceArea,
    area,
    publicArea: Math.max(0, Math.PI * (R * R - r * r) - liftFootprint - retailFootprint)
  };
}

// Fit a stair over the cone. Each flight's last tread reaches the roof pitch so the
// longer intermediate landings stay above the continuous glass below them.
function designSwingRoof(ride, radius, publicDeckY) {
  const run = radius - ride.platformRadius,
    rise = Math.min(8.4, run * 0.56),
    eaveY = publicDeckY + 0.082,
    stepCount = Math.ceil(rise / 0.18),
    flights = Math.ceil(rise / 3.1),
    stairs = [];
  for (let flight = 0; flight < flights; flight++) {
    const start = Math.round((stepCount * flight) / flights),
      end = Math.round((stepCount * (flight + 1)) / flights),
      flightRun = (run * (end - start)) / stepCount,
      landing = flight + 1 < flights ? Math.min(1.2, flightRun * 0.18) : 0,
      going = (flightRun - landing) / (end - start - Number(landing > 0));
    let outer = radius - (run * start) / stepCount;
    for (let step = start; step < end; step++) {
      const inner = step + 1 === end ? radius - (run * end) / stepCount : outer - going;
      stairs.push({
        r: inner,
        R: outer,
        y: eaveY + (rise * (step + 1)) / stepCount,
        landing: step === end - 1 && flight + 1 < flights
      });
      outer = inner;
    }
  }
  return {
    eaveY,
    rise,
    canopyEaveY: publicDeckY,
    canopyRidgeY: eaveY + rise,
    // The sealed ridge curb reaches the boarding deck above the glazing line.
    ridgeGlazingY: eaveY + rise - 0.34,
    stairHalfAngle: Math.min(0.22, 0.95 / ride.platformRadius),
    stairs
  };
}

// Reconfigure the outer corridor at each slide landing. The original room's angular
// extent becomes a facade room with an inner bypass and two radial returns. No overlapping floor area.
function connectSlide(layout, feature, R, slotN) {
  const s = feature.slide;
  if (!s) return;
  const c = layout.circulation,
    endpoints = [
      { f: s.startFloor, a: s.startAngle },
      { f: s.endFloor, a: s.endAngle }
    ],
    clearance = new Set(feature.blocked),
    halfCell = TAU / (slotN * 2);
  s.connections = [];
  s.facadeDetours = [];
  s.clearanceBlockedSlots = [...clearance];
  function moveRoom(q, landing = false) {
    const a = q.start,
      b = q.end,
      depth = q.R - q.r,
      old = q.area,
      center = (a + b) / 2,
      w = Math.min(c.width, depth * 0.45),
      side = Math.min(c.width / Math.max(1, q.R), (b - a) * 0.21),
      start = a + side,
      end = b - side;
    const region = c.regions.find(
      (x) => x.f === q.f && x.kind === 'outer' && x.start <= a + 1e-7 && x.end >= b - 1e-7
    );
    if (!region || detourRoomArea(q, R, c) < state.minRoomArea - 1e-7) return false;
    const i = c.regions.indexOf(region),
      replacement = [];
    const add = (kind, r, rad, lo, hi) => {
      if (hi - lo > 1e-9 && rad - r > 1e-9)
        replacement.push({
          f: q.f,
          kind,
          r,
          R: rad,
          start: lo,
          end: hi,
          area: ((rad * rad - r * r) * (hi - lo)) / 2
        });
    };
    add('outer', region.r, region.R, region.start, a);
    add('outer', region.r, region.R, b, region.end);
    add('slide_return', q.r, R, a, start);
    add('slide_return', q.r, R, end, b);
    add('slide_bypass', q.r, q.r + w, start, end);
    c.regions.splice(i, 1, ...replacement);
    q.r += w;
    q.R = R;
    q.start = start;
    q.end = end;
    q.area = ((R * R - q.r * q.r) * (end - start)) / 2;
    q.facadeFacing = true;
    q.slideLanding = landing;
    q.slideDetour = !landing;
    q.slideDoorRadius = q.r;
    // The new room front cannot serve a dock. Reserve every overlapping docking threshold
    // (but do not cascade the next detour selection from these additional frontage reservations).
    const pad = Math.atan((MODULE.width / 2 + 0.5) / R);
    for (let j = 0; j < slotN; j++) {
      const angle = (j * TAU) / slotN;
      if (mod(angle - start + pad, TAU) < end - start + 2 * pad)
        feature.blocked.add(q.f * slotN + j);
    }
    const info = {
      floor: q.f,
      program: P[q.id].id,
      angle: center,
      roomArea: q.area,
      previousRoomArea: old,
      bypassWidth: w,
      roomStart: q.start,
      roomEnd: q.end,
      roomInner: q.r,
      roomOuter: q.R
    };
    (landing ? s.connections : s.facadeDetours).push(info);
    return true;
  }
  for (const e of endpoints) {
    const q = layout.rooms.find(
      (q) =>
        q.id === 0 &&
        q.f === e.f &&
        q.band === layout.bandN - 1 &&
        angDist((q.start + q.end) / 2, e.a) < 1e-6
    );
    if (!q || !moveRoom(q, true)) throw Error('Slide landing missing');
  }
  // Slide clearance is a spatial opportunity, even where the ride does not enter the core.
  // Reposition each *eligible* outer room that substantially overlaps a physical blocked bay.
  // Do not overwrite the lobby, lift links, shared hubs, or the direct Rinse endpoints.
  const byFloor = Array.from({ length: state.floors }, () => []);
  for (const idx of clearance) byFloor[Math.floor(idx / slotN)].push(((idx % slotN) * TAU) / slotN);
  for (const q of layout.rooms) {
    if (
      q.facadeFacing ||
      q.band !== layout.bandN - 1 ||
      q.id >= P.length ||
      q.R - q.r < 2.2 ||
      (q.end - q.start) * R < 3.6
    )
      continue;
    const mid = (q.start + q.end) / 2,
      half = (q.end - q.start) / 2;
    if (
      !byFloor[q.f].some((a) => {
        const d = angDist(a, mid),
          overlap = Math.min(2 * half, 2 * halfCell, half + halfCell - d);
        return overlap >= 0.3 * Math.min(2 * half, 2 * halfCell);
      })
    )
      continue;
    moveRoom(q, false);
  }
  c.area = c.bridgeArea + c.regions.reduce((a, q) => a + q.area, 0);
  c.corridorArea = c.area - c.elevatorArea;
  c.total = c.area + c.hubArea;
}

// Allocate an integer module inventory without exceeding any program goal.
const BASE_TARGET = PROGRAMS.reduce((sum, p) => sum + p.goal, 0),
  MIN_COURT_RADIUS = 3;
function goalsForRetail(k, l = 0, roof = 0) {
  return PROGRAMS.map(
    (p) => (p.goal * Math.max(0, state.areaCap - k * MODULE.area - l - roof)) / BASE_TARGET
  );
}
function inventory(request, goals = goalsForRetail(0)) {
  const weights = goals.map((g, i) => (g * (100 - state.split[i])) / 100);
  const caps = goals.map((g, i) =>
    weights[i] > 0
      ? Math.max(0, Math.floor((g - (i === 0 ? Math.PI * MIN_COURT_RADIUS ** 2 : 0)) / MODULE.area))
      : 0
  );
  const count = Math.min(
      request,
      caps.reduce((a, b) => a + b, 0)
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
function slotCapacity(R) {
  return Math.max(1, Math.floor(TAU / (2 * Math.atan((MODULE.width + 0.9) / (2 * (R + 0.65))))));
}
// Solve the annular radius for the area budget, subject to the greenhouse and preferred ring width.
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
// Regenerate the architectural model from state. Fit floor area, reserve features, and then place the inventory.
function derive(dockVariant = state.dockVariant) {
  const floorHeight = floorPitch(state.slabThickness),
    sum = (a) => a.reduce((x, y) => x + y, 0),
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
      voidBudget = l * (levels - 1),
      roofPlan,
      circulation,
      lobby;
    // Fit the roof and the net void above the two lobbies, including their upper gallery.
    for (let pass = 0; pass < 40; pass++) {
      goals = goalsForRetail(k, l, roofBudget);
      counts = inventory(n, goals);
      count = sum(counts);
      required = goals.map((a, i) => a - counts[i] * MODULE.area);
      A = state.areaCap - (count + k) * MODULE.area - roofBudget + voidBudget;
      if (
        required[0] < Math.PI * MIN_COURT_RADIUS ** 2 - 1e-7 ||
        A < Math.PI * MIN_COURT_RADIUS ** 2 + 0.01
      )
        return null;
      geom = manual || autoGeometry(A, required[0]);
      ringPer = Math.PI * (geom.R * geom.R - geom.r * geom.r);
      const allowed = Math.max(
        0,
        Math.min(state.lobby, ringPer * 0.38, ((A - Math.PI * geom.r * geom.r) / levels) * 0.95)
      );
      if (l > allowed + 1e-6) {
        l = allowed * 0.999;
        voidBudget = Math.min(voidBudget, l);
        continue;
      }
      const span = ringPer ? (TAU * l) / ringPer : 0;
      const gallery =
        levels > 1 && l > 0 ? geom.R - Math.min(state.corridorWidth, geom.width * 0.38) : null;
      lobby = {
        area: l,
        voidArea: gallery == null ? 0 : 0.5 * (gallery ** 2 - geom.r ** 2) * span,
        levels,
        gallery,
        angle,
        span,
        bays: [angle, angle + Math.PI].map((heading) => ({ angle: heading, span: span / 2 })),
        blocked: new Set()
      };
      lobby.volume = (l + lobby.voidArea) * floorHeight;
      circulation = circulationPlan(geom.r, geom.R, lobby);
      roofPlan = designRoof(geom.R, geom.r, circulation, floorHeight);
      const need = roofPlan.area + 0.00002;
      const netVoid = lobby.voidArea - circulation.bridgeArea;
      if (Math.abs(need - roofBudget) + Math.abs(netVoid - voidBudget) < 0.000005) break;
      roofBudget = need;
      voidBudget = netVoid;
      if (pass === 39) return null;
    }
    const { R, r, width } = geom,
      court = Math.PI * r * r,
      ringArea = ringPer * state.floors - lobby.voidArea,
      programRing = ringArea - l,
      slotN = slotCapacity(R),
      rawMax = slotN * state.floors;
    if (
      !roofPlan ||
      count + k > rawMax ||
      ringArea + circulation.bridgeArea + court + (count + k) * MODULE.area + roofPlan.area >
        state.areaCap + 1e-6 ||
      programRing < 0
    )
      return null;
    if (l > 0)
      for (let f = 0; f < levels; f++)
        for (let j = 0; j < slotN; j++)
          if (
            lobbyBays(lobby).some(
              (bay) =>
                angDist((j * TAU) / slotN, bay.angle) <=
                bay.span / 2 + Math.atan((MODULE.width / 2 + 0.5) / (R + 0.65))
            )
          )
            lobby.blocked.add(f * slotN + j);
    const available = Math.max(0, circulation.roomCapacity),
      ringDesired = required.map((a, i) => Math.max(0, a - (i === 0 ? court : 0))),
      wanted = sum(ringDesired),
      factor = wanted ? Math.min(1, available / wanted) : 0,
      ring = ringDesired.map((x) => x * factor);
    ring.push(Math.max(0, available - sum(ring)));
    const pack = (attempt) =>
      roomLayout(
        ring,
        r,
        R,
        state.floors,
        lobby,
        { ...circulation, regions: circulation.regions.slice() },
        attempt
      );
    let layout = pack(0);
    const hasRepel = Object.values(state.relations).includes('repel');
    const activeClusters = PROGRAMS.map((_, id) => id).filter((id) => state.cluster[id]);
    const requestedRooms = Object.keys(state.roomPrograms).filter((key) =>
      key.startsWith(String(state.seed) + ':')
    ).length;
    if (hasRepel || activeClusters.length || requestedRooms) {
      // Compare seeded alternatives when the first floor quotas leave conflicts or
      // scatter a selected program. Penalize missing area as well as angular drift.
      const alignment = (rooms) =>
        activeClusters.reduce((cost, id) => {
          const target = clusterAngle(id),
            programRooms = rooms.filter((room) => room.id === id);
          const missing = Math.max(0, ring[id] - sum(programRooms.map((room) => room.area)));
          const drift = sum(
            programRooms.map(
              (room) => room.area * (1 - Math.cos((room.start + room.end) / 2 - target))
            )
          );
          return cost + (2 * missing + drift) / Math.max(1, ring[id]);
        }, 0);
      let conflicts = hasRepel ? repellingRoomContacts(layout.rooms) : 0;
      const matchedRooms = (candidate) =>
        candidate.rooms.filter((room) => Object.hasOwn(state.roomPrograms, room.editKey)).length;
      let matches = matchedRooms(layout);
      let cost = alignment(layout.rooms);
      const clusterAttempts = Math.ceil(3 * clusterStrength());
      for (
        let attempt = 1;
        attempt <= 5 &&
        (matches < requestedRooms ||
          conflicts > 0 ||
          (activeClusters.length && attempt <= clusterAttempts));
        attempt++
      ) {
        const alternate = pack(attempt);
        const count = hasRepel ? repellingRoomContacts(alternate.rooms) : 0;
        const alternateCost = alignment(alternate.rooms);
        const alternateMatches = matchedRooms(alternate);
        if (
          alternateMatches > matches ||
          (alternateMatches === matches &&
            (count < conflicts || (count === conflicts && alternateCost < cost - 1e-7)))
        ) {
          layout = alternate;
          matches = alternateMatches;
          conflicts = count;
          cost = alternateCost;
        }
      }
    }
    circulation = layout.circulation;
    const feature = designRideAndSlide(layout, R, r, slotN, lobby, floorHeight);
    // The boarding platform completes the cone's inner edge all the way to the mast.
    const ride = feature.ride;
    ride.roofPitch = designSwingRoof(ride, r, roofPlan.y);
    ride.roofLevel = ride.roofPitch.canopyRidgeY - 0.16;
    connectSlide(layout, feature, R, slotN);
    const blocked = new Set([
        ...feature.blocked,
        ...lobby.blocked,
        ...(feature.climbing?.blocked || [])
      ]);
    formSharedLobbies(layout, slotN, blocked, rawMax - count - k);
    const actualRing = P.map((p, i) =>
        sum(layout.rooms.filter((q) => q.id === i).map((q) => q.area))
      ),
      core = actualRing.slice();
    core[0] += court;
    const adjusted = goals.map(
      (g, i) => g - (ring[i] - actualRing[i]) - (ringDesired[i] - ring[i])
    );
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
      roofPlan
    };
    const max = rawMax - blocked.size;
    if (count + k > max) return null;
    return { ...result, ...layout, feature, blocked, max };
  }
  let best = null;
  for (let n = Math.min(state.modules, Math.floor(state.areaCap / MODULE.area)); n >= 0; n--) {
    best = candidate(n, 0, true);
    if (best) break;
  }
  if (!best) throw Error('No feasible core geometry');
  function addRetail(base) {
    const upper = Math.min(
      retailWant(base.max - base.count),
      Math.max(
        0,
        Math.floor(
          (state.areaCap - base.count * MODULE.area - Math.PI * MIN_COURT_RADIUS ** 2 - 0.1) /
            MODULE.area
        )
      )
    );
    for (let k = upper; k > 0; k--) {
      const c = candidate(base.count, k, true);
      if (
        c &&
        c.count === base.count &&
        k <= retailWant(c.max - c.count) &&
        (!base.circulation.hubs.length || c.circulation.hubs.length)
      )
        return c;
    }
    return base;
  }
  best = addRetail(best);
  // Try one fewer requested module when that can make room for an explicit Attract lobby.
  // Keep the higher count if the extra floor area does not actually produce a through route.
  if (
    !best.circulation.hubs.length &&
    Object.values(state.relations).includes('attract') &&
    best.count > Object.keys(state.modulePrograms).length
  ) {
    const alternative = candidate(best.count - 1, 0, true);
    if (alternative) {
      const integrated = addRetail(alternative);
      if (integrated.count === best.count - 1 && integrated.circulation.hubs.length)
        best = integrated;
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
    roofPlan
  } = best;
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
        use: blocked.has(i) ? 'blocked' : null
      });
    }
  const activeSlots = slots.filter((s) => !s.blocked);
  counts.push(0);
  const pins = new Map();
  const pinnedEdits = [];
  for (const [key, edit] of Object.entries(state.modulePrograms)) {
    const [columns, floor, dock] = key.split(':').map(Number);
    const index = activeSlots.findIndex(
      (slot) => slot.f === floor && slot.j === Math.round((dock / columns) * slotN) % slotN
    );
    if (index < 0 || pins.size >= count || pins.has(index)) continue;
    pins.set(index, edit.program);
    pinnedEdits.push(edit);
    activeSlots[index].editKey = key;
  }
  const added = pinnedEdits.filter((edit) => edit.from === null).length;
  const requestedCounts = added
    ? inventory(count - added, goalsForRetail(k, lobby.area, roofPlan.area))
    : counts.slice();
  while (requestedCounts.reduce((total, value) => total + value, 0) < count - added)
    requestedCounts[counts.indexOf(Math.max(...counts))]++;
  for (const { program, from } of pinnedEdits) {
    if (from === null) requestedCounts[program]++;
    else if (requestedCounts[from] > 0) {
      requestedCounts[from]--;
      requestedCounts[program]++;
    }
  }
  const { placement, score, conflicts, conflictingSlots, firehall } = place(
    activeSlots,
    slotN,
    requestedCounts,
    rooms,
    pins,
    (state.seed + dockVariant) >>> 0
  );
  counts.fill(0);
  activeSlots.forEach((slot, i) => {
    slot.p = placement[i];
    if (firehall.omitted.has(slot.i)) delete slot.editKey;
    if (slot.p !== EMPTY) counts[slot.p]++;
  });
  const vacancyCounts = assignVacancies(activeSlots, k),
    retail = vacancyCounts[3] * MODULE.area,
    outdoor = (vacancyCounts[1] + vacancyCounts[2]) * MODULE.area,
    primary =
      ringArea + circulation.bridgeArea + court + count * MODULE.area + roofPlan.serviceArea,
    total = primary + retail + roofPlan.retailArea;
  const plaza = designPlaza(R, lobby, slots, feature.climbing);
  const layout = {
    R,
    r,
    width,
    slabThickness: state.slabThickness,
    floorHeight,
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
    conflictingSlots,
    firehallUnplaced: firehall.unplaced,
    firehallOmitted: firehall.omitted,
    repelConflicts:
      conflicts +
      (Object.values(state.relations).includes('repel') ? repellingRoomContacts(rooms) : 0),
    required,
    goals,
    retailRequested: retailWant(max - count),
    manualClamped,
    feature,
    lobby,
    blocked,
    circulation,
    plaza,
    greenhouse: designGreenhouse(r, lobby, feature.ride),
    roofPlan
  };
  return state.allocationMoves.length
    ? applyAllocationMoves(layout, state.allocationMoves, dockVariant) ?? layout
    : layout;
}

// Move an existing partition only where both rooms retain the same corridor frontage.
function exchangeableRooms(left, right) {
  return Boolean(
    left &&
      right &&
      PROGRAMS[left.id] &&
      PROGRAMS[right.id] &&
      left.id !== right.id &&
      left.f === right.f &&
      left.band === right.band &&
      left.r === right.r &&
      left.R === right.R &&
      Math.abs(left.end - right.start) < 1e-7 &&
      !left.facadeFacing &&
      !right.facadeFacing &&
      !Object.hasOwn(state.roomPrograms, left.editKey) &&
      !Object.hasOwn(state.roomPrograms, right.editKey)
  );
}

function moveAllocationBoundary(layout, move, counts, roomsByKey) {
  const left = roomsByKey.get(move.left);
  const right = roomsByKey.get(move.right);
  if (
    !exchangeableRooms(left, right) ||
    left.id !== move.leftProgram ||
    right.id !== move.rightProgram
  )
    return false;

  // Every extra 81 m² module replaces exactly 81 m² of the same program in the core.
  const area = move.count * MODULE.area;
  if (left.area - area < state.minRoomArea - 1e-7 || right.area + area < state.minRoomArea - 1e-7)
    return false;

  const doors = [left, right].map((room) =>
    layout.circulation.doors.find(
      (door) =>
        door.kind === 'corridor' &&
        door.f === room.f &&
        door.program === room.id &&
        door.r === room.R &&
        Math.abs(door.angle - (room.start + room.end) / 2) < 1e-7
    )
  );
  left.end -= area / ((left.R ** 2 - left.r ** 2) / 2);
  right.start = left.end;
  left.area -= area;
  right.area += area;
  for (const [i, room] of [left, right].entries()) {
    if (!doors[i]) continue;
    doors[i].angle = (room.start + room.end) / 2;
    doors[i].width = Math.min(1.2, (room.end - room.start) * room.R * 0.68);
  }

  counts[left.id] += move.count;
  counts[right.id] -= move.count;
  layout.core[left.id] -= area;
  layout.core[right.id] += area;
  layout.ring[left.id] -= area;
  layout.ring[right.id] += area;
  return true;
}

// Reuse the normal dock solver with the revised inventory. The original shell, reservations and
// enclosed area stay in place, and the result is reproducible from a saved sequence of exchanges.
function applyAllocationMoves(original, moves, dockVariant) {
  const layout = structuredClone(original);
  const counts = layout.counts.slice();
  const roomsByKey = new Map(layout.rooms.map((room) => [room.editKey, room]));
  for (const move of moves) {
    if (!moveAllocationBoundary(layout, move, counts, roomsByKey)) return null;
  }

  const activeSlots = layout.slots.filter((slot) => !slot.blocked);
  const pins = new Map();
  const pinnedCounts = counts.map(() => 0);
  for (const [i, slot] of activeSlots.entries()) {
    if (slot.editKey) {
      pins.set(i, slot.p);
      pinnedCounts[slot.p]++;
    }
    slot.anchor = roomAt(layout.layers[slot.f][layout.bandN - 1], slot.angle);
  }
  if (counts.some((count, i) => count < pinnedCounts[i])) return null;
  if (repellingRoomContacts(layout.rooms)) return null;
  const { placement, score, conflicts, conflictingSlots, firehall } = place(
    activeSlots,
    layout.slotN,
    counts,
    layout.rooms,
    pins,
    (state.seed + dockVariant) >>> 0
  );
  if (conflicts || firehall.unplaced || firehall.omitted.size) return null;

  const installed = counts.map(() => 0);
  for (const [i, slot] of activeSlots.entries()) {
    slot.p = placement[i];
    slot.use = null;
    if (slot.p !== EMPTY) installed[slot.p]++;
  }
  if (installed.some((count, i) => count !== counts[i])) return null;

  layout.counts = installed;
  layout.score = score;
  layout.conflictingSlots = conflictingSlots;
  layout.repelConflicts = conflicts;
  layout.firehallUnplaced = firehall.unplaced;
  layout.firehallOmitted = firehall.omitted;
  layout.vacancyCounts = assignVacancies(activeSlots, layout.vacancyCounts[3]);
  layout.plaza = designPlaza(layout.R, layout.lobby, layout.slots, layout.feature.climbing);
  layout.allocationApplied = (original.allocationApplied ?? 0) + moves.length;
  return layout;
}

// The same grade crossing sets out the greenhouse paving, beds and walking graph.
function designGreenhouse(radius, lobby, ride) {
  const bays = lobbyBays(lobby);
  if (bays.length < 2) return null;
  const axis = bays[0].angle,
    width = Math.min(2.4, radius * 0.42, radius * bays[0].span * 0.8),
    ringRadius = ride.towerRadius + width / 2 + 0.28,
    point = (distance, angle) => [distance * Math.cos(angle), distance * Math.sin(angle)],
    approaches = [axis, axis + Math.PI].map((angle) => [
      point(radius, angle),
      point(ringRadius, angle)
    ]);
  const beds = [],
    clearance = 0.45,
    bedWidth = Math.min(3.6, radius / 6),
    plantingRadius = radius - 1.55;
  // Keep the planted beds clear of the crossing, mast and perimeter promenade.
  const start = ringRadius + width / 2 + clearance;
  for (const side of [-1, 1]) {
    for (let near = start; near + bedWidth < plantingRadius; near += bedWidth + 0.9) {
      const depth = 2 * Math.sqrt(plantingRadius ** 2 - (near + bedWidth) ** 2);
      if (depth < 1.5) continue;
      const [x, z] = point(near + bedWidth / 2, axis + (side * Math.PI) / 2);
      beds.push({ x, z, width: bedWidth, depth });
    }
  }
  return { axis, approaches, ringRadius, width, beds };
}

// The lobby approaches stay between docks and open onto the continuous promenade.
function designPlaza(R, lobby, slots, climb) {
  const bays = lobbyBays(lobby),
    approachSpan = bays[0]?.span ?? 0,
    mouth = R + MODULE.depth + 2,
    outer = mouth + 24,
    span = Math.max(approachSpan, Math.min(0.95, 32 / mouth)),
    walkRadius = mouth + 3.4,
    rad = mouth + 15.0;
  const n = Math.max(12, Math.min(24, Math.floor((TAU * rad) / 19))),
    zones = [],
    rng = random((state.seed ^ 0x8855aabc) >>> 0),
    themes = ['fountain', 'patio', 'picnic', 'play', 'green'];
  const ground = slots.filter((q) => q.f === 0 && !q.blocked && q.p >= 0 && q.p < 5);
  for (let i = 0; i < n; i++) {
    const a = mod(lobby.angle + ((i + 0.5) * TAU) / n, TAU);
    if (
      bays.some((bay) => angDist(a, bay.angle) < Math.max(span, bay.span) / 2 + 0.17) ||
      (climb && angDist(a, climb.angle) < climb.half + 0.18)
    )
      continue;
    const nearest = ground.reduce(
        (best, q) => (!best || angDist(q.angle, a) < angDist(best.angle, a) ? q : best),
        null
      ),
      p = nearest?.p ?? Math.floor(rng() * 5);
    zones.push({
      angle: a,
      r: rad,
      program: p,
      kind: themes[p],
      width: Math.min(17, 2 * rad * Math.sin(Math.PI / n) - 2)
    });
  }
  // Keep both sports represented when the public ring has sufficient room.
  const eligible = zones.filter((z) => z.width >= 13.5),
    sports = eligible
      .filter((z) => z.program === 3 || z.program === 2)
      .concat(eligible.filter((z) => z.program !== 3 && z.program !== 2));
  if (sports[0]) sports[0].kind = 'volleyball';
  if (sports[1] && sports[1] !== sports[0]) sports[1].kind = 'pickleball';
  else if (sports[2]) sports[2].kind = 'pickleball';
  // Preserve a diverse mix even when one nearby program dominates the circumference.
  for (const theme of themes) {
    if (zones.some((q) => q.kind === theme)) continue;
    const counts = Object.fromEntries(
      themes.map((k) => [k, zones.filter((q) => q.kind === k).length])
    );
    const candidates = zones
      .filter((q) => counts[q.kind] > 1)
      .sort(
        (a, b) =>
          (b.program === themes.indexOf(theme)) - (a.program === themes.indexOf(theme)) ||
          counts[b.kind] - counts[a.kind]
      );
    if (candidates.length) candidates[0].kind = theme;
  }
  return {
    angle: lobby.angle,
    approachSpan,
    inner: R,
    mouth,
    outer,
    span,
    extension: 24,
    walkRadius,
    zones,
    area:
      Math.PI * (outer * outer - mouth * mouth) +
      0.5 * (mouth * mouth - R * R) * lobby.span +
      (climb ? 0.5 * (mouth * mouth - climb.face * climb.face) * 2 * climb.half : 0)
  };
}
// Firehall docks start at grade. Higher floors are limited by both their own available
// docks and the number on the floor below. A manual upper dock also reserves capacity below.
function planFirehall(slots, columns, count, pins, dockConflicts) {
  const floors = Array.from({ length: state.floors }, () => []);
  const byDock = new Map(slots.map((slot, i) => [slot.i, i]));
  const eligible = slots.map((slot, i) => {
    if (dockConflicts?.[i][FIREHALL]) return false;
    for (const offset of [-1, 1]) {
      const neighbor = byDock.get(slot.f * columns + mod(slot.j + offset, columns));
      if (programsRepel(FIREHALL, pins.get(neighbor))) return false;
    }
    return true;
  });
  const omitted = new Set();
  for (const [i, program] of pins) {
    if (program === FIREHALL && !eligible[i]) {
      pins.delete(i);
      omitted.add(slots[i].i);
    }
  }
  slots.forEach((slot, i) => {
    if (eligible[i] && (!pins.has(i) || pins.get(i) === FIREHALL)) floors[slot.f].push(i);
  });
  const limits = floors.map((floor) => floor.length);
  for (let f = 1; f < limits.length; f++) limits[f] = Math.min(limits[f], limits[f - 1]);

  function minimums() {
    const needed = floors.map((floor) => floor.filter((i) => pins.get(i) === FIREHALL).length);
    for (let f = needed.length - 2; f >= 0; f--) needed[f] = Math.max(needed[f], needed[f + 1]);
    return needed;
  }
  const available = limits.reduce((sum, limit) => sum + limit, 0);
  const plannedCount = Math.min(count, available);
  let minimum = minimums();
  // Defer an upper-floor pin if there is no way to support it with the requested inventory.
  while (
    minimum.some((value, floor) => value > limits[floor]) ||
    minimum.reduce((sum, value) => sum + value, 0) > plannedCount
  ) {
    const highest = [...pins.keys()]
      .filter((i) => pins.get(i) === FIREHALL)
      .sort((a, b) => slots[b].f - slots[a].f || b - a)[0];
    pins.delete(highest);
    omitted.add(slots[highest].i);
    minimum = minimums();
  }

  const assigned = new Set();
  const targetByFloor = [];
  let remaining = plannedCount;
  for (let f = 0; f < floors.length; f++) {
    const reserveAbove = minimum.slice(f + 1).reduce((sum, value) => sum + value, 0);
    const limitBelow = targetByFloor[f - 1] ?? Infinity;
    const target = Math.min(limits[f], limitBelow, remaining - reserveAbove);
    targetByFloor.push(target);
    remaining -= target;
    const free = floors[f].filter((i) => !pins.has(i));
    const pinnedCount = floors[f].length - free.length;
    // Any chosen dock can move within its floor during the topology passes.
    const ordered = free
      .slice()
      .sort((a, b) => +(slots[b].anchor === FIREHALL) - +(slots[a].anchor === FIREHALL) || a - b);
    for (const i of ordered.slice(0, target - pinnedCount)) assigned.add(i);
  }
  return { assigned, eligible, omitted, unplaced: count - plannedCount };
}

// SEEDED TOPOLOGY SOLVER — fixed inventory; swap labels including vacancies; local pair energy.
function place(slots, n, counts, rooms = [], pins = new Map(), seed = state.seed) {
  const N = slots.length,
    rng = random(seed),
    a = Array(N).fill(EMPTY),
    clusteringStrength = clusterStrength(),
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
  // One same-floor conflict outweighs every soft score changed by a single swap.
  const separationCost = 100;
  const hasRepel = Object.values(state.relations).includes('repel');
  const outerBand = rooms.reduce((band, room) => Math.max(band, room.band), 0);
  const dockConflicts = hasRepel
    ? slots.map((slot) => {
        const nearRooms = rooms.filter(
          (room) =>
            room.band === outerBand &&
            room.f === slot.f &&
            angDist(slot.angle, (room.start + room.end) / 2) <
              (room.end - room.start) / 2 + Math.PI / n
        );
        return PROGRAMS.map(
          (_, id) =>
            +(
              programsRepel(id, slot.anchor) || nearRooms.some((room) => programsRepel(id, room.id))
            )
        );
      })
    : null;
  const fixed = new Map(pins);
  const inventoryTotal = counts.reduce((sum, count) => sum + count, 0);
  const pinnedFirehall = [...pins.values()].filter((program) => program === FIREHALL).length;
  const firehallDemand = Math.max(counts[FIREHALL], pinnedFirehall);
  const firehallBudget = Math.min(firehallDemand, inventoryTotal - pins.size + pinnedFirehall);
  const firehall = planFirehall(slots, n, firehallBudget, fixed, dockConflicts);
  firehall.unplaced += firehallDemand - firehallBudget;

  // Reserve explicit edits and Firehall floor counts, then fill the remaining docks.
  const remaining = counts.slice();
  remaining[FIREHALL] = 0;
  remaining[UNUSED] = (remaining[UNUSED] || 0) + firehall.unplaced;
  for (const program of fixed.values()) if (program !== FIREHALL) remaining[program]--;
  const firehallCount =
    firehall.assigned.size + [...fixed.values()].filter((program) => program === FIREHALL).length;
  const remainingTotal =
    inventoryTotal -
    firehallCount -
    [...fixed.values()].filter((program) => program !== FIREHALL).length;
  const labels = [];
  remaining.forEach((count, id) => {
    for (let j = 0; j < count; j++) labels.push(id);
  });
  while (labels.length > remainingTotal) {
    const program = remaining.indexOf(Math.max(...remaining));
    labels.splice(labels.lastIndexOf(program), 1);
    remaining[program]--;
  }
  while (labels.length < remainingTotal) labels.push(UNUSED);
  const free = slots.map((_, i) => i).filter((i) => !fixed.has(i));
  const unassigned = free.filter((i) => !firehall.assigned.has(i));
  while (labels.length < unassigned.length) labels.push(EMPTY);
  for (let i = labels.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [labels[i], labels[j]] = [labels[j], labels[i]];
  }
  for (const [index, program] of fixed) a[index] = program;
  for (const index of firehall.assigned) a[index] = FIREHALL;
  unassigned.forEach((index, position) => {
    a[index] = labels[position];
  });
  const dist = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 5 }, (_, j) => RELATIONSHIP_WEIGHT * relationCost(i, j))
  );
  const edges = [],
    adj = Array.from({ length: N }, () => []);
  const gridToLocal = new Map(slots.map((s, i) => [s.i, i]));
  function edge(i, j, w, sameFloor) {
    if (i === j || i == null || j == null) return;
    const k = edges.length;
    edges.push({ i, j, w, sameFloor });
    adj[i].push(k);
    adj[j].push(k);
  }
  for (let i = 0; i < N; i++) {
    const { f, j } = slots[i];
    if (n > 1 && (n > 2 || j === 0)) edge(i, gridToLocal.get(f * n + ((j + 1) % n)), 1, true);
    if (f + 1 < state.floors) edge(i, gridToLocal.get((f + 1) * n + j), 0.8, false);
  }
  function pair(x, y, sameFloor) {
    if (x === EMPTY && y === EMPTY) return 0;
    if (x === EMPTY || y === EMPTY) return 0.16;
    if (x === UNUSED || y === UNUSED) return 0.25;
    return programsRepel(x, y) ? (sameFloor ? separationCost : 0) : dist[x][y];
  }
  function anchor(i) {
    const program = a[i],
      slot = slots[i];
    if (program === EMPTY || program === UNUSED) return 0;
    const relationship = dockConflicts?.[i][program]
      ? separationCost
      : slot.anchor === UNUSED
        ? 0
        : 0.9 * dist[program][slot.anchor];
    const center = centers[program];
    if (center == null) return relationship;
    const angularCost = 12 * angDist(slot.angle, center);
    const alignmentBonus = program === slot.anchor ? 4 : 0;
    return relationship + clusteringStrength * (angularCost - alignmentBonus);
  }
  function edgeCost(k) {
    const edge = edges[k],
      aProgram = a[edge.i],
      bProgram = a[edge.j];
    // A vertical stack is worth more than a side-by-side pair for a clustered program.
    const clusterBonus =
      aProgram === bProgram && state.cluster[aProgram]
        ? (edge.sameFloor ? 3.6 : 10) * clusteringStrength
        : 0;
    return (pair(aProgram, bProgram, edge.sameFloor) - clusterBonus) * edge.w;
  }
  function local(i, j) {
    let sum = anchor(i) + anchor(j);
    for (const k of adj[i]) sum += edgeCost(k);
    for (const k of adj[j]) if (!adj[i].includes(k)) sum += edgeCost(k);
    return sum;
  }
  if (free.length > 1) {
    const steps = Math.min(22000, Math.max(2400, N * 48));
    for (let t = 0; t < steps; t++) {
      const i = free[Math.floor(rng() * free.length)],
        j = free[Math.floor(rng() * free.length)];
      if (a[i] === a[j]) continue;
      if (a[i] === FIREHALL || a[j] === FIREHALL) {
        const destination = a[i] === FIREHALL ? j : i;
        if (slots[i].f !== slots[j].f || !firehall.eligible[destination]) continue;
      }
      const before = local(i, j);
      [a[i], a[j]] = [a[j], a[i]];
      const change = local(i, j) - before,
        temp = 0.23 * (1 - t / steps) + 0.007;
      if (change > 0 && rng() > Math.exp(-change / temp)) [a[i], a[j]] = [a[j], a[i]];
    }
  }
  let score =
    edges.reduce((s, e, i) => s + edgeCost(i), 0) + slots.reduce((s, _, i) => s + anchor(i), 0);
  const conflictingSlots = new Set();
  let conflicts = 0;
  if (hasRepel) {
    for (const { i, j, sameFloor } of edges) {
      if (!sameFloor || !programsRepel(a[i], a[j])) continue;
      conflicts++;
      conflictingSlots.add(slots[i].i);
      conflictingSlots.add(slots[j].i);
    }
    a.forEach((program, i) => {
      if (!dockConflicts[i][program]) return;
      conflicts++;
      conflictingSlots.add(slots[i].i);
    });
  }
  return { placement: a, score: score / Math.max(1, N), conflicts, conflictingSlots, firehall };
}
// PROGRAM MAP — diagram coordinates are normalized independently of its display proportions.
let activeNode = null;
const wheel = $('wheel');
const MODES = {
  attract: { name: 'Attract', color: '#47866a', dash: '' },
  neutral: { name: 'Neutral', color: '#999f99', dash: '2 5' },
  repel: { name: 'Repel', color: '#bd665c', dash: '8 5' }
};
const mapCenter = { x: 200, y: 140 };
const mapScale = { x: 180, y: 119 };
function px(p) {
  return [mapCenter.x + p[0] * mapScale.x, mapCenter.y + p[1] * mapScale.y];
}
function wheelRender() {
  let html =
    '<ellipse cx="200" cy="140" rx="167" ry="111" fill="none" stroke="#d0d7cf" stroke-dasharray="3 5"/><ellipse cx="200" cy="140" rx="97" ry="64" fill="none" stroke="#e0e4dc"/><path d="M33 140H367M200 29V251" stroke="#e0e4dc"/><circle cx="200" cy="140" r="2" fill="#9ca99c"/>';
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++) {
      const a = px(state.points[i]),
        b = px(state.points[j]),
        k = relationKey(i, j),
        mode = relationMode(i, j),
        style = MODES[mode],
        mag = relationMagnitude(i, j),
        label = PROGRAMS[i].name + ' / ' + PROGRAMS[j].name + ': ' + style.name;
      const points = `x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"`;
      html += `<g class="relationship" data-pair="${k}" tabindex="0" role="button" aria-label="${label}. Click to cycle"><title>${label}</title><line class="edge-visible" ${points} stroke="${style.color}" stroke-width="${1.4 + mag * 2}" stroke-dasharray="${style.dash}" opacity="${0.6 + mag * 0.4}" pointer-events="none"/><line ${points} stroke="transparent" stroke-width="13" pointer-events="stroke"/></g>`;
    }
  for (let i = 0; i < 5; i++) {
    const [x, y] = px(state.points[i]),
      p = PROGRAMS[i];
    html += `<g class="node" data-i="${i}" tabindex="0" role="button" aria-label="${p.name}: clustering ${state.cluster[i] ? 'on' : 'off'}. Enter to toggle, arrows to move" data-clustered="${state.cluster[i]}" aria-pressed="${state.cluster[i]}" transform="translate(${x} ${y})"><circle class="cluster-ring" r="22" fill="none" stroke="none"/><circle r="18" fill="${p.color}" stroke="#fff" stroke-width="2.5"/><text text-anchor="middle" dy="4" font-size="10" font-weight="700" fill="#26322f" pointer-events="none">${p.short}</text><title>${p.name}</title></g>`;
  }
  wheel.innerHTML = html;
}
function cyclePair(key) {
  const [i, j] = key.split('-').map(Number);
  if (!(i >= 0 && j < 5 && i < j)) return;
  const mode = relationMode(i, j),
    next = { attract: 'neutral', neutral: 'repel', repel: 'attract' }[mode];
  state.relations[key] = next;
  wheelRender();
  $('relationStatus').textContent =
    PROGRAMS[i].name + ' ↔ ' + PROGRAMS[j].name + ': ' + MODES[next].name;
  wheel.querySelector('[data-pair="' + key + '"]')?.focus({ preventScroll: true });
  scheduleUpdate();
}
wheel.addEventListener('click', (e) => {
  const g = e.target.closest('[data-pair]');
  if (g) cyclePair(g.dataset.pair);
});
wheel.addEventListener('keydown', (e) => {
  const g = e.target.closest('[data-pair]');
  if (g && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    cyclePair(g.dataset.pair);
  }
});
function movePoint(i, x, y) {
  let len = Math.hypot(x, y);
  if (len > 0.86) {
    x *= 0.86 / len;
    y *= 0.86 / len;
  }
  state.points[i] = [x, y];
  wheelRender();
  scheduleUpdate();
}
function toggleCluster(i) {
  state.cluster[i] = !state.cluster[i];
  wheelRender();
  $('relationStatus').textContent =
    PROGRAMS[i].name + ' clustering ' + (state.cluster[i] ? 'on' : 'off') + '.';
  scheduleUpdate();
}
let dragOrigin = null,
  dragMoved = false;
wheel.addEventListener('pointerdown', (e) => {
  const g = e.target.closest('[data-i]');
  if (!g) return;
  e.preventDefault();
  activeNode = +g.dataset.i;
  dragOrigin = [e.clientX, e.clientY];
  dragMoved = false;
  wheel.setPointerCapture(e.pointerId);
});
wheel.addEventListener('pointermove', (e) => {
  if (activeNode === null) return;
  if (Math.hypot(e.clientX - dragOrigin[0], e.clientY - dragOrigin[1]) > 5) dragMoved = true;
  if (!dragMoved) return;
  let q = wheel.createSVGPoint();
  q.x = e.clientX;
  q.y = e.clientY;
  const p = q.matrixTransform(wheel.getScreenCTM().inverse());
  movePoint(activeNode, (p.x - mapCenter.x) / mapScale.x, (p.y - mapCenter.y) / mapScale.y);
});
wheel.addEventListener('pointerup', () => {
  if (activeNode !== null && !dragMoved) toggleCluster(activeNode);
  activeNode = null;
});
for (const ev of ['pointercancel', 'lostpointercapture'])
  wheel.addEventListener(ev, () => (activeNode = null));
wheel.addEventListener('keydown', (e) => {
  const g = e.target.closest('[data-i]');
  if (!g) return;
  const i = +g.dataset.i;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleCluster(i);
    wheel.querySelector(`[data-i="${i}"]`).focus();
    return;
  }
  const d = {
    ArrowLeft: [-0.045, 0],
    ArrowRight: [0.045, 0],
    ArrowUp: [0, -0.045],
    ArrowDown: [0, 0.045]
  }[e.key];
  if (!d) return;
  e.preventDefault();
  const p = state.points[i];
  movePoint(i, p[0] + d[0], p[1] + d[1]);
  wheel.querySelector(`[data-i="${i}"]`).focus();
});
