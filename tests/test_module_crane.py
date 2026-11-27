"""Check cassette transfer, both outboard supports, and the shared steel finish."""

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
      const m = model, elevated = m.crane, moat = planModuleCrane(m, 'moat'),
        slot = m.slots.find(s => s.f === 0 && craneDockClear(m, elevated, s) &&
          m.slots.some(a => a.j === s.j && a.f === s.f + 1 && a.p !== EMPTY && !a.blocked)),
        settings = { craneFloor: 1, craneBearing: slot.angle * 180 / Math.PI },
        hoist = moduleCranePose(m, elevated, { ...settings, craneStage: 'hoist' }),
        set = moduleCranePose(m, elevated, { ...settings, craneStage: 'transfer' }),
        feed = moduleCranePose(m, elevated, { ...settings, craneStage: 'insert' }),
        load = craneLoadStudy(m, elevated),
        closed = meshBuilder(), open = meshBuilder(), lifting = meshBuilder(), released = meshBuilder(),
        axis = moat.gateAngles[0], paint = rgb('#987469'),
        stage = (b, a) => drawCraneInfrastructure(b, m, moat, paint, true, Infinity, { angle: a });
      stage(closed, axis + Math.PI / 2);
      stage(open, axis);
      drawCraneGantry(lifting, elevated, hoist, paint);
      drawCraneGantry(released, elevated, set, paint);
      const layerData = (b, layer) => {
        const i = b.groups.findIndex(group => group.layer === layer);
        return b.solid.slice(b.groups[i].solid, b.groups[i + 1].solid);
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
      const spanClear = elevated.roofOuter > elevated.roofInner && elevated.groundRail - 1.28 > 4;
      const floorRoom = buildStorey(m, 1).base - MODULE_CASSETTE_DEPTH - DOCK_STRUCTURES['box-floor'].depth;
      return {
        spanClear,
        tiedAcrossOpenings: [elevated, moat].every(crane => crane.roofTies.length > crane.supports.length &&
          crane.supports.every(angle => crane.roofTies.includes(angle)) &&
          crane.roofTies.every((angle, i, ties) => mod(ties[(i + 1) % ties.length] - angle, TAU) <= 2 * TAU / m.slotN + 1e-6)) &&
          layerData(open, 'Crane_Roof_Ties').length === 360 * moat.roofTies.length,
        selection: [hoist, set, feed].every(pose => pose.slot.i === slot.i),
        tipClearance: hoist.payloadStart >= elevated.dockTip + 2.75 && hoist.onHook && !hoist.onCradle,
        underAnOccupiedBay: feed.payloadStart < elevated.dockTip && feed.payloadY + MODULE.height < floorRoom,
        released: !set.onHook && set.onCradle && !feed.onHook && feed.onCradle,
        chassisFit: close(2 * pickupOffset, 10.8) && close(2 * jawHalfWidth - 0.18, 5.16) && sockets.length === 4 &&
          sockets.every(([x, y, z, width, height, length]) => close(y + height / 2, hoist.payloadY + pinHeight) &&
            pinVertices.some(([u, v, w]) => Math.abs((u - x) * c + (w - z) * s) < length / 2 &&
              Math.abs(-(u - x) * s + (w - z) * c) < width / 2 && v > y && v < y + height)),
        jawsRetract: stowed.length > 0 && Math.min(...stowed) > set.payloadY + MODULE.height,
        equilibrium: load.span > 35 && Math.abs(load.rim + load.outer - load.load - load.span * load.bridgeWeight) < 1e-6,
        moat: moat.groundRail < 0 && bridgePeak(open, 1) > 7 && bridgePeak(open, 2) < 2 && bridgePeak(closed, 1) < 2,
        interlock: barrierLift(moat, axis, axis + 18 / moat.tower) === 0 && gateLift(moat, axis, axis) === Math.PI / 2
      };
    }''')
    assert all(result.values()), result

    page.locator('#craneRunway').select_option('moat')
    page.wait_for_function('!pending && model.crane.runway === "moat"')
    assert page.evaluate('JSON.stringify([model.total, model.rooms, model.slots])') == before
    assert page.evaluate('gpu.mesh.groups.filter(group => /^Crane_Drawbridge_[12]$/.test(group.layer)).length') == 2
    page.locator('#craneStage').select_option('travel')
    page.wait_for_function('craneAnimation.angle > 0.02 && gpu.mesh.craneGateMotion.length === 2')
    assert page.evaluate("!gpu.mesh.groups.some(group => group.layer === 'Crane_Demonstration_Module')")
    assert not page.locator('#craneStage option[value="ride"]').count()
    assert page.evaluate("!gpu.mesh.groups.some(group => group.layer === 'Crane_Couch_Swings')")

    page.locator('#openMaterials').click()
    page.locator('#materialScope').select_option('mast')
    expect(page.locator('#structurePalette')).to_be_hidden()
    expect(page.locator('#cranePaintHex')).to_be_visible()
    page.locator('#cranePaintHex').fill('#976148')
    page.locator('#cranePaintHex').press('Tab')
    assert page.evaluate("cranePaint(materialWorkspace.assignments()) === '#976148'")
    assert page.evaluate("materialValues({mast:{structure:'concrete'}},'mast').structure === 'mast-steel-truss'")
    page.locator('#openBuild').click()
    page.locator('#buildCraneStudy summary').click()
    expect(page.locator('#buildCraneEstimate')).to_contain_text('recessed rail plinths')
    page.locator('#openDrawings').click()
    page.locator('#drawingCraneRunway').select_option('elevated')
    expect(page.locator('#exportDrawing')).to_be_enabled(timeout=20000)
    assert page.evaluate("model.crane.runway === 'moat'")
    assert page.evaluate('''() => {
      applySaved({ state: { ...state, craneStage: 'ride' }, camera });
      return state.craneStage === 'travel';
    }''')
    page.reload()
    expect(page.locator('#drawingCraneRunway')).to_have_value('elevated')
    page.locator('#openMassing').click()
    expect(page.locator('#craneRunway')).to_have_value('moat')
    assert not errors, errors
    expect(page.locator('#craneStage')).to_have_value('travel')
    print('Cassette pickup fit, roof ties, module transfer, runway variants, drawbridges, travel and drawing override passed.')
