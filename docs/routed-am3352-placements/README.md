# Ten powered AM3352/RAM routing samples

The processor stays at (0, 0) mm; RAM is translated without rotating either chip.
All ten declared samples completed from the native pads in the same actual benchmark run.
All 47 signals pass connectivity, native combined-copper DRC, total pad-to-pad length
matching and independent copper-quality/coupling checks. The 161 supplied power
dogbones, including their physical barrels and provenance, remain unchanged.

The following measurements and routed PNG/SVG gallery come from that same run.
Routing time includes length matching; the total column includes fixture and native
validation. Times vary with machine and load. Every skew measures full pad-to-pad
planar copper, including both terminal fanouts; via depth and package delay are
not inferred. Values are rounded for display using the existing validation epsilon.
The [actual benchmark report](benchmark-results.json) retains the measured lengths
and complete validation results.

| Sample | Routing | Including validation | Signals | Carrier layer counts | Native DRC | BYTE0 / BYTE1 skew (mm) | Complete CA/CK skew (mm) | DQS0 / DQS1 / CK skew (mm) |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| [control](control-solved.png) | 40.101 s | 41.779 s | 47/47 | inner1: 19, inner2: 16, bottom: 12 | Pass | 0.635000 / 0.635000 | — | 0.077868 / 0.126884 / 0.072830 |
| [right](right-solved.png) | 32.753 s | 35.117 s | 47/47 | inner1: 21, inner2: 18, bottom: 8 | Pass | 0.635000 / 0.635000 | — | 0.096047 / 0.121802 / 0.102644 |
| [left](left-solved.png) | 42.872 s | 46.952 s | 47/47 | inner1: 18, inner2: 20, bottom: 9 | Pass | 0.635000 / 0.511147 | — | 0.010514 / 0.127000 / 0.105429 |
| [above](above-solved.png) | 47.376 s | 50.778 s | 47/47 | inner1: 18, inner2: 15, bottom: 14 | Pass | 0.635000 / 0.635000 | — | 0.127000 / 0.127000 / 0.127000 |
| [inner-layers](inner-layers-solved.png) | 60.213 s | 61.991 s | 47/47 | inner1: 24, inner2: 23 | Pass | 0.635000 / 0.635000 | — | 0.077868 / 0.126884 / 0.127000 |
| [inner-layers-right](inner-layers-right-solved.png) | 87.219 s | 89.112 s | 47/47 | inner1: 22, inner2: 25 | Pass | 0.635000 / 0.635000 | — | 0.127000 / 0.127000 / 0.127000 |
| [inner-layers-left](inner-layers-left-solved.png) | 185.754 s | 190.711 s | 47/47 | inner1: 28, inner2: 19 | Pass | 0.634990 / 0.634992 | — | 0.126990 / 0.000001 / 0.105429 |
| [inner-layers-above](inner-layers-above-solved.png) | 230.217 s | 234.454 s | 47/47 | inner1: 21, inner2: 26 | Pass | 0.634991 / 0.634993 | — | 0.126915 / 0.126990 / 0.000001 |
| [inner-layers-complete-ca](inner-layers-complete-ca-solved.png) | 279.835 s | 292.060 s | 47/47 | inner1: 19, inner2: 28 | Pass | 0.634990 / 0.634992 | 0.634994 | 0.075359 / 0.000000 / 0.066384 |
| [outer-layers](outer-layers-solved.png) | 872.711 s | 877.015 s | 47/47 | top: 8, bottom: 39 | Pass | 0.635000 / 0.635000 | — | 0.019219 / 0.127000 / 0.127000 |

The complete-CA sample matches all 24 address/control/clock members,
with total copper lengths 61.650543–62.285537 mm,
skew 0.634994 mm and the unchanged 0.635000 mm limit.
The other nine samples retain the original two byte buses and three parent pairs.
Byte-bus skew limits remain 0.635 mm and differential-pair limits remain 0.127 mm.
The outer-layer sample restricts carriers to top and bottom while preserving
all four physical layers and the fixed power copper.

## Routed gallery

Each image was exported from accepted copper for its declared sample.
The exporter and this gallery generator refuse partial, failed or unmatched runs.

| Sample | RAM center (mm) | PNG | SVG |
| --- | --- | --- | --- |
| control | (0, -27) | [Routed PNG](control-solved.png) | [Routed SVG](control-solved.svg) |
| right | (27, 0) | [Routed PNG](right-solved.png) | [Routed SVG](right-solved.svg) |
| left | (-27, 0) | [Routed PNG](left-solved.png) | [Routed SVG](left-solved.svg) |
| above | (0, 27) | [Routed PNG](above-solved.png) | [Routed SVG](above-solved.svg) |
| inner-layers | (0, -27) | [Routed PNG](inner-layers-solved.png) | [Routed SVG](inner-layers-solved.svg) |
| inner-layers-right | (27, 0) | [Routed PNG](inner-layers-right-solved.png) | [Routed SVG](inner-layers-right-solved.svg) |
| inner-layers-left | (-27, 0) | [Routed PNG](inner-layers-left-solved.png) | [Routed SVG](inner-layers-left-solved.svg) |
| inner-layers-above | (0, 27) | [Routed PNG](inner-layers-above-solved.png) | [Routed SVG](inner-layers-above-solved.svg) |
| inner-layers-complete-ca | (0, -27) | [Routed PNG](inner-layers-complete-ca-solved.png) | [Routed SVG](inner-layers-complete-ca-solved.svg) |
| outer-layers | (0, -27) | [Routed PNG](outer-layers-solved.png) | [Routed SVG](outer-layers-solved.svg) |

Reproduce the measured run with:

```sh
./benchmark.sh --timeout-seconds 1800 --require-all-solved
```
