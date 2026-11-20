# Design rationale — text companion to Design_Rationale.html

Text companion to the illustrated architectural record. Early decisions are paraphrased where original messages are unavailable.

Poly Nation – Design Rationale

POLY NATION / DESIGN RECORD / NOVEMBER 2026

Print / save as PDF

Design intent · authorship · computational translation

Architecture as a

cross-pollination system.

A permanent architectural framework accommodates changeable programs, deliberately configured relationships and more-than-human occupants. The laboratory asks how changes to the building and its social infrastructure influence the opportunities for encounters.

Design direction and research concept

Student / project designer

Computational implementation and iterative assistance

ChatGPT (AI-assisted development)

Generated axonometric showing the annular core, radial modules, public roof and atrium swing.

Designer-led

What should the system do?

The building concept, program mix, permanent vs. adaptive strategy, relationships, circulation, play, inclusive occupation, simulation logic and metric priorities were directed by the student.

AI implementation

How can it be computed?

ChatGPT translated the brief into generated geometry, room and module placement, circulation networks and an encounter simulation.

Iterative decisions

What was refined together?

Room sizes, clearances, clustering rules, circulation details and encounter weights include AI proposals, student corrections and revisions.

Attribution rule:

Designer-led

means the design requirement or concept is traceable to the student's requests, not that every parameter or line of code was authored by the student. AI proposals and computational assumptions are identified separately. Early prompts are available in retrieved summaries, so early statements are paraphrased rather than presented as verbatim quotations. Later quotations are from the visible conversation.

## Atrium and roofline

**Designer-led**

### Opposing lobby atriums

Two facing ground-floor lobbies connect the public plaza through the Infinite Rinse biofiltration greenhouse. Their axis runs perpendicular to the lift cores. The designer added this through-route to increase cross-traffic and create more opportunities for indoor and outdoor visitors to meet.

A straight path from each lobby joins a circular walk around the mast. Galleries carry the upper corridor across both lobby voids.

### Radial and vertically aligned bridges

Optional upper-floor bridges pass close to the mast and join the outer corridor at both ends. Glass railings line the bridges and open atrium edges. The designer wanted to test whether the shortcuts increase cross-pollination.

Stacking the bridges keeps them in one part of the atrium. Rotating them around it changes which parts of the greenhouse and the opposite side of the ring are visible from each floor.

### Pitched glass roof and two-storey pavilions

The designer raised the glass roof toward the swing mast. Its inner ring rises up to two storeys above the public deck. Some rooftop pavilions have a set-back second storey, varying the roofline as the layout changes.

Stairs above the glazing lead to the boarding platform at the ridge. The platform closes the roof around the mast. Both storeys of the pavilions count toward the enclosed area cap.

01 Framework

02 Allocation

03 Topology

04 Circulation

05 Public realm

06 Play

07 Agents

08 Score

09 Experiments

10 Placement

11 Materials

12 Record

01 / ARCHITECTURAL FRAMEWORK

A stable core. A changing periphery.

Geometry becomes an infrastructure for future programmatic change, rather than a fixed distribution of rooms.

Conceptual plan and module anatomy. The ring and its rooms endure; exterior units and uses can be reconfigured. Diagram not to scale.

Designer-led

Design decisions

Set a radial annular core surrounded by removable, outward-facing modules; place the greenhouse / biofilter in the full-height central space as Infinite Rinse.

Let the designer adjust the number of floors, footprint, ring width and module count. Make the core itself a mixed-program environment, not a single-use support structure for the modules.

Use 4.5 × 18 m single modules (81 m²). Earlier studio brief also contemplated 9 × 18 m doubles (162 m²); the laboratory currently instantiates singles only.

Allow unoccupied docking positions to remain vacant or support public balconies, community gardens or retail; make those shares configurable.

AI implementation

Computational translation

Annular geometry, angular docking slots by level, seeded layout generation and collision reservations. The 4.2 m floor-to-floor, 3.5 m module height in the app, docking gap, frame geometry and default dimensions are model assumptions or carried-forward brief parameters, not structural verification. Modules are discrete 81 m² units, not fractions.

