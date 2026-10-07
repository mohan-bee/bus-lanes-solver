import { BusLanesPipelineSolver } from "../lib"
import { loadAm3352SbcSample } from "./am3352-sbc-sample"
import { validateAm3352SbcSample } from "./validate-am3352-sbc-sample"
const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith("--"))
if (
  flags.some(
    (a) => !["--byte0", "--byte1", "--clear-byte-corridors"].includes(a),
  )
)
  throw Error("Unknown option")
const positional = args.filter((a) => !a.startsWith("--"))
const timing = positional[0] ?? "benchmark"
if (timing !== "benchmark" && timing !== "complete")
  throw Error(
    "Usage: bun scripts/repro-am3352-sbc.ts [benchmark|complete] [completed.json]",
  )
const input = loadAm3352SbcSample(
  timing,
  flags.includes("--clear-byte-corridors") ? "byte-corridors" : "published",
  flags.includes("--byte1")
    ? "byte1"
    : flags.includes("--byte0")
      ? "byte0"
      : "all",
)
const solver = new BusLanesPipelineSolver(input)
const before = performance.now()
while (!solver.solved && !solver.failed) {
  solver.step()
  if (performance.now() - before > 1800000)
    throw Error("SBC solve exceeded 1800 seconds")
}
if (!solver.solved) throw Error(solver.error ?? "SBC solve failed")
const output = solver.getOutput()
const report = validateAm3352SbcSample(input, output)
console.log(
  JSON.stringify(
    {
      seconds: (performance.now() - before) / 1000,
      iterations: solver.iterations,
      ...report,
    },
    null,
    2,
  ),
)
if (!report.valid)
  throw Error(
    "Completed SBC output failed connectivity, DRC, matching or coupling checks",
  )
if (positional[1]) await Bun.write(positional[1], JSON.stringify(output))
