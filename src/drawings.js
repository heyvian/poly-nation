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
      azimuth: 5,
      elevation: 225,
      sectionProjection: 'orthographic',
      sectionLens: 35,
      perspectiveFade: 55,
      source: 'massing',
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
      const previousElevation = ['front', 'side'].includes(saved.view);
      settings = {
        ...settings,
        view: previousElevation ? 'elevation' : viewNames.includes(saved.view) ? saved.view : 'axo',
        detail: Object.hasOwn(CONNECTION_DETAIL_TITLES, saved.detail) ? saved.detail : '',
        document: DRAWING_DOCUMENTS.includes(saved.document) ? saved.document : '',
        elevation: Number.isFinite(saved.elevation)
          ? mod(saved.elevation, 360)
          : saved.view === 'side'
            ? 315
            : 225,
        source: saved.source === 'build' ? 'build' : 'massing',
        sectionProjection: saved.sectionProjection === 'perspective' ? 'perspective' : 'orthographic',
        sectionLens: clamp(Number(saved.sectionLens) || 35, 8, 200),
        perspectiveFade: Number.isFinite(saved.perspectiveFade) ? clamp(saved.perspectiveFade, 0, 100) : 55,
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
  const compass = $('drawingCompass');
  for (const index of [7, 0, 1, 6, 2, 5, 4, 3]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = compassPoints[index];
    button.setAttribute('aria-label', 'View from ' + compassNames[index]);
    button.dataset.azimuth = index;
    button.onclick = () => {
      if (settings.view === 'elevation') settings.elevation = index * 45;
      else settings.azimuth = index;
      syncCompass();
      queueDrawing();
    };
    compass.append(button);
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
    syncSectionView();
  }

  const lensPosition = (mm) => Math.round((1000 * Math.log(mm / 8)) / Math.log(200 / 8));
  const lensMillimetres = (position) => Math.round(8 * (200 / 8) ** (position / 1000));
  $('drawingLensTicks').replaceChildren(
    ...SECTION_LENS_STOPS.map((mm) => new Option(`${mm} mm`, lensPosition(mm)))
  );
  function syncSectionView() {
    const aligned =
      !settings.detail && settings.view === 'aligned' && currentPlane()?.axis === 'vertical';
    $('drawingSectionView').hidden = !aligned;
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
      plane?.axis !== 'vertical' ||
      settings.sectionProjection !== 'perspective'
    )
      return null;
    const hub = selectedLobby(plane);
    return {
      cutDepth: planeHeight(plane) * (plane.flip ? -1 : 1),
      millimetres: settings.sectionLens,
      eyeLevel: (hub ? hub.f * modelFloorPitch(sourceModel) : 0) + 1.65
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

  function drawingNorthArrow({ right, up }, x, y, ink) {
    // The model's north is +Z. Project it onto the sheet so the arrow follows orbit and cut views.
    const projected = Math.hypot(right[2], up[2]),
      northX = right[2] / projected,
      northY = -up[2] / projected,
      angle = (Math.atan2(northX, -northY) * 180) / Math.PI;
    const arrow = svgElement('g', { 'aria-label': 'North arrow', 'data-north-arrow': '' });
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
    const north = svgElement('text', {
      x: x + northX * 18,
      y: y + northY * 18 + 2.7,
      'text-anchor': 'middle',
      'font-size': 8,
      'font-weight': 650
    });
    north.textContent = 'N';
    arrow.append(ring, north);
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
    if (mapBasis) indicator.prepend(drawingNorthArrow(mapBasis, end - 178, baseline - 4, ink));
  }

  function renderPens(target, frame, identified = false) {
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
    target.replaceChildren(...layers);
  }

  // Each view uses the same physical drawing units. The tile bounds crop its own wash and strokes.
  function floorView(frame, label, x = 0, y = 0, print = false) {
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
    renderPens(area, frame);
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
      drawScaleIndicator(indicator, denominator, width - margin, baseline, ink, frame.basis);
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
        { region, floorSet: true }
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

  function render() {
    timer = 0;
    if (!sourceModel || panel.hidden) return;
    const paper = paperDimensions();
    try {
      if (settings.document) {
        $('documentPages').replaceChildren(
          ...drawingSetPages(settings.document, sourceModel, sourceAssignments)
        );
        $('drawingDocumentStage').scrollTop = 0;
        return;
      }
      const includeSite = settings.showSite && siteWorkspace.hasTerrain,
        mode = settings.source + '/' + settings.mode + '/' + (includeSite ? siteWorkspace.revision : 'building');
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
          roof: true
        };
        const preview = {
          assignments: sourceAssignments,
          view,
          structureView: false,
          programColors: settings.mode === 'combined' || settings.mode === 'program',
          finishJoints: settings.mode === 'material' || settings.mode === 'combined'
        };
        const mesh = settings.source === 'build'
          ? buildAssemblyMesh(sourceModel, buildViewLayers(), 0, preview)
          : buildMesh(sourceModel, false, view, preview);
        geometry = drawingGeometry(includeSite ? siteWorkspace.composeDrawing(mesh) : mesh, sourceModel);
        renderedGeometryMode = mode;
      }
      const camera = settings.detail ? null : viewCamera();
      const optics = camera && sectionOptics();
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
              { sectionLens: optics }
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
      const { width, height, margin, denominator } = rendered,
        ruleY = height - margin * 1.8,
        textY = height - margin,
        viewLabel = settings.detail
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
      footerTitle.textContent = 'Poly Nation · ' + viewLabel;
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
      'drawingRendering',
      'drawingGlazing',
      'addDrawingPlane',
      'drawingScale',
      'fitDrawing'
    ])
      $(id).disabled = detail;
    $('drawingPlanes').hidden = detail;
    $('drawingLobbyCutField').hidden = detail;
    const availableLobbies = sourceModel?.circulation.hubs.filter((hub) => hub.layout) ?? [];
    $('drawingLobbyCut').replaceChildren(new Option(
      availableLobbies.length ? 'Choose a shared lobby' : 'No shared lobbies in this design', ''),
      ...availableLobbies.map((hub) => new Option(
        `Level ${hub.f + 1} · ${hub.pair.map((p) => P[p].name).join(' + ')}`, lobbyKey(hub))));
    $('drawingLobbyCut').disabled = !availableLobbies.length;
    $('drawingLobbyCut').value = selectedLobby(plane) ? plane.lobbyKey : '';
    $('drawingSource').value = settings.source;
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
  $('drawingSite').onchange = (event) => {
    settings.showSite = event.target.checked;
    syncSettings();
    queueDrawing();
  };
  document.addEventListener('west-village-change', () => {
    if (panel.hidden) return;
    syncSettings();
    if (settings.showSite) queueDrawing();
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
  $('drawingLobbyCut').onchange = (event) => {
    const hub = sourceModel.circulation.hubs.find(
      (candidate) => candidate.layout && lobbyKey(candidate) === event.target.value
    );
    if (!hub) return;
    const selected = currentPlane(),
      plane =
        selected?.axis === 'vertical'
          ? selected
          : {
              id: Math.max(0, ...settings.planes.map((item) => item.id)) + 1,
              axis: 'vertical',
              flip: false
            };
    if (plane !== selected) settings.planes.push(plane);
    Object.assign(plane, { lobbyKey: lobbyKey(hub), offset: 0, floor: null });
    plane.angle = planeAngle(plane);
    settings.selected = plane.id;
    settings.view = 'aligned';
    stopPlacing();
    syncSettings();
    queueDrawing();
  };
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
    plane.floor = selected === '' ? null : Number(selected);
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
      if (plane.lobbyKey && plane.offset !== 0) {
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
    if (item.localName === 'path') {
      // The renderer packs disconnected strokes into each path. Bound the number of subpaths per
      // object so large sheets remain practical to select and edit in a vector application.
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

  function vectorDrawingSheet() {
    const { width, height } = paperDimensions();
    const root = svgElement('svg', {
      width: width + 'in',
      height: height + 'in',
      viewBox: sheet.getAttribute('viewBox')
    });
    if (sheet.dataset.sectionLens) root.dataset.sectionLens = sheet.dataset.sectionLens;
    const title = svgElement('title', {}),
      defs = svgElement('defs', {}),
      layers = new Map();
    title.textContent = `${footerTitle.textContent} · 1:${rendered.denominator}`;
    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:inkscape', layerNS);
    root.append(title, defs, paperLayer.cloneNode(true));

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
    if (allPlans()) {
      // The preview uses nested SVG viewports. Reapply their crops in each exported pen layer.
      [...floorTiles.children].forEach((tile, i) => {
        const [area, label] = tile.children,
          x = tile.getAttribute('x'),
          y = tile.getAttribute('y'),
          crop = svgElement('rect', {});
        for (const attribute of ['x', 'y', 'width', 'height'])
          crop.setAttribute(attribute, area.getAttribute(attribute));
        const placement = `translate(${x} ${y})`;
        addRegion(area, crop, placement, i, rendered.regionFills[i]);
        const caption = label.cloneNode(true);
        caption.setAttribute('transform', placement);
        labels.append(caption);
      });
    } else addRegion(sheetArtwork, clipRect.cloneNode(true), null, 0, rendered.exportFills);

    root.append(...[...layers.values(), labels].filter((layer) => layer.hasChildNodes()));
    root.append(footer.cloneNode(true));
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

  exportButton.onclick = () => {
    const view = settings.detail
      ? 'detail-' + settings.detail
      : allPlans()
        ? 'floor-plans'
        : settings.view;
    downloadBlob(
      new XMLSerializer().serializeToString(vectorDrawingSheet()),
      'image/svg+xml',
      `poly-nation-${state.seed}-${view}-${settings.paper}-1-${rendered.denominator}.svg`
    );
  };
  printButton.onclick = () => {
    const { width, height } = paperDimensions();
    pageStyle.textContent = `@page { size: ${width}in ${height}in; margin: 0; }`;
    window.print();
  };
  $('printDocument').onclick = () => {
    const pages = $('documentPages');
    if (!settings.document || !pages.childElementCount) return;
    $('documentPrintPages').replaceChildren(
      ...[...pages.children].map((page) => page.cloneNode(true))
    );
    document.body.classList.add('printing-document-set');
    pageStyle.textContent = '@page { size: letter landscape; margin: 0; }';
    window.print();
  };
  $('printFloorSet').onclick = async () => {
    if (!geometry || settings.detail || settings.view !== 'plan') return;
    const button = $('printFloorSet'),
      pages = $('floorPrintPages'),
      paper = paperDimensions(),
      plans = floorPlans(),
      model = geometry,
      camera = viewCamera(),
      { scale, glazing, mode, pens } = settings;
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
          { floorSet: true }
        );
        const page = floorView(frame, 'Poly Nation · ' + label, 0, 0, true);
        page.setAttribute('width', paper.width + 'in');
        page.setAttribute('height', paper.height + 'in');
        sheets.push(page);
      }
      if (panel.hidden) return;
      pages.replaceChildren(...sheets);
      document.body.classList.add('printing-floor-set');
      pageStyle.textContent = `@page { size: ${paper.width}in ${paper.height}in; margin: 0; }`;
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
