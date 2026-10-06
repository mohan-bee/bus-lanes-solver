import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { surfaceOrdinaryPlanningInput } from "../lib/route-fresh-surface-buses"
import { routeFinishedSurfacePairs } from "../lib/route-finished-surface-pairs"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { routeSurfaceBridge } from "../lib/route-surface-bridge"
import { VectorScene, fixedCopper } from "../lib/vector-scene"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import type { SimpleRouteJson, Wire } from "../lib/types"
const wire = (x: number, y: number): Wire => ({
  x,
  y,
  layer: "top",
  width: 0.1,
  route_type: "wire",
})
function fixture(): SimpleRouteJson {
  return {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
    obstacles: [-2, 2].flatMap((x, end) =>
      ["P", "N"].map((name, index) => ({
        type: "rect" as const,
        shape: "circle" as const,
        componentId: `package_${end}`,
        center: { x, y: index ? -0.15 : 0.15 },
        width: 0.12,
        height: 0.12,
        layers: ["top"],
        connectedTo: [name],
      })),
    ),
    traces: [],
    connections: [
      { name: "P", pointsToConnect: [wire(-2, 0.15), wire(2, 0.15)] },
      { name: "N", pointsToConnect: [wire(-2, -0.15), wire(2, -0.15)] },
    ],
    buses: [
      {
        busId: "timed",
        connectionNames: ["P", "N"],
        allowedLayers: ["top", "bottom"],
        minLength: 4.3,
        maxLength: 5,
        maxLengthSkew: 0.01,
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.2, lengthTolerance: 0.01 },
    ],
  }
}
function finish<T>(work: Generator<void, T>): T {
  let next = work.next(),
    count = 0
  while (!next.done && count++ < 20000) next = work.next()
  if (!next.done) {
    work.return(null as T)
    throw Error("Prefix test work exceeded")
  }
  return next.value
}
test("surface paired prefixes reserve finite timing growth and restore native constraints with their complete owned tuple", () => {
  const native = fixture(),
    original = structuredClone(native)
  const result = finish(
    routeFinishedSurfacePairs(native, native, [], {
      anchorToFiniteCaps: true,
      solverOptions: { smoothTuning: true, denseSearch: true },
      maxStepsPerSearch: 250,
    }),
  )!
  expect(result).toBeTruthy()
  expect(native).toEqual(original)
  expect(result.native).toBe(native)
  const joined = result.retained.map((trace) =>
    joinSignalEscapes(
      trace,
      result.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  expect(joined).toHaveLength(2)
  expect(result.pending.buses).toEqual(original.buses)
  expect(
    busLengthReports(native, joined).every(
      (report) =>
        report.matched && report.aboveMinimumLength && report.withinLengthLimit,
    ),
  ).toBe(true)
  expect(
    Math.min(
      ...busLengthReports(native, joined)[0].lengths.map(
        (item) => item.totalLengthMm!,
      ),
    ),
  ).toBeGreaterThanOrEqual(4.99 - 1e-8)
  expect(
    pairLengthReports(native, joined).every((report) => report.matched),
  ).toBe(true)
  expect(
    exteriorPairSpacingReports(native, joined).every(
      (report) => report.applicable && report.matched,
    ),
  ).toBe(true)
  const drc = validateRoutedCopperDrc({
    inputSrj: native,
    routedSrj: { ...native, traces: joined },
    clearance: 0.05,
    allowBlindAndBuriedVias: false,
  } as Parameters<typeof validateRoutedCopperDrc>[0])
  expect(drc.issues).toEqual([])
})
test("cancelled paired-prefix enumeration leaves caller input and owned copper unchanged", () => {
  const native = fixture(),
    original = structuredClone(native),
    work = routeFinishedSurfacePairs(native, native, [])
  work.next()
  work.return(null)
  expect(native).toEqual(original)
})

test("a native clear path survives a coarse lookahead grid that misses its narrow corridor", () => {
  const native = fixture()
  native.bounds = { minX: -4, maxX: 4, minY: -0.675, maxY: 3 }
  for (const connection of native.connections)
    for (const point of connection.pointsToConnect) point.y += 2
  for (const obstacle of native.obstacles) obstacle.center.y += 2
  native.connections.push({
    name: "control",
    pointsToConnect: [wire(-1, 0), wire(1, 0)],
  })
  native.obstacles.push(
    ...[-1, 1].map((sign) => ({
      type: "rect" as const,
      center: { x: 0, y: sign * 0.38755 },
      width: 4,
      height: 0.5749,
      layers: ["top", "inner1", "inner2", "bottom"],
      connectedTo: [],
    })),
  )
  const connection = native.connections[2]
  const scene = new VectorScene(native, connection, 0.1, fixedCopper(native))
  expect(scene.pathVisible(connection.pointsToConnect)).toBe(true)
  expect(finish(routeSurfaceBridge(native, connection))).toBeNull()
  const original = structuredClone(native)
  const prefix = finish(
    routeFinishedSurfacePairs(native, native, [], {
      maxStepsPerSearch: 250,
      maxReachabilityExpansions: 1,
    }),
  )!
  expect(prefix).toBeTruthy()
  expect(prefix.retained).toHaveLength(2)
  expect(prefix.pending.connections).toEqual([connection])
  expect(native).toEqual(original)
})

test("a definitive native length impossibility stays rejected below one lookahead yield", () => {
  const native = fixture()
  native.connections.push({
    name: "control",
    pointsToConnect: [wire(0, -2), wire(0, 2)],
  })
  native.buses!.push({
    busId: "short-control",
    connectionNames: ["control"],
    maxLength: 3,
  })
  const original = structuredClone(native)
  expect(
    finish(
      routeFinishedSurfacePairs(native, native, [], {
        maxStepsPerSearch: 250,
        maxReachabilityExpansions: 1,
      }),
    ),
  ).toBeNull()
  expect(native).toEqual(original)
})

test("a finished prefix is rejected when it seals a remaining native-layer corridor", () => {
  const native = fixture()
  native.bounds = { minX: -2.15, maxX: 2.15, minY: -3, maxY: 3 }
  native.connections.push({
    name: "control",
    pointsToConnect: [wire(0, -2), wire(0, 2)],
  })
  native.buses!.push({
    busId: "native-only",
    connectionNames: ["control"],
    allowedLayers: ["top"],
    maxLength: 10,
  })
  const original = structuredClone(native),
    connection = native.connections[2]
  const before = new GridVisibilitySearch(
    new VectorScene(native, connection, 0.1, fixedCopper(native)),
    connection.pointsToConnect[0],
    connection.pointsToConnect[1],
    [],
    4,
    undefined,
    { allTerminalAttachments: true, checkReachability: true },
  )
  try {
    while (!before.solved && !before.failed && before.expanded < 10000)
      before.step()
    expect(before.solved).toBe(true)
  } finally {
    before.cancel()
  }
  expect(
    finish(
      routeFinishedSurfacePairs(native, native, [], {
        anchorToFiniteCaps: true,
        solverOptions: { smoothTuning: true, denseSearch: true },
        maxStepsPerSearch: 2000,
        maxReachabilityExpansions: 10000,
      }),
    ),
  ).toBeNull()
  expect(native).toEqual(original)
})

test("supplied copper owners are admitted only to the audit and their manufactured via is not an invented endpoint", () => {
  const native = fixture()
  native.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "native-power",
      source_trace_id: "supply",
      route: [
        wire(-3, -2),
        wire(-2.8, -2),
        {
          route_type: "via",
          x: -2.8,
          y: -2,
          from_layer: "top",
          to_layer: "bottom",
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        { ...wire(-2.8, -2), layer: "bottom" },
        { ...wire(-2.6, -2), layer: "bottom" },
      ],
    },
  ]
  const original = structuredClone(native)
  const result = finish(
    routeFinishedSurfacePairs(native, native, [], {
      anchorToFiniteCaps: true,
      maxStepsPerSearch: 250,
    }),
  )!
  expect(result).toBeTruthy()
  expect(native).toEqual(original)
  expect(
    result.native.connections.map((connection) => connection.name),
  ).toEqual(["P", "N"])
  expect(result.pending.traces![0]).toBe(native.traces[0])
  expect(result.native.traces).toEqual(original.traces)
})
test("absolute pair bus bounds without a bus skew still finish under the original pair tolerance", () => {
  const native = fixture()
  delete native.buses![0].maxLengthSkew
  const result = finish(
    routeFinishedSurfacePairs(native, native, [], { maxStepsPerSearch: 2000 }),
  )!
  expect(result).toBeTruthy()
  const joined = result.retained.map((trace) =>
    joinSignalEscapes(
      trace,
      result.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  expect(
    busLengthReports(native, joined).every(
      (report) => report.aboveMinimumLength && report.withinLengthLimit,
    ),
  ).toBe(true)
  expect(pairLengthReports(native, joined)[0].matched).toBe(true)
})

test("native positive floors provide an alternative legal domain without forcing further paired growth", () => {
  const native = fixture(),
    original = structuredClone(native)
  const prefix = finish(
    routeFinishedSurfacePairs(native, native, [], {
      anchorToFiniteCaps: true,
      preferNativePositiveMinimum: true,
      maxStepsPerSearch: 250,
    }),
  )!
  expect(prefix).toBeTruthy()
  const joined = prefix.retained.map((trace) =>
    joinSignalEscapes(
      trace,
      prefix.escapes.filter(
        (escape) => escape.connection_name === trace.connection_name,
      ),
    ),
  )
  const report = busLengthReports(native, joined)[0]
  expect(
    Math.min(...report.lengths.map((item) => item.totalLengthMm!)),
  ).toBeCloseTo(4.3, 6)
  const planning = surfaceOrdinaryPlanningInput(native, prefix)!
  expect(planning).toBeTruthy()
  expect(planning.buses![0].maxLength).toBeCloseTo(4.31, 6)
  expect(planning.buses![0].minLength).toBe(native.buses![0].minLength)
  expect(planning.buses![0].maxLengthSkew).toBe(native.buses![0].maxLengthSkew)
  expect(planning.connections).toBe(native.connections)
  expect(planning.traces).toBe(native.traces)
  expect(native).toEqual(original)
  expect(
    surfaceOrdinaryPlanningInput(native, {
      ...prefix,
      retained: prefix.retained.slice(1),
    }),
  ).toBeNull()
})

test("bounded surface lookahead remains provisional and does not discard a manufactured paired prefix", () => {
  const native = fixture()
  native.connections.push({
    name: "control",
    pointsToConnect: [wire(0, -2), wire(0, 2)],
  })
  const original = structuredClone(native)
  const allocation = {
    ...native,
    connections: native.connections.map((connection) =>
      connection.name === "control"
        ? { ...connection, pointsToConnect: [wire(0.5, -2), wire(0.5, 2)] }
        : connection,
    ),
  }
  const prefix = finish(
    routeFinishedSurfacePairs(native, allocation, [], {
      anchorToFiniteCaps: true,
      maxStepsPerSearch: 250,
      maxReachabilityExpansions: 1,
    }),
  )!
  expect(prefix).toBeTruthy()
  expect(prefix.retained).toHaveLength(2)
  expect(prefix.retained.length).toBeLessThan(native.connections.length)
  expect(prefix.pending.connections).toEqual([native.connections[2]])
  expect(native).toEqual(original)
})
