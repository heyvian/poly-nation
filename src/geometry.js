'use strict';

// WEBGL RENDERER — true depth-tested geometry; no network dependency.
const canvas = $('canvas');
let gl = canvas.getContext('webgl', { antialias: true, alpha: false });
let camera = { az: -0.84, el: 0.57, zoom: 1, pan: 0 },
  gpu = null,
  software = null,
  softwareMesh = null;
function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}
const sub = (a, b) => a.map((v, i) => v - b[i]),
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  unit = (a) => {
    let l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  };

function orbitBasis({ az, el }) {
  const horizontal = Math.abs(el) === Math.PI / 2 ? 0 : Math.cos(el);
  const back = [horizontal * Math.cos(az), Math.sin(el), horizontal * Math.sin(az)];
  // Derive screen-right from azimuth so the basis remains stable at a vertical camera.
  const right = [Math.sin(az), 0, -Math.cos(az)];
  return { back, right, up: unit(cross(back, right)) };
}

function baseViewHalf(mesh, camera, aspect) {
  const extent = mesh.extent * 1.23;
  return Math.max(extent, extent / aspect, camera.el > 1.4 ? 0 : mesh.H * 0.68);
}

function modelViewPivot(mesh) {
  return mesh.orbitPivot ?? [0, mesh.H * 0.47, 0];
}

// Keep both renderers and the editing ray in the same camera coordinate system.
function modelProjection(mesh, camera, aspect) {
  const basis = orbitBasis(camera),
    { right, up } = basis,
    target = modelViewPivot(mesh).map(
      (coordinate, axis) => coordinate + right[axis] * (camera.panX ?? 0) + up[axis] * camera.pan
    );
  return { ...basis, target, half: baseViewHalf(mesh, camera, aspect) * camera.zoom };
}

// Measure geometry in screen axes so a low cutaway and a tall elevation can each use
// the available canvas. The ground plane and grid precede the architectural groups.
function projectedModelBounds(mesh, { right, up }, startsAt = (group) => group.layer !== 'Reference') {
  const firstGroup = mesh.groups.find(startsAt);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const [originX, originY, originZ] = modelViewPivot(mesh);
  if (!firstGroup) return { minX, maxX, minY, maxY };
  for (const kind of ['solid', 'glass', 'lines']) {
    const vertices = mesh[kind];
    for (let i = firstGroup[kind]; i < vertices.length; i += 10) {
      const x = vertices[i] - originX,
        y = vertices[i + 1] - originY,
        z = vertices[i + 2] - originZ;
      const across = x * right[0] + y * right[1] + z * right[2];
      const height = x * up[0] + y * up[1] + z * up[2];
      minX = Math.min(minX, across);
      maxX = Math.max(maxX, across);
      minY = Math.min(minY, height);
      maxY = Math.max(maxY, height);
    }
  }
  return { minX, maxX, minY, maxY };
}

function fitModel(mesh, camera, canvas, startsAt) {
  if (!mesh?.groups.some((group) => group.layer !== 'Reference')) return;
  const box = canvas.getBoundingClientRect(),
    { width, height } = box;
  if (!width || !height) return;
  const padding = Math.min(28, Math.min(width, height) * 0.075);
  let top = padding,
    bottom = padding;
  // Leave a clear band around the controls and hints overlaid on the canvas.
  for (const overlay of canvas.parentElement.querySelectorAll(
    '.view-top, .view-bottom, .model-actions'
  )) {
    if (!overlay.getClientRects().length) continue;
    const bounds = overlay.getBoundingClientRect();
    if (overlay.classList.contains('view-top')) top = Math.max(top, bounds.bottom - box.top + 6);
    else bottom = Math.max(bottom, box.bottom - bounds.top + 6);
  }
  const { minX, maxX, minY, maxY } = projectedModelBounds(mesh, orbitBasis(camera), startsAt);
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - top - bottom) / (maxY - minY)
  );
  if (!Number.isFinite(scale) || scale <= 0) return;
  camera.zoom = height / (2 * scale * baseViewHalf(mesh, camera, width / height));
  camera.panX = (minX + maxX) / 2;
  camera.pan = (minY + maxY) / 2 + (top - bottom) / (2 * scale);
}

// Collect interleaved position, normal, and color data plus semantic groups shared by both renderers and export.
function meshBuilder() {
  const solid = [],
    lines = [],
    glass = [],
    groups = [],
    textureStrokes = new Set();
  function mark(layer, name = layer, pick = null) {
    groups.push({
      layer,
      name,
      solid: solid.length,
      lines: lines.length,
      glass: glass.length,
      pick
    });
  }
  function vertex(out, p, n, c, a = 1) {
    out.push(...p, ...n, ...c, a);
  }
  function tri(a, b, c, col, out = solid, alpha = 1) {
    const normal = unit(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) vertex(out, p, normal, col, alpha);
  }
  function quad(a, b, c, d, col, out = solid, alpha = 1) {
    tri(a, b, c, col, out, alpha);
    tri(a, c, d, col, out, alpha);
  }
  function line(a, b, col) {
    vertex(lines, a, [0, 0, 0], col);
    vertex(lines, b, [0, 0, 0], col);
  }
  function textureLine(a, b, col) {
    textureStrokes.add(lines.length);
    line(a, b, col);
  }
  function ringPoint(r, a, y) {
    return [r * Math.cos(a), y, r * Math.sin(a)];
  }
  function sector(r, R, a, b, y, h, col, portal = null, hideTop = false, bands = null) {
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
      } else if (bands) {
        for (const band of bands)
          quad(
            ringPoint(R, u, band.low),
            ringPoint(R, u, band.high),
            ringPoint(R, v, band.high),
            ringPoint(R, v, band.low),
            band.color
          );
      } else quad(B, Bt, Ct, C, col);
      if (r > 0) quad(A, D, Dt, At, col);
      if (i === 0) quad(A, At, Bt, B, col);
      if (i === cuts.length - 2) quad(D, C, Ct, Dt, col);
    }
  }

  function box(cx, cy, cz, w, h, d, angle, col, outline = false, gloss = 0) {
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
      xyz(-w / 2, h, d / 2)
    ];
    for (const f of [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0]
    ])
      quad(
        ...f
          .slice()
          .reverse()
          .map((i) => v[i]),
        col,
        solid,
        1 + gloss
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
        [3, 7]
      ])
        line(v[a], v[b], c);
    }
  }
  return {
    solid,
    lines,
    glass,
    quad,
    tri,
    line,
    textureLine,
    textureStrokes,
    sector,
    box,
    ringPoint,
    mark,
    groups
  };
}

function lowPolyPerson(box, x, y, z, a, opt = {}) {
  const h = opt.h || 1.68,
    w = opt.w || 0.56,
    skin = rgb(opt.skin || '#d9b28b'),
    cloth = rgb(opt.cloth || '#7e97b8'),
    dark = rgb(opt.dark || '#6b6b71'),
    hair = rgb(opt.hair || '#6d5a49'),
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
      true
    );
  }
  box(x, y + legH + torsoH, z, head * 0.72, head, head * 0.72, a, skin, true);
  box(x, y + legH + torsoH + head * 0.9, z, head * 0.8, head * 0.18, head * 0.8, a, hair, true);
}
function lowPolyWheelchair(box, quad, tri, x, y, z, a, opt = {}) {
  const w = opt.w || 0.7,
    skin = rgb(opt.skin || '#d6ad86'),
    cloth = rgb(opt.cloth || '#8b79b9'),
    frame = rgb('#70757e'),
    wheel = rgb('#50545a'),
    trouser = rgb('#555b60');
  const T = [-Math.sin(a), 0, Math.cos(a)],
    D = [Math.cos(a), 0, Math.sin(a)];
  function at(t, h, d, W, H, L, col) {
    box(x + t * T[0] + d * D[0], y + h, z + t * T[2] + d * D[2], W, H, L, a, col, true);
  }
  function wheelMesh(t, d, r) {
    const pts = (th, off) => [
      x + (t + off) * T[0] + (d + r * Math.cos(th)) * D[0],
      y + r + r * Math.sin(th),
      z + (t + off) * T[2] + (d + r * Math.cos(th)) * D[2]
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
  at(0, 1.27, -0.06, 0.25, 0.065, 0.24, rgb('#66564a'));
}
function lowPolyDog(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || '#b79269');
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
    true
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
      rgb('#82684f'),
      true
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
        true
      );
}
function lowPolyBird(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || '#8a8f6a');
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
    true
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
      rgb(opt.wing || '#727758'),
      true
    );
}
function lowPolyRabbit(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || '#c7b9a6');
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
    true
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
      true
    );
}
function lowPolySquirrel(box, x, y, z, a, opt = {}) {
  const s = opt.s || 1,
    col = rgb(opt.col || '#9f8063');
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
    true
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
    true
  );
}
// A repeatable ride cycle, shared by animation and the deterministic visitor simulation.
const SWING_CYCLE = { boarding: 18, ascent: 22, cruise: 60, descent: 26, unload: 10 };
const SWING_CYCLE_TOTAL = Object.values(SWING_CYCLE).reduce(
  (total, duration) => total + duration,
  0
);
function swingPose(ride, clock) {
  const C = SWING_CYCLE,
    T = SWING_CYCLE_TOTAL,
    raw = clock + C.boarding + C.ascent,
    round = Math.floor(raw / T),
    t = mod(raw, T),
    omega = ride.speedKmh / 3.6 / ride.flightRadius,
    attach =
      ride.boardingRadius ??
      Math.max(ride.towerRadius + 0.18, Math.min(8.2, ride.platformRadius - 0.55)),
    maxTilt = Math.atan((omega * omega * ride.flightRadius) / 9.81),
    length = (ride.flightRadius - attach) / Math.sin(maxTilt),
    bottom = ride.roofLevel + 0.36 + length + 0.35,
    top = ride.height - 7.5;
  const smooth = (x) => {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  };
  let h = 0,
    v = 0,
    integral = 0,
    phase = 'Boarding';
  if (t < C.boarding) {
  } else if (t < C.boarding + C.ascent) {
    const u = (t - C.boarding) / C.ascent;
    h = smooth(u);
    v = clamp((u - 0.24) / 0.76, 0, 1);
    integral = (C.ascent * 0.76 * v * v) / 2;
    phase = 'Ascending';
  } else if (t < C.boarding + C.ascent + C.cruise) {
    h = 1;
    v = 1;
    integral = (C.ascent * 0.76) / 2 + t - C.boarding - C.ascent;
    phase = 'At the top';
  } else if (t < T - C.unload) {
    const u = (t - C.boarding - C.ascent - C.cruise) / C.descent,
      k = clamp(u / 0.76, 0, 1);
    h = 1 - smooth(u);
    v = 1 - k;
    integral = (C.ascent * 0.76) / 2 + C.cruise + C.descent * 0.76 * (k - (k * k) / 2);
    phase = 'Descending';
  } else {
    integral = (C.ascent * 0.76) / 2 + C.cruise + (C.descent * 0.76) / 2;
    phase = 'Unloading';
  }
  let tilt = 0;
  for (let i = 0; i < 12; i++)
    tilt = Math.atan(((omega * v) ** 2 * (attach + length * Math.sin(tilt))) / 9.81);
  const crown = bottom + (Math.max(bottom, top) - bottom) * h,
    rad = attach + length * Math.sin(tilt),
    seatY = crown - length * Math.cos(tilt) - 0.35,
    angle =
      omega * (round * ((C.ascent * 0.76) / 2 + C.cruise + (C.descent * 0.76) / 2) + integral);
  return { phase, round, t, crown, rad, attach, seatY, angle, speed: omega * v * rad * 3.6, tilt };
}
function buildSwing(b, ride, pose) {
  const { sector, box, quad, line, ringPoint } = b,
    crownR = pose.attach + 0.28,
    seatColor = rgb('#be866d'),
    chainColor = rgb('#856f59'),
    frame = rgb('#c98b4b'),
    rail = rgb('#e2af61'),
    low = pose.crown,
    rise = 2.72,
    hub = ride.towerRadius + Math.min(0.24, (crownR - ride.towerRadius) * 0.25);
  sector(ride.towerRadius, hub, 0, TAU, low, rise, rail);
  sector(Math.max(hub, crownR - 0.56), crownR, 0, TAU, low, 0.14, rail);
  // Schematic radial trusses. The top chords fall from the mast to the chain ring.
  function brace(a, z) {
    const direction = unit(sub(z, a)),
      radial = unit(cross(direction, [0, 1, 0])),
      across = unit(cross(direction, radial));
    for (const normal of [radial, across]) {
      const edge = (point, side) => point.map((n, i) => n + normal[i] * side * 0.055);
      quad(edge(a, -1), edge(z, -1), edge(z, 1), edge(a, 1), frame);
    }
  }
  for (let i = 0; i < 18; i++) {
    // Azimuth increases during rotation. The seat faces along that tangent,
    // with its two suspension chains on the radial sides.
    const a = pose.angle + (i * TAU) / 18,
      heading = a + Math.PI / 2,
      [x, y, z] = ringPoint(pose.rad, a, pose.seatY);
    const truss = (span, upper = false) =>
      ringPoint(hub + (crownR - hub) * span, a, low + (upper ? rise * (1 - span) : 0));
    brace(truss(0), truss(1));
    brace(truss(0, true), truss(1));
    const web = [truss(0), truss(0.25, true), truss(0.48), truss(0.72, true), truss(1)];
    for (let j = 1; j < web.length; j++) brace(web[j - 1], web[j]);
    for (const offset of [-0.26, 0.26])
      line(
        ringPoint(pose.attach + offset, a, pose.crown),
        ringPoint(pose.rad + offset, a, y + 0.24),
        chainColor
      );
    box(x, y, z, SWING_SEAT_WIDTH, 0.24, SWING_SEAT_DEPTH, heading, seatColor);
    box(
      x - 0.2 * Math.cos(heading),
      y + 0.24,
      z - 0.2 * Math.sin(heading),
      SWING_SEAT_WIDTH,
      0.48,
      0.1,
      heading,
      seatColor
    );
  }
}
// Permanent construction and lightweight module families share one comparison library.
const STRUCTURAL_SYSTEMS = {
  'mast-steel-truss': {
    name: 'Braced steel lattice mast',
    short: 'Steel lattice',
    group: 'Metal',
    color: '#657a78',
    frame: 'brace',
    feature: true
  },
  concrete: {
    name: 'Cast-in-place reinforced concrete',
    short: 'Cast concrete',
    group: 'Concrete and masonry',
    color: '#a4a69e',
    frame: 'solid'
  },
  precast: {
    name: 'Precast concrete',
    short: 'Precast',
    group: 'Concrete and masonry',
    color: '#c0b8a9',
    frame: 'solid'
  },
  masonry: {
    name: 'Load-bearing masonry',
    short: 'Masonry',
    group: 'Concrete and masonry',
    color: '#9d6958',
    frame: 'solid'
  },
  'wood-stud': {
    name: 'Light wood framing (stick and frame)',
    short: 'Wood framing',
    group: 'Timber',
    color: '#c49b62',
    frame: 'stud'
  },
  clt: {
    name: 'Cross-laminated timber (CLT)',
    short: 'CLT',
    group: 'Timber',
    color: '#b88453',
    frame: 'solid',
    module: true
  },
  glulam: {
    name: 'Braced glulam post and beam',
    short: 'Glulam',
    group: 'Timber',
    color: '#93643c',
    frame: 'post',
    module: true
  },
  'lvl-box': {
    name: 'LVL box frame with shear skins',
    short: 'LVL box frame',
    group: 'Timber',
    color: '#a88760',
    frame: 'brace',
    module: true
  },
  'steel-frame': {
    name: 'Structural steel frame',
    short: 'Steel frame',
    group: 'Metal',
    color: '#626c73',
    frame: 'post',
    module: true
  },
  'light-steel': {
    name: 'Braced light-gauge steel cassette',
    short: 'Light steel',
    group: 'Metal',
    color: '#8e9aaa',
    frame: 'stud',
    module: true
  },
  'space-frame': {
    name: 'Steel space frame',
    short: 'Space frame',
    group: 'Metal',
    color: '#46606b',
    frame: 'brace',
    module: true
  },
  'steel-outrigger': {
    name: 'Steel cantilever truss',
    short: 'Cantilever truss',
    group: 'Metal',
    color: '#52645e',
    frame: 'brace'
  },
  'steel-composite': {
    name: 'Steel-composite ring frame',
    short: 'Composite steel',
    group: 'Metal',
    color: '#68736f',
    frame: 'post'
  },
  'steel-tube': {
    name: 'Welded steel tube chassis',
    short: 'Tube chassis',
    group: 'Metal',
    color: '#596f76',
    frame: 'brace',
    module: true
  },
  'aluminum-truss': {
    name: 'Aluminum truss frame',
    short: 'Aluminum truss',
    group: 'Metal',
    color: '#929da4',
    frame: 'brace',
    module: true
  }
};
const EXTERIOR_FINISHES = {
  'slide-enamel': {
    name: 'Blue enamel-coated steel',
    short: 'Blue enamel',
    group: 'Metal',
    color: '#287fa7',
    feature: true
  },
  'slide-stainless': {
    name: 'Brushed stainless steel',
    short: 'Stainless steel',
    group: 'Metal',
    color: '#a8b7b7',
    feature: true
  },
  'slide-composite': {
    name: 'Warm white fiberglass',
    short: 'Fiberglass',
    group: 'Composite',
    color: '#dfc8a8',
    feature: true
  },
  'rammed-earth': {
    name: 'Rammed earth',
    short: 'Rammed earth',
    group: 'Earth and mineral',
    color: '#b49373',
    seam: '#8f7156',
    course: 0.29,
    texture: 'earth'
  },
  concrete: {
    name: 'Architectural concrete',
    short: 'Concrete',
    group: 'Earth and mineral',
    color: '#c0bdb2',
    seam: '#8d8a80',
    joint: 3
  },
  'board-concrete': {
    name: 'Board-formed concrete',
    short: 'Board-formed',
    group: 'Earth and mineral',
    color: '#b8b0a2',
    seam: '#8d8070',
    course: 0.38
  },
  brick: {
    name: 'Brick veneer',
    short: 'Brick',
    group: 'Earth and mineral',
    color: '#a15b47',
    seam: '#d5b3a0',
    joint: 0.85,
    course: 0.28,
    stagger: true
  },
  stone: {
    name: 'Dimension stone panels',
    short: 'Stone',
    group: 'Earth and mineral',
    color: '#c0ad93',
    seam: '#96836a',
    joint: 1.6,
    course: 0.75
  },
  terracotta: {
    name: 'Terracotta rainscreen',
    short: 'Terracotta',
    group: 'Earth and mineral',
    color: '#aa6c52',
    seam: '#7f5846',
    course: 0.42,
    joint: 1.1,
    stagger: true
  },
  stucco: {
    name: 'Thin-coat stucco on reinforced board',
    short: 'Stucco',
    group: 'Earth and mineral',
    color: '#ded5bc',
    seam: '#aa9c80',
    joint: 6,
    texture: 'stucco',
    module: true
  },
  'fiber-cement': {
    name: 'Fiber cement panels',
    short: 'Fiber cement',
    group: 'Earth and mineral',
    color: '#d5d1c7',
    seam: '#969890',
    joint: 1.2,
    course: 1.2,
    module: true
  },
  cedar: {
    name: 'Cedar rainscreen',
    short: 'Cedar',
    group: 'Timber and plant-based',
    color: '#a96f47',
    seam: '#6b452c',
    joint: 0.42,
    texture: 'grain',
    module: true
  },
  'charred-wood': {
    name: 'Charred timber cladding',
    short: 'Charred wood',
    group: 'Timber and plant-based',
    color: '#424143',
    seam: '#6c6969',
    joint: 0.48,
    texture: 'grain',
    module: true
  },
  plywood: {
    name: 'Exterior-grade plywood panels',
    short: 'Plywood',
    group: 'Timber and plant-based',
    color: '#cc9e68',
    seam: '#926740',
    joint: 1.25,
    course: 1.25,
    texture: 'grain',
    module: true
  },
  'thermo-wood': {
    name: 'Thermally modified timber slats',
    short: 'Thermo timber',
    group: 'Timber and plant-based',
    color: '#9b7654',
    seam: '#6b5440',
    joint: 0.38,
    texture: 'grain',
    module: true
  },
  'cork-panel': {
    name: 'Expanded cork rainscreen panels',
    short: 'Cork panels',
    group: 'Timber and plant-based',
    color: '#ad9675',
    seam: '#7f6f55',
    joint: 1.15,
    course: 0.78,
    module: true
  },
  corrugated: {
    name: 'Corrugated galvanized steel',
    short: 'Corrugated steel',
    group: 'Metal',
    color: '#8ea2aa',
    seam: '#697b85',
    joint: 0.36,
    module: true
  },
  'insulated-panel': {
    name: 'Insulated metal sandwich panels',
    short: 'Insulated metal',
    group: 'Metal',
    color: '#dae0d7',
    seam: '#a2b3ab',
    joint: 1.13,
    module: true
  },
  'painted-tin': {
    name: 'Painted ribbed tin siding', short: 'Painted tin', group: 'Metal', color: '#607b76',
    seam: '#aab9af', joint: 0.52, texture: 'ribs', gloss: 0.16, module: true
  },
  'trailer-aluminum': {
    name: 'Polished riveted aluminum sheet', short: 'Riveted aluminum', group: 'Metal', color: '#b8c6c7',
    seam: '#859495', joint: 1.15, course: 0.85, texture: 'rivets', gloss: 0.52, module: true
  },
  aluminum: {
    name: 'Aluminum standing-seam panels',
    short: 'Aluminum',
    group: 'Metal',
    color: '#74878a',
    seam: '#9faeb1',
    joint: 0.6,
    module: true
  },
  zinc: {
    name: 'Zinc panels',
    short: 'Zinc',
    group: 'Metal',
    color: '#6c7d85',
    seam: '#9ca7ad',
    joint: 0.9,
    module: true
  },
  'weathering-steel': {
    name: 'Weathering steel cassette panels',
    short: 'Weathering steel',
    group: 'Metal',
    color: '#9a654f',
    seam: '#765346',
    joint: 1.2,
    course: 1.4,
    module: true
  },
  'perforated-aluminum': {
    name: 'Perforated aluminum screen',
    short: 'Perforated metal',
    group: 'Metal',
    color: '#99a7a2',
    seam: '#677873',
    joint: 1.2,
    texture: 'perforated',
    module: true
  },
  vinyl: {
    name: 'Vinyl lap siding',
    short: 'Vinyl siding',
    group: 'Glazing and composite panels',
    color: '#d7d4be',
    seam: '#a6a189',
    course: 0.23,
    texture: 'lapping',
    module: true
  },
  glazing: {
    name: 'Glazed curtain wall',
    short: 'Glazing',
    group: 'Glazing and composite panels',
    color: '#8eb5be',
    seam: '#496771',
    joint: 1.2,
    course: 1.3
  },
  polycarbonate: {
    name: 'Multiwall polycarbonate panels',
    short: 'Polycarbonate',
    group: 'Glazing and composite panels',
    color: '#b4c6bd',
    seam: '#8caba0',
    joint: 0.56,
    module: true
  },
  'recycled-composite': {
    name: 'Recycled composite rainscreen panels',
    short: 'Recycled composite',
    group: 'Glazing and composite panels',
    color: '#8a9891',
    seam: '#63706a',
    joint: 1.1,
    course: 0.78,
    stagger: true,
    module: true
  }
};
const MATERIAL_CATALOGUES = { structure: STRUCTURAL_SYSTEMS, facade: EXTERIOR_FINISHES };
const ACCESSORY_MATERIALS = {
  slide: { facade: ['slide-enamel', 'slide-stainless', 'slide-composite'] },
  mast: { structure: ['mast-steel-truss'] }
};

