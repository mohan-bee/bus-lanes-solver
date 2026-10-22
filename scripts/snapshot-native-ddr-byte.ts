import { writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { loadNativeDdrByte } from "./am3352-native-ddr-byte"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import {
  getPngBufferFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import { busLengthReports, pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import type { SimpleRouteJson, Trace } from "../lib/types"
const id = "byte1"
const input = loadNativeDdrByte("DDR_BYTE1")
const before = JSON.stringify(input)
const solver = new BusLanesPipelineSolver(input)
const start = performance.now()
while (!solver.solved && !solver.failed && solver.iterations < 35000)
  solver.step()
if (!solver.solved || solver.failed)
  throw Error("Refusing an incomplete byte snapshot")
const output = solver.getOutput(),
  fixed = input.traces ?? [],
  traces = solver.traces
const report = {
  solved: solver.solved,
  failed: solver.failed,
  inputUnchanged: before === JSON.stringify(input),
  seconds: (performance.now() - start) / 1000,
}
if (
  !report.solved ||
  report.failed ||
  !report.inputUnchanged ||
  JSON.stringify(output.traces!.slice(0, fixed.length)) !==
    JSON.stringify(fixed)
)
  throw Error("Refusing incomplete or mutated output")
if (
  traces.length !== input.connections.length ||
  input.connections.some((c) => {
    const t = traces.find((t) => t.connection_name === c.name)
    return (
      !t ||
      [0, 1].some((i) => {
        const p = i ? t.route.at(-1)! : t.route[0]
        return (
          p.route_type !== "wire" ||
          p.layer !== c.pointsToConnect[i].layer ||
          Math.hypot(
            p.x - c.pointsToConnect[i].x,
            p.y - c.pointsToConnect[i].y,
          ) > 1e-8
        )
      })
    )
  })
)
  throw Error("Incomplete connectivity")
const drc = validateRoutedCopperDrc({
  inputSrj: input as never,
  routedSrj: output as never,
  clearance: input.minTraceToPadEdgeClearance ?? 0.075,
  allowBlindAndBuriedVias: false,
})
const buses = busLengthReports(input, traces),
  pairs = pairLengthReports(input, traces),
  coupling = exteriorPairSpacingReports(input, traces)
const audit = {
  solved: true,
  connections: traces.length,
  fixedTracesPreserved: fixed.length,
  drc,
  buses,
  pairs,
  coupling,
  solveSeconds: report.seconds,
  inputSha256: createHash("sha256").update(before).digest("hex"),
  solverIterations: solver.iterations,
  scope: "Completed DDR_BYTE1 only; not the full SBC",
}
if (
  !drc.valid ||
  buses.some((b) => !b.matched || !b.withinLengthLimit) ||
  pairs.some((p) => !p.matched) ||
  coupling.some((p) => !p.matched)
) {
  throw Error("Refusing invalid native route snapshot")
}
const all = [...fixed, ...traces],
  points = all.flatMap((t) => t.route),
  minX = Math.min(...points.map((p) => p.x)) - 1,
  maxX = Math.max(...points.map((p) => p.x)) + 1,
  minY = Math.min(...points.map((p) => p.y)) - 1,
  maxY = Math.max(...points.map((p) => p.y)) + 1,
  w = maxX - minX,
  h = maxY - minY,
  gap = 2
const graphics: GraphicsObject = {
  coordinateSystem: "cartesian",
  lines: [],
  circles: [],
  rects: [],
  texts: [],
  title: `Native ${id} — ${traces.length}/${traces.length} connected; DRC and matching passed`,
}
for (const [i, layer] of ["top", "bottom"].entries()) {
  const dx = i * (w + gap),
    color = layer === "top" ? "#ed8e86" : "#8cdbba"
  graphics.rects!.push({
    center: { x: (minX + maxX) / 2 + dx, y: (minY + maxY) / 2 },
    width: w,
    height: h,
    fill: "none",
    stroke: "#526174",
  })
  for (const o of input.obstacles.filter(
    (o) =>
      o.center.x >= minX &&
      o.center.x <= maxX &&
      o.center.y >= minY &&
      o.center.y <= maxY &&
      o.layers.includes(layer),
  )) {
    if (o.shape === "circle")
      graphics.circles!.push({
        center: { x: o.center.x + dx, y: o.center.y },
        radius: o.width / 2,
        fill: "#41404c",
        stroke: "none",
      })
    else
      graphics.rects!.push({
        center: { x: o.center.x + dx, y: o.center.y },
        width: o.width,
        height: o.height,
        fill: "#41404c",
        stroke: "none",
        ccwRotationDegrees: o.ccwRotationDegrees,
      })
  }
  for (const [index, t] of all.entries()) {
    const stroke = index < fixed.length ? "#72808f" : color
    for (let j = 1; j < t.route.length; j++) {
      const a = t.route[j - 1],
        b = t.route[j]
      const l =
        a.route_type === "wire"
          ? a.layer
          : b.route_type === "wire"
            ? b.layer
            : undefined
      if (
        l === layer &&
        (a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer === b.layer)
      )
        graphics.lines!.push({
          points: [
            { x: a.x + dx, y: a.y },
            { x: b.x + dx, y: b.y },
          ],
          strokeColor: stroke,
          strokeWidth:
            a.route_type === "wire"
              ? a.width
              : b.route_type === "wire"
                ? b.width
                : 0.1,
        })
    }
    for (const p of t.route)
      if (
        p.route_type === "via" &&
        (p.layers ?? [p.from_layer, p.to_layer]).includes(layer)
      ) {
        graphics.circles!.push({
          center: { x: p.x + dx, y: p.y },
          radius: (p.via_diameter ?? 0.5) / 2,
          fill: stroke,
          stroke: "none",
        })
        graphics.circles!.push({
          center: { x: p.x + dx, y: p.y },
          radius: (p.via_hole_diameter ?? 0.3) / 2,
          fill: "#10151b",
          stroke: "none",
        })
      }
  }
  graphics.texts!.push({
    x: minX + dx,
    y: maxY + 0.6,
    text: layer,
    fontSize: 0.65,
    color,
    anchorSide: "bottom_left",
  })
}
graphics.texts!.push({
  x: minX,
  y: maxY + 2.2,
  text: `${id.toUpperCase()} · ${traces.length}/${traces.length} · DRC / timing passed`,
  fontSize: 0.5,
  color: "#e5edf5",
  anchorSide: "bottom_left",
})
graphics.texts!.push({
  x: minX,
  y: minY - 0.8,
  text: `0.30 mm drill / 0.50 mm land · ${fixed.length} fixed traces`,
  fontSize: 0.32,
  color: "#aab8c8",
  anchorSide: "top_left",
})
graphics.texts!.push({
  x: minX,
  y: minY - 1.5,
  text: "Completed scoped byte; full SBC remains unrouted",
  fontSize: 0.32,
  color: "#aab8c8",
  anchorSide: "top_left",
})
const dir = new URL("../docs/native-ddr-sequential/", import.meta.url)
mkdirSync(dir, { recursive: true })
const png = await getPngBufferFromGraphicsObject(graphics, {
  pngWidth: 2000,
  pngHeight: Math.round((2000 * (h + 4)) / (2 * w + gap)),
  yFlip: true,
  backgroundColor: "#10151b",
  includeTextLabels: false,
})
writeFileSync(new URL(`${id}-completed.png`, dir), png)
writeFileSync(
  new URL(`${id}-audit.json`, dir),
  JSON.stringify(audit, null, 2) + "\n",
)
console.log(
  JSON.stringify({
    id,
    drc: drc.valid,
    connections: traces.length,
    pngBytes: png.length,
    busSkew: buses.map((b) => b.skewMm),
    pairSkew: pairs.map((p) => p.skewMm),
  }),
)
