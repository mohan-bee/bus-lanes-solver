import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { length } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { prepareSurfaceTimingBanks } from "../lib/prepare-surface-timing-banks"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { tuneGeneratedOrdinaryEscapes } from "../lib/tune-generated-ordinary-escapes"
import type { SimpleRouteJson, Trace, Via, Wire } from "../lib/types"

function wire(x: number, y: number, layer = "top"): Wire {
  return { route_type: "wire", x, y, layer, width: 0.1 }
}
function via(x: number, y: number): Via {
  return {
    route_type: "via",
    x,
    y,
    from_layer: "top",
    to_layer: "bottom",
    layers: ["top", "inner1", "inner2", "bottom"],
    via_diameter: 0.3,
    via_hole_diameter: 0.15,
  }
}
function trace(name: string, id: string, route: Trace["route"]): Trace {
  return {
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: name,
    source_trace_id: name,
    route,
  }
}
function settle<T>(work: Generator<void, T>): T {
  let next = work.next()
  while (!next.done) next = work.next()
  return next.value
}

function fixture() {
  const names = ["long-data", "short-data", "pair-p", "pair-n"],
    xs = [0, 3, 7, 7.2],
    power = trace("power", "supplied-power", [
      wire(9, 5),
      wire(9, 6),
      via(9, 6),
      wire(9, 6, "bottom"),
      wire(9, 7, "bottom"),
    ]),
    native: SimpleRouteJson = {
      layerCount: 4,
      allowedLayers: ["top", "bottom"],
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      bounds: { minX: -6, maxX: 11, minY: -2, maxY: 15 },
      obstacles: names.slice(2).flatMap((name, index) =>
        [0, 12].map((y) => ({
          center: { x: xs[index + 2], y },
          width: 0.1,
          height: 0.1,
          shape: "circle" as const,
          componentId: y ? "target-package" : "source-package",
          layers: ["top"],
          connectedTo: [name],
        })),
      ),
      traces: [power],
      connections: names.map((name, i) => ({
        name,
        pointsToConnect: [wire(xs[i], 0), wire(xs[i], i < 2 ? 10 : 12)],
      })),
      buses: [
        {
          busId: "byte",
          connectionNames: names,
          maxLengthSkew: 0.1,
          minLength: 11,
          maxLength: 13,
        },
      ],
      differentialPairs: [
        {
          connectionNames: ["pair-p", "pair-n"],
          lengthTolerance: 0.1,
          traceGap: 0.1,
        },
      ],
    },
    carriers = names.map((name, i) => ({
      ...trace(
        name,
        `${name}-carrier`,
        i < 2
          ? [wire(xs[i], 4, "bottom"), wire(xs[i], 8, "bottom")]
          : [wire(xs[i], 0), wire(xs[i], 12)],
      ),
      coupledSection: i < 2 ? undefined : ([0, 1] as [number, number]),
    })),
    escapes = names
      .slice(0, 2)
      .flatMap((name, i) => [
        trace(name, `${name}-source`, [
          wire(xs[i], 0),
          wire(xs[i], 4),
          via(xs[i], 4),
          wire(xs[i], 4, "bottom"),
        ]),
        trace(name, `${name}-target`, [
          wire(xs[i], 10),
          wire(xs[i], 8),
          via(xs[i], 8),
          wire(xs[i], 8, "bottom"),
        ]),
      ]),
    tuned = settle(
      tuneGeneratedOrdinaryEscapes(
        { ...native, traces: [power, ...escapes] },
        carriers,
        escapes,
      ),
    )!
  expect(tuned).not.toBeNull()
  const donor: FlexibleSignalState = {
    native,
    pending: tuned.input,
    traces: carriers.slice(0, 2),
    retained: carriers.slice(2),
    escapes: tuned.escapes,
  }
  // This untimed copper is compatible with the old straight surface approach,
  // but occupies a curve used by the computed matched donor.
  const source = donor.escapes.find(
      (escape) => escape.pcb_trace_id === "long-data-source",
    )!,
    at = source.route.find(
      (point) => point.route_type === "wire" && Math.abs(point.x) > 0.05,
    )!,
    control = trace("enable", "owned-enable", [
      wire(at.x, at.y - 0.1),
      wire(at.x, at.y + 0.1),
    ]),
    controlEscapes = control.route.map((point, index) =>
      trace("enable", `owned-enable-${index}`, [point]),
    ),
    fullNative: SimpleRouteJson = {
      ...native,
      connections: [
        ...native.connections,
        { name: "enable", pointsToConnect: control.route as Wire[] },
      ],
    },
    previous: FlexibleSignalState = {
      native: fullNative,
      pending: {
        ...fullNative,
        traces: [power, ...escapes, ...controlEscapes],
      },
      retained: carriers.slice(2),
      traces: [
        {
          ...carriers[0],
          route: [
            wire(0, 4, "bottom"),
            wire(-4, 8, "bottom"),
            wire(-4, 12, "bottom"),
            wire(0, 8, "bottom"),
          ],
        },
        carriers[1],
        control,
      ],
      escapes: [...escapes, ...controlEscapes],
    }
  return { fullNative, previous, donor, carriers, power }
}

