"use strict";
/**
 * 09-render-base.js — rendering primitives.
 * WebGL canvas and camera state, vector helpers, the meshBuilder (collects triangles, lines and glass into buffers)
 * and the low-poly people/animal figures used for scale.
 */
// The 3D canvas, WebGL context, orbit camera, GPU resources and the software fallback (used if WebGL is unavailable).
// WEBGL RENDERER — true depth-tested geometry; no network dependency.
const canvas = $("canvas");
let gl = canvas.getContext("webgl", { antialias: true, alpha: false });
let camera = { az: -0.84, el: 0.57, zoom: 1, pan: 0 },
  gpu = null,
  software = null,
  softwareMesh = null;
// '#rrggbb' -> [r, g, b] in 0..1.
function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
// Small 3-vector helpers: subtract, dot, cross and normalise.
const sub = (a, b) => a.map((v, i) => v - b[i]),
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  unit = (a) => {
    let l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  };
// Creates a geometry collector. Each vertex is 10 numbers: position(3), normal(3), colour(3), alpha(1).
// Buffers: solid (opaque triangles), lines (outlines) and glass (transparent triangles); groups label the ranges per layer
// (used for the level filter, swing animation and 3DM layers).
function meshBuilder() {
  const solid = [],
    lines = [],
    glass = [],
    groups = [];
  // Starts a new named layer group at the current buffer positions.
  function mark(layer, name = layer) {
    groups.push({ layer, name, solid: solid.length, lines: lines.length, glass: glass.length });
  }
  // Appends one vertex.
  function vertex(out, p, n, c, a = 1) {
    out.push(...p, ...n, ...c, a);
  }
  // Adds a triangle with a flat normal.
  function tri(a, b, c, col, out = solid, alpha = 1) {
    const normal = unit(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) vertex(out, p, normal, col, alpha);
  }
  // Adds a quad as two triangles.
  function quad(a, b, c, d, col, out = solid, alpha = 1) {
    tri(a, b, c, col, out, alpha);
    tri(a, c, d, col, out, alpha);
  }
  // Adds a line segment.
  function line(a, b, col) {
    vertex(lines, a, [0, 0, 0], col);
    vertex(lines, b, [0, 0, 0], col);
  }
  // Point on a circle of radius r at angle a and height y (y is up).
  function ringPoint(r, a, y) {
    return [r * Math.cos(a), y, r * Math.sin(a)];
  }
  // Adds an extruded annular sector (a room/corridor/floor slab) from radius r to R, angle a to b, height h; optional portal gap.
  function sector(r, R, a, b, y, h, col, portal = null, hideTop = false) {
    const steps = Math.max(1, Math.ceil((b - a) / 0.055));
    const cuts = Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps);
    if (portal) for (const v of [portal.a, portal.b]) if (v > a && v < b) cuts.push(v);
    cuts.sort((x, z) => x - z);
    for (let i = 0; i < cuts.length - 1; i++) {
      const u = cuts[i],
        v = cuts[i + 1];
      if (v - u < 1e-9) continue;
      let A = ringPoint(r, u, y),
        B = ringPoint(R, u, y),
        C = ringPoint(R, v, y),
        D = ringPoint(r, v, y),
        At = ringPoint(r, u, y + h),
        Bt = ringPoint(R, u, y + h),
        Ct = ringPoint(R, v, y + h),
        Dt = ringPoint(r, v, y + h);
      if (!hideTop) quad(At, Dt, Ct, Bt, col);
      quad(A, B, C, D, col);
      if (portal && u >= portal.a - 1e-8 && v <= portal.b + 1e-8) {
        const lo = clamp(portal.lo, y, y + h),
          hi = clamp(portal.hi, y, y + h);
        if (lo > y + 1e-7) quad(B, ringPoint(R, u, lo), ringPoint(R, v, lo), C, col);
        if (hi < y + h - 1e-7) quad(ringPoint(R, u, hi), Bt, Ct, ringPoint(R, v, hi), col);
      } else quad(B, Bt, Ct, C, col);
      if (r > 0) quad(A, D, Dt, At, col);
      if (i === 0) quad(A, At, Bt, B, col);
      if (i === cuts.length - 2) quad(D, C, Ct, Dt, col);
    }
  }

  // Adds a rotated box centred on (cx, cy, cz); optionally outlined.
  function box(cx, cy, cz, w, h, d, angle, col, outline = false) {
    let t = [-Math.sin(angle), 0, Math.cos(angle)],
      r = [Math.cos(angle), 0, Math.sin(angle)];
    const xyz = (x, y, z) => [cx + x * t[0] + z * r[0], cy + y, cz + x * t[2] + z * r[2]];
    let v = [
      xyz(-w / 2, 0, -d / 2),
      xyz(w / 2, 0, -d / 2),
      xyz(w / 2, 0, d / 2),
      xyz(-w / 2, 0, d / 2),
      xyz(-w / 2, h, -d / 2),
      xyz(w / 2, h, -d / 2),
      xyz(w / 2, h, d / 2),
      xyz(-w / 2, h, d / 2),
    ];
    for (const f of [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
    ])
      quad(
        ...f
          .slice()
          .reverse()
          .map((i) => v[i]),
        col,
      );
    if (outline) {
      const c = col.map((x) => x * 0.76);
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ])
        line(v[a], v[b], c);
    }
  }
  return { solid, lines, glass, quad, tri, line, sector, box, ringPoint, mark, groups };
}

