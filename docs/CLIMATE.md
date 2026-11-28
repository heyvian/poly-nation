# Core heat and daylight study

Open **Heat & daylight** after placing the project on Site or from the unattached Massing model. Choose a Calgary extreme day, a roof assembly, and a floor. Scrub the hour to compare estimated temperatures and daylight. Roof panel coverage, fin position, dock door state and canal enclosure are shared with Massing. The study day and hour also set the position of tracking fins in the model. The CSV reports both temperature scenarios and the ideal thermal loads at each hour for every floor.

## Calgary test days

The dates are the coldest daily minimum and hottest daily maximum in a 3,377-row mirror of Environment and Climate Change Canada’s Calgary International Airport daily series (December 2016 through February 2026). The hourly outdoor profiles use smooth curves through those daily bounds, with assumed morning lows and afternoon highs. Wind is assumed at 3.8 m/s for the cold day and 2.6 m/s for the hot day. The time axis stays on Mountain Standard Time (UTC−7) in both seasons. [Station data mirror](https://github.com/RyMcQueen/Calgary-Traffic-Incident-Prediction/blob/HEAD/Data/Climate%2C%20aggregated%202016-2026%281%29.csv)

| Scenario | Date | Observed low | Observed high |
| --- | --- | --- | --- |
| Coldest daily low | January 14, 2024 | −36.2 °C | −27.2 °C |
| Hottest daily high | August 10, 2018 | 15.8 °C | 36.5 °C |

[ECCC January 2024 station records](https://climate.weather.gc.ca/climate_data/daily_data_e.html?StationID=50430&timeframe=2&Year=2024&Month=1) · [ECCC August 2018 station records](https://climate.weather.gc.ca/climate_data/daily_data_e.html?StationID=50430&timeframe=2&Year=2018&Month=8)

## What changes when the design changes

Each floor has one occupied core air zone and one atrium air zone. The model takes the annular floor area, adjacent rooms, outer wall geometry, floor pitch, garden and patio doors, shutters, signed site orientation and canal aperture from the project. It estimates conduction through envelope areas, exchange across the edge of each occupied floor, and vertical mixing in the atrium. The door states change the ratio of open area, glazed doors, insulated shutters and buffered module connections. The canal enclosure uses the remaining opening and glazing area from the fitted geometry at the current placement.

The model advances the sensible heat balance for each zone in ten-minute steps. It repeats the design day to reduce dependence on its initial temperatures. This process compares the occupied core with and without ideal heating and cooling. The ideal system operates all day at a 20 °C heating and 26 °C cooling air setpoint. The atrium has no simulated equipment in either case. The reported operative temperatures average zone air and an approximate radiant temperature based on the neighboring air and enclosure surfaces. Hourly snapshots represent the half hour and loads average the full hour.

Solar position uses NOAA’s fractional-year method at Calgary’s latitude and longitude. Direct and diffuse irradiance use a simple clear-sky approximation. Roof sectors project the sun onto the local roof slope and fin orientation. Open holds a steep fixed blade angle, shade turns the blades across the direct beam, and tracking aligns the blades with the sun’s projection into the local radial plane. The blades sit below the glazing, so the model assumes 60% of the intercepted radiation still enters the atrium as heat. The area-weighted roof U-value uses the modeled insulated area and the chosen glazing. Estimated horizontal illuminance uses approximate luminous efficacy, glazing transmittance and a floor-dependent sky view factor. [NOAA solar calculations](https://gml.noaa.gov/grad/solcalc/calcdetails.html)

## Assumed assemblies and loads

| Input | Study value |
| --- | --- |
| Double low-e roof | U 1.65 W/(m²·K), solar heat gain coefficient 0.47, visible transmittance 0.66 |
| Triple low-e roof | U 1.0 W/(m²·K), solar heat gain coefficient 0.36, visible transmittance 0.55 |
| Canal glazing | Double low-e, as above |
| Insulated cassette / fixed core wall / lowered bay shutter | U 0.22 / 0.30 / 0.58 W/(m²·K) |
| Central boarding deck | U 0.30 W/(m²·K) |
| Glazed core doors and lobby frontage | U 1.7 W/(m²·K) |
| Core / atrium background air exchange | 0.42 / 0.24 air changes per hour, plus modeled openings |
| Occupied core sensible internal gain, 08:00–20:00 | 8 W/m², with 2 W/m² outside that period |
| Ground temperature | 7 °C |

This is a concept comparison for envelope choices. A detailed analysis would need measured or simulated weather, air pressure and draft results, thermal bridge and daylight reflection geometry, HVAC operation and latent loads. Air exchange uses a simplified wind and stack approximation. Daylight is an indicator at the atrium edge and does not resolve individual workspaces, glare or localized reflections. Ideal heating and cooling are thermal energy delivered to the core, separate from any equipment electricity use.
