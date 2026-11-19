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
- Module: 4.5 m tangential width × 18 m radial depth × 3.5 m height = 81 m². Fit radial docking positions outside the ring using tangential clearance (current gap 0.9 m and radial offset 0.65 m). Each position has a floor and angular index. A module extends outward, attaches short end to ring, and can be removed. Vacant positions remain vacant, not filled with fake mass. Count is limited by geometry; warn rather than claiming unplaced modules fit. Present supports are symbolic docking rails, not engineered structure.
- Allow exact parameter input as a later enhancement. Consider optional paired 162 m² modules, variable floor heights, sectional views, movable facade closures and exposed attachment structures later. Do not accidentally change what 81 m² means.

## 3. Allocation

For each program request `goal * coreShare` in the core. Reserve the entire courtyard for Infinite Rinse first, even if that overrides its requested percentage. Allocate remaining ring area to the requested stable programs in proportion if insufficient; surplus goes to neutral unassigned capacity. Modular demand is the remaining requested program area, not a promise that every target is met. Allocate whole pods by largest remainder, respecting total feasible installed count; surplus pods are gray. Report target, actual core, pod count, actual total, variance. Maintain conservation: total geometric modeled floor area equals ring area × floors + courtyard once + installed modules × 81. Never quietly double count the greenhouse or use fractional pods. Preserve the distinction between requested shares and actual allocations. A later optimization mode may automatically choose geometry to match targets, but current controls are independent.

## 4. Topology map and placement solver

The draggable nodes are an abstract relationship diagram rather than a literal site plan. The normalized Euclidean distance between program nodes defines a soft adjacency cost: close = prefer adjacent, far = prefer separation. Same program has zero pairwise cost. Visible connecting lines respond to distance. The current stable ring uses angular node order and a weighted rotational alignment, so sector width remains proportional to assigned area. This is a heuristic; radial position in the wheel does not automatically represent real-world direction or physical distance.

For modules, create adjacency edges between horizontally neighboring slots (wrap around) and vertically neighboring slots. Each slot also anchors to its nearest/underlying ring sector. Randomize a fixed inventory of program labels and vacancies with a deterministic seed. Minimize the energy with bounded simulated annealing using label swaps, preserving all counts. Pairwise cost is based on node distance; anchor cost favors related core sectors; vacancy handling is a weak compactness preference. `Relationship strength` changes how strongly the optimizer follows topology versus the initial random distribution. Zero = randomized assignment, not zero core program area. `New variation` increments the seed; the same state/seed must reproduce the same result. A lower score is only meaningful for comparable relationship settings and geometry. Soft preferences are not enforced safety requirements.

## 5. Interaction and design priorities

- Left panel: geometry / module capacity / display toggles. Central large 3D axonometric viewport with persistent orbit, zoom, plan / axon / fit. Right panel: topology diagram and requested stable/modular splits. Below viewport: live area metrics, color distribution, full program schedule. At smaller widths stack controls responsively.
- Keep the building as the fixed orbit target. Never allow under-ground views. Update in place as sliders or nodes move, throttle computational work with requestAnimationFrame and keep camera orientation when recalculating. No full page reload. Keep the model geometrically clear rather than visually realistic.
- Export JSON with current state, program allocations, ring sectors and each docking slot's floor, center, angular rotation and program or vacancy. Later add matching import, versioned scenario saving, compare alternatives, editable area goals, GLTF/OBJ/DXF export (or a Rhino/Grasshopper JSON bridge) and optional screenshot export. Use meters throughout, no unit conversion on export.
- Later optionally introduce hard program constraints (firehall at canal/grade, daycare and senior accessibility, protected circulation, separation of public recreation and contaminated process streams), separately from soft program preferences. Avoid asserting that the conceptual model verifies structure, access, fire safety, real process layout or water treatment feasibility.

## 6. Current prototype and tests

Open `index.html` directly in a desktop browser; no npm install or web server needed. The prototype's WebGL path is implemented but this restricted test environment did not provide WebGL; the software-rendered 3D fallback was exercised in Chromium. The fallback uses depth sorting, so may show minor overlapping-face artifacts, unlike a depth-buffered renderer. Tested initial calculation (19,958 m² rounded; 110 pods), geometry controls, map dragging, camera orbit, roof visibility, seed changes, reset and JSON download. Before major expansion, add unit tests for area conservation, module count invariants, empty inventory, over-capacity and deterministic seeds; test the GPU path on a supported browser.
