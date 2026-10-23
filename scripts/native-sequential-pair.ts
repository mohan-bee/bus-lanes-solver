import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { loadNativeDdrByte } from "./am3352-native-ddr-byte"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import { runBoundedRouting } from "../lib/run-bounded-routing"
import { fixedCopper } from "../lib/vector-scene"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson, Trace } from "../lib/types"

/** Public fixture only; native board-world XY mm, +X right/+Y up. The first
 * byte is solved freshly on every invocation; no retained copper is loaded. */
export function loadSequentialNativeDdr() {
  const firstInput = loadNativeDdrByte("DDR_BYTE1")
  const before = JSON.stringify(firstInput)
  const first = new BusLanesPipelineSolver(firstInput)
  while (!first.solved && !first.failed && first.iterations < 35000)
    first.step()
  if (!first.solved || before !== JSON.stringify(firstInput))
    throw Error("First native byte did not complete without input mutation")
  const firstOutput = first.getOutput()
  const secondInput = loadNativeDdrByte("DDR_BYTE0")
  secondInput.traces = firstOutput.traces
  return { firstInput, firstOutput, secondInput }
}

export function* nativeDqs0Control(input: SimpleRouteJson, maxSteps: number) {
  return yield* runBoundedRouting(
    routeCoupledPair(input, input.differentialPairs![0], fixedCopper(input), {
      copper: [],
      penalty: 0,
      variant: 0,
      preferPackageOnlyTuning: true,
    }),
    maxSteps,
  )
}

/** Validate a completed scoped DQS0 pair and its separately validated prior
 * byte. This does not establish completion of the other nine BYTE0 signals. */
export function auditSequentialNativePair(
  sample: ReturnType<typeof loadSequentialNativeDdr>,
  traces: Trace[],
) {
  const { firstInput, firstOutput, secondInput: input } = sample
  const firstDrc = validateRoutedCopperDrc({
    inputSrj: firstInput as never,
    routedSrj: firstOutput as never,
    clearance: firstInput.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  const firstBuses = busLengthReports(firstInput, firstOutput.traces!),
    firstPairs = pairLengthReports(firstInput, firstOutput.traces!),
    firstCoupling = exteriorPairSpacingReports(firstInput, firstOutput.traces!)
  const names = new Set(input.differentialPairs![0].connectionNames)
  const scoped = {
    ...input,
    connections: input.connections.filter((c) => names.has(c.name)),
    buses: input.buses!.map((b) => ({
      ...b,
      connectionNames: b.connectionNames.filter((n) => names.has(n)),
    })),
  }
  const combined = {
    ...input,
    connections: [...firstInput.connections, ...input.connections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: { ...combined, traces: [...input.traces!, ...traces] } as never,
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  const connected =
    scoped.connections.length === 2 &&
    traces.length === 2 &&
    scoped.connections.every((c) => {
      const t = traces.find((t) => t.connection_name === c.name)
      return (
        !!t &&
        [0, 1].every((i) => {
          const p = i ? t.route.at(-1)! : t.route[0],
            q = c.pointsToConnect[i]
          return (
            p.route_type === "wire" &&
            p.layer === q.layer &&
            Math.hypot(p.x - q.x, p.y - q.y) < 1e-8
          )
        })
      )
    })
  const buses = busLengthReports(scoped, traces),
    pairs = pairLengthReports(scoped, traces),
    coupling = exteriorPairSpacingReports(scoped, traces)
  const valid =
    connected &&
    firstDrc.valid &&
    drc.valid &&
    [...firstBuses, ...buses].every((b) => b.matched && b.withinLengthLimit) &&
    [...firstPairs, ...pairs, ...firstCoupling, ...coupling].every(
      (p) => p.matched,
    )
  return {
    scope:
      "Completed DQS0 pair only, around freshly completed BYTE1; BYTE0 and SBC remain incomplete",
    valid,
    connected,
    firstDrc,
    firstBuses,
    firstPairs,
    firstCoupling,
    drc,
    buses,
    pairs,
    coupling,
  }
}
