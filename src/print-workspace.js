'use strict';

const printWorkspace = (() => {
  const phase = $('printPhase'), canvas = $('printCanvas'), scale = $('printScale'), detail = $('printDetail'),
    generate = $('printGenerate'), download = $('printDownloadKit'), partSelect = $('printPartList'),
    downloadPart = $('printDownloadPart'), status = $('printStatus'),
    view = { az: -0.84, el: 0.57, zoom: 1, pan: 0, panX: 0 },
    descriptions = {
      massing: 'Solid architectural volumes, simplified docks, mast and crane.',
      assembly: 'Separate floors and modules, with clear-sheet inserts where the geometry fits.',
      structure: 'More of the docks, rail supports and structural elements, thickened where needed to print.'
    },
    colors = Object.fromEntries(Object.entries({ Core: '#c5b087', Modules: '#80a9a0', 'Dock supports': '#82938a',
      Base: '#cdd6bd', Mast: '#a3694d', Swings: '#c48d72', Atrium: '#88a9b4', Gantry: '#507366', Rail: '#647d6d',
      'Test pieces': '#9284a4' }).map(([group, color]) => [group, rgb(color)]));
  let source, siteRevision, kit, mesh, context, renderer, software, version = 0, onBed = false;

  function report(text, error = false) {
    status.textContent = text;
    status.toggleAttribute('data-error', error);
  }

  function clearKit(message = '') {
    version++;
    kit = mesh = null;
    $('printResult').hidden = true;
    $('printEmpty').hidden = false;
    download.disabled = downloadPart.disabled = true;
    generate.disabled = false;
    $('printDetailHelp').textContent = descriptions[detail.value];
    report(message);
  }

  function open(modelToPrint) {
    if (source !== modelToPrint || siteRevision !== siteWorkspace.revision) {
      const hadKit = Boolean(kit);
      source = modelToPrint;
      siteRevision = siteWorkspace.revision;
      clearKit(hadKit ? 'The project changed. Generate the kit again.' : '');
    }
    $('printSource').textContent = `${modelToPrint.layers.length} occupied levels · ${siteWorkspace.linked ?
      'Linked West Village placement' : 'Standalone building'}`;
  }

  function selectPart() {
    return kit?.parts.find(part => part.id === partSelect.value);
  }

  function list(id, items) {
    const root = $(id);
    root.replaceChildren(...items.map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
    root.hidden = !items.length;
  }

  function present() {
    if (!mesh || phase.hidden) return;
    if (renderer) paintWebGL(canvas, context, renderer, view);
    else if (software) paintSoftware(mesh, software, view, canvas);
  }

  function showPreview() {
    const selected = selectPart();
    if (!selected) return;
    $('printAssembled').setAttribute('aria-pressed', String(!onBed));
    $('printOriented').setAttribute('aria-pressed', String(onBed));
    const width = selected.size.map(value => value.toFixed(1)).join(' × ');
    $('printPartInfo').textContent = `${width} mm in print orientation · ${selected.overhangFaces ?
      'Check overhangs and bridges in the slicer' : 'No steep downward faces above the bed detected'}`;
    list('printPartNotes', selected.notes);
    if (!renderer && !software) {
      context = canvas.getContext('webgl', { antialias: true, alpha: false });
      renderer = createWebGLRenderer(context);
      if (!renderer) software = createSoftwareRenderer(canvas);
    }
    const scene = meshBuilder(), parts = onBed ? [selected] : kit.parts.filter(part => !part.guide),
      low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    if (onBed) {
      scene.mark('Reference');
      const edge = [-4, kit.limit + 4], outline = [[edge[0], 0, -edge[0]], [edge[1], 0, -edge[0]],
        [edge[1], 0, -edge[1]], [edge[0], 0, -edge[1]]];
      for (let i = 0; i < outline.length; i++) scene.line(outline[i], outline[(i + 1) % outline.length], rgb('#a2b4a6'));
    }
    for (const part of parts) {
      scene.mark(part.group, part.id);
      const { origin, x, y, z } = part.placement, ink = colors[part.group] ?? rgb('#b5b9aa');
      const place = p => {
        const [east, south, up] = onBed ? p : origin.map((value, i) => value + p[0] * x[i] + p[1] * y[i] + p[2] * z[i]);
        const point = [east, up, -south];
        for (let i = 0; i < 3; i++) {
          low[i] = Math.min(low[i], point[i]);
          high[i] = Math.max(high[i], point[i]);
        }
        return point;
      };
      for (const triangle of part.triangles) scene.tri(...triangle.map(place), ink);
    }
    mesh = { ...scene, H: high[1] - low[1], extent: Math.max(high[0] - low[0], high[2] - low[2]) / 2,
      orbitPivot: low.map((value, i) => (value + high[i]) / 2) };
    if (renderer) uploadWebGLMesh(context, renderer, mesh);
    fitModel(mesh, view, canvas);
    present();
  }

  function showKit(result) {
    kit = result;
    const groups = new Map();
    for (const part of result.parts) {
      if (!groups.has(part.group)) {
        const group = document.createElement('optgroup');
        group.label = part.group;
        groups.set(part.group, group);
      }
      groups.get(part.group).append(new Option(part.label, part.id));
    }
    partSelect.replaceChildren(...groups.values());
    $('printSummary').textContent = `${result.parts.length} parts · 1:${result.denominator}` +
      (result.inserts.length ? ` · ${result.inserts.length} clear-sheet cut guides` : '') +
      ` · Assembled ${result.dimensions.map(Math.round).join(' × ')} mm`;
    list('printInstructions', result.instructions);
    list('printWarnings', result.warnings);
    $('printEmpty').hidden = true;
    $('printResult').hidden = false;
    download.disabled = downloadPart.disabled = false;
    onBed = false;
    showPreview();
  }

  generate.onclick = async () => {
    const quality = detail.value, denominator = Number(scale.value), request = ++version;
    generate.disabled = download.disabled = downloadPart.disabled = true;
    report('Checking geometry and orienting parts…');
    try {
      await appWork.run('Generating the 3D print kit…', () => {
        if (request !== version) return;
        if (phase.hidden) return report('');
        if (pending) update();
        source = model;
        const placed = siteWorkspace.designModel(source),
          result = generatePrintKit(placed, { denominator, detail: quality }, materialWorkspace.assignments());
        showKit(result);
        report('Kit ready. Review the assembly notes and slicer preview before printing.');
      });
    } catch (error) {
      clearKit();
      report(error.message, true);
    } finally {
      if (request === version) generate.disabled = false;
    }
  };

  scale.onchange = detail.onchange = () => clearKit('Generate a kit with the new settings.');
  $('printAssembled').onclick = () => { if (onBed) { onBed = false; showPreview(); } };
  $('printOriented').onclick = () => { if (!onBed) { onBed = true; showPreview(); } };
  partSelect.onchange = () => { onBed = true; showPreview(); };
  downloadPart.onclick = () => {
    const part = selectPart();
    if (part) downloadBlob(printPartSTL(part), 'model/stl', printPartFilename(part));
  };
  download.onclick = async () => {
    const result = kit;
    if (!result) return;
    download.disabled = true;
    try {
      await appWork.run('Preparing the print files…', () => downloadPrintPackage(result));
    } catch (error) {
      report(error.message, true);
    } finally {
      download.disabled = !kit;
    }
  };
  bindModelCamera({ canvas, getCamera: () => view, getMesh: () => mesh, onChange: present, panLimit: 2000,
    minimumZoom: 0.03, zoomToPointer: true, buttons: { axo: 'printAxo', plan: 'printPlan', fit: 'printFit' } });
  new ResizeObserver(present).observe(canvas);
  document.addEventListener('west-village-change', () => { if (!phase.hidden) open(model); });

  return { open };
})();
