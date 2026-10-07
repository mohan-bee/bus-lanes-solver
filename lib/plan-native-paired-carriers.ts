import { BusLanesSolver } from "./bus-lanes-solver"
import { offsetPath } from "./coupled-pair-routing"
import { CopperConflictIndex } from "./copper-conflict-index"
import { length } from "./geometry"
import { GridHistoryProjector } from "./grid-visibility"
import { joinSignalEscapes } from "./join-signal-escapes"
import { NativeCarrierRouter } from "./native-carrier-router"
import { packageApproachRegions, pointInBox } from "./package-approach-regions"
import { chamferOrdinaryCorners } from "./chamfer-ordinary-corners"
import { fixedCopper, VectorScene } from "./vector-scene"
import type { Connection, Point, SimpleRouteJson, Trace } from "./types"

export interface NativePairedCarrierOptions {
  /** One centerline per differential pair, in the input pair order. */
  centerlines?: Point[][]
  busTargetLength?: number
  gridStep?: number
  maxApproachPasses?: number
  maxExpansionsPerRoute?: number
}

function nativeClearance(input: SimpleRouteJson) {
  return (
    input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
  )
}
function pairedFieldMargin(input: SimpleRouteJson) {
  return (
    input.minTraceWidth +
    Math.max(
      ...input.differentialPairs!.map(
        (p) => p.traceGap ?? nativeClearance(input),
      ),
    ) /
      2 +
    nativeClearance(input)
  )
}

/** Flare paired backbones at the larger package so ordinary signals retain
 * pad escape space. Axis-aligned packages use their immutable copper fields;
 * callers can provide octilinear centerlines for other arrangements. */
function defaultCenterlines(native: SimpleRouteJson, step: number): Point[][] {
  const pairs = native.differentialPairs!,
    regions = packageApproachRegions(native, pairedFieldMargin(native))
  const connection = native.connections.find(
    (c) => c.name === pairs[0].connectionNames[0],
  )!
  const source = regions.find((r) =>
    pointInBox(connection.pointsToConnect[0], r.pads),
  )!
  const target = regions.find((r) =>
    pointInBox(connection.pointsToConnect[1], r.pads),
  )!
  if (!source || !target || source === target)
    throw Error("Native paired routing needs two distinct packages")
  const center = (b: SimpleRouteJson["bounds"]) => ({
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  })
  const a = center(source.pads),
    b = center(target.pads),
    distance = Math.hypot(a.x - b.x, a.y - b.y)
  const forward = { x: (b.x - a.x) / distance, y: (b.y - a.y) / distance },
    normal = { x: -forward.y, y: forward.x }
  if (Math.abs(forward.x) > 1e-8 && Math.abs(forward.y) > 1e-8)
    throw Error("Provide paired centerlines for diagonal native packages")
  const projection = (box: SimpleRouteJson["bounds"], u: Point) =>
    [box.minX, box.maxX].flatMap((x) =>
      [box.minY, box.maxY].map((y) => x * u.x + y * u.y),
    )
  const quantize = (n: number) =>
    Number((Math.round(n / step) * step).toFixed(8))
  const out = Number(
    (
      Math.floor(Math.max(...projection(source.copper, forward)) / step) * step
    ).toFixed(8),
  )
  const incoming = Number(
    (
      Math.ceil(Math.min(...projection(target.copper, forward)) / step) * step
    ).toFixed(8),
  )
  const sourceCenter = a.x * normal.x + a.y * normal.y,
    targetCenter = b.x * normal.x + b.y * normal.y
  const sourceSpread = quantize(
    Math.max(
      0,
      (Math.max(...projection(source.copper, normal)) -
        Math.min(...projection(source.copper, normal))) /
        2 -
        12 * native.minTraceWidth,
    ),
  )
  const targetSpread = quantize(
    Math.max(
      0,
      (Math.max(...projection(target.copper, normal)) -
        Math.min(...projection(target.copper, normal))) /
        2 -
        3 * native.minTraceWidth,
    ),
  )
  const order = pairs
    .map((pair, i) => ({
      i,
      lateral:
        pair.connectionNames.reduce((sum, name) => {
          const p = native.connections.find((c) => c.name === name)!
            .pointsToConnect[0]
          return sum + p.x * normal.x + p.y * normal.y
        }, 0) / 2,
    }))
    .sort((a, b) => b.lateral - a.lateral)
  const position = (u: number, v: number) => ({
    x: quantize(normal.x * u + forward.x * v),
    y: quantize(normal.y * u + forward.y * v),
  })
  return pairs.map((_, i) => {
    const rank = order.findIndex((p) => p.i === i),
      fraction = pairs.length === 1 ? 0 : 1 - (2 * rank) / (pairs.length - 1)
    const first = quantize(sourceCenter + fraction * sourceSpread),
      last = quantize(targetCenter + fraction * targetSpread)
    if (Math.abs(first - last) < 1e-8)
      return [position(first, out), position(last, incoming)]
    const stem = 12 * native.minTraceWidth,
      diagonal = Math.abs(first - last)
    return [
      position(first, out),
      position(first, out + stem),
      position(last, out + stem + diagonal),
      position(last, incoming),
    ]
  })
}

