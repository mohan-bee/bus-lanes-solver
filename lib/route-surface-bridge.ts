import { CopperConflictIndex } from "./copper-conflict-index"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import { chamferOrdinaryCorners } from "./chamfer-ordinary-corners"
import { distance, length, simplify } from "./geometry"
import { signalLayers } from "./flexible-signal-state"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import { joinSignalEscapes } from "./join-signal-escapes"
import { tuningPathIsSelfClear } from "./length-tuning"
import { MinHeap } from "./min-heap"
import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { signalWidth } from "./repair-bus-dogbones"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { maximumCarrierLength } from "./route-lengths"
import type {
  Connection,
  Point,
  SimpleRouteJson,
  Trace,
  Via,
  Wire,
} from "./types"
import { fixedCopper, VectorScene } from "./vector-scene"
import { connectors } from "./vector-visibility"

export interface SurfaceBridgeOptions {
  /** Accumulated congestion cost on the native pad and carrier planes. */
  history?: {
    bounds: SimpleRouteJson["bounds"]
    step: number
    values: readonly Float32Array[]
  }
  gridStep?: number
  maxExpansions?: number
  maxLength?: number
  searchPadding?: number
  /** Negotiated copper contributes cost while input.traces remain hard. */
  softTraces?: Trace[]
  softPenalty?: number
  viaPenalty?: number
  /** Manufactured transition budget, either two (default) or four vias. */
  maxVias?: number
  /** Raster memory budget; defaults to one million and is capped at four million cells. */
  maxGridCells?: number
}
export interface SurfaceBridgeRoute {
  carrier: Trace
  escapes: Trace[]
}
interface Label {
  id: number
  cell: number
  count: number
  g: number
  routeLength: number
  f: number
  firstVia?: number
  viaCells?: number[]
  parent?: Label
  attachment?: Point[]
  via?: boolean
}

/** A single inner carrier uses the native pad layer only for local escapes. */
function innerCarrier(input: SimpleRouteJson) {
  return input.allowedLayers?.length === 1 &&
    /^inner\d+$/.test(input.allowedLayers[0]) &&
    getCopperLayerNames(input.layerCount).includes(input.allowedLayers[0])
    ? input.allowedLayers[0]
    : undefined
}

export function surfaceBridgeEligible(
  input: SimpleRouteJson,
  connection: Connection,
): boolean {
  const physical = getCopperLayerNames(input.layerCount),
    pads = connection.pointsToConnect
  return (
    physical.length >= 2 &&
    pads.length === 2 &&
    pads[0].layer === pads[1].layer &&
    [physical[0], physical.at(-1)!].includes(pads[0].layer) &&
    (!!innerCarrier(input) ||
      (input.allowedLayers?.length === 2 &&
        input.allowedLayers.includes(physical[0]) &&
        input.allowedLayers.includes(physical.at(-1)!)))
  )
}

/** Search the native pad plane and the permitted carrier plane. An inner
 * carrier keeps pad-layer approaches local to their native packages. A surface
 * path may hand off anywhere through manufactured barrels; its owned
 * approaches retain any later transitions and may span the board.
 * Input copper stays immutable and hard. Optional soft copper adds search cost;
 * callers must resolve any remaining negotiated conflicts before acceptance. */
