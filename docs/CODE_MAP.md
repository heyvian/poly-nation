# Code map

`index.html` holds the workspace markup and loads the JavaScript in dependency order with deferred scripts. The source lives in `src/`, with no build step. `workspaces.js` starts the app after the model, tools and workspace controls are available. The stylesheets and digitized site plan live under `assets/`.

| Source | Responsibility |
| --- | --- |
| `model.js` | Saved design settings, derived geometry, program allocation and topology |
| `geometry.js`, `lab-ui.js` | Shared mesh and projection, rendering, camera input, Massing controls and geometry export |
| `simulation.js` | Circulation graph, occupancy, scoring, trials and optimization |
| `materials-catalog.js`, `materials.js` | Material assignments, estimates, snapshot controls and the Materials canvas |
| `workspaces.js` | Startup and workspace navigation |
| `build.js` | Experimental assembly, dock support and slab studies |
| `drawing-geometry.js`, `drawing-documents.js`, `drawings.js` | Projected geometry, architectural and Illustrator exports, drawing controls |
| `connection-details.js` | Scaled connection contexts, exterior fitting profiles and demand annotations shared by both drawing outputs |
| `site-maps.js`, `site-water.js`, `site.js` | Natural features, control-point alignment, terrain cuts, elevation tiles and building placement |
| `rationale.js`, `rationale-page.js` | Shared deck controls and the standalone page entry point |

- `defaults`, `state`, `PROGRAMS`, `MODULE`, `applySaved`: controls/defaults and backward-compatible persistence. Storage key `poly-nation-massing-lab-v2.5`; current exported JSON schema 17.
- `derive`, `circulationPlan`, `roomLayout`, `clusterAngle`, `clusterRoomBias`, `place`: annular area sizing, program inventory, room/threshold arrangement and seeded topology. `refineRoomPlacement` prioritizes same-floor separation, then angular concentration and attraction. `place` keeps module counts fixed and rewards stacks for selected programs. `relationMode` defaults to neutral.
- `designRideAndSlide`, `designClimbing`, `connectSlide`, `designPlaza`, `designRoof`: features, physical reservations, public spaces and area accounting. Slide/room modifications affect layout before slot assignment.
- `meshBuilder`, `buildMesh`, `buildSwing`, `swingPose`, `prepareSwingMesh`, `rotateSwingMesh`, `animateSwingFrame`: geometry and animation. `draw`, `drawSoftware`, `upload`, `refreshView`: renderer and view-only state. Software fallback depth-sorts triangles; it can exhibit overlap artifacts.
- `buildNavigation`, `makeOccupancy`, `advanceOccupancy`, `advanceRide`: visitor paths, memory and behavior. `advanceScored`, `scoreSample`, `crossRate`, `renderCrossScore`, `renderTrials`, `cpSignature`: scoring and comparisons.
- `exportGeometry`: full mesh/line groups, meter units and Rhino Z-up coordinate conversion. Native 3DM loader uses pinned rhino3dm 8.17.0 CDN; offline Python script export retained. Inspect actual code for options and error handling.
- `update`: design regeneration, readouts, model upload and state save. `applyProgramEdit` validates a trial layout before committing a manual room or dock assignment. `refreshView` should not reset the score on display changes.
- The Materials workspace uses a detached massing snapshot, its own canvas and camera, and separate browser storage. `materialValues` resolves inherited assignments and `buildMesh` adds the schematic material preview. The embedded design record preserves massing state. Update the embedded `designRationale` view and standalone Design_Rationale.html together when documenting decisions; no runtime external dependencies for rationale.
- `slideSurface` resolves tube paint and sheen and supplies both 3D renderers through the mesh. `receivingPoolPlan` fits the basin along the terminal tube heading inside the annular room. These details belong to the assembly and drawing study.
- `floorPitch` adds slab depth while preserving typical clear height. `derive` shares that pitch with the level-dependent model features, and `buildStorey` computes slab and soffit datums from it. `buildGravityStudy` compares dock reactions and the core slab strip. `drawSharedDockSupports` places the roof-hung return below the deck.
- `drawingGeometry` carries model-layer names into drawing components and identifies surface-joint strokes. `renderDrawing` finds visible strokes, assigns physical pen widths and adds sketch marks. `traceDrawingFills` traces visible colour regions into closed paths. `vectorDrawingSheet` moves the drawing into named root groups with independent crops and keeps each floor-plan tile aligned. The optional Illustrator script promotes the named groups while preserving their stack order.
- `drawConnectionContext` draws the 1:25 context. `drawFittingPanels` uses the same exterior profiles in the scaled connection sheets and the printed structure set. `dockSupportDemand` feeds Build and the drawing annotations from one service-load estimate.
- `siteElevationSampler` decodes public elevation tiles and `siteAssemblyMesh` places the Build mesh at the local site datum. `fetchSiteNaturalFeatures` tries Overpass and the public OSM map endpoint with independent timeouts. `alignWestVillageWater` matches two Bow River crossings to the source sheets. `terrainOutsideSiteWater` cuts the sampled terrain triangles along the digitized waterside edges.
- `initRationaleSlides` gives each jury topic its own view. Print styles show the full deck. Keep the embedded and standalone deck content synchronized with the Markdown companion.

Exact controls, default paths and export semantics should be verified against source and tested after changes. No major framework migration was performed in the handoff.
