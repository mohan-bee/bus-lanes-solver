import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import type { Connection, SimpleRouteJson } from "./types"

/** Intersect global and every owning bus restriction in physical stack order. */
export function effectiveCarrierLayers(
  input: SimpleRouteJson,
  connection: Connection,
): string[] {
  return getCopperLayerNames(input.layerCount).filter(
    (layer) =>
      (!input.allowedLayers || input.allowedLayers.includes(layer)) &&
      (input.buses ?? []).every(
        (bus) =>
          !bus.connectionNames.includes(connection.name) ||
          !bus.allowedLayers ||
          bus.allowedLayers.includes(layer),
      ),
  )
}

/** Native pad layers require explicit permission, globally or on an owning bus.
 * Unrestricted inputs retain their existing preference for non-pad carriers. */
export function explicitlyAllowsCarrierLayer(
  input: SimpleRouteJson,
  connection: Connection,
  layer: string,
): boolean {
  return !!(
    input.allowedLayers?.includes(layer) ||
    input.buses?.some(
      (bus) =>
        bus.connectionNames.includes(connection.name) &&
        bus.allowedLayers?.includes(layer),
    )
  )
}

/** A private routing view only. A redundant global surface restriction must not
 * change allocation, native strategy selection or its aggregate search budget.
 * Uncovered/empty domains and inner carriers keep the existing general path. */
export function withInferredSurfaceLayers(
  input: SimpleRouteJson,
): SimpleRouteJson {
  if (input.allowedLayers || !input.connections.length) return input
  if (
    input.connections.some(
      (connection) =>
        !input.buses?.some(
          (bus) =>
            bus.connectionNames.includes(connection.name) && bus.allowedLayers,
        ),
    )
  )
    return input
  const domains = input.connections.map((connection) =>
    effectiveCarrierLayers(input, connection),
  )
  if (domains.some((layers) => !layers.length)) return input
  const union = new Set(domains.flat())
  if (union.size !== 2 || !union.has("top") || !union.has("bottom"))
    return input
  return { ...input, allowedLayers: ["top", "bottom"] }
}
