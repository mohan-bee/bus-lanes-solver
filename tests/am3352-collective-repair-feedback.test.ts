import { expect, test } from "bun:test"
import { loadAm3352CollectiveEscapes } from "../scripts/load-am3352-collective-escapes"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"

// Freshly generate pair copper from the public native fixture. These four
// ordinary signals have individually reachable but collectively incompatible
// escape domains. No saved intermediate copper participates in this test.
test("collective escape rejection currently omits the signal needed for pair repair", () => {
  const state = loadAm3352CollectiveEscapes()
  const pairNames = new Set(
    state.native.differentialPairs!.flatMap((p) => p.connectionNames),
  )
  state.traces = []
  state.escapes = state.escapes.filter((t) => pairNames.has(t.connection_name!))
  const before = structuredClone(state)
  const selected = new Set([
    "source_trace_1",
    "source_trace_2",
    "source_trace_12",
    "source_trace_13",
  ])
  const blocked: string[] = []
  const work = negotiateSignalSites(state, selected, false, false, {
    checkEscapeCompatibility: true,
    allowExpandedSites: true,
    expandEmptyDomainsOnly: true,
    maxCandidateSearchNodes: 12000,
    onBlockedConnection: (name) => blocked.push(name),
  })
  let next = work.next(),
    steps = 0
  try {
    while (!next.done && steps++ < 5000) next = work.next()
    expect(next.done).toBe(true)
    expect(next.value).toBeNull()
    // Regression: routeSurfaceOrdinarySignals requires this callback before
    // invoking repairSurfacePairEscape, so collective rejection skips repair.
    expect(blocked).toEqual([])
    expect(state).toEqual(before)
  } finally {
    if (!next.done) work.return(null)
  }
}, 120000)
