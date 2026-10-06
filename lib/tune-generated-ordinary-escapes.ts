import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { distance, length } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import { tuningPathIsSelfClear } from "./length-tuning"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { fixedRouteLength, minimumLengthTargets } from "./route-lengths"
import { surfaceBridgeSelfShorts } from "./route-surface-bridge"
import {
  IncompleteLengthTuningError,
  tuneSmoothLengths,
} from "./smooth-length-tuning"
import { createTerminalViaClearanceChecker } from "./terminal-via-clearance"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Tune only explicitly caller-owned surface approaches of ordinary signals.
 * Every carrier and barrel stays fixed. Supplied input traces, paired corridors,
 * native pads, and all other connections stay hard and byte-identical.
 * Tune one maximal planar run at a time, including between-via runs on either
 * allowed outer layer. Targets include every held run, supplied fanout and carrier. */
export function* tuneGeneratedOrdinaryEscapes(
  input: SimpleRouteJson,
  carriers: Trace[],
  generatedEscapes: Trace[],
  options: { maxCandidatesPerEscape?: number; targetNames?: string[] } = {},
): Generator<
  void,
  {
    input: SimpleRouteJson
    traces: Trace[]
    escapes: Trace[]
    matchedNames: string[]
    unfinishedNames: string[]
  } | null
