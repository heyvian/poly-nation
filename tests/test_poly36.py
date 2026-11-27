"""Exercise the app's workspaces and export paths with Chromium's software canvas."""

from pathlib import Path
import os, shutil
import xml.etree.ElementTree as ET
from playwright.sync_api import expect, sync_playwright
from browser_fixture import serve_lab

def check_horizontal_pan(page, canvas_id):
 canvas = page.locator('#' + canvas_id)
 bounds = canvas.bounding_box()
 x, y = bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2
 before = canvas.evaluate('(el) => el.toDataURL()')
 page.mouse.move(x, y)
 page.mouse.down(button='right')
 page.mouse.move(x+40, y, steps=3)
 page.mouse.up(button='right')
 page.wait_for_function('([id, before]) => document.getElementById(id).toDataURL() !== before',
                        arg=[canvas_id, before])

def check_fit(page):
 for button in ['axo', 'plan', 'side']:
  page.locator('#' + button).click()
  angles = page.evaluate('[camera.az, camera.el]')
  page.locator('#fit').click()
  size = page.evaluate("""() => {
    const {width, height} = canvas.getBoundingClientRect();
    const basis = orbitBasis(camera);
    const {half} = modelProjection(softwareMesh, camera, width / height);
    const {minX, maxX, minY, maxY} = projectedModelBounds(softwareMesh, basis);
    const scale = height / (2 * half);
    return [
      width / 2 + (minX - camera.panX) * scale,
      height / 2 - (maxY - camera.pan) * scale,
      width / 2 + (maxX - camera.panX) * scale,
      height / 2 - (minY - camera.pan) * scale,
      width,
      height
    ];
  }""")
  left, top, right, bottom, width, height = size
  assert 0 < left < right < width and 0 < top < bottom < height, size
  assert max((right-left)/width, (bottom-top)/height) > 0.58, size
  assert page.evaluate('[camera.az, camera.el]') == angles
 page.locator('#axo').click()
 page.locator('#fit').click()

