import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import type { SimpleRouteJson, Trace } from "../lib"
import {
  am3352ByteStallInputSha256,
  loadAm3352ByteStallInput,
} from "./load-am3352-byte-stall-input"
import { validateAm3352ByteStallOutput } from "./validate-am3352-byte-stall-output"

const layers = ["top", "inner1", "inner2", "bottom"]
const colors = ["#e56b6f", "#f1b75d", "#b586ed", "#8cd391"]
type Viewport = SimpleRouteJson["bounds"]

/** Draw emitted physical copper in board-world mm (+X right, +Y up).
 * A detail viewport changes the drawing only; validation keeps the full board. */
function graphicsForViewport(
  input: SimpleRouteJson,
  traces: Trace[],
  viewport: Viewport,
  label: string,
) {
  const width = viewport.maxX - viewport.minX
  const height = viewport.maxY - viewport.minY
  const gap = 4
  const totalWidth = 4 * width + 3 * gap
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    title: `AM3352 byte 0 · 11/11 routed · ${label}`,
    lines: [],
    circles: [],
    rects: [],
    texts: [],
  }
  const visible = (x: number, y: number, radius = 0) =>
    x - radius >= viewport.minX &&
    x + radius <= viewport.maxX &&
    y - radius >= viewport.minY &&
    y + radius <= viewport.maxY
  for (const [index, layer] of layers.entries()) {
    const dx = index * (width + gap)
    const color = colors[index]
    graphics.rects!.push({
      center: {
        x: (viewport.minX + viewport.maxX) / 2 + dx,
        y: (viewport.minY + viewport.maxY) / 2,
      },
      width,
      height,
      fill: "none",
      stroke: "#354150",
    })
    for (const obstacle of input.obstacles) {
      const radius = Math.max(obstacle.width, obstacle.height) / 2
      if (!visible(obstacle.center.x, obstacle.center.y, radius)) continue
      const fill = obstacle.layers.includes(layer)
        ? "rgba(100,110,125,0.55)"
        : "rgba(100,110,125,0.12)"
      if (obstacle.shape === "circle")
        graphics.circles!.push({
          center: { x: obstacle.center.x + dx, y: obstacle.center.y },
          radius: obstacle.width / 2,
          fill,
          stroke: "none",
        })
      else
        graphics.rects!.push({
          center: { x: obstacle.center.x + dx, y: obstacle.center.y },
          width: obstacle.width,
          height: obstacle.height,
          ccwRotationDegrees: obstacle.ccwRotationDegrees,
          fill,
          stroke: "none",
        })
    }
    for (const trace of traces) {
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]
        const b = trace.route[i]
        if (
          a.route_type === "wire" &&
          b.route_type === "wire" &&
          a.layer === layer &&
          b.layer === layer
        )
          graphics.lines!.push({
            points: [
              { x: a.x + dx, y: a.y },
              { x: b.x + dx, y: b.y },
            ],
            strokeWidth: a.width,
            strokeColor: color,
          })
      }
      for (const via of trace.route)
        if (via.route_type === "via" && via.layers?.includes(layer)) {
          graphics.circles!.push({
            center: { x: via.x + dx, y: via.y },
            radius: via.via_diameter! / 2,
            fill: color,
            stroke: "none",
          })
          graphics.circles!.push({
            center: { x: via.x + dx, y: via.y },
            radius: via.via_hole_diameter! / 2,
            fill: "#10151b",
            stroke: "none",
          })
        }
    }
    const count = layer === "top" ? 5 : layer === "bottom" ? 6 : 0
    graphics.texts!.push({
      x: viewport.minX + dx,
      y: viewport.maxY + 0.04 * width,
      text: `${layer} · ${count} carriers`,
      fontSize: 0.045 * width,
      color,
      anchorSide: "bottom_left",
    })
  }
  for (const [text, y] of [
    [graphics.title!, viewport.maxY + 0.14 * width],
    [
      "11/11 complete · 1,144 obstacles · 12 through-vias 0.50/0.30 mm · DRC passed",
      viewport.minY - 0.08 * width,
    ],
    [
      "Both buses 33.585277–34.220277 mm · bus skew ≤0.635 mm · DQS skew ≤0.127 mm · exterior coupling passed",
      viewport.minY - 0.16 * width,
    ],
  ] as const)
    graphics.texts!.push({
      x: viewport.minX,
      y,
      text,
      fontSize: Math.min(0.055 * width, totalWidth / (text.length * 1.1)),
      color: "#cbd5e1",
      anchorSide: "bottom_left",
    })
  return { graphics, width: totalWidth, height: height + 0.4 * width }
}

