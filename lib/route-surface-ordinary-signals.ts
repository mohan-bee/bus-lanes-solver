import type { FlexibleSignalState } from "./flexible-signal-state"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { repairSurfacePairEscape } from "./repair-surface-pair-escape"
import { runBoundedRouting } from "./run-bounded-routing"

/** Negotiate ordinary sites before committing a generated surface pair plan.
 * Empty domains trigger bounded feedback into pair escapes, not another long
 * independent pair enumeration. Supplied copper and final acceptance stay fixed. */
export function* routeSurfaceOrdinarySignals(
  initial: FlexibleSignalState,
  ordinaryNames: ReadonlySet<string>,
  options: { maxSteps?: number; maxPairRepairs?: number } = {},
): Generator<void, FlexibleSignalState | null> {
  // Unbounded legacy buses retain their established site search exactly.
  // The new feedback is for hard length-limited surface escape allocation.
  if (!initial.native.buses?.some((bus) => bus.maxLength !== undefined))
    return yield* runBoundedRouting(
      negotiateSignalSites(initial, ordinaryNames, false, false, {
        allowExpandedSites: false,
        maxCandidateSearchNodes: 12000,
      }),
      options.maxSteps ?? 250000,
    )
  let state = initial
  const seen = new Set([
    JSON.stringify(state.retained.map((trace) => trace.route)),
  ])
  for (let repair = 0; repair <= (options.maxPairRepairs ?? 6); repair++) {
    let blocked: string | undefined
    const routed = yield* runBoundedRouting(
      negotiateSignalSites(state, ordinaryNames, false, false, {
        allowExpandedSites: true,
        expandEmptyDomainsOnly: true,
        retainExistingRoutes: state.traces.length > 0,
        maxCandidateSearchNodes: 12000,
        onBlockedConnection: (name) => {
          blocked = name
        },
      }),
      options.maxSteps ?? 250000,
    )
    if (routed) return routed
    if (!blocked || repair === (options.maxPairRepairs ?? 6)) return null
    const repaired = yield* repairSurfacePairEscape(state, blocked, seen)
    if (!repaired) return null
    seen.add(JSON.stringify(repaired.retained.map((trace) => trace.route)))
    state = repaired
  }
  return null
}
