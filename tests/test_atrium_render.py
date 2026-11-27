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
      const { stairs, bridges, hubs } = model.circulation;
      const { edges, nodes, reachable } = buildNavigation(model);
      const lifts = new Set(nodes.filter(n => n.kind === 'lift').map(n => n.f));
      const stairRoutes = edges.flatMap((choices, from) =>
        choices.filter(e => e.kind === 'stairs' && nodes[from].f - nodes[e.to].f === 1)
          .map(e => reachable.has(from) && reachable.has(e.to)));
      const assembly = buildAssemblyMesh(model, {slabs: true}, 0, {assignments: {}, view: state});
      const hasLayer = suffix => assembly.groups.some((group, index) =>
        group.layer.includes(suffix) && (assembly.groups[index + 1]?.solid ?? assembly.solid.length) > group.solid);
      const junctionTypes = new Set();
      for (const [mode, seed] of [['off', 606], ['aligned', 607]]) {
        Object.assign(state, { atriumBridges: mode, seed });
        const alternative = derive();
        if (alternative.circulation.hubs.length >= 2)
          alternative.circulation.hubs.forEach(h => {
            if (h.access?.connected) junctionTypes.add(h.access.type);
          });
      }
      Object.assign(state, { atriumBridges: 'aligned', seed: 606 });
      const paperLamps = makeRenderLighting(model, state.seed).lamps.flat()
        .filter(lamp => lamp.fixture === 'paper');
      const benchFitsWalls = hubs.every(hub => {
        const mesh = meshBuilder();
        drawSharedLobby(mesh, hub, 0, state.seed, true);
        const benches = mesh.groups.flatMap((group, i) => group.name.startsWith('Wall-scribed bench') ?
          [mesh.solid.slice(group.solid, mesh.groups[i + 1].solid)] : []);
        return benches.length >= 1 && benches.every(vertices =>
          hub.layout.roomWalls.some(({ angle, r, R }) =>
            vertices.some((x, i) => {
              if (i % 10 !== 0) return false;
              const z = vertices[i + 2], radius = x * Math.cos(angle) + z * Math.sin(angle);
              return Math.abs(vertices[i + 1] - 0.4) < 1e-6 &&
                Math.abs(z * Math.cos(angle) - x * Math.sin(angle)) < 0.075 &&
                radius >= r && radius <= R;
            })
          )
        );
      });
      const canopyFollowsCabinets = hubs.some(hub => {
        const mesh = meshBuilder();
        drawSharedLobby(mesh, hub, 0, state.seed, true);
        const i = mesh.groups.findIndex(g => g.layer.endsWith('_Shared_Lattice_Canopy'));
        if (i < 0) return false;
        const vertices = mesh.solid.slice(mesh.groups[i].solid, mesh.groups[i + 1].solid);
        const lampIndex = mesh.groups.findIndex(g => g.layer.endsWith('_Shared_Paper_Pendant'));
        const paper = mesh.solid.slice(mesh.groups[lampIndex].solid, mesh.groups[lampIndex + 1].solid);
        const { center: [x, , z] } = lobbyCanopyPattern(hub, state.seed);
        const fixtureFits = paper.length > 360 && paper.every((height, k) => k % 10 !== 1 || height > 2.5) &&
          paperLamps.some(lamp => Math.hypot(lamp.x - x, lamp.z - z) < 1e-6);
        const { axis, origin, passage, couchOuter } = hub.layout;
        const locations = [];
        for (let j = 0; j < vertices.length; j += 10) {
          const x = vertices[j] - origin[0], z = vertices[j+2] - origin[1];
          locations.push({ along: x*axis[0] + z*axis[1], across: x*axis[1] - z*axis[0], y: vertices[j+1] });
        }
        const sign = Math.sign(locations[0].across);
        const support = mesh.groups.findIndex(g => g.layer.endsWith('_Shared_Lattice_Intermediate_Supports'));
        const uprights = mesh.solid.slice(mesh.groups[support].solid, mesh.groups[support + 1].solid);
        // The two added uprights stand on taller cabinet tops, leaving the low reading seats open.
        return fixtureFits && vertices.length > 650 * 360 &&
          uprights.length === 2 * 360 && uprights.every((value, k) => k % 10 !== 1 || value > 0.95) &&
          locations.every(p => sign*p.across >= passage/2 - 0.05 && p.y < 3.72 && p.y > 0.32) &&
          locations.some(p => p.y > 3.3 && Math.abs(p.along) < 0.06) &&
          locations.filter(p => p.y < 1.8).every(p =>
            Math.abs(Math.hypot(p.along, Math.abs(p.across)-passage/2) - couchOuter - 0.123) < 0.04);
      });
      return {
        accounted: model.total <= state.areaCap && model.circulation.stairArea > 0,
        stairs: stairs.length === bridges.length && stairRoutes.length === stairs.length && stairRoutes.every(Boolean),
        separated: stairs.some((s, i) => i > 0 && angDist(s.top, stairs[i - 1].top) > Math.PI / 2),
        clear: stairs.every(s => s.going >= 0.28 && s.going < 0.43 && modelFloorPitch(model) / s.risers < 0.18),
        stepFree: bridges.every(bridge => lifts.has(bridge.f)),
        junctionLobbies: junctionTypes.has('core') && junctionTypes.has('bridge') &&
          hubs.length >= 2 && hubs.some(h => h.access?.connected) &&
          nodes.filter(n => n.kind === 'hub' && reachable.has(n.id)).length === hubs.length &&
          assembly.groups.every(group => !group.layer.includes('_Landing_Lounge')),
        canopyFollowsCabinets,
        benchFitsWalls,
        furniture: ['_Shared_Nook_Benches', '_Shared_Lattice_Canopy', 'Assembly_Atrium_Bearings',
          'Infinite_Rinse_Perimeter_Walk'].every(hasLayer)
      };
    }''')
    assert all(result.values()), result

    paired_lobbies = page.evaluate('''() => {
      const previous = state;
      state = { ...defaults(), seed: 609, dockVariant: 14, floors: 6, modules: 53, affinity: 0,
        footprint: 4700, slideLength: 60, split: [80, 25, 89, 50, 26], vacancy: [16, 18, 40, 26], atriumBridges: 'radial',
        relations: {'1-3':'repel', '1-4':'attract', '3-4':'attract', '0-2':'attract'},
        cluster: [false, false, true, false, false], visitorCount: 52,
        points: [[0.2218737284342448, -0.4040688266273306], [0.6245334201388889, 0.37901485667509194],
          [-0.024652608235677085, -0.23005022321428573], [0.09039298163519965, 0.7519118365119485],
          [0.26296140882703994, 0.32929518242844014]] };
      try {
        const plan = derive(), { circulation } = plan, graph = buildNavigation(plan),
          { total, corridorArea, hubArea, elevatorArea, hubs } = circulation,
          lounges = bridgeLounges(plan), baseGraph = buildNavigation(plan, false),
          seatNodes = graph.nodes.filter(node => node.kind === 'bridgeSeat'),
          pathsUnchanged = baseGraph.edges.every((edges, id) =>
            JSON.stringify(edges) === JSON.stringify(graph.edges[id].filter(edge => edge.to < baseGraph.nodes.length))),
          points = (a) => [a[0], a[2]];
        const clearOfWalk = lounges.every(({ f, seats, axis, passage }) => seats.every(({ p, scale }) => {
          const lateral = Math.abs(p[1] * Math.cos(axis) - p[0] * Math.sin(axis)),
            y = f * modelFloorPitch(plan) + 0.54, radius = BRIDGE_SEAT_RADIUS * scale;
          return lateral >= passage / 2 + radius && baseGraph.edges.flat().every(({ path }) =>
            path.slice(1).every((b, i) => {
              const a = path[i];
              return Math.min(a[1], b[1]) > y + 0.21 || Math.max(a[1], b[1]) < y - 0.21 ||
                bridgeSeatDistance(p, points(a), points(b)) >= radius + 0.56;
            }));
        }));
        const roundMatGroups = lounges.every(({ f, court, matRadius, seats, axis, passage }, i) => {
          const [x, z] = court;
          return matRadius > 0 && Math.abs(z * Math.cos(axis) - x * Math.sin(axis)) >= passage / 2 + matRadius &&
            seats.every(({ p, heading, route }) => route.at(-2) === court &&
              angDist(heading, Math.atan2(court[1] - p[1], court[0] - p[0])) < 1e-6 &&
              Math.hypot(p[0] - x, p[1] - z) > matRadius) &&
            lounges.slice(i + 1).every(other => other.f !== f ||
              Math.hypot(other.court[0] - x, other.court[1] - z) >= matRadius + other.matRadius);
        });
        state = { ...state, bridgeSeating: false };
        const open = derive();
        state = { ...state, relations: {} };
        const neutral = derive();
        return {
          sharedOnly: hubs.length === 3 && hubs.every(hub => hub.pair.length === 2) &&
            graph.nodes.filter(node => node.kind === 'hub' && graph.reachable.has(node.id)).length === hubs.length &&
            !graph.nodes.some(node => node.kind === 'publicLobby'),
          neutralOpen: neutral.circulation.hubs.length === 0 && neutral.circulation.bridges.length > 0,
          clusters: [...new Set(lounges.map(lounge => lounge.f + 1))].join() === '2,4,5' &&
            lounges.every(({seats}) => seats.length >= 2 && seats.length <= 5) &&
            [1, 4].every(f => lounges.some(lounge => lounge.f === f && lounge.seats.length >= 3)) && seatNodes.length >= 10,
          usableSeats: seatNodes.length === lounges.reduce((count, lounge) => count + lounge.seats.length, 0) &&
            seatNodes.every(node => graph.reachable.has(node.id) && graph.edges[node.id].length === 1),
          clearOfWalk, pathsUnchanged, roundMatGroups,
          sameProgram: !bridgeLounges(open).length && open.total === plan.total &&
            JSON.stringify(open.rooms) === JSON.stringify(plan.rooms) && JSON.stringify(open.slots) === JSON.stringify(plan.slots),
          furniture: lounges.every(lounge => {
            const mesh = meshBuilder();
            drawBridgeLounge(mesh, lounge, 0);
            const [x, z] = lounge.court, [mat, furniture] = mesh.groups,
              vertices = mesh.solid.slice(mat.solid, furniture.solid),
              radii = vertices.flatMap((u, i) => i % 10 === 0 ? [Math.hypot(u - x, vertices[i + 2] - z)] : []),
              ys = mesh.solid.filter((_, i) => i % 10 === 1);
            return mat.layer.endsWith('_Bridge_Seating_Rug') && furniture.layer.endsWith('_Bridge_Seating') &&
              Math.abs(Math.max(...radii) - lounge.matRadius) < 1e-6 && Math.max(...ys) === 2.12 && mesh.solid.every(Number.isFinite);
          }),
          openLandings: [2, 4, 5].every(level => circulation.regions.some(region =>
            region.f === level - 1 && region.kind === 'bridgeAccess' && region.r === plan.r)),
          areaSum: Math.abs(total - corridorArea - hubArea - elevatorArea) < 1e-6
        };
      } finally {
        state = previous;
      }
    }''')
    assert all(paired_lobbies.values()), paired_lobbies

    # Widen both shoulders in a placement fixture and verify two independent
    # circles of five can face inward on the same landing.
    circles = page.evaluate('''() => {
      const f = 1, footprint = {floorHeight: 4.2, circulation: {
        bridgeLoungeSeed: 606, width: 2.4, doors: [], bridges: [{ f, width: 2.2 }], regions: [
          { f, kind: 'bridgeAccess', r: 20, R: 34, start: -0.12, end: 0.12 },
          { f, kind: 'residual', r: 20, R: 34, start: -0.42, end: -0.12 },
          { f, kind: 'residual', r: 20, R: 34, start: 0.12, end: 0.42 }
        ]
      }}, p = [27, 4.74, 0], node = { id: 0, f, kind: 'corridor', cell: {}, p },
        path = [[20, 4.74, 0], p, [34, 4.74, 0]],
        routes = {nodes: [node], edges: [[{ to: 0, path }]], reachable: new Set([0])},
        courts = fitBridgeLounges(footprint, routes).filter(lounge => lounge.seats.length === 5);
      return courts.length === 2 && courts[0].court[1] * courts[1].court[1] < 0 &&
        courts.every(({ court, seats }) => seats.every(({ p, heading, route }) =>
          angDist(heading, Math.atan2(court[1] - p[1], court[0] - p[0])) < 1e-6 && route.at(-2) === court));
    }''')
    assert circles

    # A legacy Materials snapshot has one cut bridge approach. Its three
    # radial pieces should return to the exact corridor stored before the cut.
    saved_approach = page.evaluate('''() => {
      const snapshot = structuredClone(model), { circulation } = snapshot,
        index = circulation.regions.findIndex(region => region.kind === 'bridgeAccess'),
        original = circulation.regions[index],
        { r, R } = original, width = (R - r) / 3;
      const strip = (low, high, kind) => ({ ...original, r: low, R: high, kind,
        area: (high ** 2 - low ** 2) * (original.end - original.start) / 2 });
      const hub = { ...strip(r + width, R - width, 'publicLobby'), layout: { bridgeThrough: true } };
      circulation.regions.splice(index, 1, strip(r, hub.r, 'bridgeAccess'), strip(hub.R, R, 'lobbyLanding'));
      const area = circulation.corridorArea;
      circulation.publicLobbies = [hub];
      circulation.publicLobbyArea = hub.area;
      circulation.area -= hub.area;
      circulation.corridorArea -= hub.area;
      localStorage.setItem('poly-nation-material-study-v1', JSON.stringify({model: snapshot,
        view: {...state}, assignments: {moduleDesign: {enabled: true}}, notes: 'Captured materials'},
        (_, value) => value instanceof Set ? {materialSnapshotSet: [...value]} : value));
      return { original, area, hubs: circulation.hubs.length };
    }''')
    page.locator('#openMaterials').click()
    expect(page.locator('#materialNotes')).to_have_value('Captured materials')
    expect(page.locator('#uniqueModules')).to_be_checked()
    assert page.evaluate('''({original, area, hubs}) => {
      const stored = JSON.parse(localStorage.getItem('poly-nation-material-study-v1')),
        {circulation} = stored.model,
        joined = circulation.regions.find(region => region.f === original.f &&
          region.start === original.start && region.end === original.end && region.r === original.r);
      return !circulation.publicLobbies && joined?.kind === 'bridgeAccess' && joined.R === original.R &&
        Math.abs(joined.area - original.area) < 1e-6 && Math.abs(area - circulation.corridorArea) < 1e-6 &&
        circulation.hubs.length === hubs;
    }''', saved_approach)
    page.locator('#openMassing').click()
    seating = page.locator('#bridgeSeating')
    expect(seating).to_be_visible()
    expect(seating).to_be_checked()
    seating.uncheck()
    page.wait_for_function('!pending && !model.circulation.bridgeLoungeSeed')
    seating.check()
    page.wait_for_function('!pending && model.circulation.bridgeLoungeSeed === state.seed')

    expect(page.locator('#openBuild + span + button')).to_have_text('Render')
    page.evaluate('window.designBeforeRender = model')
    page.evaluate('''() => {
      window.zoomSamples = {};
      const glDraw = paintWebGL;
      const canvasDraw = paintSoftware;
      paintWebGL = (canvas, gl, renderer, camera, ...args) => {
        window.zoomSamples[canvas.id] = { ...camera };
        return glDraw(canvas, gl, renderer, camera, ...args);
      };
      paintSoftware = (mesh, renderer, camera, ...args) => {
        window.zoomSamples[renderer.canvas.id] = { ...camera };
        return canvasDraw(mesh, renderer, camera, ...args);
      };
    }''')
    for tab, target in [('#openMassing', 'canvas'), ('#openBuild', 'buildCanvas')]:
        page.locator(tab).click()
        subject = page.locator('#' + target)
        bounds = subject.bounding_box()
        subject.dispatch_event('wheel', {
            'deltaY': -6500, 'clientX': bounds['x'] + bounds['width'] * 0.7,
            'clientY': bounds['y'] + bounds['height'] * 0.43,
        })
        camera = page.evaluate('id => window.zoomSamples[id]', target)
        assert camera['zoom'] < 0.02 and camera['panX'] > 0
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
    print('Atrium stairs, shared lobby placement, quarter domes, detail zoom and lighting passed.')
