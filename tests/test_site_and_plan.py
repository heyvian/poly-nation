"""Exercise the PDF-led West Village study, terrain providers and overhead cameras."""

import os
import re
import shutil
import struct
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


def terrarium_tile(elevation):
    red, green = divmod(32768 + elevation, 256)
    row = bytes((0,)) + bytes((red, green, 0)) * 256

    def chunk(kind, payload):
        return (struct.pack('!I', len(payload)) + kind + payload
                + struct.pack('!I', zlib.crc32(kind + payload)))

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 256, 256, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(row * 256)) + chunk(b'IEND', b''))


def way(tags, *points):
    return {'type': 'way', 'tags': tags,
            'geometry': [{'lat': lat, 'lon': lon} for lat, lon in points]}


def osm_xml(features):
    root = ET.Element('osm', version='0.6')
    node_id = 0
    for item_id, feature in enumerate(features, 1):
        kind = feature['type']
        if kind == 'node':
            node_id += 1
            item = ET.SubElement(root, 'node', id=str(node_id),
                                 lat=str(feature['lat']), lon=str(feature['lon']))
        else:
            item = ET.SubElement(root, 'way', id=str(item_id))
            nodes = {}
            for point in feature['geometry']:
                location = (point['lat'], point['lon'])
                if location not in nodes:
                    node_id += 1
                    nodes[location] = str(node_id)
                    ET.SubElement(root, 'node', id=str(node_id),
                                  lat=str(point['lat']), lon=str(point['lon']))
                ET.SubElement(item, 'nd', ref=nodes[location])
        for key, value in feature['tags'].items():
            ET.SubElement(item, 'tag', k=key, v=value)
    return ET.tostring(root, encoding='unicode')


def verify_plan(page, selector):
    page.evaluate('window.projectedPlan = null')
    page.locator(selector).click()
    page.wait_for_function('window.projectedPlan?.el === Math.PI / 2', timeout=5000)
    result = page.evaluate('''() => {
      const view = window.projectedPlan;
      const {right, up} = orbitBasis(view);
      const below = [10, 0, 20], above = [10, 80, 20];
      return {
        vertical: view.el === Math.PI / 2,
        northUp: up[2] === 1 && right[0] === -1,
        sameScreenPoint: [right, up].every(axis => dot(below, axis) === dot(above, axis))
      };
    }''')
    assert all(result.values()), (selector, result)


root = Path(__file__).resolve().parents[1]
features = [
    way({'waterway': 'river', 'name': 'Bow River'}, (51.049, -114.116), (51.049, -114.113),
        (51.0495, -114.104), (51.0505, -114.093), (51.051, -114.090)),
    way({'highway': 'primary', 'bridge': 'yes', 'name': 'Crowchild Trail SW'},
        (51.048, -114.113), (51.050, -114.113)),
    way({'highway': 'primary', 'bridge': 'yes', 'name': '14 Street SW'},
        (51.0495, -114.093), (51.0515, -114.093)),
    way({'natural': 'wood'}, (51.043, -114.111), (51.046, -114.111), (51.046, -114.107),
        (51.043, -114.107), (51.043, -114.111)),
    way({'natural': 'water'}, (51.051, -114.109), (51.053, -114.109), (51.052, -114.107),
        (51.051, -114.109)),
    {'type': 'node', 'tags': {'natural': 'tree'}, 'lat': 51.045, 'lon': -114.110},
    way({'highway': 'residential'}, (51.042, -114.111), (51.053, -114.107)),
]

