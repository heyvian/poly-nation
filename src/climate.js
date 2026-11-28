'use strict';

const CLIMATE_GLAZING = {
  double: { label: 'Double low-e', u: 1.65, solar: 0.47, visible: 0.66 },
  triple: { label: 'Triple low-e', u: 1.0, solar: 0.36, visible: 0.55 }
};
const CLIMATE_HEAT_SETPOINT = 20, CLIMATE_COOL_SETPOINT = 26;
const AIR_HEAT_CAPACITY = 1206; // J/(m³·K)
const CLIMATE_GROUND_TEMPERATURE = 7;
const CLIMATE_STEPS = 6; // Ten-minute substeps under an hourly reporting clock.
const CLIMATE_STATION = 'https://climate.weather.gc.ca/climate_data/daily_data_e.html?StationID=50430&timeframe=2';
const CLIMATE_DAYS = {
  cold: { date: '2024-01-14', dayOfYear: 14, low: -36.2, high: -27.2,
    wind: 3.8, source: CLIMATE_STATION + '&Year=2024&Month=1' },
  hot: { date: '2018-08-10', dayOfYear: 222, low: 15.8, high: 36.5,
    wind: 2.6, source: CLIMATE_STATION + '&Year=2018&Month=8' }
};

function climateWeatherDay(key) {
  const day = CLIMATE_DAYS[key] ?? CLIMATE_DAYS.cold, lowHour = key === 'hot' ? 5 : 8, highHour = key === 'hot' ? 16 : 15,
    range = day.high - day.low;
  return { ...day, temperatures: Array.from({ length: 24 }, (_, hour) => {
    if (hour >= lowHour && hour <= highHour)
      return day.low + range * (1 - Math.cos(Math.PI * (hour - lowHour) / (highHour - lowHour))) / 2;
    const time = hour < lowHour ? hour + 24 : hour;
    return day.high - range * (1 - Math.cos(Math.PI * (time - highHour) / (24 + lowHour - highHour))) / 2;
  }) };
}

// NOAA's fractional-year approximation. The clock is Calgary Mountain Standard Time
// throughout (UTC−7), so there is no summer daylight-saving discontinuity in the plot.
function climateSun(dayOfYear, hour) {
  const latitude = 51.045 * Math.PI / 180, longitude = -114.072,
    year = 2 * Math.PI / 365 * (dayOfYear - 1 + (hour - 12) / 24),
    declination = 0.006918 - 0.399912 * Math.cos(year) + 0.070257 * Math.sin(year) -
      0.006758 * Math.cos(2 * year) + 0.000907 * Math.sin(2 * year) -
      0.002697 * Math.cos(3 * year) + 0.00148 * Math.sin(3 * year),
    equation = 229.18 * (0.000075 + 0.001868 * Math.cos(year) - 0.032077 * Math.sin(year) -
      0.014615 * Math.cos(2 * year) - 0.040849 * Math.sin(2 * year)),
    trueSolarHour = hour + (equation + 4 * (longitude + 105)) / 60,
    hourAngle = (trueSolarHour - 12) * Math.PI / 12,
    up = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
    east = -Math.cos(declination) * Math.sin(hourAngle),
    north = Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return { altitude: Math.asin(clamp(up, -1, 1)), azimuth: mod(Math.atan2(east, north), TAU) };
}

function climateClearSky(altitude) {
  if (altitude <= 0) return { direct: 0, diffuse: 0, horizontal: 0 };
  const sine = Math.sin(altitude), zenith = 90 - altitude * 180 / Math.PI,
    mass = 1 / (sine + 0.50572 * Math.pow(96.07995 - zenith, -1.6364)),
    direct = 1325 * Math.pow(0.73, Math.pow(mass, 0.678)),
    diffuse = 115 * Math.pow(sine, 0.55);
  return { direct, diffuse, horizontal: direct * sine + diffuse };
}

