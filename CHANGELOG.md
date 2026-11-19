# Changelog

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
