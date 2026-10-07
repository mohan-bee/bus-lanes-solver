# AM3352 SBC outer-layer routing sample

This sample captures the complete placement of `astra/am3352-sbc@0.1.21`,
with 47 unresolved DDR connections, all 1111 pad/hole obstacles, and the exact
67 saved CPU/RAM GND escapes. No previously routed DDR copper is supplied.
Coordinates are board-world millimetres, +X right and +Y up. U1 is at (0, 0);
U3 is at (0, -27), unrotated. Ground pours are regenerated around the vias;
they are not represented as solid rectangular routing keepouts.

Run:

```sh
bun scripts/repro-am3352-sbc.ts benchmark /tmp/sbc-completed.json
bun scripts/repro-am3352-sbc.ts complete /tmp/sbc-complete-timing.json
```

`benchmark` retains the two byte timing buses and three differential pairs.
`complete` also retains the address/control/clock timing bus. Neither introduces
additional absolute length bounds. Both use identical geometry and fixed copper.
The CLI writes output only after the solver completes and independent
connectivity, fixed-copper preservation, DRC, matching, and pair coupling pass.
The Cosmos page `am3352-sbc-outer-layers` provides the same two configurations.

## Reproduced escape allocation failure

Before the fix, even `benchmark` fails in about one second with
`No collision-free local dogbone assignment`. The initial congestion preference
selects bottom. DDR_D2 (`source_trace_3`, U1.N1 at (2.8, -6.8)) has no legal
adjacent through-via site because of bottom-side pads. Its RAM endpoint has
legal sites. The native top-layer path is allowed and routes individually with
DRC passing. Retrying the same bottom allocation cannot resolve this condition.

The pipeline now checks for signals without any legal local via after that
allocation failure and keeps them on an allowed native pad layer. Fixed fanout
copper is unchanged. Matching buses may split across carrier layers;
differential partners move together. Excluded layers remain excluded.

The local allocation tests establish that all 47 signals receive legal initial
handoffs, including DDR_D2 remaining on top. They do not establish complete
47-signal routing or timing closure. Full-solve results are measured separately.

## BYTE1 placement obstruction

The original BYTE1-only solve reaches length matching, then fails with
`Insufficient tuning clearance` for D13, D14, D11 and D10. A visual scan shows
DQS1 taking a 45.57 mm detour while ordinary data paths are about 17–27 mm.
Removing other bottom-side pads diagnostically reduces the pair to about
21.28 mm and produces a fresh, independently validated solve. That diagnostic
removal is not used in the committed sample.

Seven decouplers are relocated in the optional `byte-corridors` placement:
`C_U1_F5`, `C_U1_L6`, `C_U1_H5`, `C_U1_K5`, `C_DDR5`, `C_DDR9` and
`C_DDR10`. Moves range from 0.125 to 5.25 mm. The offsets were checked against
a new export from the actual board source; all 1111 obstacles, both BGA pad
fields and all 67 fixed ground fanouts remain present. A first five-part trial
cleared BYTE1 but put C_U1_L6 over DQS0's bottom escape, breaking BYTE0. The
revised placement protects both byte corridors.

```sh
bun scripts/repro-am3352-sbc.ts benchmark /tmp/byte0.json --byte0 --clear-byte-corridors
bun scripts/repro-am3352-sbc.ts benchmark /tmp/byte1.json --byte1 --clear-byte-corridors
bun test tests/am3352-sbc-byte-corridors.test.ts
```

Fresh individual solves take about 7.2 seconds for BYTE0 and 5.2 seconds for
BYTE1. Each has 11/11 connected, combined-copper DRC valid, byte skew 0.635 mm,
pair skew 0.127 mm, passing exterior coupling, and unchanged supplied ground
copper. These individual results do not establish simultaneous byte routing.
The simultaneous byte diagnostic reached its 300-second limit without
completing, so the revised placement is a diagnostic variant.

The original full-board 47-signal sample, after the local escape fix, exceeded
a 1200-second diagnostic limit after 4,424,723 iterations without completing.
Tightening BYTE1's absolute maximum to 20.200131 mm also exceeded a 300-second
diagnostic limit. A search-order experiment interleaving layer plans did not
resolve the five-part trial within 300 seconds and is not part of this patch.

## Fresh package-first solve and full-board acceptance

The outer-layer benchmark completed freshly in 941.990 seconds: 47/47 signals,
independent DRC, both byte buses, all three differential pairs, exterior
coupling, and all 161 immutable power fanouts passing. The captured DDR
terminals and 420 BGA pads exactly match this benchmark.

Its fresh 47 DDR paths also pass independent acceptance against the complete
original SBC placement: all 1111 obstacles, 67 supplied ground escapes, complete
connectivity, DRC, byte matching and exterior coupling. This is a new algorithm
search followed by full-board acceptance, without a saved DDR routing cache.
The [completed full-board image](am3352-sbc-regression/sbc-completed.png) was
opened and visually inspected. All ten declared benchmark images were also
freshly rendered and inspected; their reports are in
[the regression gallery](am3352-sbc-regression/README.md).

```sh
bun scripts/solve-am3352-sbc-package-first.ts /tmp/sbc-completed.json
bun scripts/snapshot-am3352-sbc.ts /tmp/sbc-completed.json /tmp/sbc-images
```

This staged sample verifies the actual native terminals, BGA geometry, layers,
clearances and byte rules before searching. It rejects different placements or
additional timing constraints. The package search retains the benchmark power
fanouts and provenance; full-board acceptance retains the actual 67 supplied
GND escapes and tests every actual board obstacle before emitting a result.
It does not establish convergence of the direct full-board search.
Address/control/clock matching, absolute length limits, and via/package delays
remain unresolved; the outer-layer benchmark constrains byte buses and pairs.
