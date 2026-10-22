import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

const full: SimpleRouteJson = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "./fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
        import.meta.url,
      ),
    ),
  ).toString(),
)
function scope(busId: string) {
  const input = structuredClone(full),
    bus = input.buses!.find((b) => b.busId === busId)!
  const names = new Set(bus.connectionNames)
  input.connections = input.connections.filter((c) => names.has(c.name))
  bus.maxLength = Math.max(
    ...input.connections.map((c) => {
      const [a, b] = c.pointsToConnect
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    }),
  )
  delete bus.minLength
  bus.allowedLayers = ["top", "bottom"]
  bus.preferredLayer = busId === "DDR_BYTE0" ? "top" : "bottom"
  input.buses = [bus]
  input.differentialPairs = input.differentialPairs!.filter((p) =>
    p.connectionNames.every((n) => names.has(n)),
  )
  return input
}

// Records the remaining failure; a future fix must replace the failure assertion
// with completed routing, independent copper validation and matching checks.
test("second DDR byte cannot assign dogbones around a freshly routed first byte", () => {
  const firstInput = scope("DDR_BYTE1")
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

  const secondInput = scope("DDR_BYTE0")
  // Input copper comes exclusively from this test's fresh successful solve.
  secondInput.traces = first.getOutput().traces
  const fixedBefore = JSON.stringify(secondInput.traces)
  const secondBefore = JSON.stringify(secondInput)
  expect(secondInput.traces).toHaveLength(11)
  const second = new BusLanesPipelineSolver(secondInput)
  while (!second.solved && !second.failed && second.iterations < 1000)
    second.step()
  expect(second.solved).toBe(false)
  expect(second.failed).toBe(true)
  expect(second.failureCode).toBe("local_dogbone_failed")
  expect(second.error).toContain("No collision-free local dogbone assignment")
  expect(second.error).toContain("stage=native_fallback_assignment")
  expect(second.error).toContain("fixedTraces=11")
  expect(second.error).toContain('unavailableLocalVia=["source_trace_29"]')
  expect(second.error).toContain(
    '"connectionName":"source_trace_29","fromLayer":"bottom","toLayer":"top"',
  )
  expect(JSON.stringify(secondInput)).toBe(secondBefore)
  expect(JSON.stringify(secondInput.traces)).toBe(fixedBefore)
}, 120000)
