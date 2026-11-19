# V3.5 workspace update (latest)

The workspace now has a single left control rail. The Topology Designer and Relationship strength are visible above six tabs (Building, Modules, Features, Allocation, Visitors, Score). The live cross-pollination dashboard is directly below the enlarged 3D canvas, with trial and score detail actions. The core-mixing slider lives in Building. The full area schedule is below the viewport controls and area summaries. Desktop settings and model columns scroll independently; on mobile, the model and score appear first, then the controls, with jump buttons. No modelling, simulation, scoring or export algorithms were changed in this version. Older interface notes below describe previous releases and are superseded where they conflict with this layout.

---

# Poly Nation — architectural massing laboratory

## Copilot brief

Continue the existing `index.html` prototype rather than redesigning it from scratch. This is a conceptual architectural design tool for Poly Nation / Infinite Rinse, not a detailed BIM model or a remediation simulator. Keep its visual language clean, architectural, neutral, and diagrammatic: orthographic axonometric massing, soft program colors, fine slab lines, a glass courtyard roof, and uncluttered controls. Geometry and layout must update from a single state object. Use meters and square meters.

The current implementation is self-contained vanilla HTML/CSS/JS with a WebGL renderer and a software canvas fallback. No external dependencies. If moving to Three.js, preserve the checked-in standalone version and port the rendering layer first rather than replacing the solver. Use an OrthographicCamera, OrbitControls with enablePan=false, maxPolarAngle less than PI/2, a target at the center of the building, zoom limits, and plan/axon/fit buttons. Use batched or instanced meshes for modules; dispose regenerated geometries and materials. No perspective fly-through is needed yet.

## 1. Program targets

| Program | Area (m²) | Color | Default requested core share |
|---|---:|---|---:|
| Infinite Rinse (treatment, greenhouse, museum) | 7500 | #72a9c8 | 80% |
| Love hotel | 8000 | #d681a7 | 35% |
| Marine firehall | 1500 | #d46f62 | 75% |
| Daycare | 1000 | #e0bb62 | 40% |
| Senior care | 2000 | #8bb28a | 35% |
| Total | 20000 | | |

The areas are current conceptual targets, not code-verified measurements. Keep them distinct from generated actual areas. The default shares are initial design assumptions, not fixed rules. The program sliders request stable versus removable allocation, with both percentages displayed. Neutral gray is unassigned capacity, not another project program. Outdoor programming, docks, rides and the site remediation infrastructure are outside the current massing budget; do not silently count them.

## 2. Geometry model

- The stable core is an annular ring, inspired by the Apple Park plan, vertically stacked at 4.2 m floor-to-floor (assumption). The enclosed central courtyard is a full-height greenhouse and public bioremediation space. Its grade-level area is always allocated to Infinite Rinse and counted exactly once; the void is not counted on upper floors. The roof has no extra floor area. Render simplified water/plant beds and transparent glazing; do not imply process water is safe to contact.
- Controls: number of floors, outer circular footprint in m² (includes courtyard), radial ring width in meters, requested number of modules. Calculate outer radius `R = sqrt(footprint/PI)`, inner radius `r = R-width`, ring area per floor `PI*(R²-r²)`, courtyard `PI*r²`. Restrict width so a meaningful positive courtyard remains.
- Module: 4.5 m tangential width × 18 m radial depth × 3.5 m height = 81 m². Fit radial docking positions outside the ring using tangential clearance (current gap 0.9 m and radial offset 0.65 m). Each position has a floor and angular index. A module extends outward, attaches short end to ring, and can be removed. Unoccupied primary-module positions can remain empty or become public balconies, community gardens, or enclosed commercial/retail units. See v2 notes below. Count is limited by geometry; warn rather than claiming unplaced modules fit. Present supports are symbolic docking rails, not engineered structure.
- Allow exact parameter input as a later enhancement. Consider optional paired 162 m² modules, variable floor heights, sectional views, movable facade closures and exposed attachment structures later. Do not accidentally change what 81 m² means.

## 3. Allocation

For each program request `goal * coreShare` in the core. Reserve the entire courtyard for Infinite Rinse first, even if that overrides its requested percentage. Allocate remaining ring area to the requested stable programs in proportion if insufficient; surplus goes to neutral unassigned capacity. Modular demand is the remaining requested program area, not a promise that every target is met. Allocate whole pods by largest remainder, respecting total feasible installed count; surplus pods are gray. Report target, actual core, pod count, actual total, variance. Maintain conservation: total enclosed geometric modeled floor area equals ring area × floors + courtyard once + primary modules × 81 + retail slots × 81; open decks are reported separately. Never quietly double count the greenhouse or use fractional pods. Preserve the distinction between requested shares and actual allocations. This description is superseded by the v2.2 area-balancing solver below.

