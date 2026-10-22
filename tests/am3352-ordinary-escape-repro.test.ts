import { expect, test } from "bun:test"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { loadAm3352OrdinaryEscapes } from "../scripts/load-am3352-ordinary-escapes"
import { length } from "../lib/geometry"
import { maximumCarrierLength } from "../lib/route-lengths"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"

function run(state: FlexibleSignalState, name: string, expanded: boolean) {
  const work = negotiateSignalSites(state, new Set([name]), false, expanded, {
    allowExpandedSites: expanded,
    maxCandidateSearchNodes: 12000,
  })
  let next = work.next(),
    steps = 0
  try {
    while (!next.done && steps++ < 20_000) next = work.next()
    expect(next.done).toBe(true)
    return next.value
  } finally {
    if (!next.done) work.return(null)
  }
}

test("repro: native surface policy misses a legal expanded DDR_D13 site", () => {
  const state = loadAm3352OrdinaryEscapes(),
    before = structuredClone(state)
  expect(run(state, "source_trace_1", false)).toBeNull()
  const expanded = run(state, "source_trace_1", true)!
  expect(expanded).not.toBeNull()
  const copper = [...expanded.traces, ...expanded.escapes].filter(
    (t) => t.connection_name === "source_trace_1",
  )
  expect(
    copper.reduce((sum, trace) => sum + length(trace.route), 0),
  ).toBeLessThanOrEqual(20.200131 + 1e-8)
  expect(length(expanded.traces[0].route)).toBeLessThanOrEqual(
    maximumCarrierLength(expanded.pending, "source_trace_1") + 1e-8,
  )
  const vias = copper.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias).toHaveLength(2)
  for (const via of vias)
    expect(via).toMatchObject({ via_hole_diameter: 0.3, via_diameter: 0.5 })
  expect(state).toEqual(before)
}, 60_000)

test("repro: selected clock pair strands DDR_CSn0 even with expanded sites", () => {
  const state = loadAm3352OrdinaryEscapes(),
    before = structuredClone(state)
  expect(run(state, "source_trace_5", true)).toBeNull()
  for (const pair of state.native.differentialPairs!) {
    const control = structuredClone(state),
      names = new Set(pair.connectionNames)
    control.retained = control.retained.filter(
      (trace) => !names.has(trace.connection_name!),
    )
    control.escapes = control.escapes.filter(
      (trace) => !names.has(trace.connection_name!),
    )
    const result = run(control, "source_trace_5", true)
    if (names.has("source_trace_32")) expect(result).not.toBeNull()
    else expect(result).toBeNull()
  }
  expect(state).toEqual(before)
}, 60_000)
