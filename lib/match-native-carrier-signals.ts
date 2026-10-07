import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { CopperConflictIndex } from "./copper-conflict-index"
import { length, segmentDistance } from "./geometry"
import { GridHistoryProjector } from "./grid-visibility"
import { NativeCarrierRouter } from "./native-carrier-router"
import {
  cleanNativeCarrierSignal,
  tuneNativeCarrierSignal,
} from "./native-carrier-tuning"
import { busLengthReports, pairLengthReports } from "./route-lengths"
import { pairCouplingReports } from "./pair-coupling"
import { exteriorPairSpacingReports } from "./exterior-pair-spacing"
import { sharedPairSpacingReports } from "./shared-pair-spacing"
import { nativeSignalGeometryIsValid } from "./native-signal-geometry"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"

export interface NativeCarrierMatchingOptions {
  /** Genuine native owners of immutable copper, excluded from routing requests. */
  fixedConnections?: Connection[]
  gridStep?: number
  fineGridStep?: number
  maxPasses?: number
  maxLocalPasses?: number
  maxExpansionsPerRoute?: number
  /** Bound speculative hard-only repairs; soft negotiation retains its full budget. */
  maxStrictExpansionsPerRoute?: number
}
export interface NativeCarrierProgress {
  stage: string
  pass: number
  collisions: number
  unfinished: string[]
  traces: Trace[]
}
interface State {
  traces: Trace[]
  collisions: number
  unfinished: string[]
}

/** Matched carriers and controllers negotiate together. A clear but unmatched
 * state is never accepted; matching banks participate in the physical conflict
 * graph alongside TOP escapes and all four plated via lands. */
