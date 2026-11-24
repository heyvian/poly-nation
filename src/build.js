'use strict';

function buildGirderDepth(model) {
  return clamp((model.R - model.r) / 16, 0.35, 0.82);
}

function buildRingFrame(model) {
  const width = model.R - model.r;
  return {
    inside: model.r + Math.min(0.42, width * 0.16),
    outside: model.R - Math.min(0.48, width * 0.16),
    ringWidth: Math.min(0.32, width * 0.24)
  };
}

function buildStorey(model, floor, thickness = model.slabThickness ?? BUILD_SECTION.slabThickness) {
  const { slabBase, slabThickness } = BUILD_SECTION,
    floorHeight = modelFloorPitch(model);
  const base = slabBase + floor * floorHeight + slabThickness,
    underside = base - thickness,
    soffit =
      floor + 1 === model.layers.length ? model.roofPlan.y - thickness : underside + floorHeight;
  // Both folded leaves fit under the perimeter girder above the opening.
  return { underside, base, soffit, head: soffit - buildGirderDepth(model) - 0.16 };
}

function dockTrussDepth(fraction) {
  const { rootDepth, tipDepth } = BUILD_SECTION;
  return rootDepth + fraction * (tipDepth - rootDepth);
}

const DOCK_STRUCTURES = {
  'side-truss': {
    name: 'Tapered side trusses',
    note: 'The two trusses gain depth beside the module. Diagonals cross the side window zones.'
  },
  'side-portal': {
    name: 'Side frames with open panels',
    note: 'Vierendeel frames leave rectangular window zones between posts. Their deeper chords and rigid joints carry panel bending.'
  },
  'box-floor': {
    name: 'Shallow steel box floor',
    note: 'A 420 mm torsion box fits between stacked modules. The gravity estimate shows how much it would deflect as a free cantilever.',
    depth: 0.42
  },
  'cable-stayed': {
    name: 'Same-storey cable stays',
    note: 'Two stays run from the dock tip to the top of its own storey. Bolted heads meet the perimeter ring, which transfers the reactions into shared radial collectors.'
  },
  'roof-hung': {
    name: 'Roof-hung rods',
    note: 'Vertical rods hang from outboard roof frames. A stiff perimeter root returns the load into a collector below the roof, leaving the public deck clear.'
  },
  columns: {
    name: 'Outer tip columns',
    note: 'Exterior posts carry the tips down to grade with the sides open. The posts need foundations and space at the edge of the plaza.'
  }
};

function stayCollectorSection(model) {
  return {
    beamDepth: buildGirderDepth(model),
    flangeWidth: 0.23,
    flangeThickness: 0.027,
    webThickness: 0.016
  };
}

// Coordinates are relative to the core face in the radial direction and to the dock floor vertically.
function dockStayConnection(model, { base, soffit }) {
  const section = stayCollectorSection(model),
    tipReach = BUILD_SECTION.dockGap + MODULE.depth - 0.6,
    face = 0.025,
    pinReach = 0.27,
    upper = soffit - base - section.beamDepth / 2,
    lower = -0.12;
  return {
    ...section,
    tipReach,
    face,
    pinReach,
    upper,
    lower,
    rise: upper - lower,
    run: tipReach - pinReach,
    plateWidth: 0.34,
    plateThickness: 0.035
  };
}

function stayPerimeterFaces(model, offset) {
  const { outside, ringWidth } = buildRingFrame(model),
    reach = (radius) => Math.sqrt(Math.max(0, radius ** 2 - offset ** 2)) - model.R;
  return { inner: reach(outside - ringWidth / 2), outer: reach(outside + ringWidth / 2) };
}

function drawStayIBeam(block, start, end, bottom, section) {
  const { beamDepth, flangeWidth, flangeThickness, webThickness } = section;
  if (end <= start) return;
  block(start, end, bottom, flangeThickness, flangeWidth);
  block(start, end, bottom + beamDepth - flangeThickness, flangeThickness, flangeWidth);
  block(start, end, bottom + flangeThickness, beamDepth - 2 * flangeThickness, webThickness);
}

// The two sides of a dock land near the dividing grid lines. Neighboring docks
// feed the same divider, so each core floor needs a single collector there.
function stayCollectorAxes(model, dockSlots) {
  const axesByFloor = new Map();
  for (const slot of dockSlots) {
    for (const floor of [slot.f, slot.f + 1]) {
      if (!axesByFloor.has(floor)) axesByFloor.set(floor, new Set());
      const axes = axesByFloor.get(floor);
      axes.add(mod(2 * slot.j - 1, 2 * model.slotN));
      axes.add(2 * slot.j + 1);
    }
  }
  return axesByFloor;
}

