'use strict';

// Drawing settings and clipping belong to this sheet, independently of the 3D workspaces.
const openDrawingWorkspace = (() => {
  const panel = $('drawingsPhase'),
    sheet = $('drawingSheet'),
    paperFrame = $('drawingPaperFrame'),
    status = $('drawingStatus'),
    exportButton = $('exportDrawing'),
    printButton = $('printDrawing'),
    storageKey = 'poly-nation-drawings-v1',
    svgNS = 'http://www.w3.org/2000/svg',
    layerNS = 'http://www.inkscape.org/namespaces/inkscape',
    clip = document.createElementNS(svgNS, 'clipPath'),
    clipRect = document.createElementNS(svgNS, 'rect'),
    drawingArea = document.createElementNS(svgNS, 'g'),
    content = document.createElementNS(svgNS, 'g'),
    floorTiles = document.createElementNS(svgNS, 'g'),
    paperLayer = document.createElementNS(svgNS, 'g'),
    sheetArtwork = document.createElementNS(svgNS, 'g'),
    footer = document.createElementNS(svgNS, 'g'),
    footerRule = document.createElementNS(svgNS, 'line'),
    footerTitle = document.createElementNS(svgNS, 'text'),
    footerScale = document.createElementNS(svgNS, 'g'),
    pageStyle = document.createElement('style'),
    paperSizes = { letter: [8.5, 11], tabloid: [11, 17] },
    compassPoints = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    compassNames = [
      'north',
      'northeast',
      'east',
      'southeast',
      'south',
      'southwest',
      'west',
      'northwest'
    ],
    viewNames = ['axo', 'plan', 'elevation', 'aligned'];
  const centeredPlacement = () => ({ x: 0, y: 0, ground: false, modelUnits: true });
  footer.setAttribute('fill', '#243c30');
  footer.setAttribute('font-family', 'system-ui, sans-serif');
  footer.setAttribute('font-size', '11');
  footerRule.setAttribute('stroke', '#8ba095');
  footer.append(footerRule, footerTitle, footerScale);
  clip.id = 'drawingSheetClip';
  clip.append(clipRect);
  drawingArea.setAttribute('clip-path', 'url(#drawingSheetClip)');
  markSvgLayer(paperLayer, 'Paper');
  markSvgLayer(content, 'Artwork');
  markSvgLayer(floorTiles, 'Floor plans');
  markSvgLayer(footer, 'Title and scale');
  content.append(sheetArtwork, floorTiles);
  drawingArea.append(content);
  sheet.append(clip, paperLayer, drawingArea, footer);
  document.head.append(pageStyle);
  for (const scale of DRAWING_SCALES)
    $('drawingScale').add(new Option(`1:${scale}`, String(scale)));

  let settings = {
      view: 'axo',
      detail: '',
      document: '',
      lobbyDirection: 'centre',
      lobbyAzimuth: 5,
      lobbyRender: 'colour',
      lobbyViews: 'both',
      lobbyContext: true,
      azimuth: 5,
      elevation: 225,
      sectionProjection: 'orthographic',
      sectionLens: 35,
      perspectiveFade: 55,
      cutFill: true,
      source: 'massing',
      craneRunway: 'design',
      craneBearing: null,
      craneSetSupport: 'all',
      showSite: false,
      planSheet: 'single',
      glazing: false,
      selected: null,
      planes: [],
      paper: 'letter',
      orientation: 'landscape',
      scale: 'auto',
      mode: 'linework',
      pens: drawingPens(),
      placement: centeredPlacement()
    },
    sourceModel = null,
    sourceAssignments = {},
    lobbyPages = [],
    sitePages = [],
    cranePages = [],
    craneRender = 0,
    materialSignature = '',
    geometry = null,
    renderedGeometryMode = null,
    rendered = null,
    timer = 0,
    printingFloorSet = false,
    placing = false,
    drag = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.planes)) {
      const previousElevation = ['front', 'side'].includes(saved.view),
        documentName = saved.document === 'program-diagrams' ? 'programme' : saved.document;
      settings = {
        ...settings,
        view: previousElevation ? 'elevation' : viewNames.includes(saved.view) ? saved.view : 'axo',
        detail: Object.hasOwn(CONNECTION_DETAIL_TITLES, saved.detail) ? saved.detail : '',
        document: DRAWING_DOCUMENTS.includes(documentName) ? documentName : '',
        lobbyDirection: saved.lobbyDirection === 'compass' ? 'compass' : 'centre',
        lobbyAzimuth:
          Number.isInteger(saved.lobbyAzimuth) && compassPoints[saved.lobbyAzimuth] ? saved.lobbyAzimuth : 5,
        lobbyRender: ['colour', 'hybrid', 'linework'].includes(saved.lobbyRender) ? saved.lobbyRender : 'colour',
        lobbyViews: ['axo', 'plan'].includes(saved.lobbyViews) ? saved.lobbyViews : 'both',
        lobbyContext: saved.lobbyContext !== false,
        elevation: Number.isFinite(saved.elevation)
          ? mod(saved.elevation, 360)
          : saved.view === 'side'
            ? 315
            : 225,
        source: saved.source === 'build' ? 'build' : 'massing',
        craneRunway: Object.hasOwn(CRANE_RUNWAYS, saved.craneRunway) ? saved.craneRunway : 'design',
        craneBearing: Number.isFinite(saved.craneBearing) ? clamp(Math.round(saved.craneBearing), 0, 359) : null,
        craneSetSupport: Object.hasOwn(CRANE_RUNWAYS, saved.craneSetSupport) ? saved.craneSetSupport : 'all',
        sectionProjection: saved.sectionProjection === 'perspective' ? 'perspective' : 'orthographic',
        sectionLens: clamp(Number(saved.sectionLens) || 35, 8, 200),
        perspectiveFade: Number.isFinite(saved.perspectiveFade) ? clamp(saved.perspectiveFade, 0, 100) : 55,
        cutFill: saved.cutFill !== false,
        showSite: saved.showSite === true,
        planSheet: saved.planSheet === 'floors' ? 'floors' : 'single',
        azimuth:
          Number.isInteger(saved.azimuth) && compassPoints[saved.azimuth] ? saved.azimuth : 5,
        paper: Object.hasOwn(paperSizes, saved.paper) ? saved.paper : 'letter',
        orientation: saved.orientation === 'portrait' ? 'portrait' : 'landscape',
        scale: DRAWING_SCALES.includes(Number(saved.scale)) ? saved.scale : 'auto',
        mode: ['linework', 'program', 'material', 'combined'].includes(saved.mode)
          ? saved.mode
          : 'linework',
        placement: {
          x: Number.isFinite(saved.placement?.x) ? saved.placement.x : 0,
          y: Number.isFinite(saved.placement?.y) ? saved.placement.y : 0,
          ground: saved.placement?.ground === true,
          modelUnits: saved.placement?.modelUnits === true
        },
        glazing: saved.glazing === true,
        pens: drawingPens(saved.pens),
        selected: saved.selected,
        planes: saved.planes.filter(
          (plane) =>
            plane &&
            Number.isFinite(plane.id) &&
            Number.isFinite(plane.offset) &&
            Number.isFinite(plane.angle) &&
            ['horizontal', 'vertical'].includes(plane.axis)
        )
      };
    }
  } catch {
    // Drawing controls remain available when the browser blocks local storage.
  }

  const currentPlane = () => settings.planes.find((plane) => plane.id === settings.selected);
  function paperDimensions() {
    const [short, long] = paperSizes[settings.paper];
    return settings.orientation === 'portrait'
      ? { width: short, height: long }
      : { width: long, height: short };
  }
  function resizePaperPreview() {
    const { width, height } = paperDimensions(),
      previewScale = Math.min(paperFrame.clientWidth / width, paperFrame.clientHeight / height);
    if (previewScale > 0) {
      sheet.style.width = width * previewScale + 'px';
      sheet.style.height = height * previewScale + 'px';
    }
    sheet.style.setProperty('--drawing-paper-width', width + 'in');
    sheet.style.setProperty('--drawing-paper-height', height + 'in');
  }
  function saveDrawing() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      // Export is independent of local storage.
    }
  }
  const lobbyKey = (hub) => [hub.f, hub.band, hub.start.toFixed(5), ...hub.pair].join('/');
  const selectedLobby = (plane) =>
    plane?.lobbyKey &&
    sourceModel?.circulation.hubs.find((hub) => hub.layout && lobbyKey(hub) === plane.lobbyKey);
  const focusedLobbyPlan = (plane = currentPlane()) =>
    settings.view === 'aligned' && plane?.axis === 'horizontal' ? selectedLobby(plane) : null;
  function lobbyPlanFrame(hub, includeSite) {
    const bearing = includeSite ? (siteWorkspace.drawingBearing * Math.PI) / 180 : 0,
      cos = Math.cos(bearing),
      sin = Math.sin(bearing),
      apron = 2 / hub.layout.radius;
    // Fit the lobby's actual room edges and a short length of both approaches.
    return [hub.r - 2, hub.R + 2].flatMap((radius) =>
      [hub.start - apron, hub.layout.heading, hub.end + apron].map((angle) => {
        const x = radius * Math.cos(angle),
          z = radius * Math.sin(angle);
        return [x * cos - z * sin, 0, x * sin + z * cos];
      })
    );
  }
  function planeAngle(plane) {
    const hub = selectedLobby(plane);
    if (!hub) return plane.angle;
    const bearing = settings.showSite && siteWorkspace.hasTerrain ? siteWorkspace.drawingBearing : 0;
    return mod((hub.layout.heading * 180) / Math.PI + 90 + bearing, 360);
  }
  function normalFor(plane) {
    if (plane.axis === 'horizontal') return [0, 1, 0];
    const angle = (planeAngle(plane) * Math.PI) / 180;
    return [Math.cos(angle), 0, Math.sin(angle)];
  }

  const floorDatum = (plane) =>
    plane.axis === 'horizontal' && plane.floor != null
      ? plane.floor * modelFloorPitch(sourceModel)
      : 0;
  const planeHeight = (plane) => floorDatum(plane) + plane.offset;
  const allPlans = () =>
    !settings.detail && settings.view === 'plan' && settings.planSheet === 'floors';
  function offsetLimits(plane) {
    const reach = Math.ceil(sourceModel.plaza.outer + 2);
    return plane.axis === 'horizontal'
      ? [
          Math.min(0, -floorDatum(plane)),
          Math.ceil(sourceModel.feature.ride.height) - floorDatum(plane)
        ]
      : [-reach, reach];
  }
  function viewCamera() {
    const top = Math.PI / 2;
    if (settings.view === 'plan') return { az: -Math.PI / 2, el: top };
    if (settings.view === 'elevation')
      return { az: Math.PI / 2 + (settings.elevation * Math.PI) / 180, el: 0 };
    const plane = currentPlane();
    if (settings.view === 'aligned' && plane) {
      if (plane.axis === 'horizontal') return { az: -Math.PI / 2, el: plane.flip ? -top : top };
      return { az: (planeAngle(plane) * Math.PI) / 180 + (plane.flip ? Math.PI : 0), el: 0 };
    }
    // Plan north is world +Z. Moving clockwise on the compass follows the plan axes.
    return { az: Math.PI / 2 + (settings.azimuth * Math.PI) / 4, el: 0.57 };
  }
  const compass = $('drawingCompass'),
    lobbyCompass = $('drawingLobbyCompass');
  function addCompassButtons(group, label, select) {
    for (const index of [7, 0, 1, 6, 2, 5, 4, 3]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = compassPoints[index];
      button.setAttribute('aria-label', label + compassNames[index]);
      button.dataset.azimuth = index;
      button.onclick = () => {
        select(index);
        queueDrawing();
      };
      group.append(button);
    }
  }
  addCompassButtons(compass, 'View from ', (index) => {
    if (settings.view === 'elevation') settings.elevation = index * 45;
    else settings.azimuth = index;
    syncCompass();
  });
  addCompassButtons(lobbyCompass, 'Lobby view from ', (index) => {
    settings.lobbyAzimuth = index;
    syncLobbyControls();
  });
  function syncLobbyControls() {
    $('lobbyDrawingControls').hidden = settings.document !== 'lobbies';
    const showCompass = settings.lobbyDirection === 'compass';
    $('drawingLobbyDirection').value = settings.lobbyDirection;
    $('drawingLobbyRender').value = settings.lobbyRender;
    $('drawingLobbyViews').value = settings.lobbyViews;
    $('drawingLobbyContext').checked = settings.lobbyContext;
    $('drawingLobbyPaper').value = settings.paper;
    $('drawingLobbyOrientation').value = settings.orientation;
    lobbyCompass.hidden = $('drawingLobbyCompassNote').hidden = !showCompass;
    for (const button of lobbyCompass.children)
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.azimuth) === settings.lobbyAzimuth)
      );
  }
  function syncCompass() {
    const elevation = !settings.detail && settings.view === 'elevation';
    compass.hidden = Boolean(settings.detail) || (settings.view !== 'axo' && !elevation);
    $('drawingOrbitField').hidden = !elevation;
    $('drawingOrbit').value = settings.elevation;
    $('drawingOrbitAngle').textContent = settings.elevation + '°';
    for (const button of compass.children)
      button.setAttribute(
        'aria-pressed',
        String(
          Number(button.dataset.azimuth) ===
            (elevation ? settings.elevation / 45 : settings.azimuth)
        )
      );
    $('drawingPlanSheetField').hidden = $('printFloorSet').hidden =
      Boolean(settings.detail) || settings.view !== 'plan';
    sheet.classList.toggle('planset', allPlans());
    $('placeDrawingPlane').disabled = allPlans();
    $('centerDrawing').disabled = Boolean(settings.detail) || allPlans();
    $('drawingCutFillField').hidden = Boolean(settings.detail);
    $('drawingCutFill').disabled = !currentPlane() && !allPlans();
    $('drawingCutFill').checked = settings.cutFill;
    syncSectionView();
  }

  const lensPosition = (mm) => Math.round((1000 * Math.log(mm / 8)) / Math.log(200 / 8));
  const lensMillimetres = (position) => Math.round(8 * (200 / 8) ** (position / 1000));
  $('drawingLensTicks').replaceChildren(
    ...SECTION_LENS_STOPS.map((mm) => new Option(`${mm} mm`, lensPosition(mm)))
  );
  function syncSectionView() {
    const plane = currentPlane(),
      plan = focusedLobbyPlan(plane),
      aligned = !settings.detail && settings.view === 'aligned';
    $('drawingLobbyCut').value =
      aligned && plane?.axis === 'vertical' && selectedLobby(plane) ? plane.lobbyKey : '';
    $('drawingLobbyPlan').value = aligned && plan ? plane.lobbyKey : '';
    $('drawingSectionView').hidden = !(aligned && (plane?.axis === 'vertical' || plan));
    $('drawingProjectionTitle').textContent = plan ? 'Plan projection' : 'Section projection';
    $('drawingSectionProjection').options[1].text = plan ? 'Plan perspective' : 'Section perspective';
    $('drawingSectionProjection').value = settings.sectionProjection;
    $('drawingSectionLensField').hidden = settings.sectionProjection !== 'perspective';
    $('drawingSectionLensNumber').value = settings.sectionLens;
    const slider = $('drawingSectionLens');
    slider.value = lensPosition(settings.sectionLens);
    slider.setAttribute('aria-valuetext', settings.sectionLens + ' millimetres');
    syncPerspectiveFade();
  }
  const perspectiveOpacity = () => (100 - settings.perspectiveFade) / 100;
  function syncPerspectiveFade() {
    const value = `${settings.perspectiveFade}%`;
    $('drawingPerspectiveFade').value = settings.perspectiveFade;
    $('drawingPerspectiveFade').setAttribute('aria-valuetext', value);
    $('drawingPerspectiveFadeValue').value = value;
  }
  function sectionOptics() {
    const plane = currentPlane();
    if (
      settings.view !== 'aligned' ||
      !plane ||
      (plane.axis === 'horizontal' && !focusedLobbyPlan(plane)) ||
      settings.sectionProjection !== 'perspective'
    )
      return null;
    const hub = selectedLobby(plane);
    return {
      cutDepth: planeHeight(plane) * (plane.flip ? -1 : 1),
      millimetres: settings.sectionLens,
      eyeLevel:
        plane.axis === 'vertical' ? (hub ? hub.f * modelFloorPitch(sourceModel) : 0) + 1.65 : null
    };
  }

  function floorPlans() {
    const selected = currentPlane();
    const base =
      selected?.axis === 'horizontal'
        ? selected
        : settings.planes.find((plane) => plane.axis === 'horizontal');
    const pitch = modelFloorPitch(sourceModel);
    const cut = base ? (base.floor != null ? base.offset : mod(base.offset, pitch)) : 1.2;
    // Each plan has its own height cut. Vertical sections can still crop the full set.
    const otherPlanes = settings.planes.filter((plane) => plane.axis === 'vertical');
    return sourceModel.layers.map((_, floor) => ({
      label:
        (floor === 0 ? 'Ground floor' : 'Level ' + (floor + 1)) +
        ' · Cut ' +
        (floor * pitch + cut).toFixed(2) +
        ' m',
      planes: drawingClips([...otherPlanes, { axis: 'horizontal', offset: cut, floor }])
    }));
  }

  function svgElement(name, attributes) {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  // Layer metadata exposes ordinary SVG groups as editable layers in Inkscape.
  function markSvgLayer(group, name) {
    group.setAttributeNS(layerNS, 'inkscape:groupmode', 'layer');
    group.setAttributeNS(layerNS, 'inkscape:label', name);
    group.setAttribute('data-layer', name);
    return group;
  }
  function sheetInk(paper) {
    return dot(rgb(paper), [0.21, 0.72, 0.07]) < 0.45 ? '#ebeee8' : '#243c30';
  }

  function renderConnectionSheet(paper) {
    const denominator = 25,
      width = paper.width * DRAWING_PIXELS_PER_INCH,
      height = paper.height * DRAWING_PIXELS_PER_INCH,
      margin = (10 * DRAWING_PIXELS_PER_INCH) / 25.4,
      drawingHeight = height - margin * 3.2,
      millimetres = DRAWING_PIXELS_PER_INCH / 25.4,
      scale = (1000 * millimetres) / denominator,
      origin = [width / 2, margin + 76 + 1.27 * scale],
      ink = sheetInk(settings.pens.paper),
      layers = buildViewLayers(),
      structure = layers.dockStructure,
      detail = settings.detail,
      penWidths = printedDrawingPenWidths(settings.pens, denominator),
      thin = Math.min(...penWidths) * millimetres,
      thick = Math.max(...penWidths) * millimetres;
    const cutMaterial = markSvgLayer(svgElement('g', {}), 'Cut materials'),
      connections = markSvgLayer(svgElement('g', {}), 'Connection linework'),
      services = markSvgLayer(svgElement('g', {}), 'Service routes'),
      fittings = markSvgLayer(svgElement('g', {}), 'Fitting elevations'),
      labels = markSvgLayer(
        svgElement('g', { fill: ink, 'font-family': 'system-ui, sans-serif' }),
        'Dimensions and notes'
      );
    const palette = { concrete: '#b8b9aa', steel: '#6d8e85', timber: '#b89568' };
    function emit(group, kind, attributes, text) {
      const element = svgElement(kind, attributes);
      if (text !== undefined) element.textContent = text;
      group.append(element);
      return element;
    }
    const style = { ink, paper: settings.pens.paper, thin, thick, emit },
      pen = svgConnectionPen(connections, { ...style, origin, scale }),
      { px, py } = pen;
    function text(x, y, words, size = 11, align = 'start', weight = 450) {
      emit(labels, 'text', { x, y, 'font-size': size, 'text-anchor': align, 'font-weight': weight }, words);
    }
    function label(x, y, words) {
      text(px(x), py(y), words, 9, 'start', 600);
    }
    function leader(x1, y1, x2, y2) {
      emit(labels, 'line', { x1: px(x1), y1: py(y1), x2: px(x2), y2: py(y2),
        stroke: ink, 'stroke-width': thin });
    }
    function callout(words, x, y, targetX, targetY, extension = 0.50) {
      const elbow = x + (x < 0 ? extension : -extension);
      leader(x, y - 0.04, elbow, y - 0.04);
      leader(elbow, y - 0.04, targetX, targetY);
      emit(labels, 'circle', { cx: px(targetX), cy: py(targetY), r: 1.55, fill: ink });
      text(px(x), py(y), words, 10.5, x < 0 ? 'start' : 'end');
    }
    function dim(x, bottom, top, value) {
      leader(x, bottom, x, top);
      for (const y of [bottom, top]) leader(x - 0.035, y - 0.025, x + 0.035, y + 0.025);
      text(px(x + (x < 0 ? -0.07 : 0.07)), py((top + bottom) / 2 - 0.03),
        value, 10, x < 0 ? 'end' : 'start');
    }
    function cut(x, y, w, h, material) {
      emit(cutMaterial, 'rect', { x: px(x), y: py(y), width: w * scale, height: h * scale,
        fill: palette[material], 'fill-opacity': 0.22, stroke: ink, 'stroke-width': thick });
    }
    function service(points, kind) {
      const serviceInk = { power: '#b57847', water: '#43848c', drain: '#536c86' };
      emit(services, 'polyline', { points: points.map(([x, y]) => `${px(x)},${py(y)}`).join(' '),
        fill: 'none', stroke: serviceInk[kind], 'stroke-width': thick });
    }
    const demand = dockSupportDemand(sourceModel, sourceAssignments, structure, layers.slabThickness),
      summary = connectionDemandCopy(detail, structure, demand);
    text(margin + 1, margin + 13, 'CONNECTION STUDY', 9, 'start', 650);
    text(margin + 1, margin + 36, CONNECTION_DETAIL_TITLES[detail], 22, 'start', 650);
    text(margin + 1, margin + 53, DOCK_STRUCTURES[structure].name + ' · Local detail', 11);
    text(width - margin - 1, margin + 14, 'REFERENCE SERVICE DEMAND', 9, 'end', 650);
    text(width - margin - 1, margin + 34, summary.value, 14, 'end', 650);
    text(width - margin - 1, margin + 51, demand.governing.label + ' · unfactored', 10, 'end');
    drawConnectionContext(detail, sourceModel, layers, demand, { ...pen, cut, callout, dim, label, service });

    const fitY = margin + 76 + 2.51 * scale + 14;
    drawFittingPanels(fittings, fittingPanels(detail, structure, demand),
      { x: margin + 1, y: fitY, width: width - 2 * margin - 2, printScale: true }, style);
    text(margin + 1, fitY + 171, summary.check, 10);
    const limits = detail === 'support' && structure === 'cable-stayed'
      ? 'Schematic bolt layout. Check combined bolt tension and shear, prying, welds and shared reactions at the perimeter ring.'
      : 'Exterior fitting profiles are schematic. Confirm manufacturer ratings and the complete connection before specification.';
    text(margin + 1, fitY + 185, limits, 9.5);
    sheetArtwork.replaceChildren(
      ...[cutMaterial, services, connections, fittings, labels].filter((group) => group.childElementCount)
    );
    return { width, height, margin, drawingHeight, denominator, populated: true };
  }

  function drawingDirectionArrow({ right, up }, x, y, ink, south) {
    // General drawings point to world north. Lobby sheets point back to the building centre.
    const direction = south ?? [0, 0, 1],
      across = dot(direction, right),
      rise = dot(direction, up),
      projected = Math.hypot(across, rise),
      directionX = across / projected,
      directionY = -rise / projected,
      angle = (Math.atan2(directionX, -directionY) * 180) / Math.PI;
    const arrow = svgElement('g', south
      ? { 'aria-label': 'Local south toward the building centre', 'data-local-south-arrow': '' }
      : { 'aria-label': 'North arrow', 'data-north-arrow': '' });
    const ring = svgElement('g', { transform: `translate(${x} ${y}) rotate(${angle})` });
    // A narrow ring and three dock tabs echo the massing. The fourth tab points north.
    ring.append(
      svgElement('circle', { r: 6, fill: 'none', stroke: ink, 'stroke-width': 0.85 }),
      svgElement('path', {
        d: 'M-8 0h2 M6 0h2 M0 6v2',
        fill: 'none',
        stroke: ink,
        'stroke-width': 0.85
      }),
      svgElement('path', { d: 'M0 -13l3.2 8.5L0 -6.5l-3.2 2Z', fill: ink })
    );
    const bearing = svgElement('text', {
      x: x + directionX * 18,
      y: y + directionY * 18 + 2.7,
      'text-anchor': 'middle',
      'font-size': 8,
      'font-weight': 650
    });
    bearing.textContent = south ? 'S' : 'N';
    arrow.append(ring, bearing);
    return arrow;
  }

  function drawScaleIndicator(indicator, denominator, end, baseline, ink, mapBasis) {
    // Pick a readable ground distance on the 1–2–5 series and keep the bar under 26 mm on paper.
    const capacity = (denominator * 26) / 1000,
      magnitude = 10 ** Math.floor(Math.log10(capacity)),
      metres = [5, 2, 1].map((step) => step * magnitude).find((length) => length <= capacity),
      barLength = (metres * 1000 * DRAWING_PIXELS_PER_INCH) / (denominator * 25.4),
      right = end - 53,
      left = right - barLength,
      y = baseline - 1;
    const bar = svgElement('line', {
      x1: left,
      x2: right,
      y1: y,
      y2: y,
      stroke: ink,
      'data-scale-metres': metres
    });
    const ticks = svgElement('path', {
      d: `M${left} ${y - 2}v4 M${right} ${y - 2}v4`,
      stroke: ink,
      fill: 'none'
    });
    const startLabel = svgElement('text', { x: left, y: y - 5, 'font-size': 8 });
    startLabel.textContent = '0';
    const endLabel = svgElement('text', {
      x: right,
      y: y - 5,
      'font-size': 8,
      'text-anchor': 'end'
    });
    endLabel.textContent = `${metres} m`;
    const ratio = svgElement('text', {
      x: end,
      y: baseline,
      'text-anchor': 'end',
      'data-scale-ratio': denominator
    });
    ratio.textContent = `1:${denominator}`;
    indicator.replaceChildren(bar, ticks, startLabel, endLabel, ratio);
    if (mapBasis) indicator.prepend(drawingDirectionArrow(mapBasis, end - 178, baseline - 4, ink));
  }

  function renderPens(target, frame, identified = false, colourOnly = false) {
    const { pens, ink, perspective, construction, heaviest, denominator } = frame;
    const strokes = perspective
      ? [
          [frame, false],
          [perspective, true]
        ]
      : [[frame, false]];
    const widths = printedDrawingPenWidths(pens, denominator),
      guideScale = drawingPenScale(pens, denominator);
    const colorLayer = markSvgLayer(svgElement('g', {}), 'Colour wash');
    if (frame.wash)
      colorLayer.append(
        svgElement('image', { width: frame.width, height: frame.height, href: frame.wash })
      );
    if (colourOnly) {
      target.replaceChildren(colorLayer);
      return;
    }
    const textureLayer = markSvgLayer(svgElement('g', {}), 'Surface texture');
    const layout = markSvgLayer(svgElement('g', {}), 'Construction lines');
    const guide = markSvgLayer(svgElement('g', {}), 'Pencil marks');
    function path(d, width, stroke, recedes = false) {
      const outline = svgElement('path', {
        d,
        fill: 'none',
        stroke,
        'stroke-width': (width * DRAWING_PIXELS_PER_INCH) / 25.4,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
      if (recedes) {
        outline.dataset.perspectiveStroke = '';
        outline.setAttribute('stroke-opacity', perspectiveOpacity());
      }
      return outline;
    }
    const graphite = sheetInk(pens.paper) === '#ebeee8' ? '#cfc4b9' : '#6d655d';
    if (construction) {
      const axes = path(construction, 0.16 * guideScale, graphite);
      axes.setAttribute('opacity', '0.50');
      axes.setAttribute('stroke-dasharray', '12 4 2 4');
      layout.append(axes);
    }
    for (const [lines, recedes] of strokes) {
      for (const [d, width, opacity] of [
        [lines.pencilEcho, 0.12, 0.43],
        [lines.pencil, 0.19, 0.73]
      ]) {
        if (!d) continue;
        const stroke = path(d, width * guideScale, graphite, recedes);
        stroke.setAttribute('opacity', opacity);
        guide.append(stroke);
      }
    }
    const layers = [colorLayer, layout, guide, textureLayer];
    const firstInk = ink.findIndex(
      (pen, i) => pen.some(Boolean) || perspective?.ink[i].some(Boolean)
    );
    const order = pens.widths.map((_, i) => i).sort((a, b) => pens.widths[a] - pens.widths[b]);
    for (const i of order) {
      const width = widths[i],
        stroke = pens.colors[i];
      for (const [lines, recedes] of strokes)
        if (lines.texture[i]) textureLayer.append(path(lines.texture[i], width, stroke, recedes));
      const layer = markSvgLayer(
        svgElement('g', { 'data-weight-mm': width }),
        `Pen ${i + 1} · ${width.toFixed(2)} mm`
      );
      // Pressure varies slightly within a pen layer. Standard linework and section cuts use
      // the full printed width reported on the sheet, as do most sketch marks.
      let needsLineworkId = identified && i === firstInk;
      for (const [lines, recedes] of strokes) {
        for (const [pressure, multiplier] of [
          [1, 0.94],
          [0, 1],
          [2, 1.06]
        ]) {
          if (!lines.ink[i][pressure]) continue;
          const linework = path(lines.ink[i][pressure], width * multiplier, stroke, recedes);
          if (needsLineworkId) linework.id = 'drawingLinework';
          needsLineworkId = false;
          layer.append(linework);
        }
      }
      if (i === heaviest) {
        if (perspective?.section) layer.append(path(perspective.section, width, stroke, true));
        const cut = path(frame.section, width, stroke);
        if (identified) cut.id = 'drawingSections';
        layer.append(cut);
      }
      layers.push(layer);
    }
    for (const [name, key] of [
      ['Component outlines', 'componentInk'],
      ['Overall silhouette', 'silhouetteInk']
    ]) {
      const layer = markSvgLayer(svgElement('g', {}), name);
      for (const [lines, recedes] of strokes)
        if (lines[key])
          layer.append(path(lines[key], widths[heaviest], pens.colors[heaviest], recedes));
      if (layer.hasChildNodes()) layers.push(layer);
    }
    if (frame.cutFills.length) {
      const fill = markSvgLayer(svgElement('g', { fill: '#000000' }), 'Cut fill');
      for (const d of frame.cutFills) fill.append(svgElement('path', { d, 'fill-rule': 'nonzero' }));
      layers.push(fill);
    }
    target.replaceChildren(...layers);
  }

  // Each view uses the same physical drawing units. The tile bounds crop its own wash and strokes.
  function floorView(frame, label, x = 0, y = 0, print = false, { colourOnly, mapBasis = frame.basis } = {}) {
    const { width, height, margin, drawingHeight, denominator } = frame;
    const tile = svgElement('svg', { x, y, width, height, viewBox: `0 0 ${width} ${height}` });
    const area = svgElement('svg', {
      x: margin,
      y: margin,
      width: width - margin * 2,
      height: drawingHeight,
      viewBox: `${margin} ${margin} ${width - margin * 2} ${drawingHeight}`,
      overflow: 'hidden'
    });
    renderPens(area, frame, false, colourOnly);
    const ink = sheetInk(frame.pens.paper),
      baseline = height - (print ? margin : Math.min(12, margin));
    const name = svgElement('text', {
      x: margin,
      y: baseline,
      fill: ink,
      'font-family': 'system-ui, sans-serif',
      'font-size': 11
    });
    name.textContent = print ? label : `${label} · 1:${denominator}`;
    if (print) tile.append(svgElement('rect', { width, height, fill: frame.pens.paper }));
    tile.append(area, name);
    if (print) {
      const indicator = svgElement('g', {
        fill: ink,
        'font-family': 'system-ui, sans-serif',
        'font-size': 11
      });
      drawScaleIndicator(indicator, denominator, width - margin, baseline, ink, mapBasis);
      tile.append(indicator);
    }
    return tile;
  }

  function renderFloorSheet(paper, camera) {
    const width = paper.width * DRAWING_PIXELS_PER_INCH,
      height = paper.height * DRAWING_PIXELS_PER_INCH,
      margin = (10 * DRAWING_PIXELS_PER_INCH) / 25.4,
      drawingHeight = height - margin * 3.2;
    const plans = floorPlans(),
      drawingWidth = width - 2 * margin;
    // Choose the grid that leaves the most room for each circular plan and its label.
    let columns = 1,
      bestSize = 0;
    for (let count = 1; count <= plans.length; count++) {
      const cellSize = Math.min(
        drawingWidth / count - 2 * DRAWING_TILE_MARGIN,
        drawingHeight / Math.ceil(plans.length / count) - DRAWING_TILE_RESERVED_HEIGHT
      );
      if (cellSize <= bestSize) continue;
      bestSize = cellSize;
      columns = count;
    }
    const rows = Math.ceil(plans.length / columns),
      region = {
        width: Math.floor(drawingWidth / columns),
        height: Math.floor(drawingHeight / rows)
      };
    let denominator = settings.scale;
    let cropped = false,
      populated = false;
    const regionFills = [];
    const tiles = plans.map(({ planes, label }, i) => {
      const frame = renderDrawing(
        geometry,
        camera,
        planes,
        paper,
        denominator,
        settings.glazing,
        { x: 0, y: 0, ground: false },
        settings.mode !== 'linework',
        settings.pens,
        { region, floorSet: true, cutFill: settings.cutFill }
      );
      denominator = String(frame.denominator);
      cropped ||= frame.cropped;
      populated ||= frame.populated;
      regionFills.push(frame.exportFills);
      return floorView(
        frame,
        label,
        margin + (i % columns) * region.width,
        margin + Math.floor(i / columns) * region.height
      );
    });
    floorTiles.replaceChildren(...tiles);
    return {
      width,
      height,
      margin,
      drawingHeight,
      denominator,
      cropped,
      populated,
      regionFills
    };
  }

  function renderLobbyPages(paper) {
    const hubs = sourceModel.circulation.hubs
      .filter((hub) => hub.layout)
      .sort((a, b) => a.f - b.f || a.start - b.start);
    const views = settings.lobbyViews === 'both' ? ['axo', 'plan'] : [settings.lobbyViews],
      direction = settings.lobbyDirection === 'centre' ? 4 : settings.lobbyAzimuth,
      caption = compassPoints[direction],
      colourOnly = settings.lobbyRender === 'colour',
      hybrid = settings.lobbyRender !== 'linework';
    return hubs.flatMap((hub, index) => {
      const origin = hub.layout.origin,
        // The axis to the building centre defines south for this lobby.
        heading = origin ? Math.atan2(origin[1], origin[0]) : hub.layout.heading,
        az = heading + (direction * Math.PI) / 4,
        south = [-Math.cos(heading), 0, -Math.sin(heading)],
        level = studyFloorName(hub.f, sourceModel),
        names = hub.pair.map((program) => P[program].name).join(' + ');
      return views.map((view) => {
        const isPlan = view === 'plan',
          { geometry, labels } = lobbyDrawingGeometry(sourceModel, hub, state.seed, settings.lobbyContext, !isPlan),
          projection = isPlan
            ? `Plan · Local ${caption} at bottom`
            : `Axonometric · From local ${caption}`,
          title = `Lobby ${index + 1} · ${names}`,
          label = `${level} · ${projection}`,
          frame = renderDrawing(
            geometry,
            { az, el: isPlan ? Math.PI / 2 : 0.7 },
            [],
            paper,
            'auto',
            false,
            centeredPlacement(),
            hybrid,
            settings.pens,
            { washLightness: colourOnly ? 0.08 : 0.49, scales: LOBBY_DRAWING_SCALES }
          ),
          tile = floorView(frame, title, 0, 0, true, { colourOnly, mapBasis: null }),
          [, area, , indicator] = tile.children;
        tile.classList.add('drawing-sheet');
        tile.setAttribute('width', paper.width + 'in');
        tile.setAttribute('height', paper.height + 'in');
        tile.setAttribute('role', 'img');
        tile.setAttribute('aria-label', `${title} · ${label}`);
        tile.dataset.lobbyView = view;
        tile.dataset.lobbyDirection = caption;
        tile.dataset.lobbyAzimuth = az;
        const { width, height, margin, denominator } = frame,
          ink = sheetInk(frame.pens.paper),
          header = svgElement('text', {
            x: margin,
            y: margin - 9,
            fill: ink,
            'font-family': 'system-ui, sans-serif',
            'font-size': 11
          });
        indicator.prepend(
          drawingDirectionArrow(frame.basis, width - margin - 178, height - margin - 4, ink, south)
        );
        header.textContent = label;
        const roomLabels = markSvgLayer(
          svgElement('g', {
            fill: '#283e34',
            stroke: '#fffefa',
            'stroke-width': 2,
            'paint-order': 'stroke',
            'text-anchor': 'middle',
            'font-family': 'system-ui, sans-serif',
            'font-size': 10,
            'font-weight': 650
          }),
          'Programme labels'
        );
        for (const { point, label } of labels) {
          const x = frame.originX + dot(point, frame.basis.right) * frame.scale,
            y = frame.originY - dot(point, frame.basis.up) * frame.scale,
            depth = frame.depth[Math.floor(y) * width + Math.floor(x)];
          // Suppress a label if the other side of the lounge hides that patch of floor in an axo.
          if (depth - dot(point, frame.basis.back) > 0.08) continue;
          const note = svgElement('text', { x, y });
          note.textContent = label;
          roomLabels.append(note);
        }
        if (roomLabels.hasChildNodes()) area.append(roomLabels);
        tile.append(header);
        const filename = () =>
          `poly-nation-${state.seed}-lobby-${index + 1}-${view}-${caption.toLowerCase()}-1-${denominator}.svg`;
        function vector() {
          return vectorFloorPage(paper, frame, title + ' · ' + label, tile);
        }
        const preview = document.createElement('figure'),
          button = document.createElement('button');
        preview.className = 'lobby-axo-page';
        button.type = 'button';
        button.textContent = 'Export SVG';
        button.setAttribute(
          'aria-label',
          `Export lobby ${index + 1} ${isPlan ? 'plan' : 'axonometric'} as SVG`
        );
        button.onclick = () =>
          downloadBlob(
            new XMLSerializer().serializeToString(vector()),
            'image/svg+xml',
            filename()
          );
        preview.append(button, tile);
        return { preview, vector };
      });
    });
  }

  function siteDrawingPreview(svg, title, index) {
    const preview = document.createElement('figure'), button = document.createElement('button'), vector = () => svg.cloneNode(true);
    preview.className = 'lobby-axo-page';
    button.type = 'button';
    button.textContent = 'Export SVG';
    button.setAttribute('aria-label', `Export ${title} as SVG`);
    button.onclick = () => downloadBlob(new XMLSerializer().serializeToString(vector()), 'image/svg+xml',
      `poly-nation-${state.seed}-site-${svg.dataset.siteSection === 'axo' ? 'foundation-axo' : 'section-' + (index + 1)}.svg`);
    preview.append(button, svg);
    return { preview, vector };
  }

  function renderSiteFoundationAxo(study, context, scales, pale, index) {
    const paper = SITE_SECTION_PAPER, { plan, surface, canalDepth } = study,
      w = paper.width * DRAWING_PIXELS_PER_INCH, h = paper.height * DRAWING_PIXELS_PER_INCH,
      margin = 48, right = 1070, ink = '#223b35', rule = '#a9b9b3', top = 143,
      { mesh, reach } = siteFoundationAxo(sourceModel, plan, surface, canalDepth),
      layers = drawingGeometry(mesh, sourceModel, { include: ({ layer }) => layer !== 'Site_Foundation_Platform' }),
      crossing = plan.rows.find((row) => row.transfers.length),
      camera = { az: (crossing?.angle ?? plan.accessAngle) + 0.92, el: 0.46 },
      planes = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map((normal) => ({ normal, offset: reach })),
      pens = drawingPens({ mode: 'component', widths: [0.20, 0.16, 0.13], colors: ['#475851', '#526861', '#8b9489'],
        components: { core: 0, circulation: 1, docks: 0, modules: 1, rides: 1, site: 2 } }),
      frame = renderDrawing(layers, camera, planes, paper, 'auto', false, centeredPlacement(), true, pens,
        { region: { width: right - margin - 24, height: h - 229 }, washLightness: 0.28, scales }),
      overview = renderDrawing(context, camera, [], paper, 'auto', false, centeredPlacement(), false, pale,
        { region: { width: w - right - margin, height: 350 }, scales }),
      main = floorView(frame, '', margin, top + 20), key = floorView(overview, '', right, top + 56),
      [area] = main.children, colours = area.querySelector('[data-layer="Colour wash"]'),
      title = 'Hybrid foundations · Cutaway axonometric', svg = studySVG(w, h, title);
    colours.replaceChildren(...frame.exportFills().map(({ fill, d }) => svgElement('path', { fill, d })));
    markSvgLayer(colours, 'Colour fills');
    main.replaceChildren(area);
    key.replaceChildren(key.children[0]);
    key.dataset.siteContext = 'inset';
    svg.classList.add('drawing-sheet');
    svg.setAttribute('width', paper.width + 'in');
    svg.setAttribute('height', paper.height + 'in');
    svg.setAttribute('font-family', 'system-ui, sans-serif');
    svg.dataset.siteSection = 'axo';
    studyMark(svg, 'rect', { width: w, height: h, fill: '#ffffff' });
    svg.append(main, key);
    const text = (x, y, content, size, options = {}) => studyMark(svg, 'text', {
        x, y, fill: ink, 'font-size': size, ...options
      }, content),
      scale = (view, end, baseline, north) => {
        const indicator = studyMark(svg, 'g', { fill: ink, 'font-size': 13 });
        drawScaleIndicator(indicator, view.denominator, end, baseline, ink, north ? view.basis : null);
      };
    text(margin, 40, 'POLY NATION  /  WEST VILLAGE SITE SECTIONS', 15, { 'font-weight': 700, 'letter-spacing': 1.4 });
    text(margin, 78, title, 32, { 'font-weight': 680 });
    text(margin, 106, 'The ground and deck are cut away to expose the supporting walls, girders and piles.', 15);
    text(w - margin, 40, 'PN–SI–' + String(index + 1).padStart(2, '0'), 16, { 'text-anchor': 'end' });
    for (const y of [125, h - 65]) studyMark(svg, 'line', { x1: margin, y1: y, x2: w - margin, y2: y, stroke: rule });
    studyMark(svg, 'line', { x1: right - 12, y1: 142, x2: right - 12, y2: h - 86, stroke: rule });
    text(right + 8, top + 26, 'Building context', 16, { 'font-weight': 680 });
    scale(overview, w - margin, top + 394);
    const hasGradeLines = plan.rows.some((row) => row.landward.length),
      legend = [
        ...(hasGradeLines || plan.perimeter.runs.length ? [['#b3b1a1', 'Concrete stem walls and piles']] : []),
        ...(crossing ? [['#546e65', 'Canal transfer girders']] : []),
        ...(plan.accesses.length ? [['#c7c0aa', 'Entry stairs and ramps']] : []),
        ...(mesh.groups.some(({ layer }) => layer === 'Site Bow River water') ? [['#4a939e', 'Modeled water']] : [])
      ];
    for (const [i, [fill, label]] of legend.entries()) {
      const y = top + 447 + i * 32;
      studyMark(svg, 'rect', { x: right + 8, y: y - 13, width: 16, height: 15, fill });
      text(right + 34, y, label, 15);
    }
    if (hasGradeLines) text(right + 8, top + 459 + legend.length * 32, 'Dashed lines mark local grade.', 14);
    text(margin, h - 38, `Ground floor ${(plan.floor + plan.terrain.datum).toFixed(2)} m  ·  Schematic foundation geometry`, 14);
    scale(frame, w - margin, h - 37, true);
    return siteDrawingPreview(svg, title, index);
  }

  function renderSiteSections() {
    const study = siteWorkspace.sectionStudy(sourceModel, sourceAssignments);
    if (!study) return [];
    const { plan, mesh, context, district, canalDepth } = study, paper = SITE_SECTION_PAPER,
      geometry = drawingGeometry(mesh, sourceModel),
      contextGeometry = drawingGeometry(context, sourceModel, {
        include: ({ layer }) => /^(Core_L\d+_Slab|Facade_|Modules_L|Module_Balconies|Roof_(Public_Deck|Lift_|Commercial_Retail)|Atrium_(Glass|Roof_Ridge)|Swing_(Tower|Crown|Boarding)|Crane_(Traveling_Gantry|Roof_|Elevated_Runway|Moat_Runway)|Infinite_Rinse_Water_Slide)/.test(layer)
      }),
      cuts = siteSectionCuts(plan),
      contextTop = plan.foundation + contextGeometry.points.reduce((peak, point) => Math.max(peak, point[1]), 0),
      w = paper.width * DRAWING_PIXELS_PER_INCH, h = paper.height * DRAWING_PIXELS_PER_INCH,
      margin = 48, ink = '#223b35', rule = '#9aaea1', water = '#83afb8', earth = '#e6decb',
      scales = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 5000],
      pens = drawingPens({ mode: 'component', widths: [0.31, 0.20, 0.13], colors: ['#3b5c51', '#54574e', '#8a9790'],
        components: { core: 0, circulation: 0, docks: 1, modules: 2, rides: 2, site: 2 } }),
      pale = drawingPens({ widths: [0.14], colors: ['#abb2af'] });
    if (district) cuts.unshift(district);
    const sections = cuts.map((cut, index) => {
      const { title, note, at, angle, from, to, kind } = cut, [cx, cz] = plan.position,
        detail = kind === 'canal-detail' || kind === 'piled-detail' || kind === 'approach', district = kind === 'district',
        point = (station, height) => { const [x, z] = at(station); return [x - cx, height - plan.foundation, z - cz]; },
        along = [Math.cos(angle), 0, Math.sin(angle)], normal = [-along[2], 0, along[0]],
        offset = dot(point(0, 0), normal), plane = { normal, offset },
        camera = { az: angle + Math.PI / 2, el: 0 },
        { profile, surfaces } = siteSectionGround(plan, cut, canalDepth),
        bottom = Math.min(...profile.map(([, y]) => y), plan.floor - 1.5) - (cut.belowGrade ?? 2.2),
        upper = cut.crown ?? plan.floor + Math.min(kind === 'canal-detail' ? 1.55 : 6.4,
          modelFloorPitch(sourceModel) * sourceModel.layers.length),
        focus = [from, to].flatMap((station) => [bottom, detail ? upper : Math.max(upper, contextTop + 3)].map((y) => point(station, y))),
        drawingY = detail ? 414 : 142,
        region = { width: w - 2 * margin - (cut.labels ? 280 : 0), height: h - drawingY - 65 },
        frame = renderDrawing(geometry, camera, [
          plane, { normal, offset: offset - 5, flip: true },
          { normal: along, offset: to }, { normal: along, offset: from, flip: true },
          { normal: [0, 1, 0], offset: upper - plan.foundation }
        ], paper, 'auto', false, centeredPlacement(), false, pens, { region, focus, cutFill: true, scales }),
        tile = floorView(frame, '', margin, drawingY), area = tile.children[0],
        svg = studySVG(w, h, title), sheetNumber = 'PN–SI–' + String(index + 1).padStart(2, '0');
      tile.replaceChildren(area);
      svg.classList.add('drawing-sheet');
      svg.setAttribute('width', paper.width + 'in');
      svg.setAttribute('height', paper.height + 'in');
      svg.setAttribute('font-family', 'system-ui, sans-serif');
      svg.dataset.siteSection = cut.kind;
      studyMark(svg, 'rect', { width: w, height: h, fill: '#ffffff' });

      function project(view, station, height) {
        const xyz = point(station, height);
        return [view.originX + dot(xyz, view.basis.right) * view.scale, view.originY - dot(xyz, view.basis.up) * view.scale];
      }
      const coordinates = (pairs) => pairs.map(([station, y]) => project(frame, station, y)
          .map((value) => value.toFixed(2)).join(',')).join(' '),
        ground = studyMark(area, 'g', {});
      studyMark(ground, 'polygon', { points: coordinates([...profile, [to, bottom], [from, bottom]]), fill: earth });
      for (const surface of surfaces) studyMark(ground, 'polygon', { points: coordinates(surface), fill: water });
      studyMark(ground, 'polyline', { points: coordinates(profile), fill: 'none', stroke: '#746d55', 'stroke-width': 1.4 });

      if (district)
        studyMark(ground, 'polyline', { points: coordinates([cut.avenue - 6, cut.avenue, cut.avenue + 6].map((station) =>
          [station, siteTerrainHeight(plan.terrain, ...at(station)) + 0.05])), fill: 'none', stroke: '#777873', 'stroke-width': 2.4 });

      const text = (x, y, content, size, options = {}) => studyMark(svg, 'text', {
        x, y, fill: ink, 'font-size': size, ...options
      }, content);
      if (detail) {
        const overviewY = 134, overviewRegion = { width: w - 2 * margin, height: drawingY - overviewY - 6 },
          overview = renderDrawing(contextGeometry, camera, [], paper, 'auto', false, centeredPlacement(), false, pale,
            { region: overviewRegion, scales }),
          view = floorView(overview, '', margin, overviewY), contextArea = view.children[0];
        view.replaceChildren(contextArea);
        view.dataset.siteContext = 'inset';
        svg.append(view);
        text(margin + 10, overviewY + 26, 'Building context · Dashed line marks the detail extent', 13, { 'font-weight': 650 });
        const indicator = studyMark(svg, 'g', { fill: ink, 'font-size': 12 });
        drawScaleIndicator(indicator, overview.denominator, w - margin, drawingY - 27, ink);
        studyMark(svg, 'line', { x1: margin, y1: drawingY, x2: w - margin, y2: drawingY, stroke: rule });
        const [a, y] = project(overview, from, plan.floor), [b] = project(overview, to, plan.floor),
          section = [a, b].sort((x, z) => x - z).map((x) => clamp(x, overview.margin, overview.width - overview.margin));
        studyMark(contextArea, 'line', { x1: section[0], x2: section[1], y1: y, y2: y,
          stroke: '#517970', 'stroke-width': 1.5, 'stroke-dasharray': '5 3' });
      } else {
        const visiblePlane = Math.abs(offset) > sourceModel.R + MODULE.depth ? [] : [plane],
          overview = renderDrawing(contextGeometry, camera, visiblePlane, paper, frame.denominator, false,
            centeredPlacement(), false, pale, { region, focus }),
          contextLayer = floorView(overview, '').children[0];
        contextLayer.dataset.siteContext = 'overlay';
        area.prepend(contextLayer);
      }
      area.prepend(ground);
      svg.append(tile);
      for (const [station, height, label] of cut.labels ?? []) {
        const [x, y] = project(frame, station, height), py = y + drawingY, start = x + margin,
          end = Math.max(start + 40, w * 0.73);
        studyMark(svg, 'line', { x1: start, x2: end, y1: py, y2: py, stroke: rule });
        text(end + 8, py + 4, label, 13);
      }
      if (cut.clearance) {
        const { station, underside, height } = cut.clearance,
          [x, y] = project(frame, station, underside), [, base] = project(frame, station, plan.water.level),
          px = x + margin, top = y + drawingY, lower = base + drawingY;
        studyMark(svg, 'path', { d: `M${px} ${top}V${lower}M${px - 5} ${top}h10M${px - 5} ${lower}h10`,
          fill: 'none', stroke: ink, 'stroke-width': 1.25 });
        text(px + 9, (top + lower) / 2 + 5, `${height.toFixed(1)} m clear`, 15, { 'font-weight': 650 });
      }
      if (district) {
        for (const [station, height, label, align] of [
          [cut.avenue, siteTerrainHeight(plan.terrain, ...at(cut.avenue)), 'S · 10 Avenue SW', 'start'],
          [cut.river, plan.water.level, 'Bow River · N', 'end']
        ]) {
          const [x, y] = project(frame, station, height), px = x + margin, py = y + drawingY;
          studyMark(svg, 'line', { x1: px, y1: py - 3, x2: px, y2: py - 26, stroke: rule });
          text(px, py - 33, label, 14, { 'text-anchor': align, 'font-weight': 650 });
        }
      }
      text(margin, 40, 'POLY NATION  /  WEST VILLAGE SITE SECTIONS', 15, { 'font-weight': 700, 'letter-spacing': 1.4 });
      text(margin, 78, title, 32, { 'font-weight': 680 });
      text(margin, 106, note, 15);
      text(w - margin, 40, sheetNumber, 16, { 'text-anchor': 'end' });
      for (const y of [125, h - 65]) studyMark(svg, 'line', { x1: margin, y1: y, x2: w - margin, y2: y, stroke: rule });
      const elevations = `Ground floor ${(plan.floor + plan.terrain.datum).toFixed(2)} m` +
        (surfaces.length ? `  ·  District study water level ${(plan.water.level + plan.terrain.datum).toFixed(2)} m` : '');
      text(margin, h - 38, `${elevations}  ·  Schematic site grades`, 14);
      const indicator = studyMark(svg, 'g', { fill: ink, 'font-size': 13 });
      drawScaleIndicator(indicator, frame.denominator, w - margin, h - 37, ink);

      return siteDrawingPreview(svg, title, index);
    });
    sections.push(renderSiteFoundationAxo(study, contextGeometry, scales, pale, sections.length));
    return sections;
  }

  async function renderCraneDocument(revision) {
    const target = $('documentPages'), feedback = $('craneSetStatus'),
      paper = CRANE_DRAWING_PAPER,
      width = paper.width * DRAWING_PIXELS_PER_INCH, height = paper.height * DRAWING_PIXELS_PER_INCH,
      margin = 48, ink = '#203a35', muted = '#4d655d', rule = '#a9b9b3',
      pens = drawingPens({
        mode: 'component', widths: [0.30, 0.28, 0.14, 0.18, 0.26],
        colors: ['#20564f', '#985324', '#899692', '#5792a3', '#254b76'],
        components: { docks: 0, modules: 1, core: 2, circulation: 3, rides: 4, site: 2 }
      }),
      view = { ...state, craneBearing: settings.craneBearing ?? state.craneBearing },
      current = () => revision === craneRender && !timer && settings.document === 'cranes' && !panel.hidden,
      step = () => new Promise((resolve) => setTimeout(resolve, 0));
    cranePages = [];
    target.replaceChildren();
    feedback.textContent = 'Preparing crane sheets…';
    const text = (svg, x, y, content, size, options = {}) => studyMark(svg, 'text', {
      x, y, fill: ink, 'font-size': size, ...options
    }, content);
    function sheet(title, subtitle, support, kind) {
      const number = `PN–CR–${String(cranePages.length + 1).padStart(2, '0')}`,
        svg = studySVG(width, height, `${title} · ${subtitle}`);
      svg.classList.add('drawing-sheet');
      svg.setAttribute('width', '17in');
      svg.setAttribute('height', '11in');
      svg.setAttribute('font-family', 'system-ui, sans-serif');
      svg.dataset.craneSupport = support;
      svg.dataset.craneView = kind;
      studyMark(svg, 'title', {}, `${number} · ${title}`);
      studyMark(svg, 'rect', { width, height, fill: '#ffffff' });
      text(svg, margin, 40, 'POLY NATION  /  MODULE HANDLING STUDIES', 15, { 'font-weight': 690, 'letter-spacing': 1.4 });
      text(svg, margin, 78, title, 32, { 'font-weight': 690 });
      text(svg, margin, 106, subtitle, 15, { fill: muted });
      text(svg, width - margin, 40, number, 16, { 'text-anchor': 'end', 'font-weight': 650 });
      studyMark(svg, 'line', { x1: margin, x2: width - margin, y1: 125, y2: 125, stroke: rule });
      studyMark(svg, 'line', { x1: margin, x2: width - margin, y1: 901, y2: 901, stroke: rule });
      text(svg, margin, 929, `Design variation ${view.seed}  ·  ${sourceModel.layers.length} levels`, 14, { fill: muted });
      text(svg, width - margin, 929, '11 × 17 in  /  Print at actual size', 14, { fill: muted, 'text-anchor': 'end' });
      return { svg, number };
    }
    function tile(svg, geometry, camera, { title, note, x, y, w, h, planes = [], focus, compass = false, scales }) {
      const frame = renderDrawing(geometry, camera, planes, paper, 'auto', false, centeredPlacement(), false, pens,
        { region: { width: w, height: h - 34 }, focus, scales });
      const drawing = floorView(frame, '', x, y + 20), area = drawing.children[0];
      drawing.replaceChildren(area);
      studyMark(svg, 'rect', { x, y, width: w, height: h, fill: 'none', stroke: '#dce5df' });
      svg.append(drawing);
      text(svg, x + 13, y + 25, title, 17, { 'font-weight': 650 });
      text(svg, x + 13, y + h - 19, note, 13, { fill: muted });
      const indicator = studyMark(svg, 'g', { fill: ink, 'font-size': 13 });
      drawScaleIndicator(indicator, frame.denominator, x + w - 14, y + h - 17, ink, compass ? frame.basis : null);
      if (!frame.populated) text(svg, x + 13, y + 52, 'No geometry in this view', 13, { fill: muted });
      return frame;
    }
    function cableCallout(svg, frame, bounds, point, label, detail, align) {
      const { x, y, w } = bounds, { originX, originY, basis, scale } = frame,
        px = x + originX + dot(point, basis.right) * scale,
        py = y + 20 + originY - dot(point, basis.up) * scale,
        left = align === 'start', textX = x + (left ? 13 : w - 13), from = x + (left ? 145 : w - 145),
        colour = pens.colors[4];
      studyMark(svg, 'line', { x1: from, x2: px, y1: py, y2: py, stroke: colour });
      studyMark(svg, 'circle', { cx: px, cy: py, r: 2.5, fill: '#ffffff', stroke: colour });
      text(svg, textX, py - 3, label, 13, { fill: colour, 'text-anchor': align, 'font-weight': 690 });
      text(svg, textX, py + 14, detail, 12, { fill: muted, 'text-anchor': align });
    }
    function add({ svg, number }) {
      const preview = document.createElement('figure'), button = document.createElement('button'),
        vector = () => svg.cloneNode(true);
      preview.className = 'lobby-axo-page';
      button.type = 'button';
      button.textContent = 'Export SVG';
      button.setAttribute('aria-label', `Export ${number} as SVG`);
      button.onclick = () => downloadBlob(new XMLSerializer().serializeToString(vector()), 'image/svg+xml',
        `poly-nation-${view.seed}-${number.toLowerCase().replaceAll('–', '-')}.svg`);
      preview.append(button, svg);
      cranePages.push({ vector });
      target.append(preview);
      feedback.textContent = `Preparing crane sheets… ${cranePages.length} ready`;
    }
    const columns = 2, gap = 18, panelWidth = (width - margin * 2 - gap) / columns, panelHeight = 358;
    const sequenceTile = (index) => ({
      x: margin + index % columns * (panelWidth + gap),
      y: 143 + Math.floor(index / columns) * (panelHeight + gap), w: panelWidth, h: panelHeight
    });
    try {
      const models = craneStudyModels(sourceModel, settings.craneSetSupport, view);
      for (const { model, settings: poseSettings, heading } of models) {
        const crane = model.crane, support = crane.runway, label = CRANE_RUNWAYS[support];
        await step();
        if (!current()) return;
        const overview = craneStudyGeometry(model, { ...poseSettings, craneStage: 'parked' }, false),
          bearing = craneDegrees(heading), elevation = { az: heading + Math.PI / 2, el: 0 };
        const views = [
          ['axo', 'Project axonometric', { az: heading + 1.08, el: 0.60 }],
          ['elevation', 'Project elevation', elevation]
        ];
        for (const [kind, title, camera] of views) {
          await step();
          if (!current()) return;
          const page = sheet(label, CRANE_STUDY_GUIDE[support], support, kind);
          tile(page.svg, overview, camera, {
            title, note: `Gantry parked at ${bearing}°  ·  Green shows the crane and runway`,
            x: margin, y: 143, w: width - 2 * margin, h: 736, compass: kind === 'axo',
            scales: [250, 500, 750, 1000, 1250, 2000, 2500, 5000]
          });
          add(page);
        }
      }
      const installation = models.find(({ bay }) => bay);
      if (installation) {
        const { model, settings: poseSettings, heading, bay } = installation, crane = model.crane,
          above = craneStudyUpperBay(model, bay), bearing = craneDegrees(heading),
          page = sheet('Module docking / Shared installation sequence',
            `All three crane options use this sequence  ·  Level ${bay.f + 1}, Bay ${bay.j + 1} at ${bearing}°  ·  ${above ? 'Occupied bay above' : 'Clear installation lane'}`,
            'shared', 'installation'),
          normal = [-Math.sin(heading), 0, Math.cos(heading)],
          planes = [{ normal, offset: 3.55 }, { normal, offset: -3.55, flip: true }],
          nearBay = { normal: [Math.cos(heading), 0, Math.sin(heading)], offset: model.R - 2.2, flip: true },
          elevation = { az: heading + Math.PI / 2, el: 0 };
        for (const [i, [stage, title, note]] of CRANE_STUDY_STAGES.entries()) {
          await step();
          if (!current()) return;
          const options = { ...poseSettings, craneStage: stage }, pose = moduleCranePose(model, crane, options),
            geometry = craneStudyGeometry(model, options, true, sourceAssignments), bounds = sequenceTile(i),
            showBoom = stage === 'insert',
            focus = craneStudyFocus(heading, model.R - 1.8, crane.tower + 0.8,
              Math.max(-1.3, pose.payloadY - (showBoom ? 1.6 : 4.5)),
              showBoom ? crane.head + crane.depth + 0.25 : pose.payloadY + 9.2),
            camera = showBoom ? { az: heading + 1.14, el: 0.16 }
              : i ? elevation : { az: heading + 1.08, el: 0.35 },
            frame = tile(page.svg, geometry, camera, { ...bounds, title: `${i + 1}. ${title}`, note, focus,
              planes: showBoom ? [...planes, nearBay] : planes,
              scales: showBoom ? [250, 500, 750, 1000, 1250, 2000] : undefined });
          if (showBoom) {
            const [inboard, outboard] = craneHoistStations(crane, pose), { jawHalfWidth } = craneCassetteRig(),
              { point } = craneFrame(null, heading);
            cableCallout(page.svg, frame, bounds, point(inboard.radius, jawHalfWidth, inboard.pinY),
              'Inboard pair', 'Reeled up to trolley', 'start');
            cableCallout(page.svg, frame, bounds,
              point(outboard.radius, -jawHalfWidth, (outboard.pinY + outboard.boomY) * 0.5),
              'Outboard pair', 'Still pinned to chassis', 'end');
          }
        }
        add(page);
      }
      const moat = models.find(({ model }) => model.crane.runway === 'moat');
      if (moat) {
        const { model, heading } = moat, crane = model.crane;
        const page = sheet('Moat drawbridge / Operating sequence',
          'The 10 m clear bascule closes to pedestrians before lifting. The gantry passes on the twin rails above the water.', 'moat', 'drawbridge'),
          axis = crane.gateAngles.reduce((nearest, angle) => angDist(angle, heading) < angDist(nearest, heading) ? angle : nearest),
          { inner, outer } = craneMoatBounds(crane), full = moatLiftFullyOpenAt(crane),
          focus = craneStudyFocus(axis, inner - 2.8, outer + 2.9, -1.2, 10.3, 5.8),
          stages = [
            [full + 24, 'Pedestrian crossing open', 'Leaf seated, approach barriers up.'],
            [full + 13, 'Approach barriers close', 'The leaf stays seated while pedestrian access closes.'],
            [full + 5, 'Counterweighted leaf rises', 'The 10 m deck rotates around its inner-bank hinge.'],
            [0, 'Gantry passes', 'The raised leaf leaves both rails clear.']
          ];
        for (const [i, [distance, title, note]] of stages.entries()) {
          await step();
          if (!current()) return;
          const mesh = meshBuilder(), angle = axis + distance / inner, paint = rgb(cranePaint(sourceAssignments));
          drawCraneMoat(mesh, model, crane, paint, angle, false);
          if (i === stages.length - 1) drawCraneGantry(mesh, crane, { angle, stage: 'parked' }, paint);
          const across = [-Math.sin(axis), 0, Math.cos(axis)], along = [Math.cos(axis), 0, Math.sin(axis)],
            planes = [{ normal: across, offset: 11 }, { normal: across, offset: -11, flip: true },
              { normal: along, offset: inner - 6, flip: true }, { normal: along, offset: outer + 6 },
              { normal: [0, 1, 0], offset: 10.3 }];
          const geometry = drawingGeometry(mesh, model, { component: craneStudyComponent });
          tile(page.svg, geometry, { az: axis + 0.91, el: 0.46 }, {
            ...sequenceTile(i), title: `${i + 1}. ${title}`, note, focus, planes
          });
        }
        add(page);
      }
      if (!current()) return;
      const available = settings.craneSetSupport === 'all' ? 3 : 1;
      feedback.textContent = !models.length ? 'The selected crane has no clear runway in this design.' :
        `${cranePages.length} sheets ready.` + (models.length < available ? ' Some crane options do not fit the current ring.' : '') +
        (!installation ? ' The installation sheet requires a clear dock on the selected level.' : '');
      $('printDocument').disabled = !cranePages.length;
    } catch (error) {
      console.error('Crane set render failed', error);
      if (current()) feedback.textContent = 'The crane set could not be prepared.';
    }
  }

  function render() {
    timer = 0;
    if (!sourceModel || panel.hidden) return;
    const revision = ++craneRender;
    if (settings.document === 'cranes') {
      renderCraneDocument(revision);
      $('drawingDocumentStage').scrollTop = 0;
      return;
    }
    cranePages = [];
    const paper = paperDimensions();
    try {
      if (settings.document) {
        lobbyPages = settings.document === 'lobbies' ? renderLobbyPages(paper) : [];
        sitePages = settings.document === 'site-sections' ? renderSiteSections() : [];
        const pages = settings.document === 'lobbies'
          ? lobbyPages.map(({ preview }) => preview)
          : settings.document === 'site-sections' ? sitePages.map(({ preview }) => preview)
            : drawingSetPages(settings.document, sourceModel, sourceAssignments);
        $('printDocument').disabled = !pages.length;
        if (!pages.length) {
          const message = document.createElement('p');
          message.className = 'hint';
          message.textContent = settings.document === 'site-sections'
            ? 'Load live terrain in Site to generate sections for the current placement.'
            : 'No shared lobbies in this design. Set an Attract relationship in Massing to generate one where space allows.';
          pages.push(message);
        }
        $('documentPages').replaceChildren(...pages);
        $('drawingDocumentStage').scrollTop = 0;
        return;
      }
      const includeSite = settings.showSite && siteWorkspace.hasTerrain,
        craneBearing = settings.craneBearing ?? state.craneBearing,
        mode = `${settings.source}/${settings.mode}/${settings.craneRunway}/${craneBearing}/${includeSite ? siteWorkspace.revision : 'building'}`;
      if (!settings.detail && (!geometry || renderedGeometryMode !== mode)) {
        const view = {
          ...state,
          inspect: 0,
          grid: false,
          xray: false,
          showRooms: true,
          programEditing: false,
          supports: true,
          showFacade: true,
          showModules: true,
          showRoofDeck: true,
          roof: true,
          craneStage: 'parked',
          craneBearing
        };
        const preview = {
          assignments: sourceAssignments,
          view,
          structureView: false,
          craneSettings: view,
          programColors: settings.mode === 'combined' || settings.mode === 'program',
          finishJoints: settings.mode === 'material' || settings.mode === 'combined'
        };
        let model = sourceModel;
        if (settings.craneRunway !== 'design' && settings.craneRunway !== sourceModel.crane?.runway) {
          const { R, lobby, slots, feature } = sourceModel, crane = planModuleCrane(sourceModel, settings.craneRunway);
          model = { ...sourceModel, crane, plaza: designPlaza(R, lobby, slots, feature.climbing, crane) };
        }
        const mesh = settings.source === 'build'
          ? buildAssemblyMesh(model, buildViewLayers(), 0, preview)
          : buildMesh(model, false, view, preview);
        geometry = drawingGeometry(includeSite ? siteWorkspace.composeDrawing(mesh, model) : mesh, sourceModel);
        renderedGeometryMode = mode;
      }
      const camera = settings.detail ? null : viewCamera();
      const optics = camera && sectionOptics(), lobby = camera && focusedLobbyPlan();
      $('groundDrawing').disabled = !camera || Math.abs(Math.cos(camera.el)) <= 0.01;
      if (!allPlans()) floorTiles.replaceChildren();
      rendered = settings.detail
        ? renderConnectionSheet(paper)
        : allPlans()
          ? renderFloorSheet(paper, camera)
          : renderDrawing(
              geometry,
              camera,
              drawingClips(settings.planes),
              paper,
              settings.scale,
              settings.glazing,
              settings.placement,
              settings.mode !== 'linework',
              settings.pens,
              { sectionLens: optics, focus: lobby ? lobbyPlanFrame(lobby, includeSite) : null,
                cutFill: settings.cutFill }
            );
      // Older sheets store their pan in paper millimetres. Convert at the saved scale so
      // subsequent scale changes preserve the current crop.
      if (rendered.scale && !settings.placement.modelUnits) {
        const metresPerMillimetre = DRAWING_PIXELS_PER_INCH / (25.4 * rendered.scale);
        settings.placement.x *= metresPerMillimetre;
        settings.placement.y *= metresPerMillimetre;
        settings.placement.modelUnits = true;
        saveDrawing();
      }
      const lobbyTitle = lobby && `Shared lobby plan · Level ${lobby.f + 1}`,
        { width, height, margin, denominator } = rendered,
        ruleY = height - margin * 1.8,
        textY = height - margin,
        viewLabel = lobbyTitle ? lobbyTitle + (optics ? ` · ${optics.millimetres} mm` : '') : settings.detail
          ? CONNECTION_DETAIL_TITLES[settings.detail]
          : allPlans()
            ? 'Floor plans'
            : settings.view === 'aligned'
              ? optics ? `Section perspective · ${optics.millimetres} mm` : currentPlane()?.axis === 'vertical'
                ? 'Section'
                : 'Plan section'
              : $('drawingView').selectedOptions[0].text;
      sheet.setAttribute('viewBox', `0 0 ${width} ${height}`);
      if (optics) sheet.dataset.sectionLens = optics.millimetres;
      else delete sheet.dataset.sectionLens;
      clipRect.setAttribute('x', margin);
      clipRect.setAttribute('y', margin);
      clipRect.setAttribute('width', width - margin * 2);
      clipRect.setAttribute('height', rendered.drawingHeight);
      content.removeAttribute('transform');
      paperLayer.replaceChildren(svgElement('rect', { width, height, fill: settings.pens.paper }));
      if (allPlans()) sheetArtwork.replaceChildren();
      else if (!settings.detail) renderPens(sheetArtwork, rendered, true);
      footerRule.setAttribute('x1', margin);
      const sheetText = sheetInk(settings.pens.paper);
      footer.setAttribute('fill', sheetText);
      footerRule.setAttribute('x2', width - margin);
      footerRule.setAttribute('y1', ruleY);
      footerRule.setAttribute('y2', ruleY);
      footerTitle.setAttribute('x', margin);
      footerTitle.setAttribute('y', textY);
      const runwayLabel = !settings.detail && settings.craneRunway !== 'design'
        ? ` · ${CRANE_RUNWAYS[settings.craneRunway]}` : '';
      footerTitle.textContent = 'Poly Nation · ' + viewLabel + runwayLabel;
      // Elevations and upright sections have an edge-on plan. Their footer only needs the scale.
      const mapBasis = camera && Math.abs(camera.el) > 0.01 ? orbitBasis(camera) : null;
      drawScaleIndicator(footerScale, denominator, width - margin, textY, sheetText, mapBasis);
      syncPenScaleNote(denominator);
      exportButton.disabled = printButton.disabled = !rendered.populated;
      $('printFloorSet').disabled = printingFloorSet;
      resizePaperPreview();
      showStatus();
    } catch (error) {
      console.error('Drawing render failed', error);
      status.textContent = 'The drawing could not be rendered.';
      if (settings.document) {
        lobbyPages = [];
        $('printDocument').disabled = true;
        $('documentPages').textContent = 'The document could not be rendered.';
      }
    }
  }
  function showStatus() {
    status.textContent = settings.detail
      ? '1:25 connection detail with enlarged exterior fittings. Uses the current Build dock structure and slab.'
      : placing
      ? 'Click the drawing to place the selected plane.'
      : rendered?.cropped
        ? allPlans()
          ? 'Some plans extend past their panels. Use Fit to scale the set.'
          : 'Drawing extends past the sheet. Drag to choose the part to export.'
        : exportButton.disabled
          ? 'The planes clip all the visible geometry.'
          : allPlans()
            ? 'Floor plans share a drawing scale.'
            : 'Drag the drawing or use the arrow keys to reposition it.';
  }
  function queueDrawing() {
    saveDrawing();
    exportButton.disabled = printButton.disabled = true;
    $('printDocument').disabled = true;
    $('printFloorSet').disabled = true;
    clearTimeout(timer);
    timer = setTimeout(render, 45);
  }
  new ResizeObserver(() => {
    if (!panel.hidden) resizePaperPreview();
  }).observe(paperFrame);

  function syncOffset(plane) {
    const [min, max] = offsetLimits(plane);
    for (const input of [$('drawingPlaneOffset'), $('drawingPlaneMove')]) {
      input.min = min;
      input.max = max;
      input.value = plane.offset;
    }
    const elevation = $('drawingCutElevation');
    elevation.hidden = plane.axis !== 'horizontal';
    elevation.value = `Cut elevation ${planeHeight(plane).toFixed(2)} m`;
  }
  function drawingClips(planes) {
    return planes.map((plane) => ({
      normal: normalFor(plane),
      flip: plane.flip,
      offset: planeHeight(plane)
    }));
  }
  function stopPlacing() {
    placing = false;
    $('placeDrawingPlane').setAttribute('aria-pressed', 'false');
    sheet.dataset.placing = 'false';
  }
  function syncPenScaleNote(denominator) {
    const pens = settings.pens;
    const widths = printedDrawingPenWidths(pens, denominator).map((width) => width.toFixed(2));
    $('drawingPenScaleNote').textContent = pens.adaptToScale
      ? `Your settings apply at 1:${DRAWING_PEN_REFERENCE_SCALE}. At 1:${denominator} the pens print at ${widths.join(' / ')} mm.`
      : 'Widths stay fixed on paper at every scale.';
  }

  // Rebuild the paired controls only when the pen set or assignment scheme changes.
  function syncPenControls() {
    const pens = settings.pens;
    $('drawingPenMode').value = pens.mode;
    $('drawingPenStyle').value = pens.style;
    $('drawingPaperColor').value = pens.paper;
    $('drawingInkColor').value = pens.colors[0];
    $('drawingPenCount').value = pens.widths.length;
    $('drawingAdaptWeights').checked = pens.adaptToScale;
    $('drawingSilhouette').checked = pens.silhouette;
    $('drawingComponentOutlines').checked = pens.componentOutlines;
    const components = $('drawingPenComponents');
    components.hidden = pens.mode !== 'component';
    components.replaceChildren(
      ...Object.entries(DRAWING_COMPONENTS).map(([key, [name]]) => {
        const label = document.createElement('label'),
          select = document.createElement('select');
        label.className = 'drawing-view-field';
        select.setAttribute('aria-label', name);
        label.append(name, select);
        for (const [i, width] of pens.widths.entries())
          select.add(new Option(`Pen ${i + 1} · ${width.toFixed(2)} mm`, i));
        select.value = pens.components[key];
        select.onchange = () => {
          pens.components[key] = Number(select.value);
          queueDrawing();
        };
        return label;
      })
    );
    $('drawingPenWidths').replaceChildren(
      ...pens.widths.map((width, i) => {
        const row = document.createElement('div'),
          name = document.createElement('span'),
          slider = document.createElement('input'),
          number = document.createElement('input'),
          color = document.createElement('input');
        row.className = 'drawing-pen-row';
        name.textContent = `Pen ${i + 1} · mm`;
        slider.type = 'range';
        number.type = 'number';
        color.type = 'color';
        color.value = pens.colors[i];
        color.setAttribute('aria-label', `Pen ${i + 1} colour`);
        color.onchange = () => {
          pens.colors[i] = color.value;
          queueDrawing();
        };
        for (const input of [slider, number]) {
          Object.assign(input, DRAWING_PEN_LIMITS);
          input.value = width;
          input.setAttribute(
            'aria-label',
            `Pen ${i + 1} ${input === slider ? 'width slider' : 'width in millimetres'}`
          );
        }
        const update = (value) => {
          const next = Number.isFinite(value)
            ? clamp(value, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max)
            : pens.widths[i];
          pens.widths[i] = next;
          slider.value = number.value = next;
          for (const select of components.querySelectorAll('select'))
            select.options[i].textContent = `Pen ${i + 1} · ${next.toFixed(2)} mm`;
          queueDrawing();
        };
        slider.oninput = () => {
          number.value = slider.value;
        };
        slider.onchange = () => update(slider.valueAsNumber);
        number.onchange = () => update(number.valueAsNumber);
        row.append(name, slider, number, color);
        return row;
      })
    );
  }
  $('drawingPenMode').onchange = (event) => {
    settings.pens.mode = event.target.value;
    syncPenControls();
    queueDrawing();
  };
  $('drawingPenCount').onchange = (event) => {
    settings.pens = drawingPens({
      ...settings.pens,
      components: undefined,
      widths: DRAWING_PEN_PRESETS[Number(event.target.value)]
    });
    syncPenControls();
    queueDrawing();
  };
  $('drawingPenStyle').onchange = (event) => {
    settings.pens.style = event.target.value;
    queueDrawing();
  };
  $('drawingAdaptWeights').onchange = (event) => {
    settings.pens.adaptToScale = event.target.checked;
    queueDrawing();
  };
  $('drawingSilhouette').onchange = (event) => {
    settings.pens.silhouette = event.target.checked;
    queueDrawing();
  };
  $('drawingComponentOutlines').onchange = (event) => {
    settings.pens.componentOutlines = event.target.checked;
    queueDrawing();
  };
  $('drawingPaperColor').onchange = (event) => {
    settings.pens.paper = event.target.value;
    queueDrawing();
  };
  $('drawingInkColor').onchange = (event) => {
    settings.pens.colors.fill(event.target.value);
    syncPenControls();
    queueDrawing();
  };

  function syncSiteControl() {
    const detail = Boolean(settings.detail), loaded = siteWorkspace.hasTerrain;
    $('drawingSiteField').hidden = detail;
    $('drawingSite').disabled = detail || !loaded;
    $('drawingSite').checked = loaded && settings.showSite;
    $('drawingSiteNote').hidden = detail || loaded;
  }

  function syncSettings() {
    if (!currentPlane()) settings.selected = settings.planes[0]?.id ?? null;
    const plane = currentPlane();
    if (!plane && settings.view === 'aligned') settings.view = 'axo';
    $('drawingView').value = settings.view;
    const documentMode = Boolean(settings.document);
    $('drawingDocument').value = settings.document;
    syncLobbyControls();
    $('craneDrawingControls').hidden = settings.document !== 'cranes';
    $('drawingCraneSetSupport').value = settings.craneSetSupport;
    $('singleDrawingControls').hidden = $('drawingMainStage').hidden = documentMode;
    $('drawingDocumentStage').hidden = !documentMode;
    const detail = Boolean(settings.detail);
    $('drawingDetail').value = settings.detail;
    $('drawingDetailNote').hidden = !detail;
    $('drawingDetailNote').textContent = detail
      ? DOCK_STRUCTURES[buildViewLayers().dockStructure].name
      : '';
    for (const id of [
      'drawingView',
      'drawingSource',
      'drawingCraneRunway',
      'drawingRendering',
      'drawingGlazing',
      'addDrawingPlane',
      'drawingScale',
      'fitDrawing'
    ])
      $(id).disabled = detail;
    $('drawingPlanes').hidden = detail;
    const availableLobbies = sourceModel?.circulation.hubs.filter((hub) => hub.layout) ?? [];
    for (const id of ['drawingLobbyCut', 'drawingLobbyPlan']) {
      $(id + 'Field').hidden = detail;
      $(id).replaceChildren(
        new Option(availableLobbies.length ? 'Choose a shared lobby' : 'No shared lobbies in this design', ''),
        ...availableLobbies.map((hub) => new Option(
          `Level ${hub.f + 1} · ${hub.pair.map((p) => P[p].name).join(' + ')}`, lobbyKey(hub)))
      );
      $(id).disabled = !availableLobbies.length;
    }
    $('drawingSource').value = settings.source;
    $('drawingCraneRunway').value = settings.craneRunway;
    $('drawingCraneBearing').value = settings.craneBearing ?? '';
    $('drawingCraneBearing').placeholder = `${state.craneBearing}° · Design`;
    $('drawingCraneBearing').disabled = detail;
    syncSiteControl();
    $('drawingPlanSheet').value = settings.planSheet;
    syncCompass();
    $('drawingRendering').value = settings.mode;
    syncPenControls();
    $('drawingPaper').value = settings.paper;
    $('drawingOrientation').value = settings.orientation;
    $('drawingScale').value = detail ? '25' : settings.scale;
    $('drawingGlazing').checked = settings.glazing;
    $('drawingPlaneFields').hidden = detail || !plane;
    $('drawingPlanes').replaceChildren(
      ...settings.planes.map((item, index) => {
        const row = document.createElement('div'),
          choose = document.createElement('button'),
          remove = document.createElement('button');
        row.className = 'drawing-plane-row';
        choose.type = remove.type = 'button';
        choose.textContent = `Plane ${index + 1} · ${item.axis === 'horizontal' ? 'Horizontal' : 'Vertical'}`;
        choose.setAttribute('aria-pressed', String(item.id === settings.selected));
        choose.onclick = () => {
          settings.selected = item.id;
          stopPlacing();
          syncSettings();
          $('drawingPlaneAxis').focus();
          queueDrawing();
        };
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove plane ' + (index + 1));
        remove.onclick = () => {
          settings.planes = settings.planes.filter((candidate) => candidate.id !== item.id);
          stopPlacing();
          syncSettings();
          $('addDrawingPlane').focus();
          queueDrawing();
        };
        row.append(choose, remove);
        return row;
      })
    );
    if (!plane) return;
    $('drawingPlaneAxis').value = plane.axis;
    $('drawingAngleField').hidden = plane.axis !== 'vertical';
    $('drawingFloorField').hidden = plane.axis !== 'horizontal';
    $('centerDrawingPlane').hidden = plane.axis !== 'vertical';
    $('drawingPlaneMove').setAttribute(
      'list',
      plane.axis === 'vertical' ? 'drawingCenterTick' : ''
    );
    $('drawingFloor').value = plane.floor == null ? '' : String(plane.floor);
    $('drawingPlaneAngle').value = Math.round(planeAngle(plane));
    $('flipDrawingPlane').checked = plane.flip;
    syncOffset(plane);
  }

  $('drawingView').onchange = (event) => {
    settings.view = event.target.value;
    syncCompass();
    queueDrawing();
  };
  $('drawingOrbit').oninput = (event) => {
    settings.elevation = event.target.valueAsNumber;
    syncCompass();
    queueDrawing();
  };
  $('drawingSource').onchange = (event) => {
    settings.source = event.target.value;
    queueDrawing();
  };
  $('drawingCraneRunway').onchange = (event) => {
    settings.craneRunway = event.target.value;
    queueDrawing();
  };
  $('drawingCraneBearing').onchange = (event) => {
    const value = event.target.valueAsNumber;
    settings.craneBearing = Number.isFinite(value) ? clamp(Math.round(value), 0, 359) : null;
    event.target.value = settings.craneBearing ?? '';
    queueDrawing();
  };
  $('drawingSite').onchange = (event) => {
    settings.showSite = event.target.checked;
    syncSettings();
    queueDrawing();
  };
  document.addEventListener('west-village-change', () => {
    if (panel.hidden) return;
    syncSettings();
    if (settings.showSite || settings.document === 'site-sections') queueDrawing();
  });
  $('drawingDetail').onchange = (event) => {
    settings.detail = event.target.value;
    stopPlacing();
    syncSettings();
    queueDrawing();
  };
  $('drawingDocument').onchange = (event) => {
    settings.document = event.target.value;
    stopPlacing();
    syncSettings();
    queueDrawing();
  };
  $('drawingCraneSetSupport').onchange = (event) => {
    settings.craneSetSupport = event.target.value;
    queueDrawing();
  };
  for (const [id, key] of [
    ['drawingLobbyDirection', 'lobbyDirection'],
    ['drawingLobbyViews', 'lobbyViews'],
    ['drawingLobbyRender', 'lobbyRender'],
    ['drawingLobbyPaper', 'paper'],
    ['drawingLobbyOrientation', 'orientation']
  ]) {
    $(id).onchange = (event) => {
      settings[key] = event.target.value;
      syncLobbyControls();
      queueDrawing();
    };
  }
  $('drawingLobbyContext').onchange = (event) => {
    settings.lobbyContext = event.target.checked;
    queueDrawing();
  };
  $('drawingPlanSheet').onchange = (event) => {
    settings.planSheet = event.target.value;
    stopPlacing();
    syncCompass();
    queueDrawing();
  };
  $('drawingRendering').onchange = (event) => {
    settings.mode = event.target.value;
    queueDrawing();
  };
  $('drawingPaper').onchange = (event) => {
    settings.paper = event.target.value;
    queueDrawing();
  };
  $('drawingOrientation').onchange = (event) => {
    settings.orientation = event.target.value;
    queueDrawing();
  };
  $('drawingScale').onchange = (event) => {
    settings.scale = event.target.value;
    queueDrawing();
  };
  $('drawingGlazing').onchange = (event) => {
    settings.glazing = event.target.checked;
    queueDrawing();
  };
  $('drawingCutFill').onchange = (event) => {
    settings.cutFill = event.target.checked;
    queueDrawing();
  };
  $('fitDrawing').onclick = () => {
    settings.scale = 'auto';
    $('drawingScale').value = settings.scale;
    settings.placement = centeredPlacement();
    queueDrawing();
  };
  $('centerDrawing').onclick = () => {
    settings.placement = centeredPlacement();
    queueDrawing();
  };
  $('groundDrawing').onclick = () => {
    settings.placement.y = 0;
    settings.placement.ground = true;
    queueDrawing();
  };
  $('addDrawingPlane').onclick = () => {
    const id = Math.max(0, ...settings.planes.map((plane) => plane.id)) + 1,
      horizontal = settings.view === 'plan',
      angle = Math.round((viewCamera().az * 180) / Math.PI);
    settings.planes.push({
      id,
      axis: horizontal ? 'horizontal' : 'vertical',
      offset: horizontal ? 1.2 : 0,
      angle: mod(angle, 360),
      flip: false
    });
    settings.selected = id;
    stopPlacing();
    syncSettings();
    $('drawingPlaneAxis').focus();
    queueDrawing();
  };
  function applyLobbyCut(key, axis) {
    const hub = sourceModel.circulation.hubs.find(
      (candidate) => candidate.layout && lobbyKey(candidate) === key
    );
    if (!hub) return;
    const selected = currentPlane(),
      // Plan and section are alternative views of a lobby. Reuse their plane so they do not clip each other.
      existing =
        settings.planes.find((plane) => plane.lobbyKey) ??
        (selected?.axis === axis ? selected : null),
      plane = existing ?? { id: Math.max(0, ...settings.planes.map((item) => item.id)) + 1 },
      horizontal = axis === 'horizontal';
    if (horizontal || (plane.lobbyKey && plane.axis === 'horizontal')) {
      settings.scale = 'auto';
      settings.placement = centeredPlacement();
    }
    if (!existing) settings.planes.push(plane);
    Object.assign(plane, {
      axis,
      lobbyKey: key,
      offset: horizontal ? 1.7 : 0,
      floor: horizontal ? hub.f : null,
      flip: !horizontal && plane.axis === axis && Boolean(plane.flip)
    });
    plane.angle = horizontal ? 0 : planeAngle(plane);
    settings.selected = plane.id;
    settings.view = 'aligned';
    stopPlacing();
    syncSettings();
    queueDrawing();
  }
  $('drawingLobbyCut').onchange = (event) => applyLobbyCut(event.target.value, 'vertical');
  $('drawingLobbyPlan').onchange = (event) => applyLobbyCut(event.target.value, 'horizontal');

  $('drawingSectionProjection').onchange = (event) => {
    settings.sectionProjection = event.target.value;
    syncSectionView();
    queueDrawing();
  };
  $('drawingPerspectiveFade').oninput = (event) => {
    settings.perspectiveFade = event.target.valueAsNumber;
    syncPerspectiveFade();
    // SVG export copies these attributes. Keep the slider responsive without reprojecting the model.
    for (const stroke of sheetArtwork.querySelectorAll('[data-perspective-stroke]'))
      stroke.setAttribute('stroke-opacity', perspectiveOpacity());
    saveDrawing();
  };
  const lensSlider = $('drawingSectionLens');
  let lensPointer = false;
  lensSlider.onpointerdown = () => {
    lensPointer = true;
  };
  lensSlider.onpointercancel = lensSlider.onkeydown = () => {
    lensPointer = false;
  };
  function setLens(mm, moveSlider = true) {
    settings.sectionLens = clamp(Math.round(mm), 8, 200);
    $('drawingSectionLensNumber').value = settings.sectionLens;
    lensSlider.setAttribute('aria-valuetext', settings.sectionLens + ' millimetres');
    if (moveSlider) lensSlider.value = lensPosition(settings.sectionLens);
    queueDrawing();
  }
  lensSlider.oninput = () => setLens(lensMillimetres(lensSlider.valueAsNumber), false);
  lensSlider.onchange = () => {
    const position = lensSlider.valueAsNumber;
    const stop = SECTION_LENS_STOPS.find((mm) => Math.abs(lensPosition(mm) - position) <= 18);
    setLens(lensPointer && stop ? stop : lensMillimetres(position));
    lensPointer = false;
  };
  $('drawingSectionLensNumber').onchange = (event) => {
    setLens(
      Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : settings.sectionLens
    );
  };

  $('drawingPlaneAxis').onchange = (event) => {
    const plane = currentPlane();
    delete plane.lobbyKey;
    plane.axis = event.target.value;
    plane.floor = null;
    plane.offset = plane.axis === 'horizontal' ? 1.2 : 0;
    syncSettings();
    queueDrawing();
  };
  $('drawingFloor').onchange = (event) => {
    const plane = currentPlane(),
      selected = event.target.value,
      pitch = modelFloorPitch(sourceModel);
    if (selected === '') plane.offset = planeHeight(plane);
    else if (plane.floor == null && Math.abs(plane.offset) > pitch)
      plane.offset = Math.round(mod(plane.offset, pitch) * 10) / 10;
    const floor = selected === '' ? null : Number(selected);
    if (plane.floor !== floor && plane.lobbyKey) {
      delete plane.lobbyKey;
      settings.placement = centeredPlacement();
    }
    plane.floor = floor;
    syncSectionView();
    movePlane(plane.offset);
  };
  $('centerDrawingPlane').onclick = () => movePlane(0);
  $('drawingPlaneAngle').onchange = (event) => {
    delete currentPlane().lobbyKey;
    currentPlane().angle = Number.isFinite(event.target.valueAsNumber)
      ? mod(event.target.valueAsNumber, 360)
      : currentPlane().angle;
    event.target.value = currentPlane().angle;
    $('drawingLobbyCut').value = '';
    queueDrawing();
  };
  function movePlane(value) {
    const plane = currentPlane();
    if (Number.isFinite(value)) {
      const [min, max] = offsetLimits(plane);
      plane.offset = Math.round(clamp(value, min, max) * 10) / 10;
      if (plane.axis === 'vertical' && plane.lobbyKey && plane.offset !== 0) {
        plane.angle = planeAngle(plane);
        delete plane.lobbyKey;
        $('drawingLobbyCut').value = '';
      }
    }
    syncOffset(plane);
    queueDrawing();
  }
  $('drawingPlaneMove').oninput = (event) => movePlane(event.target.valueAsNumber);
  let sliderPointer = false;
  $('drawingPlaneMove').onpointerdown = () => {
    sliderPointer = true;
  };
  $('drawingPlaneMove').onpointercancel = $('drawingPlaneMove').onkeydown = () => {
    sliderPointer = false;
  };
  $('drawingPlaneMove').onchange = (event) => {
    const plane = currentPlane();
    if (sliderPointer && plane.axis === 'vertical') {
      const reach = +event.target.max - +event.target.min;
      if (Math.abs(plane.offset) <= clamp((reach * 4) / event.target.clientWidth, 0.25, 2.5))
        movePlane(0);
    }
    sliderPointer = false;
  };
  $('drawingPlaneOffset').onchange = (event) => movePlane(event.target.valueAsNumber);
  $('flipDrawingPlane').onchange = (event) => {
    currentPlane().flip = event.target.checked;
    queueDrawing();
  };
  $('alignDrawingPlane').onclick = () => {
    settings.view = 'aligned';
    $('drawingView').value = settings.view;
    syncCompass();
    queueDrawing();
  };
  $('placeDrawingPlane').onclick = () => {
    placing = !placing;
    $('placeDrawingPlane').setAttribute('aria-pressed', String(placing));
    sheet.dataset.placing = String(placing);
    showStatus();
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placing) {
      stopPlacing();
      showStatus();
    }
  });
  function moveDrawing(x, y) {
    if (!rendered?.scale) return;
    const metresPerMillimetre = DRAWING_PIXELS_PER_INCH / (25.4 * rendered.scale);
    const placement = settings.placement;
    if (y && placement.ground && rendered.grounded) {
      // A vertical pan resumes free positioning from the visible ground-aligned frame.
      placement.y = (rendered.originY - rendered.centeredY) / rendered.scale;
      placement.ground = false;
    }
    placement.x += x * metresPerMillimetre;
    placement.y += y * metresPerMillimetre;
    queueDrawing();
  }
  function sheetPoint(event) {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      sheet.getScreenCTM().inverse()
    );
  }
  sheet.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ];
    if (!delta || settings.detail || placing || allPlans()) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    moveDrawing(delta[0] * step, delta[1] * step);
  });
  sheet.addEventListener('pointerdown', (event) => {
    if (settings.detail || placing || timer || !rendered || allPlans() || event.button !== 0)
      return;
    drag = { id: event.pointerId, start: sheetPoint(event), x: 0, y: 0 };
    sheet.focus({ preventScroll: true });
    sheet.setPointerCapture(event.pointerId);
    sheet.dataset.dragging = 'true';
    exportButton.disabled = printButton.disabled = true;
  });
  sheet.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    const at = sheetPoint(event);
    drag.x = at.x - drag.start.x;
    drag.y = at.y - drag.start.y;
    // Preview the last rendered strokes while dragging and recalculate visibility at the new crop.
    content.setAttribute('transform', `translate(${drag.x} ${drag.y})`);
  });
  sheet.addEventListener('lostpointercapture', (event) => {
    if (drag?.id !== event.pointerId) return;
    if (drag.x || drag.y)
      moveDrawing(
        (drag.x * 25.4) / DRAWING_PIXELS_PER_INCH,
        (drag.y * 25.4) / DRAWING_PIXELS_PER_INCH
      );
    else exportButton.disabled = printButton.disabled = !rendered.populated;
    drag = null;
    sheet.dataset.dragging = 'false';
  });
  sheet.addEventListener('click', (event) => {
    if (!placing || !rendered) return;
    const point = sheetPoint(event);
    const { basis, width, height, depth, scale, originX, originY, optics } = rendered;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return;
    const z = depth[Math.floor(point.y) * width + Math.floor(point.x)],
      normal = normalFor(currentPlane()),
      toward = dot(normal, basis.back);
    if (!Number.isFinite(z) && Math.abs(toward) > 0.1) {
      status.textContent = 'Click a visible surface or enter an offset.';
      return;
    }
    const [x, y, worldDepth] = optics && Number.isFinite(z)
      ? optics.unproject([point.x, point.y, z]) : [point.x, point.y, z];
    const offset = ((x - originX) / scale) * dot(normal, basis.right) -
      ((y - originY) / scale) * dot(normal, basis.up) + (Number.isFinite(worldDepth) ? worldDepth * toward : 0);
    stopPlacing();
    movePlane(offset - floorDatum(currentPlane()));
  });

  function exportArtwork(item, target) {
    if (item.localName === 'path' && !item.hasAttribute('fill-rule')) {
      // The renderer packs disconnected strokes into each path. Bound the number of subpaths per
      // object so large sheets remain practical to edit. Filled contours keep their holes together.
      const strokes = item.getAttribute('d').match(/M[^M]+/g) || [];
      for (let first = 0; first < strokes.length; first += 256) {
        const path = item.cloneNode(false);
        path.removeAttribute('id');
        path.setAttribute('d', strokes.slice(first, first + 256).join(''));
        target.append(path);
      }
      return;
    }
    target.append(item.cloneNode(true));
  }

  function vectorPage(paper, frame, caption, paperColour, pageFooter, regions, sectionLens) {
    const root = svgElement('svg', {
      width: paper.width + 'in',
      height: paper.height + 'in',
      viewBox: `0 0 ${frame.width} ${frame.height}`
    });
    if (sectionLens) root.dataset.sectionLens = sectionLens;
    const title = svgElement('title', {}),
      defs = svgElement('defs', {}),
      background = markSvgLayer(svgElement('g', {}), 'Paper'),
      layers = new Map();
    title.textContent = `${caption} · 1:${frame.denominator}`;
    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:inkscape', layerNS);
    background.append(
      svgElement('rect', { width: frame.width, height: frame.height, fill: paperColour })
    );
    root.append(title, defs, background);

    // Expose the paper, each pen and the other treatments at the root. Each group carries its own
    // crop so Illustrator can lift it into a layer without changing its appearance or position.
    function addRegion(source, crop, placement, number, makeFills) {
      const id = `Sheet_crop_${number + 1}`,
        boundary = svgElement('clipPath', { id });
      boundary.append(crop);
      defs.append(boundary);
      for (const template of source.children) {
        const previewWash = template.dataset.layer === 'Colour wash',
          name = previewWash ? 'Colour fills' : template.dataset.layer;
        if (!layers.has(name)) layers.set(name, markSvgLayer(template.cloneNode(false), name));
        const part = svgElement('g', { 'clip-path': `url(#${id})` });
        if (placement) part.setAttribute('transform', placement);
        if (previewWash) {
          for (const { fill, d } of makeFills?.() || []) {
            const id = `Fill_${number + 1}_${fill.slice(1)}`;
            part.append(svgElement('path', { id, fill, d }));
          }
        } else {
          for (const item of template.children) exportArtwork(item, part);
        }
        if (part.hasChildNodes()) layers.get(name).append(part);
      }
    }

    const labels = markSvgLayer(svgElement('g', {}), 'Floor labels');
    for (const [i, { source, crop, placement, makeFills, label }] of regions.entries()) {
      addRegion(source, crop.cloneNode(true), placement, i, makeFills);
      if (!label) continue;
      const text = label.cloneNode(true);
      text.setAttribute('transform', placement);
      labels.append(text);
    }

    root.append(...[...layers.values(), labels].filter((layer) => layer.hasChildNodes()));
    root.append(pageFooter.cloneNode(true));
    // The ASCII IDs survive import in editors that ignore the readable Inkscape layer labels.
    [...root.children]
      .filter((node) => node.localName === 'g')
      .forEach((layer, i) => {
        const order = String(i + 1).padStart(2, '0'),
          name = layer.dataset.layer.replace(/ · /g, ' ').replace(/\./g, 'p').replace(/ /g, '_');
        layer.id = `PN_${order}_${name}`;
      });
    return root;
  }

  function vectorDrawingSheet() {
    // The tiled plan preview uses nested viewports. Reapply their crops within each exported pen.
    const regions = allPlans()
      ? [...floorTiles.children].map((tile, i) => {
          const [area, label] = tile.children,
            crop = svgElement('rect', {});
          for (const attribute of ['x', 'y', 'width', 'height'])
            crop.setAttribute(attribute, area.getAttribute(attribute));
          return {
            source: area,
            crop,
            placement: `translate(${tile.getAttribute('x')} ${tile.getAttribute('y')})`,
            makeFills: rendered.regionFills[i],
            label
          };
        })
      : [{ source: sheetArtwork, crop: clipRect, makeFills: rendered.exportFills }];
    return vectorPage(
      paperDimensions(),
      rendered,
      footerTitle.textContent,
      settings.pens.paper,
      footer,
      regions,
      sheet.dataset.sectionLens
    );
  }

  function vectorFloorPage(paper, frame, label, tile = floorView(frame, label, 0, 0, true)) {
    const [, area, ...labels] = tile.children,
      { width, margin, drawingHeight } = frame,
      footer = markSvgLayer(svgElement('g', {}), 'Title and scale'),
      crop = svgElement('rect', {
        x: margin,
        y: margin,
        width: width - 2 * margin,
        height: drawingHeight
      });
    footer.append(...labels.map((node) => node.cloneNode(true)));
    return vectorPage(paper, frame, label, frame.pens.paper, footer, [
      { source: area, crop, makeFills: frame.exportFills }
    ]);
  }

  // Inline SVG is printed at the same physical size as the downloaded sheets.
  function prepareVectorPrint(sheets, { width, height }) {
    for (const [page, sheet] of sheets.entries()) {
      // All printed pages live in one document, so their clip IDs must be unique.
      const prefix = `print-${page + 1}-`;
      for (const node of sheet.querySelectorAll('[id]')) node.id = prefix + node.id;
      for (const node of sheet.querySelectorAll('[clip-path]')) {
        const clip = node.getAttribute('clip-path');
        node.setAttribute('clip-path', clip.replace('url(#', `url(#${prefix}`));
      }
    }
    $('floorPrintPages').replaceChildren(...sheets);
    document.body.classList.add('printing-floor-set');
    pageStyle.textContent = `@page { size: ${width}in ${height}in; margin: 0; }`;
  }

  function prepareDocumentPrint(pages) {
    const { width, height } = settings.document === 'programme' ? PROGRAMME_DRAWING_PAPER : { width: 11, height: 8.5 };
    $('documentPrintPages').replaceChildren(
      ...[...pages.children].map((page) => page.cloneNode(true))
    );
    document.body.classList.add('printing-document-set');
    pageStyle.textContent = `@page { size: ${width}in ${height}in; margin: 0; }`;
  }

  exportButton.onclick = () => {
    const lobby = focusedLobbyPlan();
    const view = settings.detail
      ? 'detail-' + settings.detail
      : lobby ? `lobby-plan-l${lobby.f + 1}`
      : allPlans()
        ? 'floor-plans'
        : settings.view;
    downloadBlob(
      new XMLSerializer().serializeToString(vectorDrawingSheet()),
      'image/svg+xml',
      `poly-nation-${state.seed}-${view}${settings.craneRunway === 'design' || settings.detail ? '' : '-' + settings.craneRunway}-${settings.paper}-1-${rendered.denominator}.svg`
    );
  };
  printButton.onclick = () => {
    prepareVectorPrint([vectorDrawingSheet()], paperDimensions());
    window.print();
  };
  $('printDocument').onclick = async () => {
    const pages = $('documentPages');
    if (!settings.document || !pages.childElementCount) return;
    if (settings.document === 'cranes') {
      if (!cranePages.length) return;
      prepareVectorPrint(cranePages.map(({ vector }) => vector()), CRANE_DRAWING_PAPER);
      window.print();
      return;
    }
    if (settings.document === 'site-sections') {
      if (!sitePages.length) return;
      prepareVectorPrint(sitePages.map(({ vector }) => vector()), SITE_SECTION_PAPER);
      window.print();
      return;
    }
    if (settings.document === 'lobbies') {
      const button = $('printDocument'),
        prepared = lobbyPages,
        paper = paperDimensions();
      button.disabled = true;
      button.textContent = 'Preparing lobby sheets…';
      try {
        const sheets = [];
        for (const { vector } of prepared) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (panel.hidden || timer || lobbyPages !== prepared) return;
          sheets.push(vector());
        }
        if (!sheets.length) return;
        prepareVectorPrint(sheets, paper);
        window.print();
      } catch (error) {
        console.error('Lobby set print failed', error);
      } finally {
        button.disabled = Boolean(timer) || (settings.document === 'lobbies' && !lobbyPages.length);
        button.textContent = 'Print / save PDF';
      }
      return;
    }
    prepareDocumentPrint(pages);
    window.print();
  };
  $('printFloorSet').onclick = async () => {
    if (!geometry || settings.detail || settings.view !== 'plan') return;
    const button = $('printFloorSet'),
      paper = paperDimensions(),
      plans = floorPlans(),
      model = geometry,
      camera = viewCamera(),
      { scale, glazing, mode, pens, cutFill } = settings;
    printingFloorSet = button.disabled = true;
    button.textContent = 'Preparing floor set…';
    try {
      const sheets = [];
      for (const { planes, label } of plans) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const frame = renderDrawing(
          model,
          camera,
          planes,
          paper,
          scale,
          glazing,
          { x: 0, y: 0, ground: false },
          mode !== 'linework',
          pens,
          { floorSet: true, cutFill }
        );
        sheets.push(vectorFloorPage(paper, frame, 'Poly Nation · ' + label));
      }
      if (panel.hidden) return;
      prepareVectorPrint(sheets, paper);
      window.print();
    } catch (error) {
      console.error('Floor set failed', error);
      status.textContent = 'The floor set could not be prepared.';
    } finally {
      printingFloorSet = false;
      button.disabled = Boolean(timer);
      button.textContent = 'Print floor set';
    }
  };
  window.addEventListener('beforeprint', () => {
    const { classList } = document.body;
    if (
      panel.hidden ||
      classList.contains('printing-floor-set') ||
      classList.contains('printing-document-set')
    )
      return;
    if (timer) {
      clearTimeout(timer);
      render();
    }
    if (settings.document === 'cranes') {
      if (cranePages.length && !$('printDocument').disabled)
        prepareVectorPrint(cranePages.map(({ vector }) => vector()), CRANE_DRAWING_PAPER);
    }
    else if (settings.document === 'site-sections') {
      if (sitePages.length) prepareVectorPrint(sitePages.map(({ vector }) => vector()), SITE_SECTION_PAPER);
    }
    else if (settings.document === 'lobbies' && lobbyPages.length)
      prepareVectorPrint(
        lobbyPages.map(({ vector }) => vector()),
        paperDimensions()
      );
    else if (settings.document) prepareDocumentPrint($('documentPages'));
    else if (rendered?.populated) prepareVectorPrint([vectorDrawingSheet()], paperDimensions());
  });
  window.addEventListener('afterprint', () => {
    pageStyle.textContent = '';
    document.body.classList.remove('printing-floor-set');
    document.body.classList.remove('printing-document-set');
    $('floorPrintPages').replaceChildren();
    $('documentPrintPages').replaceChildren();
  });
  return (model, assignments) => {
    const signature = JSON.stringify([assignments, buildViewLayers()]);
    if (sourceModel !== model || materialSignature !== signature) {
      sourceModel = model;
      sourceAssignments = assignments;
      materialSignature = signature;
      geometry = null;
      for (const plane of settings.planes) {
        plane.floor = Number.isInteger(plane.floor)
          ? clamp(plane.floor, 0, model.layers.length - 1)
          : null;
        plane.offset = clamp(plane.offset, ...offsetLimits(plane));
      }
      $('drawingFloor').replaceChildren(
        new Option('Project datum', ''),
        ...model.layers.map(
          (_, i) =>
            new Option(
              (i === 0 ? 'Ground floor' : 'Level ' + (i + 1)) +
                ' · ' +
                (i * modelFloorPitch(model)).toFixed(2) +
                ' m',
              String(i)
            )
        )
      );
    }
    stopPlacing();
    syncSettings();
    queueDrawing();
  };
})();
