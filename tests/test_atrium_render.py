"""Check public stair links, lobby fit-out and the independent lighting workspace."""

from pathlib import Path
import os
import shutil

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


root = Path(__file__).resolve().parents[1]
with serve_lab(root) as url, sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
        args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    )
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    result = page.evaluate('''() => {
      state = defaults();
      state.atriumBridges = 'aligned';
      state.relations['0-1'] = 'attract';
      state.simRunning = state.animateSwing = false;
      update();
      const { stairs, bridges, landingLounges } = model.circulation;
      const { edges, nodes, reachable } = buildNavigation(model);
      const lifts = new Set(nodes.filter(n => n.kind === 'lift').map(n => n.f));
      const stairRoutes = edges.flatMap((choices, from) =>
        choices.filter(e => e.kind === 'stairs' && nodes[from].f - nodes[e.to].f === 1)
          .map(e => reachable.has(from) && reachable.has(e.to)));
      const assembly = buildAssemblyMesh(model, {slabs: true}, 0, {assignments: {}, view: state});
      const hasLayer = suffix => assembly.groups.some((group, index) =>
        group.layer.includes(suffix) && (assembly.groups[index + 1]?.solid ?? assembly.solid.length) > group.solid);
      return {
        accounted: model.total <= state.areaCap && model.circulation.stairArea > 0,
        stairs: stairs.length === bridges.length && stairRoutes.length === stairs.length && stairRoutes.every(Boolean),
        separated: stairs.some((s, i) => i > 0 && angDist(s.top, stairs[i - 1].top) > Math.PI / 2),
        clear: stairs.every(s => s.going >= 0.28 && s.going < 0.43 && modelFloorPitch(model) / s.risers < 0.18),
        stepFree: bridges.every(bridge => lifts.has(bridge.f)),
        lounges: new Set(landingLounges.map(l => l.type)).size === 2 &&
          nodes.filter(n => n.kind === 'landingLounge' && reachable.has(n.id)).length === landingLounges.length,
        furniture: ['_Shared_Nook_Benches', '_Shared_Lattice_Canopy', 'Assembly_Atrium_Bearings',
          'Infinite_Rinse_Perimeter_Walk'].every(hasLayer)
      };
    }''')
    assert all(result.values()), result

    expect(page.locator('#openBuild + span + button')).to_have_text('Render')
    page.evaluate('window.designBeforeRender = model')
    page.locator('#openRender').click()
    expect(page.locator('#renderPhase')).to_be_visible()
    expect(page.locator('#buildPhase')).to_be_hidden()
    page.locator('#renderModules').uncheck()
    page.locator('#renderLevel').select_option('3')
    page.locator('#renderPlan').click()
    canvas = page.locator('#renderCanvas')
    day = canvas.screenshot()
    page.locator('#renderDaylight').fill('0')
    page.locator('#renderInterior').fill('0')
    lights_off = canvas.screenshot()
    page.locator('#renderInterior').fill('100')
    lights_on = canvas.screenshot()
    assert day != lights_off and lights_on != lights_off
    assert page.evaluate('model === window.designBeforeRender'), 'Render must preserve the working design'
    page.reload()
    expect(page.locator('#openRender')).to_have_attribute('aria-current', 'page')
    expect(canvas).to_be_visible()
    assert not errors, errors
    browser.close()
    print('Atrium stair fit, bridge bearings, landing lounges and independent lighting passed.')