export function* routeSurfaceBridge(
  input: SimpleRouteJson,
  connection: Connection,
  options: SurfaceBridgeOptions = {},
): Generator<void, SurfaceBridgeRoute | null> {
  const physical = getCopperLayerNames(input.layerCount)
  if (physical.length < 2 || connection.pointsToConnect.length !== 2)
    return null
  const pads = connection.pointsToConnect,
    surface = pads[0].layer,
    inner = innerCarrier(input),
    bridge = inner ?? (surface === physical[0] ? physical.at(-1)! : physical[0])
  if (
    pads[1].layer !== surface ||
    ![physical[0], physical.at(-1)!].includes(surface) ||
    (!inner &&
      (input.allowedLayers?.length !== 2 ||
        !input.allowedLayers.includes(surface) ||
        !input.allowedLayers.includes(bridge)))
  )
    return null
  const diameter = input.minViaPadDiameter ?? 0.3,
    hole = input.minViaHoleDiameter ?? 0.15
  if (
    !Number.isFinite(diameter) ||
    diameter <= 0 ||
    !Number.isFinite(hole) ||
    hole <= 0 ||
    hole > diameter
  )
    return null
  const softPenalty = options.softPenalty ?? 20,
    viaPenalty = options.viaPenalty ?? 4,
    requestedCells = options.maxGridCells ?? 1_000_000,
    maxVias = inner ? 2 : (options.maxVias ?? 2)
  if (
    !Number.isFinite(softPenalty) ||
    softPenalty < 0 ||
    !Number.isFinite(viaPenalty) ||
    viaPenalty < 0 ||
    !Number.isInteger(requestedCells) ||
    requestedCells < 4 ||
    (maxVias !== 2 && maxVias !== 4)
  )
    return null
  const maxGridCells = Math.min(requestedCells, 4_000_000),
    width = signalWidth(input, connection),
    holeClearance = Math.max(
      input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      (
        input as SimpleRouteJson & {
          minPlatedHoleDrillEdgeToDrillEdgeClearance?: number
        }
      ).minPlatedHoleDrillEdgeToDrillEdgeClearance ?? 0,
    )
  if (!Number.isFinite(holeClearance) || holeClearance < 0) return null
  const maxLength = Math.min(
      options.maxLength ?? Infinity,
      maximumCarrierLength(input, connection.name),
    ),
    fixed = fixedCopper(input),
    layers = [surface, bridge],
    carrierLayers = signalLayers(input, connection),
    scenes = layers.map(
      (layer) =>
        new VectorScene(
          input,
          {
            ...connection,
            pointsToConnect: pads.map((pad) => ({ ...pad, layer })),
          },
          width,
          fixed,
        ),
    ),
    landScenes = physical.map(
      (layer) =>
        new VectorScene(
          input,
          {
            ...connection,
            pointsToConnect: pads.map((pad) => ({ ...pad, layer })),
          },
          diameter,
          fixed,
        ),
    ),
    oldVias = (input.traces ?? []).flatMap((trace) =>
      trace.route.filter((point): point is Via => point.route_type === "via"),
    ),
    nativePads = [
      ...input.connections.flatMap((item) => item.pointsToConnect),
      ...pads,
    ],
    envelope = surfaceSearchBounds(
      input,
      connection,
      options.searchPadding ??
        (inner
          ? Math.max(
              input.bounds.maxX - input.bounds.minX,
              input.bounds.maxY - input.bounds.minY,
            )
          : 4),
    ),
    minX = envelope.minX,
    minY = envelope.minY,
    rangeX = envelope.maxX - minX,
    rangeY = envelope.maxY - minY
  if (
    rangeX <= 0 ||
    rangeY <= 0 ||
    maxLength < 0 ||
    distance(pads[0], pads[1]) > maxLength + 1e-8
  )
    return null
  // Limit both the raster memory and the search. Larger boards use a coarser
  // fallback; every selected edge is still checked with continuous geometry.
  const step = surfaceBridgeGridStep(
    rangeX,
    rangeY,
    options.gridStep ?? Math.min(0.05, width),
    maxGridCells,
  )
  if (!Number.isFinite(step) || step <= 0) return null
  const columns = Math.floor(rangeX / step) + 1,
    rows = Math.floor(rangeY / step) + 1,
    size = columns * rows,
    point = (cell: number): Point => ({
      x: minX + (cell % columns) * step,
      y: minY + Math.floor(cell / columns) * step,
    }),
    directions = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ],
    edges = [new Uint8Array(size * 8), new Uint8Array(size * 8)],
    lands = new Uint8Array(size),
    nativePadCells = new Set<number>()
  // Match the endpoint coincidence tolerance in validateRoutedCopperDrc.
  const nativeEndpointTolerance = 1e-6
  for (const pad of nativePads) {
    const firstX = Math.max(
        0,
        Math.ceil((pad.x - nativeEndpointTolerance - minX) / step) - 1,
      ),
      lastX = Math.min(
        columns - 1,
        Math.floor((pad.x + nativeEndpointTolerance - minX) / step) + 1,
      ),
      firstY = Math.max(
        0,
        Math.ceil((pad.y - nativeEndpointTolerance - minY) / step) - 1,
      ),
      lastY = Math.min(
        rows - 1,
        Math.floor((pad.y + nativeEndpointTolerance - minY) / step) + 1,
      )
    for (let x = firstX; x <= lastX; x++)
      for (let y = firstY; y <= lastY; y++) {
        const cell = x + y * columns
        if (distance(point(cell), pad) <= nativeEndpointTolerance)
          nativePadCells.add(cell)
      }
  }
  const landing = (cell: number) => {
    // A native pad is the trace terminal, not a manufactured handoff. Even
    // same-net via-in-pad placement is rejected by the native route validator.
    if (nativePadCells.has(cell)) return false
    if (lands[cell]) return lands[cell] === 1
    const at = point(cell),
      clear =
        landScenes.every((scene) => scene.visible(at, at)) &&
        !oldVias.some(
          (via) =>
            distance(via, at) <
            hole / 2 +
              (via.via_hole_diameter ?? hole) / 2 +
              holeClearance -
              1e-8,
        )
    lands[cell] = clear ? 1 : 2
    return clear
  }
  const edgeVisible = (
    layer: number,
    cell: number,
    direction: number,
    next: number,
  ) => {
    const index = cell * 8 + direction,
      cache = edges[layer]
    if (cache[index]) return cache[index] === 1
    const clear = scenes[layer].visible(point(cell), point(next))
    cache[index] = clear ? 1 : 2
    cache[next * 8 + ((direction + 4) % 8)] = cache[index]
    return clear
  }
  const localEscapes = inner
    ? pads.map((pad) => {
        const owner = input.obstacles
          .filter((obstacle) => obstacle.componentId)
          .sort((a, b) => distance(a.center, pad) - distance(b.center, pad))[0]
        const field = input.obstacles.filter(
          (obstacle) => obstacle.componentId === owner?.componentId,
        )
        const margin = diameter * 10
        return field.length
          ? {
              minX:
                Math.min(...field.map((p) => p.center.x - p.width / 2)) -
                margin,
              maxX:
                Math.max(...field.map((p) => p.center.x + p.width / 2)) +
                margin,
              minY:
                Math.min(...field.map((p) => p.center.y - p.height / 2)) -
                margin,
              maxY:
                Math.max(...field.map((p) => p.center.y + p.height / 2)) +
                margin,
            }
          : undefined
      })
    : undefined
  const withinEscape = (cell: number, count: number) => {
    if (!localEscapes || count % 2) return true
    const box = localEscapes[count === 0 ? 0 : 1],
      at = point(cell)
    return (
      !!box &&
      at.x >= box.minX &&
      at.x <= box.maxX &&
      at.y >= box.minY &&
      at.y <= box.maxY
    )
  }
  const softTraces = options.softTraces ?? [],
    hasSoft = softTraces.length > 0,
    softInput = { ...input, obstacles: [], traces: softTraces },
    softCopper = hasSoft ? fixedCopper(softInput) : [],
    softScenes = hasSoft
      ? layers.map(
          (layer) =>
            new VectorScene(
              softInput,
              {
                ...connection,
                pointsToConnect: pads.map((pad) => ({ ...pad, layer })),
              },
              width,
              softCopper,
            ),
        )
      : [],
    softLandScenes = hasSoft
      ? physical.map(
          (layer) =>
            new VectorScene(
              softInput,
              {
                ...connection,
                pointsToConnect: pads.map((pad) => ({ ...pad, layer })),
              },
              diameter,
              softCopper,
            ),
        )
      : [],
    softVias = softTraces.flatMap((trace) =>
      trace.route.filter((point): point is Via => point.route_type === "via"),
    ),
    softEdges = hasSoft
      ? [new Uint8Array(size * 8), new Uint8Array(size * 8)]
      : [],
    softLands = hasSoft ? new Uint8Array(size) : undefined
  const edgeCostFactor = (
    layer: number,
    cell: number,
    direction: number,
    next: number,
  ) => {
    const history = options.history
    const at = point(next)
    const historyX = history
      ? Math.round((at.x - history.bounds.minX) / history.step)
      : -1
    const historyY = history
      ? Math.round((at.y - history.bounds.minY) / history.step)
      : -1
    const historyColumns = history
      ? Math.floor((history.bounds.maxX - history.bounds.minX) / history.step) +
        1
      : 0
    const historyRows = history
      ? Math.floor((history.bounds.maxY - history.bounds.minY) / history.step) +
        1
      : 0
    const historic =
      history &&
      historyX >= 0 &&
      historyX < historyColumns &&
      historyY >= 0 &&
      historyY < historyRows
        ? (history.values[layer]?.[historyX + historyY * historyColumns] ?? 0)
        : 0
    if (!hasSoft || !softPenalty) return 1 + historic
    const index = cell * 8 + direction,
      cache = softEdges[layer]
    if (!cache[index]) {
      cache[index] = softScenes[layer].visible(point(cell), point(next)) ? 1 : 2
      cache[next * 8 + ((direction + 4) % 8)] = cache[index]
    }
    return (cache[index] === 1 ? 1 : 1 + softPenalty) + historic
  }
  const landingPenalty = (cell: number) => {
    if (!softLands || !softPenalty) return 0
    if (!softLands[cell]) {
      const at = point(cell),
        clear =
          softLandScenes.every((scene) => scene.visible(at, at)) &&
          !softVias.some(
            (via) =>
              distance(via, at) <
              hole / 2 +
                (via.via_hole_diameter ?? hole) / 2 +
                holeClearance -
                1e-8,
          )
      softLands[cell] = clear ? 1 : 2
    }
    return softLands[cell] === 1 ? 0 : softPenalty
  }
  const attachments = pads.map((pad, end) => {
    const result = new Map<number, Point[]>(),
      cx = Math.round((pad.x - minX) / step),
      cy = Math.round((pad.y - minY) / step)
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++) {
        const x = cx + dx,
          y = cy + dy
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue
        const cell = x + y * columns,
          at = point(cell),
          path = connectors(end ? at : pad, end ? pad : at)
            .sort((a, b) => length(a) - length(b))
            .find((candidate) => scenes[0].pathVisible(candidate))
        if (path) result.set(cell, path)
      }
    return result
  })
  if (!attachments[0].size || !attachments[1].size) return null
  // A freshly placed first barrel must not suppress a longer middle-plane
  // path that has travelled far enough to place a second barrel. Keep those
  // drill-clear states separate while retaining a bounded raster state count.
  const labelId = (count: number, cell: number, firstVia?: number) => {
    let phase = count === 0 ? 0 : count * 2 - 1
    if (
      count % 2 &&
      firstVia !== undefined &&
      distance(point(firstVia), point(cell)) >= hole + holeClearance - 1e-8
    )
      phase++
    return phase * size + cell
  }
  const queue = new MinHeap<Label>(),
    costs = new Float64Array(size * maxVias * 2)
  costs.fill(Infinity)
  for (const [cell, attachment] of attachments[0]) {
    const g = length(attachment)
    if (g > maxLength + 1e-8) continue
    costs[cell] = g
    queue.push({
      id: cell,
      cell,
      count: 0,
      g,
      routeLength: g,
      f: g + distance(point(cell), pads[1]),
      attachment,
    })
  }
  let expanded = 0
  while (queue.length && expanded < (options.maxExpansions ?? 1_500_000)) {
    const current = queue.pop()
    if (current.g > costs[current.id] + 1e-9) continue
    if (++expanded % 64 === 0) yield
    if (
      current.count % 2 === 0 &&
      carrierLayers.includes(current.count === 0 ? surface : bridge) &&
      attachments[1].has(current.cell)
    ) {
      const result = materialize(
        current,
        attachments[1].get(current.cell)!,
        point,
        input,
        connection,
        layers,
        physical,
        width,
        diameter,
        hole,
        fixed,
        softTraces,
      )
      if (
        result &&
        length(joinSignalEscapes(result.carrier, result.escapes).route) <=
          maxLength + 1e-8
      )
        return result
    }
    const x = current.cell % columns,
      y = Math.floor(current.cell / columns),
      layer = current.count % 2
    for (let direction = 0; direction < directions.length; direction++) {
      const [dx, dy] = directions[direction],
        nx = x + dx,
        ny = y + dy
      if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue
      const cell = nx + ny * columns,
        id = labelId(current.count, cell, current.firstVia),
        span = step * (dx && dy ? Math.SQRT2 : 1),
        routeLength = current.routeLength + span,
        g =
          current.g +
          span * edgeCostFactor(layer, current.cell, direction, cell)
      if (
        routeLength > maxLength + 1e-8 ||
        !withinEscape(cell, current.count) ||
        g >= costs[id] - 1e-9 ||
        !edgeVisible(layer, current.cell, direction, cell)
      )
        continue
      costs[id] = g
      queue.push({
        id,
        cell,
        count: current.count,
        g,
        routeLength,
        f: g + distance(point(cell), pads[1]),
        firstVia: current.firstVia,
        viaCells: current.viaCells,
        parent: current,
      })
    }
    if (
      carrierLayers.includes(bridge) &&
      current.count < maxVias &&
      withinEscape(current.cell, current.count + 1) &&
      landing(current.cell) &&
      (current.viaCells ?? []).every(
        (cell) =>
          distance(point(cell), point(current.cell)) >=
          hole + holeClearance - 1e-8,
      ) &&
      (current.firstVia === undefined ||
        distance(point(current.firstVia), point(current.cell)) >=
          hole + holeClearance - 1e-8)
    ) {
      const count = current.count + 1,
        firstVia =
          current.count % 2 === 0
            ? current.cell
            : (current.firstVia ?? current.cell),
        id = labelId(count, current.cell, firstVia),
        g = current.g + viaPenalty + landingPenalty(current.cell)
      if (g < costs[id] - 1e-9) {
        costs[id] = g
        queue.push({
          id,
          cell: current.cell,
          count,
          g,
          routeLength: current.routeLength,
          f: g + distance(point(current.cell), pads[1]),
          firstVia,
          viaCells: [...(current.viaCells ?? []), current.cell],
          parent: current,
          via: true,
        })
      }
    }
  }
  return null
}

