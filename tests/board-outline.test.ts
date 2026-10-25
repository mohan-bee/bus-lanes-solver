import { expect, test } from "bun:test"
import { BusLanesSolver, type SimpleRouteJson, type Trace } from "../lib"
import {
  isSegmentInsideBoardOutline,
  tracesInsideBoardOutline,
} from "../lib/board-outline"
import { length, segmentDistance } from "../lib/geometry"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { VectorScene } from "../lib/vector-scene"

test("a rounded practice board routes and matches all eight data lanes and clock", () => {
  const names = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "CLK"]
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minTraceToPadEdgeClearance: 0.2,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -32, maxX: 32, minY: -20, maxY: 20 },
    // The board's 2 mm corner arcs are supplied as an ordinary polygon,
    // matching the outline emitted for tscircuit's borderRadius property.
    outline: [
      { x: 30, y: 18, angle: 0 },
      { x: -30, y: 18, angle: Math.PI / 2 },
      { x: -30, y: -18, angle: Math.PI },
      { x: 30, y: -18, angle: (3 * Math.PI) / 2 },
    ].flatMap((corner) =>
      Array.from({ length: 9 }, (_, i) => ({
        x: corner.x + 2 * Math.cos(corner.angle + (i * Math.PI) / 16),
        y: corner.y + 2 * Math.sin(corner.angle + (i * Math.PI) / 16),
      })),
    ),
    connections: names.map((name, i) => ({
      name,
      pointsToConnect: [
        { x: -24, y: 11.43 - i * 2.54, layer: "top" },
        { x: 24, y: 11.43 - i * 2.54, layer: "top" },
      ],
    })),
    buses: [
      {
        busId: "DATA_AND_CLOCK",
        connectionNames: names,
        minLength: 49.5,
        maxLength: 50.5,
        maxLengthSkew: 0.1,
      },
    ],
    obstacles: [],
  }
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.traces).toHaveLength(9)
  expect(input).toEqual(before)
  const lengths = solver.traces.map((trace) => length(trace.route))
  expect(Math.min(...lengths)).toBeGreaterThanOrEqual(49.5 - 1e-7)
  expect(Math.max(...lengths)).toBeLessThanOrEqual(50.5 + 1e-7)
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(
    0.1 + 1e-7,
  )
  for (const connection of input.connections) {
    const trace = solver.traces.find(
      (trace) => trace.connection_name === connection.name,
    )!
    expect(trace.route[0]).toMatchObject(connection.pointsToConnect[0])
    expect(trace.route.at(-1)).toMatchObject(connection.pointsToConnect[1])
    for (const point of trace.route) {
      expect(point.route_type).toBe("wire")
      // Independent rounded-rectangle containment, in board coordinates.
      const dx = Math.max(Math.abs(point.x) - 30, 0)
      const dy = Math.max(Math.abs(point.y) - 18, 0)
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(4 + 1e-7)
    }
    for (let i = 1; i < trace.route.length; i++) {
      for (let j = 0; j < input.outline!.length; j++) {
        expect(
          segmentDistance(
            [trace.route[i - 1], trace.route[i]],
            [
              input.outline![j],
              input.outline![(j + 1) % input.outline!.length],
            ],
          ),
        ).toBeGreaterThanOrEqual(0.3 - 1e-7)
      }
    }
  }
  for (let i = 0; i < solver.traces.length; i++) {
    for (let j = i + 1; j < solver.traces.length; j++) {
      const a = solver.traces[i].route
      const b = solver.traces[j].route
      for (let k = 1; k < a.length; k++) {
        for (let m = 1; m < b.length; m++) {
          expect(
            segmentDistance([a[k - 1], a[k]], [b[m - 1], b[m]]),
          ).toBeGreaterThanOrEqual(0.4 - 1e-7)
        }
      }
    }
  }
})

test("outline edge clearance includes half the trace width", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 11 },
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 2, y: 0.3, layer: "top" },
          { x: 8, y: 0.3, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  const scene = new VectorScene(input, input.connections[0], 0.2, [])
  expect(scene.visible({ x: 2, y: 0.3 }, { x: 8, y: 0.3 })).toBe(true)
  expect(scene.visible({ x: 2, y: 0.299999 }, { x: 8, y: 0.299999 })).toBe(
    false,
  )
  expect(scene.visible({ x: -0.5, y: 2 }, { x: -0.5, y: 8 })).toBe(false)
})

function getConcaveBoardInput(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.2,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ],
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 2, y: 8, layer: "top" },
          { x: 8, y: 8, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
}

