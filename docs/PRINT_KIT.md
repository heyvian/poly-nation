# 3D print study

Use **3D Print** to turn the current design into a physical model. The generator uses the selected core perimeter, actual dock assignments, linked site if present, and gantry support choice. **Massing** prints solid model volumes. **Assembly** opens the core into floor and module pieces and leaves room for clear-sheet glazing at supported openings. **Structure** adds a schematic representation of the load-bearing elements and gantry frame.

## Size and bed orientation

The X1 Carbon’s nominal build volume is 256 × 256 × 256 mm. The generator allocates 248 mm per part on each axis. The preview shows the overall assembled size, the orientation of the selected STL and the part's measured dimensions. It flags steep downward faces above the bed for review. Import the STLs as millimetres at 100%. Use the supplied bed layouts or arrange individual parts in Bambu Studio. Confirm that recentering, brims and supports leave the 18 × 28 mm front-left exclusion clear. [Bambu Studio X1 Carbon 0.4 mm nozzle profile](https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/machine/Bambu%20Lab%20X1%20Carbon%200.4%20nozzle.json)

The fabrication geometry is derived from the architecture. Thin elements can be enlarged, towers can be split into segments, and delicate features are represented schematically. Seams need to be kept square and test fitted. The generator checks each part's bounds, closed edge pairs, face winding, shell volume and contact with the print bed. A closed mesh can still require support or a fit adjustment. The gantry rail and spring shoes use deliberate model-scale profiles and hand operation. Use the coupon first and check that the shoe can flex and slide cleanly before printing the whole rail.

## Kit files

- `parts/` has one oriented binary STL for each numbered piece.
- `plates/` groups parts on shared beds. `plates.csv` lists the pieces and positions on each bed. The fit samples and flexible PETG shoes have their own batches.
- `parts.csv` maps file names to dimensions, groups and print notes.
- `assembly.svg` shows how the parts locate in plan and elevation. `placement.json` holds their exact assembly transforms in millimetres.
- When clear-sheet seats fit, `acrylic/` has 1:1 closed cut paths, a printable reference with a scale check, and the insert schedule. Use the cut-only SVG in the cutter, confirm material thickness, and adjust for kerf after checking a sample.

The kit is intended for an architectural exhibit model. Physical fit depends on printer calibration, filament and slice settings. The fabrication geometry and joints have been checked in software. A sample print is needed to confirm the working fit on a specific machine.
