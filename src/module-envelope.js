'use strict';

// Profiles are measured across the enclosure from -1 to 1. The solid shell,
// roof framing and nominal area takeoff all use these same sections.
const MODULE_FORM_KINDS = [
  'flat', 'gable', 'shed', 'saltbox', 'vault', 'streamliner', 'bevel', 'sawtooth', 'butterfly', 'stepped', 'hip'
];

function moduleEnvelope(kind, length, sample, varied) {
  const depth = MODULE.height, half = varied ? 2.00 + sample() * 0.185 : MODULE.width / 2,
    hand = sample() < 0.5 ? -1 : 1, variation = sample(),
    finish = kind === 'streamliner' ? 2.36 + variation * 0.13 :
      kind === 'vault' ? 2.46 + variation * 0.22 :
        kind === 'flat' ? 3.31 : kind === 'bevel' ? 2.62 + variation * 0.17 : 2.60 + variation * 0.27,
    crown = varied ? 3.39 + sample() * 0.11 : depth;
  const arc = (count, raise) => Array.from({ length: count + 1 }, (_, i) => {
    const a = Math.PI * i / count;
    return [-Math.cos(a), finish + (crown - finish) * Math.sin(a) ** raise];
  });
  const shapes = {
    flat: () => [[-1, crown], [1, crown]],
    gable: () => [[-1, finish], [0, crown], [1, finish]],
    shed: () => [[-1, finish], [1, crown]],
    saltbox: () => [[-1, finish + 0.24], [-0.43 + 0.17 * variation, crown], [1, finish]],
    vault: () => arc(8, 1),
    streamliner: () => arc(12, 0.66),
    bevel: () => [[-1, finish], [-0.68, crown], [0.68, crown], [1, finish]],
    sawtooth: () => [[-1, finish], [0.32, crown], [0.33, finish + 0.11], [1, finish + 0.21]],
    butterfly: () => [[-1, crown], [-0.13, finish], [0, finish], [1, crown - 0.13]],
    stepped: () => [[-1, finish], [-0.49, finish + 0.08], [-0.48, crown], [0.45, crown],
      [0.46, finish + 0.12], [1, finish]],
    hip: () => [[-1, finish], [-0.32, crown], [0.32, crown], [1, finish]]
  };
  const profile = shapes[kind]().map(([x, y]) => [hand * x, Math.min(depth, y)]).sort((a, b) => a[0] - b[0]),
    nose = kind === 'streamliner' ? Math.min(length * 0.18, 1.48 + variation * 0.80)
      : kind === 'bevel' ? 0.54 + variation * 0.50 : 0,
    noseScale = kind === 'streamliner' ? 0.67 + variation * 0.09 : 0.82 + variation * 0.08,
    stations = [0, length];
  if (nose) {
    const sections = kind === 'streamliner' ? 6 : 1;
    for (let i = 0; i < sections; i++) stations.push(length - nose + nose * i / sections);
  }
  if (kind === 'hip') stations.push(1.04, length - 1.34);
  if (kind === 'stepped') stations.push(length * 0.57, length * 0.61);
  stations.sort((a, b) => a - b);
  const envelope = { kind, half, profile, stations, nose, noseScale, eave: finish, variation, length };
  let area = 0, side = 0;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i], left = moduleHalfAt(envelope, a), right = moduleHalfAt(envelope, b);
    area += (left + right) * (b - a);
    side += Math.hypot(b - a, right - left);
  }
  return { ...envelope, area, perimeter: 2 * (side + half + moduleHalfAt(envelope, length)) };
}

function moduleHalfAt(form, along) {
  if (!form.nose) return form.half;
  const t = clamp((along - form.length + form.nose) / form.nose, 0, 1),
    taper = form.kind === 'streamliner' ? 1 - Math.sqrt(1 - 0.91 * t * t) : t;
  return form.half * (1 - (1 - form.noseScale) * (form.kind === 'streamliner' ? taper / 0.7 : taper));
}

function moduleRoofAt(form, y, along) {
  let scale = 1;
  if (form.kind === 'streamliner') scale = 0.44 + 0.56 * Math.sqrt(1 - 0.98 * clamp((along - form.length + form.nose) / form.nose, 0, 1) ** 2);
  if (form.kind === 'hip') scale = Math.min(1, 0.18 + 0.82 * along / 1.04, 0.18 + 0.82 * (form.length - along) / 1.34);
  if (form.kind === 'stepped') scale = 1 - 0.63 * clamp((along / form.length - 0.57) / 0.04, 0, 1);
  return form.eave + (y - form.eave) * scale;
}