function climateEnvelope(model) {
  const floors = model.layers.length, pitch = modelFloorPitch(model), r = model.r, R = model.R,
    site = model.sitePlan ?? null, canal = site?.canalAtrium,
    options = atriumEnvelopeOptions(model), sealMode = dockSealMode(model),
    ring = Math.PI * (R ** 2 - r ** 2), court = Math.PI * r ** 2,
    roof = model.feature?.ride?.roofPitch,
    crown = roof?.ridgeGlazingY ?? roof?.canopyRidgeY ?? roof?.eaveY ?? 0,
    eave = roof?.canopyEaveY ?? roof?.eaveY ?? crown,
    inner = Math.min(r - 0.1, model.feature?.ride?.platformRadius ?? 0),
    slope = Math.atan2(Math.max(0, crown - eave), r - inner),
    roofArea = Math.PI * (r ** 2 - inner ** 2) / Math.cos(slope),
    bearing = site?.angle ?? model.siteGeometry?.angle ?? 0,
    geometry = Array.from({ length: floors }, (_, f) => {
      const storey = buildStorey(model, f),
        availableHeight = Math.max(0, dockBayHead(storey) - dockWalkLevel(storey) - DOCK_ENTRY.shutterPocket),
        lobbySpans = lobbyHoles(model.lobby, f), voidSpan = lobbySpans.reduce((sum, [, half]) => sum + half * 2, 0),
        lobbyWall = Math.min(TAU * R * pitch, voidSpan * R * pitch),
        area = Math.max(1, ring - (f === 0 ? model.siteGeometry?.ringCutArea ?? 0 : (model.lobby.voidArea ?? 0) * Number(f === 1))),
        facet = Math.PI / Math.max(3, model.slotN),
        polygonLength = TAU * R * Math.sqrt(Math.tan(facet) / facet),
        perimeter = model.coreEnvelope === 'faceted' ? polygonLength : TAU * R,
        coreWall = Math.max(1, perimeter * pitch - lobbyWall),
        roomEdge = model.rooms.filter(q => q.f === f && q.r <= r + 0.001).reduce((sum, q) => sum + q.end - q.start, 0),
        edge = clamp(1 - (roomEdge - voidSpan * 0.4) / TAU, 0.08, 1),
        bays = model.slots.filter(slot => slot.f === f && !slot.blocked);
      let shutter = 0, glazed = lobbyWall * 0.55, module = 0, open = 0;
      const glazedFaces = lobbySpans.map(([angle, half]) => ({ angle, area: R * half * 2 * pitch * 0.55 }));
      for (const slot of bays) {
        const { width } = dockBayOpening(model, slot),
          shutterArea = width * availableHeight,
          closure = DOCK_ENTRY.coreWidth * DOCK_ENTRY.coreHeight,
          occupied = slot.p !== EMPTY || slot.use === 'retail';
        if (sealMode === 'secured' || !dockInUse(slot)) shutter += shutterArea;
        else if (occupied) module += shutterArea;
        else {
          const glassArea = Math.max(0, width - DOCK_ENTRY.coreWidth) * DOCK_ENTRY.coreHeight +
            (sealMode === 'winter' ? closure : 0);
          glazed += glassArea;
          glazedFaces.push({ angle: slot.angle, area: glassArea });
          if (sealMode === 'summer') open += closure;
        }
      }
      return { area, volume: area * pitch, edge, opaque: Math.max(0, coreWall + lobbyWall - (shutter + glazed + module + open)),
        shutter, glazed, module, open, glazedFaces };
    });
  return { floors, pitch, r, R, court, roofArea, deckArea: Math.PI * inner ** 2, slope, bearing, geometry, sealMode, ...options,
    openingArea: canal?.openingArea ?? 0, glazingArea: canal?.glazingArea ?? 0,
    residualOpenArea: canal?.residualOpenArea ?? canal?.openingArea ?? 0,
    canalOrientation: canal?.normalBearing ?? null, placed: Boolean(site) };
}

function climateWeatherAt(weather, hour) {
  const index = Math.floor(mod(hour, 24)), next = (index + 1) % 24, fraction = hour - Math.floor(hour),
    temperature = weather.temperatures[index] * (1 - fraction) + weather.temperatures[next] * fraction,
    wind = weather.winds ? (weather.winds[index] * (1 - fraction) + weather.winds[next] * fraction) : weather.wind ?? 3.2;
  return { temperature, wind, ...climateSun(weather.dayOfYear, hour) };
}

function climateIncident(weather, azimuth, slope) {
  const sky = climateClearSky(weather.altitude),
    beam = sky.direct * Math.max(0, Math.sin(weather.altitude) * Math.cos(slope) +
      Math.cos(weather.altitude) * Math.sin(slope) * Math.cos(weather.azimuth - azimuth)),
    diffuse = sky.diffuse * (1 + Math.cos(slope)) / 2 + sky.horizontal * 0.18 * (1 - Math.cos(slope)) / 2;
  return { beam, diffuse };
}

