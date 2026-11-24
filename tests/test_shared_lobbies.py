"""Verify the walk-through lobby, its furniture and the scaled section perspective."""

from pathlib import Path
import os
import shutil
import xml.etree.ElementTree as ET

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


root = Path(__file__).resolve().parents[1]
with serve_lab(root) as url, sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
        args=['--no-sandbox', '--disable-webgl'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/')
    result = page.evaluate('''() => {
      state = defaults();
      state.relations['0-4'] = 'attract';
      const recovered = derive().circulation.hubs.length;
      state.relations = {'0-1':'attract'};
      state.simRunning = state.animateSwing = false;
      update();
      const g = buildNavigation(model);
      const hubs = model.circulation.hubs;
      const geometryChecks = hubs.map(hub => {
        const mesh = meshBuilder();
        drawSharedLobby(mesh, hub, 0);
        const { heading, radius, passage, arch, tableRadius, couchDepth } = hub.layout;
        const clear = (x, z) => Math.abs(x * Math.cos(heading) + z * Math.sin(heading) - radius);
        const tight = mesh.solid.some((x, i) => i % 10 === 0 && mesh.solid[i+1] < 1.9 &&
          clear(x, mesh.solid[i+2]) < passage / 2 - 0.001);
        const outside = mesh.solid.some((x, i) => {
          if (i % 10 !== 0) return false;
          const z = mesh.solid[i+2], radial = Math.hypot(x,z);
          const a = heading + Math.atan2(Math.sin(Math.atan2(z,x)-heading), Math.cos(Math.atan2(z,x)-heading));
          return radial > hub.R + 0.01 || radial < hub.r - 0.01 || a < hub.start - 0.001 || a > hub.end + 0.001;
        });
        const n = g.nodes.find(node => node.cell?.lobbyId === hub.lobbyId);
        const neighbors = g.edges[n.id].map(e => g.nodes[e.to]);
        const rooms = neighbors.filter(node => node.kind === 'room');
        const route = rooms.length === 2 && shortestPath(g, rooms[0].id, rooms[1].id, 'human');
        const fromPublic = neighbors.find(node => node.kind === 'corridor');
        return {
          cleared: !tight && !outside && Math.abs(passage - model.circulation.width * 0.8) < 1e-8,
          scale: couchDepth === 0.88 && 2*tableRadius >= 1.8 && arch > tableRadius,
          route: route?.length === 2 && route[0].to === n.id && rooms.every(room => g.edges[room.id].length === 1),
          public: Boolean(fromPublic && shortestPath(g, fromPublic.id, rooms[0].id, 'human')),
          plants: mesh.groups.some(group => group.layer.endsWith('Shared_Thresholds'))
        };
      });
      const build = buildAssemblyMesh(model, {walls:true, slabs:true, slabThickness: state.slabThickness}, 0,
        {assignments:{}, view:state, programColors: true});
      return { recovered, checks: geometryChecks, minimums: model.rooms.every(r => r.area >= state.minRoomArea - 1e-6),
        furnishedInBuild: build.groups.filter(group => group.layer.endsWith('Shared_Thresholds')).length === hubs.length };
    }''')
    assert result['recovered'] and result['checks'] and result['minimums'] and result['furnishedInBuild'], result
    assert all(all(check.values()) for check in result['checks']), result

    page.locator('#openDrawings').click()
    lobby = page.locator('#drawingLobbyCut')
    expect(lobby).to_be_enabled()
    lobby.select_option(index=1)
    expect(page.locator('#drawingView')).to_have_value('aligned')
    expect(page.locator('#drawingPlaneOffset')).to_have_value('0')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    angle_check = page.evaluate('''() => {
      const saved = JSON.parse(localStorage.getItem('poly-nation-drawings-v1'));
      const cut = saved.planes.find(plane => plane.id === saved.selected);
      const hub = model.circulation.hubs[0];
      return Math.abs(Math.cos(cut.angle * Math.PI / 180 - hub.layout.heading)) < 1e-9 && cut.offset === 0;
    }''')
    assert angle_check

    sheet = page.locator('#drawingSheet')
    scale = sheet.locator('[data-scale-ratio]').text_content()
    at_cut = sheet.locator('#drawingSections').get_attribute('d')
    assert at_cut
    page.locator('#drawingSectionProjection').select_option('perspective')
    expect(sheet).to_have_attribute('data-section-lens', '35')
    lens = page.locator('#drawingSectionLensNumber')
    lens.fill('8')
    lens.press('Tab')
    expect(sheet).to_have_attribute('data-section-lens', '8')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    wide = sheet.locator('#drawingLinework').get_attribute('d')
    assert sheet.locator('#drawingSections').get_attribute('d') == at_cut
    lens.fill('200')
    lens.press('Tab')
    expect(sheet).to_have_attribute('data-section-lens', '200')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    assert sheet.locator('#drawingSections').get_attribute('d') == at_cut
    assert sheet.locator('#drawingLinework').get_attribute('d') != wide
    assert sheet.locator('[data-scale-ratio]').text_content() == scale

    assert page.evaluate('''() => {
      const slider = $('drawingSectionLens'), tick = $('drawingLensTicks').options[3];
      slider.dispatchEvent(new PointerEvent('pointerdown'));
      slider.value = Number(tick.value) + 9;
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
      return $('drawingSectionLensNumber').value === '24';
    }''')
    expect(sheet).to_have_attribute('data-section-lens', '24')
    page.locator('#drawingRendering').select_option('program')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    with page.expect_download() as result:
        page.locator('#exportDrawing').click()
    svg = ET.parse(result.value.path()).getroot()
    assert svg.get('data-section-lens') == '24'
    assert any(node.get('data-layer') == 'Colour fills' for node in svg)
    page.reload()
    expect(page.locator('#drawingsPhase')).to_be_visible()
    expect(lens).to_have_value('24')
    expect(sheet).to_have_attribute('data-section-lens', '24')
    assert not errors, errors
    print('Shared lobby generation, furniture clearance, forced routes, centred cuts, lens stops and scaled SVG passed.')