## 4. Topology map and placement solver

The draggable nodes are an abstract relationship diagram rather than a literal site plan. The normalized Euclidean distance between program nodes defines a soft adjacency cost: close = prefer adjacent, far = prefer separation. Same program has zero pairwise cost. Visible connecting lines respond to distance. The v2 ring uses independent room/zone partitions on each floor and in one or two radial bands; it no longer uses the old continuous program-sector stack. This is a heuristic; radial position in the wheel does not automatically represent real-world direction or physical distance.

For modules, create adjacency edges between horizontally neighboring slots (wrap around) and vertically neighboring slots. Each slot also anchors to the outer-band room at that angle on its own floor. Randomize a fixed inventory of program labels and vacancies with a deterministic seed. Minimize the energy with bounded simulated annealing using label swaps, preserving all counts. Pairwise cost is based on node distance; anchor cost favors related core sectors; vacancy handling is a weak compactness preference. `Relationship strength` changes how strongly the optimizer follows topology versus the initial random distribution. Zero = randomized assignment, not zero core program area. `New variation` increments the seed; the same state/seed must reproduce the same result. A lower score is only meaningful for comparable relationship settings and geometry. Soft preferences are not enforced safety requirements.

## 5. Interaction and design priorities

- Left panel: geometry / module capacity / display toggles. Central large 3D axonometric viewport with persistent orbit, zoom, plan / axon / fit. Right panel: topology diagram and requested stable/modular splits. Below viewport: live area metrics, color distribution, full program schedule. At smaller widths stack controls responsively.
- Keep the building as the fixed orbit target. Never allow under-ground views. Update in place as sliders or nodes move, throttle computational work with requestAnimationFrame and keep camera orientation when recalculating. No full page reload. Keep the model geometrically clear rather than visually realistic.
- Export JSON with current state, program allocations, core rooms and each docking slot's floor, center, angular rotation and program or vacancy. Later add matching import, versioned scenario saving, compare alternatives, editable area goals, GLTF/OBJ/DXF export (or a Rhino/Grasshopper JSON bridge) and optional screenshot export. Use meters throughout, no unit conversion on export.
- Later optionally introduce hard program constraints (firehall at canal/grade, daycare and senior accessibility, protected circulation, separation of public recreation and contaminated process streams), separately from soft program preferences. Avoid asserting that the conceptual model verifies structure, access, fire safety, real process layout or water treatment feasibility.

## 6. Current prototype and tests

Open `index.html` directly in a desktop browser; no npm install or web server needed. The prototype's WebGL path is implemented but this restricted test environment did not provide WebGL; the software-rendered 3D fallback was exercised in Chromium. The fallback uses depth sorting, so may show minor overlapping-face artifacts, unlike a depth-buffered renderer. Tested initial calculation (19,958 m² rounded; 110 pods), geometry controls, map dragging, camera orbit, roof visibility, seed changes, reset and JSON download. Before major expansion, add unit tests for area conservation, module count invariants, empty inventory, over-capacity and deterministic seeds; test the GPU path on a supported browser.

## 7. Version 2 — cross-pollination and adaptive slots (implemented)

