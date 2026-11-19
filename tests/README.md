# Optional browser regression tests
Portable copies of the V3.6 development tests. They use Python Playwright, not app dependencies. Install `python -m pip install playwright` and `python -m playwright install chromium`. Run from the project directory:

```
python tests/test_poly36.py
python tests/test_poly36_features.py
python tests/test_materials_editing.py
```

If needed set the environment variable `CHROMIUM_PATH` to a local executable. Screenshots are written to `tests/output/`, not the supplied previews. The tests run in software-rendered Chromium. The Materials and editing suite uses an HTTP server to check browser storage and assignment persistence. The original suites use `page.set_content`. The scripts touch internal functions and may need updates after refactoring. They test state preservation, responsive documents, runtime errors, ride queue/boarding/unloading, outdoor encounters selected area-cap configurations, same-floor repulsion with vertical adjacency, Firehall clustering, and Materials navigation. The Materials and editing suite also covers clicking the model, reprogramming rooms and modules, adding a module, and rejecting programming conflicts.
