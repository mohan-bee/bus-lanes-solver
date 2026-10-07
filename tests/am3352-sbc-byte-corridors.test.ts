import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"
import { validateAm3352SbcSample } from "../scripts/validate-am3352-sbc-sample"

for (const scope of ["byte0", "byte1"] as const) {
  test(`${scope} freshly routes with complete board obstacles after decoupler moves`, () => {
    const published = loadAm3352SbcSample("benchmark")
    const input = loadAm3352SbcSample("benchmark", "byte-corridors", scope)
    expect(input.obstacles).toHaveLength(1111)
    expect(input.traces).toEqual(published.traces)
    const moved = new Set(
      input.obstacles
        .filter(
          (o, index) =>
            JSON.stringify(o.center) !==
            JSON.stringify(published.obstacles[index].center),
        )
        .map((o) => o.componentId),
    )
    expect(moved.size).toBe(7)
    expect(moved.has("pcb_component_0")).toBe(false)
    expect(moved.has("pcb_component_1")).toBe(false)
    expect(input.connections).toHaveLength(11)
    const solver = new BusLanesPipelineSolver(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const report = validateAm3352SbcSample(input, solver.getOutput())
    expect(report.valid).toBe(true)
    expect(report.signals).toBe(11)
  }, 60_000)
}
