'use strict';

const CONNECTION_DETAIL_TITLES = {
  support: 'Dock support',
  root: 'Dock to core',
  services: 'Module seat and services'
};

// The exterior profiles are diagrammatic. The same shapes are used on the assembly
// drawing and in the enlarged elevations so the callouts identify the same parts.
function fittingPen(pen, x = 0, y = 0, angle = 0) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const point = (u, v) => [x + u * cos - v * sin, y + u * sin + v * cos];
  function outline(points, weight = 'outline') {
    pen.outline(
      points.map(([u, v]) => point(u, v)),
      weight
    );
  }
  function line(u, v, a, b, weight) {
    pen.line(...point(u, v), ...point(a, b), weight);
  }
  function plate(left, bottom, width, height, weight) {
    outline(
      [
        [left, bottom],
        [left + width, bottom],
        [left + width, bottom + height],
        [left, bottom + height]
      ],
      weight
    );
  }
  function ring(u, v, radius) {
    pen.pin(...point(u, v), radius);
  }
  function hex(u, v, radius) {
    outline(
      Array.from({ length: 6 }, (_, i) => [
        u + radius * Math.cos((i * TAU) / 6),
        v + radius * Math.sin((i * TAU) / 6)
      ]),
      'fine'
    );
  }
  function bolt(u, v, radius = 0.021) {
    ring(u, v, radius);
    hex(u, v, radius * 0.78);
    ring(u, v, radius * 0.26);
  }
  function chamfer(left, right, half, bevel) {
    outline([
      [left, -half + bevel],
      [left + bevel, -half],
      [right - bevel, -half],
      [right, -half + bevel],
      [right, half - bevel],
      [right - bevel, half],
      [left + bevel, half],
      [left, half - bevel]
    ]);
  }
  function thread(left, right, half, step = 0.016) {
    plate(left, -half, right - left, 2 * half, 'fine');
    // The hatch follows only the exposed threaded surface.
    for (let at = left; at + step <= right + 1e-9; at += step) {
      line(at + step * 0.7, -half, at, half, 'fine');
    }
  }
  function nut(left, right, half) {
    chamfer(left, right, half, 0.008);
    for (const sign of [-1, 1]) line(left, (sign * half) / 2, right, (sign * half) / 2, 'fine');
  }
  return { outline, line, plate, ring, bolt, chamfer, thread, nut };
}

function cableFork(pen, x = 0, y = 0, angle = 0, showLug = true) {
  const { outline, plate, line, ring } = fittingPen(pen, x, y, angle);
  // Side elevation. The exposed retaining system is drawn at the near end of the pin.
  if (showLug) {
    plate(-0.35, -0.137, 0.045, 0.274);
    outline([
      [-0.305, -0.124],
      [-0.151, -0.079],
      [-0.113, -0.044],
      [-0.11, 0.034],
      [-0.145, 0.08],
      [-0.305, 0.124]
    ]);
  }
  plate(0.18, -0.04, 0.17, 0.08, 'fine');
  for (let at = 0.23; at < 0.34; at += 0.024) line(at, -0.038, at - 0.032, 0.038, 'fine');
  outline([
    [-0.201, -0.072],
    [-0.076, -0.077],
    [-0.016, -0.059],
    [0.027, -0.053],
    [0.082, -0.062],
    [0.155, -0.062],
    [0.212, -0.04],
    [0.212, 0.04],
    [0.155, 0.062],
    [0.082, 0.062],
    [0.027, 0.053],
    [-0.016, 0.059],
    [-0.076, 0.077],
    [-0.201, 0.072],
    [-0.238, 0.041],
    [-0.244, 0],
    [-0.238, -0.041]
  ]);
  line(-0.055, 0.062, -0.055, -0.062, 'fine');
  line(0.082, 0.062, 0.082, -0.062, 'fine');
  line(0.158, 0.058, 0.158, -0.058, 'fine');
  ring(-0.167, 0, 0.052);
  ring(-0.167, 0, 0.035);
  ring(-0.167, 0, 0.011);
  line(-0.193, 0.034, -0.205, 0.061, 'fine');
}

const stayBoltRows = [-0.33, -0.14, 0.14, 0.33];

