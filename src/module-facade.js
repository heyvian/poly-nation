'use strict';

function moduleFacadeAppearance(plan, paint, programColour) {
  const finish = EXTERIOR_FINISHES[plan.values.facade],
    mix = (from, to, weight) => from.map((value, i) => value + (to[i] - value) * weight),
    base = finishColor(finish, null, {}, plan.finishSeed),
    metal = plan.values.facade === 'trailer-aluminum',
    timber = finish.group === 'Timber and plant-based',
    painted = paint?.colors ? rgb(paint.colors[mod(plan.paintIndex, paint.colors.length)]) : null,
    [main, secondary] = plan.palette.map(rgb),
    skin = programColour || (painted && !plan.unique ? painted : mix(base, painted || main,
      !plan.unique ? 0 : metal ? 0.10 : timber ? 0.20 : painted ? 0.72 : 0.45)),
    accent = programColour ? materialTint(skin, 0.92) : mix(secondary, painted || secondary, painted ? 0.36 : 0),
    trim = materialTint(accent, 0.67),
    cover = programColour ? materialTint(skin, 0.95) : plan.form.kind === 'streamliner' || metal
      ? mix(skin, rgb('#e9ebdd'), 0.40) : mix(accent, rgb('#3d524b'), 0.39);
  return { finish, skin: materialTint(skin, plan.tint), accent, trim, cover,
    gloss: Math.max(finish.gloss ?? 0, (paint?.gloss ?? 0) * (timber && plan.unique ? 0.30 : 1)) };
}

// Refer every joint to the elevation datum so courses continue past windows.
function drawModuleCladdingJoints(finish, a, b, low, high, point, line, color, stations) {
  const { course, joint, texture, stagger } = finish,
    seam = rgb(finish.seam).map((value, i) => value * 0.72 + color[i] * 0.28),
    pitch = course || high - low, first = course ? Math.floor(low / pitch) : 0,
    last = course ? Math.ceil(high / pitch) - 1 : 0;
  const horizontal = (y) => {
    const cuts = [a, ...stations.filter((u) => u > a && u < b), b];
    for (let i = 1; i < cuts.length; i++) line(point(cuts[i - 1], y), point(cuts[i], y), seam);
  };
  if (texture === 'stucco') return;
  for (let row = first; row <= last; row++) {
    const floor = course ? row * pitch : low, top = floor + pitch,
      from = Math.max(floor, low), to = Math.min(top, high);
    if (from >= to - 1e-6) break;
    if (course && texture !== 'diamond' && floor > low + 1e-6) horizontal(floor);
    if (!joint) continue;
    const shift = (stagger || texture === 'diamond') && Math.abs(row % 2) === 1 ? joint / 2 : 0;
    if (texture === 'diamond') {
      for (let u = Math.floor((a - shift) / joint) * joint + shift; u < b + joint / 2; u += joint) {
        for (const dx of [-joint / 2, joint / 2]) {
          const start = Math.max((from - floor) / pitch, Math.min((a - u) / dx, (b - u) / dx)),
            end = Math.min((to - floor) / pitch, Math.max((a - u) / dx, (b - u) / dx));
          if (end > start) line(point(u + dx * start, floor + pitch * start), point(u + dx * end, floor + pitch * end), seam);
        }
      }
      continue;
    }
    for (let u = Math.floor((a - shift) / joint + 1) * joint + shift; u < b - 1e-6; u += joint) {
      if (u <= a + 1e-6) continue;
      line(point(u, from), point(u, to), seam);
    }
  }
  if (texture === 'rivets') {
    const rivet = materialTint(color, 0.75);
    for (let row = Math.ceil(low / pitch); row * pitch + 0.035 < high; row++) {
      const y = row * pitch + 0.035;
      for (let u = Math.ceil(a / 0.30) * 0.30; u < b - 0.025; u += 0.30)
        line(point(u, y), point(u + 0.014, y), rivet);
    }
  }
}

