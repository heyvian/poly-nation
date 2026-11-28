"""Verify the print workspace and inspect the downloaded meshes independently."""

from collections import defaultdict
from csv import DictReader
from io import StringIO
import json
from math import atan2, isfinite, pi
import os
from pathlib import Path
import re
import shutil
import struct
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

from browser_fixture import serve_lab


KIT_LIMIT_MM = 248
# The X1 Carbon has a 256 mm nominal cube. The kit reserves 8 mm per axis.
BED_BORDER_MM = 4
PART_GAP_MM = 5
WELD_MM = 0.0001
BED_TOLERANCE_MM = 0.02
TRIANGLE = struct.Struct('<12fH')


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def subtract(a, b):
    return tuple(u - v for u, v in zip(a, b))


def dot(a, b):
    return sum(u * v for u, v in zip(a, b))


def read_stl(payload, name):
    assert len(payload) >= 84, name
    count, = struct.unpack_from('<I', payload, 80)
    assert count > 0 and len(payload) == 84 + TRIANGLE.size * count, (name, count, len(payload))
    vertices, faces, indices = [], [], {}
    for record in TRIANGLE.iter_unpack(payload[84:]):
        assert all(isfinite(value) for value in record[:12]), name
        face = []
        for axis in (3, 6, 9):
            point = record[axis:axis + 3]
            key = tuple(round(value / WELD_MM) for value in point)
            if key not in indices:
                indices[key] = len(vertices)
                vertices.append(point)
            face.append(indices[key])
        faces.append(tuple(face))
    return vertices, faces


def verify_stl(payload, name):
    vertices, faces = read_stl(payload, name)
    axes = list(zip(*vertices))
    size = [max(axis) - min(axis) for axis in axes]
    assert all(0 < span <= KIT_LIMIT_MM + BED_TOLERANCE_MM for span in size), (name, size)
    assert abs(min(axes[2])) <= BED_TOLERANCE_MM, (name, min(axes[2]))

    directed_edges, vertex_links = set(), defaultdict(dict)
    face_keys, contact_area = set(), 0
    vertex_volume, vertex_contact = defaultdict(float), defaultdict(float)
    for face in faces:
        key = tuple(sorted(face))
        assert len(set(face)) == 3 and key not in face_keys, (name, 'duplicate or welded triangle', face)
        face_keys.add(key)
        a, b, c = (vertices[index] for index in face)
        normal = cross(subtract(b, a), subtract(c, a))
        assert dot(normal, normal) > 1e-14, (name, 'zero-area triangle', face)
        for u, v, w in zip(face, (face[1], face[2], face[0]), (face[2], face[0], face[1])):
            assert (u, v) not in directed_edges, (name, 'non-manifold or misoriented edge', u, v)
            directed_edges.add((u, v))
            vertex_links[u][v] = w
        vertex_volume[face[0]] += dot(a, cross(b, c)) / 6
        if max(abs(point[2]) for point in (a, b, c)) <= BED_TOLERANCE_MM and normal[2] < 0:
            area = -normal[2] / 2
            contact_area += area
            vertex_contact[face[0]] += area
    for u, v in directed_edges:
        assert (v, u) in directed_edges, (name, 'open edge', u, v)

    # A watertight edge count alone would accept two shells pinched at one vertex.
    for vertex, links in vertex_links.items():
        entry = step = next(iter(links))
        length = 0
        while step in links:
            step = links[step]
            length += 1
            if step == entry or length > len(links):
                break
        assert step == entry and length == len(links), (name, 'split vertex link', vertex)

    unseen = set(range(len(vertices)))
    components = 0
    while unseen:
        stack = [unseen.pop()]
        volume, bed = 0, 0
        while stack:
            vertex = stack.pop()
            volume += vertex_volume[vertex]
            bed += vertex_contact[vertex]
            for neighbour in vertex_links[vertex]:
                if neighbour in unseen:
                    unseen.remove(neighbour)
                    stack.append(neighbour)
        assert volume > 0.001, (name, 'inward or empty shell', volume)
        assert bed > 0.01, (name, 'shell without a bed face', bed)
        components += 1
    return vertices, size, components, contact_area


def verify_placement(vertices, placement, name):
    origin = placement['origin']
    basis = [placement[axis] for axis in 'xyz']
    assert all(isfinite(value) for vector in [origin, *basis] for value in vector), name
    for first, axis in enumerate(basis):
        for second, other in enumerate(basis):
            assert abs(dot(axis, other) - (first == second)) < 1e-6, (name, basis)
    assert dot(cross(*basis[:2]), basis[2]) > 1 - 1e-6, (name, 'reflected print placement')
    world = [tuple(origin[i] + sum(coordinate * axis[i] for coordinate, axis in zip(vertex, basis))
                   for i in range(3)) for vertex in vertices]
    axes = list(zip(*world))
    return [[min(axis) for axis in axes], [max(axis) for axis in axes]]