function stayCollectorFace(pen, stay) {
  const { plate, bolt, line } = fittingPen(pen),
    { plateWidth, beamDepth, flangeThickness } = stay,
    edge = plateWidth / 2,
    top = beamDepth / 2;
  plate(-edge, -top, plateWidth, beamDepth);
  // Looking inboard: the central lug is seen edge-on. Both bolt columns
  // clear the lug and sit between the beam flanges for access behind the plate.
  plate(-0.035, -0.31 * beamDepth, 0.07, 0.62 * beamDepth);
  for (const x of [-0.32 * plateWidth, 0.32 * plateWidth]) {
    for (const row of stayBoltRows) bolt(x, row * beamDepth, 0.021);
  }
  for (const y of [-top + flangeThickness, top - flangeThickness]) line(-edge, y, edge, y, 'fine');
}

function stayTensioner(pen, x = 0, y = 0, angle = 0) {
  const { chamfer, thread, nut, plate, line } = fittingPen(pen, x, y, angle);
  plate(-0.39, -0.035, 0.78, 0.07);
  thread(-0.37, -0.221, 0.043);
  thread(0.221, 0.37, 0.043);
  chamfer(-0.22, 0.22, 0.076, 0.025);
  for (const sign of [-1, 1]) line(-0.195, sign * 0.047, 0.195, sign * 0.047, 'fine');
  nut(-0.257, -0.22, 0.062);
  nut(0.22, 0.257, 0.062);
  // Different end marks identify the left- and right-hand adjustments.
  line(-0.182, -0.038, -0.182, 0.038, 'fine');
  line(0.166, -0.038, 0.166, 0.038, 'fine');
  line(0.182, -0.038, 0.182, 0.038, 'fine');
}

function rodHead(pen, x = 0, y = 0, angle = 0) {
  const { plate, outline, thread, nut, line } = fittingPen(pen, x, y, angle);
  plate(-0.29, -0.035, 0.57, 0.07);
  thread(0.04, 0.25, 0.044, 0.014);
  // In the enlarged view the rod is horizontal so the plate stack is legible.
  for (const side of [-1, 1]) {
    outline([
      [-0.2, side * 0.041],
      [-0.025, side * 0.137],
      [-0.025, side * 0.041]
    ]);
    line(-0.13, side * 0.045, -0.042, side * 0.045, 'fine');
  }
  plate(-0.036, -0.151, 0.046, 0.302);
  plate(0.01, -0.099, 0.018, 0.198, 'fine');
  nut(0.028, 0.101, 0.086);
  nut(0.102, 0.148, 0.081);
}

function rodCoupler(pen, x = 0, y = 0, angle = 0) {
  const { plate, thread, chamfer, line } = fittingPen(pen, x, y, angle);
  plate(-0.36, -0.036, 0.72, 0.072);
  thread(-0.32, -0.162, 0.043, 0.014);
  thread(0.162, 0.32, 0.043, 0.014);
  chamfer(-0.172, 0.172, 0.071, 0.018);
  for (const y of [-0.041, 0.041]) line(-0.15, y, 0.15, y, 'fine');
  for (const x of [-0.1, 0.1]) line(x, -0.035, x, 0.035, 'fine');
}

function plateFace(pen, { height = 0.4, width = 0.31, rows = 3 } = {}) {
  const { plate, bolt, line } = fittingPen(pen);
  const top = height / 2,
    edge = width / 2;
  plate(-edge, -top, width, height);
  for (const x of [-edge + 0.03, edge - 0.03]) {
    line(x, -top + 0.012, x, top - 0.012, 'fine');
    for (let i = 0; i < rows; i++) {
      bolt(x * 0.76, (i / (rows - 1) - 0.5) * (height - 0.11));
    }
  }
  for (const y of [-top + 0.025, top - 0.025]) {
    line(-edge + 0.03, y, edge - 0.03, y, 'fine');
  }
}

