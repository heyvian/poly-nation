'use strict';

// Render the current occupants as separate dynamic geometry so animation does not rebuild the architecture.
function makePopulationMesh() {
  const b = meshBuilder();
  if (!occupancy) return b;
  const g = occupancy.graph,
    cut = !state.inspect ? Infinity : buildStorey(model, state.inspect - 1).soffit,
    roofVisible = !state.inspect && state.showRoofDeck && !state.xray;
  for (const a of [...occupancy.people, ...occupancy.animals]) {
    if (!a.active || (a.kind === 'human' ? !state.showPeople : !state.showAnimals)) continue;
    const [x, y, z] = a.p;
    if (y >= cut || (!roofVisible && y >= g.roofLevel * g.floorHeight)) continue;
    if (a.kind === 'human') {
      if (a.rideSeat != null) {
        const h = a.style.h || 1.68,
          co = rgb(a.style.cloth || '#7e97b8'),
          sk = rgb(a.style.skin || '#d9b28b');
        b.box(x, y, z, 0.34, 0.45 * h, 0.22, a.angle, co);
        b.box(
          x + 0.19 * Math.cos(a.angle),
          y - 0.23,
          z + 0.19 * Math.sin(a.angle),
          0.32,
          0.45,
          0.19,
          a.angle,
          rgb('#555b60')
        );
        b.box(x, y + 0.45 * h, z, 0.2, 0.22, 0.2, a.angle, sk);
      } else if (a.wheelchair) lowPolyWheelchair(b.box, b.quad, b.tri, x, y, z, a.angle, a.style);
      else lowPolyPerson(b.box, x, y, z, a.angle, a.style);
    } else if (a.kind === 'dog') lowPolyDog(b.box, x, y, z, a.angle, a.style);
    else if (a.kind === 'bird') {
      const flight = a.path
        ? Math.min(2.1, 0.7 + Math.abs(Math.sin((occupancy.clock || 0) * 2 + a.i)) * 0.9)
        : 0.02;
      lowPolyBird(b.box, x, y + flight, z, a.angle, a.style);
    } else if (a.kind === 'rabbit') lowPolyRabbit(b.box, x, y, z, a.angle, a.style);
    else lowPolySquirrel(b.box, x, y, z, a.angle, a.style);
  }
  return b;
}
function refreshPopulation() {
  const mesh = software ? softwareMesh : gpu?.mesh;
  if (!mesh || !occupancy) return;
  const b = makePopulationMesh();
  mesh.population = b;
  if (!software && gpu) {
    for (const k of ['solid', 'lines']) {
      const name = 'agent_' + k;
      if (!gpu.buffers[name]) gpu.buffers[name] = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[name]);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b[k]), gl.DYNAMIC_DRAW);
      gpu.lengths[name] = b[k].length / 10;
    }
  }
  $('simPeople').textContent = occupancy.people.filter((a) => a.active).length;
  $('simAnimals').textContent = occupancy.animals.filter((a) => a.active).length;
  $('simGather').textContent = occupancy.gather;
  $('simFun').textContent = occupancy.fun;
  renderCrossScore();
}

// SOFTWARE FALLBACK — same 3D vertices and orbit camera, depth-sorted orthographic drawing.
function createSoftwareRenderer(target) {
  let c = target,
    ctx = null;
  try {
    ctx = c.getContext('2d');
  } catch {}
  if (!ctx) {
    c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    target.after(c);
    ctx = c.getContext('2d');
  }
  return ctx ? { canvas: c, ctx } : null;
}
function initSoftware() {
  software = createSoftwareRenderer(canvas);
  if (!software) {
    $('error').style.display = 'block';
    $('error').textContent =
      'No supported drawing context. The program calculations remain available.';
  }
}
function drawSoftware() {
  if (!software || !softwareMesh) return;
  paintSoftware(softwareMesh, software, camera, canvas);
}

const PROGRAM_PREVIEW_TINT = [0.99, 0.76, 0.22, 0.82];
const softwareInk = (color, opacity = 1) => `rgba(${color.join(',')},${opacity})`;

// Detailed furniture needs per-pixel depth in the canvas fallback. A triangle's
// centre can otherwise sort in front of the adjacent cushion, shelving or rug.
function paintSoftwareWithDepth(ctx, paint, width, height, scale, lineDraw) {
  const depth = new Float32Array(width * height).fill(-Infinity);
  let pixels = ctx.getImageData(0, 0, width, height);
  const face = ({ pts: [a, b, c], fill, alpha }) =>
    rasterDrawingFace(depth, width, height, a, b, c, pixels.data, fill, null, 0, null, alpha);
  for (const triangle of paint) if (triangle.alpha === 1) face(triangle);
  ctx.putImageData(pixels, 0, 0);

  for (const {
    pts: [a, b],
    stroke
  } of paint) {
    if (!stroke) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    let start = null;
    for (let i = 0; i <= steps; i++) {
      const point = a.map((value, j) => value + ((b[j] - value) * i) / steps),
        [x, y, z] = point,
        col = Math.floor(x),
        row = Math.floor(y),
        visible =
          col >= 0 &&
          col < width &&
          row >= 0 &&
          row < height &&
          z + 0.7 / scale >= depth[row * width + col];
      if (visible && !start) start = point;
      if (start && (!visible || i === steps)) {
        lineDraw(start, point, softwareInk(stroke));
        start = null;
      }
    }
  }

  const glass = paint.filter(({ alpha }) => alpha > 0 && alpha < 1);
  if (!glass.length) return;
  // Blend glazing from far to near against the opaque depth. Glass leaves that depth intact.
  pixels = ctx.getImageData(0, 0, width, height);
  for (const triangle of glass) face(triangle);
  ctx.putImageData(pixels, 0, 0);
}

