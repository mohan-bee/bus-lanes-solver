# Collective rejection skips pair repair

Previously `negotiateSignalSites` reported individually empty domains through
`onBlockedConnection`, but omitted it when `pruneCandidateDomains` emptied a
domain. The callback now identifies that proven empty domain as well, allowing
the caller to attempt generated-pair repair.

Run `bun test tests/am3352-collective-repair-feedback.test.ts`. The test freshly
generates its pair state from the existing public 46-signal native fixture and
requires one callback identifying a domain proved empty. Unit controls cover
propagated and initially empty domains, immutable inputs and inconclusive
support-check exhaustion. The caller can now attempt generated-pair repair.
This repairs feedback, not the complete native SBC route.

The completed native BYTE1 snapshot in `../native-ddr-sequential` illustrates
validated native routing at 0.30/0.50 mm vias. It is a separate completed byte,
not a picture of the failed four-domain case or a complete SBC. PR descriptions
also include the eleven inspected completed legacy reference snapshots; fresh
base/head benchmark results are reported separately.
