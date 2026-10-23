import { expect, test, spyOn } from "bun:test"
import { loadAm3352CollectiveEscapes } from "../scripts/load-am3352-collective-escapes"
import { routeSurfaceOrdinarySignals } from "../lib/route-surface-ordinary-signals"
import * as pairRepair from "../lib/repair-surface-pair-escape"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"

// Freshly generate pair copper from the public native fixture. These four
// ordinary signals have individually reachable but collectively incompatible
// escape domains. No saved intermediate copper participates in this test.
test("collective escape rejection reports a proven empty domain for pair repair", () => {
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
    // The caller can now invoke generated-pair repair for this conflict.
    expect(blocked).toHaveLength(1)
    expect(selected.has(blocked[0])).toBe(true)
    expect(state).toEqual(before)
  } finally {
    if (!next.done) work.return(null)
  }
}, 120000)

test("the surface caller invokes generated-pair repair after collective rejection", () => {
  const state = loadAm3352CollectiveEscapes()
  const pairNames = new Set(
    state.native.differentialPairs!.flatMap((p) => p.connectionNames),
  )
  state.traces = []
  state.escapes = state.escapes.filter((t) => pairNames.has(t.connection_name!))
  const selected = new Set([
    "source_trace_1",
    "source_trace_2",
    "source_trace_12",
    "source_trace_13",
  ])
  const before = structuredClone(state),
    blocked: string[] = []
  const mocked = spyOn(
    pairRepair,
    "repairSurfacePairEscape",
  ).mockImplementation(function* (_state, name) {
    blocked.push(name)
    return null
  })
  const work = routeSurfaceOrdinarySignals(state, selected, { maxSteps: 20000 })
  let next = work.next(),
    steps = 0
  try {
    while (!next.done && steps++ < 5000) next = work.next()
    expect(next.done).toBe(true)
    expect(next.value).toBeNull()
    expect(blocked).toHaveLength(1)
    expect(selected.has(blocked[0])).toBe(true)
    expect(state).toEqual(before)
  } finally {
    if (!next.done) work.return(null)
    mocked.mockRestore()
  }
}, 120000)
