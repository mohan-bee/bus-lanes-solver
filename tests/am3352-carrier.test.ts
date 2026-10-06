import { expect, test } from "bun:test"
import type { Trace } from "../lib"
import { am3352Carrier } from "../scripts/am3352-carrier"

const wire = (x: number, y: number, layer: string) => ({
  route_type: "wire" as const,
  x,
  y,
  layer,
  width: 0.1,
})
const via = (x: number, y: number, from_layer: string, to_layer: string) => ({
  route_type: "via" as const,
  x,
  y,
  from_layer,
  to_layer,
  layers: ["top", "inner1", "inner2", "bottom"],
  via_diameter: 0.3,
  via_hole_diameter: 0.15,
})
const routed: Trace = {
  type: "pcb_trace",
  pcb_trace_id: "control",
  connection_name: "control",
  route: [
    wire(0, 0, "top"),
    wire(2, 0, "top"),
    via(2, 0, "top", "bottom"),
    wire(2, 0, "bottom"),
    wire(2, 2, "bottom"),
    via(2, 2, "bottom", "top"),
    wire(2, 2, "top"),
    wire(4, 2, "top"),
    via(4, 2, "top", "bottom"),
    wire(4, 2, "bottom"),
    wire(4, 4, "bottom"),
    via(4, 4, "bottom", "top"),
    wire(4, 4, "top"),
    wire(6, 4, "top"),
  ],
}

test("a control can use another outer-plane crossing in its owned approach", () => {
  const carrier = am3352Carrier(routed)
  expect(carrier).toEqual({
    start: 3,
    end: 4,
    layer: "bottom",
    route: [wire(2, 0, "bottom"), wire(2, 2, "bottom")],
    viaCount: 4,
  })
})

test("the additional crossing cannot conceal a plane jump or missing barrel handoff", () => {
  for (const mutation of [
    { index: 9, fields: { layer: "inner1" } },
    { index: 8, fields: { to_layer: "inner1" } },
    { index: 10, fields: { x: 4.1 } },
    { index: 12, fields: { layer: "bottom" } },
  ]) {
    const invalid = structuredClone(routed)
    Object.assign(invalid.route[mutation.index], mutation.fields)
    expect(am3352Carrier(invalid)).toBeNull()
  }
})
