"""Verify shared lobby routes, furnishings, sections and drawing sheets."""

from math import pi
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
    assert page.evaluate('''() => {
      const floor = {r: 12, R: 18, start: 0.4, end: 0.65};
      const mesh = meshBuilder();
      drawInteriorFloorPattern(mesh, floor, 0, [0.7, 0.7, 0.7], false);
      // Measure whole tiles from the generated joints on both sides of the curved floor.
      const courses = new Map();
      for (let i = 0; i < mesh.solid.length; i += 60) {
        const data = mesh.solid;
        const inner = Math.hypot(data[i], data[i + 2]);
        const outer = Math.hypot(data[i + 20], data[i + 22]);
        if (outer - inner < 0.4) continue;
        const radius = (inner + outer) / 2;
        const key = radius.toFixed(5);
        const angle = (Math.atan2(data[i + 2], data[i]) +
          Math.atan2(data[i + 12], data[i + 10])) / 2;
        if (!courses.has(key)) courses.set(key, []);
        courses.get(key).push(radius * (angle - floor.start));
      }
      const rows = [...courses.entries()].filter(([, joints]) => joints.length >= 2);
      const [inner, outer] = [rows[0], rows.at(-1)];
      if (!inner || !outer || rows.length < 10) return false;
      const [firstRadius, firstJoints] = inner;
      const [nextRadius, nextJoints] = rows[1];
      return Math.abs(nextRadius - firstRadius - 0.45) < 1e-5 &&
        Math.abs(firstJoints[0] - nextJoints[0] - 0.3) < 1e-5 &&
        [firstJoints, outer[1]].every(joints => Math.abs(joints[1] - joints[0] - 0.6) < 1e-5);
    }''')
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
        drawSharedLobby(mesh, hub, 0, state.seed);
        const rugBuffer = (mesh) => {
          const index = mesh.groups.findIndex(group => group.layer.endsWith('Shared_Rugs'));
          return mesh.solid.slice(mesh.groups[index].solid, mesh.groups[index+1].solid);
        };
        const rug = rugBuffer(mesh);
        const rugColors = rug.reduce((colors, _, i) => {
          if (i % 10 === 6) colors.add(rug.slice(i, i+3).join());
          return colors;
        }, new Set());
        const alternate = meshBuilder();
        drawSharedLobby(alternate, hub, 0, state.seed + 1);
        const { heading, axis, origin, passage, arch, tableRadius, couchDepth } = hub.layout;
        const alongLobby = (x, z) => (x - origin[0]) * axis[0] + (z - origin[1]) * axis[1];
        const acrossLobby = (x, z) => (x - origin[0]) * axis[1] - (z - origin[1]) * axis[0];
        const furnishings = mesh.solid.slice(rug.length);
        const tight = furnishings.some((x, i) => i % 10 === 0 && furnishings[i+1] < 1.9 &&
          Math.abs(acrossLobby(x, furnishings[i+2])) < passage / 2 - 0.001);
        const rugCoversAisle = rug.some((x, i) => i % 10 === 0 && rug[i+4] > 0.99 &&
          Math.hypot(x - origin[0], rug[i+2] - origin[1]) < 1e-6) &&
          rug.every((y, i) => i % 10 !== 1 || y < 0.03);
        const thresholds = mesh.groups.flatMap((group, i) =>
          group.layer.endsWith('Shared_Thresholds') ? [{
            name: group.name,
            vertices: mesh.solid.slice(group.solid, mesh.groups[i+1].solid)
          }] : []);
        const programmedThresholds = thresholds.length === 2 && thresholds.every(({name, vertices}, i) => {
          const { program, along } = hub.doors[i];
          const accent = rgb(PROGRAMS[program].color);
          return name.startsWith(PROGRAMS[program].name) &&
            vertices.some((x, j) => j % 10 === 0 && vertices[j+1] > 2.16 &&
              Math.abs(alongLobby(x, vertices[j+2]) - along) < 0.1 &&
              accent.every((channel, k) => vertices[j+6+k] === channel));
        });
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
        const publicApproaches = neighbors.filter(node => node.kind === 'corridor');
        const throughLobby = publicApproaches.length === 2 &&
          shortestPath(g, publicApproaches[0].id, publicApproaches[1].id, 'human');
        const shelfIndex = mesh.groups.findIndex(group => group.layer.endsWith('Shared_Shelving'));
        const shelving = mesh.solid.slice(mesh.groups[shelfIndex].solid, mesh.groups[shelfIndex+1].solid);
        const wood = rgb('#b18a64'), shelfTops = new Set(), wallSides = new Set();
        const hasColor = (hex) => {
          const color = rgb(hex);
          return shelving.some((_, i) =>
            i % 10 === 6 && color.every((component, offset) => shelving[i+offset] === component));
        };
        const stocked = hasColor('#b27765') && hasColor('#a87960') &&
          ['#bd985d', '#7f9c81', '#9a6a63', '#7b91a4'].some(hasColor);
        for (let i = 0; i < shelving.length; i += 10) {
          if (!wood.every((color, j) => shelving[i+6+j] === color)) continue;
          const x = shelving[i], z = shelving[i+2];
          if (shelving[i+1] >= 0.97) shelfTops.add(shelving[i+1]);
          if (Math.abs(alongLobby(x, z)) < arch - 0.2 && !sharedLobbyContains(hub, x, z, 0.05))
            wallSides.add(Math.sign(acrossLobby(x, z)));
        }
        const planting = (mesh) => mesh.solid.slice(
          mesh.groups.find(group => group.layer.endsWith('Shared_Planting')).solid);
        const plants = planting(mesh), tops = [0, 0, 0, 0];
        let foliageClear = true;
        for (let i = 0; i < plants.length; i += 10) {
          const x = plants[i], z = plants[i+2],
            across = acrossLobby(x, z), along = alongLobby(x, z),
            side = (along > 0 ? 2 : 0) + (across > 0 ? 1 : 0);
          tops[side] = Math.max(tops[side], plants[i+1]);
          foliageClear &&= Math.abs(across) >= passage / 2;
        }
        const plantedWithSeed = (seed) => {
          const replay = meshBuilder();
          drawSharedLobby(replay, hub, 0, seed);
          return planting(replay).join();
        };
        return {
          cleared: !tight && !outside && Math.abs(passage - model.circulation.width * 0.8) < 1e-8,
          rotated: Math.abs(axis[0] * Math.cos(heading) + axis[1] * Math.sin(heading)) > 0.05,
          scale: couchDepth === 0.88 && 2*tableRadius >= 1.8 && arch > tableRadius,
          route: route?.length === 2 && route[0].to === n.id && rooms.every(room => g.edges[room.id].length === 1),
          public: throughLobby?.length === 2 && throughLobby[0].to === n.id &&
            g.edges[n.id].filter(edge => g.nodes[edge.to].kind === 'corridor').every(edge =>
              edge.path.slice(0, 3).every(([x, , z]) => Math.abs(acrossLobby(x, z)) < 1e-6) &&
              Math.abs(alongLobby(edge.path[2][0], edge.path[2][2])) > arch),
          wallFitted: wallSides.size === 2,
          varyingShelves: shelfTops.size >= 8 &&
            Math.max(...shelfTops) >= 1.91 && Math.max(...shelfTops) <= 2.22 &&
            [...shelfTops].some(top => top >= 0.98 && top <= 1.29 &&
              [1, 2, 3].every(tier => [...shelfTops].some(upper => Math.abs(upper - top - tier * 0.31) < 1e-8))) &&
            shelving.some((height, i) => i % 10 === 1 && Math.abs(height - 0.52) < 1e-8) &&
            shelving.some((color, i) => i % 10 === 6 && color === rgb('#9e7956')[0]),
          stocked,
          rugs: rugCoversAisle && rugColors.size >= 3 && !rugColors.has(rgb('#5e8c80').join()) &&
            rug.join() !== rugBuffer(alternate).join(),
          programmedThresholds,
          plants: foliageClear && tops.every(height => height >= 2.2 && height < 2.76) &&
            new Set(tops).size === 4 && plantedWithSeed(state.seed) === plants.join() &&
            plantedWithSeed(state.seed + 1) !== plants.join()
        };
      });
      const build = buildAssemblyMesh(model, {walls:true, slabs:true, slabThickness: state.slabThickness}, 0,
        {assignments:{}, view:state, programColors: true});
      const accounted = model.core.reduce((sum, area) => sum + area, 0) + model.count * MODULE.area +
        model.lobby.area + model.circulation.total + model.retail + model.roofPlan.area;
      return { recovered, checks: geometryChecks, accounted: Math.abs(model.total - accounted) < 1e-5,
        minimums: model.rooms.every(r => r.area >= state.minRoomArea - 1e-6),
        integrated: !model.circulation.regions.some(q => q.kind === 'lobbyDivider') &&
          model.rooms.filter(r => r.lobbyShoulder && r.facadeFacing && r.R === model.R).length === hubs.length &&
          model.circulation.regions.filter(q => q.kind === 'lobbyShoulder').length === hubs.length,
        furnishedInBuild: build.groups.filter(group => group.layer.endsWith('Shared_Planting')).length === hubs.length &&
          !build.groups.some(group => /Shared_Lobby_(Divider|Screen)$/.test(group.layer)) &&
          build.groups.filter(group => group.layer.endsWith('Shared_Lobby_Approach')).length === 3 * hubs.length &&
          build.groups.filter(group => group.layer.endsWith('Shared_Shelving'))
            .every(group => build.textureStrokes.has(group.lines)) };
    }''')
    assert result['recovered'] and result['checks'] and result['accounted'] and result['minimums'] and result['integrated'] and result['furnishedInBuild'], result
    assert all(all(check.values()) for check in result['checks']), result

    assert page.evaluate('''() => {
      const previous = state;
      try {
        // These small programmes previously missed one another or ran out of fit space.
        return [[607, '1-3', 0], [609, '3-4', 2]].every(([seed, pair, allowance]) => {
          state = { ...defaults(), seed, relations: { [pair]: 'attract' } };
          const layout = derive();
          const graph = buildNavigation(layout);
          const hub = graph.nodes.find(node => node.cell?.pair?.join('-') === pair ||
            node.cell?.pair?.slice().reverse().join('-') === pair);
          const counted = layout.core.reduce((sum, area) => sum + area, 0) +
            layout.count * MODULE.area + layout.lobby.area + layout.circulation.total +
            layout.retail + layout.roofPlan.area;
          return hub && graph.reachable.has(hub.id) && layout.count >= 110 - allowance &&
            Math.abs(layout.total - counted) < 1e-5 && layout.total <= state.areaCap + 1e-6 &&
            layout.rooms.every(room => room.area >= state.minRoomArea - 1e-6);
        });
      } finally {
        state = previous;
      }
    }''')

    assert page.evaluate('''() => {
      // Overlapping triangles swap depth across their area. A centroid sort cannot depict this.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext('2d');
      paintSoftwareWithDepth(ctx, [
        { pts: [[0,0,0], [8,0,4], [0,8,0]], fill: [255,0,0], alpha: 1 },
        { pts: [[0,0,2], [8,0,2], [0,8,2]], fill: [0,0,255], alpha: 1 }
      ], 8, 8, 1, () => {});
      return ctx.getImageData(1,1,1,1).data[2] === 255 && ctx.getImageData(5,1,1,1).data[0] === 255;
    }''')

    assert page.evaluate('''() => {
      const previous = state;
      state = { ...defaults(), ringWidth: 22, areaCap: 42000, relations: {'0-1':'attract', '0-4':'attract'} };
      try {
        const wide = derive(), graph = buildNavigation(wide);
        const hubs = graph.nodes.filter(node => node.kind === 'hub');
        const availableDocks = wide.slots.filter(slot => !slot.blocked && (slot.p !== EMPTY || slot.use !== 'empty'));
        const accessibleDocks = graph.nodes.filter(node => node.slot != null && graph.reachable.has(node.id));
        return wide.circulation.dual && hubs.length > 0 && availableDocks.length === accessibleDocks.length &&
          hubs.every(hub => {
            const entrances = graph.edges[hub.id].filter(edge => graph.nodes[edge.to].kind === 'corridor');
            const { arch, axis, origin } = hub.cell.layout;
            return entrances.length === 4 && [-1, 1].every(side => {
              const align = ([x, , z]) => (x - origin[0]) * axis[0] + (z - origin[1]) * axis[1];
              const paths = entrances.filter(edge => Math.abs(align(edge.path[1]) - side * arch) < 1e-6);
              if (paths.length !== 2) return false;
              const [[x, , z], [otherX, , otherZ]] = paths.map(edge => edge.path[2]);
              const across = ((x + otherX) / 2 - origin[0]) * axis[1] -
                ((z + otherZ) / 2 - origin[1]) * axis[0];
              return Math.abs(across) < 1e-6;
            }) && [0, 2].every(i =>
              shortestPath(graph, entrances[i].to, entrances[i+1].to, 'human')[0].to === hub.id);
          });
      } finally {
        state = previous;
      }
    }''')

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

    page.locator('#openMassing').click()
    page.evaluate('''() => {
        state = { ...defaults(), seed: 607, relations: { '1-3': 'attract' }, simRunning: false };
        update();
    }''')
    page.locator('#openDrawings').click()
    expect(page.locator('#lobbyDrawingControls')).to_be_hidden()
    page.locator('#drawingDocument').select_option('lobbies')
    expect(page.locator('#lobbyDrawingControls')).to_be_visible()
    pages = page.locator('#documentPages .lobby-axo-page > svg')
    count = page.evaluate('model.circulation.hubs.length')
    expect(pages).to_have_count(2 * count)
    axo, plan = pages.nth(0), pages.nth(1)
    expect(axo).to_have_attribute('data-lobby-view', 'axo')
    expect(plan).to_have_attribute('data-lobby-view', 'plan')
    expect(axo).to_have_attribute('data-lobby-direction', 'S')
    expect(plan).to_have_attribute('data-lobby-direction', 'S')
    south_arrow = plan.locator('[data-local-south-arrow] > g')
    expect(south_arrow).to_have_count(1)
    south_rotation = south_arrow.get_attribute('transform')
    expect(plan.locator('[data-layer="Programme labels"]')).to_contain_text('Corridor')
    azimuth = float(plan.get_attribute('data-lobby-azimuth'))
    page.locator('#drawingLobbyDirection').select_option('compass')
    page.get_by_role('button', name='Lobby view from east').click()
    expect(axo).to_have_attribute('data-lobby-direction', 'E')
    expect(plan).to_have_attribute('data-lobby-direction', 'E')
    expect(south_arrow).not_to_have_attribute('transform', south_rotation)
    assert abs(float(plan.get_attribute('data-lobby-azimuth')) - azimuth + pi / 2) < 1e-8
    page.locator('#drawingLobbyContext').uncheck()
    expect(plan.locator('[data-layer="Programme labels"]')).to_have_count(0)
    page.locator('#drawingLobbyContext').check()
    page.locator('#drawingLobbyPaper').select_option('tabloid')
    expect(plan).to_have_attribute('width', '17in')
    ratio = plan.locator('[data-scale-ratio]')
    denominator = int(ratio.get_attribute('data-scale-ratio'))
    assert denominator in (25, 50, 100, 200, 250)
    expect(ratio).to_have_text(f'1:{denominator}')
    with page.expect_download() as drawing:
        page.get_by_role('button', name='Export lobby 1 plan as SVG').click()
    exported = ET.parse(drawing.value.path()).getroot()
    assert exported.get('width') == '17in' and exported.get('height') == '11in'
    assert {layer.get('data-layer') for layer in exported} >= {'Colour fills', 'Programme labels', 'Title and scale'}
    assert not exported.findall('.//{*}image')
    page.evaluate('''() => {
        window.print = () => {
          window.printedLobbySheets = [...document.querySelectorAll('#floorPrintPages > svg')]
            .map(sheet => [sheet.getAttribute('width'), sheet.getAttribute('height')]);
        };
    }''')
    page.locator('#printDocument').click()
    page.wait_for_function('window.printedLobbySheets')
    assert page.evaluate('window.printedLobbySheets') == [['17in', '11in']] * (2 * count)
    page.reload()
    expect(page.locator('#drawingDocument')).to_have_value('lobbies')
    expect(page.get_by_role('button', name='Lobby view from east')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#drawingLobbyContext')).to_be_checked()
    page.locator('#drawingLobbyViews').select_option('plan')
    expect(pages).to_have_count(count)
    assert not errors, errors
    print('Lobby routes, focused cuts, contextual lobby sheets, compass, PDF pages and SVG export passed.')
