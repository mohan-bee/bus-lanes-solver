import { distance } from "./geometry"
import type { Trace } from "./types"

/** Join pad-to-carrier escapes while preserving curve and coupled segment
 * indexes. Escapes must already use the carrier's actual physical layer. */
export function joinSignalEscapes(lane: Trace, escapes: Trace[]): Trace {
  const prefix = escapes.find(
    (trace) => distance(trace.route.at(-1)!, lane.route[0]) < 1e-8,
  )
  const suffix = escapes.find(
    (trace) =>
      trace !== prefix &&
      distance(trace.route.at(-1)!, lane.route.at(-1)!) < 1e-8,
  )
  const reversed =
    suffix?.route
      .toReversed()
      .map((point) =>
        point.route_type === "via"
          ? { ...point, from_layer: point.to_layer, to_layer: point.from_layer }
          : point,
      ) ?? []
  const offset = (prefix?.route.length ?? 1) - 1
  const suffixOffset = offset + lane.route.length - 1
  const curvedSegments = [
    ...(prefix?.curvedSegments ?? []),
    ...(lane.curvedSegments?.map((index) => index + offset) ?? []),
    ...(suffix?.curvedSegments?.map(
      (index) => suffixOffset + suffix.route.length - index,
    ) ?? []),
  ].sort((a, b) => a - b)
  return {
    ...lane,
    coupledSection: lane.coupledSection?.map((index) => index + offset) as
      | [number, number]
      | undefined,
    curvedSegments: curvedSegments.length ? curvedSegments : undefined,
    route: [
      ...(prefix?.route.slice(0, -1) ?? []),
      ...lane.route,
      ...reversed.slice(1),
    ],
  }
}
