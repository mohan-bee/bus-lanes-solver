/** Minimal native-pad carrier-domain reproduction. No router or copper output. */
import { signalLayers } from "../lib/flexible-signal-state"
import type { SimpleRouteJson } from "../lib/types"
const input: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [
    {
      name: "D0",
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 0, y: -2, layer: "top" },
      ],
    },
  ],
  obstacles: [],
  buses: [{ busId: "BYTE0", connectionNames: ["D0"], allowedLayers: ["top"] }],
}
const connection = input.connections[0]
const implicit = signalLayers(input, connection)
const explicit = signalLayers(
  { ...input, allowedLayers: ["top", "bottom"] },
  connection,
)
console.log(
  JSON.stringify(
    { busAllowedLayers: input.buses![0].allowedLayers, implicit, explicit },
    null,
    2,
  ),
)
if (
  process.argv.includes("--assert-equivalent") &&
  JSON.stringify(implicit) !== JSON.stringify(explicit)
)
  process.exitCode = 1