function gussetFace(pen, portal = false) {
  const { plate, outline, line, bolt } = fittingPen(pen);
  plate(-0.4, -0.155, 0.8, 0.145);
  if (portal) {
    plate(-0.245, -0.007, 0.21, 0.22);
    plate(-0.29, -0.04, 0.305, 0.043);
    line(-0.245, 0.095, -0.035, 0.095, 'fine');
    line(-0.245, 0.108, -0.035, 0.108, 'fine');
    for (const y of [-0.117, -0.085]) line(-0.4, y, 0.4, y, 'fine');
    return;
  }
  outline([
    [-0.34, 0.158],
    [-0.198, 0.206],
    [0.137, 0.045],
    [0.117, -0.017]
  ]);
  outline([
    [-0.26, -0.107],
    [-0.27, 0.139],
    [-0.13, 0.122],
    [0.247, -0.036],
    [0.281, -0.093],
    [0.249, -0.125],
    [-0.221, -0.125]
  ]);
  for (const [x, y] of [
    [-0.196, 0.095],
    [-0.13, 0.064],
    [-0.067, 0.036],
    [0.03, -0.067],
    [0.104, -0.067],
    [0.178, -0.067]
  ])
    bolt(x, y, 0.017);
  line(-0.22, -0.105, 0.244, -0.105, 'fine');
}

function bearingSide(pen, post = false, x = 0, y = 0) {
  const { plate, outline, line, nut } = fittingPen(pen, x, y);
  plate(-0.37, 0.052, 0.74, 0.102);
  line(-0.37, 0.087, 0.37, 0.087, 'fine');
  plate(-0.28, 0.014, 0.56, 0.038);
  plate(-0.235, -0.03, 0.47, 0.043);
  plate(-0.27, -0.064, 0.54, 0.034);
  plate(-0.13, -0.155, 0.26, 0.091);
  for (const side of [-1, 1]) {
    const x = side * 0.13;
    outline([
      [x, -0.153],
      [side * 0.231, -0.066],
      [x, -0.066]
    ]);
  }
  if (post) return;
  plate(0.21, 0.015, 0.048, 0.153);
  for (const x of [-0.23, 0.23]) nut(x - 0.031, x + 0.031, 0.02);
}

function columnBase(pen) {
  const { plate, nut, line, outline } = fittingPen(pen);
  plate(-0.39, -0.16, 0.78, 0.052);
  plate(-0.293, -0.11, 0.586, 0.033);
  plate(-0.132, -0.076, 0.264, 0.269);
  for (const sign of [-1, 1]) {
    outline([
      [sign * 0.132, -0.076],
      [sign * 0.211, -0.076],
      [sign * 0.132, 0.057]
    ]);
    const x = sign * 0.244;
    plate(x - 0.043, -0.076, 0.086, 0.013, 'fine');
    plate(x - 0.023, -0.062, 0.046, 0.107);
    nut(x - 0.036, x + 0.036, 0.023);
    for (let at = -0.041; at <= 0.045; at += 0.021)
      line(x - 0.022, at, x + 0.022, at + 0.004, 'fine');
  }
  line(-0.37, -0.128, 0.37, -0.128, 'fine');
}

function serviceFittings(pen) {
  // The three row elevations show the visible collar, housing and release hardware.
  const power = fittingPen(pen, 0, 0.108);
  const water = fittingPen(pen);
  const drain = fittingPen(pen, 0, -0.112);
  power.plate(-0.29, -0.024, 0.56, 0.048, 'fine');
  power.chamfer(-0.2, 0.162, 0.042, 0.015);
  power.plate(-0.126, -0.047, 0.034, 0.094, 'fine');
  power.outline([
    [0.031, 0.038],
    [0.13, 0.038],
    [0.123, 0.064],
    [0.05, 0.064]
  ]);
  water.plate(-0.29, -0.017, 0.56, 0.034, 'fine');
  water.chamfer(-0.183, 0.162, 0.036, 0.01);
  water.nut(-0.15, -0.081, 0.042);
  water.nut(0.069, 0.132, 0.042);
  drain.plate(-0.29, -0.043, 0.56, 0.086, 'fine');
  drain.plate(-0.151, -0.053, 0.3, 0.106);
  for (const x of [-0.112, 0.11]) drain.plate(x - 0.024, -0.058, 0.048, 0.116, 'fine');
  drain.bolt(0.087, 0.059, 0.017);
}

