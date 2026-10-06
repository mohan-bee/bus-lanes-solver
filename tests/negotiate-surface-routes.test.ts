import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { negotiateSurfaceRoutes } from "../lib/negotiate-surface-routes"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { surfaceBridgeSelfShorts } from "../lib/route-surface-bridge"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, width = 0.1): Wire => ({
  x,
  y,
  width,
  layer: "top",
  route_type: "wire",
})
const trace = (name: string, route: Trace["route"]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: `trace_${name}`,
  source_trace_id: name,
  connection_name: name,
  route,
})

function fixture() {
  const connections = [
      {
        name: "ordinary",
        pointsToConnect: [wire(-2, 0, 0.12), wire(2, 0, 0.12)],
      },
      { name: "control", pointsToConnect: [wire(0, -1.5), wire(0, 1.5)] },
      { name: "P", pointsToConnect: [wire(-2, 2.6), wire(2, 2.6)] },
      { name: "N", pointsToConnect: [wire(-2, 2.3), wire(2, 2.3)] },
    ],
    paired = connections.slice(2).map((connection) => ({
      ...trace(connection.name, connection.pointsToConnect),
      coupledSection: [0, 1] as [number, number],
    })),
    power = trace("power", [
      wire(-2.5, -2.5),
      wire(-2.2, -2.2),
      {
        x: -2.2,
        y: -2.2,
        route_type: "via",
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { ...wire(-2.2, -2.2), layer: "bottom" },
      { ...wire(-1.9, -2.2), layer: "bottom" },
    ]),
    native: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.05,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
      minBoardEdgeClearance: 0.05,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [],
      connections,
      traces: [power],
      differentialPairs: [
        { connectionNames: ["P", "N"], traceGap: 0.2, lengthTolerance: 0.01 },
      ],
      buses: [
        {
          busId: "ordinary_bus",
          connectionNames: ["ordinary"],
          allowedLayers: ["top"],
          traceWidth: 0.12,
          maxLength: 10,
        },
      ],
    },
    ordinary = trace("ordinary", connections[0].pointsToConnect),
    state: FlexibleSignalState = {
      native,
      pending: { ...native, traces: [power, ...paired] },
      escapes: [],
      retained: paired,
      traces: [ordinary],
    }
  return { native, state, paired, power }
}

function finish<T>(search: Generator<void, T>) {
  let next = search.next(),
    work = 0
  while (!next.done && work++ < 100000) next = search.next()
  if (!next.done) {
    search.return(undefined as T)
    throw Error("Surface negotiation exceeded the test work bound")
  }
  return next.value
}

