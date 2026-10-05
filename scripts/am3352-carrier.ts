import type { Trace, Wire } from "../lib"

/** Recover the single-plane carrier from a native pad-to-pad route. Additional
 * outer-plane crossings belong to its owned approach, outside the core lane. */
export function am3352Carrier(trace: Trace) {
  const vias = trace.route.flatMap((point, index) =>
    point.route_type === "via" ? [index] : [],
  )
  if (![0, 2, 4].includes(vias.length)) return null
  const start = vias.length ? vias[0] + 1 : 0
  const end = vias.length ? vias[1] - 1 : trace.route.length - 1
  const carrier = trace.route.slice(start, end + 1)
  const layer = (carrier[0] as Wire | undefined)?.layer
  if (
    carrier.length < 2 ||
    !layer ||
    !carrier.every(
      (point) => point.route_type === "wire" && point.layer === layer,
    ) ||
    (vias.length === 0 ? layer !== "top" : layer === "top")
  )
    return null
  if (vias.length === 4) {
    if (layer !== "bottom") return null
    let currentLayer = "top"
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type === "wire") {
        if (point.layer !== currentLayer) return null
      } else {
        const before = trace.route[index - 1],
          after = trace.route[index + 1],
          nextLayer = currentLayer === "top" ? "bottom" : "top"
        if (
          point.from_layer !== currentLayer ||
          point.to_layer !== nextLayer ||
          before?.route_type !== "wire" ||
          after?.route_type !== "wire" ||
          Math.hypot(before.x - point.x, before.y - point.y) > 1e-8 ||
          Math.hypot(after.x - point.x, after.y - point.y) > 1e-8
        )
          return null
        currentLayer = nextLayer
      }
    }
    if (currentLayer !== "top") return null
  }
  return { start, end, layer, route: carrier as Wire[], viaCount: vias.length }
}
