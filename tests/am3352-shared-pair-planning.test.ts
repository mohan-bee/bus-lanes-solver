import { expect, test } from "bun:test"
import { planSharedPairCorridors } from "../lib/plan-shared-pair-corridors"
import { RouteConflictIndex } from "../lib/route-conflict-index"
import { length } from "../lib/geometry"
import { maximumCarrierLength, pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import type { Trace, Wire } from "../lib/types"
import { loadAm3352SharedPairs } from "../scripts/load-am3352-shared-pairs"

test("native AM3352 plans all three pairs within a bounded search", () => {
  const { input, terminalLayers } = loadAm3352SharedPairs()
  const before = structuredClone(input)
  const search = planSharedPairCorridors(input, terminalLayers, true, {
    preferPackageOnlyTuning: true,
  })
  let state = search.next()
  let steps = 0
  try {
    while (!state.done && !state.value && steps < 20_000) {
      steps++
      state = search.next()
    }
    expect({ jointPlan: !!state.value, steps }).toMatchObject({
      jointPlan: true,
    })
    const traces = state.value as Trace[]
    expect(traces).toHaveLength(6)
    expect(input).toEqual(before)
    expect(
      sharedPairSpacingReports(input, traces).every((pair) => pair.matched),
    ).toBe(true)
    expect(pairLengthReports(input, traces).every((pair) => pair.matched)).toBe(
      true,
    )
    const clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    const conflicts = new RouteConflictIndex()
    const pairs = input.differentialPairs!
    for (const trace of traces) {
      expect(length(trace.route)).toBeLessThanOrEqual(
        maximumCarrierLength(input, trace.connection_name!) + 1e-7,
      )
      const layer = (trace.route[0] as Wire).layer
      expect(
        input.buses!.find((bus) =>
          bus.connectionNames.includes(trace.connection_name!),
        )!.allowedLayers!,
      ).toContain(layer)
      for (const other of traces) {
        if (
          trace === other ||
          pairs.some(
            (pair) =>
              pair.connectionNames.includes(trace.connection_name!) &&
              pair.connectionNames.includes(other.connection_name!),
          )
        )
          continue
        if ((other.route[0] as Wire).layer !== layer) continue
        expect(
          conflicts.firstConflict(
            trace.route,
            other.route,
            ((trace.route[0] as Wire).width + (other.route[0] as Wire).width) /
              2 +
              clearance -
              1e-8,
          ),
        ).toBeNull()
      }
    }
  } finally {
    if (!state.done) search.return(undefined)
  }
}, 120_000)
