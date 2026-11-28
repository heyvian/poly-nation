'use strict';

const PRINT_UTF8 = new TextEncoder();
const PRINT_ZIP_CRC = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function printZipCRC(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ PRINT_ZIP_CRC[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// Store the little-endian local records, central directory and end record using
// ZIP32. Exported CAD files are already binary, and the browser needs no codec.
function printStoredZIP(files) {
  const records = files.map(({ name, data }) => {
    const path = PRINT_UTF8.encode(name);
    if (path.byteLength > 0xffff) throw new RangeError('A print export filename is too long.');
    return { path, data: typeof data === 'string' ? PRINT_UTF8.encode(data) : data };
  });
  const centralAt = records.reduce((size, record) => size + 30 + record.path.length + record.data.length, 0),
    centralSize = records.reduce((size, record) => size + 46 + record.path.length, 0),
    total = centralAt + centralSize + 22;
  if (records.length > 0xffff || total > 0xffffffff) throw new RangeError('This export exceeds the ZIP32 size limit.');
  const output = new Uint8Array(total), view = new DataView(output.buffer),
    word = (at, value) => view.setUint16(at, value, true),
    dword = (at, value) => view.setUint32(at, value, true);
  let local = 0, central = centralAt;
  for (const { path, data } of records) {
    const checksum = printZipCRC(data), size = data.length, nameSize = path.length;
    dword(local, 0x04034b50);
    word(local + 4, 20);
    word(local + 6, 0x0800); // UTF-8 names.
    word(local + 12, 33); // 1 January 1980, deterministic ZIP timestamp.
    dword(local + 14, checksum);
    dword(local + 18, size);
    dword(local + 22, size);
    word(local + 26, nameSize);
    output.set(path, local + 30);
    output.set(data, local + 30 + nameSize);
    dword(central, 0x02014b50);
    word(central + 4, 20);
    word(central + 6, 20);
    word(central + 8, 0x0800);
    word(central + 14, 33);
    dword(central + 16, checksum);
    dword(central + 20, size);
    dword(central + 24, size);
    word(central + 28, nameSize);
    dword(central + 42, local);
    output.set(path, central + 46);
    local += 30 + nameSize + size;
    central += 46 + nameSize;
  }
  dword(central, 0x06054b50);
  word(central + 8, records.length);
  word(central + 10, records.length);
  dword(central + 12, centralSize);
  dword(central + 16, centralAt);
  return output;
}

function printFileSlug(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'part';
}

function printCSVCell(value) {
  const content = String(value ?? '');
  return /[,\r\n"]/.test(content) ? '"' + content.replaceAll('"', '""') + '"' : content;
}

function printXMLText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function printPartFilename(part) {
  return printFileSlug(part.id) + '.stl';
}

function printPartSTL(part) {
  const { triangles } = part;
  if (!Array.isArray(triangles) || !triangles.length || triangles.length > 0xffffffff)
    throw new RangeError('No exportable triangles for ' + part.label + '.');
  const bytes = new Uint8Array(84 + triangles.length * 50), view = new DataView(bytes.buffer);
  bytes.set(PRINT_UTF8.encode('Poly Nation | millimetres | ' + part.id).subarray(0, 80));
  view.setUint32(80, triangles.length, true);
  let position = 84;
  for (const [a, b, c] of triangles) {
    if (![a, b, c].every(vertex => vertex?.length === 3 && vertex.every(Number.isFinite)))
      throw new TypeError('Invalid STL coordinates for ' + part.label + '.');
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2],
      vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2],
      nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx,
      length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) throw new RangeError('Degenerate STL triangle for ' + part.label + '.');
    for (const coordinate of [nx / length, ny / length, nz / length, ...a, ...b, ...c]) {
      view.setFloat32(position, coordinate, true);
      position += 4;
    }
    position += 2; // Attribute byte count remains zero.
  }
  return bytes;
}

