import { expect, test } from "bun:test"
import { pairHasUnroutedNativePads } from "../lib/coupled-pair-routing"
import type { SimpleRouteJson, Wire } from "../lib/types"

test("native pair pads exclude supplied connected copper and existing fanout handoffs", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -3, maxX: 11, minY: -3, maxY: 3 },
    connections: ["P", "N"].map((name, i) => ({
      name,
      pointsToConnect: [0, 8].map((x) => ({ x, y: i * 0.8, layer: "top" })),
    })),
    obstacles: ["P", "N"].flatMap((name, i) =>
      [0, 8].map((x) => ({
        componentId: x === 0 ? "driver" : "receiver",
        shape: "circle" as const,
        center: { x, y: i * 0.8 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: [name],
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.127, traceGap: 0.12 },
    ],
  }
  const pair = input.differentialPairs![0]
  const before = structuredClone(input)
  expect(pairHasUnroutedNativePads(input, pair)).toBe(true)
  expect(input).toEqual(before)

  const connectedCopper = structuredClone(input)
  const wire = (x: number, y: number): Wire => ({
    x,
    y,
    route_type: "wire",
    layer: "top",
    width: 0.1,
  })
  connectedCopper.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "supplied_P_escape",
      connection_name: "P",
      route: [wire(0, 0), wire(0.4, -0.4)],
    },
  ]
  expect(pairHasUnroutedNativePads(connectedCopper, pair)).toBe(false)
  const handoffs = structuredClone(input)
  handoffs.connections[0].pointsToConnect[0] = {
    x: 0.4,
    y: -0.4,
    layer: "top",
  }
  expect(pairHasUnroutedNativePads(handoffs, pair)).toBe(false)
  const foreignPad = structuredClone(input)
  foreignPad.obstacles[0].connectedTo = ["OTHER_NET"]
  expect(pairHasUnroutedNativePads(foreignPad, pair)).toBe(false)
})
