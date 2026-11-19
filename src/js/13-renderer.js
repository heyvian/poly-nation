"use strict";
/**
 * 13-renderer.js — drawing and camera.
 * WebGL path (initGL, upload, draw), a software canvas fallback (initSoftware, drawSoftware), the swing-ride
 * animation and orbit/zoom input handling.
 */
// Sets up the 2D canvas fallback when WebGL is not available.
// SOFTWARE FALLBACK — same 3D vertices and orbit camera, depth-sorted orthographic drawing.
function initSoftware() {
  let c = canvas,
    ctx = null;
  try {
    ctx = c.getContext("2d");
  } catch {}
  if (!ctx) {
    c = document.createElement("canvas");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.after(c);
    ctx = c.getContext("2d");
  }
  if (!ctx) {
    $("error").style.display = "block";
    $("error").textContent = "No supported drawing context. The program calculations remain available.";
    return;
  }
  software = { canvas: c, ctx };
}
// Software renderer: projects triangles, sorts them back to front and paints them with simple shading.
function drawSoftware() {
  if (!software || !softwareMesh) return;
  const m = softwareMesh,
    { canvas: c, ctx } = software,
    dpr = Math.min(2, window.devicePixelRatio || 1),
    w = Math.max(1, Math.round(canvas.clientWidth * dpr)),
    h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  ctx.fillStyle = "#e4e8df";
  ctx.fillRect(0, 0, w, h);
  const el = camera.el,
    az = camera.az,
    back = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
    right = unit(cross([0, 1, 0], back)),
    up = unit(cross(back, right)),
    aspect = w / h,
    half =
      Math.max(m.extent * 1.23, (m.extent * 1.23) / aspect, camera.el > 1.4 ? 0 : m.H * 0.68) * camera.zoom,
    scale = h / (half * 2),
    target = [0, m.H * 0.47, 0];
  function project(p) {
    return [
      w / 2 + (p[0] * right[0] + (p[1] - target[1]) * right[1] + p[2] * right[2]) * scale,
      h / 2 - (p[0] * up[0] + (p[1] - target[1]) * up[1] + p[2] * up[2] - camera.pan) * scale,
      p[0] * back[0] + (p[1] - target[1]) * back[1] + p[2] * back[2],
    ];
  }
  function point(a, i) {
    return project([a[i], a[i + 1], a[i + 2]]);
  }
  function color(a, i, shade = 1) {
    return `rgba(${Math.round(255 * a[i + 6] * shade)},${Math.round(255 * a[i + 7] * shade)},${Math.round(255 * a[i + 8] * shade)},${a[i + 9]})`;
  }
  const paint = [],
    sun = unit([-0.4, 1, 0.65]);
  function tris(a, start = 0) {
    for (let i = start; i < a.length; i += 30) {
      const p = point(a, i),
        q = point(a, i + 10),
        r = point(a, i + 20);
      const normal = [a[i + 3], a[i + 4], a[i + 5]];
      if (a[i + 9] === 1 && dot(normal, back) < 0.00001) continue;
      const shade = 0.74 + 0.26 * Math.abs(dot(normal, sun));
      paint.push({ z: (p[2] + q[2] + r[2]) / 3, pts: [p, q, r], fill: color(a, i, shade), alpha: a[i + 9] });
    }
  }
  function lineDraw(p, q, col) {
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.65, dpr * 0.7);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  }
  // ground plane first, ground grid behind the model
  for (let i = 0; i < m.lines.length; i += 20) {
    if (m.lines[i + 1] < 0) {
      lineDraw(point(m.lines, i), point(m.lines, i + 10), color(m.lines, i));
    } else {
      const p = point(m.lines, i),
        q = point(m.lines, i + 10);
      paint.push({ z: (p[2] + q[2]) / 2 + 0.02, pts: [p, q], stroke: color(m.lines, i) });
    }
  }
  tris(m.solid, 60);
  tris(m.glass);
  if (m.population) {
    tris(m.population.solid);
    const a = m.population.lines;
    for (let i = 0; i < a.length; i += 20) {
      const p = point(a, i),
        q = point(a, i + 10);
      paint.push({ z: (p[2] + q[2]) / 2 + 0.02, pts: [p, q], stroke: color(a, i) });
    }
  }
  paint.sort((a, b) => a.z - b.z);
  for (const t of paint) {
    if (t.stroke) {
      lineDraw(t.pts[0], t.pts[1], t.stroke);
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    ctx.lineTo(t.pts[1][0], t.pts[1][1]);
    ctx.lineTo(t.pts[2][0], t.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = t.fill;
    ctx.fill();
    if (t.alpha === 1) {
      ctx.strokeStyle = t.fill;
      ctx.lineWidth = 0.65 * dpr;
      ctx.stroke();
    }
  }
}

// Compiles the shaders and creates the WebGL program; falls back to software if anything fails.
function initGL() {
  if (!gl) {
    initSoftware();
    return;
  }
  const v = `attribute vec3 aPosition;attribute vec3 aNormal;attribute vec4 aColor;uniform vec3 uTarget,uRight,uUp,uBack;uniform vec2 uScale;uniform float uDepth;varying vec4 vColor;void main(){vec3 p=aPosition-uTarget;gl_Position=vec4(dot(p,uRight)*uScale.x,dot(p,uUp)*uScale.y,-dot(p,uBack)/uDepth,1.0);float valid=step(.1,length(aNormal));float shade=.74+.26*abs(dot(normalize(aNormal+vec3(.00001)),normalize(vec3(-.4,1.,.65))));vColor=vec4(aColor.rgb*mix(1.,shade,valid),aColor.a);}`;
  const f = `precision mediump float;varying vec4 vColor;void main(){gl_FragColor=vColor;}`;
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  try {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, v));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, f));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    const at = {};
    for (const name of ["aPosition", "aNormal", "aColor"]) at[name] = gl.getAttribLocation(p, name);
    const u = {};
    for (const name of ["uTarget", "uRight", "uUp", "uBack", "uScale", "uDepth"])
      u[name] = gl.getUniformLocation(p, name);
    gpu = {
      p,
      at,
      u,
      buffers: { solid: gl.createBuffer(), lines: gl.createBuffer(), glass: gl.createBuffer() },
      lengths: {},
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.914, 0.932, 0.908, 1);
  } catch (e) {
    gl = null;
    initSoftware();
  }
}
// Swing ride animation: only the rotating crown and seat vertices are rewritten each frame.
// Ride animation uses only the rotating crown and seat vertex ranges. Static model and exported geometry remain unchanged.
let swingAngle = 0,
  swingLast = 0,
  swingDrawLast = 0;
