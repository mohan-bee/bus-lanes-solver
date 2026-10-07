import { expect, test } from "bun:test"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"
import { prepareSbcPackageSearch } from "../scripts/solve-am3352-sbc-package-first"

test("package-first sample verifies actual terminals, pad geometry and all timing rules", async () => {
  const input = loadAm3352SbcSample("benchmark")
  const original = structuredClone(input)
  const search = await prepareSbcPackageSearch(input)
  expect(search.input.connections).toHaveLength(47)
  expect(search.input.obstacles).toHaveLength(420)
  expect(search.input.traces).toHaveLength(161)
  expect(input).toEqual(original)
  input.connections[0].pointsToConnect[1].x += 0.1
  await expect(prepareSbcPackageSearch(input)).rejects.toThrow(
    "terminals differ",
  )
  await expect(
    prepareSbcPackageSearch(loadAm3352SbcSample("complete")),
  ).rejects.toThrow("timing rules differ")
  const pair = loadAm3352SbcSample("benchmark")
  pair.differentialPairs![0].traceGap = 0.2
  await expect(prepareSbcPackageSearch(pair)).rejects.toThrow(
    "pair rules differ",
  )
  const restricted = loadAm3352SbcSample("benchmark")
  restricted.buses![0].allowedLayers = ["bottom"]
  await expect(prepareSbcPackageSearch(restricted)).rejects.toThrow(
    "bus layer restrictions differ",
  )
})

test("package-first routing cannot hide a changed BGA pad or narrower clearance", async () => {
  const input = loadAm3352SbcSample("benchmark")
  input.obstacles.find((o) => o.componentId === "pcb_component_0")!.width +=
    0.01
  await expect(prepareSbcPackageSearch(input)).rejects.toThrow(
    "pad geometry differs",
  )
  const wider = loadAm3352SbcSample("benchmark")
  wider.minTraceToPadEdgeClearance = 0.2
  await expect(prepareSbcPackageSearch(wider)).rejects.toThrow(
    "minTraceToPadEdgeClearance differs",
  )
})
