import { expect, test } from "bun:test"
import { checkSignalSelfShorts } from "../scripts/check-signal-self-shorts"
import type { SimpleRouteJson, Trace, Wire } from "../lib"

const wire = (x: number, y: number, layer = "top"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})
const input: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  obstacles: [],
  connections: [{ name: "CONTROL", pointsToConnect: [wire(0, 0), wire(1, 0)] }],
}
const trace = (route: Trace["route"]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: "control",
  connection_name: "CONTROL",
  source_trace_id: "CONTROL",
  route,
})

test("native self-short audit checks controls without a length-matched bus", () => {
  const before = structuredClone(input)
  expect(
    checkSignalSelfShorts(input, [trace([wire(0, 0), wire(1, 0)])]),
  ).toHaveLength(0)
  expect(
    checkSignalSelfShorts(input, [
      trace([wire(0, 0), wire(1, 1), wire(0, 1), wire(1, 0)]),
    ]),
  ).toHaveLength(1)
  expect(input).toEqual(before)
})

test("untimed control audit materializes through-via lands that bypass earlier copper", () => {
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
  const candidate = trace([
    wire(0, 0),
    wire(1, 0),
    wire(1, 1),
    via(1, 1, "top", "bottom"),
    wire(1, 1, "bottom"),
    wire(0, 1, "bottom"),
    wire(0, 0.14, "bottom"),
    via(0, 0.14, "bottom", "top"),
    wire(0, 0.14),
    wire(-1, 0.14),
  ])
  // The wire runs do not touch; the second via's 0.3mm land is the bypass.
  const withoutLands = structuredClone(candidate)
  for (const point of withoutLands.route)
    if (point.route_type === "via") point.via_diameter = 0.01
  expect(checkSignalSelfShorts(input, [withoutLands])).toHaveLength(0)
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(1)
  for (const point of withoutLands.route)
    if (point.route_type === "via") point.via_diameter = 0.3
  expect(checkSignalSelfShorts(input, [withoutLands])).toHaveLength(1)
})

for (const layer of ["top", "bottom"]) {
  test(`${layer} native audit rejects tangency and retracing but permits ordinary joints`, () => {
    const w = (x: number, y: number) => wire(x, y, layer)
    expect(
      checkSignalSelfShorts(input, [trace([w(0, 0), w(1, 0), w(1, 1)])]),
    ).toHaveLength(0)
    expect(
      checkSignalSelfShorts(input, [trace([w(0, 0), w(1, 0), w(0.5, 0)])]),
    ).toHaveLength(1)
    expect(
      checkSignalSelfShorts(input, [
        trace([w(0, 0), w(1, 0), w(1, 1), w(0.5, 1), w(0.5, 0.1), w(-1, 0.1)]),
      ]),
    ).toHaveLength(1)
  })
}

test("native audit permits projected crossings between separate wire layers", () => {
  expect(
    checkSignalSelfShorts(input, [
      trace([
        wire(-1, 0),
        wire(1, 0),
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        wire(1, 0, "bottom"),
        wire(1, 1, "bottom"),
        wire(0, 1, "bottom"),
        wire(0, -1, "bottom"),
      ]),
    ]),
  ).toHaveLength(0)
})

test("an earlier audit pass cannot hide later coordinate or copper-width changes", () => {
  const candidate = trace([
    wire(0, 0),
    wire(1, 0),
    wire(1, 1),
    wire(0.5, 1),
    wire(0.5, 0.11),
    wire(-1, 0.11),
  ])
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(0)
  for (const point of candidate.route)
    if (point.route_type === "wire") point.width = 0.12
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(1)
  for (const point of candidate.route)
    if (point.route_type === "wire") point.width = 0.1
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(0)
  candidate.route[4].y = 0
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(1)
})

test("the audit also rejects self-contact when a signal is identified only by its PCB trace ID", () => {
  const candidate = trace([wire(0, 0), wire(1, 0), wire(0.5, 0)])
  delete candidate.connection_name
  delete candidate.source_trace_id
  expect(checkSignalSelfShorts(input, [candidate])).toHaveLength(1)
})