// Split the enclosure walls into solids around real openings. The same
// positions also locate the exposed framing, including around a tapered tip.
function drawModuleElevation(mesh, plan, point, box, angle, appearance, options) {
  const { side, sign, apertures, enclosure, finishJoints, framing, post, baySpacing, system } = options,
    { form, length, ceiling, wall, detail } = plan,
    { finish, skin, accent, trim, gloss } = appearance,
    edge = sign < 0 ? 0 : length,
    half = moduleHalfAt(form, edge),
    start = side ? wall : -half,
    end = side ? length - (form.nose ? 0 : wall) : half,
    light = rgb('#dcd9c9'), glass = rgb(plan.windowStyle === 'portholes' ? '#769392' : '#89acb9');
  const locate = (along, normal, up) => side
    ? point(sign * (moduleHalfAt(form, along) + normal), along, up)
    : point(along, edge + sign * normal, up);
  function part(center, normal, up, width, depth, height, color, sheen = 0) {
    if (width <= 0.002 || height <= 0.002) return;
    if (!side) {
      box(center, edge + sign * Math.min(normal, -depth / 2), up, width, depth, height, color, false, sheen);
      return;
    }
    const from = center - width / 2, to = center + width / 2;
    if (!form.nose || to <= length - form.nose) {
      box(sign * (form.half + normal), center, up, depth, width, height, color, false, sheen);
      return;
    }
    // Closed panel solids for curved or cut-off ends keep the wall legible
    // in sections. Each run follows the same stations as the roof and floor.
    const breaks = [from, ...form.stations.filter((s) => s > from && s < to), to];
    for (let i = 1; i < breaks.length; i++) {
      const [a, b] = breaks.slice(i - 1, i + 1), low = normal - depth / 2, high = normal + depth / 2,
        at = (s, n, y) => locate(s, n, up + y),
        p = [at(a, low, 0), at(a, high, 0), at(b, high, 0), at(b, low, 0),
          at(a, low, height), at(a, high, height), at(b, high, height), at(b, low, height)];
      for (const order of [[0, 3, 2, 1], [4, 5, 6, 7], [1, 2, 6, 5], [3, 0, 4, 7], [0, 1, 5, 4], [2, 3, 7, 6]]) {
        const corners = order.map((j) => p[j]);
        mesh.quad(...(sign < 0 ? corners.reverse() : corners), color, mesh.solid, 1 + sheen);
      }
    }
  }
  function logCourses(a, b, low, high, backing, color) {
    if (b - a < 0.002 || high - low < 0.002) return;
    const pitch = EXTERIOR_FINISHES['log-siding'].course, relief = 0.054,
      profile = [[0, -relief], [0.18, -0.016], [0.50, 0], [0.82, -0.016], [1, -relief]],
      cuts = [a, ...(side ? form.stations.filter((u) => u > a && u < b) : []), b];
    part((a + b) / 2, -(backing + relief) / 2, low, b - a, backing - relief, high - low, color);
    for (let row = Math.floor(low / pitch); row * pitch < high; row++) {
      for (let i = 1; i < profile.length; i++) {
        const [u, x] = profile[i - 1], [v, y] = profile[i],
          bottom = Math.max(low, (row + u) * pitch), top = Math.min(high, (row + v) * pitch);
        if (bottom >= top) continue;
        const at = (h) => x + (y - x) * ((h / pitch - row - u) / (v - u)),
          timber = materialTint(color, (i === 1 || i === 4 ? 0.89 : 1.03) + 0.025 * Math.sin(row * 2.2));
        for (let j = 1; j < cuts.length; j++) {
          const p = cuts[j - 1], q = cuts[j], corners = [locate(p, at(bottom), bottom), locate(q, at(bottom), bottom),
            locate(q, at(top), top), locate(p, at(top), top)];
          mesh.quad(...((side ? sign < 0 : sign > 0) ? corners.reverse() : corners), timber);
        }
      }
    }
  }
  function skinPart(a, b, low, high) {
    if (b <= a || high <= low) return;
    if (finish.texture === 'logs') return logCourses(a, b, low, high, wall, skin);
    const battens = finish.texture === 'batten', recess = battens ? 0.021 : 0;
    part((a + b) / 2, -(wall + recess) / 2, low, b - a, wall - recess, high - low, skin, gloss);
    if (battens) {
      const strip = materialTint(skin, 0.91);
      for (let u = Math.ceil((a + 0.022) / finish.joint) * finish.joint; u < b - 0.022; u += finish.joint)
        part(u, -0.011, low, 0.038, 0.023, high - low, strip);
    } else if (finishJoints && high - low > 0.05 && b - a > 0.05) {
      drawModuleCladdingJoints(finish, a, b, low, high, (u, y) => locate(u, 0.002, y),
        mesh.textureLine, skin, side ? form.stations : []);
    }
  }
  function framePart(a, b) {
    const width = b - a, low = side ? 0.08 : 0,
      top = ceiling - 0.12, count = Math.max(1, Math.ceil(width / baySpacing));
    if (system.frame === 'solid') {
      part((a + b) / 2, -wall / 2, low, width, 0.105, top - low, framing);
      return;
    }
    if (width < post) return;
    const stations = width < post * 2 ? [(a + b) / 2] :
      Array.from({ length: count + 1 }, (_, i) => a + post / 2 + (width - post) * i / count);
    for (const at of stations) part(at, -wall / 2, low, post, post, top - low, framing);
    if (side && system.frame === 'brace' && width > 0.95 && a === start)
      drawAssemblyMember(mesh, locate(a + 0.1, -wall / 2, low + 0.05), locate(b - 0.1, -wall / 2, top - 0.04),
        0.065, framing, 0.065, angle);
  }
  if (!enclosure) {
    part((start + end) / 2, -wall / 2, ceiling - 0.12, end - start, 0.115, 0.12, framing);
    if (side) part((start + end) / 2, -wall / 2, 0, end - start, 0.105, 0.08, framing);
  }
  let cursor = start, shaded = false;
  for (const aperture of apertures) {
    const { center, width, bottom, top, door, dock, mullion } = aperture,
      a = center - width / 2, b = center + width / 2;
    if (!enclosure && system.logs) {
      logCourses(cursor, a, 0, ceiling, wall, framing);
      logCourses(a, b, 0, bottom, wall, framing);
      logCourses(a, b, top, ceiling, wall, framing);
      cursor = b;
      continue;
    }
    if (enclosure) skinPart(cursor, a, 0, ceiling);
    else framePart(cursor, a);
    cursor = b;
    if (!enclosure) {
      part(center, -wall / 2, top, width + 0.1, 0.11, Math.min(0.14, ceiling - top), framing);
      if (!door) part(center, -wall / 2, bottom - 0.085, width + 0.1, 0.10, 0.085, framing);
      continue;
    }
    skinPart(a, b, 0, bottom);
    skinPart(a, b, top, ceiling);
    if (aperture.shape === 'round' || aperture.shape === 'rounded') {
      drawShapedModuleWindow(mesh, locate, aperture, side ? sign < 0 : sign > 0, wall, skin, trim, glass, gloss);
    } else {
      for (const jamb of [a + 0.024, b - 0.024]) part(jamb, -0.035, bottom, 0.048, 0.105, top - bottom, trim);
      part(center, -0.035, top - 0.042, width, 0.105, 0.042, trim);
      if (dock) continue;
      if (door) {
        drawModulePatioDoor(mesh, locate, part, aperture, wall, skin, trim, glass);
        continue;
      }
      part(center, -0.035, bottom, width, 0.105, 0.046, trim);
      const pane = -wall * (detail === 'frames' ? 0.74 : 0.46),
        corners = [locate(a + 0.05, pane, bottom + 0.047), locate(a + 0.05, pane, top - 0.042),
          locate(b - 0.05, pane, top - 0.042), locate(b - 0.05, pane, bottom + 0.047)];
      mesh.quad(...corners, glass, mesh.glass, 0.77);
      if (mullion) part(center, -0.03, bottom, 0.045, 0.10, top - bottom, trim);
    }
    if (!side || !plan.unique) continue;
    if (!shaded && plan.shade && width > 0.78 && top + 0.075 < ceiling && (!form.nose || b + 0.14 <= length - form.nose)) {
      const projection = clamp(MODULE.width / 2 - form.half - 0.012, 0, 0.24);
      drawModuleWindowShade(mesh, locate, part, plan.shade, Math.max(start, a - 0.08), Math.min(end, b + 0.08),
        top, Math.min(top + 0.19, ceiling - 0.025), projection, accent, trim);
      shaded = true;
    }
    if (detail === 'shutters') for (const u of [a - 0.139, b + 0.139]) {
      if (u < start + 0.15 || u > end - 0.15) continue;
      part(u, 0.017, bottom, 0.25, 0.042, top - bottom, accent);
      for (let y = bottom + 0.10; y < top - 0.055; y += 0.12)
        mesh.line(locate(u - 0.10, 0.042, y), locate(u + 0.10, 0.042, y), light);
    }
    if (detail === 'screen' && sign > 0 && width > 0.8) {
      for (let u = a + 0.10; u < center; u += 0.17) part(u, 0.022, bottom, 0.052, 0.051, top - bottom, accent);
    }
  }
  if (enclosure) skinPart(cursor, end, 0, ceiling);
  else if (system.logs) logCourses(cursor, end, 0, ceiling, wall, framing);
  else framePart(cursor, end);
  if (!side || !enclosure || !plan.unique) return;
  if (detail === 'vents') {
    part(0.91, 0.022, 1.58, 0.71, 0.045, 0.44, trim);
    for (let h = 1.65; h < 1.99; h += 0.055)
      mesh.line(locate(0.61, 0.047, h), locate(1.20, 0.047, h), light);
  }
}