const printNumber = value => typeof value === 'number' ? Number(value.toFixed(3)) : value;
const printDimension = size => (Array.isArray(size) ? size : [size]).map(printNumber).join(' × ') + ' mm';
const printPartPath = part => 'parts/' + printPartFilename(part);

function printPartsCSV(kit) {
  const rows = [[
    'number', 'id', 'group', 'label', 'file', 'quantity',
    'bed_x_mm', 'bed_y_mm', 'height_mm', 'components', 'steep_overhang_faces',
    'assembly_x_min_mm', 'assembly_y_min_mm', 'assembly_z_min_mm',
    'assembly_x_max_mm', 'assembly_y_max_mm', 'assembly_z_max_mm', 'notes'
  ]];
  for (const [index, part] of kit.parts.entries()) {
    const { id, group, label, size, components, overhangFaces, assemblyBounds } = part,
      bounds = !part.guide && assemblyBounds ? [...assemblyBounds.min, ...assemblyBounds.max] : Array(6).fill(''),
      notes = Array.isArray(part.notes) ? part.notes.join(' / ') : part.notes;
    rows.push([index + 1, id, group, label, printPartPath(part), 1, ...size, components, overhangFaces, ...bounds, notes]);
  }
  return rows.map(row => row.map(value => printCSVCell(printNumber(value))).join(',')).join('\r\n') + '\r\n';
}

function printPlacementJSON(kit) {
  return JSON.stringify({
    units: 'mm',
    worldAxes: ['scene X', 'negative scene Z', 'scene Y'],
    transform: 'world = origin + x * bedX + y * bedY + z * height',
    scale: kit.denominator,
    seed: kit.seed,
    parts: kit.parts.filter(part => !part.guide).map(part => ({
      id: part.id, file: printPartPath(part), placement: part.placement, bounds: part.assemblyBounds
    }))
  }, null, 2) + '\n';
}

const PRINT_BED_WIDTH = 256, PRINT_BED_MARGIN = 4, PRINT_PART_GAP = 5;
// The X1C profile reserves an 18 × 28 mm rectangle for its cutter at the front-left corner.
const PRINT_X1C_CORNER = { x: 18 + PRINT_BED_MARGIN, y: 28 + PRINT_BED_MARGIN };

function printPlateBatches(parts) {
  const batches = new Map();
  for (const part of parts) {
    const material = [part.material ?? part.notes ?? []].flat().some(note => /\bPETG\b/i.test(note)) ? 'PETG' : 'Frame',
      phase = part.guide ? 'Fit samples' : 'Building pieces',
      name = phase + '/' + material;
    if (!batches.has(name)) batches.set(name, { material, phase, parts: [] });
    batches.get(name).parts.push(part);
  }
  return [...batches.values()].sort((a, b) =>
    Number(b.phase === 'Fit samples') - Number(a.phase === 'Fit samples') ||
    a.material.localeCompare(b.material));
}

