import { expect, test } from "bun:test"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import type { SimpleRouteJson, Via, Wire } from "../lib/types"
import { checkSignalSelfShorts } from "../scripts/check-signal-self-shorts"

function finishNativePadBridge<T>(search: Generator<void, T>): T {
  let step = search.next(),
    yields = 0
  while (!step.done && yields++ < 10000) step = search.next()
  if (!step.done) {
    search.return(undefined as T)
    throw Error("Native-pad bridge exceeded its bound")
  }
  return step.value
}

const nativePadWire = (x: number, y: number, layer = "top"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

/** The barrier's right edge is 0.2mm from the target. With the via radius and
 * clearance, its first permitted landing is exactly on the native pad's raster
 * cell. The router must pick a nearby manufactured site instead, including when
 * the native coordinate is fractionally displaced within DRC's 1e-6 tolerance. */
function nativePadBridgeFixture(
  offset = 0,
  queuedPad = false,
): SimpleRouteJson {
  const physical = getCopperLayerNames(6)
  return {
    layerCount: 6,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -4, maxX: 4, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        center: { x: 2.7, y: 0 },
        width: 0.2,
        height: 2,
        layers: ["top"],
        connectedTo: ["wall"],
      },
    ],
    connections: [
      {
        name: "signal",
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          { x: -3 - offset, y: 0, layer: "top" },
          { x: 3 + offset, y: 0, layer: "top" },
        ],
      },
      {
        name: "power",
        pointsToConnect: [
          { x: -2, y: 0.65, layer: "top" },
          { x: -1.7, y: 0.35, layer: "bottom" },
        ],
      },
      ...(queuedPad
        ? [
            {
              name: "queued",
              pointsToConnect: [
                { x: 3, y: 0.05, layer: "top" },
                { x: 3.4, y: 0.5, layer: "top" },
              ],
            },
          ]
        : []),
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_power",
        connection_name: "power",
        source_trace_id: "power",
        route: [
          nativePadWire(-2, 0.65),
          nativePadWire(-2, 0.35),
          {
            route_type: "via",
            x: -2,
            y: 0.35,
            from_layer: "top",
            to_layer: "bottom",
            layers: physical,
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          nativePadWire(-2, 0.35, "bottom"),
          nativePadWire(-1.7, 0.35, "bottom"),
        ],
      },
    ],
  }
}

function verifyNativePadBridge(input: SimpleRouteJson, viaPenalty: number) {
  const original = structuredClone(input),
    connection = input.connections[0]
  const result = finishNativePadBridge(
    routeSurfaceBridge(input, connection, { viaPenalty }),
  )
  expect(result).toBeTruthy()
  const joined = joinSignalEscapes(result!.carrier, result!.escapes)
  const vias = joined.route.filter(
    (point): point is Via => point.route_type === "via",
  )
  expect(vias).toHaveLength(2)
  const physical = getCopperLayerNames(6),
    pads = input.connections.flatMap((c) => c.pointsToConnect)
  for (const via of vias) {
    expect(via.layers).toEqual(physical)
    for (const pad of pads) expect(distance(via, pad)).toBeGreaterThan(1e-6)
    const suppliedVia = input.traces![0].route.find(
      (point): point is Via => point.route_type === "via",
    )!
    expect(distance(via, suppliedVia)).toBeGreaterThanOrEqual(0.3 - 1e-8)
  }
  expect(distance(vias[0], vias[1])).toBeGreaterThanOrEqual(0.3 - 1e-8)
  expect(distance(joined.route[0], connection.pointsToConnect[0])).toBeLessThan(
    1e-8,
  )
  expect(
    distance(joined.route.at(-1)!, connection.pointsToConnect[1]),
  ).toBeLessThan(1e-8)
  expect(
    result!.carrier.route.every(
      (point) => point.route_type === "wire" && point.layer === "bottom",
    ),
  ).toBe(true)
  expect(routeAnglesAreConventional([joined])).toBe(true)
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
}

test("surface bridges keep manufactured barrels off exact and fractional native pads", () => {
  for (const offset of [0, 0.0000005])
    for (const viaPenalty of [0, 2])
      verifyNativePadBridge(nativePadBridgeFixture(offset), viaPenalty)
})

test("surface bridge landings protect other queued connections' original terminals", () => {
  verifyNativePadBridge(nativePadBridgeFixture(0, true), 0)
})
