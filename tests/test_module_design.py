"""Verify that varied modules use one dock interface and give Build real room layouts."""

import os
from pathlib import Path
import shutil

from playwright.sync_api import expect, sync_playwright
from browser_fixture import serve_lab


with serve_lab(Path(__file__).resolve().parents[1]) as url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
        args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    )
    page = browser.new_page(viewport={'width': 1360, 'height': 920})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    massing = page.evaluate('JSON.stringify([state.seed, model.total, model.slots])')
    page.locator('#openMaterials').click()
    page.locator('#uniqueModules').check()
    shades = page.get_by_role('checkbox', name='Window awnings and shades')
    skylights = page.get_by_role('checkbox', name='Skylights')
    expect(skylights).to_be_checked()
    shades.uncheck()
    expect(page.get_by_role('slider', name='Love hotel similarity')).to_have_value('40')
    daycare = page.get_by_role('slider', name='Daycare similarity')
    daycare.focus()
    daycare.press('End')
    expect(daycare).to_have_value('100')
    expect(page.locator('#moduleDesignArea')).to_contain_text('m² of terraces')
    page.locator('#openBuild').click()
    page.locator('#buildModuleRoofs').uncheck()
    page.locator('#buildFacade').check()
    page.reload()
    page.locator('#openMaterials').click()
    expect(page.locator('#uniqueModules')).to_be_checked()
    expect(shades).not_to_be_checked()
    shades.check()
    expect(daycare).to_have_value('100')
    page.locator('#openBuild').click()
    expect(page.locator('#buildFacade')).to_be_checked()
    expect(page.locator('#buildModuleRoofs')).not_to_be_checked()
    assert page.evaluate('JSON.stringify([state.seed, model.total, model.slots])') == massing
    results = page.evaluate('''() => {
      const assignments = materialWorkspace.assignments(), seed = state.seed,
        withFixture = {...model, slots: PROGRAMS.flatMap((_, p) => Array.from({length: 93}, (_, j) =>
          ({p, j, f: 0, i: p * 93 + j, angle: j * 0.1, use: 'empty', blocked: false})))},
        varied = {...assignments, moduleDesign: {enabled: true, similarity: {day: 0}}},
        plans = withFixture.slots.map((slot) => furnishedModulePlan(withFixture, slot, varied, seed)),
        daycare = withFixture.slots.filter(slot => P[slot.p].id === 'day'),
        shape = ({ kind, half, length, nose, variation }) => [kind, half, length, nose, variation],
        signature = plan => JSON.stringify([plan.values, shape(plan.form), plan.sideWindows, plan.palette]),
        shared = new Set(daycare.map(slot => signature(furnishedModulePlan(withFixture, slot, assignments, seed)))),
        mixed = new Set(daycare.map(slot => signature(furnishedModulePlan(withFixture, slot, varied, seed)))),
        study = (similarity) => daycare.map(slot => furnishedModulePlan(withFixture, slot,
          {...assignments, moduleDesign: {enabled: true, similarity: {day: similarity}}}, seed)),
        moderate = study(45), formLock = study(70), finishes = (collection) =>
          new Set(collection.map(plan => plan.values.facade)).size,
        forms = (collection) => new Set(collection.map(plan => JSON.stringify(shape(plan.form)))).size,
        exposure = realizedModuleEnclosure(model, assignments, seed),
        takeoff = estimateMaterialAssemblies(model, assignments, DEFAULT_MATERIAL_RATES),
        preview = {assignments, view: {seed}}, layers = buildViewLayers(),
        built = buildAssemblyMesh(model, layers, 1, preview),
        hidden = buildAssemblyMesh(model, {...layers, modules: false}, 1, preview),
        seatMesh = meshBuilder(), testSlot = {f: 0, j: 0, angle: 0}, storey = buildStorey(model, 0);
      drawDockFrame(seatMesh, model, testSlot, storey, 'Test_Seat', false, false, MODULE_CASSETTE_DEPTH);
      const transom = [];
      for (let i = 0; i < seatMesh.solid.length; i += 30) {
        const lateral = [2, 12, 22].map(offset => seatMesh.solid[i + offset]);
        if (Math.min(...lateral) < -1 && Math.max(...lateral) > 1)
          transom.push(...[1, 11, 21].map(offset => seatMesh.solid[i + offset]));
      }
      const roofPeaks = [];
      for (const type of MODULE_FORM_KINDS) {
        const index = plans.findIndex(plan => plan.roof === type);
        for (const enclosure of [true, false]) {
          const roofMesh = meshBuilder(), slot = {...withFixture.slots[index], angle: 0};
          drawFittedModule(roofMesh, slot, 0, 0, 0, {assignments: varied, view: {seed}},
            plans[index], {assembly: true, enclosure});
          const roof = roofMesh.groups.find(group => group.layer === 'Assembly_Module_Roof'),
            points = [];
          for (let i = roof.solid; i < roofMesh.solid.length; i += 10) {
            points.push(roofMesh.solid[i + 1]);
            if (Math.abs(roofMesh.solid[i + 2]) > MODULE.width / 2 + 1e-7) return {overhang: type};
          }
          roofPeaks.push(Math.max(...points));
        }
      }
      const upper = buildStorey(model, 1), boxFloor = meshBuilder();
      drawAlternativeDock(boxFloor, model, {...testSlot, f: 1}, upper, 'box-floor', MODULE_CASSETTE_DEPTH);
      // Measure the first solid, which is the box itself, independent of the core returns.
      const boxBottom = Math.min(...Array.from({length: 36}, (_, i) => boxFloor.solid[10 * i + 1]));
      const cabin = plans.find(plan => plan.form.kind === 'cabin'),
        glazed = plans.findIndex(plan => plan.skylight),
        glassRoof = meshBuilder(), sample = {...withFixture.slots[glazed], angle: 0};
      drawFittedModule(glassRoof, sample, 0, 0, 0, {assignments: varied, view: {seed}, finishJoints: true},
        plans[glazed], {assembly: true});
      const roofGlassStart = glassRoof.groups.find(group => group.layer === 'Assembly_Module_Roof').glass,
        sharedSaltboxes = withFixture.slots.filter(slot => P[slot.p].id === 'love').map(slot =>
          furnishedModulePlan(withFixture, slot, {...varied, moduleDesign: {enabled: true, similarity: {love: 100}}}, seed).form),
        roofHands = new Set(sharedSaltboxes.map(form => Math.sign(form.profile[0][1] - form.profile.at(-1)[1]))),
        muted = {...varied, moduleDesign: {...varied.moduleDesign, windowShades: false, skylights: false}},
        alternate = furnishedModulePlan(withFixture, sample, muted, seed),
        doors = new Set(plans.filter(plan => plan.endOpening.door).map(plan => plan.endOpening.doorStyle));
      return {
        roofFits: roofPeaks.every(height => height <= MODULE.height + 1e-7) &&
          boxBottom - storey.base - Math.max(...roofPeaks) >= 0.10 - 1e-6,
        lengths: [...new Set(plans.map(plan => plan.length))].sort((a, b) => a - b),
        families: new Set(plans.map(plan => plan.form.kind)).size,
        materialCount: finishes(plans),
        streams: plans.some(plan => plan.form.kind === 'streamliner' && plan.values.facade === 'trailer-aluminum' &&
          moduleHalfAt(plan.form, plan.length) < plan.form.half - 0.35),
        proportional: forms(moderate) < daycare.length / 2 && forms(formLock) === 1 &&
          finishes(moderate) >= 10 && finishes(formLock) >= 10,
        lightweight: ['cedar', 'vinyl', 'stucco', 'painted-tin', 'trailer-aluminum', 'timber-cassettes', 'exposed-clt',
          'board-batten', 'larch-lap', 'reclaimed-boards', 'cedar-shingles', 'metal-shingles', 'tin-shingles'].every(key =>
          materialCompatible('facade', key, 'module') && plans.some(plan => plan.values.facade === key)),
        timberCabin: cabin.values.structure === 'stacked-timber' && cabin.values.facade === 'log-siding' &&
          plans.some(plan => plan.values.facade === 'exposed-clt' && plan.values.structure === 'clt'),
        mirroredRoofs: sharedSaltboxes.every(form => form.kind === 'saltbox') && roofHands.has(-1) && roofHands.has(1),
        roofLight: glassRoof.glass.length > roofGlassStart && glassRoof.glass.every(Number.isFinite),
        options: !alternate.skylight && !alternate.shade && signature(alternate) === signature(plans[glazed]) &&
          new Set(plans.map(plan => plan.shade)).size === 4,
        variedDoors: ['sliding', 'french', 'solid', 'half-glazed', 'hinged'].every(door => doors.has(door)),
        uses: [...new Set(plans.flatMap(plan => plan.zones.map(zone => zone.use)))],
        aligned: plans.every(plan => plan.doorWidth === plans[0].doorWidth && plan.doorHeight === plans[0].doorHeight),
        windowsFit: plans.every(plan => plan.sideWindows.every(windows => windows.every((window, i) =>
          window.width > 0 && window.center - window.width / 2 >= plan.wall &&
          window.center + window.width / 2 <= plan.length - plan.wall &&
          (!i || window.center - window.width / 2 > windows[i - 1].center + windows[i - 1].width / 2)))),
        shared: shared.size, mixed: mixed.size,
        measured: Math.abs(takeoff.studyTotal - model.total + exposure.unenclosed) < 1e-6 && exposure.unenclosed >= exposure.terraces,
        seated: Math.abs(Math.max(...transom) - storey.base + MODULE_CASSETTE_DEPTH) < 1e-6,
        mesh: ['Chassis', 'Skin', 'Dock_Collar', 'Interior_Partitions'].every(layer =>
          built.groups.some(group => group.layer === 'Assembly_Module_' + layer)),
        noRoofs: !built.groups.some(group => group.layer === 'Assembly_Module_Roof'),
        noModules: !hidden.groups.some(group => group.layer.startsWith('Assembly_Module_')),
        finite: built.solid.every(Number.isFinite) && built.glass.every(Number.isFinite)
      };
    }''')
    assert 'overhang' not in results, results
    assert results['lengths'] == [9, 13.5, 18], results
    assert results['families'] == 16 and results['materialCount'] >= 25, results
    assert {'bunk', 'office', 'crew', 'bed', 'bath', 'living', 'play', 'rinse'} <= set(results['uses']), results
    assert results['shared'] == 1 and results['mixed'] > 10, results
    for check in ['aligned', 'windowsFit', 'measured', 'streams', 'proportional', 'lightweight', 'seated', 'roofFits', 'mesh',
                  'noRoofs', 'noModules', 'finite', 'timberCabin', 'mirroredRoofs', 'roofLight', 'options', 'variedDoors']:
        assert results[check], results
    assert not errors, errors
    print('Module forms and claddings, roof handedness, skylights, shades, door diversity, envelope fit and restoration passed.')