function climateRoofSun(envelope, weather, glazing) {
  const { slope, bearing, opaqueFraction, finMode, roofArea } = envelope;
  const sample = 24, { spacing, chord } = ATRIUM_FIN;
  const sky = climateClearSky(weather.altitude);
  let beam = 0, diffuse = 0, unshaded = 0;
  for (let i = 0; i < sample; i++) {
    const azimuth = -Math.PI / 2 + bearing + (i + 0.5) * TAU / sample,
      incident = climateIncident(weather, azimuth, slope),
      radialSun = Math.cos(weather.azimuth - azimuth), radial = radialSun * Math.cos(weather.altitude),
      tilt = atriumFinTilt(finMode, weather.altitude, radialSun);
    let clear = 1;
    if (tilt != null && weather.altitude > 0) {
      // The slats run across each roof strip. Project the solar ray into the
      // strip's radial section and compare the fin and sun directions there.
      const profile = Math.atan2(Math.sin(weather.altitude), radial),
        blocked = chord / spacing * Math.abs(Math.sin(profile - tilt)) / Math.max(0.16, Math.sin(profile));
      clear = clamp(1 - blocked, 0.08, 1);
    }
    beam += incident.beam * clear;
    diffuse += incident.diffuse * (tilt == null ? 1 : 1 - chord / spacing * (0.83 - 0.40 * Math.abs(Math.sin(tilt))));
    unshaded += incident.beam + incident.diffuse;
  }
  beam /= sample;
  diffuse /= sample;
  const transmittance = (1 - opaqueFraction) * 0.9, // Mullions occupy 10% of the opening.
    intercepted = Math.max(0, unshaded / sample - beam - diffuse);
  // The fins sit below the glass. Allow most intercepted solar energy to
  // return to the atrium as heat, after reflection back through the glazing.
  return { heat: (beam + diffuse + 0.6 * intercepted) * roofArea * transmittance * glazing.solar,
    daylight: (beam * 96 + diffuse * 130) * transmittance * glazing.visible,
    exterior: sky.horizontal };
}

function climateSensibleVent(area, wind, height, outside, inside) {
  // Area-based wind and stack exchange for an exposed opening. A conservative
  // effective pressure factor represents the lack of a resolved wind field.
  return AIR_HEAT_CAPACITY * area * 0.34 * Math.sqrt((0.30 * wind) ** 2 +
    0.12 * 2 * 9.81 * height * Math.abs(outside - inside) / Math.max(245, outside + 273.15));
}

