import { expect, test } from "bun:test"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { normalizeSurfaceCarriers } from "../lib/normalize-surface-carriers"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson, Trace, Via, Wire } from "../lib/types"

const tailWire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

function bottomTailFixture(reverse = false) {
  const physical = getCopperLayerNames(6)
  const route = [
    tailWire(1.5, 0),
    tailWire(0.1, 0),
    tailWire(0.05, 0),
    tailWire(0, 0.05),
    tailWire(-0.0000385, 0.05),
    tailWire(-0.0002155, 0.049823),
    tailWire(-0.000254, 0.049823),
  ]
  if (reverse) route.reverse()
  const carrier: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "carrier",
    connection_name: "control",
    source_trace_id: "control",
    route,
  }
  const escapes: Trace[] = [route[0], route.at(-1)!].map((point, end) => ({
    ...carrier,
    pcb_trace_id: `owned_escape_${end}`,
    route: [
      tailWire(point.x, point.y + 0.5, "top"),
      tailWire(point.x, point.y, "top"),
      {
        route_type: "via",
        x: point.x,
        y: point.y,
        from_layer: "top",
        to_layer: "bottom",
        layers: physical,
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      point,
    ],
  }))
  const fixed: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_power",
    connection_name: "power",
    source_trace_id: "power",
    route: [
      tailWire(-1, 1, "top"),
      tailWire(0.5, 1, "top"),
      {
        route_type: "via",
        x: 0.5,
        y: 1,
        from_layer: "top",
        to_layer: "bottom",
        layers: physical,
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      tailWire(0.5, 1),
      tailWire(0.5, 1.5),
    ],
  }
  const native: SimpleRouteJson = {
    layerCount: 6,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -2, maxX: 2, minY: -0.5, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "control",
        source_trace_id: "control",
        pointsToConnect: [escapes[0].route[0], escapes[1].route[0]] as Wire[],
      },
      {
        name: "power",
        source_trace_id: "power",
        pointsToConnect: [fixed.route[0], fixed.route.at(-1)!] as Wire[],
      },
    ],
    traces: [fixed],
  }
  const input: SimpleRouteJson = {
    ...native,
    connections: [
      {
        ...native.connections[0],
        pointsToConnect: [route[0], route.at(-1)!],
      },
    ],
    traces: [fixed, ...escapes],
  }
  return { input, native, carrier, escapes, fixed }
}

function nativeTailDrc(native: SimpleRouteJson, joined: Trace) {
  return validateRoutedCopperDrc({
    inputSrj: native,
    routedSrj: { ...native, traces: [...native.traces!, joined] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
}

for (const reverse of [false, true]) {
  test(`normalization removes microscopic BOTTOM carrier ${reverse ? "source" : "target"} tail backsteps while preserving full-stack barrels`, () => {
    const { input, native, carrier, escapes, fixed } =
      bottomTailFixture(reverse)
    const before = structuredClone({ input, native, carrier, escapes, fixed })
    expect(tuningPathIsSelfClear(carrier.route, 0.1)).toBe(false)
    const oldCore = BusLanesSolver.forValidation(input, [carrier], {
      smoothTuning: true,
    })
    oldCore.solve()
    expect(oldCore.solved).toBe(false)
    expect(oldCore.error).toContain("Final self-clearance violation")
    expect(
      nativeTailDrc(native, joinSignalEscapes(carrier, escapes)).valid,
    ).toBe(true)

    const prepared = normalizeSurfaceCarriers(input, [carrier], escapes)
    const normalized = prepared.traces[0]
    expect(normalized.route[0]).toEqual(carrier.route[0])
    expect(normalized.route.at(-1)).toEqual(carrier.route.at(-1))
    expect(tuningPathIsSelfClear(normalized.route, 0.1)).toBe(true)
    expect(routeAnglesAreConventional([normalized])).toBe(true)
    expect(normalized.curvedSegments).toBeUndefined()
    for (let index = 1; index < normalized.route.length; index++) {
      const a = normalized.route[index - 1],
        b = normalized.route[index]
      expect((b.x - a.x) * (reverse ? 1 : -1)).toBeGreaterThanOrEqual(-1e-8)
      expect((b.y - a.y) * (reverse ? -1 : 1)).toBeGreaterThanOrEqual(-1e-8)
    }
    expect(
      normalized.route.every(
        (point) =>
          point.route_type === "wire" &&
          point.layer === "bottom" &&
          point.width === 0.1,
      ),
    ).toBe(true)
    const core = BusLanesSolver.forValidation(prepared.input, prepared.traces, {
      smoothTuning: true,
    })
    core.solve()
    expect(core.solved).toBe(true)
    expect(core.error).toBeNull()

    const joined = joinSignalEscapes(normalized, prepared.escapes)
    expect(joined.route[0]).toEqual(
      native.connections[0].pointsToConnect[0] as Wire,
    )
    expect(joined.route.at(-1)).toEqual(
      native.connections[0].pointsToConnect[1] as Wire,
    )
    const drc = nativeTailDrc(native, joined)
    expect(drc.valid).toBe(true)
    expect(drc.issues).toEqual([])
    expect(prepared.input.traces![0]).toBe(fixed)
    expect(prepared.escapes).toEqual(escapes)
    for (let end = 0; end < escapes.length; end++) {
      expect(prepared.escapes[end]).toBe(escapes[end])
      const barrel = escapes[end].route.find(
        (point): point is Via => point.route_type === "via",
      )!
      expect(
        prepared.escapes[end].route.find((point) => point.route_type === "via"),
      ).toBe(barrel)
      expect(barrel.layers).toEqual(getCopperLayerNames(6))
      expect(prepared.input.traces![end + 1]).toBe(escapes[end])
    }
    expect({ input, native, carrier, escapes, fixed }).toEqual(before)
  })
}

test("carrier tail normalization preserves annotated or coupled copper", () => {
  for (const annotation of [
    { curvedSegments: [4, 5] },
    { coupledSection: [2, 6] as [number, number] },
  ]) {
    const { input, carrier, escapes } = bottomTailFixture()
    Object.assign(carrier, annotation)
    const before = structuredClone({ input, carrier, escapes })
    const prepared = normalizeSurfaceCarriers(input, [carrier], escapes)
    expect(prepared.traces[0]).toEqual(carrier)
    expect(prepared.traces[0].route).toEqual(carrier.route)
    expect(prepared.escapes).toEqual(escapes)
    expect({ input, carrier, escapes }).toEqual(before)
  }
})

test("source-tail normalization shifts untouched interior curve and coupling indexes", () => {
  const { input, native, carrier, escapes } = bottomTailFixture(true)
  carrier.curvedSegments = [6]
  carrier.coupledSection = [5, 6]
  const before = structuredClone({ input, carrier, escapes }),
    protectedRun = carrier.route.slice(5, 7),
    prepared = normalizeSurfaceCarriers(input, [carrier], escapes),
    normalized = prepared.traces[0]
  expect(normalized.curvedSegments).toEqual([4])
  expect(normalized.coupledSection).toEqual([3, 4])
  expect(normalized.route.slice(3, 5)).toEqual(protectedRun)
  expect(tuningPathIsSelfClear(normalized.route, 0.1)).toBe(true)
  expect(routeAnglesAreConventional([normalized])).toBe(true)
  expect(
    nativeTailDrc(native, joinSignalEscapes(normalized, escapes)).issues,
  ).toEqual([])
  expect({ input, carrier, escapes }).toEqual(before)
})
