import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { length } from "../lib/geometry"
import { busLengthReports, fixedRouteLength } from "../lib/route-lengths"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"

const createInput = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.1,
  bounds: { minX: -7, maxX: 7, minY: -5, maxY: 5 },
  obstacles: [],
  connections: [
    ...[-0.11, 0.11].map((y, i) => ({
      name: i ? "N" : "P",
      pointsToConnect: [-4, 4].map((x) => ({ x, y, layer: "top" })),
    })),
    {
      name: "ADDRESS",
      pointsToConnect: [
        { x: -4, y: 2, layer: "top" },
        { x: 4, y: 2, layer: "top" },
      ],
    },
  ],
  buses: [
    {
      busId: "CA",
      connectionNames: ["P", "N", "ADDRESS"],
      minLength: 14,
      maxLength: 15,
      maxLengthSkew: 0.635,
    },
  ],
  differentialPairs: [
    { connectionNames: ["P", "N"], lengthTolerance: 0.127, traceGap: 0.12 },
  ],
  traces: [-0.11, 0.11].flatMap((y, i) =>
    [-1, 1].map((side) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `escape_${i}_${side}`,
      connection_name: i ? "N" : "P",
      route: [5, 4].map((x) => ({
        route_type: "wire" as const,
        x: x * side,
        y,
        layer: "top",
        width: 0.1,
      })),
    })),
  ),
})

test("reserves a clock's bus minimum before routing ordinary members", () => {
  const input = createInput()
  const fixed = fixedCopper(input)
  const search = routeCoupledPair(input, input.differentialPairs![0], fixed)
  let step = search.next()
  for (let i = 0; !step.done && i < 16000; i++) step = search.next()
  expect(step.done).toBe(true)
  expect(step.value).not.toBeNull()
  const traces = step.value as Trace[]
  expect(traces).toHaveLength(2)
  for (const trace of traces) {
    const total =
      length(trace.route) + fixedRouteLength(input, trace.connection_name!)
    expect(total).toBeGreaterThanOrEqual(14 - 1e-7)
    expect(total).toBeLessThanOrEqual(15 + 1e-7)
    const connection = input.connections.find(
      (c) => c.name === trace.connection_name,
    )!
    expect(
      new VectorScene(input, connection, 0.1, [
        ...fixed,
        ...traces.flatMap(routeCopper),
      ]).pathVisible(trace.route),
    ).toBe(true)
  }
})

test("matches every bus member after reserving its clock minimum", () => {
  const input = createInput()
  const before = JSON.stringify(input.traces)
  const solver = new BusLanesSolver(input, {
    smoothTuning: true,
    denseSearch: true,
  })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(input.connections.length)
  expect(JSON.stringify(input.traces)).toBe(before)
  expect(busLengthReports(input, solver.traces)[0]).toMatchObject({
    aboveMinimumLength: true,
    withinLengthLimit: true,
    matched: true,
  })
  for (const trace of solver.traces) {
    const connection = input.connections.find(
      (c) => c.name === trace.connection_name,
    )!
    expect(
      new VectorScene(input, connection, 0.1, [
        ...fixedCopper(input),
        ...solver.traces.flatMap(routeCopper),
      ]).pathVisible(trace.route),
    ).toBe(true)
  }
})
