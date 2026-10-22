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

## Benchmark effect and merge status

**Benchmark validation is incomplete: do not merge until a controlled fresh base/head run of all eleven legacy cases on the final production revision is reported.** CI and retained-route validation do not close this gap.

Revisions: PR base `f965d0041703021d851728b29fc0f6c71be8d805`; initial broad fix `f5f4154242bac006f6bc912be6b5475321b31700`; final production code `378a1cd29dcd6fcf1f96d6a685298de1473c08a6`. Subsequent report/workflow edits do not change executable code. Environment: Bun 1.4.0, Linux, 4 CPU / 16 GiB.

| Measurement | Before | With this change | Effect / confidence |
| --- | --- | --- | --- |
| Targeted ordinary candidate assignment | D13 and CSn0 fail under the old surface policy | D13, CSn0, and their combined assignment succeed | Resolves the reproduced empty-domain failures; candidate-stage result only |
| Completed legacy route geometry | Prior completed outputs | All eleven accepted outputs have identical trace arrays and PNGs | No observed geometry or acceptance regression in these outputs; two are retained proofs |
| Connectivity / DRC / length / coupling | Prior completed outputs pass | Eleven revalidated outputs pass, each with 47/47 signals and 161 unchanged fixed power dogbones/barrels/pad joins | Acceptance compatibility; not eleven fresh solves |
| Initial broad-policy fresh search | Prior runs had eleven completed outputs, under different conditions | Nine completions; two 1,800 s caps | Completion/performance concern prompted restriction to hard length-limited buses |
| Final legacy ordinary search | Established unbounded search | Same generator progression and returned geometry in the equivalence regression | Search-policy preservation; no whole-suite runtime conclusion |
| Final full native trial | No completed native board | No completed assignment for all 40 ordinary signals: 263.158 s / 262,136 yields | Full-board routing remains unresolved |

### Controlled targeted comparison

[Machine-readable comparison](targeted-comparison.json): the pinned base implementation and final head ran sequentially in one Bun process on identical clones of the same runtime-generated public-fixture pair seed. One measurement per policy/case; the shared 15.961 s seed-generation cost is excluded. Both use a 50,000-step child budget, 12,000 candidate-search-node limit and 100,000-yield outer cap; the head permits two pair repairs. Baseline: `runBoundedRouting(negotiateSignalSites(state, names, false, false, {allowExpandedSites:false,maxCandidateSearchNodes:12000}),50000)`. Head: `routeSurfaceOrdinarySignals(state,names,{maxSteps:50000,maxPairRepairs:2})`. Both consume their generators to completion or the outer cap.

| Case | Base outcome / s / yields | Final head outcome / s / yields |
| --- | --- | --- |
| D13 | No candidate / 0.270 / 4 | Candidate / 1.325 / 314 |
| CSn0 | No candidate / 0.196 / 4 | Candidate / 14.340 / 11,052 |
| D13 + CSn0 | No candidate / 0.167 / 4 | Candidate / 15.547 / 11,579 |

**Effect: 0/3 → 3/3 candidate assignments, with additional search time rather than a speedup.** All six pair conductors remain present and the seed is unchanged. These measurements stop at candidate assignment; the regression suite separately checks native-pad connectivity, copper clearance, whole-copper maximum lengths, pair skew, repaired CK coupling, manufacturing dimensions and input immutability. They do not establish final full-bus matching or full-board success. The single measurements are not a statistical performance study.

### Historical full-suite measurements

Initial fresh search timings follow. They are historical measurements from concurrent correctness runs, **not final-revision timings and not paired performance comparisons**. No speedup or measured absence of a runtime regression is claimed. In particular, the capped cases have not completed a fresh rerun on the final policy. The final policy restores the established unbounded search and restricts new feedback to hard maximum-length buses; this addresses the broadened-search cause but does not substitute for measuring the final suite.

| Legacy sample | Initial broad-fix fresh search (s) | Final accepted-output provenance |
| --- | ---: | --- |
| control | 43.712 | Initial broad-fix completion, revalidated |
| control-inner1 | 1800.555 (timeout) | Retained prior completion, revalidated |
| right | 43.537 | Initial broad-fix completion, revalidated |
| left | 54.358 | Initial broad-fix completion, revalidated |
| above | 59.915 | Initial broad-fix completion, revalidated |
| inner-layers | 78.207 | Initial broad-fix completion, revalidated |
| inner-layers-right | 106.557 | Initial broad-fix completion, revalidated |
| inner-layers-left | 275.373 | Initial broad-fix completion, revalidated |
| inner-layers-above | 395.417 | Initial broad-fix completion, revalidated |
| inner-layers-complete-ca | 318.659 | Initial broad-fix completion, revalidated |
| outer-layers | 1800.108 (timeout) | Retained prior completion, revalidated |

To close the gap, run `./benchmark.sh --require-all-solved --timeout-seconds 3600` separately at the pinned base and final production revision, on the same machine without overlapping benchmark jobs. Keep all eleven cases and the same acceptance checks; publish each result, timeout and runtime delta. A longer identical budget on both revisions is required if either run times out; a timeout remains a reported failure to complete within the selected budget.

The `AGENTS.md` change in this PR only strengthens contributor reporting requirements; it has no executable benchmark effect.

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
