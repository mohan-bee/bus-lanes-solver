# AM3352 per-bus surface layer restrictions

Production baseline: bus-lanes-solver 0.0.27 (`5beb513`). This is a new real-board
case, distinct from the eleven solved legacy placements. No routing fix is
claimed here.

## Reproduce

```sh
bun scripts/repro-surface-layer-domain.ts --assert-equivalent
bun scripts/repro-am3352-effective-layers.ts --assert-equivalent
```

Both commands intentionally exit 1 on this baseline when equivalent layer
constraints produce different decisions. Neither exports or accepts copper.

The minimal case is one TOP-pad connection in a bus restricted to TOP.
`signalLayers` returns `[]`; adding redundant global TOP/BOTTOM returns `["top"]`.
Its native-pad exclusion consults only global `allowedLayers`, ignoring the
explicit per-bus permission. The real capture has this empty domain for all
11 BYTE0 members; other members also lose their permitted TOP alternative.
This helper observation alone does not prove the full routing failure's cause.

## Exact native input

`tests/fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz` contains
unmodified CLI capture bytes (gzip transport only), SHA-256:

`384e4337e3fd09fbb67ca2e0a019cf485007fc75dd301bafb40cae2142042571`

Source: am3352-sbc baseline `d8dc063`, experimental branch
`feat/retry-native-routing-bus-lanes-0-0-27`. Only native TSX routing/timing
configuration changed: all 46 matched DDR signals share phase 1 and their
original three timing buses; BYTE0 is TOP-only, other buses TOP/BOTTOM. The
four-layer board, 1,144 obstacles, 0.30 mm drills / 0.50 mm via lands, 0.10 mm
traces, timing windows and pair coupling requirements are preserved. No prior
copper, manually routed copper or output post-processing is supplied.

Every connection is covered by an explicit surface-only bus restriction, so
adding global `["top", "bottom"]` removes no otherwise permitted signal carrier.
Nevertheless, the exact native input selects `lanes_route` with an 800,000-step
pipeline budget; the redundant global declaration selects `route_shared_layers`
with 8,000,000 steps. Escape allocation produces 66 traces in both cases.

The native CLI attempt exhausted its iteration limit after 1,355.322 seconds
(22m 35s), having reported provisional progress up to 39%. No full solution was
accepted. A prior 300.024-second explicit-global control reached 242,543 steps
without solving or failing. Consequently, strategy normalization is a concrete
upstream defect to investigate, **not a demonstrated complete DDR fix**.

## Upstream work suggested

Use a shared effective carrier-domain calculation for per-bus/global constraints,
native surface eligibility and owned terminal-site alternatives. Keep caller
input and supplied copper immutable. Test equivalent declarations, uncovered
signals, intersecting bus restrictions, inner carriers and existing handoffs.

The full case also needs bounded, observable shared-pair/site negotiation: normal
pipeline stats currently do not identify the inner search being attempted.
Retain this capture as a separate real-board regression; do not replace or
reinterpret the 11/11 legacy proof. A routing fix still needs full connectivity,
DRC, total copper timing/coupling validation and fresh legacy benchmarks.

## Additional instrumented control

A fresh diagnostic run with redundant global surface layers was deliberately
stopped after the last recorded progress at 312.412 seconds / 272,229 steps.
It completed 55 individual pair searches, 13 successfully, but produced no
compatible three-pair plan. It was neither solved nor algorithmically failed.
Instrumentation added logging only and was removed afterward; no resulting
copper was exported to the board. This narrows the observed shared-layer
work to pair-corridor planning, rather than ordinary lane routing or tuning.

Verification: both assertion commands reproduced the discrepancy on unchanged
production source; full TypeScript checking and formatting passed. No routing
fix or new legacy benchmark claim is included in this reproduction.

## Stacked correction

The fix intersects physical/global/all owning-bus carrier restrictions in one
helper, and honors explicit per-bus permission to use native pad layers. When
all connections are constrained to a union of TOP and BOTTOM, the pipeline uses
an internal view with that redundant global restriction. This makes allocation,
strategy and budget match the explicit-global input. Public input, constructor
parameters and output geometry retain the original declarations and fixed copper.
Uncovered signals, empty/intersecting invalid domains, and inner-carrier inputs
are not promoted to the surface strategy.

On the fix branch, both reproduction commands above must exit 0. Regression tests
cover intersections, explicit global exclusions, defaults, uncovered signals,
complete small-board output equivalence and exact full-DDR escape/dispatch
identity. The full-DDR check stops after allocation; it does not assert that all
46 signals route. Shared-pair corridor convergence remains separate work.
