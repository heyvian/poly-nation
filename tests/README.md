# Optional browser regression tests
Portable copies of the V3.6 development tests. They use Python Playwright, not app dependencies. Install `python -m pip install playwright` and `python -m playwright install chromium`. Run from the project directory:

```
python tests/test_poly36.py
python tests/test_poly36_features.py
```

If needed set the environment variable `CHROMIUM_PATH` to a local executable. Screenshots are written to `tests/output/`, not the supplied previews. These tests deliberately use software rendering (`--disable-webgl`) and `page.set_content`; they do not test hardware GPU or actual local-file storage or Rhino. The scripts touch internal functions and may need updates after refactoring. They test state preservation, responsive documents, runtime errors, ride queue/boarding/unloading, outdoor encounters and selected area-cap configurations. More regression coverage is desirable.