function runClimateStudy(model, { day = 'cold', glass = 'triple' } = {}) {
  const envelope = climateEnvelope(model), weather = climateWeatherDay(day), glazing = CLIMATE_GLAZING[glass] ?? CLIMATE_GLAZING.triple,
    { floors, pitch, r, court, geometry, roofArea, deckArea, opaqueFraction, bearing, glazingArea, residualOpenArea, openingArea } = envelope,
    count = 2 * floors, dt = 3600 / CLIMATE_STEPS,
    roofU = glazing.u * (1 - opaqueFraction) + 0.22 * opaqueFraction,
    canalGlass = CLIMATE_GLAZING.double,
    top = count - 1, roofHeight = floors * pitch,
    capacities = [...geometry.map(q => q.area * 112000 + q.volume * AIR_HEAT_CAPACITY),
      ...geometry.map((_, f) => court * (f ? 26000 : 69000) + court * pitch * AIR_HEAT_CAPACITY)];
  const solar = Array.from({ length: 24 * CLIMATE_STEPS }, (_, step) => {
    const met = climateWeatherAt(weather, (step + 0.5) / CLIMATE_STEPS), roof = climateRoofSun(envelope, met, glazing),
      wall = geometry.map(q => q.glazedFaces.reduce((sum, face) => {
        const { beam, diffuse } = climateIncident(met, -Math.PI / 2 + bearing + face.angle, Math.PI / 2);
        return sum + face.area * (beam + diffuse) * 0.44;
      }, 0));
    return { ...met, roof, wall };
  });
  function dayTrace(conditioned) {
    let temperatures = Array(count).fill(day === 'hot' ? 23 : 19), hours = [];
    for (let round = 0; round <= 14; round++) {
      const initial = [...temperatures];
      hours = [];
      for (const [step, met] of solar.entries()) {
        const at = (step + 0.5) / CLIMATE_STEPS, occupied = at >= 8 && at < 20,
          outside = met.temperature, moduleAir = day === 'hot' ? 26 : 18,
          capacity = capacities.map(cap => cap / dt), diagonal = [...capacity],
          rhs = capacity.map((cap, i) => cap * temperatures[i]), adjacent = Array.from({ length: count }, () => []);
        const connect = (i, j, ua) => {
          diagonal[i] += ua;
          diagonal[j] += ua;
          adjacent[i].push([j, ua]);
          adjacent[j].push([i, ua]);
        };
        const ambient = (i, ua, temperature) => {
          diagonal[i] += ua;
          rhs[i] += ua * temperature;
        };
        for (const [f, zone] of geometry.entries()) {
          const atrium = floors + f, air = temperatures[f], atriumAir = temperatures[atrium],
            airChange = 0.42 * AIR_HEAT_CAPACITY * zone.volume / 3600,
            shutters = zone.shutter * 0.58, walls = zone.opaque * 0.30;
          ambient(f, walls, outside + met.roof.exterior * 0.012);
          ambient(f, shutters + zone.glazed * 1.7 + airChange +
            climateSensibleVent(zone.open, met.wind, pitch, outside, air), outside);
          ambient(f, zone.module * 0.85, moduleAir);
          rhs[f] += zone.area * (occupied ? 8 : 2) + met.wall[f];
          ambient(atrium, AIR_HEAT_CAPACITY * court * pitch * 0.24 / 3600, outside);
          const openPerimeter = zone.edge * r * TAU;
          connect(f, atrium, AIR_HEAT_CAPACITY * openPerimeter * pitch * 0.012 *
            (1 + 0.2 * Math.sqrt(Math.abs(air - atriumAir))) + (1 - zone.edge) * r * TAU * pitch * 0.6);
          if (f) {
            connect(f - 1, f, zone.area * 0.32);
            connect(atrium - 1, atrium, AIR_HEAT_CAPACITY * court * pitch * 1.7 / 3600);
          }
          if (f === 0) {
            ambient(f, zone.area * 0.30, CLIMATE_GROUND_TEMPERATURE);
            ambient(atrium, Math.max(0, court - Math.min(court * 0.9, openingArea)) * 0.32, CLIMATE_GROUND_TEMPERATURE);
            ambient(atrium, glazingArea * canalGlass.u +
              climateSensibleVent(residualOpenArea, met.wind, roofHeight, outside, atriumAir), outside);
            rhs[atrium] += met.roof.heat * 0.38;
            if (glazingArea > 0 && envelope.canalOrientation != null) {
              const sun = climateIncident(met, envelope.canalOrientation, Math.PI / 3);
              rhs[atrium] += (sun.beam + sun.diffuse) * glazingArea * canalGlass.solar;
            }
          }
          if (f === floors - 1) {
            ambient(f, zone.area * 0.22, outside + met.roof.exterior * 0.036);
            ambient(atrium, roofU * roofArea + deckArea * 0.30, outside);
            rhs[atrium] += met.roof.heat * 0.40;
          }
          rhs[atrium] += met.roof.heat * 0.22 / floors + (occupied ? 1.0 : 0.3) * court / floors;
        }
        const next = [...temperatures];
        const equation = i => rhs[i] + adjacent[i].reduce((sum, [j, ua]) => sum + next[j] * ua, 0);
        for (let sweep = 0; sweep < 30; sweep++) {
          let error = 0;
          for (let i = 0; i < count; i++) {
            const steady = equation(i) / diagonal[i],
              value = conditioned && i < floors ? clamp(steady, CLIMATE_HEAT_SETPOINT, CLIMATE_COOL_SETPOINT) : steady;
            error = Math.max(error, Math.abs(next[i] - value));
            next[i] = value;
          }
          if (error < 1e-5) break;
        }
        temperatures = next;
        const loads = Array.from({ length: floors }, (_, i) => conditioned ? (diagonal[i] * next[i] - equation(i)) / 1000 : 0),
          zoneHours = geometry.map((zone, f) => {
            const atriumAir = next[floors + f], coreAir = next[f],
              skyFactor = Math.max(0.15, r ** 2 / (r ** 2 + ((floors - f - 0.5) * pitch) ** 2)),
              roofRadiant = roofU * 0.13 * (outside - atriumAir),
              glazingRadiant = 1.7 * 0.13 * (outside - coreAir),
              atriumRadiant = atriumAir + roofRadiant * skyFactor + (coreAir - atriumAir) * 0.17,
              radiant = coreAir + glazingRadiant * Math.min(0.45, zone.glazed / zone.area) + (atriumAir - coreAir) * zone.edge * 0.27;
            return { core: (coreAir + radiant) / 2, atrium: (atriumAir + atriumRadiant) / 2,
              atriumAir, coreAir, lux: met.roof.daylight * skyFactor * 0.68,
              heat: Math.max(0, loads[f]), cool: Math.max(0, -loads[f]) };
          });
        hours.push(zoneHours);
      }
      if (round >= 3 && Math.max(...temperatures.map((value, i) => Math.abs(value - initial[i]))) < 0.035) break;
    }
    return Array.from({ length: 24 }, (_, h) => {
      const steps = hours.slice(h * CLIMATE_STEPS, (h + 1) * CLIMATE_STEPS),
        sample = steps[CLIMATE_STEPS / 2 - 1], midpoint = climateWeatherAt(weather, h + 0.5),
        roofSolar = climateRoofSun(envelope, midpoint, glazing).heat / 1000,
        zones = sample.map((zone, f) => ({ ...zone,
          lux: (zone.lux + steps[CLIMATE_STEPS / 2][f].lux) / 2,
          heat: steps.reduce((sum, hourStep) => sum + hourStep[f].heat, 0) / CLIMATE_STEPS,
          cool: steps.reduce((sum, hourStep) => sum + hourStep[f].cool, 0) / CLIMATE_STEPS }));
      return { outside: midpoint.temperature, roofSolar, zones };
    });
  }
  return { envelope, weather, roofU, free: dayTrace(false), controlled: dayTrace(true) };
}