root=Path(__file__).resolve().parents[1]; out=root/'tests'/'output'; out.mkdir(exist_ok=True)
with serve_lab(root) as url, sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,args=['--no-sandbox','--disable-dev-shm-usage','--disable-webgl'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 page.goto(url + '/',wait_until='domcontentloaded',timeout=30000)
 page.wait_for_function("typeof model !== 'undefined' && model && model.total > 0",timeout=30000)
 page.evaluate("state.animateSwing=false;state.simRunning=false;refreshView();")
 baseline=page.evaluate("({cap:state.areaCap,area:model.total,seed:state.seed,rooms:model.rooms.length,modules:model.count,score:crossRate(occupancy),state:JSON.stringify(state),geometry:exportGeometry(model).objects.length})")
 print('baseline', {k:v for k,v in baseline.items() if k!='state'},flush=True)
 page.locator('#openRationale').click(); page.wait_for_timeout(200)
 assert page.locator('#designRationale').is_visible() and not page.locator('.layout').is_visible()
 assert page.locator('.dr-svg').count()>=8
 assert page.locator('.dr-slide').evaluate_all('(slides) => slides.every(slide => slide.querySelector("svg, img"))')
 assert page.locator('.dr-hero-image img').evaluate('(im)=>im.complete && im.naturalWidth>0')
 page.get_by_role('link', name='Atrium and roofline').click()
 decisions = page.locator('#drAtrium')
 assert decisions.get_by_role('heading', name='Opposing lobby atriums').is_visible()
 assert decisions.get_by_role('heading', name='Radial and vertically aligned bridges').is_visible()
 assert decisions.get_by_role('heading', name='Pitched glass roof and two-storey pavilions').is_visible()
 assert '40 km/h' not in page.locator('#dr06').inner_text()
 page.screenshot(path=str(out/'rationale-preview.png'))
 page.get_by_role('link', name='10 Placement').click()
 assert page.get_by_role('heading', name='Where programs meet the ring.').is_visible()
 assert page.locator('#dr10 img').evaluate('(im)=>im.complete && im.naturalWidth>0')
 page.get_by_role('link', name='11 Materials').click()
 assert page.get_by_role('heading', name='Give the frame and the enclosure different lives.').is_visible()
 assert not page.locator('#dr10').is_visible()
 assert page.locator('#dr11 img').evaluate_all('(images)=>images.length===2 && images.every(image=>image.complete && image.naturalWidth>0)')
 assert page.get_by_role('link', name='12 Record').get_attribute('href') == '#dr12'
 page.locator('.dr-nav a[href="#dr08"]').click();page.wait_for_timeout(200);page.screenshot(path=str(out/'score-rationale.png'))
 page.locator('#openMassing').click();page.wait_for_timeout(250)
 assert page.locator('.layout').is_visible() and not page.locator('#designRationale').is_visible()
 after=page.evaluate("({cap:state.areaCap,area:model.total,seed:state.seed,rooms:model.rooms.length,modules:model.count,score:crossRate(occupancy),state:JSON.stringify(state),geometry:exportGeometry(model).objects.length})")
 assert baseline==after,(baseline,after)
 page.locator('#openMaterials').click()
 assert page.locator('#materialsPhase').is_visible() and not page.locator('.layout').is_visible()
 assert page.locator('.material-rationale summary').is_visible()
 assert page.locator('#openMaterials').get_attribute('aria-current') == 'page'
 page.locator('#openRationale').click()
 assert page.locator('#designRationale').is_visible()
 assert page.locator('#dr08').is_visible()
 page.get_by_role('link', name='Atrium and roofline').click()
 assert decisions.get_by_text('opportunities for indoor and outdoor visitors to meet', exact=False).is_visible()
 page.locator('#drBack').click()
 assert page.locator('#materialsPhase').is_visible()
 page.locator('#openMassing').click()
 assert page.locator('.layout').is_visible() and not page.locator('#materialsPhase').is_visible()
 assert page.evaluate('JSON.stringify(state)') == baseline['state']
 bridges = page.locator('#design-panel-0').get_by_label('Atrium bridges', exact=True)
 assert bridges.is_visible() and bridges.input_value() == 'off'
 view = page.evaluate('JSON.stringify({ inspect: state.inspect, camera })')
 for value, count in [('radial', 3), ('aligned', 3), ('off', 0)]:
  bridges.select_option(value)
  page.wait_for_function(f'!pending && model.circulation.bridges.length === {count}')
  assert page.evaluate('JSON.stringify({ inspect: state.inspect, camera })') == view
 page.evaluate('state.simRunning=true; refreshView()')
 start_clock = page.evaluate('occupancy.clock')
 page.locator('#openMaterials').click()
 page.wait_for_function(f'occupancy.clock > {start_clock}')
 check_horizontal_pan(page, 'materialsCanvas')
 page.locator('#openMassing').click()
 page.evaluate('state.simRunning=false; refreshView()')
 page.locator('#shuffle').click();page.wait_for_function(f'state.seed!=={baseline["seed"]} && pending===0')
 page.wait_for_timeout(200)
 assert page.evaluate('model.total<=state.areaCap+1e-5')
 check_horizontal_pan(page, 'canvas')
 check_fit(page)
 page.screenshot(path=str(out/'model-preview.png'))
 before_drawing = page.evaluate('JSON.stringify({state, camera})')
 page.locator('#openDrawings').click()
 drawing_export = page.locator('#exportDrawing')
 expect(drawing_export).to_be_enabled()
 before_compass = page.locator('#drawingLinework').get_attribute('d')
 north = page.locator('#drawingSheet [data-north-arrow] > g')
 before_north = north.get_attribute('transform')
 page.get_by_role('button', name='View from northeast').click()
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingLinework').get_attribute('d') != before_compass
 assert north.get_attribute('transform') != before_north
 page.get_by_text('Line weights', exact=True).click()
 silhouette = page.locator('#drawingSilhouette')
 outlines = page.locator('#drawingComponentOutlines')
 silhouette_path = page.locator('#drawingSheet [data-layer="Overall silhouette"] path')
 outline_path = page.locator('#drawingSheet [data-layer="Component outlines"] path')
 silhouette.check()
 expect(silhouette_path).to_be_visible()
 expect(outline_path).to_have_count(0)
 outlines.check()
 expect(outline_path).to_be_visible()
 expect(page.locator('#drawingPenMode')).to_have_value('distance')
 expect(drawing_export).to_be_enabled()
 with page.expect_download() as saved_outlines:
  drawing_export.click()
 outline_svg = ET.parse(saved_outlines.value.path()).getroot()
 outline_layers = {group.get('data-layer'): group for group in outline_svg if group.get('data-layer')}
 assert {'Overall silhouette', 'Component outlines'} <= outline_layers.keys()
 silhouette.uncheck()
 expect(silhouette_path).to_have_count(0)
 expect(outline_path).to_be_visible()
 outlines.uncheck()
 page.locator('#drawingRendering').select_option('combined')
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingSheet image').get_attribute('href').startswith('data:image/png')
 page.locator('#drawingPenStyle').select_option('sketch')
 expect(drawing_export).to_be_enabled()
 with page.expect_download() as saved_hybrid:
  drawing_export.click()
 hybrid = ET.parse(saved_hybrid.value.path()).getroot()
 layers = {group.get('data-layer'): group for group in hybrid if group.get('data-layer')}
 assert {'Paper', 'Colour fills', 'Construction lines', 'Pencil marks', 'Surface texture', 'Title and scale'} <= layers.keys()
 assert all(group.get('id', '').startswith('PN_') for group in layers.values())
 assert not hybrid.findall('.//{*}image')
 assert len({path.get('fill') for path in layers['Colour fills'].findall('.//{*}path')}) > 10
 assert any('Q' in path.get('d') for path in layers['Pencil marks'].findall('.//{*}path'))
 assert len({path.get('stroke-width') for path in next(group for label, group in layers.items() if label.startswith('Pen ')).findall('.//{*}path')}) > 1
 page.locator('#drawingPenStyle').select_option('standard')
 page.locator('#drawingRendering').select_option('linework')
 # Compare the width in physical page units at two scales, then check the adaptive SVG.
 scale = page.locator('#drawingScale')
 adapt = page.locator('#drawingAdaptWeights')
 heaviest = page.locator('#drawingSheet [data-layer^="Pen 1 ·"]')
 expect(adapt).not_to_be_checked()
 for denominator in ['50', '2000']:
  scale.select_option(denominator)
  expect(page.locator('#drawingSheet [data-scale-ratio]')).to_have_text(f'1:{denominator}')
  expect(heaviest).to_have_attribute('data-weight-mm', '0.5')
 adapt.check()
 expect(heaviest).to_have_attribute('data-weight-mm', '0.3')
 expect(drawing_export).to_be_enabled()
 with page.expect_download() as adaptive_svg:
  drawing_export.click()
 adaptive_drawing = ET.parse(adaptive_svg.value.path()).getroot()
 pen_group = next(group for group in adaptive_drawing if group.get('data-layer') == 'Pen 1 · 0.30 mm')
 assert all(abs(float(path.get('stroke-width')) * 25.4 / 88 - 0.3) < 1e-8 for path in pen_group.findall('.//{*}path'))
 scale.select_option('50')
 expect(heaviest).to_have_attribute('data-weight-mm', '0.68')
 scale.select_option('250')
 expect(heaviest).to_have_attribute('data-weight-mm', '0.5')
 adapt.uncheck()
 page.locator('#drawingView').select_option('elevation')
 page.get_by_role('button', name='View from northeast').click()
 expect(page.locator('#drawingOrbit')).to_have_value('45')
 expect(north).to_have_count(0)
 page.locator('#groundDrawing').click()
 expect(drawing_export).to_be_enabled()
 page.locator('#drawingScale').select_option('250')
 expect(drawing_export).to_be_enabled()
 before_pan = page.locator('#drawingLinework').get_attribute('d')
 sheet = page.locator('#drawingSheet')
 sheet.press('Shift+ArrowUp')
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingLinework').get_attribute('d') != before_pan
 page.locator('#fitDrawing').click()
 expect(page.locator('#drawingScale')).to_have_value('auto')
 page.locator('#drawingView').select_option('plan')
 page.locator('#addDrawingPlane').click()
 expect(drawing_export).to_be_enabled()
 ground_cut = page.locator('#drawingSections').get_attribute('d')
 assert ground_cut
 page.locator('#drawingPlaneOffset').fill('6')
 page.locator('#drawingPlaneOffset').press('Tab')
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingSections').get_attribute('d') != ground_cut
 page.locator('#drawingFloor').select_option('1')
 page.locator('#drawingPlaneOffset').fill('1.2')
 page.locator('#drawingPlaneOffset').press('Tab')
 page.locator('#drawingFloor').select_option('2')
 expect(page.locator('#drawingPlaneOffset')).to_have_value('1.2')
 page.locator('#drawingPlanSheet').select_option('floors')
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingSheet text').filter(has_text='Level 2 · Cut 5.40 m').count() == 1
 with page.expect_download() as saved_plans:
  drawing_export.click()
 floor_sheet = ET.parse(saved_plans.value.path()).getroot()
 floor_labels = next(layer for layer in floor_sheet if layer.get('data-layer') == 'Floor labels')
 assert len(floor_labels.findall('{*}text')) == 4
 assert len(floor_sheet.findall('./{*}defs/{*}clipPath')) == 4
 page.locator('#drawingPlanSheet').select_option('single')
 page.locator('#drawingPaper').select_option('tabloid')
 page.locator('#drawingOrientation').select_option('portrait')
 page.locator('#drawingScale').select_option('1000')
 expect(drawing_export).to_be_enabled()
 with page.expect_download() as saved_drawing:
  drawing_export.click()
 drawing_svg = ET.parse(saved_drawing.value.path()).getroot()
 assert drawing_svg.attrib['width'] == '11in' and drawing_svg.attrib['height'] == '17in'
 assert drawing_svg.find('.//{*}text[@data-scale-ratio="1000"]').text == '1:1000'
 assert 'Tabloid' not in ''.join(drawing_svg.itertext())
 bar = drawing_svg.find('.//{*}line[@data-scale-metres="20"]')
 assert abs((float(bar.get('x2')) - float(bar.get('x1'))) * 25.4 / 88 - 20) < 1e-8
 assert drawing_svg.find('.//{*}g[@data-north-arrow]/{*}text').text == 'N'
 # A vector editor must be able to control the drawing layers independently.
 drawing_layers = {group.get('data-layer') for group in drawing_svg if group.get('data-layer')}
 assert {'Paper', 'Title and scale'} <= drawing_layers
 assert not (drawing_layers & {'Colour fills', 'Construction lines', 'Pencil marks'})
 assert sum(label.startswith('Pen ') for label in drawing_layers) == 3
 page.locator('#openBuild').click()
 expect(page.locator('#buildCanvas')).to_be_visible()
 check_horizontal_pan(page, 'buildCanvas')
 before_walls = page.locator('#buildCanvas').evaluate('(canvas) => canvas.toDataURL()')
 page.locator('#buildWalls').check()
 assert page.locator('#buildCanvas').evaluate('(canvas) => canvas.toDataURL()') != before_walls
 page.locator('#buildFacade').check()
 dock_structure = page.locator('#buildDockStructure')
 expect(dock_structure.locator('option')).to_have_count(6)
 dock_structure.select_option('cable-stayed')
 expect(page.locator('#dockStructureNote')).to_contain_text('top of its own storey')
 before_heights = page.evaluate('''() => ({
   ground: buildStorey(model, 0).base, clear: buildStorey(model, 0).soffit - buildStorey(model, 0).base,
   roof: model.roofPlan.y
 })''')
 page.locator('#buildSlabThickness').select_option('0.3')
 expect(page.locator('#buildStoreyNote')).to_contain_text('4.28 m floor to floor · 3.98 m typical clear')
 assert page.evaluate('''({ground, clear, roof}) => {
   const floor = buildStorey(model, 0);
   return Math.abs(floor.base - ground) < 1e-8 && Math.abs(floor.soffit - floor.base - clear) < 1e-8 &&
     Math.abs(model.roofPlan.y - roof - model.layers.length * 0.08) < 1e-8;
 }''', before_heights)
 expect(page.locator('#buildEstimate')).to_contain_text('300 mm')
 page.get_by_text('Dock and slab estimates', exact=True).click()
 page.locator('#buildWaterDepth').fill('1.5')
 expect(page.locator('#buildEstimate')).to_contain_text('adds 14.7 kPa')
 page.locator('#buildModules').uncheck()
 page.locator('#buildLevel').select_option('1')
 page.locator('#buildFit').click()
 page.locator('#openDrawings').click()
 page.locator('#drawingSource').select_option('build')
 expect(drawing_export).to_be_enabled()
 expect(page.locator('#drawingFloor option[value="1"]')).to_have_text('Level 2 · 4.28 m')
 page.locator('#drawingPlaneAxis').select_option('vertical')
 page.locator('#drawingPlaneOffset').fill('5')
 page.locator('#drawingPlaneOffset').press('Tab')
 page.locator('#centerDrawingPlane').click()
 expect(page.locator('#drawingPlaneOffset')).to_have_value('0')
 detail = page.locator('#drawingDetail')
 detail.select_option('support')
 expect(page.locator('#drawingSheet [data-scale-ratio]')).to_have_text('1:25')
 expect(page.locator('#drawingSheet').get_by_text('Tensioner and locknuts')).to_be_visible()
 detail.select_option('services')
 expect(page.locator('#drawingSheet [data-layer="Service routes"] polyline')).to_have_count(3)
 page.locator('#drawingDocument').select_option('programme')
 expect(page.locator('#documentPages .study-programme-axos svg')).to_have_count(4)
 expect(page.locator('#documentPages .study-programme-exploded svg')).to_have_count(1)
 pairs = page.locator('#documentPages .study-plan-pair')
 plan_counts = pairs.evaluate_all('pairs => pairs.map(pair => pair.querySelectorAll("svg").length)')
 plan_count = page.evaluate('model.layers.length + 1')
 assert plan_counts == [2] * (plan_count // 2) + ([1] if plan_count % 2 else [])
 assert page.locator('#documentPages table tbody tr').count() == page.locator('#schedule tr').count()
 page.locator('#openMassing').click()
 assert page.evaluate('JSON.stringify({state: {...state, slabThickness: 0.22}, camera})') == before_drawing
 print('desktop navigation, imagery, unchanged model + state, variation passed',flush=True)
 mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
 mobile.on('pageerror',lambda err:errors.append(str(err)))
 mobile.goto(url + '/',wait_until='domcontentloaded',timeout=30000)
 mobile.wait_for_function("typeof model !== 'undefined' && model")
 mobile.evaluate('state.animateSwing=false;state.simRunning=false;refreshView()')
 mobile.locator('#openRationale').click();mobile.wait_for_timeout(100)
 assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
 mobile.screenshot(path=str(out/'rationale-mobile.png'))
 mobile.locator('#drBack').click();assert mobile.locator('.layout').is_visible()
 mobile.locator('#openMaterials').click()
 assert mobile.locator('#materialsPhase').is_visible()
 assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
 mobile.locator('#openMassing').click()
 assert mobile.locator('.layout').is_visible()
 assert mobile.get_by_label('Atrium bridges', exact=True).is_visible()
 mobile.get_by_label('Atrium bridges', exact=True).select_option('aligned')
 mobile.wait_for_function('!pending && model.circulation.bridges.length === 3')
 assert mobile.evaluate('state.inspect === 0 && document.documentElement.scrollWidth <= innerWidth+1')
 check_fit(mobile)
 mobile.locator('#openDrawings').click()
 expect(mobile.locator('#exportDrawing')).to_be_enabled()
 assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
 print('mobile width and navigation passed; errors',errors,flush=True)
 assert not errors
 browser.close()
