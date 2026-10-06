import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { routeCoupledPair } from "./coupled-pair-routing"
import { routeAlternateSignalDogbones } from "./alternate-signal-dogbones"
import { finishSurfaceTiming } from "./finish-surface-timing"
import { type FlexibleSignalState, signalLayers } from "./flexible-signal-state"
import { ownedSignalEscapes, signalDogboneOptions } from "./repair-bus-dogbones"
import { joinSignalEscapes } from "./join-signal-escapes"
import { exteriorPairSpacingReports } from "./exterior-pair-spacing"
import {
  busLengthReports,
  fixedRouteLength,
  pairLengthReports,
} from "./route-lengths"
import { retargetGeneratedEscape } from "./retarget-generated-escape"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import {
  routeSurfaceBridge,
  surfaceBridgeEligible,
  surfaceBridgeSelfShorts,
  surfaceBridgeYieldInterval,
} from "./route-surface-bridge"
import { GridVisibilitySearch } from "./grid-visibility"
import { signalWidth } from "./repair-bus-dogbones"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { runBoundedRouting } from "./run-bounded-routing"
import { fixedCopper, VectorScene } from "./vector-scene"
import { length } from "./geometry"
import { connectors } from "./vector-visibility"
import type { SimpleRouteJson, SolverOptions, Trace, Wire } from "./types"

export interface FinishedSurfacePairOptions {
  solverOptions?: SolverOptions
  maxStepsPerSearch?: number
  maxFinishSteps?: number
  anchorToFiniteCaps?: boolean
  /** Preserve an explicit positive minimum while still anchoring unconstrained
   * byte groups near their finite caps. */
  preferNativePositiveMinimum?: boolean
  maxReachabilityExpansions?: number
  /** Optional lookahead never replaces the complete solver. A bounded probe
   * is unknown and leaves the final feasibility decision to ordinary routing. */
  maxReachabilityYields?: number
}

/** Finish each prospective pair before retaining its copper as the next pair's
 * obstacle. Owned fanouts and carriers are adopted together; caller-owned
 * input copper and native terminal positions remain immutable. Prefixes are
 * provisional until all remaining connections and full timing groups finish. */