function drawModuleWindowShade(mesh, at, part, style, a, b, top, backY, projection, color, trim) {
  const center = (a + b) / 2, width = b - a;
  if (style === 'louvers') {
    for (let i = 0; i < 4; i++) part(center, projection * 0.43 - 0.02, top - 0.06 - i * 0.076,
      width, projection * 0.90 + 0.04, 0.025, trim);
    for (const side of [a + 0.027, b - 0.027]) part(side, projection * 0.40 - 0.018, top - 0.316, 0.036,
      projection * 0.85 + 0.036, 0.35, trim);
    return;
  }
  const frontY = style === 'visor' ? backY - 0.025 : top - 0.051, pitch = 0.018;
  const rear = -0.005, front = projection;
  const upper = [at(a, rear, backY), at(a, front, frontY), at(b, front, frontY), at(b, rear, backY)];
  mesh.quad(...upper, color);
  mesh.quad(at(b, front, frontY - pitch), at(a, front, frontY - pitch), upper[1], upper[2], trim);
  for (const side of [a + 0.035, b - 0.035])
    drawAssemblyMember(mesh, at(side, -0.012, top - 0.15), at(side, front, frontY - pitch), 0.022, trim);
}

function drawModulePatioDoor(mesh, at, part, aperture, wall, skin, trim, glass) {
  const { center, width, top, doorStyle } = aperture, left = center - width / 2 + 0.051,
    right = center + width / 2 - 0.051, span = right - left,
    double = doorStyle === 'french' || doorStyle === 'sliding', split = doorStyle === 'half-glazed' ? 1.03 : doorStyle === 'french' ? 0.31 : 0.11,
    wood = materialTint(skin, 0.81), sill = 0.042, pane = -wall * 0.49;
  part(center, -0.036, 0, width, 0.106, sill, trim);
  if (doorStyle === 'solid') {
    part(center, -0.048, sill, span, 0.062, top - sill - 0.045, wood);
    for (const u of [left + span * 0.24, center, right - span * 0.24])
      mesh.textureLine(at(u, -0.016, sill + 0.05), at(u, -0.016, top - 0.10), materialTint(wood, 0.73));
  } else {
    if (split > 0.15) part(center, -0.054, sill, span, 0.059, split - sill, wood);
    part(center, -0.048, split - 0.019, span, 0.085, 0.055, trim);
    mesh.quad(at(left, pane, split + 0.036), at(left, pane, top - 0.044), at(right, pane, top - 0.044),
      at(right, pane, split + 0.036), glass, mesh.glass, 0.76);
    if (double) part(center, -0.035, sill, 0.051, 0.10, top - sill - 0.035, trim);
    if (doorStyle === 'french') {
      for (const u of [left + span * 0.25, right - span * 0.25])
        part(u, -0.049, split + 0.03, 0.021, 0.064, top - split - 0.072, trim);
      part(center, -0.049, 1.47, span, 0.065, 0.021, trim);
    }
  }
  const handles = doorStyle === 'french' ? [center - 0.074, center + 0.074] :
    [doorStyle === 'sliding' ? left + 0.093 : right - 0.076];
  for (const u of handles) part(u, -0.025, 0.94, 0.043, 0.047, 0.13, rgb('#a6a59a'));
}