test("a concave outline rejects crossing segments and routes around the notch", () => {
  const input = getConcaveBoardInput()
  const [start, end] = input.connections[0].pointsToConnect
  const scene = new VectorScene(input, input.connections[0], 0.2, [])
  expect(scene.visible(start, start)).toBe(true)
  expect(scene.visible(end, end)).toBe(true)
  expect(scene.visible(start, end)).toBe(false)

  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(1)
  const route = solver.traces[0].route
  expect(route[0]).toMatchObject(start)
  expect(route.at(-1)).toMatchObject(end)
  expect(Math.min(...route.map((point) => point.y))).toBeLessThanOrEqual(3.7)
  for (let i = 1; i < route.length; i++) {
    const midpoint = {
      x: (route[i - 1].x + route[i].x) / 2,
      y: (route[i - 1].y + route[i].y) / 2,
    }
    expect(midpoint.x < 4 || midpoint.x > 6 || midpoint.y <= 4).toBe(true)
    for (let j = 0; j < input.outline!.length; j++) {
      expect(
        segmentDistance(
          [route[i - 1], route[i]],
          [input.outline![j], input.outline![(j + 1) % input.outline!.length]],
        ),
      ).toBeGreaterThanOrEqual(0.3 - 1e-7)
    }
  }
})

test("changing an outline invalidates cached rectangular grid routing", () => {
  const input = getConcaveBoardInput()
  const [start, end] = input.connections[0].pointsToConnect
  // Reuse the same input identity after a rectangular grid has been cached.
  const gridInput: SimpleRouteJson = { ...input, outline: undefined }
  const rectangularSearch = new GridVisibilitySearch(
    new VectorScene(gridInput, gridInput.connections[0], 0.2, []),
    start,
    end,
  )
  while (!rectangularSearch.solved && !rectangularSearch.failed)
    rectangularSearch.step()
  expect(rectangularSearch.solved).toBe(true)
  expect(length(rectangularSearch.result)).toBeCloseTo(6, 7)
  gridInput.outline = input.outline
  const notchedSearch = new GridVisibilitySearch(
    new VectorScene(gridInput, gridInput.connections[0], 0.2, []),
    start,
    end,
  )
  while (!notchedSearch.solved && !notchedSearch.failed) notchedSearch.step()
  expect(notchedSearch.solved).toBe(true)
  expect(
    Math.min(...notchedSearch.result.map((point) => point.y)),
  ).toBeLessThanOrEqual(3.7)
})

test("final validation rejects copper crossing a concave outline", () => {
  const input = getConcaveBoardInput()
  const [start, end] = input.connections[0].pointsToConnect
  const invalidTrace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "invalid_notch_crossing",
    connection_name: "D0",
    route: [
      { ...start, route_type: "wire", width: 0.2 },
      { ...end, route_type: "wire", width: 0.2 },
    ],
  }
  const validation = BusLanesSolver.forValidation(input, [invalidTrace])
  validation.solve()
  expect(validation.solved).toBe(false)
  expect(validation.failed).toBe(true)
  expect(validation.error).toContain("Final copper clearance violation")
  expect(() => validation.getOutput()).toThrow()
})

test("an explicitly closed clockwise outline is accepted", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    outline: [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ],
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 2, y: 5, layer: "top" },
          { x: 8, y: 5, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(1)
  expect(length(solver.traces[0].route)).toBeCloseTo(6, 7)
})

test("a self-intersecting outline fails instead of publishing routes", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 8 },
      { x: 8, y: 0 },
    ],
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 2, y: 5, layer: "top" },
          { x: 8, y: 5, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  const solver = new BusLanesSolver(input)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("invalid_outline")
  expect(() => solver.getOutput()).toThrow()
})

test("zero edge clearance still rejects a segment crossing a concave notch", () => {
  const outline = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 6, y: 10 },
    { x: 6, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ]
  expect(
    isSegmentInsideBoardOutline({
      segment: [
        { x: 2, y: 8 },
        { x: 8, y: 8 },
      ],
      outline,
      clearance: 0,
    }),
  ).toBe(false)
  expect(
    isSegmentInsideBoardOutline({
      segment: [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
      ],
      outline,
      clearance: 0,
    }),
  ).toBe(true)
})

test("generated via pads retain board edge clearance independently of wire width", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    outline: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    connections: [],
    obstacles: [],
  }
  const wireTrace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "wire",
    route: [
      { route_type: "wire", x: 0.49, y: 2, layer: "top", width: 0.2 },
      { route_type: "wire", x: 0.49, y: 8, layer: "top", width: 0.2 },
    ],
  }
  const viaTrace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "generated_via",
    route: [
      {
        route_type: "via",
        x: 0.49,
        y: 5,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
    ],
  }
  expect(tracesInsideBoardOutline(input, [wireTrace])).toBe(true)
  expect(tracesInsideBoardOutline(input, [wireTrace, viaTrace])).toBe(false)
  viaTrace.route[0].x = 0.5
  expect(tracesInsideBoardOutline(input, [wireTrace, viaTrace])).toBe(true)
})
