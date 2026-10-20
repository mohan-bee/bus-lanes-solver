import { expect, test } from "bun:test"
import { pairRouteKey, routeCoupledPair } from "../lib/coupled-pair-routing"
import { pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib/types"

test("excluded computed pairs yield a different topology without poisoning ordinary cache reuse", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -2, maxX: 12, minY: -4, maxY: 4 },
    obstacles: [],
    connections: [-0.1, 0.1].map((y, index) => ({
      name: index === 0 ? "P" : "N",
      source_trace_id: index === 0 ? "source_P" : "source_N",
      pointsToConnect: [0, 10].map((x) => ({ x, y, layer: "bottom" })),
    })),
    differentialPairs: [
      { connectionNames: ["P", "N"], traceGap: 0.1, lengthTolerance: 0.2 },
    ],
  }
  const before = structuredClone(input)
  const fixed = fixedCopper(input)
  const deadline = performance.now() + 4500
  const compute = (excludedPairRoutes?: ReadonlySet<string>) => {
    const search = routeCoupledPair(input, input.differentialPairs![0], fixed, {
      copper: [],
      penalty: 0,
      variant: 0,
      excludedPairRoutes,
    })
    let state = search.next(),
      steps = 0
    try {
      while (!state.done && steps++ < 2000 && performance.now() < deadline)
        state = search.next()
      expect(state.done).toBe(true)
      expect(state.value).not.toBeNull()
      const traces = state.value as Trace[]
      expect(traces).toHaveLength(2)
      expect(pairLengthReports(input, traces)[0].matched).toBe(true)
      expect(sharedPairSpacingReports(input, traces)[0].matched).toBe(true)
      const copper = [...fixed, ...traces.flatMap(routeCopper)]
      for (const connection of input.connections) {
        const trace = traces.find(
          (candidate) => candidate.connection_name === connection.name,
        )!
        expect(trace.source_trace_id).toBe(connection.source_trace_id)
        expect(trace.route[0]).toMatchObject(connection.pointsToConnect[0])
        expect(trace.route.at(-1)).toMatchObject(connection.pointsToConnect[1])
        expect(
          trace.route.every(
            (point) =>
              point.route_type === "wire" &&
              point.layer === "bottom" &&
              point.width === 0.1,
          ),
        ).toBe(true)
        expect(
          new VectorScene(input, connection, 0.1, copper).pathVisible(
            trace.route,
          ),
        ).toBe(true)
      }
      return traces
    } finally {
      if (!state.done) search.return(null)
    }
  }
  const first = compute()
  expect(compute()).toEqual(first)
  const firstKey = pairRouteKey(first)
  const excluded = new Set([firstKey])
  const alternative = compute(excluded)
  expect(pairRouteKey(alternative)).not.toBe(firstKey)
  expect(excluded.has(pairRouteKey(alternative))).toBe(false)
  expect(compute(excluded)).toEqual(alternative)
  expect(compute()).toEqual(first)
  expect([...excluded]).toEqual([firstKey])
  expect(input).toEqual(before)
}, 5000)
