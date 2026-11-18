# Poly Nation

A system for testing the **programming** and **cross-pollination** of a mixed-use modular district (ARCH 606 Studio III, Vian Esterhuizen). The app models floor-space requirements per program and evaluates how programs are distributed and adjacent to one another across a fixed modular grid.

## Purpose

- Test whether a proposed allocation of modules meets the program and floor-area requirements.
- Test cross-pollination: how programs are layered and adjacent (e.g. sex / support / safety) rather than segregated.
- Make it easy to vary the allocation and compare outcomes.

## Requirements

### Floor space

- Total gross floor area (GFA): **20,000 m²**.

| Program | GFA | Share | ≈ Modules (÷ 81 m²) |
| --- | --- | --- | --- |
| Infinite Rinse – water treatment and museum | 7,500 m² | 37.5% | 92.6 |
| Love hotel | 8,000 m² | 40% | 98.8 |
| Marine firehall | 1,500 m² | 7.5% | 18.5 |
| Daycare | 1,000 m² | 5% | 12.3 |
| Senior care | 2,000 m² | 10% | 24.7 |
| **Total** | **20,000 m²** | **100%** | **≈ 246.9** |

### Modular unit

| Dimension | Value |
| --- | --- |
| Width | 4.5 m |
| Length | 18 m |
| Height | 4 m |
| Floor area per module | 81 m² |

- 20,000 m² ÷ 81 m² ≈ 247 modules. Rounding each program up gives 93 / 99 / 19 / 12 / 25 = 248 modules (20,088 m²), so the app must decide how to reconcile to exactly 20,000 m² (e.g. 247 modules, or non-modular space).
- Stacked modules count floor area on each level.

### Functional requirements

- Define programs with a target GFA and a module count derived from the module size.
- Place modules into a layout (hubs of modules around a core, distributed modules, midway rides) and track GFA per program against its target.
- Report total GFA and deviation from 20,000 m² and from each program's share.
- Evaluate cross-pollination: adjacency and layering between programs, and mix within each cluster.
- Support alternate allocations so scenarios can be compared.

## Programs

- **Infinite Rinse** – a water treatment facility and museum that remediates creosote through continuous circulation: public intake, injection/rinse wells, extraction wells, treatment, recirculation. Includes public education and exhibition space.
- **Love hotel** – the largest program (Sex).
- **Senior care** and **daycare** (Support).
- **Marine firehall** (Safety) – boat bays and a river dock.

## Context

Bow River, Calgary; Fifth City studio brief concerned with creosote contamination.

## Reference material

Studio drawings and reflection are in `docs/pdfs/` (`phase-2.pdf`, `phase-3-reflection.pdf`).