const CONNECTION_FITTINGS = {
  'cable-stayed': [
    {
      title: 'Pinned fork socket',
      note: 'Two fork cheeks around the welded lug · retained pin',
      draw: cableFork
    }
  ],
  'roof-hung': [
    {
      title: 'Hanger head',
      note: 'Stiffened plate · washer · locknuts · rotated on sheet',
      draw: rodHead
    },
    {
      title: 'Threaded bar coupler',
      note: 'Coupler shoulders · witness marks · exposed threads',
      draw: rodCoupler
    }
  ],
  columns: [
    {
      title: 'Tip post cap',
      note: 'Seated deck rail · bearing · stiffened cap',
      draw: (pen) => bearingSide(pen, true)
    },
    {
      title: 'Post base plate',
      note: 'Grout bed · bearing plate · hold-down nuts',
      draw: columnBase,
      scale: 15
    }
  ],
  'side-truss': [
    {
      title: 'Chord end plate',
      note: 'Bolt heads and washers · plate perimeter',
      draw: plateFace,
      scale: 15
    },
    {
      title: 'Web gusset',
      note: 'Bolted web splice · weld return · chord',
      draw: gussetFace,
      scale: 15
    }
  ],
  'side-portal': [
    {
      title: 'Moment end plate',
      note: 'Bolts and washers · chord flange line',
      draw: (pen) => plateFace(pen, { height: 0.46, rows: 4 }),
      scale: 15
    },
    {
      title: 'Rigid post junction',
      note: 'Post face · visible weld and stiffener lines',
      draw: (pen) => gussetFace(pen, true),
      scale: 15
    }
  ],
  'box-floor': [
    {
      title: 'Full-depth end plate',
      note: 'Bolted perimeter · diaphragm behind plate',
      draw: (pen) => plateFace(pen, { height: 0.42, rows: 4 }),
      scale: 15
    },
    {
      title: 'Dock seat and keeper',
      note: 'Bearing pad · welded stop · removable fixing',
      draw: bearingSide
    }
  ],
  services: [
    {
      title: 'Module seat',
      note: 'Bearing pad · welded stop · removable keeper',
      draw: bearingSide
    },
    {
      title: 'Service connections',
      note: 'Top to bottom · power plug · water union · drain collar',
      draw: serviceFittings
    }
  ]
};

function connectionDemandCopy(detail, structure, demand) {
  const kN = (force) => Math.round(force).toLocaleString('en-CA') + ' kN',
    MNm = (moment) => (moment / 1000).toFixed(2) + ' MN·m',
    moment = MNm(demand.governing.rootMoment),
    shear = kN(demand.governing.shear),
    demandByStructure = {
      'cable-stayed': {
        value: kN(demand.stayTension) + ' tension per stay',
        check: `Each upper anchor: ${kN(demand.anchorOut)} outward, ${kN(demand.anchorDown)} down, ${Math.round(demand.anchorMoment)} kN·m from pin offset.`
      },
      'roof-hung': {
        value: kN(demand.stackedSupport) + ' tension per upper rod',
        check:
          'All decks loaded in the stack. Check thread area, coupler, bearing plate and roof collector.'
      },
      columns: {
        value: kN(demand.stackedSupport) + ' compression per lower post',
        check:
          'All decks loaded in the stack. Check bearing, column buckling and footing reactions.'
      },
      'side-truss': {
        value: kN(demand.governing.chordForce) + ' axial force per root chord',
        check: 'Check plate bending, bolts, gusset buckling and the welds into the core framing.'
      },
      'side-portal': {
        value: moment + ' at the core face',
        check: 'Global moment across both frames. Check the rigid joints and frame bending.'
      },
      'box-floor': {
        value: moment + ' at the core face',
        check: 'Check the closed section, end-plate prying, bolts and the collector welds.'
      }
    };
  if (detail === 'services')
    return {
      value: shear + ' gravity load per dock',
      check:
        'Global dock load. Seat reactions, utility ratings, drain falls and local bearing require design.'
    };
  if (detail === 'root' && structure === 'cable-stayed')
    return {
      value: kN(demand.deckCompression) + ' compression into core',
      check:
        'Ideal horizontal reaction from the two stays. Check the collector and deck connection.'
    };
  if (detail === 'root' && structure === 'roof-hung')
    return {
      value: kN(demand.stackedSupport) + ' vertical load per roof return',
      check:
        'All decks loaded in the stack. The outboard reach also puts bending into the roof collector.'
    };
  if (detail === 'root' && structure === 'columns') {
    const reaction = demand.governing.shear - demand.tipPair;
    return {
      value: kN(Math.abs(reaction)) + (reaction < 0 ? ' uplift at the core' : ' shear into core'),
      check:
        'Ideal inboard reaction for the whole deck. Verify how the seat and restraint share it.'
    };
  }
  return demandByStructure[structure];
}

