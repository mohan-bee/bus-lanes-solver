import { expect, test } from "bun:test"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

test("a paired approach's skew correction clears its own manufactured via land", () => {
  const trace: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "paired_a",
    source_trace_id: "a",
    connection_name: "a",
    route: [wire(0, 0), wire(3, 0), wire(4, 0)],
    coupledSection: [0, 1],
  }
  const escape: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "escape_a",
    connection_name: "a",
    source_trace_id: "a",
    route: [
      wire(4.4, 0.4, "top"),
      wire(4, 0, "top"),
      {
        route_type: "via",
        x: 4,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      wire(4, 0),
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 10, minY: -3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "a",
        source_trace_id: "a",
        pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
      },
    ],
    traces: [escape],
  }
  const original = structuredClone({ input, trace })
  const target = 4.4 + Math.SQRT2 * 0.4
  const [tuned] = tuneSmoothLengths(input, [trace], new Map([["a", target]]), {
    maxCandidates: 4096,
  })
  expect(length(tuned.route) + length(escape.route)).toBeCloseTo(target, 8)
  expect(tuned.route[0]).toEqual(trace.route[0])
  expect(tuned.route.at(-1)).toEqual(trace.route.at(-1))
  expect(tuned.route.slice(0, 2)).toEqual(trace.route.slice(0, 2))
  expect(tuned.coupledSection).toEqual([0, 1])
  expect(tuned.curvedSegments!.length).toBeGreaterThan(0)
  expect(
    createTerminalViaClearanceChecker(input, trace, {
      preserveExistingApproach: false,
    })(tuned.route),
  ).toBe(true)
  const joined = joinSignalEscapes(tuned, [escape])
  const elements = [
    { type: "pcb_board", pcb_board_id: "board", num_layers: 4 },
    {
      type: "source_bus",
      source_bus_id: "timed",
      source_trace_ids: ["a"],
      max_length_skew: 0,
    },
    {
      ...joined,
      route: joined.route.map((point) =>
        point.route_type === "via"
          ? {
              ...point,
              outer_diameter: point.via_diameter,
              hole_diameter: point.via_hole_diameter,
            }
          : point,
      ),
    },
    {
      type: "pcb_via",
      pcb_via_id: "via",
      pcb_trace_id: joined.pcb_trace_id,
      source_trace_id: "a",
      x: 4,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "inner1", "inner2", "bottom"],
    },
  ] as Parameters<typeof checkPcbTraceSelfShorts>[0]
  expect(checkPcbTraceSelfShorts(elements)).toEqual([])
  expect({ input, trace }).toEqual(original)
})
