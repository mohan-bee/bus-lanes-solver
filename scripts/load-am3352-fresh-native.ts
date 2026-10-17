import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../lib/types"

/** Exact CLI capture, including omitted optional fields; never normalize it. */
export function loadAm3352FreshNativeInput(): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      "../tests/fixtures/am3352-fresh-native/whole-ddr.simple-route.json.gz",
      import.meta.url,
    ),
  )
  const bytes = gunzipSync(compressed)
  const sha256 = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex")
  if (
    sha256(compressed) !==
      "3b34bdde4d7dd6d7b8424a09c8cb53be7074dae4c6135d89dac396cfdc1c4aed" ||
    sha256(bytes) !==
      "3aaecdebece8150ea60c95e17995996e2d84f71d035df51603d5a8e136f15164"
  )
    throw Error("AM3352 fresh native input bytes changed")
  const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
  if (
    input.connections.length !== 46 ||
    input.obstacles.length !== 1144 ||
    (input.traces?.length ?? 0) !== 0
  )
    throw Error("Unexpected AM3352 fresh native input counts")
  return input
}
