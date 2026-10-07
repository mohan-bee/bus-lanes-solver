import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { NativeCarrierRouter } from "../lib/native-carrier-router"
import { length } from "../lib/geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson } from "../lib/types"

function nativeInput(): SimpleRouteJson {
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
      componentId: `package_${i}`,
      center: { x, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["signal"],
    })),
  }
}
function route(input: SimpleRouteJson, maximum = Infinity) {
  const cells = 161 * 81
  const router = new NativeCarrierRouter(input, 0.1, [
      new Float32Array(cells),
      new Float32Array(cells),
    ]),
    search = router.route(input.connections[0], {
      maxLength: maximum,
      maxExpansions: 200000,
    })
  let result = search.next()
  while (!result.done) result = search.next()
  return result.value?.trace ?? null
}

test("native carrier uses two plated vias, retains pad ownership and obeys whole-copper limits", () => {
  const input = nativeInput(),
    before = structuredClone(input),
    trace = route(input, 12.5)!
  expect(trace).not.toBeNull()
  expect(length(trace.route)).toBeLessThanOrEqual(12.5)
  expect(trace.route.filter((p) => p.route_type === "via")).toHaveLength(2)
  expect(routeAnglesAreConventional([trace])).toBe(true)
  expect(
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [trace] },
      clearance: 0.1,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid,
  ).toBe(true)
  expect(input).toEqual(before)
  expect(route(input, 11.9)).toBeNull()
})

test("native carrier cannot bypass an inner-layer barrier through TOP", () => {
  const input = nativeInput()
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 8,
    layers: ["inner1"],
    connectedTo: [],
  })
  expect(route(input)).toBeNull()
})

test("via placement checks copper on unused physical planes", () => {
  const input = nativeInput()
  // Cover every legal source-package via site on bottom while leaving the
  // entire requested inner1 wire plane open.
  input.obstacles.push({
    type: "rect",
    center: { x: -6, y: 0 },
    width: 6.4,
    height: 6.4,
    layers: ["bottom"],
    connectedTo: [],
  })
  expect(route(input)).toBeNull()
})
