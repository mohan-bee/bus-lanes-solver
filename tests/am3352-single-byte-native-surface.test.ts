import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import type { SimpleRouteJson } from "../lib/types"

// Expected failure until the stacked strategy fix; unexpected success fails CI.
test.failing("one hard-length native DDR byte uses joint surface escapes and passes matching", () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  const bus = input.buses!.find((bus) => bus.busId === "DDR_BYTE1")!
  const names = new Set(bus.connectionNames)
  input.connections = input.connections.filter((connection) =>
    names.has(connection.name),
  )
  bus.maxLength = Math.max(
    ...input.connections.map((connection) => {
      const [a, b] = connection.pointsToConnect
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    }),
  )
  delete bus.minLength
  input.buses = [bus]
  input.differentialPairs = input.differentialPairs!.filter((pair) =>
    pair.connectionNames.every((name) => names.has(name)),
  )
  const before = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input)
  while (!solver.solved && !solver.failed && solver.iterations < 35000)
    solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failureCode).toBeNull()
  expect(solver.iterations).toBeLessThan(35000)
  expect(input.connections).toHaveLength(11)
  expect(bus.maxLength).toBeCloseTo(20.200131, 6)
  expect(solver.stats.busLengths).toEqual([
    expect.objectContaining({
      busId: "DDR_BYTE1",
      matched: true,
      withinLengthLimit: true,
    }),
  ])
  expect(solver.stats.pairLengths).toEqual([
    expect.objectContaining({ matched: true }),
  ])
  expect(JSON.stringify(input)).toBe(before)
}, 120000)
