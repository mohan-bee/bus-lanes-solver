import { expect, test } from "bun:test"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})
const line = (name: string, points: Wire[]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: `trace_${name}`,
  connection_name: name,
  source_trace_id: name,
  route: points,
})
const finish = <T>(generator: Generator<unknown, T>): T => {
  let next = generator.next(),
    steps = 0
  try {
    while (!next.done && steps++ < 15000) next = generator.next()
    expect(next.done).toBe(true)
    if (!next.done) throw Error("Unexpected focused-test search budget")
    return next.value
  } finally {
    if (!next.done) generator.return(undefined as T)
  }
}

function fixture(): FlexibleSignalState {
  const connection = {
    name: "A",
    source_trace_id: "native_A",
    pointsToConnect: [
      { x: -3, y: 0, layer: "top", pointId: "pad_A0" },
      { x: 3, y: 0, layer: "top", pointId: "pad_A1" },
    ],
  }
  const carrier = {
    ...line("A", [wire(-3, -1), wire(0, -1), wire(3, -1)]),
    pcb_trace_id: "existing_non_adjacent_carrier",
    source_trace_id: "native_A",
    // Existing trace metadata must survive a no-change repair.
    curvedSegments: [1],
  }
  const escapes = [-3, 3].map(
    (x, end): Trace => ({
      type: "pcb_trace",
      pcb_trace_id: `owned_non_adjacent_${end}`,
      connection_name: "A",
      source_trace_id: "native_A",
      route: [
        wire(x, 0, "top"),
        wire(x, -1, "top"),
        {
          route_type: "via",
          x,
          y: -1,
          from_layer: "top",
          to_layer: "bottom",
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        wire(x, -1),
      ],
    }),
  )
  const fixed = line("POWER", [wire(-3.8, 1.5, "top"), wire(-3.4, 1.5, "top")])
  const native: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.05,
    bounds: { minX: -4, maxX: 4, minY: -1.8, maxY: 1.8 },
    connections: [connection],
    buses: [{ busId: "A", connectionNames: ["A"], maxLength: 9 }],
    traces: [fixed],
    obstacles: [
      ...[-3, 3].flatMap((x, end) => [
        {
          componentId: `chip_${end}`,
          center: { x, y: 0 },
          width: 0.2,
          height: 0.2,
          shape: "circle" as const,
          layers: ["top"],
          connectedTo: ["A", `pad_A${end}`],
        },
        {
          componentId: `chip_${end}`,
          center: { x, y: 0.8 },
          width: 0.2,
          height: 0.2,
          shape: "circle" as const,
          layers: ["top"],
          connectedTo: [`unused_${end}`],
        },
        // The four compact via cells are unavailable. The existing site at
        // y=-1 remains clear, but compact regeneration cannot produce it.
        {
          center: { x, y: 0 },
          width: 1.6,
          height: 1.2,
          layers: ["bottom"],
          connectedTo: [],
        },
      ]),
      // No native TOP route exists across the board.
      {
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 3.6,
        layers: ["top"],
        connectedTo: [],
      },
    ],
  }
  const local = {
    ...connection,
    pointsToConnect: [carrier.route[0], carrier.route.at(-1)!] as Wire[],
  }
  return {
    native,
    pending: {
      ...native,
      connections: [local],
      traces: [...native.traces!, ...escapes],
    },
    escapes,
    retained: [],
    traces: [carrier],
  }
}

test("an existing non-adjacent site survives compact-only pocket negotiation unchanged", () => {
  const state = fixture(),
    before = structuredClone(state)
  const current = state.traces[0],
    owned = state.escapes,
    supplied = state.native.traces![0]
  const validator = BusLanesSolver.forValidation(state.pending, state.traces)
  validator.solve()
  expect(validator.solved).toBe(true)
  const result = finish(
    negotiateSignalSites(state, new Set(["A"]), false, false, {
      allowExpandedSites: false,
      retainExistingRoutes: true,
    }),
  )
  expect(result).not.toBeNull()
  expect(result!.traces).toEqual([current])
  expect(result!.traces[0]).toBe(current)
  expect(result!.escapes).toEqual(owned)
  expect(result!.escapes[0]).toBe(owned[0])
  expect(result!.pending.traces![0]).toBe(supplied)
  const joined = joinSignalEscapes(result!.traces[0], result!.escapes)
  expect(joined.route[0]).toEqual(wire(-3, 0, "top"))
  expect(joined.route.at(-1)).toEqual(wire(3, 0, "top"))
  expect(state).toEqual(before)
})

