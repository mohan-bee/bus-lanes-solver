import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  BusLanesPipelineSolver,
  busLengthReports,
  pairLengthReports,
} from "../lib"
import { am3352Hash, loadAm3352Sample } from "./am3352-samples"
import { measureAm3352RoutingQuality } from "./measure-am3352-routing-quality"
import { fixedCopper } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib"
import {
  validateAm3352OutputShape,
  validateAm3352Sample,
} from "./validate-am3352-sample"

/** Compact vector snapshot of actual carrier copper. Artifact acceptance is
 * performed by routeControlInner1 before this renderer is called. */
export function nativeCarrierSvg(input: SimpleRouteJson, traces: Trace[]) {
  const layer = input.allowedLayers![0],
    all = [...(input.traces ?? []), ...traces]
  const coordinates = [
    ...all.flatMap((t) => t.route),
    ...input.obstacles.flatMap((o) => [
      { x: o.center.x - o.width / 2, y: o.center.y - o.height / 2 },
      { x: o.center.x + o.width / 2, y: o.center.y + o.height / 2 },
    ]),
  ]
  const minX = Math.min(...coordinates.map((p) => p.x)) - 1,
    maxX = Math.max(...coordinates.map((p) => p.x)) + 1,
    minY = Math.min(...coordinates.map((p) => p.y)) - 1,
    maxY = Math.max(...coordinates.map((p) => p.y)) + 1
  const width = maxX - minX,
    height = maxY - minY + 9
  const n = (value: number) => Number(value.toFixed(4))
  const copper = fixedCopper({ ...input, traces: all }).filter(
    (c) => c.layer === layer,
  )
  const paths = new Map<number, string[]>(),
    vias: string[] = []
  for (const c of copper) {
    if (c.rect) continue
    if (Math.hypot(c.a.x - c.b.x, c.a.y - c.b.y) < 1e-9) {
      continue
    }
    const d = paths.get(c.radius * 2) ?? []
    d.push(`M${n(c.a.x)},${n(c.a.y)}L${n(c.b.x)},${n(c.b.y)}`)
    paths.set(c.radius * 2, d)
  }
  for (const trace of all)
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const physical =
        point.layers ??
        Array.from({ length: input.layerCount }, (_, i) =>
          i === 0 ? "top" : i === input.layerCount - 1 ? "bottom" : `inner${i}`,
        )
      if (!physical.includes(layer)) continue
      const radius = (point.via_diameter ?? input.minViaPadDiameter ?? 0.3) / 2,
        hole = (point.via_hole_diameter ?? input.minViaHoleDiameter ?? 0.15) / 2
      vias.push(
        `<circle cx="${n(point.x)}" cy="${n(point.y)}" r="${n(radius)}" fill="#f1b75d" stroke="none"/><circle cx="${n(point.x)}" cy="${n(point.y)}" r="${n(hole)}" fill="#10151b" stroke="none"/>`,
      )
    }
  const pads = input.obstacles
    .filter((o) => o.layers.includes("top"))
    .map((o) =>
      o.shape === "circle"
        ? `<circle cx="${n(o.center.x)}" cy="${n(o.center.y)}" r="${n(o.width / 2)}"/>`
        : `<rect x="${n(o.center.x - o.width / 2)}" y="${n(o.center.y - o.height / 2)}" width="${n(o.width)}" height="${n(o.height)}"/>`,
    )
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="900" height="${Math.round((900 * height) / width)}"><title>AM3352 control: 47 matched inner1 signals; native DRC and physical pair coupling passed</title><rect width="100%" height="100%" fill="#10151b"/><g font-family="monospace" fill="#cbd5e1" font-size="0.6"><text x="0.4" y="1.2">AM3352 control / inner1</text><text x="0.4" y="2.3">47/47 connected / native DRC passed</text><text x="0.4" y="${n(height - 2)}">161 fixed power dogbones preserved</text><text x="0.4" y="${n(height - 0.8)}">DDR length matching / physical pair coupling passed</text></g><g transform="translate(${n(-minX)},${n(maxY + 4)}) scale(1,-1)"><g fill="#e56b6f" opacity="0.16">${pads}</g><g fill="none" stroke="#f1b75d" stroke-linecap="round" stroke-linejoin="round">${[...paths].map(([w, d]) => `<path stroke-width="${n(w)}" d="${d.join("")}"/>`).join("")}<g>${vias.join("")}</g></g></g></svg>\n`
}

/** Fresh matched native routing, exported only after the standard sample audit. */
export async function routeControlInner1(
  directory: string,
  timeoutSeconds = 3600,
) {
  const { input, metadata } = await loadAm3352Sample("control-inner1")
  const before = am3352Hash(input)
  const solver = new BusLanesPipelineSolver(input, {
    singleCarrier: { fixedConnections: metadata.powerConnections },
  })
  const started = performance.now()
  while (!solver.solved && !solver.failed) {
    if (performance.now() - started > timeoutSeconds * 1000)
      throw Error(
        `Control inner1 exceeded ${timeoutSeconds} seconds; no artifacts written`,
      )
    solver.step()
  }
  const milliseconds = performance.now() - started
  if (!solver.solved || solver.failed)
    throw Error(solver.error ?? "Matched routing failed; no artifacts written")
  const output = solver.getOutput()
  validateAm3352OutputShape(input, metadata, solver.traces, output)
  if (am3352Hash(input) !== before) throw Error("Solver changed its input")
  const validation = await validateAm3352Sample(input, metadata, solver.traces)
  if (
    !validation.valid ||
    !validation.complete ||
    !validation.matched ||
    !validation.combinedDrc?.valid
  )
    throw Error(
      "Refusing artifacts without complete connectivity, native DRC, length matching and physical coupling",
    )
  const complete = validation.complete,
    drc = validation.combinedDrc
  const lengths = {
    buses: busLengthReports(input, solver.traces),
    pairs: pairLengthReports(input, solver.traces),
  }
  const report = {
    sample: "control-inner1",
    goal: "matched",
    complete,
    allowedLayers: input.allowedLayers,
    carrierLayerCounts: { inner1: solver.traces.length },
    requestedSignals: input.connections.length,
    routedSignals: solver.traces.length,
    fixedPowerDogbones: input.traces!.length,
    fixedPowerPreserved:
      am3352Hash(output.traces.slice(0, 161)) ===
      am3352Hash(metadata.fixedFanoutTraces),
    inputUnchanged: am3352Hash(input) === before,
    milliseconds,
    iterations: solver.iterations,
    drc,
    matchingEnforced: true,
    matched:
      lengths.buses.every((b) => b.matched) &&
      lengths.pairs.every((p) => p.matched),
    ...lengths,
    validation,
    quality: measureAm3352RoutingQuality(input, solver.traces),
    provenance: metadata.provenance,
  }
  const svg = nativeCarrierSvg(input, solver.traces)
  // Write only after the complete standard matched-sample audit.
  await mkdir(directory, { recursive: true })
  await Bun.write(join(directory, "control-inner1-matched.svg"), svg)
  await Bun.write(
    join(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  )
  await Bun.write(
    join(directory, "routed.json"),
    JSON.stringify(output, null, 2) + "\n",
  )
  console.log(JSON.stringify(report, null, 2))
  return report
}

if (import.meta.main) {
  if (process.argv.length > 4)
    throw Error(
      "Usage: bun scripts/route-control-inner1.ts [directory] [timeout-seconds]",
    )
  const timeout = Number(process.argv[3] ?? 3600)
  if (!Number.isFinite(timeout) || timeout <= 0) throw Error("Invalid timeout")
  await routeControlInner1(process.argv[2] ?? "work/control-inner1", timeout)
}