function paintSoftware(
  m,
  { canvas: c, ctx },
  camera,
  viewport = c,
  dpr = Math.min(2, window.devicePixelRatio || 1)
) {
  const w = Math.max(1, Math.round(viewport.clientWidth * dpr)),
    h = Math.max(1, Math.round(viewport.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const sky = m.renderLighting && Math.round(43 + 191 * m.renderLighting.daylight);
  ctx.fillStyle = m.renderLighting ? `rgb(${sky * 0.97},${sky},${sky * 1.03})` : '#e4e8df';
  ctx.fillRect(0, 0, w, h);
  const { back, right, up, target, half } = modelProjection(m, camera, w / h),
    scale = h / (half * 2);
  function point(a, i) {
    const x = a[i] - target[0],
      y = a[i + 1] - target[1],
      z = a[i + 2] - target[2];
    return [
      w / 2 + (x * right[0] + y * right[1] + z * right[2]) * scale,
      h / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale,
      x * back[0] + y * back[1] + z * back[2]
    ];
  }
  function color(a, i, shade = 1, highlight = 0) {
    const preview = m.programPreview;
    if (a === m.solid && preview && i >= preview.start && i < preview.end) {
      const tint = PROGRAM_PREVIEW_TINT;
      return tint
        .slice(0, 3)
        .map((channel, j) =>
          Math.round(255 * (a[i + 6 + j] * shade * (1 - tint[3]) + channel * tint[3]))
        );
    }
    const channel = (offset) =>
      Math.round(255 * (a[i + offset] * shade * (1 - highlight) + highlight));
    return [channel(6), channel(7), channel(8)];
  }
  const paint = [],
    sun = unit([-0.4, 1, 0.65]),
    reflection = unit(sun.map((value, i) => value + back[i]));
  function tris(a, start = 0) {
    for (let i = start; i < a.length; i += 30) {
      const p = point(a, i),
        q = point(a, i + 10),
        r = point(a, i + 20);
      const normal = [a[i + 3], a[i + 4], a[i + 5]];
      if (a[i + 9] >= 1 && dot(normal, back) < 0.00001) continue;
      const shade = 0.74 + 0.26 * Math.abs(dot(normal, sun));
      const highlight =
        a[i + 9] > 1 ? (a[i + 9] - 1) * Math.max(0, dot(normal, reflection)) ** 14 : 0;
      let fill = color(a, i, shade, highlight);
      if (m.renderLighting) {
        const center = [0, 1, 2].map(axis => (a[i + axis] + a[i + 10 + axis] + a[i + 20 + axis]) / 3),
          light = renderSurfaceLight(m.renderLighting, ...center);
        fill = fill.map((channel, index) => Math.round(clamp(channel * light[index], 0, 255)));
      }
      paint.push({
        z: (p[2] + q[2] + r[2]) / 3,
        pts: [p, q, r],
        fill,
        alpha: Math.min(1, a[i + 9])
      });
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
      lineDraw(point(m.lines, i), point(m.lines, i + 10), softwareInk(color(m.lines, i)));
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
  if (m.groups.some(({ layer }) => layer.endsWith('_Shared_Furniture'))) {
    paintSoftwareWithDepth(ctx, paint, w, h, scale, lineDraw);
    return;
  }
  for (const t of paint) {
    if (t.stroke) {
      lineDraw(t.pts[0], t.pts[1], softwareInk(t.stroke));
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(t.pts[0][0], t.pts[0][1]);
    ctx.lineTo(t.pts[1][0], t.pts[1][1]);
    ctx.lineTo(t.pts[2][0], t.pts[2][1]);
    ctx.closePath();
    const fill = softwareInk(t.fill, t.alpha);
    ctx.fillStyle = fill;
    ctx.fill();
    if (t.alpha === 1) {
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.65 * dpr;
      ctx.stroke();
    }
  }
}

// Set up reusable depth-tested rendering for the massing and Materials canvases.
function createWebGLRenderer(gl) {
  if (!gl) return null;
  const v = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec4 aColor;
    uniform vec3 uTarget,uRight,uUp,uBack;
    uniform vec2 uScale;
    uniform float uDepth;
    uniform vec4 uTint;
    varying vec4 vColor;
    varying mediump vec3 vWorld;
    void main() {
      vWorld = aPosition;
      vec3 p = aPosition - uTarget;
      gl_Position = vec4(dot(p,uRight)*uScale.x, dot(p,uUp)*uScale.y, -dot(p,uBack)/uDepth, 1.0);
      vec3 n = normalize(aNormal + vec3(.00001));
      vec3 sun = normalize(vec3(-.4,1.,.65));
      float shade = .74 + .26 * abs(dot(n, sun));
      vec3 base = aColor.rgb * mix(1., shade, step(.1, length(aNormal)));
      // Opaque surfaces can store sheen above 1.0 without changing the vertex format or blend.
      float gloss = max(0., aColor.a - 1.);
      float highlight = gloss * pow(max(0., dot(n, normalize(sun + uBack))), 14.);
      vColor = vec4(mix(mix(base, vec3(1.), highlight), uTint.rgb, uTint.a), min(aColor.a, 1.));
    }`;
  const f = `
    precision mediump float;
    varying vec4 vColor;
    varying mediump vec3 vWorld;
    uniform sampler2D uLightField;
    uniform vec4 uLightGeometry, uLightData, uLightControls;
    void main() {
      vec3 ink = vColor.rgb;
      if (uLightControls.x > 0.) {
        float r = length(vWorld.xz);
        float y = vWorld.y;
        float base = uLightGeometry.z;
        float top = uLightGeometry.w;
        float depth = clamp((y - base) / (top - base), 0., 1.);
        float rim = clamp((r - uLightGeometry.x + 1.) / 9., 0., 1.);
        bool outside = r > uLightGeometry.y + .06;
        float sky = (y < base - .12 || y > top - .03 || outside)
          ? 1. : (.44 + .49 * depth) * (1. - .86 * rim);
        float level = floor((y - base + .045) / uLightData.y);
        vec2 uv = .5 + vWorld.xz / (2. * uLightData.x);
        float pool = 0.;
        if (!outside && level >= 0. && level < uLightData.z && y < top - .05) {
          float edge = .5 / uLightData.w;
          uv.y = (clamp(uv.y, edge, 1. - edge) + level) / uLightData.z;
          pool = texture2D(uLightField, uv).r;
        }
        float daylight = uLightControls.y;
        float natural = .14 + daylight * (.11 + (.89 + .19 * depth) * sky);
        ink *= vec3(natural) + vec3(.86, .58, .32) * pool * uLightControls.z;
      }
      gl_FragColor = vec4(ink, vColor.a);
    }`;
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
    for (const name of ['aPosition', 'aNormal', 'aColor']) at[name] = gl.getAttribLocation(p, name);
    const u = {};
    for (const name of ['uTarget', 'uRight', 'uUp', 'uBack', 'uScale', 'uDepth', 'uTint',
      'uLightField', 'uLightGeometry', 'uLightData', 'uLightControls'])
      u[name] = gl.getUniformLocation(p, name);
    const renderer = {
      p,
      at,
      u,
      buffers: { solid: gl.createBuffer(), lines: gl.createBuffer(), glass: gl.createBuffer() },
      lengths: {},
      lightField: gl.createTexture()
    };
    gl.bindTexture(gl.TEXTURE_2D, renderer.lightField);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.914, 0.932, 0.908, 1);
    return renderer;
  } catch {
    return null;
  }
}

function initGL() {
  gpu = createWebGLRenderer(gl);
  if (!gpu) {
    gl = null;
    initSoftware();
  }
}

function uploadWebGLMesh(gl, renderer, mesh) {
  renderer.mesh = mesh;
  const light = mesh.renderLighting;
  if (light && renderer.lightSource !== light) {
    renderer.lightSource = light;
    gl.bindTexture(gl.TEXTURE_2D, renderer.lightField);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, light.size, light.size * light.levels,
      0, gl.LUMINANCE, gl.UNSIGNED_BYTE, light.field);
  }
  for (const kind of ['solid', 'lines', 'glass']) {
    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.buffers[kind]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh[kind]), gl.STATIC_DRAW);
    renderer.lengths[kind] = mesh[kind].length / 10;
  }
}
// Ride animation uses only the rotating crown and seat vertex ranges. Static model and exported geometry remain unchanged.
let swingAngle = 0,
  swingLast = 0,
  swingDrawLast = 0,
  standaloneSwingClock = 0;
// Cache the geometry ranges that move with the crown and chairs.
function prepareSwingMesh(mesh) {
  const i = mesh.groups.findIndex((g) => g.layer === 'Swing_Crown_and_Seats');
  mesh.swingParts = [];
  if (i < 0) return;
  const g = mesh.groups[i],
    next = mesh.groups[i + 1];
  for (const kind of ['solid', 'lines']) {
    const start = g[kind],
      end = next ? next[kind] : mesh[kind].length;
    if (end > start) mesh.swingParts.push({ kind, start, length: end - start });
  }
  rotateSwingMesh(mesh, false);
}
// Update only the animated swing vertices using the shared ride pose.
function rotateSwingMesh(mesh, sendGPU) {
  if (!mesh.swingParts?.length || !model) return;
  const pose = swingPose(
      model.feature.ride,
      occupancy &&
        (state.simRunning || occupancy.people.some((a) => a.rideSeat != null || a.rideQueued))
        ? occupancy.clock
        : standaloneSwingClock
    ),
    b = meshBuilder();
  buildSwing(b, model.feature.ride, pose);
  for (const part of mesh.swingParts) {
    const { kind, start, length } = part;
    if (b[kind].length !== length) continue;
    const arr = b[kind],
      dst = mesh[kind];
    for (let i = 0; i < length; i++) dst[start + i] = arr[i];
    if (sendGPU && gl && gpu) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[kind]);
      gl.bufferSubData(gl.ARRAY_BUFFER, start * 4, new Float32Array(arr));
    }
  }
  const info = $('swingPhase');
  if (info)
    info.textContent = `${pose.phase} · ${Math.round(pose.speed)} km/h · ${Math.round(pose.t)} s / ${SWING_CYCLE_TOTAL} s`;
}
function animateSwingFrame(now) {
  const dt = swingLast ? Math.max(0, Math.min(0.6, (now - swingLast) / 1000)) : 0;
  swingLast = now;
  const mesh = software ? softwareMesh : gpu?.mesh;
  const showingModel = !$('massingPhase').hidden;
  if (mesh && !document.hidden) {
    let changed = false;
    // Keep simulation time running in the auxiliary views without drawing the hidden model.
    if (occupancy && state.simRunning && now - simDrawLast >= (software ? 180 : 45)) {
      const elapsed = simLast ? Math.min(0.6, (now - simLast) / 1000) : 0;
      simLast = now;
      simDrawLast = now;
      tickOccupancy(elapsed);
      standaloneSwingClock = occupancy.clock;
      if (showingModel) {
        refreshPopulation();
        changed = true;
      }
    } else if (!state.simRunning) simLast = now;
    if (
      showingModel &&
      (state.animateSwing || state.simRunning) &&
      !state.inspect &&
      mesh.swingParts?.length
    ) {
      if (!state.simRunning && !occupancy?.people.some((a) => a.rideSeat != null || a.rideQueued))
        standaloneSwingClock += dt;
      if (now - swingDrawLast >= (software ? 130 : 16)) {
        swingDrawLast = now;
        rotateSwingMesh(mesh, !software);
        changed = true;
      }
    }
    if (showingModel && mesh.craneMotion && craneTravelStage(state.craneStage) && !craneAnimation.paused &&
        now - craneAnimation.last >= (software ? 135 : 36)) {
      const elapsed = craneAnimation.last ? Math.min(0.25, (now - craneAnimation.last) / 1000) : 0;
      craneAnimation.last = now;
      animateCraneMotion(mesh, elapsed, gl, gpu);
      changed = true;
    }
    if (changed) draw();
  } else simLast = now;
  requestAnimationFrame(animateSwingFrame);
}
// Editing adds hit targets to the view, separate from the architectural model and exports.
let programEditing = false;
function massingView() {
  return programEditing
    ? {
        ...state,
        programEditing,
        showRooms: true,
        showModules: true,
        showFacade: false,
        showRoofDeck: false,
        roof: false
      }
    : state;
}

function syncProgrammingHint(model) {
  const missing =
    Object.keys(state.roomPrograms).length +
    Object.keys(state.modulePrograms).length -
    model.rooms.filter((room) => Object.hasOwn(state.roomPrograms, room.editKey)).length -
    model.slots.filter((slot) => slot.editKey).length;
  $('programEditHint').textContent =
    'Click a room, module, or green dock to assign its program.' +
    (missing > 0 ? ' ' + missing + ' saved edits have no matching location in this layout.' : '');
}

// Bounds skip unrelated mesh groups before testing triangles on each pointer move.
function prepareProgramTargets(mesh) {
  mesh.programTargets = [];
  for (const [i, group] of mesh.groups.entries()) {
    const start = group.solid,
      end = mesh.groups[i + 1]?.solid ?? mesh.solid.length;
    if (start === end || group.layer === 'Reference') continue;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let offset = start; offset < end; offset += 10)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], mesh.solid[offset + axis]);
        max[axis] = Math.max(max[axis], mesh.solid[offset + axis]);
      }
    mesh.programTargets.push({ start, end, min, max, pick: group.pick });
  }
}

function hitProgramBounds(origin, direction, target, nearest) {
  let enter = 0,
    exit = nearest;
  for (let axis = 0; axis < 3; axis++) {
    const start = origin[axis],
      step = direction[axis];
    if (Math.abs(step) < 1e-9) {
      if (start < target.min[axis] || start > target.max[axis]) return false;
      continue;
    }
    const a = (target.min[axis] - start) / step,
      b = (target.max[axis] - start) / step;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

function pickMassingLocation(clientX, clientY) {
  const mesh = softwareMesh || gpu?.mesh;
  if (!mesh?.programTargets) return null;
  const bounds = canvas.getBoundingClientRect();
  const aspect = bounds.width / bounds.height,
    { back, right, up, target, half } = modelProjection(mesh, camera, aspect);
  const x = ((2 * (clientX - bounds.left)) / bounds.width - 1) * half * aspect;
  const y = (1 - (2 * (clientY - bounds.top)) / bounds.height) * half;
  const origin = back.map((value, i) => target[i] + value * 500 + right[i] * x + up[i] * y);
  const direction = back.map((value) => -value);
  let nearest = Infinity,
    selection = null;
  const vertex = (offset) => mesh.solid.slice(offset, offset + 3);
  // Intersect the rendered surfaces so an opaque object can occlude an editable one.
  for (const target of mesh.programTargets) {
    if (!hitProgramBounds(origin, direction, target, nearest)) continue;
    for (let offset = target.start; offset < target.end; offset += 30) {
      const a = vertex(offset),
        b = sub(vertex(offset + 10), a),
        c = sub(vertex(offset + 20), a);
      const h = cross(direction, c),
        determinant = dot(b, h);
      if (Math.abs(determinant) < 1e-8) continue;
      const s = sub(origin, a),
        u = dot(s, h) / determinant;
      if (u < 0 || u > 1) continue;
      const q = cross(s, b),
        v = dot(direction, q) / determinant;
      if (v < 0 || u + v > 1) continue;
      const distance = dot(c, q) / determinant;
      if (distance >= 0 && distance < nearest) {
        nearest = distance;
        selection = target.pick ? target : null;
      }
    }
  }
  return selection;
}

// Test the edit on the full layout before changing the visible model, occupancy or saved settings.
function applyProgramEdit(selection, program) {
  const before = model;
  const original = state;
  const { room, slot } = selection;
  const adding = slot?.p === EMPTY;
  if (!Number.isInteger(program) || !PROGRAMS[program]) return 'Select a valid program.';
  if (slot?.blocked) return 'This dock is reserved for another building feature.';
  if (room?.id === program || slot?.p === program) return '';
  state = {
    ...state,
    roomPrograms: { ...state.roomPrograms },
    modulePrograms: { ...state.modulePrograms }
  };
  let key;
  if (room) {
    key = room.editKey;
    state.roomPrograms[key] = program;
  } else {
    key = slot.editKey || [before.slotN, slot.f, slot.j].join(':');
    const prior = state.modulePrograms[key];
    state.modulePrograms[key] = { program, from: prior ? prior.from : adding ? null : slot.p };
    if (adding) state.modules = Math.min(300, Math.max(state.modules, before.count + 1));
  }

  let error = '';
  let candidate;
  try {
    candidate = derive();
    const updatedRoom = room && candidate.rooms.find((entry) => entry.editKey === key);
    const updatedSlot = slot && candidate.slots.find((entry) => entry.editKey === key);
    if (adding && candidate.count <= before.count) {
      error = 'No additional module fits within the current area cap and dock reservations.';
    } else if (slot && program === FIREHALL && !updatedSlot) {
      error = 'This Firehall dock needs a compatible dock on each floor below it.';
    } else if (room ? updatedRoom?.id !== program : updatedSlot?.p !== program) {
      error = 'The selected location is unavailable in the recalculated layout.';
    } else if (
      before.rooms.some(
        (room) =>
          original.roomPrograms[room.editKey] !== undefined &&
          !candidate.rooms.some((next) => next.editKey === room.editKey)
      ) ||
      before.slots.some(
        (slot) => slot.editKey && !candidate.slots.some((next) => next.editKey === slot.editKey)
      )
    ) {
      error = 'This change would displace a room or module you already edited.';
    } else if (candidate.total > state.areaCap + 1e-5) {
      error = 'This edit would exceed the enclosed area cap.';
    } else if (
      candidate.repelConflicts > before.repelConflicts ||
      (updatedSlot && candidate.conflictingSlots.has(updatedSlot.i)) ||
      (updatedRoom &&
        candidate.rooms.some(
          (other) => programsRepel(program, other.id) && roomsAreNeighbors(updatedRoom, other)
        ))
    ) {
      error = 'That placement conflicts with a same-floor Repel relationship.';
    } else if (candidate.lobby.area) {
      const graph = buildNavigation(candidate);
      const node = updatedSlot
        ? graph.nodes.find((node) => node.slot === updatedSlot.i)
        : graph.nodes.find(
            (node) =>
              node.f === updatedRoom.f &&
              node.program === program &&
              node.cell?.start === updatedRoom.start
          );
      if (!node || graph.entry == null || !shortestPath(graph, graph.entry, node.id, 'human'))
        error = 'The edited space needs a reachable route from the entrance.';
    }
  } catch (e) {
    error = 'The solver could not fit this edit into the current layout.';
  }
  if (error) state = original;
  else update();
  return error;
}

function programLocationLabel({ room, slot }) {
  const program = P[room?.id ?? slot.p]?.name;
  const level = 'L' + ((room?.f ?? slot.f) + 1);
  if (room) return level + ' · Room ' + (model.rooms.indexOf(room) + 1) + ' · ' + program;
  return level + ' · Dock ' + (slot.j + 1) + ' · ' + (program || 'Available for a module');
}

function initProgrammingEditor() {
  const toggle = $('editProgramming');
  const dialog = $('programDialog');
  const programs = $('programChoice');
  const feedback = $('programFeedback');
  const label = $('programHoverLabel');
  let hoverFrame = 0;
  let hoverPoint = null;
  let selection = null;
  let pointerStart = null;
  PROGRAMS.forEach((program, id) => programs.add(new Option(program.name, id)));

  function clearHover() {
    hoverPoint = null;
    label.hidden = true;
    const mesh = softwareMesh || gpu?.mesh;
    if (mesh?.programPreview) {
      mesh.programPreview = null;
      draw();
    }
  }

  function scheduleHover(event) {
    if (!programEditing || event.pointerType === 'touch' || event.buttons || dialog.open) {
      clearHover();
      return;
    }
    hoverPoint = [event.clientX, event.clientY];
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!hoverPoint || !programEditing || dialog.open) return;
      const hit = pickMassingLocation(...hoverPoint);
      if (!hit) {
        clearHover();
        return;
      }
      const mesh = softwareMesh || gpu?.mesh;
      if (mesh.programPreview !== hit) {
        mesh.programPreview = hit;
        draw();
      }
      const bounds = canvas.getBoundingClientRect();
      label.textContent = programLocationLabel(hit.pick);
      label.hidden = false;
      const [x, y] = hoverPoint;
      label.style.left =
        Math.max(6, Math.min(x - bounds.left + 12, bounds.width - label.offsetWidth - 6)) + 'px';
      label.style.top =
        (y - bounds.top + label.offsetHeight + 16 < bounds.height
          ? y - bounds.top + 13
          : Math.max(6, y - bounds.top - label.offsetHeight - 10)) + 'px';
    });
  }

  function openEditor(pick) {
    clearHover();
    selection = { pick, model };
    const { room, slot } = pick;
    const id = room?.id ?? slot.p;
    $('programSelection').textContent = programLocationLabel(pick);
    programs.value = PROGRAMS[id] ? String(id) : '0';
    $('applyProgram').textContent = slot?.p === EMPTY ? 'Add module' : 'Apply program';
    feedback.textContent = '';
    dialog.showModal();
  }

  toggle.onclick = () => {
    clearHover();
    programEditing = !programEditing;
    toggle.setAttribute('aria-pressed', String(programEditing));
    $('programEditHint').hidden = !programEditing;
    $('orbitHint').hidden = programEditing;
    if (programEditing) syncProgrammingHint(model);
    canvas.classList.toggle('program-picking', programEditing);
    refreshView();
  };
  $('cancelProgram').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (!dialog.open) selection = null;
  });
  $('programForm').onsubmit = (event) => {
    event.preventDefault();
    // A recalculated model has new room and dock identities.
    if (!selection || pending || model !== selection.model) {
      feedback.textContent = 'The layout changed. Close this editor and select the location again.';
      return;
    }
    const error = applyProgramEdit(selection.pick, Number(programs.value));
    if (error) feedback.textContent = error;
    else dialog.close();
  };
  canvas.addEventListener('pointermove', scheduleHover);
  canvas.addEventListener('wheel', scheduleHover, { passive: true });
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('pointerdown', (event) => {
    clearHover();
    pointerStart =
      programEditing && event.isPrimary && event.button === 0
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
  });
  canvas.addEventListener('pointerup', (event) => {
    const start = pointerStart;
    pointerStart = null;
    if (
      !programEditing ||
      !start ||
      start.id !== event.pointerId ||
      Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5
    )
      return;
    // Pick against the latest layout if a field edit queued a rebuild.
    if (pending) {
      cancelAnimationFrame(pending);
      update();
    }
    const selected = pickMassingLocation(event.clientX, event.clientY);
    if (selected) openEditor(selected.pick);
  });
  canvas.addEventListener('pointercancel', () => {
    clearHover();
    pointerStart = null;
  });
}
// Replace model meshes and retain occupants for view-only changes that reuse the same derived model.
function upload(m) {
  if (
    !occupancy ||
    occupancy.m !== m ||
    (occupancy.people.length !== state.visitorCount && occupancy.graph.entry != null)
  ) {
    occupancy = makeOccupancy(m);
    simLast = 0;
  }
  $('programHoverLabel').hidden = true;
  const mesh = buildMesh(m, false, massingView());
  if (programEditing) prepareProgramTargets(mesh);
  if (software) {
    softwareMesh = mesh;
    prepareSwingMesh(softwareMesh);
    prepareCraneMotion(softwareMesh);
    refreshPopulation();
    drawSoftware();
    return;
  }
  if (!gl || !gpu) return;
  prepareSwingMesh(mesh);
  prepareCraneMotion(mesh);
  uploadWebGLMesh(gl, gpu, mesh);
  refreshPopulation();
  draw();
}
function draw() {
  if (software) {
    drawSoftware();
    return;
  }
  paintWebGL(canvas, gl, gpu, camera);
}

function paintWebGL(
  canvas,
  gl,
  gpu,
  camera,
  viewport = canvas,
  dpr = Math.min(2, window.devicePixelRatio || 1)
) {
  if (!gl || !gpu?.mesh) return;
  const w = Math.max(1, Math.round(viewport.clientWidth * dpr)),
    h = Math.max(1, Math.round(viewport.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const light = gpu.mesh.renderLighting;
  if (light) {
    const sky = 0.17 + 0.75 * light.daylight;
    gl.clearColor(sky * 0.97, sky, sky * 1.03, 1);
  }
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(gpu.p);
  const aspect = w / h,
    { back, right, up, target, half } = modelProjection(gpu.mesh, camera, aspect);
  const u = gpu.u;
  if (light) {
    gl.uniform4f(u.uLightControls, 1, light.daylight, light.interior, 0);
    gl.uniform4f(u.uLightGeometry, light.radius, light.outer, light.base, light.top);
    gl.uniform4f(u.uLightData, light.extent, light.pitch, light.levels, light.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.lightField);
    gl.uniform1i(u.uLightField, 0);
  }
  gl.uniform3fv(u.uTarget, target);
  gl.uniform3fv(u.uRight, right);
  gl.uniform3fv(u.uUp, up);
  gl.uniform3fv(u.uBack, back);
  gl.uniform2f(u.uScale, 1 / (half * aspect), 1 / half);
  // The district terrain extends well beyond the building-scale depth range.
  // Leave the smaller range in place for the closer assembly views.
  const { extent, H } = gpu.mesh,
    [pivotX, , pivotZ] = modelViewPivot(gpu.mesh),
    depth = Math.hypot(extent + Math.abs(pivotX), extent + Math.abs(pivotZ), H) + 32;
  gl.uniform1f(u.uDepth, Math.max(500, depth));
  gl.uniform4f(u.uTint, 0, 0, 0, 0);
  function batch(k, mode, offset = 0, count = gpu.lengths[k]) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffers[k]);
    for (const [key, size, offset] of [
      ['aPosition', 3, 0],
      ['aNormal', 3, 12],
      ['aColor', 4, 24]
    ]) {
      gl.enableVertexAttribArray(gpu.at[key]);
      gl.vertexAttribPointer(gpu.at[key], size, gl.FLOAT, false, 40, offset);
    }
    gl.drawArrays(mode, offset, count);
  }
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);
  const preview = gpu.mesh.programPreview;
  if (preview) {
    const start = preview.start / 10,
      end = preview.end / 10;
    batch('solid', gl.TRIANGLES, 0, start);
    gl.uniform4fv(u.uTint, PROGRAM_PREVIEW_TINT);
    batch('solid', gl.TRIANGLES, start, end - start);
    gl.uniform4f(u.uTint, 0, 0, 0, 0);
    batch('solid', gl.TRIANGLES, end, gpu.lengths.solid - end);
  } else batch('solid', gl.TRIANGLES);
  batch('agent_solid', gl.TRIANGLES);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  batch('lines', gl.LINES);
  batch('agent_lines', gl.LINES);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  batch('glass', gl.TRIANGLES);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}
const DETAIL_CAMERA_ZOOM = 0.012;

// Model canvases share pointer gestures and camera presets across workspaces.
function bindModelCamera({
  canvas, getCamera, getMesh, onChange, buttons, panLimit = 180,
  minimumZoom = 0.06, zoomToPointer = false
}) {
  const pointers = new Map();
  const topView = Math.PI / 2;
  function setZoom(camera, zoom, x, y) {
    const next = clamp(zoom, minimumZoom, 3),
      mesh = zoomToPointer && getMesh();
    if (mesh && next !== camera.zoom) {
      const { left, top, width, height } = canvas.getBoundingClientRect();
      const shift = 2 * baseViewHalf(mesh, camera, width / height) * (camera.zoom - next) / height;
      // Keep the point under the cursor or pinch midpoint at the same screen position.
      camera.panX = clamp((camera.panX ?? 0) + (x - left - width / 2) * shift, -panLimit, panLimit);
      camera.pan = clamp(camera.pan + (top + height / 2 - y) * shift, -panLimit, panLimit);
    }
    camera.zoom = next;
  }
  function pan(camera, dx, dy) {
    const height = Math.max(1, canvas.clientHeight),
      mesh = getMesh(),
      half = mesh ? baseViewHalf(mesh, camera, canvas.clientWidth / height) : 100,
      metresPerPixel = (2 * half * camera.zoom) / height;
    camera.panX = clamp((camera.panX ?? 0) - dx * metresPerPixel, -panLimit, panLimit);
    camera.pan = clamp(camera.pan + dy * metresPerPixel, -panLimit, panLimit);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (pointers.size === 2 || (event.button !== 0 && event.button !== 2)) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, pan: event.button === 2 });
  });
  canvas.addEventListener('pointermove', (event) => {
    const old = pointers.get(event.pointerId);
    if (!old) return;
    const next = { x: event.clientX, y: event.clientY, pan: old.pan },
      dx = next.x - old.x,
      dy = next.y - old.y,
      camera = getCamera();
    if (pointers.size === 2) {
      // Each event moves one finger, so the midpoint travels half that distance.
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1],
        before = Math.hypot(old.x - other.x, old.y - other.y),
        after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0 && after > 0)
        setZoom(camera, (camera.zoom * before) / after, (old.x + other.x) / 2, (old.y + other.y) / 2);
      pan(camera, dx / 2, dy / 2);
    } else if (old.pan) pan(camera, dx, dy);
    else {
      camera.az += 0.009 * dx;
      camera.el = clamp(camera.el + 0.008 * dy, 0, topView);
    }
    pointers.set(event.pointerId, next);
    onChange();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(type, (event) => pointers.delete(event.pointerId));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const camera = getCamera();
      setZoom(camera, camera.zoom * Math.exp(event.deltaY * 0.001), event.clientX, event.clientY);
      onChange();
    },
    { passive: false }
  );

  const views = {
    axo: (camera) => Object.assign(camera, { az: -0.84, el: 0.57 }),
    plan: (camera) => Object.assign(camera, { az: -Math.PI / 2, el: topView }),
    side: (camera) => {
      camera.el = 0;
    },
    fit: (camera) => fitModel(getMesh(), camera, canvas)
  };
  for (const [view, id] of Object.entries(buttons))
    $(id).onclick = () => {
      views[view](getCamera());
      onChange();
    };
}

bindModelCamera({
  canvas,
  getCamera: () => camera,
  getMesh: () => softwareMesh || gpu?.mesh,
  onChange: () => {
    draw();
    queueSave();
  },
  minimumZoom: DETAIL_CAMERA_ZOOM,
  zoomToPointer: true,
  buttons: { axo: 'axo', plan: 'plan', side: 'side', fit: 'fit' }
});
new ResizeObserver(draw).observe(canvas);
function warning(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}
const viewKeys = {
  viewXray: 'xray',
  viewRooms: 'showRooms',
  viewModules: 'showModules',
  viewFacade: 'showFacade',
  viewRoof: 'showRoofDeck',
  viewSwing: 'animateSwing',
  viewPeople: 'showPeople',
  viewAnimals: 'showAnimals',
  viewSim: 'simRunning'
};
for (const [id, key] of Object.entries(viewKeys))
  $(id).onclick = () => {
    state[key] = !state[key];
    refreshView();
    renderCrossScore();
  };
// Recalculate the model, synchronize the controls and readouts, and schedule an autosave.
function update() {
  pending = 0;
  const R = Math.sqrt(state.footprint / Math.PI);
  $('ringWidth').max = state.autoCore
    ? 35
    : Math.max(0.5, Math.min(35, Math.floor((R - 3) * 2) / 2));
  $('ringWidth').min = state.autoCore ? 5 : Math.min(5, +$('ringWidth').max);
  state.ringWidth = clamp(state.ringWidth, +$('ringWidth').min, +$('ringWidth').max);
  syncControls();
  for (const [id, key] of Object.entries(viewKeys))
    $(id).setAttribute('aria-pressed', String(state[key]));
  model = derive();
  if (state.allocationMoves.length && !model.allocationApplied) {
    state.allocationMoves = [];
    setOptimizationStatus('The updated design cleared the saved allocation exchanges.');
  }
  if (programEditing) syncProgrammingHint(model);
  refreshTrialDashboard();
  const m = model;
  refreshCraneControls(m);
  const c = m.feature.climbing,
    s = m.feature.slide;
  $('climbSize').textContent = c
    ? c.width.toFixed(1) + ' m × ' + c.height.toFixed(1) + ' m'
    : 'Off';
  $('climbBlocked').textContent = c ? c.blocked.size + ' slots' : '0 slots';
  $('climbClearance').textContent = s?.climbCrossing
    ? s.climbClearance.toFixed(1) + ' m (conceptual)'
    : c && s
      ? 'No crossing'
      : '—';
  $('roofPublic').textContent = fmt(m.roofPlan.publicArea) + ' m²';
  const twoStoreyPavilions = m.roofPlan.pavilions.filter((pavilion) => pavilion.upper).length;
  $('roofRetail').textContent =
    m.roofPlan.pavilions.length +
    ' / ' +
    fmt(m.roofPlan.retailArea) +
    ' m²' +
    (twoStoreyPavilions ? ' · ' + twoStoreyPavilions + ' two-storey' : '');
  $('roofService').textContent = fmt(m.roofPlan.serviceArea) + ' m²';
  $('slideConnections').textContent = m.feature.slide
    ? m.feature.slide.connections.length + ' direct landings'
    : '—';
  if (state.autoCore || m.manualClamped) {
    $('footprint').value = Math.PI * m.R * m.R;
    $('footprintOut').textContent = fmt(Math.PI * m.R * m.R) + ' m²';
    $('footprint').closest('.field').querySelector('.num-edit').value = Math.round(
      Math.PI * m.R * m.R
    );
  }
  $('actualWidth').textContent = m.width.toFixed(2) + ' m';
  $('wallThickness').textContent = Math.round(facadeThickness(m) * 1000) + ' mm';
  $('corridorActual').textContent = m.circulation.width.toFixed(2) + ' m';
  const bridgeInfo = $('bridgeInfo');
  const bridges = m.circulation.bridges.length,
    stairCount = m.circulation.stairs?.length ?? 0;
  bridgeInfo.hidden = state.atriumBridges === 'off';
  bridgeInfo.textContent = state.floors === 1
    ? 'Atrium bridges need an upper floor.'
    : `${bridges} of ${state.floors - 1} upper floors bridged · ${stairCount} down ${stairCount === 1 ? 'stair' : 'stairs'}`;
  $('corridorArea').textContent = fmt(m.circulation.corridorArea) + ' m²';
  $('elevatorArea').textContent = fmt(m.circulation.elevatorArea) + ' m²';
  $('hubArea').textContent = fmt(m.circulation.hubArea) + ' m²';
  $('hubCount').textContent = m.circulation.hubs.length;
  const hubPairs = [];
  for (let i = 0; i < 5; i++)
    for (let j = i + 1; j < 5; j++)
      if (relationMode(i, j) === 'attract') {
        const n = m.circulation.hubs.filter(
          (h) => relationKey(...h.pair) === relationKey(i, j)
        ).length;
        hubPairs.push({ i, j, n });
      }
  $('hubCoverage').textContent = hubPairs.filter((p) => p.n > 0).length + ' / ' + hubPairs.length;
  $('hubPairs').innerHTML = hubPairs.length
    ? hubPairs
        .map(
          (p) =>
            `<div class="readout" style="font-size:11px"><span>${PROGRAMS[p.i].short} + ${PROGRAMS[p.j].short}</span><b style="color:${p.n ? '#47866a' : '#a06b40'}">${p.n ? p.n + ' shared' : 'No shared hub'}</b></div>`
        )
        .join('')
    : '<p class="hint">No pairs set to attract.</p>';
  $('circulationArea').textContent = fmt(m.circulation.total) + ' m²';
  warning(
    'circulationWarning',
    [
      m.circulation.width < state.corridorWidth - 0.02
        ? 'Corridor width reduced to fit the narrow ring.'
        : '',
      m.lobby.voidArea
        ? 'Level 2 galleries keep the outer corridor connected across both lobby atriums.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')
  );
  warning(
    'geometryWarning',
    m.manualClamped
      ? 'Requested core too large; scaled down to the floor-area cap.'
      : Math.abs(m.width - state.ringWidth) > 0.01
        ? 'Ring width adjusted to keep the greenhouse within its allocated area.'
        : ''
  );
  PROGRAMS.forEach((p, i) => {
    $('actual' + i).textContent =
      `Adjusted goal: ${fmt(m.goals[i])} m² · Actual: ${fmt(m.core[i])} m² core · ${m.counts[i]} pods (${fmt(m.counts[i] * 81)} m²)`;
  });
  $('diameter').textContent = (m.R * 2).toFixed(1) + ' m';
  $('ringArea').textContent = fmt(m.ringPer) + ' m²';
  $('courtArea').textContent = fmt(m.court) + ' m²';
  $('lobbyArea').textContent = fmt(m.lobby.area) + ' m²';
  $('lobbyVoid').textContent = fmt(m.lobby.voidArea) + ' m²';
  $('lobbyVolume').textContent = fmt(m.lobby.volume) + ' m³';
  $('lobbyBlocked').textContent = m.lobby.blocked.size + ' slots';
  $('plazaArea').textContent = fmt(m.plaza?.area || 0) + ' m²';
  $('slots').textContent = m.slotN;
  $('actualModuleSpacing').textContent = m.moduleEntranceGap == null ? '—' : m.moduleEntranceGap.toFixed(2) + ' m';
  $('maxModules').textContent = m.max;
  $('blockedSlots').textContent = (m.feature?.blocked.size || 0) + ' slots';
  $('slideDetours').textContent = m.feature.slide?.facadeDetours?.length || 0;
  $('rideHeight').textContent = (m.feature?.ride.height || 117).toFixed(0) + ' m';
  $('slideRun').textContent = m.feature.slide ? fmt(m.feature.slide.run) + ' m' : 'Off';
  $('slideLevels').textContent = m.feature.slide
    ? `L${m.feature.slide.startFloor + 1} → L${m.feature.slide.endFloor + 1} · ${Math.round(m.feature.slide.grade * 100)}%`
    : '—';
  warning(
    'slideWarning',
    state.slideLength && !m.feature.slide
      ? 'No suitable vertically separated Infinite Rinse facade rooms. Try another variation or more core Rinse area / floors.'
      : ''
  );
  warning(
    'capacityWarning',
    state.modules > m.count
      ? `${m.count} of ${state.modules} requested modules installed. Docking space or eligible program demand limits capacity; remaining primary area stays in the core.`
      : ''
  );
  $('totalArea').textContent = fmt(m.total);
  $('coreArea').textContent = fmt(
    m.ringArea + m.circulation.bridgeArea + m.court + m.roofPlan.area
  );
  $('moduleArea').textContent = fmt(m.count * 81);
  $('totalModules').textContent = m.count;
  $('vacantCount').textContent = m.max - m.count;
  $('outdoorArea').textContent = fmt(m.outdoor) + ' m²';
  $('retailArea').textContent = fmt(m.retail) + ' m²';
  $('roomCount').textContent =
    m.rooms.length +
    (m.rooms.length ? ' · min ' + fmt(Math.min(...m.rooms.map((q) => q.area))) + ' m²' : '');
  $('primaryArea').textContent = fmt(m.primary) + ' m²';
  VACANCY.forEach((v, i) => {
    $('vacCount' + i).textContent = m.vacancyCounts[i] + ' slots';
  });
  $('vacancyBar').innerHTML = VACANCY.map(
    (v, i) =>
      `<div style="background:${v.color};width:${m.max > m.count ? (m.vacancyCounts[i] / (m.max - m.count)) * 100 : 0}%"></div>`
  ).join('');
  $('areaDelta').textContent =
    fmt(Math.max(0, state.areaCap - m.total)) + ' m² remaining of ' + fmt(state.areaCap) + ' m²';
  const firehallStatus = $('firehallStatus');
  firehallStatus.hidden = !m.firehallUnplaced && !m.firehallOmitted.size;
  firehallStatus.textContent = m.firehallUnplaced
    ? m.firehallUnplaced + ' requested Firehall modules could not fit under the ground-first rule.'
    : 'Some saved Firehall docks conflict with the ground-first rule.';
  const repelStatus = $('repelStatus');
  repelStatus.hidden = m.repelConflicts === 0;
  repelStatus.textContent =
    m.repelConflicts === 0
      ? ''
      : m.repelConflicts +
        ' same-floor Repel ' +
        (m.repelConflicts === 1 ? 'conflict remains.' : 'conflicts remain.');
  let rows = '',
    bar = '';
  P.forEach((p, i) => {
    const total = m.core[i] + m.counts[i] * 81,
      d = total - p.goal;
    if (i === UNUSED && total < 0.01) return;
    rows += `<tr><td><i class="dot" style="background:${p.color}"></i>${p.name}</td><td>${fmt(p.goal)}</td><td>${fmt(m.core[i])}</td><td>${m.counts[i]}</td><td><b>${fmt(total)}</b></td><td class="${d < -0.5 ? 'negative' : d > 0.5 ? 'positive' : ''}">${signed(d)}</td></tr>`;
    bar += `<div title="${p.name}: ${fmt(total)} m²" style="background:${p.color};width:${(total / m.total) * 100}%"></div>`;
  });
  if (m.lobby.area) {
    rows += `<tr><td><i class="dot" style="background:#e5d3ae"></i>Lobby atriums</td><td>—</td><td>${fmt(m.lobby.area)}</td><td>—</td><td><b>${fmt(m.lobby.area)}</b></td><td>—</td></tr>`;
    bar += `<div style="background:#e5d3ae;width:${(m.lobby.area / m.total) * 100}%"></div>`;
  }
  if (m.circulation.total) {
    for (const [name, value, color] of [
      ['Corridors / links', m.circulation.corridorArea - m.circulation.bridgeArea, '#eee9da'],
      ['Atrium bridges / stairs', m.circulation.bridgeArea, '#d9bb87'],
      ['Elevator blocks', m.circulation.elevatorArea, '#777a91'],
      ['Shared lobbies', m.circulation.hubArea, '#80509e']
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
    ['Roof retail pavilions', m.roofPlan.retailArea, '#ad91c7'],
    ['Roof lift access + services', m.roofPlan.serviceArea, '#777a91']
  ]) {
    if (value < 0.001) continue;
    rows += `<tr><td><i class="dot" style="background:${color}"></i>${name}</td><td>—</td><td>${fmt(value)}</td><td>—</td><td><b>${fmt(value)}</b></td><td>—</td></tr>`;
    bar += `<div title="${name}: ${fmt(value)} m²" style="background:${color};width:${(value / m.total) * 100}%"></div>`;
  }
  $('schedule').innerHTML = rows;
  $('areaBar').innerHTML = bar;
  warning(
    'allocationWarning',
    [
      m.circulation.total > 0
        ? 'Circulation is deducted from remaining core program room areas, not added to the total.'
        : '',
      m.lobby.area > 0
        ? 'The lobby shares the area budget with all programs; its upper-level void is excluded.'
        : '',
      m.lobby.area < state.lobby - 0.1 ? 'Lobby footprint limited by available ring geometry.' : '',
      m.retail > 0
        ? 'Retail occupies part of the area budget; the five base goals are reduced proportionally.'
        : '',
      m.vacancyCounts[3] < m.retailRequested
        ? 'Retail share limited by the cap or docking geometry; overflow assigned to other vacancy uses.'
        : '',
      !state.autoCore &&
      PROGRAMS.some((p, i) => Math.abs(m.core[i] + m.counts[i] * 81 - m.goals[i]) > 0.01)
        ? 'Manual geometry does not match one or more adjusted program goals. Re-enable auto-size to rebalance.'
        : ''
    ]
      .filter(Boolean)
      .join(' ')
  );
  updateBudget(m);
  upload(m);
  queueSave();
}
// Combine bursts of form and pointer changes into one recalculation per frame.
function scheduleUpdate() {
  if (!pending) pending = requestAnimationFrame(update);
}
$('shuffle').onclick = () => {
  state.seed = (state.seed + 1) >>> 0;
  state.dockVariant = 0;
  state.allocationMoves = [];
  scheduleUpdate();
};
$('reset').onclick = () => {
  if (
    !confirm(
      'Reset all design settings and camera to defaults? Export JSON first if you want to keep this configuration.'
    )
  )
    return;
  state = defaults();
  initCrossUI();
  $('relationStatus').textContent = 'All program pairs begin neutral unless explicitly changed.';
  camera = { az: -0.84, el: 0.57, zoom: 1, pan: 0 };
  wheelRender();
  scheduleUpdate();
};
for (const k of ['roof', 'grid', 'supports', 'showModules', 'showPeople', 'showAnimals'])
  $(k).onchange = () => {
    state[k] = $(k).checked;
    refreshView();
  };
$('export').onclick = () => {
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
              ...Object.fromEntries(Object.entries(occupancy.score).filter(([k]) => k !== 'pairs'))
            }
          : null,
        comparisons: cpHistory
      },
      units: 'meters, square meters',
      crane: m.crane,
      state,
      geometry: {
        outerFootprint: Math.PI * m.R * m.R,
        outerWallThickness: facadeThickness(m),
        ringWidth: m.width,
        outerRadius: m.R,
        innerRadius: m.r,
        floorHeight: m.floorHeight,
        slabThickness: m.slabThickness,
        module: MODULE,
        dockingGrid: { baysPerFloor: m.slotN, minimumEntranceGap: state.moduleSpacing, actualEntranceGap: m.moduleEntranceGap },
        ringAreaPerFloor: m.ringPer,
        netRingArea: m.ringArea,
        programRingArea: m.programRing,
        courtyardArea: m.court
      },
      features: {
        swingRide: m.feature?.ride || null,
        waterSlide: m.feature?.slide || null,
        climbingWall: m.feature.climbing
          ? { ...m.feature.climbing, blocked: [...m.feature.climbing.blocked] }
          : null,
        blockedSlots: [...m.blocked],
        slideBlockedSlots: [...m.feature.blocked]
      },
      programs: P.map((p, i) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        goal: p.goal,
        adjustedGoal: m.goals[i] ?? 0,
        coreArea: m.core[i],
        moduleCount: m.counts[i],
        actualArea: m.core[i] + m.counts[i] * 81
      })),
      circulation: {
        width: m.circulation.width,
        axis: m.circulation.axis,
        bridgeAngle: m.circulation.bridgeAngle,
        totalArea: m.circulation.total,
        corridorArea: m.circulation.corridorArea,
        elevatorArea: m.circulation.elevatorArea,
        sharedLobbyArea: m.circulation.hubArea,
        bridgeArea: m.circulation.bridgeArea,
        stairArea: m.circulation.stairArea,
        stairs: m.circulation.stairs,
        bridges: m.circulation.bridges,
        bridgeSeating: bridgeLounges(m).map(({ court, matRadius, ...lounge }) => ({
          ...lounge,
          court,
          rug: bridgeMatOutline.map(([u, v]) => [court[0] + u * matRadius, court[1] + v * matRadius])
        })),
        roomPacking: m.circulation.roomPacking,
        regions: m.circulation.regions,
        hubs: m.circulation.hubs,
        doors: m.circulation.doors
      },
      coreRooms: m.rooms.map((s) => ({ ...s, program: P[s.id].id })),
      vacancies: VACANCY.map((v, i) => ({
        ...v,
        percentage: state.vacancy[i],
        actualPercentage: m.max > m.count ? (100 * m.vacancyCounts[i]) / (m.max - m.count) : 0,
        slots: m.vacancyCounts[i]
      })),
      areaCap: state.areaCap,
      remainingArea: Math.max(0, state.areaCap - m.total),
      primaryTarget: state.areaCap - m.retail - m.roofPlan.retailArea,
      programTarget:
        state.areaCap - m.retail - m.roofPlan.area - m.lobby.area - m.circulation.total,
      camera,
      lobby: { ...m.lobby, blocked: [...m.lobby.blocked] },
      greenhouse: m.greenhouse,
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
          buildStorey(m, s.f).base,
          (m.R + 0.65 + 9) * Math.sin(s.angle)
        ]
      })),
      totalArea: m.total
    };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'poly-nation-massing-' + state.seed + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// Local save + portable state import. File URLs may have browser-specific storage behavior.
const STORAGE_KEY = 'poly-nation-massing-lab-v2.5';
let saveTimer;
function saveNow() {
  try {
    const crossPollination = { comparisons: cpHistory };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, camera, crossPollination }));
    $('saveStatus').textContent = 'Saved locally';
  } catch (e) {
    $('saveStatus').textContent = 'Local save unavailable — use JSON';
  }
}
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}
// Validate saved values against current defaults and ranges, while accepting legacy saved settings.
function applySaved(data) {
  if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object')
    throw Error('Choose a Poly Nation JSON export.');
  const d = defaults(),
    s = data.state;
  if (SLAB_DEPTHS.includes(s.slabThickness)) d.slabThickness = s.slabThickness;
  const ranges = {
    floors: [1, 10],
    footprint: [100, 22000],
    ringWidth: [0.5, 35],
    modules: [0, 300],
    moduleSpacing: [MODULE_SPACING.min, MODULE_SPACING.max],
    affinity: [0, 100],
    seed: [0, 4294967295],
    dockVariant: [0, 4294967295],
    inspect: [0, 10],
    mix: [0, 100],
    slideLength: [0, 100],
    climbWidth: [0, 24],
    lobby: [0, 1000],
    corridorWidth: [1.5, 5],
    areaCap: [5000, 50000],
    craneBearing: [0, 359],
    craneFloor: [1, 10],
    minRoomArea: [40, 200],
    simSpeed: [1, 12],
    visitorCount: [8, 70]
  };
  for (const [k, [a, b]] of Object.entries(ranges))
    if (typeof s[k] === 'number' && Number.isFinite(s[k])) d[k] = clamp(s[k], a, b);
  if (Object.hasOwn(BRIDGE_MODES, s.atriumBridges)) d.atriumBridges = s.atriumBridges;
  if (s.craneStage === 'ride') d.craneStage = 'travel';
  else if (Object.hasOwn(CRANE_STAGES, s.craneStage)) d.craneStage = s.craneStage;
  if (Object.hasOwn(CRANE_RUNWAYS, s.craneRunway)) d.craneRunway = s.craneRunway;
  if (d.craneRunway !== 'elevated' && d.craneStage === 'caterpillar') d.craneStage = 'travel';
  d.craneFloor = Math.round(d.craneFloor);
  d.craneBearing = Math.round(d.craneBearing);
  d.moduleSpacing = Number(d.moduleSpacing.toFixed(1));
  for (const k of ['floors', 'modules', 'seed', 'dockVariant', 'inspect', 'visitorCount'])
    d[k] = Math.round(d[k]);
  for (const k of [
    'autoCore',
    'roof',
    'grid',
    'supports',
    'showModules',
    'showPeople',
    'showAnimals',
    'xray',
    'showRooms',
    'showRoofDeck',
    'showFacade',
    'animateSwing',
    'bridgeSeating',
    'simRunning'
  ])
    if (typeof s[k] === 'boolean') d[k] = s[k];
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
  if (s.relations && typeof s.relations === 'object')
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const k = relationKey(i, j),
          v = s.relations[k];
        if (['attract', 'neutral', 'repel'].includes(v)) d.relations[k] = v;
      }
  if (s.roomPrograms && typeof s.roomPrograms === 'object')
    for (const [key, program] of Object.entries(s.roomPrograms).slice(0, 300)) {
      if (
        /^\d+:\d+:\d+:\d+\.\d{5}:\d+\.\d{5}$/.test(key) &&
        Number.isInteger(program) &&
        PROGRAMS[program]
      )
        d.roomPrograms[key] = program;
    }
  if (s.modulePrograms && typeof s.modulePrograms === 'object')
    for (const [key, edit] of Object.entries(s.modulePrograms).slice(0, 300)) {
      const [columns, floor, dock] = key.split(':').map(Number);
      if (
        /^[1-9]\d*:\d+:\d+$/.test(key) &&
        columns <= 200 &&
        floor < 10 &&
        dock < columns &&
        edit &&
        Number.isInteger(edit.program) &&
        PROGRAMS[edit.program] &&
        (edit.from === null || (Number.isInteger(edit.from) && PROGRAMS[edit.from]))
      )
        d.modulePrograms[key] = { program: edit.program, from: edit.from };
    }
  if (Array.isArray(s.cluster) && s.cluster.length === 5) d.cluster = s.cluster.map(Boolean);
  if (Array.isArray(s.allocationMoves)) {
    const roomKey = /^\d+:\d+:\d+:\d+\.\d{5}:\d+\.\d{5}$/;
    d.allocationMoves = s.allocationMoves
      .slice(0, 300)
      .filter(
        (move) =>
          move &&
          typeof move.left === 'string' &&
          typeof move.right === 'string' &&
          roomKey.test(move.left) &&
          roomKey.test(move.right) &&
          Number.isInteger(move.leftProgram) &&
          PROGRAMS[move.leftProgram] &&
          Number.isInteger(move.rightProgram) &&
          PROGRAMS[move.rightProgram] &&
          Number.isInteger(move.count) &&
          move.count !== 0 &&
          Math.abs(move.count) <= ALLOCATION_EXCHANGE_LIMIT
      );
  }
  if (s.encounterWeights && typeof s.encounterWeights === 'object')
    for (const k of Object.keys(d.encounterWeights))
      if (Number.isFinite(s.encounterWeights[k]))
        d.encounterWeights[k] = clamp(s.encounterWeights[k], 0, 10);
  for (const k of ['memoryBonus', 'programBonus', 'funBonus', 'speciesBonus'])
    if (Number.isFinite(s[k])) d[k] = clamp(s[k], 1, 3);
  state = d;
  Object.assign(craneAnimation, { angle: 0, last: 0, paused: false });
  const c = data.camera || {};
  camera = {
    az: Number.isFinite(c.az) ? c.az : -0.84,
    el: clamp(Number.isFinite(c.el) ? c.el : 0.57, 0, Math.PI / 2),
    zoom: clamp(Number.isFinite(c.zoom) ? c.zoom : 1, DETAIL_CAMERA_ZOOM, 3),
    pan: clamp(Number.isFinite(c.pan) ? c.pan : 0, -180, 180),
    panX: clamp(Number.isFinite(c.panX) ? c.panX : 0, -180, 180)
  };
  const comparisons = data.crossPollination?.comparisons;
  cpHistory = Array.isArray(comparisons)
    ? comparisons
        .filter(isTrialRecord)
        .slice(0, 8)
        .map((trial) => ({
          ...trial,
          thumbnail: trialThumbnailSource(trial.thumbnail)
        }))
    : [];
  cpTrialNotice = '';
}

function isTrialRecord(trial) {
  const fields = ['rate', 'rooms', 'modules', 'hubs', 'core', 'encounters', 'cross', 'species', 'seed', 'visitors'];
  return trial && typeof trial.signature === 'string' && fields.every((key) => Number.isFinite(trial[key]));
}
function restoreSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved) applySaved(saved);
    // Older installations kept this selection in Build only. Migrate it into the design once.
    const legacySlab = Number(localStorage.getItem(LEGACY_SLAB_KEY));
    if (saved?.state?.slabThickness == null && SLAB_DEPTHS.includes(legacySlab))
      state.slabThickness = legacySlab;
  } catch (e) {
    $('saveStatus').textContent = 'Local save unavailable';
  }
}
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    applySaved(data);
    initCrossUI();
    wheelRender();
    update();
    saveNow();
  } catch (e) {
    alert('Could not restore configuration: ' + e.message);
  } finally {
    $('importFile').value = '';
  }
};
window.addEventListener('pagehide', saveNow);
// Native Rhino export: shared semantic geometry, meters, right-handed Z-up.
function exportGeometry(m) {
  const mesh = buildMesh(m, true),
    groups = mesh.groups,
    objects = [];
  const point = (a, i) => [+a[i].toFixed(5), +(-a[i + 2]).toFixed(5), +a[i + 1].toFixed(5)];
  const color = (a, i) => a.slice(i + 6, i + 9).map((x) => Math.round(clamp(x, 0, 1) * 255));
  for (let k = 0; k < groups.length; k++) {
    const g = groups[k],
      next = groups[k + 1] || {
        solid: mesh.solid.length,
        glass: mesh.glass.length,
        lines: mesh.lines.length
      };
    if (g.layer === 'Reference') continue;
    for (const kind of ['solid', 'glass', 'lines']) {
      if (next[kind] <= g[kind]) continue;
      const a = mesh[kind],
        layer = g.layer + (kind === 'glass' ? '_Glazing' : kind === 'lines' ? '_Lines' : '');
      const item = {
        layer,
        name: g.name + (kind === 'glass' ? ' glazing' : kind === 'lines' ? ' linework' : ''),
        color: color(a, g[kind]),
        kind: kind === 'lines' ? 'lines' : 'mesh'
      };
      if (kind === 'lines') {
        item.segments = [];
        const seen = new Set();
        for (let i = g.lines; i < next.lines; i += 20) {
          const p = point(a, i),
            q = point(a, i + 10),
            x = p.join(','),
            y = q.join(','),
            key = x < y ? x + '|' + y : y + '|' + x;
          if (x === y || seen.has(key)) continue;
          seen.add(key);
          item.segments.push([p, q]);
        }
        if (item.segments.length) objects.push(item);
        continue;
      }
      const vertices = [],
        faces = [],
        lookup = new Map(),
        seen = new Set();
      for (let i = g[kind]; i < next[kind]; i += 30) {
        const tri = [point(a, i), point(a, i + 10), point(a, i + 20)];
        const u = sub(tri[1], tri[0]),
          v = sub(tri[2], tri[0]);
        if (Math.hypot(...cross(u, v)) < 1e-9) continue;
        const ids = tri.map((p) => {
          const key = p.join(',');
          if (!lookup.has(key)) {
            lookup.set(key, vertices.length);
            vertices.push(p);
          }
          return lookup.get(key);
        });
        const key = ids
          .slice()
          .sort((a, b) => a - b)
          .join(',');
        if (new Set(ids).size !== 3 || seen.has(key)) continue;
        seen.add(key);
        faces.push(ids);
      }
      if (faces.length) {
        item.vertices = vertices;
        item.faces = faces;
        objects.push(item);
      }
    }
  }
  return { units: 'meters', axis: 'Z-up', filename: 'poly-nation-' + state.seed + '.3dm', objects };
}
function downloadBlob(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const RHINO_CDN = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';
let rhinoPromise = null;
// Load the pinned Rhino library on demand and clear the cached request if loading fails.
function loadRhino() {
  if (!rhinoPromise) {
    rhinoPromise = (async () => {
      const mod = await import(RHINO_CDN + 'rhino3dm.module.min.js');
      return await mod.default({ locateFile: (name) => RHINO_CDN + name });
    })();
    rhinoPromise.catch(() => {
      rhinoPromise = null;
    });
  }
  return rhinoPromise;
}
function timed(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Rhino library download timed out')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}
const dispose = (o) => {
  if (o && typeof o.delete === 'function') o.delete();
  else if (o && typeof o.destroy === 'function') o.destroy();
};
// Write semantic mesh and line layers to a new Rhino document, then read it back to confirm the payload.
function nativeBytes(r, geom) {
  const doc = new r.File3dm();
  let expected = 0;
  try {
    const settings = doc.settings();
    settings.modelUnitSystem = r.UnitSystem.Meters;
    settings.modelAbsoluteTolerance = 0.001;
    const layerTable = doc.layers(),
      table = doc.objects(),
      layers = new Map();
    for (const item of geom.objects) {
      if (!layers.has(item.layer)) {
        const [red, g, b] = item.color,
          idx = layerTable.addLayer(item.layer, { r: red, g, b, a: 255 });
        if (idx < 0) throw Error('Layer creation failed: ' + item.layer);
        layers.set(item.layer, idx);
      }
      const attr = new r.ObjectAttributes();
      attr.layerIndex = layers.get(item.layer);
      attr.name = item.name;
      try {
        if (item.kind === 'mesh') {
          const mesh = new r.Mesh();
          try {
            const verts = mesh.vertices(),
              faces = mesh.faces();
            for (const p of item.vertices) verts.add(...p);
            for (const f of item.faces) faces.addTriFace(...f);
            mesh.normals().computeNormals();
            mesh.compact();
            const id = table.add(mesh, attr);
            if (!id || id === '00000000-0000-0000-0000-000000000000')
              throw Error('Mesh creation failed: ' + item.name);
            expected++;
          } finally {
            dispose(mesh);
          }
        } else
          for (const [a, b] of item.segments) {
            const id = table.addLine(a, b, attr);
            if (!id || id === '00000000-0000-0000-0000-000000000000')
              throw Error('Line creation failed: ' + item.name);
            expected++;
          }
      } finally {
        dispose(attr);
      }
    }
    const raw = doc.toByteArray();
    const bytes = new Uint8Array(raw);
    if (bytes.length < 64) throw Error('Rhino returned an empty file');
    // Round-trip with the same OpenNURBS library before offering the file.
    const check = r.File3dm.fromByteArray(bytes);
    if (!check) throw Error('3DM read-back failed');
    try {
      if (check.objects().count !== expected || check.layers().count < layers.size)
        throw Error('3DM read-back object or layer count mismatch');
    } finally {
      dispose(check);
    }
    return { bytes, objects: expected, layers: layers.size };
  } finally {
    dispose(doc);
  }
}
$('export3DM').onclick = async () => {
  const button = $('export3DM'),
    status = $('exportStatus');
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = 'Preparing Rhino geometry…';
  try {
    if (pending) update();
    if (!model) return;
    const geom = exportGeometry(model);
    status.textContent = 'Loading Rhino3dm.js (internet required on first load)…';
    const r = await timed(loadRhino(), 25000);
    status.textContent = 'Writing native 3DM…';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = nativeBytes(r, geom);
    downloadBlob(result.bytes, 'application/octet-stream', geom.filename);
    status.textContent = `3DM saved · ${result.layers} layers · ${result.objects} objects`;
  } catch (e) {
    console.error(e);
    status.textContent = '3DM export unavailable: ' + e.message + '. Use Rhino script (offline).';
  } finally {
    button.disabled = false;
  }
};
// Offline Rhino exporter. Inject the same geometry payload used by the native exporter.
const RHINO_SCRIPT = `# -*- coding: utf-8 -*-
# Poly Nation: standalone Rhino 8 script. Run with _RunPythonScript.
# Creates a new 3DM on disk, without modifying the active Rhino document.
import json
import Rhino
import rhinoscriptsyntax as rs
from System.Drawing import Color
from System import Guid

DATA = json.loads(__GEOMETRY_JSON__)

def main():
    path = rs.SaveFileName("Save Poly Nation native Rhino model", "Rhino 3D Model (*.3dm)|*.3dm||", filename=DATA["filename"])
    if not path:
        return
    if not path.lower().endswith(".3dm"):
        path += ".3dm"
    doc = Rhino.FileIO.File3dm()
    doc.Settings.ModelUnitSystem = Rhino.UnitSystem.Meters
    doc.Settings.ModelAbsoluteTolerance = 0.001
    layers = {}
    count = 0
    try:
        for item in DATA["objects"]:
            name = item["layer"]
            if name not in layers:
                layer = Rhino.DocObjects.Layer()
                layer.Name = name
                layer.Color = Color.FromArgb(*item["color"])
                index = doc.Layers.Add(layer)
                if index < 0:
                    raise Exception("Could not add layer: " + name)
                layers[name] = index
            attr = Rhino.DocObjects.ObjectAttributes()
            attr.LayerIndex = layers[name]
            attr.Name = item["name"]
            if item["kind"] == "mesh":
                mesh = Rhino.Geometry.Mesh()
                for v in item["vertices"]:
                    mesh.Vertices.Add(v[0], v[1], v[2])
                for f in item["faces"]:
                    mesh.Faces.AddFace(f[0], f[1], f[2])
                mesh.Normals.ComputeNormals()
                mesh.Compact()
                if not mesh.IsValid:
                    raise Exception("Invalid mesh: " + item["name"])
                oid = doc.Objects.AddMesh(mesh, attr)
                if oid == Guid.Empty:
                    raise Exception("Could not add mesh: " + item["name"])
                count += 1
            else:
                for line in item["segments"]:
                    a = Rhino.Geometry.Point3d(*line[0]); b = Rhino.Geometry.Point3d(*line[1])
                    oid = doc.Objects.AddLine(a, b, attr)
                    if oid == Guid.Empty:
                        raise Exception("Could not add curve: " + item["name"])
                    count += 1
        if not doc.Write(path, 8):
            raise Exception("Rhino could not write the selected file.")
        rs.MessageBox("Saved {0} objects on {1} layers.\\n{2}\\nOpen the new 3DM in Rhino.".format(count, len(layers), path), 0, "Poly Nation")
    finally:
        doc.Dispose()

if __name__ == "__main__":
    main()
`;
$('exportRhinoScript').onclick = () => {
  if (pending) update();
  if (!model) return;
  const geom = exportGeometry(model);
  const payload = JSON.stringify(geom);
  const code = RHINO_SCRIPT.replace('__GEOMETRY_JSON__', () => JSON.stringify(payload));
  downloadBlob(code, 'text/x-python', geom.filename.replace('.3dm', '-rhino.py'));
  $('exportStatus').textContent = 'Script saved. In Rhino, run _RunPythonScript to create the 3DM.';
};

// Update the existing model display without rerunning the layout or resetting the simulation.
function refreshView() {
  if (!model || pending) {
    scheduleUpdate();
    return;
  }
  for (const [id, key] of Object.entries(viewKeys))
    $(id).setAttribute('aria-pressed', String(state[key]));
  for (const k of ['roof', 'grid', 'supports', 'showModules', 'showPeople', 'showAnimals'])
    $(k).checked = state[k];
  upload(model);
  queueSave();
}
function updateBudget(m) {
  const cap = state.areaCap,
    used = Math.min(100, Math.max(0, (m.total / cap) * 100)),
    remaining = Math.max(0, cap - m.total);
  $('budgetFill').style.width = used + '%';
  $('budgetTrack').setAttribute('aria-valuemax', String(cap));
  $('budgetTrack').setAttribute('aria-valuenow', String(Math.round(m.total)));
  $('budgetText').textContent = fmt(remaining) + ' m² available · ' + fmt(cap) + ' m² budget';
}
const designSettings = $('designSettings');
for (const nav of document.querySelectorAll('.panel-tabs')) {
  const bs = [...nav.querySelectorAll('[role=tab]')];
  const select = (b) => {
    for (const q of bs) {
      const on = q === b;
      q.setAttribute('aria-selected', String(on));
      q.tabIndex = on ? 0 : -1;
      $(q.dataset.panel).hidden = !on;
    }
    designSettings.scrollTop = 0;
  };
  for (const b of bs) b.onclick = () => select(b);
  nav.addEventListener('keydown', (e) => {
    const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    let j =
      e.key === 'ArrowRight'
        ? (i + 1) % bs.length
        : e.key === 'ArrowLeft'
          ? (i + bs.length - 1) % bs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? bs.length - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    select(bs[j]);
    bs[j].focus();
  });
}
function goToModel() {
  if (innerWidth < 900) document.querySelector('.model-stage').scrollIntoView({ block: 'start' });
}
const areaSchedule = $('areaSchedulePanel');
const areaDetails = $('focusSchedule');
const trialDrawer = $('trialDrawer');
const trialLogButton = $('openTrialLog');
// Both tools use the same right-hand space. Closing the trial log leaves an active run going.
function openMassingDrawer(drawer, trigger) {
  areaSchedule.hidden = drawer !== areaSchedule;
  trialDrawer.hidden = drawer !== trialDrawer;
  areaDetails.setAttribute('aria-expanded', String(!areaSchedule.hidden));
  trialLogButton.setAttribute('aria-expanded', String(!trialDrawer.hidden));
  if (drawer) {
    if (innerWidth < 900) drawer.scrollIntoView({ block: 'start' });
    drawer.focus({ preventScroll: true });
    return;
  }
  goToModel();
  trigger.focus();
}
areaDetails.onclick = () => openMassingDrawer(areaSchedule);
trialLogButton.onclick = () => openMassingDrawer(trialDrawer);
$('collapseSchedule').onclick = () => openMassingDrawer(null, areaDetails);
$('collapseTrial').onclick = () => openMassingDrawer(null, trialLogButton);
$('returnModelMobile').onclick = goToModel;
const topologyToggle = $('toggleTopology');
const topologyControls = $('topologyControls');
// Collapse the panel without changing any program relationships or clustering settings.
function setTopologyOpen(open) {
  topologyControls.hidden = !open;
  topologyToggle.setAttribute('aria-expanded', String(open));
  const label = open ? 'Collapse' : 'Expand';
  topologyToggle.textContent = label;
  topologyToggle.setAttribute('aria-label', label + ' Topology Designer');
}
topologyToggle.onclick = () => setTopologyOpen(topologyControls.hidden);
$('jumpTopology').onclick = () => {
  setTopologyOpen(true);
  $('program-panel-0').scrollIntoView({ block: 'start' });
};
$('openScoreDetails').onclick = () => {
  const tab = $('cpPaneScore-tab');
  tab.click();
  if (innerWidth < 900 || innerHeight <= 600) tab.parentElement.scrollIntoView({ block: 'start' });
};
const exportMenu = document.querySelector('.file-menu');
document.addEventListener('click', (e) => {
  if (!exportMenu.contains(e.target) || e.target.closest('.file-menu-content button'))
    exportMenu.open = false;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exportMenu.open = false;
});

$('simRestart').onclick = () => {
  if (model) {
    occupancy = makeOccupancy(model);
    simLast = 0;
    refreshPopulation();
    draw();
  }
};
