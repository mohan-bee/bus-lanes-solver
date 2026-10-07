import { distance, pointSegmentDistanceToPoints } from "./geometry"
import type { Point, SimpleRouteJson, Trace, Wire } from "./types"

/** Keep the manufactured terminal land and existing corner tangents straight.
 * Length tuning uses only the remaining interior of this ordinary segment. */
export function terminalViaTuningSegment(
  input: SimpleRouteJson,
  trace: Trace,
  index: number,
  bank?: { start: Point; end: Point },
): {
  a: Point
  b: Point
  span: number
  firstLead: number
  lastLead: number
} | null {
  const originalA = trace.route[index],
    originalB = trace.route[index + 1],
    a = bank?.start ?? originalA,
    b = bank?.end ?? originalB,
    span = distance(a, b),
    width = (trace.route[0] as Wire).width
  if (span < 0.01) return null
  const vias = (input.traces ?? [])
    .filter((fixed) => fixed.connection_name === trace.connection_name)
    .flatMap((fixed) =>
      fixed.route.filter((point) => point.route_type === "via"),
    )
  const ux = (b.x - a.x) / span,
    uy = (b.y - a.y) / span
  let firstViaLead = 0,
    lastViaLead = 0
  for (const via of vias) {
    const reach =
      ((via.via_diameter ?? input.minViaPadDiameter ?? 0.6) + width) / 2 + 1e-6
    const firstInside = distance(a, via) <= reach,
      lastInside = distance(b, via) <= reach
    if (firstInside && lastInside) return null
    // An interior crossing cannot become a tuning bank. The terminal escape
    // must retain its existing straight copper until it leaves the land.
    if (
      !firstInside &&
      !lastInside &&
      pointSegmentDistanceToPoints(via, a, b) <= reach
    )
      return null
    const exitDistance = (point: Point, dx: number, dy: number): number => {
      const x = point.x - via.x,
        y = point.y - via.y,
        projection = x * dx + y * dy
      return (
        -projection +
        Math.sqrt(projection * projection + reach * reach - x * x - y * y)
      )
    }
    if (firstInside)
      firstViaLead = Math.max(firstViaLead, exitDistance(a, ux, uy))
    if (lastInside)
      lastViaLead = Math.max(lastViaLead, exitDistance(b, -ux, -uy))
  }
  const turns = (p: Point, q: Point, r: Point): boolean => {
    const first = distance(p, q),
      second = distance(q, r)
    return (
      first > 1e-8 &&
      second > 1e-8 &&
      ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y)) /
        (first * second) <
        1 - 1e-9
    )
  }
  // A sampled curve begins with a chord, rather than an exact tangent. Leave
  // a short straight interval so it cannot sharpen an existing 45-degree turn.
  const cornerLead = width / 4,
    firstLead = Math.max(
      firstViaLead,
      distance(a, originalA) < 1e-8 &&
        index > 0 &&
        turns(trace.route[index - 1], a, b)
        ? cornerLead
        : 0,
    ),
    lastLead = Math.max(
      lastViaLead,
      distance(b, originalB) < 1e-8 &&
        index + 2 < trace.route.length &&
        turns(a, b, trace.route[index + 2])
        ? cornerLead
        : 0,
    )
  if (span - firstLead - lastLead < 0.01) return null
  return {
    a: firstLead ? { x: a.x + ux * firstLead, y: a.y + uy * firstLead } : a,
    b: lastLead ? { x: b.x - ux * lastLead, y: b.y - uy * lastLead } : b,
    span: span - firstLead - lastLead,
    firstLead,
    lastLead,
  }
}
