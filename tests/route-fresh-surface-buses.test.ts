import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { distance } from "../lib/geometry"
import { joinSignalEscapes } from "../lib/join-signal-escapes"
import { pairCouplingReports } from "../lib/pair-coupling"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { routeFreshSurfaceBuses } from "../lib/route-fresh-surface-buses"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

function fixture(blockBottom: boolean): SimpleRouteJson {
  const lines = [
    ["A0", 0],
    ["A1", 0.8],
    ["B0", 1.6],
    ["B1", 2.4],
    ["CLKP", -2],
    ["CLKN", -2.24],
    ["ENABLE", 4],
  ] as const
  return {
    layerCount: 4,
    allowedLayers: blockBottom ? ["bottom", "top"] : ["top", "bottom"],
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.08,
    bounds: { minX: -8, maxX: 8, minY: -6, maxY: 7 },
    obstacles: [
      ...lines.flatMap(([name, y]) =>
        [-3, 3].map((x) => ({
          componentId: x < 0 ? "driver" : "receiver",
          center: { x, y },
          width: 0.12,
          height: 0.12,
          layers: ["top"],
          connectedTo: [name],
        })),
      ),
      ...(blockBottom
        ? [
            {
              center: { x: 0, y: 0.5 },
              width: 16,
              height: 13,
              layers: ["bottom"],
              connectedTo: [],
            },
          ]
        : []),
    ],
    connections: lines.map(([name, y]) => ({
      name,
      pointsToConnect: [
        { x: -3, y, layer: "top" },
        { x: 3, y, layer: "top" },
      ],
    })),
    buses: [
      { busId: "byteA", connectionNames: ["A0", "A1"], maxLengthSkew: 0.1 },
      { busId: "byteB", connectionNames: ["B0", "B1"], maxLengthSkew: 0.1 },
    ],
    differentialPairs: [
      {
        connectionNames: ["CLKP", "CLKN"],
        lengthTolerance: 0.05,
        traceGap: 0.12,
        maxUncoupledLength: 0.01,
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "existing_supply",
        connection_name: "SUPPLY",
        route: [
          { route_type: "wire", x: -4, y: 6, layer: "top", width: 0.12 },
          { route_type: "wire", x: 4, y: 6, layer: "top", width: 0.12 },
        ],
      },
    ],
  }
}

for (const blocked of [false, true]) {
  test(`fresh surface routing stages both byte buses, a standalone pair, and a control${blocked ? " despite an unavailable preferred bottom plane" : ""}`, () => {
    const input = fixture(blocked)
    // The allocation suggests a bottom carrier in the second case. A fresh
    // native-pad choice must survive when that plane is physically blocked.
    const allocation: SimpleRouteJson = {
      ...input,
      connections: input.connections.map((c) => ({
        ...c,
        pointsToConnect: c.pointsToConnect.map((p) => ({
          ...p,
          layer: blocked ? "bottom" : "top",
        })),
      })),
    }
    const escapes: Trace[] = []
    const before = structuredClone({ input, allocation, escapes })
    const generator = routeFreshSurfaceBuses(
      input,
      allocation,
      escapes,
      new Map(input.connections.map((c) => [c.name, input.allowedLayers!])),
      { denseSearch: true, smoothTuning: true },
    )
    let step = generator.next(),
      iterations = 0
    try {
      while (!step.done && iterations++ < 10000) step = generator.next()
      expect(step.done).toBe(true)
      expect(step.value).not.toBeNull()
      const result = step.value!
      expect({ input, allocation, escapes }).toEqual(before)
      expect(result.input.traces!.slice(0, input.traces!.length)).toEqual(
        input.traces!,
      )
      expect(result.traces).toHaveLength(input.connections.length)
      expect(new Set(result.traces.map((t) => t.connection_name)).size).toBe(
        input.connections.length,
      )
      const validator = BusLanesSolver.forValidation(
        result.input,
        result.traces,
        { smoothTuning: true },
      )
      validator.solve()
      expect(validator.solved).toBe(true)
      expect(validator.error).toBeNull()
      expect(
        busLengthReports(result.input, result.traces).every(
          (report) => report.matched,
        ),
      ).toBe(true)
      expect(pairLengthReports(result.input, result.traces)[0].matched).toBe(
        true,
      )
      const joined = result.traces.map((t) =>
        joinSignalEscapes(
          t,
          result.escapes.filter((e) => e.connection_name === t.connection_name),
        ),
      )
      expect(routeAnglesAreConventional(joined)).toBe(true)
      for (const trace of joined) {
        const connection = input.connections.find(
          (c) => c.name === trace.connection_name,
        )!
        expect(
          distance(trace.route[0], connection.pointsToConnect[0]),
        ).toBeLessThan(1e-8)
        expect(
          distance(trace.route.at(-1)!, connection.pointsToConnect[1]),
        ).toBeLessThan(1e-8)
        expect((trace.route[0] as Wire).layer).toBe("top")
        expect((trace.route.at(-1)! as Wire).layer).toBe("top")
        if (!trace.connection_name!.startsWith("CLK"))
          expect(
            result.traces
              .find(
                (carrier) => carrier.connection_name === trace.connection_name,
              )!
              .route.every((p) => p.route_type === "wire"),
          ).toBe(true)
      }
      const pair = pairCouplingReports(input, joined)[0]
      expect(pair.matched).toBe(true)
      expect(
        pair.conductors.every((conductor) => conductor.coupledFraction > 0.99),
      ).toBe(true)
      if (blocked)
        expect(
          joined.every((t) =>
            t.route.every((p) => p.route_type === "wire" && p.layer === "top"),
          ),
        ).toBe(true)
      // Audit fixed power and joined signals together against the original
      // physical pads; the carrier validator alone sees only handoff points.
      const fixed = input.traces![0]
      const physical = {
        ...input,
        connections: [
          ...input.connections,
          {
            name: "SUPPLY",
            pointsToConnect: [
              fixed.route[0] as Wire,
              fixed.route.at(-1)! as Wire,
            ],
          },
        ],
      }
      const drc = validateRoutedCopperDrc({
        inputSrj: physical,
        routedSrj: { ...physical, traces: [...input.traces!, ...joined] },
        clearance: 0.08,
        allowBlindAndBuriedVias: false,
      } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
      expect(drc.valid).toBe(true)
      expect(drc.issues).toEqual([])
    } finally {
      if (!step.done) generator.return(null)
    }
  })
}

test("the pipeline stages explicitly requested native pad planes", () => {
  const input = fixture(false)
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.step()
  expect(solver.phase).toBe("route_shared_layers")
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(input.connections.length)
  expect(input).toEqual(before)
  const fixed = input.traces![0]
  const physical = {
    ...input,
    connections: [
      ...input.connections,
      {
        name: "SUPPLY",
        pointsToConnect: [fixed.route[0], fixed.route.at(-1)!] as Wire[],
      },
    ],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: physical as Parameters<
      typeof validateRoutedCopperDrc
    >[0]["inputSrj"],
    routedSrj: {
      ...solver.getOutput(),
      connections: physical.connections,
    } as Parameters<typeof validateRoutedCopperDrc>[0]["routedSrj"],
    clearance: 0.08,
  })
  expect(drc.issues).toEqual([])
})