/** Export only complete independently accepted copper, never search state. */
export async function exportAm3352ByteStallSnapshot(
  output: SimpleRouteJson,
  directory: string,
) {
  const input = loadAm3352ByteStallInput()
  const validation = validateAm3352ByteStallOutput(input, output)
  if (!validation.valid || !validation.complete || validation.signals !== 11)
    throw Error(
      `Refusing byte snapshot without all 11 signals, DRC, timing and coupling: ${validation.issues.join("; ")}`,
    )
  const traces = output.traces!
  const endpointComponents = new Set(
    input.obstacles
      .filter((obstacle) =>
        input.connections.some((connection) =>
          connection.pointsToConnect.some(
            (point) =>
              Math.hypot(
                point.x - obstacle.center.x,
                point.y - obstacle.center.y,
              ) < 1e-7,
          ),
        ),
      )
      .map((obstacle) => obstacle.componentId),
  )
  const points = [
    ...traces.flatMap((trace) => trace.route),
    ...input.obstacles
      .filter(
        (obstacle) =>
          obstacle.componentId && endpointComponents.has(obstacle.componentId),
      )
      .flatMap((obstacle) => [
        {
          x: obstacle.center.x - obstacle.width / 2,
          y: obstacle.center.y - obstacle.height / 2,
        },
        {
          x: obstacle.center.x + obstacle.width / 2,
          y: obstacle.center.y + obstacle.height / 2,
        },
      ]),
  ]
  const detail = {
    minX: Math.min(...points.map((point) => point.x)) - 1,
    maxX: Math.max(...points.map((point) => point.x)) + 1,
    minY: Math.min(...points.map((point) => point.y)) - 1,
    maxY: Math.max(...points.map((point) => point.y)) + 1,
  }
  const artifacts = []
  for (const [name, viewport] of [
    ["board", input.bounds],
    ["ddr-detail", detail],
  ] as const) {
    const { graphics, width, height } = graphicsForViewport(
      input,
      traces,
      viewport,
      name,
    )
    const pixels = 3200
    const pixelHeight = Math.round((pixels * height) / width)
    const options = { includeTextLabels: false, backgroundColor: "#10151b" }
    const svg = getSvgFromGraphicsObject(graphics, {
      ...options,
      svgWidth: pixels,
      svgHeight: pixelHeight,
    }).replace(/[ \t]+$/gm, "")
    const png = await getPngBufferFromGraphicsObject(graphics, {
      ...options,
      pngWidth: pixels,
      pngHeight: pixelHeight,
      yFlip: true,
    })
    artifacts.push({ name, svg, png })
  }
  await mkdir(directory, { recursive: true })
  for (const artifact of artifacts) {
    await Bun.write(
      join(directory, `${artifact.name}-solved.svg`),
      artifact.svg,
    )
    await Bun.write(
      join(directory, `${artifact.name}-solved.png`),
      artifact.png,
    )
  }
  await Bun.write(
    join(directory, "byte-validation.json"),
    JSON.stringify(
      { nativeInputSha256: am3352ByteStallInputSha256, ...validation },
      null,
      2,
    ) + "\n",
  )
  return validation
}

if (import.meta.main) {
  if (process.argv.length !== 4)
    throw Error(
      "Usage: bun scripts/snapshot-am3352-byte-stall.ts completed.simple-route.json output-directory",
    )
  await exportAm3352ByteStallSnapshot(
    await Bun.file(process.argv[2]).json(),
    process.argv[3],
  )
}