// Low-poly human figure for scale at (x, y, z) facing angle a; opt holds style options.
function lowPolyPerson(box, x, y, z, a, opt = {}) {
  const h = opt.h || 1.68,
    w = opt.w || 0.56,
    skin = rgb(opt.skin || "#d9b28b"),
    cloth = rgb(opt.cloth || "#7e97b8"),
    dark = rgb(opt.dark || "#6b6b71"),
    hair = rgb(opt.hair || "#6d5a49"),
    stroll = opt.stroll || 0;
  const T = [-Math.sin(a), Math.cos(a)],
    legH = h * 0.44,
    torsoH = h * 0.34,
    head = h * 0.15;
  for (const side of [-1, 1]) {
    const sx = side * (w * 0.14 + stroll * side * 0.03),
      px = x + sx * T[0],
      pz = z + sx * T[1];
    box(px, y, pz, w * 0.16, legH, w * 0.16, a, dark, true);
  }
  box(x, y + legH, z, w * 0.44, torsoH, w * 0.22, a, cloth, true);
  for (const side of [-1, 1]) {
    const px = x + side * w * 0.29 * T[0],
      pz = z + side * w * 0.29 * T[1];
    box(
      px,
      y + legH + torsoH * 0.19,
      pz,
      w * 0.1,
      torsoH * 0.72,
      w * 0.1,
      a + (side < 0 ? 0.25 : -0.25),
      cloth,
      true,
    );
  }
  box(x, y + legH + torsoH, z, head * 0.72, head, head * 0.72, a, skin, true);
  box(x, y + legH + torsoH + head * 0.9, z, head * 0.8, head * 0.18, head * 0.8, a, hair, true);
}
// Low-poly wheelchair user.
function lowPolyWheelchair(box, quad, tri, x, y, z, a, opt = {}) {
  const w = opt.w || 0.7,
    skin = rgb(opt.skin || "#d6ad86"),
    cloth = rgb(opt.cloth || "#8b79b9"),
    frame = rgb("#70757e"),
    wheel = rgb("#50545a"),
    trouser = rgb("#555b60");
  const T = [-Math.sin(a), 0, Math.cos(a)],
    D = [Math.cos(a), 0, Math.sin(a)];
  function at(t, h, d, W, H, L, col) {
    box(x + t * T[0] + d * D[0], y + h, z + t * T[2] + d * D[2], W, H, L, a, col, true);
  }
  function wheelMesh(t, d, r) {
    const pts = (th, off) => [
      x + (t + off) * T[0] + (d + r * Math.cos(th)) * D[0],
      y + r + r * Math.sin(th),
      z + (t + off) * T[2] + (d + r * Math.cos(th)) * D[2],
    ];
    for (let j = 0; j < 12; j++) {
      const u = (j * TAU) / 12,
        v = ((j + 1) * TAU) / 12;
      quad(pts(u, -0.035), pts(v, -0.035), pts(v, 0.035), pts(u, 0.035), wheel);
      for (const sign of [-1, 1]) {
        const q = t + sign * 0.035;
        const c = [x + q * T[0] + d * D[0], y + r, z + q * T[2] + d * D[2]],
          u0 = pts(u, sign * 0.035),
          v0 = pts(v, sign * 0.035);
        if (sign < 0) tri(c, v0, u0, frame);
        else tri(c, u0, v0, frame);
      }
    }
  }
  for (const sign of [-1, 1]) {
    wheelMesh(sign * w * 0.46, -0.12, 0.3);
    wheelMesh(sign * w * 0.36, 0.32, 0.1);
  }
  at(0, 0.43, 0, w * 0.76, 0.08, 0.58, frame);
  at(0, 0.49, -0.25, w * 0.7, 0.48, 0.09, frame);
  at(0, 0.52, 0.11, w * 0.52, 0.16, 0.48, trouser);
  at(0, 0.14, 0.33, w * 0.5, 0.38, 0.17, trouser);
  at(0, 0.67, -0.06, w * 0.54, 0.39, 0.27, cloth);
  for (const sign of [-1, 1]) at(sign * w * 0.39, 0.58, -0.02, 0.09, 0.25, 0.12, cloth);
  at(0, 1.06, -0.06, 0.23, 0.24, 0.22, skin);
  at(0, 1.27, -0.06, 0.25, 0.065, 0.24, rgb("#66564a"));
}
// Low-poly dog.
function lowPolyDog(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || "#b79269");
  box(x, y + 0.33 * s, z, 0.92 * s, 0.42 * s, 0.3 * s, a, col, true);
  box(
    x + 0.44 * s * Math.cos(a),
    y + 0.45 * s,
    z + 0.44 * s * Math.sin(a),
    0.34 * s,
    0.24 * s,
    0.22 * s,
    a,
    col,
    true,
  );
  for (const side of [-1, 1])
    box(
      x + 0.52 * s * Math.cos(a) + side * 0.08 * -Math.sin(a),
      y + 0.58 * s,
      z + 0.52 * s * Math.sin(a) + side * 0.08 * Math.cos(a),
      0.05 * s,
      0.12 * s,
      0.05 * s,
      a,
      rgb("#82684f"),
      true,
    );
  for (const sx of [-0.25, 0.15])
    for (const sz of [-0.09, 0.09])
      box(
        x + sx * s * Math.cos(a) + sz * -Math.sin(a),
        y + 0.12 * s,
        z + sx * s * Math.sin(a) + sz * Math.cos(a),
        0.08 * s,
        0.24 * s,
        0.08 * s,
        a,
        col,
        true,
      );
}
// Low-poly bird.
function lowPolyBird(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || "#8a8f6a");
  box(x, y + 0.08 * s, z, 0.18 * s, 0.12 * s, 0.12 * s, a, col, true);
  box(
    x + 0.11 * s * Math.cos(a),
    y + 0.12 * s,
    z + 0.11 * s * Math.sin(a),
    0.08 * s,
    0.06 * s,
    0.06 * s,
    a,
    col,
    true,
  );
  for (const side of [-1, 1])
    box(
      x + side * 0.11 * s * -Math.sin(a),
      y + 0.11 * s,
      z + side * 0.11 * s * Math.cos(a),
      0.14 * s,
      0.02 * s,
      0.08 * s,
      a + side * 0.3,
      rgb(opt.wing || "#727758"),
      true,
    );
}
// Low-poly rabbit.
function lowPolyRabbit(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || "#c7b9a6");
  box(x, y + 0.13 * s, z, 0.24 * s, 0.18 * s, 0.14 * s, a, col, true);
  box(
    x + 0.12 * s * Math.cos(a),
    y + 0.2 * s,
    z + 0.12 * s * Math.sin(a),
    0.12 * s,
    0.11 * s,
    0.11 * s,
    a,
    col,
    true,
  );
  for (const side of [-1, 1])
    box(
      x + 0.16 * s * Math.cos(a) + side * 0.03 * -Math.sin(a),
      y + 0.34 * s,
      z + 0.16 * s * Math.sin(a) + side * 0.03 * Math.cos(a),
      0.03 * s,
      0.18 * s,
      0.03 * s,
      a,
      col,
      true,
    );
}
// Low-poly squirrel.
function lowPolySquirrel(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || "#9f8063");
  box(x, y + 0.12 * s, z, 0.22 * s, 0.17 * s, 0.12 * s, a, col, true);
  box(
    x + 0.11 * s * Math.cos(a),
    y + 0.19 * s,
    z + 0.11 * s * Math.sin(a),
    0.09 * s,
    0.1 * s,
    0.09 * s,
    a,
    col,
    true,
  );
  box(
    x - 0.12 * s * Math.cos(a),
    y + 0.26 * s,
    z - 0.12 * s * Math.sin(a),
    0.08 * s,
    0.25 * s,
    0.08 * s,
    a - 0.4,
    col,
    true,
  );
}
