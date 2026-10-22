# Collective rejection skips pair repair

`negotiateSignalSites` reports individually empty domains through
`onBlockedConnection`, but returns null without that callback when
`pruneCandidateDomains` empties a domain. Its caller therefore skips generated
pair repair and enumerates another pair seed.

Run `bun test tests/am3352-collective-repair-feedback.test.ts`. The test freshly
generates its pair state from the existing public 46-signal native fixture,
checks four ordinary domains and records the missing callback. The stacked fix
will require a callback identifying a domain proved empty, while preserving
inputs and leaving support-check exhaustion inconclusive.

The completed native BYTE1 snapshot in `../native-ddr-sequential` illustrates
validated native routing at 0.30/0.50 mm vias. It is a separate completed byte,
not a picture of the failed four-domain case or a complete SBC. PR descriptions
also include the eleven inspected completed legacy reference snapshots; fresh
base/head benchmark results are reported separately.
