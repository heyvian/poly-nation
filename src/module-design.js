'use strict';

// A module occupies a standard dock. Its enclosure can stop short of the end
// of the chassis, leaving the rest of the docking bay as a private terrace.
const MODULE_CASSETTE_DEPTH = 0.18;
const MODULE_SIMILARITY = { rinse: 87, love: 40, fire: 88, day: 15, senior: 10 };
const PROGRAM_MODULE_FORM = {
  rinse: 'vault', love: 'saltbox', fire: 'flat', day: 'gable', senior: 'hip', retail: 'shed', unused: 'bevel'
};
const MODULE_FINISHES = [
  'cedar', 'charred-wood', 'thermo-wood', 'plywood', 'vinyl', 'stucco', 'painted-tin', 'trailer-aluminum',
  'corrugated', 'zinc', 'fiber-cement', 'recycled-composite', 'cork-panel', 'weathering-steel',
  'polycarbonate', 'insulated-panel', 'perforated-aluminum', 'timber-cassettes', 'exposed-clt',
  'board-batten', 'larch-lap', 'reclaimed-boards', 'cedar-shingles', 'metal-shingles', 'tin-shingles'
];
const MODULE_DETAILS = ['shutters', 'screen', 'vents', 'frames', 'frames'];
const MODULE_STRUCTURE_BY_FINISH = {
  'log-siding': ['stacked-timber'], 'exposed-clt': ['clt'],
  'timber-cassettes': ['clt', 'wood-stud', 'glulam'],
  'trailer-aluminum': ['aluminum-truss', 'light-steel'],
  corrugated: ['steel-tube', 'light-steel'], 'insulated-panel': ['steel-frame', 'steel-tube'],
  polycarbonate: ['glulam', 'steel-frame'], 'weathering-steel': ['steel-tube', 'steel-frame']
};
const MODULE_WINDOW_STYLES = ['ribbon', 'punched', 'portholes', 'picture', 'clerestory', 'paired'];
const MODULE_COLOURS = [
  ['#bbc5bc', '#275b54'], ['#eddfc2', '#a4523c'], ['#a2b2bd', '#294d67'], ['#e2dad9', '#684663'],
  ['#d6af68', '#664e41'], ['#ceb0a7', '#7b414a'], ['#5b7565', '#ccb888'], ['#e4decb', '#696d45'],
  ['#9db8b1', '#23575f'], ['#d8cdab', '#964b36'], ['#91744f', '#e4d5b9'], ['#a9a1ad', '#5c6478']
];
const MODULE_PATIO_DOORS = ['hinged', 'half-glazed', 'french', 'sliding', 'solid'];

function moduleSimilarity(assignments, program) {
  const value = assignments?.moduleDesign?.similarity?.[program];
  return Number.isFinite(value) ? clamp(value, 0, 100) : MODULE_SIMILARITY[program] ?? 60;
}

function dockDesignSeed(seed, slot) {
  return (seed ^ Math.imul(slot.f + 1, 0x1b873593) ^ Math.imul(slot.j + 1, 0x85ebca6b)) >>> 0;
}