// Connection contexts are local elevations of the hardware over sections of the building.
// Coordinates are metres, with the perimeter or the main attachment near x = 0.
function drawConnectionContext(detail, model, layers, demand, pen) {
  const { cut, line, callout, dim, label, service } = pen,
    { dockStructure: structure, slabThickness: slab } = layers,
    { dockGap: gap, chordDepth } = BUILD_SECTION,
    girder = buildGirderDepth(model);
  function core() {
    cut(-1.39, 0, 1.39, slab, 'concrete');
    cut(-0.35, -slab, 0.35, girder, 'steel');
    cut(-1.32, -slab - 0.04, 0.94, 0.185, 'steel');
    line(-1.39, 0.045, -0.04, 0.045, 'fine');
  }
  function jointPlate(x, y, height = 0.36) {
    const { plate, bolt } = fittingPen(pen, x, y);
    plate(-0.045, -height / 2, 0.09, height);
    for (const v of [-height * 0.34, 0, height * 0.34]) bolt(0, v, 0.015);
  }
  function deckRail(x, y, width, depth = 0.28) {
    const { plate, line } = fittingPen(pen, x, y);
    plate(0, -depth, width, depth);
    line(0, -0.045, width, -0.045, 'fine');
    line(0, 0.05 - depth, width, 0.05 - depth, 'fine');
  }

  if (detail === 'services') {
    core();
    const floorDepth = 0.5,
      seat = 1.1;
    cut(gap, 0, 1.03, 0.075, 'timber');
    cut(gap, -0.075, 0.09, floorDepth - 0.075, 'steel');
    cut(gap, -floorDepth + 0.065, 1.03, 0.065, 'steel');
    line(0, 0, gap, 0, 'outline');
    line(0.08, 0.045, gap - 0.08, 0.045, 'fine');
    line(gap, 0, gap, 0.73, 'outline');
    line(gap + 0.09, 0, gap + 0.09, 0.73, 'outline');
    line(gap - 0.06, 0.73, gap + 0.15, 0.73, 'faint');
    const seatPen = fittingPen(pen, seat, -floorDepth);
    seatPen.plate(-0.28, -0.036, 0.56, 0.036);
    seatPen.plate(-0.31, -0.08, 0.62, 0.044);
    seatPen.plate(0.26, -0.044, 0.075, 0.18);
    seatPen.bolt(0.19, -0.062, 0.018);
    deckRail(0.72, -0.08 - floorDepth, 0.94, 0.16);
    // These three solid routes are projected from an adjacent utility bay.
    service(
      [
        [-0.94, -0.39],
        [-0.42, -0.39],
        [-0.16, -0.13],
        [0.42, -0.13],
        [0.56, -0.19],
        [1.48, -0.19]
      ],
      'power'
    );
    service(
      [
        [-0.94, -0.51],
        [-0.37, -0.51],
        [-0.15, -0.26],
        [0.41, -0.26],
        [0.56, -0.29],
        [1.48, -0.29]
      ],
      'water'
    );
    service(
      [
        [1.48, -0.37],
        [0.56, -0.38],
        [0.27, -0.41],
        [-0.21, -0.48],
        [-0.82, -0.57]
      ],
      'drain'
    );
    fittingPen(pen, 0.25, -0.13).chamfer(-0.052, 0.052, 0.034, 0.013);
    fittingPen(pen, 0.25, -0.26).nut(-0.068, 0.068, 0.043);
    fittingPen(pen, 0.25, -0.412).plate(-0.072, -0.039, 0.144, 0.078);
    dim(1.77, -floorDepth, 0, '500 mm');
    callout('Removable threshold cover', -2.25, 0.61, 0.22, 0.044);
    callout('Power and data plug', -2.25, 0.35, 0.25, -0.13);
    callout('Isolated water coupling', -2.25, -0.82, 0.25, -0.26);
    callout('Gravity drain to core stack', -2.25, -1.08, 0.25, -0.412);
    callout('A  Bearing pad and locating stop', 2.25, -1.01, seat, -0.54);
    label(-1.39, 0.18, 'CORE FFL');
    label(0.78, 0.13, 'MODULE FFL');
    return;
  }

  if (detail === 'root') {
    core();
    dim(-1.63, -slab, 0, Math.round(slab * 1000) + ' mm');
    if (structure === 'roof-hung') {
      const collector = -slab - girder * 0.68;
      deckRail(-1.34, collector + 0.16, 1.65, 0.36);
      deckRail(0.18, 0.62, 1.39, 0.34);
      const jamb = fittingPen(pen, 0.15, collector);
      jamb.plate(-0.02, -0.26, 0.31, 1.6);
      jamb.line(0.047, -0.24, 0.047, 1.3, 'fine');
      jointPlate(0.16, collector - 0.04);
      callout('Public roof deck', -2.25, 0.56, -0.87, 0.045);
      callout('Below-deck return to collector', -2.25, -1.07, -0.69, collector);
      callout('Outboard head frame', 2.25, 0.96, 1.37, 0.61);
      callout('Stiffened perimeter root', 2.25, -1.1, 0.29, collector - 0.1);
      return;
    }
    const box = structure === 'box-floor';
    deckRail(0.07, -0.1, 1.51, box ? DOCK_STRUCTURES[structure].depth : chordDepth);
    jointPlate(0.04, -0.25, box ? 0.42 : 0.37);
    if (structure === 'side-truss' || structure === 'side-portal') {
      const { outline, plate, line } = fittingPen(pen);
      plate(0.09, -0.07, 0.15, 1.05);
      deckRail(0.24, 0.89, 1.21, 0.21);
      if (structure === 'side-truss') {
        outline([
          [0.265, 0.69],
          [0.36, 0.82],
          [1.39, -0.02],
          [1.28, -0.14]
        ]);
        line(0.31, 0.75, 1.33, -0.08, 'fine');
      } else plate(1.23, -0.1, 0.17, 0.78);
      callout('Upper chord return to frame', 2.25, 1.11, 0.36, 0.8);
    } else {
      callout(
        box ? 'A  Full-depth end plate' : 'A  Deck restraint at ring',
        2.25,
        0.58,
        0.07,
        -0.2
      );
    }
    callout('Ring edge girder', -2.25, 0.55, -0.21, -slab - 0.075);
    callout('Radial collector into core', -2.25, -1.11, -0.76, -slab - 0.15);
    callout('Dock rail continues to tip', 2.25, -1.08, 1.43, -0.2);
    return;
  }

  if (structure === 'cable-stayed') {
    const { beamDepth, face, pinReach, plateThickness, flangeThickness } = demand.stay,
      perimeter = stayPerimeterFaces(model, MODULE.width / 2 + 0.14),
      pinY = -slab - beamDepth / 2,
      bottom = -slab - beamDepth,
      behind = face - plateThickness,
      front = face + plateThickness,
      angle = -Math.atan(demand.slope),
      stayY = (x) => pinY - (x - pinReach) * demand.slope,
      { plate, outline } = fittingPen(pen);
    cut(-1.58, 0, 1.58, slab, 'concrete');
    // The stay receiver meets the perimeter ring. The shared radial collector
    // is projected on the inboard side of the ring to show the continuing load path.
    for (const [start, end] of [
      [-1.58, perimeter.inner],
      [perimeter.outer, behind]
    ]) {
      cut(start, -slab, end - start, beamDepth, 'steel');
      for (const y of [bottom, -slab - flangeThickness])
        plate(start, y, end - start, flangeThickness);
    }
    cut(perimeter.inner, -slab, perimeter.outer - perimeter.inner, beamDepth, 'steel');
    plate(perimeter.inner + 0.03, bottom + flangeThickness, 0.04, beamDepth - 2 * flangeThickness);
    plate(behind, bottom, plateThickness, beamDepth);
    plate(face, bottom, plateThickness, beamDepth);
    for (const row of stayBoltRows) {
      const bolt = fittingPen(pen, face, pinY + row * beamDepth);
      bolt.plate(-0.048, -0.012, 0.096, 0.024, 'fine');
      bolt.nut(-0.062, -0.038, 0.022);
      bolt.nut(0.035, 0.059, 0.022);
    }
    outline([
      [front, pinY - 0.28 * beamDepth],
      [pinReach + 0.054, pinY - 0.049],
      [pinReach + 0.054, pinY + 0.049],
      [front, pinY + 0.28 * beamDepth]
    ]);
    fittingPen(pen, pinReach, pinY, angle).plate(0.18, -0.04, 1.36, 0.08);
    cableFork(
      pen,
      pinReach + 0.167 * Math.cos(angle),
      pinY + 0.167 * Math.sin(angle),
      angle,
      false
    );
    stayTensioner(pen, 1.12, stayY(1.12), angle);
    callout('Shared radial collector (projected)', -2.25, 0.64, -1.19, pinY);
    callout(
      'Perimeter ring transfer',
      -2.25,
      -1.12,
      (perimeter.inner + perimeter.outer) / 2,
      pinY,
      1.22
    );
    callout(
      'B  Bolts through paired end plates',
      2.25,
      0.69,
      front + 0.019,
      pinY + 0.33 * beamDepth
    );
    callout('A  Retained fork pin', 2.25, 0.36, pinReach, pinY, 0.74);
    callout('Tensioner and locknuts', 2.25, -1.17, 1.12, stayY(1.12), 0.89);
    label(-1.18, 0.13, 'UPPER ANCHOR · SAME STOREY');
    return;
  }

  if (structure === 'roof-hung') {
    deckRail(-1.46, 0.59, 2.63, 0.34);
    const { plate } = fittingPen(pen, 0.77, 0.03);
    plate(-0.041, -1.1, 0.082, 1.8);
    rodHead(pen, 0.77, 0.6, Math.PI / 2);
    rodCoupler(pen, 0.77, -0.54, Math.PI / 2);
    callout('Outboard collector beam', -2.25, 0.98, -0.55, 0.43);
    callout('A  Stiffened plate, washer and locknuts', 2.25, 1.14, 0.77, 0.74);
    callout('B  Threaded rod coupler', 2.25, -0.43, 0.77, -0.58);
    callout('Rod continues down dock stack', 2.25, -1.19, 0.77, -1.0);
    return;
  }

  if (structure === 'columns') {
    deckRail(-1.4, 0.44, 2.72, 0.27);
    const { plate } = fittingPen(pen, 0.68, 0.12);
    plate(-0.14, -1.21, 0.28, 1.2);
    bearingSide(pen, true, 0.68, 0.13);
    callout('Dock deck rail', -2.25, 0.89, -0.44, 0.33);
    callout('A  Bearing and stiffened cap', 2.25, 0.82, 0.69, 0.16);
    callout('B  Post continues down to base', 2.25, -1.2, 0.68, -0.93);
    return;
  }

  if (structure === 'box-floor') {
    core();
    const depth = DOCK_STRUCTURES[structure].depth;
    deckRail(0.07, -0.12, 1.55, depth);
    jointPlate(0.046, -0.12 - depth / 2, depth);
    dim(1.72, -0.12 - depth, -0.12, '420 mm');
    callout('A  Full-depth end plate', -2.25, 0.55, 0.046, -0.21);
    callout('Closed torsion box', 2.25, 0.61, 1.32, -0.15);
    callout('B  Removable deck sits above', 2.25, -1.06, 1.39, -0.12);
    return;
  }

  const portal = structure === 'side-portal',
    { outline, plate, line: detailLine, bolt } = fittingPen(pen);
  core();
  plate(-0.02, -1.12, portal ? 0.26 : 0.2, 2.25);
  deckRail(0.2, 1.02, 1.43, portal ? 0.27 : 0.2);
  deckRail(0.2, -0.97, 1.43, portal ? 0.27 : 0.2);
  plate(1.42, -0.97, portal ? 0.21 : 0.12, 1.72);
  jointPlate(0.15, 0.92);
  if (portal) {
    plate(1.36, 0.67, 0.28, 0.07);
    detailLine(1.42, -0.91, 1.63, -0.91, 'fine');
  } else {
    outline([
      [0.3, 0.79],
      [0.4, 0.88],
      [1.46, -0.93],
      [1.33, -1.0]
    ]);
    outline([
      [0.25, 0.63],
      [0.25, 0.81],
      [0.54, 0.81],
      [0.64, 0.46],
      [0.52, 0.46]
    ]);
    for (const [x, y] of [
      [0.29, 0.72],
      [0.41, 0.73],
      [0.49, 0.65],
      [0.54, 0.54]
    ])
      bolt(x, y, 0.016);
  }
  callout(portal ? 'A  Moment end plate' : 'A  Chord end plate', -2.25, 1.29, 0.15, 0.97);
  callout(
    portal ? 'B  Rigid post junction' : 'B  Bolted web gusset',
    2.25,
    0.52,
    portal ? 1.51 : 0.49,
    portal ? 0.68 : 0.63
  );
  callout('Lower chord to permanent frame', 2.25, -1.24, 1.09, -1.1);
}