with serve_lab(root) as url, sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH')
                               or shutil.which('chromium') or None,
                               args=['--no-sandbox', '--disable-webgl'])
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    errors, tile_requests, elevation_requests = [], [], []
    tile = terrarium_tile(1040)
    page.on('pageerror', lambda error: errors.append(str(error)))
    tiles = 'https://s3.amazonaws.com/elevation-tiles-prod/**'
    overpass = 'https://overpass-api.de/api/interpreter?*'
    mirror = 'https://overpass.private.coffee/api/interpreter?*'
    official = 'https://api.openstreetmap.org/api/0.6/map?*'
    fallback = 'https://api.open-meteo.com/v1/elevation?*'

    def primary_terrain(route):
        tile_requests.append(route.request.url)
        route.fulfill(body=tile, content_type='image/png')

    page.route(tiles, primary_terrain)
    for endpoint in [overpass, mirror, official]:
        page.route(endpoint, lambda route: route.abort())
    page.goto(url + '/')
    page.evaluate('''() => {
      state.simRunning = state.animateSwing = false;
      window.designScenes = {};
      const paint = paintSoftware;
      paintSoftware = (...args) => {
        window.projectedPlan = {...args[2]};
        window.paintedGroups = args[0].groups.map(group => group.layer);
        window.designScenes[args[1].canvas.id] = { layers: window.paintedGroups,
          foundation: args[0].foundation, north: args[0].northAzimuth, lit: Boolean(args[0].renderLighting) };
        if (args[1].canvas.id === 'siteCanvas') window.siteOrbitScene = args[0];
        return paint(...args);
      };
      const collect = drawingGeometry;
      drawingGeometry = (...args) => ({ ...collect(...args), terrain: args[0].groups.some(group => group.layer === 'Site terrain') });
      const drawModel = renderDrawing;
      renderDrawing = (...args) => {
        window.drawingIncludesTerrain = args[0].terrain;
        return drawModel(...args);
      };
    }''')
    verify_plan(page, '#plan')
    page.locator('#openMaterials').click()
    verify_plan(page, '#materialPlan')
    page.locator('#openBuild').click()
    verify_plan(page, '#buildPlan')
    page.locator('#openDrawings').click()
    expect(page.locator('#drawingSite')).to_be_disabled()
    page.locator('#drawingDocument').select_option('site-sections')
    expect(page.locator('#documentPages')).to_contain_text('Load live terrain')
    expect(page.locator('#printDocument')).to_be_disabled()
    page.locator('#drawingDocument').select_option('')
    page.locator('#openSite').click()
    svg = page.locator('#sitePlacementPlan')
    footprint = page.locator('#siteFootprint')
    expect(svg).to_be_visible()
    expect(page.locator('#siteParcelBoundary')).to_have_attribute('points', re.compile(r'\d'))
    expect(page.locator('#sitePlanSource')).to_have_value('combined')
    expect(page.locator('#siteRegistration')).to_contain_text('Three GPS landmarks')
    assert page.evaluate('''() => {
      const pairs = WEST_VILLAGE_LANDMARKS.map(({gps}) => gps), fit = westVillageLandmarkRegistration(pairs),
        {project} = siteCoordinates(WEST_VILLAGE_PLAN.terrainCentre);
      return fit.controlCount === 3 && fit.rms < 0.4 && fit.a < 0 &&
        WEST_VILLAGE_LANDMARKS.every(({page, gps: [lat, lon]}) =>
          Math.hypot(...sub(westVillageToGround(page, fit), project({lat, lon}))) < 0.5);
    }''')
    assert page.evaluate('''() => {
      const fit = westVillageLandmarkRegistration(WEST_VILLAGE_LANDMARKS.map(({gps}) => gps)),
        flat = { size: WEST_VILLAGE_PLAN.terrainSize, count: 17, datum: 1040, elevations: Array(289).fill(1040) },
        paths = siteDistrictVectors(fit, WEST_VILLAGE_CIRCULATION),
        bridges = (proposed) => siteDistrictBridgeCandidates(paths, flat,
          westVillageWaterFromPlan(flat, fit, proposed), [], null).bridges;
      return bridges(false).length === 2 && bridges(true).length === 38;
    }''')

    def pick(x, y):
        point = svg.evaluate('(node, [x, y]) => {const p = new DOMPoint(x, y).matrixTransform(node.getScreenCTM()); return [p.x, p.y]}',
                             [x, y])
        page.mouse.click(*point)

    start = footprint.get_attribute('transform')
    pick(140, 120)
    expect(page.locator('#sitePlacementStatus')).to_contain_text('inside Parcel 4')
    expect(footprint).to_have_attribute('transform', start)
    pick(335, 407)
    pin = footprint.get_attribute('transform')
    assert pin != start
    svg.press('ArrowRight')
    pin = footprint.get_attribute('transform')
    for sheet, asset in [('water', 'water'), ('circulation', 'circulation'), ('parcels', 'parcels'),
                         ('combined', 'water-circulation'), ('master', 'master')]:
        page.locator('#sitePlanSource').select_option(sheet)
        expect(page.locator('#sitePlanImage')).to_have_attribute('href', f'assets/site/{asset}.webp')
        expect(footprint).to_have_attribute('transform', pin)
    page.locator('#siteTerrainMode').click()
    expect(page.locator('#siteTerrainEmpty')).to_be_visible()
    assert not tile_requests, 'Terrain was requested before the placement step'

    # No vector map service is required to show the river and excavations in the supplied plans.
    assert page.locator('#loadSite').evaluate('''button => {
      button.click();
      return !document.getElementById('appWorking').hidden;
    }''')
    expect(page.locator('#siteStatus')).to_contain_text('Mapzen Terrain Tiles', timeout=20000)
    expect(page.locator('#appWorking')).to_be_hidden()
    expect(page.locator('#sitePlacementStatus')).to_contain_text('Ground at pin 1040.0 m')
    expect(page.locator('#siteWaterStatus')).to_contain_text('Bow River study level 1040.0 m')
    expect(page.locator('#siteWaterStatus')).to_contain_text('Registered to the three GPS landmarks')
    expect(page.locator('#siteTerrainEmpty')).to_be_hidden()
    expect(page.locator('#siteCanvas')).to_be_visible()
    page.wait_for_function("window.paintedGroups.includes('Site_District_Paths') && "
                           "window.paintedGroups.includes('Site_District_Pedestrian_Bridge_Decks')")
    verify_plan(page, '#sitePlan')
    page.locator('#siteAxo').click()
    page.locator('#siteFit').click()
    orbit_probe = '''() => {
      const mesh = window.siteOrbitScene, view = window.projectedPlan;
      const storage = JSON.parse(localStorage.getItem('poly-nation-west-village-v1'));
      const [x, z] = westVillageToGround(storage.pin, storage.registration);
      const pivot = modelViewPivot(mesh);
      const {right, up, target, half} = modelProjection(mesh, view, 1);
      return {az: view.az, pinned: Math.abs(pivot[0]-x) < 1e-6 && Math.abs(pivot[2]-z) < 1e-6,
        screen: [dot(sub(pivot, target), right)/half, dot(sub(pivot, target), up)/half]};
    }'''
    before_orbit = page.evaluate(orbit_probe)
    bounds = page.locator('#siteCanvas').bounding_box()
    x = bounds['x'] + bounds['width'] / 2
    y = bounds['y'] + bounds['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 120, y + 38, steps=4)
    page.mouse.up()
    after_orbit = page.evaluate(orbit_probe)
    assert before_orbit['pinned'] and after_orbit['pinned']
    assert before_orbit['az'] != after_orbit['az']
    assert all(abs(a - b) < 1e-8 for a, b in zip(before_orbit['screen'], after_orbit['screen']))
    page.locator('#siteFocus').click()
    assert page.evaluate('window.projectedPlan.zoom < 0.15')
    page.locator('#siteCondition').select_option('existing')
    page.wait_for_function("window.paintedGroups.includes('Site Bow River water') && !window.paintedGroups.includes('Site canal bed')")
    page.locator('#siteCondition').select_option('proposed')
    page.wait_for_function("window.paintedGroups.includes('Site canal bed') && window.paintedGroups.includes('Site canal water')")
    page.locator('#siteShowWater').uncheck()
    page.wait_for_function("window.paintedGroups.includes('Site canal bed') && !window.paintedGroups.includes('Site canal water')")
    page.locator('#siteShowWater').check()
    page.locator('#siteContours').uncheck()
    page.locator('#siteCanalDepth').fill('3')
    page.locator('#siteCanalDepth').press('Tab')
    assert page.evaluate('''() => {
      const terrain = {size: 2800, count: 2, datum: 1040, elevations: [1040,1048,1040,1048]};
      const structure = meshBuilder();
      structure.mark('Core_test');
      structure.box(0,0,0,4,10,4,0,rgb('#447763'));
      const building = {...structure, H: 10, extent: 4};
      const water = {level: 1041, existing: [],
        proposed: [[[0,0], [20,0], [0,20]]]};
      const settings = {water, showWater: false, showContours: false, canalDepth: 3, position: [2, 3]};
      const changed = siteAssemblyMesh(building, terrain, settings);
      const outlines = siteAssemblyMesh(building, terrain, {...settings, showContours: true});
      const floor = changed.groups.findIndex(group => group.layer === 'Site canal bed');
      const bay = changed.groups.find(group => group.layer === 'Core_test');
      const span = changed.solid.slice(changed.groups[floor].solid, changed.groups[floor + 1].solid);
      const asDrawing = siteAssemblyMesh(building, terrain, {...settings, relativeToBuilding: true});
      const origin = asDrawing.groups.find(group => group.layer === 'Core_test').solid;
      return span.filter((_, i) => i % 10 === 1).every(y => y === -2) &&
        outlines.lines.length > changed.lines.length && outlines.solid.join() === changed.solid.join() &&
        changed.solid[bay.solid + 1] > asDrawing.solid[origin + 1];
    }''')
    assert page.evaluate('''() => {
      const terrain = {size: 480, count: 9, datum: 1040, elevations: Array(81).fill(1040)};
      const mesh = siteAssemblyMesh({...meshBuilder(), H: 10, extent: 65, craneMoat: { inner: 60, outer: 68.5 }},
        terrain, { position: [24, -19], showWater: false, showContours: false });
      const withinTerrain = (x, z) => {
        for (let i = 0; i < mesh.solid.length; i += 30) {
          const sides = [0, 10, 20].map((step, j) => {
            const a = i + step, b = i + ((j + 1) % 3) * 10;
            return (mesh.solid[b] - mesh.solid[a]) * (z - mesh.solid[a + 2]) -
              (mesh.solid[b + 2] - mesh.solid[a + 2]) * (x - mesh.solid[a]);
          });
          if (sides.every(value => value > 1e-6) || sides.every(value => value < -1e-6)) return true;
        }
        return false;
      };
      return Array.from({length: 16}, (_, i) => i * TAU / 16 + 0.12).every(angle => {
        const at = (r) => withinTerrain(24 + r * Math.cos(angle), -19 + r * Math.sin(angle));
        return at(58) && !at(64.25) && at(71);
      });
    }''')
    assert page.evaluate('''() => {
      const terrain = {size: 400, count: 9, datum: 1040,
        elevations: Array.from({length: 81}, (_, i) => 1040 + (i % 9) * 0.9 + Math.floor(i / 9) * 0.6)};
      const water = {level: 1044, existing: [],
        proposed: [[[-6,-100], [6,-100], [6,100]], [[-6,-100], [6,100], [-6,100]]]};
      const plan = siteFoundationPlan(model, terrain, { position: [0,0], bearing: 24, grade: 0, water });
      const spans = plan.rows.flatMap(row => row.transfers);
      const flat = siteFoundationPlan(model, { ...terrain, elevations: Array(81).fill(1040) },
        { position: [0, 0], bearing: 24, grade: 0, water: null });
      const blocked = siteLobbyWalk(flat.terrain, plan.water, [0, 80], 0, 0, 0, flat.floor, 3.8);
      const mesh = meshBuilder();
      drawSiteFoundations(mesh, model, plan, false);
      const landward = mesh.groups.flatMap((group, i) => {
        if (!/^Site_Foundation_(Stem_Walls|Pile_Caps|Piles)$/.test(group.layer)) return [];
        return mesh.solid.slice(group.solid, mesh.groups[i + 1]?.solid ?? mesh.solid.length)
          .flatMap((x, j, points) => j % 10 === 0 ? [[x, points[j + 2]]] : []);
      });
      const cuts = siteSectionCuts(plan);
      const source = meshBuilder(), concrete = rgb('#556f66'), top = plan.crossingSoffit - plan.foundation;
      source.mark('Core_Test_Ground');
      source.box(0, 0, 0, 20, top, 6, 0, concrete);
      source.mark('Core_Test_Upper');
      source.box(0, top, 0, 20, 0.24, 6, 0, concrete);
      const clipped = siteAssemblyMesh({ ...source, H: 10, extent: 15 }, terrain,
        { bearing: 0, supportPlan: plan, model, includeTerrain: false, includeFoundations: false });
      const lower = clipped.solid.slice(0, clipped.groups[1].solid), placed = sitePlacementModel(model, plan);
      const exactModules = placed.slots.every((slot, i) => plan.omitted.has(slot.i)
        ? slot.f === 0 && slot.blocked && slot.p === EMPTY : slot === model.slots[i]);
      const railStacks = model.crane.supports.every((azimuth) => plan.grid.axes.some(({ angle, active }) =>
        azimuth === angle && active.inner && active.outer));
      const bearingGeometry = plan.columns.every(({ at, angle, side }) => {
        const r = plan.grid[side];
        return Math.hypot(at[0] - Math.cos(angle) * r, at[1] - Math.sin(angle) * r) < 1e-6;
      });
      return plan.floor < plan.water.level + 2 && Math.abs(plan.crossingDeck - plan.floor - modelFloorPitch(model)) < 1e-6 &&
        railStacks && bearingGeometry && plan.foundationRings.length === 2 && plan.mastCrossing &&
        mesh.groups.some(({ layer }) => layer === 'Site_Mast_Transfer') &&
        plan.columns.some(({ wet, transfer }) => wet && transfer) &&
        plan.columns.filter(({ wet }) => wet).every(({ key }) => placed.siteTransferredColumns.has(key)) &&
        exactModules && plan.omitted.size > 0 && spans.length > 0 && lower.length > 0 &&
        plan.runway.lift > 0 && Math.abs(placed.crane.groundRail + plan.foundation - plan.runway.head) < 1e-6 &&
        lower.every((x, i) => i % 10 || Math.abs(x) >= 6 - 1e-6 || lower[i + 1] >= plan.crossingSoffit - 1e-6) &&
        clipped.solid.length - lower.length === source.solid.length - source.groups[1].solid &&
        landward.length > 0 && landward.every(point => !plan.water.overlaps(point, 5)) &&
        plan.rows.some(row => row.supports.some(support => support.bank && plan.water.overlaps(row.at(support.at), 5))) &&
        plan.rows.every(row => row.supports.every(support => !plan.water.overlaps(row.at(support.at), 1.3))) &&
        spans.every(span => plan.crossingSoffit - span.depth > plan.water.level + 2.7) &&
        !blocked && flat.accesses.length === 2 && flat.accesses.every((walk) => walk.arrival &&
          walk.nodes.at(-1)[0] > model.crane.tower && walk.courts.length === 2) && [flat, plan].every((site) =>
          site.accesses.every(({ at, threshold, kind, nodes }) => kind === 'walk' &&
            Math.abs(nodes[0][1] - site.floor) < 1e-6 &&
            Math.abs(siteTerrainHeight(site.terrain, ...at(threshold)) - site.floor) < 0.04 &&
            nodes.slice(1).every(([station, y], i) => Math.abs(y - nodes[i][1]) <= (station - nodes[i][0]) / 20 + 1e-6))) &&
        cuts.some(cut => cut.kind === 'canal-detail') &&
        cuts.some(cut => cut.kind === 'piled-detail');
    }''')
    assert page.evaluate('''() => {
      const terrain = { size: 400, count: 9, datum: 1040, elevations: Array(81).fill(1040) },
        position = [4, -6], bearing = 26, angle = bearing * Math.PI / 180, r = model.r,
        level = 1040, bridge = { f: 1, heading: 0.32, offset: 3.95, width: 2.2 },
        bridgeModel = { ...model, circulation: { ...model.circulation, bridges: [bridge], stairs: [] } },
        area = (direction, from, to, low, high) => {
          const line = (offset) => siteLine(position, angle + direction, offset),
            [a, b, c, d] = [line(low)(from), line(low)(to), line(high)(to), line(high)(from)];
          return [[a, b, c], [a, c, d]];
        },
        canal = { level, existing: [], proposed: area(bridge.heading, -r - 18, r + 18, 6, 14) },
        plan = siteFoundationPlan(bridgeModel, terrain, { position, bearing, grade: 0, water: canal }),
        dry = siteFoundationPlan(model, terrain, { position, bearing, grade: 0, water: null }),
        placed = sitePlacementModel(bridgeModel, plan), base = buildStorey(placed, 1).base,
        mesh = buildAssemblyMesh(placed, { slabs: true }, 2, { assignments: {}, view: state }),
        oneFloor = buildAssemblyMesh(placed, { slabs: true }, 1, { assignments: {}, view: state });
      const panes = (source) => source.groups.flatMap(({ layer, glass }, i) => layer === 'Site_Canal_Lookout_Glazing'
        ? source.glass.slice(glass, source.groups[i + 1]?.glass).filter((_, i) => i % 10 === 1) : []);
      const scene = siteAssemblyMesh(mesh, terrain, { position, bearing, model: bridgeModel, supportPlan: plan, includeTerrain: false });
      const withoutBridge = { ...model, circulation: { ...model.circulation, bridges: [], stairs: [] } },
        link = model.circulation.regions.find((q) => q.f === 1 && q.kind === 'link' && q.r === r),
        ring = siteFoundationPlan(withoutBridge, terrain, { position, bearing, grade: 0,
          water: { level, existing: [], proposed: area((link.start + link.end) / 2, r - 8, r + 12, -4, 4) } }),
        dock = model.slots.find((slot) => slot.f === 1 && !slot.blocked),
        dockModel = { ...bridgeModel, slots: model.slots.map((slot) => slot === dock ? { ...slot, p: EMPTY, use: 'empty' } : slot) },
        exterior = area(dock.angle, model.R + 7, model.R + 22, -3, 3),
        outdoor = siteFoundationPlan(dockModel, terrain, { position, bearing, grade: 0, lookout: 'outdoor',
          water: { ...canal, proposed: exterior } }),
        both = siteFoundationPlan(dockModel, terrain, { position, bearing, grade: 0, lookout: 'both',
          water: { ...canal, proposed: [...canal.proposed, ...exterior] } }),
        withDock = sitePlacementModel(dockModel, outdoor),
        dockMesh = buildAssemblyMesh(withDock, { slabs: true, facade: true }, 2, { assignments: {}, view: state });
      return plan.lookouts.some(({ type }) => type === 'bridge') && !dry.lookouts.length &&
        ring.lookouts.some(({ type }) => type === 'ring') && placed.siteCanalLookouts === plan.lookouts &&
        panes(mesh).length > 0 && panes(mesh).every((y) => Math.abs(y - base) < 1e-6) &&
        !panes(oneFloor).length && panes(scene).length === panes(mesh).length &&
        panes(scene).every((y) => Math.abs(y - plan.crossingDeck) < 1e-6) &&
        siteSectionCuts(plan).some(({ kind }) => kind === 'canal-lookout') &&
        outdoor.lookouts.length === 1 && outdoor.lookouts[0].slot === dock.i &&
        withDock.slots.find((slot) => slot.i === dock.i).siteCanalLookout &&
        panes(dockMesh).length > 0 && panes(dockMesh).every((y) => Math.abs(y - base) < 1e-6) &&
        dockMesh.groups.some(({ layer, name }) => layer === 'Dock_Closure_Folded_L2' && name === `Slot_${dock.j}`) &&
        both.lookouts.some(({ type }) => type === 'bridge') && both.lookouts.some(({ type }) => type === 'dock') &&
        siteSectionCuts(both).some(({ kind }) => kind === 'canal-lookout-open-air');
    }''')
    assert page.evaluate('''() => {
      const terrain = { size: 480, count: 17, datum: 1040,
        elevations: Array.from({length: 289}, (_, i) => 1040 + (i % 17 - 8) * 0.66 + (Math.floor(i / 17) - 8) * 0.15) };
      const position = [0, 0], bearing = 19, angle = model.lobby.angle + bearing * Math.PI / 180 + Math.PI / 2,
        point = (station, offset) => siteLine(position, angle, offset)(station),
        [a, b, c, d] = [point(model.R - 0.8, -6.2), point(151, -6.2), point(151, 6.2), point(model.R - 0.8, 6.2)],
        water = { level: 1040.2, existing: [], proposed: [[a, b, c], [a, c, d]] },
        crane = planModuleCrane(model, 'moat'), building = { ...model, crane }, layers = JSON.stringify(model.layers),
        plan = siteFoundationPlan(building, terrain, { position, bearing, grade: 0, water }),
        dry = siteFoundationPlan(building, terrain, { position, bearing, grade: 5.5, water: null }),
        elevated = siteFoundationPlan({ ...model, crane: planModuleCrane(model, 'elevated') }, terrain,
          { position, bearing, grade: 0, water }),
        six = siteFoundationPlan(building, terrain, { position, bearing, grade: 0, water, boatCapacity: 6 }),
        shallow = siteFoundationPlan(building, terrain, { position, bearing, grade: 0, water, canalDepth: 1.5 }),
        mesh = meshBuilder();
      drawCraneInfrastructure(mesh, building, crane, rgb('#5d7971'), true);
      const scene = siteAssemblyMesh({ ...mesh, H: 60, extent: 120, craneMoat: craneMoatBounds(crane) }, terrain,
        { position, bearing, water, model: building, supportPlan: plan, canalDepth: 2 });
      const waterHeights = (layer) => {
        const i = scene.groups.findIndex((group) => group.layer === layer);
        return i < 0 ? [] : scene.solid.slice(scene.groups[i].solid, scene.groups[i + 1]?.solid)
          .filter((_, j) => j % 10 === 1);
      };
      const moatHeights = waterHeights('Site moat water'), canalHeights = waterHeights('Site canal water'),
        bay = plan.boatBay, cuts = siteSectionCuts(plan).map(({ kind }) => kind);
      return plan.moat.connected && !dry.moat.connected && moatHeights.length && canalHeights.length &&
        [...moatHeights, ...canalHeights].every((y) => Math.abs(y - (water.level - terrain.datum)) < 1e-5) &&
        bay?.capacity === 3 && bay.boat.length >= 11 && bay.boat.beam < bay.berthWidth && bay.maintenanceArea >= 120 &&
        !shallow.boatBay && !shallow.surface.garage && six.boatBay?.capacity === 6 &&
        six.boatBay.slipCenters.length === 6 && six.boatBay.area > bay.area &&
        plan.water.overlaps(bay.at(bay.back + 0.2)) && elevated.runway.spans.length > 0 &&
        elevated.runway.poles.every((azimuth) => elevated.runway.radii.every((radius) =>
          !elevated.water.overlaps(siteLine(position, azimuth)(radius), 1.1))) &&
        scene.groups.some(({ layer }) => layer === 'Site_Firehall_Rescue_Boat') &&
        cuts.includes('boat-garage') && cuts.includes('boat-hall-cross') &&
        dry.lowerRooms.length && dry.lowerRooms.every(({ ceiling, level }) => ceiling - level >= 2.7) &&
        JSON.stringify(model.layers) === layers;
    }''')

    page.locator('#siteBearing').fill('22')
    page.locator('#siteBearing').press('Tab')
    for phase, canvas_id in [('Massing', 'canvas'), ('Materials', 'materialsCanvas'),
                             ('Build', 'buildCanvas'), ('Render', 'renderCanvas')]:
        page.locator('#open' + phase).click()
        page.wait_for_function('''id => designScenes[id]?.layers.includes('Site terrain') &&
          designScenes[id].layers.includes('Site_Foundation_Platform') &&
          Math.abs(designScenes[id].north + Math.PI / 2 + 22 * Math.PI / 180) < 1e-6''', arg=canvas_id)
    assert page.evaluate('designScenes.renderCanvas.lit && occupancy.m === siteWorkspace.designModel(model)')
    page.locator('#openSite').click()
    page.locator('#siteLinkDesign').uncheck()
    page.locator('#openMassing').click()
    page.wait_for_function("!designScenes.canvas.layers.includes('Site terrain') && occupancy.m === model")
    page.locator('#openSite').click()
    page.locator('#siteLinkDesign').check()
    page.locator('#openDrawings').click()
    include_site = page.locator('#drawingSite')
    expect(include_site).to_be_enabled()
    expect(include_site).to_be_checked()
    page.wait_for_function('window.drawingIncludesTerrain')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    include_site.uncheck()
    page.wait_for_function('window.drawingIncludesTerrain === false')
    page.locator('#drawingDocument').select_option('site-sections')
    expect(page.locator('#documentPages svg[data-site-section=foundation]')).to_have_count(1, timeout=30000)
    district = page.locator('#documentPages svg[data-site-section=district]')
    expect(district).to_contain_text('North–south section looking west')
    expect(district).to_have_attribute('data-site-parcel', '4')
    expect(district).to_contain_text('Parcel 4')
    expect(district).to_contain_text('Bow River')
    expect(district.locator('[data-site-parcel-locator="4"] polygon')).to_be_attached()
    expect(district.locator('[data-site-context=overlay] path').first).to_be_attached()
    expect(page.locator('#documentPages svg[data-site-section=piled-detail]')).to_contain_text('Pile lengths are shown schematically')
    loadpath = page.locator('#documentPages svg[data-site-section=structural-axis]')
    expect(loadpath).to_contain_text('Lateral load path')
    expect(loadpath.locator('[data-load-path] polygon').first).to_be_attached()
    expect(page.locator('#documentPages svg[data-site-section=mast-foundation]')).to_contain_text('Swing mast and greenhouse foundations')
    axo = page.locator('#documentPages svg[data-site-section=axo]')
    expect(axo).to_have_attribute('width', '17in')
    expect(axo).to_have_attribute('height', '11in')
    expect(axo.locator('[data-layer="Colour fills"] path').first).to_be_attached()
    expect(axo.locator('[data-site-context=inset] path').first).to_be_attached()
    expect(axo.locator('image')).to_have_count(0)
    expect(page.locator('#printDocument')).to_be_enabled()
    page.evaluate('window.print = () => {}')
    page.locator('#printDocument').click()
    pdf = page.pdf(prefer_css_page_size=True, print_background=True)
    assert b'/MediaBox [0 0 1224 792]' in pdf and b'/Subtype /Image' not in pdf
    page.evaluate('window.dispatchEvent(new Event("afterprint"))')
    page.locator('#openSite').click()
    page.reload()
    expect(page.locator('#sitePhase')).to_be_visible()
    expect(page.locator('#siteContours')).not_to_be_checked()
    expect(page.locator('#siteCanalDepth')).to_have_value('3')
    expect(page.locator('#siteStatus')).to_contain_text('cached elevations')
    page.locator('#sitePlaceMode').click()
    expect(footprint).to_have_attribute('transform', pin)

    # Try the standards-based OSM XML lookup and the independent elevation fallback.
    page.route(official, lambda route: route.fulfill(body=osm_xml(features), content_type='application/xml'))
    page.route(tiles, lambda route: route.abort())

    def fallback_terrain(route):
        latitudes = parse_qs(urlsplit(route.request.url).query)['latitude'][0].split(',')
        elevation_requests.append(len(latitudes))
        route.fulfill(json={'elevation': [1042] * len(latitudes)})

    page.route(fallback, fallback_terrain)
    page.locator('#loadSite').click()
    expect(page.locator('#siteStatus')).to_contain_text('Open-Meteo (coarser fallback)', timeout=20000)
    expect(page.locator('#siteWaterStatus')).to_contain_text('Bow River study level 1042.0 m')
    expect(page.locator('#siteWaterStatus')).to_contain_text('Registered to the three GPS landmarks')
    assert elevation_requests == [100, 100, 89], elevation_requests
    page.locator('#siteVegetation').check()
    expect(page.locator('#siteWaterStatus')).to_contain_text('Mapped vegetation is shown.', timeout=30000)
    page.locator('#siteVegetation').uncheck()
    page.route(fallback, lambda route: route.abort())
    page.locator('#loadSite').click()
    expect(page.locator('#siteStatus')).to_contain_text('previous elevation surface is still shown')
    expect(page.locator('#appWorking')).to_be_hidden()
    expect(page.locator('#siteCanvas')).to_be_visible()
    page.locator('#sitePlaceMode').click()
    expect(footprint).to_have_attribute('transform', pin)
    svg.scroll_into_view_if_needed()
    pick(338, 456)
    page.wait_for_function('''() => model.siteGeometry.canalArea > 0 && model.siteGeometry.wetBays.size > 0 &&
      model.slots.filter(({ siteReserved }) => siteReserved).every(({ f, blocked, p, use }) =>
        f === 0 && blocked && p === EMPTY && use === 'blocked') &&
      model.total <= state.areaCap + 0.001''')
    page.locator('#openMassing').click()
    page.locator('summary').filter(has_text='West Village site').click()
    before_site_change = page.evaluate('model.siteGeometry.position')
    page.locator('#designSiteMoveEast').click()
    page.wait_for_function('before => model.siteGeometry.position.some((value, i) => value !== before[i])', arg=before_site_change)
    page.locator('#openDrawings').click()
    page.locator('#drawingDocument').select_option('programme')
    expect(page.locator('#documentPages')).to_contain_text('of ground plate open at the water')
    expect(page.locator('#documentPages [data-site-water]').first).to_be_attached()
    expect(page.locator('#documentPages [data-site-footprint]').first).to_be_attached()
    page.evaluate('window.print = () => {}')
    page.locator('#printDocument').click()
    pdf = page.pdf(prefer_css_page_size=True, print_background=True)
    assert b'/MediaBox [0 0 1224 792]' in pdf and b'/Subtype /Image' not in pdf
    page.evaluate('window.dispatchEvent(new Event("afterprint"))')
    mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mobile.goto(url + '/')
    mobile.locator('#openSite').click()
    expect(mobile.locator('#sitePlacementPlan')).to_be_visible()
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.goto(url + '/Design_Rationale.html')
    expect(page.locator('.dr-slide:visible')).to_have_count(1)
    page.locator('#drNext').press('ArrowRight')
    expect(page.locator('#drSite')).to_be_visible()
    assert not errors, errors
    print('PDF placement, district bounds, terrain and map fallbacks, canal excavation, drawing toggle and overhead views passed.')