// Finds and copies the swing vertices so they can be rotated.
function prepareSwingMesh(mesh) {
  const i = mesh.groups.findIndex((g) => g.layer === "Swing_Crown_and_Seats");
  mesh.swingParts = [];
  if (i < 0) return;
  const g = mesh.groups[i],
    next = mesh.groups[i + 1];
  for (const kind of ["solid", "lines"]) {
    const start = g[kind],
      end = next ? next[kind] : mesh[kind].length;
    if (end > start)
      mesh.swingParts.push({
        kind,
        start,
        base: new Float32Array(mesh[kind].slice(start, end)),
        rotated: new Float32Array(end - start),
      });
  }
  rotateSwingMesh(mesh, false);
}
// Rotates those vertices by the current swing angle and sends them to the GPU/software mesh.
function rotateSwingMesh(mesh, sendGPU) {
  const c = Math.cos(swingAngle),
    s = Math.sin(swingAngle);
  for (const part of mesh.swingParts || []) {
    const { kind, start, base, rotated } = part,
      a = mesh[kind];
    for (let i = 0; i < base.length; i += 10) {
      rotated.set(base.subarray(i, i + 10), i);
      rotated[i] = c * base[i] - s * base[i + 2];
      rotated[i + 2] = s * base[i] + c * base[i + 2];
      rotated[i + 3] = c * base[i + 3] - s * base[i + 5];
      rotated[i + 5] = s * base[i + 3] + c * base[i + 5];
    }
    for (let i = 0; i < rotated.length; i++) a[start + i] = rotated[i];
    if (sendGPU && gl && gpu) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[kind]);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, rotated);
    }
  }
}
// Animation loop: advances the swing, ticks the simulation and redraws every frame.
function animateSwingFrame(now) {
  const dt = swingLast ? Math.max(0, (now - swingLast) / 1000) : 0;
  swingLast = now;
  const mesh = software ? softwareMesh : gpu?.mesh;
  if (mesh && !document.hidden) {
    let changed = false;
    if (state.animateSwing && !state.inspect && mesh.swingParts?.length) {
      const ride = model.feature.ride;
      swingAngle = (swingAngle + (dt * (ride.speedKmh / 3.6)) / ride.flightRadius) % TAU;
      if (now - swingDrawLast >= (software ? 130 : 16)) {
        swingDrawLast = now;
        rotateSwingMesh(mesh, !software);
        changed = true;
      }
    }
    if (occupancy && state.simRunning && now - simDrawLast >= (software ? 180 : 45)) {
      const elapsed = simLast ? Math.min(0.6, (now - simLast) / 1000) : 0;
      simLast = now;
      simDrawLast = now;
      tickOccupancy(elapsed);
      refreshPopulation();
      changed = true;
    } else if (!state.simRunning) simLast = now;
    if (changed) draw();
  }
  requestAnimationFrame(animateSwingFrame);
}
// Sends model m to the active renderer: (re)creates the simulation if the model or visitor count changed, builds the mesh and uploads it.
function upload(m) {
  if (
    !occupancy ||
    occupancy.m !== m ||
    (occupancy.people.length !== state.visitorCount && occupancy.graph.entry != null)
  ) {
    occupancy = makeOccupancy(m);
    simLast = 0;
  }
  if (software) {
    softwareMesh = buildMesh(m);
    prepareSwingMesh(softwareMesh);
    refreshPopulation();
    drawSoftware();
    return;
  }
  if (!gl || !gpu) return;
  const mesh = buildMesh(m);
  prepareSwingMesh(mesh);
  gpu.mesh = mesh;
  for (const k of ["solid", "lines", "glass"]) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[k]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh[k]), gl.STATIC_DRAW);
    gpu.lengths[k] = mesh[k].length / 10;
  }
  refreshPopulation();
  draw();
}
// Draws one frame with the current camera.
function draw() {
  if (software) {
    drawSoftware();
    return;
  }
  if (!gl || !gpu || !gpu.mesh) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1),
    w = Math.max(1, Math.round(canvas.clientWidth * dpr)),
    h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(gpu.p);
  const el = camera.el,
    az = camera.az,
    back = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)],
    right = unit(cross([0, 1, 0], back)),
    up = unit(cross(back, right)),
    aspect = w / h,
    extent = gpu.mesh.extent,
    half =
      Math.max(extent * 1.23, (extent * 1.23) / aspect, camera.el > 1.4 ? 0 : gpu.mesh.H * 0.68) *
      camera.zoom;
  const u = gpu.u;
  gl.uniform3fv(u.uTarget, [up[0] * camera.pan, gpu.mesh.H * 0.47 + up[1] * camera.pan, up[2] * camera.pan]);
  gl.uniform3fv(u.uRight, right);
  gl.uniform3fv(u.uUp, up);
  gl.uniform3fv(u.uBack, back);
  gl.uniform2f(u.uScale, 1 / (half * aspect), 1 / half);
  gl.uniform1f(u.uDepth, 500);
  function batch(k, mode) {
    if (!gpu.lengths[k]) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[k]);
    for (const [key, size, offset] of [
      ["aPosition", 3, 0],
      ["aNormal", 3, 12],
      ["aColor", 4, 24],
    ]) {
      gl.enableVertexAttribArray(gpu.at[key]);
      gl.vertexAttribPointer(gpu.at[key], size, gl.FLOAT, false, 40, offset);
    }
    gl.drawArrays(mode, 0, gpu.lengths[k]);
  }
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);
  batch("solid", gl.TRIANGLES);
  batch("agent_solid", gl.TRIANGLES);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  batch("lines", gl.LINES);
  batch("agent_lines", gl.LINES);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  batch("glass", gl.TRIANGLES);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
