"use strict";
/**
 * 14-update.js — the main update cycle.
 * update() recalculates the model from `state`, refreshes every readout, the area schedule and the 3D view.
 * Changes are batched with scheduleUpdate().
 */
// Shows or hides a warning message under a panel section.
function warning(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}
// Toolbar button id -> state flag it toggles. Clicking re-uploads the model and redraws.
const viewKeys = {
  viewXray: "xray",
  viewRooms: "showRooms",
  viewModules: "showModules",
  viewFacade: "showFacade",
  viewRoof: "showRoofDeck",
  viewSwing: "animateSwing",
  viewPeople: "showPeople",
  viewAnimals: "showAnimals",
  viewSim: "simRunning",
};
for (const [id, key] of Object.entries(viewKeys))
  $(id).onclick = () => {
    state[key] = !state[key];
    refreshView();
    renderCrossScore();
  };
// Recalculates everything: syncs the controls, runs derive(), writes the readouts (geometry, circulation,
// features, roof, capacity, vacancy), fills the area schedule, budget bar and warnings, then uploads the 3D mesh,
// restarts the simulation for the new model and saves.
function update() {
  pending = 0;
  const R = Math.sqrt(state.footprint / Math.PI);
  $("ringWidth").max = state.autoCore ? 35 : Math.max(0.5, Math.min(35, Math.floor((R - 3) * 2) / 2));
  $("ringWidth").min = state.autoCore ? 5 : Math.min(5, +$("ringWidth").max);
  state.ringWidth = clamp(state.ringWidth, +$("ringWidth").min, +$("ringWidth").max);
  syncControls();
  for (const [id, key] of Object.entries(viewKeys)) $(id).setAttribute("aria-pressed", String(state[key]));
  model = derive();
  renderTrials();
  const m = model;
  const c = m.feature.climbing,
    s = m.feature.slide;
  $("climbSize").textContent = c ? c.width.toFixed(1) + " m × " + c.height.toFixed(1) + " m" : "Off";
  $("climbBlocked").textContent = c ? c.blocked.size + " slots" : "0 slots";
  $("climbClearance").textContent = s?.climbCrossing
    ? s.climbClearance.toFixed(1) + " m (conceptual)"
    : c && s
      ? "No crossing"
      : "—";
  $("roofPublic").textContent = fmt(m.roofPlan.publicArea) + " m²";
  $("roofRetail").textContent = m.roofPlan.pavilions.length + " / " + fmt(m.roofPlan.retailArea) + " m²";
  $("roofService").textContent = fmt(m.roofPlan.serviceArea) + " m²";
  $("slideConnections").textContent = m.feature.slide
    ? m.feature.slide.connections.length + " direct landings"
    : "—";
  if (state.autoCore || m.manualClamped) {
    $("footprint").value = Math.PI * m.R * m.R;
    $("footprintOut").textContent = fmt(Math.PI * m.R * m.R) + " m²";
    $("footprint").closest(".field").querySelector(".num-edit").value = Math.round(Math.PI * m.R * m.R);
  }
  $("actualWidth").textContent = m.width.toFixed(2) + " m";
  $("wallThickness").textContent = Math.round(facadeThickness(m) * 1000) + " mm";
  $("corridorActual").textContent = m.circulation.width.toFixed(2) + " m";
  $("corridorArea").textContent = fmt(m.circulation.corridorArea) + " m²";
  $("elevatorArea").textContent = fmt(m.circulation.elevatorArea) + " m²";
  $("hubArea").textContent = fmt(m.circulation.hubArea) + " m²";
  $("hubCount").textContent = m.circulation.hubs.length;
  const hubPairs = [];
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++)
      if (relationMode(i, j) === "attract") {
        const n = m.circulation.hubs.filter((h) => relationKey(...h.pair) === relationKey(i, j)).length;
        hubPairs.push({ i, j, n });
      }
  $("hubCoverage").textContent =
    state.affinity === 0 ? "Off" : hubPairs.filter((p) => p.n > 0).length + " / " + hubPairs.length;
  $("hubPairs").innerHTML = hubPairs.length
    ? hubPairs
        .map(
          (p) =>
            `<div class="readout" style="font-size:11px"><span>${PROGRAMS[p.i].short} + ${PROGRAMS[p.j].short}</span><b style="color:${p.n ? "#47866a" : "#a06b40"}">${p.n ? p.n + " shared" : "No shared hub"}</b></div>`,
        )
        .join("")
    : '<p class="hint">No pairs set to attract.</p>';
  $("circulationArea").textContent = fmt(m.circulation.total) + " m²";
  warning(
    "circulationWarning",
    [
      m.circulation.width < state.corridorWidth - 0.02
        ? "Corridor width reduced to fit the narrow ring."
        : "",
      m.lobby.voidArea
        ? "Level 2 outer corridor is interrupted by the double-height entrance; its two ends remain connected around the other side."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  warning(
    "geometryWarning",
    m.manualClamped
      ? "Requested core too large; scaled down to the floor-area cap."
      : Math.abs(m.width - state.ringWidth) > 0.01
        ? "Ring width adjusted to keep the greenhouse within its allocated area."
        : "",
  );
  PROGRAMS.forEach((p, i) => {
    $("actual" + i).textContent =
      `Adjusted goal: ${fmt(m.goals[i])} m² · Actual: ${fmt(m.core[i])} m² core · ${m.counts[i]} pods (${fmt(m.counts[i] * 81)} m²)`;
  });
  $("diameter").textContent = (m.R * 2).toFixed(1) + " m";
  $("ringArea").textContent = fmt(m.ringPer) + " m²";
  $("courtArea").textContent = fmt(m.court) + " m²";
  $("lobbyArea").textContent = fmt(m.lobby.area) + " m²";
  $("lobbyVoid").textContent = fmt(m.lobby.voidArea) + " m²";
  $("lobbyVolume").textContent = fmt(m.lobby.volume) + " m³";
  $("lobbyBlocked").textContent = m.lobby.blocked.size + " slots";
  $("plazaArea").textContent = fmt(m.plaza?.area || 0) + " m²";
  $("slots").textContent = m.slotN;
  $("maxModules").textContent = m.max;
  $("blockedSlots").textContent = (m.feature?.blocked.size || 0) + " slots";
  $("slideDetours").textContent = m.feature.slide?.facadeDetours?.length || 0;
  $("rideHeight").textContent = (m.feature?.ride.height || 117).toFixed(0) + " m";
  $("slideRun").textContent = m.feature.slide ? fmt(m.feature.slide.run) + " m" : "Off";
  $("slideLevels").textContent = m.feature.slide
    ? `L${m.feature.slide.startFloor + 1} → L${m.feature.slide.endFloor + 1} · ${Math.round(m.feature.slide.grade * 100)}%`
    : "—";
  warning(
    "slideWarning",
    state.slideLength && !m.feature.slide
      ? "No suitable vertically separated Infinite Rinse facade rooms. Try another variation or more core Rinse area / floors."
      : "",
  );
  warning(
    "capacityWarning",
    state.modules > m.count
      ? `${m.count} of ${state.modules} requested modules installed. Docking space or eligible program demand limits capacity; remaining primary area stays in the core.`
      : "",
  );
  $("totalArea").textContent = fmt(m.total);
  $("coreArea").textContent = fmt(m.ringArea + m.court + m.roofPlan.area);
  $("moduleArea").textContent = fmt(m.count * 81);
  $("totalModules").textContent = m.count;
  $("vacantCount").textContent = m.max - m.count;
  $("outdoorArea").textContent = fmt(m.outdoor) + " m²";
  $("retailArea").textContent = fmt(m.retail) + " m²";
  $("roomCount").textContent =
    m.rooms.length + (m.rooms.length ? " · min " + fmt(Math.min(...m.rooms.map((q) => q.area))) + " m²" : "");
  $("primaryArea").textContent = fmt(m.primary) + " m²";
  VACANCY.forEach((v, i) => {
    $("vacCount" + i).textContent = m.vacancyCounts[i] + " slots";
  });
  $("vacancyBar").innerHTML = VACANCY.map(
    (v, i) =>
      `<div style="background:${v.color};width:${m.max > m.count ? (m.vacancyCounts[i] / (m.max - m.count)) * 100 : 0}%"></div>`,
  ).join("");
  $("areaDelta").textContent =
    fmt(Math.max(0, state.areaCap - m.total)) + " m² remaining of " + fmt(state.areaCap) + " m²";
  $("seedLabel").textContent = "Seed " + state.seed;
  $("score").textContent = state.affinity === 0 ? "Off" : m.score.toFixed(3);
  let rows = "",
    bar = "";
  P.forEach((p, i) => {
    const total = m.core[i] + m.counts[i] * 81,
      d = total - p.goal;
    if (i === UNUSED && total < 0.01) return;
    rows += `<tr><td><i class="dot" style="background:${p.color}"></i>${p.name}</td><td>${fmt(p.goal)}</td><td>${fmt(m.core[i])}</td><td>${m.counts[i]}</td><td><b>${fmt(total)}</b></td><td class="${d < -0.5 ? "negative" : d > 0.5 ? "positive" : ""}">${signed(d)}</td></tr>`;
    bar += `<div title="${p.name}: ${fmt(total)} m²" style="background:${p.color};width:${(total / m.total) * 100}%"></div>`;
  });
  if (m.lobby.area) {
    rows += `<tr><td><i class="dot" style="background:#e5d3ae"></i>Entrance / lobby</td><td>—</td><td>${fmt(m.lobby.area)}</td><td>—</td><td><b>${fmt(m.lobby.area)}</b></td><td>—</td></tr>`;
    bar += `<div style="background:#e5d3ae;width:${(m.lobby.area / m.total) * 100}%"></div>`;
  }
  if (m.circulation.total) {
    for (const [name, value, color] of [
      ["Corridors / links", m.circulation.corridorArea, "#eee9da"],
      ["Elevator blocks", m.circulation.elevatorArea, "#777a91"],
      ["Shared lobbies", m.circulation.hubArea, "#80509e"],
    ]) {
      if (value < 0.01) continue;
      rows += `<tr><td><i class="dot" style="background:${color}"></i>${name}</td><td>—</td><td>${fmt(value)}</td><td>—</td><td><b>${fmt(value)}</b></td><td>—</td></tr>`;
      bar += `<div title="${name}: ${fmt(value)} m²" style="background:${color};width:${(value / m.total) * 100}%"></div>`;
    }
  }
  if (m.retail) {
    rows += `<tr><td><i class="dot" style="background:${VACANCY[3].color}"></i>Commercial / retail</td><td>—</td><td>—</td><td>${m.vacancyCounts[3]}*</td><td><b>${fmt(m.retail)}</b></td><td>—</td></tr>`;
    bar += `<div title="Retail: ${fmt(m.retail)} m²" style="background:${VACANCY[3].color};width:${(m.retail / m.total) * 100}%"></div>`;
  }
  for (const [name, value, color] of [
    ["Roof retail pavilions", m.roofPlan.retailArea, "#ad91c7"],
    ["Roof lift access + services", m.roofPlan.serviceArea, "#777a91"],
  ]) {
    if (value < 0.001) continue;
    rows += `<tr><td><i class="dot" style="background:${color}"></i>${name}</td><td>—</td><td>${fmt(value)}</td><td>—</td><td><b>${fmt(value)}</b></td><td>—</td></tr>`;
    bar += `<div title="${name}: ${fmt(value)} m²" style="background:${color};width:${(value / m.total) * 100}%"></div>`;
  }
  $("schedule").innerHTML = rows;
  $("areaBar").innerHTML = bar;
  warning(
    "allocationWarning",
    [
      m.circulation.total > 0
        ? "Circulation is deducted from remaining core program room areas, not added to the total."
        : "",
      m.lobby.area > 0
        ? "The lobby shares the area budget with all programs; its upper-level void is excluded."
        : "",
      m.lobby.area < state.lobby - 0.1 ? "Lobby footprint limited by available ring geometry." : "",
      m.retail > 0
        ? "Retail occupies part of the area budget; the five base goals are reduced proportionally."
        : "",
      m.vacancyCounts[3] < m.retailRequested
        ? "Retail share limited by the cap or docking geometry; overflow assigned to other vacancy uses."
        : "",
      !state.autoCore && PROGRAMS.some((p, i) => Math.abs(m.core[i] + m.counts[i] * 81 - m.goals[i]) > 0.01)
        ? "Manual geometry does not match one or more adjusted program goals. Re-enable auto-size to rebalance."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  updateBudget(m);
  upload(m);
  queueSave();
}
// Debounces updates: many quick control changes result in one update on the next frame.
function scheduleUpdate() {
  if (!pending) pending = requestAnimationFrame(update);
}
// New variation: a new random seed with the same settings.
$("shuffle").onclick = () => {
  state.seed = (state.seed + 1) >>> 0;
  scheduleUpdate();
};
// Reset design: restores all defaults and clears relations/clusters.
$("reset").onclick = () => {
  if (
    !confirm(
      "Reset all design settings and camera to defaults? Export JSON first if you want to keep this configuration.",
    )
  )
    return;
  state = defaults();
  initCrossUI();
  $("relationStatus").textContent = "All program pairs begin neutral unless explicitly changed.";
  camera = { az: -0.84, el: 0.57, zoom: 1, pan: 0 };
  wheelRender();
  scheduleUpdate();
};
for (const k of ["roof", "grid", "supports", "showModules", "showPeople", "showAnimals"])
  $(k).onchange = () => {
    state[k] = $(k).checked;
    refreshView();
  };