02 / PROGRAM & AREA

One program budget, two modes of occupation.

Permanent space and modular space are distributions of the same demand.

Core share

Modular share

Infinite Rinse

7,500 m²

80% requested core · 20% modular

Love hotel

8,000 m²

35% requested core · 65% modular

Marine firehall

1,500 m²

75% requested core · 25% modular

Daycare

1,000 m²

40% requested core · 60% modular

Senior care

2,000 m²

35% requested core · 65% modular

Total base target

20,000 m²

Original program targets and initial core-share slider values documented in the brief. Actual generated areas may differ after shared space and physical constraints.

Designer-led

Design decisions

Set five programs and target areas: Infinite Rinse (water treatment, museum, greenhouse), Love hotel, Marine firehall, Daycare, Senior care.

Allow each program to have its own proportion of permanent core vs. modular accommodation.

Originally impose a hard 20,000 m² limit, then make the cap adjustable with 20,000 m² remaining the default.

Require variable-sized internal rooms, with sizes suited to the programs; later reject the tiny rooms produced by the first implementation.

AI implementation

Accounting and packing

Reserve greenhouse area once; distribute remaining program capacity, use whole modules, and account for enclosed retail, shared circulation, core lobby and rooftop lift/service enclosures. Open plaza, gardens and balconies do not add enclosed GFA. The 80 m² default minimum, 40–200 m² range, room-size bands, proportional allocation and residual-room merging are AI-developed numerical/packing choices. The minimum is for gross program zones, not individual suites or a code minimum.

Enclosed area

= ring floors − lobby voids above grade + upper atrium bridges + greenhouse at grade + enclosed modules and rooftop structures ≤ selected area cap.

Circulation, lifts and shared lobbies inside the ring are already in the ring area; never add them twice. Detailed GFA and wall measurement conventions are not code-verified.

“Maybe add a few random ‘rooms’ on the roof too that are retail/commercial space.”

Student request · V2.9 iteration (quotation punctuation normalized)

03 / TOPOLOGY DESIGNER

Relationships are the design input.

The Topology Designer starts with a graph of program relationships. The same graph shapes rooms in the permanent ring and docks along its edge.

Example relationship settings, not the default. By default all inter-program relationships are neutral and explicit clustering is off.

Designer-led

Design decisions

Use the distance between nodes to weight pair relationships. Group each program’s rooms and modules around one part of the ring when clustering is selected.

Explicitly distinguish attraction, repulsion and neutrality between program pairs. Start every pair neutral; do not impose a social hierarchy before the experiment.

Use relationships to influence both internal rooms and module placement. Give the core its own opportunities for cross-pollination, even with few modules.

Originally identify the firehall as one program that should be concentrated and vertically aligned; then generalize that requirement into an optional clustering toggle on every node, off by default.

AI implementation

Heuristics

Attraction favors adjacent rooms and can create a shared lobby where space allows. Repel prioritizes separation among rooms and modules on the same floor, while permitting vertical neighbors and shared public routes. Neutral carries no pair-specific preference. Selected programs cluster even at 0%, with the slider adding emphasis independently of the pair relationships. The seeded room and dock solvers balance those preferences with area, circulation and the available geometry.

Ground-first Firehall

Firehall modules fill compatible ground-floor docks first. Each higher floor can have at most as many Firehall modules as the floor directly below. Clustering can still group the Firehall around a common part of the ring.

“The default for all program types should be neutral”

“Actually maybe all programming can have that option but by default it's turned of. It can be a toggle when you click on the icon in the topology designer”

Student requests · V2.8.1 and V3.1 iterations

04 / CIRCULATION AS SOCIAL INFRASTRUCTURE

Attraction becomes a place to gather.

Circulation is more than a route to a destination: it shapes whether different programs meet.

Attract → shared lobby when feasible; neutral/repel → separate thresholds to the public network. Wall and door graphics are conceptual.

