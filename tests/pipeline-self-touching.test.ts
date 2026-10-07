import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import type { Trace, Wire } from "../lib"

for (const layer of ["top", "bottom"]) {
  test(`${layer} final acceptance rejects an approach crossing its individually valid carrier`, () => {
    const wire = (x: number, y: number): Wire => ({
      route_type: "wire",
      layer,
      width: 0.1,
      x,
      y,
    })
    const solver = new BusLanesPipelineSolver(
      {
        layerCount: 2,
        allowedLayers: ["top", "bottom"],
        minTraceWidth: 0.1,
        bounds: { minX: -2, maxX: 4, minY: -2, maxY: 2 },
        obstacles: [],
        connections: [
          { name: "CONTROL", pointsToConnect: [wire(0, 0), wire(3, 0)] },
        ],
      },
      { fanout: "none", smoothTuning: false },
    )
    solver.step()
    // Simulate an invalid owned approach handed to the joining boundary. The
    // child routes a straight, self-clear carrier; only assembled copper has
    // the bypass, so accepting the child alone would be insufficient.
    const state = solver as unknown as { escapes: Trace[] }
    state.escapes = [
      {
        type: "pcb_trace",
        pcb_trace_id: "approach",
        connection_name: "CONTROL",
        route: [
          wire(0, 0),
          wire(0, 1),
          wire(1, 1),
          wire(1, -1),
          wire(0, -1),
          wire(0, 0),
        ],
      },
    ]
    solver.solve()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("shorts to itself")
    solver.tryFinalAcceptance()
    expect(solver.solved).toBe(false)
    expect(() => solver.getOutput()).toThrow("shorts to itself")
  })
}

for (const mode of ["nativeSingleCarrier", "connectivitySolver"] as const) {
  test(`${mode} completion rejects self-touching copper before accepting it`, () => {
    const wire = (x: number, y: number): Wire => ({
      route_type: "wire",
      layer: "top",
      width: 0.1,
      x,
      y,
    })
    const solver = new BusLanesPipelineSolver(
      {
        layerCount: 2,
        minTraceWidth: 0.1,
        bounds: { minX: -2, maxX: 4, minY: -2, maxY: 4 },
        obstacles: [],
        connections: [
          { name: "CONTROL", pointsToConnect: [wire(0, 0), wire(3, 0)] },
        ],
      },
      { fanout: "none" },
    )
    const traces: Trace[] = [
      {
        type: "pcb_trace",
        pcb_trace_id: "self-touching-completion",
        connection_name: "CONTROL",
        route: [wire(0, 0), wire(2, 2), wire(0, 2), wire(2, 0), wire(3, 0)],
      },
    ]
    // Inject an invalid child result at each new completion boundary: acceptance
    // must independently audit even a child that claims successful routing.
    Object.assign(
      solver,
      mode === "nativeSingleCarrier"
        ? {
            nativeSingleCarrier: (function* () {
              return traces
            })(),
          }
        : {
            connectivitySolver: {
              step() {},
              solved: true,
              failed: false,
              error: null,
              stats: {},
              traces,
            },
          },
    )
    solver.step()
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("shorts to itself")
    solver.tryFinalAcceptance()
    expect(solver.solved).toBe(false)
    expect(() => solver.getOutput()).toThrow("shorts to itself")
  })
}