function materialCompatible(field, key, family) {
  const catalog = MATERIAL_CATALOGUES[field];
  if (Object.hasOwn(ACCESSORY_MATERIALS, family))
    return ACCESSORY_MATERIALS[family][field]?.includes(key) ?? false;
  return (
    Object.hasOwn(catalog, key) &&
    !catalog[key].feature &&
    (family === 'core' || catalog[key].module === true)
  );
}

function materialSlotKey(layout, slot) {
  return [layout.slotN, slot.f, slot.j, slot.p].join(':');
}

function materialValues(assignments, scope, program, slotKey) {
  if (Object.hasOwn(ACCESSORY_MATERIALS, scope))
    return Object.fromEntries(
      Object.entries(ACCESSORY_MATERIALS[scope]).map(([field, keys]) => [
        field,
        keys.includes(assignments[scope]?.[field]) ? assignments[scope][field] : keys[0]
      ])
    );
  const scopes =
    scope === 'roofRetail'
      ? ['building', 'modules', 'commercial', 'roofRetail']
      : scope === 'commercial'
        ? ['building', 'modules', 'commercial']
      : ['building', scope === 'module' ? 'modules' : scope];
  if (program != null) scopes.push(scope + 'Program:' + program);
  if (slotKey) scopes.push('module:' + slotKey);
  const defaults =
    scope === 'core'
      ? { structure: 'concrete', facade: 'concrete' }
      : scope === 'roofRetail'
        ? { structure: 'light-steel', facade: 'insulated-panel' }
        : { structure: 'steel-frame', facade: 'corrugated' };
  // Older studies can contain heavy module presets. Resolve through to the next compatible layer.
  for (const key of scopes) {
    const selection = assignments[key];
    for (const field of Object.keys(defaults))
      if (materialCompatible(field, selection?.[field], scope)) defaults[field] = selection[field];
  }
  return defaults;
}

function materialTint(color, factor) {
  return color.map((channel) => clamp(channel * factor, 0, 1));
}

const MODULE_PAINT_PALETTES = {
  brights: ['#ef6c66', '#ffd13c', '#39afd2', '#72c76f', '#b07bdf'],
  pastels: ['#e9a7aa', '#ead686', '#9bcbd2', '#a9c99e', '#b9a8d5'],
  coastal: ['#4f918e', '#5786a4', '#edbc81', '#dc887b', '#c6d2bc']
};
const PAINT_SHEEN = { matte: 0, satin: 0.25, gloss: 0.63 };

function paintHex(value) {
  const hex = typeof value === 'string' ? value.trim().replace(/^#/, '').toLowerCase() : '';
  if (/^[0-9a-f]{6}$/.test(hex)) return '#' + hex;
  if (/^[0-9a-f]{3}$/.test(hex)) return '#' + [...hex].map((digit) => digit + digit).join('');
  return '';
}

function slideSurface(assignments) {
  const rule = assignments.slide,
    { facade } = materialValues(assignments, 'slide'),
    custom = paintHex(rule?.paintHex),
    sheen = Number.isFinite(rule?.sheenPercent) ? clamp(rule.sheenPercent, 0, 100) : 30;
  return {
    hex: custom || EXTERIOR_FINISHES[facade].color,
    sheen,
    gloss: (PAINT_SHEEN.gloss * sheen) / 100,
    custom
  };
}

function modulePaint(assignments, program) {
  const daycare = PROGRAMS[program]?.id === 'day';
  let palette = daycare ? 'brights' : 'none',
    sheen = daycare ? 'gloss' : 'satin',
    custom = MODULE_PAINT_PALETTES.brights;
  for (const key of ['modules', 'moduleProgram:' + program]) {
    const rule = assignments[key];
    if (!rule) continue;
    if (
      rule.paint === 'none' ||
      rule.paint === 'custom' ||
      Object.hasOwn(MODULE_PAINT_PALETTES, rule.paint)
    )
      palette = rule.paint;
    if (Object.hasOwn(PAINT_SHEEN, rule.sheen)) sheen = rule.sheen;
    if (
      Array.isArray(rule.paintColors) &&
      rule.paintColors.length === custom.length &&
      rule.paintColors.every((color) => /^#[0-9a-f]{6}$/i.test(color))
    )
      custom = rule.paintColors;
  }
  const colors = palette === 'custom' ? custom : MODULE_PAINT_PALETTES[palette];
  return { palette, colors, custom, gloss: PAINT_SHEEN[sheen] };
}

function finishColor(finish, program, preview, variation) {
  const byProgram = preview.programColors && PROGRAMS[program],
    color = rgb(byProgram ? PROGRAMS[program].color : finish.color);
  if (variation == null) return color;
  // Five finish tones read from across the site while preserving the material or programme hue.
  const tones = [-0.28, -0.14, 0, 0.13, 0.26],
    tone = tones[Math.floor(random(variation)() * tones.length)] * (byProgram ? 0.58 : 1);
  return color.map((channel) => (tone < 0 ? channel * (1 + tone) : channel + (1 - channel) * tone));
}

// Rammed-earth lifts run through the curve and openings at shared elevations.
function earthBands(y, height, color, spacing = 0.31) {
  const seamAt = (index) =>
    index * spacing + (random((index ^ 0x75fb9241) >>> 0)() - 0.5) * spacing * 0.36;
  const bands = [];
  for (let i = Math.floor(y / spacing) - 1; seamAt(i) < y + height; i++) {
    const low = Math.max(y, seamAt(i)),
      high = Math.min(y + height, seamAt(i + 1));
    if (high <= low) continue;
    const tint = random((i ^ 0xa930641d) >>> 0)();
    bands.push({ low, high, color: materialTint(color, 0.92 + 0.16 * tint) });
  }
  return bands;
}

// Draw seams on each arc or planar elevation. Glazing is a color study here.
function drawFinishJoints(finish, length, height, point, line, surfaceColor, variation) {
  const seam = rgb(finish.seam).map((channel, i) => (channel + surfaceColor[i]) / 2);
  const jointSpacing = Math.max(0.85, finish.joint || 0);
  const rows = finish.course ? Math.ceil(height / Math.max(0.64, finish.course)) : 1;
  const sample = random(variation ?? 0),
    phase = variation == null ? 0 : (sample() - 0.5) * jointSpacing * 0.38;
  for (let row = 0; row < rows; row++) {
    const y = (row * height) / rows,
      next = ((row + 1) * height) / rows;
    if (row > 0) {
      const segments = Math.ceil(length / 0.8);
      for (let i = 0; i < segments; i++)
        line(point((i * length) / segments, y), point(((i + 1) * length) / segments, y), seam);
    }
    if (finish.joint)
      for (
        let x = jointSpacing * (finish.stagger && row % 2 ? 0.5 : 1) + phase;
        x < length;
        x += jointSpacing
      )
        line(point(x, y), point(x, next), seam);
  }
  const accent = seam.map((channel, i) => channel * 0.66 + surfaceColor[i] * 0.34);
  if (finish.texture === 'grain') {
    for (let i = 0; i < Math.min(12, Math.ceil(length * 0.75)); i++) {
      const x = (0.06 + sample() * 0.88) * length,
        start = (0.12 + sample() * 0.51) * height;
      line(point(x, start), point(x, start + height * (0.08 + sample() * 0.18)), accent);
    }
  } else if (finish.texture === 'ribs' || finish.texture === 'lapping') {
    const across = finish.texture === 'lapping', span = across ? height : length;
    for (let at = 0.12; at < span; at += across ? 0.25 : 0.22)
      line(across ? point(0, at) : point(at, 0), across ? point(length, at) : point(at, height), accent);
  } else if (finish.texture === 'rivets' || finish.texture === 'stucco') {
    const riveted = finish.texture === 'rivets';
    for (let row = 0.12; row < height - 0.03; row += riveted ? 0.43 : 0.27)
      for (let x = 0.10; x < length - 0.05; x += riveted ? 0.24 : 0.35) {
        const y = row + (riveted ? 0 : (sample() - 0.5) * 0.14);
        line(point(x, y), point(x + (riveted ? 0.025 : 0.045), y + (riveted ? 0 : 0.022)), accent);
      }
  } else if (finish.texture === 'perforated') {
    for (let column = 0.25 + phase; column < length - 0.05; column += 0.48)
      for (let row = 0.3; row < height - 0.05; row += 0.44)
        line(point(column, row), point(column + 0.045, row), accent);
  }
}

function drawStructureBays(system, length, height, point, line) {
  const color = rgb(system.color);
  const bays = Math.max(1, Math.ceil(length / (system.frame === 'stud' ? 0.65 : 3.2)));
  for (let i = 0; i < bays; i++) {
    const x = (i * length) / bays,
      next = ((i + 1) * length) / bays;
    line(point(x, 0), point(x, height), color);
    line(point(x, height), point(next, height), color);
    line(point(x, 0), point(next, 0), color);
    if (system.frame === 'brace') {
      line(point(x, 0), point(next, height), color);
      line(point(x, height), point(next, 0), color);
    }
  }
  line(point(length, 0), point(length, height), color);
}

function drawMaterialModule(b, slot, x, y, z, preview, values) {
  const { box, line } = b;
  const { width, height, depth } = MODULE;
  const angle = slot.angle;
  const tangent = [-Math.sin(angle), Math.cos(angle)];
  const radial = [Math.cos(angle), Math.sin(angle)];
  const point = (across, along, up) => [
    x + across * tangent[0] + along * radial[0],
    y + up,
    z + across * tangent[1] + along * radial[1]
  ];
  const finish = EXTERIOR_FINISHES[values.facade],
    system = STRUCTURAL_SYSTEMS[values.structure],
    variation =
      (Math.imul(slot.f + 1, 0x534192d7) ^
        Math.imul(slot.j + 1, 0x70a8ee9d) ^
        preview.view.seed) >>>
      0;
  const framing = preview.structureView && system.frame !== 'solid';
  const paint =
    !preview.structureView && !preview.programColors && slot.p !== EMPTY
      ? modulePaint(preview.assignments, slot.p)
      : null;
  const color = preview.structureView
    ? rgb(system.color)
    : paint?.colors
      ? rgb(paint.colors[mod(slot.j + 2 * slot.f + preview.view.seed, paint.colors.length)])
      : finishColor(finish, slot.p, preview, variation);
  box(
    x,
    y,
    z,
    width,
    framing ? 0.16 : height,
    depth,
    angle,
    color,
    true,
    paint?.colors ? paint.gloss : 0
  );
  if (preview.structureView ? !framing : !preview.finishJoints) return;
  const elevation = framing
    ? (length, locate) => drawStructureBays(system, length, height, locate, line)
    : (length, locate, face) =>
        drawFinishJoints(
          finish,
          length,
          height,
          locate,
          b.textureLine,
          color,
          (variation ^ face) >>> 0
        );
  for (const side of [-1, 1]) {
    elevation(depth, (d, up) => point(side * (width / 2 + 0.025), d - depth / 2, up), 69 * side);
    elevation(width, (w, up) => point(w - width / 2, side * (depth / 2 + 0.025), up), 175 * side);
  }
}

// Seed the exterior details from the study's variation and its current dock assignments.
// The samples are independent of materials, visibility, and the placement solver.
function moduleExteriorDetails(model, seed) {
  const modules = model.slots.filter((slot) => !slot.blocked && slot.p !== EMPTY),
    rinse = [],
    senior = [],
    balconies = new Set();
  const rankRinse = random(seed ^ 0xf46a0387),
    rankSenior = random(seed ^ 0x773b51e6),
    laundryChance = 0.3 + rankSenior() * 0.3;
  for (const slot of modules) {
    const program = P[slot.p].id;
    if (program === 'rinse') rinse.push({ slot, rank: rankRinse() });
    if (program === 'senior') senior.push({ slot, rank: rankSenior() });
    if (program === 'senior' || program === 'love' || (program === 'fire' && slot.f > 0))
      balconies.add(slot.i);
  }
  rinse.sort((a, b) => a.rank - b.rank);
  for (const { slot } of rinse.slice(0, Math.round(rinse.length * 0.2))) balconies.add(slot.i);

  // A line can only span a shared gap between two enclosed modules on the same floor.
  // Open public decks, removed modules and reserved docks cannot act as anchors.
  const byDock = new Map(
      model.slots
        .filter((slot) => !slot.blocked && (slot.p !== EMPTY || slot.use === 'retail'))
        .map((slot) => [slot.i, slot])
    ),
    usedGaps = new Set(),
    laundry = [],
    target = Math.round(senior.length * laundryChance);
  senior.sort((a, b) => a.rank - b.rank);
  for (const { slot } of senior) {
    if (laundry.length >= target) break;
    const firstSide = rankSenior() < 0.5 ? -1 : 1;
    for (const side of [firstSide, -firstSide]) {
      const neighbor = byDock.get(slot.f * model.slotN + mod(slot.j + side, model.slotN));
      if (!neighbor || neighbor === slot) continue;
      const gap = relationKey(slot.i, neighbor.i);
      if (usedGaps.has(gap)) continue;
      usedGaps.add(gap);
      laundry.push({ slot, neighbor, side, seed: Math.floor(rankSenior() * 4294967296) });
      break;
    }
  }
  return { balconies, laundry };
}

// Vacant public decks use the same footprint in Massing and Build.
function drawDockDeck({ box }, slot, x, y, z, angle, color, recessed = false) {
  const thickness = recessed ? MODULE_CASSETTE_DEPTH : 0.24;
  if (recessed) y -= 0.24;
  box(x, y + 0.24 - thickness, z, MODULE.width, thickness, MODULE.depth, angle, color, true);
  const T = [-Math.sin(angle), Math.cos(angle)],
    D = [Math.cos(angle), Math.sin(angle)],
    rail = rgb('#687e73');
  for (const side of [-1, 1]) {
    const tx = x + side * 2.15 * T[0],
      tz = z + side * 2.15 * T[1];
    box(tx, y + 1.12, tz, 0.09, 0.1, MODULE.depth, angle, rail);
    for (const d of [-8.7, -3, 3, 8.7])
      box(tx + d * D[0], y + 0.24, tz + d * D[1], 0.07, 0.9, 0.07, angle, rail);
  }
  box(x + 8.92 * D[0], y + 1.12, z + 8.92 * D[1], 4.32, 0.1, 0.09, angle, rail);
  if (slot.use === 'garden') {
    for (const d of [-5.8, 0, 5.8])
      for (const side of [-1, 1]) {
        const tx = x + d * D[0] + side * 1.35 * T[0],
          tz = z + d * D[1] + side * 1.35 * T[1];
        box(tx, y + 0.25, tz, 1.2, 0.34, 4.1, angle, rgb('#69875d'), true);
        box(tx, y + 0.59, tz, 0.95, 0.28, 3.7, angle, rgb('#8bb276'));
      }
  } else {
    for (const d of [-5, 5]) {
      const tx = x + d * D[0] + 1.38 * T[0],
        tz = z + d * D[1] + 1.38 * T[1];
      box(tx, y + 0.24, tz, 0.55, 0.48, 2.6, angle, rgb('#c6ae8b'), true);
    }
  }
}

// Local coordinates start at the outer module face, with positive depth pointing away from the ring.
function moduleTipPoint(model, slot, base) {
  const radial = model.R + BUILD_SECTION.dockGap + MODULE.depth,
    cosine = Math.cos(slot.angle),
    sine = Math.sin(slot.angle);
  return (across, depth, up) => [
    (radial + depth) * cosine - across * sine,
    base + up,
    (radial + depth) * sine + across * cosine
  ];
}

function drawModuleBalcony(mesh, model, slot, base, pick = null, showDoor = true, plan = null) {
  const { tri, quad, line, box, mark } = mesh,
    point = moduleTipPoint(model, slot, base),
    userDeck = plan?.unique,
    slab = rgb(userDeck && plan.broad > 0.49 ? '#b9a589' : '#c6bcaa'),
    rail = rgb(userDeck && plan.broad < 0.4 ? '#786b63' : '#597368'),
    radius = userDeck ? 1.53 + plan.broad * 0.43 : 1.65,
    deckShape = userDeck && plan.broad > 0.53 ? 0.73 : 1,
    deck = plan ? 0.005 : 0.18,
    bottom = deck - 0.18,
    guard = 1.08,
    segments = 16;
  mark(`Module_Balconies_L${slot.f + 1}_${P[slot.p].id}`, `Slot_${slot.j}`, pick);
  const curve = (step, up) => {
    const angle = Math.PI * (step / segments - 0.5);
    return point(radius * Math.sin(angle), radius * Math.cos(angle) ** deckShape, up);
  };
  for (let i = 0; i < segments; i++) {
    const low = curve(i, bottom),
      nextLow = curve(i + 1, bottom),
      top = curve(i, deck),
      nextTop = curve(i + 1, deck);
    tri(point(0, 0, bottom), low, nextLow, slab);
    tri(point(0, 0, deck), nextTop, top, slab);
    quad(low, top, nextTop, nextLow, slab);
    for (const up of [deck + 0.13, deck + guard]) line(curve(i, up), curve(i + 1, up), rail);
  }
  quad(curve(segments, bottom), curve(segments, deck), curve(0, deck), curve(0, bottom), slab);
  for (let i = 0; i <= segments; i += 2) {
    const [x, y, z] = curve(i, deck);
    box(x, y, z, 0.045, guard, 0.045, slot.angle, rail);
  }
  if (userDeck) {
    const planter = point(0.69, 0.64, deck),
      depth = plan.broad < 0.46 ? 0.52 : 0.38;
    box(...planter, 0.57, 0.32, depth, slot.angle, slab);
    if (plan.broad > 0.27) {
      const foliage = point(0.69, 0.64, deck + 0.32);
      box(...foliage, 0.48, 0.25 + plan.broad * 0.20, depth - 0.09, slot.angle, rgb('#829d78'));
    }
  }
  if (!showDoor) return;
  // A glazed door marks the connection to the occupied module, above the balcony slab.
  const glazed = rgb('#91aaa5'),
    threshold = 0.19,
    head = 2.48;
  for (const [left, right] of [
    [-0.92, -0.025],
    [0.025, 0.92]
  ]) {
    const corners = [
      point(left, 0.045, threshold),
      point(left, 0.045, head),
      point(right, 0.045, head),
      point(right, 0.045, threshold)
    ];
    quad(...corners, glazed);
    for (let i = 0; i < corners.length; i++)
      line(corners[i], corners[(i + 1) % corners.length], rail);
  }
}

function drawModuleLaundry(mesh, model, { slot, neighbor, side, seed }, base, preview = null) {
  const { line, quad, mark } = mesh,
    half = MODULE.width / 2 + 0.025,
    compatibleDepth = preview?.assignments.moduleDesign?.enabled
      ? Math.min(...[slot, neighbor].map((unit) =>
        moduleMaterialSelection(model, unit, preview.assignments, preview.view.seed).length)) - MODULE.depth - 1.0
      : -3.8,
    anchor = (at, direction) => moduleTipPoint(model, at, base)(direction * half, compatibleDepth, 2.54),
    start = anchor(slot, side),
    end = anchor(neighbor, -side),
    length = Math.hypot(end[0] - start[0], end[2] - start[2]),
    rng = random(seed),
    cord = rgb('#756e60');
  const sag = Math.min(0.26, 0.085 * length),
    at = (t, drop = 0, fold = 0) => [
      start[0] + t * (end[0] - start[0]) + (fold * (end[2] - start[2])) / length,
      start[1] - 4 * sag * t * (1 - t) - drop,
      start[2] + t * (end[2] - start[2]) - (fold * (end[0] - start[0])) / length
    ];
  mark(`Senior_Care_Laundry_L${slot.f + 1}`, `Slots_${slot.j}_${neighbor.j}`);
  for (let i = 0; i < 12; i++) line(at(i / 12), at((i + 1) / 12), cord);

  const palette = ['#ede2cb', '#d6b69d', '#b9cbd0', '#a79bb4', '#7a9f92'],
    pieces = clamp(Math.floor(length / 0.67), 1, 4);
  for (let i = 0; i < pieces; i++) {
    const center = (i + 0.5) / pieces,
      width = Math.min(0.31 / pieces, (0.19 + rng() * 0.18) / length),
      left = center - width,
      right = center + width,
      hem = 0.48 + rng() * 0.5,
      color = rgb(palette[Math.floor(rng() * palette.length)]),
      crease = (rng() - 0.5) * 0.2;
    if (i % 3 === 0 && pieces > 1) {
      // Alternate a short-sleeved shirt with loose linens.
      const shoulder = width * 0.53,
        seam = (t, up) => at(t, up, crease);
      quad(
        at(center - shoulder),
        seam(center - shoulder, hem),
        seam(center + shoulder, hem),
        at(center + shoulder),
        color
      );
      for (const side of [-1, 1]) {
        const inner = center + side * shoulder,
          outer = center + side * width;
        quad(
          at(inner),
          at(outer, hem * 0.16),
          seam(outer, hem * 0.43),
          seam(inner, hem * 0.34),
          color
        );
      }
      continue;
    }
    // Two folds catch the light on the hanging linens.
    quad(at(left), at(left, hem - 0.05, crease), at(center, hem, -crease), at(center), color);
    quad(
      at(center),
      at(center, hem, -crease),
      at(right, hem - 0.1, crease),
      at(right),
      materialTint(color, 0.9)
    );
  }
}

// Keep opening extents and program boundaries shared by the preview and the cost takeoff.
function coreFacadeSpans(
  model,
  floor,
  { base: y, head, soffit } = buildStorey(model, floor),
  slidePortals = null
) {
  const fullHeightHoles = lobbyHoles(model.lobby, floor),
    doorHoles = [];
  for (const slot of model.slots)
    if (slot.f === floor && !slot.blocked)
      doorHoles.push([slot.angle, Math.min(0.45, 1.1 / model.R)]);
  for (const connection of model.feature.slide?.connections || []) {
    if (connection.floor !== floor) continue;
    const portal = slidePortals?.find((entry) => entry.floor === floor);
    fullHeightHoles.push(
      portal
        ? [(portal.start + portal.end) / 2, (portal.end - portal.start) / 2]
        : [connection.angle, Math.min(0.35, 1.45 / model.R)]
    );
  }
  return [
    ...openArcs([...fullHeightHoles, ...doorHoles]).map((span) => ({
      span,
      y,
      height: head - y
    })),
    ...openArcs(fullHeightHoles).map((span) => ({
      span,
      y: head,
      height: soffit - head
    }))
  ];
}

function coreFacadeSegments(model, floor, [start, end]) {
  const rooms = model.layers[floor][model.bandN - 1];
  const cuts = [
    start,
    ...rooms
      .flatMap((room) => [room.start, room.end])
      .filter((angle) => angle > start && angle < end),
    end
  ].sort((a, b) => a - b);
  const spans = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1],
      b = cuts[i];
    if (b - a > 1e-6) spans.push({ start: a, end: b, program: roomAt(rooms, (a + b) / 2) });
  }
  return spans;
}

