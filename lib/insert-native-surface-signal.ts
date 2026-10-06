import { CopperConflictIndex } from "./copper-conflict-index"
import {
  signalLayers,
  signalTrace,
  type FlexibleSignalState,
} from "./flexible-signal-state"
import { GridVisibilitySearch } from "./grid-visibility"
import { tuningPathIsSelfClear } from "./length-tuning"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { signalWidth } from "./repair-bus-dogbones"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { runBoundedRouting } from "./run-bounded-routing"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { SimpleRouteJson, Wire } from "./types"

/** Reserve a native surface approach before adding another paired corridor.
 * Supplied copper and existing pairs remain hard. Only ordinary carriers that
 * physically cross the proposed control may be reconsidered; the new control
 * stays fixed during that bounded repair. */
export function* insertNativeSurfaceSignal(
  full: SimpleRouteJson,
  previous: FlexibleSignalState,
  name: string,
  options: {
    maxBlockers?: number
    maxPrimitiveSteps?: number
    maxRepairSteps?: number
  } = {},
): Generator<void, FlexibleSignalState | null> {
  const connection = full.connections.find((item) => item.name === name)
  const constrained = new Set([
    ...(full.buses?.flatMap((bus) => bus.connectionNames) ?? []),
    ...(full.differentialPairs?.flatMap((pair) => pair.connectionNames) ?? []),
  ])
  const carriers = [...previous.retained, ...previous.traces]
  if (
    !connection ||
    constrained.has(name) ||
    carriers.some((trace) => trace.connection_name === name) ||
    connection.pointsToConnect.length !== 2
  )
    return null
  const layer = connection.pointsToConnect[0].layer
  if (
    !["top", "bottom"].includes(layer) ||
    connection.pointsToConnect.some((point) => point.layer !== layer) ||
    !signalLayers(full, connection).includes(layer)
  )
    return null
  const paired = new Set(
    previous.native.differentialPairs?.flatMap((pair) => pair.connectionNames),
  )
  const local: SimpleRouteJson = {
    ...full,
    connections: [connection],
    buses: [],
    differentialPairs: [],
    traces: [
      ...(full.traces ?? []),
      ...carriers.filter((trace) => paired.has(trace.connection_name!)),
      ...previous.escapes.filter((trace) => paired.has(trace.connection_name!)),
    ],
  }
  const width = signalWidth(full, connection)
  const clearance =
    full.minTraceToPadEdgeClearance ?? full.defaultObstacleMargin ?? 0.075
  const scene = new VectorScene(local, connection, width, fixedCopper(local))
  const search = new GridVisibilitySearch(
    scene,
    connection.pointsToConnect[0],
    connection.pointsToConnect[1],
    [],
    0,
    undefined,
    { checkReachability: true },
  )
  try {
    let steps = 0
    while (
      !search.solved &&
      !search.failed &&
      steps++ < (options.maxPrimitiveSteps ?? 50000)
    ) {
      search.step()
      yield
    }
    if (!search.solved) return null
    const primitive = signalTrace(
      full,
      connection,
      reduceOrdinaryTurns(search.result, scene),
      layer,
    )
    if (
      !scene.pathVisible(primitive.route) ||
      !routeAnglesAreConventional([primitive]) ||
      !tuningPathIsSelfClear(primitive.route, width / 2 + clearance)
    )
      return null
    const conflicts = new CopperConflictIndex()
    const proposed = fixedCopper({
      ...full,
      obstacles: [],
      traces: [primitive],
    })
    const blockers = new Set(
      carriers
        .filter((trace) => !paired.has(trace.connection_name!))
        .filter((trace) =>
          conflicts.firstConflict(
            proposed,
            fixedCopper({
              ...full,
              obstacles: [],
              traces: [
                trace,
                ...previous.escapes.filter(
                  (escape) => escape.connection_name === trace.connection_name,
                ),
              ],
            }),
            clearance - 1e-8,
          ),
        )
        .map((trace) => trace.connection_name!),
    )
    if (blockers.size > (options.maxBlockers ?? 3)) return null
    const joined = [...carriers, primitive]
    const names = new Set(joined.map((trace) => trace.connection_name!))
    const native: SimpleRouteJson = {
      ...full,
      connections: full.connections.filter((item) => names.has(item.name)),
      buses: full.buses?.filter((bus) =>
        bus.connectionNames.every((member) => names.has(member)),
      ),
      differentialPairs: full.differentialPairs?.filter((pair) =>
        pair.connectionNames.every((member) => names.has(member)),
      ),
    }
    const state: FlexibleSignalState = {
      native,
      escapes: previous.escapes,
      retained: [...previous.retained, primitive],
      traces: previous.traces,
      pending: {
        ...native,
        connections: native.connections.map((item) => {
          const trace = joined.find(
            (trace) => trace.connection_name === item.name,
          )!
          return {
            ...item,
            pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
          }
        }),
        traces: [
          ...(full.traces ?? []),
          ...previous.escapes,
          ...previous.retained,
          primitive,
        ],
      },
    }
    if (!blockers.size) return state
    return yield* runBoundedRouting(
      negotiateSignalSites(state, blockers, false, false, {
        retainExistingRoutes: true,
        maxCandidateSearchNodes: 12000,
      }),
      options.maxRepairSteps ?? 150000,
    )
  } finally {
    search.cancel()
  }
}
