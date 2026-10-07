import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { remapCurvedSegments } from "./remap-curved-segments"
import { fixedCopper, routeCopper, VectorScene } from "./vector-scene"
import type { SimpleRouteJson, Trace, Wire } from "./types"

/** Rebuild provisional individual approaches before final matching. Preserve
 * the shared trunk and every supplied fanout; other routed signals stay hard. */
export function straightenPairApproaches(
  input: SimpleRouteJson,
  traces: Trace[],
): Trace[] {
  const copper = [...fixedCopper(input), ...traces.flatMap(routeCopper)]
  return traces.map((trace) => {
    if (
      !trace.coupledSection ||
      trace.route.some((point) => point.route_type !== "wire")
    )
      return trace
    const [start, end] = trace.coupledSection
    const first = trace.route[0] as Wire
    const connection = input.connections.find(
      (c) => c.name === trace.connection_name,
    )!
    const scene = new VectorScene(input, connection, first.width, copper)
    const before = reduceOrdinaryTurns(trace.route.slice(0, start + 1), scene)
    const after = reduceOrdinaryTurns(trace.route.slice(end), scene)
    const route = [
      ...before.slice(0, -1),
      ...trace.route.slice(start, end + 1),
      ...after.slice(1),
    ].map((p) => ({
      ...p,
      route_type: "wire" as const,
      layer: first.layer,
      width: first.width,
    }))
    return {
      ...trace,
      route,
      curvedSegments: remapCurvedSegments(trace, route),
      coupledSection: [before.length - 1, before.length + end - start - 1] as [
        number,
        number,
      ],
    }
  })
}
