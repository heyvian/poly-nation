"use strict";
/**
 * 17-ui-shell.js — page-level UI and application start-up.
 * Tabs, navigation shortcuts, export menu, simulation restart and the initial startup sequence.
 */
// Applies view toggles (X-ray, rooms, etc.): updates button states and re-uploads the mesh without re-solving the layout.
function refreshView() {
  if (!model || pending) {
    scheduleUpdate();
    return;
  }
  for (const [id, key] of Object.entries(viewKeys)) $(id).setAttribute("aria-pressed", String(state[key]));
  for (const k of ["roof", "grid", "supports", "showModules", "showPeople", "showAnimals"])
    $(k).checked = state[k];
  upload(model);
  queueSave();
}
// Updates the area budget bar and its text.
function updateBudget(m) {
  const cap = state.areaCap,
    used = Math.min(100, Math.max(0, (m.total / cap) * 100)),
    remaining = Math.max(0, cap - m.total);
  $("budgetFill").style.width = used + "%";
  $("budgetTrack").setAttribute("aria-valuemax", String(cap));
  $("budgetTrack").setAttribute("aria-valuenow", String(Math.round(m.total)));
  $("budgetText").textContent = fmt(remaining) + " m² available · " + fmt(cap) + " m² budget";
}
// Tab lists: click and arrow/Home/End key navigation (with ARIA state).
for (const nav of document.querySelectorAll(".panel-tabs")) {
  const bs = [...nav.querySelectorAll("[role=tab]")];
  const select = (b) => {
    for (const q of bs) {
      const on = q === b;
      q.setAttribute("aria-selected", String(on));
      q.tabIndex = on ? 0 : -1;
      $(q.dataset.panel).hidden = !on;
    }
    const sc = nav.closest(".design-scroll");
    if (sc) sc.scrollTop = 0;
  };
  for (const b of bs) b.onclick = () => select(b);
  nav.addEventListener("keydown", (e) => {
    const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    let j =
      e.key === "ArrowRight"
        ? (i + 1) % bs.length
        : e.key === "ArrowLeft"
          ? (i + bs.length - 1) % bs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? bs.length - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    select(bs[j]);
    bs[j].focus();
  });
}
// Scrolls back to the 3D model (mainly for small screens).
function goToModel() {
  document.querySelector(".center").scrollTop = 0;
  if (innerWidth < 900) document.querySelector(".model-stage").scrollIntoView({ block: "start" });
}
$("focusSchedule").onclick = () => document.querySelector(".schedule").scrollIntoView({ block: "start" });
$("backToModel").onclick = goToModel;
$("returnModelMobile").onclick = goToModel;
$("jumpTopology").onclick = () =>
  document.querySelector(".topology-persistent").scrollIntoView({ block: "start" });
$("openScoreDetails").onclick = () => {
  $("cpPaneScore-tab").click();
  const sc = document.querySelector(".design-scroll");
  sc.scrollTop = 0;
  if (innerWidth < 900) $("cpPaneScore-tab").scrollIntoView({ block: "start" });
};
// Close the Files & export menu on outside click or Escape.
const exportMenu = document.querySelector(".file-menu");
document.addEventListener("click", (e) => {
  if (!exportMenu.contains(e.target) || e.target.closest(".file-menu-content button"))
    exportMenu.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") exportMenu.open = false;
});

// Restart the simulation from a clean state.
$("simRestart").onclick = () => {
  if (model) {
    occupancy = makeOccupancy(model);
    simLast = 0;
    refreshPopulation();
    draw();
  }
};
// START-UP: set up rendering, restore the last save, build the score controls, draw the topology map, run the first update and start the animation loop.
initGL();
restoreSaved();
initCrossUI();
wheelRender();
update();
document.addEventListener("visibilitychange", () => {
  swingLast = 0;
});
requestAnimationFrame(animateSwingFrame);