test("whole surface candidate negotiation restores crossing ordinary signals while paired and supplied copper stay immutable", () => {
  const { native, state, paired, power } = fixture(),
    original = structuredClone(state),
    result = finish(
      negotiateSurfaceRoutes(native, state, {
        maxRounds: 30,
        maxExpansions: 20000,
        maxInitialExpansions: 40000,
        maxClosureExpansions: 40000,
      }),
    )!
  expect(result).toBeTruthy()
  expect(state).toEqual(original)
  expect(result.native).toBe(native)
  expect(native.traces).toEqual([power])
  expect(result.retained).toEqual(paired)
  const all = [...result.retained, ...result.traces],
    joined = all.map((carrier) =>
      joinSignalEscapes(
        carrier,
        result.escapes.filter(
          (escape) => escape.connection_name === carrier.connection_name,
        ),
      ),
    ),
    drcInput = {
      ...native,
      connections: [
        ...native.connections,
        {
          name: "power",
          pointsToConnect: [power.route[0], power.route.at(-1)!] as Wire[],
        },
      ],
    },
    drc = validateRoutedCopperDrc({
      inputSrj: drcInput,
      routedSrj: { ...drcInput, traces: [...native.traces!, ...joined] },
      clearance: native.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(all).toHaveLength(native.connections.length)
  expect(new Set(all.map((carrier) => carrier.connection_name)).size).toBe(4)
  expect(drc.valid).toBe(true)
  expect(drc.issues).toEqual([])
  const ordinary = joined.find((trace) => trace.connection_name === "ordinary")!
  expect(
    ordinary.route.every(
      (point) =>
        point.route_type === "wire" &&
        point.layer === "top" &&
        point.width === 0.12,
    ),
  ).toBe(true)
  for (const connection of native.connections) {
    const route = joined.find(
      (trace) => trace.connection_name === connection.name,
    )!
    expect(route.route[0].x).toBe(connection.pointsToConnect[0].x)
    expect(route.route[0].y).toBe(connection.pointsToConnect[0].y)
    expect(route.route.at(-1)!.x).toBe(connection.pointsToConnect[1].x)
    expect(route.route.at(-1)!.y).toBe(connection.pointsToConnect[1].y)
    expect(surfaceBridgeSelfShorts(native, connection, route)).toBe(false)
  }
  expect(result.pending.buses).toEqual(native.buses)
  expect(result.pending.differentialPairs).toEqual(native.differentialPairs)
})

test("cancelled or exhausted surface negotiation leaves its physical checkpoint unchanged", () => {
  const { native, state } = fixture(),
    original = structuredClone(state),
    search = negotiateSurfaceRoutes(native, state)
  expect(search.next().done).toBe(false)
  search.return(null)
  expect(state).toEqual(original)
  expect(
    finish(
      negotiateSurfaceRoutes(native, state, {
        maxExpansions: 0,
        maxInitialExpansions: 0,
        maxClosureExpansions: 0,
      }),
    ),
  ).toBeNull()
  expect(state).toEqual(original)
})

test("frozen timed members retain their entire routed copper while untimed signals negotiate around them", () => {
  const { native, state } = fixture(),
    original = structuredClone(state),
    result = finish(
      negotiateSurfaceRoutes(native, state, {
        frozenConnectionNames: new Set(["ordinary"]),
        maxRounds: 10,
        maxExpansions: 40000,
        maxInitialExpansions: 80000,
      }),
    )!
  expect(result).toBeTruthy()
  expect(state).toEqual(original)
  expect(result.native).toBe(native)
  expect(
    result.retained.find((trace) => trace.connection_name === "ordinary"),
  ).toBe(state.traces[0])
  expect(result.traces.map((trace) => trace.connection_name)).toEqual([
    "control",
  ])
  const joined = [...result.retained, ...result.traces].map((trace) =>
      joinSignalEscapes(
        trace,
        result.escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      ),
    ),
    power = native.traces![0],
    input = {
      ...native,
      connections: [
        ...native.connections,
        {
          name: "power",
          pointsToConnect: [power.route[0], power.route.at(-1)!] as Wire[],
        },
      ],
    },
    drc = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [...native.traces!, ...joined] },
      clearance: native.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.valid).toBe(true)
  expect(drc.issues).toEqual([])
  expect(result.pending.buses).toEqual(native.buses)
  expect(result.pending.differentialPairs).toEqual(native.differentialPairs)
})

