# AM3352 byte routing stall

The gzip is the byte-exact native CLI capture from
[`astra/am3352-sbc`](https://github.com/tscircuit/am3352-sbc/tree/feat/fresh-native-autorouting/routing/repros/fresh-ddr),
using Core 0.0.2164: 11 connections, 1,144 obstacles, no supplied copper,
four physical layers, 0.50 mm via lands and 0.30 mm through drills.
The loader verifies compressed and uncompressed SHA-256 hashes.

Five bus members require TOP and six require BOTTOM. Every member retains the
33.585277–34.220277 mm whole-copper length window; the DQS pair retains its
0.127 mm skew limit and 0.12 mm gap. Global `allowedLayers` is omitted.

The native board build timed out after 1,800.592 s and 572,200 steps in
`lanes_route`. A headless bus-lanes 0.0.25 run reproduced slow vector search:
60 s, 11,364 steps, attempt 6, with 5,515 visibility vertices. This happens
without Core or rendering. For at most 12 fixed-layer signals,
[`BusLanesSolver.useNegotiation`, `routePair` and `retry`](../../../lib/bus-lanes-solver.ts)
lock one DQS corridor while trying up to 300 ordinary-lane orders.
[`VectorVisibilitySearch.step`](../../../lib/vector-visibility.ts) examines
every visibility vertex per expansion.

The bounded test compares one real solver step with a control that adds only
redundant global `allowedLayers: ["top", "bottom"]`. The per-bus restrictions,
geometry and membership are identical, but the initial routing stages differ:
the native input skips the fresh surface route in
[`canRouteOnPadLayers`](../../../lib/bus-lanes-pipeline-solver.ts).

A diagnostic change enabling
[`routeIndependentBuses`](../../../lib/route-independent-buses.ts) produced
all 11 carrier candidates within both bus length windows after approximately
16 s / 6,640 steps. The pipeline correctly rejected them: DQS approaches
separate outside the package regions, with a 2.04 mm maximum edge gap against
approximately 0.140 mm allowed by
[`exteriorPairSpacingReports`](../../../lib/exterior-pair-spacing.ts).
This is an invalid intermediate candidate; no routed output was published.

Further repair ideas remain unproven. In
[`routeCoupledPair`](../../../lib/coupled-pair-routing.ts), the package-only
tuning guard recognizes fresh via dogbones but misses a native TOP-pad pair
with zero dogbones. Matching in
[`BusLanesSolver.match`](../../../lib/bus-lanes-solver.ts) also permits
individual approach tuning outside package regions. Correcting these paths
or changing strategy alone has not established a complete, physically coupled
route; further repair and validation are required.

```sh
bun test tests/am3352-byte-stall-layer-dispatch.test.ts
bun scripts/repro-am3352-byte-stall.ts --case both --steps 12000 --seconds 60
```

The CLI runs cases serially in bounded child processes and reports phase,
steps, wall time and search statistics. It emits no route geometry or failed
images. `solver_completed` alone does not certify connectivity, DRC or timing.