function printPackPlates(parts) {
  const ordered = (part) => [Math.max(part.size[0], part.size[1]), part.size[0] * part.size[1]],
    edge = PRINT_BED_WIDTH - PRINT_BED_MARGIN, centeredEdge = PRINT_BED_WIDTH - PRINT_X1C_CORNER.x,
    plates = [], individual = [];
  function newShelf(plate, orientations) {
    const candidates = [],
      start = y => plate.centered || y < PRINT_X1C_CORNER.y ? PRINT_X1C_CORNER.x : PRINT_BED_MARGIN;
    for (const orientation of orientations) {
      const isWide = start(plate.nextY) + orientation.width > plate.edge + 1e-7,
        y = !plate.centered && isWide ? Math.max(plate.nextY, PRINT_X1C_CORNER.y) : plate.nextY,
        x = start(y);
      if (x + orientation.width <= plate.edge + 1e-7 && y + orientation.depth <= edge + 1e-7)
        candidates.push({ plate, orientation, y, x });
    }
    return candidates.sort((a, b) => a.y + a.orientation.depth - b.y - b.orientation.depth)[0];
  }
  for (const batch of printPlateBatches(parts)) {
    const group = [], sorted = [...batch.parts].sort((a, b) => {
      const [lengthA, areaA] = ordered(a), [lengthB, areaB] = ordered(b);
      return lengthB - lengthA || areaB - areaA || a.id.localeCompare(b.id);
    });
    for (const part of sorted) {
      const [width, depth] = part.size, orientations = [
        { width, depth, turn: 0 }, { width: depth, depth: width, turn: 90 }
      ], centered = Math.min(width, depth) <= centeredEdge - PRINT_X1C_CORNER.x + 1e-7,
        eligible = group.filter(plate => plate.centered === centered);
      let candidate = null;
      for (const plate of eligible) for (const shelf of plate.shelves) for (const orientation of orientations) {
        const remaining = plate.edge - shelf.nextX - orientation.width;
        if (orientation.depth > shelf.depth + 1e-7 || remaining < -1e-7) continue;
        if (!candidate || remaining < candidate.remaining)
          candidate = { plate, shelf, orientation, remaining };
      }
      if (!candidate) {
        let opening = eligible.map(plate => newShelf(plate, orientations)).find(Boolean);
        if (!opening) {
          const bed = { phase: batch.phase, material: batch.material, centered, edge: centered ? centeredEdge : edge,
            shelves: [], items: [], nextY: PRINT_BED_MARGIN };
          opening = newShelf(bed, orientations);
          if (!opening) {
            individual.push({ part, material: batch.material });
            continue;
          }
          group.push(bed);
        }
        const { plate, orientation, y, x } = opening,
          shelf = { y, nextX: x, depth: orientation.depth };
        plate.shelves.push(shelf);
        plate.nextY = y + orientation.depth + PRINT_PART_GAP;
        candidate = { plate, shelf, orientation };
      }
      const { plate, shelf, orientation } = candidate;
      plate.items.push({ part, x: shelf.nextX, y: shelf.y, ...orientation });
      shelf.nextX += orientation.width + PRINT_PART_GAP;
    }
    plates.push(...group);
  }
  return { plates, individual };
}

function printPlates(kit) {
  const { plates, individual } = printPackPlates(kit.parts), files = [],
    rows = [['plate', 'file', 'material', 'part_id', 'x_min_mm', 'y_min_mm', 'x_max_mm', 'y_max_mm', 'rotation_degrees', 'phase', 'placement_note']];
  for (const [i, { phase, material, items, centered }] of plates.entries()) {
    const number = i + 1, id = 'plate-' + String(number).padStart(3, '0') + '-' + material.toLowerCase(),
      name = 'plates/' + id + '.stl', triangles = [];
    for (const { part, x, y, width, depth, turn } of items) {
      rows.push([number, name, material, part.id, x, y, x + width, y + depth, turn, phase,
        centered ? 'Centered or original X1C bed position' : 'Keep original X1C bed position']);
      const at = turn ? ([a, b, c]) => [x + part.size[1] - b, y + a, c] : ([a, b, c]) => [x + a, y + b, c];
      for (const triangle of part.triangles) triangles.push(triangle.map(at));
    }
    files.push({ name, data: printPartSTL({ id, label: id, triangles }) });
  }
  for (const { part, material } of individual)
    rows.push(['', printPartPath(part), material, part.id, '', '', '', '', '', 'Individual placement',
      'Footprint needs manual arrangement around the X1C excluded corner']);
  return { files, count: plates.length, individual,
    csv: rows.map(row => row.map(value => printCSVCell(printNumber(value))).join(',')).join('\r\n') + '\r\n' };
}

const PRINT_GROUP_COLORS = ['#426957', '#93705a', '#4e7797', '#9072a0', '#aa8143', '#507e82', '#775f58'];