def near_dimensions(measured, reported, name):
    assert len(measured) == len(reported), (name, measured, reported)
    assert all(abs(a - float(b)) < BED_TOLERANCE_MM for a, b in zip(measured, reported)), (
        name, measured, reported
    )


def vector_svg(payload, name):
    svg = ET.fromstring(payload)
    assert svg.tag == '{http://www.w3.org/2000/svg}svg', name
    assert not svg.findall('.//{*}image'), name
    return svg


def verify_inserts(package, printable_ids):
    cuts = vector_svg(package.read('acrylic/cut-paths.svg'), 'acrylic/cut-paths.svg')
    reference = vector_svg(package.read('acrylic/print-reference.svg'), 'acrylic/print-reference.svg')
    for svg in (cuts, reference):
        viewbox = [float(value) for value in svg.attrib['viewBox'].split()]
        assert svg.get('width', '').endswith('mm') and svg.get('height', '').endswith('mm')
        near_dimensions(viewbox[2:], [svg.attrib[axis][:-2] for axis in ('width', 'height')], 'acrylic 1:1')
    outlines = {path.attrib['id']: path.attrib['d'] for path in cuts.findall('.//{*}path')}
    rows = list(DictReader(StringIO(package.read('acrylic/inserts.csv').decode())))
    assert len(outlines) == len(rows) > 0 and set(outlines) == {row['id'] for row in rows}
    for row in rows:
        outline = outlines[row['id']]
        coords = [(float(x), float(y)) for x, y in re.findall(r'[ML](-?[\d.]+) (-?[\d.]+)', outline)]
        assert len(coords) >= 3 and outline.endswith(' Z'), row['id']
        width, height = [max(axis) - min(axis) for axis in zip(*coords)]
        near_dimensions([width, height], [row['width_mm'], row['height_mm']], row['id'])
        assert row['receiving_part_id'] in printable_ids and float(row['material_thickness_mm']) > 0, row
    assert any('h20' in path.attrib['d'] for path in reference.findall('.//{*}path'))


def verify_plates(package, parts):
    packed = list(DictReader(StringIO(package.read('plates.csv').decode())))
    assert len(packed) == len(parts) and {row['part_id'] for row in packed} == set(parts)
    by_plate = defaultdict(list)
    for row in packed:
        by_plate[row['file']].append(row)
    assert set(by_plate) == {name for name in package.namelist() if name.startswith('plates/') and name.endswith('.stl')}
    assert {row['material'] for row in packed} == {'Frame', 'PETG'}
    fit_samples = [int(row['plate']) for row in packed if row['phase'] == 'Fit samples']
    building_pieces = [int(row['plate']) for row in packed if row['phase'] == 'Building pieces']
    assert fit_samples and building_pieces and max(fit_samples) < min(building_pieces)
    for name, rows in by_plate.items():
        vertices, _, components, _ = verify_stl(package.read(name), name)
        assert components == sum(int(parts[row['part_id']]['components']) for row in rows), name
        rectangles = []
        assert len({row['material'] for row in rows}) == 1, name
        for row in rows:
            box = tuple(float(row[key]) for key in ('x_min_mm', 'y_min_mm', 'x_max_mm', 'y_max_mm'))
            left, bottom, right, top = box
            assert min(left, bottom) >= BED_BORDER_MM - BED_TOLERANCE_MM, (name, box)
            assert max(right, top) <= 256 - BED_BORDER_MM + BED_TOLERANCE_MM, (name, box)
            assert left >= 22 - BED_TOLERANCE_MM or bottom >= 32 - BED_TOLERANCE_MM, (name, box)
            for x0, y0, x1, y1 in rectangles:
                assert max(x0 - right, left - x1, y0 - top, bottom - y1) >= PART_GAP_MM - BED_TOLERANCE_MM, (name, box)
            rectangles.append(box)
            source = parts[row['part_id']]
            span = [source['bed_x_mm'], source['bed_y_mm']]
            rotation = float(row['rotation_degrees'])
            assert rotation % 90 == 0, row
            if rotation % 180:
                span.reverse()
            near_dimensions([right - left, top - bottom], span, row['part_id'])
        xs, ys, _ = zip(*vertices)
        bounds = [min(box[0] for box in rectangles), min(box[1] for box in rectangles),
                  max(box[2] for box in rectangles), max(box[3] for box in rectangles)]
        near_dimensions([min(xs), min(ys), max(xs), max(ys)], bounds, name)
        if all(row['placement_note'] == 'Centered or original X1C bed position' for row in rows):
            dx = (256 - bounds[0] - bounds[2]) / 2
            dy = (256 - bounds[1] - bounds[3]) / 2
            assert all(left + dx >= 22 - BED_TOLERANCE_MM or bottom + dy >= 32 - BED_TOLERANCE_MM
                       for left, bottom, _, _ in rectangles), name


