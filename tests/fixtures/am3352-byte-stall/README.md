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
60 s, 11,364 steps, attempt 6. This happens without Core or rendering.

The bounded test compares one real solver step with a control that adds only
redundant global `allowedLayers: ["top", "bottom"]`. The per-bus restrictions,
geometry and membership are identical, but the initial routing stages differ:
the native input skips the fresh surface route. Separately, the 11-signal
fixed-layer path repeatedly routes ordinary lanes around one locked DQS
corridor. These are diagnosis and dispatch regressions, not proof that either
change alone completes routing.

```sh
bun test tests/am3352-byte-stall-layer-dispatch.test.ts
bun scripts/repro-am3352-byte-stall.ts --case both --steps 12000 --seconds 60
```

The CLI runs cases serially in bounded child processes and reports phase,
steps, wall time and search statistics. It emits no route geometry or failed
images. `solver_completed` alone does not certify connectivity, DRC or timing.
