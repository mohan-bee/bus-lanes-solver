import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import { am3352Hash, loadAm3352Sample } from "../scripts/am3352-samples"
import { validateAm3352Sample } from "../scripts/validate-am3352-sample"

test("native surface search changes preserve the complete legacy inner-left route", async () => {
  const { input, metadata } = await loadAm3352Sample("inner-layers-left")
  const before = am3352Hash(input)
  const solver = new BusLanesPipelineSolver(input, {
    singleCarrier: { fixedConnections: metadata.powerConnections },
  })
  try {
    while (!solver.solved && !solver.failed) solver.step()
    expect({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
    }).toMatchObject({ solved: true, failed: false })
    expect(am3352Hash(input)).toBe(before)
    const report = await validateAm3352Sample(input, metadata, solver.traces)
    expect(report).toMatchObject({
      valid: true,
      complete: true,
      matched: true,
      fixedPowerTraces: 161,
      fixedPowerVias: 161,
      fixedPowerPadJoins: 161,
    })
    expect(report.combinedDrc?.valid).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.quality?.issues).toEqual([])
  } finally {
    if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
  }
}, 360_000)
