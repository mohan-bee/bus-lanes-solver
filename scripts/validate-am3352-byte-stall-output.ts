import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { Obstacle, SimpleRouteJson, Terminal, Trace, Via } from "../lib"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { distance, pointSegmentDistanceToPoints } from "../lib/geometry"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { pairCouplingReports } from "../lib/pair-coupling"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import { am3352Carrier } from "./am3352-carrier"
import { measureAm3352RoutingQuality } from "./measure-am3352-routing-quality"

const physicalLayers = ["top", "inner1", "inner2", "bottom"]
const epsilon = 1e-7
type CapturedObstacle = Obstacle & { isNonPlatedHole?: boolean }
type CapturedInput = SimpleRouteJson & {
  minTraceToHoleEdgeClearance?: number
}

/** Audit complete pad-to-pad output against the untouched native byte capture.
 * Geometry is in board-world millimetres (+X right, +Y up); no fixed copper or
 * synthetic connections are added to either side of the independent DRC. */
export function validateAm3352ByteStallOutput(
  input: SimpleRouteJson,
  output: SimpleRouteJson,
) {
  const issues: string[] = []
  const traces = output.traces ?? []
  const { traces: _inputTraces, ...inputGeometry } = input
  const { traces: _outputTraces, ...outputGeometry } = output
  const inputPreserved =
    JSON.stringify(inputGeometry) === JSON.stringify(outputGeometry)
  if (!inputPreserved) issues.push("Output changed native routing input")
  if (
    input.connections.length !== 11 ||
    input.obstacles.length !== 1144 ||
    (input.traces?.length ?? 0) !== 0 ||
    input.layerCount !== 4 ||
    input.allowedLayers !== undefined ||
    input.buses?.length !== 2 ||
    input.differentialPairs?.length !== 1
  )
    issues.push("Expected the unchanged eleven-signal native byte capture")

  const matches = (point: Trace["route"][number], terminal: Terminal) =>
    point.route_type === "wire" &&
    point.layer === terminal.layer &&
    distance(point, terminal) <= epsilon
  const complete =
    traces.length === 11 &&
    input.connections.every((connection) => {
      const owned = traces.filter(
        (trace) => trace.connection_name === connection.name,
      )
      if (owned.length !== 1 || owned[0].route.length < 2) return false
      const trace = owned[0]
      if (trace.source_trace_id !== connection.source_trace_id) return false
      const first = trace.route[0]
      const last = trace.route.at(-1)!
      const [a, b] = connection.pointsToConnect
      return (
        a.layer === "top" &&
        b.layer === "top" &&
        ((matches(first, a) && matches(last, b)) ||
          (matches(first, b) && matches(last, a)))
      )
    })
  if (!complete)
    issues.push("Signals do not join all original pads exactly once")
  if (new Set(traces.map((trace) => trace.pcb_trace_id)).size !== traces.length)
    issues.push("Duplicate output trace IDs")

  const clearance = input.minTraceToPadEdgeClearance ?? 0.1
  const edgeClearance = input.minBoardEdgeClearance ?? 0.2
  const carriers = new Map<string, ReturnType<typeof am3352Carrier>>()
  const vias: Array<{ point: Via; connectionName: string | undefined }> = []
  for (const trace of traces) {
    const name = trace.connection_name
    const connection = input.connections.find((c) => c.name === name)
    const carrier = am3352Carrier(trace)
    if (name) carriers.set(name, carrier)
    const bus = input.buses?.find((b) => b.connectionNames.includes(name ?? ""))
    const layer = bus?.allowedLayers?.[0]
    if (
      !connection ||
      !carrier ||
      !layer ||
      bus?.allowedLayers?.length !== 1 ||
      carrier.layer !== layer ||
      carrier.viaCount !== (layer === "top" ? 0 : 2) ||
      !tuningPathIsSelfClear(carrier.route, 0.1 + clearance)
    )
      issues.push(`${name}: invalid bus carrier or self-clearance`)
    for (const point of trace.route) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        (point.route_type === "wire"
          ? !Number.isFinite(point.width) ||
            Math.abs(point.width - 0.1) > epsilon ||
            !physicalLayers.includes(point.layer)
          : !Number.isFinite(point.via_diameter) ||
            !Number.isFinite(point.via_hole_diameter) ||
            Math.abs(point.via_diameter! - 0.5) > epsilon ||
            Math.abs(point.via_hole_diameter! - 0.3) > epsilon ||
            JSON.stringify(point.layers) !== JSON.stringify(physicalLayers) ||
            !["top", "bottom"].includes(point.from_layer) ||
            !["top", "bottom"].includes(point.to_layer) ||
            point.from_layer === point.to_layer)
      )
        issues.push(`${name}: invalid copper dimensions or physical layer`)
      const radius =
        point.route_type === "wire" ? point.width / 2 : point.via_diameter! / 2
      if (
        point.x - radius < input.bounds.minX + edgeClearance - epsilon ||
        point.x + radius > input.bounds.maxX - edgeClearance + epsilon ||
        point.y - radius < input.bounds.minY + edgeClearance - epsilon ||
        point.y + radius > input.bounds.maxY - edgeClearance + epsilon
      )
        issues.push(`${name}: copper violates the board-edge clearance`)
      if (point.route_type === "via") vias.push({ point, connectionName: name })
    }
  }
  if (vias.length !== 12)
    issues.push("Expected twelve full-through signal vias")
  const carrierLayers = (input.buses ?? []).map((bus) => ({
    busId: bus.busId,
    layers: bus.connectionNames.map(
      (name) => carriers.get(name)?.layer ?? null,
    ),
  }))

  // Copper DRC has one copper clearance, so audit the distinct drill rule too,
  // including same-net holes. Native NPTH circles retain their physical radius.
  const holeClearance = input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.2
  const traceHoleClearance =
    (input as CapturedInput).minTraceToHoleEdgeClearance ?? 0.2
  const holes = (input.obstacles as CapturedObstacle[]).filter(
    (obstacle) => obstacle.isNonPlatedHole,
  )
  if (
    holes.some(
      (hole) =>
        hole.shape !== "circle" || Math.abs(hole.width - hole.height) > epsilon,
    )
  )
    issues.push("Native nonplated-hole geometry is not a physical circle")
  for (let i = 0; i < vias.length; i++) {
    const via = vias[i].point
    for (const other of vias.slice(i + 1))
      if (
        distance(via, other.point) -
          (via.via_hole_diameter! + other.point.via_hole_diameter!) / 2 <
        holeClearance - epsilon
      )
        issues.push("Generated via holes violate drill clearance")
    for (const hole of holes) {
      if (
        distance(via, hole.center) -
          hole.width / 2 -
          via.via_hole_diameter! / 2 <
        holeClearance - epsilon
      )
        issues.push(
          "Generated via hole violates native nonplated-hole clearance",
        )
    }
  }
  for (const trace of traces)
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]
      const b = trace.route[i]
      if (a.route_type !== "wire" || b.route_type !== "wire") continue
      for (const hole of holes)
        if (
          hole.layers.includes(a.layer) &&
          pointSegmentDistanceToPoints(hole.center, a, b) -
            hole.width / 2 -
            a.width / 2 <
            traceHoleClearance - epsilon
        )
          issues.push("Signal trace violates native nonplated-hole clearance")
      for (const via of vias)
        if (
          via.connectionName !== trace.connection_name &&
          pointSegmentDistanceToPoints(via.point, a, b) -
            via.point.via_hole_diameter! / 2 -
            a.width / 2 <
            traceHoleClearance - epsilon
        )
          issues.push("Signal trace violates another net's via-hole clearance")
    }

  const copperDrc = validateRoutedCopperDrc({
    inputSrj: input,
    routedSrj: output,
    clearance,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  const buses = busLengthReports(input, traces)
  const pairs = pairLengthReports(input, traces)
  const shared = sharedPairSpacingReports(input, traces)
  const exterior = exteriorPairSpacingReports(input, traces)
  const coupling = pairCouplingReports(input, traces)
  const quality = measureAm3352RoutingQuality(input, traces)
  const matched =
    buses.length === 2 &&
    pairs.length === 1 &&
    [...buses, ...pairs].every(
      (report) =>
        report.matched && report.withinLengthLimit && report.aboveMinimumLength,
    )
  const coupled =
    shared.length === 1 &&
    exterior.length === 1 &&
    coupling.length === 1 &&
    shared.every((report) => report.matched) &&
    exterior.every(
      (report) =>
        report.applicable &&
        report.matched &&
        report.separatedExteriorLengthMm === 0,
    ) &&
    coupling.every((report) => report.matched)
  if (!copperDrc.valid) issues.push("Independent copper DRC failed")
  if (!matched) issues.push("Absolute bus lengths or bus/pair skew failed")
  if (!coupled)
    issues.push("Shared or exterior differential-pair coupling failed")
  issues.push(...quality.issues)
  return {
    valid: inputPreserved && complete && !issues.length,
    inputPreserved,
    complete,
    signals: traces.length,
    viaCount: vias.length,
    nonPlatedHoleCount: holes.length,
    carrierLayers,
    matched,
    coupled,
    copperDrc,
    buses,
    pairs,
    shared,
    exterior,
    coupling,
    quality,
    issues: [...new Set(issues)],
  }
}
