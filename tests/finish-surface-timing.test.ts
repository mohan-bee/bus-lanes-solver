import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { finishSurfaceTiming } from "../lib/finish-surface-timing"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { signalTrace } from "../lib/flexible-signal-state"
import { length } from "../lib/geometry"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { busLengthReports } from "../lib/route-lengths"
import { tuneSmoothLengths } from "../lib/smooth-length-tuning"
import type { SimpleRouteJson } from "../lib/types"

test("finishing controls preserves already matched bus tuning and supplied copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 9 },
    obstacles: [],
    connections: [0, 3, 6].map((y, index) => ({
      name: ["DATA_A", "DATA_B", "ENABLE"][index],
      pointsToConnect: [
        { x: -3, y, layer: "top" },
        { x: 3, y: index === 2 ? 7 : y, layer: "top" },
      ],
    })),
    buses: [
      {
        busId: "data",
        connectionNames: ["DATA_A", "DATA_B"],
        maxLengthSkew: 0.01,
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "supplied_power",
        connection_name: "POWER",
        route: [
          { route_type: "wire", x: -3, y: 8, layer: "top", width: 0.1 },
          { route_type: "wire", x: 3, y: 8, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const data = tuneSmoothLengths(
    input,
    input.connections
      .slice(0, 2)
      .map((connection) =>
        signalTrace(input, connection, connection.pointsToConnect, "top"),
      ),
    new Map([
      ["DATA_A", 7],
      ["DATA_B", 7],
    ]),
  )
  expect(data.every((trace) => trace.curvedSegments!.length > 0)).toBe(true)
  expect(routeAnglesAreConventional(data)).toBe(true)
  const control = signalTrace(
    input,
    input.connections[2],
    [
      { x: -3, y: 6 },
      { x: -1, y: 6 },
      { x: -1, y: 7 },
      { x: 3, y: 7 },
    ],
    "top",
  )
  expect(routeAnglesAreConventional([control])).toBe(false)
  const state: FlexibleSignalState = {
    native: input,
    pending: input,
    retained: [],
    escapes: [],
    traces: [...data, control],
  }
  const before = structuredClone(state)
  const work = finishSurfaceTiming(
    state,
    { smoothTuning: true, denseSearch: true },
    { preserveTiming: true },
  )
  let next = work.next()
  while (!next.done) next = work.next()
  expect(next.value).not.toBeNull()
  const result = next.value!
  expect(state).toEqual(before)
  expect(result.traces.slice(0, 2)).toEqual(data)
  expect(result.pending.traces).toEqual(input.traces)
  expect(routeAnglesAreConventional(result.traces)).toBe(true)
  expect(length(result.traces[2].route)).toBeLessThan(length(control.route))
  expect(busLengthReports(result.pending, result.traces)[0].matched).toBe(true)
  const validator = BusLanesSolver.forValidation(
    result.pending,
    result.traces,
    {
      smoothTuning: true,
    },
  )
  validator.solve()
  expect(validator.solved).toBe(true)
})
