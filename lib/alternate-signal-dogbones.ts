import { backwardFacingPackageTerminals } from "./backward-facing-package-terminals"
import { routeLocalSignalDogbones } from "@tscircuit/fanout-solver"
import type { SimpleRouteJson, Point } from "./types"

/** The site matcher's preferred quadrant is expressed in a routing frame.
 * Rotate the entire scene (including fixed copper), then invert only newly
 * generated dogbones. This explores site choices without moving fixed copper. */
export function routeAlternateSignalDogbones(
  input: SimpleRouteJson,
  options: Parameters<typeof routeLocalSignalDogbones>[1],
  attempt: number,
): ReturnType<typeof routeLocalSignalDogbones> {
  try {
    return routeVariant(input, options, attempt)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "No collision-free local dogbone assignment"
    )
      throw error
    const targets = new Map(options.targetLayers)
    const nativeLayer = (name: string) => {
      const connection = input.connections.find((c) => c.name === name)
      if (!connection || connection.pointsToConnect.length !== 2) return
      const layer = connection.pointsToConnect[0].layer
      if (
        !connection.pointsToConnect.every((point) => point.layer === layer) ||
        !input.allowedLayers?.includes(layer) ||
        (input.buses ?? []).some(
          (bus) =>
            bus.connectionNames.includes(name) &&
            bus.allowedLayers &&
            !bus.allowedLayers.includes(layer),
        )
      )
        return
      return layer
    }
    let changed = false
    for (const connection of input.connections) {
      const layer = nativeLayer(connection.name)
      if (!layer || targets.get(connection.name) === layer) continue
      // A failed all-local assignment must not prevent native surface search.
      // Only a connection with no legal local assignment in any quadrant is
      // moved back to its original permitted plane. Fixed copper is untouched.
      const single = {
        ...input,
        connections: [connection],
        buses: [],
        differentialPairs: [],
      }
      let possible = false
      for (let quadrant = 0; quadrant < 4 && !possible; quadrant++) {
        try {
          routeVariant(single, options, quadrant)
          possible = true
        } catch {
          /* Every local quadrant is an independent physical candidate. */
        }
      }
      if (possible) continue
      targets.set(connection.name, layer)
      changed = true
    }
    if (!changed) throw error
    // Differential partners share a carrier plane. A fallback is legal only
    // when both partners can retain the same original permitted native plane.
    for (const pair of input.differentialPairs ?? []) {
      const [a, b] = pair.connectionNames
      if (targets.get(a) === targets.get(b)) continue
      const layer = nativeLayer(a)
      if (!layer || nativeLayer(b) !== layer) throw error
      targets.set(a, layer)
      targets.set(b, layer)
    }
    return routeVariant(input, { ...options, targetLayers: targets }, attempt)
  }
}

function routeVariant(
  input: SimpleRouteJson,
  options: Parameters<typeof routeLocalSignalDogbones>[1],
  attempt: number,
): ReturnType<typeof routeLocalSignalDogbones> {
  const delta = input.connections.reduce(
    (s, c) => ({
      x: s.x + c.pointsToConnect[1].x - c.pointsToConnect[0].x,
      y: s.y + c.pointsToConnect[1].y - c.pointsToConnect[0].y,
    }),
    { x: 0, y: 0 },
  )
  const base = Math.abs(delta.x) > Math.abs(delta.y) ? (delta.x > 0 ? 3 : 1) : 0
  const busNames = new Set(
    (input.buses ?? []).flatMap((b) => b.connectionNames),
  )
  const backward = backwardFacingPackageTerminals({
    ...input,
    connections: input.connections.filter((c) => busNames.has(c.name)),
  })
  // Empty carriers can begin beside the pad column, keeping the local
  // approach available for rounded skew correction. Supplied copper keeps
  // the established first site choice; every retry visits a distinct quadrant.
  const order = input.traces?.length
    ? [0, ...[0, 1, 2, 3].map((i) => (base + i) % 4).filter((i) => i !== 0)]
    : [3, 0, 1, 2].map((i) => (base + i) % 4)
  const turns = backward ? (base + attempt) % 4 : order[attempt % 4]
  const rotate = <T extends Point>(p: T, k: number): T => {
    let { x, y } = p
    for (let i = 0; i < k; i++) [x, y] = [-y, x]
    return { ...p, x, y }
  }
  const corners = [
    { x: input.bounds.minX, y: input.bounds.minY },
    { x: input.bounds.maxX, y: input.bounds.maxY },
  ].map((p) => rotate(p, turns))
  const rotated = {
    ...input,
    bounds: {
      minX: Math.min(...corners.map((p) => p.x)),
      maxX: Math.max(...corners.map((p) => p.x)),
      minY: Math.min(...corners.map((p) => p.y)),
      maxY: Math.max(...corners.map((p) => p.y)),
    },
    connections: input.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => rotate(p, turns)),
    })),
    obstacles: input.obstacles.map((o) => ({
      ...o,
      center: rotate(o.center, turns),
      ccwRotationDegrees: (o.ccwRotationDegrees ?? 0) + 90 * turns,
    })),
    traces: input.traces?.map((t) => ({
      ...t,
      route: t.route.map((p) => rotate(p, turns)),
    })),
  }
  const result = routeLocalSignalDogbones(
    rotated as Parameters<typeof routeLocalSignalDogbones>[0],
    options,
  )
  return {
    connections: result.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => rotate(p, (4 - turns) % 4)),
    })),
    traces: result.traces.map((t) => ({
      ...t,
      route: t.route.map((p) => {
        if (!("x" in p)) throw Error("Unexpected dogbone primitive")
        return rotate(p, (4 - turns) % 4)
      }),
    })),
  }
}
