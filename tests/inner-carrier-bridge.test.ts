import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  routeSurfaceBridge,
  surfaceBridgeEligible,
} from "../lib/route-surface-bridge"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson } from "../lib/types"

function input(): SimpleRouteJson {
  return {
    layerCount: 4,
    allowedLayers: ["inner1"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -8, maxX: 8, minY: -4, maxY: 4 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -6, y: 0, layer: "top" },
          { x: 6, y: 0, layer: "top" },
        ],
      },
    ],
    obstacles: [-6, 6].map((x, i) => ({
      type: "rect",
      shape: "circle",
      componentId: `component_${i}`,
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal"],
    })),
  }
}
function finish(srj: SimpleRouteJson) {
  const g = routeSurfaceBridge(srj, srj.connections[0], {
    gridStep: 0.1,
    maxExpansions: 200000,
  })
  let result = g.next(),
    steps = 0
  while (!result.done && steps++ < 10000) result = g.next()
  g.return(null)
  expect(result.done).toBe(true)
  return result.value
}

test("single inner carrier connects native pads with two manufactured, conventional escapes", async () => {
  const srj = input()
  expect(surfaceBridgeEligible(srj, srj.connections[0])).toBe(true)
  const result = finish(srj)
  expect(result).not.toBeNull()
  const trace = joinSignalEscapes(result!.carrier, result!.escapes)
  expect(trace.route.filter((p) => p.route_type === "via")).toHaveLength(2)
  expect(
    result!.carrier.route.every(
      (p) => p.route_type === "wire" && p.layer === "inner1",
    ),
  ).toBe(true)
  expect(routeAnglesAreConventional([trace])).toBe(true)
  const drc = await validateRoutedCopperDrc({
    inputSrj: srj,
    routedSrj: { ...srj, traces: [trace] },
    minTraceToPadEdgeClearance: 0.1,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.valid).toBe(true)
})

test("a blocked inner carrier cannot be bypassed by routing the signal across the native pad layer", () => {
  const srj = input()
  srj.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 8,
    layers: ["inner1"],
    connectedTo: [],
  })
  expect(finish(srj)).toBeNull()
})
