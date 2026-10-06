import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { CopperConflictIndex } from "./copper-conflict-index"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import { finishSurfaceTiming } from "./finish-surface-timing"
import { type FlexibleSignalState, signalLayers } from "./flexible-signal-state"
import { distance, length } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import { tuningPathIsSelfClear } from "./length-tuning"
import { routeAnglesAreConventional } from "./route-angle-validation"
import {
  busLengthReports,
  fixedRouteLength,
  pairLengthReports,
} from "./route-lengths"
import { surfaceBridgeSelfShorts } from "./route-surface-bridge"
import { runBoundedRouting } from "./run-bounded-routing"
import { tuneGeneratedOrdinaryEscapes } from "./tune-generated-ordinary-escapes"
import type {
  Connection,
  SimpleRouteJson,
  SolverOptions,
  Trace,
  Wire,
} from "./types"
import { fixedCopper, VectorScene } from "./vector-scene"

export interface PrepareSurfaceTimingBanksOptions {
  solverOptions?: SolverOptions
  /** Total yielded work, including owned-approach tuning and final matching. */
  maxSteps?: number
  maxCandidatesPerEscape?: number
}

/** Reclaim timing space from a computed control prefix. Only explicit owned
 * carriers and escapes are released; every supplied trace remains immutable.
 * A previous matched runtime checkpoint may replace an overlong ordinary
 * member, but its carrier and escapes are always validated as one tuple.
 * The result is a matched timing-only scene, not full-board acceptance. */
export function* prepareSurfaceTimingBanks(
  fullNative: SimpleRouteJson,
  previous: FlexibleSignalState,
  matchedCheckpoint: FlexibleSignalState,
  options: PrepareSurfaceTimingBanksOptions = {},
): Generator<void, FlexibleSignalState | null> {
  const maxSteps = options.maxSteps ?? 200000,
    maxCandidates = options.maxCandidatesPerEscape ?? 16384
  if (
    !Number.isInteger(maxSteps) ||
    maxSteps <= 0 ||
    !Number.isInteger(maxCandidates) ||
    maxCandidates <= 0
  )
    return null
  try {
    return yield* runBoundedRouting(
      prepare(fullNative, previous, matchedCheckpoint, options, maxSteps),
      maxSteps,
    )
  } catch {
    return null
  }
}

