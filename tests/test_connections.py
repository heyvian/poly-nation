"""Exercise exterior fitting sheets, vector export, and depth-tested architectural linework."""

import os
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


root = Path(__file__).resolve().parents[1]
fittings = {
    'side-truss': ('Chord end plate', 'Web gusset'),
    'side-portal': ('Moment end plate', 'Rigid post junction'),
    'box-floor': ('Full-depth end plate', 'Dock seat and keeper'),
    'cable-stayed': ('Pinned fork socket', 'Enclosed stay tensioner'),
    'roof-hung': ('Hanger head', 'Threaded bar coupler'),
    'columns': ('Tip post cap', 'Post base plate'),
}

with serve_lab(root) as url, sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH')
                               or shutil.which('chromium') or None,
                               args=['--no-sandbox', '--disable-webgl'])
    page = browser.new_page(viewport={'width': 1400, 'height': 940})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/')
    page.evaluate('state.simRunning = state.animateSwing = false')
    assert page.evaluate('''() => {
      const camera = {az: Math.PI / 2, el: 0};
      const facade = (x, y, offset = 0) => [x, y, (x + 80) * 0.017 + offset];
      const points = [facade(-80,-40), facade(80,-40), facade(80,40), facade(-80,40),
        facade(-55,0,-0.065), facade(55,0,-0.065), facade(-55,9), facade(55,9)];
      const face = { normal: [0,0,1], color: [0.8,0.8,0.8] };
      const geometry = {points, edges: [], faces: [{...face, vertices:[0,1,2]},
        {...face, vertices:[0,2,3]}], lines: [{a:4,b:5,component:'core'}, {a:6,b:7,component:'core'}]};
      // The rear edge is 65 mm back. The former pixel-sized bias revealed it at 1:2000.
      const result = renderDrawing(geometry, camera, [], {width: 11,height: 8.5},
        2000, false, {x: 0,y: 0}, false, drawingPens());
      const ink = result.ink.flat().join('');
      const frontY = (result.originY - 9 * result.scale).toFixed(1);
      return (ink.match(/M/g) || []).length === 1 && ink.includes(' ' + frontY);
    }''')

    for system, expected in fittings.items():
        page.locator('#openBuild').click()
        page.locator('#buildDockStructure').select_option(system)
        page.locator('#openDrawings').click()
        page.locator('#drawingDetail').select_option('support')
        page.locator('#drawingOrientation').select_option('portrait')
        sheet = page.locator('#drawingSheet')
        views = sheet.locator('[data-layer="Fitting elevations"] [data-fitting]')
        expect(views).to_have_count(2)
        for view, name in zip(views.all(), expected):
            expect(view).to_have_attribute('data-fitting', name)
        assert views.evaluate_all('''nodes => nodes.every(node =>
            node.querySelectorAll('polygon, circle').length >= 3 &&
            node.querySelectorAll('polygon, circle, line').length >= 8 &&
            !node.querySelector('[stroke-dasharray]'))'''), system
        expect(sheet.locator('[data-scale-ratio]')).to_have_text('1:25')
        if system == 'cable-stayed':
            expected_force = page.evaluate('Math.round(dockSupportDemand(model, {}, "cable-stayed").stayTension)')
            expect(sheet.get_by_text(f'{expected_force:,} kN tension per stay')).to_be_visible()
            expect(sheet.get_by_text('1:10')).to_have_count(2)
            page.locator('#drawingOrientation').select_option('landscape')
            expect(views).to_have_count(2)
            expect(page.locator('#exportDrawing')).to_be_enabled()
            with page.expect_download() as download:
                page.locator('#exportDrawing').click()
            svg = ET.parse(download.value.path()).getroot()
            svg_layers = {node.get('data-layer') for node in svg}
            assert {'Connection linework', 'Fitting elevations', 'Dimensions and notes'} <= svg_layers
            assert not [node for node in svg.iter() if node.get('stroke-dasharray')]
            page.locator('#drawingDetail').select_option('root')
            expect(sheet.get_by_text('compression into core', exact=False)).to_be_visible()
            page.locator('#drawingDetail').select_option('services')
            expect(sheet.locator('[data-layer="Service routes"] polyline')).to_have_count(3)
            expect(views.first).to_have_attribute('data-fitting', 'Module seat')
        if system == 'roof-hung':
            expect(sheet.get_by_text('tension per upper rod', exact=False)).to_be_visible()

    page.locator('#drawingDocument').select_option('structure')
    expect(page.get_by_role('heading', name='Structure · Dock fittings')).to_be_visible()
    expect(page.locator('#documentPages [data-fitting]')).to_have_count(2)
    assert not errors, errors
    print('Visible strokes, all six dock fitting systems, layer export, service routes and structural document passed.')
