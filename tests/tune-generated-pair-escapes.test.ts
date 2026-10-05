import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { distance, length } from "../lib/geometry"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { pairLengthReports } from "../lib/route-lengths"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import { tuneGeneratedPairEscapes } from "../lib/tune-generated-pair-escapes"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})
const dogbone = (
  name: string,
  end: number,
  pad: Wire,
  x: number,
  y: number,
): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: `generated_${name}_${end}`,
  connection_name: name,
  route: [
    pad,
    wire(x, y, "top"),
    {
      route_type: "via",
      x,
      y,
      from_layer: "top",
      to_layer: "bottom",
      layers: ["top", "inner1", "inner2", "bottom"],
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    },
    wire(x, y),
  ],
})
function fixture() {
  const escapes = [
    dogbone("P", 0, wire(-0.4, -0.4, "top"), 0, 0),
    dogbone("P", 1, wire(8.4, -0.4, "top"), 8, 0),
    dogbone("N", 0, wire(-1.2, 0.42, "top"), 0, 0.42),
    dogbone("N", 1, wire(8.4, 0.82, "top"), 8, 0.42),
  ]
  const fixed: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "supplied_fanout",
    connection_name: "F",
    route: [wire(-3, -2), wire(-2, -2)],
  }
  const traces: Trace[] = [
    ...["P", "N"].map(
      (name, i): Trace => ({
        type: "pcb_trace",
        pcb_trace_id: `carrier_${name}`,
        connection_name: name,
        coupledSection: [0, 1],
        route: [wire(0, i * 0.42), wire(8, i * 0.42)],
      }),
    ),
    {
      type: "pcb_trace",
      pcb_trace_id: "carrier_F",
      connection_name: "F",
      route: [wire(-2, -2), wire(10, -2)],
    },
  ]
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -4, maxX: 11, minY: -3, maxY: 3 },
    obstacles: [
      ...escapes.map((t, i) => ({
        componentId: i % 2 ? "receiver" : "driver",
        center: t.route[0],
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: [t.connection_name!],
      })),
      {
        componentId: "driver",
        center: { x: -0.4, y: -1.2 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: traces.map((t) => ({
      name: t.connection_name!,
      pointsToConnect: [t.route[0] as Wire, t.route.at(-1)! as Wire],
    })),
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.05, traceGap: 0.32 },
    ],
    traces: [fixed, ...escapes],
  }
  return { input, traces, escapes, fixed }
}

const finish = (gen: ReturnType<typeof tuneGeneratedPairEscapes>) => {
  let step = gen.next()
  while (!step.done) step = gen.next()
  return step.value
}

test("residual pair skew can be corrected in a generated top stub without moving its barrel or coupled carriers", () => {
  const { input, traces, escapes, fixed } = fixture()
  const before = structuredClone({ input, traces, escapes })
  expect(pairLengthReports(input, traces)[0].matched).toBe(false)
  const result = finish(
    tuneGeneratedPairEscapes(input, traces, escapes, { smoothTuning: true }),
  )
  expect(result).not.toBeNull()
  const routed = result!
  expect(pairLengthReports(routed.input, routed.traces)[0].matched).toBe(true)
  expect({ input, traces, escapes }).toEqual(before)
  expect(routed.traces).toEqual(traces)
  expect(routed.input.connections).toEqual(input.connections)
  expect(
    routed.input.traces!.find((t) => t.pcb_trace_id === fixed.pcb_trace_id),
  ).toEqual(fixed)
  const changes = routed.escapes.filter(
    (t, i) => JSON.stringify(t) !== JSON.stringify(escapes[i]),
  )
  expect(changes).toHaveLength(1)
  const changed = changes[0],
    original = escapes.find((t) => t.pcb_trace_id === changed.pcb_trace_id)!
  const oldVia = original.route.findIndex((p) => p.route_type === "via"),
    newVia = changed.route.findIndex((p) => p.route_type === "via")
  expect(changed.route.slice(newVia)).toEqual(original.route.slice(oldVia))
  expect(changed.route[0]).toEqual(original.route[0])
  const top = { ...changed, route: changed.route.slice(0, newVia) }
  expect(length(top.route)).toBeGreaterThan(
    length(original.route.slice(0, oldVia)),
  )
  expect(length(top.route)).toBeLessThanOrEqual(2)
  expect(
    top.route.every((p) => p.route_type === "wire" && p.layer === "top"),
  ).toBe(true)
  expect(routeAnglesAreConventional([top])).toBe(true)
  expect(tuningPathIsSelfClear(top.route, 0.2)).toBe(true)
  expect(
    createTerminalViaClearanceChecker(routed.input, top, {
      preserveExistingApproach: false,
    })(top.route),
  ).toBe(true)
  const validator = BusLanesSolver.forValidation(routed.input, routed.traces, {
    smoothTuning: true,
  })
  validator.solve()
  expect(validator.error).toBeNull()
  expect(validator.solved).toBe(true)
  const coupling = exteriorPairSpacingReports(routed.input, routed.traces)[0]
  expect(coupling.applicable).toBe(true)
  expect(coupling.matched).toBe(true)
  expect(coupling.separatedExteriorLengthMm).toBe(0)
  // Audit the physical pad-to-pad routes, including all original via lands and
  // the supplied fanout. Carrier-only validation would miss stub collisions.
  const joined = traces
    .filter((t) => t.connection_name !== "F")
    .map((t) => {
      const ends = routed.escapes.filter(
        (e) => e.connection_name === t.connection_name,
      )
      const prefix = ends.find(
        (e) => distance(e.route.at(-1)!, t.route[0]) < 1e-8,
      )!
      const suffix = ends.find((e) => e !== prefix)!
      const reverse = suffix.route
        .toReversed()
        .map((p) =>
          p.route_type === "via"
            ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
            : p,
        )
      return {
        ...t,
        route: [...prefix.route.slice(0, -1), ...t.route, ...reverse.slice(1)],
      }
    })
  const physical = {
    ...input,
    traces: [],
    connections: [
      ...joined.map((t) => ({
        name: t.connection_name!,
        pointsToConnect: [t.route[0] as Wire, t.route.at(-1)! as Wire],
      })),
      {
        name: "F",
        pointsToConnect: [
          fixed.route[0] as Wire,
          traces[2].route.at(-1)! as Wire,
        ],
      },
    ],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: physical,
    routedSrj: { ...physical, traces: [fixed, ...joined, traces[2]] },
    clearance: 0.1,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])
  expect(drc.valid).toBe(true)
})

test("supplied fanouts remain ineligible even when their top stub has tuning room", () => {
  const { input, traces, escapes } = fixture()
  const before = structuredClone({ input, traces, escapes })
  expect(
    finish(tuneGeneratedPairEscapes(input, traces, [], { smoothTuning: true })),
  ).toBeNull()
  expect({ input, traces, escapes }).toEqual(before)
})
