import type { PcbTraceError } from "circuit-json"
import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import type { SimpleRouteJson, Trace } from "./types"

// Compaction revisits mostly unchanged traces. Cache only successful checks of
// exact serialized copper, so edits to coordinates, widths or lands are rechecked.
const clearedCopper = new Set<string>()
const maximumClearedEntries = 1024

/** Run the native matched-copper check on joined routes, including materialized
 * via lands. A carrier-only clearance audit cannot see a land bypassing a bend. */
export function checkSignalSelfShorts(
  input: SimpleRouteJson,
  traces: Trace[],
): PcbTraceError[] {
  const sourceId = (trace: Trace) =>
    trace.connection_name || trace.source_trace_id || trace.pcb_trace_id
  const keys = new Map(
    traces.map((trace) => [
      trace,
      JSON.stringify([
        input.layerCount,
        trace.pcb_trace_id,
        trace.connection_name,
        trace.route,
      ]),
    ]),
  )
  const pending = traces.filter((trace) => !clearedCopper.has(keys.get(trace)!))
  if (!pending.length) return []
  const circuit: any[] = [
    { type: "pcb_board", pcb_board_id: "board", num_layers: input.layerCount },
    // The native check selects traces through a matching bus. Audit untimed
    // controls too, without changing the board's actual routing constraints.
    {
      type: "source_bus",
      source_bus_id: "signal_self_short_audit",
      max_length_skew: 0,
      source_trace_ids: pending.map(sourceId),
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
    ...pending.map((t) => ({
      ...t,
      type: "pcb_trace",
      source_trace_id: sourceId(t),
    })),
    ...pending.flatMap((t) =>
      t.route.flatMap((p, i) =>
        p.route_type === "via"
          ? [
              {
                type: "pcb_via",
                pcb_via_id: `${t.pcb_trace_id}_via_${i}`,
                pcb_trace_id: t.pcb_trace_id,
                source_trace_id: sourceId(t),
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
  const errors = checkPcbTraceSelfShorts(circuit)
  const failed = new Set(errors.map((error) => error.pcb_trace_id))
  for (const trace of pending) {
    if (failed.has(trace.pcb_trace_id)) continue
    if (clearedCopper.size >= maximumClearedEntries)
      clearedCopper.delete(clearedCopper.values().next().value!)
    clearedCopper.add(keys.get(trace)!)
  }
  return errors
}