function moduleMaterialSelection(model, slot, assignments, seed) {
  const retail = slot.p === EMPTY,
    scope = retail ? 'commercial' : 'module',
    key = materialSlotKey(model, slot),
    assigned = new Set(),
    values = materialValues(assignments, scope, retail ? null : slot.p, retail ? null : key, assigned),
    program = retail ? 'retail' : P[slot.p].id,
    settings = assignments.moduleDesign,
    unique = settings?.enabled === true,
    localSeed = dockDesignSeed(seed, slot),
    similarity = moduleSimilarity(assignments, program) / 100,
    commonSeed = (seed ^ Math.imul(slot.p + 3, 0x7feb352d)) >>> 0,
    roll = random(localSeed ^ 0x5aeb1e73),
    formAgreement = 1 - (1 - Math.min(similarity / 0.68, 1)) ** 1.55,
    finishAgreement = similarity ** 2.65,
    followsForm = roll() < formAgreement,
    followsFinish = roll() < finishAgreement,
    choose = (list, sample) => list[Math.floor(sample() * list.length)],
    localForm = choose(MODULE_FORM_KINDS, roll),
    kind = !unique ? 'flat' : followsForm ? PROGRAM_MODULE_FORM[program] : localForm,
    formSample = random((followsForm || !unique ? commonSeed : localSeed) ^ 0x71023be3),
    amount = formSample(),
    length = !unique || followsForm && ['rinse', 'fire', 'retail', 'unused'].includes(program)
      ? MODULE.depth : amount < 0.29 ? 9 : amount < 0.60 ? 13.5 : MODULE.depth,
    roofHand = random(localSeed ^ 0xc12c3703)() < 0.5 ? -1 : 1,
    form = moduleEnvelope(kind, length, formSample, unique, roofHand),
    style = random((followsFinish || !unique ? commonSeed : localSeed) ^ 0x4d69fe61),
    materialRoll = style(),
    generatedFinish = kind === 'cabin' ? 'log-siding' : kind === 'streamliner' && materialRoll < 0.82
      ? choose(['trailer-aluminum', 'trailer-aluminum', 'painted-tin', 'zinc'], style)
      : choose(MODULE_FINISHES, style),
    broad = formSample(),
    detail = unique ? choose(MODULE_DETAILS, style) : 'frames',
    windowStyle = !unique || kind === 'cabin' ? 'punched' : choose(MODULE_WINDOW_STYLES, style),
    palette = choose(MODULE_COLOURS, style),
    tint = unique && !followsFinish ? 0.91 + style() * 0.19 : 1,
    paintIndex = unique ? Math.floor(style() * 31) : slot.j + 2 * slot.f + seed,
    shade = unique && style() < 0.52 && kind !== 'streamliner'
      ? choose(['awning', 'visor', 'louvers'], style) : null,
    patioDoor = !unique ? 'sliding' : kind === 'cabin' ? choose(['half-glazed', 'solid'], style) : choose(MODULE_PATIO_DOORS, style),
    skylight = unique && style() < 0.38 ? moduleSkylight(form, style) : null;
  // Preserve individual overrides. The shared finish inherits the current
  // palette assignment, with the remaining units exploring lightweight skins.
  if (unique && !followsFinish && !assignments['module:' + key]?.facade) values.facade = generatedFinish;
  if (unique && !followsFinish && !assigned.has('structure')) {
    const timber = EXTERIOR_FINISHES[values.facade].group === 'Timber and plant-based';
    values.structure = choose(MODULE_STRUCTURE_BY_FINISH[values.facade] ?? (timber
      ? ['wood-stud', 'wood-stud', 'lvl-box', 'glulam', 'clt'] : ['wood-stud', 'light-steel', 'steel-frame']), style);
  }
  return {
    values, program, unique, form, length, broad, detail, windowStyle, palette, tint, paintIndex, patioDoor,
    shade: settings?.windowShades === false ? null : shade,
    skylight: settings?.skylights === false ? null : skylight,
    finishSeed: unique && followsFinish ? commonSeed : localSeed
  };
}

function moduleSkylight(form, sample) {
  if (!['flat', 'gable', 'shed', 'saltbox', 'cabin', 'butterfly'].includes(form.kind)) return null;
  const facets = [];
  for (let i = 0; i < form.profile.length - 1; i++) {
    const [a] = form.profile[i], [b] = form.profile[i + 1];
    if (b - a < 0.58) continue;
    const half = Math.min(0.23, (b - a) * 0.27), center = (a + b) / 2;
    facets.push({ facet: i, left: center - half, right: center + half });
  }
  if (!facets.length) return null;
  const opening = facets[Math.floor(sample() * facets.length)], { facet, left, right } = opening,
    [[a, y], [b, h]] = form.profile.slice(facet, facet + 2),
    rise = [left, right].map((u) => y + (h - y) * (u - a) / (b - a)),
    lift = Math.min(0.055, MODULE.height - Math.max(...rise));
  const start = (0.39 + sample() * 0.18) * form.length;
  return { ...opening, start, end: start + 1.26, lift };
}

