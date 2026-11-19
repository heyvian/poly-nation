"use strict";
/**
 * 12-cross-pollination.js — the cross-pollination score and its panel.
 * Encounters between agents that are close together in compatible zones earn points, scaled by place weights and
 * bonuses (different rooms, different programs, human + animal, fun moment). The headline figure is points per
 * 100 visitor-minutes. Time is simulation time, not render frames.
 */
// Display names for each encounter category (also the keys of state.encounterWeights).
// Cross-pollination: bounded pair encounters, measured in simulation time, not render frames.
const CP_LABELS = {
  hub: "Shared lobby",
  room: "Same room / module",
  garden: "Garden / gazebo",
  plaza: "Plaza / entrance lobby",
  balcony: "Public balcony",
  greenhouse: "Greenhouse",
  roof: "Roof promenade",
  ride: "Ride experience",
  corridor: "Passing / circulation",
};
// Fresh score record: totals, counts per category and the table of currently-tracked pairs.
function newCrossScore() {
  return {
    points: 0,
    personSeconds: 0,
    encounters: 0,
    memory: 0,
    programs: 0,
    species: 0,
    crossSpecies: 0,
    fun: 0,
    by: Object.fromEntries(Object.keys(CP_LABELS).map((k) => [k, { points: 0, count: 0 }])),
    pairs: new Map(),
  };
}
// Maps a navigation node kind to one of the scoring categories.
function scoreCategory(k) {
  return (
    {
      hub: "hub",
      room: "room",
      module: "room",
      retail: "room",
      slideStart: "room",
      slideEnd: "room",
      garden: "garden",
      gazebo: "garden",
      outdoor: "garden",
      plaza: "plaza",
      entry: "plaza",
      lobby: "plaza",
      balcony: "balcony",
      greenhouse: "greenhouse",
      roof: "roof",
      swing: "ride",
      climbBase: "ride",
      climbTop: "ride",
      corridor: "corridor",
      lift: "corridor",
      roofLink: "corridor",
    }[k] || "corridor"
  );
}
// The navigation node an agent is currently in (null while in a lift, slide, or between zones).
function agentZone(a, s) {
  const g = s.graph;
  if (!a.path) return g.nodes[a.node];
  const t = a.path[a.step];
  if (!t || ["slide", "climb"].includes(t.kind)) return null;
  if (t.kind === "lift") return null;
  const [x, y, z] = a.p,
    r = Math.hypot(x, z),
    theta = mod(Math.atan2(z, x), TAU),
    f = Math.min(state.floors, Math.max(0, Math.round((y - 0.54) / 4.2)));
  const ids = [t.from, t.to].filter((i) => i != null);
  for (const i of ids) {
    const n = g.nodes[i],
      c = n.cell;
    if (
      c &&
      c.f === f &&
      r >= c.r - 0.01 &&
      r <= c.R + 0.01 &&
      [theta, theta + TAU, theta - TAU].some((t) => t >= c.start - 1e-6 && t <= c.end + 1e-6)
    )
      return n;
  }
  // Route-local outdoor/deck transitions; do not credit proximity through walls.
  for (const i of ids) {
    const n = g.nodes[i];
    if (
      !n.cell &&
      [
        "entry",
        "plaza",
        "outdoor",
        "garden",
        "balcony",
        "gazebo",
        "module",
        "retail",
        "swing",
        "climbBase",
        "climbTop",
      ].includes(n.kind) &&
      Math.hypot(...sub(a.p, n.p)) <= 2.5
    )
      return n;
  }
  return null;
}
// Two agents can meet only on the same floor in the same zone (or directly linked corridor/plaza/roof/garden zones).
function compatibleZones(a, b, g) {
  if (!a || !b || a.f !== b.f) return false;
  if (a.id === b.id) return true;
  const ca = scoreCategory(a.kind),
    cb = scoreCategory(b.kind);
  if (ca !== cb || !["corridor", "plaza", "roof", "garden", "greenhouse"].includes(ca)) return false;
  return g.edges[a.id].some((e) => e.to === b.id && e.kind !== "lift");
}
// Called once per simulated second: finds agent pairs within 2.5 m in compatible zones, opens an encounter,
// and credits points (max 15 s each) with the bonuses applied.
function scoreSample(s, dt) {
  const q = s.score,
    agents = [...s.people, ...s.animals].filter((a) => a.active),
    zones = agents.map((a) => agentZone(a, s));
  q.personSeconds += agents.length * dt;
  for (let i = 0; i < agents.length; i++)
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i],
        b = agents[j],
        za = zones[i],
        zb = zones[j];
      if (!compatibleZones(za, zb, s.graph) || Math.hypot(...sub(a.p, b.p)) > 2.5) continue;
      const key = a.kind + ":" + a.i + "|" + b.kind + ":" + b.i,
        category = scoreCategory(za.kind);
      let pair = q.pairs.get(key);
      const fresh = !pair || s.clock - pair.last > 8;
      if (fresh) {
        pair = { last: s.clock, credited: 0, flags: {}, category };
        q.pairs.set(key, pair);
        q.encounters++;
        q.by[category].count++;
      }
      pair.last = s.clock;
      const credit = Math.min(dt, 15 - pair.credited);
      if (credit <= 0) continue;
      pair.credited += credit;
      const memory = a.lastRoom != null && b.lastRoom != null && a.lastRoom !== b.lastRoom,
        programs = a.lastProgram != null && b.lastProgram != null && a.lastProgram !== b.lastProgram,
        species = (a.kind === "human") !== (b.kind === "human"),
        crossSpecies = a.kind !== b.kind,
        fun = [a, b].some((v) => s.clock >= v.funAt && s.clock - v.funAt < 90);
      for (const [k, v] of Object.entries({ memory, programs, species, crossSpecies, fun }))
        if (v && !pair.flags[k]) {
          pair.flags[k] = true;
          q[k]++;
        }
      const multiplier =
          (memory ? state.memoryBonus : 1) *
          (programs ? state.programBonus : 1) *
          (crossSpecies ? state.speciesBonus : 1) *
          (fun ? state.funBonus : 1),
        points = ((state.encounterWeights[category] * credit) / 10) * multiplier;
      q.points += points;
      q.by[category].points += points;
    }
  for (const [k, v] of q.pairs) if (s.clock - v.last > 9) q.pairs.delete(k);
}
// Moves the simulation forward in fixed 0.25 s steps and samples the score each second.
function advanceScored(s, dt) {
  s.stepBalance += dt;
  while (s.stepBalance >= 0.25 - 1e-8) {
    advanceOccupancy(s, 0.25);
    s.stepBalance -= 0.25;
    s.sampleClock += 0.25;
    if (s.sampleClock >= 1) {
      scoreSample(s, 1);
      s.sampleClock = 0;
    }
  }
}
// Called every animation frame with real elapsed time; applies the speed setting.
function tickOccupancy(dt) {
  if (occupancy) advanceScored(occupancy, Math.min(dt, 0.6) * state.simSpeed);
}
// Headline metric: weighted points per 100 visitor-minutes.
function crossRate(s) {
  return s?.score.personSeconds > 0 ? (s.score.points * 6000) / s.score.personSeconds : 0;
}
// Updates the dashboard and score panel from the live simulation.
let cpRendered = null,
  cpRenderedSecond = -1;
