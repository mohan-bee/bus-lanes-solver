import { expect, test } from "bun:test"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { checkSignalSelfShorts } from "../scripts/check-signal-self-shorts"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

test("a paired departure returning through its terminal land remains a native self-short", () => {
  const carrier: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "dqs_carrier",
    source_trace_id: "dqs",
    connection_name: "dqs",
    coupledSection: [1, 2],
    route: [wire(0, 0), wire(1, 0), wire(1, 1), wire(0.1, 0.1), wire(-1, 1)],
  }
  const escape: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "dqs_escape",
    source_trace_id: "dqs",
    connection_name: "dqs",
    route: [
      wire(0, 0, "top"),
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      wire(0, 0),
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      { name: "dqs", pointsToConnect: [wire(0, 0, "top"), wire(-1, 1)] },
    ],
    traces: [escape],
  }
  const original = structuredClone({ input, carrier })
  expect(
    createTerminalViaClearanceChecker(input, carrier, {
      preserveExistingApproach: false,
    })(carrier.route),
  ).toBe(false)
  expect(
    checkSignalSelfShorts(input, [joinSignalEscapes(carrier, [escape])]),
  ).toHaveLength(1)
  expect({ input, carrier }).toEqual(original)
})
