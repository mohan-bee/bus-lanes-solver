import { expect, test } from "bun:test"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import {
  packageApproachRegions,
  pointInBox,
} from "../lib/package-approach-regions"
import { pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("a native TOP-pad pair keeps individual skew correction inside its packages", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -4, maxX: 16, minY: -4, maxY: 6 },
    connections: ["P", "N"].map((name, i) => ({
      name,
      pointsToConnect: [
        { x: 0, y: i * 0.8, layer: "top" },
        { x: 10, y: (i + 1) * 0.8, layer: "top" },
      ],
    })),
    obstacles: [0, 10].flatMap((x) =>
      [0, 0.8, 1.6].flatMap((dx) =>
        [0, 0.8, 1.6, 2.4].map((y) => ({
          componentId: x === 0 ? "driver" : "receiver",
          shape: "circle" as const,
          center: { x: x + dx, y },
          width: 0.35,
          height: 0.35,
          layers: ["top"],
          connectedTo:
            dx === 0 && (x === 0 ? y <= 0.8 : y >= 0.8 && y <= 1.6)
              ? [y === (x === 0 ? 0 : 0.8) ? "P" : "N"]
              : [],
        })),
      ),
    ),
    buses: [
      {
        busId: "BYTE_TOP",
        connectionNames: ["P", "N"],
        allowedLayers: ["top"],
        maxLengthSkew: 0.127,
      },
    ],
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.01, traceGap: 0.12 },
    ],
  }
  const before = structuredClone(input)
  const fixed = fixedCopper(input)
  const search = routeCoupledPair(input, input.differentialPairs![0], fixed, {
    copper: [],
    penalty: 0,
    variant: 0,
    preferPackageOnlyTuning: true,
  })
  let state = search.next(),
    steps = 0
  try {
    while (!state.done && steps++ < 12_000) state = search.next()
    expect(state.done).toBe(true)
    expect(state.value).not.toBeNull()
    const traces = state.value as Trace[]
    expect(traces).toHaveLength(2)
    expect(pairLengthReports(input, traces)[0].matched).toBe(true)
    expect(sharedPairSpacingReports(input, traces)[0].matched).toBe(true)
    expect(exteriorPairSpacingReports(input, traces)[0]).toMatchObject({
      applicable: true,
      matched: true,
      separatedExteriorLengthMm: 0,
    })
    const regions = packageApproachRegions(input, 0.26)
    const curves = traces.flatMap((trace) =>
      (trace.curvedSegments ?? []).map((i) => [
        trace.route[i - 1],
        trace.route[i],
      ]),
    )
    expect(curves.length).toBeGreaterThan(0)
    for (const [a, b] of curves)
      expect(
        regions.some((r) => pointInBox(a, r.copper) && pointInBox(b, r.copper)),
      ).toBe(true)
    const copper = [...fixed, ...traces.flatMap(routeCopper)]
    for (const trace of traces) {
      const connection = input.connections.find(
        (c) => c.name === trace.connection_name,
      )!
      expect(trace.route[0]).toMatchObject(connection.pointsToConnect[0])
      expect(trace.route.at(-1)).toMatchObject(connection.pointsToConnect[1])
      expect(
        trace.route.every((p) => p.route_type === "wire" && p.layer === "top"),
      ).toBe(true)
      expect(
        new VectorScene(input, connection, 0.1, copper).pathVisible(
          trace.route,
        ),
      ).toBe(true)
    }
    expect(input).toEqual(before)
  } finally {
    if (!state.done) search.return(null)
  }
}, 30_000)
