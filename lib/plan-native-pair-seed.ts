import {
  pairHasUnroutedNativePads,
  routeCoupledPair,
} from "./coupled-pair-routing"
import { signalLayers } from "./flexible-signal-state"
import { length } from "./geometry"
import { maximumCarrierLength } from "./route-lengths"
import { runBoundedRouting } from "./run-bounded-routing"
import { fixedCopper } from "./vector-scene"
import type { SimpleRouteJson, Trace } from "./types"

export const NATIVE_PAIR_SEARCH_STEPS = 60000
export const NATIVE_PAIR_REPAIR_STEPS = 300000

/** Try original native pad endpoints before generated via handoffs around
 * previous-phase copper. Positions are board-world XY mm, +X right/+Y up.
 * Only an explicitly hard-length paired bus on an allowed common pad layer
 * participates. Supplied copper is fixed and never retargeted or removed. */
export function* planNativePairSeed(
  input: SimpleRouteJson,
  maxSteps = NATIVE_PAIR_SEARCH_STEPS,
): Generator<void, Trace[] | null> {
  const pair = input.differentialPairs?.[0]
  if (
    !pair ||
    input.differentialPairs!.length !== 1 ||
    !input.traces?.length ||
    !input.buses?.some(
      (bus) =>
        bus.maxLength !== undefined &&
        pair.connectionNames.every((name) =>
          bus.connectionNames.includes(name),
        ),
    ) ||
    !pairHasUnroutedNativePads(input, pair)
  )
    return null
  const members = input.connections.filter((c) =>
      pair.connectionNames.includes(c.name),
    ),
    layer = members[0].pointsToConnect[0].layer
  if (
    !members.every(
      (c) =>
        signalLayers(input, c).includes(layer) &&
        c.pointsToConnect.every((p) => p.layer === layer),
    )
  )
    return null
  const paired = yield* runBoundedRouting(
    routeCoupledPair(input, pair, fixedCopper(input), {
      copper: [],
      penalty: 0,
      variant: 0,
      preferPackageOnlyTuning: true,
    }),
    maxSteps,
  )
  return paired?.every(
    (t) =>
      length(t.route) <= maximumCarrierLength(input, t.connection_name!) + 1e-7,
  )
    ? paired
    : null
}
