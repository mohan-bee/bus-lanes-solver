import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { length } from "../lib/geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { surfaceBridgeSelfShorts } from "../lib/route-surface-bridge"
import { tuneGeneratedOrdinaryEscapes } from "../lib/tune-generated-ordinary-escapes"
import type { SimpleRouteJson, Trace, Via, Wire } from "../lib/types"

test("ordinary matching tunes the BOTTOM run of a caller-owned three-via suffix without moving its TOP runs, barrels, carrier, paired copper, or supplied input", () => {
  const wire = (x: number, y: number, layer = "top"): Wire => ({
    route_type: "wire",
    x,
    y,
    layer,
    width: 0.1,
  })
  const via = (
    x: number,
    y: number,
    from_layer = "top",
    to_layer = "bottom",
  ): Via => ({
    route_type: "via",
    x,
    y,
    from_layer,
    to_layer,
    layers: ["top", "inner1", "inner2", "bottom"],
    via_diameter: 0.3,
    via_hole_diameter: 0.15,
  })
  const trace = (name: string, id: string, route: Trace["route"]): Trace => ({
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: name,
    source_trace_id: name,
    route,
  })
  const data = trace("data", "carrier", [
    wire(0, 1, "bottom"),
    wire(0, 3, "bottom"),
  ])
  const pair = [
    trace("p", "p", [wire(4, 0), wire(4, 24)]),
    trace("q", "q", [wire(4.2, 0), wire(4.2, 24)]),
  ]
  const prefix = trace("data", "owned-prefix", [
    wire(0, 0),
    wire(0, 1),
    via(0, 1),
    wire(0, 1, "bottom"),
  ])
  const suffix = trace("data", "owned-three-via-suffix", [
    wire(0, 20),
    wire(0, 15),
    via(0, 15),
    wire(0, 15, "bottom"),
    wire(0, 8, "bottom"),
    via(0, 8, "bottom", "top"),
    wire(0, 8),
    wire(0, 3),
    via(0, 3),
    wire(0, 3, "bottom"),
  ])
  const power = trace("power", "fixed-supplied", [wire(-4, 2), wire(-4, 18)])
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 6, minY: -2, maxY: 26 },
    connections: [
      {
        name: "data",
        pointsToConnect: [wire(0, 1, "bottom"), wire(0, 3, "bottom")],
      },
      { name: "p", pointsToConnect: pair[0].route as Wire[] },
      { name: "q", pointsToConnect: pair[1].route as Wire[] },
      { name: "power", pointsToConnect: power.route as Wire[] },
    ],
    obstacles: [],
    traces: [power, prefix, suffix],
    buses: [
      {
        busId: "data",
        connectionNames: ["data"],
        minLength: 24.5,
        maxLength: 24.6,
        maxLengthSkew: 0.1,
      },
    ],
    differentialPairs: [
      { connectionNames: ["p", "q"], lengthTolerance: 0.1, traceGap: 0.1 },
    ],
  }
  const carriers = [data, ...pair],
    escapes = [prefix, suffix]
  const snapshot = JSON.stringify({ input, carriers, escapes })
  const work = tuneGeneratedOrdinaryEscapes(input, carriers, escapes, {
    maxCandidatesPerEscape: 4096,
  })
  let next = work.next()
  while (!next.done) next = work.next()
  expect(next.value).not.toBeNull()
  const result = next.value!
  expect(result.matchedNames).toEqual(["data"])
  expect(result.unfinishedNames).toEqual([])
  expect(JSON.stringify({ input, carriers, escapes })).toBe(snapshot)
  expect(result.traces).toBe(carriers)
  expect(result.input.traces![0]).toBe(power)
  expect(result.escapes[0]).toBe(prefix)
  const changed = result.escapes[1]
  expect(changed).not.toBe(suffix)
  expect(changed.route.slice(0, 3)).toEqual(suffix.route.slice(0, 3))
  expect(changed.route.slice(-5)).toEqual(suffix.route.slice(-5))
  expect(changed.route.filter((p) => p.route_type === "via")).toEqual(
    suffix.route.filter((p) => p.route_type === "via"),
  )
  const oldBottom = suffix.route.slice(3, 5),
    newBottom = changed.route.slice(3, changed.route.length - 5)
  expect(length(newBottom)).toBeCloseTo(length(oldBottom) + 4.5, 6)
  expect(
    newBottom.every(
      (p) => p.route_type === "wire" && p.layer === "bottom" && p.width === 0.1,
    ),
  ).toBe(true)
  expect(
    changed.curvedSegments!.every(
      (index) => index > 3 && index < changed.route.length - 5,
    ),
  ).toBe(true)
  const joined = joinSignalEscapes(data, result.escapes)
  expect(length(joined.route)).toBeCloseTo(24.5, 6)
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(surfaceBridgeSelfShorts(input, input.connections[0], joined)).toBe(
    false,
  )
  const physicalInput = {
    ...input,
    connections: input.connections.map((c) =>
      c.name === "data"
        ? { ...c, pointsToConnect: [wire(0, 0), wire(0, 20)] }
        : c,
    ),
  }
  expect(
    validateRoutedCopperDrc({
      inputSrj: physicalInput,
      routedSrj: { ...physicalInput, traces: [power, joined, ...pair] },
      clearance: 0.1,
      allowBlindAndBuriedVias: false,
    } as any).valid,
  ).toBe(true)
  const suppliedOnly = tuneGeneratedOrdinaryEscapes(input, carriers, [], {
    maxCandidatesPerEscape: 4096,
  })
  let unchanged = suppliedOnly.next()
  while (!unchanged.done) unchanged = suppliedOnly.next()
  expect(unchanged.value).toBeNull()
  expect(JSON.stringify({ input, carriers, escapes })).toBe(snapshot)
  const capped = {
    ...input,
    buses: [{ ...input.buses![0], minLength: 24.7, maxLength: 24.6 }],
  }
  const outsideWindow = tuneGeneratedOrdinaryEscapes(capped, carriers, escapes)
  let blocked = outsideWindow.next()
  while (!blocked.done) blocked = outsideWindow.next()
  expect(blocked.value).toBeNull()
  expect(JSON.stringify({ input, carriers, escapes })).toBe(snapshot)
})
