"use strict";
/**
 * 02-state.js — shared mutable state and tiny helpers.
 * state: current design settings; model: last computed building model; pending: scheduled-update handle.
 * $: getElementById, fmt: rounded locale number, clamp: limit to range, mod: true modulo, signed: +/- number text.
 */
let state = defaults(),
  model = null,
  pending = 0;
const $ = (id) => document.getElementById(id),
  fmt = (n) => Math.round(n).toLocaleString("en-US"),
  clamp = (x, a, b) => Math.max(a, Math.min(b, x)),
  mod = (x, n) => ((x % n) + n) % n,
  signed = (n) => (n > 0 ? "+" : "") + fmt(n);