// Compare gravity service loads for the reusable dock. All dimensions are metres and forces kN.
function buildGravityStudy(
  model,
  assignments,
  structure = 'side-truss',
  slabThickness = model.slabThickness ?? BUILD_SECTION.slabThickness
) {
  const { dockGap, rootDepth, chordWidth, chordDepth, chordWall } = BUILD_SECTION,
    span = dockGap + MODULE.depth,
    chordArea = 2 * chordWall * (chordWidth + chordDepth - 2 * chordWall),
    deckArea = MODULE.area,
    shellArea = 2 * (MODULE.width + MODULE.depth) * MODULE.height,
    steelWeight = 105,
    steelModulus = 200e6; // kN/m²
  function moduleDeadLoad({ structure, facade }) {
    const shellMass =
      STRUCTURE_STUDY[structure][0] * deckArea + CLADDING_STUDY[facade][0] * shellArea;
    return shellMass * 0.00981 + 1.4 * deckArea;
  }
  // Keep a reference enclosed module in the comparison even when a variation has no occupied docks.
  let moduleWeight = moduleDeadLoad({ structure: 'steel-frame', facade: 'corrugated' });
  for (const slot of model.slots) {
    if (slot.blocked || (slot.p === EMPTY && slot.use !== 'retail')) continue;
    const values =
      slot.p === EMPTY
        ? materialValues(assignments, 'commercial')
        : materialValues(assignments, 'module', slot.p, materialSlotKey(model, slot));
    moduleWeight = Math.max(moduleWeight, moduleDeadLoad(values));
  }
  function inertiaAt(fraction) {
    if (structure === 'box-floor') return (3.8 * 0.016 * 0.38 ** 2) / 2;
    return chordArea * dockTrussDepth(fraction) ** 2;
  }
  function reaction(label, distributed, tip = 0) {
    // The frame starts at the face of the core. The module or deck starts beyond the threshold gap.
    function moment(x) {
      const loadedFrom = Math.max(x, dockGap),
        tail = span - loadedFrom;
      return (
        ((steelWeight / span) * (span - x) ** 2) / 2 +
        ((distributed * tail) / MODULE.depth) * (loadedFrom + tail / 2 - x) +
        tip * (span + 0.7 - x)
      );
    }
    let deflection = 0;
    const step = span / 64;
    for (let i = 0; i < 64; i++) {
      const x = (i + 0.5) * step;
      // Two trusses with two equal chords each give I ≈ A × depth². Integrate for a unit tip load.
      const inertia = inertiaAt(x / span);
      deflection += (moment(x) * (span - x) * step) / (steelModulus * inertia);
    }
    const rootMoment = moment(0);
    return {
      label,
      shear: steelWeight + distributed + tip,
      rootMoment,
      chordForce: rootMoment / (2 * rootDepth),
      deflection
    };
  }
  const openDeck = (1.5 + 4.8) * deckArea,
    saturatedSoil = 6 * (1.2 * 4.1) * 6,
    tipBalcony = ((Math.PI * 1.65 ** 2) / 2) * (1.5 + 4.8),
    cases = [
      reaction('Empty dock', 0),
      reaction('Enclosed + tip balcony', moduleWeight + (3 + 1.2) * deckArea, tipBalcony),
      reaction('Public balcony', openDeck),
      reaction('Saturated garden', openDeck + saturatedSoil)
    ];
  // The longest slab strip is at the outer rim between a primary and secondary radial beam.
  const slabSpan = (Math.PI * model.R) / model.slotN,
    slabWeight = slabThickness * 24,
    dryLoad = slabWeight + 1.5 + 4.8,
    slabMoment = (dryLoad * slabSpan ** 2) / 8;
  return { cases, span, moduleWeight, slabSpan, slabMoment, slabWeight, dryLoad };
}

// Idealized service reactions shared by the Build readout and the connection drawings.
function dockSupportDemand(model, assignments, structure, thickness) {
  const study = buildGravityStudy(model, assignments, structure, thickness),
    governing = study.cases.reduce((largest, row) =>
      row.rootMoment > largest.rootMoment ? row : largest
    ),
    arm = study.span - 0.6,
    connections = model.layers.map((_, floor) =>
      dockStayConnection(model, buildStorey(model, floor, thickness))
    ),
    stay = connections.reduce((shallowest, next) =>
      next.rise < shallowest.rise ? next : shallowest
    ),
    slope = stay.rise / stay.run,
    tipPair = governing.rootMoment / arm,
    anchorDown = tipPair / 2,
    anchorOut = anchorDown / slope;
  return {
    ...study,
    governing,
    slope,
    tipPair,
    stay,
    anchorOut,
    anchorDown,
    anchorMoment: anchorDown * (stay.pinReach - stay.face),
    stayTension: Math.hypot(anchorOut, anchorDown),
    deckCompression: 2 * anchorOut,
    stackedSupport: (tipPair * model.layers.length) / 2
  };
}

