from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import shutil
from threading import Thread
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
handler = partial(SimpleHTTPRequestHandler, directory=root)
with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server, sync_playwright() as p:
    Thread(target=server.serve_forever, daemon=True).start()
    b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--disable-webgl'])
    page=b.new_page(viewport={'width':1280,'height':720})
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/')
    page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
    start=page.evaluate('({seed:state.seed,count:model.count,core:model.core.slice(),modules:model.counts.slice()})')
    expect(page.get_by_role('heading', name='Poly Nation Cross Pollination Laboratory')).to_be_visible()
    page.locator('#openMaterials').click()
    expect(page.locator('#materialStructure [data-material=clt]')).to_have_text('CLT')
    expect(page.locator('#materialFacade [data-material=charred-wood]')).to_have_text('Charred wood')
    expect(page.locator('#materialsPhase')).to_be_visible()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 606')
    schedule = page.locator('#materialAssemblies')
    detail = page.locator('#assemblyDetail')
    core = page.locator('#assembly-core button')
    firehall = page.locator('#assembly-2 button')
    expect(schedule).to_be_visible()
    expect(page.locator('#assemblyCards .assembly-card')).to_have_count(6)
    expect(page.locator('#materialScope option[value=module]')).to_have_count(0)
    expect(detail).to_be_hidden()
    def assert_workspace_fits():
        assert page.evaluate("""() => {
          const model = document.querySelector('.material-model');
          const board = document.querySelector('.material-board').getBoundingClientRect();
          return model.scrollHeight <= model.clientHeight + 1 &&
            model.scrollWidth <= model.clientWidth + 1 && board.bottom <= innerHeight + 1 &&
            document.querySelector('#materialsCanvas').clientHeight >= 180;
        }""")

    expect(page.locator('#materialsCanvas')).to_be_visible()
    assert_workspace_fits()
    core.click()
    assert_workspace_fits()
    expect(detail.locator('canvas')).to_have_attribute('aria-label', 'Core ring, exploded axonometric. Cast-in-place reinforced concrete structure and Architectural concrete cladding.')
    expect(detail).to_contain_text('420 kg/m² floor')
    expect(detail).to_contain_text('72 kg/m² wall')
    core.click()
    expect(detail).to_be_hidden()
    firehall.click()
    expect(page.locator('#materialScope')).to_have_value('moduleProgram')
    expect(page.locator('#materialTarget')).to_have_value('2')
    expect(page.locator('#assembly-2')).to_have_attribute('data-editing', 'true')
    expect(page.locator('#assembly-core')).to_have_attribute('data-editing', 'false')
    page.locator('#materialScope').select_option('building')
    page.wait_for_function("document.querySelector('#materialsCanvas').width>600")

    def choose(field, material):
        page.locator(f'#{field} [data-material="{material}"]').click()

    initial = page.locator('#materialsCanvas').evaluate('(canvas)=>canvas.toDataURL()')
    choose('materialFacade', 'cedar')
    page.wait_for_function("(before)=>document.querySelector('#materialsCanvas').toDataURL()!==before",arg=initial)
    choose('materialStructure', 'clt')
    page.locator('#materialScope').select_option('modules')
    choose('materialStructure', 'space-frame')
    page.locator('#materialScope').select_option('moduleProgram')
    page.locator('#materialTarget').select_option('2')
    choose('materialFacade', 'brick')
    expect(detail).to_contain_text('Brick veneer')
    expect(detail).to_contain_text('Triangulated load paths')
    page.locator('#materialScope').select_option('coreProgram')
    page.locator('#materialTarget').select_option('3')
    choose('materialFacade', 'vinyl')
    expect(page.locator('#assembly-core')).to_have_attribute('data-editing', 'true')
    assert page.evaluate("""() => {
      const {assignments} = JSON.parse(localStorage.getItem('poly-nation-material-study-v1'));
      return materialValues(assignments, 'core', 3).facade === 'vinyl' &&
        materialValues(assignments, 'module', 2).facade === 'brick' &&
        materialValues(assignments, 'module', 2).structure === 'space-frame';
    }""")
    page.locator('#materialAnalysisView').click()
    assert_workspace_fits()
    expect(page.locator('#materialsCanvas')).to_be_visible()
    expect(page.locator('#materialBuildingSummary')).to_contain_text('tonnes')
    expect(page.locator('#materialStructuralSummary')).to_contain_text('triangulated')
    expect(page.locator('#materialDiversitySummary')).to_contain_text('finishes')
    expect(page.locator('#materialCostRows tr').first).to_contain_text('Core ring')
    expect(page.locator('#materialCostRows tr').filter(has_text='Marine firehall')).to_contain_text('5')
    before_rates = page.evaluate("""() => {
      const study = JSON.parse(localStorage.getItem('poly-nation-material-study-v1'));
      const total = estimateMaterialAssemblies(study.model, study.assignments, DEFAULT_MATERIAL_RATES);
      return total.total + total.structuralCost;
    }""")
    page.locator('#openMaterialRates').click()
    page.locator('#materialStructureRate').fill('700')
    page.get_by_role('button', name='Apply assumptions').click()
    expected = '$' + f'{before_rates:,.0f}'
    expect(page.locator('#materialCostTotal')).to_contain_text(expected)
    page.locator('#materialStructureView').check()
    page.locator('#materialProgramColors').check()
    page.locator('.material-rationale summary').click()
    page.locator('#materialNotes').fill('Compare cedar and galvanized metal.')
    assert page.evaluate('state.seed')==start['seed']
    page.locator('#openMaterials').click()
    page.locator('#shuffle').click()
    expect(page.locator('#seedLabel')).to_have_text('Seed 607')
    page.locator('#openMaterials').click()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 606')
    page.locator('#updateMaterials').click()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 607')
    page.locator('#materialScope').select_option('building')
    expect(page.locator('#materialFacade [data-material=cedar]')).to_have_attribute('aria-pressed', 'true')
    page.reload()
    page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
    page.locator('#openMaterials').click()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 607')
    expect(page.locator('#materialFacade [data-material=cedar]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#materialNotes')).to_have_value('Compare cedar and galvanized metal.')
    page.locator('#openMaterials').click()
    print('materials snapshot, multiple scopes, preview changes and reload passed',flush=True)

    page.locator('#editProgramming').click()
    page.locator('#plan').click()
    # Project the top of a top-floor program module into the canvas and click that actual mesh.
    x,y=page.evaluate("""() => {
   const slot=model.slots.find(s=>s.f===state.floors-1 && s.p>=0 && s.p<5);
   const box=canvas.getBoundingClientRect(),mesh=softwareMesh;
   const back=[Math.cos(camera.el)*Math.cos(camera.az),Math.sin(camera.el),Math.cos(camera.el)*Math.sin(camera.az)];
   const right=unit(cross([0,1,0],back)),up=unit(cross(back,right));
   const half=mesh.extent*1.23*Math.max(1,box.height/box.width)*camera.zoom,rad=model.R+.65+MODULE.depth/2;
   const point=[rad*Math.cos(slot.angle),slot.f*4.2+.43+MODULE.height-mesh.H*.47,rad*Math.sin(slot.angle)];
   return [box.left+box.width/2+dot(point,right)*box.height/(2*half),
           box.top+box.height/2-(dot(point,up)-camera.pan)*box.height/(2*half)];
    }""")
    page.mouse.click(x,y)
    expect(page.locator('#programDialog')).to_be_visible()
    expect(page.locator('#applyProgram')).to_have_text('Apply program')
    assert 'Dock' in page.locator('#programLocation option:checked').inner_text()
    previous=int(page.locator('#programChoice').input_value())
    replacement=(previous+1)%5
    before_counts=page.evaluate('model.counts.slice()')
    page.locator('#programChoice').select_option(str(replacement))
    page.locator('#applyProgram').click()
    expect(page.locator('#programDialog')).to_be_hidden()
    counts=page.evaluate('model.counts.slice()')
    assert counts[replacement]==before_counts[replacement]+1 and counts[previous]==before_counts[previous]-1,(counts,before_counts)
    assert page.evaluate('model.total<=state.areaCap+1e-5')
    print('direct click and module program/area reassignment passed',flush=True)

    page.locator('#chooseProgramLocation').click()
    choices=page.locator('#programLocation option').all()
    room=next(item for item in choices if 'Room ' in item.inner_text())
    page.locator('#programLocation').select_option(room.get_attribute('value'))
    room_program=int(page.locator('#programChoice').input_value())
    page.locator('#programChoice').select_option(str((room_program+1)%5))
    page.locator('#applyProgram').click()
    expect(page.locator('#programDialog')).to_be_hidden()
    assert page.evaluate('Object.keys(state.roomPrograms).length===1')
    print('room reassignment passed',flush=True)

    room_key = page.evaluate('Object.keys(state.roomPrograms)[0]')
    before_count=page.evaluate('model.count')
    page.locator('#chooseProgramLocation').click()
    available=[item.get_attribute('value') for item in page.locator('#programLocation option').all() if 'Available for a module' in item.inner_text()]
    for value in available[:8]:
        page.locator('#programLocation').select_option(value)
        page.locator('#programChoice').select_option('2')
        page.locator('#applyProgram').click()
        if not page.locator('#programDialog').is_visible(): break
    else: raise AssertionError(page.locator('#programFeedback').inner_text())
    assert page.evaluate('model.count')==before_count+1
    assert page.evaluate('(key)=>model.rooms.some(room=>room.editKey===key && room.id===state.roomPrograms[key])', room_key)
    assert page.evaluate('model.total<=state.areaCap+1e-5 && !model.slots.some(s=>s.blocked&&s.p!==EMPTY)')
    page.locator('#openMaterials').click()
    assert str(before_count+1)+' modules' not in page.locator('#materialSnapshot').inner_text()
    page.locator('#updateMaterials').click()
    expect(page.locator('#materialSnapshot')).to_contain_text(str(before_count+1)+' modules')
    print('valid dock insertion and snapshot separation passed',flush=True)
    page.locator('#openMaterials').click()
    guard=page.evaluate("""() => {
   state=defaults();
   state.relations['1-3']='repel';
   update();
   const besideHotel=model.slots.find(slot=>slot.anchor===1 && PROGRAMS[slot.p] && slot.p!==3);
   const reserved=model.slots.find(slot=>slot.blocked);
   const saved=JSON.stringify(state);
   const count=model.count;
   const conflict=applyProgramEdit({slot:besideHotel},3);
   const blocked=applyProgramEdit({slot:reserved},2);
   return {conflict,blocked,unchanged:JSON.stringify(state)===saved && model.count===count};
    }""")
    assert 'Repel' in guard['conflict'] and 'reserved' in guard['blocked'] and guard['unchanged'], guard
    print('Repel and reserved-dock rejections left the model and settings intact',flush=True)
    cap_guard = page.evaluate("""() => {
      state=defaults();
      state.vacancy=[100,0,0,0];
      update();
      state.autoCore=false;
      state.footprint=Math.PI*model.R**2;
      state.ringWidth=model.width;
      update();
      const dock=model.slots.find(slot=>!slot.blocked && slot.p===EMPTY && slot.use==='empty');
      const saved=JSON.stringify(state), count=model.count;
      const error=applyProgramEdit({slot:dock},2);
      return {error, unchanged: JSON.stringify(state)===saved && model.count===count};
    }""")
    assert 'area cap' in cap_guard['error'] and cap_guard['unchanged'], cap_guard


    mobile=b.new_page(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    mobile.goto(f'http://127.0.0.1:{server.server_port}/')
    mobile.locator('#openMaterials').click()
    expect(mobile.locator('#materialAssemblies')).to_be_visible()
    expect(mobile.locator('#assemblyCards .assembly-card')).to_have_count(6)
    mobile.locator('#assembly-2 button').click()
    expect(mobile.locator('#materialTarget')).to_have_value('2')
    mobile.locator('#returnToAssembly').click()
    expect(mobile.locator('#assembly-2 button')).to_be_focused()
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert not errors, errors
    server.shutdown()