test("a previous ordinary candidate crossing newly frozen copper is searched again", () => {
  const { native, state } = fixture()
  state.traces.push(
    trace("control", native.connections[1].pointsToConnect as Wire[]),
  )
  const original = structuredClone(state),
    result = finish(
      negotiateSurfaceRoutes(native, state, {
        frozenConnectionNames: new Set(["ordinary"]),
        maxRounds: 0,
        maxExpansions: 40000,
        maxInitialExpansions: 80000,
      }),
    )!
  expect(result).toBeTruthy()
  expect(state).toEqual(original)
  expect(
    result.retained.find((trace) => trace.connection_name === "ordinary"),
  ).toBe(state.traces[0])
  const joined = [...result.retained, ...result.traces].map((carrier) =>
      joinSignalEscapes(
        carrier,
        result.escapes.filter(
          (escape) => escape.connection_name === carrier.connection_name,
        ),
      ),
    ),
    power = native.traces![0],
    input = {
      ...native,
      connections: [
        ...native.connections,
        {
          name: "power",
          pointsToConnect: [power.route[0], power.route.at(-1)!] as Wire[],
        },
      ],
    },
    drc = validateRoutedCopperDrc({
      inputSrj: input,
      routedSrj: { ...input, traces: [...native.traces!, ...joined] },
      clearance: native.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.valid).toBe(true)
  expect(drc.issues).toEqual([])
})

test.each([0, 1e-6])(
  "a previous via within native endpoint tolerance (%d mm) is replaced before surface negotiation accepts it",
  (offset) => {
    const { native, state } = fixture(),
      bottom = (x: number, y: number): Wire => ({
        ...wire(x, y),
        layer: "bottom",
      }),
      via = (x: number, y: number) => ({
        route_type: "via" as const,
        x,
        y,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      }),
      illegal = trace("control", [bottom(offset, -1.5), bottom(offset, 1.2)])
    state.traces.push(illegal)
    state.escapes.push(
      {
        ...trace("control", [
          wire(0, -1.5),
          wire(offset, -1.5),
          via(offset, -1.5),
          bottom(offset, -1.5),
        ]),
        pcb_trace_id: "control_start",
      },
      {
        ...trace("control", [
          wire(0, 1.5),
          wire(offset, 1.5),
          wire(offset, 1.2),
          via(offset, 1.2),
          bottom(offset, 1.2),
        ]),
        pcb_trace_id: "control_goal",
      },
    )
    const original = structuredClone(state),
      result = finish(
        negotiateSurfaceRoutes(native, state, {
          frozenConnectionNames: new Set(["ordinary"]),
          maxRounds: 0,
          maxExpansions: 40000,
          maxInitialExpansions: 80000,
        }),
      )!
    expect(result).toBeTruthy()
    expect(state).toEqual(original)
    expect(result.traces[0]).not.toBe(illegal)
    const joined = [...result.retained, ...result.traces].map((carrier) =>
        joinSignalEscapes(
          carrier,
          result.escapes.filter(
            (escape) => escape.connection_name === carrier.connection_name,
          ),
        ),
      ),
      power = native.traces![0],
      input = {
        ...native,
        connections: [
          ...native.connections,
          {
            name: "power",
            pointsToConnect: [power.route[0], power.route.at(-1)!] as Wire[],
          },
        ],
      },
      drc = validateRoutedCopperDrc({
        inputSrj: input,
        routedSrj: { ...input, traces: [...native.traces!, ...joined] },
        clearance: native.minTraceToPadEdgeClearance!,
        allowBlindAndBuriedVias: false,
      } as Parameters<typeof validateRoutedCopperDrc>[0])
    expect(drc.valid).toBe(true)
    expect(drc.issues).toEqual([])
    expect(
      joined.every((trace) =>
        trace.route.every(
          (point) =>
            point.route_type !== "via" ||
            native.connections.every((connection) =>
              connection.pointsToConnect.every(
                (terminal) =>
                  Math.hypot(point.x - terminal.x, point.y - terminal.y) > 1e-6,
              ),
            ),
        ),
      ),
    ).toBe(true)
  },
)

test("an untimed surface route can cross alternating plane barriers using four manufactured transitions", () => {
  const native: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.05,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
      minBoardEdgeClearance: 0.05,
      bounds: { minX: -4, maxX: 4, minY: -0.7, maxY: 0.7 },
      connections: [
        { name: "control", pointsToConnect: [wire(-3, 0), wire(3, 0)] },
      ],
      obstacles: [-1.5, 0, 1.5].map((x, index) => ({
        type: "rect",
        center: { x, y: 0 },
        width: 0.2,
        height: 2,
        layers: [index === 1 ? "bottom" : "top"],
        connectedTo: [],
      })),
    },
    state: FlexibleSignalState = {
      native,
      pending: native,
      escapes: [],
      retained: [],
      traces: [],
    },
    original = structuredClone(state),
    settings = {
      maxRounds: 0,
      maxExpansions: 40000,
      maxInitialExpansions: 80000,
    }
  expect(
    finish(
      negotiateSurfaceRoutes(native, state, { ...settings, maxUntimedVias: 2 }),
    ),
  ).toBeNull()
  const result = finish(negotiateSurfaceRoutes(native, state, settings))!,
    carrier = result.traces[0],
    joined = joinSignalEscapes(carrier, result.escapes),
    vias = joined.route.filter((point) => point.route_type === "via"),
    drc = validateRoutedCopperDrc({
      inputSrj: native,
      routedSrj: { ...native, traces: [joined] },
      clearance: native.minTraceToPadEdgeClearance!,
      allowBlindAndBuriedVias: false,
    } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(state).toEqual(original)
  expect(vias).toHaveLength(4)
  expect(carrier.route.every((point) => point.route_type === "wire")).toBe(true)
  expect(drc.valid).toBe(true)
  expect(drc.issues).toEqual([])
  expect(surfaceBridgeSelfShorts(native, native.connections[0], joined)).toBe(
    false,
  )
  expect(
    joined.route
      .filter((point) => point.route_type === "wire")
      .every((point) => ["top", "bottom"].includes(point.layer)),
  ).toBe(true)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
    expect(via.via_diameter).toBe(0.3)
    expect(via.via_hole_diameter).toBe(0.15)
  }
})

