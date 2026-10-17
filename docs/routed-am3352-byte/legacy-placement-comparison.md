# AM3352 regression benchmark comparison

Accepted placements: 6/11 baseline → 6/11 candidate. Regressed accepted samples: none.

Baseline `5de6291`; candidate integration `49605dc0` combines main `6f58178` and fix `53814af`. Both use `./benchmark.sh --timeout-seconds 180` across all eleven historical 47-signal placement fixtures. This is separate from the exact native 11-signal reproduction.

| Sample | Baseline result / solve s | Candidate result / solve s | Candidate audited signals | DRC issues | Whole-copper skew B0 / B1 / CA (mm) | Max pair skew (mm) |
|---|---|---|---|---:|---|---:|
| [control](../routed-am3352-placements/control-solved.png) | pass / 39.437 | pass / 39.063 | 47/47 | 0 | 0.635000 / 0.635000 / — | 0.126884 |
| [control-inner1](../routed-am3352-placements/control-inner1-solved.png) | timeout / 180.048 | timeout / 182.289 | not accepted | — | — / — / — | — |
| [right](../routed-am3352-placements/right-solved.png) | pass / 32.120 | pass / 33.519 | 47/47 | 0 | 0.635000 / 0.635000 / — | 0.121802 |
| [left](../routed-am3352-placements/left-solved.png) | pass / 42.253 | pass / 43.020 | 47/47 | 0 | 0.635000 / 0.511147 / — | 0.127000 |
| [above](../routed-am3352-placements/above-solved.png) | pass / 45.817 | pass / 52.232 | 47/47 | 0 | 0.635000 / 0.635000 / — | 0.127000 |
| [inner-layers](../routed-am3352-placements/inner-layers-solved.png) | pass / 58.322 | pass / 59.994 | 47/47 | 0 | 0.635000 / 0.635000 / — | 0.127000 |
| [inner-layers-right](../routed-am3352-placements/inner-layers-right-solved.png) | pass / 84.858 | pass / 85.814 | 47/47 | 0 | 0.635000 / 0.635000 / — | 0.127000 |
| [inner-layers-left](../routed-am3352-placements/inner-layers-left-solved.png) | timeout / 180.022 | timeout / 181.896 | not accepted | — | — / — / — | — |
| [inner-layers-above](../routed-am3352-placements/inner-layers-above-solved.png) | timeout / 183.609 | timeout / 180.013 | not accepted | — | — / — / — | — |
| [inner-layers-complete-ca](../routed-am3352-placements/inner-layers-complete-ca-solved.png) | timeout / 180.866 | timeout / 180.009 | not accepted | — | — / — / — | — |
| [outer-layers](../routed-am3352-placements/outer-layers-solved.png) | timeout / 180.000 | timeout / 180.000 | not accepted | — | — / — / — | — |

All eleven input hashes identical: true. All inputs unchanged: true. All 161 fixed power dogbones preserved: true. Accepted results require complete connectivity, zero combined copper DRC issues, matching, and the existing quality/coupling checks.

Times are solver seconds; skews include supplied copper and are rounded to six decimals. An em dash means an undeclared bus or no accepted output. Timeout progress counters are not accepted routes. Existing reference images were retained, not presented as regenerated evidence for failed samples.

Full provenance, input hashes, unrounded metrics and both revisions' audited results are in [legacy-placement-comparison.json](legacy-placement-comparison.json); the candidate raw report is [legacy-placement-benchmark.json](legacy-placement-benchmark.json).

The linked images are previously inspected, successful reference outputs. This bounded run retains metrics for every sample and exports no failed or incomplete images.
