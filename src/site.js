'use strict';

// The footprint stays in PDF coordinates while the survey landmarks register the sheets to the DEM.
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
    landmarkStatus = $('siteLandmarkStatus'),
    landmarkFields = ['siteLandmarkPumpTop', 'siteLandmarkPumpSouth', 'siteLandmarkGreyhound'].map($),
    defaultLandmarks = WEST_VILLAGE_LANDMARKS.map(({ gps }) => gps),
    defaultRegistration = westVillageLandmarkRegistration(defaultLandmarks) ?? WEST_VILLAGE_NOMINAL,
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
    { frame, limits, defaultPin, parcel, terrainCentre, terrainSize, sources } = WEST_VILLAGE_PLAN;
  let pin = [...defaultPin],
    landmarks = defaultLandmarks,
    registration = defaultRegistration,
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

  sourcePicker.value = 'combined';
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved) {
      if (Array.isArray(saved.pin)) {
        if (westVillageInside(saved.pin)) pin = saved.pin;
        else directions = 'The saved pin was outside Parcel 4. The current pin starts inside Parcel 4.';
      }
      condition.value = saved.condition === 'existing' ? 'existing' : 'proposed';
      sourcePicker.value = Object.hasOwn(sources, saved.plan) ? saved.plan : 'combined';
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
      const match = westVillageLandmarkRegistration(saved.landmarks);
      if (match) {
        landmarks = saved.landmarks;
        registration = match;
      }
    } else {
      // Keep a prior point if it belongs to the new study. The former GPS form accepted
      // arbitrary sites, so points outside Parcel 4 leave the starter pin in place.
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
          landmarks,
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
      registration,
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
    const { position, bearing, grade, canalDepth, boatCapacity, water: districtWater } = sceneOptions(),
      key = [...position, bearing, grade, canalDepth, boatCapacity].join('/');
    if (design?.terrain === terrain && design?.surface === districtWater && design.key === key)
      return design.constraints;
    const angle = bearing * Math.PI / 180,
      cos = Math.cos(angle), sin = Math.sin(angle),
      ground = siteTerrainHeight(terrain, ...position),
      water = siteFoundationWater(districtWater, position, 340),
      level = (districtWater?.level ?? terrain.datum) - terrain.datum,
      point = (x, z) => [position[0] + x * cos - z * sin, position[1] + x * sin + z * cos],
      context = siteDistrictObstacles(registration, terrain, districtWater),
      fits = new Map();
    const marineStudy = Boolean(districtWater?.proposed?.length);
    const constraints = {
      position, angle, ground, marineStudy,
      marineReserve: marineStudy && canalDepth >= SITE_MIN_FIREBOAT_DEPTH ? siteFirehallReserve(boatCapacity) : 0,
      fitFirehall(building, floor) {
        const bay = siteFirehallBoatBay(building, position, districtWater, terrain,
          building.lobby.angle + angle, boatCapacity, { floor, context });
        if (!bay) return null;
        const { at, point, ...geometry } = bay;
        return geometry;
      },
      resolve(R, r, slotN, coreEnvelope) {
        const fitKey = [R, r, slotN, coreEnvelope, state.floors, state.slabThickness, state.craneRunway].join('/');
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
        const dockFootprints = Array.from({ length: slotN }, (_, j) =>
          siteModuleFootprint(core, { angle: TAU * j / slotN }, position, angle));
        if (reachesWater) for (const [j, footprint] of dockFootprints.entries()) {
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
          envelope = Math.max(R + 3.15, Math.hypot(R + BUILD_SECTION.dockGap + MODULE.depth + 2.05, MODULE.width / 2 + 0.4)),
          groundSlots = dockFootprints.map((_, j) => ({ f: 0, j, i: j, angle: TAU * j / slotN })),
          gradeFit = reachesWater ? siteGroundStorey({ ...core, slots: groundSlots }, terrain, position, angle, R + 3.15, water) : null,
          floor = Math.max((gradeFit && crosses ? gradeFit.near + 0.22 : ground + base) + grade,
            gradeFit && crosses ? gradeFit.peak - 2 : (gradeFit?.peak ?? siteTerrainMaximum(terrain, position, envelope)) + 0.24,
            crosses ? level + 0.25 : -Infinity),
          floorHigh = state.craneRunway === 'moat' ? Math.max(floor, level + base + 0.65) : floor,
          contextBays = new Set(), pitch = floorPitch(state.slabThickness);
        for (const [j, footprint] of dockFootprints.entries()) {
          if (!context(footprint.corners)) continue;
          const cosDock = Math.cos(footprint.angle), sinDock = Math.sin(footprint.angle);
          for (let f = 0; f < state.floors; f++) {
            const y = floor + f * pitch,
              lower = ([x, , z]) => {
                const station = (x - position[0]) * cosDock + (z - position[1]) * sinDock;
                return y - dockTrussDepth(clamp((station - R) / (MODULE.depth + BUILD_SECTION.dockGap), 0, 1)) - 0.15;
              };
            if (context(footprint.corners, lower, floorHigh + f * pitch + MODULE.height + 0.22)) contextBays.add(f * slotN + j);
          }
        }
        const fit = {
          wetBays, contextBays, cutRing: wetArea(r, R), cutCourt: wetArea(0, r), dryArcs, wetArea,
          clearContext(azimuth, from, to, width, low, high) {
            const left = siteLine(position, angle + azimuth, -width / 2), right = siteLine(position, angle + azimuth, width / 2);
            return !context([left(from), left(to), right(to), right(from)], floor - base + low, floorHigh - base + high);
          },
          clearsPoint(x, z, radius, y) {
            return !context([point(x - radius, z - radius), point(x + radius, z - radius),
              point(x + radius, z + radius), point(x - radius, z + radius)], floor - base + y - radius, floorHigh - base + y + radius);
          },
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
    const circulation = scene.districtCirculation, circulationStatus = $('siteCirculationStatus');
    circulationStatus.hidden = !circulation;
    if (circulation) {
      const { bridges, interrupted, steepApproaches } = circulation;
      circulationStatus.textContent = `${bridges} mapped pedestrian ${bridges === 1 ? 'bridge' : 'bridges'}.` +
        (interrupted ? ` ${interrupted} ${interrupted === 1 ? 'crossing is' : 'crossings are'} interrupted by the project footprint.` : '') +
        (steepApproaches ? ` ${steepApproaches} ${steepApproaches === 1 ? 'bridge has an approach' : 'bridges have approaches'} above the 5% study grade.` : '');
    }
    if (renderer) uploadWebGLMesh(context, renderer, scene);
    if (fit) fitCurrentView();
    present();
  }

  function fitCurrentView() {
    const nearbyTheatre = building && westVillagePumphouseDistance(sceneOptions().position, registration) <
      (building.crane?.extent ?? building.R + MODULE.depth) + 40;
    const modelStart = (group) =>
      (nearbyTheatre && group.layer === 'Site_District_Pumphouse_Theatre') ||
      (!group.layer.startsWith('Site ') && !group.layer.startsWith('Site_District_') &&
        group.layer !== 'OpenStreetMap mapped trees');
    const districtStart = (group) => group.layer === 'Site_District_Paths';
    const start = focusBuilding ? modelStart : scene?.groups.some(districtStart) ? districtStart : undefined;
    fitModel(scene, view, canvas, start);
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
          boat = supports.boatBay ? ` A ${Math.round(supports.boatBay.connection.length)} m enclosed crew gallery connects the core to the ${supports.boatBay.capacity}-boat Firehall.`
            : condition.value !== 'proposed' ? '' : sceneOptions().canalDepth < SITE_MIN_FIREBOAT_DEPTH
              ? ` The fireboat hall needs at least ${SITE_MIN_FIREBOAT_DEPTH.toFixed(2)} m of modeled water for draft and under-keel clearance.`
              : !linked() ? ' Link the site to the design to fit the Firehall and its core connection.'
                : ` The ${boatCapacity.value}-boat Firehall needs a canal bank with room for an enclosed route to the core.`,
          clearBays = supports.omitted.size ? ` ${supports.omitted.size} ground-level dock bays reserved over water.` : '',
          contextDocks = building.siteGeometry?.contextBays?.size ?? 0,
          contextNote = contextDocks ? ` ${contextDocks} dock positions are unavailable where they intersect the mapped bridges or theatre.` : '',
          moat = supports.moat?.connected ? ' The moat shares the district water level.' : '',
          runway = (supports.runway ?? supports.moat?.runway)?.unresolved ? ' Long runway crossings need a separate span study.' : '',
          theatreDistance = westVillagePumphouseDistance(position, registration),
          theatre = theatreDistance < building.R + 0.35 ? ' The core overlaps Pumphouse Theatre at this pin.'
            : theatreDistance < (building.crane?.extent ?? building.R + MODULE.depth)
              ? ' The project envelope reaches the existing Pumphouse Theatre at this pin.' : '';
        supportStatus.textContent = (supports.unresolved ? 'The footprint crosses water beyond the available bank supports.' : structure) +
          lookouts + access + forecourts + clearBays + contextNote + dry + boat + moat + runway + theatre;
      }
    } else {
      delete $('sitePlacementStatus').dataset.elevation;
      $('sitePlacementStatus').textContent = 'The project pin is inside Parcel 4.';
    }
    if (directions) $('sitePlacementStatus').textContent = directions;
    else if (footprint.dataset.pastParcel === 'true')
      $('sitePlacementStatus').textContent += ' The projected project envelope extends past the parcel boundary.';
    registrationStatus.textContent = registration.method === 'landmarks'
      ? `Three GPS landmarks register the plan. The control points differ from the fitted plan by ${registration.rms.toFixed(2)} m RMS.`
      : 'The studio plan is shown at its nominal scale. Enter the landmark coordinates to register it to the terrain.';
    if (terrain) {
      const { elevations, provider, fromCache } = terrain,
        relief = Math.max(...elevations) - Math.min(...elevations);
      if (!load.disabled && !terrainError)
        status.textContent = `${provider} · ${relief.toFixed(1)} m of relief${fromCache ? ' · cached elevations' : ''}.`;
      const method = registration.method === 'landmarks'
        ? 'Registered to the three GPS landmarks.'
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
    const source = sources[sourcePicker.value] ?? sources.combined,
      proposed = condition.value === 'proposed',
      existing = !proposed && source.existing ? sources[source.existing] : null,
      showOverlays = Boolean(existing) || !source.proposedWater;
    $('sitePlanImage').setAttribute('href', (existing ?? source).image);
    $('siteSheetName').textContent = source.title + (existing ? ' · Existing ground' : showOverlays ? '' : ' · Full proposal');
    $('sitePlanRiver').style.display = showOverlays ? '' : 'none';
    $('sitePlanCanals').style.display =
      showOverlays && proposed ? '' : 'none';
    const withPaths = sourcePicker.value === 'combined' || sourcePicker.value === 'circulation',
      pathKey = $('sitePathKey');
    $('siteWaterKey').hidden = !showOverlays && !withPaths;
    if (pathKey) pathKey.hidden = !withPaths;
    $('siteProposedKey').hidden = condition.value !== 'proposed';
    $('siteDepthField').hidden = condition.value !== 'proposed';
    const scale = westVillageScale(registration),
      radius = (building?.R ?? 35) / scale,
      edge = building
        ? Math.max(building.R + MODULE.depth + 2, building.plaza.outer, building.crane?.extent ?? 0) / scale
        : radius,
      conflicts =
        westVillageOverlaps(pin, edge, WEST_VILLAGE_WATER.river) ||
        (proposed &&
          westVillageOverlaps(pin, edge, WEST_VILLAGE_WATER.canals));
    footprint.setAttribute('transform', `translate(${pin.join(' ')})`);
    footprint.dataset.water = String(conflicts);
    const pastParcel = edge > westVillageParcelEdge(pin);
    footprint.dataset.pastParcel = String(pastParcel);
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
    $('sitePlanHelp').textContent = [
      'Click inside Parcel 4 to place the building. Arrow keys move it 5 m.',
      pastParcel && 'The projected project envelope extends past the parcel boundary.',
      westVillagePumphouseDistance(westVillageToGround(pin, registration), registration) < edge * scale &&
        'The project envelope reaches the existing Pumphouse Theatre.',
      conflicts && (terrain ? 'Open 3D terrain to inspect the water crossing.'
        : 'Load terrain to study the water crossing.')
    ].filter(Boolean).join(' ');
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
  function queueChange({ refreshWater = false, fit = false } = {}) {
    if (!terrain) return changed({ refreshWater, fit });
    if (queuedChange) {
      queuedChange.refreshWater ||= refreshWater;
      queuedChange.fit ||= fit;
      return;
    }
    queuedChange = { refreshWater, fit };
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
    $('siteCirculationStatus').hidden = true;
    $('siteTerrainEmpty').hidden = Boolean(terrain);
    $('siteViewport').hidden = !terrain;
    if (draw && !showPlan && terrain) appWork.run('Preparing the site view…', () => {
      if (mode === value) rebuild(!scene);
    });
    save();
  }

  async function lookupMap() {
    if (mapLookup) return mapLookup;
    if (!vegetation.checked || mapped) return null;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 23000);
    mapLookup = (async () => {
      try {
        mapped = await fetchSiteNaturalFeatures(
          terrainCentre,
          terrainSize,
          false,
          controller.signal
        );
        function applyMap() {
          if (!vegetation.checked) return;
          natural = siteNaturalOverlay(mapped, terrain);
          changed();
        }
        if (terrain && vegetation.checked) await appWork.run('Updating mapped vegetation…', applyMap);
      } catch {
        // The registered studio sheets still supply the district and waterway geometry.
      } finally {
        clearTimeout(timeout);
        mapLookup = null;
        if (terrain) syncStatus();
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
    // Optional vegetation loads separately from the elevations and GPS registration.
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
      directions = 'Choose a point inside Parcel 4.';
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
  $('sitePumphouseFootprint').setAttribute('points', WEST_VILLAGE_PUMPHOUSE.footprint.map(point => point.join(',')).join(' '));
  $('sitePumphouseHeight').textContent = `${WEST_VILLAGE_PUMPHOUSE.name} uses the mapped footprint and an estimated ${WEST_VILLAGE_PUMPHOUSE.height} m height.`;
  $('siteParcelBoundary')?.setAttribute('points', parcel.map((point) => point.join(',')).join(' '));
  $('siteParcelLabel')?.setAttribute('x', '329');
  $('siteParcelLabel')?.setAttribute('y', '492');
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
  function syncLandmarkFields() {
    landmarkFields.forEach((field, i) => {
      if (field) field.value = landmarks[i].join(', ');
    });
  }
  function setLandmarks(coordinates, message) {
    const fit = westVillageLandmarkRegistration(coordinates);
    if (!fit) {
      landmarkStatus.textContent = 'Enter three distinct Calgary latitude and longitude pairs in the order shown.';
      return;
    }
    landmarks = coordinates;
    registration = fit;
    directions = null;
    landmarkStatus.textContent = message;
    syncLandmarkFields();
    queueChange({ refreshWater: true, fit: true });
  }
  const applyLandmarks = $('siteApplyLandmarks'), resetLandmarks = $('siteResetLandmarks');
  if (applyLandmarks && resetLandmarks && landmarkFields.every(Boolean)) {
    applyLandmarks.onclick = () => setLandmarks(landmarkFields.map((field) => {
      const values = field.value.trim().replace(/^@\s*/, '').replace(/−/g, '-').split(/[\s,]+/);
      return values.length === 2 && values.every(Boolean) ? values.map(Number) : null;
    }), 'GPS registration updated.');
    resetLandmarks.onclick = () => setLandmarks(defaultLandmarks, 'Supplied landmark coordinates restored.');
    syncLandmarkFields();
  }
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
    get registration() {
      return registration;
    },
    placedModel,
    designModel(model) {
      return linked() ? placedModel(model) : model;
    },
    composeDesign(mesh, model, includeTerrain = true) {
      if (!linked()) return mesh;
      const support = supportPlan(model);
      return siteAssemblyMesh(mesh, terrain, { ...sceneOptions(), model, supportPlan: support,
        buildingCoordinates: true, includeTerrain, includeDistrictPaths: false,
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
        mesh = siteAssemblyMesh(building, terrain, { ...placement, registration, includeDistrictPaths: true }),
        frame = buildAssemblyMesh(placed, { ...layers, facade: false, modules: false }, 0,
          { assignments, view, craneSettings: view }),
        structure = siteAssemblyMesh(frame, terrain, placement),
        overview = buildMesh(placed, false, { ...view, floors: model.layers.length, inspect: 0, grid: false,
          xray: false, programEditing: false, showRooms: false, showFacade: true, showModules: true,
          roof: true, showRoofDeck: true, supports: false }),
        context = siteAssemblyMesh(overview, terrain, { ...placement, includeContextBuildings: true }),
        district = siteDistrictCut(plan, plan.surface, registration);
      return { plan, mesh, structure, context, district, dockStructure, registration,
        surface: plan.surface, canalDepth: placement.canalDepth };
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
