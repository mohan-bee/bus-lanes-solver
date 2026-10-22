# Native pair seed exceeds the shared planner's child budget

`planSharedPairCorridors` gives each pair search 6,000 yields. BYTE0's native
TOP DQS0 route around a freshly completed BYTE1 requires 24,086 yields. The
usual seed also starts from generated via handoffs instead of trying the native
pad endpoints, so increasing the handoff search budget alone misses this seed.

`bun test tests/native-ddr-pair-budget.test.ts` regenerates BYTE1 from the public
native fixture, rejects the 6,000-yield control and completes the same native
pair with 60,000. Independent checks include prior-byte DRC/timing, pair DRC
against fixed copper, pad connectivity, absolute maximum, skew and coupling.
Only the two-signal DQS0 scope is completed; the other nine BYTE0 signals and
full SBC are not claimed complete.

`bun scripts/snapshot-native-pair-budget.ts` freshly regenerates and validates
the completed scoped pair before exporting its snapshot. The fix tries an allowed original native pair seed for up to 60,000 yields
before retaining every existing handoff alternative. Ordinary negotiation for
that native seed receives 2,000,000 yields, and native surface pair repair around
prior copper receives 300,000. Other pair searches retain 6,000 and existing
ordinary budgets remain unchanged. Final DRC and timing acceptance is unchanged.

The production-path regression also checks that global/bus layer restrictions,
missing hard bounds, absence of prior copper and supplied own-net copper cannot
be bypassed, and that the pipeline actually offers the native-seed helper.
These changes complete the pair reproduction; full BYTE0/SBC completion remains
a separate validation.

`bun test tests/native-ddr-repair-budget.test.ts` reproduces the later repair
stage: collective pruning identifies its blocked ordinary signal, the repair
computes that ordinary candidate and recovers a valid pair after 201,522 pair
yields (202,047 including the ordinary control), beyond the former 60,000 cap.
The recovered pair passes absolute length, skew/coupling and combined copper
checks, including the computed ordinary candidate. The ordinary candidate is
not a completed length-matched byte.