Designer-led

Design decisions

Two elevator blocks on opposite sides, one aligned to the swing ride access; an outer corridor connects all occupied docking positions. Make corridor width adjustable; introduce internal variation rather than pure randomness.

Avoid direct connections between repelling programs and encourage direct connections for attracting ones. Turn the space between attracted programs into a shared lobby where different occupants can linger.

Make those lobbies identifiable through furniture (rug, couches) and a color distinguishable from daycare.

Where the slide blocks modules, move the internal rooms against the façade and route the corridor behind them. The slide's endpoints must connect directly to Infinite Rinse rooms, not discharge into hallways.

Use an opaque exterior façade rather than curtain-wall glazing; remove visually overlapping room/wall geometry.


AI implementation

Geometry rules

Generate annular corridor sectors, optional inner band, opposing lift sectors and room-door thresholds. Carve a purple shared zone out of adjacent attracted rooms when area and minimum clearance allow it; neutral and repel pairs keep independent entrances. The AI chose numerical thresholds, 500 mm nominal wall thickness (reduced if needed), and a rerouting method. A shared public corridor is still available to repelled programs.

Slide-side topology changes the floor plan: the normal outer ring gives way locally to an inward bypass.

“Maybe lobby areas have like a rug and couches visual to symbolize gathering.”

Student request · V3.1 iteration

05 / PUBLIC REALM

Every spare surface is an opportunity.

Public activity occurs at the ground, along the modular perimeter, inside the central atrium and on the roof.

Conceptual section: open public surfaces (green) and enclosed programming (colored) support different kinds of encounters.

Designer-led

Design decisions

Enlarge the exterior entrance floor past the module footprint so it becomes a public plaza with room to gather.

Make the whole annular roof public, including greenery, walking paths, gardens, gazebos and scattered retail/commercial rooms.

Extend elevator access to the roof and provide overhead service space for both lift blocks. Preserve the transparent atrium roof as a distinct central element.

Use vacant dock spaces for public uses and the greenhouse as an inhabited setting, not a purely technical void.


AI implementation

Spatial details

AI-generated planters, communal tables, benches, paving, gazebos, railings, a perimeter walking loop, seeded retail locations, lift overruns and a roof bridge. The default plaza extension and furniture dimensions are implementation decisions. Roof pavilions and lift enclosures consume budget; the outdoor park does not. Geometry remains conceptual.

“Also the whole roof will be public space, green space, walking path, gardens, gazebos etc.”

Student request · V2.9 iteration

Later student refinement · continuous public realm

Wrap the entire building in a connected exterior plaza linking the lobby and climbing wall. The student proposed patios, umbrellas, fountains, benches, picnic tables, planting, beach volleyball and pickleball, with the neighboring programs influencing the character of the spaces. The AI translated this into a clear annular walking loop and program-influenced activity islands; their distribution and dimensions are implementation choices.

Student direction: turn the perimeter into a continuous outdoor social space, not only an entrance forecourt. The exact activity arrangement depends on generated program distribution.

06 / PLEASURE AS A SPATIAL FORCE

Play changes the shape of the building.

Recreation is both part of the architecture and a driver of visitor behavior.

Ride, slide and climb are linked to their surroundings, not placed independently as objects. Schematic only.

Designer-led

Design decisions

Place a Prater-inspired swing ride through the glazed central atrium.

Run an external water slide from a high concentration of Infinite Rinse space to a lower Infinite Rinse room; route it around the façade, reserve affected module positions and expose the connected rooms.

Add a façade climbing wall with adjustable width; cap its height by reference to Calgary Climbing Centre Rocky Mountain. Climbers must descend to the base, never exit onto the roof.

Allow the slide to cross the climbing wall by bowing out for clearance rather than forbidding that crossing.

Make all three features attractive destinations, with recent experiences of fun affecting the cross-pollination metric. Give the slide a recognizable blue-green hue.

AI implementation

Fit to the building

