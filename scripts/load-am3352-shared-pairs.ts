import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { SimpleRouteJson } from "../lib/types"
import { loadAm3352FreshNativeInput } from "./load-am3352-fresh-native"

/** Exact captured pair-planning input in board-world XY mm (+X right, +Y up).
 * Reuse the existing large obstacle-owner arrays; apply captured differences
 * only. Fixed escapes are immutable solver output, never a proposed board route.
 */
export function loadAm3352SharedPairs() {
  const directory = new URL(
    "../tests/fixtures/am3352-shared-pairs/",
    import.meta.url,
  )
  const bytes = readFileSync(new URL("allocation-overlay.json", directory))
  const provenance = JSON.parse(
    readFileSync(new URL("provenance.json", directory), "utf8"),
  )
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    provenance.capturePatchSha256
  )
    throw Error("AM3352 pair-planning capture changed")
  const { obstacleChanges, terminalLayers, ...allocation } = JSON.parse(
    bytes.toString(),
  ) as Partial<SimpleRouteJson> & {
    obstacleChanges: {
      index: number
      center?: { x: number; y: number }
      width?: number
      height?: number
    }[]
    terminalLayers: [string, string[]][]
  }
  const input = loadAm3352FreshNativeInput()
  Object.assign(input, allocation)
  for (const { index, ...geometry } of obstacleChanges)
    Object.assign(input.obstacles[index], geometry)
  return { input, terminalLayers: new Map(terminalLayers) }
}