def verify_package(path, scale, seed, single, acrylic=False):
    with ZipFile(path) as package:
        names = package.namelist()
        assert len(names) == len(set(names)) and package.testzip() is None
        summary = package.read('README.txt').decode()
        assert f'1:{scale}' in summary and '248' in summary
        parts = list(DictReader(StringIO(package.read('parts.csv').decode())))
        assert parts and {part['file'] for part in parts} == {
            name for name in names if name.startswith('parts/') and name.endswith('.stl')
        }
        assert len({part['id'] for part in parts}) == len(parts)
        assert package.read('parts/' + single.suggested_filename) == single.path().read_bytes()
        placement = json.loads(package.read('placement.json'))
        assert placement['units'] == 'mm' and placement['scale'] == scale and placement['seed'] == seed, placement.keys()
        assert placement['worldAxes'] == ['scene X', 'negative scene Z', 'scene Y']
        assemblies = {part['id']: part for part in placement['parts']}
        assert len(assemblies) == len(placement['parts']) > 1
        assert set(assemblies) <= {part['id'] for part in parts}
        vector_svg(package.read('assembly.svg'), 'assembly.svg')
        if acrylic:
            verify_inserts(package, set(assemblies))
        else:
            assert not any(name.startswith('acrylic/') for name in names)

        for part in parts:
            name = part['file']
            vertices, measured, components, _ = verify_stl(package.read(name), name)
            near_dimensions(measured, [part[key] for key in ('bed_x_mm', 'bed_y_mm', 'height_mm')], name)
            assert components == int(part['components']) and int(part['steep_overhang_faces']) >= 0, name
            if part['id'] not in assemblies:
                assert not part['assembly_x_min_mm'], name
                continue
            assembly = assemblies[part['id']]
            assert assembly['file'] == name, name
            low, high = verify_placement(vertices, assembly['placement'], name)
            near_dimensions(low, assembly['bounds']['min'], name)
            near_dimensions(high, assembly['bounds']['max'], name)
        verify_plates(package, {part['id']: part for part in parts})
    return parts, assemblies


def verify_mast(assemblies):
    assert 'mast-foundation-key' in assemblies and 'swing-crown' in assemblies
    sections = sorted(part for part in assemblies if part.startswith('mast-section-'))
    assert len(sections) == 3, sections
    shafts = [assemblies[part]['bounds'] for part in sections]
    assert all(lower['min'][2] < upper['min'][2] < lower['max'][2] for lower, upper in zip(shafts, shafts[1:])), shafts
    assert min(shaft['max'][2] for shaft in shafts) > 0
    crown = assemblies['swing-crown']['bounds']
    center = [(lo + hi) / 2 for lo, hi in zip(crown['min'], crown['max'])]
    bearings = []
    for index in range(1, 9):
        bounds = assemblies[f'swing-seat-{index:02}']['bounds']
        x, y, _ = [(lo + hi) / 2 - origin for lo, hi, origin in zip(bounds['min'], bounds['max'], center)]
        bearings.append(atan2(y, x) % (2 * pi))
    bearings.sort()
    for a, b in zip(bearings, bearings[1:] + [bearings[0] + 2 * pi]):
        assert abs((b - a) - pi / 4) < 0.08, bearings


def verify_modules(assemblies):
    modules = {part: record for part, record in assemblies.items() if part.startswith('module-')}
    assert modules
    bearings = set()
    for part, record in modules.items():
        tray = assemblies[part.replace('module-', 'dock-', 1)]
        module_pose, tray_pose = record['placement'], tray['placement']
        for axis in 'xyz':
            near_dimensions(module_pose[axis], tray_pose[axis], part)
        radial = module_pose['x']
        bearings.add(round(atan2(radial[1], radial[0]), 3))
        extension = dot(subtract(module_pose['origin'], tray_pose['origin']), radial)
        assert extension > 0.35, (part, 'The dock tongue must extend toward the core.', extension)
        gap = record['bounds']['min'][2] - tray['bounds']['max'][2]
        assert abs(gap) < BED_TOLERANCE_MM, (part, 'Module does not seat on its tray.', gap)
    assert len(bearings) >= 8, bearings


def generate_kit(page):
    page.locator('#printGenerate').click()
    page.wait_for_function('!document.getElementById("printDownloadKit").disabled || '
                           'document.getElementById("printStatus").hasAttribute("data-error")', timeout=60_000)
    assert page.locator('#printDownloadKit').is_enabled(), page.locator('#printStatus').text_content()
    expect(page.locator('#printDownloadPart')).to_be_enabled()