function drawMaterialFacade(b, model, floor, span, y, height, preview) {
  for (const { start: a, end: z, program } of coreFacadeSegments(model, floor, span)) {
    const { structure, facade } = materialValues(preview.assignments, 'core', program);
    const system = STRUCTURAL_SYSTEMS[structure],
      finish = EXTERIOR_FINISHES[facade];
    const point = (distance, up) => b.ringPoint(model.R + 0.028, a + distance / model.R, y + up);
    const length = (z - a) * model.R;
    if (preview.structureView && system.frame !== 'solid') {
      drawStructureBays(system, length, height, point, b.line);
    } else {
      const color = preview.structureView
        ? rgb(system.color)
        : finishColor(finish, program, preview);
      const bands =
        !preview.structureView && finish.texture === 'earth' ? earthBands(y, height, color) : null;
      b.sector(
        model.R - facadeThickness(model),
        model.R,
        a,
        z,
        y,
        height,
        color,
        null,
        false,
        bands
      );
      if (!bands && !preview.structureView && preview.finishJoints)
        drawFinishJoints(finish, length, height, point, b.textureLine, color);
    }
  }
}

// Guard the open slab edges, leaving daylight voids, enclosed rooms and bridge doors clear.
function atriumGuardSpans(model, floor) {
  const occupied = [...model.rooms, ...model.circulation.regions.filter((q) => q.kind === 'elevator')]
    .filter((q) => q.f === floor && q.r <= model.r + 0.001)
    .map(({ start, end }) => [(start + end) / 2, (end - start) / 2]);
  const openings = lobbyHoles(model.lobby, floor);
  const bridge = model.circulation.bridges?.find((q) => q.f === floor);
  if (bridge) {
    // Compute both openings from the deck edges where they meet the circular slab.
    const near = Math.acos((bridge.offset + bridge.width / 2) / model.r),
      far = Math.acos((bridge.offset - bridge.width / 2) / model.r),
      center = (near + far) / 2,
      half = (far - near) / 2 + 0.03 / model.r;
    for (const side of [-1, 1]) openings.push([bridge.heading + side * center, half]);
  }
  for (const stair of model.circulation.stairs ?? []) {
    if (stair.f === floor) openings.push([stair.top, stair.half + 0.002]);
    if (stair.f - 1 === floor) openings.push([stair.bottom, stair.half + 0.002]);
  }
  return openArcs([...occupied, ...openings]).filter(([a, z]) => (z - a) * model.r > 0.08);
}

// Prefabricated shop units stand on skids above the public roof. Each deck keeps its allocated area.
function drawCommercialPavilions(mesh, roof, preview) {
  const { mark, box, quad, line } = mesh,
    { structure, facade } = materialValues(preview?.assignments ?? {}, 'roofRetail'),
    system = STRUCTURAL_SYSTEMS[structure],
    finish = EXTERIOR_FINISHES[facade],
    frame = rgb(system.color),
    shell = rgb(finish.color),
    window = rgb('#91afb6'),
    roofPanel = rgb('#dde1dc');
  for (const [i, pavilion] of roof.pavilions.entries()) {
    const angle = (pavilion.start + pavilion.end) / 2,
      radius = (pavilion.r + pavilion.R) / 2 - Math.min(0.11, (pavilion.R - pavilion.r) * 0.04),
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      baseDepth = (pavilion.R - pavilion.r) * 0.96;
    function point(across, along, y) {
      return [(radius + along) * cos - across * sin, y, (radius + along) * sin + across * cos];
    }
    function part(across, along, y, width, height, depth, color) {
      const [x, , z] = point(across, along, y);
      box(x, y, z, width, height, depth, angle, color, true);
    }
    const storeys = pavilion.upper ? [pavilion, pavilion.upper] : [pavilion];
    for (const [floor, storey] of storeys.entries()) {
      const y = roof.y + 0.16 + floor * 3,
        depth = baseDepth * (floor ? 0.87 : 1),
        width = storey.area / depth,
        front = depth / 2 + 0.012;
      mark(
        floor ? 'Roof_Commercial_Retail_Upper' : 'Roof_Commercial_Retail',
        'Prefabricated shop ' + (i + 1)
      );
      for (const across of [-0.33 * width, 0.33 * width])
        part(across, 0, y - 0.13, 0.19, 0.13, depth, frame);
      if (preview?.structureView) {
        for (const y0 of [y, y + 2.67]) part(0, 0, y0, width, 0.16, depth, frame);
        for (const across of [-width / 2 + 0.08, width / 2 - 0.08])
          for (const along of [-depth / 2 + 0.08, depth / 2 - 0.08])
            part(across, along, y + 0.15, 0.16, 2.53, 0.16, frame);
        continue;
      }
      if (preview?.assignments.moduleDesign?.enabled) {
        drawVariedRoofShop(mesh, pavilion, preview, i, floor, part, point, width, depth, y, system, finish);
        continue;
      }
      part(0, 0, y, width, 2.72, depth, shell);
      part(0, 0, y + 2.72, width + 0.16, 0.15, depth + 0.16, roofPanel);
      const glassWidth = width * 0.76,
        left = -glassWidth / 2,
        right = glassWidth / 2,
        at = (across, h) => point(across, front, y + h);
      const corners = [at(left, 0.28), at(left, 2.23), at(right, 2.23), at(right, 0.28)];
      quad(...corners, window);
      for (let j = 0; j < corners.length; j++)
        line(corners[j], corners[(j + 1) % corners.length], frame);
      const doorHalf = Math.min(0.48, glassWidth * 0.2),
        door = [at(-doorHalf, 0.04), at(-doorHalf, 2.23), at(doorHalf, 2.23), at(doorHalf, 0.04)];
      // The inner storefront bay is a glazed entry with its own sill and jambs.
      quad(door[0], at(-doorHalf, 0.28), at(doorHalf, 0.28), door[3], window);
      for (let j = 0; j < door.length; j++) line(door[j], door[(j + 1) % door.length], frame);
      if (floor === storeys.length - 1)
        part(width * 0.26, -depth * 0.28, y + 2.87, 0.68, 0.3, 0.49, frame);
      if (preview?.finishJoints)
        for (const side of [-1, 1])
          drawFinishJoints(
            finish,
            depth,
            2.72,
            (distance, h) => point(side * (width / 2 + 0.018), distance - depth / 2, y + h),
            mesh.textureLine,
            shell,
            i + 19 * floor
          );
    }
  }
}

// Steel lattice is continuous from the foundation to the rotating crown.
// Solid collars couple the bridge bearings and seal the glazing at the mast.
function drawSwingMast(mesh, model, height, preview) {
  const { mark, sector, ringPoint } = mesh, ride = model.feature.ride,
    radius = ride.towerRadius, color = rgb(cranePaint(preview?.assignments)),
    posts = 6, radial = radius * 0.88,
    chord = Math.min(0.30, radius * 0.19), bays = Math.max(1, Math.ceil((height - 0.34) / 3.65));
  mark('Swing_Tower', 'Fixed steel lattice mast');
  sector(0, radius, 0, TAU, 0, Math.min(height, 0.34), color);
  function member(a, y, b, z, width) {
    drawAssemblyMember(mesh, ringPoint(radial, a, y), ringPoint(radial, b, z), width, color);
  }
  for (let i = 0; i < posts; i++) {
    const a = i * TAU / posts, b = (i + 1) * TAU / posts;
    member(a, 0.23, a, height, chord);
    for (let j = 0; j < bays; j++) {
      const low = 0.26 + (height - 0.26) * j / bays, top = 0.26 + (height - 0.26) * (j + 1) / bays;
      member(a, low, b, low, chord * 0.63);
      member(j % 2 ? b : a, low, j % 2 ? a : b, top, chord * 0.53);
    }
  }
  for (const bridge of model.circulation.bridges ?? []) {
    const bottom = bridge.f * modelFloorPitch(model) + 0.535 - atriumBridgeDepth(model.r, bridge);
    if (bottom - 0.68 < height) sector(radial - chord, radius, 0, TAU, bottom - 0.68,
      Math.min(0.72, height - bottom + 0.68), color);
  }
  const collar = ride.roofLevel - 0.56;
  if (collar < height) sector(radial - chord, radius, 0, TAU, collar, Math.min(0.74, height - collar), color);
  if (height >= ride.height - 1e-6) sector(0, radius, 0, TAU, height - 0.17, 0.17, color);
}

// The bridge edges and swing stairs use the same glass guards.
function glassGuards({ quad, glass, line, ringPoint }) {
  const guardGlass = rgb('#c7dbd9'),
    guardFrame = rgb('#987753');
  function glassGuard(a, b) {
    const head = ([x, y, z]) => [x, y + 1.1, z];
    const topA = head(a), topB = head(b);
    quad(a, b, topB, topA, guardGlass, glass, 0.38);
    line(topA, topB, guardFrame);
  }
  function curvedGlassGuard(radius, y, start, end) {
    const panels = Math.ceil((end - start) / 0.07);
    for (let i = 0; i < panels; i++) {
      const a = start + ((end - start) * i) / panels,
        z = start + ((end - start) * (i + 1)) / panels;
      glassGuard(ringPoint(radius, a, y), ringPoint(radius, z, y));
    }
  }
  return { glassGuard, curvedGlassGuard };
}

// The ground promenade is the receiving level of the lowest public stair.
// Use the same basin and crossing positions in both massing and assemblies.
function drawGreenhouseGround(mesh, model, top) {
  const { axis, points, approaches, ringRadius, width, beds } = model.greenhouse,
    { box, mark, sector, quad } = mesh,
    surface = top - 0.075;
  mark('Infinite_Rinse_Greenhouse_Beds');
  beds.forEach(({ x, z, width, depth }, i) =>
    box(x, surface, z, width, 0.26, depth, axis, rgb(i % 2 ? '#8fb8a8' : '#91b6c4'))
  );
  mark('Infinite_Rinse_Perimeter_Walk');
  sector(model.r - 1.25, model.r, 0, TAU, surface, 0.075, rgb('#d6dfce'));
  mark('Infinite_Rinse_Atrium_Crossing');
  const crossing = rgb('#e9d6ae');
  const edge = ([x, z], side) => [
    x - (Math.sin(axis) * side * width) / 2, top + 0.005,
    z + (Math.cos(axis) * side * width) / 2
  ];
  if (ringRadius) sector(ringRadius - width / 2, ringRadius + width / 2, 0, TAU, surface, 0.08, crossing);
  const paths = approaches ?? points.slice(1).map((point, i) => [points[i], point]);
  for (const [a, b] of paths) {
    const forward = (b[0] - a[0]) * Math.cos(axis) + (b[1] - a[1]) * Math.sin(axis),
      first = forward > 0 ? b : a, last = forward > 0 ? a : b;
    quad(edge(first, -1), edge(last, -1), edge(last, 1), edge(first, 1), crossing);
  }
}

// Model the deep deck with two half-spans and a corbel on the fixed mast sleeve.
function atriumBridgeDepth(radius, bridge) {
  const halfSpan = Math.sqrt(radius ** 2 - bridge.offset ** 2);
  return clamp(halfSpan / 25, 0.44, 1.24);
}

function drawAtriumBridge(mesh, radius, bridge, top, deck) {
  const { quad } = mesh,
    { glassGuard } = glassGuards(mesh),
    { heading, width, offset } = bridge,
    boxGirder = rgb('#839089'),
    bottom = top - atriumBridgeDepth(radius, bridge),
    left = offset - width / 2,
    right = offset + width / 2,
    cos = Math.cos(heading),
    sin = Math.sin(heading);
  function edge(across, end, y) {
    const along = end * Math.sqrt(radius ** 2 - across ** 2);
    return [across * cos - along * sin, y, across * sin + along * cos];
  }
  for (let i = 0; i < 8; i++) {
    const a = left + (width * i) / 8,
      b = left + (width * (i + 1)) / 8;
    quad(edge(a, -1, top), edge(a, 1, top), edge(b, 1, top), edge(b, -1, top), deck);
    quad(edge(a, -1, bottom), edge(b, -1, bottom), edge(b, 1, bottom), edge(a, 1, bottom), boxGirder);
  }
  for (const [side, start, end] of [
    [left, -1, 1],
    [right, 1, -1]
  ]) {
    const a = edge(side, start, top),
      b = edge(side, end, top),
      shoulderA = edge(side, start, top - 0.16),
      shoulderB = edge(side, end, top - 0.16);
    quad(edge(side, start, bottom), edge(side, end, bottom), shoulderB, shoulderA, boxGirder);
    quad(shoulderA, shoulderB, b, a, deck);
    glassGuard(a, b);
  }
}

// The brackets sit below deck level. The visible sleeve is fixed, separate from
// the ride's moving assembly, and represents a connection for engineering study.
function drawAtriumBridgeBearing(mesh, radius, bridge, top, color) {
  const { heading, width, offset } = bridge,
    mast = swingMastRadius(radius),
    bottom = top - atriumBridgeDepth(radius, bridge),
    support = offset - width / 2 + 0.57,
    point = (r, along, y) => [
      r * Math.cos(heading) - along * Math.sin(heading), y,
      r * Math.sin(heading) + along * Math.cos(heading)
    ];
  mesh.sector(mast - 0.035, mast + 0.19, 0, TAU, bottom - 0.93, 1.12, color);
  for (const along of [-0.33, 0.33]) {
    const end = point(support, along, bottom - 0.12);
    drawAssemblyMember(mesh, point(mast + 0.075, along, bottom - 0.76), end, 0.2, color);
    drawAssemblyMember(mesh, point(mast + 0.070, along, bottom - 0.12), end, 0.22, color);
  }
  const [x, y, z] = point(support - 0.06, 0, bottom - 0.13);
  mesh.box(x, y, z, 1.05, 0.15, 0.58, heading, color);
}

function atriumStairAngles(stair) {
  const direction = Math.sign(stair.bottom - stair.top);
  return {
    direction,
    start: stair.top + direction * stair.half,
    end: stair.bottom - direction * stair.half
  };
}

// Draw treads and closed risers above twin curved stringers. Only the landing
// sectors touch the atrium wall so the stair follows the void without cutting rooms.
function drawAtriumStair(mesh, r, stair, high, low, deck) {
  const { sector, ringPoint, line } = mesh,
    { glassGuard } = glassGuards(mesh),
    { top, bottom, half, width, risers } = stair,
    { direction, start, end } = atriumStairAngles(stair),
    flightAngle = end - start,
    rise = (high - low) / risers,
    steel = rgb('#576c65'),
    inner = r - width - 0.06,
    outer = r - 0.06,
    sectorSpan = (from, to, y, height, far = outer) =>
      sector(inner, far, Math.min(from, to), Math.max(from, to), y - height, height, deck),
    point = (rad, i, dy = 0) =>
      ringPoint(rad, start + flightAngle * i / (risers - 1), high - rise * (i + 0.5) + dy);

  for (const [angle, y] of [[top, high], [bottom, low]]) {
    sectorSpan(angle - half, angle + half, y, 0.24, r + 0.012);
    glassGuard(ringPoint(inner, angle - half, y), ringPoint(inner, angle + half, y));
  }
  for (let i = 0; i < risers - 1; i++) {
    const a = start + flightAngle * i / (risers - 1),
      b = start + flightAngle * (i + 1) / (risers - 1),
      y = high - rise * (i + 1);
    sectorSpan(a, b, y, 0.19);
    line(ringPoint(inner + 0.045, a, y + 0.002), ringPoint(outer - 0.035, a, y + 0.002), steel);
  }
  for (const radius of [inner + 0.095, outer - 0.075]) {
    for (let i = 0; i < risers - 1; i++) {
      drawAssemblyMember(mesh, point(radius, i, -0.22), point(radius, i + 1, -0.22), 0.12, steel, 0.28);
      if (i % 3 === 0) glassGuard(point(radius, i), point(radius, Math.min(risers - 1, i + 3)));
    }
    // Pick up the stringers at each ring landing, outside the clear stair width.
    for (const [i, angle, y] of [[0, top, high], [risers - 1, bottom, low]])
      drawAssemblyMember(mesh, point(radius, i, -0.22), ringPoint(radius, angle, y - 0.19),
        0.12, steel, 0.28);
  }
  for (const [i, angle, y] of [[0, top - direction * half, high], [risers - 1, bottom + direction * half, low]])
    line(point(outer - 0.075, i, 1.1), ringPoint(outer - 0.075, angle, y + 1.1), steel);
}

// The boarding deck closes the canopy at the mast, with stairs over the glazing.
function drawSwingAboveRoof(b, m, assembly = false) {
  const { mark, sector, ringPoint, quad, line, glass, box } = b,
    { glassGuard, curvedGlassGuard } = glassGuards(b),
    ride = m.feature.ride,
    rr = m.r;
  const platform = rgb('#e4d6b7');
  const pitch = ride.roofPitch;
  mark('Swing_Boarding_Platform');
  // Lap the glass and mast joints so adjacent tessellated rings have a continuous seal.
  const lap = pitch?.stairs ? 0.06 : 0;
  sector(
    ride.towerRadius - lap,
    ride.platformRadius + lap,
    0,
    TAU,
    ride.roofLevel - 0.2,
    0.36,
    platform
  );
  const bridge = (rr + ride.platformRadius) / 2,
    aBridge = m.circulation.bridgeAngle;
  if (pitch?.stairs) {
    const { eaveY, stairHalfAngle, stairs } = pitch,
      start = aBridge - stairHalfAngle,
      end = aBridge + stairHalfAngle;
    mark('Swing_Boarding_Platform_Railing');
    for (const [a, z] of openArcs([[aBridge, stairHalfAngle]]))
      curvedGlassGuard(ride.platformRadius, ride.roofLevel + 0.16, a, z);
    if (assembly) drawBuildBoardingStairs(b, m);
    else {
      mark('Swing_Boarding_Stairs');
      let lower = eaveY;
      for (const step of stairs) {
        sector(step.r, step.R, start, end, lower - 0.025, step.y - lower + 0.025, platform);
        for (const angle of [start, end])
          glassGuard(ringPoint(step.R, angle, lower), ringPoint(step.r, angle, step.y));
        lower = step.y;
      }
    }
  } else if (pitch) {
    // Earlier material snapshots can retain their original ramp followed by the glass.
    const { eaveY, rise, rampHalfWidth: halfWidth, rampEnd } = pitch,
      point = (rad, across, y) => [
        rad * Math.cos(aBridge) - across * Math.sin(aBridge),
        y,
        rad * Math.sin(aBridge) + across * Math.cos(aBridge)
      ];
    const near = [point(rr, -halfWidth, eaveY), point(rr, halfWidth, eaveY)],
      far = [point(rampEnd, -halfWidth, eaveY + rise), point(rampEnd, halfWidth, eaveY + rise)];
    mark('Swing_Boarding_Ramp');
    quad(near[0], far[0], far[1], near[1], platform);
    for (const side of [0, 1]) {
      const a = near[side],
        b = far[side],
        railTop = ([x, y, z]) => [x, y + 1.1, z];
      quad(a, b, railTop(b), railTop(a), rgb('#c7dbd9'), glass, 0.35);
      line(railTop(a), railTop(b), rgb('#ac9271'));
    }
  } else {
    // Saved material studies with the original flat roof retain their boarding bridge.
    box(
      bridge * Math.cos(aBridge),
      ride.roofLevel,
      bridge * Math.sin(aBridge),
      Math.min(2.4, m.circulation.width),
      0.25,
      rr - ride.platformRadius + 0.5,
      aBridge,
      platform,
      true
    );
    sector(
      rr,
      Math.min(m.R, rr + 3),
      aBridge - 0.07,
      aBridge + 0.07,
      ride.roofLevel - 0.1,
      0.18,
      platform
    );
  }
  mark('Swing_Crown_and_Seats');
  buildSwing(b, ride, swingPose(ride, 0));
}

const BUILD_SLIDE_SIDES = 36;

// Extend the terminal tube stubs behind the interior face so the wall sleeves meet the route.
function slideTubeRings(slide, sides, extend = false) {
  const route = slide.points;
  const extendEnd = (point, away) => {
    const direction = unit(sub(point, away));
    return point.map((value, k) => value + direction[k] * 1.4);
  };
  const points = extend
    ? [extendEnd(route[0], route[1]), ...route, extendEnd(route.at(-1), route.at(-2))]
    : route;
  return points.map((point, i) => {
    const tangent = unit(
        sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)])
      ),
      side = unit(cross([0, 1, 0], tangent)),
      up = unit(cross(tangent, side));
    return Array.from({ length: sides }, (_, j) => {
      const angle = (j * TAU) / sides;
      return point.map(
        (v, k) => v + slide.tubeRadius * (Math.cos(angle) * side[k] + Math.sin(angle) * up[k])
      );
    });
  });
}

