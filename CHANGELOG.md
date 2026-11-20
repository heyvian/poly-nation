# Changelog

## West Village site study and overhead cameras
- Added mapped OpenStreetMap waterways, woodland and trees to Site. The West Village preset matches two Bow River crossings to the supplied drawings and cuts the proposed canals into the DEM at a shared river study elevation.
- Set Plan to a true vertical orthographic projection in the model viewers and plan drawings.
- Moved application scripts, styles and study data out of the main HTML. Browser suites now exercise the same asset loading as GitHub Pages.

## Slab depth and storey height
- Keep the ground-floor datum and typical clear height fixed when slab depth changes. The working model raises upper floors and the roof, with the revised datums shared by geometry, navigation, drawing cuts and exports.

## Connection drawings, terrain and document sets
- Saved Build visibility and level selections. Added a configurable Infinite Rinse water-load comparison to the core slab estimate.
- Added three layered 1:25 concept details tied to the selected dock system, including the module bearing and a proposed 500 mm service zone.
- Added a Site workspace for decimal coordinates and public elevation tiles, plus printable programme, circulation and structural drawing sets.
- Increased the contrast among five stable cladding tones on repeated modules to make the variation visible in whole-building views.
- Moved the roof-hung dock backspan below the public deck to clear rooftop circulation and rooms.

## Drawing outlines and Illustrator import
- Added independent overall silhouette and key component outline emphasis. Both work with distance-based line weights and export to named SVG layers.
- Updated the Illustrator import script to identify artwork using the SVG's layer list and temporary text markers that it removes after import.

## Scale-aware drawing pens
- Added an optional adjustment for pen weights at the current drawing scale. Fixed printed widths remain the default. Preview, SVG and print all use the effective widths shown in the line-weight panel.
- Put paper and pen colour pickers on one row. Replaced the footer’s paper-size label with a metric scale bar alongside the drawing ratio and added a ring-inspired north arrow to plans and axonometrics.

## Illustrator export and jury diagrams
- Reorganized exported SVGs into named top-level groups and added an optional Illustrator script to promote them to native layers. Hybrid shading is exported as editable vector fills.
- Made the pencil overlay more visible, added geometry-based construction lines and introduced subtle pressure variation within each pen layer.
- Added illustrated site, atrium, programme allocation and jury review slides. Every rationale slide now has a visual.

## Runout pool, drawing pens and jury rationale
- Extended the receiving pool along the slide exit and added a slide paint picker, hex field and sheen control.
- Added one to five physical line weights, distance and component assignments, a pen-over-pencil style and adjustable ink and paper colours. SVG drawings carry separate colour, texture, pencil and pen layers.
- Reworked the architectural rationale as an ARCH 606 jury deck and added diagrams of the dock closure, structural alternatives and slide landing.

## Slide wall joints, rooftop shops and paint
- Added a 36-sided Build slide with sleeves, flanges and fitted flashing at both façade crossings, plus an upper boarding platform and lower receiving pool.
- Modeled straight-sided prefabricated rooftop shops on skids and added an independent Materials scope for their structure and exterior finish.
- Added module paint palettes with editable custom colours and matte, satin and gloss options. Daycare starts with glossy bright colours varied by dock.

## Build rides and dock refinements
- Added the swing assembly and a waterslide with bolted section joints to Build and its drawings.
- Moved cable stays to the top of their own dock storey, removed the deep underfloor systems from the stacked layout, and added 220, 260 and 300 mm slab studies.
- Aligned framing sections to each bay. The Modules toggle controls the chassis, cladding and balcony or garden decks together.

## Dock structure comparisons
- Added eight Build dock systems, including underfloor frames, cable stays, roof hangers and tip columns. The selection carries through to Build-source drawings.
- Added a gravity comparison and flagged underfloor systems that enter grade or an occupied or reserved bay below.

## Shared model controls
- Matched orbit, two-axis pan, zoom, and the 3D, Plan, Side and Fit shortcuts across Massing, Materials and Build. Touch uses one finger to orbit and two fingers to pan or pinch-zoom.

## Dock structure and slab study
- Extended Build partitions to the slab above and kept door openings below their lintels.
- Replaced the shallow docking rails in Massing and Build with paired tapered steel trusses. Open decks, gardens and empty bays share the frame. Reserved bays stay clear.
- Added sealed or overhead-folded dock closures and aligned Build's girders, columns and dock ties to the bay grid.
- Added a conceptual gravity check for dock reactions, tip deflection and the beam-supported concrete slab.

