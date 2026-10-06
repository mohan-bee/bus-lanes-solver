import { CopperConflictIndex } from "./copper-conflict-index"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import type { FlexibleSignalState } from "./flexible-signal-state"
import { distance, segmentDistance } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import {
  routeSurfaceBridge,
  surfaceBridgeEligible,
  type SurfaceBridgeOptions,
  type SurfaceBridgeRoute,
} from "./route-surface-bridge"
import { solveSignalCandidatePool } from "./solve-signal-candidate-pool"
import type { Connection, SimpleRouteJson, Trace, Wire } from "./types"
import { fixedCopper, type Copper } from "./vector-scene"

export interface SurfaceNegotiationOptions {
  maxRounds?: number
  maxExpansions?: number
  maxInitialExpansions?: number
  maxClosureExpansions?: number
  maxDomainCandidates?: number
  maxCandidateSearchNodes?: number
  maxSupportChecks?: number
  maxClosureSize?: number
  maxClosureNeighbors?: number
  maxClosureFragments?: number
  maxUntimedVias?: number
  frozenConnectionNames?: ReadonlySet<string>
}

interface Candidate extends SurfaceBridgeRoute {
  id: number
  joined: Trace
  copper: Copper[]
}

/** Negotiate complete owned surface approaches and carriers together. Supplied
 * copper and every paired rail stay hard; only ordinary signals enter the
 * candidate pool. A result connects every native signal with mutually clear
 * copper and manufactured drills. Length matching remains the caller's final
 * refinement step. */