/** Retain the requested resolution while the whole raster fits the memory
 * budget. A long narrow envelope may need more rows than a square raster. */
export function surfaceBridgeGridStep(
  rangeX: number,
  rangeY: number,
  requested: number,
  maxCells = 1_000_000,
) {
  if (
    !Number.isFinite(requested) ||
    requested <= 0 ||
    !Number.isFinite(rangeX) ||
    !Number.isFinite(rangeY) ||
    rangeX <= 0 ||
    rangeY <= 0 ||
    maxCells < 4
  )
    return NaN
  const cells = (step: number) =>
    (Math.floor(rangeX / step) + 1) * (Math.floor(rangeY / step) + 1)
  if (cells(requested) <= maxCells) return requested
  const sum = rangeX + rangeY,
    quadratic =
      (sum + Math.sqrt(sum * sum + 4 * (maxCells - 1) * rangeX * rangeY)) /
      (2 * (maxCells - 1)),
    coarse = Math.max(requested, quadratic)
  return cells(coarse) <= maxCells ? coarse : coarse * (1 + 1e-12)
}

function surfaceSearchBounds(
  input: SimpleRouteJson,
  connection: Connection,
  padding: number,
) {
  const owners = new Set(
    connection.pointsToConnect
      .map(
        (pad) =>
          input.obstacles.find(
            (obstacle) =>
              obstacle.componentId && distance(obstacle.center, pad) < 1e-4,
          )?.componentId,
      )
      .filter(Boolean),
  )
  if (!owners.size) return input.bounds
  const pads = input.obstacles.filter((obstacle) =>
    owners.has(obstacle.componentId),
  )
  return {
    minX: Math.max(
      input.bounds.minX,
      Math.min(...pads.map((pad) => pad.center.x - pad.width / 2)) - padding,
    ),
    maxX: Math.min(
      input.bounds.maxX,
      Math.max(...pads.map((pad) => pad.center.x + pad.width / 2)) + padding,
    ),
    minY: Math.max(
      input.bounds.minY,
      Math.min(...pads.map((pad) => pad.center.y - pad.height / 2)) - padding,
    ),
    maxY: Math.min(
      input.bounds.maxY,
      Math.max(...pads.map((pad) => pad.center.y + pad.height / 2)) + padding,
    ),
  }
}