def verify_canal_variant(page):
    checks = page.evaluate('''() => {
      const terrain = { size: 480, count: 17, datum: 1040, elevations: Array(289).fill(1041) },
        a = [-115, -7], b = [115, -7], c = [115, 7], d = [-115, 7],
        water = { level: 1040.35, existing: [], proposed: [[a, b, c], [a, c, d]] },
        plan = siteFoundationPlan(model, terrain, { position: [0, 0], bearing: 0, grade: 0, water }),
        placed = sitePlacementModel(model, plan), denominator = 300,
        kit = generatePrintKit(placed, { denominator, detail: 'assembly' }),
        removed = model.slots.filter(slot => plan.omitted.has(slot.i) && !slot.blocked && dockInUse(slot)),
        ids = new Set(kit.parts.map(part => part.id)),
        floors = kit.parts.filter(part => part.id.startsWith('core-level-1-'));
      return {
        linked: kit.siteLinked && Boolean(plan.anchor),
        wetDocks: removed.length > 0 && removed.every(({ f, j }) =>
          !ids.has('dock-l' + (f + 1) + '-b' + (j + 1)) && !ids.has('module-l' + (f + 1) + '-b' + (j + 1))),
        opening: floors.length > 0 && floors.every(({ triangles, placement: { origin, x, y, z } }) =>
          triangles.every(face => face.every(([a, b, c]) => Math.abs(origin[1] + x[1] * a + y[1] * b + z[1] * c) > 2 * 1000 / denominator)))
      };
    }''')
    assert all(checks.values()), checks


def run():
    root = Path(__file__).resolve().parents[1]
    with serve_lab(root) as url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
        )
        page = browser.new_page(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        snapshot = 'JSON.stringify([state.seed, model.R, model.total, model.rooms, model.slots])'
        page.evaluate('state.simRunning = state.animateSwing = false')
        before = page.evaluate(snapshot)
        seed = page.evaluate('state.seed')
        page.locator('#openPrint').click()
        expect(page.locator('#printPhase')).to_be_visible()
        expect(page.locator('#openPrint')).to_have_attribute('aria-current', 'page')
        expect(page.locator('#printScale')).to_have_value('200')
        expect(page.locator('#printDetail')).to_have_value('massing')

        generate_kit(page)
        expect(page.locator('#printCanvas')).to_be_visible()
        page.locator('#printOriented').click()
        expect(page.locator('#printOriented')).to_have_attribute('aria-pressed', 'true')
        page.locator('#printPartList').select_option('rail-fit-test')
        with page.expect_download(timeout=60_000) as one:
            page.locator('#printDownloadPart').click()
        assert one.value.suggested_filename == 'rail-fit-test.stl'
        with page.expect_download(timeout=60_000) as all_parts:
            page.locator('#printDownloadKit').click()
        kit = all_parts.value
        assert kit.suggested_filename == f'poly-nation-3d-print-1-200-{seed}.zip'
        parts, assemblies = verify_package(kit.path(), 200, seed, one.value)
        assert len({part['group'] for part in parts}) > 2, page.locator('#printStatus').text_content()
        assert 'rail-fit-test' not in assemblies and 'gantry-clip-fit-test' not in assemblies
        assert any(part.startswith('rail-roof-outer-') for part in assemblies)
        verify_mast(assemblies)
        assert any(part.startswith('module-') and part.replace('module-', 'dock-', 1) not in assemblies
                   for part in assemblies), 'Massing should combine compatible modules and trays.'

        page.locator('#printScale').select_option('300')
        page.locator('#printDetail').select_option('structure')
        expect(page.locator('#printDownloadKit')).to_be_disabled()
        generate_kit(page)
        with page.expect_download(timeout=60_000) as one:
            page.locator('#printDownloadPart').click()
        with page.expect_download(timeout=60_000) as structural:
            page.locator('#printDownloadKit').click()
        assert structural.value.suggested_filename == f'poly-nation-3d-print-1-300-{seed}.zip'
        _, structural_assemblies = verify_package(structural.value.path(), 300, seed, one.value, acrylic=True)
        verify_modules(structural_assemblies)
        verify_canal_variant(page)

        assert page.evaluate(snapshot) == before
        assert not errors, errors
        mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mobile.goto(url)
        mobile.locator('#openPrint').click()
        expect(mobile.locator('#printPhase')).to_be_visible()
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        browser.close()
    print('3D Print workspace, bed orientations, STL topology, assembly placement and vector templates passed.')


if __name__ == '__main__':
    run()
