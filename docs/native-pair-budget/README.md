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
the completed scoped pair before exporting its snapshot. The stacked fix adds
native seeds and increases only the relevant hard-length continuation budgets,
while retaining the existing handoff alternatives and final acceptance rules.