// Sweep the slide on the massing route. Build supplies a rounder tube and molded section joints.
function drawWaterSlide(
  mesh,
  slide,
  preview,
  maxY = Infinity,
  flangeMinRadius = Infinity,
  tube = null
) {
  if (!slide) return;
  const { mark, quad, tri, solid } = mesh,
    surface = preview ? slideSurface(preview.assignments) : { hex: '#287fa7', gloss: 0 },
    color = rgb(surface.hex),
    alpha = 1 + surface.gloss,
    rings = tube ?? slideTubeRings(slide, 12);
  mark('Infinite_Rinse_Water_Slide');
  function clippedQuad(vertices) {
    if (vertices.every((p) => p[1] <= maxY)) {
      quad(...vertices, color, solid, alpha);
      return;
    }
    const out = [];
    for (let j = 0; j < vertices.length; j++) {
      const a = vertices[j],
        b = vertices[(j + 1) % vertices.length],
        insideA = a[1] <= maxY,
        insideB = b[1] <= maxY;
      if (insideA) out.push(a);
      if (insideA !== insideB) {
        const t = (maxY - a[1]) / (b[1] - a[1]);
        out.push(a.map((v, k) => v + t * (b[k] - v)));
      }
    }
    for (let j = 1; j + 1 < out.length; j++) tri(out[0], out[j], out[j + 1], color, solid, alpha);
  }
  for (let i = 1; i < rings.length; i++) {
    const previous = rings[i - 1],
      ring = rings[i];
    for (let j = 0; j < ring.length; j++) {
      const next = (j + 1) % ring.length;
      clippedQuad([previous[j], previous[next], ring[next], ring[j]]);
    }
  }
  if (flangeMinRadius < Infinity)
    drawSlideJoints(mesh, slide.points, slide.tubeRadius, color, maxY, flangeMinRadius);
}

// Trace the intersection of each tube strip with both curved faces of the wall.
function buildSlidePortals(model, rings) {
  const slide = model.feature.slide,
    outside = model.R,
    inside = outside - facadeThickness(model),
    ends = [
      { floor: slide.startFloor, angle: slide.startAngle },
      { floor: slide.endFloor, angle: slide.endAngle }
    ];
  function contour(radius, angle, end) {
    const path = end ? rings.slice().reverse() : rings;
    return path[0].map((_, j) => {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1][j],
          b = path[i][j],
          from = Math.hypot(a[0], a[2]),
          to = Math.hypot(b[0], b[2]);
        if (from > radius || to < radius || from === to) continue;
        const t = (radius - from) / (to - from),
          p = a.map((value, k) => value + t * (b[k] - value)),
          bearing = Math.atan2(p[2], p[0]);
        return [angle + Math.atan2(Math.sin(bearing - angle), Math.cos(bearing - angle)), p[1]];
      }
      return null;
    });
  }
  return ends
    .map(({ floor, angle }, end) => {
      const outer = contour(outside, angle, end),
        inner = contour(inside, angle, end);
      if (outer.includes(null) || inner.includes(null)) return null;
      const bearings = [...outer, ...inner].map(([a]) => a),
        pad = 0.16 / outside;
      return {
        floor,
        outer,
        inner,
        inside,
        outside,
        start: Math.min(...bearings) - pad,
        end: Math.max(...bearings) + pad
      };
    })
    .filter(Boolean);
}

// In the unwrapped elevation the flashing fills a rectangle around the true tube outline.
function drawSlidePortal(mesh, portal, storey, clad) {
  const { mark, quad, ringPoint } = mesh,
    { outer, inner, start, end, outside, inside } = portal,
    gasket = rgb('#414d4c'),
    collar = rgb('#697975'),
    flashing = rgb('#a6b1ac');
  const point = (radius, [angle, y]) => ringPoint(radius, angle, y);
  mark('Infinite_Rinse_Slide_Wall_Sleeve', 'Level ' + (portal.floor + 1));
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    quad(
      point(outside, outer[i]),
      point(outside, outer[j]),
      point(inside, inner[j]),
      point(inside, inner[i]),
      gasket
    );
  }
  for (const [face, radius, direction] of [
    [outer, outside, 1],
    [inner, inside, -1]
  ]) {
    const center = [0, 1].map((k) => face.reduce((sum, p) => sum + p[k], 0) / face.length),
      delta = ([angle, y]) => [(angle - center[0]) * outside, y - center[1]],
      uv = (x, y) => [center[0] + x / outside, center[1] + y],
      pad = 0.12,
      lip = face.map((p) => {
        const [x, y] = delta(p),
          size = Math.hypot(x, y);
        return uv(x * (1 + pad / size), y * (1 + pad / size));
      });
    mark('Infinite_Rinse_Slide_Facade_Flange');
    for (let i = 0; i < face.length; i++) {
      const j = (i + 1) % face.length;
      quad(
        point(radius + direction * 0.024, face[i]),
        point(radius + direction * 0.024, face[j]),
        point(radius + direction * 0.036, lip[j]),
        point(radius + direction * 0.036, lip[i]),
        collar
      );
    }
    if (!clad) continue;
    const low = storey.base,
      high = storey.soffit,
      corners = [
        [start, low],
        [end, low],
        [end, high],
        [start, high]
      ],
      local = face.map(delta),
      bearings = [...face, ...corners]
        .map((p) => {
          const [x, y] = delta(p);
          return Math.atan2(y, x);
        })
        .sort((a, b) => a - b);
    const [left, bottom] = delta([start, low]),
      [right, top] = delta([end, high]);
    function ray(angle) {
      const x = Math.cos(angle),
        y = Math.sin(angle);
      const boxDist = Math.min(x < 0 ? left / x : right / x, y < 0 ? bottom / y : top / y);
      let tubeDist = Infinity;
      for (let i = 0; i < local.length; i++) {
        const [u, v] = local[i],
          [w, z] = local[(i + 1) % local.length],
          dx = w - u,
          dy = z - v,
          determinant = x * dy - y * dx;
        if (Math.abs(determinant) < 1e-8) continue;
        const t = (u * dy - v * dx) / determinant,
          s = (u * y - v * x) / determinant;
        if (s >= -1e-7 && s <= 1 + 1e-7 && t >= 0) tubeDist = Math.min(tubeDist, t);
      }
      return [uv(x * tubeDist, y * tubeDist), uv(x * boxDist, y * boxDist)];
    }
    mark('Infinite_Rinse_Slide_Flashing');
    for (let i = 0; i < bearings.length; i++) {
      const a = bearings[i],
        b = i + 1 < bearings.length ? bearings[i + 1] : bearings[0] + TAU,
        [u, v] = ray(a),
        [w, z] = ray(b);
      if (![u, v, w, z].flat().every(Number.isFinite)) continue;
      quad(point(radius, u), point(radius, w), point(radius, z), point(radius, v), flashing);
    }
  }
}

// Fit a runout rectangle along the tube's terminal heading, inside the annular landing room.
function receivingPoolPlan(model, room, origin) {
  const route = model.feature.slide.points,
    travel = sub(route.at(-1), route.at(-2)),
    forward = unit([travel[0], 0, travel[2]]),
    across = [-forward[2], 0, forward[0]],
    roomSpan = room.roomEnd - room.roomStart,
    inner = room.roomInner + 0.23,
    outer = room.roomOuter - facadeThickness(model) - 0.18;
  if (outer <= inner) return null;
  const margin = 0.18 / inner,
    point = (x, y, run) => [
      origin[0] + across[0] * x + forward[0] * run,
      y,
      origin[2] + across[2] * x + forward[2] * run
    ];
  function fits(width, start, end) {
    const half = width / 2,
      corners = [
        point(-half, 0, start),
        point(half, 0, start),
        point(half, 0, end),
        point(-half, 0, end)
      ];
    return corners.every((a, i) => {
      const edge = sub(corners[(i + 1) % corners.length], a),
        t = clamp(-dot(a, edge) / dot(edge, edge), 0, 1),
        bearing = mod(Math.atan2(a[2], a[0]) - room.roomStart, TAU);
      // An edge can cross the inner circle even when both its corners clear it.
      return (
        Math.hypot(a[0] + edge[0] * t, a[2] + edge[2] * t) >= inner &&
        Math.hypot(a[0], a[2]) <= outer &&
        bearing >= margin &&
        bearing <= roomSpan - margin
      );
    });
  }
  // Prefer a useful receiving width before looking for extra length in a tighter room.
  for (const minimum of [2.5, 0.8]) {
    for (const width of [3.4, 3.1, 2.8, 2.6, 2.3, 2.0]) {
      for (const start of [-0.55, -0.24, 0]) {
        let end = minimum,
          limit = 7.5;
        if (!fits(width, start, end)) continue;
        for (let i = 0; i < 12; i++) {
          const candidate = (end + limit) / 2;
          if (fits(width, start, candidate)) end = candidate;
          else limit = candidate;
        }
        return { width, start, end, point };
      }
    }
  }
  return null;
}

function drawReceivingPool(mesh, model, room, origin, base) {
  const plan = receivingPoolPlan(model, room, origin);
  if (!plan) return;
  const { mark, quad, tri, line } = mesh,
    { width, start, end, point } = plan,
    half = width / 2,
    lip = 0.16,
    corner = Math.min(0.27, (end - start) * 0.14),
    copingY = base + 0.36,
    waterY = base + 0.24,
    tile = rgb('#91adae'),
    coping = rgb('#d6dcd0'),
    water = rgb('#62a8ba'),
    waterEdge = rgb('#4e94aa');
  function outline(offset, y) {
    const x = half - offset,
      a = start + offset,
      b = end - offset,
      cut = Math.max(0.035, corner - offset * 0.55);
    return [
      [-x + cut, a],
      [x - cut, a],
      [x, a + cut],
      [x, b - cut],
      [x - cut, b],
      [-x + cut, b],
      [-x, b - cut],
      [-x, a + cut]
    ].map(([x, run]) => point(x, y, run));
  }
  const bottom = outline(0, base),
    top = outline(0, copingY),
    inner = outline(lip, copingY),
    surface = outline(lip, waterY),
    fill = outline(lip + 0.06, waterY),
    center = point(0, waterY, (start + end) / 2);
  mark('Infinite_Rinse_Slide_Receiving_Pool', 'Level ' + (room.floor + 1));
  for (let i = 0; i < top.length; i++) {
    const j = (i + 1) % top.length;
    quad(bottom[i], bottom[j], top[j], top[i], tile);
    quad(top[i], top[j], inner[j], inner[i], coping);
    quad(inner[j], inner[i], surface[i], surface[j], tile);
    quad(surface[i], surface[j], fill[j], fill[i], waterEdge);
    tri(center, fill[i], fill[j], water);
    line(top[i], top[j], tile);
  }
  // A small stepped exit at the far end gives the basin a clear direction in plan.
  const stepHalf = half * 0.48,
    tread = Math.min(0.23, (end - start) * 0.16);
  for (let i = 0; i < 2; i++) {
    const back = end - lip - (2 - i) * tread,
      front = back + tread,
      y = waterY + 0.035 + i * 0.055;
    quad(
      point(-stepHalf, y, back),
      point(stepHalf, y, back),
      point(stepHalf, y, front),
      point(-stepHalf, y, front),
      coping
    );
    quad(
      point(-stepHalf, waterY, back),
      point(stepHalf, waterY, back),
      point(stepHalf, y, back),
      point(-stepHalf, y, back),
      tile
    );
  }
}

// Fit each landing assembly inside its Infinite Rinse room and below the tube mouth.
function drawSlideLandings(mesh, model, rings, floors, slabThickness) {
  const { mark, box, line } = mesh,
    slide = model.feature.slide,
    trim = rgb('#758c87'),
    deck = rgb('#d3c7a8');
  for (const room of slide.connections) {
    if (room.floor >= floors) continue;
    const upper = room.floor === slide.startFloor,
      mouth = upper ? rings[0] : rings.at(-1),
      center = [0, 1, 2].map((axis) => mouth.reduce((sum, p) => sum + p[axis], 0) / mouth.length),
      { base } = buildStorey(model, room.floor, slabThickness);
    if (!upper) {
      drawReceivingPool(mesh, model, room, center, base);
      continue;
    }
    const { angle } = room,
      radial = [Math.cos(angle), 0, Math.sin(angle)],
      tangent = [-radial[2], 0, radial[0]],
      near = room.roomInner + 0.19,
      far = room.roomOuter - facadeThickness(model) - 0.21,
      roomHalf = near * Math.sin(Math.min(1.15, (room.roomEnd - room.roomStart) / 2)) - 0.2,
      width = Math.min(2.8, roomHalf * 1.65);
    if (width < 0.55 || far - near < 0.8) continue;
    const across = clamp(dot(center, tangent), -roomHalf + width / 2, roomHalf - width / 2),
      front = clamp(dot(center, radial) + 0.47, near + 0.75, far),
      point = (x, y, r) => [
        r * radial[0] + (x + across) * tangent[0],
        y,
        r * radial[2] + (x + across) * tangent[2]
      ];
    function part(x, y, r, w, h, d, color) {
      const [px, , pz] = point(x, y, r);
      box(px, y, pz, w, h, d, angle, color, true);
    }
    const back = Math.max(near + 0.3, front - 1.5),
        top = Math.max(base + 0.18, Math.min(...mouth.map((p) => p[1])) + 0.035),
        rise = top - base,
        stairs = Math.ceil(rise / 0.18),
        run = Math.min(back - near, stairs * 0.27),
        step = run / stairs,
        handrail = top + 0.96;
      mark('Infinite_Rinse_Slide_Boarding_Platform', 'Level ' + (room.floor + 1));
      part(0, top - 0.14, (front + back) / 2, width, 0.14, front - back, deck);
      for (const edge of [-width / 2 + 0.07, width / 2 - 0.07]) {
        for (const r of [back + 0.06, front - 0.06])
          part(edge, base, r, 0.065, handrail - base, 0.065, trim);
        line(point(edge, handrail, back + 0.06), point(edge, handrail, front - 0.06), trim);
      }
      for (let i = 0; i < stairs; i++)
        part(
          0,
          base,
          back - run + (i + 0.5) * step,
          Math.min(1.35, width),
          (rise * (i + 1)) / stairs,
          step,
          deck
        );
  }
}

// Two molded flange lips meet at each section joint. The galvanized heads run around the rim.
function drawSlideJoints({ mark, quad, tri }, points, radius, color, maxY, minRadius) {
  const spacing = 2.8,
    rim = radius + 0.17,
    flange = materialTint(color, 0.81),
    bolt = rgb('#c2c6bf');
  let distance = 0,
    next = spacing;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      segment = sub(b, a),
      length = Math.hypot(...segment);
    if (distance + length >= next && length > 0) {
      const t = (next - distance) / length,
        center = a.map((value, k) => value + t * segment[k]);
      next += spacing;
      if (center[1] + rim + 0.12 <= maxY && Math.hypot(center[0], center[2]) >= minRadius) {
        const axis = unit(segment),
          side = unit(cross([0, 1, 0], axis)),
          up = cross(axis, side);
        const at = (angle, r, depth) =>
          center.map(
            (value, k) =>
              value + r * (Math.cos(angle) * side[k] + Math.sin(angle) * up[k]) + depth * axis[k]
          );
        mark('Infinite_Rinse_Slide_Flanges');
        for (const [front, back] of [
          [-0.075, -0.012],
          [0.012, 0.075]
        ]) {
          for (let j = 0; j < BUILD_SLIDE_SIDES; j++) {
            const first = (j * TAU) / BUILD_SLIDE_SIDES,
              last = ((j + 1) * TAU) / BUILD_SLIDE_SIDES;
            const edge = (angle, depth) => at(angle, rim, depth);
            quad(
              edge(first, front),
              edge(last, front),
              edge(last, back),
              edge(first, back),
              flange
            );
            quad(
              at(first, radius, front),
              at(last, radius, front),
              edge(last, front),
              edge(first, front),
              flange
            );
            quad(
              at(last, radius, back),
              at(first, radius, back),
              edge(first, back),
              edge(last, back),
              flange
            );
          }
        }
        mark('Infinite_Rinse_Slide_Bolts');
        for (let j = 0; j < 12; j++) {
          const angle = ((j + 0.5) * TAU) / 12;
          for (const end of [-1, 1]) {
            const foot = at(angle, radius + 0.098, end * 0.075),
              top = at(angle, radius + 0.098, end * 0.106);
            const hex = (center, i) =>
              center.map(
                (value, k) =>
                  value +
                  0.044 * (Math.cos((i * TAU) / 6) * side[k] + Math.sin((i * TAU) / 6) * up[k])
              );
            for (let i = 0; i < 6; i++) {
              const x = hex(top, i),
                y = hex(top, i + 1);
              quad(hex(foot, i), hex(foot, i + 1), y, x, bolt);
              tri(top, x, y, bolt);
            }
          }
        }
      }
    }
    distance += length;
  }
}

const ROOM_FLOOR_FINISH = rgb('#c9bdb0');
const CIRCULATION_FLOOR_FINISH = rgb('#f0eadc');

// Brush the circulation finish along the route. Scatter aggregate in the poured room floors.
function drawInteriorFloorPattern(mesh, patch, y, color, circulation, region = patch) {
  const { r, R, start, end } = patch;
  const top = y + 0.003;
  if (circulation) {
    // The returns cross the ring, so their bands run radially into the next corridor.
    const radial =
        /return/i.test(region.kind ?? '') || ['link', 'bridgeAccess'].includes(region.kind),
      radius = (region.r + region.R) / 2,
      width = radial ? (region.end - region.start) * radius : region.R - region.r,
      stripes = Math.max(1, Math.floor(width / 0.42)),
      half = 0.016,
      ink = materialTint(color, 0.89);
    for (let i = 0; i < stripes; i++) {
      const offset = ((i + 0.5) * width) / stripes,
        low = radial ? r : Math.max(r, region.r + offset - half),
        high = radial ? R : Math.min(R, region.r + offset + half),
        a = radial ? Math.max(start, region.start + (offset - half) / radius) : start,
        b = radial ? Math.min(end, region.start + (offset + half) / radius) : end;
      if (high - low < 0.009 || (b - a) * high < 0.009) continue;
      const steps = Math.ceil((b - a) / 0.045);
      for (let j = 0; j < steps; j++) {
        const left = a + ((b - a) * j) / steps,
          right = a + ((b - a) * (j + 1)) / steps;
        mesh.quad(
          mesh.ringPoint(low, left, top),
          mesh.ringPoint(low, right, top),
          mesh.ringPoint(high, right, top),
          mesh.ringPoint(high, left, top),
          ink
        );
      }
    }
    return;
  }
  // Sample the full room so cropped drawings keep the same flecks as the assembly.
  const span = region.end - region.start,
    radialArea = region.R ** 2 - region.r ** 2,
    seed =
      Math.round(mod(region.start, TAU) * 100000) ^
      Math.imul(Math.round(region.r * 1000), 0x45d9f3b),
    sample = random(seed),
    count = Math.ceil(radialArea * span * 0.63);
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt(region.r ** 2 + radialArea * sample()),
      angle = region.start + span * sample(),
      size = 0.023 + sample() * 0.048,
      tone = 0.82 + sample() * 0.14,
      width = size / radius;
    if (radius - size < r || radius + size > R || angle - width < start || angle + width > end)
      continue;
    const at = (dr, da) => mesh.ringPoint(radius + size * dr, angle + width * da, top);
    mesh.quad(
      at(-0.58, -0.4),
      at(-0.22, 0.8),
      at(0.78, 0.28),
      at(0.4, -0.9),
      materialTint(color, tone)
    );
  }
}

const LOBBY_RUG_MARGIN = 0.03;

// Give the lobby surface small faces so its flat panels also sort under the furniture
// in the software renderer. The perimeter remains a single curved floor element.
function drawSharedLobbyFloor(mesh, hub, top) {
  const { r, R, start, end } = hub;
  const color = CIRCULATION_FLOOR_FINISH;
  const columns = Math.max(1, Math.ceil(((end - start) * R) / 0.75)),
    rows = Math.ceil((R - r) / 0.75),
    point = (row, column) =>
      mesh.ringPoint(
        r + ((R - r) * row) / rows,
        start + ((end - start) * column) / columns,
        top
      );
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < columns; j++)
      mesh.quad(point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j), color);
  const { passage, arch, shelfOuter } = hub.layout;
  // Brush the short approaches up to the rug in the direction of the aisle.
  const length = arch - 0.065,
    rugEnd = shelfOuter + LOBBY_RUG_MARGIN,
    ink = materialTint(color, 0.89);
  if (length > rugEnd)
    for (const fraction of [-0.34, -0.17, 0, 0.17, 0.34]) {
      const across = passage * fraction,
        at = (along, offset) => sharedLobbyPoint(hub, along, across + offset, top + 0.003);
      for (const [start, end] of [
        [-length, -rugEnd],
        [rugEnd, length]
      ])
        mesh.quad(at(start, -0.016), at(end, -0.016), at(end, 0.016), at(start, 0.016), ink);
    }
}

// Join the radial divider to the screen along the lobby edge. The only openings
// from the corridor are beside the two arches, beyond the ends of the furnishings.
function drawSharedLobbyScreens(mesh, hub, y, height, color) {
  for (const { radius, start, end } of hub.layout.corridorScreens ?? []) {
    mesh.mark(`Circulation_L${hub.f + 1}_Shared_Lobby_Screen`);
    mesh.sector(radius - 0.08, radius + 0.08, start, end, y, height, color);
  }
}

