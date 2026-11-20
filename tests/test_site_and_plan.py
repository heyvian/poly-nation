"""Exercise the PDF-led West Village study, terrain providers and overhead cameras."""

import os
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
      const paint = paintSoftware;
      paintSoftware = (...args) => {
        window.projectedPlan = {...args[2]};
        window.paintedGroups = args[0].groups.map(group => group.layer);
        return paint(...args);
      };
      const drawModel = renderDrawing;
      renderDrawing = (...args) => {
        window.drawingIncludesTerrain = args[0].points.some(([x, , z]) => Math.hypot(x, z) > 800);
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
    page.locator('#openSite').click()
    svg = page.locator('#sitePlacementPlan')
    footprint = page.locator('#siteFootprint')
    expect(svg).to_be_visible()
    expect(footprint).to_have_attribute('data-water', 'false')

    def pick(x, y):
        point = svg.evaluate('(node, [x, y]) => {const p = new DOMPoint(x, y).matrixTransform(node.getScreenCTM()); return [p.x, p.y]}',
                             [x, y])
        page.mouse.click(*point)

    start = footprint.get_attribute('transform')
    pick(140, 120)
    expect(page.locator('#sitePlacementStatus')).to_contain_text('inside the dashed')
    expect(footprint).to_have_attribute('transform', start)
    pick(740, 423)
    pin = footprint.get_attribute('transform')
    assert pin != start
    svg.press('ArrowRight')
    pin = footprint.get_attribute('transform')
    for sheet in ['water', 'circulation', 'master']:
        page.locator('#sitePlanSource').select_option(sheet)
        expect(page.locator('#sitePlanImage')).to_have_attribute('href', f'assets/site/{sheet}.webp')
        expect(footprint).to_have_attribute('transform', pin)
    page.locator('#siteTerrainMode').click()
    expect(page.locator('#siteTerrainEmpty')).to_be_visible()
    assert not tile_requests, 'Terrain was requested before the placement step'

    # No vector map service is required to show the river and excavations in the supplied plans.
    page.locator('#loadSite').click()
    expect(page.locator('#siteStatus')).to_contain_text('Mapzen Terrain Tiles', timeout=20000)
    expect(page.locator('#sitePlacementStatus')).to_contain_text('Ground at pin 1040.0 m')
    expect(page.locator('#siteWaterStatus')).to_contain_text('Bow River study level 1040.0 m')
    expect(page.locator('#siteWaterStatus')).to_contain_text('Approximate plan registration')
    expect(page.locator('#siteTerrainEmpty')).to_be_hidden()
    expect(page.locator('#siteCanvas')).to_be_visible()
    verify_plan(page, '#sitePlan')
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

    page.locator('#openDrawings').click()
    include_site = page.locator('#drawingSite')
    expect(include_site).to_be_enabled()
    include_site.check()
    page.wait_for_function('window.drawingIncludesTerrain')
    expect(page.locator('#exportDrawing')).to_be_enabled()
    include_site.uncheck()
    page.wait_for_function('window.drawingIncludesTerrain === false')
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
    expect(page.locator('#siteWaterStatus')).to_contain_text('Matched at two Bow River crossings')
    assert elevation_requests == [100, 100, 89], elevation_requests
    page.locator('#siteVegetation').check()
    expect(page.locator('#siteWaterStatus')).to_contain_text('Mapped vegetation is shown.')
    page.locator('#siteVegetation').uncheck()
    page.route(fallback, lambda route: route.abort())
    page.locator('#loadSite').click()
    expect(page.locator('#siteStatus')).to_contain_text('previous elevation surface is still shown')
    expect(page.locator('#siteCanvas')).to_be_visible()
    page.locator('#sitePlaceMode').click()
    expect(footprint).to_have_attribute('transform', pin)
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
