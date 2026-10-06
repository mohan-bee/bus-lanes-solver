import { expect, test } from "bun:test"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import { length } from "../lib/geometry"
import type { SimpleRouteJson, Trace } from "../lib/types"

function fixture(rotated: boolean): SimpleRouteJson {
  const connections = [-0.5, 0.5].map((y, index) => ({
    name: index ? "N" : "P",
    pointsToConnect: [
      { x: 0, y, layer: "top" },
      { x: 10, y, layer: "top" },
    ],
  }))
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 13, minY: -3, maxY: 3 },
    connections,
    obstacles: [0, 10].flatMap((x) =>
      connections.map((connection) => ({
        type: "rect" as const,
        componentId: `package_${x}`,
        connectedTo: [connection.name],
        center: { x, y: connection.pointsToConnect[0].y },
        layers: ["top"],
        width: rotated ? 0.8 : 0.16,
        height: rotated ? 0.16 : 0.8,
        ccwRotationDegrees: rotated ? 90 : 0,
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.12, lengthTolerance: 0.127 },
    ],
  }
}
function solve(input: SimpleRouteJson): Trace[] {
  const fixed = fixedCopper(input)
  const search = routeCoupledPair(input, input.differentialPairs![0], fixed, {
    copper: [],
    penalty: 1,
    variant: 0,
  })
  let next = search.next(),
    steps = 0
  while (!next.done && steps++ < 10000) next = search.next()
  if (!next.done) {
    search.return(null)
    throw Error("Rotated pair fixture exceeded its bound")
  }
  expect(next.value).toBeTruthy()
  const traces = next.value!
  for (const [index, trace] of traces.entries())
    expect(
      new VectorScene(input, input.connections[index], 0.1, [
        ...fixed,
        ...traces.flatMap(routeCopper),
      ]).pathVisible(trace.route),
    ).toBe(true)
  return traces
}
test("paired handoffs use the physical ninety-degree pad field on both corridor axes", () => {
  const unrotated = fixture(false),
    rotated = fixture(true),
    original = structuredClone(rotated)
  const expected = solve(unrotated),
    actual = solve(rotated)
  const rounded = (traces: Trace[]) =>
    traces.map((trace) =>
      trace.route.map((point) => ({
        x: Math.round(point.x * 1e7) / 1e7,
        y: Math.round(point.y * 1e7) / 1e7,
      })),
    )
  expect(rounded(actual)).toEqual(rounded(expected))
  expect(actual.map((trace) => length(trace.route))).toEqual(
    expected.map((trace) => length(trace.route)),
  )
  expect(rotated).toEqual(original)
})