function printHull(points) {
  const unique = [...new Map(points.map(point => [point.join(','), point])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length < 3) return unique;
  const half = sequence => {
    const edge = [];
    for (const p of sequence) {
      while (edge.length > 1) {
        const [a, b] = edge.slice(-2);
        if ((b[0] - a[0]) * (p[1] - a[1]) > (b[1] - a[1]) * (p[0] - a[0])) break;
        edge.pop();
      }
      edge.push(p);
    }
    return edge.slice(0, -1);
  };
  return [...half(unique), ...half(unique.reverse())];
}

function printProjectedHull(part, first, second) {
  const { origin, x, y, z } = part.placement,
    transform = ([a, b, c], axis) => origin[axis] + a * x[axis] + b * y[axis] + c * z[axis];
  return printHull(part.triangles.flatMap(triangle =>
    triangle.map(point => [transform(point, first), transform(point, second)])));
}

function printAssemblyView(entries, vertical, title, left, top, width, height) {
  const first = 0, second = vertical ? 2 : 1,
    minimum = axis => entries.reduce((low, { part }) => Math.min(low, part.assemblyBounds.min[axis]), Infinity),
    maximum = axis => entries.reduce((high, { part }) => Math.max(high, part.assemblyBounds.max[axis]), -Infinity),
    startX = minimum(first), startY = minimum(second),
    spanX = maximum(first) - startX, spanY = maximum(second) - startY,
    box = `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="7" fill="#f7f8f3" stroke="#d8dfd7"/>
      <text x="${left + 15}" y="${top + 25}" class="head">${title}</text>`;
  if (!entries.length)
    return box + `<text x="${left + 15}" y="${top + 60}" class="body">Assembly pieces appear here when included in the kit.</text>`;
  const scale = Math.min((width - 60) / Math.max(1, spanX), (height - 83) / Math.max(1, spanY)),
    x = value => left + (width - spanX * scale) / 2 + (value - startX) * scale,
    y = value => top + 22 + (height - spanY * scale) / 2 + (spanY - value + startY) * scale,
    depth = vertical ? 1 : 2,
    sorted = [...entries].sort((a, b) => a.part.assemblyBounds.min[depth] - b.part.assemblyBounds.min[depth]),
    markers = [], marked = [];
  const outlines = sorted.map(({ part, number, color }) => {
    const hull = printProjectedHull(part, first, second), { min, max } = part.assemblyBounds,
      midX = x((min[first] + max[first]) / 2), midY = y((min[second] + max[second]) / 2),
      hint = `<title>${number} · ${printXMLText(part.label)} · ${printXMLText(part.id)}</title>`;
    if (marked.every(point => Math.hypot(point[0] - midX, point[1] - midY) >= 24)) {
      marked.push([midX, midY]);
      markers.push(`<g>${hint}<circle cx="${printNumber(midX)}" cy="${printNumber(midY)}" r="9" fill="#fffefa" stroke="${color}"/>
        <text x="${printNumber(midX)}" y="${printNumber(midY + 3.3)}" class="marker">${number}</text></g>`);
    }
    const points = hull.map(([u, v]) => printNumber(x(u)) + ',' + printNumber(y(v))).join(' ');
    return `<polygon points="${points}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-opacity="0.63" stroke-width="0.8">${hint}</polygon>`;
  });
  return box + outlines.join('') + markers.join('') +
    `<text x="${left + width - 14}" y="${top + height - 13}" text-anchor="end" class="note">${printDimension([spanX, spanY])} extent</text>`;
}

function printAssemblySVG(kit) {
  const width = 1120, viewTop = 103, viewHeight = 420, viewWidth = 526,
    groups = [...new Set(kit.parts.filter(part => !part.guide).map(part => part.group))],
    entries = kit.parts.flatMap((part, i) => part.guide ? [] : [{
      part, number: i + 1, color: PRINT_GROUP_COLORS[groups.indexOf(part.group) % PRINT_GROUP_COLORS.length]
    }]),
    column = 358, row = 37, indexTop = 591,
    height = indexTop + row * Math.ceil(entries.length / 3) + 40,
    source = kit.siteLinked ? 'Linked site geometry' : 'Standalone building',
    subheading = `1:${kit.denominator} · ${source}${kit.floors ? ` · ${kit.floors} levels` : ''}${kit.slotCount ? ` · ${kit.slotCount} perimeter positions` : ''}`,
    levelString = (part) => printNumber(part.assemblyBounds.min[2]) + ' to ' + printNumber(part.assemblyBounds.max[2]) + ' mm high in assembly',
    trim = (text, limit) => text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  const index = entries.map(({ part, number, color }, i) => {
    const left = 24 + i % 3 * column, top = indexTop + Math.floor(i / 3) * row;
    return `<g id="${printXMLText(part.id)}"><title>${printXMLText(part.label)}</title>
      <rect x="${left}" y="${top + 1}" width="21" height="21" rx="3" fill="${color}"/>
      <text x="${left + 10.5}" y="${top + 15}" class="index-number">${number}</text>
      <text x="${left + 30}" y="${top + 10}" class="body">${printXMLText(trim(part.label, 43))}</text>
      <text x="${left + 30}" y="${top + 25}" class="note">${printXMLText(trim(part.id + ' · ' + levelString(part), 55))}</text></g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>Poly Nation 3D Print Kit · Assembly sketch</title>
  <desc>Plan and elevation of projected part extents, plus a numbered list. See placement.json for exact transforms.</desc>
  <style>
    text{font-family:Arial,sans-serif;fill:#263b32}.title{font-size:28px;font-weight:bold}.head{font-size:15px;font-weight:bold}
    .body{font-size:13px}.note{font-size:11px;fill:#566b60}.marker,.index-number{font-size:10px;text-anchor:middle;font-weight:bold}
    .index-number{fill:#fff}
  </style>
  <rect width="100%" height="100%" fill="#fffefa"/>
  <text x="24" y="40" class="title">Poly Nation · Assembly sketch</text>
  <text x="24" y="63" class="body">${printXMLText(subheading)}</text>
  <text x="24" y="84" class="note">Coloured outlines show projected part extents. Overlapping pieces may share a marker position.</text>
  ${printAssemblyView(entries, false, 'Plan · XY', 24, viewTop, viewWidth, viewHeight)}
  ${printAssemblyView(entries, true, 'Elevation · XZ', 570, viewTop, viewWidth, viewHeight)}
  <text x="24" y="557" class="head">Part index</text>
  <text x="24" y="575" class="note">Match each identifier to its STL filename and the exact placement in placement.json.</text>
  ${index.join('\n')}
</svg>\n`;
}

function printInsertSheets(inserts) {
  const margins = 7, gap = 6, records = inserts.map((insert, i) => {
    const { shape } = insert;
    if (!Array.isArray(shape) || shape.length < 3 || !shape.every(p => p.length === 2 && p.every(Number.isFinite)))
      throw new TypeError('Invalid acrylic outline for ' + insert.label + '.');
    const minX = Math.min(...shape.map(p => p[0])), minY = Math.min(...shape.map(p => p[1]));
    return { insert, number: i + 1, minX, minY, labelHeight: 5,
      width: Math.max(...shape.map(p => p[0])) - minX, height: Math.max(...shape.map(p => p[1])) - minY };
  });
  const width = Math.max(192, ...records.map(r => r.width + 2 * margins)),
    patterns = [], annotations = [];
  let left = margins, top = 18, rowHeight = 0;
  for (const { insert, number, minX, minY, labelHeight, width: w, height: h } of records) {
    const cellWidth = Math.max(w, 11);
    if (left > margins && left + cellWidth + margins > width) {
      left = margins;
      top += rowHeight + gap;
      rowHeight = 0;
    }
    const outline = insert.shape.map(([x, y], i) => (i ? 'L' : 'M') +
      printNumber(left + x - minX) + ' ' + printNumber(top + y - minY)).join(' ') + ' Z';
    patterns.push(`<path id="${printXMLText(insert.id)}" d="${outline}"/>`);
    annotations.push(`<text x="${printNumber(left)}" y="${printNumber(top + h + 4)}">${number}</text>`);
    left += cellWidth + gap;
    rowHeight = Math.max(rowHeight, h + labelHeight);
  }
  const height = printNumber(top + rowHeight + margins), plotWidth = printNumber(width),
    header = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${plotWidth}mm" height="${height}mm" viewBox="0 0 ${plotWidth} ${height}">`,
    cuts = `<g id="cut-paths" fill="none" stroke="#000" stroke-width="0.10">${patterns.join('\n')}</g>`;
  const cutFile = `${header}
<title>Poly Nation acrylic insert outlines · millimetres</title>
${cuts}
</svg>\n`;
  const referenceFile = `${header}
<title>Poly Nation acrylic insert print reference · 1 to 1</title>
${cuts}
<g id="reference" fill="#344b40" font-family="Arial,sans-serif" font-size="2.9">
  <text x="7" y="6.5" font-weight="bold">Poly Nation · Acrylic inserts</text>
  <text x="7" y="11">Print at 100%. Match each number to inserts.csv.</text>
  <path d="M${plotWidth - 27} 13 v-2 h20 v2" fill="none" stroke="#344b40" stroke-width="0.25"/>
  <text x="${plotWidth - 17}" y="9.2" text-anchor="middle">20 mm check</text>
  ${annotations.join('\n')}
</g>
</svg>\n`;
  const rows = [['number', 'id', 'label', 'receiving_part_id', 'material_thickness_mm', 'width_mm', 'height_mm', 'notes']];
  for (const { insert, number, width: w, height: h } of records)
    rows.push([number, insert.id, insert.label, insert.partId, insert.thickness, w, h, insert.notes]);
  const csv = rows.map(row => row.map(value => printCSVCell(printNumber(value))).join(',')).join('\r\n') + '\r\n';
  return [
    { name: 'acrylic/cut-paths.svg', data: cutFile },
    { name: 'acrylic/print-reference.svg', data: referenceFile },
    { name: 'acrylic/inserts.csv', data: csv }
  ];
}

function printPackageREADME(kit, plates) {
  const quantities = new Map();
  for (const part of kit.parts) quantities.set(part.group, (quantities.get(part.group) ?? 0) + 1);
  const groups = [...quantities].map(([group, count]) => '  ' + group + ' — ' + count).join('\n'),
    guide = kit.parts.find(part => part.guide),
    site = kit.siteLinked ? 'Linked West Village placement' : 'Standalone building',
    structure = kit.runway ? 'Gantry support ' + kit.runway + '\n' : '',
    levels = kit.floors ? kit.floors + ' levels\n' : '',
    slots = kit.slotCount ? kit.slotCount + ' perimeter positions\n' : '',
    insertFiles = kit.inserts?.length ? 'acrylic/  1:1 cut outlines, printable reference and the insert-to-part schedule\n' : '',
    warnings = Array.isArray(kit.warnings) && kit.warnings.length ? '\nReview before slicing\n' +
      kit.warnings.map(warning => '• ' + warning).join('\n') + '\n' : '',
    instructions = [kit.instructions ?? []].flat().filter(Boolean).map(line => '• ' + line).join('\n');
  return `POLY NATION · 3D PRINT KIT
Scale 1:${kit.denominator} · Design seed ${kit.seed} · ${kit.detail} detail
${site}
${levels}${slots}${structure}
Contents
parts/           ${kit.parts.length} binary STL files in print orientation, one per numbered piece
plates/          ${plates.count} pre-arranged STL beds, in print order, each as a separate import
plates.csv       Bed numbers, material batches and exact on-bed positions and rotations
parts.csv        Quantity, print dimensions, assembly extents and overhang review counts
assembly.svg     Plan and elevation with a numbered part index
placement.json   Exact transforms from slicer coordinates to assembled model coordinates
${insertFiles}
${groups}

Slicing and fit
1. Choose the pre-arranged plate STL files for quicker setup or import individual parts to arrange your own beds. Open each plate separately as one object to preserve the spacing and orientation of its pieces. Import in millimetres at 100% using the Bambu Lab X1 Carbon profile for a 256 × 256 × 256 mm nominal build volume.
2. The arrangements use a ${PRINT_BED_MARGIN} mm bed margin around the edges and the X1C front-left cutter exclusion, with at least ${PRINT_PART_GAP} mm between part bounds. The part envelope is ${printDimension(Array.isArray(kit.limit) ? kit.limit : [kit.limit, kit.limit, kit.limit])}. If your slicer recenters an import, verify the reserved corner is clear. For plates marked “Keep original X1C bed position,” center the object's bounding box at the midpoint of the full plate bounds listed in plates.csv using millimetres from the front-left bed origin.${plates.individual.length ? ' The ' + plates.individual.length + ' items marked “Individual placement” need manual arrangement around the reserved corner.' : ''}
3. Use the material named in plates.csv for PETG spring shoes and your chosen frame material for the Frame batches. Keep the printed orientations for the initial pass. Check any additional space needed for brims and supports. Inspect the sliced preview for first-layer contact, steep overhangs, unsupported spans, fragile edges, separate islands and mating faces.
4. The geometry uses ${printNumber(kit.minWall)} mm as the study minimum thickness and ${printNumber(kit.clearance)} mm as the joint clearance setting. Some architectural features are thickened or omitted to suit the output scale. Verify the result with your extrusion width, material and slicer.
5. ${guide ? 'Start with the Fit samples plates to check the joints and rails. For individual imports, use the sample pieces listed in parts.csv.' : 'Print one small mating pair before committing to the full kit.'} Check the fit after the pieces cool. Adjust your slicer’s horizontal compensation if needed and check another sample before printing the final pieces.

Assembly
Match the printed STL names to parts.csv and assembly.svg. Dry-fit mating faces as you go. For a digital assembly, apply the coordinate transforms in placement.json to the original STL vertices.
${instructions ? '\nDesign-specific assembly notes\n' + instructions + '\n' : ''}${warnings}${kit.inserts?.length ? `
Acrylic inserts
Use acrylic/cut-paths.svg for the cutter. It contains closed outlines at 1:1 in millimetres. Select the cutting operation and kerf compensation in your controller. Use acrylic/print-reference.svg for manual work, print at 100% (tile if needed), then measure the 20 mm check bar. Pair each insert with its printed receiving part using acrylic/inserts.csv. Check sheet thickness and fit a small sample before cutting the full set.
` : ''}
`;
}

function buildPrintPackage(kit) {
  if (!kit.parts.length) throw new RangeError('Choose at least one part for the print package.');
  const plates = printPlates(kit), files = [
    { name: 'README.txt', data: printPackageREADME(kit, plates) },
    { name: 'parts.csv', data: printPartsCSV(kit) },
    { name: 'plates.csv', data: plates.csv },
    { name: 'assembly.svg', data: printAssemblySVG(kit) },
    { name: 'placement.json', data: printPlacementJSON(kit) },
    ...kit.parts.map(part => ({ name: printPartPath(part), data: printPartSTL(part) })),
    ...plates.files,
    ...(kit.inserts?.length ? printInsertSheets(kit.inserts) : [])
  ];
  const filename = 'poly-nation-3d-print-1-' + kit.denominator + '-' + printFileSlug(kit.seed) + '.zip';
  return { bytes: printStoredZIP(files), filename, files };
}

function downloadPrintPackage(kit) {
  const { bytes, filename } = buildPrintPackage(kit);
  downloadBlob(bytes, 'application/zip', filename);
}
