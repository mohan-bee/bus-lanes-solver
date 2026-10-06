import { expect, test } from "bun:test"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { insertSurfaceSignal } from "../lib/insert-surface-signal"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { surfaceBridgeSelfShorts } from "../lib/route-surface-bridge"
import { busLengthReports } from "../lib/route-lengths"
import { distance } from "../lib/geometry"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import type { Connection, SimpleRouteJson, Trace, Wire } from "../lib/types"

function finish<T>(search: Generator<void, T>): T {
  let step = search.next(),
    count = 0
  while (!step.done && count++ < 10000) step = search.next()
  if (!step.done) {
    search.return(undefined as T)
    throw Error("Surface insertion exceeded its bound")
  }
  return step.value
}
const wire = (x: number, y: number, layer = "top", width = 0.1): Wire => ({
  x,
  y,
  route_type: "wire",
  layer,
  width,
})

/** An obsolete TOP approach and BOTTOM carrier form a barrier across both
 * usable planes. Its ordinary owner can move below the newly inserted control;
 * a bus-specific width, carrier layer, and copper bounds survive the exchange. */
function fixture(blocking = true): FlexibleSignalState {
  const physical = getCopperLayerNames(4),
    connection = (name: string, a: Wire, b: Wire): Connection => ({
      name,
      source_trace_id: name,
      pointsToConnect: [a, b],
    }),
    ordinary = connection("ordinary", wire(0, -0.45), wire(0.9, -0.35)),
    p = connection("P", wire(-3.5, 0.25), wire(-2.7, 0.25)),
    n = connection("N", wire(-3.5, -0.25), wire(-2.7, -0.25)),
    control = connection("control", wire(-3, 0), wire(3, 0)),
    powerConnection = connection(
      "power",
      wire(2, -0.15),
      wire(2.3, -0.3, "bottom"),
    ),
    trace = (name: string, id: string, route: Trace["route"]): Trace => ({
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: name,
      source_trace_id: name,
      route,
    }),
    escape = (c: Connection, end: number, x: number, y: number, width = 0.1) =>
      trace(c.name, `${c.name}_escape_${end}`, [
        { ...c.pointsToConnect[end], route_type: "wire", width } as Wire,
        wire(x, y, "top", width),
        {
          x,
          y,
          route_type: "via",
          from_layer: "top",
          to_layer: "bottom",
          layers: physical,
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        wire(x, y, "bottom", width),
      ]),
    pairTraces = [p, n].map((c) => ({
      ...trace(c.name, `${c.name}_carrier`, [
        wire(-3.3, c.pointsToConnect[0].y, "bottom"),
        wire(-2.9, c.pointsToConnect[0].y, "bottom"),
      ]),
      coupledSection: [0, 1] as [number, number],
    })),
    pairEscapes = [p, n].flatMap((c) => [
      escape(c, 0, -3.3, c.pointsToConnect[0].y),
      escape(c, 1, -2.9, c.pointsToConnect[1].y),
    ]),
    first = blocking ? { x: 0, y: 0.4 } : { x: 0, y: -0.3 },
    second = { x: 0.6, y: -0.35 },
    ordinaryTrace = trace("ordinary", "ordinary_original_carrier", [
      wire(first.x, first.y, "bottom", 0.12),
      ...(blocking ? [wire(0, -0.35, "bottom", 0.12)] : []),
      wire(second.x, second.y, "bottom", 0.12),
    ]),
    escapes = [
      ...pairEscapes,
      escape(ordinary, 0, first.x, first.y, 0.12),
      escape(ordinary, 1, second.x, second.y, 0.12),
    ],
    power = trace("power", "fixed_power", [
      wire(2, -0.15),
      wire(2, -0.3),
      {
        x: 2,
        y: -0.3,
        route_type: "via",
        from_layer: "top",
        to_layer: "bottom",
        layers: physical,
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      wire(2, -0.3, "bottom"),
      wire(2.3, -0.3, "bottom"),
    ]),
    native: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.05,
      minBoardEdgeClearance: 0.05,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      bounds: { minX: -4, maxX: 4, minY: -0.6, maxY: 0.6 },
      obstacles: [],
      connections: [control, ordinary, p, n, powerConnection],
      traces: [power],
      buses: [
        {
          busId: "ordinary_bus",
          connectionNames: ["ordinary"],
          traceWidth: 0.12,
          allowedLayers: ["bottom"],
          minLength: 0.9,
          maxLength: 3,
          maxLengthSkew: 0,
        },
      ],
      differentialPairs: [
        { connectionNames: ["P", "N"], lengthTolerance: 0.01, traceGap: 0.4 },
      ],
    },
    carriers = [...pairTraces, ordinaryTrace],
    pending: SimpleRouteJson = {
      ...native,
      connections: native.connections.map((c) => {
        const t = carriers.find((t) => t.connection_name === c.name)
        return t
          ? { ...c, pointsToConnect: [t.route[0], t.route.at(-1)!] as Wire[] }
          : c
      }),
      traces: [power, ...escapes, ...pairTraces],
    }
  return {
    native,
    pending,
    escapes,
    retained: pairTraces,
    traces: [ordinaryTrace],
  }
}

function proof(state: FlexibleSignalState) {
  const all = [...state.retained, ...state.traces],
    joined = all.map((t) =>
      joinSignalEscapes(
        t,
        state.escapes.filter((e) => e.connection_name === t.connection_name),
      ),
    ),
    report = validateRoutedCopperDrc({
      inputSrj: state.native,
      routedSrj: {
        ...state.native,
        traces: [...state.native.traces!, ...joined],
      },
      clearance: 0.05,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.issues).toEqual([])
  expect(report.valid).toBe(true)
  for (const t of joined) {
    const c = state.native.connections.find(
      (c) => c.name === t.connection_name,
    )!
    expect(distance(t.route[0], c.pointsToConnect[0])).toBeLessThan(1e-8)
    expect(distance(t.route.at(-1)!, c.pointsToConnect[1])).toBeLessThan(1e-8)
    expect(surfaceBridgeSelfShorts(state.native, c, t)).toBe(false)
  }
  return { all, joined }
}

function preserved(
  state: FlexibleSignalState,
  original: FlexibleSignalState,
  result: FlexibleSignalState,
) {
  expect(state).toEqual(original)
  expect(result.native).toBe(state.native)
  expect(result.native.traces).toEqual(original.native.traces!)
  expect(result.native.buses).toEqual(original.native.buses)
  expect(result.pending.buses).toEqual(original.native.buses)
  expect(result.pending.differentialPairs).toEqual(
    original.native.differentialPairs,
  )
  for (const old of original.retained) {
    expect(
      [...result.retained, ...result.traces].find(
        (t) => t.connection_name === old.connection_name,
      ),
    ).toEqual(old)
    expect(
      result.escapes.filter((e) => e.connection_name === old.connection_name),
    ).toEqual(
      original.escapes.filter((e) => e.connection_name === old.connection_name),
    )
  }
  expect(
    result.pending.traces!.filter((t) => t.pcb_trace_id === "fixed_power"),
  ).toEqual(original.native.traces!)
}

test("frozen multinet insertion preserves supplied power, paired rails and all accepted owned escapes", () => {
  const state = fixture(false),
    original = structuredClone(state),
    result = finish(
      insertSurfaceSignal(state, "control", { maxReleasedCandidates: 0 }),
    )!
  expect(result).toBeTruthy()
  preserved(state, original, result)
  expect(
    [...result.retained, ...result.traces].find(
      (t) => t.connection_name === "ordinary",
    ),
  ).toEqual(original.traces[0])
  expect(
    result.escapes.filter((e) => e.connection_name === "ordinary"),
  ).toEqual(original.escapes.filter((e) => e.connection_name === "ordinary"))
  const { all, joined } = proof(result)
  expect(all).toHaveLength(4)
  expect(new Set(all.map((t) => t.connection_name)).size).toBe(4)
  const reports = busLengthReports(result.native, joined)
  expect(reports[0].aboveMinimumLength).toBe(true)
  expect(reports[0].withinLengthLimit).toBe(true)
  expect(reports[0].matched).toBe(true)
})

test("a bounded ordinary exchange restores its original width, allowed carrier layer and complete bus constraints", () => {
  const state = fixture(),
    original = structuredClone(state)
  proof(state)
  expect(
    finish(insertSurfaceSignal(state, "control", { maxReleasedCandidates: 0 })),
  ).toBeNull()
  const result = finish(
    insertSurfaceSignal(state, "control", { maxReleasedCandidates: 1 }),
  )!
  expect(result).toBeTruthy()
  preserved(state, original, result)
  const { all, joined } = proof(result),
    ordinary = all.find((t) => t.connection_name === "ordinary")!
  expect(all).toHaveLength(4)
  expect(new Set(all.map((t) => t.connection_name)).size).toBe(4)
  expect(ordinary.pcb_trace_id).not.toBe(original.traces[0].pcb_trace_id)
  expect(
    ordinary.route.every(
      (p) =>
        p.route_type === "wire" && p.layer === "bottom" && p.width === 0.12,
    ),
  ).toBe(true)
  const ordinaryJoin = joined.find((t) => t.connection_name === "ordinary")!
  expect(ordinaryJoin.route.filter((p) => p.route_type === "via")).toHaveLength(
    2,
  )
  const report = busLengthReports(result.native, joined)[0]
  expect(report.aboveMinimumLength).toBe(true)
  expect(report.withinLengthLimit).toBe(true)
  expect(report.matched).toBe(true)
  expect(
    result.pending.connections.find((c) => c.name === "ordinary")!
      .pointsToConnect,
  ).toEqual([ordinary.route[0], ordinary.route.at(-1)!] as Wire[])
})

test("failed constrained restoration and cancellation leave the frozen checkpoint unchanged", () => {
  const state = fixture()
  state.native.buses![0].maxLength = 0.9
  const original = structuredClone(state)
  expect(
    finish(insertSurfaceSignal(state, "control", { maxReleasedCandidates: 1 })),
  ).toBeNull()
  expect(state).toEqual(original)
  const search = insertSurfaceSignal(state, "control", {
    maxReleasedCandidates: 1,
  })
  expect(search.next().done).toBe(false)
  expect(search.return(null).done).toBe(true)
  expect(search.next().done).toBe(true)
  expect(state).toEqual(original)
})
