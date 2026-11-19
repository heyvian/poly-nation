"use strict";
/**
 * 08-topology-map.js — the Topology Designer.
 * An SVG diagram where each program is a draggable node. Distance sets relationship strength, clicking a line
 * cycles attract / neutral / repel, clicking a node toggles clustering.
 */
// PROGRAM MAP — circle is a diagram, not a floor plan. Coordinates are normalized [-.85,.85].
let activeNode = null;
const wheel = $("wheel");
// Visual style for each relationship mode.
const MODES = {
  attract: { name: "Attract", color: "#47866a", dash: "" },
  neutral: { name: "Neutral", color: "#999f99", dash: "2 5" },
  repel: { name: "Repel", color: "#bd665c", dash: "8 5" },
};
// Converts normalised map coordinates to SVG pixels.
function px(p) {
  return [140 + p[0] * 119, 140 + p[1] * 119];
}
// Redraws the whole map (guide circles, relationship lines, nodes) plus the pair list and cluster status.
function wheelRender() {
  let html =
    '<circle cx="140" cy="140" r="111" fill="none" stroke="#d0d7cf" stroke-dasharray="3 5"/><circle cx="140" cy="140" r="64" fill="none" stroke="#e0e4dc"/><path d="M29 140H251M140 29V251" stroke="#e0e4dc"/><circle cx="140" cy="140" r="2" fill="#9ca99c"/>';
  let pairs = "";
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++) {
      const a = px(state.points[i]),
        b = px(state.points[j]),
        k = relationKey(i, j),
        mode = relationMode(i, j),
        style = MODES[mode],
        mag = relationMagnitude(i, j),
        label = PROGRAMS[i].name + " / " + PROGRAMS[j].name + ": " + style.name;
      const points = `x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"`;
      html += `<g class="relationship" data-pair="${k}" tabindex="0" role="button" aria-label="${label}. Click to cycle"><title>${label}</title><line class="edge-visible" ${points} stroke="${style.color}" stroke-width="${1.4 + mag * 2}" stroke-dasharray="${style.dash}" opacity="${0.6 + mag * 0.4}" pointer-events="none"/><line ${points} stroke="transparent" stroke-width="13" pointer-events="stroke"/></g>`;
      pairs += `<button data-pair="${k}" aria-label="${label}. Click to cycle"><span>${PROGRAMS[i].short} ↔ ${PROGRAMS[j].short}</span><b style="color:${style.color}">${style.name}</b></button>`;
    }
  for (let i = 0; i < 5; i++) {
    const [x, y] = px(state.points[i]),
      p = PROGRAMS[i];
    html += `<g class="node" data-i="${i}" tabindex="0" role="button" aria-label="${p.name}: clustering ${state.cluster[i] ? "on" : "off"}. Enter to toggle, arrows to move" data-clustered="${state.cluster[i]}" aria-pressed="${state.cluster[i]}" transform="translate(${x} ${y})"><circle class="cluster-ring" r="22" fill="none" stroke="none"/><circle r="18" fill="${p.color}" stroke="#fff" stroke-width="2.5"/><text text-anchor="middle" dy="4" font-size="10" font-weight="700" fill="#26322f" pointer-events="none">${p.short}</text><title>${p.name}</title></g>`;
  }
  wheel.innerHTML = html;
  $("pairList").innerHTML = pairs;
  const c = PROGRAMS.filter((p, i) => state.cluster[i]).map((p) => p.name);
  $("clusterStatus").textContent = c.length
    ? "Clustered: " + c.join(", ")
    : "Clustering off for all programs.";
}
// Advances a pair to the next mode (attract -> neutral -> repel -> attract) and re-runs the design.
function cyclePair(key, container) {
  const [i, j] = key.split("-").map(Number);
  if (!(i >= 0 && j < 5 && i < j)) return;
  const mode = relationMode(i, j),
    next = { attract: "neutral", neutral: "repel", repel: "attract" }[mode];
  state.relations[key] = next;
  wheelRender();
  $("relationStatus").textContent = PROGRAMS[i].name + " ↔ " + PROGRAMS[j].name + ": " + MODES[next].name;
  container?.querySelector('[data-pair="' + key + '"]')?.focus({ preventScroll: true });
  scheduleUpdate();
}
// Reset every relationship to neutral.
$("neutralize").onclick = () => {
  state.relations = {};
  wheelRender();
  $("relationStatus").textContent = "All program relationships set to neutral.";
  scheduleUpdate();
};
// Click / keyboard handlers for the relationship lines.
wheel.addEventListener("click", (e) => {
  const g = e.target.closest("[data-pair]");
  if (g) cyclePair(g.dataset.pair, wheel);
});
wheel.addEventListener("keydown", (e) => {
  const g = e.target.closest("[data-pair]");
  if (g && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    cyclePair(g.dataset.pair, wheel);
  }
});
$("pairList").addEventListener("click", (e) => {
  const g = e.target.closest("[data-pair]");
  if (g) cyclePair(g.dataset.pair, $("pairList"));
});
// Moves a node, keeping it inside the map circle.
function movePoint(i, x, y) {
  let len = Math.hypot(x, y);
  if (len > 0.86) {
    x *= 0.86 / len;
    y *= 0.86 / len;
  }
  state.points[i] = [x, y];
  wheelRender();
  scheduleUpdate();
}
// Turns clustering on or off for one program.
function toggleCluster(i) {
  state.cluster[i] = !state.cluster[i];
  wheelRender();
  $("relationStatus").textContent =
    PROGRAMS[i].name + " clustering " + (state.cluster[i] ? "on" : "off") + ".";
  scheduleUpdate();
}
// Pointer handling: drag a node to move it; a click without movement toggles clustering.
let dragOrigin = null,
  dragMoved = false;
wheel.addEventListener("pointerdown", (e) => {
  const g = e.target.closest("[data-i]");
  if (!g) return;
  e.preventDefault();
  activeNode = +g.dataset.i;
  dragOrigin = [e.clientX, e.clientY];
  dragMoved = false;
  wheel.setPointerCapture(e.pointerId);
});
wheel.addEventListener("pointermove", (e) => {
  if (activeNode === null) return;
  if (Math.hypot(e.clientX - dragOrigin[0], e.clientY - dragOrigin[1]) > 5) dragMoved = true;
  if (!dragMoved) return;
  let q = wheel.createSVGPoint();
  q.x = e.clientX;
  q.y = e.clientY;
  const p = q.matrixTransform(wheel.getScreenCTM().inverse());
  movePoint(activeNode, (p.x - 140) / 119, (p.y - 140) / 119);
});
wheel.addEventListener("pointerup", () => {
  if (activeNode !== null && !dragMoved) toggleCluster(activeNode);
  activeNode = null;
});
for (const ev of ["pointercancel", "lostpointercapture"])
  wheel.addEventListener(ev, () => (activeNode = null));
wheel.addEventListener("keydown", (e) => {
  const g = e.target.closest("[data-i]");
  if (!g) return;
  const i = +g.dataset.i;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleCluster(i);
    wheel.querySelector(`[data-i="${i}"]`).focus();
    return;
  }
  const d = { ArrowLeft: [-0.045, 0], ArrowRight: [0.045, 0], ArrowUp: [0, -0.045], ArrowDown: [0, 0.045] }[
    e.key
  ];
  if (!d) return;
  e.preventDefault();
  const p = state.points[i];
  movePoint(i, p[0] + d[0], p[1] + d[1]);
  wheel.querySelector(`[data-i="${i}"]`).focus();
});