The slide connects Infinite Rinse rooms at different heights. Its route is drawn around dock positions and arcs outward where it crosses the climbing wall.

“no the slide generator doesn't have to avoid that strip but it just sticks out further from the facade there to create a safe climbing area”

“Climber avatars will always decend. That's how climbing works.”

Student corrections · V3.3 iteration

07 / HUMAN & NON-HUMAN OCCUPATION

From scale figures to spatial agents.

The laboratory tests potential patterns of occupation, rather than showing an uninhabited object.

Conceptual state diagram. Agents move, dwell, remember, meet and move on. Paths and timings are model assumptions, not observed human or animal behavior.

Designer-led

Design decisions

Populate the building with low-poly avatars of varied body shapes and sizes, including wheelchair users; also represent dogs, birds, rabbits and squirrels. Make them independently visible or hidden.

Transform figures into agents: enter and leave through the entrance plaza/lobby, visit program rooms and modules, stay for a while, use elevators between floors, and explore the greenhouse, rooftop and public spaces.

After leaving an attracting program, gravitate toward the shared lobby for a temporary period; then the attraction wears off and exploration continues.

Draw visitors toward the fun of the swing, slide and climbing wall. Remember the last occupied room and recent fun experiences for the encounter calculation.

AI implementation

Behavioral mechanics

Build a route graph from adjacent circulation, halls, lifts, rooms, modules, and outdoor destinations; use shortest-path routing and seeded probabilities. Lifts are vertical graph connections; dwell time and destination-choice probabilities are numerical defaults. Humans and dogs enter/exit and respawn; the initial simulation is partly pre-populated rather than starting exclusively at the plaza. Humans visit rooms and rides; dogs use the shared public network; birds, rabbits and squirrels use exterior/roof habitat pools. The seed and visitor count govern reproducibility; the simulation supports pause, speed and restart.

“if they leave a room that's got an ‘attract’ connection they gravitate towards the lobby for some time before it wares off and they continue to wander around”

Student request · V3.1 iteration (quotation punctuation normalized)

AI-supplied limitations: this is a schematic agent-based model. It does not solve individual collision avoidance, queue capacity, social identity, accessibility compliance or real animal ethology. Wheelchairs are represented and have modeled movement speeds, not a validated universal-access network.

08 / CROSS-POLLINATION METRIC

Measure the encounter, not the number of lobbies.

The performance question proposed by the student: do different spatial configurations create different opportunities for human and more-than-human interaction?

Shared lobby

5

Same room / module

3

Garden / gazebo

2.5

Plaza / entrance

2.5

Public balcony

2.5

Greenhouse

2.5

Ride experience

2.5

Roof promenade

2

Passing / circulation

0.5

V3.5 default base weights, in points per ten credited seconds before multipliers. Editable experimental assumptions, not empirically calibrated values. The student's requested ordering informed these AI-supplied values.

Designer-led

Measurement concept

Use observed encounters between avatars (human and non-human) as the performance signal, rather than treating the number of rooms or lobbies as success by itself.

Weight types of encounters: shared lobby gathering highest, being in the same room second, brief passing lowest; public gardens, plazas and balconies more valuable than passing.

Give each avatar a memory of its last room. Interactions between avatars from different recent rooms should score more than those with the same room memory.

Reward encounters after a fun activity. Use the score to compare modular vs. core allocation, core size and other settings.

AI implementation

Metric definition

The AI introduced additional different-program and cross-species multipliers, a bounded encounter window, 2.5 m proximity threshold, 90-second fun memory, and normalization per active visitor time. They operationalize the student's goals, but their magnitudes and timing are assumptions. The score is not a percentage or bounded 0–100 index.

Illustration of two remembered origins meeting in one space; context and bonuses determine the score.

One encounter, four possible modifiers

×1.5

Different most recent room

×1.2

Different most recent program

×1.4

Recent fun (within 90 s)

×1.3

Different species / agent kinds

Points = space weight × credited seconds / 10 × applicable multipliers

