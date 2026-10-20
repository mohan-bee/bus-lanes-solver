/** Compare redundant layer declarations without routing or exporting copper. */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { signalLayers } from "../lib/flexible-signal-state"
import type { SimpleRouteJson } from "../lib/types"

const bytes = gunzipSync(
  readFileSync(
    new URL(
      "../tests/fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
      import.meta.url,
    ),
  ),
)
const sha256 = createHash("sha256").update(bytes).digest("hex")
if (
  sha256 !== "384e4337e3fd09fbb67ca2e0a019cf485007fc75dd301bafb40cae2142042571"
)
  throw Error("Native CLI capture changed")
const original = JSON.parse(bytes.toString()) as SimpleRouteJson
if (
  original.allowedLayers !== undefined ||
  original.connections.length !== 46 ||
  original.obstacles.length !== 1144 ||
  original.traces?.length !== 0
)
  throw Error("Unexpected capture")
// Prove the global restriction excludes no carrier already permitted by buses.
for (const connection of original.connections) {
  const restricted = original.buses?.filter(
    (b) => b.connectionNames.includes(connection.name) && b.allowedLayers,
  )
  if (
    !restricted?.length ||
    !restricted.some((b) =>
      b.allowedLayers!.every((l) => l === "top" || l === "bottom"),
    )
  )
    throw Error(`Uncovered carrier domain: ${connection.name}`)
}
const reports = [false, true].map((explicit) => {
  const input = structuredClone(original)
  if (explicit) input.allowedLayers = ["top", "bottom"]
  const before = JSON.stringify(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.step() // Allocate dogbones and select a strategy; do not route copper.
  if (JSON.stringify(input) !== before) throw Error("Input mutated")
  return {
    explicitGlobalLayers: explicit,
    phase: solver.phase,
    iterationLimit: solver.MAX_ITERATIONS,
    failed: solver.failed,
    error: solver.error,
    layerDomains: input.buses!.map((bus) => ({
      busId: bus.busId,
      allowedLayers: bus.allowedLayers,
      emptyDomains: input.connections
        .filter(
          (c) =>
            bus.connectionNames.includes(c.name) &&
            signalLayers(input, c).length === 0,
        )
        .map((c) => c.name),
    })),
  }
})
const equivalent =
  reports[0].phase === reports[1].phase &&
  reports[0].iterationLimit === reports[1].iterationLimit &&
  JSON.stringify(reports[0].layerDomains) ===
    JSON.stringify(reports[1].layerDomains)
console.log(
  JSON.stringify(
    { sha256, diagnosticOnly: true, equivalent, reports },
    null,
    2,
  ),
)
if (process.argv.includes("--assert-equivalent") && !equivalent)
  process.exitCode = 1
