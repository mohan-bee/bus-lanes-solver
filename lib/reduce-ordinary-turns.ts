import { connectors } from "./vector-visibility"
import { distance, length, simplify } from "./geometry"
import { tuningPathIsSelfClear } from "./length-tuning"
import type { Point } from "./types"
import type { VectorScene } from "./vector-scene"

/** Clearance-aware shortening before length tuning. Board-world mm, +X right,
 * +Y up. Never run on sampled meanders or one rail of an already coupled pair. */
export function reduceOrdinaryTurns(
  path: Point[],
  scene: VectorScene,
  connectorAlternative = 0,
  stableConnectorTies = false,
) {
  let result = simplify(path)
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (let i = 0; i < result.length - 2; i++) {
      for (let j = result.length - 1; j > i + 1; j--) {
        const old = length(result.slice(i, j + 1))
        const candidates = connectors(result[i], result[j]).sort((a, b) => {
          const delta = length(a) - length(b)
          // Native paired planning opts into stable ordering for analytically
          // equal paths. Preserve established strict ordering for fixed handoffs.
          return stableConnectorTies && Math.abs(delta) < 1e-8
            ? a.length - b.length
            : delta || a.length - b.length
        })
        let accepted = false
        for (const replacement of candidates) {
          if (
            length(replacement) > old + 1e-8 ||
            (replacement.length >= j - i + 1 &&
              length(replacement) >= old - 1e-8) ||
            !scene.pathVisible(replacement)
          )
            continue
          const candidate = simplify([
            ...result.slice(0, i),
            ...replacement,
            ...result.slice(j + 1),
          ])
          const required = scene.width / 2 + scene.margin
          // A raster path may contain several tiny returning jogs. Repair them
          // progressively; requiring the entire path to be clean after the first
          // shortcut prevents either independent jog from being removed.
          if (
            !tuningPathIsSelfClear(candidate, required) &&
            tuningPathIsSelfClear(result, required)
          )
            continue
          result = candidate
          changed = true
          accepted = true
          break
        }
        if (accepted) break
      }
    }
    if (!changed) break
  }
  if (!tuningPathIsSelfClear(result, scene.width / 2 + scene.margin))
    return path
  if (connectorAlternative > 0) {
    // Make one explicit equal-cost choice after stable shortening. Applying it
    // during repeated shortening could oscillate between symmetric elbows, or
    // discard an alternative already represented by a three-point grid path.
    for (let i = 0; i < result.length - 2; i++) {
      for (let j = result.length - 1; j > i + 1; j--) {
        const old = length(result.slice(i, j + 1))
        const choices = connectors(result[i], result[j])
          .filter(
            (replacement) =>
              replacement.length <= j - i + 1 &&
              Math.abs(length(replacement) - old) < 1e-8 &&
              scene.pathVisible(replacement),
          )
          .sort((a, b) => a.length - b.length)
          .map((replacement) =>
            simplify([
              ...result.slice(0, i),
              ...replacement,
              ...result.slice(j + 1),
            ]),
          )
          .filter((candidate) =>
            tuningPathIsSelfClear(candidate, scene.width / 2 + scene.margin),
          )
        if (choices.length > 1)
          return choices[connectorAlternative % choices.length]
      }
    }
  }
  return result
}
