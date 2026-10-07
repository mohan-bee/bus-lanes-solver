import { ordinaryRunCandidates } from "./simplify-matched-traces"
import { checkSignalSelfShorts } from "./check-signal-self-shorts"
import type { GraphicsObject } from "graphics-debug"
import { layerColor } from "./layer-colors"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  getCopperLayerNames,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import {
  GridVisibilitySearch,
  GridHistoryProjector,
  type GridRoutingAccess,
} from "./grid-visibility"
import { GridHeap } from "./grid-heap"
import { fixedCopper, VectorScene } from "./vector-scene"
import { CopperConflictIndex } from "./copper-conflict-index"
import { length, simplify } from "./geometry"
import { busLengthReports, pairLengthReports } from "./route-lengths"
import type { Trace, Connection, Point, Wire, SimpleRouteJson } from "./types"

export interface SingleLayerConnectivityOptions {
  /** Original connections owning supplied immutable copper not in the routing requests. */
  fixedConnections?: Connection[]
  gridStep?: number
  maxPasses?: number
  maxExpansionsPerRoute?: number
}

/** Routes top-layer terminals through two plated vias onto one signal carrier.
 * This connectivity stage does not enforce bus timing or differential coupling.
 * Its solved flag means complete connectivity and copper DRC, never DDR acceptance.
 * Use BusLanesPipelineSolver when length matching and coupled pairs are required.
 */
