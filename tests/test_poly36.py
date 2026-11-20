from pathlib import Path
import os, shutil
import xml.etree.ElementTree as ET
from playwright.sync_api import expect, sync_playwright

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

root=Path(__file__).resolve().parents[1]; src=root/'index.html'; out=root/'tests'/'output'; out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,args=['--no-sandbox','--disable-dev-shm-usage','--disable-webgl'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 page.set_content(src.read_text(),wait_until='domcontentloaded',timeout=30000)
 page.wait_for_function("typeof model !== 'undefined' && model && model.total > 0",timeout=30000)
 page.evaluate("state.animateSwing=false;state.simRunning=false;refreshView();")
 baseline=page.evaluate("({cap:state.areaCap,area:model.total,seed:state.seed,rooms:model.rooms.length,modules:model.count,score:crossRate(occupancy),state:JSON.stringify(state),geometry:exportGeometry(model).objects.length})")
 print('baseline', {k:v for k,v in baseline.items() if k!='state'},flush=True)
 page.locator('#openRationale').click(); page.wait_for_timeout(200)
 assert page.locator('#designRationale').is_visible() and not page.locator('.layout').is_visible()
 assert page.locator('.dr-svg').count()>=8
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
 assert page.get_by_role('heading', name='Compare structure and cladding.').is_visible()
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
 assert decisions.get_by_text('The designer added this through-route', exact=False).is_visible()
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
 page.get_by_role('button', name='View from northeast').click()
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingLinework').get_attribute('d') != before_compass
 page.locator('#drawingRendering').select_option('combined')
 expect(drawing_export).to_be_enabled()
 assert page.locator('#drawingSheet image').get_attribute('href').startswith('data:image/png')
 page.locator('#drawingRendering').select_option('linework')
 page.locator('#drawingView').select_option('elevation')
 page.get_by_role('button', name='View from northeast').click()
 expect(page.locator('#drawingOrbit')).to_have_value('45')
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
 page.locator('#drawingPlanSheet').select_option('single')
 page.locator('#drawingPaper').select_option('tabloid')
 page.locator('#drawingOrientation').select_option('portrait')
 page.locator('#drawingScale').select_option('1000')
 expect(drawing_export).to_be_enabled()
 with page.expect_download() as saved_drawing:
  drawing_export.click()
 drawing_svg = ET.parse(saved_drawing.value.path()).getroot()
 assert drawing_svg.attrib['width'] == '11in' and drawing_svg.attrib['height'] == '17in'
 assert '1:1000 · Tabloid' in ''.join(drawing_svg.itertext())
 page.locator('#openBuild').click()
 expect(page.locator('#buildCanvas')).to_be_visible()
 check_horizontal_pan(page, 'buildCanvas')
 before_walls = page.locator('#buildCanvas').evaluate('(canvas) => canvas.toDataURL()')
 page.locator('#buildWalls').check()
 assert page.locator('#buildCanvas').evaluate('(canvas) => canvas.toDataURL()') != before_walls
 page.locator('#buildFacade').check()
 dock_structure = page.locator('#buildDockStructure')
 expect(dock_structure.locator('option')).to_have_count(8)
 dock_structure.select_option('deep-box')
 expect(page.locator('#dockStructureNote')).to_contain_text('where the frame enters grade or the bay below')
 dock_structure.select_option('cable-stayed')
 expect(page.locator('#dockStructureNote')).to_contain_text('anchors two storeys higher')
 page.locator('#buildLevel').select_option('1')
 page.locator('#buildFit').click()
 page.locator('#openDrawings').click()
 page.locator('#drawingSource').select_option('build')
 expect(drawing_export).to_be_enabled()
 page.locator('#drawingPlaneAxis').select_option('vertical')
 page.locator('#drawingPlaneOffset').fill('5')
 page.locator('#drawingPlaneOffset').press('Tab')
 page.locator('#centerDrawingPlane').click()
 expect(page.locator('#drawingPlaneOffset')).to_have_value('0')
 page.locator('#openMassing').click()
 assert page.evaluate('JSON.stringify({state, camera})') == before_drawing
 print('desktop navigation, imagery, unchanged model + state, variation passed',flush=True)
 mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
 mobile.on('pageerror',lambda err:errors.append(str(err)))
 mobile.set_content(src.read_text(),wait_until='domcontentloaded',timeout=30000)
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
