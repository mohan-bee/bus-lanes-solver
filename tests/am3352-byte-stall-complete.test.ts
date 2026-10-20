import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import { loadAm3352ByteStallInput } from "../scripts/load-am3352-byte-stall-input"
import { validateAm3352ByteStallOutput } from "../scripts/validate-am3352-byte-stall-output"

test("the exact native byte capture completes all eleven signals with DRC, timing and exterior coupling", () => {
  const input = loadAm3352ByteStallInput()
  const before = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  let steps = 0
  try {
    while (!solver.solved && !solver.failed && steps < 16_000) {
      solver.step()
      steps++
    }
    expect({
      solved: solver.solved,
      failed: solver.failed,
      phase: solver.phase,
      error: solver.error,
      steps,
    }).toMatchObject({ solved: true, failed: false })
    const report = validateAm3352ByteStallOutput(input, solver.getOutput())
    expect(input).toEqual(before)
    expect(report.issues).toEqual([])
    expect(report.copperDrc.issues).toEqual([])
    expect(report.quality.issues).toEqual([])
    expect(report).toMatchObject({
      valid: true,
      complete: true,
      inputPreserved: true,
      signals: 11,
      viaCount: 12,
      nonPlatedHoleCount: 8,
      matched: true,
      coupled: true,
    })
    expect(report.carrierLayers.map((bus) => bus.layers)).toEqual([
      Array(5).fill("top"),
      Array(6).fill("bottom"),
    ])
    expect(
      report.buses.map((bus) => [bus.minLengthMm, bus.maxLengthMm]),
    ).toEqual([
      [33.585277, 34.220277],
      [33.585277, 34.220277],
    ])
    expect(report.pairs[0].skewMm!).toBeLessThanOrEqual(0.127 + 1e-7)
    expect(report.exterior[0]).toMatchObject({
      applicable: true,
      matched: true,
      separatedExteriorLengthMm: 0,
    })
  } finally {
    if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
  }
}, 120_000)