- Generate variable-size core room/zone masses, independent of the module grid. First allocate exact gross program area budgets across floors with seeded variation and balancing, then pack independent annular bands by consuming each floor budget. Use one band when the ring width is less than 9 m, otherwise two concentric bands. The current algorithm uses angular wedges; it is a conceptual partition, not a plan with resolved access. Do not snap core boundaries to module docks. Small residual areas can fall outside the preferred size range.
- Preferred gross zone size ranges in m²: Infinite Rinse 70–420; love hotel 30–105; firehall 45–230; daycare 30–125; senior care 25–105; unassigned 40–180. These are editable design assumptions, not room standards. Larger stable zones may be subdivided later.
- Program topology affects selection probabilities based on previous angular neighbors, an adjacent radial band, and the previous floor. The separate Core cross-pollination slider increases the penalty for repeating the same program; proximity in the topology map still encourages compatible neighbors. These are stochastic soft preferences, not a hard constraint solver. Primary module optimization still uses fixed counts and now anchors to the adjacent core room on that floor.
- Provide an Inspect level selector and an exterior visibility toggle. The greenhouse roof is hidden in single-level inspection. Preserve camera behavior and same seed determinism.
- After primary modules are placed, apportion the remaining docking positions into empty, public balcony, community garden, retail. Defaults are 25/30/30/15 percent. Changing one share redistributes the remainder proportionally among the others, and all four always sum to 100. Use largest remainder for exact integer slot counts, then independently seeded placement. Balconies and gardens are open decks with symbolic railings, seating, or planters. Retail uses an enclosed 81 m² mass. Empty slots are left vacant.
- Retain the 20,000 m² primary program target. Retail adds to enclosed GFA, balconies/gardens add outdoor area, empty slots add neither. Report actual primary area separately from enclosed total. Do not change core allocation merely because vacant slot uses change; primary inventory changes do rebalance the core in v2.2. The JSON export schema v2 includes `coreRooms` (program, floor, band, radii, angles, exact area), vacancy categories and counts, per-slot `use` for nonprimary slots, and `primaryArea`, `retailArea`, `outdoorPublicArea`.
- Tested software-rendered Chromium view, floor selector, modules visibility, vacancy redistribution to 100% retail, reset, export, and 80 varied configurations for preservation of room area budgets and slot capacity. WebGL path remains unverified in the container. Hard forbidden adjacency constraints are intentionally deferred, as are actual corridors, access/egress, wall thickness and structural checks.

## V2.2 — Area-balanced core (current behavior; supersedes older allocation rules)

- Auto-size is on by default. Keep each of the five program targets fixed. For program i, `requiredCore[i] = goal[i] - moduleCount[i] * 81`. The 20,000 m² primary budget is exact, and the greenhouse is counted once as part of Infinite Rinse. No primary gray pods are created.
- The requested module count sets overall inventory; stable/modular sliders define relative preferences, not independent exact shares. The actual built counts and core areas appear under every slider. 100% core excludes a program from the module inventory. Integer allocation respects per-program caps and reserves a minimum 3 m courtyard radius for Infinite Rinse.
- Solve the annular geometry based on the remaining primary area. With floors f, ring width w, outer radius R, and core area A, solve `R = -(f-1)*w + sqrt(f*(f-1)*w*w + A/PI)`. Bound w to preserve a courtyard radius of at least 3 m and a courtyard area no larger than remaining Infinite Rinse core area. Treat the ring width control as a preference and show actual width. The outer footprint readout is derived in auto mode.
- The docking capacity depends on R, so reduce requested inventory if necessary until counts fit. Warn when not every requested module is installed. No loss of program floor area: uninstalled primary modules remain in the core.
- Manual geometry is optional: unlock footprint and ring width, calculate program allocations from actual installed module counts, and report any deficit or surplus relative to the fixed program targets. Do not silently claim manual mode meets targets.
- The 20,000 m² primary area excludes additional retail in vacant slots. Public balcony and garden area remains outdoor. Keep all these counts and area metrics unchanged in meaning.
- JSON export schema v3 adds actual outer footprint and ring width, primaryTarget and autoCore state. Use actual `geometry` fields, not the preferred footprint/width state, when reconstructing in other tools.
- Preserve V2.1 corrected horizontal orbit direction.
- Regression test: default 110 primary modules → 8,910 m² modules and 11,090 m² core; 50 → 4,050 m² modules and 15,950 m² core; 0 → 20,000 m² core. Each program total should equal its goal in auto mode (within floating-point tolerance). Tested 100 varied parameter configurations and UI changes in software renderer, not WebGL.

## V2.3 — Hard total enclosed GFA cap (supersedes earlier retail rules)

- `TARGET = 20,000 m²` now caps all enclosed geometry, including core ring, one greenhouse courtyard floor, primary 81 m² pods, and 81 m² retail pods. Open gardens/balconies are reported separately; this is a conceptual area convention, not a code calculation.
- Base program goals are retained for reference. Retail displaces the five goals proportionally: `adjustedGoal[i] = baseGoal[i] * (TARGET - retailCount*81) / TARGET`. This is a provisional policy, not a user-specified priority ordering. In auto mode the adjusted goals are exact and total enclosed GFA is 20,000 m². The core receives adjusted goal minus installed primary modules.
- Prioritize requested primary pods subject to program and docking capacity. Test retail counts from the no-retail geometry's requested count downward, re-solving the adjusted inventory, core geometry and available slots each time. If retail cannot fit, redistribute excess vacancy slots among open uses (empty if no other preference). Show actual counts and adjusted program goals.
- Manual mode respects the cap by scaling an oversized core, then capping primary and retail inventory to the remaining budget; it may fall below cap or miss goals. Show warnings. The footprint is a preference when clamped.
- Export schema v4 includes areaCap, remainingArea, adjustedGoal and actual vacancy percentages. Earlier text in this brief describing retail as additional is historical, not current behavior.