function furnishedModulePlan(model, slot, assignments, seed, tipBalcony = false) {
  const design = moduleMaterialSelection(model, slot, assignments, seed),
    { program, length, form, unique, broad, windowStyle } = design,
    // The 1.95 m dock threshold and the module door share the centre line.
    doorWidth = 1.5, doorHeight = 2.26,
    wall = design.values.structure === 'stacked-timber' ? 0.23 : form.kind === 'streamliner' ? 0.15 : form.kind === 'hip' ? 0.26 : 0.18,
    inside = form.half - wall,
    aisleEdge = -inside + 1.13,
    entry = 1.45,
    usable = length - entry - Math.max(wall + 0.06, Math.min(form.nose + 0.10, length === 9 ? 1.15 : 1.78)),
    fireBunks = program === 'fire' && model.slots.filter((other) =>
      other.p === slot.p && other.i < slot.i && !other.blocked).length % 2 === 0,
    zonesFor = {
      senior: [['bath', 1.82], ['bed', 2.7], ['living', 0]],
      love: [['bath', 1.78], ['bed', 2.65], ['lounge', 0]],
      fire: fireBunks ? [['locker', 1.55], ['bath', 1.6], ['bunk', 2.55], ['bunk', 0]] :
        [['office', 2.45], ['meeting', 2.65], ['crew', 0]],
      day: [['cubbies', 1.55], ['bath', 1.65], ['play', 0]],
      rinse: [['locker', 1.85], ['bath', 1.68], ['rinse', 0]],
      retail: [['counter', 2.32], ['shop', 0]],
      unused: [['storage', 2.42], ['flex', 0]]
    };
  const arrangement = zonesFor[program].slice(), last = arrangement.pop();
  // Longer homes can accommodate a second bedroom. In compact firehall bunk
  // units a single bunk room leaves more usable area than two tiny compartments.
  if (program === 'senior' && length > 13 && broad < 0.65) arrangement.push(['bed', 2.6]);
  if (program === 'fire' && fireBunks && length === 9) arrangement.pop();
  if (program === 'fire' && fireBunks && length >= 13.5) arrangement.push(['bunk', 2.65]);
  if (program === 'fire' && fireBunks && length === MODULE.depth) arrangement.push(['bunk', 2.65], ['bunk', 2.55]);
  if (program === 'love' && length > 13 && broad > 0.55) arrangement.unshift(['storage', 1.35]);
  if (program === 'day' && length > 13) arrangement.push(['quiet', 2.45]);
  if (program === 'rinse' && length > 13) arrangement.push(['treatment', 2.8]);

  let start = entry;
  const zones = [...arrangement, last].map(([use, size]) => {
    const end = size ? start + size : entry + usable;
    const zone = { use, start, end };
    start = end;
    return zone;
  });
  const privateZones = ['bath', 'bed', 'bunk', 'office', 'meeting', 'quiet', 'treatment', 'storage'];
  for (const [i, zone] of zones.entries()) {
    zone.partition = privateZones.includes(zone.use);
    zone.closeStart = zone.partition && !zones[i - 1]?.partition;
    zone.closeEnd = zone.partition && i < zones.length - 1;
  }
  const patio = length < MODULE.depth;
  const sideWindows = (side) => zones.flatMap((zone, i) => {
    // Keep glazing in front of the furnishings it serves and out of the
    // curved tail. A private room still gets a raised sill.
    if (side < 0 && zone.partition && (i + Number(broad > 0.5)) % 2 === 0 && windowStyle !== 'portholes') return [];
    const end = Math.min(zone.end, length - Math.max(wall + 0.05, form.nose)), distance = end - zone.start;
    if (distance < 0.72) return [];
    const high = zone.use === 'bath' || zone.use === 'locker' || windowStyle === 'clerestory',
      publicRoom = ['living', 'lounge', 'play', 'shop', 'crew', 'rinse'].includes(zone.use),
      spacing = { ribbon: 3.65, punched: 2.35, portholes: 1.70, picture: 4.2, clerestory: 2.70, paired: 2.2 },
      count = Math.max(1, Math.floor(distance / spacing[windowStyle])),
      styleWidth = { ribbon: 2.68, punched: 1.25, portholes: 0.91, picture: 2.36, clerestory: 1.74, paired: 1.48 },
      width = Math.min(distance / count - 0.42, styleWidth[windowStyle] * (high ? 0.62 : publicRoom ? 1 : 0.84)),
      top = Math.min(form.eave - 0.14, high ? 2.39 : windowStyle === 'picture' ? 2.54 : 2.44),
      shape = windowStyle === 'portholes' ? 'round' : form.kind === 'streamliner' || windowStyle === 'ribbon' ? 'rounded' : 'square',
      bottom = top - (high ? 0.42 : shape === 'round' ? Math.min(0.88, width) : windowStyle === 'ribbon' ? 0.72 : publicRoom ? 1.36 : 1.08);
    return Array.from({ length: count }, (_, j) => ({
      center: zone.start + (j + 0.5) * distance / count, width,
      bottom, top, shape, mullion: windowStyle === 'paired' || windowStyle === 'picture' || width > 2.05
    }));
  });
  const balcony = !patio && (tipBalcony || unique && ['day', 'love', 'senior'].includes(program) && broad < 0.27);
  const endHalf = moduleHalfAt(form, length),
    door = Math.min(doorHeight, form.eave - 0.07),
    patioWidth = design.patioDoor === 'sliding' && unique ? 1.65 : design.patioDoor === 'french' ? 1.40 : 1.15,
    endWindow = { center: 0, width: Math.min(2.35, 1.44 * endHalf), bottom: 0.85,
      top: Math.min(form.eave - 0.135, 2.44), shape: form.kind === 'streamliner' ? 'rounded' : 'square' };
  return {
    ...design, wall, inside, aisleEdge, patio, balcony, doorWidth, doorHeight, zones,
    roof: form.kind, ceiling: form.eave,
    sideWindows: [-1, 1].map(sideWindows),
    endOpening: patio || balcony
      ? { center: Math.max(-endHalf + patioWidth / 2 + 0.045, patio ? -1.05 : -0.85), width: patioWidth,
        bottom: 0, top: door, door: true, doorStyle: design.patioDoor }
      : endWindow
  };
}

function realizedModuleEnclosure(model, assignments, seed) {
  let enclosed = 0, terraces = 0, short = 0, nominal = 0;
  for (const slot of model.slots) {
    if (slot.blocked || slot.p === EMPTY && slot.use !== 'retail') continue;
    const { length, form } = moduleMaterialSelection(model, slot, assignments, seed);
    enclosed += form.area;
    nominal += MODULE.area;
    terraces += (MODULE.depth - length) * MODULE.width;
    if (length < MODULE.depth) short++;
  }
  return { enclosed, terraces, short, unenclosed: nominal - enclosed };
}