function* prepare(
  fullNative: SimpleRouteJson,
  previous: FlexibleSignalState,
  checkpoint: FlexibleSignalState,
  options: PrepareSurfaceTimingBanksOptions,
  maxSteps: number,
): Generator<void, FlexibleSignalState | null> {
  const paired = new Set(
      fullNative.differentialPairs?.flatMap((pair) => pair.connectionNames),
    ),
    timing = new Set([
      ...(fullNative.buses?.flatMap((bus) => bus.connectionNames) ?? []),
      ...paired,
    ]),
    supplied = fullNative.traces ?? [],
    original = [...previous.retained, ...previous.traces],
    donor = [...checkpoint.retained, ...checkpoint.traces]
  if (
    !timing.size ||
    !ownershipIsUnambiguous(supplied, original, previous.escapes) ||
    !ownershipIsUnambiguous(supplied, donor, checkpoint.escapes)
  )
    return null
  let carriers = original.filter((trace) => timing.has(trace.connection_name!)),
    escapes = previous.escapes.filter((trace) =>
      timing.has(trace.connection_name!),
    )
  if (
    carriers.length !== timing.size ||
    new Set(carriers.map((trace) => trace.connection_name)).size !== timing.size
  )
    return null
  const native: SimpleRouteJson = {
    ...fullNative,
    connections: fullNative.connections.filter((connection) =>
      timing.has(connection.name),
    ),
    traces: supplied,
  }
  if (native.connections.length !== timing.size) return null
  if (
    (fullNative.buses ?? []).some((bus) =>
      [bus.minLength, bus.maxLength, bus.maxLengthSkew].some(
        (value) =>
          value !== undefined && (!Number.isFinite(value) || value < 0),
      ),
    ) ||
    (fullNative.differentialPairs ?? []).some(
      (pair) =>
        !Number.isFinite(pair.lengthTolerance) || pair.lengthTolerance < 0,
    )
  )
    return null
  const input = () => ({ ...native, traces: [...supplied, ...escapes] })
  const total = (trace: Trace, owned: Trace[]) =>
    length(joinSignalEscapes(trace, owned).route) +
    fixedRouteLength(fullNative, trace.connection_name!)
  const totals = new Map(
    carriers.map((trace) => [
      trace.connection_name!,
      total(
        trace,
        escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      ),
    ]),
  )
  const windows = new Map<string, { min: number; max: number }>()
  if (
    [...totals.values()].some((value) => !Number.isFinite(value) || value < 0)
  )
    return null
  for (const bus of fullNative.buses ?? []) {
    const anchors = bus.connectionNames
      .filter((name) => paired.has(name))
      .map((name) => totals.get(name)!)
    const anchor = anchors.length ? Math.max(...anchors) : undefined
    for (const name of bus.connectionNames) {
      if (paired.has(name)) continue
      const before = windows.get(name) ?? { min: 0, max: Infinity }
      windows.set(name, {
        min: Math.max(
          before.min,
          bus.minLength ?? 0,
          anchor !== undefined && bus.maxLengthSkew !== undefined
            ? anchor - bus.maxLengthSkew
            : 0,
        ),
        max: Math.min(
          before.max,
          bus.maxLength ?? Infinity,
          anchor !== undefined && bus.maxLengthSkew !== undefined
            ? anchor + bus.maxLengthSkew
            : Infinity,
        ),
      })
    }
  }
  if ([...windows.values()].some((window) => window.min > window.max + 1e-7))
    return null
  const outliers = new Set(
    carriers
      .filter(
        (trace) =>
          !paired.has(trace.connection_name!) &&
          totals.get(trace.connection_name!)! >
            (windows.get(trace.connection_name!)?.max ?? Infinity) + 1e-7,
      )
      .map((trace) => trace.connection_name!),
  )
  if (outliers.size) {
    const reports = [
      ...busLengthReports(
        { ...fullNative, traces: [...supplied, ...checkpoint.escapes] },
        donor,
      ),
      ...pairLengthReports(
        { ...fullNative, traces: [...supplied, ...checkpoint.escapes] },
        donor,
      ),
    ]
    if (
      reports.some(
        (report) =>
          (report.toleranceMm !== null && !report.matched) ||
          !report.withinLengthLimit ||
          !report.aboveMinimumLength,
      )
    )
      return null
  }
  yield
  // One replacement can free a legal donor for another outlier. Each tuple
  // still has to clear every other current timing member before it is adopted.
  while (outliers.size) {
    let changed = false
    for (const name of outliers) {
      const candidate = donor.find((trace) => trace.connection_name === name),
        own = checkpoint.escapes.filter(
          (trace) => trace.connection_name === name,
        ),
        window = windows.get(name)!,
        connection = native.connections.find(
          (connection) => connection.name === name,
        )!,
        others = carriers
          .filter((trace) => trace.connection_name !== name)
          .map((trace) =>
            joinSignalEscapes(
              trace,
              escapes.filter(
                (escape) => escape.connection_name === trace.connection_name,
              ),
            ),
          )
      if (
        candidate &&
        total(candidate, own) >= window.min - 1e-7 &&
        total(candidate, own) <= window.max + 1e-7 &&
        ownershipIsUnambiguous(
          supplied,
          [
            ...carriers.filter((trace) => trace.connection_name !== name),
            candidate,
          ],
          [
            ...escapes.filter((trace) => trace.connection_name !== name),
            ...own,
          ],
        ) &&
        tupleIsClear(fullNative, connection, candidate, own, others)
      ) {
        carriers = carriers.map((trace) =>
          trace.connection_name === name ? candidate : trace,
        )
        escapes = [
          ...escapes.filter((trace) => trace.connection_name !== name),
          ...own,
        ]
        outliers.delete(name)
        changed = true
      }
      yield
    }
    if (!changed) return null
  }
  try {
    const tuned = yield* tuneGeneratedOrdinaryEscapes(
      input(),
      carriers,
      escapes,
      {
        maxCandidatesPerEscape: options.maxCandidatesPerEscape ?? 16384,
      },
    )
    if (tuned) escapes = tuned.escapes
    return yield* finishSurfaceTiming(
      {
        native,
        pending: input(),
        escapes,
        retained: carriers.filter((trace) =>
          paired.has(trace.connection_name!),
        ),
        traces: carriers.filter((trace) => !paired.has(trace.connection_name!)),
      },
      options.solverOptions ?? { smoothTuning: true, denseSearch: true },
      { preserveTiming: true, maxSteps },
    )
  } catch {
    return null
  }
}

function ownershipIsUnambiguous(
  supplied: Trace[],
  carriers: Trace[],
  escapes: Trace[],
) {
  const owned = [...carriers, ...escapes],
    ids = new Set(owned.map((trace) => trace.pcb_trace_id))
  return (
    ids.size === owned.length &&
    supplied.every((trace) => !ids.has(trace.pcb_trace_id))
  )
}

