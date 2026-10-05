import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { insertNativeSurfaceSignal } from "../lib/insert-native-surface-signal"
import { distance, length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { surfaceBridgeSelfShorts } from "../lib/route-surface-bridge"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import type {
  Connection,
  SimpleRouteJson,
  Trace,
  Via,
  Wire,
} from "../lib/types"

const wire = (x: number, y: number, layer = "top"): Wire => ({
  x,
  y,
  route_type: "wire",
  layer,
  width: 0.1,
})
const trace = (name: string, route: Wire[]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: `existing_${name}`,
  connection_name: name,
  source_trace_id: name,
  route,
})
const connection = (name: string, route: Wire[]): Connection => ({
  name,
  pointsToConnect: [route[0], route.at(-1)!],
})
const via = (x: number, y: number): Via => ({
  x,
  y,
  route_type: "via",
  from_layer: "top",
  to_layer: "bottom",
  layers: ["top", "inner1", "inner2", "bottom"],
  via_diameter: 0.3,
  via_hole_diameter: 0.15,
})

function fixture(): FlexibleSignalState {
  const blocking = trace("crossing", [wire(0, -0.8), wire(0, 0.8)]),
    unrelated = trace("unrelated", [wire(-3, -2), wire(3, -2)]),
    positive = trace("pair_positive", [wire(-3, 2), wire(3, 2)]),
    negative = trace("pair_negative", [wire(-3, 2.25), wire(3, 2.25)]),
    supplied = trace("power", [wire(-3, -2.5), wire(3, -2.5)]),
    native: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.05,
      minBoardEdgeClearance: 0.05,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
      connections: [
        connection("control", [wire(-3, 0), wire(3, 0)]),
        ...[blocking, unrelated, positive, negative].map((item) =>
          connection(item.connection_name!, item.route as Wire[]),
        ),
      ],
      traces: [supplied],
      obstacles: [],
      buses: [
        { busId: "ordinary", connectionNames: ["crossing"], maxLength: 4 },
      ],
      differentialPairs: [
        {
          connectionNames: ["pair_positive", "pair_negative"],
          lengthTolerance: 0.127,
          traceGap: 0.15,
          maxUncoupledLength: 0.5,
        },
      ],
    }
  native.obstacles = native.connections.flatMap((item) =>
    item.pointsToConnect.map((point, end) => ({
      type: "rect",
      componentId: `${item.name}_package_${end}`,
      shape: "circle" as const,
      center: point,
      width: 0.15,
      height: 0.15,
      layers: [point.layer],
      connectedTo: [item.name],
    })),
  )
  for (const [end, point] of native.connections[1].pointsToConnect.entries())
    for (const [dx, delta] of [
      [0.6, 0],
      [0, 0.6],
      [0.6, 0.6],
    ]) {
      const dy = delta * (end ? 1 : -1)
      native.obstacles.push({
        type: "rect",
        componentId: `crossing_package_${end}`,
        shape: "circle",
        center: { x: point.x + dx, y: point.y + dy },
        width: 0.15,
        height: 0.15,
        layers: ["top"],
        connectedTo: [`unused_${end}_${dx}_${dy}`],
      })
    }
  return {
    native,
    pending: native,
    escapes: [],
    retained: [unrelated, positive, negative],
    traces: [blocking],
  }
}

function finish<T>(search: Generator<void, T>): { result: T; steps: number } {
  let step = search.next(),
    count = 0
  while (!step.done && count++ < 50000) step = search.next()
  if (!step.done) {
    search.return(undefined as T)
    throw new Error("Native surface insertion exceeded the regression bound")
  }
  return { result: step.value, steps: count }
}

function joined(state: FlexibleSignalState): Trace[] {
  return [...state.retained, ...state.traces].map((carrier) =>
    joinSignalEscapes(
      carrier,
      state.escapes.filter(
        (escape) => escape.connection_name === carrier.connection_name,
      ),
    ),
  )
}

