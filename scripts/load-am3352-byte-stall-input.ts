import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../lib/types"

export const am3352ByteStallInputSha256 =
  "c939f7275683ea7d61f0a329c136519c7299ed865cc780e8a6b6dd307fa0e64b"

/** Exact native CLI capture in board-world mm (+X right, +Y up). Preserve
 * omitted optional fields and every pad, hole, bus and physical-layer rule. */
export function loadAm3352ByteStallInput(): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      "../tests/fixtures/am3352-byte-stall/byte0-layer-cohorts.simple-route.json.gz",
      import.meta.url,
    ),
  )
  const bytes = gunzipSync(compressed)
  const sha256 = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex")
  if (
    sha256(compressed) !==
      "d759de78b38d4a00d82fd0d4d9706a3686019d7a7e81d1de0efbc7cf1b8ddb80" ||
    sha256(bytes) !== am3352ByteStallInputSha256
  )
    throw Error("AM3352 byte-stall input bytes changed")
  const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
  if (
    input.connections.length !== 11 ||
    input.obstacles.length !== 1144 ||
    (input.traces?.length ?? 0) !== 0
  )
    throw Error("Unexpected AM3352 byte-stall input counts")
  return input
}