// Retain the arrangement stored by Material snapshots from before the walk-through lobby.
function drawSavedSharedLobby(mesh, hub, y) {
  const angle = (hub.start + hub.end) / 2,
    depth = hub.R - hub.r,
    radius = hub.r + depth * 0.44,
    span = (hub.end - hub.start) * radius;
  if (depth <= 2.2 || span <= 2.3) return;
  const box = (r, level, width, height, length, color) =>
    mesh.box(...mesh.ringPoint(r, angle, y + level), width, height, length, angle, rgb(color), true);
  mesh.mark(`Circulation_L${hub.f + 1}_Shared_Furniture`, `Shared gathering ${hub.start.toFixed(3)}`);
  box(radius, 0.09, 0.28, 0.71, 0.28, '#5c426a');
  box(radius, 0.8, Math.min(1.25, span * 0.3), 0.12, Math.min(1.4, depth * 0.26), '#d4bb9c');
  box(radius, 0.079, Math.min(span * 0.68, 3.7), 0.025, Math.min(depth * 0.65, 3.8), '#bca4ce');
  const sofaWidth = Math.min(2.4, span * 0.55),
    sofaDepth = Math.min(0.83, depth * 0.18);
  for (const side of [-1, 1]) {
    const r = radius + side * Math.min(depth * 0.29, 1.6);
    if (r - sofaDepth / 2 < hub.r + 0.1 || r + sofaDepth / 2 > hub.R - 0.1) continue;
    box(r, 0.1, sofaWidth, 0.42, sofaDepth, '#d2c7bb');
    box(r + side * sofaDepth * 0.36, 0.5, sofaWidth, 0.43, sofaDepth * 0.27, '#a69aa9');
  }
}

// Grow two offset canes with alternating folded leaves. Their horizontal reach stays
// under 0.4 m from the planter centre, keeping the foliage outside the clear aisle.
function drawLobbyPlant(mesh, point, along, across, crownHeight, sample) {
  const potTop = 0.335,
    height = crownHeight * (0.86 + 0.21 * sample()),
    broadness = 0.048 + 0.052 * sample(),
    foliage = ['#41664b', '#547c54', '#709464', '#7c9a68'].map(rgb),
    stem = rgb('#6a7150'),
    turn = sample() * TAU;
  for (const cane of [0, 1]) {
    const top = cane ? height * (0.68 + 0.15 * sample()) : height,
      direction = turn + cane * Math.PI,
      lean = 0.045 + 0.04 * sample(),
      leanAlong = Math.cos(direction) * lean,
      leanAcross = Math.sin(direction) * lean,
      stemTip = top - 0.1,
      heightAt = (t) => potTop + (stemTip - potTop) * t,
      rootAt = (t, a = 0, b = 0, rise = 0) =>
        point(along + leanAlong * t * t + a, across + leanAcross * t * t + b, heightAt(t) + rise),
      thickness = cane ? 0.023 : 0.033,
      leaves = (cane ? 4 : 6) + Math.floor(sample() * 3);
    drawAssemblyMember(mesh, rootAt(0), rootAt(0.55), thickness, stem);
    drawAssemblyMember(mesh, rootAt(0.55), rootAt(1), thickness, stem);
    for (let i = 0; i < leaves; i++) {
      const level = 0.3 + (0.7 * (i + 1)) / leaves,
        azimuth = direction + i * 2.4 + (sample() - 0.5) * 0.75,
        spread = (0.18 + 0.13 * sample()) * (1 - 0.14 * level),
        lengthAlong = Math.cos(azimuth) * spread,
        lengthAcross = Math.sin(azimuth) * spread,
        width = broadness * (0.68 + 0.32 * sample()),
        sideAlong = -Math.sin(azimuth) * width,
        sideAcross = Math.cos(azimuth) * width,
        rise = Math.min(0.13 + 0.19 * sample(), top - heightAt(level)),
        base = rootAt(level),
        tip = rootAt(level, lengthAlong, lengthAcross, rise),
        middleAlong = lengthAlong * 0.56,
        middleAcross = lengthAcross * 0.56,
        fold = rootAt(level, middleAlong, middleAcross, rise * 0.56 + 0.026),
        left = rootAt(level, middleAlong + sideAlong, middleAcross + sideAcross, rise * 0.43),
        right = rootAt(level, middleAlong - sideAlong, middleAcross - sideAcross, rise * 0.43),
        tint = Math.floor(sample() * (foliage.length - 1));
      mesh.tri(base, fold, left, foliage[tint]);
      mesh.tri(fold, tip, left, foliage[tint]);
      mesh.tri(base, right, fold, foliage[tint + 1]);
      mesh.tri(fold, right, tip, foliage[tint + 1]);
    }
  }
}

const LOBBY_ARCH_SPRING = 2.16;
const LOBBY_ARCH_RISE = 0.41;
const LOBBY_ARCH_MOTIFS = {
  // The two values returned by inlay are its centre and half-width across the beam face.
  rinse: {
    bays: 4,
    crown: (t) => 0.049 * (1 + Math.cos(2 * TAU * t)),
    inlay: (phase) => [0.55 + 0.16 * Math.sin(TAU * phase), 0.14]
  },
  love: {
    bays: 3,
    crown: (t) => 0.12 * Math.sin(TAU * t) ** 2,
    inlay: (phase) => [0.57, 0.26 * Math.sin(TAU * phase) ** 2]
  },
  fire: {
    bays: 5,
    crown: (t) => 0.12 * (1 - Math.abs(2 * t - 1)),
    inlay: (phase) => [0.25 + 0.5 * (1 - Math.abs(2 * phase - 1)), 0.12]
  },
  day: {
    bays: 5,
    crown: (t, bays) => 0.11 * Math.sin(Math.PI * bays * t) ** 2,
    inlay: (phase) => [0.58, 0.29 * Math.sin(Math.PI * phase) ** 2]
  },
  senior: {
    bays: 4,
    crown: (t) => 0.064 * Math.sin(Math.PI * t),
    inlay: (phase) => [0.38 + 0.24 * phase, 0.25 * Math.sin(Math.PI * phase)]
  }
};

function drawLobbyArch(mesh, point, heading, along, edge, program, seed, assembly) {
  const { box, quad, textureLine } = mesh,
    timber = rgb('#9a7957'),
    lamination = rgb('#785a42'),
    post = edge + 0.06,
    motif = LOBBY_ARCH_MOTIFS[program?.id],
    accent = rgb(program?.color ?? '#9a7957');
  const sample = random(seed),
    bays = (motif?.bays ?? 4) + Math.floor(sample() * 3),
    amplitude = 0.84 + sample() * 0.28;
  for (const side of [-1, 1]) {
    const foot = (y) => point(along, side * post, y),
      shoe = assembly ? 0.08 : 0;
    box(...foot(shoe), 0.17, LOBBY_ARCH_SPRING - shoe, 0.12, heading, timber);
    if (assembly) box(...foot(0), 0.2, shoe - 0.002, 0.12, heading, rgb('#545c55'));
  }
  // Only the outer crown varies. The original clearance curve and posts define the opening.
  function archPoint(t, face, band) {
    const angle = Math.PI * t,
      offset = -0.06 + 0.12 * band,
      profile = motif ? motif.crown(t, bays) * amplitude : 0;
    return point(
      along + face,
      (post + offset) * Math.cos(angle),
      LOBBY_ARCH_SPRING + (LOBBY_ARCH_RISE + offset + band * profile) * Math.sin(angle)
    );
  }
  const section = (t) => [
    archPoint(t, -0.085, 0),
    archPoint(t, -0.085, 1),
    archPoint(t, 0.085, 1),
    archPoint(t, 0.085, 0)
  ];
  const steps = bays * 10;
  for (let i = 0; i < steps; i++) {
    const start = i / steps,
      end = (i + 1) / steps,
      a = section(start),
      b = section(end);
    for (let j = 0; j < a.length; j++) {
      const next = (j + 1) % a.length;
      quad(a[j], b[j], b[next], a[next], timber);
    }
    if (assembly)
      for (const face of [-0.088, 0.088])
        for (const layer of [0.25, 0.78])
          textureLine(archPoint(start, face, layer), archPoint(end, face, layer), lamination);
    if (!motif || i < 2 || i >= steps - 2) continue;
    // Insets are solid surfaces so they also appear in material plans and the vector exports.
    const [centreA, widthA] = motif.inlay((i % 10) / 10),
      [centreB, widthB] = motif.inlay(((i + 1) % 10) / 10);
    if (widthA + widthB < 0.002) continue;
    for (const face of [-0.09, 0.09]) {
      const profile = [
        archPoint(start, face, centreA - widthA),
        archPoint(end, face, centreB - widthB),
        archPoint(end, face, centreB + widthB),
        archPoint(start, face, centreA + widthA)
      ];
      quad(...(face < 0 ? profile : profile.reverse()), accent);
    }
    const stripeA = widthA * 0.22,
      stripeB = widthB * 0.22;
    quad(
      archPoint(start, -stripeA, 1.015),
      archPoint(end, -stripeB, 1.015),
      archPoint(end, stripeB, 1.015),
      archPoint(start, stripeA, 1.015),
      accent
    );
  }
}

function sharedLobbySeed(hub, seed) {
  return seed ^ Math.imul(hub.f + 1, 0x9e3779b1) ^ Math.round(hub.start * 1e5);
}

// Render and the model use the same seeded canopy side and pendant centre.
function lobbyCanopyPattern(hub, seed) {
  const { axis, couchOuter, passage, tableRadius } = hub.layout,
    sample = random(sharedLobbySeed(hub, seed) ^ 0x21bebc31);
  if (!axis || sample() >= 0.46) return null;
  const sign = sample() < 0.5 ? -1 : 1,
    radius = couchOuter + 0.123,
    angle = Math.PI / 2 + 0.005 + 0.012 / (couchOuter + 0.018),
    spread = tableRadius * 0.72,
    center = sharedLobbyPoint(hub, spread * Math.cos(angle), sign * (passage / 2 + spread * Math.sin(angle)), 0);
  return { sign, radius, angle, pitch: Math.acos(spread / radius), rise: 1.35 + sample() * 0.17, center };
}

// A shallow paper ring echoes the central courtyard and the coloured docking bays.
function drawLobbyPendant(mesh, center, anchor) {
  const [x, , z] = center,
    y = anchor - 0.61,
    paper = rgb('#f3e4c4'),
    frame = rgb('#9e774a'),
    profile = [
      [0.115, -0.27], [0.228, -0.22], [0.255, -0.127], [0.227, -0.044], [0.105, 0]
    ],
    divisions = 32;
  const rim = (radius, height, angle) =>
    [x + radius * Math.cos(angle), y + height, z + radius * Math.sin(angle)];
  drawAssemblyMember(mesh, [x, y - 0.007, z], [x, anchor + 0.012, z], 0.014, frame);
  for (let i = 0; i < divisions; i++) {
    const a = i * TAU / divisions, b = (i + 1) * TAU / divisions;
    for (let j = 0; j < profile.length - 1; j++) {
      const [r, h] = profile[j], [R, H] = profile[j + 1];
      mesh.quad(rim(r, h, a), rim(R, H, a), rim(R, H, b), rim(r, h, b),
        i % 2 ? paper : rgb('#ead7b1'));
    }
    mesh.quad(rim(0.055, -0.265, a), rim(0.117, -0.27, a), rim(0.117, -0.27, b),
      rim(0.055, -0.265, b), rgb('#e0b96f'));
    mesh.tri([x, y - 0.237, z], rim(0.055, -0.265, a), rim(0.055, -0.265, b), rgb('#fff0ce'));
    mesh.tri([x, y, z], rim(0.105, 0, b), rim(0.105, 0, a), frame);
    if (i % 2 === 0) {
      const angle = (a + b) / 2, [px, , pz] = rim(0.248, 0, angle);
      const color = rgb(PROGRAMS[(i / 2) % 5].color);
      mesh.box(px, y - 0.158, pz, 0.029, 0.069, 0.028, angle, color);
    }
  }
}

