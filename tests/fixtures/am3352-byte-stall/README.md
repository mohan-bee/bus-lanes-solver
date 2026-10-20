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
geometry and membership are identical. Before the fix their initial routing
stages differed: the native input skipped the fresh surface route in
[`canRouteOnPadLayers`](../../../lib/bus-lanes-pipeline-solver.ts).

A diagnostic change enabling
[`routeIndependentBuses`](../../../lib/route-independent-buses.ts) produced
all 11 carrier candidates within both bus length windows after approximately
16 s / 6,640 steps. The pipeline correctly rejected them: DQS approaches
separate outside the package regions, with a 2.04 mm maximum edge gap against
approximately 0.140 mm allowed by
[`exteriorPairSpacingReports`](../../../lib/exterior-pair-spacing.ts).
This is an invalid intermediate candidate; no routed output was published.

The fix selects bounded independent-layer negotiation for both equivalent
inputs. A native TOP-pad pair now receives package-only skew correction even
when it needs zero dogbones. Its raw exterior approaches are repaired before
ordinary routing. Native handoffs account for whole-connection distance, and
the shared corridor explores verified alternatives among equally short bends.
The existing bus matcher then tunes the complete group jointly. Package entries
account for the signed rail offset and miter projection; local reconnection
bevels stay inside the package. Repeated physical proposals are memoized and
retried pair geometry is excluded from subsequent cached searches.

The unchanged capture now completes all 11 signals with independent copper,
drill, board-edge, timing and physical coupling checks. See the
[completed snapshots and measured results](../../../docs/routed-am3352-byte).
This is a byte-phase regression, not evidence that the complete board is routed.

```sh
bun test tests/am3352-byte-stall-layer-dispatch.test.ts
bun test tests/am3352-byte-stall-complete.test.ts
bun scripts/repro-am3352-byte-stall.ts --case both --steps 12000 --seconds 60
```

The CLI runs cases serially in bounded child processes and reports phase,
steps, wall time and search statistics. A solved native case also requires
independent connectivity, DRC, timing and coupling validation. The explicit
surface-layer control remains diagnostic. Optional `--artifacts-directory`
exports only independently validated native snapshots and measurements.