> {
  const physical = getCopperLayerNames(input.layerCount)
  const outer = new Set([physical[0], physical.at(-1)!])
  const allowed = new Set(
    input.allowedLayers?.filter((layer) => outer.has(layer)),
  )
  if (!allowed.size) return null
  const carrierIds = new Set(carriers.map((t) => t.pcb_trace_id))
  const escapeIds = new Set(generatedEscapes.map((t) => t.pcb_trace_id))
  if (escapeIds.size !== generatedEscapes.length)
    throw Error("Owned escape IDs must be unique")
  if (carrierIds.size !== carriers.length)
    throw Error("Carrier IDs must be unique")
  const movable = new Map(
    [...carriers, ...generatedEscapes].map((t) => [t.pcb_trace_id, t]),
  )
  const owned = new Set([...carriers, ...generatedEscapes])
  if (movable.size !== carriers.length + generatedEscapes.length)
    throw Error("Carrier and owned escape IDs must be disjoint")
  for (const trace of input.traces ?? []) {
    const movableTrace = movable.get(trace.pcb_trace_id)
    // Explicit object identity determines ownership. An unrelated supplied
    // trace sharing an owned identifier must never be removed as owned.
    if (movableTrace && !owned.has(trace))
      throw Error(
        `Owned trace ID collides with supplied input: ${trace.pcb_trace_id}`,
      )
  }
  const supplied = (input.traces ?? []).filter((t) => !owned.has(t))
  let escapes = generatedEscapes
  let local: SimpleRouteJson = { ...input, traces: [...supplied, ...escapes] }
  const targets = minimumLengthTargets(local, carriers)
  const paired = new Set(
    input.differentialPairs?.flatMap((p) => p.connectionNames),
  )
  const requested = options.targetNames ? new Set(options.targetNames) : null
  const deficit = (t: Trace) =>
    (targets.get(t.connection_name!) ?? 0) -
    length(t.route) -
    fixedRouteLength(local, t.connection_name!)
  const eligible = carriers
    .filter((t) => {
      const name = t.connection_name!
      return (
        !paired.has(name) &&
        (!requested || requested.has(name)) &&
        t.route[0]?.route_type === "wire" &&
        t.route.every((p) => p.route_type === "wire" && allowed.has(p.layer)) &&
        deficit(t) > 1e-7
      )
    })
    .sort((a, b) => deficit(b) - deficit(a))
  let changed = false
  for (const carrier of eligible) {
    const name = carrier.connection_name!
    const originalConnection = input.connections.find((c) => c.name === name)
    if (!originalConnection) continue
    const maxLength = Math.min(
      Infinity,
      ...(input.buses ?? [])
        .filter(
          (b) => b.connectionNames.includes(name) && b.maxLength !== undefined,
        )
        .map((b) => b.maxLength!),
    )
    if (targets.get(name)! > maxLength + 1e-7) continue
    const candidates = escapes
      .filter((e) => e.connection_name === name)
      .sort((a, b) => length(b.route) - length(a.route))
    for (const oldEscape of candidates) {
      const runs = ownedPlanarRuns(oldEscape, allowed).sort(
        (a, b) => b.length - a.length,
      )
      for (const originalRun of runs) {
        const escape = escapes.find(
          (e) => e.pcb_trace_id === oldEscape.pcb_trace_id,
        )!
        const run = ownedPlanarRuns(escape, allowed).find(
          (candidate) => candidate.ordinal === originalRun.ordinal,
        )!
        const planar = escape.route.slice(run.start, run.end + 1) as Wire[]
        const pad = planar[0]
        const stub: Trace = {
          ...escape,
          route: planar,
          coupledSection: undefined,
          curvedSegments: escape.curvedSegments
            ?.filter((index) => index > run.start && index <= run.end)
            .map((index) => index - run.start),
        }
        const held: Trace[] = [
          {
            ...escape,
            pcb_trace_id: `${escape.pcb_trace_id}_held_before_${run.ordinal}`,
            route: escape.route.slice(0, run.start),
          },
          {
            ...escape,
            pcb_trace_id: `${escape.pcb_trace_id}_held_after_${run.ordinal}`,
            route: escape.route.slice(run.end + 1),
          },
        ].filter((t) => t.route.length)
        const stubInput: SimpleRouteJson = {
          ...local,
          connections: local.connections.map((c) =>
            c.name === name
              ? { ...c, pointsToConnect: [pad, planar.at(-1)!] }
              : c,
          ),
          traces: [
            ...local.traces!.filter((t) => t !== escape),
            ...held,
            ...carriers,
          ],
        }
        let tuned: Trace
        try {
          tuned = tuneSmoothLengths(
            stubInput,
            [stub],
            new Map([[name, targets.get(name)!]]),
            {
              maxCandidates: Math.max(
                0,
                Math.floor(
                  (options.maxCandidatesPerEscape ?? 4096) / runs.length,
                ),
              ),
              packMeanders: true,
            },
          )[0]
        } catch (error) {
          if (!(error instanceof IncompleteLengthTuningError)) {
            yield
            continue
          }
          tuned = error.traces[0]
        }
        const added = length(tuned.route) - length(stub.route)
        if (added < 1e-7) {
          yield
          continue
        }
        const replacement: Trace = {
          ...escape,
          route: [
            ...escape.route.slice(0, run.start),
            ...tuned.route,
            ...escape.route.slice(run.end + 1),
          ],
          curvedSegments: [
            ...(escape.curvedSegments ?? []).filter(
              (index) => index <= run.start,
            ),
            ...(tuned.curvedSegments ?? []).map((index) => index + run.start),
            ...(escape.curvedSegments ?? [])
              .filter((index) => index > run.end)
              .map((index) => index + tuned.route.length - planar.length),
          ].sort((a, b) => a - b),
        }
        const ownEscapes = escapes
          .map((e) => (e === escape ? replacement : e))
          .filter((e) => e.connection_name === name)
        const joined = joinSignalEscapes(carrier, ownEscapes)
        const others = carriers
          .filter((t) => t.connection_name !== name)
          .map((t) =>
            joinSignalEscapes(
              t,
              escapes.filter((e) => e.connection_name === t.connection_name),
            ),
          )
        const scene = new VectorScene(
          input,
          { ...originalConnection, pointsToConnect: [pad, planar.at(-1)!] },
          pad.width,
          fixedCopper({ ...input, traces: [...supplied, ...others] }),
        )
        if (
          tuned.route.some(
            (p) =>
              p.route_type !== "wire" ||
              p.layer !== pad.layer ||
              p.width !== pad.width,
          ) ||
          distance(tuned.route[0], planar[0]) > 1e-8 ||
          distance(tuned.route.at(-1)!, planar.at(-1)!) > 1e-8 ||
          !scene.pathVisible(tuned.route) ||
          !tuningPathIsSelfClear(
            tuned.route,
            pad.width +
              (input.minTraceToPadEdgeClearance ??
                input.defaultObstacleMargin ??
                0.075),
          ) ||
          !createTerminalViaClearanceChecker(stubInput, stub, {
            preserveExistingApproach: false,
          })(tuned.route) ||
          !routeAnglesAreConventional([joined]) ||
          surfaceBridgeSelfShorts(input, originalConnection, joined) ||
          length(joined.route) +
            fixedRouteLength({ ...input, traces: supplied }, name) >
            maxLength + 1e-7 ||
          length(joined.route) +
            fixedRouteLength({ ...input, traces: supplied }, name) >
            targets.get(name)! + 1e-6
        ) {
          yield
          continue
        }
        // The pending connection may describe carrier handoff vias. Native DRC
        // needs the real pad endpoints supplied by the complete owned approaches.
        const physicalInput = {
          ...input,
          connections: input.connections.map((connection) => {
            const route = [...others, joined].find(
              (trace) => trace.connection_name === connection.name,
            )
            if (!route) return connection
            return {
              ...connection,
              pointsToConnect: [
                route.route[0] as Wire,
                route.route.at(-1)! as Wire,
              ],
            }
          }),
        }
        const drc = validateRoutedCopperDrc({
          inputSrj: { ...physicalInput, traces: supplied },
          routedSrj: {
            ...physicalInput,
            traces: [...supplied, ...others, joined],
          },
          clearance:
            input.minTraceToPadEdgeClearance ??
            input.defaultObstacleMargin ??
            0.075,
          allowBlindAndBuriedVias: false,
        } as Parameters<typeof validateRoutedCopperDrc>[0])
        if (
          (!drc.valid && drc.issues.length === 0) ||
          drc.issues.some(
            (issue) =>
              (!issue.traceId && !issue.otherTraceId) ||
              issue.traceId === joined.pcb_trace_id ||
              issue.otherTraceId === joined.pcb_trace_id,
          )
        ) {
          yield
          continue
        }
        escapes = escapes.map((e) => (e === escape ? replacement : e))
        local = { ...local, traces: [...supplied, ...escapes] }
        changed = true
        yield
        if (
          length(joined.route) +
            fixedRouteLength({ ...input, traces: supplied }, name) >=
          targets.get(name)! - 1e-7
        )
          break
      }
      if (
        length(
          joinSignalEscapes(
            carrier,
            escapes.filter((e) => e.connection_name === name),
          ).route,
        ) +
          fixedRouteLength({ ...input, traces: supplied }, name) >=
        targets.get(name)! - 1e-7
      )
        break
    }
  }
  if (!changed) return null
  const matchedNames: string[] = [],
    unfinishedNames: string[] = []
  for (const carrier of eligible) {
    const name = carrier.connection_name!
    const total =
      fixedRouteLength({ ...input, traces: supplied }, name) +
      length(
        joinSignalEscapes(
          carrier,
          escapes.filter((e) => e.connection_name === name),
        ).route,
      )
    ;(total >= targets.get(name)! - 1e-7 ? matchedNames : unfinishedNames).push(
      name,
    )
  }
  return {
    input: local,
    traces: carriers,
    escapes,
    matchedNames,
    unfinishedNames,
  }
}

