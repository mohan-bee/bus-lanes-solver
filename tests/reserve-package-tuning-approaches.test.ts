import { expect, test } from "bun:test"
import { checkSignalSelfShorts } from "../lib/check-signal-self-shorts"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { reservePackageTuningApproaches } from "../lib/reserve-package-tuning-approaches"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

for (const layer of ["top", "bottom"]) {
  test(`${layer} retains exterior pairing while using package copper for via-safe skew correction`, () => {
    const opposite = layer === "top" ? "bottom" : "top"
    const wire = (x: number, y: number, on = layer): Wire => ({
      route_type: "wire",
      x,
      y,
      layer: on,
      width: 0.1,
    })
    const carriers: Trace[] = ["P", "N"].map((name, i) => ({
      type: "pcb_trace",
      pcb_trace_id: name,
      connection_name: name,
      route: [
        wire(-10, i * 0.22),
        wire(0, i * 0.22),
        wire(4, i * 0.22),
        wire(i ? 5.15 : 4.35, i * 0.22),
      ],
      coupledSection: [0, 2],
    }))
    const escapes: Trace[] = carriers.map((t) => {
      const end = t.route.at(-1)!
      return {
        type: "pcb_trace",
        pcb_trace_id: `escape_${t.connection_name}`,
        connection_name: t.connection_name,
        route: [
          wire(end.x + 0.4, end.y + 0.4, opposite),
          wire(end.x, end.y, opposite),
          {
            route_type: "via",
            x: end.x,
            y: end.y,
            from_layer: opposite,
            to_layer: layer,
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          end,
        ],
      }
    })
    const input: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -12, maxX: 8, minY: -3, maxY: 3 },
      connections: carriers.map((t) => ({
        name: t.connection_name!,
        pointsToConnect: [t.route[0], t.route.at(-1)!] as Wire[],
      })),
      traces: escapes,
      differentialPairs: [
        { connectionNames: ["P", "N"], traceGap: 0.12, lengthTolerance: 0.001 },
      ],
      obstacles: [
        {
          componentId: "CPU",
          center: { x: -10, y: 0.11 },
          width: 2,
          height: 0.42,
          layers: [opposite],
          connectedTo: ["P", "N"],
        },
        {
          componentId: "RAM",
          center: { x: 3, y: 0.11 },
          width: 4.5,
          height: 0.42,
          layers: [opposite],
          connectedTo: ["P", "N"],
        },
      ],
    }
    const before = structuredClone({ input, carriers })
    const target = length(carriers[1].route) + length(escapes[1].route)
    const prepared = reservePackageTuningApproaches(input, carriers)
    for (let i = 0; i < 2; i++)
      expect(length(prepared[i].route)).toBeCloseTo(
        length(carriers[i].route),
        10,
      )
    const tuned = tuneSmoothLengths(
      input,
      prepared,
      new Map([
        ["P", target],
        ["N", target],
      ]),
      { maxCandidates: 4096, packageOnlyPairTuning: true },
    )
    for (let i = 0; i < 2; i++)
      expect(length(tuned[i].route) + length(escapes[i].route)).toBeCloseTo(
        target,
        8,
      )
    expect(
      exteriorPairSpacingReports(input, tuned).every((p) => p.matched),
    ).toBe(true)
    expect(
      checkSignalSelfShorts(
        input,
        tuned.map((t, i) => joinSignalEscapes(t, [escapes[i]])),
      ),
    ).toEqual([])
    expect({ input, carriers }).toEqual(before)
  })
}
