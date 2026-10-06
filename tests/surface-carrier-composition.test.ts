import { expect, test } from "bun:test"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { normalizeSurfaceCarriers } from "../lib/normalize-surface-carriers"
import { length } from "../lib/geometry"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const trace = (
  id: string,
  points: number[][],
  curvedSegments?: number[],
): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: "DATA",
  curvedSegments,
  route: points.map(([x, y]) => ({
    route_type: "wire",
    x,
    y,
    layer: "top",
    width: 0.1,
  })),
})

test("surface composition exposes native terminals without double-counting fanout copper", () => {
  const prefix = trace(
    "source",
    [
      [0, 0],
      [0.5, 0.1],
      [1, 0],
    ],
    [1, 2],
  )
  const suffix = trace(
    "target",
    [
      [4, 0],
      [3.5, 0.1],
      [3, 0],
    ],
    [1, 2],
  )
  const carrier = {
    ...trace(
      "carrier",
      [
        [1, 0],
        [2, 0],
        [3, 0],
      ],
      [1],
    ),
    coupledSection: [0, 2] as [number, number],
  }
  const fixed = {
    ...trace("power", [
      [0, 2],
      [4, 2],
    ]),
    connection_name: "GND",
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [carrier.route[0], carrier.route.at(-1)!] as Wire[],
      },
    ],
    traces: [fixed, prefix, suffix],
  }
  const before = structuredClone(input)
  const result = normalizeSurfaceCarriers(input, [carrier], [prefix, suffix])
  const joined = result.traces[0]
  expect(result.input.connections[0].pointsToConnect).toEqual([
    prefix.route[0] as Wire,
    suffix.route[0] as Wire,
  ])
  expect(joined.curvedSegments).toEqual([1, 2, 3, 5, 6])
  expect(joined.coupledSection).toEqual([2, 4])
  expect(length(joined.route)).toBeCloseTo(
    length(prefix.route) + length(carrier.route) + length(suffix.route),
    10,
  )
  expect(result.escapes.every((escape) => escape.route.length === 1)).toBe(true)
  expect(result.input.traces![0]).toBe(fixed)
  expect(input).toEqual(before)
})

test("joining bottom dogbones reverses the terminal via and preserves its physical span", () => {
  const makeEscape = (id: string, x: number): Trace => ({
    ...trace(
      id,
      [
        [x, 1],
        [x, 0],
      ],
      [1],
    ),
    route: [
      ...trace(id, [
        [x, 1],
        [x, 0],
      ]).route,
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
      },
      { route_type: "wire", x, y: 0, layer: "bottom", width: 0.1 },
    ],
  })
  const prefix = makeEscape("source", 0),
    suffix = makeEscape("target", 4)
  const carrier = {
    ...trace("carrier", [
      [0, 0],
      [4, 0],
    ]),
    route: trace("carrier", [
      [0, 0],
      [4, 0],
    ]).route.map((point) => ({ ...point, layer: "bottom" })),
  } as Trace
  const before = structuredClone([prefix, suffix])
  const joined = joinSignalEscapes(carrier, [prefix, suffix])
  const vias = joined.route.filter((point) => point.route_type === "via")
  expect(vias).toHaveLength(2)
  expect(vias[1]).toMatchObject({
    from_layer: "bottom",
    to_layer: "top",
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(joined.curvedSegments).toEqual([1, joined.route.length - 1])
  expect([prefix, suffix]).toEqual(before)
})