- V2.3 regression: Chromium software renderer, module slider, 100% retail preference, reset and JSON export; 240 varied auto/manual configurations conserve room areas and stay within the hard cap. WebGL remains unverified.


## V2.4 additions
- Add a central Prater-scale swing tower passing through the atrium and through the roof.
- The roof is no longer a full glazed disc; it is an annular glazed roof around a central ride platform, so riders board at roof level while the tower continues above.
- Add a Water slide length slider (0–100%). The slide begins at the highest outer-band Infinite Rinse concentration, wraps along the outside perimeter, and re-enters a lower Infinite Rinse zone.
- Docking slots intersected by the slide are blocked and removed from module/vacancy capacity.
- These features are exported to JSON under a features object.


## V2.4.1 runtime repair
- Fixed the crash in the module placement solver: filtered docking slots now use a grid-index-to-local-index map, with absent neighbors skipped.
- The floor-area solver now tests actual slide clearance before assigning modules and retail; it recalculates core geometry and program budgets when the inventory changes.
- Water slide uses a sampled continuous swept tube between two actual Infinite Rinse facade rooms on different levels. The length slider specifies a preference, with feasible length and descent reported. When there is no feasible pair, the slide is omitted and the interface explains why. This is not a ride-engineering calculation.
- The roof glass connects to a center boarding platform (sized to fit the atrium) with a roof-level approach bridge. The 117 m tower height is conceptual; the open-air deck and slide are excluded from enclosed GFA.
- Chromium software renderer tested, including slider changes, reset, and JSON export; 90 seeded area/count invariant tests passed. Hardware WebGL not verified.


## V2.5 — entrance, persistence and Rhino interchange

- `state.lobby` is requested gross lobby footprint (0–1,000 m²). Actual size is bounded by annular geometry. Lobby sector runs across full ring width at azimuth -0.84 rad. `lobby.levels = min(2,floors)`. The lobby area is counted once; `lobby.voidArea = lobby.area*(levels-1)` is deducted from the complete annular floor area. Dedicated lobby line item shares the 20,000 m² cap with all programs and retail. Other five program goals are proportionally reduced. The auto core solver adds the void allowance before solving radius. Manual geometry can remain below the hard cap. `programRing` excludes both lobby and upper void; `roomLayout` partitions exact remaining annular sectors and reserves the same lobby arc on first two floors. Ground/second-floor slots crossing the approach are blocked. Slide cannot cross the low entrance arc. Both blocked sets are unified before inventory/placement. One-floor configurations have single-height lobby, no slide; report requested vs achieved lobby area.
- `localStorage` key `poly-nation-massing-lab-v2.5` stores state and camera after changes, with debounced saves and a final pagehide save. File URL storage is browser dependent; portable JSON import/export handles migration from earlier JSON schemas via validated defaults. Reset replaces saved configuration.
- Right mouse drag pans vertically in the view plane; left drag orbits and wheel zooms. Camera position persists. Fit resets pan and zoom.
- `buildMesh(m,true)` ignores display/inspect filters and records logical geometry groups with semantic layer tags. `dxfText` serializes grouped polyface meshes plus linework to DXF, units meters ($INSUNITS=6), Z-up right-handed coordinate transform [x,-z,y], layer colors. Excludes reference ground/grid. Layers named by level/program and component (slabs, frames, primary modules, gardens, retail, greenhouse, entrance, tower, platform, slide, glass and linework). Individual room/module mesh groups remain individually selectable. This is polygonal massing, not NURBS/Brep, IFC or native 3DM. Open DXF in Rhino 8, verify model units are meters, Save As .3dm. Future improvement: native 3DM export with rhino3dm.js or a Rhino-side converter for analytical Breps and nested layers.
- No structural, accessibility, code or ride engineering analysis implied. Lobby GFA accounting is conceptual; roof-level open decks remain outside the enclosed area cap.


