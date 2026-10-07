# AM3352 SBC escape regression

All ten benchmark cases were freshly solved with the native-layer fallback patch.
The snapshot guard verified complete connectivity, independent combined-copper
DRC, full planar bus/pair matching, exterior coupling and unchanged fixed power
fanouts before rendering. All ten PNGs were opened and visually inspected: native
pad arrays and via rings remain visible, each placement and layer count agrees
with the report, tuning paths appear continuous, and panels and labels are
unclipped. No failed or intermediate diagnostic images are included.

The fresh SVG scenes are byte-identical to the existing completed gallery; the
manifest references those exact SVGs and the newly rendered PNGs. The benchmark
report includes every per-connection length and all three pair measurements.
Lengths include supplied signal fanouts and new interconnect; they are planar
copper lengths, without inferred via depth or package delay. These results do
not establish address/control matching on the outer-layer case.

| Sample | Connectivity | DRC | Per-bus total planar copper skew | Runtime |
| --- | --- | --- | --- | --- |
| [control](control-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 41.047 s |
| [right](right-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 32.645 s |
| [left](left-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.511147 mm | 44.359 s |
| [above](above-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 53.003 s |
| [inner-layers](inner-layers-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 65.042 s |
| [inner-layers-right](inner-layers-right-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 91.098 s |
| [inner-layers-left](inner-layers-left-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.634990 mm; DDR_BYTE1: 0.634992 mm | 194.353 s |
| [inner-layers-above](inner-layers-above-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.634991 mm; DDR_BYTE1: 0.634993 mm | 235.858 s |
| [inner-layers-complete-ca](inner-layers-complete-ca-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.634990 mm; DDR_BYTE1: 0.634992 mm; DDR_ADDR_CTRL_CK: 0.634994 mm | 288.527 s |
| [outer-layers](outer-layers-solved.png) | 47/47 | Pass | DDR_BYTE0: 0.635000 mm; DDR_BYTE1: 0.635000 mm | 941.990 s |

Benchmark SHA-256: `fdd5d5e6162199c241df621c6756cb88fa66fdf915d290353c41a8137d1d686d`.

## Full board acceptance

The fresh `outer-layers` result was also checked against the captured complete
board, including all 1111 obstacles and 67 fixed ground escapes. That accepted
47/47 result is shown in [the full-board snapshot](sbc-completed.png); its
[independent report](sbc-validation.json) includes byte matching and all three
pairs. The image was opened and inspected after the full-board acceptance gate.

Run `bun scripts/solve-am3352-sbc-package-first.ts /tmp/sbc.json` to regenerate
it from a new algorithm search, then `bun scripts/snapshot-am3352-sbc.ts
/tmp/sbc.json /tmp/sbc-images`. No saved DDR routes are supplied. The package
search uses the benchmark's 161 immutable power fanouts, retaining their
provenance. Acceptance uses the actual board's supplied 67 GND escapes and
every board obstacle. This staged workflow does not establish convergence of
the direct full-board search or address/control timing closure.
