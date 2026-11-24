# Optional browser regression tests
Portable copies of the V3.6 development tests. They use Python Playwright, not app dependencies. Install `python -m pip install playwright` and `python -m playwright install chromium`. Run from the project directory:

```
python tests/test_poly36.py
python tests/test_poly36_features.py
python tests/test_materials_editing.py
python tests/test_site_and_plan.py
python tests/test_connections.py
python tests/test_shared_lobbies.py
```

Set `CHROMIUM_PATH` to use a particular Chromium executable. The suites serve the real static app over localhost and use software rendering. Screenshots go to `tests/output/`. The suites cover workspace and drawing exports, storage, responsive layouts, ride boarding and unloading, outdoor encounters, area caps, topology rules, clustering, Materials and direct programming edits. `test_site_and_plan.py` checks overhead projection, PDF placement, the canal cut and Drawings inclusion with controlled elevation, map fallback and service failure responses. `test_connections.py` checks all six dock support systems, exterior fitting layers, and visibility behind a thin façade at 1:2000.

`test_shared_lobbies.py` checks furniture clearances, visitor routes through the lobby, the centred section preset, lens stops, crop anchoring at new scales, drawing placement, and linework fade in SVG export.