export function* negotiateSurfaceRoutes(
  native: SimpleRouteJson,
  previous: FlexibleSignalState,
  options: SurfaceNegotiationOptions = {},
): Generator<void, FlexibleSignalState | null> {
  const paired = new Set(
      native.differentialPairs?.flatMap((pair) => pair.connectionNames) ?? [],
    ),
    timed = new Set(native.buses?.flatMap((bus) => bus.connectionNames) ?? []),
    frozen = new Set([...paired, ...(options.frozenConnectionNames ?? [])]),
    original = [...previous.retained, ...previous.traces],
    frozenTraces = original.filter((trace) =>
      frozen.has(trace.connection_name!),
    ),
    frozenEscapes = previous.escapes.filter((trace) =>
      frozen.has(trace.connection_name!),
    ),
    targets = native.connections.filter(
      (connection) => !frozen.has(connection.name),
    )
  if (
    frozenTraces.length !== frozen.size ||
    targets.some((connection) => !surfaceBridgeEligible(native, connection))
  )
    return null
  const hard: SimpleRouteJson = {
      ...native,
      traces: [
        ...(native.traces ?? []),
        ...frozenTraces.map((trace) =>
          joinSignalEscapes(
            trace,
            frozenEscapes.filter(
              (escape) => escape.connection_name === trace.connection_name,
            ),
          ),
        ),
      ],
    },
    domains = targets.map(() => [] as Candidate[]),
    current: Array<Candidate | null> = targets.map(() => null),
    hardCopper = fixedCopper({ ...hard, obstacles: [] }),
    conflicts = new CopperConflictIndex(),
    checked = new Map<string, boolean>(),
    searches = new Map<string, Candidate | null>(),
    traceIds = new WeakMap<Trace, number>(),
    clearance =
      native.minTraceToPadEdgeClearance ?? native.defaultObstacleMargin ?? 0.075
  let nextId = 0
  let nextTraceId = 0
  const traceId = (trace: Trace) => {
    let id = traceIds.get(trace)
    if (id === undefined) {
      id = nextTraceId++
      traceIds.set(trace, id)
    }
    return id
  }
  const candidate = (route: SurfaceBridgeRoute): Candidate => {
    const joined = joinSignalEscapes(route.carrier, route.escapes)
    return {
      ...route,
      id: nextId++,
      joined,
      copper: fixedCopper({ ...native, obstacles: [], traces: [joined] }),
    }
  }
  const clearOfHard = (index: number, value: Candidate) => {
    const connection = targets[index],
      owners = [connection.name, connection.source_trace_id ?? connection.name],
      foreign = hard.traces!.filter(
        (trace) =>
          !owners.includes(trace.connection_name ?? "") &&
          !owners.includes(trace.source_trace_id ?? ""),
      )
    return (
      !value.joined.route.some(
        (point) =>
          point.route_type === "via" &&
          native.connections.some((connection) =>
            connection.pointsToConnect.some(
              (terminal) => distance(point, terminal) <= 1e-6,
            ),
          ),
      ) &&
      !conflicts.firstConflict(
        value.copper,
        hardCopper.filter(
          (copper) => !copper.owners.some((owner) => owners.includes(owner)),
        ),
        clearance - 1e-8,
      ) &&
      !generatedEscapeHolesConflict(native, [value.joined], foreign)
    )
  }
  const compatible = (first: Candidate, second: Candidate) => {
    const key =
      first.id < second.id
        ? `${first.id}:${second.id}`
        : `${second.id}:${first.id}`
    const cached = checked.get(key)
    if (cached !== undefined) return cached
    const clear =
      !conflicts.firstConflict(first.copper, second.copper, clearance - 1e-8) &&
      !generatedEscapeHolesConflict(native, [first.joined], [second.joined])
    checked.set(key, clear)
    return clear
  }
  const remember = (index: number, value: Candidate) => {
    if (
      !domains[index].some(
        (old) =>
          old.joined.route.length === value.joined.route.length &&
          old.joined.route.every((point, index) => {
            const other = value.joined.route[index]
            return (
              point.route_type === other.route_type &&
              point.x === other.x &&
              point.y === other.y &&
              (point.route_type === "wire" && other.route_type === "wire"
                ? point.layer === other.layer
                : point.route_type === "via" && other.route_type === "via"
                  ? point.from_layer === other.from_layer &&
                    point.to_layer === other.to_layer
                  : false)
            )
          }),
      )
    )
      domains[index].push(value)
    if (domains[index].length > (options.maxDomainCandidates ?? 24))
      domains[index].splice(1, 1)
  }
  const select = () =>
    solveSignalCandidatePool(
      domains,
      compatible,
      options.maxCandidateSearchNodes ?? 50000,
      options.maxSupportChecks ?? 500000,
    )
  const preferredVias = (index: number): 2 | 4 =>
    frozen.size > paired.size &&
    !timed.has(targets[index].name) &&
    (options.maxUntimedVias ?? 4) >= 4
      ? 4
      : 2
  const compose = (selected: Candidate[]): FlexibleSignalState => {
    const traces = selected.map((value) => value.carrier),
      escapes = [
        ...frozenEscapes,
        ...selected.flatMap((value) => value.escapes),
      ],
      all = [...frozenTraces, ...traces],
      byName = new Map(all.map((trace) => [trace.connection_name, trace]))
    return {
      native,
      escapes,
      retained: frozenTraces,
      traces,
      pending: {
        ...native,
        traces: [...(native.traces ?? []), ...escapes, ...frozenTraces],
        connections: native.connections.map((connection) => {
          const trace = byName.get(connection.name)!
          return {
            ...connection,
            pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
          }
        }),
      },
    }
  }
  function* search(
    index: number,
    input: SimpleRouteJson,
    soft: Trace[],
    settings: SurfaceBridgeOptions,
    reverse = false,
  ): Generator<void, Candidate | null> {
    const key = JSON.stringify([
      index,
      input.traces?.map(traceId),
      soft.map(traceId),
      settings,
      reverse,
    ])
    if (searches.has(key)) return searches.get(key)!
    const connection = targets[index],
      reversed: Connection = reverse
        ? {
            ...connection,
            pointsToConnect: [...connection.pointsToConnect].reverse(),
          }
        : connection
    const result = yield* routeSurfaceBridge(input, reversed, {
      ...settings,
      softTraces: soft,
    })
    if (!result) {
      searches.set(key, null)
      return null
    }
    const value = candidate(
      reverse
        ? {
            carrier: {
              ...result.carrier,
              route: [...result.carrier.route].reverse(),
            },
            escapes: [...result.escapes].reverse(),
          }
        : result,
    )
    remember(index, value)
    searches.set(key, value)
    return value
  }
  for (let index = 0; index < targets.length; index++) {
    const trace = original.find(
      (trace) => trace.connection_name === targets[index].name,
    )
    if (trace) {
      const value = candidate({
        carrier: trace,
        escapes: previous.escapes.filter(
          (escape) => escape.connection_name === trace.connection_name,
        ),
      })
      if (!clearOfHard(index, value)) continue
      remember(index, value)
      current[index] = value
    }
  }
  for (let index = 0; index < targets.length; index++) {
    if (current[index]) continue
    const soft = current.flatMap((value, other) =>
      value && other !== index ? [value.joined] : [],
    )
    current[index] =
      (yield* search(index, hard, soft, {
        maxVias: preferredVias(index),
        softPenalty: 2,
        viaPenalty: 2,
        maxExpansions: options.maxExpansions ?? 900000,
      })) ??
      (yield* search(index, hard, [], {
        maxVias: preferredVias(index),
        viaPenalty: 2,
        maxExpansions: options.maxInitialExpansions ?? 1500000,
      }))
    if (
      !current[index] &&
      !timed.has(targets[index].name) &&
      (options.maxUntimedVias ?? 4) >= 4
    )
      current[index] = yield* search(index, hard, [], {
        maxVias: 4,
        viaPenalty: 2,
        maxExpansions: options.maxInitialExpansions ?? 1500000,
      })
    if (!current[index]) return null
    yield
  }
  let selected = select()
  if (selected) return compose(selected)
  const edges = (values: Array<Candidate | null>) => {
    const result: Array<[number, number]> = []
    for (let first = 0; first < values.length; first++)
      for (let second = first + 1; second < values.length; second++)
        if (
          values[first] &&
          values[second] &&
          !compatible(values[first]!, values[second]!)
        )
          result.push([first, second])
    return result
  }
  let best = current.slice(),
    bestCount = edges(current).length,
    lastImprovement = 0
  const lastAttempt = new Int32Array(targets.length),
    lastFailure = new Int32Array(targets.length)
  lastAttempt.fill(-100)
  lastFailure.fill(-100)
  for (let round = 0; round < (options.maxRounds ?? 120); round++) {
    const active = edges(current),
      counts = new Uint16Array(targets.length)
    if (!active.length) return compose(current as Candidate[])
    if (active.length < bestCount) {
      best = current.slice()
      bestCount = active.length
      lastImprovement = round
    }
    if (round - lastImprovement > 35) break
    for (const [first, second] of active) {
      counts[first]++
      counts[second]++
    }
    let choices = [...targets.keys()]
      .filter((index) => counts[index] && round - lastFailure[index] >= 15)
      .sort((first, second) => {
        const score = (index: number) =>
          counts[index] / (1 + Math.max(0, 3 - (round - lastAttempt[index])))
        return (
          score(second) - score(first) ||
          lastAttempt[first] - lastAttempt[second]
        )
      })
    if (!choices.length)
      choices = [...targets.keys()]
        .filter((index) => counts[index])
        .sort((first, second) => lastFailure[first] - lastFailure[second])
    const index = choices[0]
    lastAttempt[index] = round
    const value = yield* search(
      index,
      hard,
      current.flatMap((value, other) =>
        value && other !== index ? [value.joined] : [],
      ),
      {
        maxVias: preferredVias(index),
        softPenalty: Math.min(300, 5 + round * 2),
        viaPenalty: 2,
        maxExpansions: options.maxExpansions ?? 900000,
      },
    )
    if (value) {
      const after = current.filter(
        (other, otherIndex) =>
          other && otherIndex !== index && !compatible(value, other),
      ).length
      if (after >= counts[index]) lastFailure[index] = round
      current[index] = value
    } else lastFailure[index] = round
    if (round % 3 === 0) {
      selected = select()
      if (selected) return compose(selected)
    }
    yield
  }
  current.splice(0, current.length, ...best)
  const maximumClosure = Math.min(3, options.maxClosureSize ?? 3)
  while (edges(current).length) {
    const active = edges(current),
      component = conflictComponents(active)[0]
    if (component.length > maximumClosure) {
      let repaired = false,
        attempts = 0
      for (const fragment of closureFragments(
        component,
        active,
        maximumClosure,
      )) {
        if (++attempts > (options.maxClosureFragments ?? 12)) break
        if (yield* repairClosure(fragment)) {
          repaired = true
          break
        }
      }
      if (!repaired || edges(current).length >= active.length) return null
      continue
    }
    const repaired = yield* repairClosure(component)
    if (!repaired && component.length < maximumClosure) {
      const neighbors = closureNeighbors(component)
      let expanded = false
      for (const neighbor of neighbors.slice(
        0,
        options.maxClosureNeighbors ?? 4,
      )) {
        if (yield* repairClosure([...component, neighbor])) {
          expanded = true
          break
        }
      }
      if (!expanded) return null
    } else if (!repaired) return null
    if (edges(current).length >= active.length) return null
  }
  if (edges(current).length) return null
  return compose(current as Candidate[])

  function closureNeighbors(component: number[]) {
    const blocked = component.flatMap((first, at) =>
        component.slice(at + 1).flatMap((second) => {
          const hit = conflicts.firstConflict(
            current[first]!.copper,
            current[second]!.copper,
            clearance - 1e-8,
          )
          return hit ?? []
        }),
      ),
      distance = (index: number) =>
        Math.min(
          ...current[index]!.copper.flatMap((copper) =>
            blocked
              .filter((other) => other.layer === copper.layer)
              .map(
                (other) =>
                  segmentDistance([other.a, other.b], [copper.a, copper.b]) -
                  copper.radius -
                  other.radius,
              ),
          ),
        )
    return [...targets.keys()]
      .filter((index) => !component.includes(index))
      .sort((first, second) => distance(first) - distance(second))
  }

  function* repairClosure(component: number[]): Generator<void, boolean> {
    const stable = current.flatMap((value, index) =>
        value && !component.includes(index) ? [value] : [],
      ),
      input = {
        ...hard,
        traces: [...hard.traces!, ...stable.map((value) => value.joined)],
      }
    const viaLimits: Array<2 | 4> =
      component.some((index) => !timed.has(targets[index].name)) &&
      (options.maxUntimedVias ?? 4) >= 4
        ? [4, 2]
        : [2]
    for (const maxVias of viaLimits)
      for (const order of permutations(component))
        for (const gridStep of [0.05, 0.025])
          for (const orientation of orientations(component.length, maxVias > 2))
            for (const softPenalty of [0, 2, 20, 200]) {
              const built: Candidate[] = []
              let failed = false
              for (const [at, index] of order.entries()) {
                const value = yield* search(
                  index,
                  {
                    ...input,
                    traces: [
                      ...input.traces,
                      ...built.map((value) => value.joined),
                    ],
                  },
                  order.slice(at + 1).map((other) => current[other]!.joined),
                  {
                    gridStep,
                    maxGridCells: 4000000,
                    maxVias: timed.has(targets[index].name) ? 2 : maxVias,
                    softPenalty: at ? 0 : softPenalty,
                    viaPenalty: 2,
                    maxExpansions: options.maxClosureExpansions ?? 2000000,
                  },
                  orientation[at],
                )
                if (
                  !value ||
                  [...stable, ...built].some(
                    (other) => !compatible(value, other),
                  )
                ) {
                  failed = true
                  break
                }
                built.push(value)
              }
              if (!failed) {
                for (const [at, index] of order.entries())
                  current[index] = built[at]
                return true
              }
              selected = select()
              if (selected) {
                current.splice(0, current.length, ...selected)
                return true
              }
              yield
            }
    return false
  }
}

