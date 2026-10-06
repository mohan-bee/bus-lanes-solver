import { BusLanesSolver } from "./bus-lanes-solver"
import { exteriorPairSpacingReports } from "./exterior-pair-spacing"
import { distance, length } from "./geometry"
import { tuningPathIsSelfClear } from "./length-tuning"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { fixedRouteLength, minimumLengthTargets } from "./route-lengths"
import { tuneSmoothLengths } from "./smooth-length-tuning"
import { createTerminalViaClearanceChecker } from "./terminal-via-clearance"
import type { SimpleRouteJson, SolverOptions, Trace, Wire } from "./types"

/** Correct residual paired skew in caller-owned pad dogbones. Keep the entire
 * carrier, its shared corridor, and every via barrel fixed. Supplied fanout
 * traces are never eligible: the caller must explicitly identify generated
 * escapes. A short surface correction is accepted only after full validation. */
export function* tuneGeneratedPairEscapes(
  input: SimpleRouteJson,
  traces: Trace[],
  generatedEscapes: Trace[],
  options: SolverOptions,
): Generator<
  void,
  { input: SimpleRouteJson; traces: Trace[]; escapes: Trace[] } | null
> {
  const targets = minimumLengthTargets(input, traces)
  const paired = new Set(
    input.differentialPairs?.flatMap((p) => p.connectionNames),
  )
  const generatedIds = new Set(generatedEscapes.map((t) => t.pcb_trace_id))
  let local = input
  let escapes = generatedEscapes
  let changed = false
  for (const carrier of traces) {
    const name = carrier.connection_name!
    if (!paired.has(name) || !carrier.coupledSection) continue
    if (
      (targets.get(name) ?? 0) <=
      length(carrier.route) + fixedRouteLength(local, name) + 1e-7
    )
      continue
    for (const escape of local.traces ?? []) {
      if (
        !generatedIds.has(escape.pcb_trace_id) ||
        escape.connection_name !== name
      )
        continue
      const viaIndex = escape.route.findIndex((p) => p.route_type === "via")
      if (
        viaIndex < 2 ||
        escape.route.filter((p) => p.route_type === "via").length !== 1
      )
        continue
      const pad = escape.route[0]
      const via = escape.route[viaIndex]
      if (
        pad.route_type !== "wire" ||
        pad.layer !== "top" ||
        via.route_type !== "via" ||
        via.from_layer !== "top"
      )
        continue
      const top = escape.route.slice(0, viaIndex)
      if (
        top.some((p) => p.route_type !== "wire" || p.layer !== "top") ||
        distance(top.at(-1)!, via) > 1e-8
      )
        continue
      const owner = input.obstacles.find(
        (o) => o.componentId && distance(o.center, pad) < 1e-4,
      )
      if (!owner) continue
      const pitch = Math.min(
        ...input.obstacles
          .filter((o) => o.componentId === owner.componentId)
          .map((o) => distance(o.center, pad))
          .filter((d) => d > 1e-4),
      )
      if (!Number.isFinite(pitch)) continue
      const surfaceLimit = Math.min(2, 2.5 * pitch)
      const connection = input.connections.find((c) => c.name === name)!
      const stubInput: SimpleRouteJson = {
        ...local,
        connections: local.connections.map((c) =>
          c.name === name
            ? { ...connection, pointsToConnect: [pad, top.at(-1)! as Wire] }
            : c,
        ),
        traces: [
          ...(local.traces ?? []).filter((t) => t !== escape),
          {
            ...escape,
            pcb_trace_id: `${escape.pcb_trace_id}_held_barrel`,
            route: escape.route.slice(viaIndex),
          },
          ...traces,
        ],
      }
      const stub: Trace = { ...escape, route: top }
      try {
        const tuned = tuneSmoothLengths(
          stubInput,
          [stub],
          new Map([[name, targets.get(name)!]]),
          { maxCandidates: 4096, packMeanders: true },
        )[0]
        const clearance =
          input.minTraceToPadEdgeClearance ??
          input.defaultObstacleMargin ??
          0.075
        if (
          length(tuned.route) > surfaceLimit + 1e-8 ||
          !routeAnglesAreConventional([tuned]) ||
          !tuningPathIsSelfClear(tuned.route, pad.width + clearance) ||
          !createTerminalViaClearanceChecker(stubInput, stub, {
            preserveExistingApproach: false,
          })(tuned.route)
        )
          continue
        const replacement: Trace = {
          ...escape,
          route: [...tuned.route, ...escape.route.slice(viaIndex)],
          curvedSegments: tuned.curvedSegments,
        }
        local = {
          ...local,
          traces: local.traces!.map((t) => (t === escape ? replacement : t)),
        }
        escapes = escapes.map((t) =>
          t.pcb_trace_id === escape.pcb_trace_id ? replacement : t,
        )
        changed = true
        break
      } catch {
        // Try the other pad end; a blocked package pocket is a normal outcome.
      }
      yield
    }
  }
  if (!changed) return null
  const validator = BusLanesSolver.forValidation(local, traces, options)
  try {
    while (!validator.solved && !validator.failed) {
      validator.step()
      yield
    }
    const coupling = exteriorPairSpacingReports(local, traces)
    if (
      validator.solved &&
      coupling.length === (input.differentialPairs?.length ?? 0) &&
      coupling.every((p) => p.applicable && p.matched)
    ) {
      return { input: local, traces, escapes }
    }
  } finally {
    if (!validator.solved && !validator.failed) validator.tryFinalAcceptance()
  }
  return null
}
