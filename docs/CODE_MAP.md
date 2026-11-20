# Code map

Current app is a self-contained page. The authoritative baseline is index.html; search these symbols rather than relying on historic line numbers.

- `defaults`, `state`, `PROGRAMS`, `MODULE`, `applySaved`: controls/defaults and backward-compatible persistence. Storage key `poly-nation-massing-lab-v2.5`; current exported JSON schema 17.
- `derive`, `circulationPlan`, `roomLayout`, `clusterAngle`, `clusterRoomBias`, `place`: annular area sizing, program inventory, room/threshold arrangement and seeded topology. `refineRoomPlacement` prioritizes same-floor separation, then angular concentration and attraction. `place` keeps module counts fixed and rewards stacks for selected programs. `relationMode` defaults to neutral.
- `designRideAndSlide`, `designClimbing`, `connectSlide`, `designPlaza`, `designRoof`: features, physical reservations, public spaces and area accounting. Slide/room modifications affect layout before slot assignment.
- `meshBuilder`, `buildMesh`, `buildSwing`, `swingPose`, `prepareSwingMesh`, `rotateSwingMesh`, `animateSwingFrame`: geometry and animation. `draw`, `drawSoftware`, `upload`, `refreshView`: renderer and view-only state. Software fallback depth-sorts triangles; it can exhibit overlap artifacts.
- `buildNavigation`, `makeOccupancy`, `advanceOccupancy`, `advanceRide`: visitor paths, memory and behavior. `advanceScored`, `scoreSample`, `crossRate`, `renderCrossScore`, `renderTrials`, `cpSignature`: scoring and comparisons.
- `exportGeometry`: full mesh/line groups, meter units and Rhino Z-up coordinate conversion. Native 3DM loader uses pinned rhino3dm 8.17.0 CDN; offline Python script export retained. Inspect actual code for options and error handling.
- `update`: design regeneration, readouts, model upload and state save. `applyProgramEdit` validates a trial layout before committing a manual room or dock assignment. `refreshView` should not reset the score on display changes.
- The Materials workspace uses a detached massing snapshot, its own canvas and camera, and separate browser storage. `materialValues` resolves inherited assignments and `buildMesh` adds the schematic material preview. The embedded design record preserves massing state. Update the embedded `designRationale` view and standalone Design_Rationale.html together when documenting decisions; no runtime external dependencies for rationale.
- `slideSurface` resolves tube paint and sheen and supplies both 3D renderers through the mesh. `receivingPoolPlan` fits the basin along the terminal tube heading inside the annular room. These details belong to the assembly and drawing study.
- `drawingGeometry` carries model-layer names into drawing components and identifies surface-joint strokes. `renderDrawing` finds visible strokes and then assigns physical pen widths. `renderPens` emits the same named SVG groups for previews, floor plans and vector export.
- `initRationaleSlides` gives each jury topic its own view. Print styles show the full deck. Keep the embedded and standalone deck content synchronized with the Markdown companion.

Exact controls, default paths and export semantics should be verified against source and tested after changes. No major framework migration was performed in the handoff.
