"use strict";
/**
 * 01-config.js — static configuration.
 * Program definitions, global constants, default design state and room-size rules.
 * All dimensions are in metres and all floor areas in square metres.
 */
// The five programs that make up the 20,000 m² project.
// id/name/short: identity; goal: target gross floor area (m²); color: display colour;
// split: default % of the goal placed in the central core (the rest goes into modular pods);
// pos: default position on the normalised topology map (-1..1 on both axes).
// PROGRAM AND STATE — all dimensions in meters, floor areas in square meters.
const PROGRAMS = [
  {
    id: "rinse",
    name: "Infinite Rinse",
    short: "IR",
    goal: 7500,
    color: "#72a9c8",
    split: 80,
    pos: [0.0, -0.7],
  },
  { id: "love", name: "Love hotel", short: "LH", goal: 8000, color: "#d681a7", split: 35, pos: [0.65, -0.1] },
  {
    id: "fire",
    name: "Marine firehall",
    short: "FH",
    goal: 1500,
    color: "#d46f62",
    split: 75,
    pos: [-0.67, -0.18],
  },
  { id: "day", name: "Daycare", short: "DC", goal: 1000, color: "#e0bb62", split: 40, pos: [0.05, 0.69] },
  {
    id: "senior",
    name: "Senior care",
    short: "SC",
    goal: 2000,
    color: "#8bb28a",
    split: 35,
    pos: [-0.4, 0.47],
  },
];
// Pseudo-program used for leftover floor space; P is the full list incl. UNASSIGNED (index 5 = UNUSED).
// EMPTY marks an unoccupied module slot, TAU is a full turn in radians.
// MODULE is the prefabricated pod: 4.5 m wide x 18 m deep, 3.5 m tall in this model, 81 m² footprint.
// defaults() returns a fresh copy of every user-adjustable setting (used on start and on Reset design):
//   core/geometry (autoCore, floors, footprint, ringWidth, lobby, areaCap, minRoomArea, corridorWidth),
//   modules (modules, vacancy shares), topology (affinity, points, relations, cluster, mix, seed),
//   view toggles (roof, grid, supports, show*, xray, inspect, animateSwing),
//   features (slideLength, climbWidth) and simulation / scoring (sim*, visitorCount, encounterWeights, *Bonus).
const UNASSIGNED = { id: "unused", name: "Unassigned", short: "—", goal: 0, color: "#c4c9c2" },
  P = [...PROGRAMS, UNASSIGNED],
  EMPTY = -1,
  UNUSED = 5,
  TAU = 2 * Math.PI,
  MODULE = { width: 4.5, depth: 18, height: 3.5, area: 81 },
  defaults = () => ({
    autoCore: true,
    floors: 4,
    footprint: 4700,
    ringWidth: 10,
    modules: 110,
    affinity: 70,
    seed: 606,
    split: PROGRAMS.map((p) => p.split),
    points: PROGRAMS.map((p) => p.pos.slice()),
    roof: true,
    grid: true,
    supports: true,
    showModules: true,
    showPeople: true,
    showAnimals: true,
    inspect: 0,
    mix: 65,
    vacancy: [25, 30, 30, 15],
    slideLength: 40,
    climbWidth: 10,
    lobby: 240,
    relations: {},
    corridorWidth: 2.4,
    areaCap: 20000,
    xray: false,
    showRooms: true,
    showRoofDeck: true,
    showFacade: true,
    animateSwing: true,
    minRoomArea: 80,
    cluster: [false, false, false, false, false],
    simRunning: true,
    simSpeed: 3,
    visitorCount: 36,
    encounterWeights: {
      hub: 5,
      room: 3,
      garden: 2.5,
      plaza: 2.5,
      balcony: 2.5,
      greenhouse: 2.5,
      roof: 2,
      ride: 2.5,
      corridor: 0.5,
    },
    memoryBonus: 1.5,
    programBonus: 1.2,
    funBonus: 1.4,
    speciesBonus: 1.3,
  });
// How unoccupied module slots can be used. 'retail' counts as enclosed floor area; the others do not.
const VACANCY = [
  { id: "empty", name: "Empty", color: "#d1d6ce" },
  { id: "balcony", name: "Public balcony", color: "#a8bbc2" },
  { id: "garden", name: "Community garden", color: "#548b57" },
  { id: "retail", name: "Commercial / retail", color: "#ad91c7" },
];
// Thickness of the exterior wall (m) and a helper that limits it for narrow rings.
// Conceptual gross room / zone area ranges; not code minima. Large rooms may be subdivided later.
const OUTER_WALL_THICKNESS = 0.5;
const facadeThickness = (m) => Math.min(OUTER_WALL_THICKNESS, m.width * 0.45);
// [min, max] preferred room area (m²) per program index 0-5 (the last row is for unassigned space).
// Preferred gross program-zone sizes. The global minimum is enforced by the packing pass.
const ROOM_RANGES = [
  [150, 540],
  [80, 210],
  [120, 360],
  [100, 240],
  [80, 210],
  [80, 240],
];
// Preferred [min, max] area for a room of program `id`, never below the user's minimum room area.
function roomRange(id) {
  const lo = Math.max(state.minRoomArea, ROOM_RANGES[id][0]);
  return [lo, Math.max(lo * 1.65, ROOM_RANGES[id][1])];
}
// Usable area left in a facade room (arc `q`) if the water slide forces an inner bypass corridor around it.
function detourRoomArea(q, R, c) {
  const depth = q.R - q.r,
    w = Math.min(c.width, depth * 0.45),
    side = Math.min(c.width / Math.max(1, q.R), (q.end - q.start) * 0.21);
  return ((R * R - (q.r + w) ** 2) * Math.max(0, q.end - q.start - 2 * side)) / 2;
}

