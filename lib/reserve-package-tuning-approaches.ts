import { packageApproachRegions, pointInBox } from "./package-approach-regions"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Leave native package interiors available for individual skew correction.
 * Copper is unchanged; physical exterior coupling remains independently checked. */
export function reservePackageTuningApproaches(
  input: SimpleRouteJson,
  traces: Trace[],
): Trace[] {
  return traces.map((trace) => {
    if (
      !trace.coupledSection ||
      trace.route.some((p) => p.route_type !== "wire")
    )
      return trace
    const [start, end] = trace.coupledSection
    const width = (trace.route[0] as Wire).width
    const pair = input.differentialPairs?.find((p) =>
      p.connectionNames.includes(trace.connection_name!),
    )
    if (!pair) return trace
    const rails = pair.connectionNames.map((name) =>
      traces.find(
        (t) => t.connection_name === name || t.source_trace_id === name,
      ),
    )
    if (rails.some((t) => !t)) return trace
    const clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.075
    const regions = packageApproachRegions(
      input,
      width + (pair.traceGap ?? clearance) / 2 + clearance,
    ).filter((r) =>
      [0, 1].some((end) =>
        rails.every((t) =>
          pointInBox(end ? t!.route.at(-1)! : t!.route[0], r.copper),
        ),
      ),
    )
    if (!regions.length) return trace
    const route: Trace["route"] = [trace.route[0]],
      curvedSegments: number[] = [],
      exterior: number[] = []
    for (let i = 0; i < trace.route.length - 1; i++) {
      const a = trace.route[i],
        b = trace.route[i + 1],
        parameters = [0, 1]
      if (i >= start && i < end)
        for (const { copper: box } of regions)
          for (const [axis, low, high] of [
            ["x", box.minX, box.maxX],
            ["y", box.minY, box.maxY],
          ] as const) {
            const delta = b[axis] - a[axis]
            if (Math.abs(delta) < 1e-12) continue
            for (const boundary of [low, high]) {
              const t = (boundary - a[axis]) / delta
              if (t > 1e-9 && t < 1 - 1e-9) parameters.push(t)
            }
          }
      const sorted = [...new Set(parameters)].sort((a, b) => a - b)
      for (let j = 1; j < sorted.length; j++) {
        const previous = route.at(-1)!,
          t = sorted[j],
          point =
            t === 1
              ? b
              : { ...a, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        const middle = {
          x: (previous.x + point.x) / 2,
          y: (previous.y + point.y) / 2,
        }
        if (
          i >= start &&
          i < end &&
          !regions.some((r) => pointInBox(middle, r.copper))
        )
          exterior.push(route.length - 1)
        route.push(point)
        if (trace.curvedSegments?.includes(i + 1))
          curvedSegments.push(route.length - 1)
      }
    }
    if (!exterior.length) return trace
    return {
      ...trace,
      route,
      curvedSegments: curvedSegments.length ? curvedSegments : undefined,
      coupledSection: [exterior[0], exterior.at(-1)! + 1],
    }
  })
}