function renderCrossScore() {
  const s = occupancy;
  if (!s) return;
  $("cpNoEntry").hidden = s.graph.entry != null;
  const status = $("cpLiveStatus");
  status.textContent = !state.simRunning ? "Paused" : s.clock < 15 ? "Warming up" : "Live";
  status.dataset.paused = String(!state.simRunning);
  const second = Math.floor(s.clock);
  if (s === cpRendered && second === cpRenderedSecond) return;
  cpRendered = s;
  cpRenderedSecond = second;
  const q = s.score;
  $("cpScore").textContent = s.clock < 15 ? "—" : crossRate(s).toFixed(1);
  for (const [id, k] of [
    ["cpEncounters", "encounters"],
    ["cpMemory", "memory"],
    ["cpPrograms", "programs"],
    ["cpSpecies", "species"],
    ["cpCrossSpecies", "crossSpecies"],
    ["cpFun", "fun"],
  ])
    $(id).textContent = q[k];
  $("cpTime").textContent = Math.floor(s.clock / 60) + "m " + Math.floor(s.clock % 60) + "s";
  $("cpDashTime").textContent = $("cpTime").textContent;
  $("cpDashEncounters").textContent = q.encounters;
  $("cpDashMemory").textContent = q.memory;
  $("cpDashSpecies").textContent = q.crossSpecies;
  $("cpBreakdown").innerHTML = Object.entries(CP_LABELS)
    .map(([k, label]) => {
      const v = q.by[k];
      return `<div class="cp-row"><span>${label} · ${v.count}</span><b style="text-align:right">${v.points.toFixed(1)}</b><div class="cp-track"><i style="width:${q.points ? (v.points / q.points) * 100 : 0}%"></i></div></div>`;
    })
    .join("");
}
// History of five-minute trial runs, used for comparing designs.
let cpHistory = [],
  cpTrialActive = null;