// Scribe seat depths from the actual casework outline to a programme wall.
// Sampling turns irregular leftover pockets into continuous, fitted seat runs.
function lobbyWallBenchRuns(hub, shelfLimit) {
  const { axis, passage, arch, roomWalls, publicEntries = [] } = hub.layout;
  if (!axis) return [];
  const edge = passage / 2,
    walls = roomWalls ?? [-1, 1].map((side) => ({
      side, angle: side < 0 ? hub.start : hub.end, r: hub.r, R: hub.R
    })),
    routes = [...publicEntries, ...(hub.doors ?? [])]
      .filter(({ angle, radius, r, along }) => [angle, radius ?? r, along].every(Number.isFinite))
      .map(({ angle, radius, r, along, width }) => {
        const [x, , z] = sharedLobbyPoint(hub, along, 0, 0);
        return {
          start: [x, z],
          end: [(radius ?? r) * Math.cos(angle), (radius ?? r) * Math.sin(angle)],
          clear: (width ?? passage) / 2 + 0.075
        };
      });
  function distanceToRoute([x, , z], { start, end }) {
    const dx = end[0] - start[0], dz = end[1] - start[1],
      lengthSquared = dx ** 2 + dz ** 2,
      t = lengthSquared ? clamp(((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared, 0, 1) : 0;
    return Math.hypot(x - start[0] - t * dx, z - start[1] - t * dz);
  }
  const runs = [];
  for (const wall of walls) for (const sign of [-1, 1]) {
    const [ox, , oz] = sharedLobbyPoint(hub, 0, sign * edge, 0),
      u = Math.cos(wall.angle), v = Math.sin(wall.angle),
      at = (angle, radius) =>
        sharedLobbyPoint(hub, radius * Math.cos(angle), sign * (edge + radius * Math.sin(angle)), 0);
    function sample(angle) {
      const [x, , z] = at(angle, 1),
        dx = x - ox, dz = z - oz,
        perpendicular = u * dz - v * dx;
      if (Math.abs(perpendicular) < 0.02) return null;
      const wallDepth = (v * ox - u * oz) / perpendicular,
        wallRadius = (ox + wallDepth * dx) * u + (oz + wallDepth * dz) * v,
        inner = shelfLimit(sign, angle) + 0.004,
        outer = wallDepth - 0.067 / Math.abs(perpendicular);
      const sin = Math.sin(angle), cos = Math.cos(angle);
      if (wallRadius < wall.r + 0.045 || wallRadius > wall.R - 0.045 ||
          outer - inner < 0.33 || inner * sin < 0.32) return null;
      // Intersect the radial seat slice with the planter's actual rectangular
      // footprint and a small shadow gap, both in the furniture frame.
      const potStart = (arch - 0.26) / Math.abs(cos),
        potEnd = (arch + 0.26) / Math.abs(cos);
      if (Math.max(inner, potStart, (0.42 - 0.255) / sin) <
          Math.min(outer, potEnd, (0.42 + 0.255) / sin)) return null;
      for (let i = 0; i <= 8; i++) {
        const point = at(angle, inner + (outer - inner) * i / 8);
        if (!sharedLobbyContains(hub, point[0], point[2], 0.009) ||
            routes.some((route) => distanceToRoute(point, route) < route.clear)) return null;
      }
      return { angle, inner, outer };
    }
    let strip = [], widest = [];
    // Scan toward the back of the casework so each corner picks its largest clear seat.
    for (let i = 0; i <= 70; i++) {
      const corner = 0.075 + i * 0.017,
        ray = sample(wall.side > 0 ? corner : Math.PI - corner);
      if (ray) {
        strip.push(ray);
        if (strip.length > widest.length) widest = strip;
      } else strip = [];
    }
    if (widest.length < 2) continue;
    const first = widest[0], last = widest.at(-1);
    const mid = ({ angle, inner, outer }) => at(angle, (inner + outer) / 2);
    if (Math.hypot(...sub(mid(first), mid(last))) < 0.42) continue;
    if (first.angle > last.angle) widest.reverse();
    runs.push({ sign, slices: widest });
  }
  return runs;
}

// Split the circular furniture into two halves around the clear strip used by the occupancy graph.
function drawSharedLobby(mesh, hub, y, seed = 0, assembly = false) {
  const { mark, box, quad, tri, textureLine } = mesh,
    { axis, passage, tableRadius, couchInner, couchOuter, shelfOuter, arch } = hub.layout,
    heading = axis ? Math.atan2(-axis[0], axis[1]) : hub.layout.heading,
    edge = passage / 2,
    timber = rgb('#b18a64'),
    cushion = rgb('#5e8c80'),
    back = rgb('#3f655d'),
    base = rgb('#374b43'),
    tabletop = rgb('#d9ba91'),
    lobbySeed = sharedLobbySeed(hub, seed),
    cabinetRandom = random(lobbySeed ^ 0x546b2829),
    contentsRandom = random(lobbySeed ^ 0x3c6ef372);
  const point = (along, across, up) => sharedLobbyPoint(hub, along, across, y + up);
  const curved = (sign, radius, angle, up) =>
    point(radius * Math.cos(angle), sign * (edge + radius * Math.sin(angle)), up);
  function strip(sign, inner, outer, bottom, height, color, start = 0, end = Math.PI, bevel = 0) {
    const steps = Math.max(1, Math.ceil((end - start) / 0.105)),
      top = bottom + height;
    const profile = (angle) => {
      const outside = typeof outer === 'function' ? outer(angle) : outer,
        inside = typeof inner === 'function' ? inner(angle) : inner;
      return bevel
        ? [
            [inside + bevel, bottom],
            [outside - bevel, bottom],
            [outside, bottom + bevel],
            [outside, top - bevel],
            [outside - bevel, top],
            [inside + bevel, top],
            [inside, top - bevel],
            [inside, bottom + bevel]
          ]
        : [
            [inside, bottom],
            [outside, bottom],
            [outside, top],
            [inside, top]
          ];
    };
    // Reflection reverses the winding. Keep the mirrored faces outward in both renderers.
    const face = (a, b, c, d) => (sign > 0 ? quad(a, b, c, d, color) : quad(d, c, b, a, color));
    for (let i = 0; i < steps; i++) {
      const a = start + ((end - start) * i) / steps,
        b = start + ((end - start) * (i + 1)) / steps,
        first = profile(a),
        last = profile(b);
      for (let j = 0; j < first.length; j++) {
        const next = (j + 1) % first.length,
          divisions = Math.max(
            1,
            Math.ceil(
              Math.max(
                Math.abs(first[next][0] - first[j][0]),
                Math.abs(last[next][0] - last[j][0])
              ) / 0.24
            )
          );
        const at = (angle, edge, t) =>
          curved(
            sign,
            edge[j][0] + (edge[next][0] - edge[j][0]) * t,
            angle,
            edge[j][1] + (edge[next][1] - edge[j][1]) * t
          );
        for (let k = 0; k < divisions; k++)
          face(
            at(b, last, k / divisions),
            at(b, last, (k + 1) / divisions),
            at(a, first, (k + 1) / divisions),
            at(a, first, k / divisions)
          );
      }
    }
    for (const [angle, reverse] of [
      [start, sign < 0],
      [end, sign > 0]
    ]) {
      const cap = profile(angle).map(([r, h]) => curved(sign, r, angle, h));
      for (let i = 1; i < cap.length - 1; i++) {
        if (reverse) tri(cap[0], cap[i + 1], cap[i], color);
        else tri(cap[0], cap[i], cap[i + 1], color);
      }
    }
  }
  function block(along, across, up, width, height, depth, color, angle = heading) {
    box(...point(along, across, up), width, height, depth, angle, color);
  }
  function surfaceDetail(sign, radius, height, start, end, color) {
    const steps = Math.max(1, Math.ceil((end - start) / 0.105));
    for (let i = 0; i < steps; i++)
      textureLine(
        curved(sign, radius, start + ((end - start) * i) / steps, height),
        curved(sign, radius, start + ((end - start) * (i + 1)) / steps, height),
        color
      );
  }
  // A single rug spans the seating and aisle. Solid inlays retain its pattern in vector exports.
  const rugRandom = random(lobbySeed ^ 0x85ebca6b),
    rugPalettes = [
      ['#81648f', '#54405d', '#e2c5a2', '#bc8c95'],
      ['#705879', '#453950', '#dcc3ab', '#ad9ab3'],
      ['#986e83', '#624659', '#eacda5', '#b58a67']
    ],
    [rugField, rugBinding, rugRing, rugAccent] =
      rugPalettes[Math.floor(rugRandom() * rugPalettes.length)].map(rgb),
    dockCount = 8 + Math.floor(rugRandom() * 6),
    docks = Array.from({ length: dockCount }, (_, i) => ({
      angle: ((i + 0.5) * Math.PI) / dockCount,
      halfWidth: ((0.21 + 0.13 * rugRandom()) * Math.PI) / dockCount,
      crossing: i === 1 || i === dockCount - 2,
      contrast: rugRandom() > 0.47
    }));
  function drawRug() {
    const rugRadius = shelfOuter + LOBBY_RUG_MARGIN,
      bottom = 0.005,
      surface = 0.027,
      top = 0.029,
      steps = Math.ceil(Math.PI / 0.085),
      centreTop = point(0, 0, surface),
      centreBottom = point(0, 0, bottom);
    // The rounded ends and straight aisle edges form one closed perimeter.
    const perimeter = [1, -1].flatMap((side) =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const angle = ((side > 0 ? i : steps - i) * Math.PI) / steps;
        return [rugRadius * Math.cos(angle), side * (edge + rugRadius * Math.sin(angle))];
      })
    );
    for (let i = 0; i < perimeter.length; i++) {
      const from = perimeter[i],
        to = perimeter[(i + 1) % perimeter.length],
        aboveA = point(...from, surface),
        aboveB = point(...to, surface),
        belowA = point(...from, bottom),
        belowB = point(...to, bottom);
      tri(centreTop, aboveA, aboveB, rugField);
      tri(centreBottom, belowB, belowA, rugField);
      quad(belowA, belowB, aboveB, aboveA, rugField);
    }
    function arc(sign, inner, outer, color, start = 0, end = Math.PI) {
      const steps = Math.ceil((end - start) / 0.085),
        inlay = sign > 0 ? quad : (a, b, c, d, color) => quad(d, c, b, a, color);
      for (let i = 0; i < steps; i++) {
        const a = start + ((end - start) * i) / steps,
          b = start + ((end - start) * (i + 1)) / steps;
        inlay(
          curved(sign, outer, b, top),
          curved(sign, inner, b, top),
          curved(sign, inner, a, top),
          curved(sign, outer, a, top),
          color
        );
      }
    }
    // Connect the curved rings with straight runs across the aisle.
    for (const [inner, outer, color] of [
      [tableRadius + 0.04, tableRadius + 0.097, rugRing],
      [couchInner - 0.065, couchInner - 0.018, rugBinding],
      [rugRadius - 0.065, rugRadius - 0.021, rugBinding]
    ]) {
      arc(1, inner, outer, color);
      arc(-1, inner, outer, color);
      for (const [a, b] of [
        [-outer, -inner],
        [inner, outer]
      ])
        quad(
          point(a, -edge, top),
          point(b, -edge, top),
          point(b, edge, top),
          point(a, edge, top),
          color
        );
    }
    // Wider tabs at the opposite ends refer to the two entrances through the core.
    for (const sign of [-1, 1])
      for (const dock of docks)
        arc(
          sign,
          dock.crossing ? tableRadius + 0.097 : tableRadius + 0.128,
          dock.crossing ? couchInner - 0.065 : couchInner - 0.093,
          dock.crossing || dock.contrast ? rugRing : rugAccent,
          dock.angle - dock.halfWidth,
          dock.angle + dock.halfWidth
        );
  }
  const shelfInner = couchOuter + 0.018,
    board = 0.038,
    shelfPitch = 0.31,
    bayCount = 8,
    seatTop = 0.52,
    cabinetStile = 0.024 / shelfInner,
    cabinetTop = ({ type, height, extraShelves }) => type === 'seat' ? 0.39 : height + extraShelves * shelfPitch;
  const bookColors = ['#b27765', '#778f82', '#c5a771', '#66778c', '#d8c4ab', '#856b70'].map(rgb);
  const gameColors = ['#bd985d', '#7f9c81', '#9a6a63', '#7b91a4'].map(rgb);
  const pillowColors = ['#e6cb9f', '#ad7462', '#a4b9a8'].map(rgb);
  // Scribe each back to the radial or angular room edge. Keep the ends of the
  // lounge free so the public approaches can turn past the planted arches.
  function shelfLimit(sign, angle) {
    let low = shelfOuter,
      high = shelfOuter + (hub.R - hub.r);
    for (let i = 0; i < 12; i++) {
      const at = (low + high) / 2,
        along = at * Math.cos(angle),
        [x, , z] = point(along, sign * (edge + at * Math.sin(angle)), 0);
      if (Math.abs(along) <= arch - 0.15 && sharedLobbyContains(hub, x, z, 0.025)) low = at;
      else high = at;
    }
    return low;
  }
  const shelves = [-1, 1].map((sign) => {
    const bays = Array.from({ length: bayCount }, (_, i) => {
      const start = (i * Math.PI) / bayCount + 0.005,
        end = ((i + 1) * Math.PI) / bayCount - 0.005,
        outer = (angle) => shelfLimit(sign, angle),
        height = 0.98 + Math.floor(cabinetRandom() * 8) * 0.044,
        type = i % 4 === 1 || cabinetRandom() < 0.22 ? 'cupboard' : 'open';
      return { start, end, outer, height, type, extraShelves: 0 };
    });
    // A leftover shallow end bay becomes an extension of the sofa. The seat
    // turns into the casework without extending into the arch or the doorway.
    for (const i of [0, 7]) {
      const bay = bays[i],
        depth = Math.min(bay.outer(bay.start), bay.outer(bay.end)) - shelfInner;
      if (depth >= 0.21 && (bay.end - bay.start) * shelfInner >= 0.56) {
        bay.type = 'seat';
        bay.nook = true;
      }
    }
    const candidates = [2, 3, 4, 5].filter((i) => {
      const bay = bays[i];
      return Math.min(bay.outer(bay.start), bay.outer(bay.end)) - shelfInner >= 0.34;
    });
    if (candidates.length)
      bays[candidates[Math.floor(cabinetRandom() * candidates.length)]].type = 'seat';
    // Keep the ends low around the arches and vary the taller wall-backed bays.
    const tallBays = [2, 3, 4, 5].filter((i) => bays[i].type !== 'seat');
    const tallest = tallBays.splice(Math.floor(cabinetRandom() * tallBays.length), 1)[0];
    bays[tallest].extraShelves = 3;
    const medium = tallBays[Math.floor(cabinetRandom() * tallBays.length)];
    bays[medium].extraShelves = 1 + Math.floor(cabinetRandom() * 2);
    return bays;
  });
  mark(`Circulation_L${hub.f + 1}_Shared_Rugs`, `Woven lobby rug ${hub.start.toFixed(3)}`);
  drawRug();
  mark(`Circulation_L${hub.f + 1}_Shared_Furniture`, `Shared gathering ${hub.start.toFixed(3)}`);
  for (const sign of [-1, 1]) {
    // A broad half-round table and a regular-depth upholstered seat face each other.
    strip(sign, 0.005, tableRadius, 0.69, 0.075, tabletop);
    block(0, sign * (edge + tableRadius * 0.48), 0.037, 0.29, 0.65, 0.32, base);
    const backInner = couchOuter - 0.25;
    strip(sign, couchInner + 0.04, couchOuter, 0.038, 0.318, base);
    for (let i = 0; i < bayCount; i++) {
      const a = (i * Math.PI) / bayCount,
        b = ((i + 1) * Math.PI) / bayCount,
        seat = shelves[sign < 0 ? 0 : 1][i].type === 'seat';
      // Open seams between the base, seat pads and back cushions keep their faces distinct.
      strip(
        sign,
        couchInner,
        seat ? couchOuter - 0.006 : backInner - 0.014,
        0.36,
        seatTop - 0.36,
        cushion,
        a + 0.009,
        b - 0.009,
        0.044
      );
      if (!seat)
        strip(
          sign,
          backInner,
          couchOuter,
          0.36,
          0.57,
          back,
          a + 0.01,
          b - 0.01,
          0.067
        );
      if (!seat && i % 3 === 1) {
        const mid = (a + b) / 2;
        strip(
          sign,
          backInner - 0.145,
          backInner - 0.008,
          seatTop - 0.012,
          0.31,
          pillowColors[(i + (sign > 0 ? 1 : 0)) % pillowColors.length],
          mid - 0.077,
          mid + 0.077,
          0.054
        );
      }
      if (assembly)
        surfaceDetail(sign, couchInner + 0.055, seatTop + 0.003, a + 0.03, b - 0.03, rgb('#9eafa1'));
    }
  }
  // Use separate seeded variation so contents never change the cabinet or plant layouts.
  // Place objects on the shelf's front band and leave the back free for the fitted wall profile.
  function stockShelf(sign, left, right, y) {
    const angleAt = (fraction) => left + (right - left) * fraction;
    function item(fraction, depth, width, height, base, color) {
      const angle = angleAt(fraction),
        radius = shelfInner + 0.026 + depth / 2;
      block(
        radius * Math.cos(angle),
        sign * (edge + radius * Math.sin(angle)),
        y + base,
        width,
        height,
        depth,
        color,
        heading - sign * (angle - Math.PI / 2)
      );
    }
    const count = 4 + Math.floor(contentsRandom() * 4);
    for (let i = 0; i < count; i++) {
      const position = 0.14 + i * 0.047,
        height = 0.14 + contentsRandom() * 0.10,
        color = bookColors[Math.floor(contentsRandom() * bookColors.length)];
      item(
        position,
        0.1 + contentsRandom() * 0.037,
        0.024 + contentsRandom() * 0.009,
        height,
        0,
        color
      );
    }
    if (contentsRandom() < 0.62) {
      // A smaller lidded box stacked on a broad box reads as a pair of board games.
      const color = gameColors[Math.floor(contentsRandom() * gameColors.length)],
        lid = color.map((component) => component + (1 - component) * 0.18);
      item(0.74, 0.183, 0.243, 0.044, 0, color);
      item(0.74, 0.181, 0.24, 0.011, 0.044, lid);
      item(0.77, 0.165, 0.186, 0.029, 0.055, bookColors[3]);
      item(0.77, 0.163, 0.183, 0.008, 0.084, bookColors[4]);
    } else {
      // A small ceramic pot with an inset lip distinguishes the loose objects from boxes.
      const angle = angleAt(0.75),
        center = curved(sign, shelfInner + 0.11, angle, y),
        pot = rgb('#a87960'),
        mouth = rgb('#795b50');
      const rim = (radius, up, theta) =>
        [center[0] + radius * Math.cos(theta), center[1] + up, center[2] + radius * Math.sin(theta)];
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8,
          b = ((i + 1) * TAU) / 8;
        quad(rim(0.043, 0, a), rim(0.063, 0.082, a), rim(0.063, 0.082, b), rim(0.043, 0, b), pot);
        quad(rim(0.063, 0.082, a), rim(0.048, 0.078, a), rim(0.048, 0.078, b), rim(0.063, 0.082, b), pot);
        tri([center[0], center[1] + 0.052, center[2]], rim(0.048, 0.078, b), rim(0.048, 0.078, a), mouth);
      }
      item(0.89, 0.09, 0.07, 0.09, 0, bookColors[1]);
    }
  }
  const nookSeats = [];
  mark(
    `Circulation_L${hub.f + 1}_Shared_Shelving`,
    `Fitted timber casework ${hub.start.toFixed(3)}`
  );
  for (const [side, bays] of shelves.entries()) {
    const sign = side ? 1 : -1;
    for (const { start, end, outer, height, type, extraShelves, nook } of bays) {
      const low = type === 'seat',
        high = cabinetTop({ type, height, extraShelves }),
        stile = cabinetStile,
        left = start + stile + 0.002,
        right = end - stile - 0.002,
        shelfBoards = low ? [0.08, high - board] : [0.12, 0.47];
      // The original top board becomes the first open shelf when a bay grows taller.
      if (!low)
        for (let shelf = 0; shelf <= extraShelves; shelf++)
          shelfBoards.push(height + shelf * shelfPitch - board);
      strip(sign, shelfInner, outer, 0.038, high - 0.038, timber, start, start + stile);
      strip(sign, shelfInner, outer, 0.038, high - 0.038, timber, end - stile, end);
      for (const baseHeight of shelfBoards) {
        strip(sign, shelfInner, outer, baseHeight, board, timber, left, right);
        if (assembly)
          for (const depth of [0.035, 0.085, 0.15])
            surfaceDetail(
              sign,
              shelfInner + depth,
              baseHeight + board + 0.003,
              left,
              right,
              rgb('#9f7954')
            );
      }
      if (low) {
        // The matching sofa bay omits its back so the seat can be reached from the aisle.
        const seat = () => strip(sign, couchOuter + 0.006, (angle) => outer(angle) - 0.016,
          high + 0.003, seatTop - high - 0.003, cushion, left, right, 0.036);
        if (nook) nookSeats.push(seat);
        else seat();
        continue;
      }
      if (type === 'cupboard') {
        const door = rgb('#9e7956'),
          handle = rgb('#605e54');
        strip(sign, shelfInner + 0.004, shelfInner + 0.03, 0.163, height - 0.215, door, left, right);
        const mid = right - 0.038,
          radius = shelfInner - 0.012;
        block(
          radius * Math.cos(mid),
          sign * (edge + radius * Math.sin(mid)),
          height - 0.17,
          0.09,
          0.026,
          0.027,
          handle,
          heading - sign * (mid - Math.PI / 2)
        );
      }
      const openBoards = type === 'cupboard' ? shelfBoards.slice(2) : shelfBoards;
      for (const shelf of openBoards) stockShelf(sign, left, right, shelf + board + 0.003);
    }
  }
  if (nookSeats.length) {
    mark(`Circulation_L${hub.f + 1}_Shared_Nook_Benches`, `Casework benches ${hub.start.toFixed(3)}`);
    for (const drawSeat of nookSeats) drawSeat();
  }
  for (const [i, along] of [-arch, arch].entries()) {
    // Each programme owns the arch at the end where its room door meets the lobby.
    const door = hub.doors?.find((door) => Math.sign(door.along) === Math.sign(along)),
      programIndex = door?.program ?? hub.pair?.[i],
      program = PROGRAMS[programIndex],
      seed = lobbySeed ^ Math.imul((programIndex ?? 0) + 1, 0x7f4a7c15);
    mark(
      `Circulation_L${hub.f + 1}_Shared_Thresholds`,
      `${program?.name ?? 'Shared lobby'} arch ${hub.start.toFixed(3)}`
    );
    drawLobbyArch(mesh, point, heading, along, edge, program, seed, assembly);
  }
  // The cabinet shoulder and the room wall define the full depth of each built-in seat.
  for (const { sign, slices } of lobbyWallBenchRuns(hub, shelfLimit)) {
    const first = slices[0].angle, last = slices.at(-1).angle;
    const edgeAt = (angle, edge) => {
      const index = clamp((slices.length - 1) * (angle - first) / (last - first), 0, slices.length - 1),
        a = slices[Math.floor(index)][edge], b = slices[Math.ceil(index)][edge];
      return a + (b - a) * (index % 1);
    };
    mark(`Circulation_L${hub.f + 1}_Shared_Nook_Benches`, `Wall-scribed bench ${hub.start.toFixed(3)}`);
    strip(sign, (angle) => edgeAt(angle, 'inner'), (angle) => edgeAt(angle, 'outer'),
      0.025, 0.375, timber, first, last);
    strip(sign, (angle) => edgeAt(angle, 'inner') + 0.02, (angle) => edgeAt(angle, 'outer') - 0.014,
      0.40, 0.105, cushion, first + 0.009, last - 0.009, 0.025);
  }

  // A quarter dome springs from the semicircular cabinet backs. Each upright
  // extends an actual cabinet stile, including the low reading-seat bays.
  const canopy = lobbyCanopyPattern(hub, seed);
  if (canopy) {
    const { sign, radius } = canopy,
      bays = shelves[sign < 0 ? 0 : 1],
      spring = Math.max(2.13, ...bays.map((bay) => cabinetTop(bay) + 0.06)),
      rise = Math.min(3.64 - spring, canopy.rise),
      ribs = [
        ...bays.map((bay) => ({ bay, angle: bay.start + cabinetStile / 2 })),
        { bay: bays.at(-1), angle: bays.at(-1).end - cabinetStile / 2 }
      ],
      first = ribs[0].angle,
      last = ribs.at(-1).angle,
      wood = rgb('#ab805b'),
      at = (angle, pitch) => curved(sign, radius * Math.cos(pitch), angle, spring + rise * Math.sin(pitch)),
      batten = (a, b, width) => drawAssemblyMember(mesh, a, b, width, wood);
    mark(`Circulation_L${hub.f + 1}_Shared_Lattice_Canopy`, `Timber quarter dome ${hub.start.toFixed(3)}`);
    for (const [index, { angle, bay }] of ribs.entries()) {
      const edgeRib = index === 0 || index === ribs.length - 1,
        gauge = edgeRib ? 0.078 : 0.051;
      batten(curved(sign, radius, angle, cabinetTop(bay) - 0.02), at(angle, 0), edgeRib ? 0.032 : 0.042);
      for (let j = 0; j < 12; j++)
        batten(at(angle, j * Math.PI / 24), at(angle, (j + 1) * Math.PI / 24), gauge);
    }
    // Three thin battens fill each principal rib bay. They stop at the crown
    // rings, avoiding a clump of timber where the principal ribs converge.
    for (let i = 1; i < ribs.length; i++) {
      for (const fraction of [0.25, 0.5, 0.75]) {
        const angle = ribs[i - 1].angle + (ribs[i].angle - ribs[i - 1].angle) * fraction;
        for (let j = 0; j < 9; j++)
          batten(at(angle, j * 1.28 / 9), at(angle, (j + 1) * 1.28 / 9), 0.021);
      }
    }
    const ringAngle = (i) => first + (last - first) * i / 32;
    for (const pitch of [0, 0.13, 0.26, 0.39, 0.52, 0.65, 0.78, 0.91, 1.04, 1.16, 1.28, 1.4])
      for (let i = 0; i < 32; i++)
        batten(at(ringAngle(i), pitch), at(ringAngle(i + 1), pitch), pitch === 0 ? 0.088 : 0.022);
    // Two intermediate uprights pick up the springing rail between the main
    // ribs. Use the flanking full-height cabinet bays to keep reading seats open.
    const flankingBays = [
      bays.slice(1, bayCount / 2).find((bay) => bay.type !== 'seat'),
      bays.slice(bayCount / 2, -1).findLast((bay) => bay.type !== 'seat')
    ];
    mark(`Circulation_L${hub.f + 1}_Shared_Lattice_Intermediate_Supports`, `Casework uprights ${hub.start.toFixed(3)}`);
    for (const bay of flankingBays) {
      if (!bay) continue;
      const angle = (bay.start + bay.end) / 2;
      batten(curved(sign, radius, angle, cabinetTop(bay) - 0.012), at(angle, 0), 0.044);
    }
    mark(`Circulation_L${hub.f + 1}_Shared_Paper_Pendant`, `Poly Nation paper lantern ${hub.start.toFixed(3)}`);
    drawLobbyPendant(mesh, canopy.center, at(canopy.angle, canopy.pitch)[1]);
  }
  // Use a local random sequence so the same lobby keeps its plants in every workspace.
  const sample = random(lobbySeed);
  mark(`Circulation_L${hub.f + 1}_Shared_Planting`, `Lobby plants ${hub.start.toFixed(3)}`);
  for (const along of [-arch, arch]) {
    for (const side of [-1, 1]) {
      const across = side * (edge + 0.42);
      block(along, across, 0.015, 0.45, 0.32, 0.44, rgb('#986f59'));
      drawLobbyPlant(mesh, point, along, across, LOBBY_ARCH_SPRING + LOBBY_ARCH_RISE, sample);
    }
  }
}

