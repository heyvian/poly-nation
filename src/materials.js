'use strict';

// Work on a detached massing snapshot. Changing massing never mutates the material study.
const materialWorkspace = (() => {
  const phase = $('materialsPhase');
  const materialCanvas = $('materialsCanvas');
  let materialGL = null,
    materialRenderer = null,
    materialSoftware = null;
  const storageKey = 'poly-nation-material-study-v1';
  const scope = $('materialScope');
  const target = $('materialTarget');
  const studyCamera = { az: -0.84, el: 0.57, zoom: 0.95, pan: 0 };
  let study = null,
    mesh = null,
    frame = 0;

  function saveStudy() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(study, (_, value) =>
          value instanceof Set ? { materialSnapshotSet: [...value] } : value
        )
      );
    } catch {
      $('materialStatus').textContent = 'This study could not be saved in browser storage.';
    }
  }
  // Restore circulation in detached studies saved with the retired public
  // lobbies. Keep the captured rooms, bridges and material assignments.
  function restoreLegacyCorridors(circulation) {
    if (!circulation?.publicLobbies) return false;
    for (const hub of circulation.publicLobbies) {
      const { f, r, R, start, end, area } = hub,
        span = end - start,
        regions = circulation.regions,
        overlapsBay = (q) => q.f === f &&
          angDist((q.start + q.end) / 2, (start + end) / 2) + (q.end - q.start) / 2 <= span / 2 + 1e-7,
        aprons = hub.layout?.bridgeThrough ? regions.filter((q) => q.R === r && overlapsBay(q)) : [],
        pairs = aprons.map((inner) => [inner, regions.find((q) => q.f === f && q.r === R &&
          q.start === inner.start && q.end === inner.end)]),
        width = aprons.reduce((total, q) => total + q.end - q.start, 0);
      if (Math.abs(width - span) < 1e-7 && pairs.every(([, outer]) => outer)) {
        const replaced = new Map();
        for (const [inner, outer] of pairs) {
          const restored = area * (inner.end - inner.start) / span;
          replaced.set(inner, [{ ...inner, R: outer.R, area: inner.area + restored + outer.area }]);
          replaced.set(outer, []);
        }
        circulation.regions = regions.flatMap((q) => replaced.get(q) ?? [q]);
      } else {
        // Earlier snapshots left an angular bypass beside the furnished bay.
        // Fill its former seating footprint on the same corridor level.
        regions.push({ f, r, R, start, end, area, kind: 'residual' });
      }
      circulation.area += area;
      circulation.corridorArea += area;
    }
    delete circulation.publicLobbies;
    delete circulation.publicLobbyArea;
    return true;
  }

  function restoreStudy() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey), (_, value) =>
        value?.materialSnapshotSet ? new Set(value.materialSnapshotSet) : value
      );
      if (stored?.model?.slots && stored.view && stored.assignments) {
        study = stored;
        const model = study.model, migrated = restoreLegacyCorridors(model.circulation),
          refreshCrane = !Object.hasOwn(model, 'crane') || (model.crane && !Number.isFinite(model.crane.atriumClearRadius));
        if (refreshCrane) model.crane = planModuleCrane(model, model.crane?.runway);
        const moat = craneMoatBounds(model.crane), refreshPlaza = moat && model.plaza.outer > moat.inner ||
          model.crane?.runway === 'elevated' && !Array.isArray(model.plaza.arrivals);
        if (refreshPlaza)
          model.plaza = designPlaza(model.R, model.lobby, model.slots, model.feature.climbing, model.crane, study.view.seed);
        if (migrated || refreshCrane || refreshPlaza) saveStudy();
      }
    } catch {
      $('materialStatus').textContent = 'The saved material study could not be loaded.';
    }
  }

  function captureMassing() {
    if (pending) update();
    study ??= { assignments: {}, programColors: false, structureView: false, notes: '' };
    study.model = structuredClone(model);
    study.view = {
      floors: state.floors,
      seed: state.seed,
      inspect: 0,
      xray: false,
      grid: state.grid,
      showRooms: true,
      showModules: study.view?.showModules ?? true,
      supports: true,
      showRoofDeck: true,
      showFacade: true,
      roof: true,
      ...(state.craneStage === 'caterpillar' ? craneCaterpillarPreview() : {})
    };
    const currentSlots = new Set(
      study.model.slots
        .filter((slot) => slot.p !== EMPTY)
        .map((slot) => 'module:' + materialSlotKey(study.model, slot))
    );
    for (const key of Object.keys(study.assignments)) {
      if (key.startsWith('module:') && !currentSlots.has(key)) delete study.assignments[key];
    }
    saveStudy();
  }

  function present() {
    if (phase.hidden || !mesh) return;
    if (materialRenderer) paintWebGL(materialCanvas, materialGL, materialRenderer, studyCamera);
    else if (materialSoftware) paintSoftware(mesh, materialSoftware, studyCamera, materialCanvas);
  }

  function captureMaterialModel(width, height) {
    const capture = document.createElement('canvas');
    const viewport = { clientWidth: width, clientHeight: height };
    const ctx = capture.getContext('2d');
    if (!ctx || !mesh) throw Error('The material model is unavailable.');
    const screenAspect = materialCanvas.clientWidth / materialCanvas.clientHeight,
      outputAspect = width / height,
      captureCamera = { ...studyCamera };
    // Carry the framing into the sheet even when its model area has a different aspect ratio.
    if (Number.isFinite(screenAspect) && screenAspect > 0)
      captureCamera.zoom *=
        (baseViewHalf(mesh, studyCamera, screenAspect) * Math.max(1, screenAspect / outputAspect)) /
        baseViewHalf(mesh, studyCamera, outputAspect);
    if (materialRenderer && !materialGL.isContextLost()) {
      capture.width = width;
      capture.height = height;
      // Copy the WebGL frame immediately, before the browser clears the drawing buffer.
      try {
        paintWebGL(materialCanvas, materialGL, materialRenderer, captureCamera, viewport, 1);
        ctx.drawImage(materialCanvas, 0, 0);
      } finally {
        present();
      }
    } else {
      paintSoftware(mesh, { canvas: capture, ctx }, captureCamera, viewport, 1);
    }
    return capture;
  }
  function redraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      present();
    });
  }
  function rebuild() {
    if (!materialRenderer && !materialSoftware) {
      materialGL = materialCanvas.getContext('webgl', { antialias: true, alpha: false });
      materialRenderer = createWebGLRenderer(materialGL);
      if (materialRenderer) {
        // Match the shaded ground so the edge of its plane blends into the viewport.
        const groundShade = 0.74 + 0.26 / Math.hypot(-0.4, 1, 0.65);
        const ground = rgb('#e4e8df').map((channel) => channel * groundShade);
        materialGL.clearColor(...ground, 1);
      } else materialSoftware = createSoftwareRenderer(materialCanvas);
    }
    const view = { ...study.view, showRooms: !study.structureView || study.programColors };
    // Depth testing hides seams behind overlapping walls. Keep simplified colors on Canvas.
    const preview = { ...study, finishJoints: Boolean(materialRenderer) };
    const placed = siteWorkspace.designModel(study.model);
    mesh = siteWorkspace.composeDesign(buildMesh(placed, false, view, preview), study.model);
    if (materialRenderer) uploadWebGLMesh(materialGL, materialRenderer, mesh);
    redraw();
  }
  new ResizeObserver(redraw).observe(materialCanvas);

  const option = (label, value) => new Option(label, value);

  const assemblyView = $('materialAssemblies');
  const analysisView = $('materialAnalysis');
  const details = $('assemblyDetail');
  const currentVariants = new Map();
  let cards = [];
  let expandedAssembly = null;
  let drawDetail = null;
  const diagramObserver = new ResizeObserver(() => drawDetail?.());

  function showMaterialPanel(showAssemblies) {
    assemblyView.hidden = !showAssemblies;
    analysisView.hidden = showAssemblies;
    $('materialAssembliesView').setAttribute('aria-pressed', String(showAssemblies));
    $('materialAnalysisView').setAttribute('aria-pressed', String(!showAssemblies));
    if (showAssemblies) drawDetail?.();
  }

  function syncAssemblyHeaders() {
    for (const { key, program } of cards) {
      const card = $('assembly-' + key);
      const open = expandedAssembly === key;
      const editing =
        scope.value === 'building' ||
        (key === 'core'
          ? scope.value.startsWith('core')
          : scope.value === 'modules' ||
            (scope.value === 'moduleProgram' && Number(target.value) === program));
      card.dataset.editing = String(editing);
      const button = card.querySelector('button');
      button.setAttribute('aria-expanded', String(open));
      button.querySelector('.assembly-chevron').textContent = open ? '−' : '+';
    }
  }

  function toggleAssembly({ key, program }) {
    if (expandedAssembly === key) {
      expandedAssembly = null;
    } else {
      expandedAssembly = key;
      scope.value = key === 'core' ? 'core' : 'moduleProgram';
      syncTargets();
      if (program != null) target.value = String(program);
      syncAssignment();
    }
    syncAssemblyHeaders();
    renderAssemblyDetail();
  }

  function buildAssemblyHeader(cardData) {
    const { key, title, program, variants } = cardData;
    const count = variants.reduce((total, variant) => total + variant.quantity, 0);
    const card = document.createElement('article');
    card.className = 'assembly-card';
    card.id = 'assembly-' + key;
    card.style.setProperty('--program-color', PROGRAMS[program]?.color || '#547765');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-controls', 'assemblyDetail');
    const titleText = document.createElement('span');
    titleText.className = 'assembly-name';
    titleText.textContent = title;
    const meta = document.createElement('span');
    meta.className = 'assembly-meta';
    meta.textContent = assemblyQuantity(cardData.ring, count) + (key === 'core' ? ' of rooms' : '');
    const chevron = document.createElement('span');
    chevron.className = 'assembly-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(titleText, meta, chevron);
    button.addEventListener('click', () => toggleAssembly(cardData));
    card.append(button);
    return card;
  }

  function renderAssemblyDetail() {
    diagramObserver.disconnect();
    drawDetail = null;
    const card = cards.find((card) => card.key === expandedAssembly);
    details.hidden = !card;
    if (!card) {
      details.replaceChildren();
      return;
    }
    const { title, key, variants, ring } = card;
    details.setAttribute('aria-label', title + ' assembly details');
    details.innerHTML =
      '<figure class="assembly-figure"><span class="assembly-fig-label cladding">Cladding</span>' +
      '<canvas role="img"></canvas><span class="assembly-fig-label structure">Structure</span></figure>' +
      '<div class="assembly-variant"></div><div class="assembly-specs"></div>';
    const canvas = details.querySelector('canvas');
    const spec = details.querySelector('.assembly-specs');
    const variantHeader = details.querySelector('.assembly-variant');
    variantHeader.append(title);
    const select = document.createElement('select');
    select.setAttribute('aria-label', title + ' assembly variant');
    for (const variant of variants) {
      const qty = ring ? fmt(variant.quantity) + ' m²' : variant.quantity + ' modules';
      select.append(
        option(
          qty +
            ' · ' +
            STRUCTURAL_SYSTEMS[variant.values.structure].name +
            ' / ' +
            EXTERIOR_FINISHES[variant.values.facade].name,
          variant.key
        )
      );
    }
    if (variants.some((variant) => variant.key === currentVariants.get(key)))
      select.value = currentVariants.get(key);
    if (variants.length > 1) variantHeader.append(select);
    function showVariant() {
      const { values } = variants.find((variant) => variant.key === select.value);
      currentVariants.set(key, select.value);
      canvas.setAttribute(
        'aria-label',
        title +
          ', exploded axonometric. ' +
          STRUCTURAL_SYSTEMS[values.structure].name +
          ' structure and ' +
          EXTERIOR_FINISHES[values.facade].name +
          ' cladding.'
      );
      spec.innerHTML = assemblyLayerMarkup(values);
      drawDetail = () => drawExplodedAssembly(canvas, values, ring);
      drawDetail();
    }
    select.addEventListener('change', showVariant);
    diagramObserver.observe(canvas);
    showVariant();
  }

  const currency = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0
  });
  const percent = (ratio) => Math.round(ratio * 100) + '%';
  function updateMaterialAnalysis() {
    const { model, assignments, rates } = study;
    const takeoff = estimateMaterialAssemblies(model, assignments, rates, study.view.seed);
    $('materialCostTotal').textContent = '≈ ' + currency.format(takeoff.total) + ' CAD';
    $('materialCostRows').replaceChildren(
      ...takeoff.rows.map(({ label, count, cost }) => {
        const row = document.createElement('tr');
        for (const value of [
          label,
          count,
          count ? currency.format(cost / count) : '—',
          currency.format(cost)
        ]) {
          const cell = row.insertCell();
          cell.textContent = value;
        }
        return row;
      })
    );
    const coreShare = takeoff.total ? takeoff.rows[0].cost / takeoff.total : 0;
    const pods = takeoff.rows.slice(1).reduce((sum, row) => sum + row.count, 0);
    $('materialBuildingSummary').textContent =
      'The ' +
      fmt(takeoff.studyTotal) +
      ' m² study includes a ' +
      fmt(model.ringArea) +
      ' m² core ring and ' +
      pods +
      ' enclosed modules. ' +
      'The assemblies measured here total roughly ' +
      fmt(takeoff.mass / 1000) +
      ' tonnes' +
      (takeoff.total
        ? ', and the core accounts for ' + percent(coreShare) + ' of estimated cost.'
        : '.');
    const [mainSystem, floorArea] = takeoff.leadingStructure || ['concrete', 0];
    const measuredFloor = [...takeoff.structureAreas.values()].reduce((sum, area) => sum + area, 0);
    const structureShare = takeoff.total ? takeoff.structuralCost / takeoff.total : 0;
    $('materialStructuralSummary').textContent =
      STRUCTURAL_SYSTEMS[mainSystem].name +
      ' covers ' +
      percent(measuredFloor ? floorArea / measuredFloor : 0) +
      ' of the measured floor area. Its typical behavior is ' +
      STRUCTURE_STUDY[mainSystem][2].replace(/^[A-Z]/, (letter) => letter.toLowerCase()) +
      '.' +
      (takeoff.total
        ? ' Structure makes up ' + percent(structureShare) + ' of estimated cost.'
        : '');
    const systems = takeoff.structureAreas.size,
      finishes = takeoff.finishes.size,
      pairs = takeoff.modulePairs.size;
    $('materialDiversitySummary').textContent =
      systems +
      (systems === 1 ? ' structural system' : ' structural systems') +
      ' and ' +
      finishes +
      (finishes === 1 ? ' finish' : ' finishes') +
      ' are in use. ' +
      (pairs === 0
        ? 'The study contains only the core assembly.'
        : pairs === 1
          ? 'Repeating one module assembly keeps detailing consistent.'
          : takeoff.moduleSystems.size === 1
            ? 'The modules share one structure but vary the cladding, so exterior finishes can distinguish programs without changing the framing.'
            : 'The modules use ' +
              pairs +
              ' assemblies across ' +
              takeoff.moduleSystems.size +
              ' structural systems, with different framing and connection details.');
  }

  function refreshAssemblies() {
    const { model: snapshot, assignments } = study;
    const core = assemblyVariants(
      snapshot.rooms.map((room) => ({
        values: materialValues(assignments, 'core', room.id),
        quantity: room.area
      })),
      materialValues(assignments, 'core')
    );
    cards = [{ key: 'core', title: 'Core ring', ring: snapshot, program: null, variants: core }];
    for (const [id, program] of PROGRAMS.entries()) {
      const modules = snapshot.slots
        .filter((slot) => slot.p === id)
        .map((slot) => ({
          values: moduleMaterialSelection(snapshot, slot, assignments, study.view.seed).values,
          quantity: 1
        }));
      const variants = assemblyVariants(modules, materialValues(assignments, 'module', id));
      cards.push({ key: String(id), title: program.name, ring: null, program: id, variants });
    }
    $('assemblyCards').replaceChildren(...cards.map(buildAssemblyHeader));
    syncAssemblyHeaders();
    renderAssemblyDetail();
    updateMaterialAnalysis();
  }

  $('materialAssembliesView').addEventListener('click', () => showMaterialPanel(true));
  $('materialAnalysisView').addEventListener('click', () => showMaterialPanel(false));
  $('returnToAssembly').onclick = () => {
    showMaterialPanel(true);
    const key = scope.value.startsWith('core')
      ? 'core'
      : scope.value === 'moduleProgram'
        ? target.value
        : '';
    const button = $('assembly-' + key)?.querySelector('button') || $('materialAssembliesView');
    button.scrollIntoView({ block: 'nearest' });
    button.focus({ preventScroll: true });
  };
  const ratesDialog = $('materialRatesDialog');
  $('openMaterialRates').onclick = () => {
    $('materialStructureRate').value = study.rates.structure;
    $('materialCladdingRate').value = study.rates.facade;
    ratesDialog.showModal();
  };
  $('materialRatesForm').onsubmit = () => {
    study.rates = {
      structure: $('materialStructureRate').valueAsNumber,
      facade: $('materialCladdingRate').valueAsNumber
    };
    saveStudy();
    updateMaterialAnalysis();
  };

  function currentKey() {
    return $('materialTargetField').hidden ? scope.value : scope.value + ':' + target.value;
  }
  function changePaint(field, value) {
    const key = currentKey(),
      override = (study.assignments[key] ||= {});
    if (value !== '') override[field] = value;
    else delete override[field];
    if (!Object.keys(override).length) delete study.assignments[key];
    syncAssignment();
    saveStudy();
    rebuild();
  }
  function syncSlidePaint() {
    const palette = $('slidePaintPalette');
    palette.hidden = scope.value !== 'slide';
    if (palette.hidden) return;
    const surface = slideSurface(study.assignments),
      hex = $('slidePaintHex');
    $('slidePaintPicker').value = surface.hex;
    hex.value = surface.hex;
    hex.setCustomValidity('');
    $('resetSlidePaint').hidden = !surface.custom;
    $('slidePaintSheen').value = surface.sheen;
    $('slidePaintSheenValue').value = surface.sheen + '%';
  }
  $('slidePaintPicker').onchange = (event) => changePaint('paintHex', event.target.value);
  $('resetSlidePaint').onclick = () => changePaint('paintHex', '');
  const slideHex = $('slidePaintHex');
  slideHex.oninput = () => slideHex.setCustomValidity('');
  slideHex.onchange = () => {
    const hex = paintHex(slideHex.value);
    slideHex.setCustomValidity(
      hex || !slideHex.value.trim() ? '' : 'Enter a three- or six-digit hex colour.'
    );
    if (slideHex.reportValidity()) changePaint('paintHex', hex);
  };
  slideHex.onkeydown = (event) => {
    if (event.key === 'Enter') slideHex.blur();
  };
  const slideSheen = $('slidePaintSheen');
  slideSheen.oninput = () => {
    $('slidePaintSheenValue').value = slideSheen.value + '%';
  };
  slideSheen.onchange = () => changePaint('sheenPercent', slideSheen.valueAsNumber);

  function syncPaint(assignment, program) {
    const palette = $('paintPalette');
    palette.hidden = !['modules', 'moduleProgram'].includes(scope.value);
    if (palette.hidden) return;
    const paint = modulePaint(study.assignments, program);
    $('materialPaint').value = assignment.paint ?? '';
    $('materialPaintSheen').value = assignment.sheen ?? '';
    const samples = (paint.colors ?? []).map((color, i) => {
      if (paint.palette !== 'custom') {
        const swatch = document.createElement('span');
        swatch.style.background = color;
        swatch.title = color;
        return swatch;
      }
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = color;
      picker.setAttribute('aria-label', 'Palette colour ' + (i + 1));
      picker.onchange = () => {
        const key = currentKey();
        (study.assignments[key] ||= {}).paint = 'custom';
        const revised = paint.colors.slice();
        revised[i] = picker.value;
        changePaint('paintColors', revised);
      };
      return picker;
    });
    $('paintSamples').replaceChildren(...samples);
  }
  function syncCranePaint() {
    const palette = $('cranePaintPalette');
    palette.hidden = scope.value !== 'mast';
    if (palette.hidden) return;
    const color = cranePaint(study.assignments);
    $('cranePaintPicker').value = color;
    $('cranePaintHex').value = color;
    $('cranePaintHex').setCustomValidity('');
    $('resetCranePaint').hidden = !paintHex(study.assignments.mast?.paintHex);
  }
  $('cranePaintPicker').onchange = (event) => changePaint('paintHex', event.target.value);
  $('resetCranePaint').onclick = () => changePaint('paintHex', '');
  const craneHex = $('cranePaintHex');
  craneHex.oninput = () => craneHex.setCustomValidity('');
  craneHex.onchange = () => {
    const color = paintHex(craneHex.value);
    craneHex.setCustomValidity(color || !craneHex.value.trim() ? '' : 'Enter a three- or six-digit hex colour.');
    if (craneHex.reportValidity()) changePaint('paintHex', color);
  };
  craneHex.onkeydown = (event) => {
    if (event.key === 'Enter') craneHex.blur();
  };

  $('materialPaint').onchange = (event) => changePaint('paint', event.target.value);
  $('materialPaintSheen').onchange = (event) => changePaint('sheen', event.target.value);

  const paletteIds = { structure: 'materialStructure', facade: 'materialFacade' };
  function syncAssignment() {
    const assignment = study.assignments[currentKey()] || {};
    const family = materialFamily();
    const program = scope.value.endsWith('Program') ? Number(target.value) : null;
    const effective = materialValues(study.assignments, family, program);
    for (const [field, id] of Object.entries(paletteIds)) {
      for (const button of $(id).querySelectorAll('button'))
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.material === (assignment[field] || ''))
        );
      if (!effective[field]) continue;
      const catalog = MATERIAL_CATALOGUES[field];
      const selection = assignment[field];
      let description = 'Inherited · ' + catalog[effective[field]].name;
      if (materialCompatible(field, selection, family)) description = catalog[selection].name;
      else if (scope.value === 'building')
        description = materialCompatible(field, selection, 'core')
          ? catalog[selection].name + ' · Core only'
          : 'Inherit the core and module defaults';
      $(field + 'Choice').textContent = description;
    }
    syncPaint(assignment, program);
    syncSlidePaint();
    syncCranePaint();
    syncAssemblyHeaders();
  }
  function syncTargets() {
    const previous = target.value;
    const byProgram = scope.value.endsWith('Program');
    target.replaceChildren(...PROGRAMS.map((entry, id) => option(entry.name, String(id))));
    if (previous) target.value = previous;
    $('materialTargetField').hidden = !byProgram;
    for (const [field, id] of Object.entries(paletteIds)) refreshPalette(field, id);
    syncAssignment();
  }
  const uniqueModules = $('uniqueModules'),
    exteriorOptions = [['windowShades', $('moduleWindowShades')], ['skylights', $('moduleSkylights')]];
  const similarityFields = PROGRAMS.map((program) => {
    const label = document.createElement('label'),
      readout = document.createElement('output'), slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.setAttribute('aria-label', program.name + ' similarity');
    slider.oninput = () => { readout.value = slider.value + '%'; };
    slider.onchange = () => {
      const settings = (study.assignments.moduleDesign ||= {});
      (settings.similarity ||= {})[program.id] = slider.valueAsNumber;
      applyModuleDesign();
    };
    label.append(program.name + ' similarity', readout, slider);
    $('moduleSimilarity').append(label);
    return { id: program.id, slider, readout };
  });
  function syncModuleDesign() {
    const enabled = study.assignments.moduleDesign?.enabled === true;
    uniqueModules.checked = enabled;
    $('moduleSimilarity').hidden = !enabled;
    $('moduleExteriorOptions').hidden = !enabled;
    for (const [key, input] of exteriorOptions) input.checked = study.assignments.moduleDesign?.[key] !== false;
    for (const { id, slider, readout } of similarityFields) {
      slider.value = moduleSimilarity(study.assignments, id);
      readout.value = slider.value + '%';
    }
    $('moduleSimilarityHint').hidden = !enabled;
    const hint = $('moduleDesignArea');
    if (!enabled) {
      hint.textContent = 'Explore different silhouettes, claddings and windows within the same dock.';
      return;
    }
    const { enclosed, terraces, short } = realizedModuleEnclosure(study.model, study.assignments, study.view.seed);
    hint.textContent = fmt(enclosed) + ' m² enclosed in dock modules · ' + fmt(terraces) +
      ' m² of terraces across ' + short + ' shortened units. Massing still books the full dock allowance.';
  }
  function applyModuleDesign() {
    syncModuleDesign();
    saveStudy();
    refreshAssemblies();
    rebuild();
  }
  uniqueModules.onchange = () => {
    (study.assignments.moduleDesign ||= {}).enabled = uniqueModules.checked;
    applyModuleDesign();
  };
  for (const [key, input] of exteriorOptions) input.onchange = () => {
    (study.assignments.moduleDesign ||= {})[key] = input.checked;
    applyModuleDesign();
  };

  function syncStudy() {
    $('materialSnapshot').textContent =
      'Massing snapshot · Seed ' +
      study.view.seed +
      ' · ' +
      study.view.floors +
      (study.view.floors === 1 ? ' floor' : ' floors') +
      ' · ' +
      study.model.count +
      ' modules';
    $('materialProgramColors').checked = study.programColors;
    $('materialStructureView').checked = study.structureView;
    $('materialShowModules').checked = study.view.showModules !== false;
    $('materialNotes').value = study.notes;
    study.rates = { ...DEFAULT_MATERIAL_RATES, ...study.rates };
    $('returnToAssembly').hidden = false;
    syncTargets();
    syncModuleDesign();
    refreshAssemblies();
    rebuild();
  }

  // Shared building overrides use the options that apply to both construction families.
  function materialFamily() {
    if (['slide', 'mast', 'commercial', 'roofRetail'].includes(scope.value)) return scope.value;
    return scope.value.startsWith('core') ? 'core' : 'module';
  }
  function refreshPalette(field, id) {
    const family = materialFamily(),
      catalogue = MATERIAL_CATALOGUES[field],
      entries = family === 'mast' ? [] : Object.entries(catalogue).filter(([key]) => materialCompatible(field, key, family)),
      filters = $(field + 'Families'),
      previous = filters.value,
      groups = [...new Set(entries.map(([, preset]) => preset.group))];
    filters.replaceChildren(
      option('All families', ''),
      ...groups.map((group) => option(group, group))
    );
    filters.value = groups.includes(previous) ? previous : '';
    $(field + 'Palette').hidden = entries.length === 0;
    const shown = entries.filter(([, preset]) => !filters.value || preset.group === filters.value);
    $(id).replaceChildren(
      ...[['', { name: 'Inherit', short: 'Inherit' }], ...shown].map(([value, preset]) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.material = value;
        chip.title = preset.name;
        chip.setAttribute('aria-label', preset.name);
        const sample = document.createElement('span');
        sample.className = 'material-sample';
        sample.setAttribute('aria-hidden', 'true');
        if (value) {
          sample.style.setProperty('--chip', preset.color);
          if (preset.seam) sample.style.setProperty('--seam', preset.seam);
          if (preset.texture === 'earth') sample.classList.add('earth');
          else if (preset.course) sample.classList.add('course');
          else if (preset.joint) sample.classList.add('joint');
        }
        chip.append(sample, preset.short);
        chip.onclick = () => {
          const key = currentKey(),
            assignment = (study.assignments[key] ||= {});
          if (value) assignment[field] = value;
          else delete assignment[field];
          if (!Object.keys(assignment).length) delete study.assignments[key];
          syncAssignment();
          saveStudy();
          refreshAssemblies();
          rebuild();
        };
        return chip;
      })
    );
  }
  for (const [field, id] of Object.entries(paletteIds))
    $(field + 'Families').onchange = () => {
      refreshPalette(field, id);
      syncAssignment();
    };

  scope.addEventListener('change', syncTargets);
  target.addEventListener('change', syncAssignment);
  for (const [field, id] of [
    ['programColors', 'materialProgramColors'],
    ['structureView', 'materialStructureView']
  ]) {
    $(id).addEventListener('change', () => {
      study[field] = $(id).checked;
      saveStudy();
      rebuild();
    });
  }
  $('materialShowModules').onchange = (event) => {
    study.view.showModules = event.target.checked;
    saveStudy();
    rebuild();
  };
  $('materialNotes').addEventListener('input', () => {
    study.notes = $('materialNotes').value;
    saveStudy();
  });
  $('updateMaterials').addEventListener('click', () => {
    captureMassing();
    syncStudy();
    $('materialStatus').textContent =
      'Updated from massing. Matching material assignments were kept.';
  });
  const snapshotButton = $('saveMaterialSnapshot');
  snapshotButton.addEventListener('click', async () => {
    const date = new Date();
    snapshotButton.disabled = true;
    try {
      const sheet = drawMaterialSnapshot(study, cards, currentVariants, captureMaterialModel, date);
      const png = await new Promise((resolve) => sheet.toBlob(resolve, 'image/png'));
      if (!png) throw Error('The browser could not create a PNG.');
      const filename = 'poly-nation-materials-' + date.toISOString().replace(/[:.]/g, '-') + '.png';
      downloadBlob(png, 'image/png', filename);
      $('materialStatus').textContent = 'Materials snapshot downloaded.';
    } catch (error) {
      console.error('Materials snapshot failed', error);
      $('materialStatus').textContent = 'Could not save the snapshot. Try again.';
    } finally {
      snapshotButton.disabled = false;
    }
  });
  bindModelCamera({
    canvas: materialCanvas,
    getCamera: () => studyCamera,
    getMesh: () => mesh,
    onChange: redraw,
    buttons: { axo: 'materialAxo', plan: 'materialPlan', side: 'materialSide', fit: 'materialFit' }
  });
  document.addEventListener('west-village-change', () => {
    if (!phase.hidden && study) rebuild();
  });

  return {
    open() {
      if (!study) restoreStudy();
      if (!study) captureMassing();
      syncStudy();
    },
    assignments() {
      if (!study) restoreStudy();
      return study?.assignments ?? {};
    }
  };
})();
