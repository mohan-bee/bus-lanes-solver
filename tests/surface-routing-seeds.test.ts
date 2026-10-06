import { expect, test } from "bun:test"
import {
  insertSurfaceControlCandidates,
  insertSurfaceControls,
  routeFreshSurfaceSeeds,
} from "../lib/route-fresh-surface-buses"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import type { SimpleRouteJson } from "../lib/types"

test("a failed surface control preserves the greatest physical seed without accepting it as complete", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -3, maxY: 5 },
    obstacles: [
      {
        center: { x: 2, y: 3 },
        width: 0.8,
        height: 0.8,
        layers: ["top", "inner1", "inner2", "bottom"],
        connectedTo: ["OTHER_NET"],
      },
    ],
    connections: [0, 3].map((y, index) => ({
      name: index ? "BLOCKED_CONTROL" : "FIRST_CONTROL",
      pointsToConnect: [
        { x: -2, y, layer: "top" },
        { x: 2, y, layer: "top" },
      ],
    })),
    buses: [],
    differentialPairs: [],
    traces: [],
  }
  const before = structuredClone(input)
  const work = routeFreshSurfaceSeeds(
    input,
    input,
    [],
    new Map(
      input.connections.map((connection) => [
        connection.name,
        ["top", "bottom"],
      ]),
    ),
    { smoothTuning: true, denseSearch: true },
    { maxControlAttempts: 1 },
  )
  let next = work.next()
  let timing: FlexibleSignalState | undefined
  while (!next.done) {
    if (next.value?.phase === "timing") timing = next.value.state
    next = work.next()
  }
  expect(input).toEqual(before)
  expect(timing).toBeDefined()
  expect(next.value).toEqual(timing!)
  expect(next.value!.traces.map((trace) => trace.connection_name)).toEqual([
    "FIRST_CONTROL",
  ])
  const bounded = insertSurfaceControlCandidates(
    input,
    input,
    timing!,
    ["BLOCKED_CONTROL"],
    { maxIterations: 0 },
  )
  expect(bounded.next().value).toEqual(timing!)
  const complete = insertSurfaceControls(input, input, timing!, [
    "BLOCKED_CONTROL",
  ])
  let result = complete.next()
  while (!result.done) result = complete.next()
  expect(result.value).toBeNull()
})