const CLIMATE_STUDY_KEY = 'poly-nation-climate-v1';
const climateSelection = (() => {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(CLIMATE_STUDY_KEY));
  } catch {
    // A new study still works with storage disabled.
  }
  return { day: saved?.day === 'hot' ? 'hot' : 'cold',
    glass: saved?.glass === 'double' ? 'double' : 'triple', floor: Math.max(0, Math.floor(+saved?.floor || 0)),
    hour: Number.isInteger(saved?.hour) ? clamp(saved.hour, 0, 23) : 13 };
})();

function climateStudySun() {
  return climateSun(climateWeatherDay(climateSelection.day).dayOfYear, climateSelection.hour + 0.5);
}

function climateFinStamp(model) {
  return ['shade', 'tracking'].includes(model.atriumEnvelope?.finMode) ? climateSelection.day + ':' + climateSelection.hour : null;
}

const climateTemp = value => value.toFixed(1).replace('-', '−') + ' °C';
const climateQuantity = value => Math.round(value).toLocaleString('en-CA');
const climateClock = hour => String(hour).padStart(2, '0') + ':30';
const climateLevel = f => f ? 'Level ' + (f + 1) : 'Ground';
const climateSum = (zones, field) => zones.reduce((sum, zone) => sum + zone[field], 0);
const CLIMATE_SERIES = [
  { key: 'outdoor', name: 'Outdoor air', color: '#475963', dash: '5 5' },
  { key: 'core', name: 'Core with HVAC', color: '#406a50' },
  { key: 'free', name: 'Core without HVAC', color: '#b65437', dash: '6 4' },
  { key: 'atrium', name: 'Atrium edge with core HVAC', color: '#3c72a1' }
];