function showBuildGravityStudy(model, assignments, structure, slabThickness, waterDepth = 1) {
  const demand = dockSupportDemand(model, assignments, structure, slabThickness),
    { cases, span, moduleWeight, slabSpan, slabMoment, slabWeight, dryLoad, governing } = demand,
    { rootDepth, tipDepth, chordWidth, chordDepth, chordWall } = BUILD_SECTION;
  const freeCantilever = structure === 'side-truss' || Boolean(DOCK_STRUCTURES[structure].depth);
  let finding;
  if (structure === 'side-truss') {
    finding = `The trusses taper from ${rootDepth.toFixed(2)} m to ${tipDepth.toFixed(2)} m between ${chordDepth * 1000} × ${chordWidth * 1000} × ${chordWall * 1000} mm box chords. The governing load puts about ${(governing.chordForce / 1000).toFixed(2)} MN into each root chord.`;
  } else if (freeCantilever) {
    finding = `The ${DOCK_STRUCTURES[structure].depth.toFixed(2)} m underfloor frame gives about ${(governing.deflection * 1000).toFixed(0)} mm of idealized tip deflection in the governing case. Compare this with the ${Math.round((span * 1000) / 360)} mm reference of span / 360.`;
  } else if (structure === 'side-portal') {
    finding =
      'The table shows global gravity demand. Portal joints and chords also bend locally, so tip deflection needs a frame analysis.';
  } else {
    if (structure === 'cable-stayed') {
      finding = `At the shallowest same-storey angle, about ${((Math.atan(demand.slope) * 180) / Math.PI).toFixed(1)}°, each stay needs about ${(demand.stayTension / 1000).toFixed(2)} MN in tension under an ideal pinned-root check. Per upper anchor the stay pulls ${Math.round(demand.anchorOut)} kN outward and ${Math.round(demand.anchorDown)} kN down. The pin projection adds about ${Math.round(demand.anchorMoment)} kN·m at the plate. The two stays push ${(demand.deckCompression / 1000).toFixed(2)} MN back through the lower deck rails.`;
    } else if (structure === 'roof-hung') {
      finding = `The ideal tip support carries about ${Math.round(demand.tipPair)} kN per loaded deck. If all ${model.layers.length} floors used the governing case at the same dock, the roof pair could collect ${((2 * demand.stackedSupport) / 1000).toFixed(2)} MN.`;
    } else {
      finding = `The ideal outer post pair carries about ${Math.round(demand.tipPair)} kN per loaded deck. Its footing takes the combined reaction from the floors above.`;
    }
  }
  const waterLoad = waterDepth * 9.81,
    wetMoment = ((dryLoad + waterLoad) * slabSpan ** 2) / 8;
  $('buildEstimate').innerHTML = `
   <p class="hint">Reference gravity loads for an ${span.toFixed(2)} m dock. The estimated enclosed module weighs ${(moduleWeight / 9.81).toFixed(1)} t with fit-out, before occupants and snow. The study uses the heaviest installed assembly or a steel reference module.</p>
   <table class="build-estimate-table">
    <thead><tr><th scope="col">Case</th><th scope="col">Load kN</th><th scope="col">MN·m*</th>${freeCantilever ? '<th scope="col">Tip mm</th>' : ''}</tr></thead>
    <tbody>${cases.map(({ label, shear, rootMoment, deflection }) => `<tr><th scope="row">${label}</th><td>${shear.toFixed(0)}</td><td>${(rootMoment / 1000).toFixed(1)}</td>${freeCantilever ? `<td>${(deflection * 1000).toFixed(0)}</td>` : ''}</tr>`).join('')}</tbody>
   </table>
   <p class="hint">* Moment about the core face before crediting tip supports. ${finding} ${freeCantilever ? 'The tip estimate assumes elastic bending and a fixed root. Core rotation, web and connection movement add deflection.' : ''}</p>
   <h3>Core slab demand</h3>
   <p class="hint">${Math.round(slabThickness * 1000)} mm concrete at a ${slabSpan.toFixed(2)} m reference span between radial beams. At 24 kN/m³, the slab itself contributes ${slabWeight.toFixed(1)} kPa.</p>
   <table class="build-estimate-table"><thead><tr><th scope="col">Service case</th><th scope="col">Load kPa</th><th scope="col">kN·m/m</th></tr></thead>
   <tbody><tr><th scope="row">Dry reference</th><td>${dryLoad.toFixed(1)}</td><td>${slabMoment.toFixed(1)}</td></tr>
   <tr><th scope="row">With ${waterDepth.toFixed(2)} m of water</th><td>${(dryLoad + waterLoad).toFixed(1)}</td><td>${wetMoment.toFixed(1)}</td></tr></tbody></table>
   <p class="hint">Assumed dry loads are 1.5 kPa for finishes and 4.8 kPa for occupancy. The wet case adds ${waterLoad.toFixed(1)} kPa of uniformly distributed water. This is an unfactored one-way strip comparison. Tank weight, concentrated supports, saturated media, pumps, slide reactions and vibration need their own load cases.</p>
   <p class="hint">Slab reinforcement, shear, deflection, crack control, waterproofing and the load path through the beams and foundations still require design. The cable concept uses local receivers at the perimeter. Check combined reactions from adjacent docks, the ring transfer and any steel-to-core transition.</p>
   <p class="hint">Assumptions in kPa include 3.0 occupancy and 1.2 snow for enclosed modules, 4.8 occupancy on open decks and 6.0 saturated planter load over six planter footprints. The comparison uses 105 kN per dock as a common frame-weight allowance. Detailed design would establish actual member weights and check site loads, vibration, connections and load transfer.</p>`;
}

function drawAssemblyMember({ quad }, start, end, width, color, depth = width, angle = 0) {
  const direction = unit(sub(end, start)),
    radial = [Math.cos(angle), 0, Math.sin(angle)],
    side = unit(cross(direction, Math.abs(direction[1]) > 0.97 ? radial : [0, 1, 0])),
    across = cross(direction, side);
  const corners = (p) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ].map(([u, v]) => p.map((x, i) => x + (width / 2) * u * side[i] + (depth / 2) * v * across[i]));
  const a = corners(start),
    b = corners(end);
  quad(a[3], a[2], a[1], a[0], color);
  quad(b[0], b[1], b[2], b[3], color);
  for (let i = 0; i < 4; i++) quad(a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i], color);
}

// The removable module sits between permanent side trusses, clear of the bay below.
function drawDockFrame(mesh, model, slot, storey, layer, showReturns = false, openPanels = false) {
  const { dockGap, chordWidth, chordDepth } = BUILD_SECTION,
    { box, mark } = mesh,
    span = dockGap + MODULE.depth,
    lower = storey.base - chordDepth / 2,
    point = moduleTipPoint(model, slot, lower),
    sideOffset = MODULE.width / 2 + 0.14,
    steel = rgb('#657b76'),
    web = rgb('#7c9088'),
    plates = rgb('#a87e5b'),
    panels = 4;
  const member = (a, b, width, color, depth) =>
    drawAssemblyMember(mesh, a, b, width, color, depth, slot.angle);
  mark(layer, `Slot_${slot.j}`);
  for (const side of [-sideOffset, sideOffset]) {
    const chord = (panel, top = false) => {
      const fraction = panel / panels;
      return point(side, span * (fraction - 1), top ? dockTrussDepth(fraction) : 0);
    };
    for (const top of [false, true])
      member(
        chord(0, top),
        chord(panels, top),
        openPanels ? 0.26 : chordWidth,
        steel,
        openPanels ? 0.42 : chordDepth
      );
    for (let i = 0; i <= panels; i++) {
      member(chord(i), chord(i, true), openPanels ? 0.27 : 0.15, web);
      if (!openPanels && i < panels) member(chord(i, true), chord(i + 1), 0.16, web);
    }
    for (const top of [false, true]) {
      const [x, y, z] = chord(0, top);
      box(x, y - 0.23, z, 0.36, 0.46, 0.28, slot.angle, plates);
    }
    if (showReturns) {
      // A jamb connects the two reactions to the slabs. Radial collectors tie them back to the ring.
      const attachment = -span - Math.min(0.3, (model.R - model.r) * 0.15),
        back = -span - (model.R - model.r) + Math.min(0.42, (model.R - model.r) * 0.16),
        head = storey.soffit - lower - 0.14;
      member(point(side, attachment, 0), point(side, attachment, head), 0.32, steel);
      for (const height of [0, head])
        member(point(side, attachment, height), point(side, back, height), 0.23, steel, 0.28);
    }
  }
  // Crossmembers carry a module or open deck between the two side frames.
  for (const depth of [dockGap, span / 2, span])
    member(
      point(-sideOffset, depth - span, 0),
      point(sideOffset, depth - span, 0),
      0.16,
      steel,
      0.2
    );
}

