# Completed snapshot inspection

All eleven PNGs were opened at original detail after the standard benchmark
workers passed and successful captures passed the independent snapshot audit.
Every image shows all four physical copper planes at the same board scale: the
completed signal carriers, owned TOP escapes, immutable power dogbones, native
pad arrays, and plated via rings. Placement and carrier counts agree with the
benchmark report. Tuning banks and paired backbones are visible; titles,
completion labels and copper remain unclipped. No search or intermediate view
is included.

All eleven published PNGs were regenerated from their accepted computed
graphics scenes and compared with exported hashes. All eleven files matched.
Full-plane vector exports were also verified locally; this gallery publishes PNGs.
The [scene verification](scene-verification.json) and
[artifact manifest](artifact-manifest.json) bind them to the exact
[benchmark report](benchmark-results.json).

Benchmark SHA-256: `44332d70b072bd00224645ff94a47ebc2e5b0325e831234b58ccba2118b45f44`.

| Inspected PNG | RAM center (mm) | Carrier layer counts | Visual review |
| --- | --- | --- | --- |
| [control](control-solved.png) | (0, -27) | inner2: 16, inner1: 19, bottom: 12 | Pass |
| [control-inner1](control-inner1-solved.png) | (0, -27) | inner1: 47 | Pass |
| [right](right-solved.png) | (27, 0) | inner2: 18, inner1: 21, bottom: 8 | Pass |
| [left](left-solved.png) | (-27, 0) | inner2: 20, inner1: 18, bottom: 9 | Pass |
| [above](above-solved.png) | (0, 27) | bottom: 14, inner2: 15, inner1: 18 | Pass |
| [inner-layers](inner-layers-solved.png) | (0, -27) | inner2: 23, inner1: 24 | Pass |
| [inner-layers-right](inner-layers-right-solved.png) | (27, 0) | inner2: 25, inner1: 22 | Pass |
| [inner-layers-left](inner-layers-left-solved.png) | (-27, 0) | inner1: 28, inner2: 19 | Pass |
| [inner-layers-above](inner-layers-above-solved.png) | (0, 27) | inner1: 21, inner2: 26 | Pass |
| [inner-layers-complete-ca](inner-layers-complete-ca-solved.png) | (0, -27) | inner2: 28, inner1: 19 | Pass |
| [outer-layers](outer-layers-solved.png) | (0, -27) | bottom: 39, top: 8 | Pass |

All eleven native audits passed connectivity, combined-copper DRC, whole
pad-to-pad bus/pair matching, physical coupling, ordinary geometry and immutable
provenance for all 161 power fanouts. The dedicated control image in
[the inner1 report](../control-inner1/README.md) was also inspected; it is
explicitly a view of the inner1 plane, with all physical planes in this gallery.
