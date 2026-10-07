import { expect, test } from "bun:test"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { smoothTuningLobes } from "../lib/smooth-tuning"

test("local smooth bends do not exempt tight returning arms or crossings", () => {
  expect(
    tuningPathIsSelfClear(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 0.05 },
        { x: 0, y: 0.05 },
      ],
      0.2,
    ),
  ).toBe(false)
  expect(
    tuningPathIsSelfClear(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      0.2,
    ),
  ).toBe(false)
  const tightCurve = Array.from({ length: 37 }, (_, i) => ({
    x: 0.06 * Math.cos((Math.PI * i) / 36),
    y: 0.06 * Math.sin((Math.PI * i) / 36),
  }))
  expect(tuningPathIsSelfClear(tightCurve, 0.2)).toBe(false)
  expect(
    tuningPathIsSelfClear(
      smoothTuningLobes({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 2, 1, 0.3)!,
      0.2,
    ),
  ).toBe(true)
})

for (const layer of ["top", "bottom"]) {
  test(`${layer} carrier rejects a collinear backtrack even with repeated handoff points`, async () => {
    const { BusLanesSolver } = await import("../lib/bus-lanes-solver")
    for (const duplicated of [false, true]) {
      const path = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        ...(duplicated ? [{ x: 1, y: 0 }] : []),
        { x: 0.5, y: 0 },
      ]
      expect(tuningPathIsSelfClear(path, 0.2)).toBe(false)
      const route = path.map((point) => ({
        ...point,
        route_type: "wire" as const,
        layer,
        width: 0.1,
      }))
      const solver = BusLanesSolver.forValidation(
        {
          layerCount: 2,
          allowedLayers: [layer],
          minTraceWidth: 0.1,
          bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
          obstacles: [],
          connections: [
            { name: "signal", pointsToConnect: [route[0], route.at(-1)!] },
          ],
        },
        [
          {
            type: "pcb_trace",
            pcb_trace_id: "signal",
            connection_name: "signal",
            route,
          },
        ],
        { smoothTuning: false },
      )
      solver.solve()
      expect(solver.solved).toBe(false)
      expect(solver.error).toContain("self-clearance")
      const refinement = BusLanesSolver.forRefinement(
        solver.input,
        solver.traces,
        { smoothTuning: false },
        4096,
      )
      refinement.solve()
      expect(refinement.solved).toBe(false)
      expect(refinement.error).toContain("self-clearance")
    }
  })
}