// Study alternatives retain the docking pitch, door and deck height of the baseline.
function drawAlternativeDock(mesh, model, slot, storey, structure) {
  const { dockGap } = BUILD_SECTION,
    { mark, box } = mesh,
    span = dockGap + MODULE.depth,
    point = moduleTipPoint(model, slot, storey.base),
    steel = rgb('#657b76'),
    cable = rgb('#3b5753'),
    back = Math.min(3.5, (model.R - model.r) * 0.6);
  const member = (a, b, width, color = steel, depth) =>
    drawAssemblyMember(mesh, a, b, width, color, depth, slot.angle);
  mark('Assembly_Dock_Connections', 'L' + (slot.f + 1) + '_Slot_' + slot.j);
  if (structure === 'box-floor') {
    const { depth } = DOCK_STRUCTURES[structure];
    const [x, y, z] = point(0, -span / 2, -depth);
    box(x, y, z, 3.8, depth, span, slot.angle, steel);
    for (const offset of [-1.72, 1.72])
      member(point(offset, -span, -0.16), point(offset, -span - back, -0.16), 0.27);
    return;
  }

  const side = MODULE.width / 2 + 0.14;
  const stay = structure === 'cable-stayed' ? dockStayConnection(model, storey) : null,
    railY = stay?.lower ?? -0.16;
  for (const offset of [-side, side])
    member(point(offset, -span, railY), point(offset, 0, railY), 0.2, steel, 0.32);
  for (const depth of [-span + dockGap, -span / 2, -0.6])
    member(point(-side, depth, -0.11), point(side, depth, -0.11), 0.17, steel, 0.2);
  if (!stay) return;
  mark('Assembly_Dock_Stays_L' + (slot.f + 1), 'Slot_' + slot.j);
  for (const offset of [-side, side])
    member(
      point(offset, stay.tipReach - span, stay.lower),
      point(offset, stay.pinReach - span, stay.upper),
      0.08,
      cable
    );

  mark('Assembly_Dock_Stay_Anchors_L' + (slot.f + 1), 'Slot_' + slot.j);
  for (const offset of [-side, side]) {
    const node = stayPerimeterFaces(model, offset).outer,
      { beamDepth, face, pinReach, upper, plateWidth, plateThickness } = stay;
    function block(start, end, bottom, height, width, color = steel) {
      const [x, y, z] = point(offset, (start + end) / 2 - span, bottom);
      box(x, y, z, width, height, end - start, slot.angle, color);
    }
    // Keep the bolt head and its short steel receiver in the stay plane. The receiver
    // ends at the outer ring, where the shared radial floor grid takes over.
    const bottom = upper - beamDepth / 2,
      behind = face - plateThickness;
    drawStayIBeam(block, node, behind, bottom, stay);
    block(behind, face, bottom, beamDepth, plateWidth);
    block(face, face + plateThickness, bottom, beamDepth, plateWidth, cable);
    block(face + plateThickness, pinReach, upper - 0.075, 0.15, 0.07);
    // Bring the lower rail back to the same perimeter line without extending its
    // off-axis compression stub across the floor or into the slab.
    const seatBottom = storey.underside - storey.base - 0.2;
    block(node, -0.04, seatBottom, 0.17, 0.23);
    block(-0.04, 0, seatBottom, railY + 0.16 - seatBottom, 0.28);
  }
}

// One shared pair of posts or hangers carries all active decks in a stacked dock line.
function drawSharedDockSupports(mesh, model, slots, structure, slabThickness) {
  const { mark, box } = mesh,
    roof = model.roofPlan.y,
    span = BUILD_SECTION.dockGap + MODULE.depth,
    stacks = new Map();
  for (const slot of slots) {
    const pair = stacks.get(slot.j) ?? [slot, slot];
    pair[1] = slot;
    stacks.set(slot.j, pair);
  }
  for (const [bottom, top] of stacks.values()) {
    const point = moduleTipPoint(model, bottom, 0),
      steel = rgb(structure === 'columns' && model.slots[bottom.j].blocked ? '#a2735d' : '#657b76'),
      member = (a, b, width, depth) =>
        drawAssemblyMember(mesh, a, b, width, steel, depth, bottom.angle);
    mark('Assembly_Dock_Stack_Supports', 'Dock_' + bottom.j);
    for (const offset of [-2.39, 2.39]) {
      if (structure === 'columns') {
        const height = buildStorey(model, top.f, slabThickness).base - 0.13;
        const [x, , z] = point(offset, -0.6, 0);
        box(x, 0, z, 0.95, 0.14, 0.95, bottom.angle, steel);
        member(point(offset, -0.6, 0.14), point(offset, -0.6, height), 0.28);
        continue;
      }
      const bottomDeck = buildStorey(model, bottom.f, slabThickness).base - 0.13,
        anchor = roof + 0.44,
        mast = roof + 3.25,
        root = -span + 0.28,
        back = -span - (model.R - model.r) + Math.min(0.45, (model.R - model.r) * 0.19),
        collector = roof - slabThickness - buildGirderDepth(model) * 0.65;
      member(point(offset, -0.6, bottomDeck), point(offset, -0.6, anchor), 0.085);
      member(point(offset, root, anchor), point(offset, -0.6, anchor), 0.26, 0.38);
      member(point(offset, root, mast), point(offset, -0.6, anchor), 0.24);
      member(point(offset, root, collector), point(offset, root, mast), 0.36, 0.46);
      // Return the moment into the roof framing below the public deck. The perimeter root is
      // schematic and would need a designed moment joint and an inboard tie to the core.
      mark('Assembly_Dock_Roof_Backspan', 'Dock_' + bottom.j);
      member(point(offset, root, collector), point(offset, back, collector), 0.37, 0.48);
      member(point(offset, back, collector - 0.55), point(offset, back, collector), 0.26);
      mark('Assembly_Dock_Stack_Supports', 'Dock_' + bottom.j);
    }
  }
}

