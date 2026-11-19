# Code map

Current app is a self-contained page. The authoritative baseline is index.html; search these symbols rather than relying on historic line numbers.

- `defaults`, `state`, `PROGRAMS`, `MODULE`, `applySaved`: controls/defaults and backward-compatible persistence. Storage key `poly-nation-massing-lab-v2.5`; current exported JSON schema 17.
- `derive`, `circulationPlan`, `roomLayout`, `clusterAngle`, `clusterRoomBias`, `place`: annular area sizing, program inventory, room/threshold arrangement and seeded topology. `refineRoomPlacement` prioritizes same-floor separation, then angular concentration and attraction. `place` keeps module counts fixed and rewards stacks for selected programs. `relationMode` defaults to neutral.
- `designRideAndSlide`, `designClimbing`, `connectSlide`, `designPlaza`, `designRoof`: features, physical reservations, public spaces and area accounting. Slide/room modifications affect layout before slot assignment.
- `meshBuilder`, `buildMesh`, `buildSwing`, `swingPose`, `prepareSwingMesh`, `rotateSwingMesh`, `animateSwingFrame`: geometry and animation. `draw`, `drawSoftware`, `upload`, `refreshView`: renderer and view-only state. Software fallback depth-sorts triangles; it can exhibit overlap artifacts.
- `buildNavigation`, `makeOccupancy`, `advanceOccupancy`, `advanceRide`: visitor paths, memory and behavior. `advanceScored`, `scoreSample`, `crossRate`, `renderCrossScore`, `renderTrials`, `cpSignature`: scoring and comparisons.
- `exportGeometry`: full mesh/line groups, meter units and Rhino Z-up coordinate conversion. Native 3DM loader uses pinned rhino3dm 8.17.0 CDN; offline Python script export retained. Inspect actual code for options and error handling.
- `update`: design regeneration, readouts, model upload and state save. `refreshView` should not reset the score on display changes.
- The Materials placeholder and embedded design record preserve the massing state. Update the embedded `designRationale` view and standalone Design_Rationale.html together when documenting decisions; no runtime external dependencies for rationale.

Exact controls, default paths and export semantics should be verified against source and tested after changes. No major framework migration was performed in the handoff.