export function* planNativePairedCarriers(
  native: SimpleRouteJson,
  options: NativePairedCarrierOptions = {},
  progress?: (stage: string) => void,
): Generator<void, Trace[] | null> {
  const pairs = native.differentialPairs ?? [],
    carrier = native.allowedLayers![0],
    step = options.gridStep ?? native.minTraceWidth
  if (!pairs.length) return []
  const centers = options.centerlines ?? defaultCenterlines(native, step)
  if (centers.length !== pairs.length)
    throw Error("Supply exactly one backbone for each differential pair")
  const regions = packageApproachRegions(native, pairedFieldMargin(native)),
    pairedNames = new Set(pairs.flatMap((p) => p.connectionNames))
  const legs: Connection[] = [],
    trunks: Trace[] = [],
    legRegions = new Map<string, SimpleRouteJson["bounds"]>()
  for (let i = 0; i < pairs.length; i++)
    for (let rail = 0; rail < 2; rail++) {
      const pair = pairs[i],
        name = pair.connectionNames[rail],
        c = native.connections.find((c) => c.name === name)!
      const path = offsetPath(
        centers[i],
        ((rail ? 1 : -1) * (native.minTraceWidth + (pair.traceGap ?? 0.1))) / 2,
      )
      trunks.push({
        type: "pcb_trace",
        pcb_trace_id: `trunk_${name}`,
        connection_name: name,
        source_trace_id: c.source_trace_id,
        route: path.map((p) => ({
          ...p,
          route_type: "wire",
          layer: carrier,
          width: native.minTraceWidth,
        })),
      })
      for (let side = 0; side < 2; side++) {
        const point = c.pointsToConnect[side],
          end = path[side ? path.length - 1 : 0],
          region = regions.find((r) => pointInBox(point, r.pads))
        if (!region || !pointInBox(end, region.copper))
          throw Error(
            "Paired handoffs must lie inside native package copper fields",
          )
        const legName = `${name}_${side}`
        legs.push({
          ...c,
          name: legName,
          source_trace_id: c.source_trace_id ?? name,
          pointsToConnect: [point, { ...end, layer: carrier }],
        })
        legRegions.set(legName, region.copper)
      }
    }
  const reservations = native.connections
    .filter((c) => !pairedNames.has(c.name))
    .flatMap((c) =>
      c.pointsToConnect.map((p) => ({
        type: "rect",
        shape: "circle" as const,
        center: { x: p.x, y: p.y },
        width: 4 * native.minTraceWidth,
        height: 4 * native.minTraceWidth,
        layers: [carrier],
        connectedTo: [c.name, c.source_trace_id ?? c.name],
      })),
    )
  const input = {
    ...native,
    obstacles: [...native.obstacles, ...reservations],
    traces: [...(native.traces ?? []), ...trunks],
    connections: legs,
  }
  const fixed = fixedCopper(input),
    projector = new GridHistoryProjector(
      new VectorScene(input, legs[0], native.minTraceWidth, fixed),
      { bounds: input.bounds, step },
    )
  const history = [
      new Float32Array(projector.cellCount),
      new Float32Array(projector.cellCount),
    ],
    router = new NativeCarrierRouter(input, step, history),
    routed = new Map<string, Trace>(),
    index = new CopperConflictIndex()
  const copper = (t: Trace) =>
    fixedCopper({ ...input, obstacles: [], traces: [t] })
  let trouble = new Map<string, number>(),
    clear = false
  progress?.("native_pair_approaches")
  for (let pass = 0; pass < (options.maxApproachPasses ?? 300); pass++) {
    for (const c of [...legs].sort(
      (a, b) => (trouble.get(b.name) ?? 0) - (trouble.get(a.name) ?? 0),
    )) {
      if (pass >= 12 && !trouble.has(c.name)) continue
      routed.delete(c.name)
      const search = {
        softTraces: [...routed.values()],
        softPenalty: 5 + pass * 5,
        carrierRegion: legRegions.get(c.name),
        maxExpansions: options.maxExpansionsPerRoute,
      }
      const candidate =
        (pass >= 12
          ? yield* router.route(c, { ...search, strict: true })
          : null) ?? (yield* router.route(c, search))
      if (!candidate) return null
      routed.set(c.name, candidate.trace)
    }
    const all = [...routed.values()],
      physical = all.map(copper)
    trouble = new Map()
    for (let a = 0; a < all.length; a++)
      for (let b = 0; b < a; b++) {
        const hit = index.firstConflict(
          physical[a],
          physical[b],
          nativeClearance(native) - 1e-8,
        )
        if (!hit) continue
        for (const t of [all[a], all[b]])
          trouble.set(
            t.connection_name!,
            (trouble.get(t.connection_name!) ?? 0) + 1,
          )
        const [first, second] = hit,
          plane = first.layer === carrier ? 1 : 0
        projector.penalizeIntersection(
          history[plane],
          first.a,
          first.b,
          second.a,
          second.b,
          first.radius + second.radius + nativeClearance(native),
          true,
          2,
        )
      }
    if (!trouble.size) {
      clear = true
      break
    }
    yield
  }
  if (!clear) return null
  // Choose a manufactured CPU via whose actual owned approach balances the
  // pair before residual package-only tuning. It never edits fixed power.
  for (const pair of pairs) {
    const totals = pair.connectionNames.map(
      (name) =>
        length(routed.get(`${name}_0`)!.route) +
        length(routed.get(`${name}_1`)!.route),
    )
    if (Math.abs(totals[0] - totals[1]) <= 0.1) continue
    const short = totals[0] < totals[1] ? 0 : 1,
      name = pair.connectionNames[short],
      c = legs.find((c) => c.name === `${name}_0`)!,
      old = routed.get(c.name)!
    const desired = totals[1 - short] - length(routed.get(`${name}_1`)!.route),
      point = c.pointsToConnect[0],
      box = legRegions.get(c.name)!,
      candidates: Point[] = []
    const estimate = (p: Point) =>
      Math.hypot(p.x - point.x, p.y - point.y) +
      Math.hypot(p.x - c.pointsToConnect[1].x, p.y - c.pointsToConnect[1].y)
    for (
      let x = Math.ceil(box.minX / step);
      x <= Math.floor(box.maxX / step);
      x++
    )
      for (
        let y = Math.ceil((box.minY + 0.01) / step);
        y <= Math.floor(Math.min(box.maxY, point.y + 0.2) / step);
        y++
      ) {
        const p = { x: x * step, y: y * step },
          lower = estimate(p)
        if (lower <= desired + 0.3 && lower >= desired - 0.7) candidates.push(p)
      }
    candidates.sort(
      (a, b) =>
        Math.abs(estimate(a) - desired) - Math.abs(estimate(b) - desired),
    )
    let best = old,
      error = Infinity
    routed.delete(c.name)
    for (const p of candidates.slice(0, 200)) {
      const candidate = yield* router.route(c, {
        softTraces: [...routed.values()],
        softPenalty: 30,
        strict: true,
        forcedVia: p,
        carrierRegion: box,
        maxExpansions: options.maxExpansionsPerRoute,
      })
      if (!candidate) continue
      const delta = Math.abs(length(candidate.trace.route) - desired)
      if (delta < error) {
        best = candidate.trace
        error = delta
      }
      if (delta < 0.09) break
    }
    routed.set(c.name, best)
  }
  const full: Trace[] = [],
    escapes: Trace[] = [],
    carriers: Trace[] = [],
    connections: Connection[] = []
  for (const pair of pairs)
    for (const name of pair.connectionNames) {
      const c = native.connections.find((c) => c.name === name)!,
        a = routed.get(`${name}_0`)!,
        b = routed.get(`${name}_1`)!,
        trunk = trunks.find((t) => t.connection_name === name)!
      const suffix = b.route
        .toReversed()
        .map((p) =>
          p.route_type === "via"
            ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
            : p,
        )
      const t: Trace = {
        type: "pcb_trace",
        pcb_trace_id: `pair_${name}`,
        connection_name: name,
        source_trace_id: c.source_trace_id,
        route: [...a.route, ...trunk.route.slice(1), ...suffix.slice(1)],
        coupledSection: [
          a.route.length - 1,
          a.route.length + trunk.route.length - 2,
        ],
      }
      full.push(t)
      const [first, last] = t.route.flatMap((p, i) =>
          p.route_type === "via" ? [i] : [],
        ),
        route = t.route.slice(first + 1, last)
      carriers.push({
        ...t,
        route,
        coupledSection: t.coupledSection!.map((i) => i - first - 1) as [
          number,
          number,
        ],
      })
      escapes.push(
        {
          ...t,
          pcb_trace_id: `generated_escape_${name}_0`,
          route: t.route.slice(0, first + 2),
          coupledSection: undefined,
        },
        {
          ...t,
          pcb_trace_id: `generated_escape_${name}_1`,
          route: t.route
            .slice(last - 1)
            .toReversed()
            .map((p) =>
              p.route_type === "via"
                ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
                : p,
            ),
          coupledSection: undefined,
        },
      )
      connections.push({
        ...c,
        pointsToConnect: [
          { ...route[0], layer: carrier },
          { ...route.at(-1)!, layer: carrier },
        ],
      })
    }
  const pairedInput = {
    ...native,
    obstacles: input.obstacles,
    connections,
    traces: [...(native.traces ?? []), ...escapes],
    buses: [],
  }
  const clean = chamferOrdinaryCorners(
    pairedInput,
    carriers,
    fixedCopper(pairedInput),
    0.125,
  )
  const solver = BusLanesSolver.forRefinement(pairedInput, clean, {
    smoothTuning: true,
    denseSearch: true,
    originalCorridorTuningCandidates: 65536,
    maxSearchIterations: 1_000_000,
  })
  progress?.("native_pair_matching")
  try {
    while (!solver.solved && !solver.failed) {
      solver.step()
      yield
    }
  } finally {
    if (!solver.solved) solver.tryFinalAcceptance()
  }
  if (!solver.solved) return null
  const total = solver.traces.map((t) =>
    length(
      joinSignalEscapes(
        t,
        escapes.filter((e) => e.connection_name === t.connection_name),
      ).route,
    ),
  )
  const longest = Math.max(...total)
  const target =
    options.busTargetLength ?? Math.max(longest, Math.ceil(longest * 1.15))
  const targets = (native.buses ?? []).flatMap((bus) =>
    pairs
      .filter((p) =>
        p.connectionNames.every((n) => bus.connectionNames.includes(n)),
      )
      .map((pair) => ({
        busId: `native_${bus.busId}`,
        connectionNames: pair.connectionNames,
        minLength: Math.max(target, bus.minLength ?? 0),
        maxLengthSkew: pair.lengthTolerance,
      })),
  )
  const bankInput = { ...pairedInput, buses: targets }
  const matcher = BusLanesSolver.forRefinement(bankInput, solver.traces, {
    smoothTuning: true,
    denseSearch: true,
    originalCorridorTuningCandidates: 65536,
  })
  try {
    while (!matcher.solved && !matcher.failed) {
      matcher.step()
      yield
    }
  } finally {
    if (!matcher.solved) matcher.tryFinalAcceptance()
  }
  if (!matcher.solved) return null
  return matcher.traces.map((t) =>
    joinSignalEscapes(
      t,
      escapes.filter((e) => e.connection_name === t.connection_name),
    ),
  )
}
