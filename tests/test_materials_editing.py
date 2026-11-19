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
    page=b.new_page(viewport={'width':1440,'height':900})
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/')
    page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
    start=page.evaluate('({seed:state.seed,count:model.count,core:model.core.slice(),modules:model.counts.slice()})')
    page.locator('#openMaterials').click()
    expect(page.locator('#materialsPhase')).to_be_visible()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 606')
    schedule = page.locator('#materialAssemblies')
    core = page.locator('#materialCoreAssembly')
    modules = page.locator('#materialModuleAssemblies .assembly-card')
    expect(schedule).to_be_visible()
    expect(modules).to_have_count(5)
    expect(core.locator('canvas')).to_have_attribute('aria-label', 'Core ring, exploded axonometric. Cast-in-place reinforced concrete structure and Architectural concrete cladding.')
    expect(core).to_contain_text('420 kg/m² floor')
    expect(core).to_contain_text('72 kg/m² wall')
    modules.filter(has_text='Marine firehall').get_by_role('button', name='Edit program').click()
    expect(page.locator('#materialScope')).to_have_value('moduleProgram')
    expect(page.locator('#materialTarget')).to_have_value('2')
    page.locator('#materialScope').select_option('building')
    page.locator('#materialModelView').click()
    page.wait_for_function("document.querySelector('#materialsCanvas').width>600")
    def frame():
        return page.locator('#materialsCanvas').evaluate('(canvas)=>canvas.toDataURL()')
    initial=frame()
    page.locator('#materialFacade').select_option('cedar')
    page.wait_for_function("(before)=>document.querySelector('#materialsCanvas').toDataURL()!==before",arg=initial)
    page.locator('#materialStructure').select_option('clt')
    page.locator('#materialScope').select_option('modules')
    page.locator('#materialStructure').select_option('space-frame')
    page.locator('#materialScope').select_option('moduleProgram')
    page.locator('#materialTarget').select_option('2')
    page.locator('#materialFacade').select_option('brick')
    page.locator('#materialScope').select_option('coreProgram')
    page.locator('#materialTarget').select_option('3')
    page.locator('#materialFacade').select_option('vinyl')
    page.locator('#materialScope').select_option('module')
    firehall_slot = page.locator('#materialTarget option').filter(has_text='Marine firehall').first
    page.locator('#materialTarget').select_option(firehall_slot.get_attribute('value'))
    page.locator('#materialFacade').select_option('zinc')
    assert page.evaluate("""() => {
      const {assignments} = JSON.parse(localStorage.getItem('poly-nation-material-study-v1'));
      const slot = document.getElementById('materialTarget').value;
      return materialValues(assignments, 'core', 3).facade === 'vinyl' &&
        materialValues(assignments, 'module', 2).facade === 'brick' &&
        materialValues(assignments, 'module', 2, slot).facade === 'zinc' &&
        materialValues(assignments, 'module', 2).structure === 'space-frame';
    }""")
    page.locator('#materialAssembliesView').click()
    expect(core).to_contain_text('Cross-laminated timber (CLT)')
    firehall = modules.filter(has_text='Marine firehall')
    expect(firehall).to_contain_text('Brick veneer')
    expect(firehall).to_contain_text('Triangulated load paths')
    firehall.get_by_role('combobox', name='Marine firehall assembly variant').select_option('space-frame/zinc')
    expect(firehall.locator('.assembly-specs')).to_contain_text('Zinc panels')
    expect(firehall.locator('.assembly-specs')).to_contain_text('9 kg/m² wall')
    page.locator('#materialModelView').click()
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
    expect(page.locator('#materialFacade')).to_have_value('cedar')
    page.reload()
    page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
    page.locator('#openMaterials').click()
    expect(page.locator('#materialSnapshot')).to_contain_text('Seed 607')
    expect(page.locator('#materialFacade')).to_have_value('cedar')
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
    expect(mobile.locator('#materialModuleAssemblies canvas')).to_have_count(5)
    mobile.locator('#assembly-2').get_by_role('button', name='Edit program').click()
    expect(mobile.locator('#materialTarget')).to_have_value('2')
    mobile.locator('#returnToAssembly').click()
    expect(mobile.locator('#assembly-2')).to_be_focused()
    assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert not errors, errors
    server.shutdown()
