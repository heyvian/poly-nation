# Simulation and scoring — V3.6

## Research intent
The user wants to compare how architectural distributions affect opportunities for cross-pollination across people and non-human occupants, rather than optimizing a static count of lobbies. Shared lobbies have highest encounter value, room co-occupation next, public gathering higher than passing. Room memories and recent fun should increase value. The implemented numerical model is an experimental hypothesis, not empirically validated social interaction, accessibility, crowd flow or animal behavior.

## Mechanics
`buildNavigation(m)` constructs nodes/edges from program rooms, modules, thresholds, circulation and hubs, lifts, greenhouse, roof, balconies/gardens, entry/plaza, activity islands and recreation. `makeOccupancy(m)` creates seeded human and animal populations. Humans visit rooms, modules, public destinations and rides. Dogs occupy public routes; birds/rabbits/squirrels use exterior/roof destinations; humans/dogs enter and leave via plaza (some initially placed inside). Lifts traverse virtual vertical edges. Dwell, probabilistic destination selection, pathfinding, last departed room/program memory and temporary attraction towards feasible hubs drive movement. No physical collision avoidance. Wheelchair geometry and speeds do not constitute accessibility verification.

Default seed 606; 36 human visitors; live speed 3×; fixed simulation increments 0.25 s, score sample each simulated second. `advanceScored` integrates both. Visual toggles don't change population counts. Building changes restart the live simulation. Simulation continues in rationale view unless paused.

A furnished shared lobby connects its two programme rooms and routes the local corridor through both arches. Room footprints and corridor strips swap sides at the approaches. On two-band floors both sides bend with the rooms. Any dock threshold taken by a façade-facing room is reserved, and the other docks stay on the public route. The solver keeps manually assigned docks and can fit one fewer module when that makes a feasible through-lobby possible. Encounters in the furnished space retain the shared-lobby weight.

Human and dog routes can enter either ground-floor lobby from the public promenade and cross the biofiltration greenhouse on straight approaches joined by a circular walk. Agents can take either side of the swing mast. The crossing uses the same geometry as the modeled paving. Encounters there use the existing greenhouse scoring weights.

Optional upper-floor atrium bridges give agents a shortcut between sectors of the same floor. The routes connect both ends to the outer corridor, use the existing corridor weights and participate in shortest-path routing. Trial comparisons log changes to the bridge arrangement and the resulting bridge count. Stairs above the glazing connect the public roof to the swing platform at the ridge. Simulated visitors who use wheelchairs stay on routes without stairs.

Climb: ascend then descend to base, completion records fun; wall max 19.8 m. Slide: direct upper/lower IR landings, travel along swept path, recreation memory. Swing: `SWING_CYCLE`, `swingPose`, `buildSwing`, `advanceRide` follow 136 s cycle (18 boarding, 22 ascend, 60 cruise, 26 descend, 10 unload), 18 seats; modeled 40 km/h cruise and 12 m reference radius. Chain angle quasi-static speed-dependent. Queue at roof-level platform, stay seated in motion, unload onto same platform and accrue recent fun upon completion. The code's cycle offset starts at cruise rather than empty boarding. Durations except user-defined 60 s top dwell are implementation defaults.

## Score definition (checked in source)
`scoreSample(s,dt)` checks active pair distance ≤ 2.5 m and compatible zones: same floor, same zone or connected eligible adjacent like-category cells (corridor/plaza/roof/garden/greenhouse, excluding lift edges). Transit without an eligible zone does not score. Pair encounter is fresh if last eligible contact was >8 s ago. Each continuous encounter has ≤15 credited seconds. Counts and bonuses tracked; different human/non-human and different-kind encounters distinguished. The multiplier uses different agent kinds. Time denominator includes all active human and non-human agents. Editable base weights per ten credited seconds:

| Context | Default |
|---|---:|
| Shared lobby | 5 |
| Room/module/retail and slide landing | 3 |
| Garden/gazebo/outdoor | 2.5 |
| Plaza/entry/lobby | 2.5 |
| Balcony | 2.5 |
| Greenhouse | 2.5 |
| Ride / swing / climbing destination | 2.5 |
| Roof | 2 |
| Corridor/lift link | 0.5 |

Points = base weight × credited seconds/10 × applicable multipliers. Different remembered rooms (both non-null) ×1.5; different remembered programs (both non-null) ×1.2; different kinds ×1.3; either agent completed fun within 90 simulated seconds ×1.4. Example: ten seconds of a shared lobby encounter with different prior rooms/programs and recent fun = 5 × 1.5 × 1.2 × 1.4 = 12.6 points. Normalized rate = total weighted points × 100 / active-agent-minutes. Not a percentage or capped score. Live dashboard warms up before displaying the rate. Treat as modeled co-presence, not proof conversations occurred.

## Compare
**Run Pollination Trial** opens the trial log and advances five simulated minutes as fast as the browser can compute them. It uses an independent population while the live simulation continues at its selected speed. The oldest retained entry shows the baseline. Later entries show changed settings first, followed by differences in the generated layout and encounters. Each row highlights its new value. Score differences are displayed when the seed, visitor count, and scoring weights and multipliers match. A change of at least 10% and 5 points is flagged as major. The five-point minimum also applies when the prior score is zero. These labels describe the size of an individual result. Change one variable at a time and repeat across seeds to assess consistency. The eight most recent trials are saved locally and included in JSON exports with their model thumbnails.

**Optimize layout** tests up to eight alternative placements for the existing modules. It keeps the core rooms, program areas, module counts, visitor count, scoring weights, and topology rules fixed. Candidates must preserve manual module assignments and meet the Firehall and same-floor Repel rules. It ranks placements by their average score over three five-minute trials using the same simulation seeds for every candidate. The search previews the best sampled layout if it improves on the current one. **Apply layout** runs a fast trial on the applied layout and saves the result in the trial log.

**Optimize allocation** compares up to eight built core-to-module splits. It exchanges one to three 81 m² modules between programs and moves a shared core partition to transfer exactly the same area in the opposite direction. This keeps each program’s total floor area, the building’s enclosed area, and the total module count fixed. Candidates honor room minimums, reserved docks, manual assignments, Firehall stacking, and same-floor Repel. The search uses the same matched trials as Optimize layout. The preview shows the core share for each affected program. **Apply allocation** saves the exchange and runs a pollination trial. Changing a core-share preference or generating a new variation clears the exchanges.

## Known limitations
Heuristic topology and room connectivity, schematic ride loading and elevator use, no validated pedestrian accessibility, wildlife ethology, crowd capacity or ride safety. Score threshold and weights selected by AI to operationalize student priorities, not calibrated by data. Need sensitivity analysis and real-world evidence for any performance claim. Current code is authority if docs and implementation diverge; reconcile openly rather than silently changing model.
