"use strict";
/**
 * 15-persistence.js — saving and loading.
 * Save JSON downloads a portable file; settings are also kept automatically in localStorage.
 */
// Save JSON: settings plus a summary of the computed result, downloaded as a file.
$("export").onclick = () => {
  if (pending) update();
  if (!model) return;
  const m = model,
    data = {
      schemaVersion: 17,
      crossPollination: {
        live: occupancy
          ? {
              clock: occupancy.clock,
              rate: crossRate(occupancy),
              ...Object.fromEntries(Object.entries(occupancy.score).filter(([k]) => k !== "pairs")),
            }
          : null,
        comparisons: cpHistory,
      },
      units: "meters, square meters",
      state,
      geometry: {
        outerFootprint: Math.PI * m.R * m.R,
        outerWallThickness: facadeThickness(m),
        ringWidth: m.width,
        outerRadius: m.R,
        innerRadius: m.r,
        floorHeight: 4.2,
        module: MODULE,
        ringAreaPerFloor: m.ringPer,
        netRingArea: m.ringArea,
        programRingArea: m.programRing,
        courtyardArea: m.court,
      },
      features: {
        swingRide: m.feature?.ride || null,
        waterSlide: m.feature?.slide || null,
        climbingWall: m.feature.climbing
          ? { ...m.feature.climbing, blocked: [...m.feature.climbing.blocked] }
          : null,
        blockedSlots: [...m.blocked],
        slideBlockedSlots: [...m.feature.blocked],
      },
      programs: P.map((p, i) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        goal: p.goal,
        adjustedGoal: m.goals[i] ?? 0,
        coreArea: m.core[i],
        moduleCount: m.counts[i],
        actualArea: m.core[i] + m.counts[i] * 81,
      })),
      circulation: {
        width: m.circulation.width,
        axis: m.circulation.axis,
        bridgeAngle: m.circulation.bridgeAngle,
        totalArea: m.circulation.total,
        corridorArea: m.circulation.corridorArea,
        elevatorArea: m.circulation.elevatorArea,
        sharedLobbyArea: m.circulation.hubArea,
        roomPacking: m.circulation.roomPacking,
        regions: m.circulation.regions,
        hubs: m.circulation.hubs,
        doors: m.circulation.doors,
      },
      coreRooms: m.rooms.map((s) => ({ ...s, program: P[s.id].id })),
      vacancies: VACANCY.map((v, i) => ({
        ...v,
        percentage: state.vacancy[i],
        actualPercentage: m.max > m.count ? (100 * m.vacancyCounts[i]) / (m.max - m.count) : 0,
        slots: m.vacancyCounts[i],
      })),
      areaCap: state.areaCap,
      remainingArea: Math.max(0, state.areaCap - m.total),
      primaryTarget: state.areaCap - m.retail - m.roofPlan.retailArea,
      programTarget: state.areaCap - m.retail - m.roofPlan.area - m.lobby.area - m.circulation.total,
      camera,
      lobby: { ...m.lobby, blocked: [...m.lobby.blocked] },
      primaryArea: m.primary,
      retailArea: m.retail,
      outdoorPublicArea: m.outdoor + (m.plaza?.area || 0) + m.roofPlan.publicArea,
      roofPlan: m.roofPlan,
      roofRetailArea: m.roofPlan.retailArea,
      roofServiceArea: m.roofPlan.serviceArea,
      outdoorBalconiesAndGardens: m.outdoor,
      entrancePlaza: m.plaza,
      slots: m.slots.map((s) => ({
        ...s,
        program: s.p < 0 ? null : P[s.p].id,
        center: [
          (m.R + 0.65 + 9) * Math.cos(s.angle),
          s.f * 4.2 + 0.43,
          (m.R + 0.65 + 9) * Math.sin(s.angle),
        ],
      })),
      totalArea: m.total,
    };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "poly-nation-massing-" + state.seed + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// localStorage key for the automatic save.
