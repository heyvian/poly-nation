# Roadmap — proposals, not instructions to implement automatically

There is no outstanding user-approved feature request in this handoff beyond continuing from V3.6. Prioritize the next user request. Keep the current source as a working baseline.

Potential technical improvements (AI suggestions only): extract solver/navigation/scoring into testable modules without changing behavior; add automated invariant tests and explicit comparison configuration export; save named scenarios and repeated multi-seed trials with distributions; profile renderer and agent loop; improve navigation robustness and collision/dwell behavior; test hardware WebGL, actual 3DM round-trip in Rhino, local storage reopening and offline Python geometry bridge; improve code clarity and keyboard accessibility. Preserve single-file deliverability if possible.

Potential architectural research extensions (require designer approval): additional occupancy scenarios, topology sensitivity and explicit design constraints, improved program-specific navigation patterns, agent encounter visualization, benchmarking the score against observations. Do not imply that human/non-human bonuses or attraction weights are empirically calibrated. Detailed egress, net usable areas, accessible paths, structure, climbing/ride safety and contaminated water separation need specialist work beyond this model.
