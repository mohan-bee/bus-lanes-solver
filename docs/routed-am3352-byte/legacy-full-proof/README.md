# Fresh eleven-placement AM3352 proof

All eleven declared legacy AM3352/RAM placements freshly completed 47/47 signals within the 3600-second-per-case budget. The saved native outputs passed independent complete connectivity, combined-copper DRC, full planar copper bus/pair matching, physical pair coupling and routing geometry checks. Each retains the original 161 fixed FanoutSolver power traces, vias, pad joins and provenance. All eleven newly exported PNGs passed recorded visual inspection.

These are the reduced legacy scenes: 420 native pad obstacles, four copper layers, and native minimum via dimensions of 0.30 mm lands / 0.15 mm drills. The separate [exact native byte-phase proof](https://github.com/tscircuit/bus-lanes-solver/blob/328ace12cef6df723bb25fe6070deb0e8eef6822/docs/routed-am3352-byte/README.md) uses 11 signals, 1,144 obstacles and minimum via dimensions of 0.50 mm lands / 0.30 mm drills. This placement proof does not establish complete-board routing or fabrication readiness.

| Sample / fresh PNG | Route (s) | Signals | Native DRC | BYTE0 / BYTE1 / CA skew (mm) | DQS0 / DQS1 / CK skew (mm) | Max pair skew (mm) |
| --- | ---: | --- | --- | --- | --- | ---: |
| [control](control-solved.png) | 45.097 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.077868 / 0.126884 / 0.072830 | 0.126884 |
| [control-inner1](control-inner1-solved.png) | 1590.859 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.048900 / 0.004720 / 0.002792 | 0.048900 |
| [right](right-solved.png) | 33.051 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.096047 / 0.121802 / 0.102644 | 0.121802 |
| [left](left-solved.png) | 42.531 | 47/47 | Pass | 0.635000 / 0.511147 / — | 0.010514 / 0.127000 / 0.105429 | 0.127000 |
| [above](above-solved.png) | 46.445 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.127000 / 0.127000 / 0.127000 | 0.127000 |
| [inner-layers](inner-layers-solved.png) | 61.317 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.077868 / 0.126884 / 0.127000 | 0.127000 |
| [inner-layers-right](inner-layers-right-solved.png) | 87.162 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.127000 / 0.127000 / 0.127000 | 0.127000 |
| [inner-layers-left](inner-layers-left-solved.png) | 221.028 | 47/47 | Pass | 0.634990 / 0.634992 / — | 0.126990 / 0.000001 / 0.105429 | 0.126990 |
| [inner-layers-above](inner-layers-above-solved.png) | 272.137 | 47/47 | Pass | 0.634991 / 0.634993 / — | 0.126915 / 0.126990 / 0.000001 | 0.126990 |
| [inner-layers-complete-ca](inner-layers-complete-ca-solved.png) | 288.173 | 47/47 | Pass | 0.634990 / 0.634992 / 0.634994 | 0.075359 / 0.000000 / 0.066384 | 0.075359 |
| [outer-layers](outer-layers-solved.png) | 955.370 | 47/47 | Pass | 0.635000 / 0.635000 / — | 0.019219 / 0.127000 / 0.127000 | 0.127000 |

Lengths include complete planar pad-to-pad copper, both native terminal escapes and any supplied signal copper; via depth and package delay are not inferred. Bus skew limits remain 0.635 mm and pair skew limits 0.127 mm, with the existing 1e-7 mm numerical epsilon. The 24-member CA/CK group is declared only in `inner-layers-complete-ca`; an em dash denotes no declared CA group. Pair matching and physical coupling are checked separately in the independent audit.

The benchmark ran locally with Bun 1.4.0 in fresh serial workers. The table reports solver time, including routing and matching; fixture loading, independent validation and image export are excluded. Total solver time across the eleven cases was 3643.172 seconds. These are descriptive local timings, without a paired CI speed comparison.

Exact source is main `6f58178c3324c4f6b95c24f242c353e5927b75ce` plus fix `53814af4da9a0fed9a15d3d2b402ed316bdc2238`, including the merged PR61 default-layer fallback. The production `lib` tree is `926cfe1574b9ed5f6d57394dcbee006222288eaf`; the legacy fixture tree is `0e6564370d4dde2bbab46f717f79d8042625776e`. Local integration commit `49605dc0f56c9532e047c88928f27c8e3b46f8e1` is recorded for provenance and need not exist on GitHub. Reconstruct in a clean isolated checkout:

```sh
git switch --detach 6f58178c3324c4f6b95c24f242c353e5927b75ce
git merge --no-ff --no-commit 53814af4da9a0fed9a15d3d2b402ed316bdc2238
merged_tree=$(git write-tree)
git ls-tree "$merged_tree" lib tests/fixtures/am3352-ram
```

Compare the returned subtree IDs and the individual source/harness SHA-256 hashes in the artifact manifest. Dependency metadata, exact benchmark command and original run timestamps are retained in the run provenance; the source output was revalidated and rendered without rerouting or modifying copper. Successful native route JSONs remain available locally and are identified by hashes, avoiding duplicate raw copper in this gallery.

Evidence: [full benchmark measurements](benchmark-results.json), [independent native audit](independent-validation.json), [artifact/source hashes and reproduction metadata](artifact-manifest.json), [original run provenance](run-provenance.json), and [completed visual inspections](visual-inspection.json).

Inspection completed at 2026-10-20T17:36:01.547353+00:00. Reviewed manifest SHA-256: `a94590a12c1c30530f9da903538ea2e2cce6074a0ce1810291e784828a3bd8fe`; visual-inspection record SHA-256: `26064083cbf195e243dd120522ad33335351df832a6e3f8ad4047d9a064151a6`.

The earlier [180-second comparison](https://github.com/tscircuit/bus-lanes-solver/blob/328ace12cef6df723bb25fe6070deb0e8eef6822/docs/routed-am3352-byte/legacy-placement-comparison.md) is preserved as historical evidence: six accepted placements and five timeouts under that shorter budget. Its report and reference images are unchanged. The fresh proof above uses the full one-hour-per-case budget.

Repository Biome formatting preserves parsed values. The public manifest additionally records publication metadata and refreshed public byte hashes; benchmark, audit, run-provenance and visual-review values are unchanged. The manifest's `capturedFileSha256` preserves original local byte hashes; its current report, audit, provenance and inspection hash fields identify the formatted public files. PNGs and the [export audit script](revalidate-export.ts.txt) are byte-identical to their captured sources.
