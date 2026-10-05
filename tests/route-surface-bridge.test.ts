import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import {
  routeSurfaceBridge,
  surfaceBridgeSelfShorts,
  surfaceBridgeGridStep,
} from "../lib/route-surface-bridge"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { distance, length } from "../lib/geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson, Trace, Via } from "../lib/types"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next(),
    count = 0
  while (!step.done && count++ < 10000) step = search.next()
  if (!step.done) throw new Error("Surface bridge exceeded its bound")
  return step.value
}
function fixture(): SimpleRouteJson {
  const physical = getCopperLayerNames(6)
  return {
    layerCount: 6,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minBoardEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.35,
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
    connections: [
      {
        name: "signal",
        nominalTraceWidth: 0.12,
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
      {
        name: "power",
        pointsToConnect: [
          { x: -2.4, y: 0.95, layer: "top" },
          { x: -2.4, y: -0.05, layer: "bottom" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_power",
        connection_name: "power",
        source_trace_id: "power",
        route: [
          { x: -2.4, y: 0.95, route_type: "wire", layer: "top", width: 0.1 },
          { x: -2.4, y: 0.45, route_type: "wire", layer: "top", width: 0.1 },
          {
            x: -2.4,
            y: 0.45,
            route_type: "via",
            from_layer: "top",
            to_layer: "bottom",
            layers: physical,
            via_diameter: 0.3,
            via_hole_diameter: 0.2,
          },
          { x: -2.4, y: 0.45, route_type: "wire", layer: "bottom", width: 0.1 },
          {
            x: -2.4,
            y: -0.05,
            route_type: "wire",
            layer: "bottom",
            width: 0.1,
          },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.05,
        height: 4,
        layers: ["top"],
        connectedTo: ["wall"],
      },
      {
        type: "rect",
        center: { x: 1.5, y: 0 },
        width: 5,
        height: 4,
        layers: ["bottom"],
        connectedTo: ["reserved_copper"],
      },
    ],
  }
}

test("a two-via outer-surface bridge accepts a long native approach with full-stack drill clearance", () => {
  const input = fixture(),
    original = structuredClone(input),
    connection = input.connections[0],
    result = finish(routeSurfaceBridge(input, connection))
  expect(result).toBeTruthy()
  const joined = joinSignalEscapes(result!.carrier, result!.escapes),
    vias = joined.route.filter(
      (point): point is Via => point.route_type === "via",
    )
  expect(vias).toHaveLength(2)
  expect(
    result!.carrier.route.every(
      (point) =>
        point.route_type === "wire" &&
        point.layer === "bottom" &&
        point.width === 0.12,
    ),
  ).toBe(true)
  expect(result!.escapes.some((trace) => length(trace.route) > 2)).toBe(true)
  for (const via of vias) {
    expect(via.layers).toEqual(getCopperLayerNames(6))
    expect(distance(via, input.traces![0].route[2])).toBeGreaterThanOrEqual(
      0.55 - 1e-8,
    )
  }
  expect(distance(vias[0], vias[1])).toBeGreaterThanOrEqual(0.55 - 1e-8)
  expect(distance(joined.route[0], connection.pointsToConnect[0])).toBeLessThan(
    1e-8,
  )
  expect(
    distance(joined.route.at(-1)!, connection.pointsToConnect[1]),
  ).toBeLessThan(1e-8)
  expect(routeAnglesAreConventional([joined])).toBe(true)
  const report = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: { ...input, traces: [...input.traces!, joined] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.issues).toEqual([])
  expect(report.valid).toBe(true)
  expect(input).toEqual(original)
})

test("surface bridges require explicit native and opposite outer-layer permission", () => {
  for (const allowed of [
    undefined,
    ["bottom"],
    ["top", "inner1"],
    ["top", "inner1", "bottom"],
  ]) {
    const input = fixture()
    input.allowedLayers = allowed
    expect(finish(routeSurfaceBridge(input, input.connections[0]))).toBeNull()
  }
})

test("surface bridges enforce the complete remaining copper budget, including fixed signal fanout", () => {
  const input = fixture()
  input.traces!.push({
    type: "pcb_trace",
    pcb_trace_id: "fixed_signal",
    connection_name: "signal",
    source_trace_id: "signal",
    route: [
      { x: -3.5, y: 0, route_type: "wire", layer: "top", width: 0.12 },
      { x: -3, y: 0, route_type: "wire", layer: "top", width: 0.12 },
    ],
  })
  input.buses = [
    { busId: "limited", connectionNames: ["signal"], maxLength: 6.4 },
  ]
  expect(finish(routeSurfaceBridge(input, input.connections[0]))).toBeNull()
})

test("a legal native surface route uses no barrel and search exhaustion remains bounded", () => {
  const input = fixture()
  input.obstacles = []
  input.traces = []
  const result = finish(routeSurfaceBridge(input, input.connections[0]))!
  expect(
    result.carrier.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(result.escapes.every((trace) => trace.route.length === 1)).toBe(true)
  expect(
    finish(
      routeSurfaceBridge(fixture(), fixture().connections[0], {
        maxExpansions: 1,
      }),
    ),
  ).toBeNull()
})

test("untimed bridge validation checks contacts between both native-layer approaches", () => {
  const input = fixture(),
    connection = input.connections[0],
    physical = getCopperLayerNames(input.layerCount),
    wire = (x: number, y: number, layer = "top") => ({
      x,
      y,
      layer,
      width: 0.12,
      route_type: "wire" as const,
    }),
    via = (x: number, y: number, from_layer: string, to_layer: string) => ({
      x,
      y,
      from_layer,
      to_layer,
      layers: physical,
      via_diameter: 0.3,
      via_hole_diameter: 0.2,
      route_type: "via" as const,
    }),
    trace: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "crossed_approaches",
      connection_name: "signal",
      route: [
        wire(-3, 0),
        wire(0, 0),
        via(0, 0, "top", "bottom"),
        wire(0, 0, "bottom"),
        wire(0, 2, "bottom"),
        via(0, 2, "bottom", "top"),
        wire(0, 2),
        wire(-2, 2),
        wire(-2, -1),
        wire(3, -1),
      ],
    }
  expect(input.buses).toBeUndefined()
  expect(surfaceBridgeSelfShorts(input, connection, trace)).toBe(true)
  const valid = finish(routeSurfaceBridge(input, connection))!
  expect(
    surfaceBridgeSelfShorts(
      input,
      connection,
      joinSignalEscapes(valid.carrier, valid.escapes),
    ),
  ).toBe(false)
})

test("bridge raster keeps narrow envelopes at requested resolution while bounding total cells", () => {
  expect(surfaceBridgeGridStep(30, 50, 0.05)).toBe(0.05)
  for (const [x, y] of [
    [500, 50],
    [10000, 0.001],
    [1, 10000],
  ]) {
    const step = surfaceBridgeGridStep(x, y, 0.05)
    expect(
      (Math.floor(x / step) + 1) * (Math.floor(y / step) + 1),
    ).toBeLessThanOrEqual(1_000_000)
    expect(step).toBeGreaterThanOrEqual(0.05)
  }
})

test("surface bridges reject nonmanufacturable barrel dimensions before searching", () => {
  for (const [pad, hole] of [
    [0, 0.15],
    [-0.3, 0.15],
    [NaN, 0.15],
    [Infinity, 0.15],
    [0.3, 0],
    [0.3, -0.15],
    [0.3, NaN],
    [0.3, Infinity],
    [0.3, 0.31],
  ]) {
    const input = fixture()
    input.minViaPadDiameter = pad
    input.minViaHoleDiameter = hole
    const search = routeSurfaceBridge(input, input.connections[0])
    expect(search.next()).toEqual({ done: true, value: null })
  }
})

test("surface bridges reject invalid computed drill clearance without mutating supplied geometry", () => {
  for (const [holeClearance, platedClearance] of [
    [NaN, 0],
    [Infinity, 0],
    [0.1, NaN],
    [0.1, Infinity],
    [-0.1, -0.2],
  ]) {
    const input = fixture() as SimpleRouteJson & {
      minPlatedHoleDrillEdgeToDrillEdgeClearance?: number
    }
    input.minViaHoleEdgeToViaHoleEdgeClearance = holeClearance
    input.minPlatedHoleDrillEdgeToDrillEdgeClearance = platedClearance
    const original = structuredClone(input),
      search = routeSurfaceBridge(input, input.connections[0])
    expect(search.next()).toEqual({ done: true, value: null })
    expect(input).toEqual(original)
  }
})

test("generated bridge trace IDs stay distinct from immutable supplied copper IDs", () => {
  const input = fixture(),
    bases = [
      "surface_bridge_carrier_signal",
      "surface_bridge_carrier_signal_1",
      "surface_bridge_escape_signal_0",
      "surface_bridge_escape_signal_1",
    ],
    power = input.traces![0]
  input.traces = bases.map((id) => ({
    ...structuredClone(power),
    pcb_trace_id: id,
  }))
  const original = structuredClone(input),
    result = finish(routeSurfaceBridge(input, input.connections[0]))!
  expect(result).toBeTruthy()
  const generated = [result.carrier, ...result.escapes],
    joined = joinSignalEscapes(result.carrier, result.escapes),
    suppliedIds = new Set(bases)
  expect(
    joined.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  expect(result.carrier.pcb_trace_id).toBe("surface_bridge_carrier_signal_2")
  expect(generated.every((trace) => !suppliedIds.has(trace.pcb_trace_id))).toBe(
    true,
  )
  expect(new Set(generated.map((trace) => trace.pcb_trace_id)).size).toBe(3)
  expect(input).toEqual(original)
})

test("soft bridge negotiation avoids movable copper while preserving hard supplied fanout", () => {
  const input = fixture(),
    soft: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "movable_crossing",
      connection_name: "movable",
      source_trace_id: "movable",
      route: [
        { x: 0, y: -0.8, layer: "top", width: 0.12, route_type: "wire" },
        { x: 0, y: 0.8, layer: "top", width: 0.12, route_type: "wire" },
      ],
    }
  input.connections.push({
    name: "movable",
    pointsToConnect: [
      { x: 0, y: -0.8, layer: "top" },
      { x: 0, y: 0.8, layer: "top" },
    ],
  })
  const original = structuredClone(input),
    originalSoft = structuredClone(soft),
    relaxed = finish(
      routeSurfaceBridge(input, input.connections[0], {
        softTraces: [soft],
        softPenalty: 0,
      }),
    )!,
    preferred = finish(
      routeSurfaceBridge(input, input.connections[0], {
        softTraces: [soft],
        softPenalty: 100,
        viaPenalty: 100,
        maxLength: 9,
      }),
    )!
  expect(relaxed).toBeTruthy()
  expect(preferred).toBeTruthy()
  const report = (result: typeof preferred) =>
    validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: {
        ...input,
        traces: [
          ...input.traces!,
          soft,
          joinSignalEscapes(result.carrier, result.escapes),
        ],
      },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report(relaxed).valid).toBe(false)
  expect(report(preferred).issues).toEqual([])
  const joined = joinSignalEscapes(preferred.carrier, preferred.escapes)
  expect(length(joined.route)).toBeLessThanOrEqual(9)
  expect(
    joined.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(surfaceBridgeSelfShorts(input, input.connections[0], joined)).toBe(
    false,
  )
  expect(input).toEqual(original)
  expect(soft).toEqual(originalSoft)
})

test("soft settings cannot relax copper explicitly supplied as hard", () => {
  const input = fixture(),
    soft = input.traces![0],
    original = structuredClone(input),
    result = finish(
      routeSurfaceBridge(input, input.connections[0], {
        softTraces: [soft],
        softPenalty: 0,
        viaPenalty: 0,
      }),
    )!
  expect(result).toBeTruthy()
  const joined = joinSignalEscapes(result.carrier, result.escapes),
    report = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [...input.traces!, joined] },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.issues).toEqual([])
  expect(surfaceBridgeSelfShorts(input, input.connections[0], joined)).toBe(
    false,
  )
  expect(input).toEqual(original)
})

test("bridge callers can reverse native endpoints without changing manufactured span or fixed copper", () => {
  const input = fixture(),
    original = structuredClone(input),
    connection = {
      ...input.connections[0],
      pointsToConnect: [...input.connections[0].pointsToConnect].reverse(),
    },
    result = finish(routeSurfaceBridge(input, connection))!
  expect(result).toBeTruthy()
  const joined = joinSignalEscapes(result.carrier, result.escapes),
    report = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [...input.traces!, joined] },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(distance(joined.route[0], connection.pointsToConnect[0])).toBeLessThan(
    1e-8,
  )
  expect(
    distance(joined.route.at(-1)!, connection.pointsToConnect[1]),
  ).toBeLessThan(1e-8)
  expect(
    joined.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  expect(report.issues).toEqual([])
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(surfaceBridgeSelfShorts(input, connection, joined)).toBe(false)
  expect(input).toEqual(original)
})

test("bridge raster budgets permit a bounded finer grid and reject invalid search costs", () => {
  const defaultStep = surfaceBridgeGridStep(30, 50, 0.025)
  expect(defaultStep).toBeGreaterThan(0.025)
  expect(surfaceBridgeGridStep(30, 50, 0.025, 4_000_000)).toBe(0.025)
  for (const options of [
    { softPenalty: -1 },
    { softPenalty: Infinity },
    { viaPenalty: -1 },
    { viaPenalty: NaN },
    { maxGridCells: Infinity },
    { maxGridCells: 3 },
    { maxGridCells: 4.5 },
    { maxVias: 0 },
    { maxVias: 3 },
    { maxVias: Infinity },
  ]) {
    const input = fixture(),
      original = structuredClone(input),
      search = routeSurfaceBridge(input, input.connections[0], options)
    expect(search.next()).toEqual({ done: true, value: null })
    expect(input).toEqual(original)
  }
})

test("soft via penalties include drill spacing that exceeds copper land clearance", () => {
  const input = fixture()
  input.traces = []
  const initial = finish(routeSurfaceBridge(input, input.connections[0]))!,
    first = joinSignalEscapes(initial.carrier, initial.escapes).route.find(
      (point): point is Via => point.route_type === "via",
    )!,
    point = { x: first.x, y: first.y + 0.4 },
    soft: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "movable_barrel",
      connection_name: "movable_barrel",
      source_trace_id: "movable_barrel",
      route: [
        {
          x: point.x - 0.3,
          y: point.y,
          route_type: "wire",
          layer: "top",
          width: 0.12,
        },
        { ...point, route_type: "wire", layer: "top", width: 0.12 },
        {
          ...point,
          route_type: "via",
          from_layer: "top",
          to_layer: "bottom",
          layers: getCopperLayerNames(input.layerCount),
          via_diameter: 0.3,
          via_hole_diameter: 0.2,
        },
        { ...point, route_type: "wire", layer: "bottom", width: 0.12 },
        {
          x: point.x - 0.3,
          y: point.y,
          route_type: "wire",
          layer: "bottom",
          width: 0.12,
        },
      ],
    }
  input.connections.push({
    name: "movable_barrel",
    pointsToConnect: [
      { x: point.x - 0.3, y: point.y, layer: "top" },
      { x: point.x - 0.3, y: point.y, layer: "bottom" },
    ],
  })
  const original = structuredClone(input),
    originalSoft = structuredClone(soft),
    result = finish(
      routeSurfaceBridge(input, input.connections[0], {
        softTraces: [soft],
        softPenalty: 100,
      }),
    )!,
    joined = joinSignalEscapes(result.carrier, result.escapes),
    vias = joined.route.filter(
      (point): point is Via => point.route_type === "via",
    ),
    report = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [soft, joined] },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(distance(first, point)).toBeGreaterThan(0.35)
  expect(distance(first, point)).toBeLessThan(0.55)
  expect(vias).toHaveLength(2)
  expect(vias.every((via) => distance(via, point) >= 0.55 - 1e-8)).toBe(true)
  expect(report.issues).toEqual([])
  expect(routeAnglesAreConventional([joined])).toBe(true)
  expect(surfaceBridgeSelfShorts(input, input.connections[0], joined)).toBe(
    false,
  )
  expect(input).toEqual(original)
  expect(soft).toEqual(originalSoft)
})
