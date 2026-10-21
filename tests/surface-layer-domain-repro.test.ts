import { expect, test } from "bun:test"
import { signalLayers } from "../lib/flexible-signal-state"
import type { SimpleRouteJson } from "../lib/types"

test("per-bus permission retains the native surface carrier", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "D0",
        pointsToConnect: [
          { x: 0, y: 2, layer: "top" },
          { x: 0, y: -2, layer: "top" },
        ],
      },
    ],
    obstacles: [],
    buses: [
      { busId: "BYTE0", connectionNames: ["D0"], allowedLayers: ["top"] },
    ],
  }
  const connection = input.connections[0]
  expect(signalLayers(input, connection)).toEqual(["top"])
  expect(
    signalLayers({ ...input, allowedLayers: ["top", "bottom"] }, connection),
  ).toEqual(["top"])
})