test("legacy compact negotiation retains its default fresh-route behavior", () => {
  const state = fixture(),
    before = structuredClone(state)
  expect(
    finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(before)
})

test("new hard paired copper invalidates an old carrier instead of seeding it", () => {
  const state = fixture()
  const paired = [0, 0.22].map((x, side) => ({
    ...line(side ? "N" : "P", [wire(x, -1.8), wire(x, 1.8)]),
    coupledSection: [0, 1] as [number, number],
  }))
  state.native = {
    ...state.native,
    connections: [
      ...state.native.connections,
      ...paired.map((trace) => ({
        name: trace.connection_name!,
        pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
      })),
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.12, lengthTolerance: 0.05 },
    ],
  }
  state.retained = paired
  state.pending = {
    ...state.pending,
    traces: [...state.pending.traces!, ...paired],
  }
  const before = structuredClone(state)
  const scene = new VectorScene(
    state.native,
    state.pending.connections[0],
    0.1,
    [...fixedCopper(state.native), ...paired.flatMap(routeCopper)],
  )
  expect(scene.pathVisible(state.traces[0].route)).toBe(false)
  expect(
    finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
        retainExistingRoutes: true,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(before)
  expect(state.retained).toEqual(paired)
})

test("an old non-adjacent site remains available when new paired copper requires a new carrier", () => {
  const state = fixture(),
    old = state.traces[0]
  const paired = [0, 0.22].map((x, side) => ({
    ...line(side ? "N" : "P", [wire(x, -1.4), wire(x, -0.6)]),
    coupledSection: [0, 1] as [number, number],
  }))
  state.native = {
    ...state.native,
    connections: [
      ...state.native.connections,
      ...paired.map((trace) => ({
        name: trace.connection_name!,
        pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
      })),
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.12, lengthTolerance: 0.05 },
    ],
  }
  state.retained = paired
  state.pending = {
    ...state.pending,
    traces: [...state.pending.traces!, ...paired],
  }
  const before = structuredClone(state)
  const scene = new VectorScene(
    state.native,
    state.pending.connections[0],
    0.1,
    [...fixedCopper(state.native), ...paired.flatMap(routeCopper)],
  )
  expect(scene.pathVisible(old.route)).toBe(false)
  const result = finish(
    negotiateSignalSites(state, new Set(["A"]), false, false, {
      allowExpandedSites: false,
      retainExistingRoutes: true,
    }),
  )
  expect(result).not.toBeNull()
  expect(result!.traces[0]).not.toBe(old)
  expect(result!.traces[0].route).not.toEqual(old.route)
  expect(scene.pathVisible(result!.traces[0].route)).toBe(true)
  expect(result!.escapes).toEqual(state.escapes)
  expect(result!.escapes[0]).toBe(state.escapes[0])
  expect(result!.retained).toEqual(paired)
  expect(state).toEqual(before)
})

