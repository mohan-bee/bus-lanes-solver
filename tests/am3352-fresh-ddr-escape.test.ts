import { expect, spyOn, test } from "bun:test"
import { BusLanesPipelineSolver, BusLanesSolver } from "../lib"
import type { SimpleRouteJson } from "../lib"
import { loadAm3352FreshNativeInput } from "../scripts/load-am3352-fresh-native"

test("fresh full DDR assigns local escapes when optional allowedLayers is omitted", () => {
  const input = loadAm3352FreshNativeInput()
  const before = structuredClone(input)
  expect(input.allowedLayers).toBeUndefined()
  const attempts: SimpleRouteJson[] = []
  // Exercise the real layer allocation and dogbone matcher, then stop at the
  // planar child. This is an escape regression, not a completed DDR route.
  const childStep = spyOn(BusLanesSolver.prototype, "_step").mockImplementation(
    function (this: BusLanesSolver) {
      attempts.push(structuredClone(this.input))
      this.failed = true
      this.error =
        "Planar routing intentionally stopped after escape assignment"
    },
  )
  try {
    const solver = new BusLanesPipelineSolver(input)
    solver.solve()
    expect(solver.failed).toBe(true)
  } finally {
    childStep.mockRestore()
  }
  expect(input).toEqual(before)
  expect(attempts.length).toBeGreaterThan(0)
  const assigned = attempts[0]!
  expect(
    assigned.connections.map((connection) => [
      connection.name,
      connection.source_trace_id,
    ]),
  ).toEqual(
    input.connections.map((connection) => [
      connection.name,
      connection.source_trace_id,
    ]),
  )
  const escapes = assigned.traces!
  expect(escapes.length).toBeGreaterThan(0)
  const cke = assigned.connections.find(
    (connection) => connection.name === "source_trace_46",
  )!
  expect(cke.pointsToConnect.map((point) => point.layer)).toEqual([
    "top",
    "top",
  ])
  expect(escapes.filter((trace) => trace.connection_name === cke.name)).toEqual(
    [],
  )
  for (const connection of input.connections) {
    const handoffs = assigned.connections.find(
      (candidate) => candidate.name === connection.name,
    )!.pointsToConnect
    expect(handoffs).toHaveLength(2)
    for (const [index, terminal] of connection.pointsToConnect.entries()) {
      const escape = escapes.find(
        (trace) =>
          trace.connection_name === connection.name &&
          trace.route[0].x === terminal.x &&
          trace.route[0].y === terminal.y,
      )
      if (!escape) {
        expect(handoffs[index]).toEqual(terminal)
        continue
      }
      expect(escape.source_trace_id).toBe(connection.source_trace_id)
      const vias = escape.route.filter((point) => point.route_type === "via")
      expect(vias).toHaveLength(1)
      expect(vias[0]!.via_diameter).toBe(0.5)
      expect(vias[0]!.via_hole_diameter).toBe(0.3)
      expect(vias[0]!.layers).toEqual(["top", "inner1", "inner2", "bottom"])
      const end = escape.route.at(-1)!
      expect(end.route_type).toBe("wire")
      expect({ x: end.x, y: end.y }).toEqual({
        x: handoffs[index]!.x,
        y: handoffs[index]!.y,
      })
      expect("layer" in end && end.layer).toBe(handoffs[index]!.layer)
    }
  }
}, 30_000)
