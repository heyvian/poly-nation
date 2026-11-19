"use strict";
/**
 * 16-export.js — 3D export for Rhino.
 * exportGeometry() converts the mesh to meters, Z-up. Export 3DM builds a native .3dm file in the browser with the
 * rhino3dm library (loaded from a CDN on demand); Rhino script produces a Python file that builds the model in Rhino.
 */
// Builds export geometry grouped by layer: vertices/faces/lines with Y-up converted to Rhino's Z-up.
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
        lines: mesh.lines.length,
      };
    if (g.layer === "Reference") continue;
    for (const kind of ["solid", "glass", "lines"]) {
      if (next[kind] <= g[kind]) continue;
      const a = mesh[kind],
        layer = g.layer + (kind === "glass" ? "_Glazing" : kind === "lines" ? "_Lines" : "");
      const item = {
        layer,
        name: g.name + (kind === "glass" ? " glazing" : kind === "lines" ? " linework" : ""),
        color: color(a, g[kind]),
        kind: kind === "lines" ? "lines" : "mesh",
      };
      if (kind === "lines") {
        item.segments = [];
        const seen = new Set();
        for (let i = g.lines; i < next.lines; i += 20) {
          const p = point(a, i),
            q = point(a, i + 10),
            x = p.join(","),
            y = q.join(","),
            key = x < y ? x + "|" + y : y + "|" + x;
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
          const key = p.join(",");
          if (!lookup.has(key)) {
            lookup.set(key, vertices.length);
            vertices.push(p);
          }
          return lookup.get(key);
        });
        const key = ids
          .slice()
          .sort((a, b) => a - b)
          .join(",");
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
  return { units: "meters", axis: "Z-up", filename: "poly-nation-" + state.seed + ".3dm", objects };
}
// Triggers a browser download.
function downloadBlob(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
// rhino3dm library, loaded only when Export 3DM is used.
const RHINO_CDN = "https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/";
let rhinoPromise = null;
// Loads the rhino3dm module once and caches the promise.
function loadRhino() {
  if (!rhinoPromise) {
    rhinoPromise = (async () => {
      const mod = await import(RHINO_CDN + "rhino3dm.module.min.js");
      return await mod.default({ locateFile: (name) => RHINO_CDN + name });
    })();
    rhinoPromise.catch(() => {
      rhinoPromise = null;
    });
  }
  return rhinoPromise;
}
// Rejects if `promise` takes longer than `ms` milliseconds.
function timed(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Rhino library download timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
// Frees the WebAssembly memory of a rhino3dm object (delete or destroy).
const dispose = (o) => {
  if (o && typeof o.delete === "function") o.delete();
  else if (o && typeof o.destroy === "function") o.destroy();
};
// Creates the .3dm document (layers, meshes, lines), serialises it and checks it by reading it back.
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
        if (idx < 0) throw Error("Layer creation failed: " + item.layer);
        layers.set(item.layer, idx);
      }
      const attr = new r.ObjectAttributes();
      attr.layerIndex = layers.get(item.layer);
      attr.name = item.name;
      try {
        if (item.kind === "mesh") {
          const mesh = new r.Mesh();
          try {
            const verts = mesh.vertices(),
              faces = mesh.faces();
            for (const p of item.vertices) verts.add(...p);
            for (const f of item.faces) faces.addTriFace(...f);
            mesh.normals().computeNormals();
            mesh.compact();
            const id = table.add(mesh, attr);
            if (!id || id === "00000000-0000-0000-0000-000000000000")
              throw Error("Mesh creation failed: " + item.name);
            expected++;
          } finally {
            dispose(mesh);
          }
        } else
          for (const [a, b] of item.segments) {
            const id = table.addLine(a, b, attr);
            if (!id || id === "00000000-0000-0000-0000-000000000000")
              throw Error("Line creation failed: " + item.name);
            expected++;
          }
      } finally {
        dispose(attr);
      }
    }
    const raw = doc.toByteArray();
    const bytes = new Uint8Array(raw);
    if (bytes.length < 64) throw Error("Rhino returned an empty file");
    // Round-trip with the same OpenNURBS library before offering the file.
    const check = r.File3dm.fromByteArray(bytes);
    if (!check) throw Error("3DM read-back failed");
    try {
      if (check.objects().count !== expected || check.layers().count < layers.size)
        throw Error("3DM read-back object or layer count mismatch");
    } finally {
      dispose(check);
    }
    return { bytes, objects: expected, layers: layers.size };
  } finally {
    dispose(doc);
  }
}
// Export 3DM button.
$("export3DM").onclick = async () => {
  const button = $("export3DM"),
    status = $("exportStatus");
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = "Preparing Rhino geometry…";
  try {
    if (pending) update();
    if (!model) return;
    const geom = exportGeometry(model);
    status.textContent = "Loading Rhino3dm.js (internet required on first load)…";
    const r = await timed(loadRhino(), 25000);
    status.textContent = "Writing native 3DM…";
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = nativeBytes(r, geom);
    downloadBlob(result.bytes, "application/octet-stream", geom.filename);
    status.textContent = `3DM saved · ${result.layers} layers · ${result.objects} objects`;
  } catch (e) {
    console.error(e);
    status.textContent = "3DM export unavailable: " + e.message + ". Use Rhino script (offline).";
  } finally {
    button.disabled = false;
  }
};
// Python script template; the geometry JSON replaces __GEOMETRY_JSON__.
const RHINO_SCRIPT =
  '# -*- coding: utf-8 -*-\n# Poly Nation: standalone Rhino 8 script. Run with _RunPythonScript.\n# Creates a new 3DM on disk, without modifying the active Rhino document.\nimport json\nimport Rhino\nimport rhinoscriptsyntax as rs\nfrom System.Drawing import Color\nfrom System import Guid\n\nDATA = json.loads(__GEOMETRY_JSON__)\n\ndef main():\n    path = rs.SaveFileName("Save Poly Nation native Rhino model", "Rhino 3D Model (*.3dm)|*.3dm||", filename=DATA["filename"])\n    if not path:\n        return\n    if not path.lower().endswith(".3dm"):\n        path += ".3dm"\n    doc = Rhino.FileIO.File3dm()\n    doc.Settings.ModelUnitSystem = Rhino.UnitSystem.Meters\n    doc.Settings.ModelAbsoluteTolerance = 0.001\n    layers = {}\n    count = 0\n    try:\n        for item in DATA["objects"]:\n            name = item["layer"]\n            if name not in layers:\n                layer = Rhino.DocObjects.Layer()\n                layer.Name = name\n                layer.Color = Color.FromArgb(*item["color"])\n                index = doc.Layers.Add(layer)\n                if index < 0:\n                    raise Exception("Could not add layer: " + name)\n                layers[name] = index\n            attr = Rhino.DocObjects.ObjectAttributes()\n            attr.LayerIndex = layers[name]\n            attr.Name = item["name"]\n            if item["kind"] == "mesh":\n                mesh = Rhino.Geometry.Mesh()\n                for v in item["vertices"]:\n                    mesh.Vertices.Add(v[0], v[1], v[2])\n                for f in item["faces"]:\n                    mesh.Faces.AddFace(f[0], f[1], f[2])\n                mesh.Normals.ComputeNormals()\n                mesh.Compact()\n                if not mesh.IsValid:\n                    raise Exception("Invalid mesh: " + item["name"])\n                oid = doc.Objects.AddMesh(mesh, attr)\n                if oid == Guid.Empty:\n                    raise Exception("Could not add mesh: " + item["name"])\n                count += 1\n            else:\n                for line in item["segments"]:\n                    a = Rhino.Geometry.Point3d(*line[0]); b = Rhino.Geometry.Point3d(*line[1])\n                    oid = doc.Objects.AddLine(a, b, attr)\n                    if oid == Guid.Empty:\n                        raise Exception("Could not add curve: " + item["name"])\n                    count += 1\n        if not doc.Write(path, 8):\n            raise Exception("Rhino could not write the selected file.")\n        rs.MessageBox("Saved {0} objects on {1} layers.\\n{2}\\nOpen the new 3DM in Rhino.".format(count, len(layers), path), 0, "Poly Nation")\n    finally:\n        doc.Dispose()\n\nif __name__ == "__main__":\n    main()\n';
// Rhino script button.
$("exportRhinoScript").onclick = () => {
  if (pending) update();
  if (!model) return;
  const geom = exportGeometry(model);
  const payload = JSON.stringify(geom);
  const code = RHINO_SCRIPT.replace("__GEOMETRY_JSON__", () => JSON.stringify(payload));
  downloadBlob(code, "text/x-python", geom.filename.replace(".3dm", "-rhino.py"));
  $("exportStatus").textContent = "Script saved. In Rhino, run _RunPythonScript to create the 3DM.";
};