// Local save + portable state import. File URLs may have browser-specific storage behavior.
const STORAGE_KEY = "poly-nation-massing-lab-v2.5";
let saveTimer;
// Writes state and camera to localStorage.
function saveNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, camera }));
    $("saveStatus").textContent = "Saved locally";
  } catch (e) {
    $("saveStatus").textContent = "Local save unavailable — use JSON";
  }
}
// Debounced save.
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}
// Validates and applies loaded data to state: unknown keys are ignored, numbers clamped to slider ranges.
function applySaved(data) {
  if (!data || typeof data !== "object" || !data.state || typeof data.state !== "object")
    throw Error("Choose a Poly Nation JSON export.");
  const d = defaults(),
    s = data.state;
  const ranges = {
    floors: [1, 10],
    footprint: [100, 22000],
    ringWidth: [0.5, 35],
    modules: [0, 300],
    affinity: [0, 100],
    seed: [0, 4294967295],
    inspect: [0, 10],
    mix: [0, 100],
    slideLength: [0, 100],
    climbWidth: [0, 24],
    lobby: [0, 1000],
    corridorWidth: [1.5, 5],
    areaCap: [5000, 50000],
    minRoomArea: [40, 200],
    simSpeed: [1, 12],
    visitorCount: [8, 70],
  };
  for (const [k, [a, b]] of Object.entries(ranges))
    if (typeof s[k] === "number" && Number.isFinite(s[k])) d[k] = clamp(s[k], a, b);
  for (const k of ["floors", "modules", "seed", "inspect", "visitorCount"]) d[k] = Math.round(d[k]);
  for (const k of [
    "autoCore",
    "roof",
    "grid",
    "supports",
    "showModules",
    "showPeople",
    "showAnimals",
    "xray",
    "showRooms",
    "showRoofDeck",
    "showFacade",
    "animateSwing",
    "simRunning",
  ])
    if (typeof s[k] === "boolean") d[k] = s[k];
  if (Array.isArray(s.split) && s.split.length === 5 && s.split.every(Number.isFinite))
    d.split = s.split.map((x) => clamp(x, 0, 100));
  if (
    Array.isArray(s.points) &&
    s.points.length === 5 &&
    s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
  )
    d.points = s.points.map((p) => {
      let n = Math.max(1, Math.hypot(...p) / 0.86);
      return p.map((x) => x / n);
    });
  if (
    Array.isArray(s.vacancy) &&
    s.vacancy.length === 4 &&
    s.vacancy.every((x) => Number.isFinite(x) && x >= 0) &&
    s.vacancy.some(Boolean)
  )
    d.vacancy = apportion(s.vacancy, 100);
  if (s.relations && typeof s.relations === "object")
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const k = relationKey(i, j),
          v = s.relations[k];
        if (["attract", "neutral", "repel"].includes(v)) d.relations[k] = v;
      }
  if (Array.isArray(s.cluster) && s.cluster.length === 5) d.cluster = s.cluster.map(Boolean);
  if (s.encounterWeights && typeof s.encounterWeights === "object")
    for (const k of Object.keys(d.encounterWeights))
      if (Number.isFinite(s.encounterWeights[k])) d.encounterWeights[k] = clamp(s.encounterWeights[k], 0, 10);
  for (const k of ["memoryBonus", "programBonus", "funBonus", "speciesBonus"])
    if (Number.isFinite(s[k])) d[k] = clamp(s[k], 1, 3);
  state = d;
  const c = data.camera || {};
  camera = {
    az: Number.isFinite(c.az) ? c.az : -0.84,
    el: clamp(Number.isFinite(c.el) ? c.el : 0.57, 0, Math.PI / 2 - 0.012),
    zoom: clamp(Number.isFinite(c.zoom) ? c.zoom : 1, 0.06, 3),
    pan: clamp(Number.isFinite(c.pan) ? c.pan : 0, -180, 180),
  };
}
// Restores the last autosave on startup.
function restoreSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applySaved(JSON.parse(raw));
  } catch (e) {
    $("saveStatus").textContent = "Local save unavailable";
  }
}
// Load JSON: pick a file and apply it.
$("import").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const f = $("importFile").files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    applySaved(data);
    cpHistory = Array.isArray(data.crossPollination?.comparisons)
      ? data.crossPollination.comparisons
          .filter(
            (t) =>
              t &&
              [
                t.rate,
                t.rooms,
                t.modules,
                t.hubs,
                t.core,
                t.encounters,
                t.cross,
                t.species,
                t.seed,
                t.visitors,
              ].every(Number.isFinite) &&
              typeof t.signature === "string",
          )
          .slice(0, 8)
      : [];
    initCrossUI();
    wheelRender();
    update();
    saveNow();
  } catch (e) {
    alert("Could not restore configuration: " + e.message);
  } finally {
    $("importFile").value = "";
  }
};
// Save when the page is closed.
window.addEventListener("pagehide", saveNow);