function materialize(
  found: Label,
  goal: Point[],
  point: (cell: number) => Point,
  input: SimpleRouteJson,
  connection: Connection,
  layers: string[],
  physical: string[],
  width: number,
  diameter: number,
  hole: number,
  fixed: ReturnType<typeof fixedCopper>,
  softTraces: Trace[] = [],
): SurfaceBridgeRoute | null {
  const chain: Label[] = []
  for (let label: Label | undefined = found; label; label = label.parent)
    chain.push(label)
  chain.reverse()
  let route: Trace["route"] = chain[0].attachment!.map((at) => ({
    ...at,
    route_type: "wire",
    layer: layers[0],
    width,
  }))
  for (const label of chain.slice(1)) {
    const at = point(label.cell),
      layer = layers[label.count % 2]
    if (label.via)
      route.push({
        ...at,
        route_type: "via",
        from_layer: layers[(label.count - 1) % 2],
        to_layer: layer,
        layers: physical,
        via_diameter: diameter,
        via_hole_diameter: hole,
      })
    route.push({ ...at, route_type: "wire", layer, width })
  }
  route.push(
    ...goal.slice(1).map((at) => ({
      ...at,
      route_type: "wire" as const,
      layer: layers[0],
      width,
    })),
  )
  // Keep every avoided ordinary route hard during simplification. Only
  // already crossed provisional routes may still participate in negotiation.
  let refinementCopper = fixed
  const negotiatedInner = !!innerCarrier(input) && softTraces.length > 0
  if (negotiatedInner) {
    const provisional: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "provisional_bridge",
      connection_name: connection.name,
      route,
    }
    const copper = fixedCopper({
      ...input,
      obstacles: [],
      traces: [provisional],
    })
    const conflicts = new CopperConflictIndex()
    const clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    refinementCopper = [
      ...fixed,
      ...softTraces.flatMap((trace) => {
        const other = fixedCopper({ ...input, obstacles: [], traces: [trace] })
        return conflicts.firstConflict(copper, other, clearance - 1e-8)
          ? []
          : other
      }),
    ]
  }
  const normalized: Trace["route"] = []
  let current: Wire[] = []
  const finish = () => {
    if (!current.length) return true
    const local = {
        ...connection,
        pointsToConnect: [current[0], current.at(-1)!],
      },
      scene = new VectorScene(input, local, width, refinementCopper),
      trace: Trace = {
        type: "pcb_trace",
        pcb_trace_id: "surface_piece",
        connection_name: connection.name,
        // Ordinary shortcuts can erase the path selected to avoid soft copper.
        route: (softTraces.length && !negotiatedInner
          ? simplify(current)
          : reduceOrdinaryTurns(simplify(current), scene)
        ).map((at) => ({
          ...at,
          route_type: "wire",
          layer: current[0].layer,
          width,
        })),
      },
      bevel = chamferOrdinaryCorners(
        { ...input, connections: [local] },
        [trace],
        refinementCopper,
      )[0].route as Wire[]
    if (
      !scene.pathVisible(bevel) ||
      !tuningPathIsSelfClear(
        bevel,
        width +
          (input.minTraceToPadEdgeClearance ??
            input.defaultObstacleMargin ??
            0.075),
      )
    )
      return false
    normalized.push(...bevel)
    current = []
    return true
  }
  for (const at of route) {
    if (at.route_type === "wire") current.push(at)
    else {
      if (!finish()) return null
      normalized.push(at)
    }
  }
  if (!finish()) return null
  route = normalized
  const takenIds = new Set(
      [...(input.traces ?? []), ...softTraces].map(
        (trace) => trace.pcb_trace_id,
      ),
    ),
    uniqueId = (base: string) => {
      const bound = takenIds.size
      for (let suffix = 0; suffix <= bound; suffix++) {
        const id = suffix ? `${base}_${suffix}` : base
        if (takenIds.has(id)) continue
        takenIds.add(id)
        return id
      }
      throw new Error("Could not allocate a surface bridge trace ID")
    }
  const joined: Trace = {
      type: "pcb_trace",
      pcb_trace_id: uniqueId(`surface_bridge_${connection.name}`),
      connection_name: connection.name,
      source_trace_id: connection.source_trace_id ?? connection.name,
      route,
    },
    vias = route.filter((at): at is Via => at.route_type === "via")
  if (
    !routeAnglesAreConventional([joined]) ||
    surfaceBridgeSelfShorts(input, connection, joined)
  )
    return null
  if (!vias.length)
    return {
      carrier: joined,
      escapes: connection.pointsToConnect.map((pad, end) => ({
        ...joined,
        pcb_trace_id: uniqueId(
          `surface_bridge_escape_${connection.name}_${end}`,
        ),
        route: [{ ...pad, route_type: "wire", width }],
      })),
    }
  if (vias.length !== 2 && vias.length !== 4) return null
  // Check every manufactured barrel, including later transitions within the
  // target-owned approach, rather than only the two carrier handoffs.
  if (
    vias.some((via, index) =>
      vias
        .slice(index + 1)
        .some((other) =>
          generatedEscapeHolesConflict(
            input,
            [{ ...joined, route: [via] }],
            [{ ...joined, route: [other] }],
          ),
        ),
    )
  )
    return null
  const first = route.indexOf(vias[0]),
    last = route.indexOf(vias[1]),
    reverse = (points: Trace["route"]) =>
      [...points]
        .reverse()
        .map((at) =>
          at.route_type === "via"
            ? { ...at, from_layer: at.to_layer, to_layer: at.from_layer }
            : at,
        ),
    carrier = {
      ...joined,
      pcb_trace_id: uniqueId(`surface_bridge_carrier_${connection.name}`),
      route: route.slice(first + 1, last),
    },
    escapes = [
      {
        ...joined,
        pcb_trace_id: uniqueId(`surface_bridge_escape_${connection.name}_0`),
        route: route.slice(0, first + 2),
      },
      {
        ...joined,
        pcb_trace_id: uniqueId(`surface_bridge_escape_${connection.name}_1`),
        route: reverse(route.slice(last - 1)),
      },
    ]
  if (generatedEscapeHolesConflict(input, [escapes[0]], [escapes[1]]))
    return null
  return { carrier, escapes }
}

export function surfaceBridgeSelfShorts(
  input: SimpleRouteJson,
  connection: Connection,
  trace: Trace,
) {
  const circuit: any[] = [
    {
      type: "pcb_board",
      pcb_board_id: "surface_bridge_board",
      num_layers: input.layerCount,
    },
    {
      type: "source_bus",
      source_bus_id: "surface_bridge_self_check",
      max_length_skew: 0,
      source_trace_ids: [connection.name],
    },
    {
      type: "source_trace",
      source_trace_id: connection.name,
      name: connection.name,
      connected_source_port_ids: [],
      connected_source_net_ids: [],
    },
    { ...trace, source_trace_id: connection.name },
    ...trace.route.flatMap((at, index) =>
      at.route_type === "via"
        ? [
            {
              type: "pcb_via",
              pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
              pcb_trace_id: trace.pcb_trace_id,
              source_trace_id: connection.name,
              x: at.x,
              y: at.y,
              outer_diameter: at.via_diameter,
              hole_diameter: at.via_hole_diameter,
              layers: at.layers,
            },
          ]
        : [],
    ),
  ]
  return checkPcbTraceSelfShorts(circuit).length > 0
}
