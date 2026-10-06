import { expect, test } from "bun:test"
import { checkPcbTraceSelfShorts } from "@tscircuit/checks"
import { distance, length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import { createTerminalViaClearanceChecker } from "../lib/terminal-via-clearance"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "bottom"): Wire => ({
  route_type: "wire",
  x,
  y,
  layer,
  width: 0.1,
})

test("a short paired terminal corrects residual skew after a straight native via departure", () => {
  for (const corner of [false, true])
    for (const reverse of [false, true]) {
      const via = { x: 3.4, y: corner ? 0.11 : 0 }
      const route = [
        wire(0, 0),
        wire(3, 0),
        ...(corner ? [wire(3.29, 0)] : []),
        wire(via.x, via.y),
      ]
      const trace: Trace = {
        type: "pcb_trace",
        pcb_trace_id: "carrier_a",
        source_trace_id: "a",
        connection_name: "a",
        route: reverse ? route.toReversed() : route,
        coupledSection: reverse ? [route.length - 2, route.length - 1] : [0, 1],
      }
      const escape: Trace = {
        type: "pcb_trace",
        pcb_trace_id: "escape_a",
        source_trace_id: "a",
        connection_name: "a",
        route: [
          wire(via.x + 0.4, via.y + 0.4, "top"),
          wire(via.x, via.y, "top"),
          {
            ...via,
            route_type: "via",
            from_layer: "top",
            to_layer: "bottom",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          wire(via.x, via.y),
        ],
      }
      const input: SimpleRouteJson = {
        layerCount: 4,
        minTraceWidth: 0.1,
        minTraceToPadEdgeClearance: 0.1,
        bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
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
      const target = length(trace.route) + length(escape.route) + 0.0001
      const [tuned] = tuneSmoothLengths(
        input,
        [trace],
        new Map([["a", target]]),
        {
          maxCandidates: 512,
        },
      )
      expect(length(tuned.route) + length(escape.route)).toBeCloseTo(target, 8)
      expect(tuned.route[0]).toEqual(trace.route[0])
      expect(tuned.route.at(-1)).toEqual(trace.route.at(-1))
      expect(reverse ? tuned.route.slice(-2) : tuned.route.slice(0, 2)).toEqual(
        reverse ? trace.route.slice(-2) : trace.route.slice(0, 2),
      )
      expect(tuned.curvedSegments!.length).toBeGreaterThan(0)
      for (const index of tuned.curvedSegments!) {
        expect(distance(tuned.route[index - 1], via)).toBeGreaterThan(0.2)
        expect(distance(tuned.route[index], via)).toBeGreaterThan(0.2)
      }
      expect(
        createTerminalViaClearanceChecker(input, trace, {
          preserveExistingApproach: false,
        })(tuned.route),
      ).toBe(true)
      expect(routeAnglesAreConventional([tuned])).toBe(true)
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
          ...via,
          outer_diameter: 0.3,
          hole_diameter: 0.15,
          layers: ["top", "inner1", "inner2", "bottom"],
        },
      ] as Parameters<typeof checkPcbTraceSelfShorts>[0]
      expect(checkPcbTraceSelfShorts(elements)).toEqual([])
      expect({ input, trace }).toEqual(original)
    }
})
