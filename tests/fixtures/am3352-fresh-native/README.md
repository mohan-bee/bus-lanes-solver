# Fresh AM3352 native input

`whole-ddr.simple-route.json.gz` is the unchanged CLI input from
[`astra/am3352-sbc`](https://github.com/tscircuit/am3352-sbc/tree/feat/fresh-native-autorouting/routing/repros/fresh-ddr),
using Core 0.0.2164: 46 DDR connections, 1,144 obstacles, no supplied traces,
and 0.50 mm via lands / 0.30 mm drills. The loader verifies both byte hashes.

The capture omits optional `allowedLayers`; its buses allow TOP/BOTTOM.
DDR_CKE's RAM K9 terminal has no clear adjacent through-via site because of
bottom capacitor C_DDR11. It can remain on TOP, but the native-layer fallback
incorrectly treats omitted `allowedLayers` as no permitted layers.

Run `bun test tests/am3352-fresh-ddr-escape.test.ts`. The test exercises actual
escape assignment and stops the planar child; it does not claim a completed,
DRC-checked or length-matched DDR route. No failed routing images are exported.
