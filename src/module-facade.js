'use strict';

function moduleFacadeAppearance(plan, paint, programColour) {
  const finish = EXTERIOR_FINISHES[plan.values.facade],
    mix = (from, to, weight) => from.map((value, i) => value + (to[i] - value) * weight),
    base = finishColor(finish, null, {}, plan.finishSeed),
    metal = plan.values.facade === 'trailer-aluminum',
    painted = paint?.colors ? rgb(paint.colors[mod(plan.paintIndex, paint.colors.length)]) : null,
    [main, secondary] = plan.palette.map(rgb),
    skin = programColour || (painted && !plan.unique ? painted : mix(base, painted || main,
      !plan.unique ? 0 : metal ? 0.10 : finish.texture === 'grain' ? 0.22 : painted ? 0.72 : 0.45)),
    accent = programColour ? materialTint(skin, 0.92) : mix(secondary, painted || secondary, painted ? 0.36 : 0),
    trim = materialTint(accent, 0.67),
    cover = programColour ? materialTint(skin, 0.95) : plan.form.kind === 'streamliner' || metal
      ? mix(skin, rgb('#e9ebdd'), 0.40) : mix(accent, rgb('#3d524b'), 0.39);
  return { finish, skin: materialTint(skin, plan.tint), accent, trim, cover, gloss: Math.max(finish.gloss ?? 0, paint?.gloss ?? 0) };
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
    : point(along, edge + sign * Math.min(normal, 0), up);
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
  function accentAt(u, h) {
    if (!plan.unique) return false;
    switch (plan.pattern) {
      case 'belt': return h > 0.81 && h < 1.48;
      case 'base': return h < 0.78;
      case 'upper-band': return h > 1.72;
      case 'end-panels': return !side || u < 1.55 || u > length - 1.55;
      case 'patchwork': return Math.floor((u + (side ? 1.5 : 2)) / 2.9) % 3 === (h > 1.48 ? 2 : 0);
      default: return false;
    }
  }
  function skinPart(a, b, low, high) {
    if (b <= a || high <= low) return;
    const splits = { belt: [0.81, 1.48], base: [0.78], 'upper-band': [1.72], patchwork: [1.48] },
      heights = [low, ...(splits[plan.pattern] ?? []).filter((h) => h > low && h < high), high],
      breaks = [a, b];
    if (side && plan.pattern === 'end-panels') breaks.push(...[1.55, length - 1.55].filter((u) => u > a && u < b));
    if (plan.pattern === 'patchwork')
      for (let u = 1.4; u < b; u += 2.9) if (u > a) breaks.push(u);
    breaks.sort((u, v) => u - v);
    for (let i = 1; i < heights.length; i++) for (let j = 1; j < breaks.length; j++) {
      const u = (breaks[j - 1] + breaks[j]) / 2, y = (heights[i - 1] + heights[i]) / 2,
        colour = accentAt(u, y) ? accent : skin;
      part(u, -wall / 2, heights[i - 1], breaks[j] - breaks[j - 1], wall,
        heights[i] - heights[i - 1], colour, gloss);
    }
    if (finishJoints && high - low > 0.26 && b - a > 0.33) {
      const cuts = side ? form.stations.filter((u) => u > a && u < b) : [];
      for (const [i, u] of [a, ...cuts].entries()) {
        const v = [...cuts, b][i];
        drawFinishJoints(finish, v - u, high - low, (d, y) => locate(u + d, 0.0018, y + low),
          mesh.textureLine, skin, plan.finishSeed);
      }
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
  let cursor = start;
  for (const aperture of apertures) {
    const { center, width, bottom, top, door, dock, mullion } = aperture,
      a = center - width / 2, b = center + width / 2;
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
      part(center, -0.035, bottom, width, 0.105, 0.046, trim);
      const pane = -wall * (detail === 'frames' ? 0.74 : 0.46),
        corners = [locate(a + 0.05, pane, bottom + 0.047), locate(a + 0.05, pane, top - 0.042),
          locate(b - 0.05, pane, top - 0.042), locate(b - 0.05, pane, bottom + 0.047)];
      mesh.quad(...corners, glass, mesh.glass, 0.77);
      if (mullion || door) part(center, -0.03, bottom, 0.045, 0.10, top - bottom, trim);
    }
    if (!side || !plan.unique) continue;
    const projection = (MODULE.width / 2 - form.half) * 0.90;
    if (detail === 'hood') {
      part(center, projection * 0.5, top + 0.047, width + 0.15, projection, 0.09, accent);
      part(center, projection * 0.77, bottom - 0.051, width + 0.13, projection * 0.42, 0.056, trim);
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
  else framePart(cursor, end);
  if (!side || !enclosure || !plan.unique) return;
  if (detail === 'vents' || detail === 'patch') {
    part(0.91, 0.022, 1.58, 0.71, 0.045, 0.44, detail === 'vents' ? trim : light);
    if (detail === 'vents') for (let h = 1.65; h < 1.99; h += 0.055)
      mesh.line(locate(0.61, 0.047, h), locate(1.20, 0.047, h), light);
  }
  if (detail === 'ribs' || detail === 'straps') {
    for (const u of [wall + 0.18, wall + 0.40, length - wall - 0.18])
      part(u, 0.015, 0.12, detail === 'straps' ? 0.15 : 0.066, 0.042, ceiling - 0.24, accent);
  }
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
