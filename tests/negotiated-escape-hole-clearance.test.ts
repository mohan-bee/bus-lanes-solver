import { expect, test } from "bun:test"
import { distance } from "../lib/geometry"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import type { SimpleRouteJson, Via } from "../lib/types"

function separatedNativeSignals(): SimpleRouteJson & {
  minPlatedHoleDrillEdgeToDrillEdgeClearance: number
} {
  const connectionNames = ["signal", "other_net"]
  return {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.4,
    minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.4,
    allowedLayers: ["top", "bottom"],
    allowBlindAndBuriedVias: false,
    bounds: { minX: -3, maxX: 7, minY: -3, maxY: 3 },
    connections: connectionNames.map((name, i) => ({
      name,
      source_trace_id: `source_${name}`,
      pointsToConnect: [0, 4].map((x) => ({
        x,
        y: i * 0.45,
        layer: "top",
        pcb_port_id: `port_${name}_${x}`,
      })),
    })),
    buses: [
      { busId: "bottom_bus", connectionNames, allowedLayers: ["bottom"] },
    ],
    traces: [],
    obstacles: connectionNames.flatMap((name, i) =>
      [0, 4].flatMap((x) =>
        [0, 0.8].flatMap((dx) =>
          [0, 0.8].map((dy) => ({
            componentId: `package_${name}_${x}`,
            shape: "circle" as const,
            center: { x: x + dx, y: i * 0.45 + dy },
            width: 0.25,
            height: 0.25,
            layers: ["top"],
            connectedTo:
              dx === 0 && dy === 0
                ? [`port_${name}_${x}`]
                : [`other_${name}_${x}_${dx}_${dy}`],
          })),
        ),
      ),
    ),
  }
}

test("negotiated bottom carriers keep all owned escape drills clear", () => {
  const native = separatedNativeSignals()
  const original = structuredClone(native)
  const pending = {
    ...native,
    connections: native.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => ({
        ...point,
        layer: "bottom",
      })),
    })),
  }
  const search = negotiateSignalSites(
    { native, pending, escapes: [], retained: [], traces: [] },
    new Set(native.connections.map((connection) => connection.name)),
    false,
    true,
  )
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 100000) step = search.next()
  expect(step.done).toBe(true)
  const result = step.done ? step.value : null
  expect(result).toBeTruthy()
  expect(result!.traces.map((trace) => trace.connection_name).sort()).toEqual(
    native.connections.map((connection) => connection.name).sort(),
  )
  expect(
    result!.traces.every((trace) =>
      trace.route.every(
        (point) => point.route_type === "wire" && point.layer === "bottom",
      ),
    ),
  ).toBe(true)
  const drills = result!.escapes.flatMap((escape) =>
    escape.route.filter((point): point is Via => point.route_type === "via"),
  )
  expect(drills).toHaveLength(4)
  const clearance = Math.max(
    native.minViaHoleEdgeToViaHoleEdgeClearance!,
    native.minPlatedHoleDrillEdgeToDrillEdgeClearance,
  )
  for (const [i, drill] of drills.entries())
    for (const other of drills.slice(i + 1)) {
      const required =
        (drill.via_hole_diameter! + other.via_hole_diameter!) / 2 + clearance
      expect(distance(drill, other)).toBeGreaterThanOrEqual(required - 1e-8)
    }
  expect(native).toEqual(original)
})
