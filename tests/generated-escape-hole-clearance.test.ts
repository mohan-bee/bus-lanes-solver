import { expect, test } from "bun:test"
import { expandedSignalSiteChoices } from "../lib/expanded-signal-sites"
import { distance } from "../lib/geometry"
import type { SimpleRouteJson, Via } from "../lib/types"

function nearbyNativePackages(): SimpleRouteJson {
  const connection = {
    name: "signal",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 3.3, y: 0, layer: "top" },
    ],
  }
  return {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.1,
    allowedLayers: ["top", "bottom"],
    bounds: { minX: -3, maxX: 7, minY: -3, maxY: 3 },
    connections: [connection],
    traces: [],
    obstacles: [0, 3.3].flatMap((x) =>
      [0, 0.8].flatMap((dx) =>
        [0, 0.8].map((y) => ({
          componentId: `package_${x}`,
          shape: "circle" as const,
          type: "rect",
          center: { x: x + dx, y },
          width: 0.25,
          height: 0.25,
          layers: ["top"],
          connectedTo:
            dx === 0 && y === 0 ? ["signal"] : [`other_${x}_${dx}_${y}`],
        })),
      ),
    ),
  }
}

test("compact expanded choices keep their two generated barrels drill-clear", () => {
  const input = nearbyNativePackages()
  input.minViaHoleEdgeToViaHoleEdgeClearance = 0.1
  const original = structuredClone(input)
  const search = expandedSignalSiteChoices(
    input,
    input.connections[0],
    "bottom",
  )
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 100000) step = search.next()
  expect(step.done).toBe(true)
  const choices = step.done ? step.value : []
  expect(choices.length).toBeGreaterThan(0)
  expect(choices.length).toBeLessThanOrEqual(8)
  for (const choice of choices) {
    const barrels = choice.escapes.flatMap((escape) =>
      escape.route.filter((point): point is Via => point.route_type === "via"),
    )
    expect(barrels).toHaveLength(2)
    const required =
      (barrels[0].via_hole_diameter! + barrels[1].via_hole_diameter!) / 2 +
      input.minViaHoleEdgeToViaHoleEdgeClearance!
    expect(distance(barrels[0], barrels[1])).toBeGreaterThanOrEqual(
      required - 1e-8,
    )
  }
  expect(input).toEqual(original)
})
