'use strict';

// Distribute light pools along occupied circulation, over the lobby seating, and
// in room bays. Store a plan of the pools per storey for interactive rendering.
function makeRenderLighting(model, seed = 0) {
  const size = 128,
    levels = model.layers.length,
    extent = model.R + 2,
    pitch = modelFloorPitch(model),
    base = buildStorey(model, 0).base,
    lamps = Array.from({ length: levels }, () => []),
    field = new Uint8Array(size * size * levels),
    top = model.roofPlan.y;
  function lamp(f, r, angle, reach, intensity, fixture = 'downlight') {
    lamps[f].push({ x: r * Math.cos(angle), z: r * Math.sin(angle), reach, intensity, fixture });
  }
  for (const q of [...model.circulation.regions, ...model.rooms]) {
    if (['elevator', 'lobbyDivider'].includes(q.kind) || q.R - q.r < 0.76) continue;
    const radius = (q.r + q.R) / 2,
      span = (q.end - q.start) * radius,
      segments = Math.max(1, Math.round(span / 5.6)),
      reach = q.kind ? 4.7 : Math.max(4.2, (q.R - q.r) / 2);
    for (let i = 0; i < segments; i++)
      lamp(q.f, radius, q.start + (q.end - q.start) * (i + 0.5) / segments, reach, q.kind ? 0.7 : 0.46);
  }
  for (const hub of coreLobbies(model.circulation)) {
    if (!hub.layout) continue;
    const canopy = lobbyCanopyPattern(hub, seed);
    for (const side of hub.layout.seatingSides ?? [-1, 1]) {
      const paper = canopy?.sign === side;
      const [x, , z] = paper ? canopy.center :
        sharedLobbyPoint(hub, 0, side * (hub.layout.passage / 2 + 0.86), 0);
      lamp(hub.f, Math.hypot(x, z), Math.atan2(z, x), 4.2, 0.75, paper ? 'paper' : 'pendant');
    }
  }
  // Downlights at the ground promenade make the glazed atrium legible after dark.
  for (let i = 0; i < 24; i++) lamp(0, model.r - 1.7, i * TAU / 24, 4.3, 0.34);
  const cell = 2 * extent / size;
  for (const [f, fixtures] of lamps.entries()) {
    for (const { x, z, reach, intensity } of fixtures) {
      const s = (x + extent) / cell, t = (z + extent) / cell, spread = reach / cell;
      for (let row = Math.max(0, Math.floor(t - spread)); row < Math.min(size, t + spread); row++) {
        for (let col = Math.max(0, Math.floor(s - spread)); col < Math.min(size, s + spread); col++) {
          const d = Math.hypot(col + 0.5 - s, row + 0.5 - t) / spread,
            index = (f * size + row) * size + col;
          field[index] = Math.min(255, field[index] + Math.round(255 * intensity * Math.max(0, 1 - d ** 2) ** 2));
        }
      }
    }
  }
  return { size, levels, lamps, field, base, pitch, extent, top, radius: model.r, outer: model.R };
}

// Match the GPU's roof-exposure and lamp falloff in browsers using the canvas fallback.
function renderSurfaceLight(study, x, y, z) {
  const { size, levels, pitch, extent, base, top, field, radius, outer, daylight, interior } = study,
    r = Math.hypot(x, z),
    floor = Math.floor((y - base + 0.045) / pitch),
    depth = clamp((y - base) / (top - base), 0, 1),
    rim = clamp((r - radius + 1) / 9, 0, 1),
    sky = y < base - 0.12 || y > top - 0.03 || r > outer + 0.06 ? 1 :
      (0.44 + 0.49 * depth) * (1 - 0.86 * rim),
    row = Math.floor((z / extent + 1) * size / 2),
    col = Math.floor((x / extent + 1) * size / 2),
    pool = floor >= 0 && floor < levels && row >= 0 && row < size && col >= 0 && col < size
      ? field[(floor * size + row) * size + col] / 255 : 0,
    warm = r < outer + 0.06 && y < top - 0.05 ? pool * interior : 0,
    ambient = 0.14 + 0.11 * daylight,
    natural = ambient + (0.89 + 0.19 * depth) * sky * daylight;
  return [natural + 0.86 * warm, natural + 0.58 * warm, natural + 0.32 * warm];
}