function conflictComponents(edges: Array<[number, number]>): number[][] {
  const remaining = new Set(edges.flat()),
    components: number[][] = []
  while (remaining.size) {
    const start = remaining.values().next().value!,
      component = [start]
    remaining.delete(start)
    for (const index of component)
      for (const [first, second] of edges) {
        const next = first === index ? second : second === index ? first : -1
        if (remaining.delete(next)) component.push(next)
      }
    components.push(component)
  }
  return components
}

/** Bound the number released together, rather than the total size of a
 * conflict component. Highest-degree hubs can clear several crossings while
 * the remaining members stay hard, so every successful fragment removes at
 * least one edge from the complete physical conflict graph. */
function* closureFragments(
  component: number[],
  edges: Array<[number, number]>,
  limit: number,
): Generator<number[]> {
  if (limit < 1) return
  const neighbors = new Map(
      component.map((index) => [
        index,
        edges.flatMap(([first, second]) =>
          first === index ? [second] : second === index ? [first] : [],
        ),
      ]),
    ),
    hubs = [...component].sort(
      (first, second) =>
        neighbors.get(second)!.length - neighbors.get(first)!.length,
    ),
    seen = new Set<string>()
  for (const hub of hubs) {
    const adjacent = neighbors
      .get(hub)!
      .sort(
        (first, second) =>
          neighbors.get(second)!.length - neighbors.get(first)!.length,
      )
    if (limit > 2)
      for (let first = 0; first < adjacent.length; first++)
        for (const second of adjacent.slice(first + 1)) {
          const fragment = [hub, adjacent[first], second],
            key = [...fragment].sort((a, b) => a - b).join(":")
          if (!seen.has(key)) {
            seen.add(key)
            yield fragment
          }
        }
    if (limit > 1)
      for (const neighbor of adjacent) {
        const fragment = [hub, neighbor],
          key = [...fragment].sort((a, b) => a - b).join(":")
        if (!seen.has(key)) {
          seen.add(key)
          yield fragment
        }
      }
    if (limit === 1) yield [hub]
  }
}

function* permutations(values: number[]): Generator<number[]> {
  if (values.length < 2) {
    yield values
    return
  }
  for (let index = 0; index < values.length; index++)
    for (const tail of permutations(values.filter((_, at) => at !== index)))
      yield [values[index], ...tail]
}

function* orientations(
  size: number,
  preferNative = false,
): Generator<boolean[]> {
  const alternating = Array.from(
      { length: size },
      (_, index) => index % 2 === 1,
    ),
    preferred = preferNative
      ? [
          alternating.map(() => false),
          alternating,
          alternating.map((value) => !value),
          alternating.map(() => true),
        ]
      : [
          alternating,
          alternating.map((value) => !value),
          alternating.map(() => false),
          alternating.map(() => true),
        ],
    seen = new Set<number>()
  for (const value of preferred) {
    const mask = value.reduce(
      (mask, reverse, index) => mask | (Number(reverse) << index),
      0,
    )
    if (seen.has(mask)) continue
    seen.add(mask)
    yield value
  }
  for (let mask = 0; mask < 2 ** size; mask++) {
    if (seen.has(mask)) continue
    yield Array.from({ length: size }, (_, index) => !!(mask & (1 << index)))
  }
}
