import { expect, test } from "bun:test"
import { nativeSignalGeometryIsValid } from "../lib/native-signal-geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { Trace } from "../lib/types"

const trace = (points: number[][]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: "signal",
  connection_name: "signal",
  route: points.map(([x, y]) => ({
    x,
    y,
    route_type: "wire",
    layer: "inner1",
    width: 0.1,
  })),
})

test("native acceptance rejects ordinary non-octilinear copper even without a sharp turn", () => {
  const sloped = trace([
    [0, 0],
    [2, 1],
  ])
  expect(routeAnglesAreConventional([sloped])).toBe(true)
  expect(nativeSignalGeometryIsValid(sloped)).toBe(false)
  expect(
    nativeSignalGeometryIsValid(
      trace([
        [0, 0],
        [1, 0],
        [2, 1],
      ]),
    ),
  ).toBe(true)
})

test("native acceptance rejects duplicate, misplaced and cross-plane curve tags", () => {
  const copper = trace([
    [0, 0],
    [1, 0],
    [2, 1],
  ])
  for (const indices of [[0], [3], [1, 1], [1.5]]) {
    copper.curvedSegments = indices
    expect(nativeSignalGeometryIsValid(copper)).toBe(false)
  }
  copper.curvedSegments = [1]
  if (copper.route[1].route_type === "wire") copper.route[1].layer = "top"
  expect(nativeSignalGeometryIsValid(copper)).toBe(false)
})
