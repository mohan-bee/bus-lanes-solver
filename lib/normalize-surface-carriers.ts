import { distance } from "./geometry"
import { joinSignalEscapes } from "./join-signal-escapes"
import { tuningPathIsSelfClear } from "./length-tuning"
import { routeAnglesAreConventional } from "./route-angle-validation"
import { fixedCopper, routeCopper, VectorScene } from "./vector-scene"
import type { Point, SimpleRouteJson, Trace, Wire } from "./types"

function monotone(path: Point[]) {
  let sx = 0,
    sy = 0
  for (let index = 1; index < path.length; index++) {
    const dx = Math.sign(path[index].x - path[index - 1].x),
      dy = Math.sign(path[index].y - path[index - 1].y)
    if ((dx && sx && dx !== sx) || (dy && sy && dy !== sy)) return false
    sx ||= dx
    sy ||= dy
  }
  return true
}

function octilinear(trace: Trace) {
  return trace.route.every((b, index) => {
    if (!index || trace.curvedSegments?.includes(index)) return true
    const a = trace.route[index - 1],
      dx = Math.abs(b.x - a.x),
      dy = Math.abs(b.y - a.y)
    return Math.min(dx, dy) < 1e-8 || Math.abs(dx - dy) < 1e-8
  })
}

/** Fractional handoffs can leave a short raster overshoot and returning jog.
 * Replace only an unannotated terminal neighborhood, bounded by the copper
 * spacing, with monotone axis/45-degree tangencies. Exact endpoints stay put. */
function carrierEndCandidates(
  trace: Trace,
  scene: VectorScene,
  atStart: boolean,
) {
  const oriented = (atStart ? trace.route.toReversed() : trace.route) as Wire[],
    required = scene.width / 2 + scene.margin,
    candidates: Trace[] = []
  if (!Number.isFinite(required) || required <= 0) return candidates
  let along = 0
  for (let anchor = oriented.length - 2; anchor >= 0; anchor--) {
    along += distance(oriented[anchor], oriented[anchor + 1])
    if (along > required + 1e-8) break
    const cut = atStart ? oriented.length - 1 - anchor : anchor
    if (
      trace.curvedSegments?.some((index) =>
        atStart ? index <= cut : index > cut,
      ) ||
      (trace.coupledSection &&
        (atStart
          ? trace.coupledSection[0] < cut
          : trace.coupledSection[1] > cut))
    )
      break
    const tail = oriented.slice(anchor),
      local = { ...trace, route: tail, curvedSegments: undefined }
    if (
      monotone(tail) &&
      octilinear(local) &&
      routeAnglesAreConventional([local])
    )
      continue
    const a = tail[0],
      b = tail.at(-1)!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      ax = Math.abs(dx),
      ay = Math.abs(dy),
      sx = Math.sign(dx),
      sy = Math.sign(dy),
      bends =
        ax >= ay
          ? [
              { x: a.x + sx * (ax - ay), y: a.y },
              { x: a.x + sx * ay, y: b.y },
            ]
          : [
              { x: a.x, y: a.y + sy * (ay - ax) },
              { x: b.x, y: a.y + sy * ax },
            ]
    for (const bend of bends) {
      const replacement = [
          a,
          {
            ...bend,
            route_type: "wire" as const,
            layer: a.layer,
            width: a.width,
          },
          b,
        ],
        next = [...oriented.slice(0, anchor), ...replacement],
        route = atStart ? next.toReversed() : next,
        delta = route.length - trace.route.length,
        candidate = {
          ...trace,
          route,
          curvedSegments: trace.curvedSegments?.map((index) =>
            atStart ? index + delta : index,
          ),
          coupledSection: trace.coupledSection?.map((index) =>
            atStart ? index + delta : index,
          ) as [number, number] | undefined,
        }
      if (!monotone(replacement) || !scene.pathVisible(replacement)) continue
      candidates.push(candidate)
      if (candidates.length >= 4) return candidates
    }
  }
  return candidates
}

function normalizeCarrierEnds(trace: Trace, scene: VectorScene): Trace {
  const layer = (trace.route[0] as Wire).layer
  if (
    !trace.route.every(
      (point) => point.route_type === "wire" && point.layer === layer,
    )
  )
    return trace
  const endCandidates = [trace, ...carrierEndCandidates(trace, scene, false)],
    candidates = [
      ...endCandidates.slice(1),
      ...endCandidates.flatMap((candidate) =>
        carrierEndCandidates(candidate, scene, true),
      ),
    ]
  for (const candidate of candidates)
    if (
      octilinear(candidate) &&
      routeAnglesAreConventional([candidate]) &&
      tuningPathIsSelfClear(candidate.route, scene.width / 2 + scene.margin) &&
      scene.pathVisible(candidate.route)
    )
      return candidate
  return trace
}

