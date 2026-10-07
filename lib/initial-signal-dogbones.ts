import { routeAlternateSignalDogbones } from "./alternate-signal-dogbones"
import { isUnroutedComponentPad } from "./is-unrouted-component-pad"
import type { Connection, SimpleRouteJson } from "./types"

type Options = Parameters<typeof routeAlternateSignalDogbones>[1]

/** A pad-layer route needs no local via. If the preferred carrier allocation
 * fails, keep signals with no legal local via on their allowed native surface.
 * Bus co-location is a preference; differential partners must remain together.
 * Only solver-owned approaches change. Supplied copper remains immutable. */
export function initialSignalDogbones(
  input: SimpleRouteJson,
  options: Options,
  attempt: number,
) {
  try {
    return routeAlternateSignalDogbones(input, options, attempt)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "No collision-free local dogbone assignment"
    )
      throw error
    const targets = new Map(options.targetLayers)
    const available = (c: Connection, layer: string) =>
      input.allowedLayers?.includes(layer) &&
      c.pointsToConnect.every(
        (p) => p.layer === layer && isUnroutedComponentPad(input, c, p),
      ) &&
      (input.buses ?? []).every(
        (b) =>
          !b.connectionNames.includes(c.name) ||
          !b.allowedLayers ||
          b.allowedLayers.includes(layer),
      )
    let changed = false
    for (const c of input.connections) {
      const layer = c.pointsToConnect[0].layer
      if (targets.get(c.name) === layer || !available(c, layer)) continue
      const local = {
        ...input,
        connections: [c],
        buses: [],
        differentialPairs: [],
      }
      let hasSite = false
      for (let turn = 0; turn < 4 && !hasSite; turn++) {
        try {
          routeAlternateSignalDogbones(
            local,
            { ...options, targetLayers: targets },
            turn,
          )
          hasSite = true
        } catch {}
      }
      if (hasSite) continue
      const pair = input.differentialPairs?.find((p) =>
        p.connectionNames.includes(c.name),
      )
      const cohort = input.connections.filter((p) =>
        pair ? pair.connectionNames.includes(p.name) : p.name === c.name,
      )
      if (!cohort.every((p) => available(p, layer))) continue
      for (const p of cohort) targets.set(p.name, layer)
      changed = true
    }
    if (!changed) throw error
    return routeAlternateSignalDogbones(
      input,
      { ...options, targetLayers: targets },
      attempt,
    )
  }
}