test("bounded atomic surface repairs resolve a five-net star while retaining supplied copper and the checkpoint", () => {
  const connections = [
    { name: "hub", pointsToConnect: [wire(0, -2), wire(0, 2)] },
    ...[-1.2, -0.4, 0.4, 1.2].map((y, index) => ({
      name: `leaf_${index}`,
      pointsToConnect: [wire(-2, y), wire(2, y)],
    })),
  ]
  const power = trace("power", [
    wire(-1.9, -1.9),
    wire(-1.7, -1.7),
    {
      route_type: "via",
      x: -1.7,
      y: -1.7,
      from_layer: "top",
      to_layer: "bottom",
      layers: ["top", "inner1", "inner2", "bottom"],
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    },
    { ...wire(-1.7, -1.7), layer: "bottom" },
    { ...wire(-1.5, -1.7), layer: "bottom" },
  ])
  const native: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.05,
    bounds: { minX: -2.15, maxX: 2.15, minY: -2.15, maxY: 2.15 },
    obstacles: [],
    connections,
    traces: [power],
  }
  const routes = connections.map((connection) =>
    trace(connection.name, connection.pointsToConnect),
  )
  const state: FlexibleSignalState = {
    native,
    pending: native,
    escapes: [],
    retained: [],
    traces: routes,
  }
  const original = structuredClone(state),
    originalPower = structuredClone(power)
  const drcInput = {
    ...native,
    connections: [
      ...native.connections,
      {
        name: "power",
        pointsToConnect: [power.route[0], power.route.at(-1)!] as Wire[],
      },
    ],
  }
  const initialDrc = validateRoutedCopperDrc({
    inputSrj: drcInput,
    routedSrj: { ...drcInput, traces: [...native.traces!, ...routes] },
    clearance: native.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(initialDrc.valid).toBe(false)
  const result = finish(
    negotiateSurfaceRoutes(native, state, {
      maxRounds: 0,
      maxClosureSize: 3,
      maxUntimedVias: 2,
      maxInitialExpansions: 40000,
      maxExpansions: 40000,
      maxClosureExpansions: 80000,
    }),
  )
  expect(state).toEqual(original)
  expect(native.traces).toEqual([originalPower])
  expect(native.traces![0]).toBe(power)
  expect(result).toBeTruthy()
  if (!result) return
  expect(result.native).toBe(native)
  expect(result.retained).toEqual([])
  expect(result.traces).toHaveLength(5)
  const joined = result.traces.map((carrier) =>
    joinSignalEscapes(
      carrier,
      result.escapes.filter(
        (escape) => escape.connection_name === carrier.connection_name,
      ),
    ),
  )
  expect(new Set(joined.map((route) => route.connection_name)).size).toBe(5)
  expect(routeAnglesAreConventional(joined)).toBe(true)
  const drc = validateRoutedCopperDrc({
    inputSrj: drcInput,
    routedSrj: { ...drcInput, traces: [...native.traces!, ...joined] },
    clearance: native.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.valid).toBe(true)
  expect(drc.issues).toEqual([])
  const vias = joined.flatMap((route) =>
    route.route.filter((point) => point.route_type === "via"),
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
    expect(via.via_diameter).toBe(0.3)
    expect(via.via_hole_diameter).toBe(0.15)
  }
  for (const carrier of result.traces) {
    expect(carrier.route.every((point) => point.route_type === "wire")).toBe(
      true,
    )
    expect(
      new Set(carrier.route.map((point) => (point as Wire).layer)).size,
    ).toBe(1)
  }
  for (const connection of native.connections) {
    const route = joined.find(
      (candidate) => candidate.connection_name === connection.name,
    )!
    expect(route.route[0].x).toBe(connection.pointsToConnect[0].x)
    expect(route.route[0].y).toBe(connection.pointsToConnect[0].y)
    expect((route.route[0] as Wire).layer).toBe("top")
    expect(route.route.at(-1)!.x).toBe(connection.pointsToConnect[1].x)
    expect(route.route.at(-1)!.y).toBe(connection.pointsToConnect[1].y)
    expect((route.route.at(-1)! as Wire).layer).toBe("top")
    expect(surfaceBridgeSelfShorts(native, connection, route)).toBe(false)
    expect(
      route.route
        .filter((point) => point.route_type === "wire")
        .every((point) => ["top", "bottom"].includes(point.layer)),
    ).toBe(true)
  }
})

test("four-via timed surface routing requires an explicit opt-in and preserves the native length cap", () => {
  const native: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.15,
    minBoardEdgeClearance: 0.05,
    bounds: { minX: -4, maxX: 4, minY: -0.7, maxY: 0.7 },
    connections: [
      { name: "timed", pointsToConnect: [wire(-3, 0), wire(3, 0)] },
    ],
    buses: [
      {
        busId: "limited",
        connectionNames: ["timed"],
        allowedLayers: ["top", "bottom"],
        maxLength: 8,
      },
    ],
    obstacles: [-1.5, 0, 1.5].map((x, index) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 0.2,
      height: 2,
      layers: [index === 1 ? "bottom" : "top"],
      connectedTo: [],
    })),
  }
  const state: FlexibleSignalState = {
      native,
      pending: native,
      escapes: [],
      retained: [],
      traces: [],
    },
    original = structuredClone(state)
  const settings = {
    maxRounds: 0,
    maxExpansions: 40000,
    maxInitialExpansions: 80000,
    maxClosureExpansions: 40000,
  }
  expect(finish(negotiateSurfaceRoutes(native, state, settings))).toBeNull()
  const result = finish(
    negotiateSurfaceRoutes(native, state, { ...settings, maxTimedVias: 4 }),
  )!
  expect(result).toBeTruthy()
  expect(finish(negotiateSurfaceRoutes(native, result, settings))).toBeNull()
  const joined = joinSignalEscapes(result.traces[0], result.escapes)
  const report = validateRoutedCopperDrc({
    inputSrj: native,
    routedSrj: { ...native, traces: [joined] },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(report.issues).toEqual([])
  expect(
    joined.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(4)
  expect(result.pending.buses).toEqual(native.buses)
  expect(state).toEqual(original)
  expect(surfaceBridgeSelfShorts(native, native.connections[0], joined)).toBe(
    false,
  )
  const length = joined.route
    .slice(1)
    .reduce(
      (total, point, index) =>
        total +
        Math.hypot(
          point.x - joined.route[index].x,
          point.y - joined.route[index].y,
        ),
      0,
    )
  expect(length).toBeLessThanOrEqual(8)
  const tooShort = {
    ...native,
    buses: [{ ...native.buses![0], maxLength: 5.9 }],
  }
  expect(
    finish(
      negotiateSurfaceRoutes(
        tooShort,
        { ...state, native: tooShort, pending: tooShort },
        { ...settings, maxTimedVias: 4 },
      ),
    ),
  ).toBeNull()
})
