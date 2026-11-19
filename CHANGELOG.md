# Changelog

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
