import nativeInput from "../tests/fixtures/am3352-sbc/native-input.json"
import metadata from "../tests/fixtures/am3352-sbc/metadata.json"
import relocations from "../tests/fixtures/am3352-sbc/byte-corridor-relocations.json"
import type { SimpleRouteJson } from "../lib"
export { metadata as am3352SbcMetadata }
/** Full board: all pads and holes; only DDR is unresolved. Fixed GND copper is
 * immutable. The benchmark comparison changes constraints, never geometry. */
export function loadAm3352SbcSample(
  timing: "benchmark" | "complete" = "complete",
  placement: "published" | "byte-corridors" = "published",
  scope: "all" | "byte0" | "byte1" = "all",
): SimpleRouteJson {
  const input = structuredClone(nativeInput) as unknown as SimpleRouteJson
  if (placement === "byte-corridors") {
    for (const obstacle of input.obstacles) {
      const move = relocations[obstacle.componentId as keyof typeof relocations]
      if (!move) continue
      obstacle.center.x += move.dx
      obstacle.center.y += move.dy
    }
  }
  if (timing === "benchmark")
    input.buses = input.buses!.filter((b) =>
      /^DDR_BYTE/.test(b.name ?? b.busId),
    )
  if (scope !== "all") {
    input.buses = input.buses!.filter(
      (b) => b.busId === `DDR_BYTE${scope.at(-1)}`,
    )
    const names = new Set(input.buses[0].connectionNames)
    input.connections = input.connections.filter((c) => names.has(c.name))
    input.differentialPairs = input.differentialPairs!.filter((p) =>
      p.connectionNames.every((n) => names.has(n)),
    )
  }
  return input
}
