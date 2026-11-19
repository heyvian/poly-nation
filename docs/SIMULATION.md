# Simulation and scoring — V3.6

## Research intent
The user wants to compare how architectural distributions affect opportunities for cross-pollination across people and non-human occupants, rather than optimizing a static count of lobbies. Shared lobbies have highest encounter value, room co-occupation next, public gathering higher than passing. Room memories and recent fun should increase value. The implemented numerical model is an experimental hypothesis, not empirically validated social interaction, accessibility, crowd flow or animal behavior.

## Mechanics
`buildNavigation(m)` constructs nodes/edges from program rooms, modules, thresholds, circulation and hubs, lifts, greenhouse, roof, balconies/gardens, entry/plaza, activity islands and recreation. `makeOccupancy(m)` creates seeded human and animal populations. Humans visit rooms, modules, public destinations and rides. Dogs occupy public routes; birds/rabbits/squirrels use exterior/roof destinations; humans/dogs enter and leave via plaza (some initially placed inside). Lifts traverse virtual vertical edges. Dwell, probabilistic destination selection, pathfinding, last departed room/program memory and temporary attraction towards feasible hubs drive movement. No physical collision avoidance. Wheelchair geometry and speeds do not constitute accessibility verification.

Default seed 606; 36 human visitors; live speed 3×; fixed simulation increments 0.25 s, score sample each simulated second. `advanceScored` integrates both. Visual toggles don't change population counts. Building changes restart the live simulation. Simulation continues in rationale view unless paused.

Climb: ascend then descend to base, completion records fun; wall max 19.8 m. Slide: direct upper/lower IR landings, travel along swept path, recreation memory. Swing: `SWING_CYCLE`, `swingPose`, `buildSwing`, `advanceRide` follow 106 s cycle (18 boarding, 22 ascend, 30 cruise, 26 descend, 10 unload), 18 seats; modeled 60 km/h cruise and 15 m reference radius. Chain angle quasi-static speed-dependent. Queue at roof-level platform, stay seated in motion, unload onto same platform and accrue recent fun upon completion. The code's cycle offset starts at cruise rather than empty boarding. Durations except user-defined 30 s top dwell are implementation defaults.

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
Use separate deterministic five-minute trials (live unchanged), same seed, population, duration, weights and bonuses when comparing geometry. Repeat across seeds to assess sensitivity, change one variable at a time. Up to eight recent comparison records; JSON schema 17 includes settings, live summary and comparison history, not exact live paths. `cpSignature()` identifies comparable seed/visitor/weight/bonus settings; a matching signature does not mean building geometry is identical. Current UI shows live normalized rate, encounter stats and trial separately. Do not assume that additional lobbies automatically improve result.

## Known limitations
Heuristic topology and room connectivity, schematic ride loading and elevator use, no validated pedestrian accessibility, wildlife ethology, crowd capacity or ride safety. Score threshold and weights selected by AI to operationalize student priorities, not calibrated by data. Need sensitivity analysis and real-world evidence for any performance claim. Current code is authority if docs and implementation diverge; reconcile openly rather than silently changing model.
