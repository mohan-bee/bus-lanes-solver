import type { Trace, Via, Wire } from "./types"

/** Retarget only a solver-owned local dogbone. A carrier on the pad layer uses
 * its existing surface stub and does not emit a same-layer via transition.
 * Other carriers retain the manufactured barrel span of the original via.
 * Multi-via approaches stay immutable when they already end on that plane. */
export function retargetGeneratedEscape(
  trace: Trace,
  carrierLayer: string,
): Trace {
  const viaIndex = trace.route.findIndex((point) => point.route_type === "via")
  if (viaIndex < 0) {
    if (
      trace.route.some(
        (point) => point.route_type !== "wire" || point.layer !== carrierLayer,
      )
    )
      throw Error("Surface escape does not support the selected carrier layer")
    return trace
  }
  const viaCount = trace.route.filter(
    (point) => point.route_type === "via",
  ).length
  if (viaCount > 1) {
    if (!multiViaApproachIsContinuous(trace))
      throw Error(
        "Multi-via generated escape requires explicit continuous manufactured handoffs",
      )
    if ((trace.route.at(-1) as Wire).layer !== carrierLayer)
      throw Error("Multi-via generated escape cannot change its carrier layer")
    return trace
  }
  const via = trace.route[viaIndex] as Via
  const handoff = trace.route[viaIndex - 1]
  if (
    handoff?.route_type !== "wire" ||
    handoff.layer !== via.from_layer ||
    Math.hypot(handoff.x - via.x, handoff.y - via.y) > 1e-8
  )
    throw Error(
      "Generated escape requires one explicit native-layer via handoff",
    )
  if (
    !via.layers &&
    carrierLayer !== via.from_layer &&
    carrierLayer !== via.to_layer
  )
    throw Error(
      "Generated escape needs an explicit span to change carrier layers",
    )
  if (via.layers && !via.layers.includes(carrierLayer))
    throw Error("Generated escape does not span the selected carrier layer")
  if (carrierLayer === via.from_layer)
    return { ...trace, route: trace.route.slice(0, viaIndex) }
  return {
    ...trace,
    route: trace.route.map((point, index) =>
      point.route_type === "via"
        ? { ...point, to_layer: carrierLayer }
        : index > viaIndex
          ? { ...(point as Wire), layer: carrierLayer }
          : point,
    ),
  }
}

function multiViaApproachIsContinuous(trace: Trace) {
  if (
    trace.route[0]?.route_type !== "wire" ||
    trace.route.at(-1)?.route_type !== "wire"
  )
    return false
  for (const [index, point] of trace.route.entries()) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
    if (point.route_type === "wire") {
      if (!point.layer || !Number.isFinite(point.width) || point.width <= 0)
        return false
      const previous = trace.route[index - 1]
      if (previous?.route_type === "wire" && previous.layer !== point.layer)
        return false
      continue
    }
    const before = trace.route[index - 1],
      after = trace.route[index + 1]
    if (
      before?.route_type !== "wire" ||
      after?.route_type !== "wire" ||
      !point.from_layer ||
      !point.to_layer ||
      point.from_layer === point.to_layer ||
      before.layer !== point.from_layer ||
      after.layer !== point.to_layer ||
      Math.hypot(before.x - point.x, before.y - point.y) > 1e-8 ||
      Math.hypot(after.x - point.x, after.y - point.y) > 1e-8 ||
      !Array.isArray(point.layers) ||
      point.layers.length < 2 ||
      point.layers.some((layer) => typeof layer !== "string" || !layer) ||
      new Set(point.layers).size !== point.layers.length ||
      !point.layers.includes(point.from_layer) ||
      !point.layers.includes(point.to_layer) ||
      !Number.isFinite(point.via_diameter) ||
      !Number.isFinite(point.via_hole_diameter) ||
      point.via_diameter! <= 0 ||
      point.via_hole_diameter! <= 0 ||
      point.via_hole_diameter! > point.via_diameter!
    )
      return false
  }
  return true
}