function auditInput(state: FlexibleSignalState): SimpleRouteJson {
  // Signal-stage inputs retain supplied power copper; the independent native
  // audit also declares that already connected supply net.
  return {
    ...state.native,
    connections: [
      ...state.native.connections,
      connection("power", state.native.traces![0].route as Wire[]),
    ],
  }
}

function drcIssues(state: FlexibleSignalState, routes = joined(state)) {
  const audit = auditInput(state)
  return validateRoutedCopperDrc({
    inputSrj: audit,
    routedSrj: { ...audit, traces: [...state.native.traces!, ...routes] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0]).issues
}

test("reserve a shortest native surface control and repair only its crossing ordinary lane", () => {
  const state = fixture(),
    original = structuredClone(state),
    target = state.native.connections[0],
    baseline = new VectorScene(state.native, target, 0.1, [
      ...fixedCopper(state.native),
      ...[...state.retained, ...state.traces].flatMap(routeCopper),
    ])
  expect(baseline.pathVisible(target.pointsToConnect)).toBe(false)
  expect(drcIssues(state)).toEqual([])
  const { result } = finish(
    insertNativeSurfaceSignal(state.native, state, target.name),
  )
  expect(result).toBeTruthy()
  const routed = joined(result!),
    control = routed.find((item) => item.connection_name === target.name)!,
    crossing = routed.find((item) => item.connection_name === "crossing")!
  expect(routed.map((item) => item.connection_name).sort()).toEqual(
    state.native.connections.map((item) => item.name).sort(),
  )
  expect(
    control.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(length(control.route)).toBeCloseTo(6, 8)
  expect(crossing.route).not.toEqual(state.traces[0].route)
  for (const stable of state.retained) {
    expect(
      routed.find((item) => item.connection_name === stable.connection_name),
    ).toEqual(stable)
  }
  expect(result!.native.traces).toEqual(original.native.traces)
  expect(result!.native.connections).toEqual(state.native.connections)
  for (const item of routed) {
    const native = state.native.connections.find(
      (candidate) => candidate.name === item.connection_name,
    )!
    expect(distance(item.route[0], native.pointsToConnect[0])).toBeLessThan(
      1e-8,
    )
    expect(
      distance(item.route.at(-1)!, native.pointsToConnect[1]),
    ).toBeLessThan(1e-8)
    expect(surfaceBridgeSelfShorts(state.native, native, item)).toBe(false)
  }
  expect(routeAnglesAreConventional(routed)).toBe(true)
  const audit = auditInput(state)
  const drc = validateRoutedCopperDrc({
    inputSrj: audit,
    routedSrj: { ...audit, traces: [...state.native.traces!, ...routed] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])
  expect(drc.valid).toBe(true)
  expect(state).toEqual(original)
})

test("native reservation detects a blocker in an owned TOP approach even when its carrier is on BOTTOM", () => {
  const state = fixture(),
    native = state.native.connections[1]
  native.pointsToConnect[1] = wire(1, 0.8)
  state.native.obstacles = state.native.obstacles.filter(
    (item) => !item.componentId?.startsWith("crossing_package"),
  )
  for (const [end, point] of native.pointsToConnect.entries())
    for (const [dx, delta] of [
      [0, 0],
      [0.6, 0],
      [0, 0.6],
      [0.6, 0.6],
    ]) {
      const dy = delta * (end ? 1 : -1)
      state.native.obstacles.push({
        type: "rect",
        componentId: `crossing_package_${end}`,
        shape: "circle",
        center: { x: point.x + dx, y: point.y + dy },
        width: 0.15,
        height: 0.15,
        layers: ["top"],
        connectedTo: dx || dy ? [`unused_${end}_${dx}_${dy}`] : [native.name],
      })
    }
  state.traces = [
    trace("crossing", [wire(0, 0.5, "bottom"), wire(1, 0.5, "bottom")]),
  ]
  state.escapes = [
    {
      ...state.traces[0],
      pcb_trace_id: "owned_crossing_source",
      route: [wire(0, -0.8), wire(0, 0.5), via(0, 0.5), wire(0, 0.5, "bottom")],
    },
    {
      ...state.traces[0],
      pcb_trace_id: "owned_crossing_sink",
      route: [wire(1, 0.8), wire(1, 0.5), via(1, 0.5), wire(1, 0.5, "bottom")],
    },
  ]
  const original = structuredClone(state),
    { result } = finish(
      insertNativeSurfaceSignal(state.native, state, "control"),
    )
  expect(drcIssues(state)).toEqual([])
  expect(result).toBeTruthy()
  const routed = joined(result!),
    control = routed.find((item) => item.connection_name === "control")!,
    crossing = routed.find((item) => item.connection_name === "crossing")!
  expect(length(control.route)).toBeCloseTo(6, 8)
  expect(
    control.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(crossing.route).not.toEqual(
    joined(state).find((item) => item.connection_name === "crossing")!.route,
  )
  for (const stable of state.retained)
    expect(
      routed.find((item) => item.connection_name === stable.connection_name),
    ).toEqual(stable)
  expect(routeAnglesAreConventional(routed)).toBe(true)
  expect(surfaceBridgeSelfShorts(state.native, native, crossing)).toBe(false)
  const audit = auditInput(state)
  expect(
    validateRoutedCopperDrc({
      inputSrj: audit,
      routedSrj: { ...audit, traces: [...state.native.traces!, ...routed] },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0]).issues,
  ).toEqual([])
  expect(result!.native.traces).toEqual(original.native.traces)
  expect(state).toEqual(original)
})

test("native reservation does not release paired rails that close the planar channel", () => {
  const state = fixture(),
    positive = trace("pair_positive", [wire(0, -0.9), wire(0, 0.9)]),
    negative = trace("pair_negative", [wire(0.3, -0.9), wire(0.3, 0.9)])
  state.native.bounds.minY = -1
  state.native.bounds.maxY = 1
  state.native.traces = []
  state.native.obstacles = []
  state.native.connections = [
    state.native.connections[0],
    connection(positive.connection_name!, positive.route as Wire[]),
    connection(negative.connection_name!, negative.route as Wire[]),
  ]
  state.native.buses = []
  state.retained = [positive, negative]
  state.traces = []
  const original = structuredClone(state),
    { result } = finish(
      insertNativeSurfaceSignal(state.native, state, "control"),
    )
  expect(result).toBeNull()
  expect(state).toEqual(original)
})

test("native reservation requires explicit permission for the native carrier layer", () => {
  for (const allowedLayers of [undefined, ["bottom"]]) {
    const state = fixture()
    state.native.allowedLayers = allowedLayers
    const original = structuredClone(state),
      { result } = finish(
        insertNativeSurfaceSignal(state.native, state, "control"),
      )
    expect(result).toBeNull()
    expect(state).toEqual(original)
  }
})

test("native reservation rejects four blockers beyond the default three-lane repair cap", () => {
  const state = fixture()
  for (const [index, x] of [-1, 1, 2].entries()) {
    const extra = trace(`extra_crossing_${index}`, [
      wire(x, -0.8),
      wire(x, 0.8),
    ])
    state.traces.push(extra)
    state.native.connections.push(
      connection(extra.connection_name!, extra.route as Wire[]),
    )
  }
  const original = structuredClone(state),
    { result } = finish(
      insertNativeSurfaceSignal(state.native, state, "control"),
    )
  expect(result).toBeNull()
  expect(state).toEqual(original)
})

test("native reservation exhausts primitive and repair budgets without changing the accepted state", () => {
  for (const options of [{ maxPrimitiveSteps: 0 }, { maxRepairSteps: 0 }]) {
    const state = fixture(),
      original = structuredClone(state),
      { result } = finish(
        insertNativeSurfaceSignal(state.native, state, "control", options),
      )
    expect(result).toBeNull()
    expect(state).toEqual(original)
  }
})
