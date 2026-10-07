import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  busLengthReports,
  pairLengthReports,
  type SimpleRouteJson,
  type Trace,
} from "../lib"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { distance } from "../lib/geometry"

/** Known plane connections are supplied only to the checker, never requested
 * as signal routing. Their terminal is the original pad, not the plane via. */
export function validateAm3352SbcSample(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
) {
  const fixedCount = input.traces?.length ?? 0
  const fixedPreserved =
    JSON.stringify(output.traces?.slice(0, fixedCount)) ===
    JSON.stringify(input.traces)
  const signals = (output.traces ?? []).slice(fixedCount)
  const complete =
    signals.length === input.connections.length &&
    input.connections.every((c) => {
      const traces = signals.filter((t) => t.connection_name === c.name)
      if (traces.length !== 1) return false
      const route = traces[0].route
      const ends = [route[0], route.at(-1)!]
      return (
        ends.every((p) =>
          c.pointsToConnect.some((q) => distance(p, q) < 1e-7),
        ) &&
        c.pointsToConnect.every((p) => ends.some((q) => distance(p, q) < 1e-7))
      )
    })
  const allowedLayers = signals.every((t) =>
    t.route.every(
      (p) => p.route_type !== "wire" || input.allowedLayers?.includes(p.layer),
    ),
  )
  const ground = {
    name: "source_net_0",
    pointsToConnect: input
      .traces!.map((t) => t.route[0])
      .map((p) => ({
        ...p,
        layer: p.route_type === "wire" ? p.layer : p.from_layer,
      })),
  }
  const checkerInput = { ...input, connections: [...input.connections, ground] }
  const drc = validateRoutedCopperDrc({
    inputSrj: checkerInput,
    routedSrj: output,
    clearance: input.minTraceToPadEdgeClearance ?? 0.1,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  const buses = busLengthReports(input, signals)
  const pairs = pairLengthReports(input, signals)
  const coupling = exteriorPairSpacingReports(input, signals)
  const matched =
    [...buses, ...pairs].every((r) => r.matched) &&
    buses.every((r) => r.withinLengthLimit && r.aboveMinimumLength)
  return {
    valid:
      fixedPreserved &&
      complete &&
      allowedLayers &&
      drc.valid &&
      matched &&
      coupling.every((p) => p.applicable && p.matched),
    fixedPreserved,
    complete,
    allowedLayers,
    drc,
    buses,
    pairs,
    coupling,
    signals: signals.length,
  }
}
