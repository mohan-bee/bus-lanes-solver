import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

test("a generated bottom dogbone can continue on the top surface without a same-layer via", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.12,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.11,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 11,
        layers: ["bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "DATA",
        pointsToConnect: [
          { x: -2.4, y: 0, layer: "top" },
          { x: 2.4, y: 0, layer: "top" },
        ],
      },
    ],
  }
  for (const [componentId, x] of [
    ["U1", -2.4],
    ["U2", 2.4],
  ] as const)
    for (let i = 0; i < 4; i++)
      input.obstacles.push({
        shape: "circle",
        componentId,
        center: { x: x + (i % 2) * 0.8, y: Math.floor(i / 2) * 0.8 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: i === 0 ? ["DATA"] : [],
      })
  // A crowded surface initially favors bottom dogbones. Its remote pad field
  // leaves this top corridor open when the bottom layer is blocked.
  for (let i = 0; i < 24; i++)
    input.obstacles.push({
      shape: "circle",
      componentId: "U3",
      center: { x: -4 + (i % 6) * 0.3, y: 4 + Math.floor(i / 6) * 0.15 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    })
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input, {
    denseSearch: true,
    smoothTuning: false,
  })
  solver.step()
  const generated = (
    solver as unknown as {
      escapes: Array<{ route: Array<{ route_type: string }> }>
    }
  ).escapes
  expect(generated).toHaveLength(2)
  expect(
    generated.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(2)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(1)
  const trace = solver.traces[0]
  expect(
    trace.route.every(
      (point) => point.route_type === "wire" && point.layer === "top",
    ),
  ).toBe(true)
  expect(trace.route[0]).toMatchObject(input.connections[0].pointsToConnect[0])
  expect(trace.route.at(-1)).toMatchObject(
    input.connections[0].pointsToConnect[1],
  )
  expect(
    validateRoutedCopperDrc({
      inputSrj: input as Parameters<
        typeof validateRoutedCopperDrc
      >[0]["inputSrj"],
      routedSrj: solver.getOutput() as Parameters<
        typeof validateRoutedCopperDrc
      >[0]["routedSrj"],
      clearance: 0.11,
    }).valid,
  ).toBe(true)
  expect(input).toEqual(before)
})