// Pointer input: left drag / one finger orbits, right drag pans vertically, mouse wheel or two-finger pinch zooms.
// Target-locked orbit, elevation excludes below-grade views, no pan.
const touches = new Map();
let pinch = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, [e.clientX, e.clientY, e.button === 2]);
  if (touches.size === 2) {
    const [a, b] = touches.values();
    pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  const old = touches.get(e.pointerId);
  touches.set(e.pointerId, [e.clientX, e.clientY, old[2]]);
  if (touches.size === 2) {
    const [a, b] = touches.values(),
      dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch > 0 && dist > 0) camera.zoom = clamp((camera.zoom * pinch) / dist, 0.06, 3);
    pinch = dist;
  } else if (touches.size === 1 && old[2]) {
    const mesh = softwareMesh || gpu?.mesh,
      span = mesh
        ? Math.max(
            mesh.extent * 1.23,
            (mesh.extent * 1.23) / (canvas.clientWidth / canvas.clientHeight),
            mesh.H * 0.8,
          )
        : 100;
    camera.pan = clamp(
      camera.pan + ((e.clientY - old[1]) * 2 * span * camera.zoom) / Math.max(1, canvas.clientHeight),
      -180,
      180,
    );
  } else if (touches.size === 1) {
    camera.az += 0.009 * (e.clientX - old[0]);
    camera.el = clamp(camera.el + 0.008 * (e.clientY - old[1]), 0, Math.PI / 2 - 0.012);
  }
  draw();
  queueSave();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(ev, (e) => {
    touches.delete(e.pointerId);
    pinch = 0;
  });
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camera.zoom = clamp(camera.zoom * Math.exp(e.deltaY * 0.001), 0.06, 3);
    draw();
    queueSave();
  },
  { passive: false },
);
new ResizeObserver(draw).observe(canvas);
// Camera presets: 3D (axonometric), Plan (top), Side (ground level) and Fit (reset zoom/pan).
$("axo").onclick = () => {
  camera.az = -0.84;
  camera.el = 0.57;
  draw();
  queueSave();
};
$("plan").onclick = () => {
  camera.az = -Math.PI / 2;
  camera.el = Math.PI / 2 - 0.012;
  draw();
  queueSave();
};
$("side").onclick = () => {
  camera.el = 0;
  draw();
  queueSave();
};
$("fit").onclick = () => {
  camera.zoom = 1;
  camera.pan = 0;
  draw();
  queueSave();
};