export class SingleLayerConnectivitySolver extends BaseSolver {
  readonly input: SimpleRouteJson
  readonly options: SingleLayerConnectivityOptions
  traces: Trace[] = []
  phase = "routing"
  private task: Generator<void, Trace[]>
  constructor(
    input: SimpleRouteJson,
    options: SingleLayerConnectivityOptions = {},
  ) {
    super()
    this.input = structuredClone(input)
    this.options = structuredClone(options)
    this.MAX_ITERATIONS = 5_000_000
    if (input.allowedLayers?.length !== 1 || input.allowedLayers[0] === "top")
      throw Error("Specify exactly one non-top signal carrier in allowedLayers")
    if (
      input.connections.some(
        (c) =>
          c.pointsToConnect.length !== 2 ||
          c.pointsToConnect.some((p) => p.layer !== "top"),
      )
    )
      throw Error(
        "Single-layer connectivity requires two top-layer terminals per connection",
      )
    if (
      input.connections.some(
        (c) =>
          (c.nominalTraceWidth &&
            c.nominalTraceWidth !== input.minTraceWidth) ||
          (c.width && c.width !== input.minTraceWidth),
      )
    )
      throw Error("Single-layer connectivity requires uniform signal widths")
    for (const [name, value] of Object.entries({
      gridStep: options.gridStep ?? input.minTraceWidth,
      maxExpansionsPerRoute: options.maxExpansionsPerRoute ?? 1_500_000,
    })) {
      if (!Number.isFinite(value) || value <= 0)
        throw Error(`${name} must be positive and finite`)
    }
    if (
      !Number.isInteger(options.maxPasses ?? 300) ||
      (options.maxPasses ?? 300) < 0
    )
      throw Error("maxPasses must be a nonnegative integer")
    if (input.outline?.length)
      throw Error("Single-layer connectivity supports rectangular bounds")
    if (
      input.buses?.some(
        (b) =>
          b.traceWidth !== undefined && b.traceWidth !== input.minTraceWidth,
      )
    )
      throw Error("Single-layer connectivity requires uniform bus widths")
    if (
      input.buses?.some(
        (b) =>
          b.allowedLayers && !b.allowedLayers.includes(input.allowedLayers![0]),
      )
    )
      throw Error("A bus excludes the selected carrier layer")
    const owners = new Set(
      [...input.connections, ...(options.fixedConnections ?? [])].map(
        (c) => c.name,
      ),
    )
    if (
      input.traces?.some(
        (t) => !t.connection_name || !owners.has(t.connection_name),
      )
    )
      throw Error(
        "Supply fixedConnections for all immutable traces not owned by routing requests",
      )
    if (
      input.traces?.some((t) =>
        input.connections.some((c) => c.name === t.connection_name),
      )
    )
      throw Error(
        "Requested signals must not already contain fixed route fragments",
      )
    this.task = this.routeAll()
  }
  getConstructorParams() {
    return [this.input, this.options]
  }
  getOutput() {
    if (!this.solved)
      throw Error(this.error ?? "Single-layer connectivity is not solved")
    return {
      ...this.input,
      traces: [...(this.input.traces ?? []), ...this.traces],
    }
  }
  getLengthReports() {
    if (!this.solved)
      throw Error("Length reports require completed connectivity")
    return {
      buses: busLengthReports(this.input, this.traces),
      pairs: pairLengthReports(this.input, this.traces),
    }
  }
  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      title: `Single-layer connectivity · ${this.phase} · matching not enforced`,
      coordinateSystem: "cartesian",
      lines: [],
      circles: [],
      rects: [],
    }
    for (const copper of fixedCopper({
      ...this.input,
      traces: [...(this.input.traces ?? []), ...this.traces],
    })) {
      const color = layerColor(copper.layer)
      if (copper.rect)
        graphics.rects!.push({
          center: {
            x: (copper.rect.minX + copper.rect.maxX) / 2,
            y: (copper.rect.minY + copper.rect.maxY) / 2,
          },
          width: copper.rect.maxX - copper.rect.minX,
          height: copper.rect.maxY - copper.rect.minY,
          layer: copper.layer,
          fill: `${color}30`,
          stroke: color,
        })
      else if (
        Math.hypot(copper.a.x - copper.b.x, copper.a.y - copper.b.y) < 1e-9
      )
        graphics.circles!.push({
          center: copper.a,
          radius: copper.radius,
          layer: copper.layer,
          fill: "transparent",
          stroke: color,
        })
      else
        graphics.lines!.push({
          points: [copper.a, copper.b],
          strokeWidth: copper.radius * 2,
          strokeColor: color,
          layer: copper.layer,
        })
    }
    return graphics
  }
  _step() {
    try {
      const next = this.task.next()
      if (next.done) {
        this.traces = next.value
        this.phase = "complete"
        this.solved = true
      }
    } catch (error) {
      this.task.return([])
      this.failed = true
      this.phase = "failed"
      this.error = String(error)
    }
  }
  private *routeAll(): Generator<void, Trace[]> {
    const input = this.input,
      options = this.options,
      carrier = input.allowedLayers![0]
    const layers = getCopperLayerNames(input.layerCount)
    if (!layers.includes(carrier))
      throw Error(`Unknown carrier layer: ${carrier}`)
    if (!input.connections.length) return []
    const viaDiameter = input.minViaPadDiameter ?? 0.3
    const wireMargin =
      input.minTraceWidth / 2 + (input.minBoardEdgeClearance ?? 0)
    const viaMargin = viaDiameter / 2 + (input.minBoardEdgeClearance ?? 0)
    const clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    // Confine top-layer escapes to their package; only the carrier spans the board.
    const escapePadding = 10 * viaDiameter
    const regions = new Map<string, typeof input.bounds>()
    for (const o of input.obstacles) {
      if (!o.componentId) continue
      const r = regions.get(o.componentId) ?? {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      }
      r.minX = Math.min(r.minX, o.center.x - o.width / 2 - escapePadding)
      r.maxX = Math.max(r.maxX, o.center.x + o.width / 2 + escapePadding)
      r.minY = Math.min(r.minY, o.center.y - o.height / 2 - escapePadding)
      r.maxY = Math.max(r.maxY, o.center.y + o.height / 2 + escapePadding)
      regions.set(o.componentId, r)
    }
    const within = (p: Point, r: typeof input.bounds) =>
      p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY
    const sourceRegion = (c: Connection, j: number) => {
      const terminal = c.pointsToConnect[j]
      // A pad's owner list can contain both port IDs. Geometry disambiguates packages.
      const pad = input.obstacles
        .filter(
          (o) =>
            o.componentId &&
            terminal.pcb_port_id &&
            o.connectedTo.includes(terminal.pcb_port_id),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.center.x - terminal.x, a.center.y - terminal.y) -
            Math.hypot(b.center.x - terminal.x, b.center.y - terminal.y),
        )[0]
      if (!pad)
        throw Error(`Missing package pad ownership for ${c.name} terminal ${j}`)
      return regions.get(pad.componentId!)!
    }
    const bounds = input.bounds,
      step = options.gridStep ?? input.minTraceWidth
    const fixed = fixedCopper(input),
      routed = new Map<string, Trace>(),
      conflicts = new CopperConflictIndex()
    const projector = new GridHistoryProjector(
        new VectorScene(
          input,
          input.connections[0],
          input.minTraceWidth,
          fixed,
        ),
        { bounds, step },
      ),
      N = projector.cellCount
    const heap = new GridHeap(N * 3),
      best = new Float64Array(N * 3),
      parent = new Int32Array(N * 3),
      history = [new Float32Array(N), new Float32Array(N)]
    const cached = new Map<string, GridRoutingAccess>(),
      cacheKey = (c: Connection, l: string, w: number) => `${c.name}:${l}:${w}`
    function hardGrid(c: Connection, layer: string, width: number) {
      const key = cacheKey(c, layer, width)
      if (cached.has(key)) return cached.get(key)!
      const conn = {
        ...c,
        pointsToConnect: c.pointsToConnect.map((p) => ({ ...p, layer })),
      }
      const search = new GridVisibilitySearch(
        new VectorScene(input, conn, width, fixed),
        conn.pointsToConnect[0],
        conn.pointsToConnect[1],
        [],
        0,
        undefined,
        { bounds, step },
      )
      const g = search.getRoutingAccess()
      search.cancel()
      cached.set(key, g)
      if (cached.size > 30) cached.delete(cached.keys().next().value!)
      return g
    }
    function* solve(
      c: Connection,
      pass: number,
      strict = false,
      repair = false,
    ): Generator<void, Trace | null> {
      const soft = fixedCopper({
        ...input,
        obstacles: [],
        traces: [...routed.values()],
      })
      const grids = ["top", carrier].map((layer) => {
        const conn = {
          ...c,
          pointsToConnect: c.pointsToConnect.map((p) => ({ ...p, layer })),
        }
        const search = new GridVisibilitySearch(
          new VectorScene(input, conn, input.minTraceWidth, fixed),
          conn.pointsToConnect[0],
          conn.pointsToConnect[1],
          soft,
          0,
          undefined,
          { bounds, step },
        )
        const g = search.getRoutingAccess()
        search.cancel()
        return g
      })
      const vias = layers.map((l) => hardGrid(c, l, viaDiameter))
      const softVia = ["top", carrier].map((layer) => {
        const conn = {
          ...c,
          pointsToConnect: c.pointsToConnect.map((p) => ({ ...p, layer })),
        }
        const search = new GridVisibilitySearch(
          new VectorScene(input, conn, viaDiameter, fixed),
          conn.pointsToConnect[0],
          conn.pointsToConnect[1],
          soft,
          0,
          undefined,
          { bounds, step },
        )
        const g = search.getRoutingAccess()
        search.cancel()
        return g
      })
      const g = grids[0],
        ends = new Map<number, Point[]>(
          g.ends.map((a) => [a.id, a.path.toReversed()]),
        )
      const roots = new Map<number, Point[]>(),
        target = c.pointsToConnect[1],
        penalty = 5 + pass * 5
      const targetBox = sourceRegion(c, 1),
        sourceBox = sourceRegion(c, 0)
      const p = (id: number) => g.point(id)
      const heuristic = (id: number) => {
        const xy = p(id % N),
          dx = Math.abs(xy.x - target.x) / step,
          dy = Math.abs(xy.y - target.y) / step
        return (
          Math.max(dx, dy) +
          (Math.SQRT2 - 1) * Math.min(dx, dy) +
          (2 - Math.floor(id / N)) * 100
        )
      }
      best.fill(Infinity)
      heap.clear()
      for (const a of g.starts) {
        const cost = length(a.path) / step
        best[a.id] = cost
        parent[a.id] = -1
        roots.set(a.id, a.path)
        heap.push(a.id, cost, cost + heuristic(a.id))
      }
      let goal = -1,
        expansions = 0
      while (
        heap.length &&
        expansions++ < (options.maxExpansionsPerRoute ?? 1_500_000)
      ) {
        if (expansions % 2048 === 0) yield
        heap.pop()
        const id = heap.id,
          cost = heap.g
        if (cost !== best[id]) continue
        const stage = Math.floor(id / N),
          cell = id % N,
          plane = stage === 1 ? 1 : 0,
          grid = grids[plane],
          a = p(cell)
        if (stage === 2 && ends.has(cell)) {
          goal = id
          break
        }
        const x = cell % g.nx,
          y = Math.floor(cell / g.nx)
        for (const n of g.neighbors) {
          if (
            x + n.dx < 0 ||
            x + n.dx >= g.nx ||
            y + n.dy < 0 ||
            y + n.dy >= g.ny
          )
            continue
          const next = cell + n.offset
          if (grid.isBlocked(next)) continue
          const b = p(next)
          if (
            b.x < bounds.minX + wireMargin ||
            b.x > bounds.maxX - wireMargin ||
            b.y < bounds.minY + wireMargin ||
            b.y > bounds.maxY - wireMargin
          )
            continue
          if (stage !== 1 && !within(b, stage === 0 ? sourceBox : targetBox))
            continue
          if (!grid.hardEdgeIsClear(cell, n)) continue
          const softCost = grid.softEdgeIsClear(a, b) ? 0 : penalty
          if (strict && softCost) continue
          const ni = stage * N + next,
            nc = cost + n.cost + softCost + history[plane][next]
          if (nc < best[ni] - 1e-9) {
            best[ni] = nc
            parent[ni] = id
            heap.push(ni, nc, nc + heuristic(ni))
          }
        }
        if (
          c.pointsToConnect.every(
            (t) =>
              Math.hypot(a.x - t.x, a.y - t.y) >= (repair ? step : 0) - 1e-8,
          ) &&
          a.x >= bounds.minX + viaMargin &&
          a.x <= bounds.maxX - viaMargin &&
          a.y >= bounds.minY + viaMargin &&
          a.y <= bounds.maxY - viaMargin &&
          stage < 2 &&
          (stage === 0 || within(a, targetBox)) &&
          vias.every((v) => !v.isBlocked(cell))
        ) {
          const ni = id + N
          const viaSoft = softVia.reduce(
            (sum, v) => sum + (v.softEdgeIsClear(a, a) ? 0 : penalty * 4),
            0,
          )
          if (strict && viaSoft) continue
          const nc = cost + 100 + viaSoft + history[0][cell] + history[1][cell]
          if (nc < best[ni] - 1e-9) {
            best[ni] = nc
            parent[ni] = id
            heap.push(ni, nc, nc + heuristic(ni))
          }
        }
      }
      if (goal < 0) return null
      const ids: number[] = []
      for (let id = goal; id >= 0; id = parent[id]) ids.push(id)
      ids.reverse()
      const route: Trace["route"] = roots.get(ids[0])!.map((x) => ({
        ...x,
        route_type: "wire",
        layer: "top",
        width: input.minTraceWidth,
      }))
      for (let i = 1; i < ids.length; i++) {
        const id = ids[i],
          stage = Math.floor(id / N),
          prevStage = Math.floor(ids[i - 1] / N),
          xy = p(id % N),
          layer = stage === 1 ? carrier : "top"
        if (stage !== prevStage)
          route.push({
            ...xy,
            route_type: "via",
            from_layer: prevStage === 1 ? carrier : "top",
            to_layer: layer,
            layers: layers,
            via_diameter: viaDiameter,
            via_hole_diameter: input.minViaHoleDiameter ?? 0.15,
          })
        route.push({
          ...xy,
          route_type: "wire",
          layer,
          width: input.minTraceWidth,
        })
      }
      route.push(
        ...ends
          .get(goal % N)!
          .slice(1)
          .map((x) => ({
            ...x,
            route_type: "wire" as const,
            layer: "top",
            width: input.minTraceWidth,
          })),
      )
      const simplified: Trace["route"] = []
      let run: Wire[] = []
      const flush = () => {
        simplified.push(
          ...simplify(run).map((p) => ({
            ...p,
            route_type: "wire" as const,
            layer: run[0].layer,
            width: input.minTraceWidth,
          })),
        )
        run = []
      }
      for (const v of route) {
        if (v.route_type === "via") {
          flush()
          simplified.push(v)
        } else run.push(v)
      }
      flush()
      return {
        type: "pcb_trace",
        pcb_trace_id: "native_" + c.name,
        connection_name: c.name,
        source_trace_id: c.source_trace_id,
        route: simplified,
      }
    }

    let trouble = new Map<string, number>()
    let complete = false
    for (let pass = 0; pass < (options.maxPasses ?? 300); pass++) {
      for (const c of [...input.connections].sort(
        (a, b) => (trouble.get(b.name) ?? 0) - (trouble.get(a.name) ?? 0),
      )) {
        if (pass >= 12 && !trouble.has(c.name)) continue
        routed.delete(c.name)
        const t =
          (pass >= 12 ? yield* solve(c, pass, true) : null) ??
          (yield* solve(c, pass))
        if (!t) throw Error(`No route for ${c.name}`)
        routed.set(c.name, t)
        yield
      }
      const all = [...routed.values()],
        copper = all.map((t) =>
          fixedCopper({ ...input, obstacles: [], traces: [t] }),
        )
      let count = 0
      trouble = new Map()
      for (let a = 0; a < all.length; a++)
        for (let b = 0; b < a; b++) {
          const hit = conflicts.firstConflict(
            copper[a],
            copper[b],
            clearance - 1e-8,
          )
          if (!hit) continue
          count++
          for (const t of [all[a], all[b]])
            trouble.set(
              t.connection_name!,
              (trouble.get(t.connection_name!) ?? 0) + 1,
            )
          const [first, second] = hit,
            plane = first.layer === carrier ? 1 : 0
          if (!["top", carrier].includes(first.layer)) continue
          projector.penalizeIntersection(
            history[plane],
            first.a,
            first.b,
            second.a,
            second.b,
            first.radius + second.radius + clearance,
            true,
            2,
          )
        }
      this.stats = {
        pass,
        conflicts: count,
        routedSignals: routed.size,
        matchingEnforced: false,
      }
      yield
      if (!count) {
        complete = true
        break
      }
    }
    if (!complete)
      throw Error("Single-layer negotiation exhausted its pass budget")
    // Temporary via sites can coincide with terminals while negotiating topology.
    // Repair those sites against all completed routes before accepting any output.
    for (const c of input.connections) {
      const t = routed.get(c.name)!
      if (
        !t.route.some(
          (p) =>
            p.route_type === "via" &&
            c.pointsToConnect.some(
              (q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8,
            ),
        )
      )
        continue
      routed.delete(c.name)
      const repaired = yield* solve(c, 5, true, true)
      if (!repaired) throw Error(`No legal terminal via for ${c.name}`)
      routed.set(c.name, repaired)
      yield
    }
    // Grid endpoint attachments and via transitions can return through their
    // own copper even when different-net DRC passes. Repair only those lanes
    // against the completed neighbors, steering away from the audited contact.
    for (const c of input.connections) {
      for (let retry = 0; ; retry++) {
        const selfShorts = checkSignalSelfShorts(input, [routed.get(c.name)!])
        if (!selfShorts.length) break

        const original = routed.get(c.name)!
        const scene = new VectorScene(input, c, input.minTraceWidth, [
          ...fixed,
          ...fixedCopper({
            ...input,
            obstacles: [],
            traces: [...routed.values()].filter((trace) => trace !== original),
          }),
        ])
        let shortened: Trace | undefined
        shortcut: for (let i = 0; i < original.route.length - 2; i++) {
          const a = original.route[i]
          if (a.route_type !== "wire") continue
          for (
            let j = Math.min(original.route.length - 1, i + 8);
            j >= i + 2;
            j--
          ) {
            const run = original.route.slice(i, j + 1)
            if (
              run.some(
                (point) =>
                  point.route_type !== "wire" || point.layer !== a.layer,
              )
            )
              continue
            for (const points of ordinaryRunCandidates(
              a,
              original.route[j],
              run,
            )) {
              if (points.length >= run.length || !scene.pathVisible(points))
                continue
              const candidate = {
                ...original,
                route: [
                  ...original.route.slice(0, i),
                  ...points.map((point) => ({
                    ...point,
                    route_type: "wire" as const,
                    layer: a.layer,
                    width: a.width,
                  })),
                  ...original.route.slice(j + 1),
                ],
              }
              if (checkSignalSelfShorts(input, [candidate]).length) continue
              shortened = candidate
              break shortcut
            }
          }
        }
        if (shortened) {
          routed.set(c.name, shortened)
          yield
          continue
        }
        if (retry >= 8)
          throw Error(`No self-clear connectivity route for ${c.name}`)
        for (const error of selfShorts) {
          if (!error.center) throw Error(error.message)
          for (const plane of [0, 1])
            projector.penalizeIntersection(
              history[plane],
              error.center,
              error.center,
              error.center,
              error.center,
              viaDiameter / 2 + input.minTraceWidth,
              true,
              50,
            )
        }
        routed.delete(c.name)
        const repaired = yield* solve(c, 5 + retry, true, true)
        if (!repaired)
          throw Error(`No self-clear connectivity route for ${c.name}`)
        routed.set(c.name, repaired)
        yield
      }
    }
    const result = input.connections.map((c) => routed.get(c.name)!)
    const drc = validateRoutedCopperDrc({
      inputSrj: {
        ...input,
        connections: [
          ...input.connections,
          ...(options.fixedConnections ?? []),
        ],
      },
      routedSrj: { ...input, traces: [...(input.traces ?? []), ...result] },
      clearance,
      allowBlindAndBuriedVias: false,
    } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
    if (!drc.valid)
      throw Error(
        `Single-layer copper DRC rejected the route: ${drc.issues.map((issue) => issue.code).join(", ")}`,
      )
    return result
  }
}
