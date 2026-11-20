# Poly Nation Cross Pollination Laboratory
**Developed from the V3.6 handoff**

A student-directed architectural research instrument for the Poly Nation / Infinite Rinse studio project: a stable mixed-use ring, adaptive plug-in modules, relationships, play and multispecies occupation, with a heuristic cross-pollination performance metric.

## Design workflow

Open `index.html`, set the massing, and use the Topology Designer to set relationships between programs. Attract favors nearby rooms and modules and can create shared lobbies. Repel prioritizes separating neighbors on the same floor and allows vertical module neighbors. Clustering strength governs how closely selected programs group, including vertical alignment.

In Massing, turn on **Edit programming**, then select a room, module, or available dock on the model. The editor shows the selected location and lets you assign its program. The solver checks edits against the area cap, reserved docks, same-floor repulsion, and entrance access. Firehall modules fill eligible ground-floor docks first. Each upper floor can have at most as many as the floor directly below. Room edits follow matching room locations. A different variation can make a saved location unavailable.

Use **Massing → Building → Atrium bridges**, under **Core geometry**, to choose **Off**, **Radial**, or **Vertically aligned**. The bridges pass close to the central mast and enter the pollination trial as walkable routes.

**Materials** starts from a separate copy of the current massing and saves the study locally in the browser. **Update from massing** refreshes that copy. Use the swatch palettes to assign structure and cladding to the building, core, or module programs. Open any of the six assembly cards to see its exploded axonometric below the live model. **Snapshot** downloads a PNG sheet with the current model view and all six assembly cards. Each card lists its structure and cladding combinations. **Cost & analysis** shows CAD estimates by assembly, per-module averages, and a building summary based on the chosen materials. **Estimate assumptions** sets the two benchmark rates. The estimates cover the core ring and enclosed modules. Use **Material design rationale** to keep your own notes alongside the study.

**Drawings** creates plan, elevation and axonometric linework from the current massing. Add and move horizontal or vertical clipping planes to draw sections. Set a vertical plane's angle and use **Align view** to look square to it. Choose Letter or Tabloid, portrait or landscape, and an architectural scale. **Auto fit** picks the largest listed scale that fits the view on the sheet. Export a physically sized SVG or use **Print / PDF** with actual-size printing.

Drag the sheet or use the arrow keys to position a crop at the selected scale. **Fit** centers the sheet and restores automatic scale. **Ground** lines up elevations and axonometrics at a fixed height above the lower drawing margin. The axonometric compass uses the same north as plan. Hybrid sheets overlay linework on program colors, material textures, or both. SVG exports keep vector strokes and embed the optional color layer.

**Build** makes a separate schematic assembly from a copy of the current massing. Switch between structural framing, slabs, walls, dock connections, and module chassis to inspect how the parts meet. The assembly uses the massing's geometry and openings. Member sizes and connections are conceptual.

Use **Design rationale** to open the illustrated design record. Refreshing the same browser tab reopens the active view. Export JSON to carry a saved design to another browser or machine.

## Files
- `index.html` — active standalone app, vanilla HTML/CSS/JS. WebGL with software Canvas fallback. Native Rhino 3DM uses an optional network CDN; offline Rhino Python script is available. The app itself otherwise requires no build/dependencies.
- `Design_Rationale.html` — standalone illustrated presentation page.
- `AGENTS.md` — design and implementation guardrails.
- `docs/` — authorship, rationale (searchable text companion), simulation/scoring, project chronology, roadmap and architecture map.
- `COPILOT.md` — extensive original engineering handoff, including historical changes and test notes; use the latest sections and actual source when old notes conflict.
- `archive/` — earlier standalone HTML builds for reference and rollback, not active source. Open them only if needed; browser storage key is shared, so use a separate browser profile or local JSON backup to avoid conflicts.
- `previews/` — images from V3.6 previous tests, not new renderings.
- `references/` — selected studio briefs, diagrams, reports and prior Copilot brief, copied unchanged for context. These are not app dependencies or newly reviewed/evidentiary claims; consult the actual documents for source content.
- `tests/` — optional developer regression tests, not required for use.

## Running locally
Double-click `index.html`, or from this directory `python -m http.server 8000` then open `http://localhost:8000`. Using a consistent local URL can help with browser storage; imported JSON is the portable record. Do not expose the server publicly. Optional smoke tests are documented in `tests/README.md`.

## Source of truth and limits
The active app and its tests describe current behavior. The manifest and archived versions record the original handoff. The narrative is a synthesis of the available conversation, original handoff and rationale, not a complete verbatim chat transcript. No observed social data, engineered ride safety, BIM/code validation or remediation process simulation is included. The latest known V3.6 checks were software-rendered browser tests; native Rhino and hardware GPU output still require local verification. See `docs/AUTHORSHIP.md` and `docs/SIMULATION.md`.