function drawShapedModuleWindow(mesh, point, opening, reverse, wall, skin, trim, glass, gloss) {
  const { center, width, bottom, top, shape } = opening,
    middle = (bottom + top) / 2, rise = (top - bottom) / 2, half = width / 2, steps = 16,
    profile = (a, inset, outer = false) => {
      const x = Math.cos(a), y = Math.sin(a), rectangle = 1 / Math.max(Math.abs(x), Math.abs(y)),
        factor = outer ? rectangle : shape === 'round' ? 1 : 1 + (rectangle - 1) * 0.56;
      return [center + x * (half - inset) * factor, middle + y * (rise - inset) * factor];
    },
    at = ([u, y], inset) => point(u, inset, y),
    quad = (points, color, output = mesh.solid, alpha = 1) =>
      mesh.quad(...(reverse ? points.reverse() : points), color, output, alpha);
  for (let i = 0; i < steps; i++) {
    const a = TAU * i / steps, b = TAU * (i + 1) / steps,
      p = profile(a, 0, true), q = profile(b, 0, true), u = profile(a, 0), v = profile(b, 0),
      inner = profile(a, 0.052), next = profile(b, 0.052), pane = -wall * 0.42;
    quad([at(p, 0), at(q, 0), at(v, 0), at(u, 0)], skin, mesh.solid, 1 + gloss);
    quad([at(p, -wall), at(u, -wall), at(v, -wall), at(q, -wall)], skin);
    quad([at(u, 0), at(v, 0), at(v, -wall), at(u, -wall)], trim);
    quad([at(u, 0.009), at(v, 0.009), at(next, pane), at(inner, pane)], trim);
    const triangle = [point(center, pane, middle), at(inner, pane), at(next, pane)];
    mesh.tri(...(reverse ? triangle.reverse() : triangle), glass, mesh.glass, 0.81);
    mesh.line(at(u, 0.011), at(v, 0.011), trim);
  }
}
