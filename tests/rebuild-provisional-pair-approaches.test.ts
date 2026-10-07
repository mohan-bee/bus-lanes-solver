import { expect, test } from "bun:test"
import { checkSignalSelfShorts } from "../lib/check-signal-self-shorts"
import { straightenPairApproaches } from "../lib/straighten-pair-approaches"
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

for (const layer of ["top", "bottom"]) {
  const opposite = layer === "top" ? "bottom" : "top"
  test(`${layer} rebuilds provisional package banks before accepting full copper`, () => {
    const trace: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "paired_a",
      source_trace_id: "a",
      connection_name: "a",
      route: [wire(0, 0, layer), wire(3, 0, layer), wire(4, 0, layer)],
      coupledSection: [0, 1],
    }
    const escape: Trace = {
      type: "pcb_trace",
      pcb_trace_id: "escape_a",
      connection_name: "a",
      source_trace_id: "a",
      route: [
        wire(4.4, 0.4, opposite),
        wire(4, 0, opposite),
        {
          route_type: "via",
          x: 4,
          y: 0,
          from_layer: opposite,
          to_layer: layer,
          layers: ["top", "inner1", "inner2", "bottom"],
          via_diameter: 0.3,
          via_hole_diameter: 0.15,
        },
        wire(4, 0, layer),
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
    const [provisional] = tuneSmoothLengths(
      input,
      [trace],
      new Map([["a", target]]),
      { maxCandidates: 4096, allowProvisionalLandConflicts: true },
    )
    expect(
      checkSignalSelfShorts(input, [joinSignalEscapes(provisional, [escape])]),
    ).toHaveLength(1)
    const rebuilt = straightenPairApproaches(input, [provisional])
    expect(
      checkSignalSelfShorts(input, [joinSignalEscapes(rebuilt[0], [escape])]),
    ).toEqual([])
    const [tuned] = tuneSmoothLengths(
      input,
      rebuilt,
      new Map([["a", target]]),
      {
        maxCandidates: 4096,
      },
    )
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
    expect(checkSignalSelfShorts(input, [joined])).toEqual([])
    expect({ input, trace }).toEqual(original)
  })
}
