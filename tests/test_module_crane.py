"""Check crane positioning, cassette transfer and each of the three support studies."""

from pathlib import Path
import os
import shutil

from playwright.sync_api import expect, sync_playwright
from browser_fixture import serve_lab


with serve_lab(Path(__file__).resolve().parents[1]) as url, sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
        args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    )
    page = browser.new_page(viewport={'width': 1420, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    before = page.evaluate('JSON.stringify([model.total, model.rooms, model.slots])')
    page.locator('#moduleCraneControls summary').click()
    expect(page.locator('#craneRunway')).to_have_value('elevated')
    page.locator('#craneStage').select_option('insert')
    expect(page.locator('#craneStatus')).to_contain_text('Level 2')
    result = page.evaluate('''() => {
      const m = model, elevated = m.crane, moat = planModuleCrane(m, 'moat'), cantilever = planModuleCrane(m, 'cantilever'),
        slot = m.slots.find(s => s.f === 0 && craneDockClear(m, elevated, s) &&
          m.slots.some(a => a.j === s.j && a.f === s.f + 1 && a.p !== EMPTY && !a.blocked)),
        settings = { craneFloor: 1, craneBearing: slot.angle * 180 / Math.PI },
        hoist = moduleCranePose(m, elevated, { ...settings, craneStage: 'hoist' }),
        set = moduleCranePose(m, elevated, { ...settings, craneStage: 'transfer' }),
        feed = moduleCranePose(m, elevated, { ...settings, craneStage: 'insert' }),
        load = craneLoadStudy(m, elevated),
        roofLoad = craneLoadStudy(m, cantilever),
        closed = meshBuilder(), open = meshBuilder(), lifting = meshBuilder(), released = meshBuilder(),
        axis = moat.gateAngles[0], paint = rgb('#987469'),
        stage = (b, a) => drawCraneInfrastructure(b, m, moat, paint, true, Infinity, { angle: a });
      stage(closed, axis + Math.PI / 2);
      stage(open, axis);
      drawCraneGantry(lifting, elevated, hoist, paint);
      drawCraneGantry(released, elevated, set, paint);
      const layerData = (b, layer) => {
        const i = b.groups.findIndex(group => group.layer === layer);
        return b.solid.slice(b.groups[i].solid, b.groups[i + 1]?.solid ?? b.solid.length);
      };
      const jaws = (b) => layerData(b, 'Crane_Lifting_Jaws').filter((_, j) => j % 10 < 3),
        center = hoist.payloadStart + MODULE.depth / 2,
        c = Math.cos(slot.angle), s = Math.sin(slot.angle),
        { pickupOffset, jawHalfWidth, pinHeight } = craneCassetteRig(),
        sockets = [], pinVertices = [],
        close = (a, b) => Math.abs(a - b) < 1e-6;
      drawCraneLiftSockets({ box: (...args) => sockets.push(args) }, slot.angle, [center * c, hoist.payloadY, center * s]);
      const vertices = jaws(lifting);
      for (let i = 0; i < vertices.length; i += 3) {
        const [x, y, z] = vertices.slice(i, i + 3);
        if (y < hoist.payloadY && Math.abs(-x * s + z * c) < MODULE.width / 2)
          pinVertices.push([x, y, z]);
      }
      const stowed = jaws(released).filter((_, i) => i % 3 === 1);
      const bridgePeak = (b, number) => {
        const i = b.groups.findIndex(group => group.layer === `Crane_Drawbridge_${number}`);
        return Math.max(...b.solid.slice(b.groups[i].solid, b.groups[i + 1].solid).filter((_, j) => j % 10 === 1));
      };
      const feeding = meshBuilder();
      drawCraneGantry(feeding, elevated, feed, paint);
      const feedHeights = [0, 1].map((pair) => {
        const center = feed.payloadStart + MODULE.depth / 2;
        return jaws(feeding).filter((_, i, vertices) => i % 3 === 1 &&
          ((vertices[i - 1] * c + vertices[i + 1] * s > center) === Boolean(pair)));
      });
      const spanClear = elevated.roofOuter > elevated.roofInner && elevated.groundRail - 1.28 > 4;
      const floorRoom = buildStorey(m, 1).base - MODULE_CASSETTE_DEPTH - DOCK_STRUCTURES['box-floor'].depth;
      const bridgeDeck = layerData(closed, 'Crane_Drawbridge_1').slice(0, 360), lateral = [];
      for (let i = 0; i < bridgeDeck.length; i += 10)
        lateral.push(-bridgeDeck[i] * Math.sin(axis) + bridgeDeck[i + 2] * Math.cos(axis));
      const fixed = meshBuilder();
      drawCraneInfrastructure(fixed, m, cantilever, paint, true);
      const outsideAtrium = (vertices) => {
        for (let i = 0; i < vertices.length; i += 10) {
          if (!Number.isFinite(vertices[i]) || !Number.isFinite(vertices[i + 1]) || !Number.isFinite(vertices[i + 2]) ||
              Math.hypot(vertices[i], vertices[i + 2]) < cantilever.atriumClearRadius) return false;
        }
        return true;
      };
      const acrossRoof = [0, axis, axis + Math.PI / 3, m.circulation.bridgeAngle].every(angle => {
        const moving = meshBuilder();
        drawCraneGantry(moving, cantilever, { angle, stage: 'parked' }, paint);
        return outsideAtrium(moving.solid) && moving.solid.every((v, i) => i % 10 !== 1 || v > m.roofPlan.y);
      });
      const stair = m.circulation.bridgeAngle, yRoof = m.roofPlan.y,
        clearApproach = fixed.solid.every((x, i, vertices) => {
          if (i % 10 !== 0 || vertices[i + 1] < yRoof - 0.08 || vertices[i + 1] > yRoof + 2.45) return true;
          const z = vertices[i + 2], r = x * Math.cos(stair) + z * Math.sin(stair),
            t = z * Math.cos(stair) - x * Math.sin(stair);
          return r < m.r - 0.04 || r > m.R || Math.abs(t) > 1.12;
        }),
        rideEnvelope = Math.max(...Array.from({length: 273}, (_, i) => swingPose(m.feature.ride, i / 2).rad)) +
          Math.hypot(SWING_SEAT_WIDTH / 2, SWING_SEAT_DEPTH / 2) + 0.70;
      const atDistance = meters => axis + meters / (moat.tower - moat.moatHalf), full = moatLiftFullyOpenAt(moat);
      return {
        spanClear,
        tiedAcrossOpenings: [elevated, moat].every(crane => crane.roofTies.length > crane.supports.length &&
          crane.supports.every(angle => crane.roofTies.includes(angle)) &&
          crane.roofTies.every((angle, i, ties) => mod(ties[(i + 1) % ties.length] - angle, TAU) <= 2 * TAU / m.slotN + 1e-6)) &&
          layerData(open, 'Crane_Roof_Ties').length === 360 * moat.roofTies.length,
        selection: [hoist, set, feed].every(pose => pose.slot.i === slot.i),
        tipClearance: hoist.payloadStart >= elevated.dockTip + 2.75 && hoist.inboardHook && !hoist.onDock,
        underAnOccupiedBay: feed.payloadStart + MODULE.depth / 2 < elevated.dockTip && feed.payloadY + MODULE.height < floorRoom,
        handoff: set.onDock && set.inboardHook && feed.onDock && !feed.inboardHook &&
          set.payloadStart + MODULE.depth / 2 - pickupOffset > elevated.dockTip &&
          feed.payloadStart + MODULE.depth / 2 + pickupOffset > elevated.dockTip &&
          !released.groups.some(group => group.layer.includes('Transfer_Carriage')),
        chassisFit: close(2 * pickupOffset, 10.8) && close(2 * jawHalfWidth, 5.9) && sockets.length === 4 &&
          sockets.every(([x, y, z, width, height, length]) => close(y + height / 2, hoist.payloadY + pinHeight) &&
            pinVertices.some(([u, v, w]) => Math.abs((u - x) * c + (w - z) * s) < length / 2 &&
              Math.abs(-(u - x) * s + (w - z) * c) < width / 2 && v > y && v < y + height)),
        jawsRetract: stowed.length > 0 && Math.min(...stowed) < set.payloadY && feedHeights.every(heights => heights.length > 0) &&
          Math.min(...feedHeights[0]) > feed.payloadY + MODULE.height && Math.min(...feedHeights[1]) < feed.payloadY,
        equilibrium: load.span > 35 && Math.abs(load.rim + load.outer - load.load - load.span * load.bridgeWeight) < 1e-6,
        cantilever: cantilever.groundRail === null && roofLoad.inner < 0 && close(roofLoad.rim + roofLoad.inner,
          roofLoad.load + roofLoad.bridgeWeight * (roofLoad.span + roofLoad.backspan) + roofLoad.ballast) &&
          close((roofLoad.ballast + roofLoad.bridgeWeight * roofLoad.backspan / 2 - roofLoad.inner) * roofLoad.backspan, roofLoad.moment) &&
          ['Pile_Caps', 'Core_Frames', 'Hold_Down_Rail'].every(name => fixed.groups.some(g => g.layer === 'Crane_Cantilever_' + name)) &&
          !fixed.groups.some(g => /^Crane_(Elevated_Runway|Moat)/.test(g.layer)),
        rideClearance: acrossRoof && outsideAtrium(fixed.solid) && cantilever.atriumClearRadius >= rideEnvelope - 1e-5,
        stairAndRoofClearance: clearApproach && cantilever.supports.every(angle =>
          [cantilever.roofInner, cantilever.roofOuter].every(radius =>
            [...m.roofPlan.pavilions, ...m.roofPlan.lifts].every(zone => !craneTouchesZone(zone, radius, angle, 0.76)))) &&
          cantilever.roofRail - 2.05 - yRoof >= (m.roofPlan.pavilions.some(pavilion => pavilion.upper) ? 6.85 : 5.2),
        moat: moat.groundRail < 0 && bridgePeak(open, 1) > 7 && bridgePeak(open, 2) < 2 && bridgePeak(closed, 1) < 2,
        deckWidth: close(Math.max(...lateral) - Math.min(...lateral) - 0.32, 10),
        interlock: barrierLift(moat, axis, atDistance(full + 13)) === 0 && gateLift(moat, axis, atDistance(full + 13)) === 0 &&
          gateLift(moat, axis, atDistance(full + 7)) > 0 && close(gateLift(moat, axis, atDistance(full - 1)), Math.PI / 2) &&
          close(barrierLift(moat, axis, atDistance(full + 24)), Math.PI / 2)
      };
    }''')
    assert all(result.values()), result

    page.locator('#craneRunway').select_option('moat')
    page.wait_for_function('!pending && model.crane.runway === "moat"')
    assert page.evaluate('JSON.stringify([model.total, model.rooms, model.slots])') == before
    assert page.evaluate('gpu.mesh.groups.filter(group => /^Crane_Drawbridge_[12]$/.test(group.layer)).length') == 2
    waterfront = page.evaluate('''() => {
      const mesh = gpu.mesh, { crane, plaza } = model, { inner, outer } = craneMoatBounds(crane);
      const points = (match) => mesh.groups.flatMap((group, i) => {
        if (!match(group.layer)) return [];
        const vertices = mesh.solid.slice(group.solid, mesh.groups[i + 1]?.solid);
        return vertices.flatMap((x, j) => j % 10 === 0 ? [[Math.hypot(x, vertices[j + 2]), vertices[j + 1]]] : []);
      });
      const dry = points(layer => layer.includes('Plaza_') || layer === 'Opposite_Lobby_Promenade'),
        water = points(layer => layer === 'Crane_Moat_Water'), tracks = points(layer => layer === 'Crane_Moat_Runway'),
        surface = Math.max(...water.map(point => point[1]));
      const graph = buildNavigation(model);
      return {
        dry: dry.length > 0 && dry.every(([radius]) => radius <= inner + 1e-6) && plaza.outer <= inner,
        navigation: graph.nodes.filter(node => node.kind === 'plaza' || node.kind === 'entry')
          .every(({ p: [x, , z] }) => Math.hypot(x, z) < inner),
        water: Math.min(...water.map(point => point[0])) < crane.tower - crane.groundGauge / 2 &&
          Math.max(...water.map(point => point[0])) > crane.tower + crane.groundGauge / 2 && surface < crane.groundRail,
        railPiers: tracks.some(([, y]) => y < surface) && tracks.some(([, y]) => Math.abs(y - crane.groundRail) < 1e-6) &&
          outer - inner === 2 * crane.moatHalf
      };
    }''')
    assert all(waterfront.values()), waterfront
    page.locator('#craneStage').select_option('parked')
    page.evaluate('''() => {
      window.scrubMesh = gpu.mesh;
      const slider = document.getElementById('craneBearing');
      slider.value = craneDegrees(model.crane.gateAngles[0]);
      slider.dispatchEvent(new Event('input', {bubbles: true}));
    }''')
    expect(page.locator('#craneStatus')).to_contain_text('Drawbridge raised')
    assert page.evaluate('gpu.mesh === window.scrubMesh && gpu.mesh.craneGateMotion[0].rise === Math.PI / 2')
    page.locator('#craneBearingDegrees').fill('123')
    page.locator('#craneBearingDegrees').press('Tab')
    expect(page.locator('#craneBearing')).to_have_value('123')
    page.locator('#craneStage').select_option('travel')
    page.wait_for_function('craneAnimation.angle > 0.02 && gpu.mesh.craneGateMotion.length === 2')
    assert page.evaluate("!gpu.mesh.groups.some(group => group.layer === 'Crane_Demonstration_Module')")
    assert not page.locator('#craneStage option[value="ride"]').count()
    assert page.evaluate("!gpu.mesh.groups.some(group => group.layer === 'Crane_Couch_Swings')")
    page.locator('#parkCrane').click()
    expect(page.locator('#craneStage')).to_have_value('parked')
    page.locator('#craneRunway').select_option('cantilever')
    page.wait_for_function('!pending && model.crane?.runway === "cantilever"')
    assert page.evaluate("gpu.mesh.groups.some(group => group.layer === 'Crane_Cantilever_Hold_Down_Rail')")
    page.locator('#openBuild').click()
    page.locator('#buildCraneStudy summary').click()
    expect(page.locator('#buildCraneEstimate')).to_contain_text('Inner rail hold-down demand')
    page.locator('#openMassing').click()
    page.locator('#craneRunway').select_option('moat')
    page.wait_for_function('!pending && model.crane.runway === "moat"')
    page.locator('#craneStage').select_option('travel')

    page.locator('#openMaterials').click()
    page.locator('#materialScope').select_option('mast')
    expect(page.locator('#structurePalette')).to_be_hidden()
    expect(page.locator('#cranePaintHex')).to_be_visible()
    page.locator('#cranePaintHex').fill('#976148')
    page.locator('#cranePaintHex').press('Tab')
    assert page.evaluate("cranePaint(materialWorkspace.assignments()) === '#976148'")
    assert page.evaluate("materialValues({mast:{structure:'concrete'}},'mast').structure === 'mast-steel-truss'")
    page.locator('#openBuild').click()
    expect(page.locator('#buildCraneEstimate')).to_contain_text('raised rail beams and piers in the moat')
    page.locator('#openDrawings').click()
    page.locator('#drawingCraneRunway').select_option('cantilever')
    page.locator('#drawingCraneBearing').fill('231')
    page.locator('#drawingCraneBearing').press('Tab')
    expect(page.locator('#exportDrawing')).to_be_enabled(timeout=20000)
    assert page.evaluate("model.crane.runway === 'moat'")
    assert page.evaluate('''() => {
      applySaved({ state: { ...state, craneStage: 'ride' }, camera });
      return state.craneStage === 'travel';
    }''')
    page.reload()
    expect(page.locator('#drawingCraneRunway')).to_have_value('cantilever')
    expect(page.locator('#drawingCraneBearing')).to_have_value('231')
    page.locator('#openMassing').click()
    expect(page.locator('#craneRunway')).to_have_value('moat')
    expect(page.locator('#craneStage')).to_have_value('travel')
    page.locator('#openDrawings').click()
    page.locator('#drawingDocument').select_option('cranes')
    sheets = page.locator('#documentPages svg[data-crane-view]')
    expect(page.locator('#craneSetStatus')).to_have_text('8 sheets ready.', timeout=90000)
    assert sheets.evaluate_all("pages => pages.map(page => page.dataset.craneView)") == [
        'axo', 'elevation', 'axo', 'elevation', 'axo', 'elevation', 'installation', 'drawbridge'
    ]
    docking = page.locator('#documentPages svg[data-crane-view="installation"]')
    expect(docking).to_contain_text('Reeled up to trolley')
    expect(docking).to_contain_text('Still pinned to chassis')
    assert sheets.evaluate_all('''pages => pages.every(page => page.getAttribute('width') === '17in' &&
      page.getAttribute('height') === '11in' && !page.querySelector('image') && page.querySelector('[data-scale-ratio]'))''')
    page.evaluate('window.print = () => {}')
    page.locator('#printDocument').click()
    assert page.locator('#floorPrintPages > svg[data-crane-view]').count() == 8
    page.evaluate('window.dispatchEvent(new Event("afterprint"))')
    page.locator('#drawingCraneSetSupport').select_option('moat')
    expect(page.locator('#craneSetStatus')).to_have_text('4 sheets ready.', timeout=90000)
    assert sheets.evaluate_all("pages => pages.map(page => page.dataset.craneView)") == ['axo', 'elevation', 'installation', 'drawbridge']
    assert page.evaluate("model.crane.runway === 'moat'")
    assert not errors, errors
    print('Live crane positioning, 10 m interlocked bascules, cantilever clearance and reactions, cassette transfer and sheet overrides passed.')
