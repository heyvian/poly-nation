from pathlib import Path
import os, shutil
from playwright.sync_api import expect, sync_playwright
root=Path(__file__).resolve().parents[1]; src=root/'index.html'; out=root/'tests'/'output'; out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,args=['--no-sandbox','--disable-dev-shm-usage','--disable-webgl'])
 page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(src.read_text(),wait_until='domcontentloaded');page.wait_for_function('model && occupancy');page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
 quick_trial = page.locator('#cpQuickTrial')
 quick_result = page.locator('#cpDashTrialResult')
 drawer = page.locator('#trialDrawer')
 expect(quick_trial).to_have_text('Run Pollination Trial')
 page.locator('#focusSchedule').click()
 expect(page.locator('#areaSchedulePanel')).to_be_visible()
 expect(quick_result).to_have_text('5 simulated minutes')
 # Committing a number field as the trial button receives focus queues the layout for the next frame.
 started = page.evaluate('''() => {
   const floors = document.querySelector('input[aria-label="Floors"]');
   floors.value = '5';
   floors.dispatchEvent(new Event('change'));
   if (!pending) throw new Error('Expected a pending layout');
   $('cpQuickTrial').click();
   return $('cpDashTrialResult').textContent;
 }''')
 assert started == 'Simulating 5 min · 0%'
 expect(drawer).to_be_visible()
 expect(page.locator('#areaSchedulePanel')).to_be_hidden()
 page.wait_for_function('cpHistory.length === 1 && !cpTrialActive')
 assert page.evaluate('cpHistory[0].settings.floors') == 5
 result = page.evaluate('''() => {
   const reference = makeOccupancy(model);
   advanceScored(reference, 300);
   return {
     expected: crossRate(reference),
     actual: cpHistory[0].rate,
     encounters: cpHistory[0].encounters,
     expectedEncounters: reference.score.encounters,
     liveTime: occupancy.clock,
   };
 }''')
 assert result['actual'] == result['expected'] and result['encounters'] == result['expectedEncounters'], result
 assert result['liveTime'] == 0, result
 expect(quick_result).to_have_text(f"Last trial · {result['actual']:.1f}")
 entries = drawer.locator('.trial-entry')
 expect(entries.first).to_contain_text('Baseline')
 expect(entries.first).to_contain_text('Clustering strength')
 expect(entries.first.locator('dt').filter(has_text='Enclosed area cap')).to_have_count(1)
 assert entries.first.locator('img').evaluate('(image) => image.complete && image.naturalWidth === 384')
 page.locator('#collapseTrial').click()
 expect(drawer).to_be_hidden()
 page.locator('#openTrialLog').click()
 expect(drawer).to_be_visible()
 detail_trial = page.locator('#cpTrial')
 detail_trial.click()
 page.wait_for_function('cpHistory.length === 2 && !cpTrialActive')
 assert page.evaluate('cpHistory[0].rate === cpHistory[1].rate && occupancy.clock === 0')
 expect(entries.first).to_contain_text('No recorded changes.')
 page.evaluate('$("cpTrial").click(); $("cpQuickTrial").click()')
 expect(detail_trial).to_have_text('Run Pollination Trial')
 expect(quick_result).to_have_text('Trial cancelled.')
 assert page.evaluate('!cpTrialActive && cpHistory.length === 2')
 page.locator('#shuffle').click()
 quick_trial.evaluate('(button) => button.click()')
 page.wait_for_function('cpHistory.length === 3 && !cpTrialActive')
 expect(entries.first).to_contain_text('Variation seed')
 expect(entries.first).to_contain_text('606 → 607')
 expect(entries.first).to_contain_text('Trial settings changed')
 expect(entries.first.locator('dt').filter(has_text='Enclosed area cap')).to_have_count(0)
 expect(entries.first.locator('.trial-diff-group h4')).to_have_text(
     ['Settings changed', 'Changes in the model', 'Changes in encounters']
 )
 expect(entries.first.locator('.trial-diff-settings .trial-before')).to_have_text('606')
 expect(entries.first.locator('.trial-diff-settings .trial-after')).to_have_text('607')
 expect(entries.last.locator('.trial-after')).to_have_count(0)
 flags = page.evaluate('''() => {
   const baseline = {...cpHistory[1], rate: 100};
   return [110, 105, 95, 90].map(rate =>
     renderTrialEntry({...baseline, rate}, baseline, 0).querySelector('.trial-score-change').textContent
   );
 }''')
 assert flags == ['Major increase', 'Minor increase', 'Minor decrease', 'Major decrease'], flags
 page.locator('#cpClear').click()
 page.evaluate('state.floors=defaults().floors;state.seed=defaults().seed;update()')
 print('both trial controls, pending design edits, five simulated minutes, and cancellation passed',flush=True)

 page.evaluate('window.originalLayout = model')
 detail_trial.click()
 page.wait_for_function('cpHistory.length === 1 && !cpTrialActive')
 page.locator('#cpOptimize').click()
 suggestion = page.locator('#cpOptimizationResult')
 expect(suggestion).to_be_visible(timeout=30000)
 assert page.evaluate('model === window.originalLayout && state.dockVariant === 0 && cpHistory.length === 1')
 expect(page.locator('#cpOptimizationScores')).to_contain_text('average of 3 matched trials')
 page.locator('#cpApplyLayout').click()
 assert page.evaluate('''() =>
   state.dockVariant > 0 &&
   eligibleModuleLayout(model, window.originalLayout) &&
   JSON.stringify(model.rooms) === JSON.stringify(window.originalLayout.rooms) &&
   model.slots.some(slot => slot.p !== window.originalLayout.slots[slot.i].p)
 ''')
 page.wait_for_function('cpHistory.length === 2 && !cpTrialActive')
 assert page.evaluate('cpHistory[0].settings.dockVariant === state.dockVariant')
 expect(entries.first.locator('.trial-diff-settings')).to_contain_text('Module arrangement')
 expect(entries.first.locator('.trial-thumbnail')).to_be_visible()
 page.evaluate('state.dockVariant=0;update()')
 print('applying the optimization kept program areas and ran a fast trial',flush=True)

 page.evaluate('window.beforeAllocation = model')
 page.get_by_role('button', name='Optimize allocation').click()
 expect(suggestion.get_by_role('heading')).to_have_text('Suggested allocation',timeout=30000)
 expect(page.locator('#cpOptimizationRatios dd')).to_have_count(2)
 assert page.evaluate('model===window.beforeAllocation && state.allocationMoves.length===0')
 suggestion.get_by_role('button', name='Apply allocation').click()
 page.wait_for_function('cpHistory.length === 3 && !cpTrialActive')
 assert page.evaluate('''() =>
   preservesProgramAreas(model, window.beforeAllocation) &&
   model.count === window.beforeAllocation.count &&
   model.counts.some((n, i) => n !== window.beforeAllocation.counts[i]) &&
   cpHistory[0].settings.allocationMoves.length === 1
 ''')
 expect(entries.first.locator('.trial-diff-settings')).to_contain_text('Core / module exchanges')
 page.locator('#collapseTrial').click()
 page.evaluate('state.allocationMoves=[];update()')
 print('allocation search changed core-to-module ratios while keeping built areas',flush=True)

 pose = page.evaluate('''() => {
   const ride = model.feature.ride;
   const cruise = swingPose(ride, 0);
   const descent = swingPose(ride, 60);
   const unloading = swingPose(ride, 86);
   const nextCruise = swingPose(ride, 136);
   return {
     radius: cruise.rad,
     tiltDegrees: cruise.tilt * 180 / Math.PI,
     speed: cruise.speed,
     beforeDescent: swingPose(ride, 59.75).phase,
     descent: descent.phase,
     unloading: unloading.phase,
     unloadingHeight: unloading.seatY - ride.roofLevel,
     nextCruise: nextCruise.phase,
     nextRound: nextCruise.round - cruise.round,
   };
 }''')
 assert abs(pose['radius'] - 12) < 0.01, pose
 assert 45 < pose['tiltDegrees'] < 50, pose
 assert abs(pose['speed'] - 40) < 0.01, pose
 assert pose['beforeDescent'] == 'At the top' and pose['descent'] == 'Descending', pose
 assert pose['unloading'] == 'Unloading' and abs(pose['unloadingHeight'] - 0.36) < 0.01, pose
 assert pose['nextCruise'] == 'At the top' and pose['nextRound'] == 1, pose
 print('swing pose and 136-second cycle', pose, flush=True)
 print('defaults',page.evaluate('''()=>({area:model.total,plaza:model.plaza.area,zones:model.plaza.zones.map(x=>x.kind),reachable:occupancy.graph.reachable.size,outdoor:occupancy.graph.outdoor.length,climb:occupancy.graph.nodes.filter(q=>q.kind==='climbBase').map(q=>occupancy.graph.reachable.has(q.id)),swing:occupancy.graph.nodes.filter(q=>q.kind==='swing').map(q=>occupancy.graph.reachable.has(q.id))})'''),flush=True)
 res=page.evaluate('''()=>{const sim=makeOccupancy(model);let maxQueue=0,maxRiders=0,topRiders=0,unloaded=0;for(let i=0;i<420;i++){advanceScored(sim,1);const q=sim.people.filter(a=>a.rideQueued).length,n=sim.people.filter(a=>a.rideSeat!=null).length;maxQueue=Math.max(maxQueue,q);maxRiders=Math.max(maxRiders,n);if(swingPose(model.feature.ride,sim.clock).phase==='At the top')topRiders=Math.max(topRiders,n);unloaded=sim.completedSwings||0;}return {maxQueue,maxRiders,topRiders,unloaded,climbs:sim.completedClimbs,rate:crossRate(sim),encounters:sim.score.encounters,plaza:sim.score.by.plaza.count,fun:sim.fun};}''')
 print('simulation',res,flush=True);assert res['maxQueue']>0 and res['topRiders']>0 and res['unloaded']>0 and res['plaza']>0
 configurations=page.evaluate('''()=>{let out=[];for(const [floors,areaCap,climbWidth,lobby] of [[1,5000,0,0],[2,10000,12,240],[4,20000,10,240],[7,35000,24,300],[10,50000,24,450]]){Object.assign(state,{floors,areaCap,climbWidth,lobby});const m=derive(),g=buildNavigation(m);out.push({floors,total:m.total,cap:areaCap,area:m.plaza.area,count:m.plaza.zones.length,finite:m.plaza.zones.every(q=>Number.isFinite(q.r)&&q.width>0),reach:g.entry==null?null:g.nodes.filter(n=>n.kind==='climbBase').map(n=>g.reachable.has(n.id))});}return out;}''')
 print('configs',configurations,flush=True);assert all(c['total']<=c['cap']+1e-5 and c['finite'] and c['area']>0 for c in configurations)
 slider_label = page.locator('label[for="affinity"]')
 assert slider_label.is_visible() and slider_label.inner_text().startswith('Clustering strength')
 topology = page.evaluate('''() => {
   function layout(mode, strength, clustered) {
     state = defaults();
     state.affinity = strength;
     state.cluster[1] = clustered;
     state.relations['0-1'] = mode;
     state.points[1] = state.points[0].slice();
     const layout = derive();
     const pairedDocks = layout.slots.filter(slot =>
       (slot.p === 0 && slot.anchor === 1) || (slot.p === 1 && slot.anchor === 0)).length;
     const alignedDocks = layout.slots.filter(slot => slot.p === 1 && slot.anchor === 1).length;
     return {
       pairedDocks,
       alignedDocks,
       hubs: layout.circulation.hubs.length,
       rooms: layout.rooms.map(room => [room.id, room.start, room.end]),
       modules: layout.slots.map(slot => slot.p),
       counts: layout.counts,
     };
   }
   return {
     attract: layout('attract', 0, false),
     neutral: layout('neutral', 0, false),
     repel: layout('repel', 0, false),
     clusterAtZero: layout('attract', 0, true),
     sliderWithoutSelection: layout('attract', 100, false),
     clustered: layout('attract', 100, true),
     clusteredRepel: layout('repel', 100, true),
   };
 }''')
 attract, neutral, repel = (topology[mode] for mode in ('attract', 'neutral', 'repel'))
 assert attract['pairedDocks'] > neutral['pairedDocks'] > repel['pairedDocks']
 assert attract['hubs'] > 0 and neutral['hubs'] == repel['hubs'] == 0
 assert attract == topology['sliderWithoutSelection']
 assert topology['clusterAtZero']['alignedDocks'] > attract['alignedDocks']
 assert topology['clustered']['alignedDocks'] > attract['alignedDocks']
 assert topology['clustered']['pairedDocks'] > topology['clusteredRepel']['pairedDocks']
 for layout in topology.values():
  assert layout['counts'] == [layout['modules'].count(program) for program in range(len(layout['counts']))]
 print('topology modes affect placement at zero clustering; clustering increases core-to-module alignment', flush=True)
 separation = page.evaluate('''() => [606, 608, 612].map(seed => {
   state = defaults();
   state.seed = seed;
   state.affinity = 0;
   state.relations['1-3'] = 'repel';
   const layout = derive();
   const {slots, slotN} = layout;
   const horizontal = slots.filter(slot =>
     programsRepel(slot.p, slots[slot.f * slotN + (slot.j + 1) % slotN].p)).length;
   const vertical = slots.filter(slot =>
     programsRepel(slot.p, slots[slot.i + slotN]?.p)).length;
   return {seed, horizontal, vertical, sameFloorConflicts: layout.repelConflicts};
 })''')
 assert all(case['sameFloorConflicts'] == case['horizontal'] == 0 and case['vertical'] > 0
            for case in separation), separation
 print('Love Hotel and Daycare separated on the same floors with vertical neighbors allowed', separation, flush=True)
 firehall = page.evaluate('''() => {
   const id = PROGRAMS.findIndex(program => program.short === 'FH');
   function measure(seed, clusterEnabled) {
     state = defaults();
     state.seed = seed;
     state.affinity = 0;
     state.cluster[id] = clusterEnabled;
     const layout = derive();
     const rooms = layout.rooms.filter(room => room.id === id);
     const modules = layout.slots.filter(slot => slot.p === id);
     const points = rooms.map(room => ({angle: (room.start + room.end) / 2, weight: room.area}));
     function concentration(samples) {
       const x = samples.reduce((sum, sample) => sum + sample.weight * Math.cos(sample.angle), 0);
       const z = samples.reduce((sum, sample) => sum + sample.weight * Math.sin(sample.angle), 0);
       return Math.hypot(x, z) / samples.reduce((sum, sample) => sum + sample.weight, 0);
     }
     return {
       roomConcentration: concentration(points),
       moduleConcentration: concentration(modules.map(slot => ({angle: slot.angle, weight: 1}))),
       perFloor: Array.from({length:state.floors}, (_, floor) => modules.filter(slot=>slot.f===floor).length),
       moduleCount: modules.length,
     };
   }
   return [606, 608, 609].map(seed => ({seed, off: measure(seed, false), on: measure(seed, true)}));
 }''')
 for case in firehall:
  on, off = case['on'], case['off']
  assert on['roomConcentration'] > off['roomConcentration'] + 0.2, case
  assert on['moduleConcentration'] > off['moduleConcentration'], case
  assert on['moduleCount'] == off['moduleCount'], case
  assert on['perFloor'] == off['perFloor'] == [on['moduleCount'], 0, 0, 0], case
 print('Firehall clustering and ground-first placement passed', firehall, flush=True)
 firehall_overflow = page.evaluate('''() => {
   state = defaults();
   state.floors = 3;
   const columns = 5;
   const slots = [2, 3, 3].flatMap((count, f) =>
     Array.from({length:count}, (_, j) => ({i:f*columns+j,f,j,angle:j*TAU/columns,anchor:UNUSED})));
   const counts = [0,0,5,0,0,0];
   const scenario = (slots, pins) => {
     const result = place(slots, columns, counts, [], pins);
     return {
       perFloor: [0,1,2].map(f => slots.filter((slot,i) => slot.f===f && result.placement[i]===FIREHALL).length),
       unplaced: result.firehall.unplaced,
       omitted: [...result.firehall.omitted]
     };
   };
   return {overflow: scenario(slots,new Map()), noGround: scenario(slots.filter(s=>s.f>0),new Map([[5,FIREHALL]]))};
 }''')
 assert firehall_overflow['overflow'] == {'perFloor':[2,2,1], 'unplaced':0, 'omitted':[]}, firehall_overflow
 assert firehall_overflow['noGround']['perFloor'] == [0,0,0] and firehall_overflow['noGround']['unplaced'] == 5, firehall_overflow
 print('Firehall overflow respects the cap on each higher floor', firehall_overflow, flush=True)
 # reset and show ground plaza from above, moving ride pose proof.
 page.evaluate('state=defaults();state.simRunning=false;state.animateSwing=false;update();camera.el=Math.PI/2-.012;camera.zoom=.87;draw()');page.wait_for_timeout(150);page.screenshot(path=str(out/'plaza-preview.png'))
 # score compare deterministic geometry, not just screenshot
 page.evaluate('camera.az=-.84;camera.el=.57;camera.zoom=.9;standaloneSwingClock=75;rotateSwingMesh(softwareMesh,false);draw()');page.screenshot(path=str(out/'boarding-preview.png'))
 print('errors',errors,flush=True);assert not errors
 browser.close()
