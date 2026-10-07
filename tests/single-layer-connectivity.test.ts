import { checkSignalSelfShorts } from "../lib/check-signal-self-shorts"
import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  SingleLayerConnectivitySolver,
  BusLanesPipelineSolver,
  busLengthReports,
  pairLengthReports,
} from "../lib"
import { loadAm3352Sample } from "../scripts/am3352-samples"
import { validateAm3352OutputShape } from "../scripts/validate-am3352-sample"

test("control connects all 47 native signals on inner1 without changing fixed power or timing rules", async () => {
  const { input, metadata } = await loadAm3352Sample("control")
  input.allowedLayers = ["inner1"]
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    goal: "connectivity",
    connectivity: { fixedConnections: metadata.powerConnections },
  })
  expect(() => solver.getOutput()).toThrow("not solved")
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(checkSignalSelfShorts(input, solver.traces)).toEqual([])
  expect(input).toEqual(before)
  const output = solver.getOutput()
  validateAm3352OutputShape(input, metadata, solver.traces, output)
  expect(output.traces).toHaveLength(208)
  expect(output.buses).toEqual(before.buses)
  expect(output.differentialPairs).toEqual(before.differentialPairs)
  for (const connection of input.connections) {
    const trace = solver.traces.find(
      (t) => t.connection_name === connection.name,
    )!
    expect(trace.source_trace_id).toBe(connection.source_trace_id)
    const [first, last] = [trace.route[0], trace.route.at(-1)!]
    expect(first).toMatchObject({
      x: connection.pointsToConnect[0].x,
      y: connection.pointsToConnect[0].y,
      layer: "top",
      route_type: "wire",
    })
    expect(last).toMatchObject({
      x: connection.pointsToConnect[1].x,
      y: connection.pointsToConnect[1].y,
      layer: "top",
      route_type: "wire",
    })
    const viaIndices = trace.route.flatMap((p, i) =>
      p.route_type === "via" ? [i] : [],
    )
    expect(viaIndices).toHaveLength(2)
    for (let i = 0; i < trace.route.length; i++) {
      const point = trace.route[i]
      if (point.route_type === "wire") {
        expect(point.layer).toBe(
          i > viaIndices[0] && i < viaIndices[1] ? "inner1" : "top",
        )
      } else {
        expect(point.layers).toEqual(["top", "inner1", "inner2", "bottom"])
        for (const terminal of connection.pointsToConnect) {
          expect(
            Math.hypot(point.x - terminal.x, point.y - terminal.y),
          ).toBeGreaterThan(1e-8)
        }
      }
    }
  }
  const validationInput = {
    ...input,
    connections: [...input.connections, ...metadata.powerConnections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: validationInput,
    routedSrj: { ...output, connections: validationInput.connections },
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])
  expect(drc.valid).toBe(true)
  // This stage must never present connectivity as DDR timing acceptance.
  const reports = {
    buses: busLengthReports(input, solver.traces),
    pairs: pairLengthReports(input, solver.traces),
  }
  expect(reports.buses.some((bus) => !bus.matched)).toBe(true)
  expect(solver.stats.matchingEnforced).toBe(false)
  expect(
    solver.visualize().lines?.some((line) => line.layer === "inner1"),
  ).toBe(true)
}, 120_000)

test("exhausted negotiation never publishes provisional routes", async () => {
  const { input, metadata } = await loadAm3352Sample("control")
  input.allowedLayers = ["inner1"]
  const solver = new SingleLayerConnectivitySolver(input, {
    fixedConnections: metadata.powerConnections,
    maxPasses: 0,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.traces).toEqual([])
  expect(() => solver.getOutput()).toThrow("pass budget")
})
