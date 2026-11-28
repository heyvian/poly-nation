'use strict';

// Pin and study options are stored in PDF coordinates. Loading the DEM or matching
// geographic controls can refine the geographic position without moving the plan pin.
const siteWorkspace = (() => {
  const panel = $('sitePhase'),
    canvas = $('siteCanvas'),
    plan = $('sitePlacementPlan'),
    footprint = $('siteFootprint'),
    condition = $('siteCondition'),
    depth = $('siteCanalDepth'),
    waterToggle = $('siteShowWater'),
    contours = $('siteContours'),
    vegetation = $('siteVegetation'),
    bearing = $('siteBearing'),
    grade = $('siteGrade'),
    lookout = $('siteCanalLookout'),
    boatCapacity = $('siteBoatCapacity'),
    linkDesign = $('siteLinkDesign'),
    load = $('loadSite'),
    sourcePicker = $('sitePlanSource'),
    status = $('siteStatus'),
    dataStatus = $('siteWaterStatus'),
    registrationStatus = $('siteRegistration'),
    massingControls = [
      [linkDesign, $('designSiteLink')],
      [bearing, $('designSiteBearing')],
      [grade, $('designSiteGrade')],
      [condition, $('designSiteCondition')],
      [depth, $('designSiteDepth')],
      [lookout, $('designSiteLookout')],
      [boatCapacity, $('designSiteBoatCapacity')]
    ],
    key = 'poly-nation-west-village-v1',
    terrainKey = 'poly-nation-west-village-terrain-v1',
    supportCache = new WeakMap(),
    view = { az: -0.84, el: 0.57, zoom: 1, pan: 0, panX: 0 },
    { frame, limits, defaultPin, terrainCentre, terrainSize, sources } = WEST_VILLAGE_PLAN;
  let pin = [...defaultPin],
    registration = WEST_VILLAGE_NOMINAL,
    terrain = null,
    surface = null,
    mapped = null,
    mapLookup = null,
    natural = null,
    directions = null,
    terrainError = '',
    mode = 'plan',
    revision = 0,
    assembly = null,
    assemblyOptions = null,
    scene = null,
    building = null,
    signature = '',
    context = null,
    renderer = null,
    fallback = null,
    design = null,
    lastDesign = null;
  let focusBuilding = false;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) {
      if (Array.isArray(saved.pin) && westVillageInside(saved.pin)) pin = saved.pin;
      condition.value = saved.condition === 'existing' ? 'existing' : 'proposed';
      sourcePicker.value = Object.hasOwn(sources, saved.plan) ? saved.plan : 'master';
      depth.value = clamp(Number(saved.depth) || 2, 0.5, 8);
      bearing.value = mod(Number(saved.bearing) || 0, 360);
      grade.value = clamp(Number(saved.grade) || 0, -20, 20);
      lookout.value = ['outdoor', 'both'].includes(saved.lookout) ? saved.lookout : 'atrium';
      boatCapacity.value = Number(saved.boatCapacity) === 6 ? '6' : '3';
      linkDesign.checked = saved.linkDesign !== false;
      contours.checked = saved.contours !== false;
      waterToggle.checked = saved.water !== false;
      vegetation.checked = saved.vegetation === true;
      mode = saved.mode === 'terrain' ? 'terrain' : 'plan';
      const match = saved.registration;
      if (
        match?.matched &&
        Number.isFinite(westVillageScale(match)) &&
        westVillageScale(match) >= 1.25 &&
        westVillageScale(match) <= 2.3 &&
        [...(match.page ?? []), ...(match.ground ?? [])].length === 4 &&
        [...match.page, ...match.ground].every(Number.isFinite)
      )
        registration = match;
    } else {
      // Keep a prior point if it belongs to the new study. The former GPS form accepted
      // arbitrary sites, so out-of-district points leave the starter pin in place.
      const previous = JSON.parse(localStorage.getItem('poly-nation-site-v1'));
      if (previous) {
        const [latitude, longitude] = (previous.coordinates ?? '').split(',').map(Number);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          const local = siteCoordinates(terrainCentre).project({ lat: latitude, lon: longitude }),
            migrated = westVillageToPage(local, registration);
          if (westVillageInside(migrated)) pin = migrated;
        }
        contours.checked = previous.contours !== false;
        bearing.value = mod(Number(previous.bearing) || 0, 360);
        grade.value = clamp(Number(previous.grade) || 0, -20, 20);
      }
    }
    const cached = JSON.parse(localStorage.getItem(terrainKey));
    if (
      cached &&
      [17, 81].includes(cached.count) &&
      Number.isFinite(cached.datum) &&
      cached.elevations?.length === cached.count ** 2 &&
      cached.elevations.every((height) => Number.isFinite(height) && height > -500 && height < 9000)
    )
      terrain = { ...cached, location: terrainCentre, size: terrainSize, fromCache: true };
  } catch {
    // Site can also run with browser storage disabled.
  }

  function save() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          pin,
          condition: condition.value,
          plan: sourcePicker.value,
          mode,
          registration,
          depth: depth.value,
          grade: grade.value,
          lookout: lookout.value,
          boatCapacity: Number(boatCapacity.value),
          linkDesign: linkDesign.checked,
          bearing: bearing.value,
          contours: contours.checked,
          water: waterToggle.checked,
          vegetation: vegetation.checked
        })
      );
    } catch {
      // Positioning still works when the browser blocks storage.
    }
  }

  function saveTerrain() {
    try {
      const { count, elevations, datum, provider } = terrain;
      localStorage.setItem(terrainKey, JSON.stringify({ count, elevations, datum, provider }));
    } catch {
      // Cached live elevations are a convenience for reopening drawings.
    }
  }

  function refreshSurface() {
    surface = terrain
      ? westVillageWaterFromPlan(terrain, registration, condition.value === 'proposed')
      : null;
  }

  function sceneOptions() {
    return {
      position: westVillageToGround(pin, registration),
      grade: clamp(Number(grade.value) || 0, -20, 20),
      bearing: mod(Number(bearing.value) || 0, 360),
      lookout: lookout.value,
      boatCapacity: Number(boatCapacity.value),
      showContours: contours.checked,
      showWater: waterToggle.checked,
      canalDepth: clamp(Number(depth.value) || 2, 0.5, 8),
      water: surface,
      natural: vegetation.checked ? natural : null
    };
  }

  function supportPlan(model) {
    if (!terrain || !model) return null;
    const options = sceneOptions(), placement = [...options.position, options.grade, options.bearing, options.lookout,
      options.boatCapacity, options.canalDepth].join('/');
    let cached = supportCache.get(model);
    if (cached?.terrain !== terrain || cached.surface !== surface || cached.placement !== placement) {
      const plan = siteFoundationPlan(model, terrain, options);
      cached = { terrain, surface, placement, plan, placed: sitePlacementModel(model, plan) };
      supportCache.set(model, cached);
    }
    return cached.plan;
  }

  function placedModel(model) {
    return supportPlan(model) ? supportCache.get(model).placed : model;
  }

  const linked = () => Boolean(terrain && linkDesign.checked);

  // Share the same water extents and module footprint with the foundation study.
  // The fit only needs local measurements. The full site mesh is assembled after allocation.
  function designConstraints() {
    if (!linked()) return null;
    const { position, bearing, grade, canalDepth, water: districtWater } = sceneOptions(),
      key = [...position, bearing, grade, canalDepth].join('/');
    if (design?.terrain === terrain && design?.surface === districtWater && design.key === key)
      return design.constraints;
    const angle = bearing * Math.PI / 180,
      cos = Math.cos(angle), sin = Math.sin(angle),
      ground = siteTerrainHeight(terrain, ...position),
      water = siteFoundationWater(districtWater, position, 340),
      level = (districtWater?.level ?? terrain.datum) - terrain.datum,
      point = (x, z) => [position[0] + x * cos - z * sin, position[1] + x * sin + z * cos],
      fits = new Map();
    const constraints = {
      position, angle, ground,
      resolve(R, r, slotN, coreEnvelope) {
        const fitKey = [R, r, slotN, coreEnvelope].join('/');
        if (fits.has(fitKey)) return fits.get(fitKey);
        const core = { R, r, slotN, coreEnvelope },
          cutRadius = (radius, azimuth) => coreBoundaryRadius(core, radius, azimuth),
          local = (radius, azimuth) => {
            const station = cutRadius(radius, azimuth);
            return point(station * Math.cos(azimuth), station * Math.sin(azimuth));
          },
          wetBays = new Set(), coreReach = cutRadius(R, Math.PI / slotN),
          reachesWater = water.overlaps(position, R + MODULE.depth + BUILD_SECTION.dockGap + 3),
          cutsCore = reachesWater && water.overlaps(position, coreReach),
          arcCache = new Map(),
          areaCache = new Map();
        if (reachesWater) for (let j = 0; j < slotN; j++) {
          const footprint = siteModuleFootprint(core, { angle: TAU * j / slotN }, position, angle);
          if (water.overlapsFootprint(footprint.corners)) wetBays.add(j);
        }
        function dryArcs(lo, hi, start, end) {
          if (!cutsCore) return [[start, end]];
          const key = [lo, hi, start, end].join('/');
          if (arcCache.has(key)) return arcCache.get(key);
          const steps = Math.max(1, Math.ceil((end - start) * hi / 1.25)), dry = [];
          for (let i = 0; i < steps; i++) {
            const a = start + (end - start) * i / steps, b = start + (end - start) * (i + 1) / steps,
              corners = [local(lo, a), local(hi, a), local(hi, b), local(lo, b)];
            if (water.overlapsFootprint(corners)) continue;
            if (dry.at(-1)?.[1] === a) dry.at(-1)[1] = b;
            else dry.push([a, b]);
          }
          arcCache.set(key, dry);
          return dry;
        }
        function wetArea(lo, hi, start = 0, end = TAU) {
          if (!cutsCore) return 0;
          const key = [lo, hi, start, end].join('/');
          if (areaCache.has(key)) return areaCache.get(key);
          const strips = Math.max(1, Math.ceil((end - start) * hi / 0.75)), step = (end - start) / strips;
          let area = 0;
          for (let i = 0; i < strips; i++) {
            const azimuth = start + (i + 0.5) * step,
              at = siteLine(position, angle + azimuth);
            for (const [a, b] of water.spans(at, cutRadius(lo, azimuth), cutRadius(hi, azimuth)))
              area += (b ** 2 - a ** 2) * step / 2;
          }
          areaCache.set(key, area);
          return area;
        }
        const crosses = reachesWater && Boolean(water.anchor(R + 3.15)),
          base = BUILD_SECTION.slabBase + BUILD_SECTION.slabThickness,
          bankElevations = crosses ? Array.from({ length: 72 }, (_, i) =>
            siteLine(position, i * TAU / 72)(R + 3.15))
            .filter((at) => !water.overlaps(at, 0.5))
            .map((at) => siteTerrainHeight(terrain, ...at)).sort((a, b) => a - b) : [],
          near = bankElevations[Math.floor(bankElevations.length * 0.20)] ?? ground,
          floor = Math.max((crosses ? near + 0.22 : ground + base) + grade,
            crosses ? level + 0.25 : -Infinity);
        const fit = {
          wetBays, cutRing: wetArea(r, R), cutCourt: wetArea(0, r), dryArcs, wetArea,
          dryWalk(azimuth, from, to, width) {
            return !reachesWater || siteDryWalk(water, position, angle + azimuth, from, to, width);
          },
          surfaceBelow(x, z, radius) {
            return Math.max(...[[x, z], [x + radius, z], [x - radius, z], [x, z + radius], [x, z - radius]]
              .map(([dx, dz]) => {
                const at = point(dx, dz);
                return reachesWater && water.overlaps(at) ? level : siteTerrainHeight(terrain, ...at);
              }));
          },
          // The detailed foundation may raise this datum to clear the highest bank.
          floor, foundation: floor - base
        };
        if (fits.size >= 80) fits.clear();
        fits.set(fitKey, fit);
        return fit;
      }
    };
    design = { terrain, surface: districtWater, key, constraints };
    return constraints;
  }

  function present() {
    if (panel.hidden || mode !== 'terrain' || !scene) return;
    if (renderer) paintWebGL(canvas, context, renderer, view);
    else if (fallback) paintSoftware(scene, fallback, view);
  }

  function rebuild(fit = false) {
    if (!terrain || !building || mode !== 'terrain' || panel.hidden) return;
    const plan = supportPlan(building);
    if (!assembly || assembly.sitePlan !== plan) {
      const { assignments, layers, craneSettings } = assemblyOptions;
      assembly = buildAssemblyMesh(placedModel(building), layers, 0, {
        assignments, view: { seed: state.seed }, craneSettings, programColors: false, structureView: false, finishJoints: false
      });
      assembly.sitePlan = plan;
    }
    if (!renderer && !fallback) {
      context = canvas.getContext('webgl', { antialias: true, alpha: false });
      renderer = createWebGLRenderer(context);
      if (!renderer) fallback = createSoftwareRenderer(canvas);
    }
    scene = siteAssemblyMesh(assembly, terrain, { ...sceneOptions(), model: building, supportPlan: plan });
    if (renderer) uploadWebGLMesh(context, renderer, scene);
    if (fit) fitCurrentView();
    present();
  }

  function fitCurrentView() {
    const modelStart = (group) =>
      !group.layer.startsWith('Site ') && group.layer !== 'OpenStreetMap mapped trees';
    fitModel(scene, view, canvas, focusBuilding ? modelStart : undefined);
  }

  function syncStatus() {
    const position = westVillageToGround(pin, registration);
    const supports = supportPlan(building), supportStatus = $('siteSupportStatus');
    supportStatus.hidden = !supports;
    $('siteLinkNote').textContent = terrain
      ? linkDesign.checked ? 'The design views use this placement and the surrounding terrain.' : 'The design views use the standalone building.'
      : 'Load terrain to carry this placement into Massing, Materials, Build, Render and Drawings.';
    if (terrain) {
      const elevation = terrain.datum + siteTerrainHeight(terrain, ...position);
      $('sitePlacementStatus').dataset.elevation = elevation.toFixed(1);
      $('sitePlacementStatus').textContent = supports
        ? `Ground at pin ${elevation.toFixed(1)} m · ground floor ${(terrain.datum + supports.floor).toFixed(1)} m.`
        : `Ground at pin ${elevation.toFixed(1)} m.`;
      if (supports) {
        const spans = supports.rows.reduce((count, row) => count + row.transfers.length, 0),
          piled = supports.perimeter.runs.length || supports.rows.some((row) => row.landward.length),
          landward = piled ? ' Landward stem walls bear on schematic piles.' : '',
          clearance = spans ? Math.min(...supports.rows.flatMap((row) => row.transfers.map(({ depth }) =>
            supports.crossingSoffit - depth - supports.water.level))) : 0,
          structure = spans ? `The level above spans the canal with ${clearance.toFixed(1)} m minimum study clearance.${landward}`
            : piled ? 'Landward stem walls bear on schematic piles.' : 'Footings follow the local grade.',
          atrium = supports.lookouts.filter(({ type }) => type !== 'dock').length,
          openAir = supports.lookouts.some(({ type }) => type === 'dock'),
          lookouts = (atrium === 2 ? ' Two glazed public lookouts open off the first elevated floor inside the atrium.'
            : atrium ? ' A glazed public lookout opens off the first elevated floor inside the atrium.'
              : supports.anchor && lookout.value !== 'outdoor' ? ' No clear public landing overlooks the canal inside the atrium at this placement.' : '') +
            (openAir ? ' An open-air lookout uses a public dock on the first elevated floor.'
              : lookout.value !== 'atrium' ? ' This placement needs an available upper dock overlooking the canal for the open-air lookout.' : ''),
          arrivals = supports.accesses.filter((route) => route.arrival).length,
          forecourts = building.plaza.arrivals?.length && arrivals < building.plaza.arrivals.length
            ? ` ${arrivals ? 'One walk reaches' : 'An approach needs dry ground to reach'} beyond the elevated track.` : '',
          access = supports.accesses.length === 2 ? ' Both lobbies have step-free walks from grade.' : supports.accesses.length === 1
            ? ' One lobby has a step-free walk from grade. The other needs a different alignment.'
            : ' The lobby approaches need a different alignment to meet dry grade.',
          dryArea = supports.lowerRooms.reduce((total, room) => total + room.area, 0),
          dry = dryArea > 0 ? ` ${Math.round(dryArea)} m² of additional lower-level programme.` : '',
          boat = supports.boatBay ? ` The marine hall houses ${supports.boatBay.capacity} boats and ${Math.round(supports.boatBay.maintenanceArea)} m² of landward servicing space.` +
            (supports.boatBay.route ? '' : ' The service entrance needs a dry approach.')
            : condition.value !== 'proposed' ? '' : sceneOptions().canalDepth < SITE_MIN_FIREBOAT_DEPTH
              ? ` The fireboat hall needs at least ${SITE_MIN_FIREBOAT_DEPTH.toFixed(2)} m of modeled water for draft and under-keel clearance.`
              : ` No dry bank fits the selected ${boatCapacity.value}-boat hall and its launch apron at this placement.`,
          clearBays = supports.omitted.size ? ` ${supports.omitted.size} ground-level dock bays reserved over water.` : '',
          moat = supports.moat?.connected ? ' The moat shares the district water level.' : '',
          runway = (supports.runway ?? supports.moat?.runway)?.unresolved ? ' Long runway crossings need a separate span study.' : '';
        supportStatus.textContent = (supports.unresolved ? 'The footprint crosses water beyond the available bank supports.' : structure) +
          lookouts + access + forecourts + clearBays + dry + boat + moat + runway;
      }
    } else {
      delete $('sitePlacementStatus').dataset.elevation;
      $('sitePlacementStatus').textContent = 'The pin is saved in the studio plan.';
    }
    if (directions) $('sitePlacementStatus').textContent = directions;
    registrationStatus.textContent = registration.matched
      ? 'The studio plan is matched to the Crowchild Trail and 14 Street Bow River crossings.'
      : 'The studio plan uses an approximate district registration at its nominal scale. Live bridge controls refine it when available.';
    if (terrain) {
      const { elevations, provider, fromCache } = terrain,
        relief = Math.max(...elevations) - Math.min(...elevations);
      if (!load.disabled && !terrainError)
        status.textContent = `${provider} · ${relief.toFixed(1)} m of relief${fromCache ? ' · cached elevations' : ''}.`;
      const method = registration.matched
        ? 'Matched at two Bow River crossings.'
        : 'Approximate plan registration.';
      const trees = vegetation.checked
        ? natural?.count
          ? ' Mapped vegetation is shown.'
          : mapLookup
            ? ' Looking up mapped vegetation…'
            : ' Mapped vegetation is unavailable.'
        : '';
      dataStatus.textContent = `Bow River study level ${surface.level.toFixed(1)} m. ${method}${trees}`;
    }
    for (const [source, mirror] of massingControls) {
      if (!source || !mirror) continue;
      if (source.type === 'checkbox') mirror.checked = source.checked;
      else mirror.value = source.value;
    }
    $('designSiteDepthField').hidden = condition.value !== 'proposed';
    $('designSitePlacement').textContent = terrainError || $('sitePlacementStatus').textContent;
    $('designSiteLoad').disabled = load.disabled;
    $('designSiteLoad').textContent = load.disabled ? 'Loading terrain…' : terrain ? 'Reload terrain' : 'Load terrain';
  }

  function updatePlan() {
    const source = sources[sourcePicker.value],
      showOverlays = sourcePicker.value !== 'water';
    $('sitePlanImage').setAttribute('href', source.image);
    $('siteSheetName').textContent = source.title + (showOverlays ? '' : ' · Full proposal');
    $('sitePlanRiver').style.display = showOverlays ? '' : 'none';
    $('sitePlanCanals').style.display =
      showOverlays && condition.value === 'proposed' ? '' : 'none';
    $('siteWaterKey').hidden = !showOverlays;
    $('siteProposedKey').hidden = condition.value !== 'proposed';
    $('siteDepthField').hidden = condition.value !== 'proposed';
    const scale = westVillageScale(registration),
      radius = (building?.R ?? 35) / scale,
      edge = building
        ? Math.max(building.R + MODULE.depth + 2, building.plaza.outer) / scale
        : radius,
      conflicts =
        westVillageOverlaps(pin, edge, WEST_VILLAGE_WATER.river) ||
        (condition.value === 'proposed' &&
          westVillageOverlaps(pin, edge, WEST_VILLAGE_WATER.canals));
    footprint.setAttribute('transform', `translate(${pin.join(' ')})`);
    footprint.dataset.water = String(conflicts);
    $('siteFootprintCore').setAttribute('r', radius);
    $('siteFootprintExtent').setAttribute('r', edge);
    $('siteFootprintAxis').setAttribute(
      'd',
      `M0 ${-radius} V${-radius * 0.45} M0 ${radius} V${radius * 0.45}`
    );
    const adjustment = (Math.atan2(-registration.b, -registration.a) * 180) / Math.PI;
    $('siteFootprintAxis').setAttribute(
      'transform',
      `rotate(${sceneOptions().bearing - adjustment})`
    );
    $('sitePlanHelp').textContent = conflicts
      ? terrain ? 'The footprint overlaps a waterway. Open 3D terrain to inspect the crossing supports.'
        : 'The footprint overlaps a waterway. Load the terrain to study the crossing supports.'
      : 'Click inside the dashed boundary to place the building. Arrow keys move it 5 m.';
  }

  function changed({ refreshWater = false, fit = false } = {}) {
    if (refreshWater) refreshSurface();
    revision++;
    const activeDesign = designConstraints();
    if (lastDesign !== activeDesign && model) update({ preserveAllocation: true });
    building = model ?? building;
    lastDesign = activeDesign;
    updatePlan();
    syncStatus();
    rebuild(fit);
    save();
    document.dispatchEvent(new CustomEvent('west-village-change', { detail: { model } }));
  }

  let queuedChange;
  function queueChange({ refreshWater = false } = {}) {
    if (!terrain) return changed({ refreshWater });
    if (queuedChange) {
      queuedChange.refreshWater ||= refreshWater;
      return;
    }
    queuedChange = { refreshWater };
    return appWork.run('Updating the site and building…', () => {
      const options = queuedChange;
      queuedChange = null;
      changed(options);
    });
  }

  function setMode(value, draw = true) {
    mode = value;
    const showPlan = mode === 'plan';
    $('sitePlaceMode').setAttribute('aria-pressed', String(showPlan));
    $('siteTerrainMode').setAttribute('aria-pressed', String(!showPlan));
    $('sitePlanPanel').hidden = $('sitePlanField').hidden = !showPlan;
    $('siteTerrainPanel').hidden = showPlan;
    $('siteTerrainEmpty').hidden = Boolean(terrain);
    $('siteViewport').hidden = !terrain;
    if (draw && !showPlan && terrain) appWork.run('Preparing the site view…', () => {
      if (mode === value) rebuild(!scene);
    });
    save();
  }

  async function lookupMap() {
    if (mapLookup) return mapLookup;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 23000),
      includeVegetation = vegetation.checked;
    mapLookup = (async () => {
      try {
        const elements = await fetchSiteNaturalFeatures(
          terrainCentre,
          terrainSize,
          true,
          controller.signal,
          includeVegetation
        );
        const match = matchWestVillagePlan(elements),
          relocated = match && JSON.stringify(match) !== JSON.stringify(registration);
        function applyMap() {
          if (relocated) registration = match;
          if (includeVegetation) {
            mapped = elements;
            if (terrain) natural = siteNaturalOverlay(mapped, terrain);
          }
          changed({ refreshWater: relocated });
        }
        if (terrain && (relocated || includeVegetation)) await appWork.run('Updating the site map…', applyMap);
        else if (relocated || includeVegetation) applyMap();
      } catch {
        // The material supplied for the studio already contains the river and canal outlines.
      } finally {
        clearTimeout(timeout);
        mapLookup = null;
        if (terrain) syncStatus();
        if (!includeVegetation && vegetation.checked) lookupMap();
      }
    })();
    return mapLookup;
  }

  load.onclick = async () => {
    if (load.disabled) return;
    load.disabled = true;
    $('designSiteLoad').disabled = true;
    $('designSiteLoad').textContent = 'Loading terrain…';
    status.textContent = 'Loading live terrain…';
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 26000);
    // Map alignment runs independently. An unavailable map provider cannot withhold
    // the elevation surface or delete the river that is already on the studio plan.
    lookupMap();
    try {
      await appWork.run('Loading terrain and updating the building…', async () => {
        terrain = await loadWestVillageTerrain(controller.signal);
        natural = mapped && vegetation.checked ? siteNaturalOverlay(mapped, terrain) : null;
        saveTerrain();
        directions = null;
        refreshSurface();
        terrainError = '';
        setMode('terrain', false);
        changed({ fit: true });
        load.textContent = 'Reload live terrain';
      });
    } catch {
      terrainError = terrain
        ? 'Live refresh was unavailable. The previous elevation surface is still shown.'
        : 'Live elevation providers are unavailable. You can continue placing the building on the plan.';
      status.textContent = terrainError;
    } finally {
      clearTimeout(timeout);
      load.disabled = false;
      syncStatus();
    }
  };

  function place(point) {
    if (!westVillageInside(point)) {
      directions = 'Choose a point inside the dashed West Village boundary.';
      syncStatus();
      return;
    }
    directions = null;
    pin = point;
    // Returning from the plan should follow the moved building when its close-up is active.
    if (focusBuilding) scene = null;
    return queueChange();
  }

  const [left, top, width, height] = frame,
    [west, north, east, south] = limits;
  plan.setAttribute('viewBox', frame.join(' '));
  for (const [id, x, y, w, h] of [
    ['sitePlanImage', left, top, width, height],
    ['siteStudyLimits', west, north, east - west, south - north]
  ]) {
    const element = $(id);
    for (const [name, value] of Object.entries({ x, y, width: w, height: h }))
      element.setAttribute(name, value);
  }
  const svgTriangles = (triangles) =>
    triangles.map(([x, y, u, v, p, q]) => `M${x} ${y}L${u} ${v} ${p} ${q}Z`).join('');
  $('sitePlanRiver').setAttribute('d', svgTriangles(WEST_VILLAGE_WATER.river));
  $('sitePlanCanals').setAttribute('d', svgTriangles(WEST_VILLAGE_WATER.canals));
  plan.onclick = (event) => {
    const screen = plan.getScreenCTM();
    if (!screen) return;
    const { x, y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(screen.inverse());
    place([x, y]);
  };
  plan.onkeydown = (event) => {
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = offsets[event.key];
    if (!move) return;
    event.preventDefault();
    const step = (event.shiftKey ? 20 : 5) / westVillageScale(registration);
    place(pin.map((coordinate, index) => coordinate + step * move[index]));
  };

  $('sitePlaceMode').onclick = () => setMode('plan');
  $('siteTerrainMode').onclick = () => setMode('terrain');
  $('siteFocus').onclick = () => {
    focusBuilding = true;
    fitCurrentView();
    present();
  };
  sourcePicker.onchange = () => {
    updatePlan();
    save();
  };
  condition.onchange = () => queueChange({ refreshWater: true });
  lookout.onchange = boatCapacity.onchange = linkDesign.onchange = () => queueChange();
  depth.onchange =
    bearing.onchange =
    grade.onchange =
      () => {
        depth.value = sceneOptions().canalDepth;
        bearing.value = sceneOptions().bearing;
        grade.value = sceneOptions().grade;
        queueChange();
      };
  contours.onchange = waterToggle.onchange = () => queueChange();
  vegetation.onchange = () => {
    if (vegetation.checked && terrain) {
      if (mapped) natural = siteNaturalOverlay(mapped, terrain);
      else lookupMap();
    }
    queueChange();
  };
  for (const [source, mirror] of massingControls) {
    if (!source || !mirror) continue;
    mirror.onchange = () => {
      if (source.type === 'checkbox') source.checked = mirror.checked;
      else source.value = mirror.value;
      source.dispatchEvent(new Event('change'));
    };
  }
  for (const [direction, dx, dz] of [['North', 0, 5], ['West', 5, 0], ['South', 0, -5], ['East', -5, 0]]) {
    $('designSiteMove' + direction).onclick = () => {
      const [x, z] = westVillageToGround(pin, registration);
      place(westVillageToPage([x + dx, z + dz], registration));
    };
  }
  $('designSiteOpen').onclick = () => $('openSite').click();
  $('designSiteLoad').onclick = () => load.click();

  bindModelCamera({
    canvas,
    getCamera: () => view,
    getMesh: () => scene,
    onChange: present,
    panLimit: terrainSize,
    minimumZoom: 0.018,
    buttons: { axo: 'siteAxo', plan: 'sitePlan' }
  });
  $('siteFit').onclick = () => {
    focusBuilding = false;
    fitCurrentView();
    present();
  };
  new ResizeObserver(present).observe(canvas);
  refreshSurface();
  lastDesign = designConstraints();
  updatePlan();
  syncStatus();
  if (terrain) load.textContent = 'Reload live terrain';

  return {
    designConstraints,
    designStudyKey() {
      if (!linked()) return null;
      return [condition.value, lookout.value, grade.value, depth.value, boatCapacity.value,
        terrain.provider, surface?.level].join('/');
    },
    get hasTerrain() {
      return Boolean(terrain);
    },
    get linked() {
      return linked();
    },
    get revision() {
      return revision;
    },
    get drawingBearing() {
      return sceneOptions().bearing;
    },
    placedModel,
    designModel(model) {
      return linked() ? placedModel(model) : model;
    },
    composeDesign(mesh, model, includeTerrain = true) {
      if (!linked()) return mesh;
      const support = supportPlan(model);
      return siteAssemblyMesh(mesh, terrain, { ...sceneOptions(), model, supportPlan: support,
        buildingCoordinates: true, includeTerrain,
        contextRadius: Math.max(support.gradeReach, support.contextReach) + 25 });
    },
    composeDrawing(mesh, model, includeTerrain = true) {
      if (!terrain) return mesh;
      const support = supportPlan(model);
      return siteAssemblyMesh(mesh, terrain, { ...sceneOptions(), relativeToBuilding: true, includeTerrain,
        model, supportPlan: support, contextRadius: Math.max(support.gradeReach, support.contextReach) + 25 });
    },
    sectionStudy(model, assignments) {
      const plan = supportPlan(model);
      if (!plan) return null;
      const placed = placedModel(model), { dockStructure, slabThickness } = buildViewLayers(),
        layers = { dockStructure, slabThickness, slabs: true, frame: true, facade: true,
          docks: true, modules: true, crane: Boolean(plan.crane), swings: true, moduleInteriors: false },
        view = { ...state, craneStage: 'parked',
          craneBearing: plan.moat ? model.lobby.angle * 180 / Math.PI + 90 : state.craneBearing },
        building = buildAssemblyMesh(placed, layers, Math.min(2, model.layers.length),
          { assignments, view, craneSettings: view }),
        placement = { ...sceneOptions(), relativeToBuilding: true, includeTerrain: false, model, supportPlan: plan },
        mesh = siteAssemblyMesh(building, terrain, placement),
        frame = buildAssemblyMesh(placed, { ...layers, facade: false, modules: false }, 0,
          { assignments, view, craneSettings: view }),
        structure = siteAssemblyMesh(frame, terrain, placement),
        overview = buildMesh(placed, false, { ...view, floors: model.layers.length, inspect: 0, grid: false,
          xray: false, programEditing: false, showRooms: false, showFacade: true, showModules: true,
          roof: true, showRoofDeck: true, supports: false }),
        context = siteAssemblyMesh(overview, terrain, { ...placement, includeFoundations: false }),
        district = siteDistrictCut(plan, plan.surface, registration);
      return { plan, mesh, structure, context, district, dockStructure, surface: plan.surface, canalDepth: placement.canalDepth };
    },
    open(model, assignments) {
      const modelChanged = building !== model;
      building = model;
      // Site shows the finished project, using the selected system and slab from Build.
      const { dockStructure, slabThickness } = buildViewLayers(),
        layers = {
          dockStructure,
          slabThickness,
          ...Object.fromEntries(Object.keys(BUILD_LAYERS).map((layer) => [layer, true])),
          moduleInteriors: false
        },
        craneSettings = state.craneStage === 'caterpillar' ? craneCaterpillarPreview() : undefined,
        next = JSON.stringify([assignments, layers, craneSettings, climateFinStamp(model)]);
      if (modelChanged || signature !== next) {
        signature = next;
        assemblyOptions = { assignments, layers, craneSettings };
        assembly = null;
        scene = null;
      }
      updatePlan();
      syncStatus();
      setMode(mode);
      if (terrain && vegetation.checked && !mapped) lookupMap();
    }
  };
})();