function drawDockClosure({ box, line, sector, mark, ringPoint }, model, slot, { base, head }) {
  const open = slot.p !== EMPTY || slot.use !== 'empty',
    angle = slot.angle,
    half = Math.min(0.45, 1.1 / model.R),
    height = head - base,
    hinge = model.R - facadeThickness(model) * 0.5,
    door = rgb('#84998d'),
    seam = rgb('#556d61');
  mark(`Dock_Closure_${open ? 'Folded' : 'Sealed'}_L${slot.f + 1}`, `Slot_${slot.j}`);
  if (open) {
    const leaf = height / 2,
      rad = hinge - leaf / 2;
    for (const [above, color] of [
      [-0.05, door],
      [0.035, seam]
    ])
      box(
        rad * Math.cos(angle),
        head + above,
        rad * Math.sin(angle),
        2 * hinge * Math.sin(half),
        0.07,
        leaf,
        angle,
        color
      );
    // A shallow threshold bridges the gap between the core and the installed floor or deck.
    const threshold = model.R + BUILD_SECTION.dockGap / 2;
    box(
      threshold * Math.cos(angle),
      base - 0.09,
      threshold * Math.sin(angle),
      1.95,
      0.09,
      BUILD_SECTION.dockGap + 0.12,
      angle,
      seam
    );
  } else {
    const face = model.R - 0.015;
    sector(
      model.R - Math.min(0.14, facadeThickness(model) * 0.8),
      face,
      angle - half,
      angle + half,
      base,
      height,
      door
    );
    const middle = base + height / 2,
      steps = Math.max(2, Math.ceil((2 * half) / 0.04));
    for (let i = 0; i < steps; i++)
      line(
        ringPoint(face + 0.012, angle - half + (2 * half * i) / steps, middle),
        ringPoint(face + 0.012, angle - half + (2 * half * (i + 1)) / steps, middle),
        seam
      );
  }
}

