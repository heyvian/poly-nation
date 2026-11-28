"""Check the extreme-day model and its live envelope controls."""

import os
import re
import shutil
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


root = Path(__file__).resolve().parents[1]
with serve_lab(root) as url, sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,
        args=['--no-sandbox', '--disable-webgl'],
    )
    page = browser.new_page(viewport={'width': 1350, 'height': 800}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    page.locator('#openClimate').click()
    expect(page.locator('#climateTitle')).to_have_text('Core heat & daylight')
    expect(page.locator('#climateWeather')).to_contain_text('−36.2 °C to −27.2 °C')
    expect(page.locator('#climateWeatherSource')).to_have_attribute('href', re.compile('Year=2024'))
    checks = page.evaluate('''() => {
      const bare = { ...model, sitePlan: null, siteGeometry: null, dockSeal: 'winter',
        atriumEnvelope: { opaqueFraction: 0, finMode: 'none', canalMode: 'open' } };
      const canal = { openingArea: 120, glazingArea: 0, residualOpenArea: 120 };
      const makeCanal = (aperture) => ({ ...bare,
        sitePlan: { angle: 0, canalAtrium: aperture } });
      const open = runClimateStudy(makeCanal(canal));
      const shut = runClimateStudy(makeCanal({ ...canal, glazingArea: 145, residualOpenArea: 0 }));
      const hazy = runClimateStudy({ ...bare, atriumEnvelope: { ...bare.atriumEnvelope, finMode: 'shade',
        opaqueFraction: 0.6 } }, { day: 'hot' });
      const hot = runClimateStudy(bare, { day: 'hot' });
      const ground = 0, afternoon = 13;
      const heating = rows => rows.reduce((daily, hour) => daily + climateSum(hour.zones, 'heat'), 0);
      const traces = [open, shut, hazy, hot].flatMap(result => [result.free, result.controlled]);
      return {
        hourly: traces.every(trace => trace.length === 24 && trace.every(hour =>
          [hour.outside, hour.roofSolar, ...hour.zones.flatMap(Object.values)].every(Number.isFinite))),
        setpoints: [open, shut, hazy, hot].every(result => result.controlled.every(hour =>
          hour.zones.every(zone => zone.coreAir >= 20 && zone.coreAir <= 26))),
        weather: open.weather.temperatures.includes(-36.2) && hot.weather.temperatures.includes(36.5),
        sky: climateSun(222, 13).altitude > climateSun(14, 13).altitude &&
          hot.controlled[0].zones[ground].lux === 0,
        seal: heating(shut.controlled) < heating(open.controlled) &&
          shut.controlled[afternoon].zones[ground].atrium > open.controlled[afternoon].zones[ground].atrium,
        levels: open.controlled[afternoon].zones.length === model.layers.length &&
          (model.layers.length === 1 || open.controlled[afternoon].zones.at(-1).atrium >
            open.controlled[afternoon].zones[ground].atrium),
        shade: hazy.controlled[afternoon].roofSolar < hot.controlled[afternoon].roofSolar &&
          hazy.controlled[afternoon].zones[ground].lux < hot.controlled[afternoon].zones[ground].lux
      };
    }''')
    assert all(checks.values()), (checks, errors)

    page.locator('#climateDay').select_option('hot')
    expect(page.locator('#climateWeather')).to_contain_text('15.8 °C to 36.5 °C')
    page.locator('#climateFins').select_option('tracking')
    page.wait_for_function('model.atriumEnvelope.finMode === "tracking"')
    page.locator('#climateOpaque').evaluate('slider => { slider.value = 55; slider.dispatchEvent(new Event("change")); }')
    expect(page.locator('#climateOpaqueValue')).to_have_text('55%')
    assert page.evaluate('model.atriumEnvelope.opaqueFraction') == 0.55
    page.locator('#climateHour').focus()
    page.keyboard.press('Home')
    expect(page.locator('#climateTime')).to_have_text('00:30 MST')
    expect(page.locator('#climateMetrics')).to_contain_text('0 lx')
    with page.expect_download() as exported:
        page.locator('#climateCsv').click()
    assert exported.value.suggested_filename == 'poly-nation-climate-2018-08-10.csv'
    csv = exported.value.path().read_text().splitlines()
    assert len(csv) == page.evaluate('model.layers.length') * 24 + 1
    assert csv[1].startswith('2018-08-10,00:30,1,')
    page.reload()
    expect(page.locator('#climatePhase')).to_be_visible()
    expect(page.locator('#climateDay')).to_have_value('hot')
    expect(page.locator('#climateFins')).to_have_value('tracking')

    page.set_viewport_size({'width': 360, 'height': 780})
    widths = page.evaluate('''() => [document.documentElement, document.querySelector('#climatePhase')]
      .map(element => [element.scrollWidth, element.clientWidth])''')
    assert all(actual <= width for actual, width in widths), widths
    assert not errors, errors
    browser.close()

print('Climate workspace, envelope controls, extreme-day traces and mobile view passed.')
