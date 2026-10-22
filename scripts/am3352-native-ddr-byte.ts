import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../lib/types"

/** Recreate one native byte phase from the public fixture, without saved copper. */
export function loadNativeDdrByte(
  busId: "DDR_BYTE0" | "DDR_BYTE1",
): SimpleRouteJson {
  const full: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../tests/fixtures/am3352-full-ddr/native-phase-1.simple-route.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )

  const input = structuredClone(full),
    bus = input.buses!.find((b) => b.busId === busId)!
  const names = new Set(bus.connectionNames)
  input.connections = input.connections.filter((c) => names.has(c.name))
  bus.maxLength = Math.max(
    ...input.connections.map((c) => {
      const [a, b] = c.pointsToConnect
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    }),
  )
  delete bus.minLength
  bus.allowedLayers = ["top", "bottom"]
  bus.preferredLayer = busId === "DDR_BYTE0" ? "top" : "bottom"
  input.buses = [bus]
  input.differentialPairs = input.differentialPairs!.filter((p) =>
    p.connectionNames.every((n) => names.has(n)),
  )
  return input
}
