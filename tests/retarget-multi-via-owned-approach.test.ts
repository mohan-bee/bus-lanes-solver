import { expect, test } from "bun:test"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson, Trace, Via, Wire } from "../lib/types"
import { checkSignalSelfShorts } from "../scripts/check-signal-self-shorts"

const approachWire = (x: number, y: number, layer: string): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

function multiViaApproachFixture() {
  const physical = getCopperLayerNames(6)
  const barrel = (x: number, from_layer: string, to_layer: string): Via => ({
    route_type: "via",
    x,
    y: 0,
    from_layer,
    to_layer,
    layers: [...physical],
    via_diameter: 0.3,
    via_hole_diameter: 0.15,
  })
  const trace = (
    id: string,
    route: Trace["route"],
    name = "signal",
  ): Trace => ({
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: name,
    source_trace_id: name,
    route,
  })
  const prefix = {
    ...trace("owned_source", [
      approachWire(-3.5, 0, "top"),
      approachWire(-3, 0, "top"),
      barrel(-3, "top", "bottom"),
      approachWire(-3, 0, "bottom"),
    ]),
    curvedSegments: [1],
  }
  const carrier = trace("carrier", [
    approachWire(-3, 0, "bottom"),
    approachWire(-1, 0, "bottom"),
  ])
  const target = {
    ...trace("owned_target", [
      approachWire(3.5, 0, "top"),
      approachWire(3, 0, "top"),
      barrel(3, "top", "bottom"),
      approachWire(3, 0, "bottom"),
      approachWire(1, 0, "bottom"),
      barrel(1, "bottom", "top"),
      approachWire(1, 0, "top"),
      approachWire(-1, 0, "top"),
      barrel(-1, "top", "bottom"),
      approachWire(-1, 0, "bottom"),
    ]),
    curvedSegments: [1, 4, 7],
  }
  const fixed = trace(
    "fixed_power",
    [
      approachWire(-0.5, 1, "top"),
      approachWire(0.5, 1, "top"),
      { ...barrel(0.5, "top", "bottom"), y: 1 },
      approachWire(0.5, 1, "bottom"),
      approachWire(0.5, 1.5, "bottom"),
    ],
    "power",
  )
  const input: SimpleRouteJson = {
    layerCount: 6,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -4, maxX: 4, minY: -0.5, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [prefix.route[0], target.route[0]] as Wire[],
      },
      {
        name: "power",
        pointsToConnect: [fixed.route[0], fixed.route.at(-1)!] as Wire[],
      },
    ],
    traces: [fixed],
  }
  return { input, prefix, carrier, target, fixed }
}

test("a three-via owned target remains identical on its ending plane and rejoins a physical four-via native route", () => {
  const { input, prefix, carrier, target, fixed } = multiViaApproachFixture()
  const before = structuredClone({ input, prefix, carrier, target, fixed })
  const retained = retargetGeneratedEscape(target, "bottom")
  expect(retained).toBe(target)
  expect(retained.route).toBe(target.route)
  expect(retained.curvedSegments).toBe(target.curvedSegments)
  for (const [index, point] of target.route.entries())
    expect(retained.route[index]).toBe(point)
  const targetVias = retained.route.filter(
    (point): point is Via => point.route_type === "via",
  )
  expect(targetVias).toHaveLength(3)
  for (const via of targetVias) {
    expect(via.layers).toEqual(getCopperLayerNames(6))
    expect(via.via_diameter).toBe(0.3)
    expect(via.via_hole_diameter).toBe(0.15)
  }
  const joined = joinSignalEscapes(carrier, [prefix, retained])
  const vias = joined.route.filter(
    (point): point is Via => point.route_type === "via",
  )
  expect(vias).toHaveLength(4)
  expect(vias.map((via) => [via.from_layer, via.to_layer])).toEqual([
    ["top", "bottom"],
    ["bottom", "top"],
    ["top", "bottom"],
    ["bottom", "top"],
  ])
  expect(joined.route[0]).toEqual(prefix.route[0])
  expect(joined.route.at(-1)).toEqual(target.route[0])
  expect(joined.curvedSegments).toEqual([1, 7, 10, 13])
  const powerVia = fixed.route.find(
    (point): point is Via => point.route_type === "via",
  )!
  for (const [index, via] of vias.entries()) {
    expect(via.layers).toEqual(getCopperLayerNames(6))
    expect(distance(via, powerVia)).toBeGreaterThanOrEqual(0.3 - 1e-8)
    for (const other of vias.slice(index + 1))
      expect(distance(via, other)).toBeGreaterThanOrEqual(0.3 - 1e-8)
  }
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(checkSignalSelfShorts(input, [joined])).toEqual([])
  const report = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces: [...input.traces!, joined] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.valid).toBe(true)
  expect(report.issues).toEqual([])
  expect(input.traces![0]).toBe(fixed)
  expect({ input, prefix, carrier, target, fixed }).toEqual(before)
})