## V2.6 — viewport and native Rhino export
- Desktop center panel is sticky at top: 100vh fixed-height panel, viewport stays visible, schedule scrolls internally. Sidebars remain document-scrolled.
- Elevation clamps to [0, pi/2-.012]; Side button sets exact 0. Existing camera pan and local storage key retained.
- Replaced incomplete DXF with on-demand pinned rhino3dm.js 8.17.0 ESM from jsDelivr. No dependency loaded until export. `exportGeometry` consumes the full semantic mesh independent of display options, deduplicates triangles/lines, transforms to right-handed Rhino Z-up (x,-z,y), preserves layer/name/color and emits separate mesh objects. `nativeBytes` builds File3dm and verifies it by reading bytes back and comparing object/layer counts. Requires CDN access; no geometry is sent to CDN.
- Offline alternative generates self-contained Python script with geometry; run `_RunPythonScript` in Rhino 8. Script writes a new native model with meters and colored layers without changing active document. Exported objects are mesh massing and linework, not NURBS/Breps.
- Browser CDN/WASM unavailable in authoring test environment: do not claim native OpenNURBS export tested until run with actual library.

- Signed topology: clicking a program edge cycles attract → neutral → repel. All distinct-program edges initially defaulted to attract in V2.6; V2.8.1 changes this default to neutral, with same-program attraction unchanged. `relationCost` returns negative for attraction, positive for repulsion, zero for neutral. Node distance sets magnitude (closer = stronger); global relationship strength scales both the room generator and pod annealing, including room-to-pod anchors. The cross-pollination penalty remains separate. These are soft preferences, not strict prohibitions. `state.relations` stores pair keys `i-j` and migrates unspecified old JSON edges to the current default (neutral as of V2.8.1). Accessible pair list supports overlapping lines.


## V2.7 — Circulation geometry and social thresholds
- `circulationPlan` partitions each ring plate into an outer access corridor, optional intermediate loop, two opposing wedge-shaped elevator/link zones, and available room bands. Entrance void is excluded. The two lift banks align with the roof boarding bridge axis.
- `roomLayout` fills remaining annular intervals with seeded program areas; adjacent mutually attracted different-program rooms may yield area to a shared lobby, according to relationship magnitude and global strength. Neutral/repel pairs have no shared doorway. All rooms retain access to common circulation. This is a conceptual access topology, not code analysis.
- Corridor width is adjustable, clamped only when a narrow ring cannot fit it. Corridor, shaft and shared lobby areas are separately accounted within GFA. Remaining core room allocations are reduced; modules keep their area.
- Preserve the L2 entrance void; the outer corridor on this level is a connected horseshoe rather than a full loop. Lift and circulation geometry is exported in semantic layer groups. JSON schema 9 includes circulation geometry and door records; old JSON imports use new defaults.
- Detailed door cuts, stair/egress design, accessibility, elevator cabins and slide/circulation vertical clearances remain future work.

- The circulation panel reports attracted-pair coverage, including pairs with no feasible shared lobby in the current layout. It is not a hard adjacency solver.