Example: 10 credited seconds between two humans in a shared lobby, different remembered rooms and programs, one recently enjoyed a ride: 5 × 1.5 × 1.2 × 1.4 = 12.6 points. A human–dog encounter in that lobby with no other bonus would score 5 × 1.3 = 6.5 points. In the current agent rules dogs do not visit program rooms, so the room-memory and cross-species bonuses do not normally combine.

1 · Proximity & context

Every simulated second, active pairs within 2.5 m count only if the navigation-zone relationship is eligible and on the same floor. Excludes in-transit climbing, slide and elevator paths.

2 · Bound repeated contact

A continuous pair encounter earns at most 15 credited seconds. A gap of more than 8 seconds permits a fresh encounter. Shared-lobby and room category rules use zone membership rather than walls being transparent.

3 · Normalize

Score = total weighted points × 100 / active visitor-minutes (human and non-human agent time). The live dashboard hides the score during the first 15 simulated seconds.

“each little avatar carries a memory of the most recent room it was in and if two avatars of different room memories interact thats a higher score than of the same room.”

Student request · V3.2 iteration

A score reports modeled co-presence, not actual social exchange. The current code separately counts human/non-human encounters and encounters between different agent kinds; the cross-species multiplier uses different agent kinds. An improved layout may have a lower score depending on paths, dwell, population and weights. None of these weights has been validated against observed data.

09 / EXPERIMENTAL WORKFLOW

Compare architectures as hypotheses.

Compare alternatives to see how the core, docks and public routes change where people and animals may meet.

Feedback loop: modify design parameters, generate a building, simulate occupation, observe the score, then reconsider the architecture.

Designer-led

Research method

Use cross-pollination as a visible performance measure to examine the effect of module vs. permanent program, changes in core size and height, program relationships, clustering, circulation and fun features. Compare rather than presume that a larger core or more lobbies is inherently better.

AI implementation

Trial mechanics

Seeded layout and agent behavior; separate five-simulated-minute comparative trials; recent trial history with room/module/hub counts and configuration metadata; normalize by active agent time. Change one variable at a time, hold seed, population and metric weights constant, and repeat across seeds for stronger comparisons. Five simulated minutes are an initial comparison window, not a statistical guarantee.

“That way as I adjust sliders I can see how modules vs core programming impacts cross pollination and how larger or smaller core impacts it or how all the different settings impact it you know.”

Student request · V3.2 iteration

10 / PROGRAM PLACEMENT

Where programs meet the ring.

The permanent rooms and removable modules share one circulation network. Their different lifespans allow a program to expand at the edge or consolidate in the core as its needs change.

Generated ground-floor plan (seed 606) with Firehall clustering and Love Hotel–Daycare Repel. The five red Firehall modules occupy neighboring docks near the red Firehall room. The lower-left gap in the modules leaves room for the entry approach.

Adjacency at the edge

Rooms can create a sheltered gathering point, and nearby docks give the same program room to expand. The outer corridor reaches the module doors. Programs that repel can occupy separate stretches of the same floor and still reach the lifts, roof and promenade through common routes.

The case for an empty dock

The entrance, slide and climb reserve parts of the perimeter. Where the slide blocks a dock, an interior room can meet the façade and the circulation can pass behind it. Other open docks can stay available for a future module or support a balcony, garden or retail use.

Testing a local change

Reassigning a room or module, or adding a module at an eligible dock, tests a local change to the larger scheme. The model checks the enclosed area cap, dock reservations, same-floor Repel and entrance access before updating shared lobbies and circulation for the revised plan.

11 / MATERIAL STUDY

Compare structure and cladding.

The study holds the massing fixed so the designer can compare material assemblies for the permanent ring and removable modules.

Core ring and Firehall module axonometrics

The illustrated pages show the cladding and structure as separate layers.

From massing to materials

The core ring and the removable modules have different structural roles. A continuous core supports rooms and public routes. Repeated module framing could simplify connections to the core while allowing finishes to vary by program. The exploded drawings make it possible to examine the frame and envelope independently.

