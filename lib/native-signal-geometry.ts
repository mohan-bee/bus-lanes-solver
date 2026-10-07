import { routeAnglesAreConventional } from "./route-angle-validation"
import type { Trace } from "./types"

/** Native acceptance uses the same ordinary headings as the standard copper
 * quality audit; a gentle non-octilinear chord is not an ordinary routed wire. */
export function nativeSignalGeometryIsValid(trace: Trace) {
  if (!routeAnglesAreConventional([trace])) return false
  const curved = new Set(trace.curvedSegments ?? [])
  if (curved.size !== (trace.curvedSegments?.length ?? 0)) return false
  for (const i of curved) {
    const a = trace.route[i - 1],
      b = trace.route[i]
    if (
      !Number.isInteger(i) ||
      i <= 0 ||
      i >= trace.route.length ||
      a?.route_type !== "wire" ||
      b?.route_type !== "wire" ||
      a.layer !== b.layer
    )
      return false
  }
  for (let i = 1; i < trace.route.length; i++) {
    const a = trace.route[i - 1],
      b = trace.route[i]
    if (
      a.route_type !== "wire" ||
      b.route_type !== "wire" ||
      a.layer !== b.layer ||
      curved.has(i) ||
      Math.hypot(a.x - b.x, a.y - b.y) <= 1e-8
    )
      continue
    const heading = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    if (Math.abs(heading - Math.round(heading / 45) * 45) > 0.2) return false
  }
  return true
}
