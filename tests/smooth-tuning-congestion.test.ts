import { expect, test } from "bun:test"
import { length } from "../lib/geometry"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"

function channel() {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -1, maxX: 11, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "D",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "D",
    connection_name: "D",
    route: [0, 10].map((x) => ({
      x,
      y: 0,
      route_type: "wire",
      layer: "top",
      width: 0.1,
    })),
  }
  return { input, trace }
}
const preferUpper = (trace: Trace) =>
  -trace.route.reduce((sum, p) => sum + p.y, 0) / trace.route.length

test("negotiated tuning selects a less congested bank without changing its length or endpoints", () => {
  const { input, trace } = channel()
  const [tuned] = tuneSmoothLengths(input, [trace], new Map([["D", 11]]), {
    candidateScore: preferUpper,
    alignPeriods: true,
    maxCandidates: 4096,
  })
  expect(preferUpper(tuned)).toBeLessThan(0)
  expect(length(tuned.route)).toBeCloseTo(11, 7)
  expect(tuned.route[0]).toEqual(trace.route[0])
  expect(tuned.route.at(-1)).toEqual(trace.route.at(-1))
  expect(tuningPathIsSelfClear(tuned.route, 0.2)).toBe(true)
  expect(
    new VectorScene(
      input,
      input.connections[0],
      0.1,
      fixedCopper(input),
    ).pathVisible(tuned.route),
  ).toBe(true)
})

test("a bank score cannot override hard copper clearance", () => {
  const { input, trace } = channel()
  input.obstacles.push({
    type: "rect",
    center: { x: 5, y: 1.6 },
    width: 12,
    height: 2.8,
    layers: ["top"],
    connectedTo: [],
  })
  const [tuned] = tuneSmoothLengths(input, [trace], new Map([["D", 11]]), {
    candidateScore: preferUpper,
    alignPeriods: true,
    maxCandidates: 4096,
  })
  expect(Math.min(...tuned.route.map((p) => p.y))).toBeLessThan(0)
  expect(Math.max(...tuned.route.map((p) => p.y))).toBeLessThanOrEqual(
    0.05 + 1e-8,
  )
  expect(length(tuned.route)).toBeCloseTo(11, 7)
  expect(
    new VectorScene(
      input,
      input.connections[0],
      0.1,
      fixedCopper(input),
    ).pathVisible(tuned.route),
  ).toBe(true)
})
