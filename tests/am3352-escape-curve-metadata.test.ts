import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { length } from "../lib/geometry"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"
import { measureAm3352RoutingQuality } from "../scripts/measure-am3352-routing-quality"

const input: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  connections: [],
  obstacles: [],
}
const wire = (x: number, y: number, layer = "top"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})
function joinedCurvedEscapes() {
  const carrier: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "carrier",
    connection_name: "D",
    route: [wire(1, 0, "inner1"), wire(4, 0, "inner1")],
  }
  const escape = (id: string, side: number): Trace => ({
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: "D",
    route: [
      wire(side ? 5 : 0, -0.5),
      wire(side ? 4.75 : 0.25, -0.46875),
      wire(side ? 4.5 : 0.5, -0.375),
      wire(side ? 4.25 : 0.75, -0.21875),
      wire(side ? 4 : 1, 0),
      {
        route_type: "via",
        x: side ? 4 : 1,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      wire(side ? 4 : 1, 0, "inner1"),
    ],
    curvedSegments: [1, 2, 3, 4],
  })
  const escapes = [escape("source", 0), escape("target", 1)]
  return { joined: joinSignalEscapes(carrier, escapes), carrier, escapes }
}

test("joined TOP escape curves remain valid outside the via-bounded carrier", () => {
  const { joined, carrier, escapes } = joinedCurvedEscapes()
  const unchanged = JSON.stringify({ joined, carrier, escapes })
  expect(joined.curvedSegments).toEqual([1, 2, 3, 4, 10, 11, 12, 13])
  const quality = measureAm3352RoutingQuality(input, [joined])
  expect(quality.issues).toEqual([])
  expect(quality.nonOctilinearOrdinarySegments).toBe(0)
  expect(quality.sharpCurveCorners).toBe(0)
  expect(quality.totalPlanarLengthMm).toBeCloseTo(
    length(carrier.route) + escapes.reduce((n, t) => n + length(t.route), 0),
    12,
  )
  expect(joined.route[0]).toEqual(escapes[0].route[0])
  expect(joined.route.at(-1)).toEqual(escapes[1].route[0])
  expect(JSON.stringify({ joined, carrier, escapes })).toBe(unchanged)
})

test("escape curve tags reject invalid ending indices and layer or via handoffs", () => {
  const { joined } = joinedCurvedEscapes()
  const invalid = [0, -1, 0.5, NaN, Infinity, joined.route.length, 5, 6, 8, 9]
  for (const i of invalid) {
    const trace = { ...joined, curvedSegments: [...joined.curvedSegments!, i] }
    expect(measureAm3352RoutingQuality(input, [trace]).issues).toContain(
      "D: invalid curve ending-vertex indices",
    )
  }
  const differentPlane = {
    ...joined,
    route: joined.route.map((p, i) =>
      i === 2 && p.route_type === "wire" ? { ...p, layer: "bottom" } : p,
    ),
  }
  expect(measureAm3352RoutingQuality(input, [differentPlane]).issues).toContain(
    "D: invalid curve ending-vertex indices",
  )
  const duplicate = {
    ...joined,
    curvedSegments: [...joined.curvedSegments!, 1],
  }
  expect(measureAm3352RoutingQuality(input, [duplicate]).issues).toContain(
    "D: invalid curve ending-vertex indices",
  )
})
