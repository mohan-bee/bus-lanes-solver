import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { initialSignalDogbones } from "../lib/initial-signal-dogbones"
import { routeAlternateSignalDogbones } from "../lib/alternate-signal-dogbones"
import { signalDogboneOptions } from "../lib/repair-bus-dogbones"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { loadNativeDdrByte } from "../scripts/am3352-native-ddr-byte"

// The escape allocation is independently DRC checked. Full second-byte
// interconnect completion and timing are a separate routing acceptance.
test("second DDR byte finds legal collective escapes around a freshly routed first byte", () => {
  const firstInput = loadNativeDdrByte("DDR_BYTE1")
  const firstBefore = JSON.stringify(firstInput)
  const first = new BusLanesPipelineSolver(firstInput)
  while (!first.solved && !first.failed && first.iterations < 35000)
    first.step()
  expect(first.solved).toBe(true)
  expect(first.stats.busLengths).toEqual([
    expect.objectContaining({
      busId: "DDR_BYTE1",
      matched: true,
      withinLengthLimit: true,
    }),
  ])
  expect(first.stats.pairLengths).toEqual([
    expect.objectContaining({ matched: true }),
  ])
  expect(JSON.stringify(firstInput)).toBe(firstBefore)

  const secondInput = loadNativeDdrByte("DDR_BYTE0")
  // Input copper comes exclusively from this test's fresh successful solve.
  secondInput.traces = first.getOutput().traces
  const fixedBefore = JSON.stringify(secondInput.traces)
  const secondBefore = JSON.stringify(secondInput)
  expect(secondInput.traces).toHaveLength(11)
  const targets = new Map(
    secondInput.connections.map((c) => [c.name, "bottom"]),
  )
  targets.set("source_trace_29", "top")
  const options = signalDogboneOptions(secondInput, targets)
  expect(() => routeAlternateSignalDogbones(secondInput, options, 0)).toThrow(
    "No collision-free local dogbone assignment",
  )
  const allocation = initialSignalDogbones(secondInput, options, 0)
  expect(allocation.connections).toHaveLength(11)
  expect(allocation.traces).toHaveLength(18)
  const pair = secondInput.differentialPairs![0]
  expect(
    allocation.connections
      .filter((c) => pair.connectionNames.includes(c.name))
      .every((c) =>
        c.pointsToConnect.every((p) => "layer" in p && p.layer === "bottom"),
      ),
  ).toBe(true)
  const auditInput = {
    ...secondInput,
    connections: [...firstInput.connections, ...secondInput.connections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: auditInput as never,
    routedSrj: {
      ...auditInput,
      traces: [...secondInput.traces!, ...allocation.traces],
    } as never,
    clearance: secondInput.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(drc.valid).toBe(true)
  const second = new BusLanesPipelineSolver(secondInput)
  second.step()
  expect(second.failed).toBe(false)
  expect(second.failureCode).toBeNull()
  expect(JSON.stringify(secondInput)).toBe(secondBefore)
  expect(JSON.stringify(secondInput.traces)).toBe(fixedBefore)
}, 120000)
