"use strict";
/**
 * 04-relations.js — program relationships and small deterministic helpers.
 * Relationships are between pairs of programs: attract, neutral or repel. The distance between the two
 * nodes on the topology map sets how strong the relationship is.
 */
// Stable key for a program pair, e.g. (3, 1) -> '1-3'.
// Signed relationships: proximity controls magnitude, the edge mode controls sign.
const relationKey = (i, j) => Math.min(i, j) + "-" + Math.max(i, j);
// Mode ('attract' | 'neutral' | 'repel') of a pair; neutral when never set.
function relationMode(i, j) {
  return state.relations[relationKey(i, j)] || "neutral";
}
// Strength 0.05-1 of a pair: nodes that are closer together on the map relate more strongly.
function relationMagnitude(i, j) {
  return Math.max(
    0.05,
    1 - Math.hypot(state.points[i][0] - state.points[j][0], state.points[i][1] - state.points[j][1]) / 1.72,
  );
}
// Layout cost used by the solvers: negative = want adjacent (attract), positive = want apart (repel); same program = -1.
function relationCost(i, j) {
  if (i < 0 || j < 0 || i >= 5 || j >= 5) return 0;
  if (i === j) return -1;
  const mode = relationMode(i, j);
  return mode === "neutral" ? 0 : (mode === "repel" ? 1 : -1) * relationMagnitude(i, j);
}
// Seeded pseudo-random generator (mulberry32): same seed gives the same layout every time. Returns a function giving [0,1).
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Splits integer `count` among `weights` using largest remainder, so the parts always add up exactly.
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