function fittingPanels(detail, structure, demand) {
  if (detail === 'services') return CONNECTION_FITTINGS.services;
  if (detail === 'root') {
    const collector = {
      'cable-stayed': ['Compression seat', 'Lower rail bearing · seat plate · welded stiffeners'],
      'roof-hung': ['Below-deck collector', 'Perimeter post · visible flange and stiffener welds'],
      columns: ['Inboard rail restraint', 'Seat plate · locating stop · welded stiffener']
    }[structure];
    if (collector)
      return [
        CONNECTION_FITTINGS['side-truss'][0],
        {
          title: collector[0],
          note: collector[1],
          draw: structure === 'roof-hung' ? (pen) => gussetFace(pen, true) : bearingSide,
          scale: 15
        }
      ];
  }
  if (structure === 'cable-stayed')
    return [
      CONNECTION_FITTINGS[structure][0],
      {
        title: 'Bolted collector face',
        note: 'Looking inboard · bolt layout schematic',
        draw: (pen) => stayCollectorFace(pen, demand.stay),
        scale: demand.stay.beamDepth <= 0.56 ? 20 : 25
      }
    ];
  return CONNECTION_FITTINGS[structure];
}

// All fitting strokes stay editable in SVG. Paper fills mask overlapping silhouettes.
function svgConnectionPen(group, { origin, scale, ink, paper, thin, thick, emit }) {
  const px = (x) => origin[0] + x * scale,
    py = (y) => origin[1] - y * scale;
  const weight = (style) =>
    style === 'heavy' ? thick : style === 'outline' ? (thin + thick) / 2 : thin;
  return {
    px,
    py,
    line(x1, y1, x2, y2, style) {
      emit(group, 'line', {
        x1: px(x1),
        y1: py(y1),
        x2: px(x2),
        y2: py(y2),
        stroke: ink,
        'stroke-width': weight(style),
        opacity: style === 'faint' ? 0.5 : 1
      });
    },
    outline(points, style = 'outline') {
      emit(group, 'polygon', {
        points: points.map(([x, y]) => `${px(x)},${py(y)}`).join(' '),
        fill: paper,
        stroke: ink,
        'stroke-width': weight(style),
        'stroke-linejoin': 'round'
      });
    },
    pin(x, y, radius) {
      emit(group, 'circle', {
        cx: px(x),
        cy: py(y),
        r: radius * scale,
        fill: paper,
        stroke: ink,
        'stroke-width': thin
      });
    }
  };
}

