import { expect, test } from "bun:test"
import { normalizeSurfaceCarriers } from "../lib/normalize-surface-carriers"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { length } from "../lib/geometry"
import { reduceOrdinaryTurns } from "../lib/reduce-ordinary-turns"
import { chamferOrdinaryCorners } from "../lib/chamfer-ordinary-corners"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { busLengthReports } from "../lib/route-lengths"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, width = 0.1): Wire => ({
  route_type: "wire",
  x,
  y,
  layer: "top",
  width,
})
const trace = (id: string, points: Wire[], name = "DATA"): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: name,
  source_trace_id: name,
  route: points,
})

test("surface normalization preserves supplied copper with a colliding generated identifier", () => {
  const prefix = trace("escape", [wire(-2, 0), wire(-1, 0)])
  const carrier = trace("carrier", [wire(-1, 0), wire(2, 0)])
  const fixed = trace("escape", [wire(-2, 1), wire(2, 1)], "POWER")
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 2 },
    obstacles: [],
    connections: [{ name: "DATA", pointsToConnect: carrier.route as Wire[] }],
    traces: [fixed, prefix],
  }
  const before = structuredClone(input)
  const prepared = normalizeSurfaceCarriers(input, [carrier], [prefix])
  expect(prepared.input.traces![0]).toBe(fixed)
  expect(prepared.input.traces![1]).toBe(prepared.escapes[0])
  expect(prepared.escapes[0].route).toHaveLength(1)
  expect(prepared.traces[0].route[0]).toEqual(prefix.route[0])
  expect(length(prepared.traces[0].route)).toBeCloseTo(4, 10)
  expect(input).toEqual(before)
})

