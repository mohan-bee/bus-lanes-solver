import { expect, test } from "bun:test"
import { findViaAwareSignalPocket } from "../lib/find-signal-site-pocket"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"
const wire = (x: number, y: number): Wire => ({
  x,
  y,
  route_type: "wire",
  layer: "top",
  width: 0.1,
})
test("a native surface terminal releases the trace closing its only planar passage", () => {
  const blocking: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "blocking",
    connection_name: "B",
    route: [wire(4, -0.8), wire(4, 0.8)],
  }
  const native: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.05,
    allowedLayers: ["top"],
    bounds: { minX: -1, maxX: 9, minY: -1, maxY: 1 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 8, y: 0, layer: "top" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [blocking.route[0], blocking.route.at(-1)!] as Wire[],
      },
    ],
    obstacles: [-0.8, 0.8].map((y) => ({
      componentId: "B-package",
      type: "rect",
      shape: "circle",
      center: { x: 4, y },
      width: 0.25,
      height: 0.25,
      layers: ["top"],
      connectedTo: ["B"],
    })),
  }
  const state: FlexibleSignalState = {
    native,
    pending: native,
    escapes: [],
    retained: [],
    traces: [blocking],
  }
  const original = structuredClone(state)
  const connection = native.connections[0]
  const scene = new VectorScene(native, connection, 0.1, [
    ...fixedCopper(native),
    ...routeCopper(blocking),
  ])
  expect(scene.pathVisible(connection.pointsToConnect)).toBe(false)
  const search = findViaAwareSignalPocket(state)
  let step = search.next(),
    iterations = 0
  while (!step.done && iterations++ < 10000) step = search.next()
  expect(step.done).toBe(true)
  expect(step.value).toEqual(new Set(["A", "B"]))
  expect(state).toEqual(original)
})
