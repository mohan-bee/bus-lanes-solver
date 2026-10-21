import { expect, test } from "bun:test"
import { loadAm3352OrdinaryEscapes } from "../scripts/load-am3352-ordinary-escapes"
import { routeSurfaceOrdinarySignals } from "../lib/route-surface-ordinary-signals"
import { distance, length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { pairLengthReports, maximumCarrierLength } from "../lib/route-lengths"
import { pairCouplingReports } from "../lib/pair-coupling"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { generatedEscapeHolesConflict } from "../lib/expanded-signal-sites"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"

function solve(state: FlexibleSignalState, names: string[]) {
  const work = routeSurfaceOrdinarySignals(state, new Set(names), {
    maxSteps: 50000,
    maxPairRepairs: 2,
  })
  let next = work.next(),
    steps = 0
  try {
    while (!next.done && steps++ < 100000) next = work.next()
    expect(next.done).toBe(true)
    expect(next.value).not.toBeNull()
    return next.value!
  } finally {
    if (!next.done) work.return(null)
  }
}

function validateCandidate(state: FlexibleSignalState) {
  const carriers = [...state.retained, ...state.traces]
  const input = {
    ...state.native,
    traces: [...(state.native.traces ?? []), ...state.escapes],
  }
  expect(
    pairLengthReports(input, carriers).every((report) => report.matched),
  ).toBe(true)
  const copper = fixedCopper({
    ...input,
    traces: [...input.traces, ...carriers],
  })
  for (const carrier of carriers) {
    const name = carrier.connection_name!,
      connection = input.connections.find(
        (connection) => connection.name === name,
      )!
    const owned = state.escapes.filter(
      (trace) => trace.connection_name === name,
    )
    expect(length(carrier.route)).toBeLessThanOrEqual(
      maximumCarrierLength(input, name) + 1e-7,
    )
    const joined = joinSignalEscapes(carrier, owned)
    expect(
      distance(joined.route[0], connection.pointsToConnect[0]),
    ).toBeLessThan(1e-7)
    expect(
      distance(joined.route.at(-1)!, connection.pointsToConnect[1]),
    ).toBeLessThan(1e-7)
    for (const trace of [carrier, ...owned]) {
      for (let index = 1; index < trace.route.length; index++) {
        const a = trace.route[index - 1],
          b = trace.route[index]
        if (a.route_type !== "wire" || b.route_type !== "wire") continue
        expect(a.layer).toBe(b.layer)
        const local = { ...connection, pointsToConnect: [{ ...a }, { ...b }] }
        expect(
          new VectorScene(input, local, a.width, copper).visible(a, b),
        ).toBe(true)
      }
      for (const point of trace.route)
        if (point.route_type === "via") {
          expect(point).toMatchObject({
            via_hole_diameter: 0.3,
            via_diameter: 0.5,
            layers: ["top", "inner1", "inner2", "bottom"],
          })
          for (const layer of point.layers!) {
            const p = { x: point.x, y: point.y, layer }
            const local = { ...connection, pointsToConnect: [p, p] }
            expect(
              new VectorScene(
                input,
                local,
                point.via_diameter!,
                copper,
              ).visible(p, p),
            ).toBe(true)
          }
        }
    }
  }
  for (let index = 0; index < state.escapes.length; index++)
    expect(
      generatedEscapeHolesConflict(
        input,
        [state.escapes[index]],
        state.escapes.slice(index + 1),
      ),
    ).toBe(false)
}

test("surface ordinary routing recovers the legal expanded D13 escape", () => {
  const state = loadAm3352OrdinaryEscapes(),
    before = structuredClone(state)
  const result = solve(state, ["source_trace_1"])
  expect(result.retained).toEqual(state.retained)
  expect(result.traces.map((trace) => trace.connection_name)).toEqual([
    "source_trace_1",
  ])
  validateCandidate(result)
  expect(state).toEqual(before)
}, 120000)

test("surface feedback repairs CK while preserving both strobes and CSn0 access", () => {
  const state = loadAm3352OrdinaryEscapes(),
    before = structuredClone(state)
  const result = solve(state, ["source_trace_5"])
  const clock = new Set(["source_trace_32", "source_trace_33"])
  expect(result.retained).toHaveLength(6)
  expect(
    result.retained.filter((trace) => !clock.has(trace.connection_name!)),
  ).toEqual(
    state.retained.filter((trace) => !clock.has(trace.connection_name!)),
  )
  expect(
    result.retained.filter((trace) => clock.has(trace.connection_name!)),
  ).not.toEqual(
    state.retained.filter((trace) => clock.has(trace.connection_name!)),
  )
  expect(result.traces.map((trace) => trace.connection_name)).toEqual([
    "source_trace_5",
  ])
  validateCandidate(result)
  const coupling = pairCouplingReports(
    { ...state.native, traces: result.escapes },
    result.retained,
  )
  expect(
    coupling.find((report) =>
      report.connectionNames.includes("source_trace_32"),
    )?.matched,
  ).toBe(true)
  expect(state).toEqual(before)
}, 120000)

test("expanded D13 and repaired CK coexist in one ordinary negotiation", () => {
  const state = loadAm3352OrdinaryEscapes(),
    before = structuredClone(state)
  const result = solve(state, ["source_trace_1", "source_trace_5"])
  expect(result.retained).toHaveLength(6)
  expect(result.traces.map((trace) => trace.connection_name).sort()).toEqual([
    "source_trace_1",
    "source_trace_5",
  ])
  validateCandidate(result)
  expect(state).toEqual(before)
}, 120000)