// Fingerprint of the current design and scoring settings, so trials can be compared like for like.
function cpSignature() {
  return JSON.stringify({
    seed: state.seed,
    visitors: state.visitorCount,
    weights: state.encounterWeights,
    memory: state.memoryBonus,
    program: state.programBonus,
    fun: state.funBonus,
    species: state.speciesBonus,
  });
}
// Shows the latest trial result on the dashboard.
function refreshTrialDashboard() {
  const t = cpHistory[0],
    p = $("cpDashTrialProgress");
  $("cpQuickTrial").textContent = cpTrialActive ? "Cancel trial" : "Run 5-min trial";
  $("cpDashTrialResult").textContent = t
    ? "Last trial: " + t.rate.toFixed(1) + (t.signature === cpSignature() ? "" : " · different settings")
    : "No trial yet";
  p.hidden = !cpTrialActive;
  p.textContent = cpTrialActive ? $("cpTrialStatus").textContent : "";
}
$("cpQuickTrial").onclick = () => $("cpTrial").click();
// Draws the trial history list with change against the previous trial of the same design.
function renderTrials() {
  refreshTrialDashboard();
  $("cpHistory").innerHTML = cpHistory
    .map((t, i) => {
      const prev = cpHistory.slice(i + 1).find((x) => x.signature === t.signature),
        delta = prev
          ? " · " + (t.rate - prev.rate >= 0 ? "+" : "") + (t.rate - prev.rate).toFixed(1) + " vs prior"
          : "";
      return `<div class="cp-trial"><b>${t.rate.toFixed(1)}</b> pts / 100 visitor-min${delta}<small>${t.rooms} rooms · ${t.modules} pods · ${t.hubs} hubs · ${t.settings?.climbWidth ?? 0} m climbing · ${t.core.toLocaleString()} m² core</small><small>${t.encounters} encounters · ${t.cross} different-room · ${t.species} human/non-human</small><small>Seed ${t.seed} · ${t.visitors} humans ${t.signature === cpSignature() ? "· same trial settings" : "· different trial settings"}</small></div>`;
    })
    .join("");
}
// Builds the weight and bonus controls in the Score panel.
function initCrossUI() {
  const root = $("cpWeights"),
    rows = Object.entries(CP_LABELS)
      .map(([key, label]) => ({ key, label, min: 0, max: 10, step: 0.25, weight: true }))
      .concat([
        { key: "memoryBonus", label: "Different-room multiplier", min: 1, max: 3, step: 0.1 },
        { key: "programBonus", label: "Different-program multiplier", min: 1, max: 3, step: 0.1 },
        { key: "funBonus", label: "Recent fun multiplier", min: 1, max: 3, step: 0.1 },
        { key: "speciesBonus", label: "Cross-species multiplier", min: 1, max: 3, step: 0.1 },
      ]);
  root.innerHTML = "";
  for (const r of rows) {
    const label = document.createElement("label");
    label.textContent = r.label;
    const num = document.createElement("input");
    num.type = "number";
    num.min = r.min;
    num.max = r.max;
    num.step = r.step;
    num.setAttribute("aria-label", r.label);
    const value = () => (r.weight ? state.encounterWeights[r.key] : state[r.key]);
    num.value = value();
    label.append(num);
    root.append(label);
    num.onchange = () => {
      const v = num.valueAsNumber;
      if (!Number.isFinite(v)) {
        num.value = value();
        return;
      }
      if (r.weight) state.encounterWeights[r.key] = clamp(v, r.min, r.max);
      else state[r.key] = clamp(v, r.min, r.max);
      num.value = value();
      if (model) {
        occupancy = makeOccupancy(model);
        refreshPopulation();
        draw();
      }
      renderTrials();
      queueSave();
    };
  }
  renderTrials();
}

