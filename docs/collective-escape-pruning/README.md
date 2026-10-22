# Early rejection of incompatible native escape domains

The native AM3352 hard-length surface search can spend its carrier budget on
individually reachable escape sites that cannot coexist. This change applies
the existing bounded arc-consistency pruning to escape copper and full-stack
drill compatibility before carrier negotiation. Unsupported choices are pruned;
a proven contradiction rejects that pair seed immediately. Reaching the support
check cap retains unproven choices and continues the existing search.

The check is enabled by the bounded native surface policy. Unbounded legacy
inputs retain their established search. Supplied copper, physical via spans,
clearances, absolute length limits and final routing acceptance remain fixed.
This does not implement multi-signal feedback that regenerates DQS0, and does
not establish a completed native board.

## Reproduction and controls

`loadAm3352CollectiveEscapes` uses the existing public full-DDR fixture. It
recalculates byte maximum lengths from longest Manhattan distance and CA/CK
bounds from longest Manhattan + 7.62 +/- 1.27 mm. It runs the production initial
allocation, joint pair planner and existing CK-access repair at runtime. No
captured intermediate copper, new board dump, or manually routed coordinates
are added. The resulting state matches the failed native trial.

DDR_D13, DDR_D11, DDR_D9 and DDR_DQM1 have 4, 7, 6 and 8 local choices. All
1,344 combinations conflict; all four three-signal subsets are satisfiable.
The regression requires the bounded native policy to reject this seed before
5,000 yields while the previous policy is still searching at 10,000 yields.
A positive control releases generated DQS0 only inside the test and verifies
that the four ordinary signals still produce a candidate with the other two
pairs unchanged. This is a diagnostic control, not permission to omit DQS0
from the board. Both tests check input immutability.

```sh
bun test tests/am3352-collective-escape-pruning.test.ts
bun scripts/benchmark-am3352-collective-escapes.ts /path/to/pinned-base output.json
```

The targeted benchmark generates the pair state once and excludes that shared
setup from timings. It runs the pinned base and head sequentially with the same
native state, options and 250,000-yield cap, measuring time to reject the
four-signal and full forty-ordinary-signal seed. Fast rejection is not a solved
board or a routing speedup measurement. The PR description records results and
limits after the run completes.

## Full benchmark acceptance

Every PR runs fresh paired base/head solves for all eleven canonical AM3352
placements on Blacksmith, with a 3,600-second per-solver/sample budget. The
`AM3352 benchmark (11/11)` check must pass before merge. Completion, runtime,
whole-copper skew, DRC and fixture provenance are published in the workflow
summary and artifacts; the final comparison is copied into the PR description.

The existing completed [routed gallery](../routed-am3352-surface-constraints/README.md)
contains all eleven legacy samples. These are reference snapshots from the
recorded completed proof, not snapshots of the incomplete native reproduction:

| Sample | Reference routed snapshot |
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
