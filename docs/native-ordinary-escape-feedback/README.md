# Bounded native surface escape feedback

The existing public AM3352 fixture supplies all geometry. The reproduction loader reconstructs native pad centers by pad ID and generates a joint three-pair seed at runtime; no new captured board data or intermediate route snapshots are stored.

## Reproduced failures and fix

- The old surface policy rejects DDR_D13's local site domain. Enabling the existing expanded-site search finds legal 0.30 mm drill / 0.50 mm land dogbones within its 20.200131 mm copper-length ceiling.
- DDR_CSn0 remains blocked with expanded sites. Removing either strobe pair independently does not help; removing only CK does. The fix uses that bounded counterfactual to regenerate CK's owned escapes and coupled carrier around a computed CSn0 route. Both strobe pairs and supplied copper remain fixed.
- A combined regression routes D13 and CSn0 together with all six paired conductors retained. It checks native-pad connectivity, inter-signal and pad copper clearance, barrel spans and dimensions, whole-copper maximum lengths, pair skew, repaired CK coupling, and input immutability.

`routeSurfaceOrdinarySignals` retries empty domains at most six times for buses with hard maximum lengths. It expands only empty domains; already feasible local choices stay unchanged. Unbounded legacy buses keep their established ordinary search, with a regression comparing generator steps and returned geometry. Each repair considers allowed carrier layers and bounded coupled-pair searches; it never removes supplied copper or relaxes manufacturing/length constraints. The unchanged final pipeline still performs full connectivity, DRC, CA minimum-length, bus matching and exterior-coupling acceptance.

Run:

```sh
bun test tests/am3352-ordinary-escape-repro.test.ts tests/am3352-ordinary-escape-fix.test.ts
./benchmark.sh --require-all-solved --timeout-seconds 3600
```

The reproduction keeps the old-policy failures as diagnostic controls; the fix adds positive tests for both failures and their coexistence. They run in the normal test job, so subsequent PRs exercise these cases automatically.

## Scope and remaining work

These are candidate-stage fixes, not a completed native AM3352 board. The all-40-ordinary-signal trial with this change returned no complete assignment after 263.158 seconds / 262,136 yields, including its 250,000-yield child budget. The captured empty-domain failures are resolved; collective ordinary routing still needs work. No finished native-board route or fabrication sign-off is claimed.

## Legacy routing proof

Validation and current-run provenance are in [validation.json](validation.json).

An initial broader policy completed nine fresh legacy searches but hit the 1,800-second cap in `control-inner1` and `outer-layers`. The final policy restores the old unbounded search exactly. For the two capped cases, prior successfully completed outputs were independently revalidated on the final source. **This is eleven accepted completed outputs, not eleven fresh solves.** The source and runtime of every output, both capped attempts, and the policy correction are recorded in the report. Every declared legacy benchmark must complete all 47 signals and independently pass connectivity, DRC, whole-copper skew, pair coupling and preservation of all 161 fixed power dogbones/barrels/pad joins before routed snapshots are accepted. Legacy vias are 0.15/0.30 mm; the native reproduction uses 0.30/0.50 mm.

The existing completed gallery is reused only after regenerated PNG bytes match. Each image is inspected:

| Sample | Completed routed snapshot |
| --- | --- |
| control | [PNG](../routed-am3352-surface-constraints/control-solved.png) |
| control-inner1 | [PNG](../routed-am3352-surface-constraints/control-inner1-solved.png) |
| right | [PNG](../routed-am3352-surface-constraints/right-solved.png) |
| left | [PNG](../routed-am3352-surface-constraints/left-solved.png) |
| above | [PNG](../routed-am3352-surface-constraints/above-solved.png) |
| inner-layers | [PNG](../routed-am3352-surface-constraints/inner-layers-solved.png) |
| inner-layers-right | [PNG](../routed-am3352-surface-constraints/inner-layers-right-solved.png) |
| inner-layers-left | [PNG](../routed-am3352-surface-constraints/inner-layers-left-solved.png) |
| inner-layers-above | [PNG](../routed-am3352-surface-constraints/inner-layers-above-solved.png) |
| inner-layers-complete-ca | [PNG](../routed-am3352-surface-constraints/inner-layers-complete-ca-solved.png) |
| outer-layers | [PNG](../routed-am3352-surface-constraints/outer-layers-solved.png) |