function tupleIsClear(
  native: SimpleRouteJson,
  connection: Connection,
  carrier: Trace,
  escapes: Trace[],
  others: Trace[],
): boolean {
  const physical = getCopperLayerNames(native.layerCount),
    first = carrier.route[0],
    last = carrier.route.at(-1)
  if (
    first?.route_type !== "wire" ||
    last?.route_type !== "wire" ||
    carrier.route.length < 2 ||
    !signalLayers(native, connection).includes(first.layer) ||
    carrier.route.some(
      (point) => point.route_type !== "wire" || point.layer !== first.layer,
    )
  )
    return false
  const attached = new Set<Trace>()
  for (let end = 0; end < 2; end++) {
    const pad = connection.pointsToConnect[end],
      at = end ? last : first,
      escape = escapes.find((trace) => {
        const a = trace.route[0],
          b = trace.route.at(-1)
        return (
          a?.route_type === "wire" &&
          b?.route_type === "wire" &&
          a.layer === pad.layer &&
          distance(a, pad) < 1e-8 &&
          b.layer === at.layer &&
          distance(b, at) < 1e-8
        )
      })
    if (escape) attached.add(escape)
    else if (at.layer !== pad.layer || distance(at, pad) > 1e-8) return false
  }
  if (attached.size !== escapes.length) return false
  for (const trace of [carrier, ...escapes]) {
    if (
      trace.connection_name !== connection.name ||
      (trace.source_trace_id !== undefined &&
        trace.source_trace_id !==
          (connection.source_trace_id ?? connection.name))
    )
      return false
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index],
        before = trace.route[index - 1],
        after = trace.route[index + 1]
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
      if (point.route_type === "wire") {
        if (
          !physical.includes(point.layer) ||
          (point.layer !== first.layer &&
            !connection.pointsToConnect.some(
              (pad) => pad.layer === point.layer,
            )) ||
          !Number.isFinite(point.width) ||
          point.width < native.minTraceWidth - 1e-8 ||
          (after?.route_type === "wire" && point.layer !== after.layer)
        )
          return false
      } else {
        const from = physical.indexOf(point.from_layer),
          to = physical.indexOf(point.to_layer),
          required = native.allowBlindAndBuriedVias
            ? physical.slice(Math.min(from, to), Math.max(from, to) + 1)
            : physical
        if (
          from < 0 ||
          to < 0 ||
          from === to ||
          before?.route_type !== "wire" ||
          after?.route_type !== "wire" ||
          before.layer !== point.from_layer ||
          after.layer !== point.to_layer ||
          distance(before, point) > 1e-8 ||
          distance(after, point) > 1e-8 ||
          !point.layers ||
          point.layers.some((layer) => !physical.includes(layer)) ||
          !required.every((layer) => point.layers!.includes(layer)) ||
          !Number.isFinite(point.via_diameter) ||
          !Number.isFinite(point.via_hole_diameter) ||
          point.via_diameter! < (native.minViaPadDiameter ?? 0.3) - 1e-8 ||
          point.via_hole_diameter! <
            (native.minViaHoleDiameter ?? 0.15) - 1e-8 ||
          point.via_hole_diameter! <= 0 ||
          point.via_hole_diameter! > point.via_diameter!
        )
          return false
        if (
          native.connections.some((other) =>
            other.pointsToConnect.some((pad) => distance(point, pad) <= 1e-6),
          )
        )
          return false
      }
    }
  }
  const joined = joinSignalEscapes(carrier, escapes),
    hardTraces = [...(native.traces ?? []), ...others],
    input = { ...native, traces: hardTraces },
    hard = fixedCopper(input),
    owners = new Set([
      connection.name,
      connection.source_trace_id ?? connection.name,
    ]),
    clearance =
      native.minTraceToPadEdgeClearance ??
      native.defaultObstacleMargin ??
      0.075,
    copper = fixedCopper({ ...native, obstacles: [], traces: [joined] })
  if (
    !routeAnglesAreConventional([joined]) ||
    surfaceBridgeSelfShorts(native, connection, joined) ||
    new CopperConflictIndex().firstConflict(
      copper,
      hard.filter((item) => !item.owners.some((owner) => owners.has(owner))),
      clearance - 1e-8,
    ) ||
    generatedEscapeHolesConflict(native, escapes, hardTraces) ||
    escapes.some((trace, index) =>
      generatedEscapeHolesConflict(native, [trace], escapes.slice(index + 1)),
    )
  )
    return false
  const runs: Wire[][] = []
  for (const point of joined.route) {
    if (point.route_type !== "wire") {
      runs.push([])
      continue
    }
    let run = runs.at(-1)
    if (!run || (run.length && run[0].layer !== point.layer))
      runs.push((run = []))
    run.push(point)
  }
  return (
    copper.every((item) =>
      [item.a, item.b].every((point) => {
        const margin = item.radius + (native.minBoardEdgeClearance ?? 0)
        return (
          point.x >= native.bounds.minX + margin - 1e-8 &&
          point.x <= native.bounds.maxX - margin + 1e-8 &&
          point.y >= native.bounds.minY + margin - 1e-8 &&
          point.y <= native.bounds.maxY - margin + 1e-8
        )
      }),
    ) &&
    runs.every(
      (run) =>
        run.length < 2 ||
        (tuningPathIsSelfClear(run, run[0].width + clearance) &&
          new VectorScene(
            input,
            {
              ...connection,
              pointsToConnect: connection.pointsToConnect.map((point) => ({
                ...point,
                layer: run[0].layer,
              })),
            },
            run[0].width,
            hard,
          ).pathVisible(run)),
    )
  )
}
