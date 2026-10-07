import type { PcbTraceError } from "circuit-json"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import type { SimpleRouteJson, Trace } from "./types"

/** Run the native matched-copper check on joined routes, including materialized
 * via lands. A carrier-only clearance audit cannot see a land bypassing a bend. */
export function checkSignalSelfShorts(
  input: SimpleRouteJson,
  traces: Trace[],
): PcbTraceError[] {
  const circuit: any[] = [
    { type: "pcb_board", pcb_board_id: "board", num_layers: input.layerCount },
    // The native check selects traces through a matching bus. Audit untimed
    // controls too, without changing the board's actual routing constraints.
    {
      type: "source_bus",
      source_bus_id: "signal_self_short_audit",
      max_length_skew: 0,
      source_trace_ids: traces.map((trace) => trace.connection_name),
    },
    ...(input.buses ?? []).map((bus) => ({
      type: "source_bus",
      source_bus_id: bus.busId,
      max_length_skew: bus.maxLengthSkew,
      source_trace_ids: bus.connectionNames,
    })),
    ...input.connections.map((c) => ({
      type: "source_trace",
      source_trace_id: c.name,
      name: c.name,
      connected_source_port_ids: [],
      connected_source_net_ids: [],
    })),
    ...traces.map((t) => ({ ...t, source_trace_id: t.connection_name })),
    ...traces.flatMap((t) =>
      t.route.flatMap((p, i) =>
        p.route_type === "via"
          ? [
              {
                type: "pcb_via",
                pcb_via_id: `${t.pcb_trace_id}_via_${i}`,
                pcb_trace_id: t.pcb_trace_id,
                source_trace_id: t.connection_name,
                x: p.x,
                y: p.y,
                outer_diameter: p.via_diameter,
                hole_diameter: p.via_hole_diameter,
                layers: p.layers ?? getCopperLayerNames(input.layerCount),
              },
            ]
          : [],
      ),
    ),
  ]
  return checkPcbTraceSelfShorts(circuit)
}