export function* routeFinishedSurfacePairs(
  native: SimpleRouteJson,
  allocation: SimpleRouteJson,
  originalEscapes: Trace[],
  options: FinishedSurfacePairOptions = {},
): Generator<void, FlexibleSignalState | null> {
  const pairs = [...(native.differentialPairs ?? [])]
  if (!pairs.length) return null
  const positiveMinimum = (names: string[]) =>
    Math.max(
      0,
      ...(native.buses ?? [])
        .filter((bus) =>
          names.some((name) => bus.connectionNames.includes(name)),
        )
        .map((bus) => bus.minLength ?? 0),
    )
  pairs.sort(
    (a, b) =>
      positiveMinimum(b.connectionNames) - positiveMinimum(a.connectionNames),
  )
  const carriers: Trace[] = [],
    escapes: Trace[] = []
  for (const pair of pairs) {
    const names = new Set(pair.connectionNames)
    const members = native.connections.filter((connection) =>
      names.has(connection.name),
    )
    if (members.length !== 2) return null
    const layers = signalLayers(native, members[0]).filter((layer) =>
      members.every((connection) =>
        signalLayers(native, connection).includes(layer),
      ),
    )
    const nativeLayer = members[0].pointsToConnect[0].layer
    const commonNative = members.every((connection) =>
      connection.pointsToConnect.every((point) => point.layer === nativeLayer),
    )
    const hard = [
      ...(native.traces ?? []),
      ...carriers.map((trace) =>
        joinSignalEscapes(
          trace,
          escapes.filter(
            (escape) => escape.connection_name === trace.connection_name,
          ),
        ),
      ),
    ]
    const scoped: SimpleRouteJson = {
      ...native,
      connections: members,
      traces: hard,
      differentialPairs: [pair],
      buses: (native.buses ?? [])
        .map((bus) => ({
          ...bus,
          connectionNames: bus.connectionNames.filter((name) =>
            names.has(name),
          ),
        }))
        .filter((bus) => bus.connectionNames.length),
    }
    const planning: SimpleRouteJson = {
      ...scoped,
      buses: scoped.buses?.map((bus) => ({
        ...bus,
        minLength:
          options.anchorToFiniteCaps &&
          !(options.preferNativePositiveMinimum && (bus.minLength ?? 0) > 0) &&
          Number.isFinite(bus.maxLength) &&
          Number.isFinite(bus.maxLengthSkew)
            ? Math.max(bus.minLength ?? 0, bus.maxLength! - bus.maxLengthSkew!)
            : bus.minLength,
      })),
    }
    type Site = {
      connections: SimpleRouteJson["connections"]
      escapes: Trace[]
    }
    const sites: Site[] = []
    const allocatedLayer = allocation.connections.find((connection) =>
      names.has(connection.name),
    )?.pointsToConnect[0].layer
    const addAllocated = (
      layer: string,
      connections: SimpleRouteJson["connections"],
      owned: Trace[],
    ) => {
      if (!layers.includes(layer) || owned.length !== 4) return
      sites.push({
        connections: members.map((connection) => ({
          ...connection,
          pointsToConnect: connections
            .find((candidate) => candidate.name === connection.name)!
            .pointsToConnect.map((point) => ({ ...point, layer })),
        })),
        escapes: owned.map((escape) => retargetGeneratedEscape(escape, layer)),
      })
    }
    if (positiveMinimum(pair.connectionNames) > 0 && allocatedLayer)
      addAllocated(
        allocatedLayer,
        allocation.connections,
        originalEscapes.filter((escape) => names.has(escape.connection_name!)),
      )
    if (commonNative && layers.includes(nativeLayer))
      sites.push({ connections: members, escapes: [] })
    if (allocatedLayer)
      addAllocated(
        allocatedLayer,
        allocation.connections,
        originalEscapes.filter((escape) => names.has(escape.connection_name!)),
      )
    for (const layer of layers) {
      if (layer === nativeLayer) continue
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        try {
          const generated = routeAlternateSignalDogbones(
            scoped,
            signalDogboneOptions(
              scoped,
              new Map(members.map((connection) => [connection.name, layer])),
            ),
            quadrant,
          )
          addAllocated(
            layer,
            generated.connections as SimpleRouteJson["connections"],
            ownedSignalEscapes(native, generated.traces),
          )
        } catch {
          /* The next independent site orientation remains available. */
        }
        yield
      }
    }
    let finished: FlexibleSignalState | null = null
    const seen = new Set<string>()
    for (const offsets of positiveMinimum(pair.connectionNames) > 0
      ? ([
          [1, 1],
          [0, 0],
          [2, 2],
          [3, 3],
          [0, 1],
          [1, 0],
        ] as const)
      : ([
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
          [0, 1],
          [1, 0],
        ] as const)) {
      for (const site of sites) {
        const local: SimpleRouteJson = {
          ...native,
          connections: native.connections.map(
            (connection) =>
              site.connections.find(
                (candidate) => candidate.name === connection.name,
              ) ?? connection,
          ),
          traces: [...hard, ...site.escapes],
        }
        function* accept(raw: Trace[]): Generator<void, Trace[] | null> {
          const key = JSON.stringify(raw.map((trace) => trace.route))
          if (seen.has(key)) return null
          seen.add(key)
          const current: FlexibleSignalState = {
            native: planning,
            retained: raw,
            traces: [],
            escapes: site.escapes,
            pending: {
              ...planning,
              traces: [...hard, ...site.escapes],
              connections: members.map((connection) => {
                const trace = raw.find(
                  (candidate) => candidate.connection_name === connection.name,
                )!
                return {
                  ...connection,
                  pointsToConnect: [
                    trace.route[0],
                    trace.route.at(-1)!,
                  ] as Wire[],
                }
              }),
            },
          }
          const candidate = yield* finishSurfaceTiming(
            current,
            options.solverOptions ?? { smoothTuning: true, denseSearch: true },
            { maxSteps: options.maxFinishSteps ?? 100000 },
          )
          if (!candidate) return null
          const selected = [...candidate.retained, ...candidate.traces]
          const joined = selected.map((trace) =>
            joinSignalEscapes(
              trace,
              candidate.escapes.filter(
                (escape) => escape.connection_name === trace.connection_name,
              ),
            ),
          )
          if (
            !routeAnglesAreConventional(joined) ||
            joined.some((trace) =>
              surfaceBridgeSelfShorts(
                native,
                members.find(
                  (connection) => connection.name === trace.connection_name,
                )!,
                trace,
              ),
            )
          )
            return null
          if (
            exteriorPairSpacingReports(scoped, joined).some(
              (report) => !report.applicable || !report.matched,
            )
          )
            return null
          if (
            [
              ...busLengthReports(planning, joined),
              ...pairLengthReports(planning, joined),
            ].some(
              (report) =>
                (report.toleranceMm !== null && !report.matched) ||
                !report.aboveMinimumLength ||
                !report.withinLengthLimit,
            )
          )
            return null
          if (generatedEscapeHolesConflict(native, joined, hard)) return null
          // Audit-only identities come from supplied owners. They are never
          // routing targets, and empty terminal lists avoid inventing a power
          // endpoint at an already manufactured barrel.
          const nativeNames = new Set(
            native.connections.map((connection) => connection.name),
          )
          const supplied = hard.map((trace) => ({
            ...trace,
            connection_name: trace.connection_name ?? trace.source_trace_id,
          }))
          const hardOwners = [
            ...new Set(
              supplied.flatMap((trace) =>
                trace.connection_name ? [trace.connection_name] : [],
              ),
            ),
          ]
          const auditInput = {
            ...native,
            traces: supplied,
            connections: [
              ...native.connections,
              ...hardOwners
                .filter((name) => !nativeNames.has(name))
                .map((name) => ({ name, pointsToConnect: [] })),
            ],
          }
          const drc = validateRoutedCopperDrc({
            inputSrj: auditInput,
            routedSrj: { ...auditInput, traces: [...supplied, ...joined] },
            clearance:
              native.minTraceToPadEdgeClearance ??
              native.defaultObstacleMargin ??
              0.075,
            allowBlindAndBuriedVias: native.allowBlindAndBuriedVias ?? false,
          } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
          if (!drc.valid) return null
          const reachableInput: SimpleRouteJson = {
            ...native,
            traces: [...hard, ...joined],
          }
          const heldNames = new Set(
            [...carriers, ...selected].map((trace) => trace.connection_name),
          )
          let lookaheadYields = 0
          const lookaheadLimit = options.maxReachabilityYields ?? 2000
          for (const connection of native.connections) {
            if (heldNames.has(connection.name)) continue
            if (lookaheadYields >= lookaheadLimit) break
            const nativeLayer = connection.pointsToConnect[0].layer
            if (
              connection.pointsToConnect.every(
                (point) => point.layer === nativeLayer,
              ) &&
              signalLayers(native, connection).includes(nativeLayer)
            ) {
              const scene = new VectorScene(
                reachableInput,
                connection,
                signalWidth(native, connection),
                fixedCopper(reachableInput),
              )
              const maximumLength =
                Math.min(
                  Infinity,
                  ...(native.buses ?? [])
                    .filter((bus) =>
                      bus.connectionNames.includes(connection.name),
                    )
                    .map((bus) => bus.maxLength ?? Infinity),
                ) - fixedRouteLength(native, connection.name)
              if (
                connectors(
                  connection.pointsToConnect[0],
                  connection.pointsToConnect[1],
                ).some(
                  (path) =>
                    length(path) <= maximumLength + 1e-8 &&
                    scene.pathVisible(path),
                )
              )
                continue
            }
            const maxExpansions = Math.min(
              options.maxReachabilityExpansions ?? 150000,
              (lookaheadLimit - lookaheadYields) * surfaceBridgeYieldInterval,
            )
            if (surfaceBridgeEligible(reachableInput, connection)) {
              let reachable = false,
                bounded = false
              for (const maxVias of [2, 4]) {
                let reachedLimit = false
                const probe = routeSurfaceBridge(reachableInput, connection, {
                  maxVias,
                  maxExpansions,
                  onSearchLimit: () => {
                    reachedLimit = true
                  },
                })
                let next = probe.next()
                try {
                  while (!next.done && lookaheadYields < lookaheadLimit) {
                    yield
                    lookaheadYields++
                    next = probe.next()
                  }
                  reachable = !!(next.done && next.value)
                  bounded ||= !next.done || reachedLimit
                } finally {
                  if (!next.done) probe.return(null)
                }
                if (reachable || lookaheadYields >= lookaheadLimit) break
              }
              if (!reachable && !bounded) return null
            } else {
              if (
                !connection.pointsToConnect.every(
                  (point) =>
                    point.layer === connection.pointsToConnect[0].layer,
                )
              )
                return null
              const search = new GridVisibilitySearch(
                new VectorScene(
                  reachableInput,
                  connection,
                  signalWidth(native, connection),
                  fixedCopper(reachableInput),
                ),
                connection.pointsToConnect[0],
                connection.pointsToConnect[1],
                [],
                4,
                undefined,
                { allTerminalAttachments: true, checkReachability: true },
              )
              try {
                while (
                  !search.solved &&
                  !search.failed &&
                  search.expanded < maxExpansions &&
                  lookaheadYields < lookaheadLimit
                ) {
                  search.step()
                  lookaheadYields++
                  yield
                }
                if (!search.solved && search.failed) return null
              } finally {
                search.cancel()
              }
            }
          }
          finished = candidate
          return raw
        }
        yield* runBoundedRouting(
          routeCoupledPair(local, pair, fixedCopper(local), {
            copper: [],
            penalty: 1,
            handoffOffsets: offsets,
            preferPackageOnlyTuning: true,
            strictCandidate: accept,
          }),
          options.maxStepsPerSearch ?? 15000,
        )
        if (finished) break
      }
      if (finished) break
    }
    if (!finished) return null
    const selected = finished as FlexibleSignalState
    carriers.push(...selected.retained, ...selected.traces)
    escapes.push(...selected.escapes)
  }
  const names = new Set(carriers.map((trace) => trace.connection_name))
  return {
    native,
    retained: carriers,
    traces: [],
    escapes,
    pending: {
      ...native,
      traces: [...(native.traces ?? []), ...escapes, ...carriers],
      connections: native.connections.filter(
        (connection) => !names.has(connection.name),
      ),
    },
  }
}