## V2.8 — Outdoor entrance plaza
- `designPlaza` derives a 15 m extension beyond the docking tips from the lobby wedge. The forecourt widens only beyond the modules, with a clear pedestrian axis and planted seating islands. The existing approach is included in its area, calculated separately from enclosed GFA. A zero lobby hides the plaza.
- Shared `buildMesh` creates distinct export layers for paving, promenade, planters, trees and seating. The plaza is visible in all-level and ground-floor views and included in exports.
- Medium blue-teal (#287fa7) identifies water slide geometry separately from light blue Infinite Rinse program massing.
- JSON schema 10 adds `entrancePlaza` and `outdoorBalconiesAndGardens`; `outdoorPublicArea` now includes the forecourt. Prior settings imports remain compatible.


## V2.8.1 — Neutral topology defaults
- `relationMode` returns neutral for unspecified distinct-program pairs. New/reset configurations begin with all ten pairs neutral; explicit imported or locally saved pair modes remain intact.
- The topology-only Set all relationships to neutral button clears `state.relations` and regenerates the layout without resetting other settings or node positions. Same-program grouping and the separate cross-pollination control are unchanged. Neutral pairs produce no attraction-driven shared lobby.


## V2.9 — Direct slide connections, public roof, inspection and area budget
- `state.areaCap` is a user-adjustable 5,000–50,000 m² cap, default 20,000. Base program goals (7,500 / 8,000 / 1,500 / 1,000 / 2,000) remain the reference proportions, not guaranteed minimums. Auto mode solves the core size by reserving enclosed rooftop uses, modules and retail inside the selected cap. Manual geometry is clamped conservatively and can leave unused area.
- `designRoof` deterministically creates commercial pavilions and gardens using the seed. Both elevator blocks extend to the public roof, with service volumes above them; their two enclosed footprints are conservatively counted. Open landscape, the swing boarding deck, and open gazebos are tracked outside enclosed GFA. The atrium glazing stays separate and non-walkable.
- `connectSlide` alters the selected upper and lower Infinite Rinse rooms: extends each to the exterior radial limit, partitions the outer corridor locally into an inner bypass and radial returns, updates room/circulation areas and door position, and reserves the affected docking slots. A diagrammatic opening is cut in the massing face. If suitable vertically separated IR rooms are unavailable, no slide is generated.
- Shared lobbies now use saturated purple (#80509e), have larger preferred widths, and include small timber gathering tables/benches where they fit. Neutral relations still generate no shared lobbies by default.
- Below the central viewport, X-ray flattens rooms and hides the facade/roof for inspection; Rooms, Modules, Facade and Roof landscape are independent display controls. X-ray is intentionally diagrammatic. Full semantic export ignores display switches. Zoom minimum multiplier 0.06; camera and new controls included in JSON and local save.
- Layered geometry includes rooftop landscape, paths, pavilions, lift access and service structures, hub furniture, and revised slide portals/corridors. Native Rhino export still uses the external rhino3dm.js CDN, with the offline Rhino Python script retained.
- Tests: 45 systematic and 75 random configurations (auto/manual, cap, levels, width, modules, relationships, slide), no cap or area-balance violations. Chromium software renderer, actual visibility buttons, cap control, extended wheel zoom, JSON restoration and export geometry tested. Local file storage and native Rhino export are not independently verified here. The geometry is conceptual: structural viability, lift specifications, slide clearances, detailed door and fire egress remain unresolved.


### Animated swing ride (V2.9)
- The ride defaults to animation, with a canvas-toolbar **Animate swings** toggle saved in local storage and JSON. The model's 15 m seat radius and Prater's advertised 60 km/h tangential cruise speed imply 10.61 rpm (5.65 seconds per revolution). Reference: https://prater.at/en/attractions/prater-turm/ . This is steady-speed conceptual animation, not a full ride operating sequence or engineered clearance analysis.
- `prepareSwingMesh` extracts only the `Swing_Crown_and_Seats` geometry ranges; `rotateSwingMesh` rotates the positions and normals about the global vertical axis from the unmodified vertices. The mast and boarding platform stay fixed. WebGL uses partial buffer uploads, software rendering is throttled. The animation does not rerun the massing solver, and the Rhino export remains a stationary snapshot of the canonical geometry.


## V2.9.1 — Opaque exterior envelope
The outer facade is now a solid, neutral-colored 200 mm conceptual wall inside the outer ring radius, rather than transparent glazing. The ground entrance and slide portals retain full-height openings; occupied docking thresholds retain door-height openings. The X-ray and Facade controls hide the envelope for inspection. Full exports always include the opaque facade on the existing Facade_Ln layers; the atrium glass roof remains glazing. Gross floor area and the saved-state schema/key are unchanged.


## V2.9.3 — Exterior wall thickness
A 500 mm nominal solid outer envelope replaces the 200 mm wall. Actual thickness is limited to 45% of the ring width in extreme undersized configurations. Geometry extends inward from the same gross outer radius and is included in the existing facade layers and JSON geometry metadata. Openings and display toggles are unchanged. The GFA budget is unchanged; circulation and program schedules remain gross conceptual allocations, not net clear area or detailed structural design.


## V2.9.4 — slide-side rooms and stacked cutaway
- Render/export all exterior-facing core room masses up to the interior face of the 500 mm wall, with a 35 mm diagrammatic reveal; scheduled room areas remain gross allocations. Extend the slide centerline inward through both portal openings.
- For the physical slide clearance slots on every floor, eligible outer-band rooms with meaningful frontage overlap are shifted to the facade; the corridor is repartitioned into an inward bypass and radial returns. Additional docking positions that would conflict with the relocated room frontage are reserved before the inventory solver runs. Landing rooms remain Infinite Rinse, other shifted rooms keep their existing program. Lobby, lift, shared hub, and too-narrow room zones are not overwritten. Detour selections are based only on physical slide clearance, not recursively on frontage reservations. The revised program/circulation areas are recalculated and exported.
- `state.inspect` is now the cumulative highest visible floor (0 = full building plus roof), rather than an isolated level. It is a view-only setting, placed below the canvas. Hide upper rooms, slabs, facade and modules, roof structures and swing crown; retain the tower shaft and clip the slide and lobby to the selected height. Full export always ignores the cutaway.


## V2.9.5 — larger internal program zones
- Minimum core room area control (40–200 m², default 80), persisted in local storage and JSON. Preferred initial ranges: Rinse 150–540, love hotel 80–210, marine firehall 120–360, daycare 100–240, senior care 80–210, unassigned 80–240 m²; the global control can increase these.
- Merge undersized angular residuals with adjacent rooms of the same band, preferentially same program. Isolated fragments become circulation alcoves. This can change exact program allocation; actual room areas feed the existing schedule and all areas remain inside the cap.
- Shared lobbies and facade slide relocations respect the minimum; if a feasible pair of slide landings cannot fit, no slide is generated. Keep the remaining area geometric, not net usable/code-compliant.

## V3.0 — Interface and usability pass
- Keep the original geometry solver, area cap, topology, file formats, storage key, camera, and named layer export semantics.
- Design panel: Building (geometry + circulation), Modules (inventory + vacancy), Features (atrium/slide/roof/display). Program panel: Topology and Allocation. Tabs use ARIA, keyboard navigation and hidden tabpanels; existing IDs are unchanged so all readouts and controls remain connected.
- Desktop workspace has independently scrolling design/program panels with a fixed central model. Tablet stacks settings to the right; small screens have a sticky model stage and stacked settings. Area details switches to a compact viewport and expanded schedule.
- Numeric entries next to primary sliders commit on change/Enter, bounded by the same range/step as the original control. Auto-size shows the calculated footprint as a disabled value. Readouts are grouped into expandable calculation details. Reset has a confirmation step. File actions are grouped under Files & export. The area budget bar displays remaining space and the selected cap.
- Quick view actions update the existing mesh without re-running the geometry solver. People/animals checkboxes and canvas toggles are synchronized; the previous release referenced missing checkbox IDs (fixed). Corrected standing figure foot elevation, gave wheelchairs polygonal wheels, and added indoor dogs in suitable circulation regions. These remain static conceptual placeholders, not simulated occupants; area unaffected. Figures included in existing placeholder export layers when enabled.
- Browser checks: software-rendered Chromium, tabs, direct entry, visibility, schedule expansion, relationship cycling/reset, state restoration, responsive layout at 390 px, fixed viewport, geometry export payload, 12 varied geometry/area configurations. Native Rhino3dm.js, hardware WebGL and persistent browser storage across actual file reloads remain unverified in this environment. The state restoration code path was exercised directly. No network required for normal modeling.

## V3.2 — Cross Pollination Laboratory
- Persistent topology map above design tabs; click a node to toggle same-program clustering, drag to adjust relationship placement. Cluster starts off for all programs. Clustering prioritizes local room grouping and aligned pods, constrained by available geometry; not a guarantee of one contiguous block.
- Shared hubs are purple gathering zones with lavender rugs, couches and tables. Neutral pairs do not create hubs; attraction must be enabled and the packing rules must allow sufficient room area.
- `buildNavigation(m)` constructs a conceptual navigation graph from circulation sectors, hubs, core rooms, module dock thresholds, balcony/garden destinations, entrance plaza, greenhouse perimeter, lift links, roof, and ride landings. Humans and dogs enter/exit through the plaza; wildlife uses outdoor habitat routes. Doors and movement remain diagrammatic, not code-compliant pathfinding. Physical collision avoidance, actual accessibility compliance and human/animal behaviors are not validated.
- `makeOccupancy`, `advanceOccupancy`, `advanceScored`: seeded agent motion, dwell times, recent departed room/program memory, temporary attraction to hubs, recent ride experience. Fixed 0.25 s simulation steps; scoring samples once per simulated second. Display controls do not change the population or score. Exact five-minute trials use a separate sim instance so the live run is not disturbed.
- `scoreSample`: pairwise proximity at most 2.5 m within the same accessible zone or compatible adjacent cells. Base weights (points per 10 seconds of contact): hub 5, room/module 3, garden/gazebo 2.5, plaza/entrance 2.5, balcony 2.5, greenhouse 2.5, roof promenade 2, ride 2.5, circulation 0.5. At most 15 seconds credited per encounter; 8-second separation before re-credit. Multipliers: different previously departed room 1.5, different program 1.2, cross-species 1.3, fun within 90 seconds 1.4. Weights are adjustable. Fixed-duration trials and normalized score (weighted points / 100 active-agent-minutes) allow comparison, not a validated social performance metric.
- Score remains visible above Score / Allocation / Visitors tabs. Design changes restart live run. Up to eight five-minute comparisons retain their settings and breakdown in memory and are included in JSON export (schema 16); importing a JSON restores comparison records and settings, not the exact live avatar paths. Compare only the same seed, visitor count, duration and weights; multiple seeds reduce random effects.
- Tested in Chromium software rendering: exact repeated trial reproducibility, UI tabs, area cap and module reachability for multiple configurations, geometry export data, visibility preserving simulation state. Native Rhino file creation and hardware WebGL remain unverified.

## V3.3 climbing attraction
- `climbWidth` (0–24 m, default 10 m) sizes a curved exterior wall up to 19.8 m high. Reserve every dock whose level and angular width intersect the climb strip, with lateral margin. This is an open exterior feature, not additional enclosed GFA.
- Slide centerline smoothly bows outward at crossings; target 5 m conceptual clearance between wall face and tube exterior, not engineered safety validation. Entry/exit rooms stay clear of the climbing strip.
- Climbing is a ground-level destination via the plaza and outside pathway. Selected visitors ascend then return along the wall to the base, where recent recreation memory is recorded. No roof shortcut; roof rails remain intact. Low-poly visual and behavioral placeholders only, not accessibility or fall-protection engineering.
- Browser tests: eight massing configurations, two crossing cases with 5.18 m sampled radial clearance, six completed ascents/descents within a 600-second trial, plus exported geometry and max-height checks. Native Rhino and hardware WebGL not verified.

## V3.4 — Cross-pollination dashboard
- The main research metric now occupies a dedicated persistent strip directly above the central model viewport. Keep the live normalized rate prominent, with encounter count, different-room encounters, cross-species encounters and elapsed simulation time beside it. The rate is not a percentage and has no arbitrary ceiling.
- Show warming-up, live and paused states. The quick five-minute trial button invokes the existing comparison workflow and displays progress and the latest completed trial rate separately from the live rate. Detailed weights, breakdown, history, allocation and visitor settings remain in the right-hand panel.
- The change is presentation-only: keep the geometry solver, visitor simulation, score calculation, JSON schema and storage compatible with V3.3.
- Verified in software-rendered Chromium: score/readout synchronization, separate trial completion, pause status, visibility when switching analysis tabs, responsive widths at 1440, 1280, 1024 and 390 px, no runtime errors. Native Rhino and hardware WebGL were not retested.


## V3.6 – Design rationale and authorship record
Added a separate, printable documentation view to the unchanged V3.5 lab, via the header button `Design rationale`. Page distinguishes student-originated design decisions, AI computational implementation, and iterative proposals. Diagrams are schematic SVG; prior interface screenshot embedded. No changes to the solver, simulation, scoring, saved-state schema, or export logic. Simulation continues in the background while the documentation view is open unless paused in the model.

### V3.6 continuation — full perimeter plaza and cyclical swings
The design record now includes the latest user-requested outdoor loop and ride cycle. `designPlaza(R,lobby,slots,climb)` derives an open annular public realm outside the dock tips, a walking loop, radial connections to the entry and climbing wall, and program-influenced activity islands. Outdoor plaza area is excluded from the enclosed cap. Near-program affinities bias amenity type; fallback assignments preserve diversity. Court and fall-zone dimensions remain schematic. `buildNavigation` adds promenade and activity destinations to the shared human/wildlife graph; climbing remains an up-and-down activity. `swingPose`, `buildSwing`, and `advanceRide` share a 106-second deterministic cycle: board 18 s, ascend 22 s, cruise 30 s, descend 26 s, unload 10 s. Speed-dependent chain angle is a quasi-static conical-pendulum approximation. Visitors queue at the roof-level boarding platform, occupy one of 18 seats, unload at the same platform and earn recent-fun memory only upon completion. No detailed loading accessibility, collision avoidance, ride engineering or crowd analysis is implied. The ride follows simulation time; queued/boarded riders pause with the simulation. The existing numerical cross-pollination formula is unchanged, but trials now include the extra exterior destinations and completed rides. Model design settings still survive entry into and exit from the Design Rationale page. Browser software-rendered tests: default seven-minute simulation (8 completed swing rides, 392 plaza encounters); 5 area-cap configurations, desktop and mobile rationale navigation, geometry export data. Native Rhino and hardware WebGL not retested.
