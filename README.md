# Poly Nation Cross Pollination Laboratory
**Developed from the V3.6 handoff**

A student-directed architectural research instrument for the Poly Nation / Infinite Rinse studio project: a stable mixed-use ring, adaptive plug-in modules, relationships, play and multispecies occupation, with a heuristic cross-pollination performance metric.

## Design workflow

Open `index.html`, set the massing, and use the Topology Designer to set relationships between programs. Attract favors nearby rooms and modules and can create shared lobbies. Repel prioritizes separating neighbors on the same floor and allows vertical module neighbors. Clustering strength governs how closely selected programs group, including vertical alignment.

In Massing, turn on **Edit programming** and click a room, module, or available dock. **Choose location** provides the same controls as a list. The solver checks edits against the area cap, reserved docks, same-floor repulsion, and entrance access. Firehall modules fill eligible ground-floor docks first. Each upper floor can have at most as many as the floor directly below. Room edits follow matching room locations. A different variation can make a saved location unavailable.

**Materials** starts from a separate copy of the current massing and saves the study locally in the browser. Use **Update from massing** to replace the copy. Whole-building settings are inherited by the core and modules, with overrides by program and individual module. The Assembly schedule shows exploded axonometrics for the core and each module program, including material variants from individual overrides. The layer comparisons use indicative mass, relative installation cost, and qualitative strength descriptions. Use **Material design rationale** to keep your notes alongside the study.

Use **Design rationale** to open the illustrated design record. Export JSON to carry a saved design to another browser or machine.

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
