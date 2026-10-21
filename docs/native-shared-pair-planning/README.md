# Native shared-pair planning validation

The captured real SBC planning stage offers a compatible six-conductor seed
within **12,286 yields**. The baseline offers none within 20,000. CI guards
shared-section spacing, pair skew, layer rules, upper length bounds and inter-pair
clearance. Reproduce with `bun run benchmark:shared-pairs`.

This is a planning-stage improvement. The complete real 46-signal DDR phase,
final exterior coupling and full-bus length matching are not certified here;
the existing downstream acceptance checks remain mandatory.

All **11/11** legacy placements have successful 47/47 routes, independently
revalidated through the snapshot export gate for connectivity, combined copper
DRC, total-copper bus matching and pair coupling. Every case preserves all
161 fixed power dogbones, barrels and pad joins. The captured searches include
multiple commits of this PR; [provenance](run-provenance.json) records the scope
correction and the final inner-left rerun. The new complete inner-left CI test
prevents the surface search policy from leaking into inner-layer negotiation.

All eleven trace arrays and freshly rendered PNGs exactly match the prior proof.
The linked completed images were individually inspected. Full measurements and
image hashes are in [legacy-validation.json](legacy-validation.json).
The legacy fixtures use 0.15/0.30 mm drill/land; the separate real SBC capture
uses 0.30/0.50 mm.

| Completed legacy sample | Solve seconds | Connectivity / DRC / matching | Bus skew (mm) |
| --- | ---: | --- | --- |
| [control](../routed-am3352-surface-constraints/control-solved.png) | 53.015 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [control-inner1](../routed-am3352-surface-constraints/control-inner1-solved.png) | 2033.604 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [right](../routed-am3352-surface-constraints/right-solved.png) | 32.503 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [left](../routed-am3352-surface-constraints/left-solved.png) | 45.964 | 47/47 / pass / pass | 0.635000 / 0.511147 |
| [above](../routed-am3352-surface-constraints/above-solved.png) | 51.555 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [inner-layers](../routed-am3352-surface-constraints/inner-layers-solved.png) | 71.930 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [inner-layers-right](../routed-am3352-surface-constraints/inner-layers-right-solved.png) | 101.568 | 47/47 / pass / pass | 0.635000 / 0.635000 |
| [inner-layers-left](../routed-am3352-surface-constraints/inner-layers-left-solved.png) | 503.808 | 47/47 / pass / pass | 0.634990 / 0.634992 |
| [inner-layers-above](../routed-am3352-surface-constraints/inner-layers-above-solved.png) | 426.265 | 47/47 / pass / pass | 0.634991 / 0.634993 |
| [inner-layers-complete-ca](../routed-am3352-surface-constraints/inner-layers-complete-ca-solved.png) | 483.943 | 47/47 / pass / pass | 0.634990 / 0.634992 / 0.634994 |
| [outer-layers](../routed-am3352-surface-constraints/outer-layers-solved.png) | 1435.553 | 47/47 / pass / pass | 0.635000 / 0.635000 |

Wall times include concurrent work and are provided for reproducibility, not
as a performance comparison. The deterministic native planning regression
is measured separately in the [recorded comparison](../../tests/fixtures/am3352-shared-pairs/planning-benchmark.json).

Reproduce legacy cases with `./benchmark.sh --worker <sample> --timeout-seconds
3600 --routes-directory /tmp/am3352-routes`; the serial equivalent is
`./benchmark.sh --timeout-seconds 3600 --require-all-solved`.
