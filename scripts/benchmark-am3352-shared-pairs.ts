import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { planSharedPairCorridors } from "../lib/plan-shared-pair-corridors"
import { loadAm3352SharedPairs } from "./load-am3352-shared-pairs"

// This measures a planning stage, not full DDR routing or bus matching.
const planPairs: typeof planSharedPairCorridors = process.argv[2]
  ? (await import(pathToFileURL(resolve(process.argv[2])).href))
      .planSharedPairCorridors
  : planSharedPairCorridors
const { input, terminalLayers } = loadAm3352SharedPairs()
const before = JSON.stringify(input)
const started = performance.now()
const search = planPairs(input, terminalLayers, true, {
  preferPackageOnlyTuning: true,
})
let state = search.next()
let steps = 0
try {
  while (!state.done && !state.value && steps < 20_000) {
    steps++
    state = search.next()
  }
  const report = {
    stage: "shared_pair_planning",
    jointPlanFound: !!state.value,
    inputUnchanged: JSON.stringify(input) === before,
    pairCount: input.differentialPairs!.length,
    plannedConductors: state.value?.length ?? 0,
    steps,
    stepBudget: 20_000,
    milliseconds: performance.now() - started,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.jointPlanFound || !report.inputUnchanged) process.exitCode = 1
} finally {
  if (!state.done) search.return(undefined)
}
