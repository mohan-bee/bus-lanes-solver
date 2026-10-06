import type { FlexibleSignalState } from "./flexible-signal-state"
import { pointSegmentDistanceToPoints } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import {
  routeSurfaceBridge,
  surfaceBridgeEligible,
  type SurfaceBridgeOptions,
} from "./route-surface-bridge"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Untimed surface controls can use a long owned approach on either end.
 * Prefer a frozen insertion; a bounded ordinary singleton closure can exchange
 * one existing ordinary route and immediately restore it with its original
 * bus constraints. Paired rails stay hard. */
export function* insertSurfaceSignal(
  state: FlexibleSignalState,
  name: string,
  options: SurfaceBridgeOptions & { maxReleasedCandidates?: number } = {},
): Generator<void, FlexibleSignalState | null> {
  const { native } = state,
    connection = native.connections.find(
      (candidate) => candidate.name === name,
    ),
    constrained = new Set([
      ...(native.buses?.flatMap((bus) => bus.connectionNames) ?? []),
      ...(native.differentialPairs?.flatMap((pair) => pair.connectionNames) ??
        []),
    ])
  if (
    !connection ||
    constrained.has(name) ||
    !surfaceBridgeEligible(native, connection)
  )
    return null
  const first = yield* routeFrozen(state, name, new Set([name]), options)
  if (first) return first
  const all = [...state.retained, ...state.traces],
    paired = new Set(
      native.differentialPairs?.flatMap((pair) => pair.connectionNames) ?? [],
    )
  const candidates = all
    .filter((trace) => !paired.has(trace.connection_name!))
    .map((trace) => {
      const joined = joinSignalEscapes(
        trace,
        state.escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      )
      let distance = Infinity
      for (const pad of connection.pointsToConnect)
        for (let index = 1; index < joined.route.length; index++)
          distance = Math.min(
            distance,
            pointSegmentDistanceToPoints(
              pad,
              joined.route[index - 1],
              joined.route[index],
            ),
          )
      return { name: trace.connection_name!, distance }
    })
    .sort((a, b) => a.distance - b.distance)
  for (const candidate of candidates.slice(
    0,
    options.maxReleasedCandidates ?? 64,
  )) {
    const replacement = yield* routeFrozen(
      state,
      name,
      new Set([name, candidate.name]),
      options,
    )
    if (!replacement) continue
    const complete = yield* routeFrozen(
      replacement,
      candidate.name,
      new Set([candidate.name]),
      options,
    )
    if (complete) return complete
    yield
  }
  return null
}

function* routeFrozen(
  state: FlexibleSignalState,
  name: string,
  remove: ReadonlySet<string>,
  options: SurfaceBridgeOptions,
): Generator<void, FlexibleSignalState | null> {
  const native = state.native,
    connection = native.connections.find((candidate) => candidate.name === name)
  if (!connection) return null
  const stable = [...state.retained, ...state.traces].filter(
      (trace) => !remove.has(trace.connection_name!),
    ),
    escapes = state.escapes.filter(
      (escape) => !remove.has(escape.connection_name!),
    ),
    input = {
      ...native,
      traces: [
        ...(native.traces ?? []),
        ...stable.map((trace) =>
          joinSignalEscapes(
            trace,
            escapes.filter(
              (escape) => escape.connection_name === trace.connection_name,
            ),
          ),
        ),
      ],
    },
    result = yield* routeSurfaceBridge(input, connection, options)
  if (!result) return null
  const generated = [...escapes, ...result.escapes],
    carriers = [...stable, result.carrier]
  return {
    native,
    escapes: generated,
    retained: stable,
    traces: [result.carrier],
    pending: carrierInput(native, carriers, generated),
  }
}

function carrierInput(
  native: SimpleRouteJson,
  traces: Trace[],
  escapes: Trace[],
): SimpleRouteJson {
  const byName = new Map(traces.map((trace) => [trace.connection_name, trace]))
  return {
    ...native,
    traces: [...(native.traces ?? []), ...escapes],
    connections: native.connections.map((connection) => {
      const trace = byName.get(connection.name)
      return trace
        ? {
            ...connection,
            pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
          }
        : connection
    }),
  }
}
