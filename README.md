# Poly Nation Cross Pollination Laboratory
**Codex handoff · V3.6 baseline · November 2026**

A student-directed architectural research instrument for the Poly Nation / Infinite Rinse studio project: a stable mixed-use ring, adaptive plug-in modules, relationships, play and multispecies occupation, with a heuristic cross-pollination performance metric.

## Continue in Codex
1. Extract this ZIP to a normal local folder. Open the `Poly_Nation_Codex` folder in Codex (rather than giving it only the HTML file).
2. Open `index.html` in a browser for the current model. `Design_Rationale.html` opens the illustrated design record separately. The in-app button works without that additional file because the rationale is embedded.
3. Start a new Codex conversation with the supplied `START_HERE.txt` prompt. `AGENTS.md` establishes ongoing project instructions.
4. Optional but recommended: initialize a local Git repository, commit this untouched baseline, then use small commits for changes. No repository or remote is configured by this handoff.
5. If you have a configuration saved in the previous browser session, export its JSON from the existing app and import it in the new one. This ZIP includes the source/defaults, not your personal browser localStorage, saved runs or current camera.

## Files
- `index.html` — exact last delivered V3.6 working source, vanilla HTML/CSS/JS. WebGL with software Canvas fallback. Native Rhino 3DM uses an optional network CDN; offline Rhino Python script is available. The app itself otherwise requires no build/dependencies.
- `Design_Rationale.html` — exact illustrated presentation page.
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
The app and embedded rationale are preserved byte-for-byte. Earlier notes describe superseded behavior; do not blindly restore them. The narrative is a synthesis of the available conversation, original handoff and rationale, not a complete verbatim chat transcript. No observed social data, engineered ride safety, BIM/code validation or remediation process simulation is included. The latest known V3.6 checks were software-rendered browser tests; native Rhino and hardware GPU output still require local verification. See `docs/AUTHORSHIP.md` and `docs/SIMULATION.md`.
