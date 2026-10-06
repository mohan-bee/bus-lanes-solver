import { expect, test } from "bun:test"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import {
  routeSurfaceBridge,
  surfaceBridgeSelfShorts,
} from "../lib/route-surface-bridge"
import type { SimpleRouteJson, Trace, Via, Wire } from "../lib/types"
import { checkSignalSelfShorts } from "../scripts/check-signal-self-shorts"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next(),
    yields = 0
  while (!step.done && yields++ < 10000) step = search.next()
  if (!step.done) {
    search.return(undefined as T)
    throw Error("Four-via bridge exceeded its bound")
  }
  return step.value
}

const wire = (x: number, y: number, layer: string, width = 0.1): Wire => ({
  x,
  y,
  route_type: "wire",
  layer,
  width,
})

/** Each wall spans the complete routing bounds. The outer walls block TOP;
 * the middle wall blocks BOTTOM, so a native TOP-to-TOP join needs two distinct
 * BOTTOM excursions. Supplied full-stack power occupies the first return gate. */
function fixture(): SimpleRouteJson & {
  minPlatedHoleDrillEdgeToDrillEdgeClearance: number
} {
  const physical = getCopperLayerNames(6)
  return {
    layerCount: 6,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minBoardEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.3,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -4, maxX: 4, minY: -0.8, maxY: 0.8 },
    connections: [
      {
        name: "signal",
        source_trace_id: "signal",
        nominalTraceWidth: 0.12,
        pointsToConnect: [
          { x: -3.5, y: 0, layer: "top" },
          { x: 3.5, y: 0, layer: "top" },
        ],
      },
      {
        name: "power",
        source_trace_id: "power",
        pointsToConnect: [
          { x: -1.6, y: 0.65, layer: "top" },
          { x: -1.6, y: 0.55, layer: "bottom" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_power",
        connection_name: "power",
        source_trace_id: "power",
        route: [
          wire(-1.6, 0.65, "top"),
          wire(-1.6, 0.25, "top"),
          {
            x: -1.6,
            y: 0.25,
            route_type: "via",
            from_layer: "top",
            to_layer: "bottom",
            layers: physical,
            via_diameter: 0.3,
            via_hole_diameter: 0.2,
          },
          wire(-1.6, 0.25, "bottom"),
          wire(-1.6, 0.55, "bottom"),
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.2,
        height: 1.6,
        layers: ["top"],
        connectedTo: ["left_wall"],
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 1.6,
        layers: ["bottom"],
        connectedTo: ["middle_wall"],
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 0.2,
        height: 1.6,
        layers: ["top"],
        connectedTo: ["right_wall"],
      },
    ],
  }
}

function expectContinuous(trace: Trace) {
  expect(trace.route[0].route_type).toBe("wire")
  expect(trace.route.at(-1)!.route_type).toBe("wire")
  for (let i = 1; i < trace.route.length; i++) {
    const a = trace.route[i - 1],
      b = trace.route[i]
    if (a.route_type === "wire" && b.route_type === "wire") {
      expect(a.layer).toBe(b.layer)
    } else if (a.route_type === "wire" && b.route_type === "via") {
      expect(distance(a, b)).toBeLessThan(1e-8)
      expect(a.layer).toBe(b.from_layer)
    } else if (a.route_type === "via" && b.route_type === "wire") {
      expect(distance(a, b)).toBeLessThan(1e-8)
      expect(a.to_layer).toBe(b.layer)
    } else {
      throw Error("Adjacent vias must retain their single-plane handoff")
    }
  }
}

test("opt-in four-via surface routing crosses alternating walls and rejoins owned approaches", () => {
  const input = fixture(),
    original = structuredClone(input),
    connection = input.connections[0]
  expect(finish(routeSurfaceBridge(input, connection))).toBeNull()
  const result = finish(routeSurfaceBridge(input, connection, { maxVias: 4 }))
  expect(result).toBeTruthy()
  const { carrier, escapes } = result!,
    joined = joinSignalEscapes(carrier, escapes),
    physical = getCopperLayerNames(6)
  const vias = joined.route.filter((p): p is Via => p.route_type === "via")
  expect(vias).toHaveLength(4)
  expect(vias[0].x).toBeLessThan(-2)
  expect(vias[1].x).toBeGreaterThan(-2)
  expect(vias[1].x).toBeLessThan(0)
  expect(vias[2].x).toBeGreaterThan(0)
  expect(vias[2].x).toBeLessThan(2)
  expect(vias[3].x).toBeGreaterThan(2)
  expect(escapes).toHaveLength(2)
  expect(
    escapes.map((e) => e.route.filter((p) => p.route_type === "via").length),
  ).toEqual([1, 3])
  expect(
    carrier.route.every(
      (p) =>
        p.route_type === "wire" && p.layer === "bottom" && p.width === 0.12,
    ),
  ).toBe(true)
  expect(new Set([carrier, ...escapes].map((t) => t.pcb_trace_id)).size).toBe(3)
  expect(distance(joined.route[0], connection.pointsToConnect[0])).toBeLessThan(
    1e-8,
  )
  expect(
    distance(joined.route.at(-1)!, connection.pointsToConnect[1]),
  ).toBeLessThan(1e-8)
  expect(
    distance(escapes[0].route[0], connection.pointsToConnect[0]),
  ).toBeLessThan(1e-8)
  expect(
    distance(escapes[1].route[0], connection.pointsToConnect[1]),
  ).toBeLessThan(1e-8)
  expect(distance(escapes[0].route.at(-1)!, carrier.route[0])).toBeLessThan(
    1e-8,
  )
  expect(
    distance(escapes[1].route.at(-1)!, carrier.route.at(-1)!),
  ).toBeLessThan(1e-8)
  for (const trace of [carrier, ...escapes, joined]) expectContinuous(trace)
  expect(vias.map((v) => [v.from_layer, v.to_layer])).toEqual([
    ["top", "bottom"],
    ["bottom", "top"],
    ["top", "bottom"],
    ["bottom", "top"],
  ])
  expect(
    joined.route
      .filter((p): p is Wire => p.route_type === "wire")
      .every((p) => ["top", "bottom"].includes(p.layer) && p.width === 0.12),
  ).toBe(true)
  const powerVia = input.traces![0].route.find(
    (p): p is Via => p.route_type === "via",
  )!
  for (const [index, via] of vias.entries()) {
    expect(via.layers).toEqual(physical)
    expect(via.via_diameter).toBe(0.3)
    expect(via.via_hole_diameter).toBe(0.15)
    expect(distance(via, powerVia)).toBeGreaterThanOrEqual(0.475 - 1e-8)
    for (const other of vias.slice(index + 1))
      expect(distance(via, other)).toBeGreaterThanOrEqual(0.45 - 1e-8)
  }
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(surfaceBridgeSelfShorts(input, connection, joined)).toBe(false)
  expect(checkSignalSelfShorts(input, [joined])).toEqual([])
  const report = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces: [...input.traces!, joined] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.valid).toBe(true)
  expect(report.issues).toEqual([])
  expect(input).toEqual(original)
})
