import { expect, test } from "bun:test"
import { loadAm3352CollectiveEscapes } from "../scripts/load-am3352-collective-escapes"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { routeSurfaceOrdinarySignals } from "../lib/route-surface-ordinary-signals"
import { runBoundedRouting } from "../lib/run-bounded-routing"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"

const names = [
  "source_trace_1",
  "source_trace_2",
  "source_trace_12",
  "source_trace_13",
]

function freshState() {
  const state = loadAm3352CollectiveEscapes()
  const pairNames = new Set(
    state.native.differentialPairs!.flatMap((pair) => pair.connectionNames),
  )
  // Match the hard pair copper seen by the full forty-signal negotiation.
  // Previously computed ordinary candidates participate in that negotiation;
  // they are not fixed copper for this four-signal subproblem.
  state.traces = []
  state.escapes = state.escapes.filter((trace) =>
    pairNames.has(trace.connection_name!),
  )
  return state
}
function drive(
  work: Generator<unknown, FlexibleSignalState | null>,
  limit: number,
) {
  let next = work.next(),
    yields = 0
  try {
    while (!next.done && yields++ < limit) next = work.next()
    return {
      done: next.done === true,
      value: next.done ? next.value : null,
      yields,
    }
  } finally {
    if (!next.done) work.return(null)
  }
}

test("jointly incompatible native escapes reject a pair seed before carrier negotiation", () => {
  const state = freshState(),
    before = structuredClone(state),
    selected = new Set(names)
  const checked = drive(
    routeSurfaceOrdinarySignals(state, selected, {
      maxSteps: 20000,
      maxPairRepairs: 0,
    }),
    20010,
  )
  expect(checked.done).toBe(true)
  expect(checked.value).toBeNull()
  // Site generation is small; the legacy rip-up loop spends far more yields
  // trying to route an impossible set of fixed escape alternatives.
  expect(checked.yields).toBeLessThan(5000)
  const legacy = drive(
    negotiateSignalSites(state, selected, false, false, {
      allowExpandedSites: true,
      expandEmptyDomainsOnly: true,
      maxCandidateSearchNodes: 12000,
    }),
    10000,
  )
  expect(legacy.done).toBe(false)
  expect(state).toEqual(before)
  expect(state.native.connections).toHaveLength(46)
  expect(state.native.obstacles).toHaveLength(1144)
  expect(state.native.minViaHoleDiameter).toBe(0.3)
  expect(state.native.minViaPadDiameter).toBe(0.5)
}, 120000)

test("collective pruning retains a routable four-signal control when generated DQS0 is released", () => {
  const state = freshState()
  const dqs0 = new Set(["source_trace_15", "source_trace_16"])
  state.retained = state.retained.filter(
    (trace) => !dqs0.has(trace.connection_name!),
  )
  state.escapes = state.escapes.filter(
    (trace) => !dqs0.has(trace.connection_name!),
  )
  const before = structuredClone(state)
  const result = drive(
    runBoundedRouting(
      negotiateSignalSites(state, new Set(names), false, true, {
        checkEscapeCompatibility: true,
        allowExpandedSites: true,
        maxCandidateSearchNodes: 12000,
      }),
      50000,
    ),
    50010,
  )
  expect(result.done).toBe(true)
  expect(result.value).not.toBeNull()
  expect(
    result.value!.traces.map((trace) => trace.connection_name).sort(),
  ).toEqual([...names].sort())
  expect(result.value!.retained).toEqual(state.retained)
  expect(state).toEqual(before)
}, 120000)
