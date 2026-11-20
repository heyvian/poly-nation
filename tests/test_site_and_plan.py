"""Verify overhead cameras and West Village alignment with deterministic map responses."""

import os
import shutil
import struct
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

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
    errors = []
    requests = []
    tile = terrarium_tile(1040)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://s3.amazonaws.com/elevation-tiles-prod/**',
               lambda route: route.fulfill(body=tile, content_type='image/png'))
    page.route('https://overpass-api.de/api/interpreter?*', lambda route: route.fulfill(status=503))

    def mapped_features(route):
        requests.append(route.request.url)
        route.fulfill(json={'elements': features})

    mirror = 'https://overpass.private.coffee/api/interpreter?*'
    official = 'https://api.openstreetmap.org/api/0.6/map?*'
    page.route(mirror, mapped_features)
    page.goto(url + '/')
    page.evaluate('''() => {
      state.simRunning = state.animateSwing = false;
      const paint = paintSoftware;
      paintSoftware = (...args) => {
        window.projectedPlan = {...args[2]};
        return paint(...args);
      };
    }''')
    verify_plan(page, '#plan')
    page.locator('#openMaterials').click()
    verify_plan(page, '#materialPlan')
    page.locator('#openBuild').click()
    verify_plan(page, '#buildPlan')
    page.locator('#openSite').click()
    verify_plan(page, '#sitePlan')

    page.locator('#loadWestVillage').click()
    expect(page.locator('#siteStatus')).to_contain_text('Centre 1040.0 m elevation')
    expect(page.locator('#siteNaturalStatus')).to_have_text('4 mapped natural features. Bow River.')
    expect(page.locator('#siteWaterStatus')).to_contain_text('share a 1040.0 m study plane', timeout=15000)
    expect(page.locator('#siteCanalLegend')).to_be_visible()
    expect(page.locator('#loadSite')).to_be_enabled()
    assert len(requests) == 1, requests
    assert page.evaluate('''async (elements) => {
      const terrain = {location: {latitude: 51.049, longitude: -114.103},
        size: 2200, count: 2, datum: 1042, elevations: [1044, 1044, 1044, 1044]};
      const water = await alignWestVillageWater(elements, terrain, async () => 1040);
      const natural = siteNaturalOverlay(elements, terrain);
      const mesh = siteAssemblyMesh({...meshBuilder(), H: 0, extent: 0}, terrain, 0, 0, natural, water);
      const groups = mesh.groups;
      const volumes = groups.filter(group => group.layer.endsWith('shared study water plane'));
      const sharedPlane = volumes.length === 2 && volumes.every(group => {
        const end = groups[groups.indexOf(group) + 1].solid;
        return end > group.solid &&
          mesh.solid.slice(group.solid, end).filter((_, i) => i % 10 === 1).every(y => y === -2);
      });
      const cut = terrainOutsideSiteWater([[0,2,0], [6,2,0], [0,2,6]], siteWaterStudy(terrain,
        {level: 1040, existing: [], proposed: [[[0,0], [6,0], [0,6]]]}, 1).index[0]);
      // The entire land triangle is water: any remaining fragments must have zero area.
      const area = cut.reduce((sum, polygon) => sum + Math.abs(polygon.reduce((twice, p, i) => {
        const q = polygon[(i+1)%polygon.length];
        return twice + p[0]*q[2] - q[0]*p[2];
      }, 0)), 0);
      return sharedPlane && area < 1e-6 &&
        mesh.groups.some(group => group.layer === 'OpenStreetMap mapped trees');
    }''', features)
    verify_plan(page, '#sitePlan')

    page.locator('#siteContours').uncheck()
    assert len(requests) == 1, 'Contours caused another map request'
    assert page.evaluate('''() => {
      const terrain = {size: 80, count: 2, datum: 1040, elevations: [1040, 1048, 1040, 1048]};
      const building = {...meshBuilder(), H: 0, extent: 0};
      const withLines = siteAssemblyMesh(building, terrain, 0, 0);
      const withoutLines = siteAssemblyMesh(building, terrain, 0, 0, null, null, false);
      return withLines.lines.length > 0 && !withoutLines.lines.length &&
        withLines.solid.join() === withoutLines.solid.join();
    }''')

    page.reload()
    expect(page.locator('#sitePhase')).to_be_visible()
    expect(page.locator('#siteContours')).not_to_be_checked()
    expect(page.locator('#siteWaterStatus')).to_contain_text('share a 1040.0 m study plane', timeout=15000)
    page.route(mirror, lambda route: route.abort())
    page.route(official, lambda route: route.fulfill(body=osm_xml(features), content_type='application/xml'))
    page.locator('#loadSite').click()
    expect(page.locator('#siteNaturalStatus')).to_have_text('4 mapped natural features. Bow River.')
    expect(page.locator('#siteWaterStatus')).to_contain_text('share a 1040.0 m study plane', timeout=15000)
    page.route(official, lambda route: route.abort())
    page.locator('#loadSite').click()
    expect(page.locator('#siteNaturalStatus')).to_have_text('OpenStreetMap is unavailable. The elevation terrain is ready.')
    expect(page.locator('#siteCanalLegend')).to_be_hidden()
    expect(page.locator('#siteStatus')).to_contain_text('Centre 1040.0 m elevation')
    page.goto(url + '/Design_Rationale.html')
    expect(page.locator('.dr-slide:visible')).to_have_count(1)
    page.locator('#drNext').press('ArrowRight')
    expect(page.locator('#drSite')).to_be_visible()
    assert not errors, errors
    print('Overhead plans, Overpass and OSM XML fallback, canal grade, contour preference and rationale passed.')
