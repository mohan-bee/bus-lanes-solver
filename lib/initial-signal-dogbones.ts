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
      (!input.allowedLayers || input.allowedLayers.includes(layer)) &&
      c.pointsToConnect.every(
        (p) => p.layer === layer && isUnroutedComponentPad(input, c, p),
      ) &&
      (input.buses ?? []).every(
        (b) =>
          !b.connectionNames.includes(c.name) ||
          !b.allowedLayers ||
          b.allowedLayers.includes(layer),
      )
    const unavailableLocalVia: string[] = []
    const nativeFallbacks: {
      connectionName: string
      fromLayer: string | undefined
      toLayer: string
    }[] = []
    let cohortTrials = 0
    const contextualError = (cause: Error, stage: string) =>
      new Error(
        `${cause.message}; stage=${stage}; attempt=${attempt}; fixedTraces=${input.traces?.length ?? 0}; unavailableLocalVia=${JSON.stringify(unavailableLocalVia)}; nativeFallbacks=${JSON.stringify(nativeFallbacks)}; cohortTrials=${cohortTrials}`,
        { cause },
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
      unavailableLocalVia.push(c.name)
      const pair = input.differentialPairs?.find((p) =>
        p.connectionNames.includes(c.name),
      )
      const cohort = input.connections.filter((p) =>
        pair ? pair.connectionNames.includes(p.name) : p.name === c.name,
      )
      if (!cohort.every((p) => available(p, layer))) continue
      for (const p of cohort) {
        nativeFallbacks.push({
          connectionName: p.name,
          fromLayer: targets.get(p.name),
          toLayer: layer,
        })
        targets.set(p.name, layer)
      }
      changed = true
    }
    const tryTargets = (candidate: Map<string, string>) => {
      try {
        return routeAlternateSignalDogbones(
          input,
          { ...options, targetLayers: candidate },
          attempt,
        )
      } catch (failure) {
        if (
          !(failure instanceof Error) ||
          failure.message !== "No collision-free local dogbone assignment"
        )
          throw failure
        return null
      }
    }
    if (changed) {
      const result = tryTargets(targets)
      if (result) return result
    }
    // Nonempty individual site domains do not imply a compatible collective
    // assignment. Relax one eligible native-pad cohort at a time, ordinary
    // signals before pairs, while preserving all supplied copper and layers.
    const cohorts = input.connections.map((c) => new Set([c.name]))
    for (const pair of input.differentialPairs ?? []) {
      const related = cohorts.filter((cohort) =>
        pair.connectionNames.some((name) => cohort.has(name)),
      )
      const merged = new Set(related.flatMap((cohort) => [...cohort]))
      for (const cohort of related) cohorts.splice(cohorts.indexOf(cohort), 1)
      cohorts.push(merged)
    }
    cohorts.sort((a, b) => a.size - b.size)
    const alternatives = cohorts.flatMap((names) => {
      const members = input.connections.filter((c) => names.has(c.name))
      const layer = members[0].pointsToConnect[0].layer
      return members.every((c) => available(c, layer)) &&
        members.some((c) => targets.get(c.name) !== layer)
        ? [{ members, layer }]
        : []
    })
    // Bound this fallback to at most two trials per eligible cohort rather than
    // enumerating every subset of native/carrier allocations.
    for (const { members, layer } of alternatives) {
      const candidate = new Map(targets)
      for (const member of members) candidate.set(member.name, layer)
      cohortTrials++
      const result = tryTargets(candidate)
      if (result) return result
    }
    if (alternatives.length > 1) {
      const candidate = new Map(targets)
      for (const [index, { members, layer }] of alternatives.entries()) {
        for (const member of members) candidate.set(member.name, layer)
        if (index === 0) continue // Already tried this one-cohort allocation.
        cohortTrials++
        const result = tryTargets(candidate)
        if (result) return result
      }
    }
    throw contextualError(
      error,
      changed ? "native_fallback_assignment" : "preferred_assignment",
    )
  }
}