## Module balconies and laundry
- Added semicircular balconies at the outer ends of Senior care, Love hotel, upper-floor Marine firehall, and about one fifth of Infinite Rinse modules.
- Added seeded laundry lines between Senior care modules and adjacent enclosed modules on the same floor. Balcony and laundry geometry appears in the Massing model, material previews, and Massing drawing and geometry exports.
- Included the module balconies in the Build assembly and its drawings.

## Material-led build and floor drawings
- Ordered the navigation from Massing through Materials and Build to Drawings.
- Added a compass and horizontal orbit for Elevation, floor-relative horizontal cuts, and a center snap for vertical cuts.
- Added a shared-scale floor-plan sheet and a printable set with one page per floor.
- Added material choices for commercial enclosures, the water slide, and the swing mast.
- Carried material assignments into the Build assembly, with a separate facade toggle. Drawings can use the Massing or Build geometry with the same assignments.

## Drawing composition and assembly studies
- Added drawing pan, Fit and Ground placement, axonometric compass directions, and hybrid linework with program colors or material textures.
- Grouped material presets by family, added core options for steel framing with rammed-earth cladding, and restricted module palettes to lightweight assemblies. Added stable variation to repeated module finishes.
- Added an independent experimental Build canvas for framing, slabs, walls, module chassis, and dock connections.
- Replaced the swing crown's upright ring bracing with tapered radial trusses based on the designer's section sketch.

## Drawings and atrium details
- Added a Drawings workspace with orthographic SVG linework and movable horizontal and vertical clipping planes.
- Added Letter and Tabloid drawing sheets in either orientation, with architectural scales and physical dimensions in SVG and print output.
- Straightened both lobby approaches and joined them to a circular path around the swing mast.
- Added a vertically braced truss profile to the moving swing crown.

## Model framing and swing boarding
- Fit now centers the visible model and adjusts zoom for the current angle and available space in Massing and Materials.
- Widened the swing boarding platform to leave 1 m beyond the parked chairs where space allows. Added a glass railing with a clear opening at the stair landing.

## Atrium and roofline
- Moved the Atrium bridges selector into Building and kept the selected view while changing the layout.
- Moved radial and aligned bridges closer to the swing mast with a fixed 0.65 m modeled gap.
- Matched the open atrium floor-edge railings to the bridge railings and kept the bridge landings clear.
- Oriented swing chairs and seated riders in the direction of rotation.
- Raised the conical glass roof ridge up to 8.4 m above the public deck. The boarding platform closes the roof at the top, with stairs above the glazing.
- Put the opposing lobbies, bridge arrangements, pitched glass roof and two-storey pavilions at the front of the design rationale. Detailed ride mechanics remain in the simulation notes.

## Material snapshots and circulation
- Added a PNG snapshot of the current material model with all six assembly cards and their material variants.
- Added persistent Massing and Materials navigation alongside Design rationale.
- Modeled two opposing lobby atriums and a walkable greenhouse crossing between their plaza approaches. Recorded the designer's cross-pollination intent in the design rationale.
- Added optional radial or vertically aligned atrium bridges to the upper-floor geometry, walking graph and trial comparison log.
- Pitched the glass greenhouse roof and added a ramp to the raised swing platform. Seeded roof heights now include occasional two-storey pavilions within the area cap.

## Allocation search
- Added **Optimize allocation** to compare built core-to-module ratios while preserving the total area of each program.
- Renamed the comparison button **Run Pollination Trial**.

## Programming and layout trials
- Removed the location dropdown. Select a room, module, or available dock on the model to open its program editor.
- Applying an optimized layout automatically runs a fast trial and adds the result to the trial log.

## Massing controls and navigation
- Promoted Materials in the header and moved New variation and Reset design beside Edit programming on the model.

## Layout optimization and trial comparisons
- Added **Optimize layout** to the trial drawer. It compares alternate module placements under the current program areas, manual assignments, and topology rules, then offers a preview before applying a better-scoring result.
- Put changed settings first in trial comparisons and highlight the new values. Layout and encounter changes follow.

