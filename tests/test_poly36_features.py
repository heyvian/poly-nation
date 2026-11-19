from pathlib import Path
import os, shutil
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]; src=root/'index.html'; out=root/'tests'/'output'; out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,args=['--no-sandbox','--disable-dev-shm-usage','--disable-webgl'])
 page=browser.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(src.read_text(),wait_until='domcontentloaded');page.wait_for_function('model && occupancy');page.evaluate('state.simRunning=false;state.animateSwing=false;refreshView()')
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
 assert attract == topology['clusterAtZero'] == topology['sliderWithoutSelection']
 assert topology['clustered']['alignedDocks'] > attract['alignedDocks']
 assert topology['clustered']['pairedDocks'] > topology['clusteredRepel']['pairedDocks']
 for layout in topology.values():
  assert layout['counts'] == [layout['modules'].count(program) for program in range(len(layout['counts']))]
 print('topology modes affect placement at zero clustering; clustering increases core-to-module alignment', flush=True)
 # reset and show ground plaza from above, moving ride pose proof.
 page.evaluate('state=defaults();state.simRunning=false;state.animateSwing=false;update();camera.el=Math.PI/2-.012;camera.zoom=.87;draw()');page.wait_for_timeout(150);page.screenshot(path=str(out/'plaza-preview.png'))
 # score compare deterministic geometry, not just screenshot
 page.evaluate('camera.az=-.84;camera.el=.57;camera.zoom=.9;standaloneSwingClock=75;rotateSwingMesh(softwareMesh,false);draw()');page.screenshot(path=str(out/'boarding-preview.png'))
 print('errors',errors,flush=True);assert not errors
 browser.close()