The designer proposed studying a steel frame for the cantilevered module docks with an independently supported rammed-earth outer leaf. The comparison uses the layered earth surface and its modeled mass to distinguish the enclosure from the frame. Lightweight braced metal and engineered timber assemblies give the removable modules a different construction palette.

Comparative estimates

The cost study applies editable CAD rates to the core floor area, modeled façade area and enclosed module quantities. Starting assumptions are $350 per m² of floor for the reference concrete structure and $95 per m² of wall for the reference corrugated cladding. Estimated assembly mass, typical structural behavior and the range of finishes help compare the consequences of a material choice across the building.

Design direction and implementation

The student directed the comparison by program, the exploded drawings and the approximate CAD analysis. The assistant assembled the material library, quantity takeoff and initial assumptions. The diagrams and strength descriptions support schematic comparisons.

12 / PROCESS & AUTHORSHIP RECORD

Design direction vs. implementation.

This is a transparent account of the collaboration, not a claim that no AI design choices occurred.

Development stage

Student-originated design / decisions

AI contribution / translation

Initial brief → V2.1

Ring and radial plug-ins, program mix and quantities, adjustable allocation, internal cross-pollination, unused slots, 20,000 m².

Geometry equations, inventory apportionment, seeded mapping, colors/initial shares and WebGL/software rendering. Initial brief labels several values assumptions; individual origin not established for all defaults.

V2.4 → V2.7

Central rides and IR slide; adjustable entrance, auto circulation, two lifts; direct attract/shared lobby vs. repel separation; flexible room topology.

Route search, collision tests, corridor sectors, hub carving, topology heuristics; geometry/export grouping.

V2.8 → V2.9.6

Plaza extension, neutral default, roof park with retail, slide-facing rooms and detours, solid wall, adjustable floor area cap, bigger rooms, diverse people and animals.

Plaza and roof furnishings, room size ranges, wall thickness, ride speed research, schematic figures and area accounting.

V3.0 → V3.1

Lobbies as places of gathering, agent movement, room visits, temporary attraction, elevators, greenhouse, entry and exit, play, and optional clustering for any program.

Lobby furnishings, seeded pathfinding, routing rules, time and movement distributions, clustering solver and animal route proposals.

V3.2

Concept of a weighted encounter score, spatial hierarchy, room memory, fun-memory enhancement, configuration comparison.

Exact scoring formula, normalization, timers, thresholds, extra multipliers, repeat-contact limits and fixed-length trials.

V3.3

Adjustable climbing wall, module displacement, slide bows outward, CCC height precedent, compulsory descent.

Route bulge and clearance assumption, height conversion, blocked-slot calculation, climbing state logic and tests.

V3.6

Continuous exterior plaza, program-influenced amenities and recreation.

Authorship synthesis and diagrams, plaza geometry, route graph and activity distribution.

After V3.6

Ground-first Firehall, same-floor Repel, local program changes and material studies. Opposing lobby atriums, optional upper bridges and a varied roofline.

Placement and circulation checks, assembly quantity takeoff and comparative CAD assumptions.

Suggested presentation statement

“I developed the architectural concept, program relationships, modular and permanent spatial logic, circulation and gathering strategy, recreational features, and the research premise of measuring cross-pollination through weighted encounters. I used ChatGPT to translate those decisions into a computational model that generates layouts, routes agents and measures modeled encounters. I directed revisions to the way rooms, modules and public routes are arranged. I could review and adjust the proposed weights, thresholds and assumptions. The model supports architectural exploration.”

Evidence and scope

The available development conversation, the original Copilot brief and the versioned repository inform this record. Earlier sections preserve the design sequence. The current model and its browser tests were used to verify the later topology, programming and material studies. Early attribution draws on the available prompt summaries.

The live model shows the generated geometry. The design diagrams and material estimates are schematic comparisons. The original architectural drawings remain part of the studio reference material.

POLY NATION / CROSS POLLINATION LABORATORY

Design rationale · November 2026
