import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  BusLanesPipelineSolver,
  busLengthReports,
  pairLengthReports,
} from "../lib"
import { am3352Hash, loadAm3352Sample } from "./am3352-samples"
import { measureAm3352RoutingQuality } from "./measure-am3352-routing-quality"
import { fixedCopper } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace } from "../lib"
import { validateAm3352OutputShape } from "./validate-am3352-sample"

/** Compact vector snapshot of actual carrier copper. Artifact acceptance is
 * performed by routeControlInner1 before this renderer is called. */
export function connectivityCarrierSvg(
  input: SimpleRouteJson,
  traces: Trace[],
) {
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
      vias.push(
        `<circle cx="${n(c.a.x)}" cy="${n(c.a.y)}" r="${n(c.radius)}"/>`,
      )
      continue
    }
    const d = paths.get(c.radius * 2) ?? []
    d.push(`M${n(c.a.x)},${n(c.a.y)}L${n(c.b.x)},${n(c.b.y)}`)
    paths.set(c.radius * 2, d)
  }
  const pads = input.obstacles
    .filter((o) => o.layers.includes("top"))
    .map((o) =>
      o.shape === "circle"
        ? `<circle cx="${n(o.center.x)}" cy="${n(o.center.y)}" r="${n(o.width / 2)}"/>`
        : `<rect x="${n(o.center.x - o.width / 2)}" y="${n(o.center.y - o.height / 2)}" width="${n(o.width)}" height="${n(o.height)}"/>`,
    )
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="900" height="${Math.round((900 * height) / width)}"><title>AM3352 control: 47 connected inner1 signals; copper DRC passed; DDR matching not enforced</title><rect width="100%" height="100%" fill="#10151b"/><g font-family="monospace" fill="#cbd5e1" font-size="0.6"><text x="0.4" y="1.2">AM3352 control / inner1</text><text x="0.4" y="2.3">47/47 connected / copper DRC passed</text><text x="0.4" y="${n(height - 2)}">161 fixed power dogbones preserved</text><text x="0.4" y="${n(height - 0.8)}">DDR matching NOT enforced</text></g><g transform="translate(${n(-minX)},${n(maxY + 4)}) scale(1,-1)"><g fill="#e56b6f" opacity="0.16">${pads}</g><g fill="none" stroke="#f1b75d" stroke-linecap="round" stroke-linejoin="round">${[...paths].map(([w, d]) => `<path stroke-width="${n(w)}" d="${d.join("")}"/>`).join("")}<g stroke-width="0.05">${vias.join("")}</g></g></g></svg>\n`
}

/** Separate connectivity-stage experiment. This never changes the declared
 * matched benchmark or its artifact acceptance gate. */
export async function routeControlInner1(directory: string) {
  const { input, metadata } = await loadAm3352Sample("control")
  input.allowedLayers = ["inner1"]
  const before = am3352Hash(input)
  const solver = new BusLanesPipelineSolver(input, {
    goal: "connectivity",
    connectivity: { fixedConnections: metadata.powerConnections },
  })
  const started = performance.now()
  while (!solver.solved && !solver.failed) {
    if (performance.now() - started > 120_000)
      throw Error("Control inner1 exceeded 120 seconds; no artifacts written")
    solver.step()
  }
  const milliseconds = performance.now() - started
  if (!solver.solved || solver.failed)
    throw Error(solver.error ?? "Connectivity failed; no artifacts written")
  const output = solver.getOutput()
  validateAm3352OutputShape(input, metadata, solver.traces, output)
  if (am3352Hash(input) !== before) throw Error("Solver changed its input")
  const validationInput = {
    ...input,
    connections: [...input.connections, ...metadata.powerConnections],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: validationInput,
    routedSrj: { ...output, connections: validationInput.connections },
    clearance: input.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  } as unknown as Parameters<typeof validateRoutedCopperDrc>[0])
  const complete = input.connections.every((c) => {
    const traces = solver.traces.filter((t) => t.connection_name === c.name)
    if (traces.length !== 1) return false
    const trace = traces[0],
      [first, last] = [trace.route[0], trace.route.at(-1)!]
    if (
      [first, last].some(
        (p, i) =>
          p.route_type !== "wire" ||
          p.layer !== c.pointsToConnect[i].layer ||
          Math.hypot(
            p.x - c.pointsToConnect[i].x,
            p.y - c.pointsToConnect[i].y,
          ) > 1e-8,
      )
    )
      return false
    const vias = trace.route.flatMap((p, i) =>
      p.route_type === "via" ? [i] : [],
    )
    return (
      vias.length === 2 &&
      trace.route
        .slice(vias[0] + 1, vias[1])
        .every((p) => p.route_type === "wire" && p.layer === "inner1")
    )
  })
  if (!complete || !drc.valid)
    throw Error(
      "Refusing connectivity artifacts without all 47 inner1 routes and zero copper DRC issues",
    )
  const lengths = {
    buses: busLengthReports(input, solver.traces),
    pairs: pairLengthReports(input, solver.traces),
  }
  const report = {
    sample: "control-inner1-connectivity",
    goal: "connectivity",
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
    matchingEnforced: false,
    matched:
      lengths.buses.every((b) => b.matched) &&
      lengths.pairs.every((p) => p.matched),
    ...lengths,
    quality: measureAm3352RoutingQuality(input, solver.traces),
    provenance: metadata.provenance,
  }
  const svg = connectivityCarrierSvg(input, solver.traces)
  // Write only after routing, immutable-output, independent DRC and connectivity gates.
  await mkdir(directory, { recursive: true })
  await Bun.write(join(directory, "control-inner1-connectivity.svg"), svg)
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
  if (process.argv.length > 3)
    throw Error("Usage: bun scripts/route-control-inner1.ts [directory]")
  await routeControlInner1(process.argv[2] ?? "work/control-inner1")
}
