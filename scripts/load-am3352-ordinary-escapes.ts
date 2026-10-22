import type { FlexibleSignalState } from "../lib/flexible-signal-state"
import { planSharedPairCorridors } from "../lib/plan-shared-pair-corridors"
import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import type { Obstacle, Trace, Wire } from "../lib/types"
import { loadAm3352FreshNativeInput } from "./load-am3352-fresh-native"
import { loadAm3352SharedPairs } from "./load-am3352-shared-pairs"

let seed: FlexibleSignalState | undefined

/** Derive the reproduction entirely from existing public repository fixtures.
 * Board-world XY millimeters, +X right, +Y up. Pad IDs identify their current
 * centers in the shared-pair fixture; no newly captured board data is loaded.
 * Generate the pair seed at runtime rather than storing intermediate copper. */
export function loadAm3352OrdinaryEscapes(): FlexibleSignalState {
  if (seed) return structuredClone(seed)
  const { input: allocation, terminalLayers } = loadAm3352SharedPairs()
  const native = loadAm3352FreshNativeInput()
  native.obstacles = allocation.obstacles
  for (const connection of native.connections)
    for (const point of connection.pointsToConnect) {
      const pad = (
        native.obstacles as (Obstacle & {
          circuitJsonMetadata?: { pcb_port_id?: string }
        })[]
      ).find(
        (obstacle) =>
          obstacle.circuitJsonMetadata?.pcb_port_id === point.pcb_port_id,
      )
      if (!pad) throw Error("Public fixture is missing a native pad")
      Object.assign(point, pad.center)
    }
  native.buses = structuredClone(allocation.buses)
  // Standalone maximums are supported after the merged core conversion fix.
  for (const bus of native.buses ?? [])
    if (bus.busId !== "DDR_ADDR_CTRL_CK") delete bus.minLength
  Object.assign(native, { allowViaInPad: false })
  delete native.allowedLayers
  allocation.buses = native.buses
  const plans = planSharedPairCorridors(allocation, terminalLayers, true, {
    preferPackageOnlyTuning: true,
  })
  let next = plans.next(),
    steps = 0
  try {
    while (!next.done && !next.value && steps++ < 20_000) next = plans.next()
    if (!next.value)
      throw Error("Public AM3352 fixture did not produce a joint pair seed")
    const retained: Trace[] = next.value
    const escapes = allocation.traces!.map((escape) => {
      const carrier = retained.find(
        (trace) => trace.connection_name === escape.connection_name,
      )!
      return retargetGeneratedEscape(escape, (carrier.route[0] as Wire).layer)
    })
    const pairs = new Set(
      native.differentialPairs!.flatMap((pair) => pair.connectionNames),
    )
    seed = {
      native,
      pending: {
        ...native,
        connections: allocation.connections.filter(
          (connection) => !pairs.has(connection.name),
        ),
        traces: [...escapes, ...retained],
      },
      retained,
      escapes,
      traces: [],
    }
    return structuredClone(seed)
  } finally {
    if (!next.done) plans.return(undefined)
  }
}
