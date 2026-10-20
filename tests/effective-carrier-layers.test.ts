import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import {
  effectiveCarrierLayers,
  withInferredSurfaceLayers,
} from "../lib/effective-carrier-layers"
import { signalLayers } from "../lib/flexible-signal-state"
import type { SimpleRouteJson } from "../lib/types"

function sample(): SimpleRouteJson {
  const connections = [-2, 2].map((x, i) => ({
    name: `D${i}`,
    pointsToConnect: [
      { x, y: 2, layer: "top" },
      { x, y: -2, layer: "top" },
    ],
  }))
  return {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections,
    obstacles: connections.flatMap((c) =>
      c.pointsToConnect.map((p, i) => ({
        center: { x: p.x, y: p.y },
        width: 0.25,
        height: 0.25,
        layers: ["top"],
        connectedTo: [c.name],
        componentId: `U${i}`,
      })),
    ),
    buses: connections.map((c, i) => ({
      busId: c.name,
      connectionNames: [c.name],
      allowedLayers: i === 0 ? ["top"] : ["bottom"],
    })),
    traces: [],
  }
}

test("intersects all owning restrictions and preserves stack order", () => {
  const input = sample(),
    c = input.connections[0]
  input.allowedLayers = ["bottom", "inner1", "top"]
  input.buses![0].allowedLayers = ["bottom", "top"]
  expect(effectiveCarrierLayers(input, c)).toEqual(["top", "bottom"])
  input.buses!.push({
    busId: "overlap",
    connectionNames: [c.name],
    allowedLayers: ["inner1", "bottom"],
  })
  expect(effectiveCarrierLayers(input, c)).toEqual(["bottom"])
  expect(signalLayers(input, c)).toEqual(["bottom"])
  input.buses![2].allowedLayers = ["inner2"]
  expect(effectiveCarrierLayers(input, c)).toEqual([])
  expect(withInferredSurfaceLayers(input)).toBe(input)
})

test("does not infer surface routing for uncovered, empty or inner-layer domains", () => {
  for (const kind of [
    "uncovered",
    "empty",
    "inner",
    "no-connections",
    "two-layer-uncovered",
  ]) {
    const input = sample()
    if (kind === "uncovered") input.buses!.pop()
    if (kind === "empty") input.buses![0].allowedLayers = []
    if (kind === "inner") input.buses![0].allowedLayers = ["inner1"]
    if (kind === "no-connections") input.connections = []
    if (kind === "two-layer-uncovered") {
      input.layerCount = 2
      input.buses = []
    }
    expect(withInferredSurfaceLayers(input)).toBe(input)
  }
})

test("explicit restrictions stay authoritative and unrestricted pad preference is unchanged", () => {
  const input = sample(),
    c = input.connections[0]
  input.buses = []
  expect(signalLayers(input, c)).toEqual(["inner1", "inner2", "bottom"])
  input.allowedLayers = ["inner1"]
  expect(withInferredSurfaceLayers(input)).toBe(input)
  input.buses = [
    { busId: "conflict", connectionNames: [c.name], allowedLayers: ["top"] },
  ]
  expect(signalLayers(input, c)).toEqual([])
})

test("native allocation and complete output agree without exposing inferred global layers", () => {
  const input = sample(),
    before = structuredClone(input)
  const implicit = new BusLanesPipelineSolver(input, {
    smoothTuning: false,
    denseSearch: false,
    maxSearchIterations: 2000,
  })
  const explicit = new BusLanesPipelineSolver(
    { ...input, allowedLayers: ["top", "bottom"] },
    { smoothTuning: false, denseSearch: false, maxSearchIterations: 2000 },
  )
  implicit.solve()
  explicit.solve()
  expect(implicit.error).toBeNull()
  expect(implicit.solved).toBe(true)
  expect(explicit.solved).toBe(true)
  expect(implicit.traces).toEqual(explicit.traces)
  expect(implicit.input).toEqual(before)
  expect(implicit.getConstructorParams()[0]).toEqual(before)
  const { traces, ...geometry } = implicit.getOutput()
  const { traces: _, ...originalGeometry } = before
  expect(geometry).toEqual(originalGeometry)
  expect(input).toEqual(before)
  expect(traces!.length).toBe(2)
})

test("real DDR selects the same strategy, escape geometry and budget for equivalent declarations", () => {
  const bytes = gunzipSync(
    readFileSync(
      new URL(
        "./fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
        import.meta.url,
      ),
    ),
  )
  const input = JSON.parse(bytes.toString()) as SimpleRouteJson,
    before = structuredClone(input)
  const implicit = new BusLanesPipelineSolver(input)
  const explicit = new BusLanesPipelineSolver({
    ...input,
    allowedLayers: ["top", "bottom"],
  })
  implicit.step()
  explicit.step()
  expect(implicit.failed).toBe(false)
  expect(implicit.phase).toBe("route_shared_layers")
  expect(implicit.phase).toBe(explicit.phase)
  expect(implicit.MAX_ITERATIONS).toBe(explicit.MAX_ITERATIONS)
  expect((implicit as any).escapes).toEqual((explicit as any).escapes)
  expect([...(implicit as any).terminalLayers]).toEqual([
    ...(explicit as any).terminalLayers,
  ])
  expect(input).toEqual(before)
  expect(implicit.input).toEqual(before)
  implicit.tryFinalAcceptance()
  explicit.tryFinalAcceptance()
}, 30000)