test("timing preparation restores a matched owned tuple and spends TOP approach space released by an untimed control", () => {
  const { fullNative, previous, donor, carriers, power } = fixture(),
    before = JSON.stringify({ fullNative, previous, donor }),
    result = settle(prepareSurfaceTimingBanks(fullNative, previous, donor))!
  expect(result).not.toBeNull()
  expect(JSON.stringify({ fullNative, previous, donor })).toBe(before)
  expect(
    result.native.connections.map((connection) => connection.name),
  ).toEqual(fullNative.buses![0].connectionNames)
  expect(result.native.traces![0]).toBe(power)
  expect(result.pending.traces![0]).toBe(power)
  expect(
    result.traces.find((trace) => trace.connection_name === "long-data"),
  ).toEqual(carriers[0])
  expect(
    result.escapes.filter((escape) => escape.connection_name === "long-data"),
  ).toEqual(
    donor.escapes.filter((escape) => escape.connection_name === "long-data"),
  )
  expect(
    result.traces.find((trace) => trace.connection_name === "short-data"),
  ).toEqual(carriers[1])
  expect(
    result.escapes.some(
      (escape) =>
        escape.connection_name === "short-data" &&
        escape.curvedSegments?.length,
    ),
  ).toBe(true)
  expect(result.retained).toEqual(previous.retained)
  expect(
    [...result.traces, ...result.escapes].some(
      (trace) => trace.connection_name === "enable",
    ),
  ).toBe(false)
  const all = [...result.retained, ...result.traces]
  expect(busLengthReports(result.pending, all)[0].matched).toBe(true)
  expect(pairLengthReports(result.pending, all)[0].matched).toBe(true)
  expect(
    length(
      joinSignalEscapes(
        result.traces[0],
        result.escapes.filter(
          (escape) =>
            escape.connection_name === result.traces[0].connection_name,
        ),
      ).route,
    ),
  ).toBeCloseTo(11.9, 6)
  const validator = BusLanesSolver.forValidation(result.pending, all, {
    smoothTuning: true,
  })
  validator.solve()
  expect(validator.solved).toBe(true)
})

test("restoration rejects a carrier mixed with escapes from a different runtime site assignment", () => {
  const { fullNative, previous, donor } = fixture(),
    mixed = {
      ...donor,
      traces: donor.traces.map((trace, index) =>
        index
          ? trace
          : {
              ...trace,
              route: trace.route.map((point) => ({
                ...point,
                x: point.x + 0.02,
              })),
            },
      ),
    },
    before = JSON.stringify({ fullNative, previous, mixed })
  expect(
    settle(prepareSurfaceTimingBanks(fullNative, previous, mixed)),
  ).toBeNull()
  expect(JSON.stringify({ fullNative, previous, mixed })).toBe(before)
})

