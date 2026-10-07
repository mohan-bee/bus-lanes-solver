import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { CopperConflictIndex } from "./copper-conflict-index"
import { length, simplify } from "./geometry"
import { GridVisibilitySearch, type GridRoutingAccess } from "./grid-visibility"
import {
  LengthSearchFrontier,
  type LengthSearchLabel,
} from "./length-search-frontier"
import type { Connection, Point, SimpleRouteJson, Trace, Wire } from "./types"
import { fixedCopper, VectorScene } from "./vector-scene"

type Bounds = SimpleRouteJson["bounds"]
export interface NativeCarrierCandidate {
  trace: Trace
  bankCost: (trace: Trace) => number
}
export interface NativeCarrierSearchOptions {
  softTraces?: Trace[]
  softPenalty?: number
  strict?: boolean
  maxLength?: number
  maxExpansions?: number
  forcedVia?: Point
  /** One-via paired approaches stay inside their native package field. */
  carrierRegion?: Bounds
}

/** Owns continuous occupancy for native TOP escapes and one inner carrier.
 * Length and congestion are separate resources; immutable predecessors retain
 * a short expensive prefix when a cheap long prefix cannot finish. */
export class NativeCarrierRouter {
  readonly carrier: string
  readonly cellCount: number
  private fixed: ReturnType<typeof fixedCopper>
  private cached = new Map<string, GridRoutingAccess>()
  private regions = new Map<string, Bounds>()
  private frontier = new LengthSearchFrontier()
  private conflicts = new CopperConflictIndex()
  constructor(
    readonly input: SimpleRouteJson,
    readonly step: number,
    readonly history: readonly Float32Array[],
  ) {
    this.carrier = input.allowedLayers![0]
    this.fixed = fixedCopper(input)
    this.cellCount =
      (Math.ceil((input.bounds.maxX - input.bounds.minX) / step) + 1) *
      (Math.ceil((input.bounds.maxY - input.bounds.minY) / step) + 1)
    const padding = 10 * (input.minViaPadDiameter ?? 0.3)
    for (const o of input.obstacles) {
      if (!o.componentId) continue
      const r = this.regions.get(o.componentId) ?? {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      }
      r.minX = Math.min(r.minX, o.center.x - o.width / 2 - padding)
      r.maxX = Math.max(r.maxX, o.center.x + o.width / 2 + padding)
      r.minY = Math.min(r.minY, o.center.y - o.height / 2 - padding)
      r.maxY = Math.max(r.maxY, o.center.y + o.height / 2 + padding)
      this.regions.set(o.componentId, r)
    }
  }
  private packageRegion(c: Connection, side: number) {
    const p = c.pointsToConnect[side]
    const candidates = this.input.obstacles
      .filter(
        (o) =>
          o.componentId &&
          (p.pcb_port_id
            ? o.connectedTo.includes(p.pcb_port_id)
            : o.connectedTo.includes(c.source_trace_id ?? c.name)),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.center.x - p.x, a.center.y - p.y) -
          Math.hypot(b.center.x - p.x, b.center.y - p.y),
      )
    if (!candidates[0])
      throw Error(`Missing native package ownership for ${c.name}`)
    return this.regions.get(candidates[0].componentId!)!
  }
  private grid(
    c: Connection,
    layer: string,
    width: number,
    soft = [] as ReturnType<typeof fixedCopper>,
  ) {
    const connection = {
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => ({ ...p, layer })),
    }
    const search = new GridVisibilitySearch(
      new VectorScene(this.input, connection, width, this.fixed),
      connection.pointsToConnect[0],
      connection.pointsToConnect[1],
      soft,
      0,
      undefined,
      { bounds: this.input.bounds, step: this.step },
    )
    const access = search.getRoutingAccess()
    search.cancel()
    return access
  }
  private hardGrid(c: Connection, layer: string, width: number) {
    const key = `${c.name}:${layer}:${width}`
    const old = this.cached.get(key)
    if (old) return old
    const grid = this.grid(c, layer, width)
    this.cached.set(key, grid)
    if (this.cached.size > 30)
      this.cached.delete(this.cached.keys().next().value!)
    return grid
  }
  *route(
    c: Connection,
    options: NativeCarrierSearchOptions = {},
  ): Generator<void, NativeCarrierCandidate | null> {
    const input = this.input,
      bounds = input.bounds,
      step = this.step,
      N = this.cellCount
    const width = input.minTraceWidth,
      diameter = input.minViaPadDiameter ?? 0.3
    const wireMargin = width / 2 + (input.minBoardEdgeClearance ?? 0)
    const viaMargin = diameter / 2 + (input.minBoardEdgeClearance ?? 0)
    const softGroups = (options.softTraces ?? []).map((t) =>
      fixedCopper({ ...input, obstacles: [], traces: [t] }),
    )
    const soft = softGroups.flat(),
      grids = ["top", this.carrier].map((layer) =>
        this.grid(c, layer, width, soft),
      )
    const physical = getCopperLayerNames(input.layerCount)
    const vias = physical.map((layer) => this.hardGrid(c, layer, diameter))
    const softVia = ["top", this.carrier].map((layer) =>
      this.grid(c, layer, diameter, soft),
    )
    const g = grids[0],
      goalStage = c.pointsToConnect[1].layer === this.carrier ? 1 : 2
    const ends = new Map(
      (goalStage === 1 ? grids[1] : g).ends.map((a) => [
        a.id,
        a.path.toReversed(),
      ]),
    )
    const sourceBox = this.packageRegion(c, 0),
      targetBox =
        goalStage === 1 ? options.carrierRegion! : this.packageRegion(c, 1)
    const within = (p: Point, r: Bounds) =>
      p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY
    const target = c.pointsToConnect[1],
      penalty = options.softPenalty ?? 5,
      cap = options.maxLength ?? Infinity
    const remaining = (id: number) => {
      const p = g.point(id % N),
        dx = Math.abs(p.x - target.x),
        dy = Math.abs(p.y - target.y)
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
    }
    const heuristic = (id: number) =>
      remaining(id) / step + (goalStage - Math.floor(id / N)) * 100
    const frontier = this.frontier
    frontier.clear()
    for (const a of g.starts)
      frontier.add(
        a.id,
        length(a.path) / step,
        Number.isFinite(cap) ? length(a.path) : 0,
        heuristic(a.id),
        undefined,
        a.path,
      )
    let goal: LengthSearchLabel | undefined,
      expanded = 0
    try {
      while (
        frontier.length &&
        expanded++ < (options.maxExpansions ?? 1_500_000)
      ) {
        if (expanded % 2048 === 0) yield
        const label = frontier.pop()
        if (!label) break
        const id = label.node
        if (label.travelled + remaining(id) > cap + 1e-8) continue
        const stage = Math.floor(id / N),
          cell = id % N,
          plane = stage === 1 ? 1 : 0
        const grid = grids[plane],
          a = g.point(cell)
        if (
          stage === goalStage &&
          ends.has(cell) &&
          label.travelled + length(ends.get(cell)!) <= cap + 1e-8
        ) {
          goal = label
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
          const b = g.point(next)
          if (
            b.x < bounds.minX + wireMargin ||
            b.x > bounds.maxX - wireMargin ||
            b.y < bounds.minY + wireMargin ||
            b.y > bounds.maxY - wireMargin
          )
            continue
          if (stage !== 1 && !within(b, stage === 0 ? sourceBox : targetBox))
            continue
          if (goalStage === 1 && stage === 1 && !within(b, targetBox)) continue
          if (!grid.hardEdgeIsClear(cell, n)) continue
          const softCost = grid.softEdgeIsClear(a, b) ? 0 : penalty
          if (options.strict && softCost) continue
          const ni = stage * N + next,
            travelled = Number.isFinite(cap)
              ? label.travelled + n.cost * step
              : 0
          if (travelled + remaining(ni) <= cap + 1e-8)
            frontier.add(
              ni,
              label.cost + n.cost + softCost + (this.history[plane][next] ?? 0),
              travelled,
              heuristic(ni),
              label,
              label.rootPath,
            )
        }
        if (
          stage < goalStage &&
          (stage === 0 || within(a, targetBox)) &&
          (goalStage !== 1 || within(a, targetBox)) &&
          (!options.forcedVia ||
            Math.hypot(a.x - options.forcedVia.x, a.y - options.forcedVia.y) <
              1e-8) &&
          c.pointsToConnect.every(
            (p) => Math.hypot(a.x - p.x, a.y - p.y) >= 1e-5,
          ) &&
          a.x >= bounds.minX + viaMargin &&
          a.x <= bounds.maxX - viaMargin &&
          a.y >= bounds.minY + viaMargin &&
          a.y <= bounds.maxY - viaMargin &&
          vias.every((v) => !v.isBlocked(cell))
        ) {
          const cost = softVia.reduce(
            (sum, v) => sum + (v.softEdgeIsClear(a, a) ? 0 : penalty * 4),
            0,
          )
          if (options.strict && cost) continue
          const ni = id + N
          frontier.add(
            ni,
            label.cost +
              100 +
              cost +
              (this.history[0][cell] ?? 0) +
              (this.history[1][cell] ?? 0),
            label.travelled,
            heuristic(ni),
            label,
            label.rootPath,
          )
        }
      }
      if (!goal) return null
      const ids: number[] = []
      for (let p: LengthSearchLabel | undefined = goal; p; p = p.parent)
        ids.push(p.node)
      ids.reverse()
      const route: Trace["route"] = goal.rootPath!.map((p) => ({
        ...p,
        route_type: "wire",
        layer: "top",
        width,
      }))
      for (let i = 1; i < ids.length; i++) {
        const stage = Math.floor(ids[i] / N),
          previous = Math.floor(ids[i - 1] / N),
          p = g.point(ids[i] % N),
          layer = stage === 1 ? this.carrier : "top"
        if (stage !== previous)
          route.push({
            ...p,
            route_type: "via",
            from_layer: previous === 1 ? this.carrier : "top",
            to_layer: layer,
            layers: physical,
            via_diameter: diameter,
            via_hole_diameter: input.minViaHoleDiameter ?? 0.15,
          })
        route.push({ ...p, route_type: "wire", layer, width })
      }
      route.push(
        ...ends
          .get(goal.node % N)!
          .slice(1)
          .map((p) => ({
            ...p,
            route_type: "wire" as const,
            layer: goalStage === 1 ? this.carrier : "top",
            width,
          })),
      )
      const normalized: Trace["route"] = []
      let run: Wire[] = []
      const flush = () => {
        if (run.length)
          normalized.push(
            ...simplify(run).map((p) => ({
              ...p,
              route_type: "wire" as const,
              layer: run[0].layer,
              width,
            })),
          )
        run = []
      }
      for (const p of route) {
        if (p.route_type === "via") {
          flush()
          normalized.push(p)
        } else run.push(p)
      }
      flush()
      const trace: Trace = {
        type: "pcb_trace",
        pcb_trace_id: `native_${c.name}`,
        connection_name: c.name,
        source_trace_id: c.source_trace_id,
        route: normalized,
      }
      const bankCost = (candidate: Trace) => {
        const actual = fixedCopper({
          ...input,
          obstacles: [],
          traces: [candidate],
        })
        let cost =
          500 *
          softGroups.reduce(
            (sum, copper) =>
              sum +
              Number(
                !!this.conflicts.firstConflict(
                  actual,
                  copper,
                  (input.minTraceToPadEdgeClearance ??
                    input.defaultObstacleMargin ??
                    0.075) - 1e-8,
                ),
              ),
            0,
          )
        for (let i = 1; i < candidate.route.length; i++) {
          const a = candidate.route[i - 1],
            b = candidate.route[i],
            span = Math.hypot(a.x - b.x, a.y - b.y),
            samples = Math.max(1, Math.ceil(span / step))
          const blocked = !grids[1].softEdgeIsClear(a, b)
          for (let j = 0; j < samples; j++) {
            const f = (j + 0.5) / samples,
              x = a.x + (b.x - a.x) * f,
              y = a.y + (b.y - a.y) * f
            const cell =
              Math.round((y - bounds.minY) / step) * g.nx +
              Math.round((x - bounds.minX) / step)
            cost +=
              (span / samples / step) *
              (Number(blocked) * penalty + (this.history[1][cell] ?? 0))
          }
        }
        return cost
      }
      return { trace, bankCost }
    } finally {
      frontier.clear()
    }
  }
}