function drawFittingPanels(group, panels, frame, style) {
  const { x, y, width, printScale } = frame,
    { ink, emit } = style,
    gutter = 16,
    panelWidth = (width - gutter) / 2;
  for (const [i, fitting] of panels.entries()) {
    const left = x + (panelWidth + gutter) * i,
      panel = emit(group, 'g', {
        'data-fitting': fitting.title,
        'font-family': 'system-ui, sans-serif',
        fill: ink
      }),
      denominator = fitting.scale ?? 10,
      scale = (DRAWING_PIXELS_PER_INCH * 1000) / (25.4 * denominator);
    emit(panel, 'rect', {
      x: left,
      y,
      width: panelWidth,
      height: 156,
      fill: 'none',
      stroke: ink,
      'stroke-opacity': 0.28,
      'stroke-width': 0.75
    });
    emit(
      panel,
      'text',
      { x: left + 10, y: y + 19, 'font-size': 12, 'font-weight': 630 },
      `${String.fromCharCode(65 + i)}  ${fitting.title}`
    );
    if (printScale)
      emit(
        panel,
        'text',
        { x: left + panelWidth - 10, y: y + 19, 'text-anchor': 'end', 'font-size': 10 },
        `1:${denominator}`
      );
    emit(panel, 'line', {
      x1: left + 10,
      y1: y + 24,
      x2: left + panelWidth - 10,
      y2: y + 24,
      stroke: ink,
      'stroke-opacity': 0.22
    });
    fitting.draw(
      svgConnectionPen(panel, { ...style, origin: [left + panelWidth / 2, y + 86], scale })
    );
    emit(panel, 'text', { x: left + 10, y: y + 149, 'font-size': 9.5 }, fitting.note);
  }
}
