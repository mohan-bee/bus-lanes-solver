import type { FlexibleSignalState } from "./flexible-signal-state"
import { length } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import { busLengthReports, fixedRouteLength } from "./route-lengths"
import {
  routeSurfaceBridge,
  surfaceBridgeEligible,
} from "./route-surface-bridge"
import type { Wire } from "./types"

/** Reduce a bus's length target before allocating its shared tuning space.
 * Try only its longest member, with every other route and supplied fanout hard.
 * Paired rails remain atomic and immutable. Retain each computed checkpoint:
 * a shorter route can consume tuning space, so full matching must choose a
 * feasible candidate before any geometry is accepted. */
export function* surfaceBusShortcutCandidates(
  previous: FlexibleSignalState,
  options: { maxAttempts?: number; maxExpansions?: number } = {},
): Generator<void, FlexibleSignalState[]> {
  let state = previous
  const candidates = [previous]
  const paired = new Set(
    state.native.differentialPairs?.flatMap((pair) => pair.connectionNames),
  )
  const tried = new Set<string>()
  for (let attempt = 0; attempt < (options.maxAttempts ?? 6); attempt++) {
    const carriers = [...state.retained, ...state.traces]
    const joined = carriers.map((trace) =>
      joinSignalEscapes(
        trace,
        state.escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      ),
    )
    const targets = busLengthReports(state.native, joined)
      .filter((report) => report.toleranceMm !== null)
      .flatMap((report) => {
        const lengths = [...report.lengths].sort(
          (a, b) => (b.totalLengthMm ?? 0) - (a.totalLengthMm ?? 0),
        )
        return lengths.length
          ? [{ ...lengths[0], nextLongest: lengths[1]?.totalLengthMm }]
          : []
      })
      .filter((target) => !paired.has(target.name) && !tried.has(target.name))
      .sort((a, b) => (b.totalLengthMm ?? 0) - (a.totalLengthMm ?? 0))
    const target = targets[0]
    if (!target) break
    const name = target.name
    tried.add(name)
    const connection = state.native.connections.find(
      (candidate) => candidate.name === name,
    )
    const old = joined.find((trace) => trace.connection_name === name)
    if (!connection || !old || !surfaceBridgeEligible(state.native, connection))
      continue
    const oldLength = length(old.route)
    const local = {
      ...state.native,
      traces: [
        ...(state.native.traces ?? []),
        ...joined.filter((trace) => trace.connection_name !== name),
      ],
    }
    const ceiling = oldLength - 0.25
    const nextCeiling =
      target.nextLongest === null || target.nextLongest === undefined
        ? ceiling
        : Math.min(
            ceiling,
            target.nextLongest - fixedRouteLength(state.native, name) - 1e-6,
          )
    let replacement = yield* routeSurfaceBridge(local, connection, {
      maxLength: nextCeiling,
      maxExpansions: options.maxExpansions ?? 750000,
    })
    if (!replacement && nextCeiling < ceiling - 1e-6)
      replacement = yield* routeSurfaceBridge(local, connection, {
        maxLength: ceiling,
        maxExpansions: options.maxExpansions ?? 750000,
      })
    if (!replacement) continue
    const improved = joinSignalEscapes(replacement.carrier, replacement.escapes)
    if (length(improved.route) >= oldLength - 0.25 + 1e-8) continue
    const replace = (trace: (typeof carriers)[number]) =>
      trace.connection_name === name ? replacement.carrier : trace
    const retained = state.retained.map(replace)
    const traces = state.traces.map(replace)
    const escapes = [
      ...state.escapes.filter((escape) => escape.connection_name !== name),
      ...replacement.escapes,
    ]
    const byName = new Map(
      [...retained, ...traces].map((trace) => [trace.connection_name, trace]),
    )
    state = {
      ...state,
      retained,
      traces,
      escapes,
      pending: {
        ...state.pending,
        connections: state.pending.connections.map((candidate) => {
          const trace = byName.get(candidate.name)
          return trace
            ? {
                ...candidate,
                pointsToConnect: [
                  trace.route[0],
                  trace.route.at(-1)!,
                ] as Wire[],
              }
            : candidate
        }),
        traces: [...(state.native.traces ?? []), ...escapes, ...retained],
      },
    }
    candidates.push(state)
    yield
  }
  return candidates
}