export function* matchNativeCarrierSignals(
  original: SimpleRouteJson,
  paired: Trace[],
  options: NativeCarrierMatchingOptions = {},
  progress?: (state: NativeCarrierProgress) => void,
  initial: Trace[] = [],
): Generator<void, Trace[] | null> {
  const pairedNames = new Set(paired.map((t) => t.connection_name))
  const input: SimpleRouteJson = {
    ...original,
    connections: original.connections.filter((c) => !pairedNames.has(c.name)),
    traces: [...(original.traces ?? []), ...paired],
  }
  if (!input.connections.length) return paired
  const minimums = new Map<string, number>(),
    maximums = new Map<string, number>()
  for (const bus of original.buses ?? []) {
    const anchors = paired.filter((t) =>
      bus.connectionNames.includes(t.connection_name!),
    )
    if (!anchors.length)
      throw Error(
        `Native matching bus ${bus.busId} needs a paired length anchor`,
      )
    const ceiling = Math.min(
      Math.max(...anchors.map((t) => length(t.route))),
      bus.maxLength ?? Infinity,
    )
    const floor = Math.max(
      bus.minLength ?? 0,
      ceiling - (bus.maxLengthSkew ?? 0),
    )
    for (const name of bus.connectionNames) {
      maximums.set(name, Math.min(maximums.get(name) ?? Infinity, ceiling))
      minimums.set(name, Math.max(minimums.get(name) ?? 0, floor))
    }
  }
  const clearance =
    original.minTraceToPadEdgeClearance ??
    original.defaultObstacleMargin ??
    0.075
  const index = new CopperConflictIndex()
  const physical = (t: Trace) =>
    fixedCopper({ ...original, obstacles: [], traces: [t] })
  const graph = (traces: Trace[]) => {
    const copper = traces.map(physical),
      hits: Array<
        [
          number,
          number,
          NonNullable<ReturnType<CopperConflictIndex["firstConflict"]>>,
        ]
      > = []
    for (let a = 0; a < traces.length; a++)
      for (let b = 0; b < a; b++) {
        const hit = index.firstConflict(copper[a], copper[b], clearance - 1e-8)
        if (hit) hits.push([a, b, hit])
      }
    return hits
  }
  const unfinished = (traces: Trace[]) =>
    traces
      .filter(
        (t) =>
          !nativeSignalGeometryIsValid(t) ||
          (minimums.has(t.connection_name!) &&
            (length(t.route) < minimums.get(t.connection_name!)! - 1e-7 ||
              length(t.route) > maximums.get(t.connection_name!)! + 1e-7)),
      )
      .map((t) => t.connection_name!)
  const valid = (traces: Trace[]) => {
    const complete = [...paired, ...traces]
    if (
      complete.length !== original.connections.length ||
      !complete.every(nativeSignalGeometryIsValid)
    )
      return false
    if (
      busLengthReports(original, complete).some(
        (b) =>
          !b.aboveMinimumLength ||
          !b.withinLengthLimit ||
          (b.toleranceMm !== null && !b.matched),
      )
    )
      return false
    if (pairLengthReports(original, complete).some((p) => !p.matched))
      return false
    if (
      sharedPairSpacingReports(original, complete).some((p) => !p.matched) ||
      exteriorPairSpacingReports(original, complete).some((p) => !p.matched)
    )
      return false
    if (pairCouplingReports(original, complete).some((p) => !p.matched))
      return false
    const validationInput = {
      ...original,
      connections: [
        ...original.connections,
        ...(options.fixedConnections ?? []),
      ],
    }
    return validateRoutedCopperDrc({
      inputSrj: validationInput,
      routedSrj: {
        ...validationInput,
        traces: [...(original.traces ?? []), ...complete],
      },
      clearance,
      allowBlindAndBuriedVias: false,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0]).valid
  }
  function* negotiate(
    seed: Trace[],
    frozen: Trace[],
    step: number,
    passes: number,
    stage: string,
  ): Generator<void, State | null> {
    const frozenNames = new Set(frozen.map((t) => t.connection_name))
    const local = {
      ...input,
      connections: input.connections.filter((c) => !frozenNames.has(c.name)),
      traces: [...input.traces!, ...frozen],
    }
    if (!local.connections.length)
      return { traces: frozen, collisions: 0, unfinished: unfinished(frozen) }
    const fixed = fixedCopper(local),
      projector = new GridHistoryProjector(
        new VectorScene(
          local,
          local.connections[0],
          local.minTraceWidth,
          fixed,
        ),
        { bounds: local.bounds, step },
      )
    const history = [
        new Float32Array(projector.cellCount),
        new Float32Array(projector.cellCount),
      ],
      router = new NativeCarrierRouter(local, step, history)
    const routed = new Map(
      seed
        .filter((t) => !frozenNames.has(t.connection_name))
        .map((t) => [t.connection_name!, t]),
    )
    let trouble = new Map<string, number>(),
      best: State | null = null,
      bestMetric = Infinity,
      stale = 0
    for (let pass = 0; pass < passes; pass++) {
      for (const c of [...local.connections].sort(
        (a, b) => (trouble.get(b.name) ?? 0) - (trouble.get(a.name) ?? 0),
      )) {
        if (pass >= 2 && !trouble.has(c.name)) continue
        const old = routed.get(c.name)
        routed.delete(c.name)
        const others = [...routed.values()],
          maximum = maximums.get(c.name) ?? Infinity
        let candidate: Trace | null = null
        const search = {
          softTraces: others,
          softPenalty: 5 + pass * 5,
          maxLength: maximum,
          maxExpansions: options.maxExpansionsPerRoute,
        }
        if (pass >= 1) {
          const strict = yield* router.route(c, {
            ...search,
            strict: true,
            maxExpansions: Math.min(
              options.maxStrictExpansionsPerRoute ?? 300000,
              options.maxExpansionsPerRoute ?? 1500000,
            ),
          })
          if (strict) {
            const hard = { ...local, traces: [...local.traces!, ...others] }
            const t = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  hard,
                  c,
                  strict.trace,
                  minimums.get(c.name)!,
                  maximum,
                  [],
                )
              : cleanNativeCarrierSignal(hard, c, strict.trace, [], true)
            if (
              t &&
              others.every(
                (other) =>
                  !index.firstConflict(
                    physical(t),
                    physical(other),
                    clearance - 1e-8,
                  ),
              )
            )
              candidate = t
          }
        }
        if (!candidate) {
          const raw = yield* router.route(c, search)
          if (raw) {
            candidate = minimums.has(c.name)
              ? tuneNativeCarrierSignal(
                  local,
                  c,
                  raw.trace,
                  minimums.get(c.name)!,
                  maximum,
                  others,
                  raw.bankCost,
                )
              : cleanNativeCarrierSignal(local, c, raw.trace, others, true)
            // An honest provisional path supplies connectivity for later
            // repairs when its first bank cannot fit. It is still unfinished.
            if (!candidate && !old) candidate = raw.trace
          }
        }
        if (candidate) routed.set(c.name, candidate)
        else if (old) routed.set(c.name, old)
        else return null
        yield
      }
      const all = [...routed.values()],
        hits = graph(all)
      trouble = new Map()
      for (const [a, b, [first, second]] of hits) {
        for (const t of [all[a], all[b]])
          trouble.set(
            t.connection_name!,
            (trouble.get(t.connection_name!) ?? 0) + 1,
          )
        const plane = first.layer === input.allowedLayers![0] ? 1 : 0
        if (first.layer === "top" || plane === 1)
          projector.penalizeIntersection(
            history[plane],
            first.a,
            first.b,
            second.a,
            second.b,
            first.radius + second.radius + clearance,
            true,
            10,
          )
      }
      const missing = unfinished(all)
      for (const name of missing)
        trouble.set(name, (trouble.get(name) ?? 0) + 1)
      const state = {
          traces: [...frozen, ...all],
          collisions: hits.length,
          unfinished: missing,
        },
        metric = hits.length + 20 * missing.length
      progress?.({
        ...state,
        stage,
        pass,
        traces: [...paired, ...state.traces],
      })
      if (metric < bestMetric) {
        bestMetric = metric
        best = structuredClone(state)
        stale = 0
      } else stale++
      if (!hits.length && !missing.length) return state
      if (stale >= 5 && best && metric > bestMetric) {
        routed.clear()
        for (const t of best.traces)
          if (!frozenNames.has(t.connection_name))
            routed.set(t.connection_name!, t)
        trouble = new Map([...routed.keys()].map((n) => [n, 1]))
        stale = 0
      }
      if (
        stage === "native_global_matching" &&
        best &&
        !best.unfinished.length &&
        best.collisions <= 6 &&
        stale >= 2
      )
        break
      yield
    }
    return best
  }
  const firstState = yield* negotiate(
    initial,
    [],
    options.gridStep ?? original.minTraceWidth,
    options.maxPasses ?? 48,
    "native_global_matching",
  )
  if (!firstState) return null
  let state: State = firstState
  if (!state.collisions && !state.unfinished.length && valid(state.traces))
    return [...paired, ...state.traces]
  for (let repair = 0; repair < 6; repair++) {
    const closure = new Set<string>(),
      hits = graph(state.traces)
    for (const [a, b] of hits) {
      closure.add(state.traces[a].connection_name!)
      closure.add(state.traces[b].connection_name!)
    }
    for (const name of state.unfinished) closure.add(name)
    if (repair > 0) {
      const mouths = input.connections
        .filter((c) => closure.has(c.name))
        .flatMap((c) => c.pointsToConnect)
      const crossings = hits.map(([, , [a, b]]) => ({
        x: (a.a.x + a.b.x + b.a.x + b.b.x) / 4,
        y: (a.a.y + a.b.y + b.a.y + b.b.y) / 4,
      }))
      for (const t of state.traces) {
        if (closure.has(t.connection_name!)) continue
        if (
          physical(t).some(
            (w) =>
              w.layer === input.allowedLayers![0] &&
              (mouths.some(
                (p) =>
                  segmentDistance([p, p], [w.a, w.b]) < w.radius + 0.5 * repair,
              ) ||
                crossings.some(
                  (p) =>
                    segmentDistance([p, p], [w.a, w.b]) <
                    w.radius + 0.4 * (repair - 1),
                )),
          )
        )
          closure.add(t.connection_name!)
      }
    }
    const frozen = state.traces.filter((t) => !closure.has(t.connection_name!))
    const next: State | null = yield* negotiate(
      state.traces,
      frozen,
      options.fineGridStep ?? original.minTraceWidth / 2,
      options.maxLocalPasses ?? 48,
      `native_local_matching_${repair}`,
    )
    if (
      next &&
      next.collisions + 20 * next.unfinished.length <=
        state.collisions + 20 * state.unfinished.length
    )
      state = next
    if (!state.collisions && !state.unfinished.length && valid(state.traces))
      return [...paired, ...state.traces]
  }
  return null
}
