"use strict";
/**
 * 03-controls.js — builds the settings panel controls and wires them to `state`.
 * Every change updates `state` and then calls scheduleUpdate() (defined in 14-update.js).
 */
// Slider definitions: [state key, label, min, max, step, unit suffix].
const coreSpecs = [
  ["areaCap", "Floor area cap", 5000, 50000, 500, " m²"],
  ["floors", "Floors", 1, 10, 1, ""],
  ["footprint", "Outer footprint", 100, 22000, 1, " m²"],
  ["ringWidth", "Preferred ring width", 5, 35, 0.5, " m"],
  ["lobby", "Entrance / lobby footprint", 0, 1000, 20, " m²"],
  ["minRoomArea", "Minimum core room area", 40, 200, 5, " m²"],
];
const moduleSpecs = [["modules", "Requested modules", 0, 300, 1, ""]];
// Creates a labelled range slider with a linked number box inside element `parent`.
// Returns a refresh function that copies the current state value back into the inputs.
function slider(parent, spec) {
  const [id, title, min, max, step, suffix] = spec;
  const row = document.createElement("div");
  row.className = "field";
  row.innerHTML = `<label for="${id}">${title}<output id="${id}Out"></output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${state[id]}">`;
  $(parent).append(row);
  const range = $(id),
    out = $(id + "Out");
  const number = document.createElement("input");
  number.type = "number";
  number.className = "num-edit";
  number.title = title + suffix;
  number.setAttribute("aria-label", title + (suffix ? " (" + suffix.trim() + ")" : ""));
  number.min = min;
  number.max = max;
  number.step = step;
  out.hidden = true;
  out.after(number);
  if (suffix) {
    const unit = document.createElement("span");
    unit.className = "field-unit";
    unit.textContent = suffix.trim();
    number.after(unit);
  }
  range.addEventListener("input", () => {
    state[id] = Number(range.value);
    if (id === "simSpeed") {
      queueSave();
    } else scheduleUpdate();
  });
  number.addEventListener("change", () => {
    const v = Number(number.value);
    if (number.value.trim() !== "" && Number.isFinite(v)) {
      range.value = clamp(v, +range.min, +range.max);
      state[id] = Number(range.value);
      if (id === "simSpeed") {
        queueSave();
      } else scheduleUpdate();
    } else number.value = range.value;
  });
  number.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      number.blur();
    }
  });
  return () => {
    range.value = state[id];
    number.min = range.min;
    number.max = range.max;
    number.disabled = range.disabled;
    if (document.activeElement !== number) number.value = range.value;
    out.textContent = Number(state[id]).toLocaleString("en-US") + suffix;
  };
}
// All sliders, collected so syncControls() can refresh them together (e.g. after Reset or Load JSON).
const refreshInputs = [
  ...coreSpecs.map((s) => slider("coreFields", s)),
  ...moduleSpecs.map((s) => slider("moduleFields", s)),
  slider("circulationFields", ["corridorWidth", "Preferred corridor width", 1.5, 5, 0.1, " m"]),
  slider("featureFields", ["slideLength", "Water slide length", 0, 100, 5, "%"]),
  slider("climbFields", ["climbWidth", "Climbing wall width", 0, 24, 0.5, " m"]),
  slider("affinityField", ["affinity", "Relationship strength", 0, 100, 5, "%"]),
  slider("mixField", ["mix", "Core cross-pollination", 0, 100, 5, "%"]),
];
refreshInputs.push(
  slider("simFields", ["simSpeed", "Simulation speed", 1, 12, 1, "×"]),
  slider("simFields", ["visitorCount", "Human visitors", 8, 70, 1, ""]),
);

// Vacant-slot share sliders: moving one redistributes the remainder across the others so the total stays 100%.
VACANCY.forEach((v, i) => {
  const d = document.createElement("div");
  d.className = "program-row";
  d.style.setProperty("--program", v.color);
  d.innerHTML = `<div class="top"><label for="vac${i}"><i class="dot" style="background:${v.color}"></i>${v.name}</label><span id="vacOut${i}"></span></div><input id="vac${i}" type="range" min="0" max="100" step="1"><div class="split"><span id="vacCount${i}"></span></div>`;
  $("vacancyFields").append(d);
  $("vac" + i).oninput = () => {
    const v = +$("vac" + i).value,
      others = state.vacancy.map((x, j) => (i === j ? 0 : x)),
      weights = others.some(Boolean) ? others : others.map((_, j) => +(j !== i));
    state.vacancy = apportion(weights, 100 - v);
    state.vacancy[i] = v;
    scheduleUpdate();
  };
});
// Switching off auto-size freezes the currently computed footprint and ring width as manual values.
$("autoCore").onchange = () => {
  if (!$("autoCore").checked && model) {
    state.footprint = Math.PI * model.R * model.R;
    state.ringWidth = model.width;
  }
  state.autoCore = $("autoCore").checked;
  scheduleUpdate();
};
// Level filter for the 3D model: re-upload geometry only (no re-layout needed).
$("inspect").onchange = () => {
  state.inspect = +$("inspect").value;
  if (model && !pending) {
    upload(model);
    queueSave();
  } else scheduleUpdate();
};
// One 'core vs modular' split slider per program.
PROGRAMS.forEach((p, i) => {
  const d = document.createElement("div");
  d.className = "program-row";
  d.style.setProperty("--program", p.color);
  d.innerHTML = `<div class="top"><label for="split${i}"><i class="dot" style="background:${p.color}"></i>${p.name}</label><span>${fmt(p.goal)} m²</span></div><input id="split${i}" type="range" min="0" max="100" step="1" value="${p.split}"><div class="split"><span id="core${i}"></span><span id="mod${i}"></span></div><div class="hint" id="actual${i}"></div>`;
  $("programFields").append(d);
  $("split" + i).addEventListener("input", () => {
    state.split[i] = Number($("split" + i).value);
    scheduleUpdate();
  });
});
// Colour legend for the programs.
$("legend").innerHTML = PROGRAMS.map(
  (p) => `<span><i class="dot" style="background:${p.color}"></i>${p.name}</span>`,
).join("");
// Pushes the whole `state` into every control (sliders, checkboxes, level picker, vacancy and split rows).
function syncControls() {
  refreshInputs.forEach((f) => f());
  $("autoCore").checked = state.autoCore;
  $("footprint").disabled = state.autoCore;
  $("footprint").closest(".field").querySelector(".num-edit").disabled = state.autoCore;
  PROGRAMS.forEach((p, i) => {
    $("split" + i).value = state.split[i];
    $("core" + i).textContent = state.split[i] + "% core";
    $("mod" + i).textContent = 100 - state.split[i] + "% modular";
  });
  for (const k of ["roof", "grid", "supports", "showModules", "showPeople", "showAnimals"])
    $(k).checked = state[k];
  state.inspect = Math.min(state.inspect, state.floors);
  $("inspect").innerHTML =
    '<option value="0">All + roof</option>' +
    Array.from({ length: state.floors }, (_, i) => state.floors - i)
      .map((n) => `<option value="${n}">${n === 1 ? "Ground only" : "Ground – L" + n}</option>`)
      .join("");
  $("inspect").value = state.inspect;
  VACANCY.forEach((v, i) => {
    $("vac" + i).value = state.vacancy[i];
    $("vacOut" + i).textContent = state.vacancy[i] + "%";
  });
}