## Trial log and Massing controls
- Moved fast trials into a collapsible right-hand drawer shared with Area Schedule. The baseline records the design and scoring inputs, and later runs show changes from the preceding result with a model thumbnail per run.
- Flagged comparable trial scores as minor or major increases or decreases.
- Removed duplicate relationship controls, the solver cost, and the clustered-program list from Topology Designer. Moved programming edits to the lower-right of the model and removed the viewport badge and seed label.
- Renamed the live encounter counter to Different prior rooms and explained which encounters it counts.

## Massing settings
- Made the settings rail roomier and increased tab, label, and input sizes. The Topology Designer can collapse to give the settings more vertical space.

## Fast comparison trials
- Both trial buttons use the latest massing edits and show progress, results, or cancellation in place.
- The trial processes five simulated minutes at browser speed using the existing fixed time steps and scoring.

## Design Rationale and workspace restoration
- Refocused the illustrated and text rationale on architectural programming, module placement, circulation, and materials. Showed how the Topology Designer shapes a generated ground-floor plan.
- Reloading a browser tab restores the active Massing, Materials, or Design Rationale view.

## Programming preview
- Highlighted editable rooms, modules, and docks on hover with the location and program shown before selection.

## Materials rendering and identity
- Added visible material names to the palettes and used depth-tested Materials rendering to clean up overlapping surfaces.
- Added a Poly Nation wordmark and an SVG mark based on the radial plan.

## Materials workspace
- Kept the live model visible above six collapsible, scope-highlighted assembly cards. Replaced material selectors with swatches and removed individual module editing.
- Added editable CAD benchmarks, an assembly takeoff with per-unit and total estimates, and a live summary of structural behavior and material diversity.

## Assembly schedule and Firehall placement
- Added exploded axonometrics for the core and module programs, with material variants, comparative mass and cost, and a qualitative strength profile.
- Firehall modules now fill compatible ground-floor docks first, with each upper floor capped by the count below.

## Materials and manual programming
- Added an independent Materials workspace with a refreshable massing snapshot, structural and exterior assignments, and saved rationale notes.
- Added room and module program editing and dock insertion in the massing model, with solver validation before applying an edit.

## Topology Designer
- Selected programs now cluster at 0% strength, with the slider adding emphasis.
- Widened the relationship diagram within the existing height.

## Topology and Materials
- Improved clustering for any selected program, including Firehall, with better core room alignment and a stronger preference for vertical module stacks.
- Repel now prioritizes separating same-floor room and module neighbors while allowing vertical neighbors. The topology panel reports any same-floor conflicts left by packing.
- Added a Materials phase placeholder with space for a future design rationale.
- Reformatted and documented the active JavaScript for easier maintenance.

## Topology controls
- Renamed Relationship strength to Clustering strength. The slider adjusts grouping and alignment for the selected programs. Attract, Neutral and Repel keep their own weights in the core, at module docks and in visitor routing.

## Swing ride refinement
- Doubled the time at the top from 30 to 60 seconds, for a 136-second cycle. Reduced cruise radius from 15 to 12 m and cruise speed from 60 to 40 km/h to lessen outward chain tilt.

## Codex handoff — V3.6 unchanged
- Packaged exact current index and illustrated rationale, prior HTML snapshots, previews, context, and portable regression tests. No app behavior changed during packaging.

## V3.6
- Integrated printable Design Rationale (11 illustrated sections), standalone companion.
- Full exterior promenade with program-influenced amenity zones and entry/climb approaches; outdoor area excluded from enclosed cap.
- Fully cyclic swing animation and visitor queue/load/ride/unload; 30-second top dwell, speed-dependent chain angle.
- Added navigation to exterior destinations and completed ride memory. No scoring formula change.

## V3.5
- Single sidebar, persistent Topology Designer + relationship strength, taller model viewport and score below canvas.

## V3.4
- Persistent cross-pollination dashboard, quick independent comparison trial; initially above canvas.

## V3.3
- Climbing wall width slider, 19.8 m height cap, reserved docks, outward slide crossing, climbing round trip scoring.

## V3.1–V3.2
- Furnished shared lobbies and per-program clustering; agent-based navigation; weighted encounter score, memory/fun bonuses and comparative trials.

## V3.0
- Grouped settings, numeric inputs, budget indicator, responsive UI, visibility and population geometry fixes.

## V2.x
- Core/module allocation, cap, dynamic circular room packing, topology, vacancies, entrance and circulation, roof, slide and swing, opaque façade, room minimum, cutaways, avatar placeholders, persistence and Rhino interchange. See COPILOT.md for exact version notes and docs/DESIGN_HISTORY.md for student direction.
