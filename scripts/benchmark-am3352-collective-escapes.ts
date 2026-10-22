import { resolve } from "node:path"
import { writeFileSync } from "node:fs"
import { loadAm3352CollectiveEscapes } from "./load-am3352-collective-escapes"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"

const baselineRoot = process.argv[2]
if (!baselineRoot)
  throw Error(
    "Usage: bun scripts/benchmark-am3352-collective-escapes.ts <baseline-checkout> [output.json]",
  )
const baseline = await import(
  resolve(baselineRoot, "lib/negotiate-signal-sites.ts")
)
const revision = async (directory: string) => {
  const child = Bun.spawn(["git", "-C", directory, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const value = (await new Response(child.stdout).text()).trim()
  if (await child.exited) throw Error("Cannot identify benchmark revision")
  return value
}
const seedStarted = performance.now(),
  initial = loadAm3352CollectiveEscapes()
const pairNames = new Set(
  initial.native.differentialPairs!.flatMap((pair) => pair.connectionNames),
)
const ordinaryNames = initial.native.connections
  .filter((connection) => !pairNames.has(connection.name))
  .map((connection) => connection.name)
const report = {
  baseRevision: await revision(baselineRoot),
  headRevision: await revision(resolve(import.meta.dir, "..")),
  runtime: {
    bun: Bun.version,
    platform: process.platform,
    architecture: process.arch,
  },
  scope:
    "Time to reject an incompatible generated pair seed; not final routing success",
  seedGenerationSeconds: (performance.now() - seedStarted) / 1000,
  maxYieldsPerCase: 250000,
  cases: [] as Array<{ name: string; policies: Record<string, unknown> }>,
}
for (const [name, names] of [
  [
    "four-signal-conflict",
    ["source_trace_1", "source_trace_2", "source_trace_12", "source_trace_13"],
  ],
  ["forty-ordinary-signals", ordinaryNames],
] as const) {
  const policies: Record<string, unknown> = {}
  for (const policy of ["base", "head"]) {
    const state = structuredClone(initial)
    if (name === "four-signal-conflict") {
      state.traces = []
      state.escapes = state.escapes.filter((trace) =>
        pairNames.has(trace.connection_name!),
      )
    }
    const expected = JSON.stringify(state)
    const options = {
      allowExpandedSites: true,
      expandEmptyDomainsOnly: true,
      retainExistingRoutes: true,
      maxCandidateSearchNodes: 12000,
    }
    const work: Generator<unknown, FlexibleSignalState | null> =
      policy === "base"
        ? baseline.negotiateSignalSites(
            state,
            new Set(names),
            false,
            false,
            options,
          )
        : negotiateSignalSites(state, new Set(names), false, false, {
            ...options,
            checkEscapeCompatibility: true,
          })
    const start = performance.now()
    let next = work.next(),
      yields = 0
    while (!next.done && yields < report.maxYieldsPerCase) {
      yields++
      next = work.next()
    }
    const seconds = (performance.now() - start) / 1000
    policies[policy] = {
      seconds,
      yields,
      finished: next.done === true,
      candidateFound: next.done ? next.value !== null : false,
      status: next.done
        ? next.value
          ? "candidate"
          : "rejected_seed"
        : "yield_budget_exhausted",
      inputUnchanged: expected === JSON.stringify(state),
    }
    if (!next.done) work.return(null)
    console.log(
      JSON.stringify({ case: name, policy, ...(policies[policy] as object) }),
    )
  }
  report.cases.push({ name, policies })
}
writeFileSync(
  process.argv[3] ?? "collective-escape-benchmark.json",
  JSON.stringify(report, null, 2) + "\n",
)
