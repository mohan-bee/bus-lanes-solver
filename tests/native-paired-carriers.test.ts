import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib"
import { planNativePairedCarriers } from "../lib/plan-native-paired-carriers"
import { pairLengthReports } from "../lib/route-lengths"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { loadAm3352Sample } from "../scripts/am3352-samples"

test("fresh control pair backbones match whole copper and stay physically coupled on inner1", async () => {
  const { input, metadata } = await loadAm3352Sample("control-inner1"),
    before = JSON.stringify(input)
  const search = planNativePairedCarriers(input)
  let result = search.next()
  while (!result.done) result = search.next()
  const traces = result.value!
  expect(traces).toHaveLength(6)
  expect(
    traces.every(
      (t) => t.route.filter((p) => p.route_type === "via").length === 2,
    ),
  ).toBe(true)
  expect(pairLengthReports(input, traces).every((p) => p.matched)).toBe(true)
  expect(sharedPairSpacingReports(input, traces).every((p) => p.matched)).toBe(
    true,
  )
  expect(
    exteriorPairSpacingReports(input, traces).every((p) => p.matched),
  ).toBe(true)
  expect(routeAnglesAreConventional(traces)).toBe(true)
  expect(traces.every(nativeSignalGeometryIsValid)).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: {
        ...input,
        connections: [...input.connections, ...metadata.powerConnections],
      },
      routedSrj: { ...input, traces: [...input.traces!, ...traces] },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect(JSON.stringify(input)).toBe(before)
}, 30000)

test("matched native pipeline requires genuine owners for immutable power copper", async () => {
  const { input } = await loadAm3352Sample("control-inner1")
  const before = JSON.stringify(input),
    solver = new BusLanesPipelineSolver(input)
  solver.step()
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain("Supply fixedConnections")
  expect(solver.solved).toBe(false)
  expect(JSON.stringify(input)).toBe(before)
})
