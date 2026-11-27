'use strict';

// A module occupies a standard dock. Its enclosure can stop short of the end
// of the chassis, leaving the rest of the docking bay as a private terrace.
const MODULE_CASSETTE_DEPTH = 0.18;
const MODULE_SIMILARITY = { rinse: 87, love: 40, fire: 88, day: 15, senior: 10 };
const MODULE_FAMILIES = {
  rinse: ['utility', 'clean', 'retrofit'],
  love: ['clean', 'porch', 'retrofit', 'insulated'],
  fire: ['utility', 'retrofit', 'clean'],
  day: ['porch', 'clean', 'retrofit', 'insulated'],
  senior: ['porch', 'insulated', 'clean', 'retrofit', 'utility'],
  retail: ['clean', 'retrofit', 'porch'],
  unused: ['utility', 'retrofit', 'clean']
};
const MODULE_TYPES = {
  utility: { wall: 0.18, roof: 'flat', finishes: ['insulated-panel', 'corrugated', 'aluminum'], details: ['vent', 'hood'] },
  clean: { wall: 0.21, roof: 'flat', finishes: ['fiber-cement', 'aluminum', 'zinc'], details: ['hood', 'plain'] },
  retrofit: { wall: 0.17, roof: 'flat', finishes: ['corrugated', 'insulated-panel', 'recycled-composite'], details: ['vent', 'patch'] },
  porch: { wall: 0.22, roof: 'gable', finishes: ['cedar', 'fiber-cement', 'vinyl'], details: ['shutter', 'awning'] },
  insulated: { wall: 0.32, roof: 'shed', finishes: ['thermo-wood', 'cork-panel', 'fiber-cement'], details: ['reveal', 'hood'] }
};

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
    values = materialValues(assignments, scope, retail ? null : slot.p, retail ? null : key),
    program = retail ? 'retail' : P[slot.p].id,
    unique = assignments.moduleDesign?.enabled === true,
    localSeed = dockDesignSeed(seed, slot),
    similarity = moduleSimilarity(assignments, program) / 100,
    commonSeed = (seed ^ Math.imul(slot.p + 3, 0x7feb352d)) >>> 0,
    local = random(localSeed), common = random(commonSeed),
    families = MODULE_FAMILIES[program],
    followsFamily = local() < similarity,
    familyIndex = local(),
    family = unique ? families[followsFamily ? 0 : Math.floor(familyIndex * families.length)] : 'utility',
    type = MODULE_TYPES[family],
    sameCladding = local() < similarity,
    finishIndex = local(),
    finishChoices = [values.facade, ...type.finishes.filter((finish) => finish !== values.facade)];
  // Explicit dock-level cladding wins. The programme/collection swatch anchors
  // its family, and more varied units can use a related lightweight finish.
  if (unique && !sameCladding && !assignments['module:' + key]?.facade)
    values.facade = finishChoices[Math.floor(finishIndex * finishChoices.length)];
  const replicate = local() < similarity,
    recipe = !unique || replicate ? common : local,
    shrink = recipe(),
    length = !unique || ['rinse', 'fire', 'retail', 'unused'].includes(program) && followsFamily
      ? MODULE.depth
      : shrink < 0.24 ? 9 : shrink < 0.55 ? 13.5 : MODULE.depth,
    broad = recipe(), detail = type.details[Math.floor(recipe() * type.details.length)],
    paintIndex = unique && replicate ? Math.floor(common() * 15) : slot.j + 2 * slot.f + seed,
    tint = unique ? (replicate ? 1 : 0.78 + 0.39 * local()) : 1;
  const finishSeed = unique && replicate ? commonSeed : localSeed;
  return { values, program, unique, family, type, length, broad, detail, tint, paintIndex, finishSeed };
}

function furnishedModulePlan(model, slot, assignments, seed, tipBalcony = false) {
  const design = moduleMaterialSelection(model, slot, assignments, seed),
    { program, length, type, unique, broad } = design,
    // The 1.95 m dock threshold and the module door share the centre line.
    doorWidth = 1.5, doorHeight = 2.26,
    wall = unique ? type.wall : 0.18,
    inside = MODULE.width / 2 - wall,
    aisleEdge = -inside + 1.13,
    entry = 1.45,
    usable = length - entry - wall - 0.06,
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
    // A circulation-side window lights the aisle, while room-side glazing
    // tracks the actual use behind it. Washrooms only receive clerestories.
    if (side < 0 && zone.partition && (i + Number(broad > 0.5)) % 2 === 0) return [];
    const distance = zone.end - zone.start,
      count = Math.max(1, Math.floor(distance / (broad > 0.48 ? 3.7 : 2.55))),
      high = zone.use === 'bath' || zone.use === 'locker',
      tall = !high && ['living', 'lounge', 'play', 'shop', 'crew', 'rinse'].includes(zone.use),
      width = Math.min(distance / count - 0.56, high ? 0.75 : tall ? 1.9 : 1.35);
    return Array.from({ length: count }, (_, j) => ({
      center: zone.start + (j + 0.5) * distance / count, width,
      bottom: high ? 1.82 : tall ? 0.71 : 0.97, top: high ? 2.35 : tall ? 2.53 : 2.3
    }));
  });
  const balcony = !patio && (tipBalcony || unique && ['day', 'love', 'senior'].includes(program) && broad < 0.27);
  return {
    ...design, wall, inside, aisleEdge, patio, balcony, doorWidth, doorHeight, zones,
    roof: unique ? type.roof : 'flat', ceiling: unique && type.roof !== 'flat' ? 3.12 : 3.31,
    sideWindows: [-1, 1].map(sideWindows),
    endOpening: patio || balcony
      ? { center: patio ? -1.05 : -0.85, width: 1.15, bottom: 0, top: doorHeight, door: true } :
      { center: 0, width: 2.12, bottom: 0.88, top: 2.42 }
  };
}

function realizedModuleEnclosure(model, assignments, seed) {
  let enclosed = 0, terraces = 0, short = 0;
  for (const slot of model.slots) {
    if (slot.blocked || slot.p === EMPTY && slot.use !== 'retail') continue;
    const { length } = moduleMaterialSelection(model, slot, assignments, seed);
    enclosed += length * MODULE.width;
    terraces += (MODULE.depth - length) * MODULE.width;
    if (length < MODULE.depth) short++;
  }
  return { enclosed, terraces, short };
}
