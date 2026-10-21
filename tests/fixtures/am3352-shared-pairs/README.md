# Native AM3352 shared-pair planning

This is the exact input at `routeFreshSurfaceSeeds`' pair-planning boundary
from core 0.0.2182 with bus-lanes-solver 0.0.28. It contains 46 connections,
1,144 obstacles, and 12 immutable generated pair escapes. Via drill/land are
0.30/0.50 mm. The CLI source digest and capture provenance are recorded beside it.

The compact capture reuses the existing fresh-native fixture's large obstacle
ownership arrays and records the captured replacement fields and 142 changed
pad positions and dimensions. The loader reconstructs the captured input; it never edits
router output. No manually routed copper is supplied.

The 20,000-yield regression requires a compatible six-conductor plan with pair
skew, shared-section spacing, allowed layers, upper length bounds and inter-pair clearance.
The previous planner exhausts the bound without a plan. This tests a planning
stage; it does **not** certify full DDR routing, final exterior coupling or
full-bus length matching. Those remain mandatory pipeline acceptance checks.