// Translate the derived plan into drawing geometry. Export uses the full model regardless of current cutaway.
function buildMesh(m, exporting = false, view = state, preview = null) {
  const b = meshBuilder(),
    { solid, lines, glass, quad, tri, line, sector, box, ringPoint, mark, groups } = b;
  const coreStructure = preview && materialValues(preview.assignments, 'core').structure;
  const slab = rgb(coreStructure ? STRUCTURAL_SYSTEMS[coreStructure].color : '#d8dcd4'),
    edge = rgb('#a3aea3'),
    ground = rgb('#e4e8df');
  const { glassGuard, curvedGlassGuard } = glassGuards(b);
  const floorH = modelFloorPitch(m),
    slabThickness = m.slabThickness ?? BUILD_SECTION.slabThickness,
    H = view.floors * floorH;
  const extent = Math.max(m.R + MODULE.depth + 8, m.plaza ? m.plaza.outer + 2 : 0, m.crane?.extent ?? 0),
    plane = Math.max(170, extent * 2.6);
  mark('Reference');
  drawCraneGround(b, plane, ground, -0.22, m.crane);
  if (view.grid) {
    let gridCol = rgb('#d3d9ce');
    for (let i = -Math.ceil(extent / 10) * 10; i <= extent + 10; i += 10) {
      line([i, -0.19, -extent - 10], [i, -0.19, extent + 10], gridCol);
      line([-extent - 10, -0.19, i], [extent + 10, -0.19, i], gridCol);
    }
  }
  mark('Core_Foundation');
  sector(0, m.R + 0.25, 0, TAU, 0, Math.min(0.18, buildStorey(m, 0).underside), slab);
  mark('Infinite_Rinse_Greenhouse');
  const greenhouseLevel = m.greenhouse ? 0.46 : 0.3;
  sector(0, m.r, 0, TAU, 0.19, greenhouseLevel - 0.19, rgb('#c8d7c2'));
  // Symbolic biofiltration beds and paths, all within the central courtyard.
  const rr = m.r;
  if (m.greenhouse) {
    drawGreenhouseGround(b, m, 0.535);
  } else {
    // Preserve the original bed layout for saved studies and layouts without lobby atriums.
    const num = Math.max(2, Math.min(6, Math.floor(rr / 5))),
      bedWidth = Math.min(3.6, rr / (num + 1));
    for (let i = 0; i < num; i++) {
      const x = (i - (num - 1) / 2) * (bedWidth + 1.2),
        zmax = Math.sqrt(Math.max(0, (rr - 1.5) ** 2 - (Math.abs(x) + bedWidth / 2) ** 2));
      if (zmax < 1) continue;
      for (const side of [-1, 1]) {
        const depth = Math.max(0.8, zmax - 0.85);
        box(
          x,
          0.3,
          side * (depth / 2 + 0.85),
          bedWidth,
          0.26,
          depth,
          -Math.PI / 2,
          rgb(i % 2 ? '#8fb8a8' : '#91b6c4')
        );
      }
    }
    if (rr > 3) box(0, 0.32, 0, 1.6, 0.07, rr * 1.8, 0, rgb('#efeee3'));
  }
  // Permanent ring: independent variable-size rooms, with diagrammatic seams.
  const visible = (f) => exporting || !view.inspect || f < view.inspect;
  const cut = !exporting && view.inspect > 0,
    cutY = cut ? buildStorey(m, view.inspect - 1).soffit : Infinity;
  const craneVisible = Boolean(m.crane && (exporting || (!cut && view.showRoofDeck && !view.programEditing))),
    cranePose = craneVisible ? moduleCranePose(m, m.crane, exporting ? {} : view) : null;
  for (let f = 0; f < view.floors; f++) {
    if (!visible(f)) continue;
    const y = f * floorH + 0.22;
    mark(`Core_L${f + 1}_Slab`);
    const l = m.lobby;
    const { underside } = buildStorey(m, f);
    for (const [a, z] of openArcs(f ? lobbyHoles(l, f) : []))
      sector(m.r - 0.08, m.R + 0.12, a, z, underside, slabThickness, slab);
    for (const room of m.rooms) {
      if (room.f !== f || (!exporting && !view.showRooms)) continue;
      mark(
        `Core_L${f + 1}_${P[room.id].id}`,
        `Room_${f + 1}_${room.band}_${room.start.toFixed(3)}`,
        view.programEditing ? { room } : null
      );
      const c = rgb(
          preview && !preview.programColors
            ? STRUCTURAL_SYSTEMS[materialValues(preview.assignments, 'core', room.id).structure]
                .color
            : P[room.id].color
        ),
        gap = Math.min(0.15 / ((room.r + room.R) / 2), (room.end - room.start) * 0.16),
        radialGap = m.bandN === 2 ? 0.13 : 0;
      const ra = room.r + (room.facadeFacing ? 0 : radialGap),
        rb = Math.min(
          room.R - (room.facadeFacing ? 0 : radialGap),
          m.R - facadeThickness(m) - 0.035
        ),
        flat = !exporting && view.xray,
        h = flat ? 0.13 : BUILD_SECTION.floorHeight - 0.31,
        surface = flat ? ROOM_FLOOR_FINISH.map((part, i) => part + (c[i] - part) * 0.56) : c;
      if (rb <= ra + 0.001) continue;
      let portal = null;
      if (room.slideLanding && !flat && m.feature.slide) {
        const a = (room.start + room.end) / 2,
          d = Math.min((room.end - room.start) * 0.34, 1.35 / rb),
          yy = f === m.feature.slide.startFloor ? m.feature.slide.topY : m.feature.slide.bottomY;
        portal = { a: a - d, b: a + d, lo: yy - 1.25, hi: yy + 1.25 };
      }
      sector(
        ra,
        rb,
        room.start + gap,
        room.end - gap,
        y + 0.25,
        h,
        surface,
        portal,
        !exporting && !view.inspect && view.showRoofDeck && !view.xray && f === view.floors - 1
      );
      if (flat)
        drawInteriorFloorPattern(
          b,
          {
            r: ra,
            R: rb,
            start: room.start + gap,
            end: room.end - gap
          },
          y + 0.25 + h,
          surface,
          false,
          room
        );
      if (portal) {
        const frame = rgb('#287fa7'),
          a = portal.a,
          b = portal.b,
          lo = Math.max(y + 0.25, portal.lo),
          hi = Math.min(y + 0.25 + h, portal.hi);
        for (const u of [a, b])
          line(ringPoint(rb + 0.025, u, lo), ringPoint(rb + 0.025, u, hi), frame);
        line(ringPoint(rb + 0.025, a, hi), ringPoint(rb + 0.025, b, hi), frame);
      }
      const seam = c.map((x) => x * 0.48),
        top = y + 0.25 + h;
      line(ringPoint(ra, room.start + gap, top), ringPoint(rb, room.start + gap, top), seam);
      line(ringPoint(rb, room.start + gap, y + 0.25), ringPoint(rb, room.start + gap, top), seam);
    }
  }
  // Circulation uses cut-out spaces between the rooms, visible in plan and section.
  const circulation = m.circulation;
  for (const q of [...circulation.regions, ...circulation.hubs]) {
    if (!visible(q.f)) continue;
    if (q.kind === 'lobbyDivider') {
      const { base, soffit } = buildStorey(m, q.f);
      mark(`Circulation_L${q.f + 1}_Shared_Lobby_Divider`);
      sector(q.r, q.R, q.start, q.end, base, !exporting && view.xray ? 0.2 : soffit - base, rgb('#a89e8e'));
      continue;
    }
    const y = q.f * floorH + 0.46,
      kind = q.kind,
      isLift = kind === 'elevator',
      isHub = kind === 'hub',
      color = isLift ? rgb('#777a91') : isHub ? rgb('#80509e') : CIRCULATION_FLOOR_FINISH;
    mark(
      `Circulation_L${q.f + 1}_${isLift ? 'Lift_' + (q.block + 1) : isHub ? 'Shared_' + P[q.pair[0]].id + '_' + P[q.pair[1]].id : kind}`,
      `${kind}_${q.f + 1}_${q.start.toFixed(3)}`
    );
    if (isHub && q.layout) drawSharedLobbyFloor(b, q, y + 0.075);
    else sector(q.r, q.R, q.start, q.end, y, isLift ? floorH - 0.18 : 0.075, color);
    if (!isHub && !isLift) drawInteriorFloorPattern(b, q, y + 0.075, color, true);
    if (isLift) {
      const a = q.end,
        rad = (q.r + q.R) / 2,
        door = Math.min(1.25, (q.R - q.r) * 0.55);
      if (door > 0.1) {
        const dc = rgb('#d3d8e3'),
          v0 = ringPoint(rad - door / 2, a + 0.0008, y + 0.08),
          v1 = ringPoint(rad + door / 2, a + 0.0008, y + 0.08);
        quad(v0, v1, [v1[0], y + 2.25, v1[2]], [v0[0], y + 2.25, v0[2]], dc);
      }
    } else {
      if (isHub && q.layout) {
        drawSharedLobby(b, q, y + 0.075, view.seed);
        const { base, soffit } = buildStorey(m, q.f);
        drawSharedLobbyScreens(b, q, base, !exporting && view.xray ? 0.2 : soffit - base, rgb('#a89e8e'));
      }
      else if (isHub) drawSavedSharedLobby(b, q, y);
      const col = rgb(isHub ? '#5e3c77' : '#bfc3b9');
      for (const radius of [q.r, q.R]) {
        const n = Math.max(1, Math.ceil((q.end - q.start) / 0.09));
        for (let i = 0; i < n; i++)
          line(
            ringPoint(radius, q.start + ((q.end - q.start) * i) / n, y + 0.087),
            ringPoint(radius, q.start + ((q.end - q.start) * (i + 1)) / n, y + 0.087),
            col
          );
      }
    }
  }
  for (const lounge of bridgeLounges(m))
    if (visible(lounge.f)) drawBridgeLounge(b, lounge, lounge.f * floorH + 0.535);
  // Upper bridges span the atrium, with open landings into dedicated core passages.
  for (const bridge of circulation.bridges ?? []) {
    if (!visible(bridge.f)) continue;
    const top = bridge.f * floorH + 0.535;
    mark(`Atrium_Bridge_L${bridge.f + 1}`);
    drawAtriumBridge(b, rr, bridge, top, rgb('#d9bb87'));
    mark(`Atrium_Bridge_Bearing_L${bridge.f + 1}`);
    drawAtriumBridgeBearing(b, rr, bridge, top, rgb('#69796d'));
  }
  for (const stair of circulation.stairs ?? []) {
    if (!visible(stair.f) || !visible(stair.f - 1)) continue;
    mark(`Atrium_Stair_L${stair.f + 1}`, `Bridge stair to level ${stair.f}`);
    drawAtriumStair(b, rr, stair, stair.f * floorH + 0.535,
      (stair.f - 1) * floorH + 0.535, rgb('#d9bb87'));
  }
  for (let floor = 1; floor < view.floors; floor++) {
    if (!visible(floor)) continue;
    const y = floor * floorH + 0.535;
    mark(`Atrium_Edge_Railings_L${floor + 1}`);
    for (const [start, end] of atriumGuardSpans(m, floor)) curvedGlassGuard(rr, y, start, end);
  }
  // Separate room thresholds and paired shared doors: diagrammatic lines, not detailed door openings.
  for (const d of circulation.doors) {
    if (!visible(d.f)) continue;
    const y = d.f * floorH + 0.56,
      co = rgb(d.kind === 'shared' ? '#5d805f' : '#66786f');
    mark(`Circulation_L${d.f + 1}_Doors`);
    if (d.kind === 'shared') {
      const w = (d.width ?? 1.1) / 2;
      line(ringPoint(Math.max(0, d.r - w), d.angle, y), ringPoint(d.r + w, d.angle, y), co);
    } else {
      const w = (d.width || 1.2) / 2 / Math.max(1, d.r);
      line(ringPoint(d.r, d.angle - w, y), ringPoint(d.r, d.angle + w, y), co);
    }
  }
  // Accessible connection from the dock frame to the outer corridor; each occupied slot has a discrete threshold.
  for (const s of m.slots) {
    if (!visible(s.f) || s.blocked || (s.p === EMPTY && s.use === 'empty')) continue;
    if (!exporting && !view.showModules) continue;
    mark(`Circulation_L${s.f + 1}_Dock_Thresholds`, `Dock_${s.j}`);
    const a = s.angle,
      rad = m.R + 0.325;
    box(
      rad * Math.cos(a),
      s.f * floorH + 0.46,
      rad * Math.sin(a),
      Math.min(2.0, MODULE.width),
      0.08,
      0.7,
      a,
      rgb('#eee9da')
    );
  }
  // Each lobby atrium opens toward the plaza and the greenhouse, with no intermediate floor.
  const l = m.lobby;
  for (const [i, { angle, span }] of lobbyBays(l).entries()) {
    const a = angle - span / 2,
      z = angle + span / 2,
      base = 0.45,
      top = Math.min(buildStorey(m, l.levels - 1).soffit, cutY),
      sideBase = m.greenhouse ? base + 2.35 : base,
      frame = rgb('#ac9271'),
      glaze = rgb('#c7dbd9');
    mark(i ? 'Opposite_Lobby_Atrium' : 'Entrance_Lobby');
    sector(m.r, m.R, a, z, base, 0.08, rgb('#e5d3ae'));
    if (l.gallery && visible(1)) {
      mark('Lobby_Atrium_Upper_Gallery', 'Level 2 corridor bridge');
      sector(l.gallery, m.R + 0.12, a, z, buildStorey(m, 1).underside, slabThickness, slab);
      for (const radius of [l.gallery, m.R]) {
        const n = Math.max(1, Math.ceil((z - a) / 0.055));
        for (let j = 0; j < n; j++) {
          const left = a + ((z - a) * j) / n,
            right = a + ((z - a) * (j + 1)) / n,
            railBase = floorH + 0.53,
            railTop = railBase + 1.1;
          quad(
            ringPoint(radius, left, railBase),
            ringPoint(radius, right, railBase),
            ringPoint(radius, right, railTop),
            ringPoint(radius, left, railTop),
            glaze,
            glass,
            0.35
          );
          line(ringPoint(radius, left, railTop), ringPoint(radius, right, railTop), frame);
        }
      }
      mark(i ? 'Opposite_Lobby_Atrium' : 'Entrance_Lobby');
    }
    if (!cut || view.inspect > l.levels) sector(m.r, m.R, a, z, top - 0.2, 0.2, rgb('#e5d3ae'));
    for (const k of [a, z]) {
      quad(
        ringPoint(m.r, k, sideBase),
        ringPoint(m.R, k, sideBase),
        ringPoint(m.R, k, top - 0.2),
        ringPoint(m.r, k, top - 0.2),
        glaze,
        glass,
        0.3
      );
      line(ringPoint(m.R, k, sideBase), ringPoint(m.R, k, top - 0.2), frame);
    }
    const portal = Math.min(span * 0.32, 2.8 / m.R);
    for (const [x1, x2] of [
      [a, angle - portal],
      [angle + portal, z]
    ])
      if (x2 > x1) {
        const n = Math.max(1, Math.ceil((x2 - x1) / 0.07));
        for (let j = 0; j < n; j++) {
          const u = x1 + ((x2 - x1) * j) / n,
            v = x1 + ((x2 - x1) * (j + 1)) / n;
          quad(
            ringPoint(m.R, u, base),
            ringPoint(m.R, v, base),
            ringPoint(m.R, v, top - 0.2),
            ringPoint(m.R, u, top - 0.2),
            glaze,
            glass,
            0.32
          );
          line(ringPoint(m.R, u, base), ringPoint(m.R, u, top - 0.2), frame);
        }
      }
  }
  // Outdoor forecourt — the approach stays within the reserved entrance wedge, then
  // widens beyond the module tips. Furniture never occupies the primary entry axis.
  if (m.plaza) {
    const p = m.plaza,
      a = p.angle,
      lo = a - p.span / 2,
      hi = a + p.span / 2,
      walk = rgb('#e5d3ae'),
      paving = rgb('#ddd8cc'),
      border = rgb('#c0b6a3'),
      seat = rgb('#b69b75');
    for (const [i, { angle, span }] of lobbyBays(l).entries()) {
      mark(i ? 'Opposite_Lobby_Plaza_Paving' : 'Entrance_Plaza_Paving', 'Lobby approach');
      sector(p.inner, p.mouth, angle - span / 2, angle + span / 2, 0.01, 0.17, walk);
    }
    mark('Public_Plaza_Paving', 'Continuous exterior plaza');
    sector(p.mouth, p.outer, 0, TAU, 0.01, 0.17, paving);
    mark('Public_Plaza_Promenade', 'Continuous clear pedestrian loop');
    sector(p.walkRadius - 2, p.walkRadius + 2, 0, TAU, 0.182, 0.015, walk);
    if (m.feature.climbing) {
      const c = m.feature.climbing;
      mark('Public_Plaza_Climbing_Approach');
      sector(c.face, p.mouth, c.angle - c.half, c.angle + c.half, 0.01, 0.17, walk);
    }
    const pathHalf = Math.min(p.approachSpan / 2, p.span * 0.19, 3.2 / p.mouth);
    mark('Entrance_Plaza_Promenade', 'Clear central pedestrian axis');
    sector(p.mouth, p.outer, a - pathHalf, a + pathHalf, 0.182, 0.015, walk);
    const rear = lobbyBays(l)[1];
    if (rear) {
      mark('Opposite_Lobby_Promenade', 'Connection to the atrium crossing');
      sector(p.mouth, p.outer, rear.angle - pathHalf, rear.angle + pathHalf, 0.182, 0.015, walk);
    }
    mark('Entrance_Plaza_Paving', 'Paving joints and perimeter');
    for (let i = 0; i <= 5; i++) {
      const r = p.mouth + ((p.outer - p.mouth) * i) / 5;
      for (let j = 0; j < 40; j++)
        line(
          ringPoint(r, lo + ((hi - lo) * j) / 40, 0.201),
          ringPoint(r, lo + ((hi - lo) * (j + 1)) / 40, 0.201),
          border
        );
    }
    for (const k of [lo, hi, a - pathHalf, a + pathHalf])
      line(ringPoint(p.mouth, k, 0.201), ringPoint(p.outer, k, 0.201), border);
    function at(rad, theta, y, w, h, d, col, outline = true) {
      box(rad * Math.cos(theta), y, rad * Math.sin(theta), w, h, d, theta, col, outline);
    }
    // Two planted gathering zones framing a broad unobstructed entrance promenade.
    if (l.area)
      for (const sign of [-1, 1]) {
        const theta = a + sign * p.span * 0.33;
        for (let j = 0; j < 2; j++) {
          const rad = p.mouth + 3.4 + 8.0 * j;
          mark('Entrance_Plaza_Planters', `Planter_${sign}_${j}`);
          at(rad, theta, 0.2, 3.4, 0.44, 3.6, rgb('#9a9f90'));
          mark('Entrance_Plaza_Planting', `Planting_${sign}_${j}`);
          at(rad, theta, 0.65, 3.05, 0.1, 3.23, rgb('#83a86f'));
          const cx = rad * Math.cos(theta),
            cz = rad * Math.sin(theta);
          mark('Entrance_Plaza_Tree_Trunks', `Trunk_${sign}_${j}`);
          box(cx, 0.73, cz, 0.22, 3.4, 0.22, 0, rgb('#927758'));
          mark('Entrance_Plaza_Tree_Canopies', `Canopy_${sign}_${j}`);
          const N = 9,
            canopy = rgb(j % 2 ? '#84a678' : '#75996e');
          for (let k = 0; k < N; k++) {
            const u = (k * TAU) / N,
              v = ((k + 1) * TAU) / N;
            const pt = (t, r, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
            tri([cx, 2.7, cz], pt(u, 1.65, 4.15), pt(v, 1.65, 4.15), canopy);
            tri(pt(u, 1.65, 4.15), [cx, 5.55, cz], pt(v, 1.65, 4.15), canopy);
          }
          mark('Entrance_Plaza_Seating', `Bench_${sign}_${j}`);
          const benchTheta = theta - (sign * 2.15) / rad;
          at(rad, benchTheta, 0.2, 0.42, 0.43, 2.8, rgb('#777d72'));
          mark('Entrance_Plaza_Seating_Tops', `Bench_top_${sign}_${j}`);
          at(rad, benchTheta, 0.63, 0.82, 0.14, 3.05, seat);
        }
        // Small communal table with stools, between the planted islands.
        const rad = p.mouth + 7.4;
        mark('Entrance_Plaza_Seating', `Gathering_table_${sign}`);
        at(rad, theta, 0.2, 0.25, 0.78, 0.25, rgb('#777d72'));
        at(rad, theta, 0.98, 1.35, 0.12, 1.55, seat);
        for (const off of [-1.3, 1.3]) at(rad + off, theta, 0.2, 0.64, 0.45, 0.64, seat);
      }
    // Low-poly activity islands, beyond the uninterrupted promenade.
    for (const [i, q] of p.zones.entries()) {
      const a = q.angle,
        cx = q.r * Math.cos(a),
        cz = q.r * Math.sin(a),
        w = q.width,
        T = [-Math.sin(a), Math.cos(a)],
        D = [Math.cos(a), Math.sin(a)],
        B = (u, v, y, W, H, L, col, outline = false) =>
          box(cx + u * T[0] + v * D[0], y, cz + u * T[1] + v * D[1], W, H, L, a, rgb(col), outline),
        pt = (u, v, y) => [cx + u * T[0] + v * D[0], y, cz + u * T[1] + v * D[1]],
        LN = (u, v, U, V, y, col) => line(pt(u, v, y), pt(U, V, y), rgb(col));
      const theme = P[q.program].color;
      mark('Public_Plaza_' + q.kind, `${q.kind} / ${P[q.program].name} ${i + 1}`);
      if (q.kind === 'volleyball' || q.kind === 'pickleball') {
        const volley = q.kind === 'volleyball',
          W = volley ? Math.min(16, w - 0.5) : 13.4,
          L = volley ? 8 : 6.1,
          C = volley ? '#d8bf91' : '#769b8c';
        B(0, 0, 0.19, W + 0.65, 0.055, L + 0.65, C);
        const h = 0.25,
          white = '#f7f4e9';
        for (const u of [-W / 2, W / 2]) LN(u, -L / 2, u, L / 2, h, white);
        for (const v of [-L / 2, L / 2]) LN(-W / 2, v, W / 2, v, h, white);
        LN(0, -L / 2, 0, L / 2, h, white);
        if (!volley) {
          for (const u of [-2.13, 2.13]) LN(u, -L / 2, u, L / 2, h, white);
          for (const side of [-1, 1]) LN(side * 2.13, 0, (side * W) / 2, 0, h, white);
        }
        const netH = volley ? 2.43 : 0.86;
        for (const v of [-L / 2 - 0.18, L / 2 + 0.18])
          B(0, v, 0.24, 0.08, netH + 0.18, 0.08, '#6a7770');
        for (let k = 0; k <= 8; k++)
          line(
            pt(0, -L / 2 + (L * k) / 8, 0.24),
            pt(0, -L / 2 + (L * k) / 8, 0.24 + netH),
            rgb('#73837a')
          );
        for (let k = 1; k <= 4; k++)
          line(
            pt(0, -L / 2, 0.24 + (netH * k) / 4),
            pt(0, L / 2, 0.24 + (netH * k) / 4),
            rgb('#eae5d8')
          );
      } else if (q.kind === 'fountain') {
        const rad = Math.min(3, w * 0.28),
          N = 12,
          pc = rgb('#a2a89e'),
          water = rgb('#7eafb7');
        for (let k = 0; k < N; k++) {
          const u = (k * TAU) / N,
            v = ((k + 1) * TAU) / N;
          const f = (t, r, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
          quad(f(u, rad, 0.2), f(v, rad, 0.2), f(v, rad, 0.59), f(u, rad, 0.59), pc);
          quad(
            f(u, rad, 0.59),
            f(v, rad, 0.59),
            f(v, rad - 0.28, 0.59),
            f(u, rad - 0.28, 0.59),
            pc
          );
          tri([cx, 0.51, cz], f(v, rad - 0.28, 0.51), f(u, rad - 0.28, 0.51), water);
          line([cx, 0.55, cz], f(u, rad * 0.58, 1.42), rgb('#a3cdd4'));
          line(f(u, rad * 0.58, 1.42), f(u, rad * 0.9, 0.54), rgb('#a3cdd4'));
        }
        B(0, -5, 0.2, 3, 0.43, 0.52, '#b69b75', true);
      } else if (q.kind === 'patio' || q.kind === 'picnic') {
        B(0, 0, 0.19, Math.min(w, 15), 0.045, 11, '#cec6b8');
        for (const u of [-w * 0.27, w * 0.27])
          for (const v of [-3, 3]) {
            B(u, v, 0.24, 0.19, 0.74, 0.19, '#7c796d');
            B(u, v, 0.98, 1.55, 0.12, 1.25, '#ba9d77');
            for (const off of [-1.05, 1.05]) B(u, v + off, 0.24, 1.55, 0.45, 0.42, '#ba9d77');
            if (q.kind === 'patio') {
              B(u, v, 1.1, 0.08, 1.4, 0.08, '#7b8278');
              const center = pt(u, v, 3.1);
              for (let k = 0; k < 8; k++) {
                const a0 = (k * TAU) / 8,
                  a1 = ((k + 1) * TAU) / 8;
                tri(
                  center,
                  pt(u + 1.65 * Math.cos(a0), v + 1.65 * Math.sin(a0), 2.38),
                  pt(u + 1.65 * Math.cos(a1), v + 1.65 * Math.sin(a1), 2.38),
                  rgb(k % 2 ? theme : '#e4ddca')
                );
              }
            }
          }
      } else if (q.kind === 'play') {
        B(0, 0, 0.19, Math.min(w, 14), 0.055, 10, '#d8c995');
        for (let i = 0; i < 3; i++) {
          B(
            (i - 1) * 3,
            0,
            0.25,
            1.5,
            0.45 + i * 0.34,
            1.5,
            ['#d3aa67', '#81a09a', '#bd857d'][i],
            true
          );
        }
        B(0, -4, 0.24, 3.1, 0.43, 0.55, '#b69b75', true);
      } else {
        B(0, 0, 0.19, Math.min(w, 16), 0.12, 11, '#a9bd98');
        for (const u of [-w * 0.27, w * 0.27]) {
          B(u, 2, 0.32, 0.2, 2.7, 0.2, '#907758');
          const center = pt(u, 2, 4.8);
          for (let k = 0; k < 8; k++) {
            const a0 = (k * TAU) / 8,
              a1 = ((k + 1) * TAU) / 8,
              ring = (t) => pt(u + 1.65 * Math.cos(t), 2 + 1.65 * Math.sin(t), 3.55);
            tri(center, ring(a0), ring(a1), rgb('#7f9f75'));
            tri(pt(u, 2, 2.3), ring(a1), ring(a0), rgb('#75976e'));
          }
          B(u, -3, 0.32, 2.5, 0.48, 0.6, '#b69b75', true);
        }
      }
    }
  }

  // Primary modules and adaptive uses share the same docking geometry.
  const exterior = exporting || view.showModules ? moduleExteriorDetails(m, view.seed) : null;
  if (exterior) {
    for (const s of m.slots) {
      if (!visible(s.f) || s.blocked) continue;
      const storey = buildStorey(m, s.f);
      const varied = preview?.assignments.moduleDesign?.enabled;
      if (exporting || view.supports) {
        drawDockFrame(b, m, s, storey, `Docking_L${s.f + 1}_Frames`, false, false,
          varied || m.crane ? MODULE_CASSETTE_DEPTH : undefined);
        if (m.crane) drawDockInsertionGuides(b, m, s, storey.base);
      }
      if (cranePose?.slot?.i === s.i) continue;
      if (s.p === EMPTY && s.use === 'empty' && !view.programEditing) continue;
      const a = s.angle,
        center = m.R + BUILD_SECTION.dockGap + MODULE.depth / 2,
        x = center * Math.cos(a),
        z = center * Math.sin(a),
        y = storey.base;
      const v = s.p === EMPTY ? VACANCY.find((v) => v.id === s.use) : P[s.p],
        c = rgb(v.color);
      const values =
        preview &&
        (s.p !== EMPTY || s.use === 'retail') &&
        (s.p === EMPTY
          ? materialValues(preview.assignments, 'commercial')
          : materialValues(preview.assignments, 'module', s.p, materialSlotKey(m, s)));
      mark(
        `Modules_L${s.f + 1}_${s.p === EMPTY ? s.use : P[s.p].id}`,
        `Slot_${s.j}`,
        view.programEditing ? { slot: s } : null
      );
      if (view.programEditing && s.p === EMPTY && s.use === 'empty') {
        box(x, y, z, MODULE.width, 0.16, MODULE.depth, a, rgb('#9bbcae'), true);
        continue;
      }
      if (s.p !== EMPTY || s.use === 'retail') {
        if (varied) {
          const plan = furnishedModulePlan(m, s, preview.assignments, view.seed, exterior.balconies.has(s.i)),
            foot = center - MODULE.depth / 2;
          drawFittedModule(b, s, foot * Math.cos(a), y, foot * Math.sin(a), preview, plan, { craneLifting: Boolean(m.crane) });
          if (exporting || view.supports)
            drawModuleDockCollar(b, s, foot * Math.cos(a), y, foot * Math.sin(a), plan, storey.head, !preview.structureView);
          if (plan.balcony) drawModuleBalcony(b, m, s, y, null, false, plan);
          continue;
        }
        if (values) drawMaterialModule(b, s, x, y, z, preview, values);
        else box(x, y, z, MODULE.width, MODULE.height, MODULE.depth, a, c, true);
        if (exterior.balconies.has(s.i))
          drawModuleBalcony(
            b,
            m,
            s,
            y,
            view.programEditing ? { slot: s } : null,
            !preview?.structureView
          );
        if (s.use === 'retail') {
          const ra = m.R + 0.65 + MODULE.depth + 0.01;
          box(
            ra * Math.cos(a),
            y + 0.32,
            ra * Math.sin(a),
            3.65,
            2.4,
            0.06,
            a,
            rgb('#d8d2e1'),
            true
          );
        }
        continue;
      }
      if (varied) drawVariedDockDeck(b, s, x, y, z, view.seed);
      else drawDockDeck(b, s, x, y, z, a, c);
    }
    // Clothes only appear while the neighboring module shells are visible.
    if (!preview?.structureView)
      for (const span of exterior.laundry)
        if (visible(span.slot.f) && ![span.slot.i, span.neighbor.i].includes(cranePose?.slot?.i)) drawModuleLaundry(b, m, span, span.slot.f * floorH + 0.43, preview);
  }

  // Roof access, public park and retail. The atrium glass is not a walking surface.
  if ((exporting || (!view.inspect && view.showRoofDeck && !view.xray)) && m.roofPlan) {
    const p = m.roofPlan,
      y = p.y,
      walk = rgb('#dedbd0'),
      green = rgb('#a3b79a'),
      rail = rgb('#75897b');
    mark('Roof_Public_Deck');
    sector(m.r, m.R, 0, TAU, y - slabThickness, slabThickness, green);
    mark('Roof_Public_Walking_Loop');
    sector(m.R - p.walk, m.R, 0, TAU, y + 0.01, 0.065, walk);
    for (const a of [m.circulation.bridgeAngle, m.circulation.bridgeAngle + Math.PI]) {
      const half = Math.min(0.2, 1.15 / Math.max(1, m.r));
      mark('Roof_Pedestrian_Links');
      sector(m.r, m.R - p.walk, a - half, a + half, y + 0.01, 0.066, walk);
    }
    mark('Roof_Railings');
    for (const radius of [m.r, m.R])
      for (let i = 0; i < 100; i++) {
        const a = (i * TAU) / 100,
          d = ((i + 1) * TAU) / 100,
          stairOpening = m.feature.ride.roofPitch?.stairHalfAngle ?? 0;
        if (
          radius === m.r &&
          angDist((a + d) / 2, m.circulation.bridgeAngle) <
            Math.max(stairOpening, 1.65 / Math.max(1, radius)) + TAU / 100
        )
          continue;
        line(ringPoint(radius, a, y + 1.12), ringPoint(radius, d, y + 1.12), rail);
        if (i % 2 === 0) line(ringPoint(radius, a, y + 0.03), ringPoint(radius, a, y + 1.12), rail);
      }
    for (const q of p.lifts) {
      mark('Roof_Lift_Access_' + (q.block + 1));
      sector(q.r, q.R, q.start, q.end, y, q.accessHeight, rgb('#777a91'));
      mark('Roof_Lift_Service_' + (q.block + 1));
      sector(q.r, q.R, q.start, q.end, y + q.accessHeight, q.serviceHeight, rgb('#a5a4b4'));
      const a = q.end,
        rad = (q.r + q.R) / 2;
      quad(
        ringPoint(rad - 0.5, a + 0.001, y + 0.05),
        ringPoint(rad + 0.5, a + 0.001, y + 0.05),
        ringPoint(rad + 0.5, a + 0.001, y + 2.2),
        ringPoint(rad - 0.5, a + 0.001, y + 2.2),
        rgb('#d9dde6')
      );
    }
    drawCommercialPavilions(b, p, preview);
    if (preview?.assignments.moduleDesign?.enabled) drawVariedRoofGardens(b, p, view.seed);
    else for (const [i, q] of p.garden.entries()) {
      const a = (q.start + q.end) / 2,
        rad = (q.r + q.R) / 2,
        ww = Math.min(3.4, (q.end - q.start) * rad * 0.82),
        dd = Math.min(3.4, (q.R - q.r) * 0.7);
      if (ww < 0.5 || dd < 0.5) continue;
      const at = (r, a, h, w, ht, d, col) =>
        box(r * Math.cos(a), h, r * Math.sin(a), w, ht, d, a, col, true);
      if (q.kind === 'gazebo' && ww > 1.7 && dd > 1.7) {
        mark('Roof_Gazebos', `Gazebo ${i + 1}`);
        const x = rad * Math.cos(a),
          z = rad * Math.sin(a),
          T = [-Math.sin(a), Math.cos(a)],
          D = [Math.cos(a), Math.sin(a)];
        for (const u of [-1, 1])
          for (const v of [-1, 1])
            box(
              x + u * ww * 0.42 * T[0] + v * dd * 0.42 * D[0],
              y + 0.07,
              z + u * ww * 0.42 * T[1] + v * dd * 0.42 * D[1],
              0.13,
              2.35,
              0.13,
              a,
              rgb('#9d8b70')
            );
        at(rad, a, y + 2.42, ww, 0.14, dd, rgb('#c1ae91'));
        at(
          rad,
          a,
          y + 0.08,
          Math.min(0.65, ww * 0.3),
          0.45,
          Math.min(1.7, dd * 0.5),
          rgb('#cfbc9a')
        );
      } else {
        mark('Roof_Gardens', `Planter ${i + 1}`);
        at(rad, a, y + 0.065, ww, 0.35, dd, rgb('#8b9884'));
        at(rad, a, y + 0.415, ww * 0.86, 0.16, dd * 0.83, rgb('#719b63'));
        if (ww > 1.5 && dd > 1.5) {
          mark('Roof_Public_Seating', `Bench ${i + 1}`);
          at(
            rad,
            a + (q.end - q.start) * 0.51,
            y + 0.07,
            0.46,
            0.45,
            Math.min(2.1, dd),
            rgb('#c3a980')
          );
        }
      }
    }
  }
  // Opaque exterior envelope. Keep full-height entrance/slide portals and door-sized docking openings.
  // The wall is inside the gross footprint; X-ray and the facade toggle affect the view only.
  if (exporting || (view.showFacade && !view.xray))
    for (let f = 0; f < view.floors; f++) {
      if (!visible(f)) continue;
      mark(`Facade_L${f + 1}`, `Solid exterior wall / L${f + 1}`);
      const wall = rgb('#c9c8bf'),
        inner = m.R - facadeThickness(m);
      const storey = buildStorey(m, f);
      for (const { span, y, height } of coreFacadeSpans(m, f, storey)) {
        if (preview) drawMaterialFacade(b, m, f, span, y, height, preview);
        else sector(inner, m.R, ...span, y, height, wall);
      }
      for (const slot of m.slots)
        if (slot.f === f && !slot.blocked) drawDockClosure(b, m, slot, storey);
    }

  // Full-height outdoor climbing wall. The reserved dock strip stays unoccupied.
  const climbing = m.feature.climbing;
  if (climbing) {
    const c = climbing,
      lo = c.angle - c.half,
      hi = c.angle + c.half,
      face = rgb('#baaa91'),
      holdColors = ['#ae6a59', '#537e94', '#d5ac56', '#81749c', '#719879'].map(rgb),
      rgen = random(view.seed ^ 0x6acd9b7);
    mark('Climbing_Ground_Approach');
    sector(m.R + 0.02, m.R + 3.8, lo, hi, -0.19, 0.19, rgb('#bfae9c'));
    for (let f = 0; f < view.floors && f * floorH < c.height; f++) {
      if (!visible(f)) continue;
      const y = f * floorH + 0.08,
        hgt = Math.min(floorH, c.height - y);
      if (hgt <= 0) continue;
      mark(`Climbing_L${f + 1}_Wall`);
      sector(m.R + 0.015, c.face, lo, hi, y, hgt, face);
      mark(`Climbing_L${f + 1}_Holds`);
      const rows = 7,
        cols = Math.max(1, Math.floor(c.width / 0.68));
      for (let j = 0; j < rows; j++)
        for (let k = 0; k < cols; k++) {
          const a = lo + ((hi - lo) * (k + 0.5 + (rgen() - 0.5) * 0.64)) / cols,
            rad = c.face + 0.045,
            h = y + 0.25 + j * 0.52 + rgen() * 0.18;
          if (h + 0.2 > y + hgt) continue;
          box(
            rad * Math.cos(a),
            h,
            rad * Math.sin(a),
            0.13 + rgen() * 0.13,
            0.1 + rgen() * 0.1,
            0.1,
            a,
            holdColors[(j + k * 2) % holdColors.length]
          );
        }
      mark(`Climbing_L${f + 1}_Route_Lines`);
      for (let k = 1; k < Math.max(2, Math.floor(c.width / 2.2)); k++) {
        const a = lo + ((hi - lo) * k) / Math.max(2, Math.floor(c.width / 2.2));
        line(
          ringPoint(c.face + 0.015, a, y + 0.08),
          ringPoint(c.face + 0.015, a, y + hgt - 0.03),
          rgb('#8b8276')
        );
      }
    }
    if (exporting || !cut || cutY >= c.height) {
      mark('Climbing_Top_Anchors');
      for (let k = 0; k < Math.max(1, Math.floor(c.width / 2.2)); k++) {
        const a = lo + ((hi - lo) * (k + 0.5)) / Math.max(1, Math.floor(c.width / 2.2));
        box(
          (c.face + 0.04) * Math.cos(a),
          c.height - 0.2,
          (c.face + 0.04) * Math.sin(a),
          0.16,
          0.12,
          0.12,
          a,
          rgb('#776b60')
        );
      }
    }
  }
  // Central swing tower, platform and glass annulus. Open-air deck (not enclosed area).
  const ride = m.feature.ride;
  drawSwingMast(b, m, cut ? Math.min(cutY, ride.height) : ride.height, preview);
  if (exporting || !view.inspect) {
    drawSwingAboveRoof(b, m);
    const pitch = ride.roofPitch,
      aBridge = m.circulation.bridgeAngle;
    if (exporting || (view.roof && !view.xray)) {
      mark('Atrium_Glass_Roof');
      const raisedCanopy = pitch?.canopyRidgeY != null,
        roofc = rgb('#c4dfde'),
        frame = rgb(raisedCanopy ? '#728a81' : '#9aada8'),
        inner = ride.platformRadius,
        outer = pitch?.stairs ? rr + 0.06 : rr,
        outerY = pitch?.canopyEaveY ?? (pitch ? pitch.eaveY - 0.045 : H + 0.07),
        innerY = pitch?.ridgeGlazingY ?? pitch?.canopyRidgeY ?? (outerY + (pitch?.rise ?? 0)),
        roofY = (radius) => outerY + (innerY - outerY) * (rr - radius) / (rr - inner),
        roofPoint = (radius, angle, frameOffset = 0) =>
          ringPoint(radius, angle, roofY(radius) + frameOffset);
      const n = 96;
      for (let i = 0; i < n; i++) {
        const a = (i * TAU) / n,
          d = ((i + 1) * TAU) / n;
        quad(
          roofPoint(inner, d),
          roofPoint(outer, d),
          roofPoint(outer, a),
          roofPoint(inner, a),
          roofc,
          glass,
          raisedCanopy ? 0.38 : 0.28
        );
        line(roofPoint(outer, a, 0.01), roofPoint(outer, d, 0.01), frame);
        line(roofPoint(inner, a, 0.01), roofPoint(inner, d, 0.01), frame);
      }
      for (let i = 0; i < 24; i++) {
        const a = (i * TAU) / 24;
        line(roofPoint(inner, a, 0.02), roofPoint(outer, a, 0.02), frame);
      }
      for (const scale of [0.33, 0.66])
        for (let i = 0; i < n; i++)
          line(
            roofPoint(inner + (rr - inner) * scale, (i * TAU) / n, 0.02),
            roofPoint(inner + (rr - inner) * scale, ((i + 1) * TAU) / n, 0.02),
            frame
          );
      if (raisedCanopy) {
        mark('Atrium_Roof_Ridge', 'Glazing to boarding platform joint');
        sector(inner - 0.11, inner + 0.12, 0, TAU, innerY - 0.08,
          pitch.canopyRidgeY - innerY + 0.08, frame);
      }
      if (raisedCanopy && !pitch.stairs) {
        // The glazed outer band meets the public deck. Leave a doorway in line with the ramp.
        mark('Atrium_Glass_Clerestory');
        const doorHalf = Math.asin(pitch.rampHalfWidth / rr) + 0.025;
        for (const [start, end] of openArcs([[aBridge, doorHalf]])) {
          const panels = Math.ceil((end - start) / 0.11);
          for (let i = 0; i < panels; i++) {
            const a = start + (end - start) * i / panels,
              z = start + (end - start) * (i + 1) / panels,
              baseA = ringPoint(rr, a, pitch.eaveY),
              baseZ = ringPoint(rr, z, pitch.eaveY),
              topA = roofPoint(rr, a),
              topZ = roofPoint(rr, z);
            quad(baseZ, baseA, topA, topZ, roofc, glass, 0.26);
            line(baseA, topA, frame);
            line(baseA, baseZ, frame);
            if (i === panels - 1) line(baseZ, topZ, frame);
          }
        }
      }
    }
  }
  drawWaterSlide(b, m.feature.slide, preview, cut ? cutY : Infinity);
  if (m.crane && !view.programEditing) {
    const paint = rgb(cranePaint(preview?.assignments));
    drawCraneInfrastructure(b, m, m.crane, paint, craneVisible, cutY, cranePose,
      !exporting && cranePose?.stage === 'ride');
    if (cranePose) drawCraneGantry(b, m.crane, cranePose, paint);
  }

  // Conceptual users and animals: low-poly occupancy placeholders for scale and inclusivity.
  if (exporting && (view.showPeople || view.showAnimals)) {
    let rng = random((view.seed * 1664525 + 1013904223) >>> 0);
    const humanClothes = ['#7e97b8', '#c87f78', '#7fa888', '#b08bc1', '#c2a06f', '#7395a0'],
      humanHair = ['#6d5a49', '#4f443d', '#8a735d', '#473a31'],
      skins = ['#f0d1b5', '#d9b28b', '#b98562', '#8d5b3e'],
      groundY = 0.19;
    const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length],
      jitter = (n, s) => n + (rng() - 0.5) * s;
    function personStyle() {
      return {
        h: 1.46 + rng() * 0.46,
        w: 0.48 + rng() * 0.24,
        skin: pick(skins),
        cloth: pick(humanClothes),
        hair: pick(humanHair),
        stroll: (rng() - 0.5) * 0.8
      };
    }
    function putPerson(x, y, z, a, wheel = false) {
      wheel
        ? lowPolyWheelchair(box, quad, tri, x, y, z, a, {
            h: 1.35 + rng() * 0.28,
            w: 0.62 + rng() * 0.12,
            skin: pick(skins),
            cloth: pick(humanClothes)
          })
        : lowPolyPerson(box, x, y, z, a, personStyle());
    }
    if (view.showPeople) {
      mark('Placeholders_People');
      if (m.plaza) {
        const p = m.plaza;
        for (let i = 0; i < 12; i++) {
          const theta =
              p.angle + (i % 2 ? -1 : 1) * (0.17 + 0.12 * Math.floor(i / 2)) * (p.span * 0.42),
            rad = p.mouth + 2.6 + (i % 3) * 4.7;
          putPerson(
            rad * Math.cos(theta),
            groundY,
            rad * Math.sin(theta),
            theta + Math.PI / 2,
            i === 2 || i === 9
          );
        }
      }
      for (const q of [...m.circulation.regions, ...m.circulation.hubs]) {
        if (q.kind === 'elevator' || !visible(q.f)) continue;
        const rad = (q.r + q.R) / 2,
          span = (q.end - q.start) * rad,
          depth = q.R - q.r;
        if (span < 1.5 || depth < 1.2) continue;
        const baseY = q.f * floorH + 0.54,
          count = span > 7 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const t = count === 1 ? 0.5 : (k + 0.3) / count,
            a = q.start + (q.end - q.start) * t;
          putPerson(
            rad * Math.cos(a),
            baseY,
            rad * Math.sin(a),
            a + (q.kind === 'hub' ? 0 : Math.PI / 2),
            rng() < 0.11 && q.kind !== 'hub'
          );
        }
      }
      if ((exporting || (!view.inspect && view.showRoofDeck && !view.xray)) && m.roofPlan) {
        const p = m.roofPlan,
          y = p.y + 0.07,
          walkR = m.R - p.walk * 0.52;
        for (let i = 0; i < 10; i++) {
          const a = (i * TAU) / 10 + 0.2;
          putPerson(walkR * Math.cos(a), y, walkR * Math.sin(a), a + Math.PI / 2, false);
        }
        if (preview?.assignments.moduleDesign?.enabled) drawVariedRoofGardens(b, p, view.seed);
    else for (const [i, q] of p.garden.entries()) {
          if (i > 7) break;
          const a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          putPerson(rad * Math.cos(a), y, rad * Math.sin(a), a + (rng() - 0.5), i % 5 === 0);
        }
      }
      for (let i = 0; i < 8; i++) {
        const a = -1.15 + i * 0.33,
          rad = m.R + MODULE.depth + 7 + (i % 2) * 3.2;
        putPerson(rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.4, i === 3);
      }
    }
    if (view.showAnimals) {
      rng = random((view.seed ^ 0x5f1bbcdc) >>> 0);
      mark('Placeholders_Animals');
      let indoorDogs = 0;
      for (const q of m.circulation.regions) {
        if (!visible(q.f) || q.kind === 'elevator' || q.R - q.r < 1.4) continue;
        const rad = (q.r + q.R) / 2;
        if ((q.end - q.start) * rad < 5 || indoorDogs >= 5) continue;
        const a = q.start + (q.end - q.start) * 0.24;
        lowPolyDog(
          box,
          rad * Math.cos(a),
          q.f * floorH + 0.54,
          rad * Math.sin(a),
          a + Math.PI / 2,
          { s: 0.8 + rng() * 0.24, col: indoorDogs % 2 ? '#b79269' : '#9c8672' }
        );
        indoorDogs++;
      }

      for (let i = 0; i < 4; i++) {
        const a = m.lobby.angle + (-0.36 + i * 0.24),
          rad = m.R + MODULE.depth + 3.8 + i * 0.7;
        lowPolyDog(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.6, {
          s: 0.82 + rng() * 0.2,
          col: i % 2 ? '#b79269' : '#9c8672'
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + 0.18,
          rad = m.R + MODULE.depth + 8.5 + (i % 2) * 2.4;
        lowPolyBird(box, rad * Math.cos(a), groundY + 0.02, rad * Math.sin(a), a + 0.9, {
          s: 0.85 + rng() * 0.25
        });
      }
      if ((exporting || (!view.inspect && view.showRoofDeck && !view.xray)) && m.roofPlan) {
        const y = m.roofPlan.y + 0.07;
        for (let i = 0; i < 4 && i < m.roofPlan.garden.length; i++) {
          const q = m.roofPlan.garden[i],
            a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          lowPolyRabbit(box, rad * Math.cos(a), y, rad * Math.sin(a), a + 0.3, {
            s: 0.95 + rng() * 0.25
          });
        }
        for (let i = 4; i < 8 && i < m.roofPlan.garden.length; i++) {
          const q = m.roofPlan.garden[i],
            a = (q.start + q.end) / 2,
            rad = (q.r + q.R) / 2;
          lowPolySquirrel(box, rad * Math.cos(a), y, rad * Math.sin(a), a - 0.2, {
            s: 0.95 + rng() * 0.25
          });
        }
        for (let i = 0; i < 10; i++) {
          const a = (i * TAU) / 10 + 0.1,
            rad = m.R - 0.8;
          lowPolyBird(box, rad * Math.cos(a), y + 0.02, rad * Math.sin(a), a + 0.4, {
            s: 0.72 + rng() * 0.18
          });
        }
      }
      for (let i = 0; i < 4; i++) {
        const a = 0.65 + i * 0.55,
          rad = m.R + MODULE.depth + 9.5;
        lowPolyRabbit(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a + 0.2, {
          s: 0.95 + rng() * 0.2
        });
      }
      for (let i = 0; i < 4; i++) {
        const a = 2.3 + i * 0.47,
          rad = m.R + MODULE.depth + 8.7;
        lowPolySquirrel(box, rad * Math.cos(a), groundY, rad * Math.sin(a), a - 0.3, {
          s: 0.9 + rng() * 0.18
        });
      }
    }
  }

  return {
    solid,
    lines,
    glass,
    groups,
    textureStrokes: b.textureStrokes,
    H: cut ? view.inspect * floorH : ride.height,
    extent
  };
}