// Generate a separate assembly view from the same floor, opening and dock geometry.
function buildAssemblyMesh(model, layers, levels, preview) {
  const mesh = meshBuilder(),
    { box, quad, line, sector, ringPoint, mark } = mesh,
    { dockGap } = BUILD_SECTION,
    floorHeight = modelFloorPitch(model),
    slabThickness = layers.slabThickness ?? model.slabThickness ?? BUILD_SECTION.slabThickness,
    width = model.R - model.r,
    { inside, outside, ringWidth } = buildRingFrame(model),
    concrete = rgb('#c7c8bd'),
    partition = rgb('#e1dacc');
  const coreValues = materialValues(preview.assignments, 'core'),
    coreSystem = STRUCTURAL_SYSTEMS[coreValues.structure],
    coreFrame = rgb(coreSystem.color);
  const full = !levels,
    floors = levels || model.layers.length,
    cutY = full ? Infinity : buildStorey(model, floors - 1, slabThickness).soffit,
    ride = model.feature.ride,
    slide = layers.slide && model.feature.slide,
    slideTube = slide ? slideTubeRings(slide, BUILD_SLIDE_SIDES, true) : null,
    slidePortals = slideTube ? buildSlidePortals(model, slideTube) : [],
    dockStructure = layers.dockStructure ?? 'side-truss',
    dockSlots = model.slots.filter((slot) => slot.f < floors && !slot.blocked),
    stayAxes =
      layers.docks && dockStructure === 'cable-stayed' ? stayCollectorAxes(model, dockSlots) : null,
    extent = model.plaza.outer + 2;
  mark('Reference');
  quad(
    [-extent * 3, -0.18, -extent * 3],
    [-extent * 3, -0.18, extent * 3],
    [extent * 3, -0.18, extent * 3],
    [extent * 3, -0.18, -extent * 3],
    rgb('#e4e8df')
  );

  const member = (a, b, width, color, angle) =>
    drawAssemblyMember(mesh, a, b, width, color, width, angle);
  function at(radius, angle, y, w, h, d, color) {
    box(radius * Math.cos(angle), y, radius * Math.sin(angle), w, h, d, angle, color);
  }

  if (layers.slabs) {
    mark('Assembly_Foundation');
    sector(
      model.r - 0.1,
      model.R + 0.1,
      0,
      TAU,
      0,
      buildStorey(model, 0, slabThickness).underside,
      concrete
    );
  }
  // The radial grid puts columns between docks and secondary beams on the dock axes.
  const bayCount = model.slotN;
  const girderDepth = buildGirderDepth(model);
  function floorFrame(y, openings, gallery, floor) {
    for (const radius of [inside, outside]) {
      const arcs = openArcs(gallery && radius >= gallery ? [] : openings);
      for (const arc of arcs)
        sector(
          radius - ringWidth / 2,
          radius + ringWidth / 2,
          ...arc,
          y - girderDepth,
          girderDepth,
          coreFrame
        );
    }
    if (gallery) {
      for (const [angle, half] of openings)
        sector(
          gallery,
          gallery + 0.24,
          angle - half,
          angle + half,
          y - girderDepth,
          girderDepth,
          coreFrame
        );
    }
    const usedAxes = stayAxes?.get(floor),
      collectors = [],
      // Keep the member caps distinct where a straight beam meets a faceted ring.
      beamBottom = y - girderDepth - (stayAxes ? 0.006 : 0);
    for (let i = 0; i < bayCount * 2; i++) {
      const axis = (i + 1) % (2 * bayCount),
        angle = (axis * TAU) / (2 * bayCount),
        open = openings.some(([a, half]) => angDist(a, angle) < half + 0.015),
        inner = open ? gallery : inside;
      if (!inner || inner >= outside) continue;
      // Stop at the ring faces so the two beam systems do not share the same top surface.
      const start = stayAxes ? inner + (open ? 0.24 : ringWidth / 2) : inner,
        end = stayAxes ? outside - ringWidth / 2 : outside;
      if (end <= start) continue;
      if (usedAxes?.has(axis)) {
        collectors.push({ angle, start, end });
        continue;
      }
      at((start + end) / 2, angle, beamBottom, 0.21, girderDepth, end - start, coreFrame);
    }
    if (collectors.length) {
      const section = stayCollectorSection(model),
        steel = rgb('#657b76');
      mark('Assembly_Dock_Stay_Collectors_L' + (floor + 1));
      for (const { angle, start, end } of collectors) {
        const block = (a, b, bottom, h, w) => at((a + b) / 2, angle, bottom, w, h, b - a, steel);
        drawStayIBeam(block, start, end, beamBottom, section);
      }
    }
  }
  for (let f = 0; f < floors; f++) {
    const storey = buildStorey(model, f, slabThickness),
      { underside: y, base, soffit } = storey,
      clearHeight = soffit - base,
      openings = f ? lobbyHoles(model.lobby, f) : [],
      arcs = openArcs(openings);
    if (layers.slabs) {
      mark('Assembly_Floor_' + (f + 1));
      for (const arc of arcs) sector(model.r, model.R, ...arc, y, slabThickness, concrete);
      if (f === 1 && model.lobby.gallery)
        for (const [angle, half] of openings)
          sector(
            model.lobby.gallery,
            model.R,
            angle - half,
            angle + half,
            y,
            slabThickness,
            concrete
          );
    }
    if (layers.frame) {
      mark('Assembly_Ring_Beams_' + (f + 1));
      if (f) floorFrame(y, openings, f === 1 ? model.lobby.gallery : null, f);
      mark('Assembly_Columns_' + (f + 1));
      const column = Math.min(0.38, width * 0.3);
      const reserved = lobbyHoles(model.lobby, f);
      for (let j = 0; j < bayCount; j++) {
        const angle = ((j + 0.5) * TAU) / bayCount;
        const slidePortal =
          slidePortals.some(
            (door) => door.floor === f && mod(angle - door.start, TAU) < door.end - door.start
          ) ||
          model.feature.slide?.connections.some(
            (door) => door.floor === f && angDist(door.angle, angle) < 1.6 / model.R
          );
        if (reserved.some(([a, half]) => angDist(a, angle) < half + 0.035)) continue;
        // The wide face follows the tangent of the ring at each bay.
        at(inside, angle, base, column * 1.2, clearHeight, column, coreFrame);
        if (!slidePortal) at(outside, angle, base, column * 1.2, clearHeight, column, coreFrame);
        if (coreSystem.frame === 'brace' && j % 3 === 0)
          member(
            ringPoint(inside, angle, soffit),
            ringPoint(outside, angle, base),
            column * 0.52,
            coreFrame
          );
      }
    }
    if (layers.facade) {
      mark('Assembly_Exterior_Walls_' + (f + 1));
      for (const wall of coreFacadeSpans(model, f, storey, slidePortals))
        drawMaterialFacade(mesh, model, f, wall.span, wall.y, wall.height, preview);
    }
    if (layers.walls) {
      mark('Assembly_Room_Partitions_' + (f + 1));
      for (const room of model.rooms) {
        if (room.f !== f || room.R - room.r < 0.16) continue;
        const wall = Math.min(0.12, (room.R - room.r) / 4),
          door = (room.start + room.end) / 2,
          doorSide = room.facadeFacing ? room.r : room.R,
          doorway = Math.min(0.6 / doorSide, (room.end - room.start) * 0.28),
          doorHead = 2.15;
        const wallColor =
          preview.programColors && PROGRAMS[room.id] ? rgb(PROGRAMS[room.id].color) : partition;
        const [low, high] = room.facadeFacing ? [room.r, room.r + wall] : [room.R - wall, room.R];
        if (!room.facadeFacing)
          sector(room.r, room.r + wall, room.start, room.end, base, clearHeight, wallColor);
        if (room.sharedLobby) {
          sector(low, high, room.start, room.end, base, clearHeight, wallColor);
        } else {
          for (const [a, z] of [[room.start, door - doorway], [door + doorway, room.end]])
            sector(low, high, a, z, base, clearHeight, wallColor);
          sector(low, high, door - doorway, door + doorway, base + doorHead,
            clearHeight - doorHead, wallColor);
        }
        for (const angle of [room.start, room.end]) {
          const portal = room.sharedLobby;
          const sideWall = (a, b, y, height) => {
            if (b > a) at((a + b) / 2, angle, y, wall, height, b - a, wallColor);
          };
          if (!portal || Math.abs(angle - portal.angle) > 1e-7) {
            sideWall(room.r, room.R, base, clearHeight);
            continue;
          }
          const from = portal.r - portal.width / 2, to = portal.r + portal.width / 2,
            head = 2.3;
          sideWall(room.r, from, base, clearHeight);
          sideWall(to, room.R, base, clearHeight);
          sideWall(from, to, base + head, clearHeight - head);
        }
      }
    }
    if (layers.slabs || layers.walls) for (const hub of model.circulation.hubs) {
      if (hub.f !== f || !hub.layout) continue;
      mark(`Circulation_L${f + 1}_Shared_Lobby`, `Lobby ${hub.start.toFixed(3)}`);
      drawSharedLobbyFloor(mesh, hub, base, 0.018, rgb('#a889bc'));
      drawSharedLobby(mesh, hub, base + 0.018);
    }
  }
  if (full && layers.slabs) {
    mark('Assembly_Roof_Deck');
    sector(model.r, model.R, 0, TAU, model.roofPlan.y - slabThickness, slabThickness, concrete);
  }
  if (full && layers.frame) {
    mark('Assembly_Roof_Framing');
    floorFrame(model.roofPlan.y - slabThickness, [], null, floors);
  }
  if (layers.swings) {
    drawSwingMast(mesh, ride, Math.min(cutY, ride.height), preview);
    if (full) drawSwingAboveRoof(mesh, model);
  }
  // The boarding deck closes the inner ring when visible. Otherwise the roof shows its glazed cap.
  const pitch = ride.roofPitch;
  if (full && pitch && (layers.frame || layers.facade)) {
    const inner = ride.platformRadius,
      outer = model.r,
      low = pitch.canopyEaveY ?? pitch.eaveY - 0.045,
      high = pitch.canopyRidgeY ?? low + pitch.rise;
    if (layers.frame) {
      mark('Assembly_Greenhouse_Frame');
      for (const [radius, height] of [
        [inner, high],
        [outer, low]
      ])
        sector(radius - 0.13, radius + 0.13, 0, TAU, height - 0.24, 0.24, coreFrame);
      for (let i = 0; i < 24; i++) {
        const angle = (i * TAU) / 24;
        member(
          ringPoint(inner, angle, high - 0.13),
          ringPoint(outer, angle, low - 0.13),
          0.16,
          coreFrame
        );
      }
    }
    if (layers.facade) {
      mark('Assembly_Greenhouse_Glazing');
      const tint = rgb('#c4dfde'),
        cap = [0, high, 0];
      for (let i = 0; i < 96; i++) {
        const a = (i * TAU) / 96,
          d = ((i + 1) * TAU) / 96,
          innerA = ringPoint(inner, a, high),
          innerD = ringPoint(inner, d, high);
        quad(
          innerD,
          ringPoint(outer, d, low),
          ringPoint(outer, a, low),
          innerA,
          tint,
          mesh.glass,
          0.38
        );
        if (!layers.swings) mesh.tri(cap, innerD, innerA, tint, mesh.glass, 0.38);
      }
    }
  }
  if (full && layers.roofRetail) drawCommercialPavilions(mesh, model.roofPlan, preview);

  const exterior = layers.modules ? moduleExteriorDetails(model, preview.view.seed) : null;

  // Dock plates, paired cantilevers and their tie-back show the relationship to the ring.
  for (const slot of dockSlots) {
    const storey = buildStorey(model, slot.f, slabThickness),
      occupied = slot.p !== EMPTY || slot.use === 'retail',
      angle = slot.angle,
      base = storey.base,
      dx = Math.cos(angle),
      dz = Math.sin(angle),
      foot = model.R + dockGap,
      front = foot + MODULE.depth;
    const location = (radius, side, y) => [radius * dx - side * dz, y, radius * dz + side * dx];
    if (layers.docks) {
      if (dockStructure === 'side-truss' || dockStructure === 'side-portal')
        drawDockFrame(
          mesh,
          model,
          slot,
          storey,
          'Assembly_Dock_Connections',
          true,
          dockStructure === 'side-portal'
        );
      else drawAlternativeDock(mesh, model, slot, storey, dockStructure);
    }
    if (layers.facade || layers.docks) drawDockClosure(mesh, model, slot, storey);
    if (!layers.modules) continue;
    if (!occupied) {
      if (slot.use !== 'empty') {
        const [x, , z] = location((foot + front) / 2, 0, base),
          deckColor = rgb(VACANCY.find((use) => use.id === slot.use).color);
        mark(`Assembly_Open_${slot.use}_L${slot.f + 1}`, `Slot_${slot.j}`);
        drawDockDeck(mesh, slot, x, base, z, angle, deckColor);
      }
      continue;
    }
    const values =
      slot.p === EMPTY
        ? materialValues(preview.assignments, 'commercial')
        : materialValues(preview.assignments, 'module', slot.p, materialSlotKey(model, slot));
    const system = STRUCTURAL_SYSTEMS[values.structure];
    const chassis = rgb(
      preview.programColors && PROGRAMS[slot.p] ? PROGRAMS[slot.p].color : system.color
    );
    if (layers.facade) {
      mark('Assembly_Module_Skin', `${slot.f + 1}/Slot_${slot.j}`);
      const [x, , z] = location((foot + front) / 2, 0, base);
      drawMaterialModule(mesh, slot, x, base, z, preview, values);
      if (exterior?.balconies.has(slot.i)) drawModuleBalcony(mesh, model, slot, base);
      continue;
    }
    mark('Assembly_Module_Chassis', `${slot.f + 1}/Slot_${slot.j}`);
    const half = MODULE.width / 2 - 0.13,
      upper = base + MODULE.height;
    at((foot + front) / 2, angle, base, MODULE.width, 0.15, MODULE.depth, chassis);
    for (const side of [-half, half]) {
      member(location(foot, side, upper), location(front, side, upper), 0.11, chassis);
      for (let bay = 0; bay <= 3; bay++) {
        const atBay = foot + (MODULE.depth * bay) / 3;
        member(location(atBay, side, base), location(atBay, side, upper), 0.11, chassis, angle);
        if (system.frame !== 'solid' && bay < 3 && (system.frame === 'brace' || bay !== 1))
          member(
            location(atBay, side, base),
            location(atBay + MODULE.depth / 3, side, upper),
            0.085,
            chassis
          );
      }
    }
    for (const radius of [foot, front])
      member(location(radius, -half, upper), location(radius, half, upper), 0.11, chassis);
    if (exterior?.balconies.has(slot.i)) drawModuleBalcony(mesh, model, slot, base, null, false);
  }
  if (layers.docks && (dockStructure === 'roof-hung' || dockStructure === 'columns'))
    drawSharedDockSupports(mesh, model, dockSlots, dockStructure, slabThickness);

  // Preserve the modeled spans when the assembly is shown without its finish layers.
  if (layers.slabs) {
    mark('Assembly_Atrium_Bridges');
    for (const bridge of model.circulation.bridges ?? []) {
      if (bridge.f >= floors) continue;
      const radial = Math.sqrt(model.r ** 2 - bridge.offset ** 2),
        x = Math.cos(bridge.heading),
        z = Math.sin(bridge.heading);
      box(
        x * bridge.offset,
        bridge.f * floorHeight + 0.3,
        z * bridge.offset,
        bridge.width,
        0.23,
        2 * radial,
        bridge.heading + Math.PI / 2,
        concrete
      );
    }
  }
  if (slide) {
    drawWaterSlide(mesh, slide, preview, cutY, model.R + slide.tubeRadius + 0.22, slideTube);
    for (const portal of slidePortals)
      if (portal.floor < floors)
        drawSlidePortal(
          mesh,
          portal,
          buildStorey(model, portal.floor, slabThickness),
          layers.facade
        );
    drawSlideLandings(mesh, model, slideTube, floors, slabThickness);
  }
  const H = layers.swings && full ? ride.height : (floors + Number(full)) * floorHeight;
  return { ...mesh, H, extent };
}