function drawRenderFixtures(mesh, model, lighting, visibleLevels) {
  const color = rgb('#fff0bf'),
    stem = rgb('#5d6057'),
    limit = visibleLevels ? visibleLevels - 1 : lighting.levels;
  mesh.mark('Render_Downlights');
  for (let f = 0; f < limit; f++) {
    const ceiling = buildStorey(model, f).soffit - 0.032;
    for (const { x, z, fixture, intensity } of lighting.lamps[f]) {
      // The paper pendant is already part of the assembly. Ground uplights are recessed.
      if (fixture === 'paper' || intensity < 0.36) continue;
      const pendant = fixture === 'pendant',
        drop = pendant ? 0.31 : 0.07, width = pendant ? 0.31 : 0.17;
      mesh.box(x, ceiling - drop, z, 0.045, drop, 0.045, 0, stem);
      mesh.box(x, ceiling - drop - 0.05, z, width, 0.049, width, 0, color);
    }
  }
}

const openRenderWorkspace = (() => {
  const panel = $('renderPhase'),
    modules = $('renderModules'),
    canvas = $('renderCanvas'),
    level = $('renderLevel'),
    daylight = $('renderDaylight'),
    interior = $('renderInterior'),
    camera = { az: -0.8, el: 0.63, zoom: 1, pan: 0, panX: 0 };
  let assembly, lighting, source, signature, assignments, context, renderer, fallback;
  function present() {
    if (!assembly || panel.hidden) return;
    lighting.daylight = Number(daylight.value) / 100;
    lighting.interior = Number(interior.value) / 100;
    $('renderDaylightValue').textContent = daylight.value + '%';
    $('renderInteriorValue').textContent = interior.value + '%';
    if (renderer) paintWebGL(canvas, context, renderer, camera);
    else if (fallback) paintSoftware(assembly, fallback, camera);
  }
  function rebuild(fit = false) {
    const visible = Number(level.value),
      layers = {
        ...buildViewLayers(),
        frame: true, walls: true, slabs: true, facade: true,
        docks: modules.checked, modules: modules.checked, slide: true, swings: true, roofRetail: true
      };
    assembly = buildAssemblyMesh(source, layers, visible, {
      assignments,
      view: { seed: state.seed },
      finishJoints: false
    });
    drawRenderFixtures(assembly, source, lighting, visible);
    assembly.renderLighting = lighting;
    if (renderer) uploadWebGLMesh(context, renderer, assembly);
    if (fit) fitModel(assembly, camera, canvas);
    present();
  }
  bindModelCamera({
    canvas, getCamera: () => camera, getMesh: () => assembly, onChange: present,
    buttons: { axo: 'renderAxo', plan: 'renderPlan', side: 'renderSide', fit: 'renderFit' }
  });
  new ResizeObserver(present).observe(canvas);
  for (const control of [daylight, interior]) control.oninput = present;
  level.onchange = () => rebuild(true);
  modules.onchange = () => rebuild();
  return (model, materials) => {
    if (!renderer && !fallback) {
      context = canvas.getContext('webgl', { antialias: true, alpha: false });
      renderer = createWebGLRenderer(context);
      if (!renderer) fallback = createSoftwareRenderer(canvas);
    }
    const next = JSON.stringify([materials, buildViewLayers().dockStructure]);
    if (model === source && next === signature) return present();
    const changed = source !== model, previous = level.value;
    source = model;
    assignments = materials;
    signature = next;
    if (changed) {
      lighting = makeRenderLighting(model, state.seed);
      level.replaceChildren(
        new Option('Whole building', '0'),
        ...model.layers.map((_, i) => new Option(
          i === 0 ? 'Ground floor cutaway' : 'Cutaway through level ' + (i + 1), String(i + 1)))
      );
      level.value = previous === '' ? String(model.layers.length) :
        String(Math.min(Number(previous), model.layers.length));
    }
    rebuild(changed);
  };
})();
