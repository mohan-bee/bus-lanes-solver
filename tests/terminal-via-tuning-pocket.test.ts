import { expect, test } from "bun:test"
import { checkSignalSelfShorts } from "../lib/check-signal-self-shorts"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import type { SimpleRouteJson, Trace, Wire } from "../lib"

for (const layer of ["top", "bottom"]) {
  for (const [approachLength, extraLength, maxCandidates] of [
    [0.35, 0.001, Infinity],
    [1, 0.4, 1],
  ]) {
    test(`${layer} paired approaches tune outside the via land with ${maxCandidates === 1 ? "one candidate per search mode" : "a shallow pocket"}`, () => {
      const terminal = 3 + approachLength
      const wire = (x: number, y: number, on = layer): Wire => ({
        route_type: "wire",
        x,
        y,
        layer: on,
        width: 0.1,
      })
      const trace: Trace = {
        type: "pcb_trace",
        pcb_trace_id: "carrier",
        connection_name: "P",
        route: [wire(0, 0), wire(3, 0), wire(terminal, 0)],
        coupledSection: [0, 1],
      }
      const opposite = layer === "top" ? "bottom" : "top"
      const escape: Trace = {
        type: "pcb_trace",
        pcb_trace_id: "escape",
        connection_name: "P",
        route: [
          wire(terminal + 0.4, 0.4, opposite),
          wire(terminal, 0, opposite),
          {
            route_type: "via",
            x: terminal,
            y: 0,
            from_layer: opposite,
            to_layer: layer,
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          wire(terminal, 0),
        ],
      }
      const input: SimpleRouteJson = {
        layerCount: 4,
        allowedLayers: ["top", "bottom"],
        minTraceWidth: 0.1,
        minTraceToPadEdgeClearance: 0.1,
        bounds: { minX: -1, maxX: 5, minY: -2, maxY: 2 },
        obstacles: [],
        connections: [
          {
            name: "P",
            pointsToConnect: [trace.route[0], trace.route.at(-1)!] as Wire[],
          },
        ],
        traces: [escape],
      }
      const before = structuredClone({ input, trace })
      const target = length(trace.route) + length(escape.route) + extraLength
      const [tuned] = tuneSmoothLengths(
        input,
        [trace],
        new Map([["P", target]]),
        { maxCandidates },
      )
      expect(length(tuned.route) + length(escape.route)).toBeCloseTo(target, 8)
      expect(tuned.route.slice(0, 2)).toEqual(trace.route.slice(0, 2))
      expect(tuned.coupledSection).toEqual(trace.coupledSection)
      expect(tuned.route.at(-1)).toEqual(trace.route.at(-1))
      // The final straight lead clears the 0.15mm land plus half trace width.
      expect(tuned.route[tuned.curvedSegments!.at(-1)!].x).toBeLessThanOrEqual(
        terminal - 0.2,
      )
      expect(
        checkSignalSelfShorts(input, [joinSignalEscapes(tuned, [escape])]),
      ).toEqual([])
      expect({ input, trace }).toEqual(before)
    })
  }
}