const BUILD_LAYERS = {
  frame: 'buildFrame',
  slabs: 'buildSlabs',
  walls: 'buildWalls',
  facade: 'buildFacade',
  docks: 'buildDocks',
  modules: 'buildModules',
  slide: 'buildSlide',
  swings: 'buildSwings',
  roofRetail: 'buildRoofRetail'
};
function buildViewLayers() {
  return {
    ...Object.fromEntries(
      Object.entries(BUILD_LAYERS).map(([field, id]) => [field, $(id).checked])
    ),
    dockStructure: $('buildDockStructure').value || 'side-truss',
    slabThickness: state.slabThickness
  };
}

const openBuildWorkspace = (() => {
  const panel = $('buildPhase'),
    canvas = $('buildCanvas'),
    level = $('buildLevel'),
    dockStructure = $('buildDockStructure'),
    slabThickness = $('buildSlabThickness'),
    waterDepth = $('buildWaterDepth'),
    dockKey = 'poly-nation-build-dock-structure',
    layerKey = 'poly-nation-build-visible-layers',
    view = { az: -0.84, el: 0.57, zoom: 1, pan: 0, panX: 0 };
  let retainedLevels = 0;
  for (const [value, { name }] of Object.entries(DOCK_STRUCTURES))
    dockStructure.add(new Option(name, value));
  try {
    const savedDock = localStorage.getItem(dockKey);
    if (Object.hasOwn(DOCK_STRUCTURES, savedDock)) dockStructure.value = savedDock;
    const savedLayers = JSON.parse(localStorage.getItem(layerKey));
    for (const [field, id] of Object.entries(BUILD_LAYERS)) {
      if (typeof savedLayers?.[field] === 'boolean') $(id).checked = savedLayers[field];
    }
    if (Number.isInteger(savedLayers?.level) && savedLayers.level >= 0)
      retainedLevels = savedLayers.level;
  } catch {
    // The selector still works when browser storage is unavailable.
  }
  let source = null,
    assignments = {},
    signature = '',
    copy = null,
    assembly = null,
    context = null,
    renderer = null,
    fallback = null;

  function present() {
    if (panel.hidden || !assembly) return;
    if (renderer) paintWebGL(canvas, context, renderer, view);
    else if (fallback) paintSoftware(assembly, fallback, view);
  }
  function updateEstimate() {
    const depth = Number.isFinite(waterDepth.valueAsNumber)
      ? clamp(waterDepth.valueAsNumber, 0, 10)
      : 1;
    showBuildGravityStudy(copy, assignments, dockStructure.value, copy.slabThickness, depth);
  }
  function saveLayers() {
    // Keep both checked and unchecked choices. Older settings still inherit the defaults.
    try {
      const layers = Object.fromEntries(
        Object.entries(BUILD_LAYERS).map(([field, id]) => [field, $(id).checked])
      );
      localStorage.setItem(layerKey, JSON.stringify({ ...layers, level: retainedLevels }));
    } catch {
      // Visibility controls are also usable with browser storage disabled.
    }
  }
  function rebuild(center = false) {
    const layers = buildViewLayers(),
      visibleLevels = Number(level.value),
      choice = DOCK_STRUCTURES[layers.dockStructure];
    assembly = buildAssemblyMesh(copy, layers, visibleLevels, {
      assignments,
      view: { seed: state.seed },
      programColors: false,
      structureView: false,
      finishJoints: Boolean(renderer)
    });
    if (renderer) uploadWebGLMesh(context, renderer, assembly);
    if (center && assembly.groups.length > 1) fitModel(assembly, view, canvas);
    let note = choice.note;
    if (layers.dockStructure === 'columns')
      note += ' Brown posts flag alignment with a reserved ground bay.';
    $('dockStructureNote').textContent = note;
    present();
  }
  dockStructure.onchange = () => {
    try {
      localStorage.setItem(dockKey, dockStructure.value);
    } catch {
      // Switching structures can continue without browser storage.
    }
    $('buildDocks').checked = true;
    saveLayers();
    updateEstimate();
    rebuild(true);
  };
  slabThickness.onchange = () => {
    state.slabThickness = Number(slabThickness.value);
    update();
    openBuildWorkspace(model, assignments, false);
  };
  waterDepth.oninput = () => {
    if (copy) updateEstimate();
  };
  level.onchange = () => {
    retainedLevels = Number(level.value);
    saveLayers();
    rebuild(true);
  };
  for (const id of Object.values(BUILD_LAYERS))
    $(id).onchange = () => {
      saveLayers();
      rebuild(id === 'buildSwings');
    };
  bindModelCamera({
    canvas,
    getCamera: () => view,
    getMesh: () => assembly,
    onChange: present,
    buttons: { axo: 'buildAxo', plan: 'buildPlan', side: 'buildSide', fit: 'buildFit' }
  });
  new ResizeObserver(present).observe(canvas);

  return (model, materialAssignments, fit = true) => {
    if (!renderer && !fallback) {
      context = canvas.getContext('webgl', { antialias: true, alpha: false });
      renderer = createWebGLRenderer(context);
      if (!renderer) fallback = createSoftwareRenderer(canvas);
    }
    const next = JSON.stringify(materialAssignments);
    if (source === model) {
      if (signature === next) present();
      else {
        assignments = materialAssignments;
        signature = next;
        updateEstimate();
        rebuild();
      }
      return;
    }
    source = model;
    assignments = materialAssignments;
    signature = next;
    copy = structuredClone(model);
    updateEstimate();
    level.replaceChildren(
      new Option('All levels', '0'),
      ...copy.layers.map(
        (_, i) => new Option(i === 0 ? 'Ground only' : 'Ground through L' + (i + 1), String(i + 1))
      )
    );
    level.value = retainedLevels <= copy.layers.length ? String(retainedLevels) : '0';
    rebuild(fit);
  };
})();
