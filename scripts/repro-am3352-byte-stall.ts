import { createHash } from "node:crypto"
import { BusLanesPipelineSolver } from "../lib"
import {
  am3352ByteStallInputSha256,
  loadAm3352ByteStallInput,
} from "./load-am3352-byte-stall-input"

type CaseName = "native" | "explicit-surfaces"

const args = process.argv.slice(2)
let selectedCase: CaseName | "both" = "both"
let stepBudget = 12_000
let seconds = 60
let worker = false
for (let i = 0; i < args.length; i++) {
  const flag = args[i]
  if (flag === "--worker") {
    worker = true
    continue
  }
  if (!["--case", "--steps", "--seconds"].includes(flag))
    throw Error(`Unknown option: ${flag}`)
  const value = args[++i]
  if (!value || value.startsWith("--")) throw Error(`Missing ${flag}`)
  if (flag === "--case") {
    if (!["native", "explicit-surfaces", "both"].includes(value))
      throw Error("Unknown case")
    selectedCase = value as typeof selectedCase
  } else if (flag === "--steps") {
    stepBudget = Number(value)
    if (!Number.isSafeInteger(stepBudget) || stepBudget <= 0)
      throw Error("--steps must be a positive integer")
  } else {
    seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0)
      throw Error("--seconds must be positive and finite")
  }
}

function runCase(name: CaseName) {
  const input = loadAm3352ByteStallInput()
  if (name === "explicit-surfaces") input.allowedLayers = ["top", "bottom"]
  const inputHash = () =>
    createHash("sha256").update(JSON.stringify(input)).digest("hex")
  const before = inputHash()
  const solver = new BusLanesPipelineSolver(input)
  const started = performance.now()
  let lastReport = started
  const report = () => ({
    case: name,
    nativeInputSha256: am3352ByteStallInputSha256,
    redundantGlobalLayers: name === "explicit-surfaces",
    stepBudget,
    secondsBudget: seconds,
    runtimeMs: performance.now() - started,
    iterations: solver.iterations,
    phase: solver.phase,
    progress: solver.progress,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    failureCode: solver.failureCode,
    requestedSignals: input.connections.length,
    partialTraceCount: solver.traces.length,
    stats: solver.stats,
  })
  try {
    while (
      !solver.solved &&
      !solver.failed &&
      solver.iterations < stepBudget &&
      performance.now() - started < seconds * 1000
    ) {
      solver.step()
      if (performance.now() - lastReport >= 1000) {
        console.log("PROGRESS " + JSON.stringify(report()))
        lastReport = performance.now()
      }
    }
    return {
      ...report(),
      status: solver.solved
        ? "solver_completed"
        : solver.failed
          ? "solver_failed"
          : solver.iterations >= stepBudget
            ? "step_budget_exhausted"
            : "wall_budget_exhausted",
      inputUnchanged: inputHash() === before,
      outputConnectivityDrcAndTimingVerified: false,
    }
  } finally {
    if (!solver.solved && !solver.failed) solver.tryFinalAcceptance()
  }
}

if (worker) {
  if (selectedCase === "both") throw Error("A worker runs exactly one case")
  console.log("REPORT " + JSON.stringify(runCase(selectedCase)))
} else {
  const cases: CaseName[] =
    selectedCase === "both" ? ["native", "explicit-surfaces"] : [selectedCase]
  for (const name of cases) {
    const child = Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        "--worker",
        "--case",
        name,
        "--steps",
        String(stepBudget),
        "--seconds",
        String(seconds),
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    let killed = false
    // The parent also bounds a worker stuck inside a synchronous solver step.
    const timer = setTimeout(
      () => {
        killed = true
        child.kill()
      },
      (seconds + 10) * 1000,
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timer)
    const lines = stdout.split("\n")
    const completed = lines.find((line) => line.startsWith("REPORT "))
    const progress = lines.filter((line) => line.startsWith("PROGRESS ")).at(-1)
    const result =
      exitCode === 0 && completed
        ? JSON.parse(completed.slice(7))
        : {
            ...(progress ? JSON.parse(progress.slice(9)) : {}),
            case: name,
            stepBudget,
            secondsBudget: seconds,
            status: killed ? "worker_deadline_exceeded" : "worker_failed",
            error: killed
              ? "Worker exceeded the process deadline"
              : stderr || `Worker exited ${exitCode}`,
            outputConnectivityDrcAndTimingVerified: false,
          }
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== "solver_completed" || !result.inputUnchanged)
      process.exitCode = 1
  }
}