test("multi-via owned approaches reject a new ending plane without rewriting existing copper", () => {
  for (const layer of ["top", "inner1"]) {
    const { target } = multiViaApproachFixture(),
      before = structuredClone(target)
    expect(() => retargetGeneratedEscape(target, layer)).toThrow()
    expect(target).toEqual(before)
  }
})

test("multi-via retargeting rejects malformed handoffs, layer jumps, and manufactured span metadata without mutation", () => {
  const mutations: Array<[string, (trace: Trace) => void]> = [
    [
      "implicit before-via segment",
      (trace) => {
        trace.route[4].x += 0.1
      },
    ],
    [
      "implicit after-via segment",
      (trace) => {
        trace.route[6].y += 0.1
      },
    ],
    [
      "from-layer mismatch",
      (trace) => {
        ;(trace.route[5] as Via).from_layer = "inner1"
      },
    ],
    [
      "to-layer mismatch",
      (trace) => {
        ;(trace.route[5] as Via).to_layer = "inner2"
      },
    ],
    [
      "wire-layer jump",
      (trace) => {
        ;(trace.route[4] as Wire).layer = "top"
      },
    ],
    [
      "missing span",
      (trace) => {
        ;(trace.route[5] as Via).layers = undefined
      },
    ],
    [
      "span excludes source layer",
      (trace) => {
        ;(trace.route[5] as Via).layers = [
          "top",
          "inner1",
          "inner2",
          "inner3",
          "inner4",
        ]
      },
    ],
    [
      "span excludes destination layer",
      (trace) => {
        ;(trace.route[5] as Via).layers = [
          "inner1",
          "inner2",
          "inner3",
          "inner4",
          "bottom",
        ]
      },
    ],
    [
      "duplicate span layer",
      (trace) => {
        ;(trace.route[5] as Via).layers = ["top", "inner1", "inner1", "bottom"]
      },
    ],
    [
      "blank span layer",
      (trace) => {
        ;(trace.route[5] as Via).layers = ["top", "", "bottom"]
      },
    ],
    [
      "empty span",
      (trace) => {
        ;(trace.route[5] as Via).layers = []
      },
    ],
    [
      "same-layer via",
      (trace) => {
        ;(trace.route[5] as Via).to_layer = "bottom"
      },
    ],
    [
      "missing pad diameter",
      (trace) => {
        ;(trace.route[5] as Via).via_diameter = undefined
      },
    ],
    [
      "missing drill diameter",
      (trace) => {
        ;(trace.route[5] as Via).via_hole_diameter = undefined
      },
    ],
    [
      "nonpositive pad diameter",
      (trace) => {
        ;(trace.route[5] as Via).via_diameter = 0
      },
    ],
    [
      "oversized drill",
      (trace) => {
        ;(trace.route[5] as Via).via_hole_diameter = 0.4
      },
    ],
    [
      "nonfinite coordinate",
      (trace) => {
        trace.route[5].x = Number.NaN
      },
    ],
    [
      "nonpositive wire width",
      (trace) => {
        ;(trace.route[4] as Wire).width = 0
      },
    ],
    [
      "missing initial wire",
      (trace) => {
        trace.route.splice(0, 2)
      },
    ],
    [
      "missing final wire",
      (trace) => {
        trace.route.pop()
      },
    ],
  ]
  for (const [name, mutate] of mutations) {
    const { target } = multiViaApproachFixture()
    mutate(target)
    const before = structuredClone(target)
    expect(() => retargetGeneratedEscape(target, "bottom"), name).toThrow()
    expect(target, name).toEqual(before)
  }
})