interface OwnedPlanarRun {
  start: number
  end: number
  ordinal: number
  length: number
}
/** Maximal continuous caller-owned wire runs; every intervening barrel is held. */
function ownedPlanarRuns(
  escape: Trace,
  allowed: Set<string>,
): OwnedPlanarRun[] {
  const runs: OwnedPlanarRun[] = []
  let ordinal = 0
  for (let start = 0; start < escape.route.length; ) {
    const first = escape.route[start]
    if (first.route_type !== "wire") {
      start++
      continue
    }
    let end = start
    while (end + 1 < escape.route.length) {
      const next = escape.route[end + 1]
      if (next.route_type !== "wire" || next.layer !== first.layer) break
      end++
    }
    const before = escape.route[start - 1],
      after = escape.route[end + 1]
    const wires = escape.route.slice(start, end + 1) as Wire[]
    if (
      end > start &&
      allowed.has(first.layer) &&
      wires.every(
        (p) =>
          p.width === first.width && Number.isFinite(p.width) && p.width > 0,
      ) &&
      (!before ||
        (before.route_type === "via" &&
          before.to_layer === first.layer &&
          distance(before, first) < 1e-8)) &&
      (!after ||
        (after.route_type === "via" &&
          after.from_layer === first.layer &&
          distance(after, wires.at(-1)!) < 1e-8))
    )
      runs.push({ start, end, ordinal, length: length(wires) })
    ordinal++
    start = end + 1
  }
  return runs
}