// Clear the trial history.
$("cpClear").onclick = () => {
  cpHistory = [];
  renderTrials();
};
// Runs a separate five-minute simulated trial of the current design in short batches, then records the result.
$("cpTrial").onclick = () => {
  if (cpTrialActive) {
    cpTrialActive.cancel = true;
    return;
  }
  if (!model) return;
  const m = model,
    signature = cpSignature(),
    s = makeOccupancy(m),
    run = { cancel: false };
  cpTrialActive = run;
  $("cpTrial").textContent = "Cancel comparison";
  $("cpTrialStatus").textContent = "Comparing · 0%";
  refreshTrialDashboard();
  function batch() {
    if (run.cancel || model !== m || signature !== cpSignature()) {
      finish("Comparison cancelled (settings changed or cancelled).");
      return;
    }
    const end = performance.now() + 24;
    while (s.clock < 300 && performance.now() < end) advanceScored(s, 1);
    $("cpTrialStatus").textContent = "Comparing · " + Math.round(s.clock / 3) + "%";
    refreshTrialDashboard();
    if (s.clock < 300) setTimeout(batch, 0);
    else {
      const q = s.score;
      cpHistory.unshift({
        rate: crossRate(s),
        rooms: m.rooms.length,
        modules: m.count,
        hubs: m.circulation.hubs.length,
        core: Math.round(m.ringArea + m.court),
        encounters: q.encounters,
        cross: q.memory,
        species: q.species,
        signature,
        seed: state.seed,
        visitors: state.visitorCount,
        settings: JSON.parse(JSON.stringify(state)),
        breakdown: q.by,
      });
      cpHistory = cpHistory.slice(0, 8);
      renderTrials();
      finish("Five simulated minutes completed.");
    }
  }
  function finish(msg) {
    cpTrialActive = null;
    $("cpTrial").textContent = "Run 5-minute comparison";
    $("cpTrialStatus").textContent = msg;
    refreshTrialDashboard();
  }
  setTimeout(batch, 0);
};

// Builds the moving people/animals geometry for the current simulation positions.
function makePopulationMesh() {
  const b = meshBuilder();
  if (!occupancy) return b;
  const g = occupancy.graph,
    cut = !state.inspect ? Infinity : state.inspect * 4.2 + 0.22,
    roofVisible = !state.inspect && state.showRoofDeck && !state.xray;
  for (const a of [...occupancy.people, ...occupancy.animals]) {
    if (!a.active || (a.kind === "human" ? !state.showPeople : !state.showAnimals)) continue;
    const [x, y, z] = a.p;
    if (y >= cut || (!roofVisible && y >= state.floors * 4.2)) continue;
    if (a.kind === "human") {
      if (a.wheelchair) lowPolyWheelchair(b.box, b.quad, b.tri, x, y, z, a.angle, a.style);
      else lowPolyPerson(b.box, x, y, z, a.angle, a.style);
    } else if (a.kind === "dog") lowPolyDog(b.box, x, y, z, a.angle, a.style);
    else if (a.kind === "bird") {
      const flight = a.path
        ? Math.min(2.1, 0.7 + Math.abs(Math.sin((occupancy.clock || 0) * 2 + a.i)) * 0.9)
        : 0.02;
      lowPolyBird(b.box, x, y + flight, z, a.angle, a.style);
    } else if (a.kind === "rabbit") lowPolyRabbit(b.box, x, y, z, a.angle, a.style);
    else lowPolySquirrel(b.box, x, y, z, a.angle, a.style);
  }
  return b;
}
// Rebuilds and uploads the population geometry; the static building mesh is untouched.
function refreshPopulation() {
  const mesh = software ? softwareMesh : gpu?.mesh;
  if (!mesh || !occupancy) return;
  const b = makePopulationMesh();
  mesh.population = b;
  if (!software && gpu) {
    for (const k of ["solid", "lines"]) {
      const name = "agent_" + k;
      if (!gpu.buffers[name]) gpu.buffers[name] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[name]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b[k]), gl.DYNAMIC_DRAW);
      gpu.lengths[name] = b[k].length / 10;
    }
  }
  $("simPeople").textContent = occupancy.people.filter((a) => a.active).length;
  $("simAnimals").textContent = occupancy.animals.filter((a) => a.active).length;
  $("simGather").textContent = occupancy.gather;
  $("simFun").textContent = occupancy.fun;
  renderCrossScore();
}