test("a blocked native escape is rejected even when the existing carrier remains clear", () => {
  const state = fixture()
  const block = line("NEW_POWER", [
    wire(-3.6, -0.5, "top"),
    wire(-2.4, -0.5, "top"),
  ])
  state.native = { ...state.native, traces: [...state.native.traces!, block] }
  const before = structuredClone(state)
  const scene = new VectorScene(
    state.native,
    state.pending.connections[0],
    0.1,
    fixedCopper(state.native),
  )
  expect(scene.pathVisible(state.traces[0].route)).toBe(true)
  expect(
    finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
        retainExistingRoutes: true,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(before)
})

test("a drill-only hard conflict invalidates an otherwise clear existing site", () => {
  const state = fixture()
  const block: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "new_fixed_drill",
    connection_name: "POWER_DRILL",
    route: [
      {
        route_type: "via",
        x: -3.34,
        y: -1,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.2,
        via_hole_diameter: 0.15,
      },
    ],
  }
  state.native = {
    ...state.native,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.2,
    traces: [...state.native.traces!, block],
  }
  const before = structuredClone(state)
  expect(
    new CopperConflictIndex().firstConflict(
      fixedCopper({ ...state.native, obstacles: [], traces: state.escapes }),
      fixedCopper({ ...state.native, obstacles: [], traces: [block] }),
      0.05 - 1e-8,
    ),
  ).toBeUndefined()
  expect(
    generatedEscapeHolesConflict(state.native, state.escapes, [block]),
  ).toBe(true)
  expect(
    finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
        retainExistingRoutes: true,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(before)
})

for (const restricted of ["layer", "length"] as const)
  test(`an existing route that violates the current ${restricted} rule is not seeded`, () => {
    const state = fixture()
    state.native =
      restricted === "layer"
        ? { ...state.native, allowedLayers: ["top"] }
        : {
            ...state.native,
            buses: [{ ...state.native.buses![0], maxLength: 7.9 }],
          }
    const before = structuredClone(state)
    expect(
      finish(
        negotiateSignalSites(state, new Set(["A"]), false, false, {
          allowExpandedSites: false,
          retainExistingRoutes: true,
        }),
      ),
    ).toBeNull()
    expect(state).toEqual(before)
  })

test("owned wires cannot change layers without an explicit via handoff", () => {
  const state = fixture()
  state.escapes = state.escapes.map((escape) => ({
    ...escape,
    route: escape.route.filter((point) => point.route_type !== "via"),
  }))
  state.pending = {
    ...state.pending,
    traces: [...state.native.traces!, ...state.escapes],
  }
  const before = structuredClone(state)
  expect(
    finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
        retainExistingRoutes: true,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(before)
})

test("an owned via requires a declared physical span, coincident layer handoffs, and physical dimensions", () => {
  const mutations: Array<[string, (escape: Trace) => void]> = [
    [
      "implicit span",
      (escape) => {
        delete (escape.route[2] as any).layers
      },
    ],
    [
      "incomplete through span",
      (escape) => {
        ;(escape.route[2] as any).layers = ["top", "inner1", "bottom"]
      },
    ],
    [
      "wrong native layer",
      (escape) => {
        ;(escape.route[2] as any).from_layer = "inner1"
      },
    ],
    [
      "wrong carrier layer",
      (escape) => {
        ;(escape.route[2] as any).to_layer = "inner1"
      },
    ],
    [
      "uncoincident native handoff",
      (escape) => {
        escape.route[1] = { ...escape.route[1], x: -3.01 }
      },
    ],
    [
      "uncoincident carrier handoff",
      (escape) => {
        escape.route.splice(3, 0, wire(-3.01, -1))
      },
    ],
    [
      "nonpositive land",
      (escape) => {
        ;(escape.route[2] as any).via_diameter = 0
      },
    ],
    [
      "nonfinite drill",
      (escape) => {
        ;(escape.route[2] as any).via_hole_diameter = NaN
      },
    ],
  ]
  for (const [label, mutate] of mutations) {
    const state = fixture()
    state.escapes = structuredClone(state.escapes)
    mutate(state.escapes[0])
    state.pending = {
      ...state.pending,
      traces: [...state.native.traces!, ...state.escapes],
    }
    const before = structuredClone(state)
    const result = finish(
      negotiateSignalSites(state, new Set(["A"]), false, false, {
        allowExpandedSites: false,
        retainExistingRoutes: true,
      }),
    )
    if (result !== null)
      throw Error(`Unsafe owned escape was retained: ${label}`)
    expect(result).toBeNull()
    expect(state).toEqual(before)
  }
})