/** Native pads can retain fractional coordinates while owned surface sites
 * are quantized. Represent their unannotated chords as actual octilinear
 * copper, rather than treating the fractional diagonal as a sampled curve. */
function octilinearSurfaceEscape(escape: Trace, scene: VectorScene): Trace {
  let result = escape
  for (let index = 1; index < result.route.length; index++) {
    if (result.curvedSegments?.includes(index)) continue
    const a = result.route[index - 1] as Wire,
      b = result.route[index] as Wire
    const dx = b.x - a.x,
      dy = b.y - a.y
    if (
      Math.min(Math.abs(dx), Math.abs(dy)) < 1e-8 ||
      Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-8
    )
      continue
    const diagonal = Math.min(Math.abs(dx), Math.abs(dy))
    // Prefer the axis at the native pad, retaining the diagonal direction
    // where this escape meets the carrier. The other tangent remains an
    // alternative when fixed copper blocks that tiny axis.
    const bends = [
      { x: b.x - Math.sign(dx) * diagonal, y: b.y - Math.sign(dy) * diagonal },
      { x: a.x + Math.sign(dx) * diagonal, y: a.y + Math.sign(dy) * diagonal },
    ]
    for (const bend of bends) {
      const route = [
        ...result.route.slice(0, index),
        {
          ...bend,
          route_type: "wire" as const,
          layer: a.layer,
          width: a.width,
        },
        ...result.route.slice(index),
      ]
      if (
        !scene.pathVisible(route) ||
        (!tuningPathIsSelfClear(route, scene.width / 2 + scene.margin) &&
          tuningPathIsSelfClear(result.route, scene.width / 2 + scene.margin))
      )
        continue
      result = {
        ...result,
        route,
        curvedSegments: result.curvedSegments?.map((chord) =>
          chord >= index ? chord + 1 : chord,
        ),
      }
      index++
      break
    }
  }
  return result
}

/** Include solver-owned surface fanouts in shaping and matching the carrier.
 * Native pads then become its terminals, so handoff turns and self intersections
 * are visible to the ordinary route checks. Supplied copper stays fixed. */
export function normalizeSurfaceCarriers(
  input: SimpleRouteJson,
  traces: Trace[],
  generatedEscapes: Trace[],
) {
  const replacements = new Map<Trace, Trace>()
  let hard: ReturnType<typeof fixedCopper> | undefined
  const normalized = traces.map((trace) => {
    const first = trace.route[0]
    if (
      trace.route.length < 2 ||
      first.route_type !== "wire" ||
      !trace.route.every(
        (point) => point.route_type === "wire" && point.layer === first.layer,
      )
    )
      return trace
    const layer = first.layer
    const attached = generatedEscapes.filter(
      (escape) =>
        escape.connection_name === trace.connection_name &&
        escape.route.every(
          (point) => point.route_type === "wire" && point.layer === layer,
        ) &&
        (distance(escape.route.at(-1)!, trace.route[0]) < 1e-8 ||
          distance(escape.route.at(-1)!, trace.route.at(-1)!) < 1e-8),
    )
    const connection = input.connections.find(
      (item) => item.name === trace.connection_name,
    )
    if (!connection) return trace
    for (const escape of attached)
      replacements.set(escape, {
        ...escape,
        route: escape.route.slice(0, 1),
        curvedSegments: undefined,
      })
    hard ??= [...fixedCopper(input), ...traces.flatMap(routeCopper)]
    const scene = new VectorScene(
      input,
      {
        ...connection,
        pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
      },
      (trace.route[0] as Wire).width,
      hard,
    )
    const joined = attached.length
        ? joinSignalEscapes(
            trace,
            attached.map((escape) => octilinearSurfaceEscape(escape, scene)),
          )
        : trace,
      result = normalizeCarrierEnds(joined, scene)
    if (result !== trace) hard.push(...routeCopper(result))
    return result
  })
  const escapes = generatedEscapes.map(
    (escape) => replacements.get(escape) ?? escape,
  )
  const byName = new Map(
    normalized.map((trace) => [trace.connection_name, trace]),
  )
  return {
    input: {
      ...input,
      traces: input.traces?.map(
        // Ownership is explicit object identity. A supplied trace may share a
        // generated identifier and must still retain its original copper.
        (trace) => replacements.get(trace) ?? trace,
      ),
      connections: input.connections.map((connection) => {
        const trace = byName.get(connection.name)
        return trace
          ? {
              ...connection,
              pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
            }
          : connection
      }),
    },
    traces: normalized,
    escapes,
  }
}