test("a donor clears current timing and supplied drill rules before it can be restored", () => {
  const { fullNative, previous, donor } = fixture(),
    hard = trace("other-power", "another-supplied-fanout", [
      wire(0.45, 3.5),
      wire(0.45, 4),
      via(0.45, 4),
      wire(0.45, 4, "bottom"),
      wire(0.45, 4.5, "bottom"),
    ]),
    blocked = {
      ...fullNative,
      minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.5,
      traces: [...fullNative.traces!, hard],
    },
    before = JSON.stringify({ blocked, previous, donor })
  expect(settle(prepareSurfaceTimingBanks(blocked, previous, donor))).toBeNull()
  expect(JSON.stringify({ blocked, previous, donor })).toBe(before)
})

test("supplied traces cannot be released through an owned identifier collision", () => {
  const { fullNative, previous, donor, power } = fixture(),
    collision = {
      ...fullNative,
      traces: [{ ...power, pcb_trace_id: previous.escapes[0].pcb_trace_id }],
    }
  expect(
    settle(prepareSurfaceTimingBanks(collision, previous, donor)),
  ).toBeNull()
})

test("a matched donor cannot put a manufactured barrel directly at a native pad", () => {
  const { fullNative, previous, donor } = fixture(),
    source = donor.escapes.find(
      (escape) => escape.pcb_trace_id === "long-data-source",
    )!,
    viaIndex = source.route.findIndex((point) => point.route_type === "via"),
    replacement: Trace = {
      ...source,
      route: [
        source.route[0],
        via(0, 0),
        wire(0, 0, "bottom"),
        ...source.route
          .slice(1, viaIndex)
          .map((point) => ({ ...point, layer: "bottom" }) as Wire),
      ],
      curvedSegments: source.curvedSegments?.map((index) => index + 2),
    },
    padViaDonor = {
      ...donor,
      escapes: donor.escapes.map((escape) =>
        escape === source ? replacement : escape,
      ),
    },
    before = JSON.stringify({ fullNative, previous, padViaDonor })
  expect(
    busLengthReports(
      {
        ...fullNative,
        traces: [...fullNative.traces!, ...padViaDonor.escapes],
      },
      [...donor.retained, ...donor.traces],
    )[0].matched,
  ).toBe(true)
  expect(
    settle(prepareSurfaceTimingBanks(fullNative, previous, padViaDonor)),
  ).toBeNull()
  expect(JSON.stringify({ fullNative, previous, padViaDonor })).toBe(before)
})

test("nonfinite lengths and incompatible absolute timing windows fail before search", () => {
  const { fullNative, previous, donor } = fixture(),
    before = JSON.stringify({ fullNative, previous, donor })
  for (const bounds of [
    { minLength: NaN },
    { maxLength: Infinity },
    { maxLengthSkew: -0.1 },
    { minLength: 20, maxLength: 13 },
  ]) {
    const invalid = {
      ...fullNative,
      buses: fullNative.buses!.map((bus) => ({ ...bus, ...bounds })),
    }
    const work = prepareSurfaceTimingBanks(invalid, previous, donor)
    expect(work.next()).toEqual({ done: true, value: null })
  }
  const nonfinite: FlexibleSignalState = {
    ...previous,
    retained: previous.retained.map((trace, index) =>
      index
        ? trace
        : {
            ...trace,
            route: trace.route.map((point, pointIndex) =>
              pointIndex ? point : { ...point, x: NaN },
            ),
          },
    ),
  }
  expect(
    prepareSurfaceTimingBanks(fullNative, nonfinite, donor).next(),
  ).toEqual({ done: true, value: null })
  expect(JSON.stringify({ fullNative, previous, donor })).toBe(before)
})

test("the total preparation budget cancels child work without mutating runtime checkpoints", () => {
  const { fullNative, previous, donor } = fixture(),
    before = JSON.stringify({ fullNative, previous, donor })
  expect(
    settle(
      prepareSurfaceTimingBanks(fullNative, previous, donor, { maxSteps: 0 }),
    ),
  ).toBeNull()
  expect(
    settle(
      prepareSurfaceTimingBanks(fullNative, previous, donor, { maxSteps: 1 }),
    ),
  ).toBeNull()
  const work = prepareSurfaceTimingBanks(fullNative, previous, donor)
  expect(work.next().done).toBe(false)
  expect(work.return(null).value).toBeNull()
  expect(JSON.stringify({ fullNative, previous, donor })).toBe(before)
})