function climateChart(result, floor, hour) {
  const series = {
    outdoor: result.controlled.map(row => row.outside),
    core: result.controlled.map(row => row.zones[floor].core),
    free: result.free.map(row => row.zones[floor].core),
    atrium: result.controlled.map(row => row.zones[floor].atrium)
  };
  const values = [20, 26, ...Object.values(series).flat()],
    min = Math.min(...values), max = Math.max(...values), tick = max - min > 48 ? 15 : max - min > 28 ? 10 : 5,
    low = Math.floor((min - 1) / tick) * tick, high = Math.ceil((max + 1) / tick) * tick,
    box = { left: 55, right: 792, top: 18, bottom: 262 },
    x = t => box.left + t / 24 * (box.right - box.left),
    y = value => box.bottom - (value - low) / (high - low) * (box.bottom - box.top),
    grid = [], markers = [], paths = [];
  for (let value = low; value <= high; value += tick)
    grid.push(`<path d="M${box.left} ${y(value)}H${box.right}" class="climate-grid"/><text x="${box.left - 10}" y="${y(value) + 4}" text-anchor="end">${value}</text>`);
  for (let t = 0; t <= 24; t += 4)
    grid.push(`<text x="${x(t)}" y="${box.bottom + 25}" text-anchor="middle">${String(t).padStart(2, '0')}:00</text>`);
  for (const { key, color, dash } of CLIMATE_SERIES) {
    const points = series[key].map((value, t) => `${x(t + 0.5).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
    paths.push(`<polyline points="${points}" stroke="${color}" ${dash ? `stroke-dasharray="${dash}"` : ''} fill="none" stroke-width="2.5" stroke-linejoin="round"/>`);
    markers.push(`<circle cx="${x(hour + 0.5)}" cy="${y(series[key][hour])}" r="4" fill="${color}" stroke="#fffefa" stroke-width="1.4"/>`);
  }
  return `<title>${climateLevel(floor)} temperatures by local hour in MST</title>
    <rect x="${box.left}" width="${box.right - box.left}" y="${y(26)}" height="${y(20) - y(26)}" fill="#e6ede1"/>
    ${grid.join('')}<text x="8" y="19">°C</text>
    <path d="M${x(hour + 0.5)} ${box.top}V${box.bottom}" class="climate-cursor"/>
    ${paths.join('')}${markers.join('')}`;
}

const climateWorkspace = (() => {
  const phase = $('climatePhase'), dayControl = $('climateDay'), glassControl = $('climateGlass'),
    floorControl = $('climateFloor'), hourControl = $('climateHour'), options = [
      ['climateOpaque', 'atriumOpaquePct'],
      ['climateFins', 'atriumFinMode'],
      ['climateDocks', 'dockSeal'],
      ['climateCanal', 'canalAtriumSeal']
    ];
  let result;

  function saveSelection() {
    try {
      localStorage.setItem(CLIMATE_STUDY_KEY, JSON.stringify(climateSelection));
    } catch {
      // Controls are available when storage is disabled.
    }
  }

  function showHour() {
    if (!result) return;
    const { floor, hour } = climateSelection, row = result.controlled[hour], zone = row.zones[floor],
      sun = climateStudySun(), altitude = sun.altitude * 180 / Math.PI,
      heat = result.controlled.map(entry => climateSum(entry.zones, 'heat')),
      cool = result.controlled.map(entry => climateSum(entry.zones, 'cool'));
    $('climateTime').textContent = climateClock(hour) + ' MST';
    hourControl.setAttribute('aria-valuetext', climateClock(hour) + ' MST');
    $('climateMetrics').innerHTML = [
      ['Outdoor air', climateTemp(row.outside), altitude > 0 ? 'Sun ' + altitude.toFixed(0) + '° above horizon' : 'Sun below horizon'],
      ['Core operative', climateTemp(zone.core), 'With ideal HVAC'],
      ['Atrium edge operative', climateTemp(zone.atrium), 'With adjacent core HVAC'],
      ['Atrium daylight', climateQuantity(zone.lux) + ' lx', climateQuantity(row.roofSolar) + ' kW solar through roof']
    ].map(([label, value, note]) => `<div><dt>${label}</dt><dd>${value}</dd><small>${note}</small></div>`).join('');
    $('climateChart').innerHTML = climateChart(result, floor, hour);
    $('climateLoads').innerHTML = [
      ['Core heating', heat], ['Core cooling', cool]
    ].map(([label, data]) => `<div><strong>${label}</strong><span>${climateQuantity(Math.max(...data))} kW peak · ${climateQuantity(data.reduce((sum, value) => sum + value, 0))} kWh over 24 h</span></div>`).join('');
    $('climateFloorReadings').innerHTML = row.zones.map((value, f) => `<tr ${f === floor ? 'class="climate-selected"' : ''}>
      <th scope="row">${climateLevel(f)}</th><td>${climateTemp(value.coreAir)}</td><td>${climateTemp(value.core)}</td>
      <td>${climateTemp(value.atrium)}</td><td>${climateQuantity(value.lux)} lx</td></tr>`).join('');
  }

  function open(modelToStudy) {
    const placed = modelToStudy.sitePlan ? modelToStudy : siteWorkspace.designModel(modelToStudy);
    result = runClimateStudy(placed, climateSelection);
    const { envelope, weather, roofU } = result;
    climateSelection.floor = clamp(climateSelection.floor, 0, envelope.floors - 1);
    dayControl.value = climateSelection.day;
    glassControl.value = climateSelection.glass;
    floorControl.innerHTML = Array.from({ length: envelope.floors }, (_, f) => `<option value="${f}">${climateLevel(f)}</option>`).join('');
    floorControl.value = climateSelection.floor;
    hourControl.value = climateSelection.hour;
    for (const [id, key] of options) $(id).value = state[key];
    $('climateOpaqueValue').textContent = Math.round(envelope.opaqueFraction * 100) + '%';
    $('climateWeather').textContent = climateTemp(weather.low) + ' to ' + climateTemp(weather.high) + ' observed · clear-sky study';
    $('climateWeatherSource').href = weather.source;
    const canal = placed.sitePlan?.canalAtrium;
    $('climateCanalStatus').textContent = envelope.openingArea > 0 ?
      climateQuantity(envelope.residualOpenArea) + ' m² open air · ' + climateQuantity(envelope.glazingArea) + ' m² glazed' +
        (canal?.reason ? '. ' + canal.reason : '') :
      envelope.placed ? 'No canal opening into the atrium at this placement.' :
        'Pick a site with a canal crossing to compare these settings.';
    $('climateLegend').innerHTML = CLIMATE_SERIES.map(({ name, color, dash }) =>
      `<span><i style="--series-color:${color};--series-line:${dash ? 'dashed' : 'solid'}"></i>${name}</span>`).join('') +
      '<span><i class="climate-band"></i>20–26 °C core air setpoints</span>';
    $('climateRoofU').textContent = 'Atrium canopy U-value ' + roofU.toFixed(2) + ' W/(m²·K)';
    showHour();
  }

  for (const [id, key] of options) {
    $(id).addEventListener('change', ({ target }) => {
      const value = target.value;
      appWork.run('Updating the building and climate study…', () => {
        state[key] = key === 'atriumOpaquePct' ? Number(value) : value;
        update();
        if (!phase.hidden) open(model);
      });
    });
  }
  $('climateOpaque').addEventListener('input', event => {
    $('climateOpaqueValue').textContent = event.target.value + '%';
  });
  dayControl.addEventListener('change', () => {
    climateSelection.day = dayControl.value;
    saveSelection();
    if (climateFinStamp(model)) refreshView();
    open(model);
  });
  glassControl.addEventListener('change', () => {
    climateSelection.glass = glassControl.value;
    saveSelection();
    open(model);
  });
  floorControl.addEventListener('change', () => {
    climateSelection.floor = Number(floorControl.value);
    saveSelection();
    showHour();
  });
  hourControl.addEventListener('input', () => {
    climateSelection.hour = Number(hourControl.value);
    showHour();
  });
  hourControl.addEventListener('change', () => {
    saveSelection();
    if (climateFinStamp(model)) refreshView();
  });
  $('climateCsv').addEventListener('click', () => {
    if (!result) return;
    const rows = ['date,time_mst,level,outdoor_air_c,core_air_hvac_c,core_operative_hvac_c,core_operative_free_c,atrium_edge_operative_c,atrium_edge_lux,core_heating_kw,core_cooling_kw,roof_solar_kw'];
    const date = result.weather.date;
    for (const [h, row] of result.controlled.entries())
      for (const [f, entry] of row.zones.entries())
        rows.push([date, climateClock(h), f + 1, ...[row.outside, entry.coreAir, entry.core, result.free[h].zones[f].core,
          entry.atrium, entry.lux, entry.heat, entry.cool, row.roofSolar].map(value => value.toFixed(3))].join(','));
    downloadBlob(rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8', 'poly-nation-climate-' + date + '.csv');
  });
  document.addEventListener('west-village-change', () => {
    if (!phase.hidden) open(model);
  });
  return { open };
})();
