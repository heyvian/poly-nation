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

    assert page.evaluate('''() => {
      // The cut through a ring must keep its opening, and an isolated sheet has no solid cap.
      const mesh = meshBuilder(), color = rgb('#b8a0ca');
      mesh.mark('Core_Test_Ring');
      mesh.sector(1, 3, 0, TAU, -1, 2, color);
      mesh.mark('Core_Test_Sheet');
      mesh.quad([5,-1,0], [7,-1,0], [7,1,0], [5,1,0], color);
      const frame = renderDrawing(drawingGeometry(mesh), { az: -Math.PI / 2, el: Math.PI / 2 },
        [{ normal: [0,1,0], offset: 0 }], { width: 11, height: 8.5 }, 100, false,
        { x: 0, y: 0 }, false, drawingPens(), { cutFill: true });
      const context = document.createElement('canvas').getContext('2d');
      const covered = (x, y) => frame.cutFills.some((d) => context.isPointInPath(new Path2D(d), x, y));
      return frame.cutFills.length === 1 && !covered(frame.originX, frame.originY) &&
        covered(frame.originX + 2*frame.scale, frame.originY);
    }''')

    # A point beyond the cut must stay centred even as its projected shape is enlarged.
    assert page.evaluate('''() => {
      const camera = { az: Math.PI / 2, el: 0 };
      const paper = { width: 11, height: 8.5 };
      const placement = { x: 0, y: 0, modelUnits: true };
      const points = [[-12,0,0], [12,8,0], [4,2,-6], [5,2,-6], [-600,-60,4], [600,60,4]];
      const geometry = { points, faces: [], edges: [], lines: [
        { a:0, b:1, component:'core' }, { a:2, b:3, component:'core' },
        { a:4, b:5, component:'core' }
      ] };
      const planes = [{ normal: [0,0,1], offset: 0, flip: false }];
      const lens = { cutDepth: 0, millimetres: 24, eyeLevel: 1.65 };
      const render = (scale, cut = planes, sectionLens = lens) => renderDrawing(
        geometry, camera, cut, paper, scale, false, placement, false, drawingPens(), { sectionLens }
      );
      const atDetail = (frame) => frame.optics.project([
        frame.originX + 4 * frame.scale, frame.originY - 2 * frame.scale, -6
      ]);
      const before = render('auto'), [x, y] = atDetail(before),
        midX = before.width / 2, midY = before.margin + before.drawingHeight / 2;
      if (before.cropped || before.denominator >= render('auto', [], null).denominator) return false;
      placement.x = (midX - x) / before.scale;
      placement.y = (midY - y) / before.scale;
      for (const scale of ['auto', '100', '500']) {
        const [x, y] = atDetail(render(scale));
        if (Math.hypot(x - midX, y - midY) > 1e-7) return false;
      }
      placement.y = 0;
      placement.ground = true;
      const a = render('100'), b = render('500');
      return a.grounded && Math.abs(a.originY - b.originY) < 1e-7;
    }''')

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
    fade = page.locator('#drawingPerspectiveFade')
    expect(fade).to_be_hidden()
    scale = sheet.locator('[data-scale-ratio]').text_content()
    at_cut = sheet.locator('#drawingSections').get_attribute('d')
    assert at_cut
    page.locator('#drawingSectionProjection').select_option('perspective')
    expect(sheet).to_have_attribute('data-section-lens', '35')
    receding = sheet.locator('[data-perspective-stroke]').first
    expect(receding).to_have_attribute('stroke-opacity', '0.45')
    width = receding.get_attribute('stroke-width')
    fade.fill('70')
    expect(receding).to_have_attribute('stroke-opacity', '0.3')
    expect(receding).to_have_attribute('stroke-width', width)
    assert sheet.locator('#drawingSections').get_attribute('stroke-opacity') is None
    assert sheet.locator('#drawingSections').get_attribute('d') == at_cut
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

    drawing_scale = page.locator('#drawingScale')
    drawing_scale.select_option('500')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    unpanned = sheet.locator('#drawingSections').get_attribute('d')
    sheet.press('Shift+ArrowLeft')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    panned = sheet.locator('#drawingSections').get_attribute('d')
    assert panned != unpanned
    drawing_scale.select_option('1000')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    drawing_scale.select_option('500')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    assert sheet.locator('#drawingSections').get_attribute('d') == panned
    page.locator('#centerDrawing').click()
    expect(page.locator('#exportDrawing')).to_be_enabled()
    expect(drawing_scale).to_have_value('500')
    assert sheet.locator('#drawingSections').get_attribute('d') == unpanned
    page.locator('#groundDrawing').click()
    expect(page.locator('#exportDrawing')).to_be_enabled()
    assert sheet.locator('#drawingSections').get_attribute('d') != unpanned
    page.locator('#fitDrawing').click()
    expect(page.locator('#exportDrawing')).to_be_enabled()
    expect(drawing_scale).to_have_value('auto')
    assert sheet.locator('#drawingSections').get_attribute('d') == at_cut

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
    receding_paths = [path for path in svg.iter() if 'data-perspective-stroke' in path.attrib]
    assert receding_paths and all(path.get('stroke-opacity') == '0.3' for path in receding_paths)
    page.reload()
    expect(page.locator('#drawingsPhase')).to_be_visible()
    expect(lens).to_have_value('24')
    expect(fade).to_have_value('70')
    expect(sheet).to_have_attribute('data-section-lens', '24')

    lobby_plan = page.locator('#drawingLobbyPlan')
    lobby_plan.select_option(index=1)
    expect(page.locator('#drawingPlaneAxis')).to_have_value('horizontal')
    expect(page.locator('#drawingPlaneOffset')).to_have_value('1.7')
    expect(page.locator('#drawingProjectionTitle')).to_have_text('Plan projection')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    expect(sheet.locator('[data-scale-ratio]')).to_have_text('1:100')
    expect(sheet.locator('[data-layer="Title and scale"]')).to_contain_text('Shared lobby plan')
    expect(page.locator('#drawingPlanes .drawing-plane-row')).to_have_count(1)
    expect(lobby).to_have_value('')
    expect(page.locator('#groundDrawing')).to_be_disabled()
    expect(fade).to_have_value('70')
    cap = sheet.locator('[data-layer="Cut fill"]')
    expect(cap).to_have_attribute('fill', '#000000')
    caps_at_cut = cap.inner_html()
    lens.fill('8')
    lens.press('Tab')
    expect(sheet).to_have_attribute('data-section-lens', '8')
    assert cap.inner_html() == caps_at_cut
    drawing_scale.select_option('100')
    sheet.press('Shift+ArrowRight')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    panned_caps = cap.inner_html()
    assert panned_caps != caps_at_cut
    drawing_scale.select_option('50')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    drawing_scale.select_option('100')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    assert cap.inner_html() == panned_caps
    page.locator('#centerDrawing').click()
    expect(page.locator('#exportDrawing')).to_be_enabled()
    assert cap.inner_html() == caps_at_cut
    page.locator('#drawingCutFill').uncheck()
    expect(cap).to_have_count(0)
    page.locator('#drawingCutFill').check()
    expect(cap).to_have_attribute('fill', '#000000')
    with page.expect_download() as result:
        page.locator('#exportDrawing').click()
    assert 'lobby-plan' in result.value.suggested_filename
    plan_svg = ET.parse(result.value.path()).getroot()
    fill = next(node for node in plan_svg if node.get('data-layer') == 'Cut fill')
    assert fill.get('fill') == '#000000' and fill.find('.//{*}path').get('fill-rule') == 'nonzero'
    page.locator('#drawingPlaneOffset').fill('1.9')
    page.locator('#drawingPlaneOffset').press('Tab')
    expect(lobby_plan).not_to_have_value('')
    page.reload()
    expect(lobby_plan).not_to_have_value('')
    expect(page.locator('#drawingPlaneOffset')).to_have_value('1.9')
    lobby.select_option(index=1)
    expect(page.locator('#drawingPlaneAxis')).to_have_value('vertical')
    expect(page.locator('#drawingPlanes .drawing-plane-row')).to_have_count(1)
    expect(lobby_plan).to_have_value('')
    assert not errors, errors
    print('Lobby routes, focused plans and sections, perspective, cut fills, and SVG export passed.')
