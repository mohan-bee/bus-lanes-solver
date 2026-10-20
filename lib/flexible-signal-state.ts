import {
  effectiveCarrierLayers,
  explicitlyAllowsCarrierLayer,
} from "./effective-carrier-layers"
import { signalWidth } from "./repair-bus-dogbones"
import type { Connection, Point, SimpleRouteJson, Trace } from "./types"

/** Only fresh, solver-owned dogbones participate in site negotiation. Supplied
 * traces live in native.traces and are never removed from a search scene. */
export interface FlexibleSignalState {
  native: SimpleRouteJson
  pending: SimpleRouteJson
  escapes: Trace[]
  retained: Trace[]
  traces: Trace[]
}
export function signalLayers(input: SimpleRouteJson, connection: Connection) {
  return effectiveCarrierLayers(input, connection).filter(
    (layer) =>
      !connection.pointsToConnect.some((point) => point.layer === layer) ||
      explicitlyAllowsCarrierLayer(input, connection, layer),
  )
}
export function signalTrace(
  input: SimpleRouteJson,
  connection: Connection,
  route: Point[],
  layer: string,
): Trace {
  const width = signalWidth(input, connection)
  return {
    type: "pcb_trace",
    pcb_trace_id: `bus_lane_${connection.name}`,
    connection_name: connection.name,
    source_trace_id: connection.source_trace_id ?? connection.name,
    route: route.map((point) => ({
      ...point,
      route_type: "wire",
      layer,
      width,
    })),
  }
}
