# Optional browser regression tests
Portable copies of the V3.6 development tests. They use Python Playwright, not app dependencies. Install `python -m pip install playwright` and `python -m playwright install chromium`. Run from the project directory:

```
python tests/test_poly36.py
python tests/test_poly36_features.py
python tests/test_materials_editing.py
python tests/test_module_design.py
python tests/test_module_crane.py
python tests/test_site_and_plan.py
python tests/test_connections.py
python tests/test_shared_lobbies.py
python tests/test_atrium_render.py
```

Set `CHROMIUM_PATH` to use a particular Chromium executable. The suites serve the real static app over localhost. Most use software rendering, and the module suite also exercises WebGL. Screenshots go to `tests/output/`. The suites cover workspace and drawing exports, storage, responsive layouts, ride boarding and unloading, outdoor encounters, area caps, topology rules, clustering, Materials and direct programming edits. `test_site_and_plan.py` checks overhead projection, PDF placement, the canal cut and Drawings inclusion with controlled elevation, map fallback and service failure responses. `test_connections.py` checks all six dock support systems, exterior fitting layers, and visibility behind a thin façade at 1:2000.

`test_shared_lobbies.py` checks lobby fit for smaller programme pairs, aisle alignment on one- and two-corridor floors, stocked and wall-fitted shelves, furniture clearances, visitor routes, the lobby plan and section presets, lens stops, crop anchoring, black cut fills with open voids, and the contextual lobby drawing set with its local compass, scale, print pages and vector SVG export.

`test_atrium_render.py` checks full shared lobbies on core and bridge routes, casework-supported quarter domes, wall-scribed benches, paper pendant placement, shared program lobbies, capsule fit, two inward-facing groups of five, open bridge routes and the seating toggle in the six-level seed 609 layout, migration of saved Materials corridors, close zoom, reachable atrium stairs, bridge bearings, lighting controls and Render restoration.

`test_module_design.py` checks all three enclosure lengths, eleven roof profiles, material variety, form-first similarity, the fixed dock interface, window bounds, area takeoff and restoration of Materials and Build controls.

`test_module_crane.py` checks underside clearance, the separate lift and insertion sequences, both runway variants, drawbridge timing, paint persistence and the Drawings override.
