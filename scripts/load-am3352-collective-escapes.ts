import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { planSharedPairCorridors } from "../lib/plan-shared-pair-corridors"
import { repairSurfacePairEscape } from "../lib/repair-surface-pair-escape"
import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

let cached: FlexibleSignalState | undefined

/** Recreate the native hard-length case from the existing public full-DDR
 * fixture. All geometry is board-world XY mm, +X right/+Y up. Generate owned
 * copper at runtime; never load a captured intermediate routing state. */
export function loadAm3352CollectiveEscapes(): FlexibleSignalState {
  if (cached) return structuredClone(cached)
  let native: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../tests/fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  for (const bus of native.buses ?? []) {
    const longest = Math.max(
      ...native.connections
        .filter((connection) => bus.connectionNames.includes(connection.name))
        .map((connection) => {
          const [a, b] = connection.pointsToConnect
          return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
        }),
    )
    delete bus.minLength
    bus.maxLength = longest
    if (bus.busId === "DDR_ADDR_CTRL_CK") {
      bus.minLength = longest + 7.62 - 1.27
      bus.maxLength = longest + 7.62 + 1.27
    }
  }
  // Inspect the pipeline's fresh allocation once, rather than duplicating its
  // layer preferences and local dogbone policy in fixture preparation.
  const pipeline = new BusLanesPipelineSolver(native)
  pipeline.step()
  const allocation = pipeline as unknown as {
    routingInput: SimpleRouteJson
    escapes: Trace[]
    terminalLayers: Map<string, string[]>
    sharedPackages?: Generator<unknown, unknown>
  }
  if (!allocation.sharedPackages)
    throw Error("Expected fresh surface allocation")
  allocation.sharedPackages.return(null)
  native = structuredClone(allocation.routingInput)
  const pairs = new Set(
    native.differentialPairs!.flatMap((pair) => pair.connectionNames),
  )
  const pairEscapes = allocation.escapes.filter((trace) =>
    pairs.has(trace.connection_name!),
  )
  const connections = native.connections.map((connection) => ({
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((point) => {
      const escape = allocation.escapes.find(
        (trace) =>
          trace.connection_name === connection.name &&
          Math.hypot(trace.route[0].x - point.x, trace.route[0].y - point.y) <
            1e-8,
      )
      if (!escape) return { ...point }
      const end = escape.route.at(-1)! as Wire
      return { x: end.x, y: end.y, layer: end.layer }
    }),
  }))
  const preferredFirst = new Map(
    connections.map((connection) => [
      connection.name,
      [
        connection.pointsToConnect[0].layer,
        ...(allocation.terminalLayers.get(connection.name) ?? []).filter(
          (layer) => layer !== connection.pointsToConnect[0].layer,
        ),
      ],
    ]),
  )
  const plans = planSharedPairCorridors(
    { ...native, connections, traces: pairEscapes },
    preferredFirst,
    true,
    { preferPackageOnlyTuning: true },
  )
  let next = plans.next(),
    steps = 0
  try {
    while (!next.done && !next.value && steps++ < 50000) next = plans.next()
    if (!next.value) throw Error("Public native fixture produced no pair seed")
    const retained: Trace[] = next.value
    const escapes = pairEscapes.map((escape) =>
      retargetGeneratedEscape(
        escape,
        (
          retained.find(
            (trace) => trace.connection_name === escape.connection_name,
          )!.route[0] as Wire
        ).layer,
      ),
    )
    const state: FlexibleSignalState = {
      native,
      pending: {
        ...native,
        connections: connections.filter(
          (connection) => !pairs.has(connection.name),
        ),
        traces: [...escapes, ...retained],
      },
      retained,
      escapes,
      traces: [],
    }
    const work = repairSurfacePairEscape(
      state,
      "source_trace_5",
      new Set([JSON.stringify(retained.map((trace) => trace.route))]),
    )
    let repaired = work.next(),
      yields = 0
    try {
      while (!repaired.done && yields++ < 100000) repaired = work.next()
      if (!repaired.done || !repaired.value)
        throw Error("Public native fixture could not repair clock access")
      cached = repaired.value
      return structuredClone(cached)
    } finally {
      if (!repaired.done) work.return(null)
    }
  } finally {
    if (!next.done) plans.return(undefined)
  }
}