test("fractional native surface terminals stay exact and become octilinear through three cleanup passes", () => {
  const prefix = trace("prefix", [wire(-2.400017, 0.400031), wire(-2, 0)])
  const suffix = trace("suffix", [wire(2.400054, 0.400015), wire(2, 0)])
  const carrier = trace("carrier", [wire(-2, 0), wire(2, 0)])
  const fixed = trace("supply", [wire(-2.5, 1.5), wire(2.5, 1.5)], "POWER")
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 2 },
    obstacles: [
      ...[prefix, suffix].map((escape) => ({
        shape: "circle" as const,
        center: escape.route[0],
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["DATA"],
      })),
      {
        center: { x: 0, y: 0.8 },
        width: 3,
        height: 1.2,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [carrier.route[0], carrier.route.at(-1)!] as Wire[],
      },
    ],
    buses: [{ busId: "DATA", connectionNames: ["DATA"] }],
    traces: [fixed, prefix, suffix],
  }
  const before = structuredClone({ input, carrier, prefix, suffix })
  const native = {
    ...input,
    traces: [fixed],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [prefix.route[0], suffix.route[0]] as Wire[],
      },
    ],
  }
  const oldJoined = joinSignalEscapes(carrier, [prefix, suffix])
  const oldValidator = BusLanesSolver.forValidation(native, [oldJoined], {
    smoothTuning: true,
  })
  oldValidator.solve()
  expect(oldValidator.solved).toBe(false)
  expect(oldValidator.error).toContain("Non-octilinear segment")
  const cleanup = (local: SimpleRouteJson, routes: Trace[]) => {
    let cleaned = structuredClone(routes)
    const hard = fixedCopper(local)
    for (let pass = 0; pass < 3; pass++) {
      const scene = new VectorScene(local, local.connections[0], 0.1, hard)
      cleaned = cleaned.map((item) => ({
        ...item,
        curvedSegments: undefined,
        route: reduceOrdinaryTurns(item.route, scene).map((point) =>
          wire(point.x, point.y),
        ),
      }))
      cleaned = chamferOrdinaryCorners(local, cleaned)
    }
    return cleaned
  }
  // The blocked direct corridor prevents cleanup from simply removing the
  // suffix. An existing fractional diagonal cannot be replaced by shortening.
  const legacyValidator = BusLanesSolver.forValidation(
    native,
    cleanup(native, [oldJoined]),
    { smoothTuning: true },
  )
  legacyValidator.solve()
  expect(legacyValidator.solved).toBe(false)
  expect(legacyValidator.error).toContain("Non-octilinear segment")

  const prepared = normalizeSurfaceCarriers(input, [carrier], [prefix, suffix])
  const joined = prepared.traces[0]
  const octilinearLength = (escape: Trace) => {
    const [a, b] = escape.route,
      dx = Math.abs(b.x - a.x),
      dy = Math.abs(b.y - a.y)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }
  const expectedLength =
    length(carrier.route) + octilinearLength(prefix) + octilinearLength(suffix)
  expect(length(joined.route)).toBeCloseTo(expectedLength, 10)
  // This small increase is the physical axis copper needed to retain both
  // native endpoints; no fanout length disappears or gets counted twice.
  expect(length(joined.route) - length(oldJoined.route)).toBeGreaterThanOrEqual(
    0,
  )
  expect(length(joined.route) - length(oldJoined.route)).toBeLessThan(0.0001)
  expect(
    busLengthReports(prepared.input, prepared.traces)[0].lengths[0]
      .totalLengthMm,
  ).toBeCloseTo(expectedLength, 10)
  expect(prepared.escapes.every((escape) => escape.route.length === 1)).toBe(
    true,
  )
  expect(joined.curvedSegments).toBeUndefined()

  const fixedCopperGeometry = fixedCopper(prepared.input)
  prepared.traces = cleanup(prepared.input, prepared.traces)
  const final = prepared.traces[0]
  expect(final.route[0]).toEqual(prefix.route[0])
  expect(final.route.at(-1)).toEqual(suffix.route[0])
  expect(
    final.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(final.curvedSegments).toBeUndefined()
  expect(routeAnglesAreConventional([final])).toBe(true)
  expect(tuningPathIsSelfClear(final.route, 0.15)).toBe(true)
  expect(
    new VectorScene(
      prepared.input,
      prepared.input.connections[0],
      0.1,
      fixedCopperGeometry,
    ).pathVisible(final.route),
  ).toBe(true)
  const validator = BusLanesSolver.forValidation(
    prepared.input,
    prepared.traces,
    { smoothTuning: true },
  )
  validator.solve()
  expect(validator.solved).toBe(true)
  expect(validator.error).toBeNull()
  expect(
    busLengthReports(prepared.input, prepared.traces)[0].lengths[0]
      .totalLengthMm,
  ).toBeCloseTo(length(final.route), 10)
  expect(prepared.input.traces![0]).toBe(fixed)
  expect({ input, carrier, prefix, suffix }).toEqual(before)
})

test("surface chord correction cannot cut through hard copper or invent curve tags", () => {
  const prefix = trace("prefix", [wire(-1.4, 0.5, 0.01), wire(-1, 0, 0.01)])
  const carrier = trace("carrier", [wire(-1, 0, 0.01), wire(1, 0, 0.01)])
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.01,
    minTraceToPadEdgeClearance: 0.005,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    connections: [{ name: "DATA", pointsToConnect: carrier.route as Wire[] }],
    obstacles: [
      { x: -1.4, y: 0.4 },
      { x: -1, y: 0.1 },
    ].map((center) => ({
      shape: "circle",
      center,
      width: 0.01,
      height: 0.01,
      layers: ["top"],
      connectedTo: ["BLOCKER"],
    })),
    traces: [prefix],
  }
  const old = joinSignalEscapes(carrier, [prefix])
  const scene = new VectorScene(
    input,
    input.connections[0],
    0.01,
    fixedCopper(input),
  )
  expect(scene.pathVisible(old.route)).toBe(true)
  const result = normalizeSurfaceCarriers(input, [carrier], [prefix])
  expect(result.traces[0].route).toEqual(old.route)
  expect(result.traces[0].curvedSegments).toBeUndefined()
  expect(scene.pathVisible(result.traces[0].route)).toBe(true)
})
