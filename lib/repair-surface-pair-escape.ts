import { routeAlternateSignalDogbones } from "./alternate-signal-dogbones"
import { routeCoupledPair } from "./coupled-pair-routing"
import { generatedEscapeHolesConflict } from "./expanded-signal-sites"
import { signalLayers, type FlexibleSignalState } from "./flexible-signal-state"
import { length } from "./geometry"
import { negotiateSignalSites } from "./negotiate-signal-sites"
import { ownedSignalEscapes, signalDogboneOptions } from "./repair-bus-dogbones"
import { maximumCarrierLength } from "./route-lengths"
import { runBoundedRouting } from "./run-bounded-routing"
import type { SimpleRouteJson, Trace } from "./types"
import { fixedCopper } from "./vector-scene"

/** Recompute solver-owned pair escapes in board-world XY mm (+X right, +Y up).
 * A counterfactual ordinary candidate identifies which pair blocks its package
 * access. Reserve that computed copper while trying native surface terminals
 * and fresh dogbones on allowed carrier planes. Supplied copper stays fixed. */
export function* repairSurfacePairEscape(
  state: FlexibleSignalState,
  blocked: string,
  excluded: ReadonlySet<string>,
): Generator<void, FlexibleSignalState | null> {
  for (const pair of state.native.differentialPairs ?? []) {
    const names = new Set(pair.connectionNames)
    const retained = state.retained.filter(
      (trace) => !names.has(trace.connection_name!),
    )
    const escapes = state.escapes.filter(
      (trace) =>
        !names.has(trace.connection_name!) && trace.connection_name !== blocked,
    )
    const released: FlexibleSignalState = {
      ...state,
      retained,
      escapes,
      traces: [],
    }
    const ordinary = yield* runBoundedRouting(
      negotiateSignalSites(released, new Set([blocked]), false, false, {
        allowExpandedSites: true,
        maxCandidateSearchNodes: 12000,
      }),
      12000,
    )
    if (!ordinary) continue
    const ordinaryEscapes = ordinary.escapes.filter(
      (trace) => trace.connection_name === blocked,
    )
    const members = state.native.connections.filter((connection) =>
      names.has(connection.name),
    )
    const layers = signalLayers(state.native, members[0]).filter((layer) =>
      members.every((member) =>
        signalLayers(state.native, member).includes(layer),
      ),
    )
    const held = [
      ...(state.native.traces ?? []),
      ...escapes,
      ...retained,
      ...ordinaryEscapes,
      ...ordinary.traces,
    ]
    for (const layer of layers) {
      const surface = members.every((connection) =>
        connection.pointsToConnect.every((point) => point.layer === layer),
      )
      for (let quadrant = 0; quadrant < (surface ? 1 : 4); quadrant++) {
        let connections = members,
          pairEscapes: Trace[] = []
        if (!surface) {
          const local = { ...state.native, connections: members, traces: held }
          try {
            const generated = routeAlternateSignalDogbones(
              local,
              signalDogboneOptions(
                local,
                new Map(members.map((member) => [member.name, layer])),
              ),
              quadrant,
            )
            connections =
              generated.connections as SimpleRouteJson["connections"]
            pairEscapes = ownedSignalEscapes(state.native, generated.traces)
            if (
              generatedEscapeHolesConflict(state.native, pairEscapes, held) ||
              pairEscapes.some((escape, index) =>
                generatedEscapeHolesConflict(
                  state.native,
                  [escape],
                  pairEscapes.slice(index + 1),
                ),
              )
            )
              continue
          } catch {
            yield
            continue
          }
        }
        const local: SimpleRouteJson = {
          ...state.native,
          connections: state.native.connections.map(
            (connection) =>
              connections.find((member) => member.name === connection.name) ??
              connection,
          ),
          traces: [...held, ...pairEscapes],
        }
        const fixed = fixedCopper(local)
        for (const variant of [0, 1, 2, 3]) {
          const paired = yield* runBoundedRouting(
            routeCoupledPair(local, pair, fixed, {
              copper: [],
              penalty: 0,
              variant,
              preferPackageOnlyTuning: true,
            }),
            6000,
          )
          if (
            !paired ||
            paired.some(
              (trace) =>
                length(trace.route) >
                maximumCarrierLength(local, trace.connection_name!) + 1e-7,
            )
          )
            continue
          const candidate = [...retained, ...paired]
          if (
            excluded.has(JSON.stringify(candidate.map((trace) => trace.route)))
          )
            continue
          return {
            ...state,
            retained: candidate,
            traces: ordinary.traces,
            escapes: [...escapes, ...pairEscapes, ...ordinaryEscapes],
          }
        }
      }
    }
  }
  return null
}
